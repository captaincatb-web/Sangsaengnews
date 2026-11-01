"""네이버 업종 278 구성 종목: 응답 최상위의 hasNext·cursor 를 따라가는 페이지네이션 검증 (읽기 전용).
1차 검증(naver_278_probe.py)에서 startIdx·pageSize 는 이 엔드포인트에서 효과가 없고(항상 같은 10건), 응답에 hasNext/cursor 가 있음을 확인했다.
여기서는 응답이 돌려준 cursor 값을 그대로 다음 요청의 cursor 파라미터로 보낸다(값을 만들거나 추측하지 않는다). 403·429·리다이렉트는 즉시 중단."""
import csv, datetime as dt, hashlib, json, time
from pathlib import Path
import requests

BASE = "https://stock.naver.com"; PATH = "/api/domestic/market/upjong/278/stocklist"
H = {"User-Agent": "Mozilla/5.0 (compatible; Sangsaengnews research)", "Accept": "application/json", "Referer": "https://stock.naver.com/"}
OUT = Path("out2"); (OUT / "raw").mkdir(parents=True, exist_ok=True)
now = lambda: dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


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


def top_meta(j):
    return {k: v for k, v in j.items() if not isinstance(v, (list, dict))} if isinstance(j, dict) else {}


scr = {r["code"]: r for r in csv.DictReader(open("data/tmp_probe/naver_278_screen_20261030.csv", encoding="utf-8-sig"))}
res = {"started": now(), "markets": {}}; LOG = []; stop = [False]


def get(tag, market, params):
    p = {"orderType": "marketSum", "marketType": market, **params}
    ts = now()
    r = requests.get(BASE + PATH, params=p, headers=H, timeout=25, allow_redirects=False)
    rec = {"tag": tag, "ts": ts, "params": p, "status": r.status_code}
    if r.status_code in (403, 429) or 300 <= r.status_code < 400:
        stop[0] = True; rec["error"] = f"HTTP {r.status_code} — 우회하지 않고 중단"; LOG.append(rec); print("[STOP]", rec["error"], flush=True); return rec, None
    text = r.text; rec["raw_sha256"] = hashlib.sha256(text.encode()).hexdigest()[:16]
    (OUT / "raw" / f"{len(LOG) + 1:03d}_{tag}_{market}.json").write_text(text, encoding="utf-8")
    j = r.json(); rows = find_items(j)
    rec["count"] = len(rows); rec["codes"] = [x.get("itemcode") or x.get("itemCode") for x in rows]; rec["meta"] = top_meta(j)
    rec["types"] = {k: sorted({str(x.get(k)) for x in rows}) for k in ("marketType", "stockEndType", "type") if any(k in x for x in rows)}
    rec["row_names"] = [x.get("itemname") or x.get("itemName") for x in rows]
    LOG.append(rec); time.sleep(0.5)
    print(f"[req] {tag} {market} cursor={params.get('cursor')} → HTTP {r.status_code} · {len(rows)}건 · meta={rec['meta']} · {rec['codes']}", flush=True)
    return rec, j


for market in ("KOSPI", "KOSDAQ"):
    pages, seen, order, cursor = [], set(), [], None
    for i in range(60):
        if stop[0]: break
        params = {"cursor": cursor} if cursor else {}
        rec, j = get(f"C{i}", market, params)
        if rec is None or j is None: break
        new = [c for c in rec["codes"] if c not in seen]
        pages.append({"page": i, "cursor_sent": cursor, "count": rec["count"], "new": len(new), "dup": rec["count"] - len(new), "hasNext": rec["meta"].get("hasNext"), "cursor_returned": rec["meta"].get("cursor"), "codes": rec["codes"]})
        for c in new: seen.add(c); order.append(c)
        if not rec["meta"].get("hasNext") or not rec["meta"].get("cursor"): break
        if not new: pages[-1]["stop"] = "새 종목 없음(반복) — 중단"; break
        cursor = rec["meta"]["cursor"]
    res["markets"][market] = {"쪽수": len(pages), "고유종목수": len(order), "종료": pages[-1].get("stop") or ("hasNext=false" if pages and not pages[-1]["hasNext"] else "미확인"), "쪽별": pages, "코드": order}
# 화면 167과 비교
api = set(c for m in res["markets"].values() for c in m["코드"])
by_mk = {"KOSPI": {c for c, r in scr.items() if r["market"] == "코스피"}, "KOSDAQ": {c for c, r in scr.items() if r["market"] == "코스닥"}}
cmp = {"API 고유": len(api), "화면": len(scr), "교집합": len(api & set(scr)),
       "화면에만": [[c, scr[c]["name"]] for c in scr if c not in api], "API에만": sorted(api - set(scr)),
       "시장별": {m: {"API": len(res["markets"][m]["코드"]), "화면": len(by_mk[m]), "교집합": len(set(res["markets"][m]["코드"]) & by_mk[m])} for m in by_mk},
       "시장 불일치(화면 시장과 API 시장이 다른 종목)": [[c, m] for m in by_mk for c in res["markets"][m]["코드"] if c in scr and c not in by_mk[m]]}
res["화면167_비교"] = cmp; res["finished"] = now(); res["요청수"] = len(LOG); res["stop"] = stop[0]
(OUT / "requests.json").write_text(json.dumps(LOG, ensure_ascii=False), encoding="utf-8"); (OUT / "summary.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
print("[cursor-summary]" + json.dumps({k: (v if k != "markets" else {m: {kk: vv for kk, vv in x.items() if kk != "코드"} for m, x in v.items()}) for k, v in res.items()}, ensure_ascii=False, separators=(",", ":")), flush=True)
print("[cursor-codes]" + json.dumps({m: x["코드"] for m, x in res["markets"].items()}, ensure_ascii=False, separators=(",", ":")), flush=True)
