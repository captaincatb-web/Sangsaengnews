"""해외 반도체 소부장 기업 마스터 + 재무정보 자동수집(파일럿) → site/data/peers.js

- 대상: scripts/peers_master.csv(기업 마스터: 국가·티커·소부장 분류·주력/보조 분야). 국가·출처 열로 수집기를 고른다.
  · dart: 한국 대형사, DART 연결재무제표(CFS)
  · sec : 미국, SEC EDGAR XBRL(peers_sec.py). 클라우드에서 막히면(403) 이후 전부 야후 파이낸스로 대체
  · yf  : 일본·유럽·이스라엘·중국 등, 야후 파이낸스 연간·분기 재무제표(비공식)
- 원래 통화 값(loc, 백만 단위)과 원화 환산값(억원)을 따로 저장한다. 환율은 ECB 기준(frankfurter):
  손익은 회계연도 평균, 재무상태표는 결산일(직전 영업일) 환율. 환율과 출처를 함께 남긴다.
- 값이 없으면 0 이 아니라 빈 값(null)으로 둔다. 회사마다 수집 상태(확보·일부 확보·미확보·파싱 실패·접속 실패)와 이유를 남긴다.
- 결과는 `[peers-json]` 한 줄로도 출력한다(Actions 로그에서 회수).
"""
import csv
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

import build_company_profiles as bcp
import build_financials as bf
import peers_sec as sec

ROOT_DIR = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT_DIR / "site" / "data" / "peers.js"
MASTER_PATH = Path(__file__).resolve().parent / "peers_master.csv"
FX_HOSTS = ["https://api.frankfurter.dev/v1", "https://api.frankfurter.app"]
FX_SRC = "ECB 기준환율(frankfurter)"
UNIT = {"USD": "백만 달러", "JPY": "백만 엔", "EUR": "백만 유로", "CNY": "백만 위안", "KRW": "억 원"}

# SEC 티커 목록(www.sec.gov)은 클라우드 접속을 막는 경우가 있어 확인된 CIK 는 직접 둔다. 없으면 목록을 읽는다.
CIK = {"AMAT": 6951, "LRCX": 707549, "KLAC": 319201, "TER": 97210, "MKSI": 1049502, "ENTG": 1101302,
       "GLW": 24741, "MU": 723125, "NVDA": 1045810, "INTC": 50863, "AMD": 2488, "TXN": 97476,
       "QCOM": 804328, "AVGO": 1730168}


def load_master() -> list:
    with MASTER_PATH.open(encoding="utf-8") as f:
        return [row for row in csv.DictReader(f) if row.get("id")]


# ---------- 환율 ----------

_fx_cache: dict = {}


def _fx_rates(cur: str, start: date, end: date) -> dict:
    key = (cur, start, end)
    if key in _fx_cache:
        return _fx_cache[key]
    rates = {}
    for host in FX_HOSTS:
        try:
            r = requests.get(f"{host}/{start}..{end}", params={"base": cur, "symbols": "KRW"}, timeout=(10, 30))
            r.raise_for_status()
            rates = {d: v["KRW"] for d, v in (r.json().get("rates") or {}).items() if "KRW" in v}
            if rates:
                break
        except (requests.RequestException, ValueError) as e:
            print(f"[fx] {host} {cur} {start}~{end} 실패: {e}")
    _fx_cache[key] = rates
    return rates


def fx_average(cur: str, start: date, end: date) -> float | None:
    """기간 평균 환율(1 cur = ? 원). 못 구하면 None."""
    if cur == "KRW":
        return 1.0
    r = _fx_rates(cur, start, end)
    return sum(r.values()) / len(r) if r else None


def fx_close(cur: str, day: date) -> float | None:
    """기준일 환율(재무상태표용). 휴일이면 직전 영업일 값."""
    if cur == "KRW":
        return 1.0
    r = _fx_rates(cur, day - timedelta(days=7), day)
    return r[max(r)] if r else None


def to_eok(v, rate):
    return bcp.eok(v * rate) if v is not None and rate else None


def mil(vals):
    return [round(v / 1e6) if v is not None else None for v in vals]


