"""최근 공시와 뉴스에서 '알아야 할 사항' 2~3건을 고른다.

- 공시: 공급계약·최대주주 변경·분할·합병·시설투자처럼 회사에 큰 영향을 주는 공시를 제목으로 고른다.
  공급계약·시설투자는 원문에서 상대방과 금액을 읽어 한 줄로 요약한다.
- 뉴스: Google 뉴스(RSS)와 네이버 뉴스(NAVER_CLIENT_ID/SECRET 이 있을 때)에서 회사 이름이 제목에 든 기사만 쓴다.
  주가·시황 기사는 낮게 보고, 수주·실적·투자·인수합병 기사를 높게 본다.
- 같은 종류(계약, 실적, 투자 등)는 한 건만 골라 서로 다른 소식이 보이게 한다.
"""
import html
import os
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote, urlparse

import feedparser
import requests

GOOGLE_NEWS = "https://news.google.com/rss/search?q={q}&hl=ko&gl=KR&ceid=KR:ko"
NAVER_NEWS = "https://openapi.naver.com/v1/search/news.json"
WINDOW_DAYS = 120  # 최근 4개월
LIMIT = 3

# (종류, 점수, 공시 제목 패턴)
FILING_RULES = [
    ("계약", 4, r"단일판매|공급계약"),
    ("지배구조", 4, r"최대주주\s*변경|최대주주변경"),
    ("구조개편", 4, r"합병|분할|영업양수|영업양도|주식교환|주식이전"),
    ("투자", 4, r"신규\s*시설\s*투자|시설투자"),
    ("투자", 3, r"타법인\s*주식.*취득|출자증권.*취득"),
    ("자금", 3, r"유상증자|전환사채|신주인수권부사채|교환사채"),
    ("위험", 4, r"횡령|배임|소송|거래정지|매매정지|관리종목|불성실공시|감사의견"),
    ("주주환원", 2, r"자기주식|주식\s*소각|현금\s*ㆍ?\s*현물\s*배당"),
    ("실적", 2, r"영업\s*\(잠정\)\s*실적|매출액\s*또는\s*손익구조"),
]
NEWS_RULES = [
    ("계약", 4, r"수주|공급\s*계약|계약\s*체결|납품\s*계약|공급사\s*선정"),
    ("실적", 4, r"사상\s*최대|최대\s*실적|역대\s*최대|흑자\s*전환|적자\s*전환|어닝\s*서프라이즈"),
    ("구조개편", 4, r"인수|합병|M&A|지분\s*매각|최대주주|경영권"),
    ("상장", 4, r"상장\s*(?:추진|예정|심사|승인)|IPO|공모"),
    ("위험", 4, r"소송|횡령|배임|압수수색|제재|화재|사고|파업"),
    ("투자", 3, r"증설|신공장|공장|투자|캐파|CAPA"),
    ("제품", 3, r"개발|국산화|양산|출시|신제품|퀄\s*테스트|공급\s*개시|진출"),
    ("실적", 3, r"실적|영업이익|매출"),
    ("경영", 2, r"대표이사|신임\s*대표|사장\s*선임|회장"),
]
NEWS_NOISE = re.compile(r"특징주|목표\s*주가|목표가|주가|상한가|하한가|급등|급락|강세|약세|순매수|순매도|"
                        r"외국인|기관\s*매|마감|시황|52주|신고가|신저가|\[포토\]|부고|게시판|인사\]|ETF|수혜주|테마")
CHIP_WORDS = re.compile(r"반도체|장비|소재|부품|웨이퍼|디스플레이|공정|파운드리|HBM|메모리|낸드|D램|수주|실적|코스닥|상장")
PARTICLE = r"(?:은|는|이|가|을|를|과|와|의|도|에|에서|로|으로|만|측)?"


def _norm(text: str) -> str:
    return re.sub(r"[^0-9a-zA-Z가-힣]", "", text or "").lower()


def _bigrams(text: str) -> set:
    t = _norm(text)
    return {t[i:i + 2] for i in range(len(t) - 1)}


def similar(a: str, b: str) -> bool:
    x, y = _bigrams(a), _bigrams(b)
    return bool(x and y) and len(x & y) / len(x | y) >= 0.4


