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


def _now():
    if os.environ.get("SEMI_CAPS_NOW"): return dt.datetime.fromisoformat(os.environ["SEMI_CAPS_NOW"]).replace(tzinfo=dt.timezone.utc)
    return dt.datetime.now(dt.timezone.utc)


def expected_trading_day(now=None):
    """지금(KST) 기준으로 시세 자료가 이미 있어야 하는 가장 최근 평일 = 오늘 이전의 마지막 평일. 공휴일은 알 수 없어 평일로만 센다(그래서 1일 차이는 '지연', 2일 이상은 '오래됨'으로 구분)."""
    d = ((now or _now()) + dt.timedelta(hours=9)).date() - dt.timedelta(days=1)
    while d.weekday() >= 5: d -= dt.timedelta(days=1)
    return d.isoformat()


def weekday_lag(asof, expected):
    """기준일 이후 expected 까지 지난 평일 수(0이면 최신)."""
    a, e = dt.date.fromisoformat(asof), dt.date.fromisoformat(expected); n = 0
    while a < e:
        a += dt.timedelta(days=1); n += 1 if a.weekday() < 5 else 0
    return n


def gh_out(**kv):
    """GitHub Actions 단계 출력(있을 때만)과 주석을 남긴다."""
    f = os.environ.get("GITHUB_OUTPUT")
    if f:
        with open(f, "a", encoding="utf-8") as fh:
            for k, v in kv.items(): fh.write(f"{k}={v}\n")


