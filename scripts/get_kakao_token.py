"""
카카오 '나에게 보내기' 기능에 필요한 refresh_token을 최초 1회 발급받기 위한 로컬 실행용 스크립트.
GitHub Actions에서는 사용하지 않습니다. 사람이 직접 터미널에서 실행하세요.

사전 준비 (https://developers.kakao.com):
  1. 애플리케이션 추가 후 [내 애플리케이션 > 앱 설정 > 요약 정보]에서 REST API 키 확인
  2. [제품 설정 > 카카오 로그인] 활성화, Redirect URI에 아래에서 입력할 주소를 등록
     (실제로 그 주소가 열릴 필요는 없음. 예: https://localhost.com)
  3. [카카오 로그인 > 동의항목]에서 "카카오톡 메시지 전송(talk_message)" 항목을 사용 설정
     - 비즈 앱 전환/사업자 인증 없이도, [카카오 로그인 > 보안 > 테스트 사용자 관리] 등에서
       본인 계정을 테스트 사용자로 추가해두면 개인용으로 바로 사용할 수 있습니다.

실행:
    python scripts/get_kakao_token.py
"""

import json
from urllib.parse import parse_qs, urlparse

import requests

AUTHORIZE_URL = "https://kauth.kakao.com/oauth/authorize"
TOKEN_URL = "https://kauth.kakao.com/oauth/token"


def extract_code(pasted: str) -> str:
    pasted = pasted.strip()
    if "code=" not in pasted:
        return pasted
    query = urlparse(pasted).query
    return parse_qs(query)["code"][0]


def main() -> None:
    rest_api_key = input("카카오 REST API 키: ").strip()
    redirect_uri = input("카카오 개발자 콘솔에 등록한 Redirect URI: ").strip()
    client_secret = input("Client Secret 사용 설정을 켰다면 입력 (안 켰으면 엔터): ").strip()

    auth_url = (
        f"{AUTHORIZE_URL}?client_id={rest_api_key}"
        f"&redirect_uri={redirect_uri}&response_type=code&scope=talk_message"
    )
    print("\n아래 주소를 브라우저에서 열고 로그인/동의 후, 리다이렉트된 주소 전체(또는 code 값)를 복사하세요:")
    print(auth_url)

    pasted = input("\n리다이렉트된 주소(또는 code): ").strip()
    code = extract_code(pasted)

    data = {
        "grant_type": "authorization_code",
        "client_id": rest_api_key,
        "redirect_uri": redirect_uri,
        "code": code,
    }
    if client_secret:
        data["client_secret"] = client_secret

    resp = requests.post(TOKEN_URL, data=data, timeout=10)
    if resp.status_code != 200:
        print(f"\n토큰 발급 실패 ({resp.status_code}): {resp.text}")
        return

    tokens = resp.json()
    print("\n발급 성공! 아래 refresh_token을 GitHub 저장소 Settings > Secrets에")
    print("KAKAO_REFRESH_TOKEN 이름으로 등록하세요.\n")
    print(json.dumps(tokens, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
