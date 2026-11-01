// 국내 반도체 소부장 분석 화면의 데이터. 승인된 데이터만 이 파일에 넣는다(내부 후보·검증 자료는 내부 저장소에서 관리).
// status: "pending"(확정 전, 기업 목록 없음) | "preview"(검토용) | "approved"(사용자 승인)
window.SEMI_SME = {
  status: "pending",
  // 분모: KRX 상장종목 현황(사용자 제공값, 독립 검증 전). 시가총액 단위: 십억원
  market: {
    asOf: "2026-10-30",
    source: "KRX 상장종목 현황 (사용자 제공값)",
    unit: "십억원",
    KOSPI: { companies: 829, securities: 939, capBillion: 4730184 },
    KOSDAQ: { companies: 1826, securities: 1828, capBillion: 410401 },
    KONEX: { companies: 107, securities: 107, capBillion: 3530 }
  },
  // 분자 시가총액의 기준일·증권유형·출처(기업 시총과 함께 채운다). 분모 기준일과 다르면 시총 비중을 계산하지 않는다.
  cap: { asOf: null, basis: null, source: null },
  collectedAt: null,
  // members: [{ code:"005930", name:"", kind:"장비|부품|소재", market:"KOSPI|KOSDAQ|KONEX", capEok:12345 | null, securities:1, status:"확정|검토 중|보류" }]
  members: []
};
