"""해외 법인 중 SEC 등록 법인 본인의 연결 매출·영업이익(10-K, XBRL) 수집과 원화 환산. 결과는 비공개 폴더에만 쓴다.
- 연결: 정규화한 이름이 SEC 등록명과 정확히 같을 때만 확정(자회사·지점은 연결하지 않음, 모회사 실적으로 대체하지 않음).
- 연도: 회계연도 = 회계기간(350~380일) 종료일의 연도(기업 자체 표기). 매출·영업이익은 같은 회계기간일 때만 함께 사용. 환율: 해당 회계기간의 ECB 일별 USD·KRW 교차환율 평균(출처·일수 기록).
- 값이 없으면 빈 값(0 아님). 로그에는 건수만 출력한다."""
import csv, io, json, os, sys, time, zipfile
import datetime as dt
from pathlib import Path
import requests
import re
_SUFFIX = re.compile(r"\b(co|corp|corporation|inc|incorporated|ltd|limited|llc|gmbh|ag|sa|nv|bv|plc|pte|sdn|bhd|kk|k\.k|company|holdings?|group)\b\.?", re.I)
def name_key(s):  # common.name_key 와 같은 규칙(같은 열쇠여도 같은 법인으로 단정하지 않고, 이름 정확 일치만 연결 근거로 쓴다)
    if not s: return ""
    t = _SUFFIX.sub(" ", s.lower()); t = re.sub(r"\(주\)|주식회사|유한회사|㈜", " ", t)
    return re.sub(r"[^0-9a-z가-힣]+", "", t)
OUT = Path(os.environ.get("GROWTH_PRIVATE_DIR", "")).resolve(); UA = os.environ.get("SEC_USER_AGENT", "").strip()
if not UA or not os.environ.get("GROWTH_PRIVATE_DIR"): sys.exit("SEC_USER_AGENT 와 GROWTH_PRIVATE_DIR 가 필요합니다")
H = {"User-Agent": UA, "Accept-Encoding": "gzip, deflate"}
REV = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet"]
YEARS = (2022, 2023, 2024, 2025)
def get(url):
    time.sleep(0.2); r = requests.get(url, headers=H, timeout=60)
    if r.status_code in (403, 429): sys.exit(f"[ABORT] SEC {r.status_code}: 접근 제한 — 요청을 중단합니다")
    return r
def fx_daily():
    r = requests.get("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip", timeout=60); r.raise_for_status()
    rows = list(csv.DictReader(io.TextIOWrapper(zipfile.ZipFile(io.BytesIO(r.content)).open("eurofxref-hist.csv"), encoding="utf-8")))
    out = []
    for x in rows:
        try: out.append((dt.date.fromisoformat(x["Date"]), float(x["KRW"]) / float(x["USD"])))
        except (ValueError, KeyError, ZeroDivisionError): continue
    return out
def fx_avg(daily, start, end):
    """회계기간(start~end)에 포함된 ECB 일별 USD→KRW 교차환율의 평균과 일수. 기간 전체가 지나지 않았거나 일수가 없으면 (None, 0)."""
    v = [x for d, x in daily if start <= d <= end]
    return (sum(v) / len(v), len(v)) if v else (None, 0)
def annual(facts, tags):
    """{회계연도: (값, 시작일, 종료일)} — 연간(10-K) 기간 값. 회계연도 = 회계기간 종료일의 연도(기업 자체 표기: 6월 결산 FY2025 = 2025-06 종료).
    같은 기간은 가장 늦게 제출된 값. 태그는 앞쪽 우선(한 연도에서 한 태그의 값만 쓴다)."""
    best = {}
    for tag in tags:
        for e in (facts.get("us-gaap", {}).get(tag, {}).get("units", {}).get("USD", [])):
            if not str(e.get("form", "")).startswith("10-K") or not e.get("start"): continue
            s, t = dt.date.fromisoformat(e["start"]), dt.date.fromisoformat(e["end"])
            if not 350 <= (t - s).days <= 380: continue
            k = (tag, t.year)
            if k not in best or e["filed"] > best[k][0]: best[k] = (e["filed"], e["val"], s, t)
    out = {}
    for tag in tags:
        for (tg, y), (_, v, s, t) in best.items():
            if tg == tag: out.setdefault(y, (v, s, t))
    return out
def main():
    names = list(csv.DictReader(open(OUT / "ov_names.csv", encoding="utf-8-sig")))
    tick = get("https://www.sec.gov/files/company_tickers.json").json()
    reg = {}
    for v in tick.values(): reg.setdefault(name_key(v["title"]), []).append(v)
    daily = fx_daily(); match, fin = [], []
    for n in names:
        c = reg.get(n["entity_key"]) or []; ciks = {x["cik_str"] for x in c}
        if len(ciks) != 1: match.append({"entity_key": n["entity_key"], "cik": "", "sec_title": "", "basis": "NOT_FOUND" if not c else "REVIEW(동일 이름 복수)"}); continue
        cik = next(iter(ciks)); match.append({"entity_key": n["entity_key"], "cik": cik, "sec_title": c[0]["title"], "basis": "이름 정확 일치(SEC 등록명)"})
        r = get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{int(cik):010d}.json")
        if r.status_code != 200: continue
        facts = r.json().get("facts", {}); rev = annual(facts, REV); op = annual(facts, ["OperatingIncomeLoss"])
        for y in YEARS:
            rv, ov = rev.get(y), op.get(y)
            same = bool(rv and ov and rv[1] == ov[1] and rv[2] == ov[2])  # 매출과 영업이익의 회계기간이 같을 때만 함께 쓴다
            st, en = (rv[1], rv[2]) if rv else (None, None)
            f, nd = fx_avg(daily, st, en) if st else (None, 0)
            row = {"entity_id": "O:" + n["entity_key"], "fiscal_year": y, "period_start": st or "", "period_end": en or "", "revenue_usd": rv[0] if rv else "", "op_income_usd": ov[0] if (ov and same) else "",
                   "fx_krw_per_usd": round(f, 2) if f else "", "fx_days": nd, "fx_source": "ECB 일별 교차환율의 회계기간 평균", "basis": "SEC 10-K 연결(등록 법인 본인)"}
            row["year"] = y; row["revenue_krw"] = rv[0] * f if rv and f else ""; row["op_income_krw"] = ov[0] * f if (ov and same and f) else ""
            fin.append(row)
    for name, data in (("sec_match.csv", match), ("overseas_financials.csv", fin)):
        if data:
            with open(OUT / name, "w", encoding="utf-8-sig", newline="") as fh:
                w = csv.DictWriter(fh, fieldnames=list(data[0])); w.writeheader(); w.writerows(data)
    ok = {f["entity_id"] for f in fin}
    full = sum(1 for e in ok if all(any(f["entity_id"] == e and f["year"] == y and f["revenue_krw"] != "" and f["op_income_krw"] != "" for f in fin) for y in (2023, 2024, 2025)))
    print(json.dumps({"names": len(names), "matched": sum(1 for m in match if m["cik"]), "review": sum(1 for m in match if m["basis"].startswith("REVIEW")), "not_found": sum(1 for m in match if m["basis"] == "NOT_FOUND"), "with_filings": len(ok), "all_3y_2023_2025": full}, ensure_ascii=False))
main()
