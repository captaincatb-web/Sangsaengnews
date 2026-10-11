from datetime import datetime
from html import escape

from src.newsletter_config import FIXED_COMPANY_LIMIT, MAX_SIM, get_display_name

# 메일 클라이언트가 <style> 블록을 무시하는 경우가 있어 전부 인라인 스타일로 작성
TH = "padding:10px 8px;border:1px solid #d1d6db;background-color:#f2f4f6;font-weight:bold;color:#4e5968;text-align:center;font-size:13px;"
TD = "border:1px solid #d1d6db;padding:8px;"
TD_LAST = "border:1px solid #d1d6db;padding:8px;text-align:center;"
EMPTY = "border:1px solid #d1d6db;padding:10px;color:#b0b8c1;font-style:italic;font-size:12px;text-align:center;background-color:#ffffff;"
SIM_TD = "border:1px solid #d1d6db;padding:6px;"
GRP_START = "border-top:3px solid #3182f6;"
DART_BADGE = "background-color:#e8f3ff;border:1px solid #3182f6;border-radius:4px;padding:2px 6px;color:#3182f6;font-size:11px;"


def _co_style(alt: bool) -> str:
    bg = "#eef1f4" if alt else "#f8f9fa"
    return (
        f"padding:8px 6px;border:1px solid #d1d6db;background-color:{bg};font-weight:bold;color:#333d4b;"
        "font-size:11px;text-align:center;vertical-align:middle;word-break:keep-all;line-height:1.4;"
    )


def _age_days(now: datetime, article: dict) -> float:
    return (now - article["pub_date"]).total_seconds() / 86400


def build_newsletter_html(company_articles: dict, now: datetime, groups: list, title_text: str, fin_cells: dict, price_cells: dict) -> str:
    out = ['<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:1000px;color:#191f28;">']
    out.append(f"<h2>📬 [뉴스레터] {title_text}</h2>")
    out.append(
        '<p style="font-size:12px;color:#8b95a1;margin-bottom:20px;">💡 <b>기사 색상 안내:</b> '
        '<span style="color:#f04452;font-weight:bold;">빨간색(오늘)</span> / '
        '<span style="color:#3182f6;font-weight:bold;">파란색(최근 7일)</span> / '
        '<span style="color:#b0b8c1;font-weight:bold;">회색(7일 경과)</span></p>'
    )

    for group in groups:
        out.append(
            '<h3 style="margin-top:30px;margin-bottom:12px;font-size:16px;border-left:4px solid #3182f6;padding-left:10px;">'
            f"{group['group_name']}</h3>"
        )
        out.append('<table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #d1d6db;margin-bottom:15px;table-layout:fixed;">')
        out.append(
            "<tr>"
            + "".join(
                f'<th style="width:{w};{TH}">{name}</th>'
                for w, name in (
                    ("10%", "회사"), ("9%", "종가"), ("13%", "최근분기 재무"), ("29%", "제목"),
                    ("10%", "출처"), ("10%", "보도일"), ("9%", "구분"), ("6%", "유사"),
                )
            )
            + "</tr>"
        )

        for idx, company in enumerate(group["companies"]):
            articles = company_articles.get(company, [])
            disp = get_display_name(company)
            name_html = company if disp == company else f'<span title="{company}">{disp}</span>'
            grp_border = GRP_START if idx > 0 else ""
            co_first = grp_border + _co_style(idx % 2 == 1)
            lead_cells = (name_html, price_cells[company], fin_cells[company])

            if not articles:
                out.append(
                    "<tr>"
                    + "".join(f'<td style="{co_first}">{c}</td>' for c in lead_cells)
                    + f'<td colspan="5" style="{grp_border}{EMPTY}">최근 수집된 동향 뉴스가 없습니다.</td></tr>'
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

                is_first = a_idx == 0
                row_extra = grp_border if is_first else ""

                row = ["<tr>"]
                if is_first:
                    row += [f'<td rowspan="{total_rows}" style="{co_first}">{c}</td>' for c in lead_cells]
                row.append(
                    f'<td style="{row_extra}{TD}text-align:left;"><a href="{escape(article["link"])}" '
                    f'style="color:{title_color};text-decoration:none;font-weight:600;">{escape(article["title"])}</a></td>'
                )
                row.append(f'<td style="{row_extra}{TD}text-align:center;color:{text_color};">{escape(article["source"])}</td>')
                row.append(f'<td style="{row_extra}{TD}text-align:center;color:{text_color};font-size:12px;">{article["date_str"]}</td>')
                category = (
                    f'<span style="{DART_BADGE}">{article["cat3"]}</span>' if article["cat3"] == "공시자료" else article["cat2"]
                )
                row.append(f'<td style="{row_extra}{TD}text-align:center;color:{text_color};">{category}</td>')
                row.append(f'<td style="{row_extra}{TD_LAST}font-weight:bold;color:{sim_color};font-size:13px;">{sim_text}</td></tr>')
                out.append("".join(row))

                for sim in article["similar_articles"][:MAX_SIM]:
                    s_age = _age_days(now, sim)
                    s_title_color = "#333d4b" if s_age <= 1 else ("#6b7684" if s_age <= 7 else "#c6cacc")
                    s_text_color = "#4e5968" if s_age <= 1 else ("#8b95a1" if s_age <= 7 else "#d1d6db")
                    out.append(
                        '<tr style="background-color:#fafafa;">'
                        f'<td style="{SIM_TD}text-align:left;padding-left:16px;">· <a href="{escape(sim["link"])}" '
                        f'style="color:{s_title_color};text-decoration:none;font-size:12px;">{escape(sim["title"])}</a></td>'
                        f'<td style="{SIM_TD}text-align:center;color:{s_text_color};font-size:11px;">{escape(sim["source"])}</td>'
                        f'<td style="{SIM_TD}text-align:center;color:{s_text_color};font-size:11px;">{sim["date_str"]}</td>'
                        f'<td style="{SIM_TD}text-align:center;color:{s_text_color};font-size:11px;">{sim["cat2"]}</td>'
                        f'<td style="{SIM_TD}"></td></tr>'
                    )
        out.append("</table>")
    out.append("</div>")
    return "".join(out)
