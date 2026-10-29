"""상장 협력사의 시장 정보(네이버증권) 수집 → site/data/market.js

- 대상: financials.js 의 상장사(l=1). 파일이 비어 있으면 명단(universe.js)을 DART 기업 목록과 맞춰 종목코드를 찾는다.
- 네이버증권 종목 화면이 쓰는 공개 JSON(시세·투자지표·컨센서스, 연간 실적과 추정치)을 읽는다.
  JSON 이 바뀌어 비면 PC 화면(item/main)의 '기업실적분석' 표를 읽는다(오빠두엑셀 '웹 분석'과 같은 표).
- 공식 API 가 아니므로 형식이 바뀔 수 있다. 실패한 회사는 건너뛰고 나머지만 저장한다. 요청 사이 0.3초 쉰다.
- 결과는 `[market-json]` 한 줄로도 출력한다.
"""
import io
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

import build_financials as bf

ROOT_DIR = Path(__file__).resolve().parent.parent
FIN_PATH = ROOT_DIR / "site" / "data" / "financials.js"
OUT_PATH = ROOT_DIR / "site" / "data" / "market.js"
M_API = "https://m.stock.naver.com/api/stock/{}/{}"
PC_MAIN = "https://finance.naver.com/item/main.naver"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; Sangsaengnews research)", "Referer": "https://m.stock.naver.com/"}
INFO_KEYS = {"lastClosePrice": "price", "marketValue": "cap", "per": "per", "eps": "eps", "pbr": "pbr", "bps": "bps",
             "dividendYieldRatio": "dy", "foreignRate": "fr", "highPriceOf52Weeks": "hi52", "lowPriceOf52Weeks": "lo52",
             "cnsPer": "cper", "cnsEps": "ceps"}
ROWS = {"매출액": "s", "영업이익": "o", "당기순이익": "ni", "영업이익률": "om", "ROE": "roe", "부채비율": "dr",
        "EPS": "eps", "PER": "per", "BPS": "bps", "PBR": "pbr", "주당배당금": "dps"}


def num(text):
    """'1,234', '12.3배', '2.5%', '1조 2,345억' → 숫자(시가총액은 억원). 못 읽으면 None."""
    t = str(text or "").replace(",", "").strip()
    if not t or t in ("-", "N/A"):
        return None
    m = re.match(r"^(?:(-?\d+(?:\.\d+)?)조)?\s*(?:(-?\d+(?:\.\d+)?)억)?", t)
    if m and (m.group(1) or m.group(2)):
        return round(float(m.group(1) or 0) * 10000 + float(m.group(2) or 0))
    m = re.search(r"-?\d+(?:\.\d+)?", t)
    return float(m.group()) if m else None


def get(url, **params):
    r = requests.get(url, params=params, headers=HEADERS, timeout=(10, 20))
    time.sleep(0.3)
    r.raise_for_status()
    return r


# ---------- 대상 ----------

def load_targets(api_key: str | None) -> dict:
    """{종목코드: (DART 고유번호, 이름)}"""
    corps = bf.load_corp_list(api_key) if api_key else []
    stock_of = {c["corp_code"]: c["stock_code"] for c in corps if c["stock_code"]}
    out = {}
    text = FIN_PATH.read_text(encoding="utf-8") if FIN_PATH.exists() else ""
    m = re.search(r"window\.COMPANY_FINANCIALS\s*=\s*(\[.*?\]);", text, re.S)
    for rec in (json.loads(m.group(1)) if m else []):
        sc = stock_of.get(rec.get("c"))
        if rec.get("l") and sc:
            out[sc] = (rec["c"], rec.get("n"))
    if not out and corps:  # 저장된 재무 데이터가 없으면 명단에서 직접 찾는다(사업자번호 확인 없이 이름으로)
        found, _missing, _amb, _chk = bf.resolve(bf.universe_names(), corps, None)
        for code, (name, _key) in found.items():
            if stock_of.get(code):
                out[stock_of[code]] = (code, name)
    return out


# ---------- 네이버증권 ----------

