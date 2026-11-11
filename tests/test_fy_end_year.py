"""회계연도는 '회계기간 종료연도'로 통일한다(3월 결산 2024.04~2025.03 = 2025)."""
import sys, types, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
try:
    __import__("feedparser")
except ImportError:
    sys.modules["feedparser"] = types.ModuleType("feedparser")
import build_company_profiles as bcp
import build_financials as bf


def _fake(mt):
    """사업연도(시작한 해) y 의 보고서는 y, y-1 두 해를 준다. 값은 시작연도 y 를 매출로 쓴다(어느 사업연도가 읽혔는지 확인용)."""
    bcp.call = lambda *a, **k: {"acc_mt": str(mt)}
    bcp.statement_rows = lambda key, cc, year, kind: [year]
    bcp.annual_by_year = lambda rows, year: {year: {"매출액": year * 1.0}, year - 1: {"매출액": (year - 1) * 1.0}} if rows else {}
    bcp.eok = lambda v: v


class FyEndYearTest(unittest.TestCase):
    def test_dec_closer_unchanged(self):
        _fake(12)
        years, vals, src = bf.annual_series("k", "c", 2026)
        self.assertEqual(years, [2023, 2024, 2025]); self.assertEqual(vals["매출액"], [2023.0, 2024.0, 2025.0])

    def test_march_closer_uses_end_year_and_older_reports(self):
        _fake(3)
        years, vals, src = bf.annual_series("k", "c", 2026)
        self.assertEqual(years, [2023, 2024, 2025])                    # 종료연도 2023·2024·2025
        self.assertEqual(vals["매출액"], [2022.0, 2023.0, 2024.0])     # 실제로 읽은 사업연도(시작연도) 2022·2023·2024: 2025.4~2026.3 은 제외

    def test_shift(self):
        self.assertEqual((bf.fy_shift(12), bf.fy_shift(3), bf.fy_shift(None)), (0, 1, 0))


if __name__ == "__main__":
    unittest.main()
