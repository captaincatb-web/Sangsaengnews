import argparse
import os
import sys
from datetime import datetime

from src import email_sender, gnews_decoder
from src.history import KST
from src.newsletter_collector import collect_articles, group_similar
from src.newsletter_config import (
    FIXED_COMPANY_LIMIT,
    MAX_SIM,
    OUTPUT_DIR,
    RECIPIENT_EMAIL_DEFAULT,
    TARGET_GROUPS,
    all_company_names,
)
from src.newsletter_finance import Cache, build_fin_summary, build_price_cell, build_price_short
from src.newsletter_html import build_newsletter_html

MAIL_TITLE = "핵심 소부장 파트너사 동향 (1~4그룹)"


def main() -> None:
    parser = argparse.ArgumentParser(description="소부장 파트너사 동향 뉴스레터")
    parser.add_argument("--dry-run", action="store_true", help="메일을 보내지 않고 output/ 에 HTML만 저장")
    args = parser.parse_args()

    smtp_user = os.environ.get("SMTP_USER", "")
    smtp_password = os.environ.get("SMTP_PASSWORD", "")
    if not args.dry_run and not (smtp_user and smtp_password):
        print("필수 환경 변수가 없습니다: SMTP_USER, SMTP_PASSWORD (또는 --dry-run 사용)")
        sys.exit(1)

    dart_key = os.environ.get("OPENDART_KEY", "")
    gemini_key = os.environ.get("GEMINI_KEY", "")
    gemini_model = os.environ.get("GEMINI_MODEL") or "gemini-2.0-flash"
    recipient = os.environ.get("RECIPIENT_EMAIL") or RECIPIENT_EMAIL_DEFAULT

    now = datetime.now(KST)
    company_articles = group_similar(collect_articles())
    resolve_google_links(company_articles)

    cache = Cache()
    fin_cells, price_cells, price_short = {}, {}, {}
    for company in all_company_names():
        fin_cells[company] = build_fin_summary(company, dart_key, now, cache, gemini_key, gemini_model)
        price_cells[company] = build_price_cell(company)
        price_short[company] = build_price_short(company)
    cache.save()

    # 1~4그룹을 한 통으로 (뉴스 없는 회사는 그룹별 한 줄 요약으로 접어 본문 크기를 줄임)
    html_body = build_newsletter_html(
        company_articles, now, TARGET_GROUPS, MAIL_TITLE, fin_cells, price_cells, price_short, show_fin=bool(dart_key)
    )
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / "newsletter.html"
    out_path.write_text(html_body, encoding="utf-8")
    print(f"HTML 저장: {out_path} ({len(html_body.encode()) // 1024}KB)")

    if args.dry_run:
        return
    email_sender.send_html(
        os.environ.get("SMTP_HOST") or "smtp.gmail.com",
        int(os.environ.get("SMTP_PORT") or 465),
        smtp_user,
        smtp_password,
        recipient,
        f"📬 [뉴스레터] {MAIL_TITLE}",
        html_body,
    )
    print(f"메일 발송 완료 → {recipient}")


def resolve_google_links(company_articles: dict) -> None:
    """메일에 실제로 표시되는 기사만 구글뉴스 링크를 원문 링크로 바꾼다"""
    shown = []
    for articles in company_articles.values():
        for a in articles[:FIXED_COMPANY_LIMIT]:
            shown.append(a)
            shown.extend(a["similar_articles"][:MAX_SIM])
    mapping = gnews_decoder.decode_all(a["link"] for a in shown)
    for a in shown:
        a["link"] = mapping.get(a["link"], a["link"])

if __name__ == "__main__":
    main()
