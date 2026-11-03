"""대만 TWSE/TPEx OpenAPI 수집기. 한계: 손익계산서 데이터셋(t187ap06_L_* 등)은 **최근 보고기간(누적)만** 돌려주므로 3개년 연간 이력은 이 소스만으로 얻을 수 없다.
이 모듈은 한 번의 응답에서 '연간(4분기 누적, 1~12월)' 값만 연간 행으로 인정하고, 그 외 누적 기간은 버린다. 3개년 확보는 MOPS 과거 자료나 회사 IR 이 필요하다(미구현)."""
import datetime as dt
import json
from .base import Collector, make_row

REV_KEYS = ("營業收入", "營業收入合計", "收入")
OPI_KEYS = ("營業利益（損失）", "營業利益(損失)", "營業利益")


def _num(v):
    try: return float(str(v).replace(",", "").strip())
    except ValueError: return None


def parse_income(records, code, entity_id, official_name, source_url):
    """records: OpenAPI JSON 배열(회사별 한 행). 연간(Season '4' 또는 기간이 1/1~12/31)만. 통화 TWD, 단위는 千元(천 대만달러)로 공시되는 데이터셋 기준 — 단위 열이 없으면 거부한다."""
    rows = []
    for r in records:
        if str(r.get("公司代號", "")).strip() != str(code): continue
        year = str(r.get("年度", "")).strip(); season = str(r.get("季別", "")).strip()
        unit = (r.get("單位") or r.get("unit") or "").strip()
        mult = {"元": 1, "千元": 1e3, "百萬元": 1e6, "仟元": 1e3}.get(unit)
        if mult is None or season != "4" or not year.isdigit(): continue
        y = int(year) + 1911 if int(year) < 1911 else int(year)  # 民國 연도
        rev = next((_num(r[k]) for k in REV_KEYS if k in r and _num(r[k]) is not None), None)
        op = next((_num(r[k]) for k in OPI_KEYS if k in r and _num(r[k]) is not None), None)
        if rev is None: continue
        rows.append(make_row(entity_id, str(y), dt.date(y, 1, 1), dt.date(y, 12, 31), "TWD", rev * mult, "" if op is None else op * mult, r.get("scope", "연결"), source_url, f"公司代號 {code} 年度 {year} 第4季累計", official_name, "중간"))
    return rows


class TwTwse(Collector):
    country = "TW"
    source = "TWSE OpenAPI"
    requires_auth = False
    probe_url = "https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci"
    CAPABILITY = {"implemented": True, "live_verified": False, "fixture_tested": True,
                  "notes": "최근 보고기간만 제공 → 3개년 이력 불가(한계). 파서는 연간(4분기 누적) 행만 인정. 통화 TWD 는 ECB 환율이 없어 원화 환산 불가."}

    def collect(self, entity_ref, years=(2023, 2024, 2025)):
        status, body = self.http_get(self.probe_url, headers=self.headers(), timeout=60)
        if status != 200: return []
        try: records = json.loads(body)
        except ValueError: return []
        return [r for r in parse_income(records, entity_ref.get("code", ""), entity_ref["entity_id"], entity_ref.get("official_name", ""), self.probe_url) if int(r["fiscal_year"]) in years]
