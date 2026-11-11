"""개별·연결 공통 수집기(dart_scopes) 시험: 종료연도 3개년, 교차 검증, 연결 미공시 구분, 기존 개별 조회 기본값 보존."""
import sys, types, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
try:
    __import__("feedparser")
except ImportError:
    sys.modules["feedparser"] = types.ModuleType("feedparser")
import build_company_profiles as bcp
import dart_scopes as ds


def rows(b, rev, op, rcept):
    """사업연도 b 보고서: 당기 b, 전기 b-1, 전전기 b-2 의 매출·영업이익(rev·op 는 [당기, 전기, 전전기])."""
    def r(i, nm, v):
        return {"sj_div": "IS", "account_id": i, "account_nm": nm, "thstrm_amount": str(v[0]), "frmtrm_amount": str(v[1]), "bfefrmtrm_amount": str(v[2]), "rcept_no": rcept, "currency": "KRW"}
    return [r("ifrs-full_Revenue", "매출액", rev), r("dart_OperatingIncomeLoss", "영업이익", op)]


class Scopes(unittest.TestCase):
    def fetch_factory(self, cfs_missing=False, restate=False):
        def fetch(key, cc, b, fs):
            if fs == "CFS" and cfs_missing: return "nodata", []
            base = 100 if fs == "OFS" else 200
            rev = {b: base + b % 100}
            data = {2025: ([base + 25, base + 24, base + 23], [5, 4, 3]), 2024: ([base + 24, base + 23, base + 22], [4, 3, 2]), 2023: ([base + 23, base + 22, base + 21], [3, 2, 1])}.get(b)
            if not data: return "nodata", []
            rv, op = data
            if restate and b == 2025: rv = [rv[0], rv[1] + 7, rv[2]]   # 2025 보고서가 2024 를 다르게 적음
            return "ok", rows(b, rv, op, f"R{b}")
        return fetch

    def test_six_records_cross_checked(self):
        out = ds.collect_scopes("k", "c", 2026, 12, fetch=self.fetch_factory())
        self.assertEqual(len(out), 6)
        self.assertEqual({(r["scope"], r["fiscal_year"]) for r in out}, {(s, y) for s in ("STANDALONE", "CONSOLIDATED") for y in (2023, 2024, 2025)})
        self.assertTrue(all(r["collection_status"] == "COLLECTED" for r in out))
        ofs25 = next(r for r in out if r["scope"] == "STANDALONE" and r["fiscal_year"] == 2025)
        self.assertEqual((ofs25["revenue_krw"], ofs25["op_income_krw"], ofs25["rcept_no"]), (125, 5, "R2025"))
        self.assertEqual(ofs25["verification_status"], "DART_SINGLE_REPORT")   # 2025 는 다음 해 보고서가 없어 단일 보고서 값
        ofs24 = next(r for r in out if r["scope"] == "STANDALONE" and r["fiscal_year"] == 2024)
        self.assertEqual(ofs24["verification_status"], "DART_CROSS_CHECKED")

    def test_cfs_missing_keeps_ofs_and_marks_status(self):
        out = ds.collect_scopes("k", "c", 2026, 12, fetch=self.fetch_factory(cfs_missing=True))
        self.assertTrue(all(r["collection_status"] == "COLLECTED" for r in out if r["scope"] == "STANDALONE"))
        cfs = [r for r in out if r["scope"] == "CONSOLIDATED"]
        self.assertTrue(all(r["collection_status"] == "NO_DATA" and r["revenue_krw"] == "" for r in cfs))   # 0 이 아니라 빈 값

    def test_restatement_flagged(self):
        out = ds.collect_scopes("k", "c", 2026, 12, fetch=self.fetch_factory(restate=True))
        r24 = next(r for r in out if r["scope"] == "STANDALONE" and r["fiscal_year"] == 2024)
        self.assertEqual(r24["verification_status"], "DART_RESTATED_MISMATCH")

    def test_march_closer_period_and_year(self):
        self.assertEqual(ds.period_of(2025, 3), ("2024-04-01", "2025-03-31"))
        self.assertEqual(ds.period_of(2025, 12), ("2025-01-01", "2025-12-31"))
        seen = []
        def fetch(key, cc, b, fs): seen.append((fs, b)); return "nodata", []
        ds.collect_scopes("k", "c", 2026, 3, fetch=fetch)
        self.assertIn(("OFS", 2022), seen)   # 종료연도 2023 = 사업연도 2022 보고서

    def test_existing_statement_rows_default_is_ofs(self):
        got = {}
        bcp.call = lambda key, ep, **kw: got.update(kw) or {"list": []}
        bcp.statement_rows("k", "c", 2025, bcp.ANNUAL)
        self.assertEqual(got["fs_div"], "OFS")


if __name__ == "__main__":
    unittest.main()
