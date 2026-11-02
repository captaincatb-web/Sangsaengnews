# 해외 비교 세계 국가별 지도 (Natural Earth 1:110m)

- 위치: `site/compare.html#overview` → 세계 국가별 기업 분포 카드
- 지도 도형: `site/data/geo/world-110m.svg`, 177개 국가·지역 도형, equirectangular(등간격 경위선) 간소 투영
- 원본: [Natural Earth 1:110m Admin-0 Countries](https://www.naturalearthdata.com/downloads/110m-cultural-vectors/) (GeoJSON 변환 참조: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson)
- 라이선스: [Natural Earth Terms of Use](https://www.naturalearthdata.com/about/terms-of-use/) — Public Domain; 출처 표기
- 지도는 본사 **국가** 집계이며 특정 기업의 공장 위치, 사업장 주소, 지점 핀이 아닙니다.
- 실제 해외 분석 표본은 `site/data/peers.js`의 `window.PEERS.list`에서 KR을 제외한 기업. 업종 필터의 소부장 기본 범위를 동일하게 적용
- 나라별 색상·집계: 기존 `compare.js`가 계산한 최근 회계연도 매출 `s1`과 이전 `s0`를 재사용. 매출 단위는 억 원이며 회사별 회계연도 및 환율 기준이 서로 다를 수 있습니다.
- 국가 ISO 2자리 코드 사용. Natural Earth의 `ISO_A2_EH` 값 우선 적용, 도형이 없는 소국은 오른쪽 국가 목록에서 선택 가능
- 지도 기본 자료가 없는 국가를 회색 표시하더라도 해당 국가에 반도체 업체가 없다는 뜻이 아닙니다.
- Natural Earth는 축약된 경계와 de facto 중심 표현을 사용합니다. 법적 국가 경계를 확정하거나 정치적 주장으로 간주하지 마십시오.
- 과거 결산 재무제표 비교가능 회사 집합만 증감 계산, 결측은 0과 분리.

## 검증

- `node --test tests/world-map.test.cjs`
- `node --check site/compare-world-map-utils.js && node --check site/compare-world-map.js && node --check site/compare.js`
- PR Actions workflow: `.github/workflows/world-map-tests.yml`
- 브라우저에서는 국가 클릭→상단 국가 필터 반영, 업종 필터→지도 업데이트, 모바일 목록 접근성을 확인할 것

기존 국내 시도 지도와 별개 기능입니다. 운영 브랜치 자동 병합 및 자동 배포는 하지 않습니다.
