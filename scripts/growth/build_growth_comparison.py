"""비공개 작업 폴더의 법인·재무 자료로 공개용 집계 요약(site/data/growth-comparison-summary.json)을 만든다.
공개 파일에는 집계값·건수·필터 조합만 담는다: 기업명·등록번호·개별 재무·품목 매핑·원본 행은 넣지 않는다.
사용: GROWTH_PRIVATE_DIR=<저장소 밖> python scripts/growth/build_growth_comparison.py [--k 5]
입력(비공개 폴더): master_rows.csv, domestic_match.csv, domestic_financials.csv, [overseas_financials.csv], [eligibility_overrides.csv]
적격성: 국내는 사용자 목록 전체를 대상으로 하고, 검증된 모집단(scripts/data/semi_universe_final_*.csv)에서 별도 관리(제외·OSAT·유통)로 확정된 법인만 EXCLUDED.
확정되지 않은 기업(REVIEW)은 기본 집계에서 빠진다. 해외는 개별 법인 실적이 확인된 자료(overseas_financials.csv)가 있어야 들어온다."""
import csv, datetime as dt, json, os, sys
from collections import Counter, defaultdict
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import aggregate as A
REPO = Path(__file__).resolve().parent.parent.parent
YEARS = A.YEARS
EOK = 1e8


def rd(p):
    return list(csv.DictReader(open(p, encoding="utf-8-sig"))) if Path(p).exists() else []


def num(x):
    try: return float(x) if x not in (None, "") else None
    except ValueError: return None


def build_entities(priv, csv_universe):
    rows = rd(priv / "master_rows.csv"); match = {m["corp_no"]: m for m in rd(priv / "domestic_match.csv")}
    fin = defaultdict(dict)
    for f in rd(priv / "domestic_financials.csv"):
        fin[f["corp_no"]][int(f["year"])] = {"rev": num(f["revenue_krw"]), "op": num(f["op_income_krw"])}
    for f in rd(priv / "overseas_financials.csv"):  # 개별 법인 실적이 공식 자료로 확인된 해외 법인(원화 환산 완료)만
        fin[f["entity_id"]][int(f["year"])] = {"rev": num(f["revenue_krw"]), "op": num(f["op_income_krw"])}
    univ = {r["stock_code"]: r for r in csv_universe}; over = {r["entity_id"]: r["eligible"] for r in rd(priv / "eligibility_overrides.csv")}
    groups = defaultdict(list)
    for r in rows:
        key = ("D:" + (r["corp_no"] or "NOID-" + r["row_id"])) if r["region"] == "국내" else ("O:" + (r["name_key"] or "NOKEY-" + r["row_id"]))
        groups[key].append(r)
    ents = []
    for key, rs in groups.items():
        region = rs[0]["region"]; eid = key
        if region == "국내":
            m = match.get(key[2:], {}); u = univ.get(m.get("stock_code", ""))
            st = "ELIGIBLE"  # 사용자 목록의 국내 법인은 모두 대상. 검증된 160 모집단에서 '별도 관리(제외·OSAT·유통)'로 확정된 법인만 뺀다.
            if u and u["implementation_group"].startswith("SEPARATE"): st = "EXCLUDED"
            f = {y: v for y, v in fin.get(key[2:], {}).items() if v.get("rev") is not None or v.get("op") is not None}
        else:
            st, f = "REVIEW", fin.get(key, {})
        st = over.get(eid, st)
        ents.append({"id": eid, "region": region, "eligible": st, "fin": f, "memberships": [{"chart": r["chart_category"], **{k: (r[k] or None) for k in A.DEPTH_KEYS}} for r in rs]})
    return ents


def fmt(side):
    if not side.get("n"): return {"n": 0}
    r = lambda v, d: None if v is None else round(v, d)
    return {"n": side["n"], "rev": [r(side["rev"][y] / EOK, 1) for y in YEARS], "op": [r(side["op"][y] / EOK, 1) for y in YEARS], "margin": [r(side["margin"][y], 2) for y in YEARS],
            "growth": {str(y): r(side["growth"].get(y), 2) for y in (2023, 2024, 2025)}, "avg_rev": [r(side["avg_rev"][y] / EOK, 1) for y in YEARS]}


def build(ents, k=5, generated=None):
    by = {e["id"]: e for e in ents}; ok = A.publishable(ents, k); out = {}
    for (chart, path), sides in ok.items():
        sub = [by[i] for reg in sides for i in sides[reg]]
        res = A.compare(sub); cell = {}
        for reg, name in (("국내", "dom"), ("해외", "ov")):
            if reg in sides: cell[name] = fmt(res["dom" if reg == "국내" else "ov"])
        if "dom" in cell and "ov" in cell: cell["gap_pp"] = [None if res["margin_gap_pp"][y] is None else round(res["margin_gap_pp"][y], 2) for y in YEARS]
        out[json.dumps([chart, list(path)], ensure_ascii=False, separators=(",", ":"))] = cell
    c = Counter((e["region"], e["eligible"]) for e in ents)
    usable = lambda reg: sum(1 for e in ents if e["region"] == reg and A.usable(e))
    cov = {"entities": {r: sum(1 for e in ents if e["region"] == r) for r in ("국내", "해외")},
           "eligibility": {r: {s: c.get((r, s), 0) for s in ("ELIGIBLE", "REVIEW", "EXCLUDED")} for r in ("국내", "해외")},
           "with_3y_financials": {r: sum(1 for e in ents if e["region"] == r and all(e["fin"].get(y, {}).get("rev") is not None and e["fin"].get(y, {}).get("op") is not None for y in YEARS)) for r in ("국내", "해외")},
           "balanced_panel": {r: usable(r) for r in ("국내", "해외")}}
    return {"version": 1, "generatedAt": generated or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "years": list(YEARS), "unit": "억 원", "k_min_per_side": k,
            "basis": {"revenue": "기업 전체 매출액(반도체 사업 매출이 아님)", "scope": "해당 법인의 개별(별도) 재무, 모회사 연결 실적으로 대체하지 않음", "panel": "2023·2024·2025년 매출·영업이익이 모두 확인된 적격 법인(동일 기업군)",
                      "margin": "영업이익 합계 ÷ 매출 합계", "growth": "전년 대비, 2023년은 2022년 매출이 전원 확인될 때만", "fx": "해외 환산: 회계연도 평균 환율(출처 별도 표기)", "nonexclusive": "한 기업이 여러 분류에 속할 수 있어 분류별 합계가 전체와 다를 수 있음"},
            "coverage": cov, "cells": out}


def main():
    priv = os.environ.get("GROWTH_PRIVATE_DIR"); k = int(sys.argv[sys.argv.index("--k") + 1]) if "--k" in sys.argv else 5
    if not priv: sys.exit("GROWTH_PRIVATE_DIR 가 필요합니다")
    univ = rd(next(iter(sorted((REPO / "scripts" / "data").glob("semi_universe_final_*.csv")))))
    ents = build_entities(Path(priv), univ); summary = build(ents, k)
    p = REPO / "site" / "data" / "growth-comparison-summary.json"; p.write_text(json.dumps(summary, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"entities": summary["coverage"]["entities"], "eligibility": summary["coverage"]["eligibility"], "with_3y": summary["coverage"]["with_3y_financials"], "balanced_panel": summary["coverage"]["balanced_panel"], "published_cells": len(summary["cells"])}, ensure_ascii=False))
if __name__ == "__main__": main()
