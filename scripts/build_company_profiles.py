"""OpenDART API와 주가 데이터로 지정 기업 프로필 데이터(site/data/profiles.js)를 만든다.

사용법: DART_API_KEY 환경변수를 설정한 뒤 `python scripts/build_company_profiles.py`

- 재무는 개별(별도) 기준이 기본이다.
- 재무·주주·임원·인력은 사업보고서 제출 대상(주로 상장사)만 API로 제공되므로, 그 외 기업은 개황만 채워진다.
- 신용등급·업종평균·거래금액·거래비중처럼 외부에서 알 수 없는 값은 만들지 않는다(화면에서 확인필요/XXX로 표시).
"""
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

ROOT_DIR = Path(__file__).resolve().parent.parent
COMPANIES_PATH = ROOT_DIR / "site" / "data" / "companies.js"
PROFILES_PATH = ROOT_DIR / "site" / "data" / "profiles.js"
DART_API = "https://opendart.fss.or.kr/api/{}.json"
ANNUAL = "11011"
QUARTERLY = [("11014", "3분기"), ("11012", "반기"), ("11013", "1분기")]
EOK = 100_000_000

# (표시명, 재무제표 구분, 후보 계정명들) - 공백을 무시하고 앞쪽 후보부터 찾는다
ACCOUNTS = [
    ("총자산", ("BS",), ["자산총계"]),
    ("유동자산", ("BS",), ["유동자산"]),
    ("부채총계", ("BS",), ["부채총계"]),
    ("유동부채", ("BS",), ["유동부채"]),
    ("자본총계", ("BS",), ["자본총계"]),
    ("유형자산", ("BS",), ["유형자산"]),
    ("매출채권", ("BS",), ["매출채권", "매출채권및기타채권", "매출채권및기타유동채권", "단기매출채권"]),
    ("매입채무", ("BS",), ["매입채무", "매입채무및기타채무", "매입채무및기타유동채무", "단기매입채무"]),
    ("매출액", ("IS", "CIS"), ["매출액", "수익(매출액)", "영업수익", "매출"]),
    ("매출원가", ("IS", "CIS"), ["매출원가", "영업비용"]),
    ("영업이익", ("IS", "CIS"), ["영업이익", "영업이익(손실)", "영업손익"]),
    ("당기순이익", ("IS", "CIS"), ["당기순이익", "당기순이익(손실)", "당기순손익", "분기순이익", "반기순이익",
                                  "분기순이익(손실)", "반기순이익(손실)"]),
]
BORROWING_EXCLUDE = ("할인", "할증", "조정", "충당", "이자")


# ---------- DART 호출 ----------

class DartUnreachable(Exception):
    pass


_network_failures = 0
MAX_NETWORK_FAILURES = 5  # 연속 접속 실패가 이만큼이면 DART 에 닿지 않는 것으로 보고 중단


def call(api_key: str, endpoint: str, **params) -> dict | None:
    global _network_failures
    try:
        resp = requests.get(DART_API.format(endpoint), params={"crtfc_key": api_key, **params}, timeout=(5, 10))
        resp.raise_for_status()
        data = resp.json()
        _network_failures = 0
    except requests.RequestException as e:
        _network_failures += 1
        print(f"[dart] {endpoint} 접속 실패({_network_failures}회 연속): {e}")
        if _network_failures >= MAX_NETWORK_FAILURES:
            raise DartUnreachable(str(e)) from e
        return None
    except ValueError as e:
        print(f"[dart] {endpoint} 응답 해석 실패: {e}")
        return None
    finally:
        time.sleep(0.12)  # OpenDART 요청 한도 보호

    if data.get("status") == "013":  # 조회된 데이터 없음
        return None
    if data.get("status") != "000":
        print(f"[dart] {endpoint} {params} 응답 오류: {data.get('message')}")
        return None
    return data


def to_number(text) -> int | None:
    cleaned = re.sub(r"[^\d-]", "", str(text or ""))
    return int(cleaned) if cleaned not in ("", "-") else None


