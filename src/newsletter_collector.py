import html
import os
import re
from calendar import timegm
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote

import feedparser
import requests

from src.history import KST
from src.newsletter_config import (
    COMPANY_ALIAS_RAW,
    DART_CORP_CODES,
    HARD_BLACK_TITLES,
    MAX_AGE_DAYS,
    MAX_STORED_PER_COMPANY,
    NEWS_CATEGORIES,
    RSS_LIST,
    SIMILARITY_THRESHOLD,
    all_company_names,
)

REQUEST_TIMEOUT = 20
HEADERS = {"User-Agent": "Mozilla/5.0"}

PHOTO_CAPTION_RE = re.compile(r"[\(\[〈][^\)\]〉]*사진[^\)\]〉]*[\)\]〉]\s*$")
PHOTO_TAG_RE = re.compile(r"^\s*[\(\[〈]\s*포토\s*[\)\]〉]")

STOCK_NOISE_RE = re.compile(
    r"(특징주|테마주|수혜주|관련주|주도주|대장주|고래사냥|내일장|주식민원|투자전략|테마\s*상승|투자분석|주달|52주|신고가|신저가|외국인\s*대량|순매도|순매수|코스닥|코스피|급등|급락|상한가|하한가|증시일정|리포트|총정리|상승여력|목표가|올릴\s*종목|폭등|반도체주|장비주|동반\s*상승|동반\s*폭등|주목을|방긋|초고수|사고.*팔았다|질주|가격\s*부담|상쇄|자신감|헬로스톡|주목할\s*종목|싸다|증권|실적\s*감안|기대감도|차익실현|매수\s*추천|칩칩폭폭|딸깍|전량매도|전량매수|매수일지|투자일지|매매일기|매매복기|추천부터|손절|존버|물타기|줍줍|영끌|풀매수|풀매도|시선강탈|공략법|불타오르네|%\s*[↑↓]|장중|현재가|원선에서|만원대\s*(상승|하락)|%\s*(올라|뛰어|내려|빠져|하락에)|기술적\s*분석|지지선|저항선|움직였습니다|주식\s*\d선|기판주|소재주|부품주|장비주|강세|약세)"
)
STOCK_BRACKET_RE = re.compile(r"\[.*(강세|약세|특징|종목|테마|토픽|시황|고래|주식|베스트).*\].*")
BROKER_RE = re.compile(
    r"(한국투자|nh투자|kb증권|삼성증권|미래에셋|대신증권|키움증권|신한투자|하나증권|메리츠증권|유안타|리서치센터|목표주가|투자의견|상승 마감|하락 마감|주가\s*전망|주가\s*추이|주가)"
)
ENGLISH_STOCK_RE = re.compile(
    r"(stock|shares|nasdaq|nyse|tse:|price target|buy rating|sell rating|hold rating|downgrade|upgrade|analyst|earnings per share|\beps\b|dividend|market cap|short interest|hedge fund|institutional invest|results beat|p/e ratio|valuation|trading at|52-week|moving average|zacks|motley fool|seeking alpha|why .* stock|should you buy)"
)