def assemble(m, src, url, cur, ends, vals, quarters=None, std=None):
    """원 통화 값 → 원화 환산 레코드. vals: {s,o,ni,rd(기간), ta,tl,te(시점)} 원 단위 리스트."""
    starts = [e - timedelta(days=364) for e in ends]
    avg = [fx_average(cur, s, e) for s, e in zip(starts, ends)]
    close = [fx_close(cur, e) for e in ends]
    rec = {"k": m["id"], "n": m["name"], "ctry": m["ctry"], "cat": m["cat"], "kind": m["dom_kind"], "seg1": m["seg1"], "seg2": m["seg2"],
           "tk": m["ticker"], "src": src, "url": url, "scope": "연결", "std": std, "cur": cur,
           "mt": sec.fy_end_month(ends[-1]), "y": [sec.fy_year(e) for e in ends], "pe": [e.isoformat() for e in ends]}
    for k in ("s", "o", "ni", "rd"):
        rec[k] = [to_eok(v, r) for v, r in zip(vals.get(k) or [None] * len(ends), avg)]
    for k in ("ta", "tl", "te"):
        rec[k] = [to_eok(v, r) for v, r in zip(vals.get(k) or [None] * len(ends), close)]
    if cur != "KRW":
        rec["fx"] = [round(r, 4 if r < 100 else 1) if r else None for r in avg]
        rec["fxb"] = [round(r, 4 if r < 100 else 1) if r else None for r in close]
        rec["fxs"] = FX_SRC
        rec["loc"] = {k: mil(vals.get(k) or [None] * len(ends)) for k in ("s", "o", "ni", "ta", "tl", "te")}
        rec["loc"]["unit"] = UNIT.get(cur, "백만 " + cur)
    if quarters:
        qr = [fx_average(cur, s, e) for s, e in zip(quarters["starts"], quarters["ends"])]
        rec["q"] = {"labels": quarters["labels"], **{k: [to_eok(v, r) for v, r in zip(quarters[k], qr)] for k in ("sales", "op", "net")}}
    return rec


# ---------- 미국(SEC EDGAR) ----------

class SecBlocked(Exception):
    pass


def build_sec(m, cik_map):
    ticker = m["code"]
    cik = CIK.get(ticker) or (cik_map or {}).get(ticker)
    if cik is None:
        return None, "파싱 실패: SEC 기업번호(CIK)를 찾지 못함"
    try:
        facts = sec.load_facts(cik)
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code in (403, 429):
            raise SecBlocked(str(e))
        raise
    got = sec.extract(facts, years=4)
    if not got:
        return None, "파싱 실패: 10-K 매출 항목 없음"
    url = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=10-K"
    q = got.get("q")
    quarters = {"labels": q["labels"], "starts": q["starts"], "ends": q["ends"], "sales": q["sales"], "op": q["op"], "net": q["net"]} if q else None
    return assemble(m, "SEC EDGAR", url, "USD", got["ends"], {k: got[k] for k in ("s", "o", "ni", "rd", "ta", "tl", "te")}, quarters, "US GAAP"), None


# ---------- 야후 파이낸스(비공식) ----------

def _row(df, names):
    for n in names:
        if df is not None and n in df.index:
            return df.loc[n]
    return None


def _val(series, col):
    if series is None:
        return None
    try:
        v = series[col]
    except (KeyError, TypeError):
        return None
    return None if v != v else float(v)  # NaN 은 값 없음


def build_yf(m, cur):
    import yfinance as yf
    ticker = m["ticker"]
    t = yf.Ticker(ticker)
    inc, bs, qinc = t.income_stmt, t.balance_sheet, t.quarterly_income_stmt
    if inc is None or inc.empty:
        return None, "미확보: 야후 파이낸스에 연간 재무제표 없음"
    rev = _row(inc, ["Total Revenue", "Operating Revenue"])
    if rev is None:
        return None, "파싱 실패: 매출 항목 없음"
    cols = [c for c in sorted(inc.columns) if _val(rev, c) is not None][-4:]  # 매출이 있는 최근 4개 회계연도
    if not cols:
        return None, "미확보: 매출 값 없음"
    ends = [c.date() for c in cols]
    get = lambda ser: [_val(ser, c) for c in cols]  # noqa: E731
    vals = {"s": get(rev), "o": get(_row(inc, ["Operating Income", "Total Operating Income As Reported"])),
            "ni": get(_row(inc, ["Net Income", "Net Income Common Stockholders"])), "rd": get(_row(inc, ["Research And Development"])),
            "ta": get(_row(bs, ["Total Assets"])), "tl": get(_row(bs, ["Total Liabilities Net Minority Interest"])),
            "te": get(_row(bs, ["Stockholders Equity", "Common Stock Equity"]))}
    quarters = None
    if qinc is not None and not qinc.empty:
        qrev = _row(qinc, ["Total Revenue", "Operating Revenue"])
        qc = [c for c in sorted(qinc.columns) if _val(qrev, c) is not None][-8:]
        qe = [c.date() for c in qc]
        lab = [sec.q_label(e) for e in qe]
        if qrev is not None and qc and len(set(lab)) == len(lab):
            quarters = {"labels": lab, "starts": [e - timedelta(days=90) for e in qe], "ends": qe, "sales": [_val(qrev, c) for c in qc],
                        "op": [_val(_row(qinc, ["Operating Income"]), c) for c in qc], "net": [_val(_row(qinc, ["Net Income"]), c) for c in qc]}
    fcur = None
    try:
        fcur = (t.info or {}).get("financialCurrency")
    except Exception:  # noqa: BLE001 - 통화 정보가 없으면 마스터 값을 쓴다
        pass
    url = f"https://finance.yahoo.com/quote/{ticker}/financials"
    return assemble(m, "Yahoo Finance", url, fcur or cur, ends, vals, quarters), None