def _score(title: str, rules: list) -> tuple:
    for category, score, pattern in rules:
        if re.search(pattern, title, re.I):
            return category, score
    return "", 0


# ---------- 공시 ----------

def clean_filing_title(name: str) -> str:
    t = re.sub(r"\[[^\]]*\]", "", name or "")
    t = re.sub(r"^주요사항보고서\s*\((.*)\)\s*$", r"\1", t.strip())
    t = re.sub(r"\((?:자율공시|공정공시|종속회사의주요경영사항)\)", "", t)
    return t.replace("ㆍ", "·").strip()


def _label_values(doc: str) -> list:
    """원문 표의 각 줄을 [칸, 칸, ...] 글자 목록으로 바꾼다."""
    rows = []
    for tr in re.findall(r"<TR\b.*?</TR>", doc, re.S | re.I):
        cells = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", c[1]))).strip()
                 for c in re.findall(r"<(T[DHEU])\b[^>]*>(.*?)</\1>", tr, re.S | re.I)]
        rows.append([c for c in cells if c])
    return rows


def _find(rows: list, label: str) -> str:
    for cells in rows:
        for i, c in enumerate(cells[:-1]):
            if re.search(label, re.sub(r"\s", "", c)):
                return cells[i + 1]
    return ""


def _eok(text: str) -> int | None:
    digits = re.sub(r"[^\d]", "", text or "")
    return round(int(digits) / 100_000_000) if digits and int(digits) >= 100_000_000 else None


def _company(text: str) -> str:
    t = re.sub(r"\(주\)|㈜|주식회사|\(株\)", "", text or "").strip(" ,.")
    if not t or t in ("-", "—") or re.search(r"비공개|미기재|영업\s*비밀|생략|유보|기재하지", t):
        return ""
    return t[:30]


def filing_summary(title: str, doc: str) -> str:
    """공급계약·시설투자 공시 원문에서 상대방·금액·매출액(자기자본) 대비 비율을 읽어 한 줄로 만든다."""
    rows = _label_values(doc)
    if re.search(r"단일판매|공급계약", title):
        amount = _eok(_find(rows, r"계약금액"))
        ratio = _find(rows, r"매출액대비")
        party = _company(_find(rows, r"계약상대"))
        parts = [f"{party}와" if party else "", f"{amount:,}억원 규모" if amount else "", "공급계약 체결"]
        text = " ".join(p for p in parts if p)
        r = re.search(r"\d+(?:\.\d+)?", ratio or "")
        return f"{text} (최근 매출액 대비 {r.group()}%)" if r else text
    if re.search(r"시설\s*투자", title):
        amount = _eok(_find(rows, r"투자금액"))
        ratio = re.search(r"\d+(?:\.\d+)?", _find(rows, r"자기자본대비") or "")
        purpose = _find(rows, r"투자목적")[:30]
        text = f"신규 시설투자{f' {amount:,}억원' if amount else ''}{f' ({purpose})' if purpose else ''}"
        return f"{text}, 자기자본 대비 {ratio.group()}%" if ratio else text
    return ""


def filing_candidates(filings: list, since: datetime) -> list:
    out = []
    for f in filings:
        name = re.sub(r"\s+", " ", f.get("report_nm", "")).strip()
        try:
            day = datetime.strptime(f.get("rcept_dt", ""), "%Y%m%d").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        category, score = _score(name, FILING_RULES)
        if day < since or not score:
            continue
        out.append({"kind": "공시", "category": category, "score": score + 0.5, "date": day,
                    "title": clean_filing_title(name), "source": "DART", "rcept_no": f.get("rcept_no", ""),
                    "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={f.get('rcept_no', '')}"})
    return out


# ---------- 뉴스 ----------

def fetch_google(query: str) -> list:
    try:
        resp = requests.get(GOOGLE_NEWS.format(q=quote(f'"{query}"')), timeout=(5, 10))
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"[news] Google '{query}' 조회 실패: {e}")
        return []
    out = []
    for entry in feedparser.parse(resp.content).entries:
        if not getattr(entry, "published_parsed", None):
            continue
        source = entry.get("source", {})
        press = source.get("title", "") if isinstance(source, dict) else ""
        title = re.sub(r"\s+-\s+[^-]+$", "", entry.title) if press else entry.title
        out.append({"title": title, "source": press, "url": entry.link,
                    "date": datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)})
    return out


