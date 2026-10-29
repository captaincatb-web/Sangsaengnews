"""해외·대형 비교 기업 재무 수집 → site/data/peers.js

- 한국(삼성전자·SK하이닉스): DART 연결재무제표(CFS). 미국: SEC EDGAR(peers_sec.py).
- 금액은 모두 원화(억원)로 환산해 저장하고, 원래 통화 값도 loc 에 남긴다. 환율은 ECB 일별 환율(frankfurter)의 기간 평균.
- 결과는 `[peers-json]` 한 줄로도 출력한다(Actions 로그에서 회수).
"""
import json
import os
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import requests

import build_company_profiles as bcp
import build_financials as bf
import peers_sec as sec

ROOT_DIR = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT_DIR / "site" / "data" / "peers.js"
FX_HOSTS = ["https://api.frankfurter.dev/v1", "https://api.frankfurter.app"]

# key, 이름, 국가, 구분, 출처 코드(DART corp_code 또는 SEC 티커), 핵심(★) 여부
PEERS = [
    ("samsung", "삼성전자", "KR", "반도체 제조", ("dart", "00126380")),
    ("skhynix", "SK하이닉스", "KR", "반도체 제조", ("dart", "00164779")),
    ("amat", "Applied Materials", "US", "장비", ("sec", "AMAT")),
    ("lrcx", "Lam Research", "US", "장비", ("sec", "LRCX")),
    ("klac", "KLA", "US", "장비", ("sec", "KLAC")),
    ("ter", "Teradyne", "US", "장비", ("sec", "TER")),
    ("mksi", "MKS Instruments", "US", "부품", ("sec", "MKSI")),
    ("entg", "Entegris", "US", "소재", ("sec", "ENTG")),
    ("glw", "Corning", "US", "소재", ("sec", "GLW")),
    ("mu", "Micron", "US", "반도체 제조", ("sec", "MU")),
    ("nvda", "NVIDIA", "US", "반도체 제조", ("sec", "NVDA")),
    ("intc", "Intel", "US", "반도체 제조", ("sec", "INTC")),
    ("amd", "AMD", "US", "반도체 제조", ("sec", "AMD")),
    ("txn", "Texas Instruments", "US", "반도체 제조", ("sec", "TXN")),
    ("qcom", "Qualcomm", "US", "반도체 제조", ("sec", "QCOM")),
    ("avgo", "Broadcom", "US", "반도체 제조", ("sec", "AVGO")),
]
CURRENCY = {"KR": "KRW", "US": "USD"}


# SEC 티커 목록(www.sec.gov)은 클라우드 접속을 막는 경우가 있어 CIK 를 직접 둔다. 없을 때만 목록을 읽는다.
CIK = {"AMAT": 6951, "LRCX": 707549, "KLAC": 319201, "TER": 97210, "MKSI": 1049502, "ENTG": 1101302,
       "GLW": 24741, "MU": 723125, "NVDA": 1045810, "INTC": 50863, "AMD": 2488, "TXN": 97476,
       "QCOM": 804328, "AVGO": 1730168}


# ---------- 환율 ----------

_fx_cache: dict = {}


def fx_average(cur: str, start: date, end: date) -> float | None:
    """기간 평균 환율(1 cur = ? KRW). 못 구하면 None."""
    if cur == "KRW":
        return 1.0
    key = (cur, start, end)
    if key in _fx_cache:
        return _fx_cache[key]
    val = None
    for host in FX_HOSTS:
        try:
            r = requests.get(f"{host}/{start}..{end}", params={"base": cur, "symbols": "KRW"}, timeout=(10, 30))
            r.raise_for_status()
            rates = [v["KRW"] for v in (r.json().get("rates") or {}).values() if "KRW" in v]
            if rates:
                val = sum(rates) / len(rates)
                break
        except (requests.RequestException, ValueError) as e:
            print(f"[fx] {host} {start}~{end} 실패: {e}")
    _fx_cache[key] = val
    return val


def _last_rate(cur: str, day: date) -> float | None:
    """기준일 환율(재무상태표용). 휴일이면 직전 영업일 값."""
    start = day - timedelta(days=7)
    for host in FX_HOSTS:
        try:
            r = requests.get(f"{host}/{start}..{day}", params={"base": cur, "symbols": "KRW"}, timeout=(10, 30))
            r.raise_for_status()
            rates = (r.json().get("rates") or {})
            if rates:
                return rates[max(rates)]["KRW"]
        except (requests.RequestException, ValueError, KeyError) as e:
            print(f"[fx] {host} {day} 실패: {e}")
    return None


def to_eok(v, rate):
    return bcp.eok(v * rate) if v is not None and rate else None


# ---------- 미국(SEC) ----------

