# 소부장 파트너사 주간 뉴스레터

73개 반도체 소부장 파트너사(1~4그룹)의 뉴스·공시·주가를 모아 매주 HTML 메일 한 통으로 보낸다.
(Google Apps Script 버전을 이식·개선한 것)

## 동작 순서

1. **수집** (`src/newsletter_collector.py`, `src/news_sources.py`)
   - DART 회사별 공시 RSS
   - 전자신문·디일렉·KIPOST·EPNC·매일경제 산업·EBN 등 RSS
   - 구글뉴스 회사별 검색 (국문), 해외 9개사는 영문 검색도 함께 (국문 기사가 없을 때 보완용)
   - 네이버 뉴스 제목검색 (회사별, 키 불필요): 구글뉴스에 없는 국내 매체까지. 막히지 않도록 1초 간격으로 한 건씩 요청하고, 403을 받으면 그 주에는 더 요청하지 않는다
   - 네이버 뉴스 API (키가 있을 때)
   - 최근 30일 기사만, 같은 기사는 DART > 네이버 API > RSS > 구글 > 네이버 검색 순으로 하나만 남김
   - 오탐 필터: 주가·증시·애널리스트 기사, 사진 캡션, 채용, 스팸, 재게시된 옛 기사, 회사별 동명이인 등
2. **묶기·분류** – 같은 사건을 다룬 기사·공시를 한 묶음으로(글자 유사도 + 핵심 단어 2개 이상 겹침),
   분류(수주·협력 / 실적 / 투자·증설 / 기술·제품 / 사업재편 / 자금조달 / 지분변동 …)
3. **선정** (`src/newsletter_rank.py`) – 회사당 최근 7일 기사 중 중요도 순 2건,
   지분·소유 공시는 건수만 표시, 이번 주 소식이 없으면 8~30일 전 기사 1건을 '지난 소식'으로
4. **메일 HTML** (`src/newsletter_html.py`) – 주요 소식 6건, 1주 등락 상·하위, 그룹별 표(모바일 대응)
5. 주가는 yfinance(1일·1주 등락), 재무는 OpenDART(키가 있을 때)

## 실행

| 방법 | 설명 |
|---|---|
| `python -m src.newsletter --dry-run` | `output/newsletter.html`, `output/subject.txt` 생성만 |
| `python -m src.newsletter` | SMTP로 발송 (`SMTP_USER`, `SMTP_PASSWORD` 필요) |
| `newsletter_request.txt` 수정 후 push | Actions가 HTML을 만들어 `newsletter-out/`에 커밋 (Claude 세션이 Gmail로 발송할 때 사용) |

## 자동 발송

- 현재: Claude 루틴이 매주 목요일 05:50(KST)에 위 Actions 빌드 → Gmail 발송 (devla@naver.com)
- 대안: `.github/workflows/daily-newsletter.yml`(매주 목 06:00, SMTP 직접 발송).
  main 브랜치에 병합하고 SMTP 시크릿을 등록하면 동작하며, 이때는 Claude 루틴을 꺼서 중복 발송을 막는다.

## GitHub Secrets

| 이름 | 용도 | 상태 |
|---|---|---|
| `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | 네이버 뉴스 검색 (국내 기사 수집량 크게 증가) | 미등록 |
| `OPENDART_KEY` | 분기 재무 칸 | 미등록 |
| `GEMINI_KEY` | 재무 변동 AI 코멘트 (선택) | 미등록 |
| `SMTP_USER`, `SMTP_PASSWORD`, `RECIPIENT_EMAIL` | Actions 직접 발송 | 미등록 |

## 수집 점검

빌드마다 `newsletter-out/collect_report.txt`가 함께 커밋된다.
- 소스별 원본/채택 건수, 제외 사유별 건수
- 회사별 최근 7일 기사 수와 처음 찾은 소스
- 회사명이 들어갔지만 걸러진 최근 기사 목록 (필터가 과한지 확인용)

## 오탐이 보이면

`src/newsletter_collector.py`의 `FALSE_POSITIVE_PATTERNS`(회사별), `STOCK_NOISE_RE`(주가),
`GENERAL_NOISE_RE`(스팸·채용), `BLOCKED_SOURCE_RE`(매체)에 단어를 추가한다.
회사·별칭·티커·DART 코드는 `src/newsletter_config.py`.
