"""성장 비교 집계 계산 시험(가짜 숫자): 동일 기업군·이익률 합계 기준·성장률·중복 방지·공개 안전 판정."""
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts" / "growth"))
import aggregate as A  # noqa: E402

def ent(i, region, rev, op, chart="장비", d=("설비", "전공정"), eligible="ELIGIBLE", y22=None):
    fin = {y: {"rev": r, "op": o} for y, r, o in zip((2023, 2024, 2025), rev, op)}
    if y22 is not None: fin[2022] = {"rev": y22, "op": 0}
    return {"id": i, "region": region, "eligible": eligible, "memberships": [dict(chart=chart, **dict(zip(A.DEPTH_KEYS, d)))], "fin": fin}

class Calc(unittest.TestCase):
    def test_margin_is_sum_ratio_not_mean_of_ratios(self):
        s = A.side([ent("a", "국내", (100, 100, 100), (50, 50, 50)), ent("b", "국내", (900, 900, 900), (0, 0, 0))])
        self.assertAlmostEqual(s["margin"][2023], 5.0)  # 50/1000, 기업별 이익률 평균(25%)이 아님
    def test_growth_and_negative_operating_income(self):
        s = A.side([ent("a", "국내", (100, 120, 90), (-10, 6, 9))])
        self.assertAlmostEqual(s["growth"][2024], 20.0); self.assertAlmostEqual(s["growth"][2025], -25.0); self.assertAlmostEqual(s["margin"][2023], -10.0)
        self.assertIsNone(s["growth"][2023])  # 2022년 매출이 없으면 표시하지 않음
    def test_growth_2023_only_when_everyone_has_2022(self):
        both = A.side([ent("a", "국내", (110, 0, 0), (0, 0, 0), y22=100), ent("b", "국내", (220, 0, 0), (0, 0, 0), y22=200)]); self.assertAlmostEqual(both["growth"][2023], 10.0)
        part = A.side([ent("a", "국내", (110, 0, 0), (0, 0, 0), y22=100), ent("b", "국내", (220, 0, 0), (0, 0, 0))]); self.assertIsNone(part["growth"][2023])
    def test_balanced_panel_excludes_missing_year_and_ineligible(self):
        a = ent("a", "국내", (100, 100, 100), (1, 1, 1)); b = ent("b", "국내", (100, 100, 100), (1, 1, 1)); del b["fin"][2024]
        c = ent("c", "국내", (100, 100, 100), (1, 1, 1), eligible="REVIEW"); d = ent("d", "국내", (100, 100, 100), (1, 1, 1), eligible="EXCLUDED")
        self.assertEqual(A.side([a, b, c, d])["n"], 1)
    def test_zero_revenue_margin_is_na_and_avg_uses_included_count(self):
        z = A.side([ent("a", "국내", (0, 0, 0), (0, 0, 0))]); self.assertIsNone(z["margin"][2023])
        s = A.side([ent("a", "국내", (100, 100, 100), (1, 1, 1)), ent("b", "국내", (300, 300, 300), (1, 1, 1))]); self.assertEqual(s["avg_rev"][2023], 200)
    def test_gap_pp_dom_minus_overseas(self):
        c = A.compare([ent("a", "국내", (100, 100, 100), (12, 12, 12)), ent("b", "해외", (100, 100, 100), (15, 15, 15))])
        self.assertAlmostEqual(c["margin_gap_pp"][2023], -3.0)
        self.assertEqual(A.compare([ent("a", "국내", (100, 100, 100), (12, 12, 12))])["margin_gap_pp"][2023], None)  # 한쪽이 없으면 격차 없음
    def test_entity_counted_once_per_filter_even_with_many_product_rows(self):
        e = ent("a", "국내", (100, 100, 100), (1, 1, 1)); e["memberships"].append(dict(chart="장비", d1="설비", d2="전공정", d3="FAB설비", d4="Main", d5="CVD")); e["memberships"].append(dict(chart="장비", d1="설비", d2="전공정", d3="FAB설비", d4="Main", d5="PVD"))
        c = A.cells([e]); self.assertEqual(c[("장비", ("설비", "전공정"))], {"a"}); self.assertEqual(len(c[("장비", ("설비",))]), 1)
    def test_blank_middle_level_keeps_deeper_levels(self):
        keys = A.cell_keys({"chart": "소재", "d1": "원자재", "d2": "전공정", "d3": "PR", "d4": None, "d5": "Thinner"})
        self.assertIn(("소재", ("원자재", "전공정", "PR", A.BLANK_LABEL, "Thinner")), keys)  # 상세구분4가 비어도 상세구분5 보존
    def test_trailing_blank_not_extended(self):
        keys = A.cell_keys({"chart": "소재", "d1": "원자재", "d2": "전공정", "d3": "PR", "d4": None, "d5": None})
        self.assertIn(("소재", ("원자재", "전공정", "PR")), keys); self.assertFalse(any(len(k[1]) > 3 for k in keys))

