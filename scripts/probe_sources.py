"""네이버 뉴스 제목검색 점검 (GitHub Actions에서 실행)

73개사를 한 곳씩 일정 간격으로 조회해 PC·모바일 검색이 차단(403) 없이 되는지,
회사명이 제목에 든 최근 기사를 몇 건 찾는지 newsletter-out/probe/report.txt 에 남긴다.
"""
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

sys.path.insert(0, ".")
from src.news_sources import BROWSER_HEADERS, DAUM_SEARCH_URL, parse_daum_news, parse_naver_news  # noqa: E402
from src.newsletter_config import TARGET_GROUPS  # noqa: E402

OUT = Path("newsletter-out/probe")
OUT.mkdir(parents=True, exist_ok=True)
NOW = datetime.now(timezone.utc)
WEEK = NOW - timedelta(days=7)
report = []


def log(*a):
    line = " ".join(str(x) for x in a)
    print(line, flush=True)
    report.append(line)


def fetch(url, params, parser, term):
    try:
        r = requests.get(url, params=params, headers=BROWSER_HEADERS, timeout=20)
    except requests.RequestException as e:
        return f"ERR {type(e).__name__}", 0, 0, 0
    items = parser(r.text, NOW) if r.status_code == 200 else []
    titled = [i for i in items if term in i["title"]]
    fresh = [i for i in titled if i["pub_date"] >= WEEK]
    return r.status_code, len(items), len(titled), len(fresh)


companies = [c for g in TARGET_GROUPS for c in g["companies"]]
HOSTS = {
    "pc": ("https://search.naver.com/search.naver", "news"),
    "mobile": ("https://m.search.naver.com/search.naver", "m_news"),
}
for host, (url, where) in HOSTS.items():
    log(f"\n===== 네이버 {host} 제목검색 (1.0초 간격) =====")
    statuses, total_fresh, covered = {}, 0, 0
    started = time.monotonic()
    for company in companies:
        params = {"where": where, "query": f'"{company}"', "sort": "1", "field": "1"}
        status, n, titled, fresh = fetch(url, params, parse_naver_news, company)
        statuses[status] = statuses.get(status, 0) + 1
        total_fresh += fresh
        covered += fresh > 0
        log(f"{company}: {status} items={n} title={titled} fresh7={fresh}")
        time.sleep(1.0)
    log(f"--> {host}: 상태 {statuses}, 7일 기사 {total_fresh}건, 기사 있는 회사 {covered}곳, {time.monotonic() - started:.0f}초")

log("\n===== 다음 제목검색 후보 =====")
for name, q in [("intitle", 'intitle:"유진테크"'), ("title_op", 'title:"유진테크"'), ("plain", '"유진테크"')]:
    status, n, titled, fresh = fetch(DAUM_SEARCH_URL, {"w": "news", "q": q, "sort": "recency"}, parse_daum_news, "유진테크")
    log(f"daum {name}: {status} items={n} title={titled} fresh7={fresh}")
    time.sleep(1.0)

(OUT / "report.txt").write_text("\n".join(report), encoding="utf-8")
