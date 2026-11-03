"""성장 비교 공개 파일 안전 검사: 집계 JSON과 화면 파일에 기업명·번호·비밀키·소수 기업 값이 새지 않는지 확인한다."""
import json, re, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
SUMMARY = ROOT / "site" / "data" / "growth-comparison-summary.json"
TOP = {"version", "generatedAt", "years", "unit", "k_min_per_side", "basis", "coverage", "cells", "groups", "notes_list", "mix"}
TOP_OPTIONAL = {"cells_cons", "coverage_cons"}
CHARTS = {None, "소재", "부품", "장비", "미분류"}
GROUPS = ("dom", "ov", "fo")


def load():
    return json.loads(SUMMARY.read_text(encoding="utf-8"))


class SummarySafety(unittest.TestCase):
    def setUp(self): self.raw = SUMMARY.read_text(encoding="utf-8"); self.j = json.loads(self.raw)

    def test_top_level_keys(self): self.assertLessEqual(set(self.j), TOP | TOP_OPTIONAL); self.assertTrue(TOP <= set(self.j))

    def test_each_group_meets_k(self):
        k = self.j["k_min_per_side"]
        for key, cell in self.j["cells"].items():
            for g in GROUPS:
                if g in cell: self.assertGreaterEqual(cell[g]["n"], k, f"{key} {g} 법인 수가 k({k}) 미만으로 공개됨")

    def test_no_identifiers_or_company_tokens(self):
        body = self.raw.replace(self.j["generatedAt"], "")
        self.assertIsNone(re.search(r"\d{10,}", body), "10자리 이상 숫자(번호·금액 원값 의심)")
        for tok in ("@", "http", "주식회사", "(주)", "㈜", "유한회사"): self.assertNotIn(tok, body, tok)

    def test_cell_keys_are_chart_and_path(self):
        for key in self.j["cells"]:
            chart, path = json.loads(key)
            self.assertIn(chart, CHARTS, key); self.assertIsInstance(path, list)
            self.assertTrue(all(isinstance(p, str) for p in path))

    def test_subset_difference_rule(self):
        k = self.j["k_min_per_side"]; cells = {tuple([json.loads(key)[0], tuple(json.loads(key)[1])]): v for key, v in self.j["cells"].items()}
        def contains(x, y):  # x ⊃ y (진부분집합 관계): 그래프분류 None ⊃ 개별 분류, 상세구분 경로는 접두
            (cx, px), (cy, py) = x, y
            if x == y: return False
            chart_ok = cx is None or cx == cy
            return chart_ok and py[:len(px)] == px and (cx != cy or len(py) > len(px) or cx is None)
        for x, cx in cells.items():
            for y, cy in cells.items():
                if not contains(x, y): continue
                for g in GROUPS:
                    if g in cx and g in cy:
                        diff = cx[g]["n"] - cy[g]["n"]  # Y ⊆ X 이므로 diff == 0 이면 같은 집합(새 정보 없음), 0 < diff < k 이면 소수 법인이 드러나는 진부분집합
                        self.assertTrue(diff == 0 or diff >= k, f"부분집합 차이 규칙 위반: {x} − {y} ({g}) 차이 {diff}곳이 0도 아니고 k({k}) 미만")


class FrontEndFiles(unittest.TestCase):
    def test_no_13_digit_numbers_or_secret_names(self):
        for name in ("growth-comparison.html", "growth-comparison.js", "growth-comparison.css"):
            t = (ROOT / "site" / name).read_text(encoding="utf-8")
            self.assertIsNone(re.search(r"\d{13}", t), f"{name}: 13자리 숫자")
            for s in ("DART_API_KEY", "SEC_USER_AGENT"): self.assertNotIn(s, t, f"{name}: {s}")


if __name__ == "__main__": unittest.main()
