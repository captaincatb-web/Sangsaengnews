from datetime import datetime
from html import escape

from src.newsletter_config import FIXED_COMPANY_LIMIT, MAX_SIM, get_display_name

# 메일 클라이언트가 <style> 블록을 무시하는 경우가 있어 인라인 스타일로 작성.
# 본문 크기를 줄이기 위해 테두리/여백은 table 속성(border, cellpadding)으로 처리하고
# 셀마다 다른 값(색상/정렬)만 인라인으로 지정한다.
TABLE = (
    '<table border="1" cellspacing="0" cellpadding="7" width="100%" '
    'style="border-collapse:collapse;border-color:#d1d6db;font-size:13px;table-layout:fixed;margin-bottom:15px">'
)
COLUMNS = (("10%", "회사"), ("9%", "종가"), ("13%", "최근분기 재무"), ("29%", "제목"), ("10%", "출처"), ("10%", "보도일"), ("9%", "구분"), ("6%", "유사"))
DART_BADGE = "background:#e8f3ff;border:1px solid #3182f6;border-radius:4px;padding:2px 6px;color:#3182f6;font-size:11px"


def _age_days(now: datetime, article: dict) -> float:
    return (now - article["pub_date"]).total_seconds() / 86400


def _lead_cell(content: str, alt: bool, rowspan: int = 1) -> str:
    span = f' rowspan="{rowspan}"' if rowspan > 1 else ""
    bg = "#eef1f4" if alt else "#f8f9fa"
    return f'<td{span} align="center" bgcolor="{bg}" style="font-size:11px">{content}</td>'


def build_newsletter_html(company_articles: dict, now: datetime, groups: list, title_text: str, fin_cells: dict, price_cells: dict) -> str:
    out = ['<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:1000px;color:#191f28">']
    out.append(f"<h2>📬 [뉴스레터] {title_text}</h2>")
    out.append(
        '<p style="font-size:12px;color:#8b95a1">💡 <b>기사 색상 안내:</b> '
        '<b style="color:#f04452">빨간색(오늘)</b> / <b style="color:#3182f6">파란색(최근 7일)</b> / '
        '<b style="color:#b0b8c1">회색(7일 경과)</b></p>'
    )

    for group in groups:
        out.append(f'<h3 style="margin:30px 0 12px;font-size:16px;border-left:4px solid #3182f6;padding-left:10px">{group["group_name"]}</h3>')
        out.append(TABLE)
        out.append(
            '<tr bgcolor="#f2f4f6" style="color:#4e5968">'
            + "".join(f'<th width="{w}">{name}</th>' for w, name in COLUMNS)
            + "</tr>"
        )

        for idx, company in enumerate(group["companies"]):
            articles = company_articles.get(company, [])
            disp = get_display_name(company)
            name_html = f"<b>{company}</b>" if disp == company else f'<b title="{company}">{disp}</b>'
            alt = idx % 2 == 1
            lead = (name_html, price_cells[company], fin_cells[company])

            if not articles:
                out.append(
                    "<tr>" + "".join(_lead_cell(c, alt) for c in lead)
                    + '<td colspan="5" align="center" style="color:#b0b8c1;font-style:italic;font-size:12px">최근 수집된 동향 뉴스가 없습니다.</td></tr>'
                )
                continue

            selected = articles[:FIXED_COMPANY_LIMIT]
            total_rows = sum(1 + min(len(a["similar_articles"]), MAX_SIM) for a in selected)

            for a_idx, article in enumerate(selected):
                age = _age_days(now, article)
                title_color = "#f04452" if age <= 1 else ("#3182f6" if age <= 7 else "#b0b8c1")
                text_color = "#333d4b" if age <= 1 else ("#4e5968" if age <= 7 else "#b0b8c1")
                sim_color = "#f04452" if age <= 7 else "#f9a8b0"
                sim_count = len(article["similar_articles"])
                sim_text = "" if sim_count == 0 else (str(sim_count) if sim_count <= MAX_SIM else f"+{sim_count - MAX_SIM}")
                category = (
                    f'<span style="{DART_BADGE}">{article["cat3"]}</span>' if article["cat3"] == "공시자료" else article["cat2"]
                )

                row = ["<tr>"]
                if a_idx == 0:
                    row += [_lead_cell(c, alt, total_rows) for c in lead]
                row.append(
                    f'<td><a href="{escape(article["link"])}" style="color:{title_color};text-decoration:none;font-weight:600">'
                    f'{escape(article["title"])}</a></td>'
                )
                row.append(f'<td align="center" style="color:{text_color}">{escape(article["source"])}</td>')
                row.append(f'<td align="center" style="color:{text_color};font-size:12px">{article["date_str"]}</td>')
                row.append(f'<td align="center" style="color:{text_color}">{category}</td>')
                row.append(f'<td align="center" style="color:{sim_color};font-weight:bold">{sim_text}</td></tr>')
                out.append("".join(row))

                for sim in article["similar_articles"][:MAX_SIM]:
                    s_age = _age_days(now, sim)
                    s_title_color = "#333d4b" if s_age <= 1 else ("#6b7684" if s_age <= 7 else "#c6cacc")
                    s_text_color = "#4e5968" if s_age <= 1 else ("#8b95a1" if s_age <= 7 else "#d1d6db")
                    out.append(
                        f'<tr bgcolor="#fafafa" style="font-size:11px;color:{s_text_color}">'
                        f'<td style="padding-left:16px">· <a href="{escape(sim["link"])}" style="color:{s_title_color};text-decoration:none;font-size:12px">'
                        f'{escape(sim["title"])}</a></td>'
                        f'<td align="center">{escape(sim["source"])}</td><td align="center">{sim["date_str"]}</td>'
                        f'<td align="center">{sim["cat2"]}</td><td></td></tr>'
                    )
        out.append("</table>")
    out.append("</div>")
    return "".join(out)
