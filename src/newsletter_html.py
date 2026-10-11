from datetime import datetime
from html import escape

from src.newsletter_config import FIXED_COMPANY_LIMIT, MAX_SIM, get_display_name

# 메일 클라이언트가 <style> 블록을 무시하는 경우가 있어 인라인으로 작성하되, 본문을 한 통에 담을 수 있도록
# 테두리·여백·정렬은 table/tr 속성으로 한 번만 지정하고 셀마다 반복하지 않는다.
TABLE = (
    '<table border="1" cellspacing="0" cellpadding="6" width="100%" '
    'style="border-collapse:collapse;border-color:#d1d6db;font-size:12px;margin-bottom:15px">'
)
DART_BADGE = "background:#e8f3ff;border:1px solid #3182f6;border-radius:4px;padding:1px 5px;color:#3182f6;font-size:11px"


def _age_days(now: datetime, article: dict) -> float:
    return (now - article["pub_date"]).total_seconds() / 86400


def _link(article: dict, color: str, bold: bool) -> str:
    title = escape(article["title"])
    if bold:
        title = f"<b>{title}</b>"
    return f'<a href="{escape(article["link"])}" style="color:{color};text-decoration:none">{title}</a>'


def build_newsletter_html(
    company_articles: dict,
    now: datetime,
    groups: list,
    title_text: str,
    fin_cells: dict,
    price_cells: dict,
    price_short: dict,
    show_fin: bool = True,
) -> str:
    columns = [("13%", "회사 · 종가")] + ([("14%", "최근분기 재무")] if show_fin else []) + [
        ("", "제목"), ("11%", "출처"), ("9%", "보도일"), ("8%", "구분"), ("5%", "유사"),
    ]
    out = ['<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:1000px;color:#191f28">']
    out.append(f"<h2>📬 [뉴스레터] {title_text}</h2>")
    out.append(
        '<p style="font-size:12px;color:#8b95a1">💡 <b>기사 색상:</b> '
        '<b style="color:#f04452">빨강(오늘)</b> / <b style="color:#3182f6">파랑(최근 7일)</b> / '
        '<b style="color:#b0b8c1">회색(7일 경과)</b></p>'
    )

    for group in groups:
        out.append(f'<h3 style="margin:24px 0 10px;font-size:15px;border-left:4px solid #3182f6;padding-left:8px">{group["group_name"]}</h3>')
        out.append(TABLE)
        out.append(
            '<tr bgcolor="#f2f4f6" style="color:#4e5968">'
            + "".join(f'<th width="{w}">{n}</th>' if w else f"<th>{n}</th>" for w, n in columns)
            + "</tr>"
        )

        quiet = []
        alt = False
        for company in group["companies"]:
            articles = company_articles.get(company, [])
            disp = get_display_name(company)
            name_html = f"<b>{company}</b>" if disp == company else f'<b title="{company}">{disp}</b>'

            if not articles:
                # 뉴스 없는 회사는 그룹 끝에 한 줄로 모은다
                quiet.append(f"{name_html} {price_short[company]}".strip())
                continue

            alt = not alt
            bg = "#f8f9fa" if alt else "#eef1f4"
            selected = articles[:FIXED_COMPANY_LIMIT]
            rows = sum(1 + min(len(a["similar_articles"]), MAX_SIM) for a in selected)
            span = f' rowspan="{rows}"' if rows > 1 else ""
            lead = f'<td{span} bgcolor="{bg}" style="color:#333d4b">{name_html}<br>{price_cells[company]}</td>'
            if show_fin:
                lead += f'<td{span} bgcolor="{bg}" style="font-size:11px">{fin_cells[company]}</td>'

            for a_idx, article in enumerate(selected):
                age = _age_days(now, article)
                title_color = "#f04452" if age <= 1 else ("#3182f6" if age <= 7 else "#b0b8c1")
                text_color = "#333d4b" if age <= 1 else ("#4e5968" if age <= 7 else "#b0b8c1")
                sim_color = "#f04452" if age <= 7 else "#f9a8b0"
                sim_count = len(article["similar_articles"])
                sim_text = "" if sim_count == 0 else (str(sim_count) if sim_count <= MAX_SIM else f"+{sim_count - MAX_SIM}")
                category = f'<span style="{DART_BADGE}">공시</span>' if article["cat3"] == "공시자료" else article["cat2"]

                out.append(
                    f'<tr align="center" style="color:{text_color}">'
                    + (lead if a_idx == 0 else "")
                    + f'<td align="left">{_link(article, title_color, True)}</td>'
                    f'<td>{escape(article["source"])}</td><td>{article["date_str"]}</td><td>{category}</td>'
                    f'<td style="color:{sim_color}"><b>{sim_text}</b></td></tr>'
                )

                for sim in article["similar_articles"][:MAX_SIM]:
                    s_age = _age_days(now, sim)
                    s_title_color = "#333d4b" if s_age <= 1 else ("#6b7684" if s_age <= 7 else "#c6cacc")
                    s_text_color = "#4e5968" if s_age <= 1 else ("#8b95a1" if s_age <= 7 else "#d1d6db")
                    out.append(
                        f'<tr align="center" bgcolor="#fafafa" style="font-size:11px;color:{s_text_color}">'
                        f'<td align="left">· {_link(sim, s_title_color, False)}</td>'
                        f'<td>{escape(sim["source"])}</td><td>{sim["date_str"]}</td><td>{sim["cat2"]}</td><td></td></tr>'
                    )
        if quiet:
            out.append(
                f'<tr><td colspan="{len(columns)}" style="color:#6b7684;line-height:1.8">'
                f'📭 <b>최근 뉴스 없음 ({len(quiet)}곳)</b> · ' + " · ".join(quiet) + "</td></tr>"
            )
        out.append("</table>")
    out.append("</div>")
    return "".join(out)