def squash(name: str) -> str:
    return re.sub(r"\s", "", name or "")


def find_row(rows: list, sj_divs: tuple, names: list) -> dict | None:
    for name in names:
        for r in rows:
            if r.get("sj_div") in sj_divs and squash(r.get("account_nm")) == squash(name):
                return r
    return None


def is_borrowing(name: str) -> bool:
    n = squash(name)
    if any(x in n for x in BORROWING_EXCLUDE):
        return False
    return "차입금" in n or n.endswith("사채")


def statement_rows(api_key: str, corp_code: str, year: int, reprt_code: str) -> list:
    data = call(api_key, "fnlttSinglAcntAll", corp_code=corp_code, bsns_year=str(year),
                reprt_code=reprt_code, fs_div="OFS")
    return (data or {}).get("list", [])


def annual_by_year(rows: list, year: int) -> dict:
    """사업보고서 1건(당기·전기·전전기)을 {연도: {계정: 금액}} 으로 바꾼다."""
    cols = [("thstrm_amount", year), ("frmtrm_amount", year - 1), ("bfefrmtrm_amount", year - 2)]
    out = {y: {} for _, y in cols}
    for label, sj_divs, names in ACCOUNTS:
        row = find_row(rows, sj_divs, names)
        if row:
            for col, y in cols:
                v = to_number(row.get(col))
                if v is not None:
                    out[y][label] = v
    for col, y in cols:
        vals = [to_number(r.get(col)) for r in rows if r.get("sj_div") == "BS" and is_borrowing(r.get("account_nm"))]
        if any(v is not None for v in vals):
            out[y]["차입금"] = sum(v for v in vals if v)
    return {y: v for y, v in out.items() if v}


def quarter_values(rows: list) -> dict:
    """분기·반기보고서의 당기 금액. 손익은 누적 금액을 우선한다."""
    out = {}
    for label, sj_divs, names in ACCOUNTS:
        row = find_row(rows, sj_divs, names)
        if not row:
            continue
        v = to_number(row.get("thstrm_add_amount")) if sj_divs != ("BS",) else None
        v = v if v is not None else to_number(row.get("thstrm_amount"))
        if v is not None:
            out[label] = v
    return out


# ---------- 계산 ----------

def eok(v):
    return round(v / EOK) if v is not None else None


def pct(a, b):
    return round(a / b * 100, 1) if a is not None and b not in (None, 0) else None


def growth(cur, prev):
    if cur is None or prev in (None, 0) or prev < 0:
        return None
    return round((cur - prev) / prev * 100, 1)


def avg(a, b):
    return (a + b) / 2 if a is not None and b is not None else None


def compute_ratios(fy: dict, years: list) -> dict:
    def g(y, k):
        return fy.get(y, {}).get(k)

    keys = ["유동비율", "부채비율", "차입금의존도", "영업이익률", "총자본순이익률", "매출액순이익률",
            "총자산증가율", "매출액증가율", "유형자산증가율", "매출채권회전율", "매입채무회전율"]
    values = {k: [] for k in keys}
    # 차입금 계정이 한 해도 없으면 무차입(0%)으로, 일부 연도만 비어 있으면 그 해는 알 수 없음으로 본다
    no_borrowing = not any("차입금" in v for v in fy.values())
    for y in years:
        values["유동비율"].append(pct(g(y, "유동자산"), g(y, "유동부채")))
        values["부채비율"].append(pct(g(y, "부채총계"), g(y, "자본총계")))
        borrowing = 0 if no_borrowing else g(y, "차입금")
        values["차입금의존도"].append(pct(borrowing, g(y, "총자산")))
        values["영업이익률"].append(pct(g(y, "영업이익"), g(y, "매출액")))
        values["총자본순이익률"].append(pct(g(y, "당기순이익"), avg(g(y, "총자산"), g(y - 1, "총자산"))))
        values["매출액순이익률"].append(pct(g(y, "당기순이익"), g(y, "매출액")))
        values["총자산증가율"].append(growth(g(y, "총자산"), g(y - 1, "총자산")))
        values["매출액증가율"].append(growth(g(y, "매출액"), g(y - 1, "매출액")))
        values["유형자산증가율"].append(growth(g(y, "유형자산"), g(y - 1, "유형자산")))
        ar = avg(g(y, "매출채권"), g(y - 1, "매출채권"))
        ap = avg(g(y, "매입채무"), g(y - 1, "매입채무"))
        values["매출채권회전율"].append(round(g(y, "매출액") / ar, 1) if g(y, "매출액") and ar else None)
        values["매입채무회전율"].append(round(g(y, "매출원가") / ap, 1) if g(y, "매출원가") and ap else None)
    return values