# 회사별 오탐 필터 (제목을 소문자로 바꾼 뒤 검사)
FALSE_POSITIVE_PATTERNS = {
    "머크퍼포먼스머티리얼즈": r"제약|의약|신약|임상|바이오|치료제",
    "와이씨": r"예측|가상자산|블록체인|스타트업|달바|성과보수",
    "프로텍": r"화장품|뷰티|쿠션|선크림|케이스|보호필름|아이폰|갤럭시|프로텍트|protect|사이버작전|프로텍션|프로텍터|아세아프로텍|시큐어|코나아이|카드",
    "AP시스템": r"중국|거버넌스\s*강화|esg\s*보고서|우드맥킨지|woodmac|태양광|인버터|solar|inverter",
    "유진테크": r"유진테크놀로지",
    "에스티아이": r"여론조사|지지|응답|복당|대통령|정당|찬성|반대|국힘|민주당|후보",
    "테스": r"미용|의료기기|강소기업|바이오|두산테스나|비공개|베타|스트레스|게임|nasa|나사|망원경|테스\W*형|필라테스|요가|골대체재|드퓨신테스|시지바이오|노보시스|테스토닉|사이테스|cites|야생동물|멸종위기|파충류|희귀동물|밀수|밀매|테스티파이|테스토스|테스코|t\.e\.s\.s|아크리테스|테스라|넥슨|마비노기|테스트|신테스|tplo|정형외과|동물병원|수의|cbt|obt",
    "후성": r"후성유전|유전체|유전학|유전 편집|에피크리스퍼|심포지엄",
    "제이티": r"jtbc|제이티비씨|jt방송|jt비씨|제이티시스템|제이티넷|제이티이엔지|제이티전자",
    "ASML": r"니콘|캐논|재도전장|도전장|장악한",
    "케이씨": r"케이씨지|kcg|케이씨씨|kcc|케이씨에스|케이씨티|선박|방식|방오|조선|^pkc|\bpkc\b|케이씨피드|hkc|케이씨텍|제이케이씨",
    "디아이": r"어드밴텍|advantech|디아이에프엠|difm|디아이동일|디아이씨|adi|아나로그디바이스|sdi|배터리|holding|asml|디바인|divine|변동 원인|주식 마감|nvidia|슈퍼마이크로|3di|도쿄일렉트론|디아이랩|디아이파워|디아이건설|엑스디아이",
    "솔브레인": r"솔브레인홀딩스|홀딩스",
    "피에스케이": r"피에스케이홀딩스|홀딩스",
    "티에스이": r"엘디티",
}
FALSE_POSITIVE_RE = {k: re.compile(v) for k, v in FALSE_POSITIVE_PATTERNS.items()}

ASCII_ALIAS_RE = re.compile(r"^[a-z0-9.&\- ]+$")

# 회사와 무관한 스팸·채용 공고
GENERAL_NOISE_RE = re.compile(r"토토|카지노|바카라|슬롯|채용|인턴|신입사원")
# 사진/이미지 페이지, 주가 분석 사이트
BLOCKED_LINK_RE = re.compile(r"view_photo|image_popup|/photo/|simplywall\.st|tradersunion\.com|tradingkey\.com|calgaryroughnecks\.com")


def build_alias_map() -> dict:
    return {alias.lower(): company for company, aliases in COMPANY_ALIAS_RAW.items() for alias in aliases}


def is_dart_link(link: str) -> bool:
    return bool(link) and "dart.fss.or.kr" in link


def get_clean_title(title: str, link: str) -> str:
    # DART 공시는 제목을 자르지 않음 (시장구분 괄호만 제거)
    if is_dart_link(link):
        return re.sub(r"^\((유가|코스닥|코넥스|기타)\)", "", title).strip()
    clean = title
    last_dash = clean.rfind(" - ")
    if last_dash != -1:
        clean = clean[:last_dash]
    first_bracket = clean.find(" < ")
    if first_bracket != -1:
        clean = clean[:first_bracket]
    return clean.strip()


def is_stock_or_analysis_news(clean_title: str) -> bool:
    t = clean_title.lower()
    if re.search(r"\d{6}", t):
        return True
    if re.search(r"[+\-]\d+\.?\d*\s*%", t):
        return True
    return bool(STOCK_NOISE_RE.search(t) or STOCK_BRACKET_RE.search(t) or BROKER_RE.search(t))


def is_english_stock_news(clean_title: str) -> bool:
    if len(re.findall(r"[가-힣]", clean_title)) > 3:
        return False  # 한글 위주 제목은 한글 필터가 처리
    return bool(ENGLISH_STOCK_RE.search(clean_title.lower()))


def is_false_positive(clean_title: str, company: str) -> bool:
    pattern = FALSE_POSITIVE_RE.get(company)
    return bool(pattern and pattern.search(clean_title.lower()))


# "이완호 한국알박 팀장." 처럼 인물 사진 캡션이 제목으로 들어오는 경우
PERSON_CAPTION_RE = re.compile(r"^\S+\s+\S+\s+(팀장|대표|사장|부장|상무|전무|이사|교수|연구원|회장|본부장)\.?$")


# "OOO 대표(앞줄 왼쪽부터)와 ... 기념촬영 했다" 같은 단체사진 캡션
GROUP_CAPTION_RE = re.compile(r"기념촬영|앞줄|뒷줄|왼쪽부터|오른쪽부터|를 비롯해|하고 있다\.?$")


def is_photo_caption(title: str) -> bool:
    return bool(
        PHOTO_CAPTION_RE.search(title) or PHOTO_TAG_RE.search(title) or PERSON_CAPTION_RE.search(title) or GROUP_CAPTION_RE.search(title)
    )


