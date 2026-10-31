"""stock.naver.com 공개 JSON(읽기 전용)의 응답 구조를 소량만 확인한다.
참고: https://github.com/dd3ok/naverstock-api-skill (MIT, 비공식 API 정리). 403·429·로그인 전환이 나오면 즉시 멈춘다."""
import json, sys
import requests

BASE = "https://stock.naver.com"
H = {"User-Agent": "Mozilla/5.0 (compatible; Sangsaengnews research)", "Accept": "application/json", "Referer": "https://stock.naver.com/"}
CASES = [
    ("시장목록 코스피(시총순 2건)", "/api/domestic/market/stock/default", {"tradeType": "KRX", "marketType": "KOSPI", "orderType": "marketSum", "startIdx": 0, "pageSize": 2}),
    ("시장목록 코스닥(시총순 2건)", "/api/domestic/market/stock/default", {"tradeType": "KRX", "marketType": "KOSDAQ", "orderType": "marketSum", "startIdx": 0, "pageSize": 2}),
    ("업종 전체 시가총액", "/api/stockSecurity/rankings/v2/domestic/industries/total-market-cap", {}),
    ("업종 랭킹(시총순 3건)", "/api/stockSecurity/rankings/v2/domestic/industries", {"sortType": "marketCap", "size": 3, "excludeCodes": 25, "period": "daily"}),
    ("종목 상세(삼성전자)", "/api/domestic/detail/005930/detail", {"codeType": "KRX"}),
    ("가격 스냅샷(삼성전자)", "/api/stockSecurity/items/v2/domestic/005930/price-snapshot", {}),
    ("컨센서스(삼성전자)", "/api/domestic/detail/005930/consensus", {}),
]
for name, path, params in CASES:
    try:
        r = requests.get(BASE + path, params=params, headers=H, timeout=20, allow_redirects=False)
    except Exception as e:
        print(f"## {name}: 접속 실패 {e}"); continue
    print(f"## {name} · HTTP {r.status_code} · {r.headers.get('content-type', '')}")
    if r.status_code in (403, 429) or 300 <= r.status_code < 400:
        print("중단: 차단·리다이렉트"); sys.exit(0)
    print(r.text[:1800].replace("\n", " "))
