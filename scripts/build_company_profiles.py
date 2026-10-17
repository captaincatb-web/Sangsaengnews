"""OpenDART API와 주가 데이터로 지정 기업 프로필 데이터(site/data/profiles.js)를 만든다.

사용법: DART_API_KEY 환경변수를 설정한 뒤 `python scripts/build_company_profiles.py`

재무 데이터 출처 (앞에서부터 시도):
  1. 사업보고서 재무제표 API (사업보고서 제출 대상, 주로 상장사)
  2. 감사보고서 원문에서 재무제표 표를 읽어 추출 (외부감사 대상 비상장사)
  3. 분기·반기보고서 재무제표 API (최근 분기 실적)

연혁·사업장·회계기준은 사업보고서(없으면 감사보고서) 원문에서, 주요 특징은 최근 공시·뉴스에서 고른다.

- 재무는 개별(별도) 기준이 기본이다.
- 신용등급·업종평균·거래금액·거래비중처럼 외부에서 알 수 없는 값은 만들지 않는다(화면에서 확인필요/XXX로 표시).
"""
import html
import io
import json
import os
import re
import sys
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import requests

from company_highlights import collect_highlights
from dart_documents import audit_overview, business_overview, merge_sites, shorten_address

ROOT_DIR = Path(__file__).resolve().parent.parent
COMPANIES_PATH = ROOT_DIR / "site" / "data" / "companies.js"
PROFILES_PATH = ROOT_DIR / "site" / "data" / "profiles.js"
DART_API = "https://opendart.fss.or.kr/api/{}.json"
DART_DOCUMENT = "https://opendart.fss.or.kr/api/document.xml"
ANNUAL = "11011"
QUARTERLY = [("11014", "3분기"), ("11012", "반기"), ("11013", "1분기")]
EOK = 100_000_000
WORKERS = 4  # 동시에 조회하는 기업 수
TIME_BUDGET_SECONDS = 35 * 60  # 이 시간을 넘기면 남은 기업은 건너뛴다

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
FIN_ITEMS = ["총자산", "부채총계", "자본총계", "매출액", "영업이익", "당기순이익"]


# ---------- DART 호출 ----------

class DartUnreachable(Exception):
    pass


_failures = {"count": 0}
_failures_lock = threading.Lock()
MAX_NETWORK_FAILURES = 8  # 연속 접속 실패가 이만큼이면 DART 에 닿지 않는 것으로 보고 중단


def _record(ok: bool, err: Exception | None = None):
    with _failures_lock:
        _failures["count"] = 0 if ok else _failures["count"] + 1
        if _failures["count"] >= MAX_NETWORK_FAILURES:
            raise DartUnreachable(str(err))


def _get(url: str, params: dict, timeout=(5, 20)) -> requests.Response | None:
    try:
        resp = requests.get(url, params=params, timeout=timeout)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"[dart] {url.rsplit('/', 1)[-1]} 접속 실패: {e}")
        _record(False, e)
        return None
    finally:
        time.sleep(0.1)  # OpenDART 요청 한도 보호
    _record(True)
    return resp


def call(api_key: str, endpoint: str, **params) -> dict | None:
    resp = _get(DART_API.format(endpoint), {"crtfc_key": api_key, **params}, timeout=(5, 10))
    if resp is None:
        return None
    try:
        data = resp.json()
    except ValueError as e:
        print(f"[dart] {endpoint} 응답 해석 실패: {e}")
        return None
    if data.get("status") == "013":  # 조회된 데이터 없음
        return None
    if data.get("status") != "000":
        print(f"[dart] {endpoint} {params.get('corp_code', '')} 응답 오류: {data.get('message')}")
        return None
    return data


# ---------- 공통 변환 ----------

def to_number(text) -> int | None:
    cleaned = re.sub(r"[^\d-]", "", str(text or ""))
    return int(cleaned) if cleaned not in ("", "-") else None


def to_float(text) -> float | None:
    m = re.search(r"-?\d+(\.\d+)?", str(text or "").replace(",", ""))
    return float(m.group()) if m else None


def squash(name: str) -> str:
    return re.sub(r"\s", "", name or "")


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


def yy(year) -> str:
    return f"'{str(year)[2:]}년"


# ---------- 재무제표: 사업·분기보고서 API ----------

