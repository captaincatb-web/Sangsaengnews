import json

import requests

TOKEN_URL = "https://kauth.kakao.com/oauth/token"
SEND_URL = "https://kapi.kakao.com/v2/api/talk/memo/default/send"
REQUEST_TIMEOUT = 10
TEXT_MAX_LENGTH = 180  # 카카오 기본 텍스트 템플릿 제한(200자)보다 여유를 둠


class KakaoTokenError(RuntimeError):
    pass


class KakaoSendError(RuntimeError):
    pass


def refresh_access_token(rest_api_key: str, refresh_token: str) -> dict:
    data = {
        "grant_type": "refresh_token",
        "client_id": rest_api_key,
        "refresh_token": refresh_token,
    }
    resp = requests.post(TOKEN_URL, data=data, timeout=REQUEST_TIMEOUT)
    if resp.status_code != 200:
        raise KakaoTokenError(f"토큰 갱신 실패 ({resp.status_code}): {resp.text}")
    return resp.json()


def send_text(access_token: str, text: str, web_url: str, button_title: str = "기사 보기") -> None:
    if len(text) > TEXT_MAX_LENGTH:
        text = text[: TEXT_MAX_LENGTH - 1] + "…"

    template_object = {
        "object_type": "text",
        "text": text,
        "link": {"web_url": web_url, "mobile_web_url": web_url},
        "button_title": button_title,
    }

    resp = requests.post(
        SEND_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        data={"template_object": json.dumps(template_object, ensure_ascii=False)},
        timeout=REQUEST_TIMEOUT,
    )
    if resp.status_code != 200:
        raise KakaoSendError(f"메시지 전송 실패 ({resp.status_code}): {resp.text}")
