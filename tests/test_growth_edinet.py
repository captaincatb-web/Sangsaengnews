import io, os, sys, unittest, zipfile, datetime as dt
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts", "growth"))
import collect_edinet as E  # noqa: E402


def make_zip(rows):
    head = "要素ID\t項目名\tコンテキストID\t相対年度\t連結・個別\t期間・時点\tユニットID\t単位\t値\n"
    body = "".join("\t".join(r) + "\n" for r in rows)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z: z.writestr("XBRL_TO_CSV/jpcrp030000-asr_E00000-000_2025-03-31.csv", (head + body).encode("utf-16"))
    return buf.getvalue()


class Edinet(unittest.TestCase):
    def test_parse_reads_consolidated_and_nonconsolidated_current_year_only(self):
        z = make_zip([("jppfs_cor:NetSales", "売上高", "CurrentYearDuration", "当期", "連結", "期間", "JPY", "円", "1,000"),
                      ("jppfs_cor:OperatingIncome", "営業利益", "CurrentYearDuration", "当期", "連結", "期間", "JPY", "円", "100"),
                      ("jppfs_cor:NetSales", "売上高", "CurrentYearDuration_NonConsolidatedMember", "当期", "個別", "期間", "JPY", "円", "600"),
                      ("jppfs_cor:OperatingIncome", "営業利益", "CurrentYearDuration_NonConsolidatedMember", "当期", "個別", "期間", "JPY", "円", "-30"),
                      ("jppfs_cor:NetSales", "売上高", "Prior1YearDuration", "前期", "連結", "期間", "JPY", "円", "999")])
        d = E.parse_doc(z); self.assertEqual(d["連結"] if "連結" in d else d["연결"], {"rev": 1000.0, "op": 100.0}); self.assertEqual(d["개별"], {"rev": 600.0, "op": -30.0})
    def test_other_elements_ignored(self):
        z = make_zip([("jppfs_cor:Assets", "資産", "CurrentYearDuration", "当期", "連結", "期間", "JPY", "円", "5")]); self.assertEqual(E.parse_doc(z), {})
    def test_scope_prefers_separate_when_complete(self):
        per = {"2023-03-31": {"개별": {"rev": 1, "op": 1}, "연결": {"rev": 2, "op": 2}}, "2024-03-31": {"개별": {"rev": 1, "op": 1}, "연결": {"rev": 2, "op": 2}}}
        self.assertEqual(E.choose_scope(per), "개별")
    def test_scope_falls_back_to_consolidated_only_when_separate_missing(self):
        per = {"2023-03-31": {"연결": {"rev": 2, "op": 2}}, "2024-03-31": {"연결": {"rev": 2, "op": 2}}}
        self.assertEqual(E.choose_scope(per), "연결")
        self.assertIsNone(E.choose_scope({"2023-03-31": {}}))
    def test_windows_cover_all_four_filing_seasons_and_never_future(self):
        w = E.windows(); self.assertTrue(all(d <= dt.date.today() for d in w)); self.assertTrue({d.month for d in w} >= {3, 4, 6, 7, 9, 10, 12, 1})


if __name__ == "__main__": unittest.main()
