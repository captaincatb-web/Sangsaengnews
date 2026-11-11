"""외화 감사보고서(예: '(단위 : EUR)')를 원으로 잘못 읽지 않는지 확인한다."""
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import types
for _m in ("feedparser",):  # 이 테스트와 무관한 선택 의존성은 없으면 빈 모듈로 대체
    try:
        __import__(_m)
    except ImportError:
        sys.modules[_m] = types.ModuleType(_m)
import build_company_profiles as b


def _doc(unit):
    return f"""<TABLE><TR><TD>포괄손익계산서</TD></TR><TR><TD>에이에스엠엘코리아 유한회사 (단위 : {unit})</TD></TR>
<TR><TD>I. 매출액</TD><TD>9,118,338,964</TD><TD>7,051,108,626</TD></TR></TABLE>"""


class AuditCurrencyTest(unittest.TestCase):
    def test_eur_detected(self):
        cur, prev, ccy = b.parse_audit_statements_ex(_doc("EUR"))
        self.assertEqual(ccy, {"매출액": "EUR"})
        self.assertEqual(cur.get("매출액"), 9_118_338_964)
        self.assertEqual(prev.get("매출액"), 7_051_108_626)

    def test_krw_unchanged(self):
        cur, prev, ccy = b.parse_audit_statements_ex(_doc("원"))
        self.assertEqual(ccy, {})
        self.assertEqual(cur.get("매출액"), 9_118_338_964)

    def test_krw_report_with_usd_note_table_not_converted(self):
        doc = ("<TABLE><TR><TD>손익계산서 (단위 : 원)</TD></TR><TR><TD>I. 매출액</TD><TD>5,000,000,000</TD><TD>4,000,000,000</TD></TR></TABLE>"
               "<TABLE><TR><TD>외화자산 (단위 : USD)</TD></TR><TR><TD>자산총계</TD><TD>1,000</TD><TD>900</TD></TR></TABLE>")
        cur, prev, ccy = b.parse_audit_statements_ex(doc)
        self.assertNotIn("매출액", ccy)           # 원화 표의 매출은 환산 대상이 아니다
        self.assertEqual(cur["매출액"], 5_000_000_000)

    def test_fx_rate_average(self):
        b._ECB["daily"] = {"2025-06-30": {"KRW": "1600", "USD": "1.0"}, "2025-07-01": {"KRW": "1700", "USD": "1.0"}}
        self.assertAlmostEqual(b.krw_per_unit("EUR", 2025, 12), 1650)
        self.assertAlmostEqual(b.krw_per_unit("USD", 2025, 12), 1650)
        b._ECB.clear()


if __name__ == "__main__":
    unittest.main()
