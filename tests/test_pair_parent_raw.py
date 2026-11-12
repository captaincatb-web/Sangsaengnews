"""본사 원문 실적 파일(pair-parent-consolidated.json): 값마다 검증 상태가 있고, 대조하지 않은 값이 '대조 완료'로 표시되지 않는지 확인한다."""
import json, unittest
from pathlib import Path
P = Path(__file__).resolve().parents[1] / "site" / "data" / "pair-parent-consolidated.json"
DIRECT = {  # 공시 원문(공식 PDF·SEC·EDINET)과 직접 대조한 값만 D 를 가질 수 있다: {회사: (매출 D 연도 색인, 영업이익 D 연도 색인)}
    "Montage Technology": ({0, 1, 2}, {0, 1, 2}), "TANAKA Holdings": ({0, 1, 2}, {0, 1, 2}), "Qnity Electronics": ({0, 1, 2}, set()),
    "JSR": ({0}, {0}), "Tekscend Photomask": ({2}, {2}), "HOYA": ({0, 1, 2}, set()),
}


class ParentRaw(unittest.TestCase):
    def test_verify_codes(self):
        if not P.exists(): self.skipTest("파일 없음")
        d = json.loads(P.read_text(encoding="utf-8"))
        for c in d["companies"]:
            v = c["verify"]
            self.assertNotIn("unit", c, c["name"])  # 단위는 모두 백만(원본 통화)
            for key in ("revenue", "operating_profit"):
                self.assertEqual(len(c[key]), 3); self.assertEqual(len(v[key]), 3)
                for i in range(3):
                    self.assertIn(v[key][i], "DSPU")
                    self.assertEqual(c[key][i] is None, v[key][i] == "U", c["name"])  # 값이 없으면 미확인, 0 으로 채우지 않는다
            rv, op = DIRECT.get(c["name"], (set(), set()))
            self.assertEqual({i for i in range(3) if v["revenue"][i] == "D"}, rv, c["name"])
            self.assertEqual({i for i in range(3) if v["operating_profit"][i] == "D"}, op, c["name"])
            if c["name"] not in DIRECT or DIRECT[c["name"]] != ({0, 1, 2}, {0, 1, 2}): self.assertNotEqual(c["status"], "원문 직접 대조 완료", c["name"])  # 전부 대조한 곳만 이 표시

    def test_units_converted(self):
        d = json.loads(P.read_text(encoding="utf-8")); by = {c["name"]: c for c in d["companies"]}
        self.assertEqual(by["Gigaphoton"]["revenue"], [51055, 44910, 49802]); self.assertEqual(by["Gigaphoton"]["scope"], "개별")
        self.assertEqual(by["Hitachi High-Tech"]["revenue"], [674200, 670400, 756500]); self.assertEqual(by["Hitachi High-Tech"]["operating_profit"], [None, None, None])


if __name__ == "__main__": unittest.main()
