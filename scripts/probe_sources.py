"""포털 뉴스 검색 파라미터 점검 (GitHub Actions에서 실행)

네이버·다음 뉴스 검색의 기간·제목검색·OR·페이지 파라미터가 실제로 먹히는지,
src/news_sources.py 의 파서가 몇 건을 읽는지 확인해 newsletter-out/probe/report.txt 에 남긴다.
"""
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, ".")
from src.news_sources import (  # noqa: E402
    BROWSER_HEADERS,
    DAUM_SEARCH_URL,
    NAVER_SEARCH_URL,
    parse_daum_news,
    parse_naver_news,
)

OUT = Path("newsletter-out/probe")
OUT.mkdir(parents=True, exist_ok=True)
NOW = datetime.now(timezone.utc)
report = []


def log(*a):
    line = " ".join(str(x) for x in a)
    print(line, flush=True)
    report.append(line)


def run(name, url, params, parser, term):
    try:
        r = requests.get(url, params=params, headers=BROWSER_HEADERS, timeout=20)
    except requests.RequestException as e:
        log(f"[{name}] ERROR {e}")
        return
    items = parser(r.text, NOW)
    in_title = sum(1 for i in items if term in i["title"])
    dates = sorted(i["pub_date"] for i in items)
    span = f"{dates[0]:%m-%d}~{dates[-1]:%m-%d}" if dates else "-"
    log(f"[{name}] {r.status_code} items={len(items)} title_has={in_title} span={span} len={len(r.text)}")
    for i in items[:4]:
        log(f"   - {i['title'][:60]} | {i['source']} | {i['pub_date']:%m-%d %H:%M} | trunc={i['truncated']}")
    if not items:
        (OUT / f"{name}.txt").write_text(r.text[:300000], encoding="utf-8")
    time.sleep(0.8)


for term, alias in [("유진테크", None), ("한국알박", None), ("원익IPS", "원익아이피에스")]:
    q = f'"{term}"'
    q_or = f'"{term}" | "{alias}"' if alias else q
    log(f"\n===== {term} =====")
    naver = [
        ("N1_base", {"where": "news", "query": q, "sort": "1"}),
        ("N2_title_1m", {"where": "news", "query": q, "sort": "1", "nso": "so:dd,p:1m,a:t"}),
        ("N3_all_1m", {"where": "news", "query": q, "sort": "1", "nso": "so:dd,p:1m,a:all"}),
        ("N4_field1", {"where": "news", "query": q, "sort": "1", "field": "1", "pd": "2"}),
        ("N5_title_1m_p2", {"where": "news", "query": q, "sort": "1", "nso": "so:dd,p:1m,a:t", "start": "11"}),
        ("N6_or_title", {"where": "news", "query": q_or, "sort": "1", "nso": "so:dd,p:1m,a:t"}),
    ]
    for name, params in naver:
        run(f"{term}_{name}", NAVER_SEARCH_URL, params, parse_naver_news, term)
    daum = [
        ("D1_week", {"w": "news", "q": q, "sort": "recency", "period": "w"}),
        ("D2_month", {"w": "news", "q": q, "sort": "recency", "period": "m"}),
        ("D3_month_p2", {"w": "news", "q": q, "sort": "recency", "period": "m", "p": "2"}),
        ("D4_or", {"w": "news", "q": q_or, "sort": "recency", "period": "m"}),
    ]
    for name, params in daum:
        run(f"{term}_{name}", DAUM_SEARCH_URL, params, parse_daum_news, term)

log("\n===== 문맥어 (동명이인 회사) =====")
run("테스_naver_ctx", NAVER_SEARCH_URL, {"where": "news", "query": '"테스" 반도체', "sort": "1", "nso": "so:dd,p:1m,a:all"}, parse_naver_news, "테스")
run("테스_daum_ctx", DAUM_SEARCH_URL, {"w": "news", "q": '"테스" 반도체', "sort": "recency", "period": "m"}, parse_daum_news, "테스")
run("케이씨_naver_title", NAVER_SEARCH_URL, {"where": "news", "query": '"케이씨"', "sort": "1", "nso": "so:dd,p:1m,a:t"}, parse_naver_news, "케이씨")

(OUT / "report.txt").write_text("\n".join(report), encoding="utf-8")
