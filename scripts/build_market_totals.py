"""코스피·코스닥 시장 전체 시가총액 수집 → site/data/market_totals.js ('시장 비중' 화면의 분모)

- 네이버증권(stock.naver.com) 시장 목록(/api/domestic/market/stock/default)을 쪽 단위로 끝까지 읽어, 종목마다 현재가 × 상장주식 수를 더한다.
  우선주·ETF·리츠 등 모든 증권유형을 포함한다(한국거래소 시장 합계와 같은 범위).
- 쪽 넘김: startIdx 를 쪽 번호로 쓴다. 0 과 1 이 같은 쪽이면 1부터 세는 번호(→2, 3, …), 전부 새 종목이면 0부터 세는 번호로 본다.
- 공식 API 가 아니다. 403·429·리다이렉트·접속 실패가 나오면 우회하지 않고 중단하고 파일을 쓰지 않는다(배포는 저장해 둔 값을 쓴다).
- 한국거래소 공식 시장 합계와는 출처 차이로 1~2% 다를 수 있다(2026-10-30 시험: 코스피 -1.6%, 코스닥 -1.0%). 화면에 이 점을 적는다.
- 결과는 `[totals-json]` 한 줄로도 출력한다.
"""
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

ROOT_DIR = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT_DIR / "site" / "data" / "market_totals.js"
BASE = "https://stock.naver.com"
PATH = "/api/domestic/market/stock/default"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; Sangsaengnews research)", "Accept": "application/json", "Referer": "https://stock.naver.com/"}
PAGE = 100
MAX_PAGES = 60


class Blocked(Exception):
    pass


def items_of(j):
    """응답 어디에 있든 itemcode 를 가진 dict 목록."""
    if isinstance(j, list):
        if j and isinstance(j[0], dict) and ("itemcode" in j[0] or "itemCode" in j[0]):
            return j
        for x in j:
            r = items_of(x)
            if r:
                return r
    elif isinstance(j, dict):
        for v in j.values():
            r = items_of(v)
            if r:
                return r
    return []


def code_of(x):
    return x.get("itemcode") or x.get("itemCode")


def fetch(market, start):
    r = requests.get(BASE + PATH, params={"tradeType": "KRX", "marketType": market, "orderType": "marketSum", "pageSize": PAGE, "startIdx": start},
                     headers=HEADERS, timeout=(5, 20), allow_redirects=False)
    time.sleep(0.3)
    if r.status_code in (403, 429) or 300 <= r.status_code < 400:
        raise Blocked(f"HTTP {r.status_code}")
    r.raise_for_status()
    return items_of(r.json())


def collect(market):
    seen, rows = {}, []

    def take(its):
        new = [x for x in its if code_of(x) not in seen]
        for x in new:
            seen[code_of(x)] = 1
            rows.append(x)
        return len(new)

    r0 = fetch(market, 0)
    if not r0:
        return rows
    take(r0)
    r1 = fetch(market, 1)
    k0, k1 = {code_of(x) for x in r0}, {code_of(x) for x in r1}
    if k1 == k0:
        nxt, step = 2, 1
    elif k1 & k0:
        nxt, step = len(r0), len(r0)
        take(r1)
    else:
        nxt, step = 2, 1
        take(r1)
    for _ in range(MAX_PAGES):
        its = fetch(market, nxt)
        if not its or take(its) == 0:
            break
        nxt += step
    return rows


def total(rows):
    cap = shares = priced = 0
    for x in rows:
        p, n = str(x.get("nowPrice") or ""), str(x.get("listedStockCnt") or x.get("listedStockCount") or "")
        if p.isdigit() and n.isdigit():
            cap += int(p) * int(n)
            shares += int(n)
            priced += 1
    return {"cap": round(cap / 1e8), "n": len(rows), "priced": priced, "shares": shares}  # cap 은 억원


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)
    out = {}
    try:
        for m in ("KOSPI", "KOSDAQ"):
            rows = collect(m)
            out[m] = total(rows)
            print(f"[totals] {m}: {out[m]['n']}종목 · 시가총액 {out[m]['cap']:,}억원")
    except (Blocked, requests.RequestException, ValueError) as e:
        print(f"[totals] 수집 실패({e}) — 파일을 쓰지 않습니다")
        return 1
    if any(v["n"] < 500 or v["priced"] < v["n"] * 0.95 for v in out.values()):
        print("[totals] 종목 수나 가격 확보가 너무 적어 저장하지 않습니다(쪽 넘김 이상 의심)")
        return 1
    payload = {"updated": datetime.now().strftime("%Y-%m-%d"), "src": "네이버증권 시장 목록(현재가 × 상장주식 수, 모든 증권유형 포함)", **out}
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUT_PATH.write_text("// scripts/build_market_totals.py 가 생성한 파일입니다. 직접 수정하지 마세요.\n"
                        f"window.MARKET_TOTALS = {text};\n", encoding="utf-8")
    print(f"[totals-json]{text}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
