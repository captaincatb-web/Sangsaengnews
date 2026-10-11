"""뉴스 소스 후보를 실제로 호출해 응답 상태·건수·샘플을 기록하는 탐색 스크립트 (GitHub Actions에서 실행)"""
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote

import feedparser
import requests

OUT = Path("newsletter-out/probe")
OUT.mkdir(parents=True, exist_ok=True)
UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
}
report = []


def log(*a):
    line = " ".join(str(x) for x in a)
    print(line)
    report.append(line)


def get(name, url, headers=None, save=True, encoding=None):
    try:
        r = requests.get(url, headers={**UA, **(headers or {})}, timeout=20)
        if encoding:
            r.encoding = encoding
        text = r.text
        log(f"[{name}] {r.status_code} {r.headers.get('content-type','')} len={len(text)} url={url[:150]}")
        if save:
            (OUT / f"{name}.txt").write_text(text[:300000], encoding="utf-8")
        return r.status_code, text
    except Exception as e:
        log(f"[{name}] ERROR {type(e).__name__}: {e}")
        return None, ""


def feed_summary(name, text):
    f = feedparser.parse(text)
    dates = [e.get("published", e.get("updated", "")) for e in f.entries]
    log(f"   feed entries={len(f.entries)} first={dates[:1]} last={dates[-1:]}")
    for e in f.entries[:3]:
        log(f"   - {e.get('title','')[:70]} | {e.get('link','')[:110]}")


q = "심텍"
# 1) Bing 뉴스 RSS
for name, url in [
    ("bing_ko", f"https://www.bing.com/news/search?q=%22{quote(q)}%22&format=rss&setlang=ko-KR&cc=KR&count=50"),
    ("bing_ko_week", f"https://www.bing.com/news/search?q=%22{quote(q)}%22&format=rss&setlang=ko-KR&cc=KR&qft=interval%3d%228%22&count=50"),
    ("bing_en_amat", "https://www.bing.com/news/search?q=%22Applied+Materials%22&format=rss&setlang=en-US&cc=US&count=50"),
]:
    s, t = get(name, url)
    if s == 200:
        feed_summary(name, t)
    time.sleep(1)

# 2) 네이버 뉴스 검색 (pd=1 1주? pd=2 1개월? 둘 다 확인)
for name, url in [
    ("naver_search_pd1", f"https://search.naver.com/search.naver?where=news&query=%22{quote(q)}%22&sort=1&pd=1"),
    ("naver_search_pd2", f"https://search.naver.com/search.naver?where=news&query=%22{quote(q)}%22&sort=1&pd=2"),
    ("naver_m_search", f"https://m.search.naver.com/search.naver?where=m_news&query=%22{quote(q)}%22&sort=1&pd=1"),
    ("naver_old_rss", f"http://newssearch.naver.com/search.naver?where=rss&query={quote(q)}"),
]:
    s, t = get(name, url)
    if s == 200:
        log(f"   '{q}' occurrences={t.count(q)} news_tit={t.count('news_tit')} sds={t.count('sds-comps')} a_tags={t.count('<a ')}")
    time.sleep(1)

# 3) 네이버 증권 종목 뉴스
code = "222800"
s, t = get("naver_fin_html", f"https://finance.naver.com/item/news_news.naver?code={code}&page=1&sm=title_entity_id.basic&clusterId=",
           headers={"Referer": f"https://finance.naver.com/item/news.naver?code={code}"}, encoding="euc-kr")
if s == 200:
    log(f"   tit count={t.count('class=\"tit\"')} title td={t.count('class=\"title\"')}")
for name, url in [
    ("naver_mstock_json", f"https://m.stock.naver.com/api/news/stock/{code}?pageSize=20&page=1"),
    ("naver_mstock_json2", f"https://m.stock.naver.com/front-api/news/list?category=stock&itemCode={code}&page=1&pageSize=20"),
]:
    s, t = get(name, url, headers={"Referer": "https://m.stock.naver.com/"})
    if s == 200:
        try:
            j = json.loads(t)
            log(f"   json type={type(j).__name__} keys={list(j)[:8] if isinstance(j, dict) else len(j)}")
            log(f"   sample={json.dumps(j, ensure_ascii=False)[:600]}")
        except ValueError:
            log("   not json")
    time.sleep(1)

# 4) 다음 뉴스 검색
for name, url in [
    ("daum_search", f"https://search.daum.net/search?w=news&q=%22{quote(q)}%22&sort=recency&period=w"),
    ("daum_search_m", f"https://m.search.daum.net/search?w=news&q=%22{quote(q)}%22&sort=recency&period=w"),
]:
    s, t = get(name, url)
    if s == 200:
        log(f"   '{q}' occurrences={t.count(q)} a_tags={t.count('<a ')}")
    time.sleep(1)

# 5) 구글 뉴스 영문 (해외 기업)
s, t = get("gnews_en_amat", "https://news.google.com/rss/search?q=%22Applied+Materials%22+when:14d&hl=en-US&gl=US&ceid=US:en")
if s == 200:
    feed_summary("gnews_en_amat", t)

# 6) 업계 매체 RSS 후보
CANDIDATES = {
    "kipost": "https://www.kipost.net/rss/allArticle.xml",
    "epnc": "https://www.epnc.co.kr/rss/allArticle.xml",
    "kidd": "https://www.kidd.co.kr/rss/allArticle.xml",
    "theguru": "https://www.theguru.co.kr/rss/allArticle.xml",
    "yna_industry": "https://www.yna.co.kr/rss/industry.xml",
    "yna_economy": "https://www.yna.co.kr/rss/economy.xml",
    "hankyung_it": "https://www.hankyung.com/feed/it",
    "hankyung_economy": "https://www.hankyung.com/feed/economy",
    "mt": "https://rss.mt.co.kr/mt_news.xml",
    "etoday": "https://rss.etoday.co.kr/eto/etoday_news_all.xml",
    "digitaltoday": "https://www.digitaltoday.co.kr/rss/allArticle.xml",
    "pinpoint": "https://www.pinpointnews.co.kr/rss/allArticle.xml",
    "ceoeconomy": "https://www.ceoeconomy.com/rss/allArticle.xml",
    "cbci": "https://www.cbci.co.kr/rss/allArticle.xml",
    "etnews_all": "https://rss.etnews.com/Section901.xml",
    "newsis_economy": "https://newsis.com/RSS/economy.xml",
    "edaily": "https://rss.edaily.co.kr/edaily_news.xml",
    "dt": "https://www.dt.co.kr/rss/all.xml",
    "ddaily": "https://www.ddaily.co.kr/rss/allArticle.xml",
    "businesspost": "https://www.businesspost.co.kr/rss",
    "sedaily": "https://www.sedaily.com/rss/newsall",
    "asiae": "https://www.asiae.co.kr/rss/all.htm",
    "newspim": "https://www.newspim.com/rss",
    "mk_industry": "https://www.mk.co.kr/rss/50100032/",
}
for name, url in CANDIDATES.items():
    s, t = get("rss_" + name, url, save=False)
    if s == 200:
        feed_summary(name, t)
    time.sleep(0.5)

(OUT / "report.txt").write_text("\n".join(report), encoding="utf-8")
