"""뉴스 소스 후보를 실제로 호출해 응답 상태·건수·샘플을 기록하는 탐색 스크립트 (GitHub Actions에서 실행)

A. 파서 설계용 원본 저장 (네이버/다음 검색, 네이버 증권, GDELT 등)
B. 73개사 전체에 대해 소스별 최근 7일·30일 기사 건수 비교 (구글 / Bing / 네이버 증권)
C. 언론사 RSS 후보의 응답 여부와 기사 기간
"""
import html
import json
import re
import sys
import time
from calendar import timegm
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import feedparser
import requests

sys.path.insert(0, ".")
from src.newsletter_collector import _search_terms  # noqa: E402
from src.newsletter_config import STOCK_TICKERS, TARGET_GROUPS  # noqa: E402

OUT = Path("newsletter-out/probe")
OUT.mkdir(parents=True, exist_ok=True)
UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
}
KST = timezone(timedelta(hours=9))
NOW = datetime.now(timezone.utc)
report = []


def log(*a):
    line = " ".join(str(x) for x in a)
    print(line, flush=True)
    report.append(line)


def get(name, url, headers=None, save=True, encoding=None, quiet=False):
    try:
        r = requests.get(url, headers={**UA, **(headers or {})}, timeout=20)
        if encoding:
            r.encoding = encoding
        text = r.text
        if not quiet:
            ctype = r.headers.get("content-type", "")
            log(f"[{name}] {r.status_code} {ctype} len={len(text)} url={url[:160]}")
        if save:
            (OUT / f"{name}.txt").write_text(text[:400000], encoding="utf-8")
        return r.status_code, text
    except Exception as e:  # noqa: BLE001 - 탐색용이라 모든 오류를 기록만 한다
        log(f"[{name}] ERROR {type(e).__name__}: {e}")
        return None, ""


def feed_summary(text):
    f = feedparser.parse(text)
    dates = [e.get("published", e.get("updated", "")) for e in f.entries]
    log(f"   feed entries={len(f.entries)} first={dates[:1]} last={dates[-1:]}")
    for e in f.entries[:3]:
        title = e.get("title", "")[:70]
        link = e.get("link", "")[:110]
        log(f"   - {title} | {link}")


# ───────────── A. 원본 저장 ─────────────
q = "심텍"
qq = quote(f'"{q}"')
SAMPLES = [
    ("naver_search_pd1", f"https://search.naver.com/search.naver?where=news&query={qq}&sort=1&pd=1", None, None),
    ("naver_search_pd2", f"https://search.naver.com/search.naver?where=news&query={qq}&sort=1&pd=2", None, None),
    ("naver_m_search", f"https://m.search.naver.com/search.naver?where=m_news&query={qq}&sort=1&pd=1", None, None),
    ("naver_tab_api", f"https://s.search.naver.com/p/newssearch/search.naver?where=news_tab_api&query={qq}&sort=1&pd=1&start=1", None, None),
    ("naver_fin_html", "https://finance.naver.com/item/news_news.naver?code=222800&page=1&sm=title_entity_id.basic&clusterId=",
     {"Referer": "https://finance.naver.com/item/news.naver?code=222800"}, "euc-kr"),
    ("naver_mstock_json", "https://m.stock.naver.com/api/news/stock/222800?pageSize=20&page=1", {"Referer": "https://m.stock.naver.com/"}, None),
    ("naver_mstock_json2", "https://m.stock.naver.com/front-api/news/list?category=stock&itemCode=222800&page=1&pageSize=20",
     {"Referer": "https://m.stock.naver.com/"}, None),
    ("daum_search", f"https://search.daum.net/search?w=news&q={qq}&sort=recency&period=w", None, None),
    ("daum_search_m", f"https://m.search.daum.net/search?w=news&q={qq}&sort=recency&period=w", None, None),
    ("zum_search", f"https://search.zum.com/search.zum?method=news&query={qq}&option=date", None, None),
    ("nate_search", f"https://news.nate.com/search?q={qq}", None, None),
    ("bing_ko", f"https://www.bing.com/news/search?q={qq}&format=rss&setlang=ko-KR&cc=KR", None, None),
    ("bing_ko_p2", f"https://www.bing.com/news/search?q={qq}&format=rss&setlang=ko-KR&cc=KR&first=11", None, None),
    ("bing_en_amat", "https://www.bing.com/news/search?q=%22Applied+Materials%22&format=rss&setlang=en-US&cc=US", None, None),
    ("gdelt_en", "https://api.gdeltproject.org/api/v2/doc/doc?query=%22Applied%20Materials%22&mode=artlist&format=json&maxrecords=50&timespan=14d&sort=datedesc", None, None),
    ("gdelt_ko", f"https://api.gdeltproject.org/api/v2/doc/doc?query={quote(q)}%20sourcelang:korean&mode=artlist&format=json&maxrecords=50&timespan=1month&sort=datedesc", None, None),
    ("yahoo_rss", "https://news.search.yahoo.com/rss?p=%22Applied+Materials%22", None, None),
    ("gnews_en_amat", "https://news.google.com/rss/search?q=%22Applied+Materials%22+when:14d&hl=en-US&gl=US&ceid=US:en", None, None),
]
for name, url, headers, enc in SAMPLES:
    status, text = get(name, url, headers=headers, encoding=enc)
    if status != 200:
        continue
    if text.lstrip().startswith("<?xml") or "<rss" in text[:500]:
        feed_summary(text)
    else:
        n_q = text.count(q)
        n_tit = text.count("news_tit")
        n_sds = text.count("sds-comps")
        n_a = text.count("<a ")
        log(f"   '{q}' occurrences={n_q} news_tit={n_tit} sds={n_sds} a_tags={n_a}")
    time.sleep(0.7)


