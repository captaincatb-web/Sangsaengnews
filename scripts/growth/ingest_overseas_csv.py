"""조사 결과 CSV(공식 공시 원문 기준)를 검증해 원화 환산한 해외 재무 파일(overseas_financials_ext.csv)로 바꾼다. 결과는 비공개 폴더에만 쓴다.
입력 열: 목록표기, 공식법인명, 상장여부, 거래소, 티커, 결산월, 회계연도, 기간시작, 기간종료, 통화, 금액단위, 매출, 영업이익, 연결/개별, 출처URL, 쪽/표위치, 확신도(…), 비고
금액단위: 1(그대로)·천·백만·억·십억 또는 숫자 배율. 열이 없거나 비어 있으면 그 행은 거부한다(단위를 추정하지 않는다).
규칙(어기면 그 행은 버리고 사유를 집계): 출처 URL 필수(http로 시작), 회계기간 350~380일, 숫자는 원 통화 단위의 순수 숫자, 단위 표기(백만 등)가 있으면 거부(사람이 단위를 맞춘 뒤 다시 입력),
영업이익이 비면 영업이익만 빈 값(추정 금지), 환율은 해당 회계기간의 ECB 일별 교차환율(통화/KRW) 평균 — ECB가 발표하지 않는 통화(예: TWD)는 원화 환산을 비워 두고 사유를 남긴다.
사용: GROWTH_PRIVATE_DIR=<저장소 밖> python scripts/growth/ingest_overseas_csv.py <입력.csv>"""
import csv, datetime as dt, io, json, os, re, sys, zipfile
from collections import Counter
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import name_key

OUT_COLS = ["entity_id", "year", "fiscal_year", "period_start", "period_end", "currency", "revenue_local", "op_income_local", "fx_krw_per_unit", "fx_days", "revenue_krw", "op_income_krw", "scope", "source_url", "source_ref", "confidence", "official_name"]
NUM = re.compile(r"^-?\d+(\.\d+)?$")
UNIT = {"1": 1, "원": 1, "단위": 1, "천": 1e3, "千": 1e3, "백만": 1e6, "百万": 1e6, "만": 1e4, "억": 1e8, "십억": 1e9, "조": 1e12}


def parse_num(s):
    s = (s or "").strip().replace(",", "")
    if s == "": return None, None
    if NUM.match(s): return float(s), None
    return None, "숫자 형식 아님(단위 표기 포함)"


def unit_factor(v):
    v = (v or "").strip().replace(",", "").replace("배", "")
    if not v: return None
    if v in UNIT: return UNIT[v]
    try: return float(v)
    except ValueError: return None


def fx_daily(raw=None):
    """{통화: [(날짜, 1통화당 원)]}. ECB 유로 기준 환율 교차: KRW/통화 = (EUR→KRW) ÷ (EUR→통화)."""
    if raw is None:
        import requests
        r = requests.get("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip", timeout=60); r.raise_for_status()
        raw = io.TextIOWrapper(zipfile.ZipFile(io.BytesIO(r.content)).open("eurofxref-hist.csv"), encoding="utf-8")
    out = {}
    for x in csv.DictReader(raw):
        try: d = dt.date.fromisoformat(x["Date"]); krw = float(x["KRW"])
        except (ValueError, KeyError): continue
        out.setdefault("EUR", []).append((d, krw))
        for cur, v in x.items():
            if cur in ("Date", "KRW", "") or v in ("N/A", "", None): continue
            try: out.setdefault(cur, []).append((d, krw / float(v)))
            except (ValueError, ZeroDivisionError): continue
    return out


# ECB가 발표하지 않는 통화: 미국 연준 H.10 일별 환율(FRED 시리즈, 1달러당 해당 통화)과 ECB 기준 원/달러를 같은 날짜끼리 교차한다.
# KRW/통화 = (원/달러, ECB 교차) ÷ (통화/달러, 연준 H.10). 두 출처 모두 공식 기관 고시값이며 날짜가 겹치는 날만 쓴다.
FRED_SERIES = {"TWD": "DEXTAUS"}


def fx_add_fred(fx, raw_by_cur=None):
    """fx 에 FRED_SERIES 통화를 더한다(이미 있는 통화는 건드리지 않음). raw_by_cur 는 시험용 {통화: csv 텍스트}."""
    usd = dict(fx.get("USD", []))
    for cur, sid in FRED_SERIES.items():
        if cur in fx: continue
        if raw_by_cur is not None: text = raw_by_cur.get(cur, "")
        else:
            import requests, time
            text = ""
            for wait in (0,):  # 예비 출처: 한 번만 짧게 시도(GitHub 실행 환경에서 응답이 없을 때가 많음). 실패하면 이 통화만 환산을 비우고 나머지 반입은 계속한다
                time.sleep(wait)
                try:
                    r = requests.get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd=2021-01-01", timeout=30, headers={"User-Agent": "Mozilla/5.0 (growth-ingest)"})
                    if r.status_code in (403, 429): print(f"[FX] {cur} 환율 서버 {r.status_code}: 중단(환산 비움)"); break
                    r.raise_for_status(); text = r.text; break
                except requests.RequestException as e: print(f"[FX] {cur} 환율 받기 실패({type(e).__name__}) — 재시도")
            if not text: print(f"[FX] {cur} 환율을 받지 못해 원화 환산을 비웁니다"); continue
        ser = []
        for x in csv.DictReader(io.StringIO(text)):
            d_ = x.get("observation_date") or x.get("DATE"); v = x.get(sid)
            try: d = dt.date.fromisoformat(d_); per_usd = float(v)
            except (TypeError, ValueError): continue
            if d in usd and per_usd: ser.append((d, usd[d] / per_usd))
        if ser: fx[cur] = ser
    return fx


