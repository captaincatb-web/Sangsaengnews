"""API 키 없이 쓰는 추가 뉴스 검색: 네이버·다음 뉴스 검색 결과 페이지

포털 검색은 구글 뉴스가 잘 다루지 않는 국내 매체(전문지·지역지·인터넷 매체)까지 찾아 준다.
공식 API가 아니어서 결과 페이지 구조가 바뀌면 0건이 될 수 있는데, 이때도 다른 소스로 계속 동작하고
수집 로그(소스별 건수)로만 드러난다.
"""
import html
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import requests

KST = timezone(timedelta(hours=9))
REQUEST_TIMEOUT = 20
BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
}

NAVER_SEARCH_URL = "https://search.naver.com/search.naver"
DAUM_SEARCH_URL = "https://search.daum.net/search"

TAG_RE = re.compile(r"<[^>]+>")
RELATIVE_TIME_RE = re.compile(r"^(\d+)\s*(분|시간|일|주)\s*전$")
ABSOLUTE_DATE_RE = re.compile(r"^(\d{4})\.(\d{1,2})\.(\d{1,2})\.?$")
TIME_LABEL_RE = re.compile(r">\s*(\d+\s*(?:분|시간|일|주)\s*전|\d{4}\.\d{1,2}\.\d{1,2}\.?)\s*<")
TIME_UNITS = {"분": "minutes", "시간": "hours", "일": "days", "주": "weeks"}

# 네이버: 언론사명(.prof) → 시각 → 제목(.tit) 순으로 나온다
NAVER_TITLE_RE = re.compile(r'href="([^"]+)"[^>]*data-heatmap-target="\.tit"[^>]*>(.*?)</a>', re.S)
NAVER_PRESS_RE = re.compile(r"^[^>]*>\s*<span[^>]*>([^<]+)</span>")
# 다음: 기사 1건이 <li data-docid=...> 하나, 링크 v.daum.net/v/YYYYMMDDHHMMSS... 에 게재 시각이 들어 있다
DAUM_TITLE_RE = re.compile(r'<strong class="tit-g[^"]*">\s*<a href="([^"]+)"[^>]*>(.*?)</a>', re.S)
DAUM_PRESS_RE = re.compile(r'<strong class="tit_item"[^>]*title="([^"]+)"')
DAUM_LINK_TIME_RE = re.compile(r"/v/(\d{14})")
DAUM_SUBINFO_RE = re.compile(r'class="gem-subinfo">\s*<span class="txt_info">([^<]+)</span>')


def _text(fragment: str) -> str:
    return html.unescape(TAG_RE.sub("", fragment)).strip()


def parse_time_label(label: str, now: datetime):
    """'10분 전'·'3일 전'·'2026.09.14.' → (UTC 시각, 날짜만 정확한지)"""
    label = label.strip()
    m = RELATIVE_TIME_RE.match(label)
    if m:
        unit = m.group(2)
        return now - timedelta(**{TIME_UNITS[unit]: int(m.group(1))}), unit in ("일", "주")
    m = ABSOLUTE_DATE_RE.match(label)
    if m:
        y, mo, d = map(int, m.groups())
        return datetime(y, mo, d, 12, tzinfo=KST).astimezone(timezone.utc), True
    return None, False


def _search_query(terms: list, context: str = "") -> str:
    query = " | ".join(f'"{t}"' for t in terms)
    return f"{query} {context}".strip()