def find_companies(clean_title: str, alias_map: dict) -> list:
    lower = clean_title.lower()
    if "skc" in lower or "에스케이씨" in lower:
        return []
    if "와이씨켐" in lower or "ycchem" in lower or "yc chem" in lower:
        return []

    matched = {}
    for alias in sorted(alias_map, key=len, reverse=True):
        if ASCII_ALIAS_RE.match(alias):
            # 순수 영문/숫자 alias는 단어 경계 매칭 (예: "di"가 "nvidia"에 걸리는 오탐 차단)
            if re.search(r"(^|[^a-z0-9])" + re.escape(alias) + r"([^a-z0-9]|$)", lower):
                matched[alias_map[alias]] = True
        elif len(alias) <= 2:
            # '테스','후성' 같은 두 글자 이름은 '카르테스'처럼 다른 단어 안에 들어간 경우를 제외
            if re.search(r"(^|[^가-힣\-])" + re.escape(alias), lower):
                matched[alias_map[alias]] = True
        elif alias in lower:
            matched[alias_map[alias]] = True
    return list(matched)


def get_news_tag(clean_title: str, link: str) -> str:
    if is_dart_link(link):
        return "전자공시"
    for tag, pattern in NEWS_CATEGORIES:
        if pattern.search(clean_title):
            return tag
    return "기타동향"


_NON_WORD_RE = re.compile(r"[^A-Za-z0-9_가-힣]")


def normalize_title(title: str) -> str:
    return _NON_WORD_RE.sub("", title).lower()


def similarity(a: str, b: str, company_name: str = "") -> float:
    # company_name: 회사명 자체가 만드는 bigram이 유사도를 과대평가하는 문제 방지
    def clean(s: str) -> str:
        r = s.lower()
        r = re.sub(r"[0-9]+", "", r)
        r = re.sub(r"규모|억원|천만원|백만원|만원|원|대비|매출액|비중", "", r)
        r = re.sub(r"공급\s*계약|수주\s*공시|장비\s*계약|계약\s*체결|공급", "수주", r)
        r = re.sub(r"상장\s*임박|상장\s*초읽기|발판\s*마련|잰걸음|독자\s*생태계|구축|가속", "상장", r)
        r = re.sub(r"삼성전자[와에가]", "삼성전자", r)
        r = _NON_WORD_RE.sub("", r)
        if company_name:
            cn = _NON_WORD_RE.sub("", company_name.lower())
            if cn:
                r = r.replace(cn, "")
        return r

    na, nb = clean(a), clean(b)
    if not na or not nb:
        return 0
    if nb in na or na in nb:
        return 1

    def bigrams(s: str) -> set:
        return {s[i : i + 2] for i in range(len(s) - 1)}

    bg_a, bg_b = bigrams(na), bigrams(nb)
    if not bg_a or not bg_b:
        return 0
    return len(bg_a & bg_b) / min(len(bg_a), len(bg_b))


def format_date_string(dt: datetime) -> str:
    return dt.astimezone(KST).strftime("%m-%d %H:%M")


NAVER_NEWS_URL = "https://openapi.naver.com/v1/search/news.json"
GOOGLE_SEARCH_URL = "https://news.google.com/rss/search?q={q}+when:{days}d&hl=ko&gl=KR&ceid=KR:ko"

# 소스 우선순위: 같은 기사가 여러 곳에서 오면 먼저 처리된 소스의 링크(원문 링크)를 남긴다
SOURCE_PRIORITY = {"dart": 0, "naver": 1, "rss": 2, "google": 3}

# 네이버 API는 언론사명을 주지 않으므로 원문 도메인으로 표기
PRESS_BY_DOMAIN = {
    "etnews.com": "전자신문", "thelec.kr": "디일렉", "zdnet.co.kr": "지디넷코리아", "hankyung.com": "한국경제",
    "mk.co.kr": "매일경제", "yna.co.kr": "연합뉴스", "newsis.com": "뉴시스", "news1.kr": "뉴스1",
    "edaily.co.kr": "이데일리", "mt.co.kr": "머니투데이", "sedaily.com": "서울경제", "fnnews.com": "파이낸셜뉴스",
    "asiae.co.kr": "아시아경제", "heraldcorp.com": "헤럴드경제", "chosun.com": "조선일보", "biz.chosun.com": "조선비즈",
    "joongang.co.kr": "중앙일보", "donga.com": "동아일보", "hani.co.kr": "한겨레", "khan.co.kr": "경향신문",
    "ddaily.co.kr": "디지털데일리", "dt.co.kr": "디지털타임스", "inews24.com": "아이뉴스24", "bloter.net": "블로터",
    "thebell.co.kr": "더벨", "dealsite.co.kr": "딜사이트", "newspim.com": "뉴스핌", "nocutnews.co.kr": "노컷뉴스",
    "ajunews.com": "아주경제", "etoday.co.kr": "이투데이", "businesspost.co.kr": "비즈니스포스트", "ebn.co.kr": "EBN",
    "kmib.co.kr": "국민일보", "seoul.co.kr": "서울신문", "munhwa.com": "문화일보", "dynews.co.kr": "동양일보",
    "datanews.co.kr": "데이터뉴스", "digitaltoday.co.kr": "디지털투데이", "kipost.net": "KIPOST", "g-enews.com": "글로벌이코노믹",
}