def ratio_status(values: dict) -> dict:
    """절대 기준이 있는 지표만 판정한다. 나머지는 업종평균이 있어야 판정할 수 있다."""
    def last(k):
        return values[k][-1]

    status = {}
    if last("유동비율") is not None:
        status["유동비율"] = "양호" if last("유동비율") >= 100 else "미흡"
    if last("부채비율") is not None:
        v = last("부채비율")
        status["부채비율"] = "양호" if v <= 200 else ("과다" if v >= 300 else "보통")
    if last("차입금의존도") is not None:
        status["차입금의존도"] = "안정" if last("차입금의존도") <= 30 else "주의"
    if last("매출채권회전율") is not None:
        status["매출채권회전율"] = "양호" if last("매출채권회전율") >= 4 else "미흡"
    return status


def yy(year) -> str:
    return f"'{str(year)[2:]}년"


def change_word(rate, up="증가", down="감소"):
    return up if rate >= 0 else down


def pl_phrase(label, cur, prev, unit_cur):
    """손익 항목 서술 조각. 적자 전환 등은 증감률 대신 상태로 쓴다."""
    if cur is None or prev is None:
        return None
    if prev <= 0 < cur:
        return f"{label}은 흑자전환하여 {unit_cur:,}억원을 기록"
    if cur <= 0 < prev:
        return f"{label}은 적자전환하여 {abs(unit_cur):,}억원의 손실을 기록"
    if cur <= 0 and prev <= 0:
        return f"{label}은 {abs(unit_cur):,}억원의 손실로 적자가 지속"
    rate = growth(cur, prev)
    return f"{label}은 전년 대비 {abs(rate)}% {change_word(rate)}한 {unit_cur:,}억원을 기록"


def finance_text(fy: dict, y: int) -> list:
    cur, prev = fy.get(y, {}), fy.get(y - 1, {})
    lines = []
    ta, ta0 = cur.get("총자산"), prev.get("총자산")
    d, d0, e, e0 = cur.get("부채총계"), prev.get("부채총계"), cur.get("자본총계"), prev.get("자본총계")
    if ta and ta0:
        r = growth(ta, ta0)
        s = f"{yy(y)} 총자산은 {eok(ta):,}억원으로 전년 대비 {abs(r)}% {change_word(r)}하였으며, "
        dr, er = growth(d, d0), growth(e, e0)
        if dr is not None and er is not None:
            if dr < 0 <= er:
                s += f"부채총계는 {abs(dr)}% 감소한 반면 자본총계는 {er}% 증가하여 재무구조가 개선됨"
            elif er > dr:
                s += f"자본 증가율({er}%)이 부채 증가율({dr}%)을 상회하여 재무안정성이 개선됨"
            else:
                s += f"부채 증가율({dr}%)이 자본 증가율({er}%)을 상회함"
        else:
            s = s.rstrip(", ") + "함"
        lines.append(s)

    sales = pl_phrase("매출액", cur.get("매출액"), prev.get("매출액"), eok(cur.get("매출액")) or 0)
    op = pl_phrase("영업이익", cur.get("영업이익"), prev.get("영업이익"), eok(cur.get("영업이익")) or 0)
    if sales and op:
        op_up = (cur["영업이익"] or 0) >= (prev["영업이익"] or 0)
        lines.append(f"{yy(y)} {sales}하였고, {op}하여 수익성이 {'개선됨' if op_up else '둔화됨'}")
    net = pl_phrase("당기순이익", cur.get("당기순이익"), prev.get("당기순이익"), eok(cur.get("당기순이익")) or 0)
    if net:
        lines.append(net + "함")
    return lines