# ───────────── B. 73개사 커버리지 비교 ─────────────
def entry_dt(e):
    parsed = e.get("published_parsed") or e.get("updated_parsed")
    return datetime.fromtimestamp(timegm(parsed), tz=timezone.utc) if parsed else None


def rss_titles(url):
    try:
        r = requests.get(url, headers=UA, timeout=20)
        if r.status_code != 200:
            return None
        return [(e.get("title", ""), entry_dt(e)) for e in feedparser.parse(r.content).entries]
    except requests.RequestException:
        return None


FIN_ROW_RE = re.compile(
    r'<td class="title">\s*<a href="([^"]+)"[^>]*>(.*?)</a>.*?<td class="info">(.*?)</td>\s*<td class="date">\s*([\d.: ]+)</td>',
    re.S,
)


def naver_fin_titles(code):
    url = f"https://finance.naver.com/item/news_news.naver?code={code}&page=1&sm=title_entity_id.basic&clusterId="
    try:
        r = requests.get(url, headers={**UA, "Referer": f"https://finance.naver.com/item/news.naver?code={code}"}, timeout=20)
        r.encoding = "euc-kr"
        if r.status_code != 200:
            return None
    except requests.RequestException:
        return None
    out = []
    for _, title, _, date in FIN_ROW_RE.findall(r.text):
        try:
            dt = datetime.strptime(date.strip(), "%Y.%m.%d %H:%M").replace(tzinfo=KST)
        except ValueError:
            dt = None
        out.append((html.unescape(re.sub(r"<[^>]+>", "", title)).strip(), dt))
    return out


def counts(items, names):
    if items is None:
        return "ERR"
    hit = [(t, d) for t, d in items if d and any(n in t for n in names)]
    d7 = sum(1 for _, d in hit if NOW - d <= timedelta(days=7))
    d30 = sum(1 for _, d in hit if NOW - d <= timedelta(days=30))
    return f"{d7}/{d30}"


def probe_company(company):
    terms = _search_terms(company)
    names = terms
    gq = quote(" OR ".join(f'"{t}"' for t in terms))
    google = rss_titles(f"https://news.google.com/rss/search?q={gq}+when:30d&hl=ko&gl=KR&ceid=KR:ko")
    bq = quote(" OR ".join(f'"{t}"' for t in terms))
    bing = rss_titles(f"https://www.bing.com/news/search?q={bq}&format=rss&setlang=ko-KR&cc=KR")
    time.sleep(0.3)
    bing2 = rss_titles(f"https://www.bing.com/news/search?q={bq}&format=rss&setlang=ko-KR&cc=KR&first=11")
    ticker = STOCK_TICKERS.get(company, "")
    fin = naver_fin_titles(ticker.split(".")[0]) if ticker[:6].isdigit() else None
    bing_all = None if bing is None else bing + (bing2 or [])
    fin_cell = "-"
    if fin is not None:
        all7 = sum(1 for _, d in fin if d and NOW - d <= timedelta(days=7))
        fin_cell = f"{counts(fin, names)} (전체7일 {all7})"
    return company, counts(google, names), counts(bing_all, names), fin_cell, bing_all, fin


companies = [c for g in TARGET_GROUPS for c in g["companies"]]
with ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(probe_company, companies))

log("\n=== 커버리지 (최근7일/30일, 제목에 회사명 포함) ===")
log("company | google | bing(2p) | naver_fin")
tot = {"g": 0, "b": 0, "f": 0, "any": 0}
samples = {}
for company, g, b, f, bing_all, fin in results:
    log(f"{company} | {g} | {b} | {f}")
    fresh = [x.split("/")[0] for x in (g, b, f.split(" ")[0])]
    vals = [int(x) if x.isdigit() else 0 for x in fresh]
    tot["g"] += vals[0] > 0
    tot["b"] += vals[1] > 0
    tot["f"] += vals[2] > 0
    tot["any"] += any(vals)
    samples[company] = {
        "bing": [(t, d.isoformat() if d else None) for t, d in (bing_all or [])][:20],
        "naver_fin": [(t, d.isoformat() if d else None) for t, d in (fin or [])][:20],
    }
log(f"7일 기사 있는 회사 수: google={tot['g']} bing={tot['b']} naver_fin={tot['f']} 합집합={tot['any']} / {len(companies)}")
(OUT / "coverage_samples.json").write_text(json.dumps(samples, ensure_ascii=False, indent=1), encoding="utf-8")


# ───────────── C. 언론사 RSS 후보 ─────────────
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
    "ebn": "https://www.ebn.co.kr/rss/allArticle.xml",
    "datanews": "https://www.datanews.co.kr/rss/allArticle.xml",
    "dynews": "https://www.dynews.co.kr/rss/allArticle.xml",
    "thebell": "https://www.thebell.co.kr/free/content/rss.asp",
    "inews24": "https://www.inews24.com/rss/news_it.xml",
    "fnnews": "https://www.fnnews.com/rss/r20/fn_realnews_all.xml",
    "heraldcorp": "https://biz.heraldcorp.com/rss/google/economy",
    "news1_industry": "https://www.news1.kr/rss/industry",
}
log("\n=== 언론사 RSS 후보 ===")
for name, url in CANDIDATES.items():
    status, text = get("rss_" + name, url, save=False)
    if status == 200:
        feed_summary(text)
    time.sleep(0.3)

(OUT / "report.txt").write_text("\n".join(report), encoding="utf-8")
