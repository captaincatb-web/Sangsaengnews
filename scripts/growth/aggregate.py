"""성장 비교 집계(순수 계산 모듈 — 데이터 없음). 입력은 비공개 단계에서 만든 법인 목록이고, 출력은 공개해도 안전한 집계뿐이다.
법인 레코드: {"id","region"(국내|해외),"eligible"(ELIGIBLE|EXCLUDED|REVIEW),"memberships":[{"chart","d1","d2","d3","d4","d5"}...],
            "fin":{연도:{"rev","op"}}}  (금액은 모두 같은 통화(원)로 환산된 값, 없으면 키 자체가 없음)
규칙: 적격(ELIGIBLE)만, 2023·2024·2025 매출·영업이익이 모두 있는 법인만(동일 기업군), 한 법인은 한 필터 조건에서 한 번만 계산,
영업이익률 = 영업이익 합계 ÷ 매출 합계(기업별 이익률의 평균이 아님), 성장률 = 당해 ÷ 전년 − 1, 2023년 성장률은 같은 법인군의 2022년 매출이 모두 있을 때만."""
from itertools import chain

YEARS = (2023, 2024, 2025)
DEPTH_KEYS = ("d1", "d2", "d3", "d4", "d5")
REGIONS = ("국내", "해외", "외국계")  # 외국계 = 한국에 설립된 외국계 법인(원본 목록에서 '해외'로 표기, 한국 법인등록번호 보유). 해외 집계와 합산하지 않고 따로 집계


def usable(e, years=YEARS):
    """동일 기업군(Balanced Panel) 자격: 적격 판정 + 3개년 매출·영업이익 모두 확보."""
    f = e.get("fin") or {}
    return e.get("eligible") == "ELIGIBLE" and all(f.get(y, {}).get("rev") is not None and f.get(y, {}).get("op") is not None for y in years)


def side(entities):
    """한 지역(국내 또는 해외)의 집계. entities 는 이미 같은 필터·같은 지역으로 걸러진 고유 법인."""
    es = [e for e in entities if usable(e)]
    n = len(es)
    if n == 0: return {"n": 0}
    rev = {y: sum(e["fin"][y]["rev"] for e in es) for y in YEARS}; op = {y: sum(e["fin"][y]["op"] for e in es) for y in YEARS}
    margin = {y: (op[y] / rev[y] * 100 if rev[y] else None) for y in YEARS}
    growth = {y: (rev[y] / rev[y - 1] - 1) * 100 if y - 1 in rev and rev[y - 1] else None for y in YEARS[1:]}
    if all(e["fin"].get(2022, {}).get("rev") is not None for e in es):  # 2022년 매출이 전원 있을 때만 2023년 성장률
        r22 = sum(e["fin"][2022]["rev"] for e in es); growth[2023] = (rev[2023] / r22 - 1) * 100 if r22 else None
    else: growth[2023] = None
    return {"n": n, "rev": rev, "op": op, "margin": margin, "growth": growth, "avg_rev": {y: rev[y] / n for y in YEARS}}


def compare(entities):
    """국내·해외 나란히 + 영업이익률 격차(%p, 국내 − 해외)."""
    dom = side([e for e in entities if e["region"] == "국내"]); ov = side([e for e in entities if e["region"] == "해외"]); fo = side([e for e in entities if e["region"] == "외국계"])
    gap = {y: (dom["margin"][y] - ov["margin"][y]) if dom.get("n") and ov.get("n") and dom["margin"][y] is not None and ov["margin"][y] is not None else None for y in YEARS}
    return {"dom": dom, "ov": ov, "fo": fo, "margin_gap_pp": gap}


BLANK_LABEL = "(해당 없음)"