class Safety(unittest.TestCase):
    def pool(self, n_dom, n_ov, d3="X"):
        return [ent(f"d{i}", "국내", (100, 110, 120), (10, 11, 12), d=("설비", "전공정", d3)) for i in range(n_dom)] + [ent(f"o{i}", "해외", (100, 110, 120), (10, 11, 12), d=("설비", "전공정", d3)) for i in range(n_ov)]
    def test_min_count_per_side(self):
        ok = A.publishable(self.pool(6, 3), k=5); self.assertIn("국내", ok[("장비", ("설비",))]); self.assertNotIn("해외", ok[("장비", ("설비",))])
    def test_hidden_when_too_few_everywhere(self): self.assertEqual(A.publishable(self.pool(4, 4), k=5), {})
    def test_difference_attack_blocked(self):
        # 부모(설비) 8곳 = 자식 A(7곳)+단독 1곳. 자식 A를 공개하면 부모−A 로 단독 기업 값이 드러나므로 A를 숨긴다
        es = [ent(f"a{i}", "국내", (100, 100, 100), (1, 1, 1), d=("설비", "전공정", "A")) for i in range(7)] + [ent("solo", "국내", (900, 900, 900), (90, 90, 90), d=("설비", "전공정", "B"))]
        ok = A.publishable(es, k=5); self.assertIn("국내", ok[("장비", ("설비",))]); self.assertNotIn(("장비", ("설비", "전공정", "A")), ok)
    def test_safe_when_remainder_large_enough(self):
        es = [ent(f"a{i}", "국내", (100, 100, 100), (1, 1, 1), d=("설비", "전공정", "A")) for i in range(6)] + [ent(f"b{i}", "국내", (100, 100, 100), (1, 1, 1), d=("설비", "전공정", "B")) for i in range(6)]
        ok = A.publishable(es, k=5); self.assertIn(("장비", ("설비", "전공정", "A")), ok); self.assertIn(("장비", ("설비", "전공정", "B")), ok)
if __name__ == "__main__": unittest.main(verbosity=2)


class DedupeKr(unittest.TestCase):
    """한국 자회사 이중 집계 방지 규칙(연결 본사·균형 패널·관계 확인)."""
    @staticmethod
    def _e(i, region, fin=True, nk=None):
        e = {"id": i, "region": region, "eligible": "ELIGIBLE", "fin": {y: {"rev": 100.0, "op": 10.0} for y in (2023, 2024, 2025)} if fin else {}, "memberships": []}
        if nk is not None: e["_nk"] = nk
        return e
    def run_case(self, scope, parent_fin=True, dov=None):
        import build_growth_comparison as B
        ents = [self._e("O:lamresearch", "해외", parent_fin), self._e("F:1", "외국계", True, "lamresearchkorea")]
        keep, log, dropped = B.dedupe_kr_affiliates(ents, {"O:lamresearch": {scope}}, dov or {}); return keep, log, dropped
    def test_consolidated_parent_in_panel_drops_sub(self):
        keep, log, dropped = self.run_case("연결"); self.assertEqual(dropped, 1); self.assertEqual([e["id"] for e in keep], ["O:lamresearch"])
    def test_separate_parent_keeps_sub(self):
        keep, log, dropped = self.run_case("개별"); self.assertEqual(dropped, 0); self.assertEqual({e["id"] for e in keep}, {"O:lamresearch", "F:1"}); self.assertIn("연결 기준이 아님", log[0]["reason"])
    def test_parent_not_in_balanced_panel_keeps_sub(self):
        keep, log, dropped = self.run_case("연결", parent_fin=False); self.assertEqual(dropped, 0); self.assertIn("균형 패널에 없음", log[0]["reason"])
    def test_review_marks_unrelated_keeps_sub(self):
        keep, log, dropped = self.run_case("연결", dov={("lamresearchkorea", "lamresearch"): "unrelated"}); self.assertEqual(dropped, 0)
    def test_sub_region_becomes_overseas_when_kept(self):
        keep, log, dropped = self.run_case("개별"); self.assertEqual([e["region"] for e in keep if e["id"] == "F:1"], ["해외"])
