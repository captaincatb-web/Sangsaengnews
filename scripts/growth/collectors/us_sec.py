"""미국 SEC EDGAR 수집기: companyfacts XBRL(10-K·20-F·40-F, us-gaap + ifrs-full). import 시 환경변수·네트워크를 쓰지 않는다.
회계연도 = 회계기간 종료일의 연도, 기간 350~380일, 매출과 영업이익은 같은 기간·같은 통화일 때만 쌍으로 쓴다. 영업이익이 없으면 빈 값(추정 안 함).
entity_ref: {"entity_id": "O:key", "cik": 1234, "official_name": "…"}  (CIK 는 공식 식별자로 호출자가 확정)"""
import datetime as dt
import json
from .base import Collector, make_row

FORMS = ("10-K", "20-F", "40-F")
REV = [("us-gaap", t) for t in ("Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet")] + [("ifrs-full", "Revenue"), ("ifrs-full", "RevenueFromContractsWithCustomers")]
OPI = [("us-gaap", "OperatingIncomeLoss"), ("ifrs-full", "ProfitLossFromOperatingActivities")]


def annual(facts, tags):
    """{회계연도: (값, 시작일, 종료일, 통화, 서류양식, 접수번호)}. 같은 기간은 가장 늦게 제출된 값, 태그는 앞쪽 우선."""
    best = {}
    for tax, tag in tags:
        for cur, entries in (facts.get(tax, {}).get(tag, {}).get("units", {}) or {}).items():
            for e in entries:
                if not str(e.get("form", "")).startswith(FORMS) or not e.get("start"): continue
                s, t = dt.date.fromisoformat(e["start"]), dt.date.fromisoformat(e["end"])
                if not 350 <= (t - s).days <= 380: continue
                k = ((tax, tag), t.year)
                if k not in best or e["filed"] > best[k][0]: best[k] = (e["filed"], e["val"], s, t, cur, e.get("form"), e.get("accn", ""))
    out = {}
    for tg in tags:
        for (tg2, y), (_, v, s, t, cur, form, accn) in best.items():
            if tg2 == tg: out.setdefault(y, (v, s, t, cur, form, accn))
    return out


def rows_from_facts(facts, entity_id, official_name, cik, years=(2023, 2024, 2025)):
    rev, op = annual(facts, REV), annual(facts, OPI); rows = []
    for y in years:
        rv = rev.get(y)
        if not rv: continue
        ov = op.get(y); same = bool(ov and ov[1] == rv[1] and ov[2] == rv[2] and ov[3] == rv[3])
        url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{int(cik):010d}.json"
        rows.append(make_row(entity_id, str(y), rv[1], rv[2], rv[3], rv[0], ov[0] if same else "", "연결", url, f"Form {rv[4]} accn {rv[5]}".strip(), official_name, "높음" if same else "중간"))
    return rows


class UsSec(Collector):
    country = "US"
    source = "SEC EDGAR (companyfacts XBRL)"
    requires_auth = False  # 인증 키는 없지만 연락처가 담긴 User-Agent(SEC_USER_AGENT) 필요
    probe_url = "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json"
    CAPABILITY = {"implemented": True, "live_verified": False, "fixture_tested": True,
                  "notes": "10-K·20-F·40-F, us-gaap·ifrs-full. 개별 재무는 공시되지 않아 연결만. 실제 수집은 scripts/growth/collect_sec.py(Actions)로 검증됨, 이 모듈은 fixture 시험만."}

    def collect(self, entity_ref, years=(2023, 2024, 2025)):
        import os
        ua = os.environ.get("SEC_USER_AGENT", "").strip()
        if not ua or not entity_ref.get("cik"): return []
        url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{int(entity_ref['cik']):010d}.json"
        status, body = self.http_get(url, headers={"User-Agent": ua, "Accept-Encoding": "gzip, deflate"}, timeout=60)
        if status != 200: return []
        try: facts = json.loads(body).get("facts", {})
        except ValueError: return []
        return rows_from_facts(facts, entity_ref["entity_id"], entity_ref.get("official_name", ""), entity_ref["cik"], years)
