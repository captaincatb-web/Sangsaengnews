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
                          r"지주\s*회사|공장\s*(?:준공|신설|착공|완공)|본점\s*이전|본사\s*이전|최대주주\s*변경")
HISTORY_DROP = re.compile(r"선임|사임|취임|퇴임|대표이사|수상|인증|선정|특허|표창|훈장|포상|ISO|벤처|"
                          r"신주인수권|사채|증자|감자|액면")
# 해외 법인·지사·공장처럼 회사 자체의 설립이 아닌 사건
SUBSIDIARY = re.compile(r"Inc\b|Ltd\b|Co\.|Corp|GmbH|LLC|해외|현지|미국|중국|일본|대만|베트남|싱가포르|말레이시아|"
                        r"유럽|독일|지사|자회사|연구소|공장|센터|사무소|합작")

SITE_HEADER = re.compile(r"소재지|주\s*소|위\s*치")
SITE_EXCLUDE = re.compile(r"설립일|지분|주요\s*사업|최대주주|대표이사|상\s*호|자산총액|종속|관계")
SITE_ROLES = [("본사", r"본사|본점|본관|HQ"), ("연구소", r"연구|R&D|기술원"), ("제조", r"공장|생산|제조|팹|Fab|FAB"),
              ("물류", r"물류|창고"), ("영업", r"지점|영업소|사무소|지사|영업"), ("사업장", r"사업장|캠퍼스")]
ADDRESS_RE = re.compile(r"([가-힣]+(?:특별시|광역시|특별자치시|특별자치도|도)\s+[가-힣]+(?:시|군|구)"
                        r"(?:\s+[가-힣]+(?:구|군))?(?:\s+[가-힣0-9]+(?:동|읍|면|가))?)")


