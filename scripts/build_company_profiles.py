"""OpenDART 기업개황 API로 지정 기업의 대표자·설립일·주소 등을 받아 site/data/profiles.js 를 만든다.

사용법: DART_API_KEY 환경변수를 설정한 뒤 `python scripts/build_company_profiles.py`
"""
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

ROOT_DIR = Path(__file__).resolve().parent.parent
COMPANIES_PATH = ROOT_DIR / "site" / "data" / "companies.js"
PROFILES_PATH = ROOT_DIR / "site" / "data" / "profiles.js"
DART_COMPANY_URL = "https://opendart.fss.or.kr/api/company.json"
FIELDS = ["corp_name", "ceo_nm", "corp_cls", "est_dt", "adres", "hm_url", "phn_no", "induty_code"]


def load_corp_codes() -> list:
    # companies.js 의 ["회사명", "고유번호", ...] 줄에서 8자리 고유번호만 뽑는다
    return re.findall(r'\[\s*"[^"]+",\s*"(\d{8})"', COMPANIES_PATH.read_text(encoding="utf-8"))


def fetch_profile(api_key: str, corp_code: str) -> dict | None:
    try:
        resp = requests.get(DART_COMPANY_URL, params={"crtfc_key": api_key, "corp_code": corp_code}, timeout=10)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"[dart] {corp_code} 조회 실패: {e}")
        return None

    data = resp.json()
    if data.get("status") != "000":
        print(f"[dart] {corp_code} 응답 오류: {data.get('message')}")
        return None
    return {k: data.get(k, "") for k in FIELDS}


def main() -> int:
    api_key = os.environ.get("DART_API_KEY")
    if not api_key:
        print("DART_API_KEY 환경변수가 없습니다.")
        return 1

    profiles = {}
    for corp_code in load_corp_codes():
        profile = fetch_profile(api_key, corp_code)
        if profile:
            profiles[corp_code] = profile
        time.sleep(0.2)  # OpenDART 요청 한도 보호

    updated = datetime.now().strftime("%Y-%m-%d")
    PROFILES_PATH.write_text(
        "// scripts/build_company_profiles.py 가 생성한 파일입니다. 직접 수정하지 마세요.\n"
        f"window.COMPANY_PROFILES = {json.dumps(profiles, ensure_ascii=False, indent=2)};\n"
        f'window.COMPANY_PROFILES_UPDATED = "{updated}";\n',
        encoding="utf-8",
    )
    print(f"{len(profiles)}개 기업 개황을 저장했습니다: {PROFILES_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
