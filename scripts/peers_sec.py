"""미국 상장사 재무를 SEC EDGAR(XBRL companyfacts)에서 읽는 도구. 외부 접속과 변환을 분리해 변환만 따로 시험할 수 있게 했다.

- 공식 무료 API(키 불필요). 요청마다 이름·연락처가 든 User-Agent 가 필요하고 초당 10회 이하로 쓴다.
- 연간: 10-K 의 12개월 값. 분기: 10-Q 의 3개월 값. 4분기는 10-K 연간 값 − (1~3분기 3개월 값 합)으로 계산한다(공시 값이 아니라 계산값).
- 같은 기간이 여러 번 공시되면(수정·재표시) 가장 나중에 제출한 값을 쓴다.
- 연도·분기 이름은 기간 종료일에서 20일을 뺀 날짜로 정한다(52·53주 회계연도가 1월 초에 끝나도 앞선 해로 잡히게).
"""
import os
import time
from datetime import date, timedelta

import requests

SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{:010d}.json"
DEFAULT_UA = "Sangsaengnews research captaincatb-web@users.noreply.github.com"

# 같은 값을 여러 태그로 공시해 왔으므로, 앞의 태그부터 쓰고 없는 기간만 뒤의 태그로 채운다
REVENUE_TAGS = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
                "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueGoodsNet"]
OPERATING_TAGS = ["OperatingIncomeLoss"]
NET_TAGS = ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"]
ASSET_TAGS = ["Assets"]
LIABILITY_TAGS = ["Liabilities"]
EQUITY_TAGS = ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]
RD_TAGS = ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"]


def user_agent() -> str:
    return os.environ.get("SEC_USER_AGENT") or DEFAULT_UA


def sec_get(url: str):
    resp = requests.get(url, headers={"User-Agent": user_agent(), "Accept-Encoding": "gzip, deflate"}, timeout=(10, 60))
    resp.raise_for_status()
    time.sleep(0.2)  # 초당 10회 한도 아래
    return resp.json()


def load_cik_map() -> dict:
    """{티커: CIK} (SEC 가 제공하는 티커 목록)."""
    data = sec_get(SEC_TICKERS_URL)
    return {str(v["ticker"]).upper(): int(v["cik_str"]) for v in data.values()}


def load_facts(cik: int) -> dict:
    return sec_get(SEC_FACTS_URL.format(cik))


# ---------- 기간·이름 ----------

def d(text: str) -> date:
    return date.fromisoformat(text[:10])


def fy_year(end: date) -> int:
    return (end - timedelta(days=20)).year


def q_label(end: date) -> str:
    x = end - timedelta(days=20)
    return f"'{x.year % 100:02d}.{(x.month - 1) // 3 + 1}Q"


def fy_end_month(end: date) -> int:
    return (end - timedelta(days=15)).month


# ---------- 사실(fact) 고르기 ----------

def _entries(facts: dict, tag: str, unit: str = "USD") -> list:
    return (((facts.get("facts") or {}).get("us-gaap") or {}).get(tag) or {}).get("units", {}).get(unit, [])


def duration_values(facts: dict, tags: list, lo: int, hi: int, form_prefix: str, unit: str = "USD") -> dict:
    """{종료일: (시작일, 값)}. 기간이 lo~hi 일인 값만, 같은 종료일은 가장 나중에 제출한 것."""
    out = {}
    for tag in tags:
        best = {}
        for e in _entries(facts, tag, unit):
            if not str(e.get("form", "")).startswith(form_prefix) or not e.get("start") or e.get("val") is None:
                continue
            start, end = d(e["start"]), d(e["end"])
            if not lo <= (end - start).days <= hi:
                continue
            cur = best.get(end)
            if cur is None or e.get("filed", "") >= cur[2]:
                best[end] = (start, e["val"], e.get("filed", ""))
        for end, (start, val, _filed) in best.items():
            out.setdefault(end, (start, val))  # 앞선 태그가 이미 채운 기간은 건드리지 않는다
    return out