def strip_tags(raw: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", raw))).strip()


def table_rows(table: str) -> list:
    return [[strip_tags(c[1]) for c in CELL_RE.findall(tr)] for tr in ROW_RE.findall(table)]


# ---------- 연혁 ----------

def _section(doc: str, title_pattern: str, limit: int = 150000) -> str:
    m = re.search(r"<TITLE[^>]*>[^<]*" + title_pattern + r"[^<]*</TITLE>", doc, re.I)
    if not m:
        return ""
    end = doc.find("<TITLE", m.end())
    return doc[m.end(): end if end != -1 else m.end() + limit][:limit]


def _clean_event(text: str) -> str:
    t = re.sub(r"^[\s\-·ㆍ•▶○●□■*]+", "", text)
    t = re.sub(r"\s+", " ", t).strip(" .")
    return t[:70] + ("…" if len(t) > 70 else "")


def _rank(event: str) -> int:
    if re.search(r"설립|창립|창업", event) and not SUBSIDIARY.search(event):
        return 0  # 회사 설립
    for i, pattern in enumerate([r"상장", r"분할|합병|지주", r"상호|사명", r"법인|지사|설립", r"인수"], start=1):
        if re.search(pattern, event):
            return i
    return 6


def _cell_lines(raw: str) -> list:
    return [t for t in (strip_tags(x) for x in BREAK_RE.split(raw)) if t]


def parse_history(doc: str) -> list:
    """사업보고서 '회사의 연혁'에서 설립·상장·사명 변경·분할·해외 법인 같은 주요 사건을 최대 5개 고른다."""
    section = _section(doc, r"회사의\s*연혁")
    if not section:
        return []
    events = []
    for table in TABLE_RE.findall(section):
        for tr in ROW_RE.findall(table):
            raw_cells = [c[1] for c in CELL_RE.findall(tr)]
            cells = [strip_tags(c) for c in raw_cells]
            for i, cell in enumerate(cells[:-1]):
                m = DATE_RE.match(cell)
                if not (m and len(cell) <= 20):
                    continue
                year, month, rest = int(m.group(1)), int(m.group(2) or 0), raw_cells[i + 1:]
                if rest and re.fullmatch(r"\d{1,2}\s*월?", strip_tags(rest[0])):  # 연도 칸 + 월 칸
                    month, rest = int(re.sub(r"\D", "", strip_tags(rest[0]))), rest[1:]
                for raw in rest:
                    for text in _cell_lines(raw):  # 한 칸에 '04.01 설립<br>11.20 상장' 처럼 여러 줄
                        mm = MONTH_RE.match(text)
                        if mm and len(text) > mm.end() + 2 and int(mm.group(1)) <= 12:
                            events.append((year, int(mm.group(1)), text[mm.end():]))
                        else:
                            events.append((year, month, text))
                break
    # 표 밖의 줄글: "1990.12 회사 설립" 형식
    text = TABLE_RE.sub(" ", section)
    for line in re.split(r"<(?:BR|P)\b[^>]*>|\n", text, flags=re.I):
        row = re.sub(r"^[\s\-·ㆍ•▶○●□■*]+", "", strip_tags(line))
        m = DATE_RE.match(row)
        if m and len(row) > m.end() + 2:
            events.append((int(m.group(1)), int(m.group(2) or 0), row[m.end():]))

    seen, picked = set(), []
    for year, month, event in sorted(events, key=lambda e: (e[0], e[1])):
        event = _clean_event(event)
        key = re.sub(r"\W", "", event)
        if not event or key in seen or not HISTORY_KEEP.search(event) or HISTORY_DROP.search(event):
            continue
        seen.add(key)
        picked.append({"year": year, "month": month, "text": event, "rank": _rank(event)})
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


def merge_sites(pairs: list) -> list:
    """(위치, 역할) 쌍을 위치별로 합친다. '화성시' 처럼 다른 위치의 앞부분인 곳은 더 자세한 쪽에 합친다."""
    merged = {}
    for loc, role in pairs:
        if loc and role:
            roles = merged.setdefault(loc, [])
            if role not in roles:
                roles.append(role)
    for loc in sorted(merged, key=len):
        longer = next((o for o in merged if o != loc and o.startswith(loc + " ")), None)
        if longer:
            merged[longer] += [r for r in merged.pop(loc) if r not in merged[longer]]
    order = {"본사": 0, "제조": 1, "사업장": 2, "연구소": 3, "물류": 4, "영업": 5}
    items = [{"location": loc, "roles": sorted(r, key=lambda x: order.get(x, 9))} for loc, r in merged.items()]
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
        if not SITE_HEADER.search(joined) or SITE_EXCLUDE.search(joined):
            continue
        addr_idx = next((i for i, h in enumerate(header) if SITE_HEADER.search(h)), None)
        if addr_idx is None:
            continue
        name_idx = 0 if addr_idx != 0 else 1
        for row in rows[1:]:
            if len(row) <= max(addr_idx, name_idx):
                continue
            name, addr = row[name_idx], row[addr_idx]
            if not re.search(r"[가-힣]+(?:시|군|구|도)(?:\s|$)|특별시|광역시", addr):
                continue  # 해외 사업장이나 빈 칸
            pairs += [(shorten_address(addr), role) for role in site_roles(name)]
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

def audit_overview(doc: str) -> dict:
    """감사보고서 주석 1(일반사항)에서 연혁 문장, 사업장 (위치, 역할) 쌍, 회계기준을 읽는다."""
    text = strip_tags(doc)
    out = {"history": [], "sites": [], "standard": detect_standard(text)}

    m = re.search(r"1\s*\.\s*(?:일반\s*사항|일반적인?\s*사항|회사의\s*개요|회사\s*개요)", text)
    if not m:
        return out
    chunk = text[m.end(): m.end() + 1500]
    sentences = [s.strip() for s in re.split(r"(?<=다\.)\s+", chunk) if s.strip()][:6]
    for s in sentences:
        if re.search(r"설립|합병|분할|상호|사명|상장|인수", s) and not re.search(r"회계|기준서|재무제표|공시|주석", s):
            s = re.sub(r"^.{0,60}?\(이하[^)]*\)\s*(?:은|는)\s*", "", s)  # '주식회사 OO(이하 "회사")는' 떼기
            m_year = re.search(r"((?:19|20)\d{2})\s*년", s)
            out["history"].append({"year": int(m_year.group(1)) if m_year else None,
                                   "text": s[:150] + ("…" if len(s) > 150 else "")})
        if re.search(r"소재|위치", s):
            for addr in ADDRESS_RE.findall(s):
                before = s[: s.find(addr)][-25:]
                roles = [role for role, pattern in SITE_ROLES if re.search(pattern, before)] or \
                        [role for role, pattern in SITE_ROLES if re.search(pattern, s)] or ["본사"]
                for role in roles:
                    out["sites"].append((shorten_address(addr), role))
    out["history"] = out["history"][:3]
    return out
