import os
import sys

from src import kakao_sender, stock_data
from src.history import today_str
from src.news_collector import fetch_google_news, title_matches_query
from src.portfolio_config import STOCKS

REQUIRED_ENV_VARS = ["KAKAO_REST_API_KEY", "KAKAO_REFRESH_TOKEN"]


def load_env() -> dict:
    env = {name: os.environ.get(name, "") for name in REQUIRED_ENV_VARS}
    missing = [name for name, value in env.items() if not value]
    if missing:
        print(f"필수 환경 변수가 없습니다: {', '.join(missing)}")
        sys.exit(1)
    return env


def build_stock_message(name: str, ticker: str) -> tuple:
    quote = stock_data.get_quote(ticker)
    if quote is None:
        price_line = "시세 조회 실패"
    else:
        sign = "+" if quote["change_pct"] >= 0 else ""
        price_line = f"{stock_data.format_price(ticker, quote['price'])} ({sign}{quote['change_pct']:.2f}%)"

    news_items = [a for a in fetch_google_news(name) if title_matches_query(a["title"], name)]
    news_items.sort(key=lambda a: a["pub_date"], reverse=True)

    if news_items:
        headline = news_items[0]
        text = f"{name} ({ticker})\n{price_line}\n{headline['title']}"
        link = headline["link"]
    else:
        text = f"{name} ({ticker})\n{price_line}"
        link = f"https://finance.yahoo.com/quote/{ticker}"

    return text, link


def main() -> None:
    env = load_env()

    try:
        token_data = kakao_sender.refresh_access_token(env["KAKAO_REST_API_KEY"], env["KAKAO_REFRESH_TOKEN"])
    except kakao_sender.KakaoTokenError as e:
        print(f"::error::{e}")
        sys.exit(1)

    access_token = token_data["access_token"]
    new_refresh_token = token_data.get("refresh_token")
    if new_refresh_token and new_refresh_token != env["KAKAO_REFRESH_TOKEN"]:
        print(
            "::warning::카카오가 새 refresh_token을 발급했습니다. "
            "GitHub 저장소 Secrets의 KAKAO_REFRESH_TOKEN 값을 아래 값으로 갱신해주세요:"
        )
        print(f"::warning::{new_refresh_token}")

    kakao_sender.send_text(
        access_token,
        f"📊 포트폴리오 브리핑\n{today_str()}",
        "https://finance.yahoo.com/",
        button_title="시세 보기",
    )

    for name, ticker in STOCKS:
        text, link = build_stock_message(name, ticker)
        try:
            kakao_sender.send_text(access_token, text, link, button_title="자세히 보기")
        except kakao_sender.KakaoSendError as e:
            print(f"::warning::전송 실패 ({ticker}): {e}")

    print("포트폴리오 브리핑 전송 완료.")


if __name__ == "__main__":
    main()
