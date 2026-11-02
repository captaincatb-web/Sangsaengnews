"""국내 소부장 기업별 시가총액·주가(site/data/semi_caps.js)와 업종별 시장 비중(site/data/semi_share.js)을 매일 새로 계산한다.
- 명단(종목코드·기업명·시장·업종)과 이전 분기 말 종가(q1·q2)는 기존 site/data/semi_caps.js 에서 읽는다(바뀌지 않는 값).
- 시세·상장주식 수: 네이버증권 시장 목록(코스피·코스닥 전 종목)의 현재가 × 상장주식 수(보통주). 읽기 전용 GET, 요청 사이 0.5초.
- 403·429·리다이렉트는 우회하지 않고 즉시 중단한다. 검증(명단 적중률, 시장 합계 변동폭)에 실패하면 파일을 바꾸지 않고 종료 코드 1로 끝난다(배포는 이전 값으로 계속).
- KRX_API_KEY(한국거래소 Open API 인증키, GitHub Secret)가 있으면 KRX 일별매매정보(유가증권·코스닥·코넥스)를 우선 쓰고, 없거나 실패하면 네이버로 대신한다.
  KRX 기준은 종가·시가총액·상장주식 수가 거래소 값이고, 코넥스까지 포함하며, 거래일도 데이터가 있는 날로 확정한다. 분기 말 종가(q1·q2)도 같은 API에서 새로 받는다.
- 시험용(KRX_FIXTURE=<stk_YYYYMMDD.json 등이 있는 폴더>, 네이버는 SEMI_CAPS_FIXTURE): SEMI_CAPS_FIXTURE=<listed_KOSPI.json 이 있는 폴더> 이면 네트워크 없이 그 파일을 쓴다. SEMI_CAPS_ASOF=YYYY-MM-DD 로 기준일을 고정한다."""
import datetime as dt, json, os, re, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent; DATA = ROOT / "site" / "data"
CAPS = DATA / "semi_caps.js"; SHARE = DATA / "semi_share.js"
BASE = "https://stock.naver.com"; PATH = "/api/domestic/market/stock/default"
H = {"User-Agent": "Mozilla/5.0 (compatible; Sangsaengnews research)", "Accept": "application/json", "Referer": "https://stock.naver.com/"}
KINDS = ["소재", "부품", "장비"]; STOP = {"stopped": False, "reason": ""}


def load(p, var):
    m = re.search(rf"window\.{var}\s*=\s*(\{{.*\}});", p.read_text(encoding="utf-8"), re.S)
    return json.loads(m.group(1))


def last_trading_day(now=None):
    """한국시간 기준 마지막 평일 종가일. 장 마감(15:30) 후 16시 이후면 오늘, 아니면 직전 평일. 휴장일은 직전 종가가 그대로라 같은 값이 나온다."""
    kst = (now or dt.datetime.now(dt.timezone.utc)) + dt.timedelta(hours=9)
    d = kst.date()
    if not (kst.hour >= 16 and d.weekday() < 5): d -= dt.timedelta(days=1)
    while d.weekday() >= 5: d -= dt.timedelta(days=1)
    return d.isoformat()


def items_of(j):
    if isinstance(j, list):
        if j and isinstance(j[0], dict) and ("itemCode" in j[0] or "itemcode" in j[0]): return j
        for x in j:
            r = items_of(x)
            if r: return r
    elif isinstance(j, dict):
        for v in j.values():
            r = items_of(v)
            if r: return r
    return []


code_of = lambda x: x.get("itemcode") or x.get("itemCode")


def get(params):
    import requests
    if STOP["stopped"]: return None
    r = requests.get(BASE + PATH, params=params, headers=H, timeout=25, allow_redirects=False); time.sleep(0.5)
    if r.status_code in (403, 429) or 300 <= r.status_code < 400:
        STOP.update(stopped=True, reason=f"HTTP {r.status_code}"); print("[STOP]", STOP["reason"], "— 우회하지 않고 중단", flush=True); return None
    try: return r.json()
    except Exception: return None


def collect(market):
    """startIdx 해석: 0과 1이 같은 쪽이면 1부터 세는 쪽 번호, 전부 새 종목이면 0부터 쪽 번호, 일부 겹치면 건너뛴 개수. 새 종목이 없으면 끝."""
    seen, rows = {}, []
    def fetch(start):
        j = get({"tradeType": "KRX", "marketType": market, "orderType": "marketSum", "pageSize": 100, "startIdx": start})
        return None if j is None else items_of(j)
    def take(its):
        new = [x for x in its if code_of(x) not in seen]
        for x in new: seen[code_of(x)] = 1; rows.append({"code": code_of(x), "nowPrice": x.get("nowPrice"), "listedStockCnt": x.get("listedStockCnt") or x.get("listedStockCount")})
        return len(new)
    r0 = fetch(0)
    if not r0: return rows
    take(r0); r1 = fetch(1)
    if r1 is None: return rows
    k0, k1 = {code_of(x) for x in r0}, {code_of(x) for x in r1}
    if k1 == k0: nxt, step = 2, 1
    elif k1 & k0: nxt, step = len(r0), len(r0); take(r1)
    else: nxt, step = 2, 1; take(r1)
    for _ in range(60):
        its = fetch(nxt)
        if not its or take(its) == 0: break
        nxt += step
    return rows


