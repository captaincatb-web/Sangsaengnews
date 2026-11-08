"""해외 상장사(미국 10-K, 외국 상장사 20-F·40-F) 3개년 연간 매출·영업이익을 SEC XBRL(companyfacts)에서 티커로 찾아 수집한다. 결과는 비공개 폴더에만 쓴다.
- 대상: <GROWTH_PRIVATE_DIR>/sec_targets.csv (목록표기, 공식법인명, 티커, 대표업종). 법인 연결은 SEC 티커 목록의 티커가 정확히 같을 때만(이름 유사로 잇지 않음).
- 연도 = 회계기간(350~380일) 종료일의 연도. 매출·영업이익은 같은 회계기간·통화일 때만 함께 쓴다. 영업이익 항목(OperatingIncomeLoss 등)이 공시에 없으면 비워 둔다(다른 항목으로 계산·추정하지 않음).
- 출력 sec_rows.csv 는 조사 CSV 와 같은 20열(금액단위 1, 연결)이라 ingest_overseas_csv.py 로 반입한다(원화 환산은 반입기가 ECB 회계기간 평균 환율로 한다). 403·429 는 즉시 중단. 로그에는 건수만."""
import csv, datetime as dt, json, os, sys, time
from pathlib import Path
import requests
OUT = Path(os.environ.get("GROWTH_PRIVATE_DIR", "")).resolve(); UA = os.environ.get("SEC_USER_AGENT", "").strip()
COLS = ["목록표기", "공식법인명", "상장여부", "거래소", "티커", "결산월", "회계연도", "기간시작", "기간종료", "통화", "금액단위", "매출", "영업이익", "연결/개별", "출처URL", "쪽/표위치", "확신도(높음/중간/낮음)", "비고", "대표업종(소재/부품/장비)", "대표업종근거(반도체 관련 매출 비중과 출처)"]
REV = [("us-gaap", t) for t in ("Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet")] + [("ifrs-full", "Revenue"), ("ifrs-full", "RevenueFromContractsWithCustomers")]
OPI = [("us-gaap", "OperatingIncomeLoss"), ("ifrs-full", "ProfitLossFromOperatingActivities")]
FORMS = ("10-K", "20-F", "40-F"); YEARS = (2022, 2023, 2024, 2025)


def get(url):
    time.sleep(0.25); r = requests.get(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip, deflate"}, timeout=60)
    if r.status_code in (403, 429): sys.exit(f"[ABORT] SEC {r.status_code}: 접근 제한 — 요청을 중단합니다")
    return r


def annual(facts, tags):
    """{회계연도: (값, 시작일, 종료일, 통화, 접수번호, 태그)} — 연간 보고서의 연간 기간 값. 같은 기간은 가장 늦게 제출된 값, 태그는 앞쪽 우선."""
    best = {}
    for tax, tag in tags:
        for cur, entries in (facts.get(tax, {}).get(tag, {}).get("units", {}) or {}).items():
            for e in entries:
                if not str(e.get("form", "")).startswith(FORMS) or not e.get("start"): continue
                s, t = dt.date.fromisoformat(e["start"]), dt.date.fromisoformat(e["end"])
                if not 350 <= (t - s).days <= 380: continue
                k = ((tax, tag), t.year)
                if k not in best or e["filed"] > best[k][0]: best[k] = (e["filed"], e["val"], s, t, cur, e.get("accn", ""))
    out = {}
    for tg in tags:
        for (tg2, y), (_, v, s, t, cur, accn) in best.items():
            if tg2 == tg: out.setdefault(y, (v, s, t, cur, accn, tg[1]))
    return out


def main():
    if not UA or not os.environ.get("GROWTH_PRIVATE_DIR"): sys.exit("SEC_USER_AGENT 와 GROWTH_PRIVATE_DIR 가 필요합니다")
    tg = list(csv.DictReader(open(OUT / "sec_targets.csv", encoding="utf-8-sig")))
    tick = get("https://www.sec.gov/files/company_tickers.json").json(); by_t = {v["ticker"].upper(): v for v in tick.values()}
    rows, res = [], {"targets": len(tg), "matched": 0, "complete_3y": 0, "no_operating_income_tag": 0}
    for t in tg:
        v = by_t.get(t["티커"].strip().upper())
        if not v: print("[미발견 티커]", t["티커"]); continue
        res["matched"] += 1; cik = int(v["cik_str"])
        r = get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json")
        if r.status_code != 200: continue
        facts = r.json().get("facts", {}); rev, op = annual(facts, REV), annual(facts, OPI)
        if not op: res["no_operating_income_tag"] += 1
        got = 0
        for y in YEARS:
            rv, ov = rev.get(y), op.get(y)
            if not rv: continue
            same = bool(ov and ov[1:4] == rv[1:4])
            got += (y >= 2023) and same
            accn = rv[4].replace("-", "")
            rows.append({"목록표기": t["목록표기"], "공식법인명": t["공식법인명"], "상장여부": "상장 본사", "거래소": t.get("거래소", "") or "US", "티커": t["티커"], "결산월": str(rv[2].month).zfill(2), "회계연도": y,
                         "기간시작": rv[1].isoformat(), "기간종료": rv[2].isoformat(), "통화": rv[3], "금액단위": "1", "매출": int(rv[0]), "영업이익": int(ov[0]) if same else "", "연결/개별": "연결",
                         "출처URL": f"https://www.sec.gov/Archives/edgar/data/{cik}/{accn}/" if accn else f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}",
                         "쪽/표위치": f"SEC XBRL companyfacts: 매출 {rv[5]} / 영업이익 {ov[5] if same else '항목 없음'}", "확신도(높음/중간/낮음)": "높음" if same else "중간",
                         "비고": "SEC 연차보고서(10-K·20-F) 자동 수집" + ("" if same else " · 영업이익 항목이 공시되지 않아 비움(계산·추정 안 함)"), "대표업종(소재/부품/장비)": t.get("대표업종", ""), "대표업종근거(반도체 관련 매출 비중과 출처)": ""})
        res["complete_3y"] += got == 3
    with open(OUT / "sec_rows.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS); w.writeheader(); w.writerows(rows)
    print(json.dumps({**res, "rows": len(rows)}, ensure_ascii=False))


if __name__ == "__main__": main()
