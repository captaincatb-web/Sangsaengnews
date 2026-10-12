"""DART 공시 원문(사업보고서·감사보고서)에서 주요 연혁, 사업장, 회계기준을 읽는다.

원문은 회사마다 형식이 달라 규칙으로 고르므로, 찾지 못하면 빈 값을 돌려주고 화면에서는 그 항목을 숨긴다.
"""
import html
import re

TABLE_RE = re.compile(r"<TABLE\b.*?</TABLE>", re.S | re.I)
ROW_RE = re.compile(r"<TR\b.*?</TR>", re.S | re.I)
CELL_RE = re.compile(r"<(T[DHEU])\b[^>]*>(.*?)</\1>", re.S | re.I)
DATE_RE = re.compile(r"^\s*((?:19|20)\d{2})\s*(?:[.\-/년]\s*(\d{1,2})\s*월?\.?"
                     r"(?:\s*[.\-/]\s*\d{1,2}(?!\d)\s*일?\.?|\s*\d{1,2}\s*일)?)?\s*[:\-~)]?\s*")
MONTH_RE = re.compile(r"^\s*(\d{1,2})\s*(?:월|[.\-/])\s*(?:\d{1,2}\s*일?\.?)?\s*[:\-)]?\s*")
BREAK_RE = re.compile(r"<(?:BR|P)\b[^>]*>", re.I)

# 연혁에서 남길 사건과 뺄 사건
HISTORY_KEEP = re.compile(r"설립|창립|창업|상장|상호|사명|분할|합병|인수|현지\s*법인|해외\s*법인|법인\s*(?:신설|설립)|"
                          r"지주\s*회사|(?:공장|캠퍼스|연구소|사옥|센터)\s*(?:준공|신설|착공|완공|개소|신축)|본점\s*이전|본사\s*이전|최대주주\s*변경")
HISTORY_DROP = re.compile(r"선임|사임|취임|퇴임|대표이사|수상|인증|선정|특허|표창|훈장|포상|ISO|벤처|"
                          r"신주인수권|사채|증자|감자|액면")
# 해외 법인·지사·공장처럼 회사 자체의 설립이 아닌 사건
SUBSIDIARY = re.compile(r"Inc\b|Ltd\b|Co\.|Corp|GmbH|LLC|해외|현지|미국|중국|일본|대만|베트남|싱가포르|말레이시아|"
                        r"유럽|독일|지사|자회사|연구소|공장|센터|사무소|합작")

SITE_HEADER = re.compile(r"소재지|주\s*소|위\s*치")
SITE_EXCLUDE = re.compile(r"설립일|지분|주요\s*사업|최대주주|대표이사|상\s*호|자산총액|종속|관계")
SITE_ROLES = [("본사", r"본사|본점|본관|HQ"), ("연구소", r"연구|R&D|기술원"), ("제조", r"공장|생산|제조|팹|Fab|FAB"),
              ("물류", r"물류|창고"), ("영업", r"지점|영업소|사무소|지사|영업"), ("사업장", r"사업장|캠퍼스")]
# '경기도 화성시', '경기 화성시', '서울특별시 강남구' 처럼 시·도로 시작하는 국내 주소
PROVINCE = (r"(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청북|충청남|충북|충남|전라북|전라남|전북|전남|"
            r"경상북|경상남|경북|경남|제주)(?:특별시|광역시|특별자치시|특별자치도|도)?")
_END = r"(?=[^가-힣]|$|에|과|와|으로|로|은|는|이며)"  # '평택시 청북면에' 처럼 조사가 붙어도 지명 끝으로 본다
ADDRESS_RE = re.compile(r"(" + PROVINCE + r"\s*[가-힣]+?(?:시|군|구)" + _END +
                        r"(?:\s+[가-힣]+?(?:구|군)" + _END + r")?(?:\s+[가-힣0-9]+?(?:동|읍|면|가)" + _END + r")?)")