def _press_from_link(link: str) -> str:
    host = re.sub(r"^https?://", "", link).split("/")[0].lower()
    host = re.sub(r"^(www|m|news|biz)\.", "", host) if host.count(".") > 1 else host
    for domain, name in PRESS_BY_DOMAIN.items():
        if host == domain or host.endswith("." + domain):
            return name
    return host or "뉴스 출처"


def _search_terms(company: str) -> list:
    """회사별 검색어: 대표명 + 한글 별칭(영문 약어는 오탐이 많아 제외)"""
    terms = [company]
    for alias in COMPANY_ALIAS_RAW.get(company, []):
        if alias != company and re.search(r"[가-힣]", alias) and len(alias) >= 4 and alias not in company:
            terms.append(alias)
    return terms[:2]


def build_sources() -> list:
    """수집 소스 목록 (company 가 있으면 해당 회사로 직접 귀속되는 DART 피드)"""
    sources = []
    for company, code in DART_CORP_CODES.items():
        if code:
            sources.append({"kind": "dart", "url": f"https://dart.fss.or.kr/api/companyRSS.xml?crpCd={code}", "company": company})
    for url in RSS_LIST:
        sources.append({"kind": "google" if "news.google.com" in url else "rss", "url": url, "company": ""})
    # 회사별 개별 검색: OR로 묶은 검색은 결과 100건 한도에 큰 회사 기사가 몰려 작은 회사가 누락됨
    for company in all_company_names():
        q = " OR ".join(f'"{t}"' for t in _search_terms(company))
        sources.append({"kind": "google", "url": GOOGLE_SEARCH_URL.format(q=quote(q), days=MAX_AGE_DAYS), "company": ""})
        if os.environ.get("NAVER_CLIENT_ID"):
            sources.append({"kind": "naver", "query": f'"{company}"', "company": ""})
    sources.sort(key=lambda s: SOURCE_PRIORITY[s["kind"]])
    return sources


def _fetch_feed(source: dict) -> list:
    """소스 1개 조회 → [{title, link, pub_date, source}]"""
    if source["kind"] == "naver":
        return _fetch_naver(source["query"])
    url = source["url"]
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        if resp.status_code != 200:
            print(f"[rss] {resp.status_code} {url}")
            return []
        entries = feedparser.parse(resp.content).entries
    except requests.RequestException as e:
        print(f"[rss] 조회 실패 {url}: {e}")
        return []
    items = []
    for entry in entries:
        link = entry.get("link")
        items.append(
            {"title": entry.get("title"), "link": link, "pub_date": _entry_pub_date(entry), "source": _entry_source(entry, link or "")}
        )
    return items


