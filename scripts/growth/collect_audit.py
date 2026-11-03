"""한국에 설립된 외국계 법인 중 DART 법인등록번호가 일치한 법인의 최근 3개년 연간 매출·영업이익 수집.
사업보고서(개별 재무제표) → 없으면 감사보고서 원문(외부감사 대상 비상장사) 순서(scripts/build_financials.py 의 annual_series 와 같은 방식).
입력: <GROWTH_PRIVATE_DIR>/domestic_match.csv(collect_domestic.py 결과). 출력: ovkr_audit_financials.csv (금액은 원 단위, 값이 없으면 빈 값). 로그에는 건수만 출력한다."""
import csv, json, os, sys, time
from pathlib import Path
from datetime import datetime
sys.path.insert(0, os.environ.get("BCP_DIR") or str(Path(__file__).resolve().parent.parent))
import build_financials as bf  # noqa: E402
import build_company_profiles as bcp  # noqa: E402
OUT = Path(os.environ.get("GROWTH_PRIVATE_DIR", "")).resolve(); KEY = os.environ.get("DART_API_KEY", "")
if not KEY or not os.environ.get("GROWTH_PRIVATE_DIR"): sys.exit("DART_API_KEY 와 GROWTH_PRIVATE_DIR 가 필요합니다")
COLS = ["corp_no", "corp_code", "year", "revenue_krw", "op_income_krw", "source"]
def save(rows):
    with open(OUT / "ovkr_audit_financials.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS); w.writeheader(); w.writerows(rows)
def main():
    match = [m for m in csv.DictReader(open(OUT / "domestic_match.csv", encoding="utf-8-sig")) if m["dart_corp_code"]]
    rows, done, got = [], 0, 0
    this_year = datetime.now().year
    for m in match:
        try: years, vals, source = bf.annual_series(KEY, m["dart_corp_code"], this_year)
        except bcp.DartUnreachable as e: print(f"[ABORT] DART 접속 불가: {e}"); break
        except Exception as e: years, vals, source = [], {}, ""; print(f"[skip] 오류 {type(e).__name__}")
        for i, y in enumerate(years):
            s, o = vals.get("매출액", [None] * 3)[i], vals.get("영업이익", [None] * 3)[i]
            rows.append({"corp_no": m["corp_no"], "corp_code": m["dart_corp_code"], "year": y, "revenue_krw": "" if s is None else s * 1e8, "op_income_krw": "" if o is None else o * 1e8, "source": source})
        done += 1; got += 1 if years else 0
        if done % 10 == 0: save(rows)
    save(rows)
    full = {m["corp_no"] for m in match if all(any(r["corp_no"] == m["corp_no"] and r["year"] == y and r["revenue_krw"] != "" and r["op_income_krw"] != "" for r in rows) for y in (2023, 2024, 2025))}
    print(json.dumps({"matched": len(match), "processed": done, "with_any_year": got, "with_3y_2023_2025": len(full), "sources": {s: sum(1 for r in rows if r["source"] == s and r["year"] == max(x["year"] for x in rows if x["corp_no"] == r["corp_no"])) for s in {r["source"] for r in rows}}}, ensure_ascii=False))
main()