def integration(code: str) -> dict:
    d = get(M_API.format(code, "integration")).json()
    info = {i.get("code"): i.get("value") for i in d.get("totalInfos") or []}
    out = {k: num(info.get(src)) for src, k in INFO_KEYS.items() if info.get(src) is not None}
    cns = d.get("consensusInfo") or {}
    if cns.get("priceTargetMean"):
        out["target"] = num(cns["priceTargetMean"])
    if cns.get("recommMean"):
        out["rec"] = num(cns["recommMean"])  # 투자의견 평균(5 매수 ~ 1 매도)
    ind = d.get("industryCode")
    if ind:
        out["ind"] = str(ind)
    return out


def annual_json(code: str) -> dict | None:
    fi = (get(M_API.format(code, "finance/annual")).json() or {}).get("financeInfo") or {}
    titles = fi.get("trTitleList") or []
    if not titles:
        return None
    keys = [t["key"] for t in titles]
    out = {"p": [re.sub(r"\D", "", t.get("title", ""))[:6] for t in titles], "est": [t.get("isConsensus") == "Y" for t in titles]}
    for row in fi.get("rowList") or []:
        k = ROWS.get(re.sub(r"\s|\(.*?\)", "", row.get("title", "")))
        if k:
            cols = row.get("columns") or {}
            out[k] = [num((cols.get(key) or {}).get("value")) for key in keys]
    return out if "s" in out or "o" in out else None


def annual_html(code: str) -> dict | None:
    """PC 화면 '기업실적분석' 표의 최근 연간(추정치 포함) 열."""
    import pandas as pd
    r = get(PC_MAIN, code=code)
    r.encoding = "euc-kr"
    tables = pd.read_html(io.StringIO(r.text), match="매출액")
    t = next((x for x in tables if "최근 연간 실적" in " ".join(map(str, x.columns))), None)
    if t is None:
        return None
    annual_cols = [c for c in t.columns if "최근 연간 실적" in str(c[0])]
    out = {"p": [re.sub(r"\D", "", str(c[1]))[:6] for c in annual_cols], "est": ["(E)" in str(c[1]) for c in annual_cols]}
    for _, row in t.iterrows():
        k = ROWS.get(re.sub(r"\s|\(.*?\)", "", str(row.iloc[0])))
        if k:
            out[k] = [num(row[c]) for c in annual_cols]
    return out if "s" in out else None


def collect(code: str) -> dict:
    rec = {}
    try:
        rec.update(integration(code))
    except (requests.RequestException, ValueError) as e:
        print(f"[market] {code} 시세·지표 실패: {e}")
    fin = None
    try:
        fin = annual_json(code)
    except (requests.RequestException, ValueError) as e:
        print(f"[market] {code} 연간(JSON) 실패: {e}")
    if fin is None:
        try:
            fin = annual_html(code)
        except Exception as e:  # pandas 표 해석 오류는 형식이 다양하다
            print(f"[market] {code} 연간(PC 표) 실패: {e}")
    if fin:
        rec["fa"] = fin
    return rec


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)
    targets = load_targets(os.environ.get("DART_API_KEY"))
    limit = int(os.environ.get("MARKET_LIMIT") or 0)  # 시험용: 앞의 몇 곳만
    items = list(targets.items())[:limit] if limit else list(targets.items())
    print(f"[market] 대상 상장사 {len(items)}곳")
    out, failed = {}, []
    for i, (stock, (corp, name)) in enumerate(items, 1):
        rec = collect(stock)
        if rec.get("price") is None and "fa" not in rec:
            failed.append(name)
            continue
        rec["sc"] = stock
        out[corp] = rec
        fa = rec.get("fa") or {}
        print(f"[{i}/{len(items)}] {stock} {name} 현재가 {rec.get('price')} 시총(억) {rec.get('cap')} PER {rec.get('per')}"
              f" PBR {rec.get('pbr')} 연간 {fa.get('p')} 추정 {sum(fa.get('est') or [])}개")
    if not out:
        print("[market] 받은 데이터가 없어 저장하지 않음")
        return 1
    payload = {"updated": datetime.now().strftime("%Y-%m-%d"), "src": "네이버증권", "list": out}
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUT_PATH.write_text("// scripts/build_market.py 가 생성한 파일입니다. 직접 수정하지 마세요.\n"
                        f"window.MARKET = {text};\n", encoding="utf-8")
    print(f"[market-json]{text}")
    print(f"[market] 저장 {len(out)}곳, 실패 {len(failed)}곳: {', '.join(failed)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
