# 데이터 사전

## direct_sme_candidates_20261101.csv
- 110개 직접 소부장 후보 레코드.
- company_ko: 기업명
- category: 장비/부품/소재
- entity_status: 국내 법인 성격
- market: KRX 시장
- ticker: 6자리 종목코드 문자열
- classification_status: 원본 마스터의 판정 결과
- market_cap_krw: 네이버증권 시가총액(원). 미상장/미매칭은 빈 값.
- 후보 목록이며 최종 확정 모집단이 아니다.

## krx_market_baseline_20261030.json
사용자가 제공한 KRX 직전영업일 기준값. 시가총액 단위는 십억원. KOSDAQ GLOBAL은 KOSDAQ 내부 세부구분으로 중복 합산하지 않는다.
