"""협력사 명단 전체의 연간·분기 재무(매출액·영업이익·당기순이익)를 모아 site/data/financials.js 를 만든다.

대상: companies.js 의 1~3그룹(추가 기업 그룹 제외) + site/data/universe.js 의 협력사 명단.
  - 명단의 회사 이름은 DART 회사 목록(corpCode)에서 이름이 정확히 같은 회사로 찾는다.
    같은 이름이 여럿이면 상장사 하나일 때만 고르고, 못 찾거나 모호하면 건너뛰고 로그에 남긴다.
  - 연간: 사업보고서 재무제표(개별) → 없으면 감사보고서 원문(외부감사 대상 비상장사).
  - 분기: 상장사만. 1분기·반기·3분기 보고서의 누적 금액을 빼서 3개월 값으로 바꾸고, 4분기는 연간 − 3분기 누적.
    최근 8개 분기를 담는다. 비상장사는 분기보고서가 없어 연간만 있다.

사용법: DART_API_KEY 환경변수를 설정한 뒤 `python scripts/build_financials.py`
"""
import io
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import requests

import build_company_profiles as bcp

ROOT_DIR = Path(__file__).resolve().parent.parent
COMPANIES_PATH = ROOT_DIR / "site" / "data" / "companies.js"
UNIVERSE_PATH = ROOT_DIR / "site" / "data" / "universe.js"
OUT_PATH = ROOT_DIR / "site" / "data" / "financials.js"
CORP_CODE_URL = "https://opendart.fss.or.kr/api/corpCode.xml"
BASE_GROUPS = ("g1", "g2", "g3")
TIME_BUDGET_SECONDS = 40 * 60
QUARTER_CODES = [("11013", 1), ("11012", 2), ("11014", 3), ("11011", 4)]
ITEMS = ("매출액", "영업이익", "당기순이익")
BS_ITEMS = ("총자산", "부채총계", "자본총계")  # 재무 안정성(부채비율)용, 같은 공시에서 함께 읽는다
PLANT_SUFFIX = re.compile(r"(천안\d?공장|\S*공장|\S*사업장|\S*지점|한국영업소|전자재료사업부지점)$")


def norm(name: str) -> str:
    s = re.sub(r"[(（][^)）]*[)）]", "", name or "")  # (주)·(유)·(천안2공장) 같은 괄호는 뗀다
    return re.sub(r"㈜|주식회사|유한회사|[\s().,·\-（）]", "", s).lower()


# 명단은 한글 표기, DART 는 영문 표기인 회사가 많아 앞부분을 바꿔 한 번 더 찾는다
ENGLISH = [("에스케이", "SK"), ("엘지", "LG"), ("오씨아이", "OCI"), ("에이치디", "HD"), ("케이씨", "KC"), ("에이피", "AP"),
           ("지에스", "GS"), ("케이피엑스", "KPX"), ("디엘", "DL"), ("에이치엘", "HL"), ("케이티", "KT"), ("씨제이", "CJ")]
ALIAS = {"글로벌스탠다드테크놀로지": "GST", "원익IPS": "원익아이피에스"}


def variants(name: str) -> list:
    base = [name, PLANT_SUFFIX.sub("", name).strip()]
    out = []
    for b in base:
        out.append(b)
        for ko, en in ENGLISH:
            if norm(b).startswith(ko):
                out.append(en + norm(b)[len(ko):])
    return [norm(v) for v in out if v]


# ---------- 대상 기업 ----------

def base_companies() -> dict:
    """companies.js 의 1~3그룹을 {고유번호: 이름} 으로 읽는다."""
    text = COMPANIES_PATH.read_text(encoding="utf-8")
    out = {}
    for block in re.split(r'\n\s*\{\s*\n\s*id:', text)[1:]:
        gid = re.match(r'\s*"([^"]+)"', block)
        if not gid or gid.group(1) not in BASE_GROUPS:
            continue
        for name, code in re.findall(r'\[\s*"([^"]+)",\s*"(\d{8})"', block):
            out[code] = name
    return out


