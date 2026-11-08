"""국가별 수집기 시험 — 합성 fixture 만 사용(네트워크 없음, HTTP 는 주입)."""
import json, os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts", "growth"))
from collectors import ALL, us_sec, jp_edinet, tw_twse, cn_cninfo, eu_generic  # noqa: E402
from collectors.base import FIN_KEYS  # noqa: E402
import probe_collectors  # noqa: E402


def entry(start, end, val, form="10-K", filed="2025-02-01", accn="0001"):
    return {"start": start, "end": end, "val": val, "form": form, "filed": filed, "accn": accn}


class UsSec(unittest.TestCase):
    def facts(self):
        return {"us-gaap": {"Revenues": {"units": {"USD": [entry("2023-01-01", "2023-12-31", 100), entry("2024-01-01", "2024-12-31", 120), entry("2025-01-01", "2025-12-31", 150),
                                                           entry("2025-01-01", "2025-03-31", 30, form="10-Q")]}},
                            "OperatingIncomeLoss": {"units": {"USD": [entry("2023-01-01", "2023-12-31", 10), entry("2024-01-01", "2024-12-31", 12)]}}}}
    def test_annual_rows_and_missing_operating_income_blank(self):
        rows = us_sec.rows_from_facts(self.facts(), "O:x", "X Inc.", 123)
        self.assertEqual([r["fiscal_year"] for r in rows], ["2023", "2024", "2025"]); self.assertEqual(rows[2]["op_income_local"], "")  # 영업이익 없으면 공란(추정 안 함)
        self.assertTrue(all(set(FIN_KEYS) <= set(r) for r in rows)); self.assertTrue(all(r["scope"] == "연결" and r["unit_multiplier"] == 1 for r in rows))
    def test_ifrs_20f_foreign_currency(self):
        f = {"ifrs-full": {"Revenue": {"units": {"EUR": [entry("2024-01-01", "2024-12-31", 28263, form="20-F")]}}, "ProfitLossFromOperatingActivities": {"units": {"EUR": [entry("2024-01-01", "2024-12-31", 9023, form="20-F")]}}}}
        rows = us_sec.rows_from_facts(f, "O:y", "Y N.V.", 5, years=(2024,)); self.assertEqual((rows[0]["currency"], rows[0]["op_income_local"]), ("EUR", 9023))
    def test_fiscal_year_is_period_end_year_and_period_length_checked(self):
        f = {"us-gaap": {"Revenues": {"units": {"USD": [entry("2022-06-27", "2023-06-25", 17429), entry("2023-06-26", "2023-09-24", 4000)]}}}}  # 두 번째는 분기(거부)
        a = us_sec.annual(f, us_sec.REV); self.assertEqual(list(a), [2023]); self.assertEqual(a[2023][0], 17429)
    def test_currency_mismatch_drops_operating_income(self):
        f = {"us-gaap": {"Revenues": {"units": {"USD": [entry("2024-01-01", "2024-12-31", 100)]}}, "OperatingIncomeLoss": {"units": {"EUR": [entry("2024-01-01", "2024-12-31", 9)]}}}}
        rows = us_sec.rows_from_facts(f, "O:z", "Z", 1, years=(2024,)); self.assertEqual(rows[0]["op_income_local"], "")
    def test_period_mismatch_drops_operating_income(self):
        f = {"us-gaap": {"Revenues": {"units": {"USD": [entry("2024-01-01", "2024-12-31", 100)]}}, "OperatingIncomeLoss": {"units": {"USD": [entry("2023-12-31", "2024-12-29", 9)]}}}}
        rows = us_sec.rows_from_facts(f, "O:z", "Z", 1, years=(2024,)); self.assertEqual(rows[0]["op_income_local"], "")
    def test_collect_without_user_agent_returns_empty(self):
        os.environ.pop("SEC_USER_AGENT", None); c = us_sec.UsSec(http_get=lambda *a, **k: (200, b"{}")); self.assertEqual(c.collect({"entity_id": "O:x", "cik": 1}), [])


HDR = "要素ID\tコンテキストID\t連結・個別\t単位\t値\tperiod_start\tperiod_end\n"