# 계정 표준 코드(XBRL). 회사마다 표시 이름이 달라도 이 코드는 같아서 먼저 찾는다.
ACCOUNT_IDS = {
    "총자산": ["ifrs-full_Assets", "ifrs_Assets"],
    "유동자산": ["ifrs-full_CurrentAssets", "ifrs_CurrentAssets"],
    "부채총계": ["ifrs-full_Liabilities", "ifrs_Liabilities"],
    "유동부채": ["ifrs-full_CurrentLiabilities", "ifrs_CurrentLiabilities"],
    "자본총계": ["ifrs-full_Equity", "ifrs_Equity"],
    "매출액": ["ifrs-full_Revenue", "ifrs_Revenue"],
    "매출원가": ["ifrs-full_CostOfSales", "ifrs_CostOfSales"],
    "영업이익": ["dart_OperatingIncomeLoss"],
    "당기순이익": ["ifrs-full_ProfitLoss", "ifrs_ProfitLoss"],
}


def find_row(rows: list, sj_divs: tuple, names: list, label: str = "") -> dict | None:
    for account_id in ACCOUNT_IDS.get(label, []):
        for r in rows:
            if r.get("sj_div") in sj_divs and r.get("account_id") == account_id:
                return r
    # 이름 비교는 'Ⅰ.', '(주석3)' 같은 꾸밈을 떼고 한다
    for name in names:
        for r in rows:
            if r.get("sj_div") in sj_divs and normalize_label(r.get("account_nm")) == squash(name):
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
        row = find_row(rows, sj_divs, names, label)
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
        row = find_row(rows, sj_divs, names, label)
        if not row:
            continue
        v = to_number(row.get("thstrm_add_amount")) if sj_divs != ("BS",) else None
        v = v if v is not None else to_number(row.get("thstrm_amount"))
        if v is not None:
            out[label] = v
    if rows and "매출액" not in out:
        names = sorted({r.get("account_nm", "") for r in rows if r.get("sj_div") in ("IS", "CIS")})[:15]
        print(f"[quarter] 매출액 계정을 찾지 못함. 손익 계정 예: {names}")
    return out


# ---------- 재무제표: 감사보고서 원문 ----------

CELL_RE = re.compile(r"<(T[DHEU])\b[^>]*>(.*?)</\1>", re.S | re.I)
UNIT_RE = re.compile(r"단위\s*[:：]?\s*(백만원|천원|원)")
NOTE_RE = re.compile(r"^\d{1,2}(\s*,\s*\d{1,2})*$")  # 주석 번호 칸(예: 4, 12,13)
UNIT_FACTOR = {"원": 1, "천원": 1_000, "백만원": 1_000_000}
AUDIT_NAMES = {squash(n): label for label, _, names in ACCOUNTS for n in names}