def quarter_text(cur: dict, prev: dict, label: str, year: int) -> list:
    lines = []
    dr, er = growth(cur.get("부채총계"), prev.get("부채총계")), growth(cur.get("자본총계"), prev.get("자본총계"))
    if dr is not None and er is not None:
        lines.append(f"{yy(year)} {label} 부채총계는 전년 동기 대비 {abs(dr)}% {change_word(dr)}하고 "
                     f"자본총계는 {abs(er)}% {change_word(er)}함")
    sales = pl_phrase("매출액", cur.get("매출액"), prev.get("매출액"), eok(cur.get("매출액")) or 0)
    op = pl_phrase("영업이익", cur.get("영업이익"), prev.get("영업이익"), eok(cur.get("영업이익")) or 0)
    if sales and op:
        lines.append(f"{yy(year)} {label} {sales.replace('전년 대비', '전년 동기 대비')}하였고, "
                     f"{op.replace('전년 대비', '전년 동기 대비')}함")
    net = pl_phrase("당기순이익", cur.get("당기순이익"), prev.get("당기순이익"), eok(cur.get("당기순이익")) or 0)
    if net:
        lines.append(net.replace("전년 대비", "전년 동기 대비") + "함")
    return lines


def ratio_text(values: dict, status: dict, y: int) -> list:
    def last(k):
        return values[k][-1]

    def prev(k):
        return values[k][-2]

    lines = []
    parts = [f"{k} {last(k):,}%" for k in ("유동비율", "부채비율", "차입금의존도") if last(k) is not None]
    if parts:
        weak = [k for k in ("유동비율", "부채비율", "차입금의존도") if status.get(k) not in (None, "양호", "안정")]
        tail = "재무 안정성이 양호한 수준임" if not weak else f"{', '.join(weak)} 관리가 필요함"
        lines.append(f"{yy(y)} {', '.join(parts)}로 {tail}")
    if last("영업이익률") is not None and last("매출액순이익률") is not None:
        s = f"영업이익률 {last('영업이익률')}%, 매출액순이익률 {last('매출액순이익률')}%를 기록하였으며"
        if prev("영업이익률") is not None:
            s += f", 전년 대비 수익성이 {'개선됨' if last('영업이익률') >= prev('영업이익률') else '둔화됨'}"
        else:
            s += "함"
        lines.append(s)
    if last("총자산증가율") is not None and last("매출액증가율") is not None:
        lines.append(f"총자산 증가율 {last('총자산증가율')}%, 매출액 증가율 {last('매출액증가율')}%를 기록함")
    return lines


# ---------- 기타 항목 ----------

def fetch_ceo(api_key, corp_code, year, ceo_names: str) -> dict:
    data = call(api_key, "exctvSttus", corp_code=corp_code, bsns_year=str(year), reprt_code=ANNUAL)
    first = re.split(r"[,\s/]", ceo_names or "")[0]
    for r in (data or {}).get("list", []):
        if first and squash(r.get("nm")) == squash(first):
            m = re.search(r"(\d{4})", r.get("birth_ym") or "")
            career = [c.strip(" -·") for c in re.split(r"[\n\r]+|<br\s*/?>", r.get("main_career") or "") if c.strip(" -·")]
            return {"birth_year": int(m.group(1)) if m else None, "career": career[:5], "position": r.get("ofcps", "")}
    return {}


