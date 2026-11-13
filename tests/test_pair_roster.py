"""업체 비교 명단(site/data/pair-roster.json) 점검: 공개 회사별 수치와 이름이 정확히 같고 국내/해외가 맞는 곳만 연결, 해외 법인·지점은 모회사 실적으로 대체하지 않음, 식별번호 없음."""
import json, re, unittest
from pathlib import Path
SITE = Path(__file__).resolve().parent.parent / "site" / "data"
KINDS = {"hq", "par"}  # hq: 해외 본사 자체, par: 한국 법인·지점·현지 법인(수치는 본사 실적 p 를 씀)


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
                for side in ("dom", "glo"):  # 공정(ph: 전공정·후공정)이 나뉜 품목은 공정별로 5곳 이하, 국내·글로벌 같은 수
                    for ph in {e.get("ph") for e in it[side]}: self.assertLessEqual(sum(e.get("ph") == ph for e in it[side]), 5, (it["i"], side, ph))
                self.assertEqual(len(it["dom"]), len(it["glo"]), it["i"]) if any("ph" in e for e in it["dom"]) else None

    def test_matches_exist_by_exact_name(self):
        for g, i, side, e in self.entries:
            if "m" in e: self.assertIn(e["m"], self.rows, e["n"])
        ms = [e["m"] for *_, e in self.entries if "m" in e]; self.assertEqual(len(set(ms)), len(ms), "같은 공개 행을 두 업체에 직접 연결하지 않음")

    def test_global_entries_use_parent_figures(self):
        """글로벌 업체는 본사 실적: par 업체는 자기 이름으로 공개 행에 연결하지 않고(m 없음), 본사 지정 p 에 공개 행(m)·별도 수집(x)·사유(w) 중 하나만 둔다."""
        for g, i, side, e in self.entries:
            if side != "glo": continue
            if e["k"] == "par":
                self.assertNotIn("m", e, e["n"]); p = e["p"]; self.assertTrue(p["n"])
                self.assertEqual(sum(k in p for k in ("m", "x", "w")), 1, e["n"])
                if "m" in p: self.assertIn(p["m"], self.rows, e["n"])
            else: self.assertNotIn("p", e)
        for g, i, side, e in self.entries:  # Unimicron Kunshan 은 대만 본사 행(UNIMICRON TECHNOLOGY)을 본사로 명시해서만 연결
            if "Unimicron" in e["f"] and e.get("k") == "par": self.assertEqual(e["p"].get("m"), "UNIMICRON TECHNOLOGY")

    def test_korean_affiliate_rows_exist_by_exact_name(self):
        """글로벌 업체의 한국 법인(km: 공개 행 이름, kx: 따로 수집)은 글로벌 쪽에만 있고, km 는 공개 행에 이름이 정확히 있어야 한다."""
        for g, i, side, e in self.entries:
            if side == "dom": self.assertNotIn("km", e); self.assertNotIn("kx", e)
            if "km" in e: self.assertIn(e["km"], self.rows, e["n"]); self.assertNotIn("kx", e)

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
        names = {e["n"] for gr in R["groups"] for it in gr["items"] for e in it["dom"]} | {e["p"]["n"] for gr in R["groups"] for it in gr["items"] for e in it["dom"] if e.get("p", {}).get("d")} | {e["p"]["n"] for gr in R["groups"] for it in gr["items"] for e in it["glo"] if e.get("p", {}).get("x")} | {e["n"] for gr in R["groups"] for it in gr["items"] for e in it["glo"] if e.get("ex")} | {e["kx"] for gr in R["groups"] for it in gr["items"] for e in it["glo"] if e.get("kx")}
        self.assertEqual(set(j), {"version", "generatedAt", "unit", "note", "rows"})
        for r in j["rows"]:
            self.assertTrue(set(r) in ({"n", "s", "src", "r", "o"}, {"n", "s", "src", "r", "o", "ov"})); self.assertIn(r["n"], names | {"에이에스엠엘코리아"}); self.assertEqual((len(r["r"]), len(r["o"])), (3, 3))
            self.assertTrue(all(isinstance(v, (int, float)) for v in r["r"] + r["o"]))
        self.assertEqual(len({(r["n"], r["s"]) for r in j["rows"]}), len(j["rows"]))   # 한 업체의 개별·연결은 별개 행(같은 기준은 한 번만)
        self.assertIsNone(re.search(r"\d{10,}", raw)); self.assertIsNone(re.search(r"\d{3}-\d{2}-\d{5}|\d{6}-\d{7}", raw))


if __name__ == "__main__": unittest.main()
