"""peers_edinet offline unit tests (no API key / network)."""
import csv
import io
import sys
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from peers_edinet import extract_metrics, is_target_report, master_japan, parse_yen


def sample_zip(rows):
    columns = ["要素ID", "項目名", "コンテキストID", "相対年度", "連結・個別",
               "期間・時点", "ユニットID", "単位", "値"]
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, delimiter="\t", quoting=csv.QUOTE_ALL)
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w") as zf:
        zf.writestr("XBRL_TO_CSV/jpcrp030000-asr.csv", buffer.getvalue().encode("utf-16"))
    return payload.getvalue()


class TestEdinet(unittest.TestCase):
    def test_parse_yen(self):
        self.assertEqual(parse_yen("△12,300"), -12300)
        self.assertEqual(parse_yen("(900)"), -900)
        self.assertIsNone(parse_yen("—"))
        self.assertIsNone(parse_yen("dummy"))

    def test_exact_consolidated_current_year(self):
        blob = sample_zip([
            {"要素ID": "jpcrp_cor:NetSalesSummaryOfBusinessResults",
             "コンテキストID": "CurrentYearDuration", "連結・個別": "連結",
             "ユニットID": "JPY", "値": "123,000,000,000"},
            {"要素ID": "jppfs_cor:OperatingIncome",
             "コンテキストID": "CurrentYearDuration", "連結・個別": "連結",
             "ユニットID": "JPY", "値": "12,000,000,000"},
            {"要素ID": "jppfs_cor:OperatingIncome",
             "コンテキストID": "CurrentYearDuration_NonConsolidatedMember",
             "連結・個別": "個別", "ユニットID": "JPY", "値": "50,000,000,000"},
            {"要素ID": "jppfs_cor:OperatingIncome",
             "コンテキストID": "Prior1YearDuration",
             "ユニットID": "JPY", "値": "80,000,000,000"},
            {"要素ID": "jppfs_cor:OperatingIncome",
             "コンテキストID": "CurrentYearDuration_SegmentMember",
             "ユニットID": "JPY", "値": "90,000,000,000"},
        ])
        got = extract_metrics(blob)
        self.assertEqual(got["revenue_jpy"], 123_000_000_000)
        self.assertEqual(got["operating_income_jpy"], 12_000_000_000)
        self.assertEqual(got["operating_element"], "jppfs_cor:OperatingIncome")

    def test_ifrs_and_no_guess_for_unknown_element(self):
        blob = sample_zip([
            {"要素ID": "jpigp_cor:OperatingProfitLossIFRS",
             "コンテキストID": "CurrentYearDuration",
             "ユニットID": "JPY", "値": "-1234"},
            {"要素ID": "custom:UnmappedRevenue",
             "コンテキストID": "CurrentYearDuration",
             "ユニットID": "JPY", "値": "5000"},
        ])
        got = extract_metrics(blob)
        self.assertEqual(got["operating_income_jpy"], -1234)
        self.assertIsNone(got["revenue_jpy"])

    def test_master_and_match(self):
        targets = master_japan()
        self.assertIn("8035", targets)
        self.assertTrue(is_target_report({
            "secCode": "80350", "docTypeCode": "120", "csvFlag": "1",
            "legalStatus": "1", "withdrawalStatus": "0"
        }, targets))
        self.assertFalse(is_target_report({
            "secCode": "80350", "docTypeCode": "140", "csvFlag": "1"
        }, targets))


if __name__ == "__main__":
    unittest.main()