def fetch_naver(query: str) -> list:
    client_id, secret = os.environ.get("NAVER_CLIENT_ID"), os.environ.get("NAVER_CLIENT_SECRET")
    if not client_id or not secret:
        return []
    try:
        resp = requests.get(NAVER_NEWS, params={"query": query, "display": 40, "sort": "date"}, timeout=(5, 10),
                            headers={"X-Naver-Client-Id": client_id, "X-Naver-Client-Secret": secret})
        resp.raise_for_status()
        items = resp.json().get("items", [])
    except (requests.RequestException, ValueError) as e:
        print(f"[news] 네이버 '{query}' 조회 실패: {e}")
        return []
    out = []
    for item in items:
        try:
            day = parsedate_to_datetime(item["pubDate"]).astimezone(timezone.utc)
        except (KeyError, TypeError, ValueError):
            continue
        link = item.get("originallink") or item.get("link", "")
        host = urlparse(link).netloc.removeprefix("www.")
        out.append({"title": html.unescape(re.sub(r"</?b>", "", item.get("title", ""))), "source": host,
                    "url": link, "date": day})
    return out


def mentions(title: str, name: str) -> bool:
    """제목에 회사 이름이 따로 쓰였는지 본다. '케이씨'가 '케이씨텍' 안에 든 경우는 아니다."""
    pattern = r"(?<![0-9A-Za-z가-힣])" + re.escape(name) + PARTICLE + r"(?![0-9A-Za-z가-힣])"
    return re.search(pattern, title, re.I) is not None


def news_candidates(names: list, since: datetime) -> list:
    articles = []
    for query in names[:2]:  # 화면 이름과, 다르면 종목명(예: 원익큐엔씨 → 원익QnC)
        articles += fetch_naver(query) + fetch_google(query)
    seen, out = set(), []
    for a in articles:
        title = re.sub(r"^\s*(?:\[[^\]]*\]\s*)+", "", a["title"]).strip()  # [단독] [e공시] 같은 머리표 떼기
        key = _norm(title)
        if a["date"] < since or not key or key in seen:
            continue
        seen.add(key)
        hit = next((n for n in names if mentions(title, n)), None)
        if not hit:
            continue
        if len(_norm(hit)) <= 3 and not CHIP_WORDS.search(title):
            continue  # 짧은 이름은 반도체 관련 단어가 함께 있어야 같은 회사로 본다
        category, score = _score(title, NEWS_RULES)
        if NEWS_NOISE.search(title):
            score -= 3
        if score <= 0:
            continue
        out.append({"kind": "뉴스", "category": category, "score": score, "date": a["date"],
                    "title": title[:90], "source": a["source"], "url": a["url"]})
    return out


# ---------- 고르기 ----------

def pick(candidates: list, now: datetime, limit: int = LIMIT) -> list:
    for c in candidates:
        c["rank"] = c["score"] + (1 if now - c["date"] <= timedelta(days=30) else 0)  # 최근 한 달은 가산
    chosen = []
    for c in sorted(candidates, key=lambda c: (-c["rank"], -c["date"].timestamp())):
        if c["score"] < 2 or any(c["category"] == x["category"] or similar(c["title"], x["title"]) for x in chosen):
            continue
        chosen.append(c)
        if len(chosen) == limit:
            break
    return sorted(chosen, key=lambda c: c["date"], reverse=True)


def collect_highlights(names: list, filings: list, fetch_doc) -> list:
    """names: 화면 이름·종목명·DART 이름 (앞의 두 개로 뉴스를 찾는다), filings: DART list 결과, fetch_doc: 접수번호 → 원문."""
    names = [n for i, n in enumerate(names) if n and _norm(n) not in {_norm(x) for x in names[:i]}]
    if not names:
        return []
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=WINDOW_DAYS)
    chosen = pick(filing_candidates(filings, since) + news_candidates(names, since), now)
    out = []
    for c in chosen:
        title = c["title"]
        if c["kind"] == "공시" and c["category"] in ("계약", "투자") and c.get("rcept_no"):
            title = filing_summary(title, fetch_doc(c["rcept_no"])) or title
        out.append({"kind": c["kind"], "date": c["date"].strftime("%Y-%m-%d"), "title": title,
                    "source": c["source"], "url": c["url"]})
    return out