def stock_snapshot(ticker: str, cur: str) -> dict | None:
    """주가 지표(야후): 시총은 억원 환산, 주가는 시세 통화. 1년·3개월 수익률과 흐름(시작=100)."""
    import yfinance as yf
    try:
        t = yf.Ticker(ticker)
        info = t.info or {}
        hist = t.history(period="1y")
    except Exception as e:  # yfinance 는 네트워크·형식 오류를 다양한 예외로 던진다
        print(f"[stock] {ticker} 실패: {e}")
        return None
    cur = info.get("currency") or cur
    c = hist["Close"].dropna() if len(hist) else None
    price = info.get("currentPrice") or info.get("regularMarketPrice") or (float(c.iloc[-1]) if c is not None and len(c) else None)
    if not price:
        return None
    rate = fx_average(cur, date.today() - timedelta(days=7), date.today())
    cap = info.get("marketCap")
    # 배당수익률(%): 연간 배당금 ÷ 주가로 계산(야후 dividendYield 는 버전마다 단위가 달라 쓰지 않는다)
    dr = info.get("dividendRate") or info.get("trailingAnnualDividendRate")
    roe = info.get("returnOnEquity")
    out = {"price": price, "cur": cur, "cap": bcp.eok(cap * rate) if cap and rate else None,
           "per": info.get("trailingPE"), "fper": info.get("forwardPE"), "pbr": info.get("priceToBook"),
           "dy": round(dr / price * 100, 2) if dr else None, "roe": roe * 100 if roe is not None else None,
           "hi52": info.get("fiftyTwoWeekHigh"), "lo52": info.get("fiftyTwoWeekLow"),
           "target": info.get("targetMeanPrice"), "rec": info.get("recommendationMean"), "emp": info.get("fullTimeEmployees"),
           "asof": date.today().isoformat()}
    if c is not None and len(c) > 63:
        out["r1y"] = round((float(c.iloc[-1]) / float(c.iloc[0]) - 1) * 100, 1)
        out["r3m"] = round((float(c.iloc[-1]) / float(c.iloc[-63]) - 1) * 100, 1)
        step = max(1, len(c) // 24)
        out["trend"] = [round(float(v) / float(c.iloc[0]) * 100, 1) for v in c.iloc[::step]]
    return {k: (round(v, 2) if isinstance(v, float) else v) for k, v in out.items() if v is not None and v == v}


# ---------- 한국(DART 연결) ----------

def cfs_rows(api_key, corp_code, year, reprt):
    data = bcp.call(api_key, "fnlttSinglAcntAll", corp_code=corp_code, bsns_year=str(year), reprt_code=reprt, fs_div="CFS")
    return (data or {}).get("list", [])


def build_dart(m, api_key):
    corp_code, this_year, fy = m["code"], datetime.now().year, {}
    for year in (this_year - 1, this_year - 2):
        rows = cfs_rows(api_key, corp_code, year, bcp.ANNUAL)
        if rows:
            fy.update(bcp.annual_by_year(rows, year))
            for y, vals in bcp.annual_by_year(cfs_rows(api_key, corp_code, year - 1, bcp.ANNUAL), year - 1).items():
                fy.setdefault(y, vals)
            break
    years = sorted(y for y, v in fy.items() if v.get("매출액") is not None)[-3:]
    if not years:
        return None, "미확보: DART 연결 사업보고서 없음"
    col = lambda k: [fy[y].get(k) for y in years]  # noqa: E731 - 원 단위
    cum = {}
    for year in (this_year - 2, this_year - 1, this_year):
        for code, q in bf.QUARTER_CODES:
            if year == this_year and q == 4:
                continue
            rows = cfs_rows(api_key, corp_code, year, code)
            if rows:
                cum[(year, q)] = bcp.quarter_values(rows)
    rec = assemble(m, "DART 연결", f"https://dart.fss.or.kr/dsab007/main.do?option=corp&textCrpNm={m['name']}", "KRW",
                   [date(y, 12, 31) for y in years],
                   {"s": col("매출액"), "o": col("영업이익"), "ni": col("당기순이익"), "ta": col("총자산"), "tl": col("부채총계"), "te": col("자본총계")},
                   None, "K-IFRS")
    rec["q"] = bf.quarters_from_cumulative(cum, 8)
    return rec, None


# ---------- 상태·커버리지 ----------

def status_of(rec):
    """최근 회계연도 기준: 매출·영업이익·순이익이 모두 있으면 확보, 일부만 있으면 일부 확보."""
    L = len(rec["y"]) - 1
    miss = [nm for k, nm in (("s", "매출"), ("o", "영업이익"), ("ni", "순이익")) if rec[k][L] is None]
    if not miss:
        return "확보", ""
    return "일부 확보", "최근 연도 " + "·".join(miss) + " 항목 없음(미공시 또는 출처에 없음)"


def clean(x):
    """NaN·무한대는 JSON 에 넣지 않는다(화면에서는 '-'와 이유로 표시)."""
    if isinstance(x, float):
        return x if x == x and x not in (float("inf"), float("-inf")) else None
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items()}
    if isinstance(x, list):
        return [clean(v) for v in x]
    return x


