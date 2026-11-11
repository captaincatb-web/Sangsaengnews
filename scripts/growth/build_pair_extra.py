"""업체 비교 페이지의 '자료 없음' 업체 중 DART(사업·감사보고서) 개별 실적이 확인된 곳을 공개 JSON(site/data/pair-extra.json)으로 만든다.
사용: GROWTH_PRIVATE_DIR=<비공개 data/pair> python scripts/growth/build_pair_extra.py
- 입력(비공개): pair_audit_rows.csv. 출력은 표시명·재무 기준·출처·2023~2025 매출·영업이익(억 원)만 담는다(법인 식별번호·DART 고유번호 없음).
- 2023·2024·2025년 매출과 영업이익이 모두 있는 업체만 싣는다(3개년 미확인 업체는 제외, 추정 안 함). 업체는 명단(site/data/pair-roster.json)에 있어야 한다."""
import csv, json, os, sys
from pathlib import Path
REPO = Path(__file__).resolve().parent.parent.parent
YEARS = (2023, 2024, 2025); EOK = 1e8


def main():
    priv = os.environ.get("GROWTH_PRIVATE_DIR")
    if not priv: sys.exit("GROWTH_PRIVATE_DIR 가 필요합니다")
    roster = json.loads((REPO / "site" / "data" / "pair-roster.json").read_text(encoding="utf-8"))
    names = {e["n"] for gr in roster["groups"] for it in gr["items"] for side in ("dom", "glo") for e in it[side] if e.get("k") != "sub"}
    by = {}
    for r in csv.DictReader(open(Path(priv) / "pair_audit_rows.csv", encoding="utf-8-sig")):
        if r["상태"] == "OK" and r["year"]: by.setdefault(r["표시명"], {})[int(r["year"])] = r
    rows, skipped = [], 0
    for n in sorted(by):
        if n not in names: skipped += 1; continue
        d = by[n]
        if not all(y in d and d[y]["revenue_krw"] != "" and d[y]["op_income_krw"] != "" for y in YEARS): skipped += 1; continue
        src = {d[y]["source"] for y in YEARS}
        rows.append({"n": n, "s": "별도", "src": "·".join(sorted(src)) if len(src) > 1 else next(iter(src)),
                     "r": [round(float(d[y]["revenue_krw"]) / EOK, 1) for y in YEARS], "o": [round(float(d[y]["op_income_krw"]) / EOK, 1) for y in YEARS]})
    out = {"version": 1, "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "unit": "억 원",
           "note": "DART 사업보고서·감사보고서의 개별(별도) 재무제표. 성장 분석 집계에는 포함되지 않은 업체의 공시 수치.", "rows": rows}
    (REPO / "site" / "data" / "pair-extra.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"companies_in_file": len(rows), "skipped_incomplete_or_not_in_roster": skipped}, ensure_ascii=False))


if __name__ == "__main__": main()
