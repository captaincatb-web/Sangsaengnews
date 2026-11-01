# Claude Code 프로젝트 지침

## 현재 작업 트랙: 국내 상장 반도체 소부장 전수 조사
작업 시작 전 반드시 `docs/semiconductor-sme/CLAUDE_CODE_HANDOFF.md`를 읽고, 데이터 정의는 `docs/semiconductor-sme/DATA_DICTIONARY.md`를 참고한다.

- 기존 `scripts/count_listed_semi.py`, `scripts/build_market.py`, `.github/workflows/semi-count.yml`, `site/data/universe.js`, `site/data/segments.js`를 먼저 조사하고 재사용한다. 중복 구현 금지.
- 현재 기본 브랜치에 직접 커밋하지 않는다. `feature/krx-stock-universe-v1`에서 작업하고 PR로 제출한다.
- 회사 수와 종목 수를 구분한다. 종목코드는 6자리 문자열로 유지한다.
- null/빈 값은 0으로 치환하지 않는다.
- 직접 소부장·조건부·간접 공급망·기타 반도체 산업을 분리한다. 불확실한 법인/분류는 자동 확정하지 않는다.
- 시가총액은 상장기업 전체 가치다. 다각화 기업의 반도체 사업부 가치로 표현하지 않는다.
- 공개 저장소에 개인정보, 담당자/대표자 정보, 내부 협력사 평가자료, API 키/토큰을 추가하지 않는다.
- 수집 기준일·출처·수집시각을 데이터와 화면에 표시한다. 분자·분모 기준일이 다르면 시장 비중을 확정하지 않는다.
- 정적 HTML/JS 구조를 유지하고, API 수집은 Python/GitHub Actions에서 수행한다. API 키는 GitHub Secrets에만 둔다.