def session_open(now=None):
    """평일 08:00~20:00(KST)은 정규장·시간외·대체거래소가 열려 있어 현재가가 종가가 아닐 수 있다."""
    if os.environ.get("SEMI_CAPS_NOW"): now = dt.datetime.fromisoformat(os.environ["SEMI_CAPS_NOW"]).replace(tzinfo=dt.timezone.utc)
    kst = (now or dt.datetime.now(dt.timezone.utc)) + dt.timedelta(hours=9)
    return kst.weekday() < 5 and 8 <= kst.hour < 20


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
        for x in new: seen[code_of(x)] = 1; rows.append({"code": code_of(x), "nowPrice": x.get("nowPrice"), "listedStockCnt": x.get("listedStockCnt") or x.get("listedStockCount"), "marketStatus": x.get("marketStatus")})
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
        body = (r.text or "")[:200].replace(os.environ["KRX_API_KEY"], "***")  # 원인 구분용(응답 메시지만, 키는 가림)
        print(f"[KRX] {KRX_EP[market]} {bas} HTTP {r.status_code} {body} — 우회하지 않고 중단"); return None
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
    start = os.environ.get("SEMI_CAPS_ASOF") or (_now() + dt.timedelta(hours=9)).date().isoformat()  # 오늘부터 거슬러 올라가며 자료가 있는 마지막 거래일을 찾는다
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
        if session_open(): print("[SKIP] 거래 시간대(평일 08~20시 KST)라 네이버 현재가는 종가가 아님 — 갱신하지 않고 이전 값을 유지"); return 3
        try: lists = fetch_all()
        except Exception as e: print(f"[ABORT] 네이버 접속 실패({type(e).__name__}) — 파일을 바꾸지 않음(이전 값 유지)"); return 1
        live, mcap = {}, {}
        for m, rows in lists.items():
            tot = 0
            for r in rows:
                if str(r.get("nowPrice") or "").isdigit() and str(r.get("listedStockCnt") or "").isdigit():
                    p, s = int(r["nowPrice"]), int(r["listedStockCnt"]); live[r["code"]] = (p, s); tot += p * s
            mcap[m] = round(tot / 1e8)
        asof = os.environ.get("SEMI_CAPS_ASOF") or last_trading_day(_now()); src = "naver"
        # 네이버 현재가는 장중에는 실시간 값이라 종가가 아니다. 명단 종목 대부분이 장 마감(CLOSE) 상태일 때만 쓴다.
        roster = {r["c"] for r in caps["rows"] if r["m"] in ("KOSPI", "KOSDAQ")}
        st = [x.get("marketStatus") for rows in lists.values() for x in rows if x["code"] in roster]
        closed = sum(1 for v in st if v == "CLOSE")
        if not st or closed < len(roster) * 0.95:
            print(f"[SKIP] 장 마감 상태가 아님(CLOSE {closed}/{len(roster)}) — 장중 가격은 종가가 아니므로 갱신하지 않고 이전 값을 유지"); return 3
    exp = expected_trading_day(); lag = weekday_lag(asof, exp) if src == "krx" else 0  # 네이버 대체는 거래일을 확인할 수 없어 지연을 판단하지 않는다
    prev_asof = caps.get("asOf") or ""
    if prev_asof and asof < prev_asof:
        lag0 = weekday_lag(prev_asof, exp)
        gh_out(lag=lag0, asof=prev_asof, src=caps.get("src", ""), expected=exp, verified=str((caps.get("fresh") or {}).get("verified", False)).lower())
        print(f"[KEEP] 새 기준일 {asof} 이 기존 {prev_asof} 보다 오래됨 — 기존 값 유지(마지막 정상 거래일 기대 {exp}, 지연 {lag0}거래일)"); return 6
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
    core = [f for f in firms if f.get("g", "E") in ("E", "N")]  # 핵심 모집단만(별도 관리 종목은 managed 에 있어 rows 에 없음)
    firms = core; U = caps.get("universe") or {}
    if U: share["basis"] = f"국내 상장 소부장 핵심 모집단 {U['core']}개사(기존 {U['existing']} + 신규 {U['new']}). 시가총액은 확인된 종목만 합산"
    share["universe"] = U
    share["groups"] = {"전체": agg(firms, den), **{k: agg([f for f in firms if f["k"] == k], den) for k in KINDS}}
    # 분모·분자 구분: share 는 (KRX 기준) 코스피·코스닥·코넥스 전체 대비, shareKK 는 코스피·코스닥 소부장만 코스피·코스닥 전체 시총으로 나눈 값(코넥스 제외)
    denKK = mcap["KOSPI"] + mcap["KOSDAQ"]
    for gname, g in share["groups"].items():
        fs = firms if gname == "전체" else [f for f in firms if f["k"] == gname]
        capKK = sum(f["cap"] for f in fs if f["cap"] and f["m"] in ("KOSPI", "KOSDAQ")); g["shareKK"] = round(capKK / denKK, 6) if denKK else None
    share["denominator"] = {"share": "코스피·코스닥·코넥스 전체" if src == "krx" else "코스피·코스닥 전체", "shareKK": "코스피·코스닥 전체", "marketTotal": {k: v for k, v in mcap.items()}}
    share["konexN"] = sum(1 for f in firms if f["m"] == "KONEX")  # 모집단 안의 코넥스 종목 수(집계 값이 아니라 명단에서 센다)
    share["counts"] = {"population": len(firms), "withCap": sum(1 for f in firms if f["cap"]), "noCap": sum(1 for f in firms if not f["cap"]), "byMarket": dict(sorted(((m, sum(1 for f in firms if f["m"] == m)) for m in {f["m"] for f in firms})))}
    old = [f for f in firms if f.get("g", "E") == "E"]  # 기존 123 기준 값(연속성 비교용)
    share["legacy123"] = {"전체": agg(old, den), **{k: agg([f for f in old if f["k"] == k], den) for k in KINDS}}
    for m in ("KOSPI", "KOSDAQ"):
        fs = [f for f in firms if f["m"] == m]
        share["markets"][m] = {**agg(fs, mcap[m]), "mcap": mcap[m], "kinds": {k: agg([f for f in fs if f["k"] == k], mcap[m]) for k in KINDS}}
    share["marketTotal"] = {m: mcap[m] for m in ("KOSPI", "KOSDAQ")}
    share["asOf"] = asof; share["konexIncluded"] = src == "krx"
    share["source"] = ("한국거래소(KRX) Open API 일별매매정보 시가총액(" + asof + " 종가), 보통주 기준" if src == "krx" else re.sub(r"\(\d{4}-\d{2}-\d{2} 종가\)", f"({asof} 종가)", share["source"]))
    if src == "krx": share["marketTotal"]["KONEX"] = mcap["KONEX"]
    share["run"] = {"src": src, "asOf": asof, "collectedAt": caps["updated"]}
    j = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    CAPS.write_text("// 기업별 시가총액·주가(검토용 집계). scripts/update_semi_caps.py 가 매일 갱신합니다. 직접 수정하지 마세요.\nwindow.SEMI_CAPS = " + j(caps) + ";\n", encoding="utf-8")
    head = SHARE.read_text(encoding="utf-8").split("\n", 1)[0]
    SHARE.write_text(head + "\nwindow.SEMI_SHARE = " + j(share) + ";\n", encoding="utf-8")
    caps["fresh"] = {"expected": exp, "lag": lag, "verified": src == "krx"}; share["run"] = {**share.get("run", {}), **caps["fresh"]}
    SHARE.write_text(SHARE.read_text(encoding="utf-8").split("\n", 1)[0] + "\nwindow.SEMI_SHARE = " + j(share) + ";\n", encoding="utf-8")
    CAPS.write_text("// 기업별 시가총액·주가(검토용 집계). scripts/update_semi_caps.py 가 매일 갱신합니다. 직접 수정하지 마세요.\nwindow.SEMI_CAPS = " + j(caps) + ";\n", encoding="utf-8")
    gh_out(lag=lag, asof=asof, src=src, expected=exp, verified=str(src == "krx").lower())
    if lag >= 2: print(f"::warning::시세 기준일 {asof} 이 기대 거래일 {exp} 보다 {lag}거래일 오래됨(KRX 게시 지연 또는 갱신 문제)")
    elif lag == 1: print(f"::notice::시세 기준일 {asof} 이 기대 거래일 {exp} 보다 1거래일 오래됨(휴장일이거나 KRX 게시 지연 — 보조 실행에서 재확인)")
    print(f"[semi-caps:{src}] asOf {asof} 적중 {len(hit)}/{len(want)} 소부장 {share['groups']['전체']['cap']:,}억 비중 {share['groups']['전체']['share'] * 100:.2f}% 코스피 {mcap['KOSPI']:,}억 코스닥 {mcap['KOSDAQ']:,}억")
    return 5 if lag >= 2 else 4 if lag == 1 else 0


if __name__ == "__main__": sys.exit(main())