def instant_values(facts: dict, tags: list, unit: str = "USD") -> dict:
    """{기준일: 값} 재무상태표 항목(10-K)."""
    out = {}
    for tag in tags:
        best = {}
        for e in _entries(facts, tag, unit):
            if not str(e.get("form", "")).startswith("10-K") or e.get("start") or e.get("val") is None:
                continue
            end = d(e["end"])
            cur = best.get(end)
            if cur is None or e.get("filed", "") >= cur[1]:
                best[end] = (e["val"], e.get("filed", ""))
        for end, (val, _f) in best.items():
            out.setdefault(end, val)
    return out


def derive_q4(annual: dict, quarterly: dict) -> dict:
    """{4분기 종료일: (시작일, 값)}. 연간 값 − 같은 해 1~3분기 값. 1~3분기 중 하나라도 없으면 만들지 않는다."""
    out = {}
    for fy_end, (_start, fy_val) in annual.items():
        picks = []
        for back in (273, 182, 91):  # 1·2·3분기 종료일은 연말에서 대략 이만큼 앞
            target = fy_end - timedelta(days=back)
            near = [e for e in quarterly if abs((e - target).days) <= 25 and e < fy_end]
            if not near:
                picks = []
                break
            picks.append(min(near, key=lambda e: abs((e - target).days)))
        if len(picks) == 3 and len(set(picks)) == 3:
            out[fy_end] = (picks[2] + timedelta(days=1), fy_val - sum(quarterly[e][1] for e in picks))
    return out


# ---------- 한 회사 ----------

def extract(facts: dict, years: int = 3, quarters: int = 8) -> dict | None:
    """companyfacts → 원 통화(USD) 값의 연간·분기. 매출 연간 값이 없으면 None."""
    rev = duration_values(facts, REVENUE_TAGS, 350, 380, "10-K")
    if not rev:
        return None
    ends = sorted(rev)[-years:]
    op = duration_values(facts, OPERATING_TAGS, 350, 380, "10-K")
    ni = duration_values(facts, NET_TAGS, 350, 380, "10-K")
    rd = duration_values(facts, RD_TAGS, 350, 380, "10-K")
    ta, tl_, te = (instant_values(facts, ASSET_TAGS), instant_values(facts, LIABILITY_TAGS), instant_values(facts, EQUITY_TAGS))

    def pick(series, end):
        v = series.get(end)
        return v[1] if isinstance(v, tuple) else v

    liab = []
    for e in ends:
        v = tl_.get(e)
        if v is None and ta.get(e) is not None and te.get(e) is not None:
            v = ta[e] - te[e]
        liab.append(v)
    out = {"ends": ends, "starts": [rev[e][0] for e in ends], "years": [fy_year(e) for e in ends],
           "s": [rev[e][1] for e in ends], "o": [pick(op, e) for e in ends], "ni": [pick(ni, e) for e in ends],
           "ta": [ta.get(e) for e in ends], "tl": liab, "te": [te.get(e) for e in ends], "rd": [pick(rd, e) for e in ends],
           "mt": fy_end_month(ends[-1])}

    # 분기: 3개월 값(10-Q) + 계산한 4분기
    series = {}
    for name, tags, annual in (("s", REVENUE_TAGS, rev), ("o", OPERATING_TAGS, op), ("net", NET_TAGS, ni)):
        q = duration_values(facts, tags, 80, 100, "10-Q")
        q.update(derive_q4(annual, q))
        series[name] = q
    q_ends = sorted(e for e in series["s"] if series["s"][e][1] is not None)[-quarters:]
    if q_ends:
        labels, seen = [], set()
        for e in q_ends:
            lab = q_label(e)
            if lab in seen:  # 이름이 겹치면 시험 중 오류이므로 분기 전체를 버린다
                q_ends = []
                break
            seen.add(lab)
            labels.append(lab)
    if q_ends:
        out["q"] = {"labels": labels, "starts": [series["s"][e][0] for e in q_ends], "ends": q_ends,
                    "sales": [series["s"][e][1] for e in q_ends],
                    "op": [(series["o"].get(e) or (None, None))[1] for e in q_ends],
                    "net": [(series["net"].get(e) or (None, None))[1] for e in q_ends]}
    return out