def fetch_shareholders(api_key, corp_code, year) -> dict:
    data = call(api_key, "hyslrSttus", corp_code=corp_code, bsns_year=str(year), reprt_code=ANNUAL)
    rows = [r for r in (data or {}).get("list", []) if "보통" in (r.get("stock_knd") or "보통")]
    people, total = [], None
    for r in rows:
        name, ratio = (r.get("nm") or "").strip(), r.get("trmend_posesn_stock_qota_rt")
        if name in ("계", "합계"):
            total = ratio
        elif name:
            people.append({"name": name, "relation": r.get("relate", ""), "ratio": ratio})
    people.sort(key=lambda p: float(re.sub(r"[^\d.]", "", p["ratio"] or "0") or 0), reverse=True)
    return {"top": people[:3], "total": total}


def fetch_employees(api_key, corp_code, year) -> int | None:
    data = call(api_key, "empSttus", corp_code=corp_code, bsns_year=str(year), reprt_code=ANNUAL)
    totals = [to_number(r.get("sm")) for r in (data or {}).get("list", [])]
    totals = [t for t in totals if t]
    return sum(totals) if totals else None


def fetch_shares(api_key, corp_code, year) -> int | None:
    data = call(api_key, "stockTotqySttus", corp_code=corp_code, bsns_year=str(year), reprt_code=ANNUAL)
    for r in (data or {}).get("list", []):
        if "보통" in (r.get("se") or ""):
            return to_number(r.get("istc_totqy"))
    return None


def fetch_price(stock_code: str, corp_cls: str) -> dict | None:
    suffix = {"Y": ".KS", "K": ".KQ"}.get(corp_cls)
    if not stock_code or not suffix:
        return None
    try:
        import yfinance as yf
        hist = yf.Ticker(stock_code + suffix).history(period="7d", timeout=10)
    except Exception as e:  # yfinance 는 네트워크·형식 오류를 다양한 예외로 던진다
        print(f"[price] {stock_code} 조회 실패: {e}")
        return None
    if hist.empty:
        return None
    return {"price": round(float(hist["Close"].iloc[-1])), "date": hist.index[-1].strftime("%Y-%m-%d")}


# ---------- 조립 ----------

def build_profile(api_key: str, corp_code: str) -> dict | None:
    company = call(api_key, "company", corp_code=corp_code)
    if not company:
        return None
    p = {k: company.get(k, "") for k in ("corp_name", "ceo_nm", "corp_cls", "stock_code", "est_dt", "acc_mt",
                                         "adres", "hm_url", "induty_code")}

    this_year = datetime.now().year
    fy, report_year = {}, None
    for year in (this_year - 1, this_year - 2):
        rows = statement_rows(api_key, corp_code, year, ANNUAL)
        if rows:
            report_year = year
            fy.update(annual_by_year(rows, year))
            older = statement_rows(api_key, corp_code, year - 1, ANNUAL)
            for y, vals in annual_by_year(older, year - 1).items():
                fy.setdefault(y, vals)  # 최신 보고서 값을 우선한다
            break

    if report_year:
        y = report_year
        perf_years = [y - 3, y - 2, y - 1, y]
        p["report_year"] = y
        p["performance"] = {
            "years": perf_years,
            "매출액": [eok(fy.get(v, {}).get("매출액")) for v in perf_years],
            "영업이익": [eok(fy.get(v, {}).get("영업이익")) for v in perf_years],
            "영업이익률": [pct(fy.get(v, {}).get("영업이익"), fy.get(v, {}).get("매출액")) for v in perf_years],
        }
        fin_years = [y - 2, y - 1, y]
        items = ["총자산", "부채총계", "자본총계", "매출액", "영업이익", "당기순이익"]
        p["financials"] = {
            "years": fin_years,
            "rows": {k: [eok(fy.get(v, {}).get(k)) for v in fin_years] for k in items},
            "yoy": {k: growth(fy.get(y, {}).get(k), fy.get(y - 1, {}).get(k)) for k in items},
            "text": finance_text(fy, y),
        }
        latest = fy.get(y, {})
        p["assets"] = {"total": eok(latest.get("총자산")), "debt": eok(latest.get("부채총계")),
                       "equity": eok(latest.get("자본총계")),
                       "debt_ratio": pct(latest.get("부채총계"), latest.get("자본총계"))}
        values = compute_ratios(fy, fin_years)
        status = ratio_status(values)
        p["ratios"] = {"years": fin_years, "values": values, "status": status, "text": ratio_text(values, status, y)}

        p["ceo"] = fetch_ceo(api_key, corp_code, y, p["ceo_nm"])
        p["shareholders"] = fetch_shareholders(api_key, corp_code, y)
        p["employees"] = {"count": fetch_employees(api_key, corp_code, y), "as_of": f"{yy(y)} 사업보고서"}

        price = fetch_price(p["stock_code"], p["corp_cls"])
        shares = fetch_shares(api_key, corp_code, y)
        if price and shares:
            p["market"] = {**price, "cap": eok(price["price"] * shares)}

        # 최근 분기 실적: 올해 가장 최근 분기보고서와 작년 같은 보고서를 비교
        for code, label in QUARTERLY:
            cur_rows = statement_rows(api_key, corp_code, this_year, code)
            if not cur_rows:
                continue
            cur, prev = quarter_values(cur_rows), quarter_values(statement_rows(api_key, corp_code, this_year - 1, code))
            if cur and prev:
                items = ["총자산", "부채총계", "자본총계", "매출액", "영업이익", "당기순이익"]
                p["quarter"] = {
                    "label": label, "years": [this_year - 1, this_year],
                    "rows": {k: [eok(prev.get(k)), eok(cur.get(k))] for k in items},
                    "yoy": {k: growth(cur.get(k), prev.get(k)) for k in items},
                    "text": quarter_text(cur, prev, label, this_year),
                }
            break
    return p


