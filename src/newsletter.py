import argparse
import os
import sys
from datetime import datetime

from src import email_sender
from src.history import KST
from src.newsletter_collector import collect_articles, group_similar
from src.newsletter_config import OUTPUT_DIR, RECIPIENT_EMAIL_DEFAULT, TARGET_GROUPS, all_company_names
from src.newsletter_finance import Cache, build_fin_summary, build_price_cell
from src.newsletter_html import build_newsletter_html

# 본문 크기 한도 회피를 위해 1~3그룹 / 4그룹을 별도 메일로 발송
MAILS = [
    ("domestic", [1, 2, 3], "국내 핵심 소부장 파트너사 동향 (1~3그룹)"),
    ("global", [4], "해외 핵심 소부장 파트너사 동향 (4그룹)"),
]


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

    cache = Cache()
    fin_cells, price_cells = {}, {}
    for company in all_company_names():
        fin_cells[company] = build_fin_summary(company, dart_key, now, cache, gemini_key, gemini_model)
        price_cells[company] = build_price_cell(company)
    cache.save()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, group_ids, title in MAILS:
        groups = [g for g in TARGET_GROUPS if g["group_id"] in group_ids]
        html_body = build_newsletter_html(company_articles, now, groups, title, fin_cells, price_cells)
        out_path = OUTPUT_DIR / f"newsletter_{name}.html"
        out_path.write_text(html_body, encoding="utf-8")
        print(f"HTML 저장: {out_path} ({len(html_body) // 1024}KB)")

        if args.dry_run:
            # Gmail 도구로 나눠 보낼 수 있도록 그룹별 HTML도 저장
            for g in groups:
                part = build_newsletter_html(company_articles, now, [g], g["group_name"], fin_cells, price_cells)
                (OUTPUT_DIR / f"newsletter_group{g['group_id']}.html").write_text(part, encoding="utf-8")
            continue
        email_sender.send_html(
            os.environ.get("SMTP_HOST") or "smtp.gmail.com",
            int(os.environ.get("SMTP_PORT") or 465),
            smtp_user,
            smtp_password,
            recipient,
            f"📬 [뉴스레터] {title}",
            html_body,
        )
        print(f"메일 발송 완료: {title} → {recipient}")


if __name__ == "__main__":
    main()
