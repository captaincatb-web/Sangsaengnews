"""성장 비교 집계(순수 계산 모듈 — 데이터 없음). 입력은 비공개 단계에서 만든 법인 목록이고, 출력은 공개해도 안전한 집계뿐이다.
법인 레코드: {"id","region"(국내|해외),"eligible"(ELIGIBLE|EXCLUDED|REVIEW),"memberships":[{"chart","d1","d2","d3","d4","d5"}...],
            "fin":{연도:{"rev","op"}}}  (금액은 모두 같은 통화(원)로 환산된 값, 없으면 키 자체가 없음)
규칙: 적격(ELIGIBLE)만, 2023·2024·2025 매출·영업이익이 모두 있는 법인만(동일 기업군), 한 법인은 한 필터 조건에서 한 번만 계산,
영업이익률 = 영업이익 합계 ÷ 매출 합계(기업별 이익률의 평균이 아님), 성장률 = 당해 ÷ 전년 − 1, 2023년 성장률은 같은 법인군의 2022년 매출이 모두 있을 때만."""
from itertools import chain

YEARS = (2023, 2024, 2025)
DEPTH_KEYS = ("d1", "d2", "d3", "d4", "d5")


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
    dom = side([e for e in entities if e["region"] == "국내"]); ov = side([e for e in entities if e["region"] == "해외"])
    gap = {y: (dom["margin"][y] - ov["margin"][y]) if dom.get("n") and ov.get("n") and dom["margin"][y] is not None and ov["margin"][y] is not None else None for y in YEARS}
    return {"dom": dom, "ov": ov, "margin_gap_pp": gap}


def cell_keys(m):
    """한 품목 행이 속하는 필터 조합(그래프분류 선택 여부 × 상세구분1→5 앞부분 선택). 값이 빈칸이면 그 단계부터는 더 내려가지 않는다."""
    path = []
    for k in DEPTH_KEYS:
        if m.get(k) in (None, ""): break
        path.append(m[k])
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
        for reg in ("국내", "해외"):
            u = {i for i in ids if by[i]["region"] == reg and usable(by[i])}
            if len(u) >= k: sides[reg] = u
        if sides: ok[key] = sides
    changed = True
    while changed:
        changed = False
        for reg in ("국내", "해외"):
            keys = [kk for kk in ok if reg in ok[kk]]
            for x in keys:
                for y in keys:
                    if x == y or y not in ok or x not in ok or reg not in ok[y] or reg not in ok[x]: continue
                    X, Y = ok[x][reg], ok[y][reg]
                    if Y < X and len(X - Y) < k:  # 진부분집합이며 차이가 작음 → 더 작은 쪽을 가림
                        del ok[y][reg]; changed = True
                        if not ok[y]: del ok[y]
    return ok
