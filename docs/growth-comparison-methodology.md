# 국내·해외 소부장 성장 비교 — 산출 방법과 운영 안내

유지보수 담당자용 문서입니다. 기업명·등록번호·개별 재무는 이 문서에 적지 않습니다(비공개 자료는 파일 이름만 적습니다).

## 1. 목적
소재·부품·장비별로 국내와 해외 기업군의 매출 성장(2023=100 지수)과 영업이익률을 나란히 보여 줍니다. 공개 화면은 `site/growth-comparison.html`, 공개 데이터는 `site/data/growth-comparison-summary.json`(집계만) 한 파일입니다.

## 2. 집단 정의
| 집단(JSON 키) | 정의 |
|---|---|
| 국내(`dom`) | 소부장 경영 정보(대시보드)와 같은 기업군 126곳. 수요기업·IT·서비스 업종은 제외하고 업종(소재·부품·장비)은 그 화면의 분류를 그대로 씁니다. 상세구분1~5는 사용자 원본 목록과 연결된 경우에만 붙고, 원본에 없는 법인은 승인된 보충 분류(비공개 파일)로 채웁니다. |
| 해외 — 주요 공시기업(`ov`) | 사용자 목록 중 법인 본인의 공식 공시로 실적이 확인된 상장사. 비반도체 기업은 제외합니다(제외 판정은 비공개 `eligibility_overrides.csv`). 자회사·지점 실적은 모회사 실적으로 대체하지 않습니다. |
| 국내 소재 외국계(`fo`) | 한국에 설립된 외국계 법인(원본 목록에서 '해외'로 표기, 한국 법인등록번호 보유). 해외 집계와 합산하지 않고 따로 집계합니다. 이미 국내 기업군에 있는 법인은 중복이라 뺍니다. 같은 법인등록번호의 지점·공장 행은 한 법인으로 묶습니다. |

대표 업종: 해외 법인은 기업 전체 매출을 대표 업종 한 곳에만 반영합니다(원본 품목 분류로 중복 배분하지 않음). 국내는 대시보드 업종 + 원본 상세구분을 씁니다.

## 3. 데이터 출처
- **국내**: DART 개별(별도, OFS) 재무제표. 대시보드와 같은 수집기(`scripts/build_financials.py`)를 비공개 Actions에서 돌려 얻습니다.
- **국내 소재 외국계**: DART 사업보고서 개별 재무 → 없으면 감사보고서 원문(`scripts/growth/collect_audit.py`). 감사보고서 값은 억 원 단위로 반올림되어 있습니다.
- **해외(미국)**: SEC 10-K XBRL(`scripts/growth/collect_sec.py`). 이름이 정확히 일치하거나 확인된 티커로만 연결합니다. 20-F 제출사는 이 수집기가 못 가져옵니다.
- **해외(그 외)**: 공식 공시 원문을 조사한 CSV를 반입기 `scripts/growth/ingest_overseas_csv.py`로 검증·환산해 씁니다.
- **환율**: ECB 일별 교차환율(통화→원)의 해당 회계기간 평균. ECB가 발표하지 않는 통화(예: TWD)는 원화 환산을 비우고 집계에서 뺍니다.

## 4. 계산 규칙
- **회계연도**: 회계기간 종료일의 연도. 기간은 350~380일이어야 하고, 매출과 영업이익은 같은 회계기간일 때만 함께 씁니다. 2023·2024·2025년에 끝나는 기간 3개가 모두 있어야 합니다.
- **동일 기업군(Balanced Panel)**: 2023~2025년 매출·영업이익이 모두 확인된 적격 법인만 집계에 넣습니다.
- **영업이익률** = 영업이익 합계 ÷ 매출 합계(기업별 이익률의 평균이 아님).
- **성장률** = 당해 ÷ 전년 − 1. 2023년 성장률은 2022년 매출이 모든 법인에서 확인될 때만 계산합니다.
- **매출지수** = 해당 집단 합계의 2023년 값을 100으로 한 지수.
- **재무 기준**: 개별 재무를 우선하고, 개별이 공시되지 않으면 연결을 쓰되 화면에 표시합니다(미국 SEC 등록 법인과 20-F 제출사는 연결). 한 법인의 3개년은 같은 기준으로 통일하며, 연결·개별이 섞인 법인은 반입기가 법인 전체를 거부합니다.
- **값이 없으면** 빈 값입니다. 추정·보간·모회사 대체를 하지 않습니다.