KRX_BASE = os.environ.get("KRX_BASE", "https://data-dbg.krx.co.kr/svc/apis/sto")
KRX_EP = {"KOSPI": "stk_bydd_trd", "KOSDAQ": "ksq_bydd_trd", "KONEX": "knx_bydd_trd"}


def krx_rows(market, bas):
    """KRX Open API 일별매매정보 한 시장·한 날짜. 빈 결과(휴장일·미공시)면 빈 목록, 접근 오류는 None(우회하지 않음)."""
    fx = os.environ.get("KRX_FIXTURE")
    if fx:
        f = Path(fx) / f"{KRX_EP[market]}_{bas}.json"
        return json.load(open(f, encoding="utf-8")).get("OutBlock_1", []) if f.exists() else []
    import requests
    r = requests.get(f"{KRX_BASE}/{KRX_EP[market]}", params={"basDd": bas}, headers={"AUTH_KEY": os.environ["KRX_API_KEY"], "Accept": "application/json", "User-Agent": H["User-Agent"]}, timeout=30, allow_redirects=False)
    time.sleep(0.5)
    if r.status_code != 200:
        print(f"[KRX] {KRX_EP[market]} {bas} HTTP {r.status_code} — 우회하지 않고 중단"); return None
    try: j = r.json()
    except Exception: print(f"[KRX] {KRX_EP[market]} {bas} JSON 아님"); return None
    if "OutBlock_1" not in j: print(f"[KRX] {KRX_EP[market]} {bas} 응답 키: {list(j)[:6]}"); return None
    return j["OutBlock_1"]


def krx_code(x):
    c = str(x.get("ISU_SRT_CD") or x.get("ISU_CD") or "")
    return c[3:9] if len(c) == 12 and c.startswith("KR") else c


def krx_day(bas):
    """한 날짜의 세 시장 자료 {시장: {종목코드: (종가, 상장주식 수, 시가총액 원)}}. 코스피가 비면(휴장일) None."""
    out = {}
    for m in KRX_EP:
        rows = krx_rows(m, bas)
        if rows is None: raise RuntimeError("KRX 접근 실패")
        d = {}
        for x in rows:
            try: d[krx_code(x)] = (int(float(str(x["TDD_CLSPRC"]).replace(",", "") or 0)), int(float(str(x["LIST_SHRS"]).replace(",", "") or 0)), int(float(str(x["MKTCAP"]).replace(",", "") or 0)))
            except (KeyError, ValueError): continue
        out[m] = d
    return out if out["KOSPI"] else None


def prev_quarter_ends(asof):
    """기준일 이전 분기 말 달력일 2개(가장 가까운 분기 말, 그 전 분기 말)."""
    d = dt.date.fromisoformat(asof); q = []; y, m = d.year, ((d.month - 1) // 3) * 3
    for _ in range(2):
        if m == 0: y, m = y - 1, 12
        last = (dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1)); q.append(last); m -= 3
    return [x.isoformat() for x in q]


def krx_on_or_before(cal, limit=7):
    """달력일 이하에서 가장 가까운 거래일의 자료와 그 날짜."""
    d = dt.date.fromisoformat(cal)
    for _ in range(limit):
        day = krx_day(d.strftime("%Y%m%d"))
        if day: return d.isoformat(), day
        d -= dt.timedelta(days=1)
    return None, None


def run_krx(caps, share):
    start = os.environ.get("SEMI_CAPS_ASOF") or (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=9) - dt.timedelta(days=1)).date().isoformat()
    asof, day = krx_on_or_before(start)
    if not day: print("[KRX] 최근 7일 자료 없음"); return None
    live = {c: v for m in day for c, v in day[m].items()}; mcap = {m: round(sum(v[2] for v in day[m].values()) / 1e8) for m in day}
    q1d, q2d = prev_quarter_ends(asof); (q1, d1), (q2, d2) = krx_on_or_before(q1d), krx_on_or_before(q2d)
    if not d1 or not d2: print("[KRX] 분기 말 자료 없음"); return None
    pq = [{c: v[0] for m in d for c, v in d[m].items()} for d in (d1, d2)]
    return asof, live, mcap, (q1, q2), pq


def fetch_all():
    fx = os.environ.get("SEMI_CAPS_FIXTURE")
    out = {}
    for m in ("KOSPI", "KOSDAQ"):
        out[m] = json.load(open(Path(fx) / f"listed_{m}.json", encoding="utf-8"))["rows"] if fx else collect(m)
    return out