def universe_names() -> list:
    """universe.js 의 [이름, 키, 사업장] 줄을 읽는다."""
    text = UNIVERSE_PATH.read_text(encoding="utf-8")
    body = text[text.index("window.COMPANY_UNIVERSE = ") + len("window.COMPANY_UNIVERSE = "):].rstrip().rstrip(";")
    return json.loads(body)


def load_corp_list(api_key: str) -> list:
    resp = requests.get(CORP_CODE_URL, params={"crtfc_key": api_key}, timeout=(10, 90))
    resp.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        root = ET.fromstring(zf.read(zf.namelist()[0]))
    return [{"corp_code": (e.findtext("corp_code") or "").strip(), "name": (e.findtext("corp_name") or "").strip(),
             "stock_code": (e.findtext("stock_code") or "").strip()} for e in root.iter("list")]


def resolve(entries: list, corps: list) -> tuple:
    """명단 → ({고유번호: (이름, 명단키)}, 못 찾은 이름들, 모호한 이름들)."""
    by_name = {}
    for c in corps:
        by_name.setdefault(norm(c["name"]), []).append(c)
    found, missing, ambiguous = {}, [], []
    for name, key, _sites in entries:
        hits = next((by_name[v] for v in variants(name) if v in by_name), [])
        listed = [c for c in hits if c["stock_code"]]
        if len(hits) > 1 and len(listed) == 1:
            hits = listed
        if not hits:
            missing.append(name)
        elif len(hits) > 1:
            ambiguous.append(name)
        else:
            found.setdefault(hits[0]["corp_code"], (name, key))
    return found, missing, ambiguous


# ---------- 분기 ----------

def quarter_series(api_key: str, corp_code: str, this_year: int, count: int = 8) -> dict | None:
    """누적 금액에서 3개월 값을 만든다. 최근 count 개 분기를 {labels, sales, op, net}(억원) 으로 돌려준다."""
    cum = {}
    for year in (this_year - 2, this_year - 1, this_year):
        for code, q in QUARTER_CODES:
            if year == this_year and q == 4:
                continue
            rows = bcp.statement_rows(api_key, corp_code, year, code)
            if rows:
                cum[(year, q)] = bcp.quarter_values(rows)
    return quarters_from_cumulative(cum, count)


def quarters_from_cumulative(cum: dict, count: int = 8) -> dict | None:
    out = []
    for (year, q) in sorted(cum):
        cur = cum[(year, q)]
        prev = cum.get((year, q - 1)) if q > 1 else {}
        if prev is None or cur.get("매출액") is None:
            continue
        vals = {k: (cur[k] - (prev.get(k) or 0) if cur.get(k) is not None and (q == 1 or prev.get(k) is not None) else None)
                for k in ITEMS}
        out.append((f"'{year % 100}.{q}Q", vals))
    out = out[-count:]
    if not out:
        return None
    return {"labels": [o[0] for o in out],
            "sales": [bcp.eok(o[1]["매출액"]) for o in out],
            "op": [bcp.eok(o[1]["영업이익"]) for o in out],
            "net": [bcp.eok(o[1]["당기순이익"]) for o in out]}


# ---------- 연간 ----------

def annual_series(api_key: str, corp_code: str, this_year: int) -> tuple:
    """(연도 목록, {항목: [억원...]}, 출처) 최근 3개년. 사업보고서 → 감사보고서 순."""
    fy = {}
    for year in (this_year - 1, this_year - 2):
        rows = bcp.statement_rows(api_key, corp_code, year, bcp.ANNUAL)
        if rows:
            fy.update(bcp.annual_by_year(rows, year))
            for y, vals in bcp.annual_by_year(bcp.statement_rows(api_key, corp_code, year - 1, bcp.ANNUAL), year - 1).items():
                fy.setdefault(y, vals)
            source = "사업보고서"
            break
    else:
        fy, _auditors, _overview = bcp.audit_financials(api_key, corp_code)
        source = "감사보고서"
    years = sorted(y for y, v in fy.items() if v.get("매출액") is not None)[-3:]
    if not years:
        return [], {}, ""
    return years, {k: [bcp.eok(fy[y].get(k)) for y in years] for k in ITEMS + BS_ITEMS}, source


