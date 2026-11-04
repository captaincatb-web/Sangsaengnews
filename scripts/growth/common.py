"""성장 비교용 원본(협력사 명단) 읽기·정제 공통 함수. 이 파일에는 데이터가 없다. 원본·결과는 비공개 폴더(GROWTH_PRIVATE_DIR)에만 둔다.
- 원본 값은 바꾸지 않는다(열 그대로 문자열로 보존). 정제값은 별도 열(*_norm)로 만든다.
- 사업자·법인등록번호는 문자열로 다룬다(숫자로 읽혀 앞자리 0이 사라지거나 과학적 표기가 된 경우는 표시만 하고 복원하지 않는다)."""
import re
from collections import Counter

COLS = ["대구분", "국내상장여부", "사업자 등록번호", "법인등록번호", "협력사명(Local)", "협력사명(Eng)", "상세구분1", "상세구분2", "상세구분3", "상세구분4", "상세구분5"]
KEYS = ["region", "listing", "biz_no", "corp_no", "name_local", "name_eng", "d1", "d2", "d3", "d4", "d5"]
CHART_CAT = {"원자재": "소재", "부품": "부품", "설비": "장비", "인프라": "장비"}  # 원본 상세구분1 → 그래프 분류(원본값은 보존)


def cell_str(v):
    """셀 값을 원본 그대로 문자열로. 빈 셀은 None 과 '' 를 구분해 유지(None=셀 없음, ''=빈 문자열)."""
    if v is None: return None
    if isinstance(v, float) and v == int(v): return str(int(v))
    return str(v)


def load_rows(path):
    """엑셀 첫 시트를 읽어 (헤더, 행 목록)을 돌려준다. 각 행은 {row_id(엑셀 행 번호), 열 키: 원본 문자열}. 완전히 빈 행은 건너뛰되 개수를 센다."""
    import openpyxl
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True).worksheets[0]
    it = ws.iter_rows(values_only=True); head = [cell_str(x) for x in next(it)]
    out, blank = [], 0
    for i, r in enumerate(it, start=2):
        vals = [cell_str(x) for x in r][: len(KEYS)]; vals += [None] * (len(KEYS) - len(vals))
        if all(v in (None, "") for v in vals): blank += 1; continue
        out.append({"row_id": i, **dict(zip(KEYS, vals))})
    return head, out, blank


def fix_no(s):
    """영문명 등에서 'no'/'No'/'NO' 가 '국내'로 바뀐 오류를 되돌린 후보를 만든다(원본은 그대로 두고 *_norm 열에만 사용).
    대소문자는 주변 글자로 추정: 단어 첫머리+뒤가 소문자 → 'No', 앞뒤가 대문자거나 단독 → 'NO', 그 밖 → 'no'. 추정이므로 검토 대상으로 표시한다."""
    if not s or "국내" not in s: return s, 0
    n = 0
    def rep(m):
        nonlocal n; n += 1
        t, a, b = m.string, m.start(), m.end()
        prev = t[a - 1] if a > 0 else ""; nxt = t[b] if b < len(t) else ""
        if (not prev.isalpha()) and nxt.islower(): return "No"
        if prev.isupper() or (nxt.isalpha() and nxt.isupper()) or (not prev.isalpha() and not nxt.isalpha()): return "NO"
        return "no"
    return re.sub("국내", rep, s), n


_SUFFIX = re.compile(r"\b(co|corp|corporation|inc|incorporated|ltd|limited|llc|gmbh|ag|sa|nv|bv|plc|pte|sdn|bhd|kk|k\.k|company|holdings?|group)\b\.?", re.I)


def name_key(s):
    """같은 법인 후보를 찾기 위한 열쇠(대소문자·구두점·회사 형태 표기를 제거). 열쇠가 같아도 같은 법인이라고 확정하지 않는다."""
    if not s: return ""
    t = fix_no(s)[0].lower(); t = _SUFFIX.sub(" ", t); t = re.sub(r"\(주\)|주식회사|유한회사|㈜", " ", t)
    return re.sub(r"[^0-9a-z가-힣]+", "", t)


def diagnose(rows, blank=0):
    """집계 숫자만 담은 진단(기업명·번호 등 개별 값은 담지 않음 → 공개 보고에 써도 안전)."""
    c = Counter
    dom = [r for r in rows if r["region"] == "국내"]; ov = [r for r in rows if r["region"] == "해외"]
    empty = lambda v: v in (None, "")
    sci = lambda v: bool(v) and bool(re.search(r"\d[eE][+-]?\d", v))
    return {
        "data_rows": len(rows), "blank_rows_skipped": blank, "region": dict(c(r["region"] for r in rows)),
        "listing_domestic": dict(c(r["listing"] for r in dom)), "d1": dict(c(r["d1"] for r in rows)), "d2": dict(c(r["d2"] for r in rows)),
        "chart_category": dict(c(CHART_CAT.get(r["d1"], "미분류") for r in rows)),
        "d3_blank": sum(1 for r in rows if empty(r["d3"])), "d4_blank": sum(1 for r in rows if empty(r["d4"])), "d5_blank": sum(1 for r in rows if empty(r["d5"])),
        "d4_zero": sum(1 for r in rows if r["d4"] == "0"), "d5_not_recorded": sum(1 for r in rows if r["d5"] == "미기재"),
        "biz_no_blank": {"domestic": sum(1 for r in dom if empty(r["biz_no"])), "overseas": sum(1 for r in ov if empty(r["biz_no"]))},
        "corp_no_blank": {"domestic": sum(1 for r in dom if empty(r["corp_no"])), "overseas": sum(1 for r in ov if empty(r["corp_no"]))},
        "biz_no_len": dict(c(len(r["biz_no"]) for r in rows if not empty(r["biz_no"]))), "corp_no_len": dict(c(len(r["corp_no"]) for r in rows if not empty(r["corp_no"]))),
        "id_scientific_notation": sum(1 for r in rows if sci(r["biz_no"]) or sci(r["corp_no"])),
        "name_corruption_rows": {k: sum(1 for r in rows if r[k] and "국내" in r[k]) for k in ("name_local", "name_eng", "d5")},
        "exact_duplicate_rows": len(rows) - len({tuple(r[k] for k in KEYS) for r in rows}),
        "domestic_unique_corp_no": len({r["corp_no"] for r in dom if not empty(r["corp_no"])}), "domestic_unique_names": len({r["name_local"] for r in dom}),
        "overseas_with_korean_ids": sum(1 for r in ov if not empty(r["corp_no"])), "overseas_unique_name_keys": len({name_key(r["name_eng"]) for r in ov}),
    }