def main():
    caps = load(CAPS, "SEMI_CAPS"); share = load(SHARE, "SEMI_SHARE")
    krx = None
    if os.environ.get("KRX_API_KEY") or os.environ.get("KRX_FIXTURE"):
        try: krx = run_krx(caps, share)
        except Exception as e: print("[KRX]", e, "— 네이버로 대신함")
    if krx:
        asof, live, mcap, prev, pq = krx
        live = {c: (v[0], v[1]) for c, v in live.items()}; src = "krx"
    else:
        lists = fetch_all(); live, mcap = {}, {}
        for m, rows in lists.items():
            tot = 0
            for r in rows:
                if str(r.get("nowPrice") or "").isdigit() and str(r.get("listedStockCnt") or "").isdigit():
                    p, s = int(r["nowPrice"]), int(r["listedStockCnt"]); live[r["code"]] = (p, s); tot += p * s
            mcap[m] = round(tot / 1e8)
        asof = os.environ.get("SEMI_CAPS_ASOF") or last_trading_day(); src = "naver"
    prev_total = share.get("marketTotal", {})
    for m in ("KOSPI", "KOSDAQ"):
        if not mcap.get(m) or (prev_total.get(m) and abs(mcap[m] / prev_total[m] - 1) > 0.3):
            print(f"[ABORT] {m} 시장 합계 이상: 새 {mcap.get(m)} / 이전 {prev_total.get(m)} — 파일을 바꾸지 않음"); return 1
    want = [r for r in caps["rows"] if (src == "krx" or r["m"] in ("KOSPI", "KOSDAQ"))]; hit = [r for r in want if r["c"] in live]
    if len(hit) < len(want) * 0.95:
        print(f"[ABORT] 명단 적중 {len(hit)}/{len(want)} — 파일을 바꾸지 않음"); return 1
    for r in caps["rows"]:
        if r["c"] in live:
            p, s_ = live[r["c"]]; r["p"], r["s"], r["cap"] = p, s_, round(p * s_ / 1e8)
        if src == "krx":
            r["q1"], r["q2"] = pq[0].get(r["c"]) or r.get("q1"), pq[1].get(r["c"]) or r.get("q2")
    if src == "krx": caps["prev"] = list(prev)
    caps["rows"].sort(key=lambda r: -(r["cap"] or 0)); caps["asOf"] = asof; caps["src"] = src
    caps["source"] = ("시가총액·종가·상장주식 수: 한국거래소(KRX) Open API 일별매매정보(" + asof + " 종가, 보통주). 이전 분기 말 종가: 같은 API(수정주가 아님)" if src == "krx"
                      else re.sub(r"\(\d{4}-\d{2}-\d{2} 종가\)", f"({asof} 종가)", caps["source"]))
    caps["updated"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    # 업종별 시장 비중(semi_share.js)
    firms = caps["rows"]; den = sum(mcap.values()) if src == "krx" else mcap["KOSPI"] + mcap["KOSDAQ"]
    def agg(fs, d):
        have = sorted([f for f in fs if f["cap"]], key=lambda f: -f["cap"]); cap = sum(f["cap"] for f in have)
        return {"n": len(fs), "nCap": len(have), "cap": cap, "share": round(cap / d, 6) if d else None, "top": [{"n": f["n"], "cap": f["cap"]} for f in have[:3]]}
    share["groups"] = {"전체": agg(firms, den), **{k: agg([f for f in firms if f["k"] == k], den) for k in KINDS}}
    for m in ("KOSPI", "KOSDAQ"):
        fs = [f for f in firms if f["m"] == m]
        share["markets"][m] = {**agg(fs, mcap[m]), "mcap": mcap[m], "kinds": {k: agg([f for f in fs if f["k"] == k], mcap[m]) for k in KINDS}}
    share["marketTotal"] = {m: mcap[m] for m in ("KOSPI", "KOSDAQ")}
    share["asOf"] = asof; share["konexIncluded"] = src == "krx"
    share["source"] = ("한국거래소(KRX) Open API 일별매매정보 시가총액(" + asof + " 종가), 보통주 기준" if src == "krx" else re.sub(r"\(\d{4}-\d{2}-\d{2} 종가\)", f"({asof} 종가)", share["source"]))
    if src == "krx": share["marketTotal"]["KONEX"] = mcap["KONEX"]
    j = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    CAPS.write_text("// 기업별 시가총액·주가(검토용 집계). scripts/update_semi_caps.py 가 매일 갱신합니다. 직접 수정하지 마세요.\nwindow.SEMI_CAPS = " + j(caps) + ";\n", encoding="utf-8")
    head = SHARE.read_text(encoding="utf-8").split("\n", 1)[0]
    SHARE.write_text(head + "\nwindow.SEMI_SHARE = " + j(share) + ";\n", encoding="utf-8")
    print(f"[semi-caps:{src}] asOf {asof} 적중 {len(hit)}/{len(want)} 소부장 {share['groups']['전체']['cap']:,}억 비중 {share['groups']['전체']['share'] * 100:.2f}% 코스피 {mcap['KOSPI']:,}억 코스닥 {mcap['KOSDAQ']:,}억")
    return 0


if __name__ == "__main__": sys.exit(main())
