"""주차별 뉴스 홈페이지 (정적 사이트, GitHub Pages용 docs/)

- docs/index.html           7~10월 주차 목록 (월별 탭, 주요 소식 미리보기)
- docs/weeks/YYYY-MM-DD.html  그 주(목요일 발행일 기준)의 뉴스레터 전체 + 회사 검색
- data/site_weeks.json      주차별 요약 (목록 페이지 재생성용)
"""
import json
from datetime import date, datetime, timedelta
from html import escape

from src.config import ROOT_DIR

SITE_DIR = ROOT_DIR / "docs"
WEEKS_DIR = SITE_DIR / "weeks"
META_PATH = ROOT_DIR / "data" / "site_weeks.json"
SITE_START = date(2026, 7, 2)  # 첫 주차: 7월 첫 목요일
SITE_TITLE = "소부장 파트너사 주간 동향"

CSS = """
*{box-sizing:border-box}body{margin:0;background:#f6f7f9;color:#191f28;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif}
a{color:#3182f6}.wrap{max-width:1040px;margin:0 auto;padding:16px}
header.top{background:#fff;border-bottom:1px solid #e5e8eb}header.top .wrap{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px}
header.top h1{font-size:18px;margin:0;flex:1;min-width:200px}header.top h1 a{color:#191f28;text-decoration:none}
.nav a,.nav span{font-size:13px;margin-left:10px;text-decoration:none;white-space:nowrap}.nav span{color:#b0b8c1}
input.q{width:100%;padding:10px 12px;border:1px solid #d1d6db;border-radius:8px;font-size:14px;margin:12px 0}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0}.tabs button{border:1px solid #d1d6db;background:#fff;border-radius:999px;padding:7px 14px;font-size:14px;cursor:pointer}
.tabs button.on{background:#3182f6;border-color:#3182f6;color:#fff}
.card{background:#fff;border:1px solid #e5e8eb;border-radius:10px;padding:14px 16px;margin:10px 0}
.card h3{margin:0 0 4px;font-size:16px}.card h3 a{text-decoration:none;color:#191f28}.card .meta{font-size:12px;color:#6b7684;margin-bottom:8px}
.card ul{margin:0;padding-left:18px;font-size:13px;line-height:1.7}.card .tag{font-size:10px;background:#f2f4f6;color:#4e5968;padding:1px 5px;margin-right:4px}
.latest{border-color:#3182f6}.foot{font-size:12px;color:#8b95a1;margin:24px 0}
.page{background:#fff;border:1px solid #e5e8eb;border-radius:10px;padding:14px}
"""


def week_key(d: date) -> date:
    """발행일이 속한 주의 목요일 (월~수 수동 발행분도 그 주 목요일 페이지로 모은다)"""
    return d + timedelta(days=(3 - d.weekday()) % 7)


def all_week_keys(today: date) -> list:
    keys, d = [], SITE_START
    while d <= week_key(today):
        keys.append(d)
        d += timedelta(days=7)
    return keys