def collect(api_key: str, corp_code: str, name: str, key: str | None) -> dict | None:
    company = bcp.call(api_key, "company", corp_code=corp_code)
    if not company:
        return None
    this_year = datetime.now().year
    years, rows, source = annual_series(api_key, corp_code, this_year)
    listed = bool(company.get("stock_code"))
    rec = {"c": corp_code, "n": name, "k": key, "l": 1 if listed else 0, "cls": company.get("corp_cls", ""),
           "ind": company.get("induty_code", ""), "mt": company.get("acc_mt", ""), "ad": company.get("adres", ""),
           "y": years, "s": rows.get("매출액", []), "o": rows.get("영업이익", []), "ni": rows.get("당기순이익", []),
           "ta": rows.get("총자산", []), "tl": rows.get("부채총계", []), "te": rows.get("자본총계", []),
           "src": source}
    if listed:
        try:
            rec["q"] = quarter_series(api_key, corp_code, this_year)
        except bcp.DartUnreachable:
            raise
        except Exception as e:  # 분기를 못 읽어도 연간은 저장한다
            print(f"[quarter] {corp_code} {name}: {e}")
    return rec


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)
    api_key = os.environ.get("DART_API_KEY")
    if not api_key:
        print("DART_API_KEY 환경변수가 없습니다.")
        return 1
    entries = universe_names()
    key_of = {norm(e[0]): e[1] for e in entries}
    targets = {code: (name, key_of.get(norm(ALIAS.get(name, name)))) for code, name in base_companies().items()}
    corps = load_corp_list(api_key)
    found, missing, ambiguous = resolve(entries, corps)
    for code, (name, key) in found.items():
        targets[code] = (targets[code][0], targets[code][1] or key) if code in targets else (name, key)
    print(f"대상 {len(targets)}곳 (기존 1~3그룹 {len(base_companies())}곳, 명단에서 찾음 {len(found)}곳)")
    print(f"명단에서 못 찾음 {len(missing)}곳: {', '.join(missing)}")
    print(f"이름이 겹쳐 건너뜀 {len(ambiguous)}곳: {', '.join(ambiguous)}")

    started, records = time.monotonic(), {}
    stop = [False]

    def work(item):
        code, (name, key) = item
        if stop[0] or time.monotonic() - started > TIME_BUDGET_SECONDS:
            return
        try:
            rec = collect(api_key, code, name, key)
        except bcp.DartUnreachable as e:
            stop[0] = True
            print(f"OpenDART 에 접속할 수 없어 중단합니다: {e}")
            return
        if rec:
            records[code] = rec
            print(f"[{len(records)}/{len(targets)}] {code} {name} 연간 {len(rec['y'])}개년"
                  f"{', 분기 ' + str(len(rec['q']['labels'])) + '개' if rec.get('q') else ''}")

    with ThreadPoolExecutor(max_workers=bcp.WORKERS) as pool:
        list(pool.map(work, targets.items()))
    if not records:
        print("받은 데이터가 없어 financials.js 를 바꾸지 않습니다.")
        return 1
    ordered = [records[c] for c in targets if c in records]
    meta = {"updated": datetime.now().strftime("%Y-%m-%d"), "missing": missing, "ambiguous": ambiguous}
    OUT_PATH.write_text(
        "// scripts/build_financials.py 가 생성한 파일입니다. 직접 수정하지 마세요.\n"
        f"window.COMPANY_FINANCIALS = {json.dumps(ordered, ensure_ascii=False, separators=(',', ':'))};\n"
        f"window.COMPANY_FINANCIALS_META = {json.dumps(meta, ensure_ascii=False, separators=(',', ':'))};\n",
        encoding="utf-8")
    print(f"{len(ordered)}개 기업을 저장했습니다: {OUT_PATH}")
    # 화면 검증용: 배포 전 브랜치 빌드에서도 결과를 확인할 수 있도록 한 줄로 남긴다
    print("[financials-json] " + json.dumps(ordered, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