def csv_line(eid, ctx, kind, unit, val, s="2024-04-01", e="2025-03-31"):
    return f"{eid}\t{ctx}\t{kind}\t{unit}\t{val}\t{s}\t{e}\n"


class JpEdinet(unittest.TestCase):
    def text(self):
        return HDR + csv_line("jppfs_cor:NetSales", "CurrentYearDuration", "連結", "百万円", "1,000") + csv_line("jppfs_cor:OperatingIncome", "CurrentYearDuration", "連結", "百万円", "200") \
            + csv_line("jppfs_cor:NetSales", "CurrentYearDuration_NonConsolidatedMember", "個別", "円", "800000000") + csv_line("jppfs_cor:OperatingIncome", "CurrentYearDuration_NonConsolidatedMember", "個別", "円", "△50000000") \
            + csv_line("jppfs_cor:NetSales", "Prior1YearDuration", "連結", "百万円", "999")
    def test_parse_consolidated_and_individual_with_units(self):
        rows = jp_edinet.parse_csv(self.text(), "O:a", "A Co.", "https://example.org/doc"); by = {r["scope"]: r for r in rows}
        self.assertEqual(by["연결"]["revenue_local"], 1000 * 1e6); self.assertEqual(by["개별"]["revenue_local"], 800000000.0); self.assertEqual(by["개별"]["op_income_local"], -50000000.0)
        self.assertEqual(len(rows), 2)  # 전기(Prior1Year) 값은 제외
    def test_individual_preferred(self):
        rows = jp_edinet.prefer_individual(jp_edinet.parse_csv(self.text(), "O:a", "A", "u")); self.assertEqual([r["scope"] for r in rows], ["개별"])
    def test_unknown_unit_or_bad_period_rejected(self):
        t = HDR + csv_line("jppfs_cor:NetSales", "CurrentYearDuration", "連結", "ドル", "1") + csv_line("jppfs_cor:NetSales", "CurrentYearDuration", "連結", "円", "1", "2024-10-01", "2025-03-31")
        self.assertEqual(jp_edinet.parse_csv(t, "O:a", "A", "u"), [])
    def test_requires_auth_and_no_key_collects_nothing(self):
        os.environ.pop("EDINET_API_KEY", None); c = jp_edinet.JpEdinet(http_get=lambda *a, **k: (200, b"x")); self.assertTrue(c.requires_auth); self.assertEqual(c.collect({"entity_id": "O:a", "doc_ids": [{"docID": "S1"}]}), [])


class TwCnEu(unittest.TestCase):
    def test_twse_annual_only_and_minguo_year(self):
        recs = [{"公司代號": "2330", "年度": "113", "季別": "4", "單位": "千元", "營業收入": "1,000", "營業利益（損失）": "300"}, {"公司代號": "2330", "年度": "114", "季別": "2", "單位": "千元", "營業收入": "500"}, {"公司代號": "1101", "年度": "113", "季別": "4", "單位": "千元", "營業收入": "9"}]
        rows = tw_twse.parse_income(recs, "2330", "O:t", "T Corp", "https://example.org"); self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["fiscal_year"], rows[0]["currency"], rows[0]["revenue_local"]), ("2024", "TWD", 1e6))
    def test_twse_missing_unit_rejected(self):
        self.assertEqual(tw_twse.parse_income([{"公司代號": "2330", "年度": "113", "季別": "4", "營業收入": "1"}], "2330", "O:t", "T", "u"), [])
    def test_cninfo_parser_and_not_implemented(self):
        p = {"announcements": [{"announcementTitle": "2024年年度报告", "adjunctUrl": "a.pdf"}, {"announcementTitle": "2024年年度报告摘要", "adjunctUrl": "b.pdf"}, {"announcementTitle": "临时公告", "adjunctUrl": "c.pdf"}]}
        self.assertEqual(cn_cninfo.parse_announcements(p), [("2024年年度报告", "a.pdf")]); self.assertEqual(cn_cninfo.CnCninfo().collect({"entity_id": "O:c"}), []); self.assertFalse(cn_cninfo.CnCninfo.CAPABILITY["implemented"])
    def test_eu_placeholder(self):
        self.assertEqual(eu_generic.EuGeneric().collect({"entity_id": "O:e"}), []); self.assertFalse(eu_generic.EuGeneric.CAPABILITY["implemented"])


