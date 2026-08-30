import html
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote

import feedparser
import requests

from src.config import SEARCH_QUERIES

NAVER_NEWS_URL = "https://openapi.naver.com/v1/search/news.json"
GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss/search?q={query}&hl=ko&gl=KR&ceid=KR:ko"
REQUEST_TIMEOUT = 10


def strip_tags(text: str) -> str:
    return html.unescape(re.sub(r"</?b>", "", text))


def normalize_title(title: str) -> str:
    # Google 뉴스 제목 끝에 붙는 " - 언론사명" 접미사를 제거해 같은 기사를 다른 소스로 받아도 중복 탐지되게 함
    without_suffix = re.sub(r"\s*-\s*[^-]+$", "", title)
    return re.sub(r"[^0-9a-zA-Z가-힣]", "", without_suffix).lower()


def fetch_naver_news(query: str, client_id: str, client_secret: str, display: int = 20) -> list:
    headers = {"X-Naver-Client-Id": client_id, "X-Naver-Client-Secret": client_secret}
    params = {"query": query, "display": display, "sort": "date"}
    try:
        resp = requests.get(NAVER_NEWS_URL, headers=headers, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"[naver] '{query}' 조회 실패: {e}")
        return []

    articles = []
    for item in resp.json().get("items", []):
        try:
            pub_date = parsedate_to_datetime(item["pubDate"])
        except (KeyError, TypeError, ValueError):
            continue
        articles.append(
            {
                "title": strip_tags(item["title"]),
                "description": strip_tags(item.get("description", "")),
                "link": item.get("originallink") or item["link"],
                "pub_date": pub_date,
                "source": "naver",
            }
        )
    return articles


def fetch_google_news(query: str) -> list:
    url = GOOGLE_NEWS_RSS_URL.format(query=quote(query))
    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"[google] '{query}' 조회 실패: {e}")
        return []

    feed = feedparser.parse(resp.content)
    articles = []
    for entry in feed.entries:
        if not getattr(entry, "published_parsed", None):
            continue
        pub_date = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
        source = entry.get("source", {})
        press = source.get("title", "") if isinstance(source, dict) else ""
        articles.append(
            {
                "title": entry.title,
                "description": press,
                "link": entry.link,
                "pub_date": pub_date,
                "source": "google",
            }
        )
    return articles


def collect_all(naver_client_id: str, naver_client_secret: str) -> list:
    seen_links = set()
    seen_titles = set()
    articles = []

    for query in SEARCH_QUERIES:
        results = fetch_naver_news(query, naver_client_id, naver_client_secret) + fetch_google_news(query)
        for article in results:
            norm_title = normalize_title(article["title"])
            if article["link"] in seen_links or norm_title in seen_titles:
                continue
            seen_links.add(article["link"])
            seen_titles.add(norm_title)
            articles.append(article)

    articles.sort(key=lambda a: a["pub_date"], reverse=True)
    return articles