def strip_tags(raw: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", raw))).strip()


def table_rows(table: str) -> list:
    return [[strip_tags(c[1]) for c in CELL_RE.findall(tr)] for tr in ROW_RE.findall(table)]


# ---------- 연혁 ----------

def _section(doc: str, title_pattern: str, limit: int = 150000) -> str:
    m = re.search(r"<TITLE[^>]*>[^<]*" + title_pattern + r"[^<]*</TITLE>", doc, re.I)
    if not m:
        return ""
    # '가. 연혁' 같은 하위 제목은 건너뛰고 '3. 자본금 변동사항', 'II. 사업의 내용' 같은 같은·윗단계 제목에서 끊는다
    end = re.search(r"<TITLE[^>]*>\s*(?:\d+\s*\.|[IVXⅠ-Ⅻ]+\s*\.)", doc[m.end():], re.I)
    return doc[m.end(): m.end() + end.start() if end else m.end() + limit][:limit]


def _clean_event(text: str) -> str:
    t = re.sub(r"^[\s\-·ㆍ•▶○●□■*]+", "", text)
    # '…설립된 법인으로서, 설립 이후 … 변경사항은 없습니다' 의 뒷부분(변경 없음 안내)은 뗀다
    t = re.sub(r"(?:으로서|이며|으며)?,?\s*설립\s*이후.*(?:없습니다|않았습니다|없음)\.?$", "", t)
    t = re.sub(r"\s+", " ", t).strip(" .")
    return t if len(t) <= 160 else t[:160].rsplit(" ", 1)[0] + "…"


def _rank(event: str) -> int:
    if re.search(r"설립|창립|창업", event) and not SUBSIDIARY.search(event):
        return 0  # 회사 설립
    for i, pattern in enumerate([r"상장", r"분할|합병|지주", r"상호|사명", r"법인|지사|설립", r"인수"], start=1):
        if re.search(pattern, event):
            return i
    return 6


LINE_SPLIT = r"<(?:BR|P)\b[^>]*>|\n|\r|&cr;"
MIDDATE = re.compile(r"(?<=[^\d\s(~.])\s*(?=(?:19|20)\d{2}\s*[.년]\s*\d{1,2}(?!\d))")


def _lines(raw: str) -> list:
    """원문 조각을 줄로 나눈다. 줄 사이에 태그가 없어도 'YYYY.MM' 이 새로 시작하면 다른 줄로 본다."""
    out = []
    for x in re.split(LINE_SPLIT, raw, flags=re.I):
        out += [t.strip() for t in MIDDATE.split(strip_tags(x)) if t.strip()]
    return out


def _cell_lines(raw: str) -> list:
    return _lines(raw)


def parse_history(doc: str) -> list:
    """사업보고서 '회사의 연혁'에서 설립·상장·사명 변경·분할·해외 법인 같은 주요 사건을 최대 5개 고른다."""
    section = _section(doc, r"회사의\s*연혁")
    if not section:
        return []
    events = []
    for table in TABLE_RE.findall(section):
        last_year = None
        for tr in ROW_RE.findall(table):
            raw_cells = [c[1] for c in CELL_RE.findall(tr)]
            cells = [strip_tags(c) for c in raw_cells]
            if cells and last_year and not DATE_RE.match(cells[0]) and len(cells) > 1:
                mo = re.fullmatch(r"(\d{1,2})\s*(?:월|\.\s*\d{1,2}\s*일?)?\.?", cells[0])
                if mo and int(mo.group(1)) <= 12:  # 앞 행의 연도를 이어받는 '04월 | 내용' 행
                    cells[0] = f"{last_year}.{mo.group(1)}"
            for i, cell in enumerate(cells[:-1]):
                m = DATE_RE.match(cell)
                if not (m and len(cell) <= 20):
                    continue
                last_year = int(m.group(1))
                year, month, rest = int(m.group(1)), int(m.group(2) or 0), raw_cells[i + 1:]
                if rest and re.fullmatch(r"\d{1,2}\s*월?", strip_tags(rest[0])):  # 연도 칸 + 월 칸
                    month, rest = int(re.sub(r"\D", "", strip_tags(rest[0]))), rest[1:]
                for raw in rest:
                    for text in _cell_lines(raw):  # 한 칸에 '04.01 설립<br>2019.05 상장' 처럼 여러 줄
                        md, mm = DATE_RE.match(text), MONTH_RE.match(text)
                        if md and len(text) > md.end() + 2:  # 줄마다 자기 날짜가 있는 경우
                            events.append((int(md.group(1)), int(md.group(2) or 0), text[md.end():]))
                        elif mm and len(text) > mm.end() + 2 and int(mm.group(1)) <= 12:
                            events.append((year, int(mm.group(1)), text[mm.end():]))
                        else:
                            events.append((year, month, text))
                break
    # 표 밖의 줄글: "1990.12 회사 설립" 형식
    text = TABLE_RE.sub(" ", section)
    for line in _lines(text):
        row = re.sub(r"^[\s\-·ㆍ•▶○●□■*]+", "", line)
        m = DATE_RE.match(row)
        if m and len(row) > m.end() + 2:
            events.append((int(m.group(1)), int(m.group(2) or 0), row[m.end():]))

    seen, picked = set(), []
    for year, month, event in sorted(events, key=lambda e: (e[0], e[1])):
        event = _clean_event(event)
        key = re.sub(r"\W", "", event)
        if not event or key in seen or not HISTORY_KEEP.search(event) or HISTORY_DROP.search(event):
            continue
        if any(key[:25] == k[:25] for k in seen if len(key) > 40):
            continue  # 앞부분이 같은 설명 문장은 하나만
        seen.add(key)
        picked.append({"year": year, "month": month, "text": event, "rank": _rank(event)})
    # 날짜 조각('01)을 통해 …')은 버리고, 짧은 연혁 항목이 있으면 '…되었습니다' 같은 설명 문장은 뺀다
    picked = [e for e in picked if not re.match(r"[\d)(.,~]", e["text"])]
    prose = re.compile(r"습니다|었으며|되었|하였|이며,")
    if any(not prose.search(e["text"]) for e in picked):
        picked = [e for e in picked if not prose.search(e["text"])]
    # 순위가 높은 사건 5개를 골라 날짜순으로 보여 준다 (가장 이른 회사 설립이 맨 앞 순위)
    chosen = sorted(picked, key=lambda e: (e["rank"], e["year"]))[:5]
    return [{"year": e["year"], "month": e["month"], "text": e["text"]}
            for e in sorted(chosen, key=lambda e: (e["year"], e["month"]))]


# ---------- 사업장 ----------

def shorten_address(addr: str) -> str:
    """'경기도 화성시 동탄산단4길 9-29 (방교동)' → '화성시 방교동', '서울특별시 강남구 테헤란로' → '서울 강남구'."""
    addr = re.sub(r"\s+", " ", addr or "").strip()
    dong = ""
    m = re.search(r"\(([가-힣0-9]+(?:동|읍|면|가))[,)\s]", addr + " ")
    if m:
        dong = m.group(1)
    parts = []
    for tok in re.sub(r"\(.*?\)", " ", addr).split():
        if tok.endswith(("특별시", "광역시", "특별자치시")):
            parts.append(tok[:2])
        elif tok.endswith(("특별자치도", "도")) and len(tok) <= 6 and not parts:
            continue
        elif tok.endswith(("시", "군")) and len(parts) < 2:
            parts.append(tok)
        elif tok.endswith("구") and parts and len(parts) < 3:
            parts.append(tok)
        elif tok.endswith(("동", "읍", "면")) and parts and not dong and not re.search(r"\d", tok):
            dong = tok
            break
        elif parts:
            break
    out = " ".join(parts + ([dong] if dong else []))
    return out or addr[:20]


def site_roles(name: str) -> list:
    """'본사/공장' → ['본사', '제조']. '사업장'은 다른 역할을 못 찾았을 때만 쓴다."""
    roles = [role for role, pattern in SITE_ROLES if re.search(pattern, name or "")]
    return [r for r in roles if r != "사업장"] or roles


METRO = ("서울", "부산", "대구", "인천", "광주", "대전", "울산")


def _site_key(loc: str) -> str:
    """'화성시 석우동'·'화성 동탄'·'화성시' → '화성', '서울 강남구 역삼동' → '서울 강남'."""
    toks = [re.sub(r"(?<=[가-힣])(?:시|군|구)$", "", t) for t in loc.split()]
    return " ".join(toks[:2]) if toks and toks[0] in METRO else (toks[0] if toks else "")


def merge_sites(pairs: list) -> list:
    """(위치, 역할) 쌍을 같은 시·군(광역시는 구)끼리 합친다. 이름은 더 자세한 쪽을, 같으면 먼저 나온 쪽을 쓴다."""
    merged = {}
    for loc, role in pairs:
        if not (loc and role):
            continue
        site = merged.setdefault(_site_key(loc), {"location": loc, "roles": []})
        if len(loc.split()) > len(site["location"].split()):
            site["location"] = loc
        if role not in site["roles"]:
            site["roles"].append(role)
    order = {"본사": 0, "제조": 1, "사업장": 2, "연구소": 3, "물류": 4, "영업": 5}
    items = [{"location": s["location"], "roles": sorted(s["roles"], key=lambda x: order.get(x, 9))} for s in merged.values()]
    items.sort(key=lambda s: min(order.get(x, 9) for x in s["roles"]))
    return items[:5]


def _between(doc: str, start: str, end: str) -> str:
    m = re.search(r"<TITLE[^>]*>[^<]*" + start + r"[^<]*</TITLE>", doc, re.I)
    if not m:
        return ""
    e = re.search(r"<TITLE[^>]*>[^<]*" + end + r"[^<]*</TITLE>", doc[m.end():], re.I)
    return doc[m.end(): m.end() + e.start()] if e else doc[m.end(): m.end() + 400000]


def parse_sites(doc: str) -> list:
    """사업보고서 '사업의 내용'의 사업장·생산설비 표(사업장명 + 소재지)에서 국내 사업장을 (위치, 역할) 쌍으로 모은다."""
    section = _between(doc, r"사업의\s*내용", r"재무에\s*관한\s*사항") or doc[:2_000_000]
    pairs = []
    for table in TABLE_RE.findall(section):
        rows = table_rows(table)
        if len(rows) < 2:
            continue
        header = rows[0]
        joined = " ".join(header)
        if SITE_EXCLUDE.search(joined):
            continue
        if not SITE_HEADER.search(joined):
            pairs += _production_sites(rows)
            continue
        addr_idx = next((i for i, h in enumerate(header) if SITE_HEADER.search(h)), None)
        if addr_idx is None:
            continue
        name_idx = 0 if addr_idx != 0 else 1
        for row in rows[1:]:
            if len(row) <= max(addr_idx, name_idx):
                continue
            name, addr = row[name_idx], row[addr_idx]
            if not (re.match(PROVINCE, addr.strip()) or re.search(r"[가-힣]+(?:시|군|구|도)(?:\s|$)", addr)):
                continue  # 해외 사업장이나 빈 칸
            pairs += [(shorten_address(addr), role) for role in site_roles(name)]
    text = strip_tags(re.sub(r"<(?:P|BR)\b[^>]*>", "\n", TABLE_RE.sub(" ", section), flags=re.I))
    return pairs + sentence_sites(text, own_only=True)


def _production_sites(rows: list) -> list:
    """생산실적·생산능력 표의 '사업소/사업장/공장' 칸에서 생산 거점을 읽는다. '화성 동탄 (본사)' → ('화성 동탄', 본사·제조)."""
    header = [re.sub(r"\s", "", h) for h in rows[0]]
    idx = next((i for i, h in enumerate(header) if re.fullmatch(r"사업소|사업장|공장(?:명)?|생산(?:거점|공장)", h)), None)
    if idx is None or not re.search(r"제\d+\s*\(?(?:당|전)|생산|가동|수량|실적", " ".join(rows[0])):
        return []
    pairs = []
    for row in rows[1:]:
        if len(row) <= idx:
            continue
        name = row[idx].strip()
        if not re.search(r"[가-힣]", name) or len(name) > 25 or re.fullmatch(r"(?:합\s*계|소\s*계|총\s*계|계|-)", name):
            continue
        place = shorten_address(name) if ADDRESS_RE.search(name) else \
            re.sub(r"\s+", " ", re.sub(r"\(.*?\)|본사|본점|공장|사업장|사업소|캠퍼스|\d+", " ", name)).strip()
        if place:
            pairs += [(place, role) for role in dict.fromkeys(site_roles(name) + ["제조"])]
    return pairs


def sentence_sites(text: str, own_only: bool = False) -> list:
    """'본사 및 공장은 경기도 평택시 진위면에 소재' 같은 문장에서 (위치, 역할) 쌍을 찾는다.
    own_only 이면 '당사'·'회사' 가 주어인 문장만 본다 (고객사 공장 위치 등을 거르기 위해)."""
    pairs = []
    for s in re.split(r"(?<=다\.)\s+|\n", text):
        if not re.search(r"소재|위치|두고", s) or (own_only and not re.search(r"당사|회사의|회사는|본사", s)):
            continue
        for addr in ADDRESS_RE.findall(s):
            before = s[: s.find(addr)][-25:]
            roles = [role for role, pattern in SITE_ROLES if re.search(pattern, before)] or \
                    [role for role, pattern in SITE_ROLES if re.search(pattern, s)] or ["본사"]
            pairs += [(shorten_address(addr), role) for role in roles]
    return pairs


def detect_standard(doc: str) -> str:
    k_gaap, k_ifrs = doc.count("일반기업회계기준"), doc.count("한국채택국제회계기준")
    if not (k_gaap or k_ifrs):
        return ""
    return "K-GAAP" if k_gaap > k_ifrs else "K-IFRS"


def business_overview(doc: str) -> dict:
    """사업보고서 원문에서 주요 연혁, 사업장 (위치, 역할) 쌍, 회계기준을 읽는다."""
    return {"history": parse_history(doc), "sites": parse_sites(doc), "standard": detect_standard(doc)}


# ---------- 감사보고서 주석 '회사의 개요' ----------

def _history_sentence(s: str) -> dict:
    """'주식회사 OO(이하 "회사")는 1995년 7월 1일에 ... 설립된 ...' → 주어와 상법 문구를 뗀 한 문장(끝까지)."""
    s = re.sub(r"^.{0,60}?\(이하[^)]*\)\s*(?:은|는)\s*", "", s)  # '주식회사 OO(이하 "회사")는' 떼기
    s = re.sub(r"(?:대한민국\s*)?상법(?:의\s*규정)?에\s*(?:준거|의거|따라)하?여\s*", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) > 220:  # 아주 긴 문장만 마지막 쉼표·어절에서 끊는다
        s = s[:220].rsplit(",", 1)[0].rsplit(" ", 1)[0] + "…"
    year = re.search(r"((?:19|20)\d{2})\s*년", s)
    return {"year": int(year.group(1)) if year else None, "text": s}


def audit_overview(doc: str) -> dict:
    """감사보고서 주석 1(일반사항)에서 연혁 문장, 사업장 (위치, 역할) 쌍, 회계기준을 읽는다."""
    text = strip_tags(doc)
    out = {"history": [], "sites": [], "standard": detect_standard(text)}

    m = re.search(r"1\s*[.)]\s*(?:일반\s*사항|일반적인?\s*사항|(?:회사|당사)의?\s*개요|보고\s*기업|일반\s*정보)", text)
    if not m:  # 제목이 다르면 '…설립되었' 문장이 처음 나오는 곳을 쓴다
        m = re.search(r"[^.]{0,120}설립(?:되|된|하였|하여)", text)
        if not m:
            return out
        start = m.start()
    else:
        start = m.end()
    chunk = text[start: start + 1500]
    sentences = [s.strip() for s in re.split(r"(?<=다\.)\s+", chunk) if s.strip()][:6]
    for s in sentences:
        if (re.search(r"설립|합병|분할|상호|사명|상장|인수", s)
                and not re.search(r"회계|기준서|재무제표|공시|주석|자본금|주주|증자|주식(?!\s*회사)", s)):
            out["history"].append(_history_sentence(s))
        out["sites"] += sentence_sites(s)
    out["history"] = out["history"][:3]
    out["shareholders"] = audit_shareholders(doc)
    return out


def audit_shareholders(doc: str) -> list:
    """감사보고서 주석의 주주 현황 표(주주명 | 주식수 | 지분율)에서 지분율 상위 주주를 읽는다."""
    for table in TABLE_RE.findall(doc):
        rows = table_rows(table)
        if len(rows) < 2:
            continue
        head = [re.sub(r"\s", "", h) for h in rows[0]]
        name_i = next((i for i, h in enumerate(head) if re.search(r"주주|성명|회사명", h)), None)
        ratio_i = next((i for i, h in enumerate(head) if re.search(r"지분율|소유비율|비율|지분\(%\)", h)), None)
        if name_i is None or ratio_i is None or name_i == ratio_i:
            continue
        holders = []
        for row in rows[1:]:
            if len(row) <= max(name_i, ratio_i):
                continue
            name = row[name_i].strip()
            ratio = re.search(r"\d+(?:\.\d+)?", row[ratio_i].replace(",", ""))
            if not name or re.fullmatch(r"(?:합\s*계|계|소\s*계|기\s*타|-)", name) or not ratio:
                continue
            if 0 < float(ratio.group()) <= 100:
                holders.append({"name": name, "relation": "", "ratio": ratio.group()})
        if holders:
            holders.sort(key=lambda h: float(h["ratio"]), reverse=True)
            return holders[:5]
    return []