def cell_keys(m):
    """한 품목 행이 속하는 필터 조합(그래프분류 선택 여부 × 상세구분1→5 앞부분 선택).
    중간 단계가 빈칸이어도 더 깊은 단계 값이 있으면 버리지 않고 빈칸을 '(해당 없음)'으로 채워 보존한다. 끝쪽 빈칸만 생략한다."""
    vals = [None if m.get(k) in (None, "") else m[k] for k in DEPTH_KEYS]
    while vals and vals[-1] is None: vals.pop()
    path = [BLANK_LABEL if v is None else v for v in vals]
    out = []
    for chart in (None, m["chart"]):
        for depth in range(0, len(path) + 1):
            out.append((chart, tuple(path[:depth])))
    return out


def cells(entities):
    """{조합: 그 조합에 속한 고유 법인 id 집합}. 한 법인이 여러 품목 행을 가져도 조합마다 한 번만 들어간다(비배타적 분류)."""
    c = {}
    for e in entities:
        for m in e["memberships"]:
            for key in cell_keys(m): c.setdefault(key, set()).add(e["id"])
    return c


def publishable(entities, k=5):
    """공개 가능한 조합 판정. 각 지역에서 법인 수가 k 이상이고, 부분집합 차이로 소수 기업이 드러나지 않는 조합만 남긴다.
    차이 검사: 공개되는 두 조합 X ⊃ Y 에서 |X \\ Y| < k 이면 Y 를 숨긴다(X − Y 의 합으로 소수 법인 값을 알아낼 수 없게). 안정될 때까지 반복."""
    by = {e["id"]: e for e in entities}; allc = cells(entities); ok = {}
    for key, ids in allc.items():
        sides = {}
        for reg in REGIONS:
            u = {i for i in ids if by[i]["region"] == reg and usable(by[i])}
            if len(u) >= k: sides[reg] = u
        if sides: ok[key] = sides
    changed = True
    while changed:
        changed = False
        for reg in REGIONS:
            keys = [kk for kk in ok if reg in ok[kk]]
            for x in keys:
                for y in keys:
                    if x == y or y not in ok or x not in ok or reg not in ok[y] or reg not in ok[x]: continue
                    X, Y = ok[x][reg], ok[y][reg]
                    if Y < X and len(X - Y) < k:  # 진부분집합이며 차이가 작음 → 더 작은 쪽을 가림
                        del ok[y][reg]; changed = True
                        if not ok[y]: del ok[y]
    return ok


def cross_suppress(oks, k=5, bases=None):
    """비교 모드(집단 구성이 다른 여러 집계)를 함께 공개할 때의 교차 역산 방지. oks 는 모드별 publishable 결과의 목록이며 제자리에서 수정한다.
    서로 다른 두 공개 조합(모드·집단·필터가 달라도)에서 한쪽의 법인 집합이 다른 쪽의 진부분집합이고 차이가 1~(k-1)곳이면 작은 쪽을 가린다(큰 쪽 − 작은 쪽의 합으로 소수 법인 값이 드러나는 것을 막음). 안정될 때까지 반복. bases[mode][reg]는 그 집단 재무의 기준 이름(예: 국내 별도·국내 연결): 기준이 다르면 같은 법인이어도 값이 달라 차이로 개별 값이 드러나지 않으므로 같은 기준끼리만 비교한다."""
    bases = bases or [{} for _ in oks]
    base_of = lambda mi, reg: bases[mi].get(reg, reg)
    changed = True
    while changed:
        changed = False
        items = [(mi, key, reg, ids) for mi, ok in enumerate(oks) for key, sides in ok.items() for reg, ids in sides.items()]
        for a in items:
            for b in items:
                if a is b or (a[0], a[1], a[2]) == (b[0], b[1], b[2]) or base_of(a[0], a[2]) != base_of(b[0], b[2]): continue
                X, Y = a[3], b[3]
                if Y < X and 0 < len(X - Y) < k and b[1] in oks[b[0]] and b[2] in oks[b[0]][b[1]]:
                    del oks[b[0]][b[1]][b[2]]
                    if not oks[b[0]][b[1]]: del oks[b[0]][b[1]]
                    changed = True
    return oks
