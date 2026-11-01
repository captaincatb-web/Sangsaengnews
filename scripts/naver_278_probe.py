"""네이버 업종 278(반도체와반도체장비) 구성 종목 페이지네이션 검증 (읽기 전용, 소량 요청).

- 모든 요청의 파라미터·수집시각(UTC)·HTTP 상태·응답 건수·종목코드·응답 원문 해시를 기록한다.
- startIdx 0·1·2 응답 원문(T1)은 로그에 그대로 남긴다. 전체 원문은 out/raw/ 에 저장한다.
- 403·429·리다이렉트가 나오면 우회하지 않고 즉시 중단하고 상태를 기록한다.
- 화면 기준 167종목(사용자 제공, 2026-10-30 종가)과 비교한다. 화면 값을 정답으로 가정하지 않고 차이를 그대로 보고한다.
"""
import csv, datetime as dt, hashlib, json, os, sys, time
from pathlib import Path
import requests

BASE = "https://stock.naver.com"
PATH = "/api/domestic/market/upjong/278/stocklist"
H = {"User-Agent": "Mozilla/5.0 (compatible; Sangsaengnews research)", "Accept": "application/json", "Referer": "https://stock.naver.com/"}
OUT = Path("out"); (OUT / "raw").mkdir(parents=True, exist_ok=True)
LOG = []; STOP = {"stopped": False, "reason": ""}; N = [0]


def now(): return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def find_items(j, key="itemcode"):
    if isinstance(j, list):
        if j and isinstance(j[0], dict) and any(k.lower() == key for k in j[0]): return j
        for x in j:
            r = find_items(x, key)
            if r: return r
    elif isinstance(j, dict):
        for v in j.values():
            r = find_items(v, key)
            if r: return r
    return []


def scalars(j, path="", out=None, depth=0):
    """응답 최상위 근처의 스칼라 필드(전체 건수·페이지 정보 후보)를 모은다. 종목 행 내부는 제외."""
    out = {} if out is None else out
    if isinstance(j, dict):
        for k, v in j.items():
            if isinstance(v, (dict, list)):
                if depth < 3: scalars(v, f"{path}.{k}", out, depth + 1)
            else: out[f"{path}.{k}"] = v
    elif isinstance(j, list) and j and not (isinstance(j[0], dict) and any(k.lower() == "itemcode" for k in j[0])):
        for i, x in enumerate(j[:3]):
            if depth < 3: scalars(x, f"{path}[{i}]", out, depth + 1)
    return out


def code_of(x): return x.get("itemcode") or x.get("itemCode")


def call(tag, market, start, size, raw_in_log=False, extra=None, use_market=True):
    if STOP["stopped"]: return None
    params = {"orderType": "marketSum", "startIdx": start, "pageSize": size}
    if use_market: params["marketType"] = market
    params.update(extra or {})
    N[0] += 1; ts = now()
    rec = {"n": N[0], "tag": tag, "ts": ts, "market": market, "params": params, "status": None}
    try:
        r = requests.get(BASE + PATH, params=params, headers=H, timeout=25, allow_redirects=False)
        rec["status"] = r.status_code
        if r.status_code in (403, 429) or 300 <= r.status_code < 400:
            STOP.update(stopped=True, reason=f"HTTP {r.status_code} at request #{N[0]} ({tag})")
            rec["error"] = STOP["reason"]; LOG.append(rec); print(f"[STOP] {STOP['reason']} — 우회하지 않고 중단", flush=True); return rec
        text = r.text; rec["raw_sha256"] = hashlib.sha256(text.encode()).hexdigest()[:16]; rec["raw_len"] = len(text)
        (OUT / "raw" / f"{N[0]:03d}_{tag}_{market}_s{start}_p{size}.json").write_text(text, encoding="utf-8")
        try: j = r.json()
        except Exception: j = None
        rows = find_items(j) if j is not None else []
        rec["count"] = len(rows); rec["codes"] = [code_of(x) for x in rows]
        rec["dup_in_page"] = len(rec["codes"]) - len(set(rec["codes"]))
        rec["meta"] = scalars(j) if j is not None else {}
        if rows:
            rec["row_keys"] = sorted(rows[0].keys())[:60]
            rec["types"] = {k: sorted({str(x.get(k)) for x in rows}) for k in ("type", "marketType", "market", "stockEndType", "itemType") if any(k in x for x in rows)}
        if raw_in_log: print(f"[raw] {json.dumps({'ts': ts, 'params': params, 'status': r.status_code, 'body': j if j is not None else text[:500]}, ensure_ascii=False, separators=(',', ':'))}", flush=True)
        print(f"[req] #{N[0]} {tag} {market} startIdx={start} pageSize={size} → HTTP {r.status_code} · {len(rows)}건 · {rec['codes']}", flush=True)
    except Exception as e:
        rec["error"] = f"{type(e).__name__}: {str(e)[:150]}"; print(f"[req] #{N[0]} {tag} 오류 {rec['error']}", flush=True)
    LOG.append(rec); time.sleep(0.5)
    return rec


def S(rec): return set(rec["codes"]) if rec and rec.get("codes") else set()