## 5. 공개 안전 규칙
- 집단(국내·해외·외국계)마다 법인 수가 `k_min_per_side`(기본 5) 이상일 때만 그 집단 값을 공개합니다.
- **부분집합 차이 방지**: 공개되는 두 조합 X ⊃ Y(같은 집단, 그래프분류 '전체' ⊃ 개별 분류, 상세구분 경로가 접두 관계)에서 |X − Y| < k이면 Y를 가립니다. 안정될 때까지 반복합니다(`scripts/growth/aggregate.py` `publishable`).
- 공개 JSON에는 집계값·건수·필터 조합만 담습니다. 기업명, 등록번호, 개별 재무, 품목 매핑, 원본 행, 거래관계는 담지 않습니다. `tests/test_growth_public_safety.py`가 이를 검사합니다.

## 6. 비공개와 공개의 경계
| 구분 | 위치 | 내용(파일 단위) |
|---|---|---|
| 비공개 작업 폴더 | 저장소 밖 `GROWTH_PRIVATE_DIR` | `master_rows.csv`(원본 정제), `domestic_match.csv`, `domestic_financials.csv`, `roster_financials.js`, `roster_class.json`, `ovkr_match.csv`, `ovkr_financials.csv`, `ovkr_audit_financials.csv`, `sec_match.csv`, `overseas_financials.csv`, `overseas_financials_ext.csv`, `eligibility_overrides.csv`, `roster_detail_overrides.csv` |
| 비공개 저장소 | Internal 저장소 `data/growth/` 이하 | 위 파일의 원본·결과 사본, 조사 CSV 입력(`ext/`), 외국계 입력·결과(`ovkr/`) |
| 비공개 워크플로 | Internal 저장소 `.github/workflows/` | `growth-domestic`, `growth-overseas`, `growth-overseas-kr`, `growth-overseas-audit`, `growth-roster`, `growth-ingest`(모두 수동 실행, 로그에는 건수만 출력) |
| 공개 | 이 저장소 | `scripts/growth/*`(코드), `site/growth-comparison.*`(화면), `site/data/growth-comparison-summary.json`(집계), 테스트, 이 문서 |

비공개 폴더 경로가 저장소 안이면 `validate_master.py`·`collect_domestic.py`는 실행을 거부합니다(비공개 저장소 실행 때만 `GROWTH_PRIVATE_REPO=1`).

## 7. 갱신 절차
1. (필요 시) Internal에서 수집 워크플로를 실행합니다: `growth-domestic` → `growth-roster` → `growth-overseas`(SEC) → `growth-overseas-kr` → `growth-overseas-audit`. 키는 저장소 secret(`DART_API_KEY`, `SEC_USER_AGENT`)으로만 둡니다.
2. 해외 조사 CSV가 새로 오면 필수 열을 확인합니다: 목록표기, 공식법인명, 상장여부, 거래소, 티커, 결산월, 회계연도, 기간시작, 기간종료, 통화, **금액단위**(1·천·백만·억 등), 매출, 영업이익, 연결/개별, 출처URL, 쪽/표위치, 확신도, 비고. 출처 URL·금액단위가 없거나 회계기간이 1년이 아닌 행은 반입기가 거부합니다. `growth-ingest`로 환산합니다.
3. 결과 파일을 비공개 작업 폴더로 받은 뒤 `GROWTH_PRIVATE_DIR=<경로> python scripts/growth/build_growth_comparison.py`를 실행해 요약 JSON을 만듭니다.
4. `python3 -m unittest discover -s tests`로 검증합니다(집계 규칙, 반입기, 공개 안전 검사).
5. 요약 JSON과 코드만 커밋해 PR로 올립니다. 병합·배포는 검토 후에 합니다.

## 8. 알려진 한계
- 국내 별도 재무와 해외 연결 재무가 섞여 있어 매출 규모·수익성을 같은 기준의 직접 비교로 해석할 수 없습니다.
- 해외는 공시 접근성과 재무 확보 가능성으로 선택된 일부 표본이라 해외 산업 전체를 대표하지 않습니다. 해외 분류별 값은 5곳 미만이면 공개하지 않습니다.
- 외국계는 감사보고서에서 읽은 억 원 단위 반올림 값이라 작은 법인은 정밀도가 낮습니다.
- ECB 미제공 통화(TWD 등)는 원화 환산을 비워 집계에서 빠집니다.
- 기업 전체 매출 기준이며 반도체 사업 매출이 아닙니다.
- KRX·네이버·Yahoo 시세의 공개 재배포 약관은 아직 확정되지 않았습니다(법적 확인 필요). 이 비교 화면은 시세를 쓰지 않지만 사이트의 다른 화면에는 영향이 있습니다.