def _fetch_naver(query: str) -> list:
    headers = {
        "X-Naver-Client-Id": os.environ.get("NAVER_CLIENT_ID", ""),
        "X-Naver-Client-Secret": os.environ.get("NAVER_CLIENT_SECRET", ""),
    }
    try:
        resp = requests.get(NAVER_NEWS_URL, headers=headers, params={"query": query, "display": 30, "sort": "date"}, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        raw_items = resp.json().get("items", [])
    except (requests.RequestException, ValueError) as e:
        print(f"[naver] '{query}' 조회 실패: {e}")
        return []
    items = []
    for item in raw_items:
        link = item.get("originallink") or item.get("link")
        try:
            pub_date = parsedate_to_datetime(item["pubDate"])
        except (KeyError, TypeError, ValueError):
            continue
        title = html.unescape(re.sub(r"</?b>", "", item.get("title", "")))
        items.append({"title": title, "link": link, "pub_date": pub_date, "source": _press_from_link(link or "")})
    return items


def _entry_pub_date(entry):
    parsed = entry.get("published_parsed") or entry.get("updated_parsed")
    if not parsed:
        return None
    return datetime.fromtimestamp(timegm(parsed), tz=timezone.utc)


def _entry_source(entry, link: str) -> str:
    if is_dart_link(link):
        return "DART 전자공시"
    source = entry.get("source")
    if isinstance(source, dict) and source.get("title"):
        return source["title"]
    return _press_from_link(link) if "news.google.com" not in link else "뉴스 출처"


def collect_articles() -> dict:
    """DART + 네이버 + RSS + 구글뉴스 수집 → {회사명: [article, ...]} (회사별 최신순 상위 N건)"""
    alias_map = build_alias_map()
    sources = build_sources()

    with ThreadPoolExecutor(max_workers=16) as pool:
        feeds = list(pool.map(_fetch_feed, sources))

    stats = {}
    for source, items in zip(sources, feeds):
        stats[source["kind"]] = stats.get(source["kind"], 0) + len(items)
    print("소스별 원본 건수:", stats)

    cutoff = datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)
    valid_articles = []
    seen_titles = set()
    for source, items in zip(sources, feeds):
        fixed_company = source["company"]
        for item in items:
            title, link, pub_date = item["title"], item["link"], item["pub_date"]
            if not title or not link or not pub_date or pub_date < cutoff:
                continue

            clean_title = get_clean_title(title, link)
            # 같은 기사가 다른 소스/언론사로 들어와도 한 번만 (공백·기호 차이 무시)
            norm = normalize_title(clean_title)
            if not norm or norm in seen_titles:
                continue
            seen_titles.add(norm)

            if any(b in clean_title for b in HARD_BLACK_TITLES):
                continue
            # 포토뉴스 캡션 노이즈 차단
            if is_photo_caption(clean_title):
                continue

            src_name = item["source"]
            # 네이버 프리미엄콘텐츠(유료 구독형)·블로그 차단
            if "contents.premium.naver.com" in link or "blog.naver.com" in link or "네이버 블로그" in clean_title:
                continue
            if re.search(r"네이버\s*프리미엄|프리미엄콘텐츠|premium\s*contents", src_name, re.IGNORECASE):
                continue

            base = {
                "title": clean_title,
                "link": link,
                "source": src_name,
                "date_str": format_date_string(pub_date),
                "pub_date": pub_date,
                "cat2": get_news_tag(clean_title, link),
            }

            if fixed_company:
                # 회사별 DART 피드: 매칭/오탐필터 우회 → 해당 회사로 직접 귀속
                valid_articles.append(
                    {**base, "company": fixed_company, "cat3": "공시자료" if is_dart_link(link) else "기업동향"}
                )
                continue

            if is_stock_or_analysis_news(clean_title) or is_english_stock_news(clean_title):
                continue
            if GENERAL_NOISE_RE.search(clean_title) or BLOCKED_LINK_RE.search(link):
                continue
            for company in find_companies(clean_title, alias_map):
                if is_false_positive(clean_title, company):
                    continue
                valid_articles.append({**base, "company": company, "cat3": "기업동향"})

    by_company = {c: [] for c in all_company_names()}
    for article in valid_articles:
        by_company.setdefault(article["company"], []).append(article)

    for company, articles in by_company.items():
        seen_links = set()
        deduped = []
        for a in sorted(articles, key=lambda x: x["pub_date"], reverse=True):
            if a["link"] in seen_links:
                continue
            seen_links.add(a["link"])
            deduped.append(a)
        by_company[company] = deduped[:MAX_STORED_PER_COMPANY]

    covered = sum(1 for a in by_company.values() if a)
    print(f"수집 완료: {len(valid_articles)}건 / 기사 있는 회사 {covered}/{len(by_company)}")
    return by_company


def group_similar(by_company: dict) -> dict:
    """회사별로 유사 기사를 대표 기사 아래 similar_articles 로 묶음"""
    grouped = {}
    for company, articles in by_company.items():
        target = []
        for article in articles:
            article = {**article, "similar_articles": []}
            for rep in target:
                if similarity(article["title"], rep["title"], company) >= SIMILARITY_THRESHOLD:
                    rep["similar_articles"].append(article)
                    break
            else:
                target.append(article)
        grouped[company] = target
    return grouped