def build_us(key, name, ctry, kind, ticker, cik_map):
    cik = CIK.get(ticker) or (cik_map or {}).get(ticker)
    if cik is None:
        print(f"[peers] {ticker} CIK 없음")
        return None
    got = sec.extract(sec.load_facts(cik))
    if not got:
        print(f"[peers] {ticker} 매출 연간 값 없음")
        return None
    cur = "USD"
    rates = [fx_average(cur, s, e) for s, e in zip(got["starts"], got["ends"])]
    close = [_last_rate(cur, e) for e in got["ends"]]
    rec = {"k": key, "n": name, "ctry": ctry, "kind": kind, "src": "SEC EDGAR", "cur": cur, "mt": got["mt"],
           "y": got["years"],
           "s": [to_eok(v, r) for v, r in zip(got["s"], rates)],
           "o": [to_eok(v, r) for v, r in zip(got["o"], rates)],
           "ni": [to_eok(v, r) for v, r in zip(got["ni"], rates)],
           "ta": [to_eok(v, r) for v, r in zip(got["ta"], close)],
           "tl": [to_eok(v, r) for v, r in zip(got["tl"], close)],
           "te": [to_eok(v, r) for v, r in zip(got["te"], close)],
           "rd": [to_eok(v, r) for v, r in zip(got["rd"], rates)],
           "fx": [round(r, 1) if r else None for r in rates],
           "loc": {"s": [round(v / 1e6) if v is not None else None for v in got["s"]],
                   "o": [round(v / 1e6) if v is not None else None for v in got["o"]], "unit": "백만 달러"}}
    q = got.get("q")
    if q:
        qr = [fx_average(cur, s, e) for s, e in zip(q["starts"], q["ends"])]
        rec["q"] = {"labels": q["labels"],
                    "sales": [to_eok(v, r) for v, r in zip(q["sales"], qr)],
                    "op": [to_eok(v, r) for v, r in zip(q["op"], qr)],
                    "net": [to_eok(v, r) for v, r in zip(q["net"], qr)]}
    return rec


# ---------- 한국(DART 연결) ----------

def cfs_rows(api_key, corp_code, year, reprt):
    data = bcp.call(api_key, "fnlttSinglAcntAll", corp_code=corp_code, bsns_year=str(year), reprt_code=reprt, fs_div="CFS")
    return (data or {}).get("list", [])


def build_kr(key, name, ctry, kind, corp_code, api_key):
    this_year = datetime.now().year
    fy = {}
    for year in (this_year - 1, this_year - 2):
        rows = cfs_rows(api_key, corp_code, year, bcp.ANNUAL)
        if rows:
            fy.update(bcp.annual_by_year(rows, year))
            for y, vals in bcp.annual_by_year(cfs_rows(api_key, corp_code, year - 1, bcp.ANNUAL), year - 1).items():
                fy.setdefault(y, vals)
            break
    years = sorted(y for y, v in fy.items() if v.get("매출액") is not None)[-3:]
    if not years:
        return None
    col = lambda k: [bcp.eok(fy[y].get(k)) for y in years]  # noqa: E731
    rec = {"k": key, "n": name, "ctry": ctry, "kind": kind, "src": "DART 연결", "cur": "KRW", "mt": 12, "y": years,
           "s": col("매출액"), "o": col("영업이익"), "ni": col("당기순이익"),
           "ta": col("총자산"), "tl": col("부채총계"), "te": col("자본총계")}
    emp = []
    for y in years:
        try:
            emp.append(bcp.fetch_employees(api_key, corp_code, y).get("count"))
        except bcp.DartUnreachable:
            raise
        except Exception as e:
            print(f"[employees] {name} {y}: {e}")
            emp.append(None)
    if any(v is not None for v in emp):
        rec["e"] = emp
    cum = {}
    for year in (this_year - 2, this_year - 1, this_year):
        for code, q in bf.QUARTER_CODES:
            if year == this_year and q == 4:
                continue
            rows = cfs_rows(api_key, corp_code, year, code)
            if rows:
                cum[(year, q)] = bcp.quarter_values(rows)
    rec["q"] = bf.quarters_from_cumulative(cum, 8)
    return rec


# ---------- 실행 ----------

def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)
    api_key = os.environ.get("DART_API_KEY")
    out, failed = [], []
    cik_map = None
    only = {x for x in os.environ.get("PEERS_ONLY", "").split(",") if x}  # 시험용: 국가(KR·US)나 key 만
    for key, name, ctry, kind, (src, code) in PEERS:
        if only and ctry not in only and key not in only:
            continue
        try:
            if src == "dart":
                if not api_key:
                    print("[peers] DART_API_KEY 없음 - 한국 기업 건너뜀")
                    failed.append(name)
                    continue
                rec = build_kr(key, name, ctry, kind, code, api_key)
            else:
                if code not in CIK:
                    cik_map = cik_map or sec.load_cik_map()
                rec = build_us(key, name, ctry, kind, code, cik_map)
        except bcp.DartUnreachable as e:
            print(f"[peers] DART 접속 불가: {e}")
            failed.append(name)
            continue
        except (requests.RequestException, ValueError) as e:
            body = getattr(getattr(e, "response", None), "text", "") or ""
            print(f"[peers] {name} 실패: {e} {body[:200]!r}")
            failed.append(name)
            continue
        if rec:
            out.append(rec)
            print(f"[peers] {name}: {rec['y']} 매출(억원) {rec['s']}")
        else:
            failed.append(name)
    if not out:
        print("[peers] 수집된 기업이 없어 저장하지 않음")
        return 1
    payload = {"updated": datetime.now().strftime("%Y-%m-%d"), "list": out}
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(f"window.PEERS = {text};\n", encoding="utf-8")
    print(f"[peers-json]{text}")
    print(f"[peers] 저장 {len(out)}곳, 실패 {failed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