def load_corp_codes() -> list:
    # companies.js 의 ["회사명", "고유번호", ...] 줄에서 8자리 고유번호만 뽑는다
    return re.findall(r'\[\s*"[^"]+",\s*"(\d{8})"', COMPANIES_PATH.read_text(encoding="utf-8"))


TIME_BUDGET_SECONDS = 20 * 60  # 이 시간을 넘기면 모은 데이터까지만 저장한다


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)  # Actions 로그에 진행 상황이 바로 보이도록
    api_key = os.environ.get("DART_API_KEY")
    if not api_key:
        print("DART_API_KEY 환경변수가 없습니다.")
        return 1

    corp_codes = load_corp_codes()
    profiles, started = {}, time.monotonic()
    try:
        for i, corp_code in enumerate(corp_codes, 1):
            if time.monotonic() - started > TIME_BUDGET_SECONDS:
                print(f"시간 제한({TIME_BUDGET_SECONDS // 60}분)을 넘겨 {i - 1}개까지만 저장합니다.")
                break
            profile = build_profile(api_key, corp_code)
            if profile:
                profiles[corp_code] = profile
                print(f"[{i}/{len(corp_codes)}] {corp_code} {profile['corp_name']} "
                      f"(재무 {'있음' if 'financials' in profile else '없음'})")
            else:
                print(f"[{i}/{len(corp_codes)}] {corp_code} 개황 없음")
    except DartUnreachable as e:
        print(f"OpenDART 에 접속할 수 없어 중단합니다: {e}")

    if not profiles:
        print("받은 데이터가 없어 profiles.js 를 바꾸지 않습니다.")
        return 1

    updated = datetime.now().strftime("%Y-%m-%d")
    PROFILES_PATH.write_text(
        "// scripts/build_company_profiles.py 가 생성한 파일입니다. 직접 수정하지 마세요.\n"
        f"window.COMPANY_PROFILES = {json.dumps(profiles, ensure_ascii=False, indent=2)};\n"
        f'window.COMPANY_PROFILES_UPDATED = "{updated}";\n',
        encoding="utf-8",
    )
    print(f"{len(profiles)}개 기업 정보를 저장했습니다: {PROFILES_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
