"""국내 기업군(소부장 경영 정보와 같은 명단)의 연결재무제표 기준 연간 매출·영업이익 수집. 결과는 비공개 폴더에만 쓴다.
- DART 사업보고서 연결(CFS) 재무제표를 보고연도 2025·2023 두 건으로 2022~2025를 채운다(당기·전기·전전기).
- 연결재무제표가 없는 회사(종속회사가 없거나 감사보고서만 내는 비상장사)는 개별 재무를 그대로 쓰고 basis 에 '연결 미작성→개별'로 표시한다(연결 = 개별로 본다).
- 값이 없으면 빈 값(0 아님). 로그에는 건수만 출력한다.
입력: <GROWTH_PRIVATE_DIR>/roster_financials.js (build_financials.py 결과). 출력: roster_cfs.csv(원 단위)."""
import csv, json, os, sys
from pathlib import Path
sys.path.insert(0, os.environ.get("BCP_DIR") or str(Path(__file__).resolve().parent.parent))
import build_company_profiles as bcp  # noqa: E402
OUT = Path(os.environ.get("GROWTH_PRIVATE_DIR", "")).resolve(); KEY = os.environ.get("DART_API_KEY", "")
if not KEY or not os.environ.get("GROWTH_PRIVATE_DIR"): sys.exit("DART_API_KEY 와 GROWTH_PRIVATE_DIR 가 필요합니다")
COLS = ["corp_code", "year", "revenue_krw", "op_income_krw", "basis"]
CACHE_P = OUT / "roster_cfs_cache.json"
CACHE = json.loads(CACHE_P.read_text(encoding="utf-8")) if CACHE_P.exists() else {}
def cfs_years(code, rep_year):
    k = f"{code}:{rep_year}"
    if k not in CACHE:
        data = bcp.call(KEY, "fnlttSinglAcntAll", corp_code=code, bsns_year=str(rep_year), reprt_code=bcp.ANNUAL, fs_div="CFS")
        rows = (data or {}).get("list", [])
        CACHE[k] = {str(y): v for y, v in bcp.annual_by_year(rows, rep_year).items()} if rows else {}
        CACHE_P.write_text(json.dumps(CACHE, ensure_ascii=False), encoding="utf-8")
    return CACHE[k]
def main():
    t = (OUT / "roster_financials.js").read_text(encoding="utf-8"); a = t.index("window.COMPANY_FINANCIALS = ") + len("window.COMPANY_FINANCIALS = ")
    recs = json.loads(t[a:t.index(";\nwindow.COMPANY_FINANCIALS_META")])
    rows, n_cfs, n_fallback = [], 0, 0
    for r in recs:
        got = {}
        for rep in (2025, 2023):
            for y, v in cfs_years(r["c"], rep).items(): got.setdefault(int(y), v)
        if got:
            n_cfs += 1
            for y in (2022, 2023, 2024, 2025):
                v = got.get(y, {}); rows.append({"corp_code": r["c"], "year": y, "revenue_krw": v.get("매출액", ""), "op_income_krw": v.get("영업이익", ""), "basis": "연결(CFS)"})
        else:
            n_fallback += 1
            for i, y in enumerate(r["y"]):
                s, o = r["s"][i], r["o"][i]
                rows.append({"corp_code": r["c"], "year": y, "revenue_krw": "" if s is None else s * 1e8, "op_income_krw": "" if o is None else o * 1e8, "basis": "연결 미작성→개별"})
    with open(OUT / "roster_cfs.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS); w.writeheader(); w.writerows(rows)
    full = sum(1 for r in recs if all(any(x["corp_code"] == r["c"] and x["year"] == y and x["revenue_krw"] != "" and x["op_income_krw"] != "" for x in rows) for y in (2023, 2024, 2025)))
    print(json.dumps({"companies": len(recs), "with_cfs": n_cfs, "fallback_separate": n_fallback, "with_3y_2023_2025": full}, ensure_ascii=False))
main()
