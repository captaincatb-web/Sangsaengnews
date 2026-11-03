import datetime as dt, os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts", "growth"))
import ingest_overseas_csv as I  # noqa: E402


def fx():
    d0 = dt.date(2024, 1, 1)
    return {"JPY": [(d0 + dt.timedelta(days=i), 9.0) for i in range(366)], "EUR": [(d0 + dt.timedelta(days=i), 1400.0) for i in range(366)]}


def row(**kw):
    r = {"목록표기": "TOKYO ELECTRON", "공식법인명": "Tokyo Electron Ltd.", "회계연도": "FY2024", "기간시작": "2024-01-01", "기간종료": "2024-12-30", "통화": "JPY", "금액단위": "1", "매출": "1000", "영업이익": "200", "연결/개별": "개별", "출처URL": "https://example.org/x", "쪽/표위치": "p.1", "확신도": "높음"}
    r.update(kw); return r


class Ingest(unittest.TestCase):
    def test_converts_with_period_average_fx(self):
        ok, rej = I.convert([row()], fx()); self.assertEqual(len(ok), 1); self.assertAlmostEqual(ok[0]["revenue_krw"], 9000.0); self.assertEqual(ok[0]["entity_id"], "O:tokyoelectron")
    def test_rejects_missing_source(self):
        ok, rej = I.convert([row(출처URL="")], fx()); self.assertEqual(ok, []); self.assertIn("출처URL 없음", rej)
    def test_rejects_units_in_number(self):
        ok, rej = I.convert([row(매출="1,000백만")], fx()); self.assertEqual(ok, [])
    def test_rejects_non_annual_period(self):
        ok, rej = I.convert([row(기간종료="2024-06-30")], fx()); self.assertEqual(ok, [])
    def test_missing_operating_income_stays_blank(self):
        ok, rej = I.convert([row(영업이익="")], fx()); self.assertEqual(ok[0]["op_income_krw"], "")
    def test_currency_without_rate_keeps_local_only(self):
        ok, rej = I.convert([row(통화="TWD")], fx()); self.assertEqual(ok[0]["revenue_krw"], ""); self.assertIn("환율 없음(원화 환산 비움)", rej)

    def test_unit_required_and_applied(self):
        ok, rej = I.convert([row(금액단위="")], fx()); self.assertEqual(ok, []); self.assertIn("금액단위 없음/해석 불가", rej)
        ok, rej = I.convert([row(금액단위="백만")], fx()); self.assertAlmostEqual(ok[0]["revenue_krw"], 1000 * 1e6 * 9.0)
    def test_mixed_scope_entity_rejected(self):
        rows = [row(기간시작="2023-01-01", 기간종료="2023-12-31", **{"연결/개별": "연결"}), row(**{"연결/개별": "개별"})]
        ok, rej = I.convert(rows, fx()); self.assertEqual(ok, []); self.assertIn("연결/개별 혼재(법인 전체 거부)", rej)


if __name__ == "__main__": unittest.main()
