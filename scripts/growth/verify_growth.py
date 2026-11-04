"""공개 요약 JSON(site/data/growth-comparison-summary.json)을 비공개 법인 자료에서 aggregate.py 와 무관하게 다시 계산해 대조한다(집계 재현 검증).
사용: GROWTH_PRIVATE_DIR=<저장소 밖> python scripts/growth/verify_growth.py   — 출력은 통과/실패와 건수뿐(법인 이름·금액 없음).
검사: ①법인 id 중복 없음 ②균형 패널(2023~2025 매출·영업이익 모두) 법인 수 ③그래프 분류별·전체 기업 수 ④매출·영업이익 합계·영업이익률(ΣOP/ΣRev)·성장률 재계산 ⑤원화 환산(원통화×회계기간 평균환율) 재계산
⑥구성 메타(공시 본사 + 한국 내 외국계 = 해외계 패널) ⑦전체 ⊇ 분류(비배타적 분류에서 분류 합 ≥ 전체)."""
import csv, json, os, sys
from collections import defaultdict
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_growth_comparison as B  # noqa: E402
REPO = Path(__file__).resolve().parent.parent.parent
YEARS = (2023, 2024, 2025)


def main():
    priv = os.environ.get("GROWTH_PRIVATE_DIR")
    if not priv: sys.exit("GROWTH_PRIVATE_DIR 가 필요합니다")
    univ = B.rd(next(iter(sorted((REPO / "scripts" / "data").glob("semi_universe_final_*.csv")))))
    ents = B.build_entities(Path(priv), univ); S = json.loads((REPO / "site" / "data" / "growth-comparison-summary.json").read_text(encoding="utf-8"))
    res = []; ok = lambda name, cond, extra="": res.append((name, bool(cond), extra))
    ids = [(e["region"], e["id"]) for e in ents]; ok("법인 id 중복 없음", len(ids) == len(set(ids)))
    usable = lambda e: e["eligible"] == "ELIGIBLE" and all(e["fin"].get(y, {}).get("rev") is not None and e["fin"].get(y, {}).get("op") is not None for y in YEARS)
    reg = {"dom": "국내", "ov": "해외"}
    for g, r in reg.items():
        n = sum(1 for e in ents if e["region"] == r and usable(e)); ok(f"균형 패널 {r} = JSON 메타", n == S["coverage"]["balanced_panel"][r], f"{n}")
    # 전체·분류별 재계산(법인은 분류마다 한 번) — 비교 모드마다 그 모드의 법인 목록으로 다시 계산해 대조한다. 교차 역산 방지로 가려진 셀은 JSON에 없으므로 JSON에 있는 셀만 대조.
    mode_ents = dict(B.modes_entities(ents, priv))
    for m in S.get("modes", [{"id": "blend", "cells": S["cells"]}]):
        me = mode_ents.get(m["id"], ents); bad = checked = 0
        for key, cell in m["cells"].items():
            chart, path = json.loads(key)
            for g, r in reg.items():
                if g not in cell: continue
                es = [e for e in me if e["region"] == r and usable(e) and any((chart is None or mm["chart"] == chart) and all(mm.get(f"d{i+1}") == p_ or (p_ == "(해당 없음)" and not mm.get(f"d{i+1}")) for i, p_ in enumerate(path)) for mm in e["memberships"])]
                rev = [sum(e["fin"][y]["rev"] for e in es) / 1e8 for y in YEARS]; op = [sum(e["fin"][y]["op"] for e in es) / 1e8 for y in YEARS]
                c = cell[g]; checked += 1
                if len(es) != c["n"] or any(abs(a - b) > 0.11 for a, b in zip(rev, c["rev"])) or any(abs(a - b) > 0.11 for a, b in zip(op, c["op"])): bad += 1; continue
                mg = [o / r_ * 100 if r_ else None for o, r_ in zip(op, rev)]
                if any(mm_ is None or abs(mm_ - x) > 0.02 for mm_, x in zip(mg, c["margin"])): bad += 1; continue
                if abs((rev[2] / rev[1] - 1) * 100 - c["growth"]["2025"]) > 0.02: bad += 1
        ok(f"공개 셀 재계산 일치 — 모드 {m['id']}(기업 수·합계·영업이익률·성장률)", bad == 0, f"{checked}개 중 불일치 {bad}")
    # 원화 환산 재계산
    fxbad = fxn = 0
    for fname in ("overseas_financials.csv", "overseas_financials_ext.csv"):
        for f in B.rd(Path(priv) / fname):
            loc = f.get("revenue_local") or (f.get("revenue_usd") or ""); rate = f.get("fx_krw_per_unit") or f.get("fx_krw_per_usd") or ""
            if loc and rate and f.get("revenue_krw"):
                fxn += 1
                if abs(float(loc) * float(rate) - float(f["revenue_krw"])) > max(1e4, abs(float(f["revenue_krw"])) * 2e-4): fxbad += 1
    ok("원화 환산(원통화×평균환율) 재계산", fxbad == 0, f"{fxn}행 중 불일치 {fxbad}")
    comp = S["coverage"].get("composition", {})
    ok("구성 메타: 공시 본사 + 한국 내 외국계 = 해외계 패널", comp.get("listed_or_direct", 0) + comp.get("kr_incorporated_affiliates", 0) == S["coverage"]["balanced_panel"]["해외"], json.dumps(comp, ensure_ascii=False))
    tot = S["cells"].get('[null,[]]', {})
    for g in reg:
        if g in tot:
            sums = [sum(S["cells"].get(json.dumps([c, []], ensure_ascii=False, separators=(",", ":")), {}).get(g, {"n": 0})["n"] for c in ("소재", "부품", "장비"))]
            ok(f"분류별 기업 수 합 ≥ 전체({reg[g]})", sums[0] >= tot[g]["n"], f"{sums[0]} ≥ {tot[g]['n']}")
    for name, cond, extra in res: print(("PASS " if cond else "FAIL ") + name + (f" — {extra}" if extra else ""))
    sys.exit(0 if all(c for _, c, _ in res) else 1)


if __name__ == "__main__": main()
