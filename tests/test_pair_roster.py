"""업체 비교 명단(site/data/pair-roster.json) 점검: 공개 회사별 수치와 이름이 정확히 같고 국내/해외가 맞는 곳만 연결, 해외 법인·지점은 모회사 실적으로 대체하지 않음, 식별번호 없음."""
import json, re, unittest
from pathlib import Path
SITE = Path(__file__).resolve().parent.parent / "site" / "data"
KINDS = {"hq", "kr", "sub"}


class PairRoster(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = (SITE / "pair-roster.json").read_text(encoding="utf-8"); cls.R = json.loads(cls.raw)
        g = json.loads((SITE / "growth-companies.json").read_text(encoding="utf-8"))
        cls.rows = {r["n"]: r for r in next(m for m in g["modes"] if m["id"] == "blend")["rows"]}
        cls.entries = [(gr["g"], it["i"], side, e) for gr in cls.R["groups"] for it in gr["items"] for side in ("dom", "glo") for e in it[side]]

    def test_basis_has_four_criteria(self):
        self.assertEqual(len(self.R["basis"]), 4); self.assertIn("구매액 상위 5개업체", self.R["basis"][3])

    def test_structure_and_five_or_fewer_per_side(self):
        self.assertEqual({gr["g"] for gr in self.R["groups"]}, {"설비", "부품", "원재료"})
        self.assertEqual([it["i"] for gr in self.R["groups"] for it in gr["items"]], ["설비", "부품", "PCB/소자", "벌크가스", "웨이퍼", "케미컬", "특수가스"])
        for gr in self.R["groups"]:
            for it in gr["items"]:
                for side in ("dom", "glo"): self.assertLessEqual(len(it[side]), 5, (it["i"], side))

    def test_matches_exist_by_exact_name(self):
        for g, i, side, e in self.entries:
            if "m" in e: self.assertIn(e["m"], self.rows, e["n"])
        self.assertEqual(len({e["m"] for *_, e in self.entries if "m" in e}), sum(1 for *_, e in self.entries if "m" in e), "같은 공개 행을 두 업체에 연결하지 않음")

    def test_foreign_subsidiaries_and_branches_never_matched(self):
        for g, i, side, e in self.entries:
            if e.get("k") == "sub": self.assertNotIn("m", e, e["n"]); self.assertTrue(e.get("w"))
        for g, i, side, e in self.entries:  # 모회사 대체 방지: Kunshan 법인은 대만 본사 행(UNIMICRON TECHNOLOGY)과 연결하지 않음
            if "Kunshan" in e["f"]: self.assertNotIn("m", e)

    def test_kinds_only_on_global_side(self):
        for g, i, side, e in self.entries:
            if side == "glo": self.assertIn(e["k"], KINDS, e["n"])
            else: self.assertNotIn("k", e)

    def test_sum_exclusion_has_reason(self):
        ex = [e for *_, e in self.entries if "x" in e]
        self.assertEqual([e["n"] for e in ex], ["삼성에스디아이"]); self.assertTrue(all(len(e["x"]) > 10 for e in ex))

    def test_no_identifiers(self):
        self.assertIsNone(re.search(r"\d{10,}", self.raw)); self.assertIsNone(re.search(r"\d{3}-\d{2}-\d{5}|\d{6}-\d{7}", self.raw))


class PairExtra(unittest.TestCase):
    """감사·사업보고서로 따로 수집한 공개 파일(site/data/pair-extra.json): 허용 필드만, 명단 업체만, 3개년 완전, 식별번호 없음."""
    def test_extra_file(self):
        p = SITE / "pair-extra.json"
        if not p.exists(): self.skipTest("아직 수집 전")
        raw = p.read_text(encoding="utf-8"); j = json.loads(raw); R = json.loads((SITE / "pair-roster.json").read_text(encoding="utf-8"))
        names = {e["n"] for gr in R["groups"] for it in gr["items"] for side in ("dom", "glo") for e in it[side] if e.get("k") != "sub"}
        self.assertEqual(set(j), {"version", "generatedAt", "unit", "note", "rows"})
        for r in j["rows"]:
            self.assertEqual(set(r), {"n", "s", "src", "r", "o"}); self.assertIn(r["n"], names); self.assertEqual((len(r["r"]), len(r["o"])), (3, 3))
            self.assertTrue(all(isinstance(v, (int, float)) for v in r["r"] + r["o"]))
        self.assertEqual(len({r["n"] for r in j["rows"]}), len(j["rows"]))
        self.assertIsNone(re.search(r"\d{10,}", raw)); self.assertIsNone(re.search(r"\d{3}-\d{2}-\d{5}|\d{6}-\d{7}", raw))


if __name__ == "__main__": unittest.main()
