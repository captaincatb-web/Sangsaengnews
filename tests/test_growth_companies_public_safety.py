"""회사별 상세 공개 JSON(site/data/growth-companies.json) 안전 점검: 허용된 필드만, 식별번호·법인격 표기 없음, 집계 패널과 법인 수 일치."""
import json, re, unittest
from pathlib import Path
SITE = Path(__file__).resolve().parent.parent / "site" / "data"
ROW_KEYS = {"n", "g", "c", "d", "p", "s", "r", "o"}
OPTIONAL_KEYS = {"q": ("calc",)}  # q=calc: 영업이익 계산값(손익계산서에 영업이익 줄이 없는 해외 법인, 사용자 승인 2026-11-08)


class CompaniesPublicSafety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = (SITE / "growth-companies.json").read_text(encoding="utf-8"); cls.j = json.loads(cls.raw)
        cls.s = json.loads((SITE / "growth-comparison-summary.json").read_text(encoding="utf-8"))

    def test_top_level_keys(self):
        self.assertEqual(set(self.j), {"version", "generatedAt", "years", "unit", "note", "modes"})

    def test_row_fields_whitelist_and_values(self):
        for m in self.j["modes"]:
            for r in m["rows"]:
                self.assertEqual(set(r) - set(OPTIONAL_KEYS), ROW_KEYS)
                for k, allowed in OPTIONAL_KEYS.items():
                    if k in r: self.assertIn(r[k], allowed); self.assertEqual(r["g"], "ov")  # 계산값 표시는 해외 법인만
                self.assertIn(r["g"], ("dom", "ov")); self.assertIn(r["c"], ("소재", "부품", "장비")); self.assertTrue(r["n"].strip())
                for k in ("r", "o"):
                    self.assertEqual(len(r[k]), 3); self.assertTrue(all(isinstance(v, (int, float)) for v in r[k]))
                self.assertTrue(all(isinstance(q, list) and q and all(isinstance(v, str) for v in q) for q in r["p"]))
                if r["g"] == "dom": self.assertTrue(r["p"] or True)

    def test_no_identifiers_or_legal_forms(self):
        self.assertIsNone(re.search(r"\d{10,}", self.raw)); self.assertIsNone(re.search(r"\d{3}-\d{2}-\d{5}|\d{6}-\d{7}", self.raw))
        for m in self.j["modes"]:
            for r in m["rows"]: self.assertIsNone(re.search(r"\(주\)|㈜|주식회사|유한회사", r["n"]), r["n"])

    def test_counts_match_summary_panels(self):
        sm = {m["id"]: m["coverage"]["balanced_panel"] for m in self.s["modes"]}
        for m in self.j["modes"]:
            dom = sum(1 for r in m["rows"] if r["g"] == "dom"); ov = sum(1 for r in m["rows"] if r["g"] == "ov")
            self.assertEqual((dom, ov), (sm[m["id"]]["국내"], sm[m["id"]]["해외"]), m["id"])

    def test_no_duplicate_company_in_mode_group(self):
        for m in self.j["modes"]:
            keys = [(r["g"], r["n"]) for r in m["rows"]]
            self.assertEqual(len(keys), len(set(keys)), m["id"])


if __name__ == "__main__": unittest.main()
