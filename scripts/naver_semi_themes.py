"""네이버증권 공개 JSON(읽기 전용)에서 '반도체' 관련 테마·업종의 구성 종목을 모은다(소부장 후보 발굴용).
참고: https://github.com/dd3ok/naverstock-api-skill (MIT). 403·429·리다이렉트가 나오면 즉시 멈춘다. 결과는 한 줄 JSON [semi-themes-json]."""
import json, re, sys, time
import requests

NS = "https://stock.naver.com"
H = {"User-Agent": "Mozilla/5.0 (compatible; Sangsaengnews research)", "Accept": "application/json", "Referer": "https://stock.naver.com/"}
S = requests.Session()
KEY = re.compile(r"반도체|웨이퍼|HBM|유리기판|후공정|패키징|디스플레이 장비|특수가스|포토레지스트|ALD|CMP|전공정|메모리")


def get(path, **params):
    r = S.get(NS + path, params=params, headers=H, timeout=25, allow_redirects=False)
    if r.status_code in (403, 429) or 300 <= r.status_code < 400:
        sys.exit(f"중단: HTTP {r.status_code} {path}")
    if r.status_code >= 400:
        print(f"## HTTP {r.status_code} {path} {params} → {r.text[:300]}", flush=True)  # 서버가 알려 주는 오류 이유
        r.raise_for_status()
    time.sleep(0.25)
    return r.json()


def dicts_with(j, *keys):
    """응답 어디에 있든, keys 중 하나라도 가진 dict 목록(가장 큰 것)을 찾는다."""
    best = []
    def walk(x):
        nonlocal best
        if isinstance(x, list):
            if x and isinstance(x[0], dict) and any(k in x[0] for k in keys) and len(x) > len(best): best = x
            for y in x: walk(y)
        elif isinstance(x, dict):
            for y in x.values(): walk(y)
    walk(j)
    return best


def pages(path, params, size=10, maxp=400):
    """서버가 쪽당 10건만 주는 것으로 보여 쪽 크기를 10으로 고정한다. startIdx 가 쪽 번호인지 건너뛴 개수인지는 둘째 쪽이 첫 쪽과 겹치는지로 판별."""
    seen, out, mode = set(), [], "page"
    key = lambda r: str(r.get("itemcode") or r.get("itemCode") or r.get("no") or json.dumps(r, sort_keys=True)[:120])
    for i in range(maxp):
        start = i if mode == "page" else i * size
        rows = dicts_with(get(path, **params, startIdx=start, pageSize=size), "itemcode", "itemCode", "no", "name")
        ids = [key(r) for r in rows]
        if i == 1 and ids and len(set(ids) & seen) > len(ids) // 2 and mode == "page":
            mode = "offset"
            rows = dicts_with(get(path, **params, startIdx=size, pageSize=size), "itemcode", "itemCode", "no", "name"); ids = [key(r) for r in rows]
        new = [r for r, k in zip(rows, ids) if k not in seen]
        seen.update(ids); out += new
        if not rows or not new: break
    print(f"## {path} {len(out)}건(쪽 크기 {size}, startIdx={mode})", flush=True)
    return out


def members(kind, no):
    """구성 종목. 서버는 marketType 으로 KOSPI·KOSDAQ 만 받으므로(ALL 은 400) 두 시장을 따로 읽어 합친다."""
    res = []
    for mt, label in (("KOSPI", "코스피"), ("KOSDAQ", "코스닥")):
        rows = pages(f"/api/domestic/market/{kind}/{no}/stocklist", {"marketType": mt, "orderType": "marketSum"})
        for r in rows:
            code = r.get("itemcode") or r.get("itemCode")
            if code: res.append({"c": code, "n": r.get("itemname") or r.get("itemName"), "m": label, "cap": r.get("marketSum")})
    return res


out = {}
for kind in ("theme", "upjong"):
    lst = pages(f"/api/domestic/market/{kind}/list", {"sortType": "changeRate"})
    print(f"## {kind} 목록 {len(lst)}건 · 예시 {json.dumps(lst[:1], ensure_ascii=False)[:500]}", flush=True)
    picks = []
    for r in lst:
        name = r.get("name") or r.get("themeName") or r.get("upjongName") or ""
        no = r.get("no") or r.get("themeNo") or r.get("upjongNo") or r.get("code")
        if KEY.search(name) and no is not None: picks.append((str(no), name))
    print(f"## {kind} 반도체 관련 {len(picks)}개: {[n for _, n in picks]}", flush=True)
    for no, name in picks:
        try:
            ms = members(kind, no)
        except SystemExit:
            raise
        except Exception as e:
            print(f"## {kind} {name}({no}) 실패 {e}", flush=True); continue
        out[f"{kind}:{name}"] = ms
        print(f"## {kind} {name}({no}) 구성 {len(ms)}종목", flush=True)
print("[semi-themes-json]" + json.dumps(out, ensure_ascii=False), flush=True)
