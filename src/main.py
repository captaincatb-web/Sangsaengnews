import os
import sys
from urllib.parse import quote

from src import kakao_sender, news_collector
from src.config import MAX_ARTICLES_PER_RUN
from src.history import KST, load_history, prune, save_history, today_str

HEADER_LINK = "https://search.naver.com/search.naver?where=news&query=" + quote("반도체 중소기업")

REQUIRED_ENV_VARS = [
    "NAVER_CLIENT_ID",
    "NAVER_CLIENT_SECRET",
    "KAKAO_REST_API_KEY",
    "KAKAO_REFRESH_TOKEN",
]


def load_env() -> dict:
    env = {name: os.environ.get(name, "") for name in REQUIRED_ENV_VARS}
    missing = [name for name, value in env.items() if not value]
    if missing:
        print(f"필수 환경 변수가 없습니다: {', '.join(missing)}")
        sys.exit(1)
    return env


def format_article_text(article: dict) -> str:
    press = article["description"] if article["source"] == "google" else "네이버뉴스"
    press = press or "구글뉴스"
    pub_date_kst = article["pub_date"].astimezone(KST).strftime("%Y-%m-%d %H:%M")
    return f"{article['title']}\n{press} · {pub_date_kst}"


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

    articles = news_collector.collect_all(env["NAVER_CLIENT_ID"], env["NAVER_CLIENT_SECRET"])

    history = load_history()
    new_articles = [a for a in articles if a["link"] not in history][:MAX_ARTICLES_PER_RUN]

    today = today_str()

    if not new_articles:
        kakao_sender.send_text(
            access_token,
            f"📡 오늘의 반도체 중견·중소기업 뉴스\n{today} · 새 기사가 없어요",
            HEADER_LINK,
            button_title="뉴스 더보기",
        )
        print("새 기사 없음. 알림만 전송했습니다.")
        return

    kakao_sender.send_text(
        access_token,
        f"📡 오늘의 반도체 중견·중소기업 뉴스\n{today} · 새 기사 {len(new_articles)}건",
        HEADER_LINK,
        button_title="뉴스 더보기",
    )

    sent_count = 0
    for article in new_articles:
        try:
            kakao_sender.send_text(access_token, format_article_text(article), article["link"])
        except kakao_sender.KakaoSendError as e:
            print(f"::warning::전송 실패 ({article['link']}): {e}")
            continue
        history[article["link"]] = today
        sent_count += 1

    save_history(prune(history))
    print(f"총 {sent_count}건 전송 완료.")


if __name__ == "__main__":
    main()