def parse_naver_news(page: str, now: datetime) -> list:
    items = []
    for chunk in page.split('data-heatmap-target=".prof"')[1:]:
        title_m = NAVER_TITLE_RE.search(chunk)
        press_m = NAVER_PRESS_RE.search(chunk)
        time_m = TIME_LABEL_RE.search(chunk)
        if not (title_m and press_m and time_m):
            continue  # 언론사 로고 칸 등 기사 본문이 없는 조각
        pub_date, date_only = parse_time_label(time_m.group(1), now)
        if not pub_date:
            continue
        title = _text(title_m.group(2)).replace("새 창 열림", "").strip()
        # 네이버는 긴 제목을 '...'으로 잘라 보낸다 → 다른 소스의 전체 제목이 있으면 그쪽을 대표로 쓴다
        truncated = title.endswith("...")
        if truncated:
            title = title[:-3].rstrip() + "…"
        items.append(
            {
                "title": title,
                "link": html.unescape(title_m.group(1)),
                "pub_date": pub_date,
                "source": _text(press_m.group(1)),
                "date_only": date_only,
                "truncated": truncated,
                "clean": True,
            }
        )
    return items


def parse_daum_news(page: str, now: datetime) -> list:
    items = []
    for chunk in page.split("<li data-docid=")[1:]:
        title_m = DAUM_TITLE_RE.search(chunk)
        if not title_m:
            continue
        link = html.unescape(title_m.group(1))
        stamp = DAUM_LINK_TIME_RE.search(link)
        date_only = False
        if stamp:
            pub_date = datetime.strptime(stamp.group(1), "%Y%m%d%H%M%S").replace(tzinfo=KST).astimezone(timezone.utc)
        else:
            label = DAUM_SUBINFO_RE.search(chunk)
            pub_date, date_only = parse_time_label(label.group(1), now) if label else (None, False)
        if not pub_date:
            continue
        press_m = DAUM_PRESS_RE.search(chunk)
        items.append(
            {
                "title": _text(title_m.group(2)),
                "link": link.replace("http://v.daum.net/", "https://v.daum.net/"),
                "pub_date": pub_date,
                "source": html.unescape(press_m.group(1)) if press_m else "다음뉴스",
                "date_only": date_only,
                "truncated": False,
                "clean": True,
            }
        )
    return items


def _get(url: str, params: dict):
    resp = requests.get(url, params=params, headers=BROWSER_HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.text


def fetch_naver_news(terms: list, context: str = "", pages: int = 1, now: datetime | None = None) -> list:
    """네이버 뉴스 검색 (최신순, 최근 1개월). 문맥어가 없으면 제목 검색으로 회사명이 제목에 든 기사만 받는다."""
    now = now or datetime.now(timezone.utc)
    area = "all" if context else "t"
    items = []
    for page in range(pages):
        params = {
            "where": "news",
            "query": _search_query(terms, context),
            "sort": "1",
            "nso": f"so:dd,p:1m,a:{area}",
            "start": str(page * 10 + 1),
        }
        try:
            found = parse_naver_news(_get(NAVER_SEARCH_URL, params), now)
        except requests.RequestException as e:
            print(f"[naver_web] '{terms[0]}' 조회 실패: {e}")
            break
        items.extend(found)
        if len(found) < 10:
            break
    return items


def fetch_daum_news(terms: list, context: str = "", pages: int = 1, now: datetime | None = None) -> list:
    """다음 뉴스 검색 (최신순, 최근 1개월)"""
    now = now or datetime.now(timezone.utc)
    items = []
    for page in range(1, pages + 1):
        params = {"w": "news", "q": _search_query(terms, context), "sort": "recency", "period": "m", "p": str(page)}
        try:
            found = parse_daum_news(_get(DAUM_SEARCH_URL, params), now)
        except requests.RequestException as e:
            print(f"[daum_web] '{terms[0]}' 조회 실패: {e}")
            break
        items.extend(found)
        if len(found) < 10:
            break
    return items


def google_news_url(query: str, days: int, lang: str = "ko") -> str:
    if lang == "en":
        return f"https://news.google.com/rss/search?q={quote(query)}+when:{days}d&hl=en-US&gl=US&ceid=US:en"
    return f"https://news.google.com/rss/search?q={quote(query)}+when:{days}d&hl=ko&gl=KR&ceid=KR:ko"