class Probe(unittest.TestCase):
    def test_403_recorded_once_without_retry(self):
        calls = []
        def stub(url, headers=None, timeout=0): calls.append(url); return 403, b""
        r = us_sec.UsSec(http_get=stub).probe()
        self.assertEqual(len(calls), 1); self.assertFalse(r["reachable"]); self.assertEqual(r["http_status"], 403); self.assertIn("우회하지 않음", r["error"])
    def test_429_and_network_failure(self):
        r = tw_twse.TwTwse(http_get=lambda *a, **k: (429, b"")).probe(); self.assertFalse(r["reachable"]); self.assertIn("429", r["error"])
        r = tw_twse.TwTwse(http_get=lambda *a, **k: (None, b"")).probe(); self.assertIsNone(r["http_status"]); self.assertFalse(r["reachable"])
    def test_probe_output_fields_and_no_secret(self):
        os.environ["EDINET_API_KEY"] = "SECRET-KEY"
        try:
            res = probe_collectors.run(http_get=lambda *a, **k: (200, b"{}"))
        finally: os.environ.pop("EDINET_API_KEY", None)
        self.assertEqual(len(res), len(ALL)); txt = json.dumps(res, ensure_ascii=False); self.assertNotIn("SECRET-KEY", txt)
        for r in res: self.assertTrue({"country", "source", "endpoint", "http_status", "reachable", "auth_required", "error", "checked_at"} <= set(r))
    def test_capability_never_claims_live_verified(self):
        for c in ALL: self.assertFalse(c.CAPABILITY["live_verified"]); self.assertIn("implemented", c.CAPABILITY)


if __name__ == "__main__": unittest.main()


class SecTickersCalcOp(unittest.TestCase):
    """KLA처럼 손익계산서에 영업이익 줄이 없는 법인: 표시한 법인만, 같은 보고서·기간·통화의 4개 항목으로 계산(사용자 승인 2026-11-08)."""
    def setUp(self):
        import collect_sec_tickers as T
        self.T = T
    def facts(self, cogs_accn="A1", cogs_end="2025-06-30", cogs_cur="USD", extra=None):
        e = lambda v, accn="A1", end="2025-06-30": {"start": "2024-07-01", "end": end, "val": v, "form": "10-K", "filed": "2025-08-01", "accn": accn}
        g = {"Revenues": {"units": {"USD": [e(1000)]}}, "CostOfRevenue": {"units": {cogs_cur: [e(400, cogs_accn, cogs_end)]}},
             "ResearchAndDevelopmentExpense": {"units": {"USD": [e(120)]}}, "SellingGeneralAndAdministrativeExpense": {"units": {"USD": [e(80)]}}}
        g.update(extra or {})
        return {"us-gaap": g}
    def rv(self, f):
        return self.T.annual(f, self.T.REV)[2025]
    def test_calc_value_and_tags(self):
        f = self.facts(); v, tags, other = self.T.calc_op(f, self.rv(f), 2025)
        self.assertEqual(v, 400); self.assertEqual(tags, ["CostOfRevenue", "ResearchAndDevelopmentExpense", "SellingGeneralAndAdministrativeExpense"]); self.assertEqual(other, [])
    def test_different_filing_period_or_currency_gives_none(self):
        for kw in ({"cogs_accn": "A2"}, {"cogs_end": "2025-06-29"}, {"cogs_cur": "EUR"}):
            f = self.facts(**kw); self.assertIsNone(self.T.calc_op(f, self.rv(f), 2025), kw)
    def test_missing_component_gives_none(self):
        f = self.facts(); del f["us-gaap"]["SellingGeneralAndAdministrativeExpense"]; self.assertIsNone(self.T.calc_op(f, self.rv(f), 2025))
    def test_other_opex_is_reported_not_subtracted(self):
        imp = {"GoodwillImpairmentLoss": {"units": {"USD": [{"start": "2024-07-01", "end": "2025-06-30", "val": 50, "form": "10-K", "filed": "2025-08-01", "accn": "A1"}]}}}
        f = self.facts(extra=imp); v, _, other = self.T.calc_op(f, self.rv(f), 2025)
        self.assertEqual(v, 400); self.assertEqual(other, [("GoodwillImpairmentLoss", 50)])