# ---------- 실행 ----------

def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)
    api_key = os.environ.get("DART_API_KEY")
    only = {x for x in os.environ.get("PEERS_ONLY", "").split(",") if x}  # 시험용: 국가 코드나 id 만
    master = [m for m in load_master() if not only or m["ctry"] in only or m["id"] in only]
    out, log, cik_map, sec_ok = [], [], None, True
    collected = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for m in master:
        rec, why, src = None, "", m["source"]
        try:
            if src == "dart":
                if not api_key:
                    raise RuntimeError("DART_API_KEY 없음")
                rec, why = build_dart(m, api_key)
            elif src == "sec" and sec_ok:
                try:
                    if m["code"] not in CIK and cik_map is None:
                        cik_map = sec.load_cik_map()
                    rec, why = build_sec(m, cik_map)
                except (SecBlocked, requests.HTTPError) as e:
                    print(f"[peers] SEC 접속 차단({e}) - 이후 미국 기업은 야후 파이낸스로 대체")
                    sec_ok = False
            if rec is None and (src == "yf" or (src == "sec" and not sec_ok)):
                rec, why = build_yf(m, m["cur"])
        except bcp.DartUnreachable as e:
            why = f"접속 실패: DART({e})"
        except Exception as e:  # noqa: BLE001 - 한 회사의 실패가 전체를 멈추지 않게(yfinance 는 예외 종류가 다양하다)
            why = f"접속 실패: {e.__class__.__name__} {str(e)[:120]}"
        if rec:
            snap = stock_snapshot(m["ticker"], rec["cur"]) if m["ticker"] else None
            if snap:
                rec["mk"] = snap
            rec["st"], rec["why"] = status_of(rec)
            rec["at"] = collected
            out.append(rec)
            print(f"[peers] {m['name']}: {rec['st']} {rec['y']} 매출(억원) {rec['s']} ({rec['src']})")
        else:
            print(f"[peers] {m['name']}: {why or '미확보'}")
        log.append({"k": m["id"], "n": m["name"], "ctry": m["ctry"], "cat": m["cat"], "kind": m["dom_kind"], "seg1": m["seg1"], "tk": m["ticker"], "src": rec["src"] if rec else "-",
                    "st": rec["st"] if rec else (why.split(":")[0] if why else "미확보"), "why": (rec["why"] if rec else why) or ""})
    if not out:
        print("[peers] 수집된 기업이 없어 저장하지 않음")
        return 1
    payload = clean({"updated": datetime.now().strftime("%Y-%m-%d"), "at": collected, "master": log, "list": out,
                     "sec": "ok" if sec_ok else "blocked"})
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text("// scripts/build_peers.py 가 생성한 파일입니다. 직접 수정하지 마세요.\n"
                        f"window.PEERS = {text};\n", encoding="utf-8")
    print(f"[peers-json]{text}")
    ok = sum(1 for x in log if x["st"] == "확보")
    print(f"[peers] 대상 {len(log)}곳 · 확보 {ok} · 일부 {sum(1 for x in log if x['st'] == '일부 확보')} · 실패/미확보 {len(log) - len(out)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