def fx_add_twd_finmind(fx, raw_json=None):
    """TWD: 臺灣銀行 고시 달러 현물 매입·매도율의 중간값(1달러당 대만달러, FinMind TaiwanExchangeRate)과 ECB 원/달러를 같은 날짜끼리 교차한다.
    키는 환경변수 FINMIND_API_TOKEN(헤더로만 전송, 없으면 키 없이 요청). raw_json 은 시험용 응답."""
    if "TWD" in fx: return fx
    if raw_json is None:
        import requests
        tok = os.environ.get("FINMIND_API_TOKEN", "").strip(); h = {"User-Agent": "growth-ingest"}
        if tok: h["Authorization"] = "Bearer " + tok
        try:
            r = requests.get("https://api.finmindtrade.com/api/v4/data?dataset=TaiwanExchangeRate&data_id=USD&start_date=2021-01-01", headers=h, timeout=60)
            if r.status_code in (402, 403, 429): print(f"[FX] TWD(FinMind) {r.status_code}: 중단"); return fx
            r.raise_for_status(); raw_json = r.json()
        except Exception as e: print(f"[FX] TWD(FinMind) 받기 실패({type(e).__name__})"); return fx
    usd = dict(fx.get("USD", [])); ser = []
    for x in (raw_json or {}).get("data", []):
        try: d = dt.date.fromisoformat(x["date"]); b, s_ = float(x["spot_buy"]), float(x["spot_sell"])
        except (KeyError, TypeError, ValueError): continue
        if b <= 0 or s_ <= 0 or d not in usd: continue
        ser.append((d, usd[d] / ((b + s_) / 2)))
    if ser: fx["TWD"] = ser
    return fx


def fx_avg(series, start, end):
    v = [x for d, x in series if start <= d <= end]
    return (sum(v) / len(v), len(v)) if v else (None, 0)


def convert(rows, fx):
    ok, rej = [], Counter()
    for r in rows:
        name = re.sub(r"\s*\((SEC|참고|note)[^)]*\)\s*$", "", (r.get("목록표기") or "").strip(), flags=re.I)  # 목록 이름 뒤에 붙은 '(SEC: …)' 같은 주석은 떼고 목록 이름으로 연결
        url = (r.get("출처URL") or "").strip()
        if not name: rej["목록표기 없음"] += 1; continue
        if not url.startswith("http"): rej["출처URL 없음"] += 1; continue
        try: s, e = dt.date.fromisoformat(r["기간시작"].strip()), dt.date.fromisoformat(r["기간종료"].strip())
        except (ValueError, KeyError, AttributeError): rej["회계기간 형식 오류"] += 1; continue
        if not 350 <= (e - s).days <= 380: rej["회계기간이 1년이 아님"] += 1; continue
        rev, err1 = parse_num(r.get("매출")); op, err2 = parse_num(r.get("영업이익"))
        if err1 or err2: rej[err1 or err2] += 1; continue
        fac = unit_factor(r.get("금액단위"))
        if fac is None: rej["금액단위 없음/해석 불가"] += 1; continue
        rev = None if rev is None else rev * fac; op = None if op is None else op * fac
        if rev is None and op is None: rej["매출·영업이익 모두 없음"] += 1; continue
        cur = (r.get("통화") or "").strip().upper()
        avg, nd = fx_avg(fx.get(cur, []), s, e) if cur else (None, 0)
        if cur == "KRW": avg, nd = 1.0, 0
        ok.append({"entity_id": "O:" + name_key(name), "year": e.year, "fiscal_year": (r.get("회계연도") or "").strip(), "period_start": s.isoformat(), "period_end": e.isoformat(), "currency": cur,
                   "revenue_local": "" if rev is None else rev, "op_income_local": "" if op is None else op, "fx_krw_per_unit": round(avg, 4) if avg else "", "fx_days": nd,
                   "revenue_krw": rev * avg if (rev is not None and avg) else "", "op_income_krw": op * avg if (op is not None and avg) else "",
                   "scope": (r.get("연결/개별") or "").strip(), "source_url": url, "source_ref": (r.get("쪽/표위치") or "").strip(), "confidence": next((v for k, v in r.items() if k and k.startswith("확신도")), "").strip(), "official_name": (r.get("공식법인명") or "").strip()})
        if avg is None: rej["환율 없음(원화 환산 비움)"] += 1
    # 한 법인 안에서 연결/개별이 섞이면(예: 2023 연결, 2024~2025 개별) 성장률이 왜곡되므로 그 법인은 전부 거부한다.
    scopes = {}
    for x in ok: scopes.setdefault(x["entity_id"], set()).add(x["scope"])
    mixed = {e for e, v in scopes.items() if len(v) > 1}
    if mixed:
        rej["연결/개별 혼재(법인 전체 거부)"] += sum(1 for x in ok if x["entity_id"] in mixed); ok = [x for x in ok if x["entity_id"] not in mixed]
    return ok, rej


def main():
    priv = os.environ.get("GROWTH_PRIVATE_DIR")
    if not priv or len(sys.argv) < 2: sys.exit("GROWTH_PRIVATE_DIR 와 입력 CSV 경로가 필요합니다")
    rows = list(csv.DictReader(open(sys.argv[1], encoding="utf-8-sig")))
    ok, rej = convert(rows, fx_add_fred(fx_add_twd_finmind(fx_daily())))
    with open(Path(priv) / "overseas_financials_ext.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=OUT_COLS); w.writeheader(); w.writerows(ok)
    print(json.dumps({"input_rows": len(rows), "accepted": len(ok), "entities": len({x["entity_id"] for x in ok}), "rejected_reasons": dict(rej)}, ensure_ascii=False))


if __name__ == "__main__": main()