def main():
    screen = list(csv.DictReader(open("data/tmp_probe/naver_278_screen_20261030.csv", encoding="utf-8-sig")))
    scr = {r["code"]: r for r in screen}
    res = {"started": now(), "tests": {}}
    # T1: pageSize=10, startIdx 0·1·2 원문
    t1 = {}
    for m in ("KOSPI", "KOSDAQ"):
        for s in (0, 1, 2): t1[(m, s)] = call("T1", m, s, 10, raw_in_log=True)
    # T2: pageSize 10·20·50·100 × startIdx 0·1·2
    t2 = {}
    for m in ("KOSPI", "KOSDAQ"):
        for size in (10, 20, 50, 100):
            for s in (0, 1, 2):
                t2[(m, size, s)] = t1[(m, s)] if size == 10 else call("T2", m, s, size)
    # T3/T4: startIdx 의미 판별(교집합) — 같은 크기에서 startIdx 0·1·2 쪽 간 교집합
    ana = {}
    for m in ("KOSPI", "KOSDAQ"):
        for size in (10, 20, 50, 100):
            a = [S(t2[(m, size, s)]) for s in (0, 1, 2)]
            inter = lambda x, y: len(x & y)
            ana[f"{m}/size{size}"] = {"건수": [len(x) for x in a], "교집합(0,1)": inter(a[0], a[1]), "교집합(0,2)": inter(a[0], a[2]), "교집합(1,2)": inter(a[1], a[2]),
                                      "0==1": a[0] == a[1], "합집합": len(a[0] | a[1] | a[2])}
        # size 20(start 0) vs size 10(start 0 + 다음 쪽) 비교: offset/페이지 해석 힌트
        a10 = [S(t2[(m, 10, s)]) for s in (0, 1, 2)]; a20 = [S(t2[(m, 20, s)]) for s in (0, 1, 2)]
        ana[f"{m}/size20 vs size10"] = {"size20,start0 ⊇ size10,start0": a10[0] <= a20[0], "size20,start0 == size10 start0∪start1": a20[0] == (a10[0] | a10[1]), "size20,start1 == size10,start2?": a20[1] == a10[2]}
    res["tests"]["startIdx_분석"] = ana
    # T5/T6/T7: 가설별 전체 수집(page1: 1,2,3… / page0: 0,1,2… / offset: 0,size,2size…), 종료 조건 기록
    crawls = {}
    for m in ("KOSPI", "KOSDAQ"):
        for size in (10, 50):
            for hyp in ("page1", "page0", "offset"):
                seen, order, pages, end = set(), [], [], ""
                for i in range(40):
                    if STOP["stopped"]: end = "접근 제한으로 중단"; break
                    s = {"page1": i + 1, "page0": i, "offset": i * size}[hyp]
                    rec = call(f"T5_{hyp}", m, s, size)
                    if not rec or rec.get("error"): end = (rec or {}).get("error", "오류"); break
                    cs = rec["codes"]; new = [c for c in cs if c not in seen]
                    pages.append({"startIdx": s, "count": len(cs), "new": len(new), "dup_with_prev": len(cs) - len(new)})
                    if not cs: end = f"빈 응답(startIdx={s})"; break
                    if not new:
                        end = f"새 종목 없음(startIdx={s}, 이전 쪽과 동일/중복)"
                        break
                    for c in new: seen.add(c); order.append(c)
                else: end = "최대 40쪽 도달"
                crawls[f"{m}/size{size}/{hyp}"] = {"고유종목수": len(order), "쪽수": len(pages), "종료조건": end, "쪽별": pages, "코드": order}
    res["tests"]["전체수집"] = {k: {kk: vv for kk, vv in v.items() if kk != "코드"} for k, v in crawls.items()}
    # 가장 많이 모은 가설을 시장별로 채택(고유 종목 수 기준) → 화면 167과 비교
    best = {}
    for m in ("KOSPI", "KOSDAQ"):
        k = max((k for k in crawls if k.startswith(m)), key=lambda k: crawls[k]["고유종목수"], default=None)
        best[m] = (k, crawls[k]["코드"] if k else [])
    api_codes = set(best["KOSPI"][1]) | set(best["KOSDAQ"][1])
    scr_mk = {"코스피": "KOSPI", "코스닥": "KOSDAQ"}
    cmp = {"API 최대 고유(채택 가설)": {m: [best[m][0], len(best[m][1])] for m in best}, "API 합계": len(api_codes), "화면 합계": len(scr),
           "화면에만(API 누락)": [[c, scr[c]["name"], scr[c]["market"]] for c in scr if c not in api_codes],
           "API에만(화면에 없음)": sorted(api_codes - set(scr)),
           "교집합": len(api_codes & set(scr))}
    res["tests"]["화면167_비교"] = cmp
    # T10: 시장·증권유형 필터 조건 — 마지막 성공 응답의 type/market 필드 값, marketType 생략·ALL 요청의 서버 반응
    t10 = {"type/market 값(요청별 첫 응답)": {f"{r['market']}/{r['tag']}/s{r['params']['startIdx']}/p{r['params']['pageSize']}": r.get("types") for r in LOG if r.get("types")}}
    for r in LOG: pass
    t10["marketType 생략"] = (lambda r: {"status": r and r.get("status"), "count": r and r.get("count")})(call("T10_nomarket", "-", 0, 10, use_market=False))
    t10["marketType=ALL"] = (lambda r: {"status": r and r.get("status"), "count": r and r.get("count")})(call("T10_ALL", "ALL", 0, 10))
    res["tests"]["T10_필터"] = t10
    res["응답메타(최상위 스칼라)"] = next(({"tag": r["tag"], "meta": r["meta"]} for r in LOG if r.get("meta")), {})
    res["stop"] = STOP; res["요청수"] = N[0]; res["finished"] = now()
    (OUT / "requests.json").write_text(json.dumps(LOG, ensure_ascii=False), encoding="utf-8")
    (OUT / "summary.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print("[probe-summary]" + json.dumps(res, ensure_ascii=False, separators=(",", ":")), flush=True)
    print("[probe-codes]" + json.dumps({k: v["코드"] for k, v in crawls.items()}, ensure_ascii=False, separators=(",", ":")), flush=True)


main()
