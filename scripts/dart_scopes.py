"""DART 사업보고서에서 개별(OFS)·연결(CFS) 재무제표를 각각 조회해 회계기간 종료연도별 매출액·영업이익을 만든다(공통 수집기).
- 기업 한 곳의 개별·연결 각 3개년(종료연도 기준)을 별개 레코드로 돌려준다. 한쪽만 있어도 있는 것은 보존하고 나머지의 상태를 기록한다.
- 같은 연도를 두 보고서(당기 열 / 다음 해 보고서의 전기 열)에서 읽어 교차 검증한다. 다르면 재작성으로 보고 최신 보고서 값을 쓰고 MISMATCH 로 표시한다.
- 상태 구분: collection_status = COLLECTED / NO_DATA(DART 가 해당 기준 자료 없음: 연결 미작성·미공시 가능) / FAILED(조회 오류)
            verification_status = DART_CROSS_CHECKED / DART_SINGLE_REPORT / DART_RESTATED_MISMATCH (원문 교차 확인 전용, 사람의 원문 대조와는 별개)
- 금액은 원(KRW) 단위, 값이 없으면 빈 값. 영업이익은 일반 영업이익만(조정후 영업이익은 다루지 않는다)."""
from __future__ import annotations

import calendar
from datetime import date

import build_company_profiles as bcp

SCOPES = (("STANDALONE", "OFS"), ("CONSOLIDATED", "CFS"))


def _fetch(api_key: str, corp_code: str, bsns_year: int, fs_div: str):
    """(상태, 행 목록). 상태: 'ok' / 'nodata'(DART 013) / 'error'."""
    resp = bcp._get(bcp.DART_API.format("fnlttSinglAcntAll"), {"crtfc_key": api_key, "corp_code": corp_code, "bsns_year": str(bsns_year),
                                                              "reprt_code": bcp.ANNUAL, "fs_div": fs_div}, timeout=(5, 20))
    if resp is None:
        return "error", []
    try:
        data = resp.json()
    except ValueError:
        return "error", []
    st = data.get("status")
    if st == "000":
        return "ok", data.get("list", [])
    if st == "013":
        return "nodata", []
    return "error", []


def period_of(end_year: int, acc_mt) -> tuple[str, str]:
    """회계기간(시작일, 종료일). 결산월이 없으면 12월로 본다."""
    m = int(acc_mt) if acc_mt else 12
    end = date(end_year, m, calendar.monthrange(end_year, m)[1])
    start = date(end_year, 1, 1) if m == 12 else date(end_year - 1, m + 1, 1)
    return start.isoformat(), end.isoformat()


def collect_scopes(api_key: str, corp_code: str, this_year: int, acc_mt, fetch=_fetch, end_years=(2023, 2024, 2025)) -> list[dict]:
    """[{scope, fiscal_year, revenue_krw, op_income_krw, collection_status, verification_status, rcept_no, bsns_year, ...}] 를 돌려준다."""
    sh = 1 if acc_mt and int(acc_mt) != 12 else 0
    out = []
    for scope, fs_div in SCOPES:
        reps, stat = {}, {}
        for b in sorted({y - sh for y in end_years} | {max(y - sh for y in end_years) + 1}, reverse=True):  # 사업연도 b 보고서(당기 b, 전기 b-1)
            st, rows = fetch(api_key, corp_code, b, fs_div)
            stat[b] = st
            if rows:
                reps[b] = {"vals": bcp.annual_by_year(rows, b), "rcept": next((r.get("rcept_no") for r in rows if r.get("rcept_no")), ""),
                           "cur": next((r.get("currency") for r in rows if r.get("currency")), "KRW")}
        for y in end_years:
            b = y - sh
            own = reps.get(b, {}).get("vals", {}).get(b, {})
            nxt = reps.get(b + 1, {}).get("vals", {}).get(b, {})
            rec = {"scope": scope, "fiscal_year": y, "bsns_year": b, "revenue_krw": "", "op_income_krw": "", "rcept_no": "", "currency": "",
                   "collection_status": "", "verification_status": "", "note": ""}
            rec["fiscal_start_date"], rec["fiscal_end_date"] = period_of(y, acc_mt)
            src = own or nxt
            if not src:
                nd = all(stat.get(k) == "nodata" for k in (b, b + 1) if k in stat)
                rec["collection_status"] = "NO_DATA" if nd else "FAILED"
                rec["note"] = "DART 에 해당 기준(" + fs_div + ") 자료 없음(연결 미작성·미공시 가능, 확정 아님)" if nd else "조회 오류 또는 일부 보고서 없음"
                out.append(rec); continue
            rep = reps.get(b) if own else reps.get(b + 1)
            rec.update(revenue_krw=src.get("매출액", ""), op_income_krw=src.get("영업이익", ""), rcept_no=rep["rcept"], currency=rep["cur"],
                       collection_status="COLLECTED")
            if own and nxt:
                same = all(own.get(k) == nxt.get(k) for k in ("매출액", "영업이익") if k in own and k in nxt)
                rec["verification_status"] = "DART_CROSS_CHECKED" if same else "DART_RESTATED_MISMATCH"
                if not same:
                    rec["note"] = f"당기 열과 다음 해 보고서 전기 열 불일치(재작성 가능): {own.get('매출액')}/{own.get('영업이익')} vs {nxt.get('매출액')}/{nxt.get('영업이익')}"
            else:
                rec["verification_status"] = "DART_SINGLE_REPORT"
            if rec["revenue_krw"] == "" or rec["op_income_krw"] == "":
                rec["note"] = (rec["note"] + " 매출액 또는 영업이익 항목을 찾지 못함").strip()
            out.append(rec)
    return out