def _load_meta() -> dict:
    try:
        return json.loads(META_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _page(title: str, body: str, nav: str = "", script: str = "") -> str:
    return (
        '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{escape(title)}</title><style>{CSS}</style></head><body>"
        f'<header class="top"><div class="wrap"><h1><a href="{_root(nav)}index.html">📬 {SITE_TITLE}</a></h1>'
        f'<div class="nav">{nav if nav and nav != "root" else ""}</div></div></header>'
        f'<div class="wrap">{body}</div>{script}</body></html>'
    )


def _root(nav: str) -> str:
    return "" if nav == "root" or not nav else "../"


def publish_week(now: datetime, body_html: str, stats: dict, highlights: list) -> None:
    """한 주차 페이지를 쓰고 목록을 다시 만든다. highlights: [(회사, article)]"""
    key = week_key(now.date())
    WEEKS_DIR.mkdir(parents=True, exist_ok=True)
    META_PATH.parent.mkdir(parents=True, exist_ok=True)
    meta = _load_meta()
    meta[key.isoformat()] = {
        "fresh_news": stats["fresh_news"],
        "fresh_dart": stats["fresh_dart"],
        "fresh_companies": stats["fresh_companies"],
        "total": stats["total_companies"],
        "highlights": [
            {"company": c, "title": a["title"], "link": a["link"], "cat": a["cat2"]} for c, a in highlights[:3]
        ],
    }
    META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    keys = sorted(meta)
    i = keys.index(key.isoformat())
    prev_l = f'<a href="{keys[i - 1]}.html">← 이전 주</a>' if i > 0 else "<span>← 이전 주</span>"
    next_l = f'<a href="{keys[i + 1]}.html">다음 주 →</a>' if i + 1 < len(keys) else "<span>다음 주 →</span>"
    nav = f'<a href="../index.html">전체 주차</a>{prev_l}{next_l}'
    script = (
        "<script>var q=document.getElementById('q');q.addEventListener('input',function(){var v=q.value.trim().toLowerCase();"
        "document.querySelectorAll('.page table tr').forEach(function(r){if(r.querySelector('th'))return;"
        "r.style.display=(!v||r.textContent.toLowerCase().indexOf(v)>-1)?'':'none';});});</script>"
    )
    body = (
        '<input class="q" id="q" type="search" placeholder="회사명·키워드로 이 주 소식 찾기 (예: 심텍, 수주, 증설)">'
        f'<div class="page">{body_html}</div>'
        '<div class="foot">기사 제목과 원문 링크만 모아 보여 주는 자동 수집 페이지입니다. 저작권은 각 언론사에 있습니다.</div>'
    )
    (WEEKS_DIR / f"{key}.html").write_text(_page(f"{SITE_TITLE} {key:%m/%d}", body, nav, script), encoding="utf-8")
    build_index()


def build_index() -> None:
    meta = _load_meta()
    SITE_DIR.mkdir(parents=True, exist_ok=True)
    months = sorted({k[:7] for k in meta}, reverse=True)
    latest = max(meta) if meta else ""
    tabs, cards = [], []
    for m in months:
        tabs.append(f'<button data-m="{m}">{int(m[5:])}월</button>')
    for k in sorted(meta, reverse=True):
        d = date.fromisoformat(k)
        s = meta[k]
        start = d - timedelta(days=7)
        hl = "".join(
            f'<li><span class="tag">{escape(h["cat"])}</span><b>{escape(h["company"])}</b> · '
            f'<a href="{escape(h["link"])}">{escape(h["title"])}</a></li>'
            for h in s["highlights"]
        )
        cls = "card latest" if k == latest else "card"
        cards.append(
            f'<div class="{cls}" data-m="{k[:7]}"><h3><a href="weeks/{k}.html">{d:%Y.%m.%d}(목) 발행 주</a>'
            f'{" · 최신" if k == latest else ""}</h3>'
            f'<div class="meta">{start.month}/{start.day} ~ {d.month}/{d.day} · 새 소식 {s["fresh_news"]}건 '
            f'(공시 {s["fresh_dart"]}건) · 소식 있는 회사 {s["fresh_companies"]}/{s["total"]}곳</div>'
            f"<ul>{hl}</ul></div>"
        )
    script = (
        "<script>var b=document.querySelectorAll('.tabs button'),c=document.querySelectorAll('.card');"
        "function show(m){b.forEach(function(x){x.classList.toggle('on',x.dataset.m===m||(m==='all'&&x.dataset.m==='all'))});"
        "c.forEach(function(x){x.style.display=(m==='all'||x.dataset.m===m)?'':'none'});}"
        "b.forEach(function(x){x.onclick=function(){show(x.dataset.m)}});show('all');</script>"
    )
    body = (
        f'<p style="font-size:14px;color:#4e5968;margin:16px 0 0">반도체 소부장 파트너사 73곳의 뉴스·공시를 매주 목요일 모아 보여 줍니다 '
        f"(2026년 7월~). 주차를 눌러 그 주 전체 소식을 볼 수 있습니다.</p>"
        f'<div class="tabs"><button data-m="all">전체</button>{"".join(tabs)}</div>{"".join(cards)}'
        '<div class="foot">매주 목요일 자동 갱신 · 7~9월은 구글뉴스 검색 기준(공시·주가 제외)으로 소급 수집했습니다.</div>'
    )
    (SITE_DIR / "index.html").write_text(_page(SITE_TITLE, body, "root", script), encoding="utf-8")
    (SITE_DIR / ".nojekyll").write_text("", encoding="utf-8")
