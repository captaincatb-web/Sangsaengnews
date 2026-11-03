"""해외 법인 중 SEC 등록 법인 본인의 연결 매출·영업이익(10-K, XBRL) 수집과 원화 환산. 결과는 비공개 폴더에만 쓴다.
- 연결: 정규화한 이름이 SEC 등록명과 정확히 같을 때만 확정(자회사·지점은 연결하지 않음, 모회사 실적으로 대체하지 않음).
- 연도: 회계기간(350~380일)의 중간 날짜가 속한 해. 환율: ECB 일별 USD·KRW 교차환율의 해당 연도 평균(출처·일수 기록).
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
def fx_table():
    r = requests.get("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip", timeout=60); r.raise_for_status()
    rows = list(csv.DictReader(io.TextIOWrapper(zipfile.ZipFile(io.BytesIO(r.content)).open("eurofxref-hist.csv"), encoding="utf-8")))
    acc = {}
    for x in rows:
        try: v = float(x["KRW"]) / float(x["USD"])
        except (ValueError, KeyError, ZeroDivisionError): continue
        acc.setdefault(int(x["Date"][:4]), []).append(v)
    return {y: (sum(v) / len(v), len(v)) for y, v in acc.items()}
def annual(facts, tags):
    """{연도: 값} — 연간(10-K) 기간 값. 같은 기간은 가장 늦게 제출된 값."""
    best = {}
    for tag in tags:
        for e in (facts.get("us-gaap", {}).get(tag, {}).get("units", {}).get("USD", [])):
            if not str(e.get("form", "")).startswith("10-K") or not e.get("start"): continue
            s, t = dt.date.fromisoformat(e["start"]), dt.date.fromisoformat(e["end"])
            if not 350 <= (t - s).days <= 380: continue
            y = (s + (t - s) / 2).year
            k = (tag, y)
            if k not in best or e["filed"] > best[k][0]: best[k] = (e["filed"], e["val"])
    out = {}
    for tag in tags:
        for (tg, y), (_, v) in best.items():
            if tg == tag: out.setdefault(y, v)
    return out
def main():
    names = list(csv.DictReader(open(OUT / "ov_names.csv", encoding="utf-8-sig")))
    tick = get("https://www.sec.gov/files/company_tickers.json").json()
    reg = {}
    for v in tick.values(): reg.setdefault(name_key(v["title"]), []).append(v)
    fx = fx_table(); match, fin = [], []
    for n in names:
        c = reg.get(n["entity_key"]) or []; ciks = {x["cik_str"] for x in c}
        if len(ciks) != 1: match.append({"entity_key": n["entity_key"], "cik": "", "sec_title": "", "basis": "NOT_FOUND" if not c else "REVIEW(동일 이름 복수)"}); continue
        cik = next(iter(ciks)); match.append({"entity_key": n["entity_key"], "cik": cik, "sec_title": c[0]["title"], "basis": "이름 정확 일치(SEC 등록명)"})
        r = get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{int(cik):010d}.json")
        if r.status_code != 200: continue
        facts = r.json().get("facts", {}); rev = annual(facts, REV); op = annual(facts, ["OperatingIncomeLoss"])
        for y in YEARS:
            f = fx.get(y)
            row = {"entity_id": "O:" + n["entity_key"], "year": y, "revenue_usd": rev.get(y, ""), "op_income_usd": op.get(y, ""), "fx_krw_per_usd": round(f[0], 2) if f else "", "fx_days": f[1] if f else "", "fx_source": "ECB 일별 교차환율 연평균", "basis": "SEC 10-K 연결(등록 법인 본인)"}
            row["revenue_krw"] = rev[y] * f[0] if y in rev and f else ""; row["op_income_krw"] = op[y] * f[0] if y in op and f else ""
            fin.append(row)
    for name, data in (("sec_match.csv", match), ("overseas_financials.csv", fin)):
        if data:
            with open(OUT / name, "w", encoding="utf-8-sig", newline="") as fh:
                w = csv.DictWriter(fh, fieldnames=list(data[0])); w.writeheader(); w.writerows(data)
    ok = {f["entity_id"] for f in fin}
    full = sum(1 for e in ok if all(any(f["entity_id"] == e and f["year"] == y and f["revenue_krw"] != "" and f["op_income_krw"] != "" for f in fin) for y in (2023, 2024, 2025)))
    print(json.dumps({"names": len(names), "matched": sum(1 for m in match if m["cik"]), "review": sum(1 for m in match if m["basis"].startswith("REVIEW")), "not_found": sum(1 for m in match if m["basis"] == "NOT_FOUND"), "with_filings": len(ok), "all_3y_2023_2025": full}, ensure_ascii=False))
main()