def clean_cell(raw: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", raw)).strip()


def normalize_label(text: str) -> str:
    t = squash(text)
    t = re.sub(r"^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]+[.．]?", "", t)
    t = re.sub(r"^(\(?\d{1,2}[.)．]|[IVX]{1,4}[.．])", "", t)
    t = re.sub(r"\(주석[^)]*\)|\(주\d[^)]*\)", "", t)
    return t.replace("·", "").replace("ㆍ", "")


def parse_amount(text: str) -> int | None:
    t = text.replace(" ", "")
    if not t or t in ("-", "–") or NOTE_RE.match(t):
        return None
    neg = t.startswith("(") and t.endswith(")") or t.startswith("△") or t.startswith("-")
    digits = re.sub(r"[^\d]", "", t)
    if not digits:
        return None
    v = int(digits)
    return -v if neg else v


def parse_audit_statements(doc: str) -> tuple[dict, dict]:
    """감사보고서 원문(XML/HTML)에서 당기·전기 주요 계정을 읽는다. 표마다 단위를 찾아 원으로 환산한다."""
    cur, prev, borrow_cur, borrow_prev = {}, {}, [], []
    for m in re.finditer(r"<TABLE\b.*?</TABLE>", doc, re.S | re.I):
        table = m.group(0)
        context = clean_cell(doc[max(0, m.start() - 600):m.start()]) + clean_cell(table[:600])
        units = UNIT_RE.findall(context)
        factor = UNIT_FACTOR[units[-1]] if units else 1
        rows = []
        for tr in re.findall(r"<TR\b.*?</TR>", table, re.S | re.I):
            cells = [clean_cell(c[1]) for c in CELL_RE.findall(tr)]
            if len(cells) >= 2:
                rows.append((normalize_label(cells[0]), cells[1:]))
        # 차입금은 재무상태표에서만 센다 (현금흐름표의 '차입금의 상환', 주석의 차입금 명세는 제외)
        is_bs = any(label in ("자산총계", "부채총계") for label, _ in rows)
        for label, rest in rows:
            nums = [n for n in (parse_amount(c) for c in rest) if n is not None]
            if not nums:
                continue
            key = AUDIT_NAMES.get(label)
            if key and key not in cur:
                cur[key] = nums[0] * factor
                if len(nums) > 1:
                    prev[key] = nums[1] * factor
            elif is_bs and is_borrowing(label) and len(label) <= 12:
                borrow_cur.append(nums[0] * factor)
                if len(nums) > 1:
                    borrow_prev.append(nums[1] * factor)
    if cur:
        cur["차입금"] = sum(borrow_cur)
        if prev:
            prev["차입금"] = sum(borrow_prev)
    # 단위 표기를 못 찾아 원으로 읽었는데 자산이 10억 미만이면 천원 단위로 본다
    if cur.get("총자산") and cur["총자산"] < 1_000_000_000:
        print(f"[audit] 자산총계 {cur['총자산']:,} 가 너무 작아 천원 단위로 보정합니다.")
        cur = {k: v * 1000 for k, v in cur.items()}
        prev = {k: v * 1000 for k, v in prev.items()}
    return cur, prev


def fetch_document_text(api_key: str, rcept_no: str) -> str:
    resp = _get(DART_DOCUMENT, {"crtfc_key": api_key, "rcept_no": rcept_no})
    if resp is None:
        return ""
    try:
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            parts = []
            for name in zf.namelist():
                raw = zf.read(name)
                for enc in ("utf-8", "cp949"):
                    try:
                        parts.append(raw.decode(enc))
                        break
                    except UnicodeDecodeError:
                        continue
            return "\n".join(parts)
    except zipfile.BadZipFile:
        print(f"[document] {rcept_no} 원문을 열 수 없습니다: {resp.text[:120]}")
        return ""


def list_filings(api_key: str, corp_code: str, years_back: int, **params) -> list:
    today = datetime.now()
    data = call(api_key, "list", corp_code=corp_code, bgn_de=f"{today.year - years_back}0101",
                end_de=today.strftime("%Y%m%d"), page_count="100", **params)
    return (data or {}).get("list", [])


def audit_financials(api_key: str, corp_code: str) -> tuple[dict, list, dict]:
    """최근 감사보고서(개별) 최대 3건에서 연도별 재무를 만든다. 감사인 목록과 최근 보고서의 회사 개요도 돌려준다."""
    filings = list_filings(api_key, corp_code, 5, pblntf_ty="F")
    by_year = {}
    for f in filings:  # 최신 접수순이므로 연도별 첫 건(정정 포함 최신)을 쓴다
        name = f.get("report_nm", "")
        m = re.search(r"\((\d{4})\.(\d{2})\)", name)
        if "감사보고서" in name and "연결" not in name and m:
            # 사업연도는 시작한 해로 부른다: 12월 결산이 아니면 (2026.03) 은 '25.4~'26.3 이므로 2025년
            year = int(m.group(1)) - (0 if m.group(2) == "12" else 1)
            by_year.setdefault(year, f)
    fy, auditors, overview = {}, [], {}
    for year in sorted(by_year, reverse=True)[:3]:
        f = by_year[year]
        auditors.append({"year": year, "auditor": f.get("flr_nm", ""), "rcept_no": f.get("rcept_no")})
        doc = fetch_document_text(api_key, f["rcept_no"])
        if doc and not overview:
            overview = read_overview(audit_overview, doc, f["rcept_no"])
        cur, prev = parse_audit_statements(doc)
        if cur:
            fy.setdefault(year, cur)
        if prev:
            fy.setdefault(year - 1, prev)
    return fy, auditors, overview


def read_overview(parse, doc: str, rcept_no: str) -> dict:
    """원문 형식이 예상과 달라 읽다가 오류가 나도 그 항목만 비우고 나머지 수집은 계속한다."""
    try:
        return parse(doc) if doc else {}
    except Exception as e:  # 회사마다 원문 형식이 달라 어떤 오류가 날지 미리 알 수 없다
        print(f"[document] {rcept_no} 개요를 읽지 못함: {e}")
        return {}


def business_report_overview(api_key: str, corp_code: str) -> dict:
    """가장 최근 사업보고서 원문에서 연혁·사업장·회계기준을 읽는다."""
    for f in list_filings(api_key, corp_code, 2, pblntf_ty="A"):
        if "사업보고서" in f.get("report_nm", ""):
            doc = fetch_document_text(api_key, f["rcept_no"])
            info = read_overview(business_overview, doc, f["rcept_no"])
            if doc and not info.get("history"):  # 연혁 형식을 보완할 수 있도록 앞부분을 남긴다
                m = re.search(r"<TITLE[^>]*>[^<]*회사의\s*연혁.{0,600}", doc, re.S)
                snippet = re.sub(r"\s+", " ", m.group(0)) if m else "제목 없음"
                print(f"[history] {corp_code} 연혁을 찾지 못함: {snippet}")
            return info
    return {}


# ---------- 계산·서술 ----------

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


# ---------- 사업보고서 부가 항목 ----------

def fetch_executives(api_key, corp_code, year) -> list:
    data = call(api_key, "exctvSttus", corp_code=corp_code, bsns_year=str(year), reprt_code=ANNUAL)
    out = []
    for r in (data or {}).get("list", []):
        m = re.search(r"(\d{4})", r.get("birth_ym") or "")
        career = [c.strip(" -·") for c in re.split(r"[\n\r]+|<br\s*/?>", r.get("main_career") or "") if c.strip(" -·")]
        out.append({"name": (r.get("nm") or "").strip(), "birth_year": int(m.group(1)) if m else None,
                    "position": r.get("ofcps", ""), "registered": r.get("rgist_exctv_at", ""),
                    "fulltime": r.get("fte_at", ""), "duty": r.get("chrg_job", ""), "career": career[:6],
                    "relate": (r.get("mxmm_shrholdr_relate") or "").strip()})
    return out


def find_ceo(executives: list, ceo_names: str) -> dict:
    first = re.split(r"[,\s/]", ceo_names or "")[0]
    for e in executives:
        if first and squash(e["name"]) == squash(first):
            return {"birth_year": e["birth_year"], "career": e["career"], "position": e["position"]}
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
    people.sort(key=lambda p: to_float(p["ratio"]) or 0, reverse=True)
    return {"top": people[:5], "total": total}


def fetch_employees(api_key, corp_code, year) -> dict:
    data = call(api_key, "empSttus", corp_code=corp_code, bsns_year=str(year), reprt_code=ANNUAL)
    rows = (data or {}).get("list", [])
    counts = [(to_number(r.get("sm")) or 0, r) for r in rows]
    total = sum(c for c, _ in counts)
    if not total:
        return {}
    tenure = sum(c * (to_float(r.get("avrg_cnwk_sdytrn")) or 0) for c, r in counts) / total
    salary = sum(c * (to_number(r.get("jan_salary_am")) or 0) for c, r in counts) / total
    return {"count": total, "as_of": f"{yy(year)} 사업보고서",
            "avg_tenure": round(tenure, 1) if tenure else None,
            "avg_salary_man": round(salary / 10_000) if salary else None}


def fetch_shares(api_key, corp_code, year) -> int | None:
    data = call(api_key, "stockTotqySttus", corp_code=corp_code, bsns_year=str(year), reprt_code=ANNUAL)
    for r in (data or {}).get("list", []):
        if "보통" in (r.get("se") or ""):
            return to_number(r.get("istc_totqy"))
    return None


def fetch_audit_opinions(api_key, corp_code, year) -> list:
    data = call(api_key, "accnutAdtorNmNdAdtOpinion", corp_code=corp_code, bsns_year=str(year), reprt_code=ANNUAL)
    out = []
    for r in (data or {}).get("list", []):
        row = {"period": r.get("bsns_year", ""), "auditor": r.get("adtor", ""), "opinion": r.get("adt_opinion", "")}
        if row["auditor"] and row not in out:
            out.append(row)
    return out[:3]


def fetch_dividends(api_key, corp_code, year) -> list:
    data = call(api_key, "alotMatter", corp_code=corp_code, bsns_year=str(year), reprt_code=ANNUAL)
    out = []
    for r in (data or {}).get("list", []):
        se = r.get("se", "")
        if ("주당 현금배당금" in se and "보통" in (r.get("stock_knd") or "")) or "현금배당성향" in se:
            out.append({"item": se.strip(), "values": [r.get("lwfr", ""), r.get("frmtrm", ""), r.get("thstrm", "")]})
    return out


def fetch_investments(api_key, corp_code, year) -> list:
    data = call(api_key, "otrCprInvstmntSttus", corp_code=corp_code, bsns_year=str(year), reprt_code=ANNUAL)
    out = []
    for r in (data or {}).get("list", []):
        name = (r.get("inv_prm") or "").strip()
        if not name or name in ("합계", "계"):
            continue
        out.append({"name": name, "purpose": r.get("invstmnt_purps", ""),
                    "ratio": to_float(r.get("trmend_blce_qota_rt")),
                    "book_eok": eok(to_number(r.get("trmend_blce_acntbk_amount")))})
    out.sort(key=lambda x: x["book_eok"] or 0, reverse=True)
    return out[:8]


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


def recent_filings(filings: list) -> list:
    return [{"date": f.get("rcept_dt", ""), "title": re.sub(r"\s+", " ", f.get("report_nm", "")).strip(),
             "filer": f.get("flr_nm", ""), "rcept_no": f.get("rcept_no", "")}
            for f in filings[:10]]


# ---------- 조립 ----------

def financial_sections(p: dict, fy: dict, y: int):
    perf_years = [y - 3, y - 2, y - 1, y]
    p["performance"] = {
        "years": perf_years,
        "매출액": [eok(fy.get(v, {}).get("매출액")) for v in perf_years],
        "영업이익": [eok(fy.get(v, {}).get("영업이익")) for v in perf_years],
        "영업이익률": [pct(fy.get(v, {}).get("영업이익"), fy.get(v, {}).get("매출액")) for v in perf_years],
    }
    fin_years = [y - 2, y - 1, y]
    p["financials"] = {
        "years": fin_years,
        "rows": {k: [eok(fy.get(v, {}).get(k)) for v in fin_years] for k in FIN_ITEMS},
        "yoy": {k: growth(fy.get(y, {}).get(k), fy.get(y - 1, {}).get(k)) for k in FIN_ITEMS},
        "text": finance_text(fy, y),
    }
    latest = fy.get(y, {})
    p["assets"] = {"total": eok(latest.get("총자산")), "debt": eok(latest.get("부채총계")),
                   "equity": eok(latest.get("자본총계")),
                   "debt_ratio": pct(latest.get("부채총계"), latest.get("자본총계"))}
    values = compute_ratios(fy, fin_years)
    status = ratio_status(values)
    p["ratios"] = {"years": fin_years, "values": values, "status": status, "text": ratio_text(values, status, y)}


def build_profile(api_key: str, corp_code: str, names: list = ()) -> dict | None:
    company = call(api_key, "company", corp_code=corp_code)
    if not company:
        return None
    p = {k: company.get(k, "") for k in ("corp_name", "corp_name_eng", "stock_name", "ceo_nm", "corp_cls",
                                         "stock_code", "jurir_no", "bizr_no", "est_dt", "acc_mt", "adres",
                                         "hm_url", "ir_url", "phn_no", "fax_no", "induty_code")}
    this_year = datetime.now().year

    # 1) 사업보고서
    fy, report_year, overview = {}, None, {}
    for year in (this_year - 1, this_year - 2):
        rows = statement_rows(api_key, corp_code, year, ANNUAL)
        if rows:
            report_year = year
            fy.update(annual_by_year(rows, year))
            for y, vals in annual_by_year(statement_rows(api_key, corp_code, year - 1, ANNUAL), year - 1).items():
                fy.setdefault(y, vals)  # 최신 보고서 값을 우선한다
            break

    if report_year:
        p["fin_source"] = "annual"
        y = report_year
        executives = fetch_executives(api_key, corp_code, y)
        p["executives"] = executives
        p["ceo"] = find_ceo(executives, p["ceo_nm"])
        p["shareholders"] = fetch_shareholders(api_key, corp_code, y)
        p["employees"] = fetch_employees(api_key, corp_code, y)
        p["audit"] = fetch_audit_opinions(api_key, corp_code, y)
        p["dividends"] = fetch_dividends(api_key, corp_code, y)
        p["investments"] = fetch_investments(api_key, corp_code, y)
        price = fetch_price(p["stock_code"], p["corp_cls"])
        shares = fetch_shares(api_key, corp_code, y)
        if price and shares:
            p["market"] = {**price, "cap": eok(price["price"] * shares), "shares": shares}
        overview = business_report_overview(api_key, corp_code)
    else:
        # 2) 감사보고서 원문 (외부감사 대상 비상장사)
        audit_fy, auditors, overview = audit_financials(api_key, corp_code)
        if auditors:
            p["audit"] = [{"period": f"{a['year']}년", "auditor": a["auditor"], "opinion": "",
                           "rcept_no": a["rcept_no"]} for a in auditors]
        years = sorted(y for y, v in audit_fy.items() if v.get("총자산"))
        if years:
            fy, report_year = audit_fy, years[-1]
            p["fin_source"] = "audit"

    if report_year:
        p["report_year"] = report_year
        financial_sections(p, fy, report_year)

    # 연혁·사업장·회계기준: 본사는 회사 개황 주소를 기준으로 하고 원문의 사업장을 더한다
    p["history"] = overview.get("history", [])
    if overview.get("shareholders") and not p.get("shareholders"):  # 비상장사: 감사보고서 주주 현황
        p["shareholders"] = {"top": overview["shareholders"], "total": None, "source": "감사보고서"}
    home = [(shorten_address(p["adres"]), "본사")] if p["adres"] else []
    p["sites"] = merge_sites(home + overview.get("sites", []))
    p["standard"] = overview.get("standard") or ("K-IFRS" if p.get("fin_source") == "annual" else "")

    # 3) 최근 분기·반기 실적: 올해 가장 최근 보고서와 작년 같은 보고서를 비교
    for code, label in QUARTERLY:
        cur_rows = statement_rows(api_key, corp_code, this_year, code)
        if not cur_rows:
            continue
        cur, prev = quarter_values(cur_rows), quarter_values(statement_rows(api_key, corp_code, this_year - 1, code))
        if cur and prev:
            p["quarter"] = {
                "label": label, "years": [this_year - 1, this_year],
                "rows": {k: [eok(prev.get(k)), eok(cur.get(k))] for k in FIN_ITEMS},
                "yoy": {k: growth(cur.get(k), prev.get(k)) for k in FIN_ITEMS},
                "debt_ratio": [pct(v.get("부채총계"), v.get("자본총계")) for v in (prev, cur)],
                "text": quarter_text(cur, prev, label, this_year),
            }
            p.setdefault("fin_source", "quarter")
        break

    filings = list_filings(api_key, corp_code, 1)
    p["filings"] = recent_filings(filings)

    # 4) 주요 특징: 최근 공시·뉴스에서 2~3건
    corp = re.sub(r"\(주\)|㈜|주식회사", "", p["corp_name"]).strip()
    try:
        p["highlights"] = collect_highlights([*names, p["stock_name"], corp], filings,
                                             lambda no: fetch_document_text(api_key, no))
    except DartUnreachable:
        raise
    except Exception as e:  # 뉴스·원문 형식이 예상과 달라도 프로필은 저장한다
        print(f"[highlights] {corp_code} 주요 특징을 만들지 못함: {e}")
    return p


def load_companies() -> dict:
    """companies.js 의 ["회사명", "고유번호", "종목코드", "비고"] 줄을 {고유번호: [뉴스 검색에 쓸 이름들]} 로 읽는다."""
    out = {}
    pattern = r'\[\s*"([^"]+)",\s*"(\d{8})",\s*"\d*"(?:,\s*"([^"]*)")?\s*\]'
    for name, corp_code, note in re.findall(pattern, COMPANIES_PATH.read_text(encoding="utf-8")):
        alias = re.match(r"DART 법인명\s+(.+)", note or "")  # 예: 글로벌스탠다드테크놀로지 → GST
        out[corp_code] = [name] + ([alias.group(1).strip()] if alias else [])
    return out


def print_review(profiles: dict, companies: dict):
    """회사마다 화면 항목이 채워졌는지 한 줄로 남긴다 (Actions 로그에서 빠진 곳을 찾기 위해)."""
    print("===== 항목 점검 =====")
    for code, p in profiles.items():
        ex = {e["name"].replace(" ", ""): e for e in p.get("executives", [])}
        ceos = [n for n in re.split(r"[,/·]", re.sub(r"\([^)]*\)|각자|공동|대표이사|대표", "", p.get("ceo_nm", ""))) if n.strip()]
        careers = sum(1 for n in ceos if ex.get(n.replace(" ", ""), {}).get("career"))
        sites = ";".join(f"{x['location']}({','.join(x['roles'])})" for x in p.get("sites", []))
        hist = " | ".join(f"{h.get('year') or ''} {h['text'][:40]}" for h in p.get("history", []))
        print(f"[점검] {companies.get(code, [code])[0]} | 출처 {p.get('fin_source', '-')} | 연혁 {len(p.get('history', []))} "
              f"| 대표 {len(ceos)}명/경력 {careers} | 주주 {len((p.get('shareholders') or {}).get('top', []))} "
              f"| 분기 {'O' if p.get('quarter') else 'X'} | 특징 {len(p.get('highlights', []))} | 사업장 {sites} | 연혁: {hist}")


def print_history_full(profiles: dict, companies: dict):
    """비상장사의 연혁 원문 전체를 로그에 남긴다 (문장 형태를 점검하기 위해)."""
    print("===== 비상장 연혁 전문 =====")
    for code, p in profiles.items():
        if p.get("stock_code"):
            continue
        print(f"[연혁전문] {companies.get(code, [code])[0]} | 설립 {p.get('est_dt', '')}")
        for h in p.get("history", []):
            print(f"    - {h.get('year') or ''} {h.get('text', '')}")


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)  # Actions 로그에 진행 상황이 바로 보이도록
    api_key = os.environ.get("DART_API_KEY")
    if not api_key:
        print("DART_API_KEY 환경변수가 없습니다.")
        return 1

    companies = load_companies()
    corp_codes = list(companies)
    profiles, started, done = {}, time.monotonic(), [0]
    lock = threading.Lock()
    stop = threading.Event()

    def work(corp_code):
        if stop.is_set() or time.monotonic() - started > TIME_BUDGET_SECONDS:
            return
        try:
            profile = build_profile(api_key, corp_code, companies[corp_code])
        except DartUnreachable as e:
            if not stop.is_set():
                print(f"OpenDART 에 접속할 수 없어 중단합니다: {e}")
            stop.set()
            return
        with lock:
            done[0] += 1
            if profile:
                profiles[corp_code] = profile
                print(f"[{done[0]}/{len(corp_codes)}] {corp_code} {profile['corp_name']} "
                      f"(재무 출처: {profile.get('fin_source', '없음')})")
            else:
                print(f"[{done[0]}/{len(corp_codes)}] {corp_code} 개황 없음")

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        list(pool.map(work, corp_codes))

    if len(profiles) < len(corp_codes):
        print(f"{len(corp_codes) - len(profiles)}개 기업은 이번에 받지 못했습니다.")
    if not profiles:
        print("받은 데이터가 없어 profiles.js 를 바꾸지 않습니다.")
        return 1

    ordered = {c: profiles[c] for c in corp_codes if c in profiles}
    print_review(ordered, companies)
    print_history_full(ordered, companies)
    updated = datetime.now().strftime("%Y-%m-%d")
    PROFILES_PATH.write_text(
        "// scripts/build_company_profiles.py 가 생성한 파일입니다. 직접 수정하지 마세요.\n"
        f"window.COMPANY_PROFILES = {json.dumps(ordered, ensure_ascii=False, separators=(',', ':'))};\n"
        f'window.COMPANY_PROFILES_UPDATED = "{updated}";\n',
        encoding="utf-8",
    )
    print(f"{len(ordered)}개 기업 정보를 저장했습니다: {PROFILES_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
