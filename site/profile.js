// 협력사 프로필. 수작업 프로필 문서(company-profile-generator 양식)의 순서와 표 구성을 따르되,
// 공시로 확인할 수 없는 항목은 화면에서 빼고 맨 아래에 한 줄로 알린다.
// 제목·문단·표만으로 그려서 선택해 복사해도, "Word로 복사" 버튼을 써도 Word 에 그대로 붙는다.
(() => {
  const root = document.getElementById("profile");
  const code = decodeURIComponent(location.hash.slice(1));
  window.addEventListener("hashchange", () => location.reload());

  const company = (window.COMPANY_GROUPS || []).flatMap((g) =>
    g.companies.map(([name, corpCode, stockCode, note]) => ({ name, corpCode, stockCode, note: note || "", group: g.label }))
  ).find((c) => c.corpCode === code);

  if (!company) {
    root.innerHTML = `<div class="empty"><p class="empty-title">기업을 찾을 수 없습니다</p>
      <p>주소가 바뀌었을 수 있습니다. 기업 목록에서 다시 선택해 주세요.</p>
      <a class="btn" href="./#companies">기업 목록으로</a></div>`;
    return;
  }

  const p = (window.COMPANY_PROFILES || {})[code] || {};
  const updated = window.COMPANY_PROFILES_UPDATED || "";
  document.title = `${company.name} 프로필 | 상생기업 프로필`;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const yy = (y) => `'${String(y).slice(2)}년`;
  const num = (v, d = 0) => (v == null ? "-" : Number(v).toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const rate = (v) => (v == null ? "-" : `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v).toFixed(1)}%`);
  const eokText = (v) => {
    if (v == null) return "-";
    if (v < 10000) return `${num(v)}억`;
    const jo = Math.floor(v / 10000), rest = v % 10000;
    return `${jo}조${rest ? ` ${num(rest)}` : ""}억`;
  };
  const fmtDate = (d) => (/^\d{8}$/.test(d || "") ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : "");
  const MARKETS = { Y: "유가증권시장", K: "코스닥", N: "코넥스" };
  const listed = p.corp_cls ? Object.keys(MARKETS).includes(p.corp_cls) : !!company.stockCode;
  const accNote = p.acc_mt && p.acc_mt !== "12" ? ` * 결산기준일 ${Number(p.acc_mt)}월 말` : "";

  // 공시로 확인할 수 없어 표시하지 않는 항목. 회사마다 비어 있는 항목이 뒤에 더해진다.
  const missing = new Set(["기업규모", "연혁", "주요 제품", "제조거점", "거래금액·비중", "신용등급", "업종평균"]);

  // □ 항목 한 줄. 값이 없으면 그리지 않고 '표시하지 않은 항목'에 올린다.
  const line = (label, value, notes = []) => {
    if (value == null || value === "") {
      missing.add(label);
      return "";
    }
    return `<div class="pf-item"><p class="pf-line"><span class="sq">□</span> <strong>${label}</strong> : ${value}</p>`
      + notes.filter(Boolean).map((n) => `<p class="pf-note">${n}</p>`).join("") + "</div>";
  };
  // □ 항목 + 표·글머리 목록. 본문이 없으면 그리지 않는다.
  const block = (label, tag, body) => (body
    ? `<div class="pf-item"><p class="pf-line"><span class="sq">□</span> <strong>${label}</strong>${tag ? ` <span class="pf-tag">* ${tag}</span>` : ""}</p>${body}</div>`
    : "");
  const bullets = (lines) => (lines && lines.length ? `<ul class="pf-bullets">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : "");

  // 표. groupCol 이면 첫 열의 같은 구분(재무·손익, 안정성 등)을 세로로 합친다. textCols 는 왼쪽 정렬할 열.
  function table(head, rows, { caption = "", cls = "", groupCol = false, textCols = [] } = {}) {
    const headCols = groupCol ? 2 : 1;
    const thead = `<thead><tr>${head.map((h, i) => `<th scope="col"${i < headCols || textCols.includes(i) ? ' class="text"' : ""}>${h}</th>`).join("")}</tr></thead>`;
    const tbody = rows.map((r, ri) => `<tr>${r.map((c, i) => {
      if (groupCol && i === 0) {
        if (ri > 0 && rows[ri - 1][0] === c) return "";
        let span = 1;
        while (rows[ri + span] && rows[ri + span][0] === c) span++;
        return `<th scope="rowgroup" rowspan="${span}" class="grp">${c}</th>`;
      }
      if (i < headCols) return `<th scope="row">${c}</th>`;
      return `<td${textCols.includes(i) ? ' class="text"' : ""}>${c}</td>`;
    }).join("")}</tr>`).join("");
    return `<div class="tbl-wrap"><table class="pf-table${cls ? ` ${cls}` : ""}">${caption ? `<caption>${caption}</caption>` : ""}${thead}<tbody>${tbody}</tbody></table></div>`;
  }

  // ---------- 머리말 ----------
  const meta = [
    `<span class="grp">${esc(company.group)}</span>`,
    company.note ? esc(company.note) : "",
    listed ? `${MARKETS[p.corp_cls] || "상장"} ${esc(company.stockCode || p.stock_code || "")}` : "비상장",
    `DART ${esc(code)}`,
    updated ? `${esc(updated)} 갱신` : "",
  ].filter(Boolean).map((m) => `<li>${m}</li>`).join("")
    + (company.stockCode ? `<li data-nocopy><a href="https://finance.naver.com/item/main.naver?code=${esc(company.stockCode)}" target="_blank" rel="noopener">네이버 증권<i class="ph ph-arrow-up-right" aria-hidden="true"></i></a></li>` : "");

  // ---------- 1면: 개요 ----------
  const holders = p.shareholders && p.shareholders.top ? p.shareholders.top : [];
  const ceoIsHolder = p.ceo_nm && holders[0] && p.ceo_nm.includes(holders[0].name);
  const ceo = p.ceo_nm
    ? `${esc(p.ceo_nm)}${p.ceo && p.ceo.birth_year ? `(${yy(p.ceo.birth_year)}생)` : ""}${ceoIsHolder ? " * 최대주주" : ""}`
    : "";
  const career = (p.ceo && p.ceo.career ? p.ceo.career : []).map((c, i) => `${i ? "&nbsp;&nbsp;" : "* "}${esc(c)}`);

  const emp = p.employees || {};
  const empNote = [emp.avg_tenure ? `평균 근속 ${emp.avg_tenure}년` : "", emp.avg_salary_man ? `1인 평균 급여 ${num(emp.avg_salary_man)}만원` : ""]
    .filter(Boolean).join(", ");

  const mk = p.market;
  const mkDate = mk && mk.date ? `'${mk.date.slice(2, 4)}.${Number(mk.date.slice(5, 7))}.${Number(mk.date.slice(8))}` : "";

  const as = p.assets || {};
  const shareholders = holders.length
    ? `${holders.slice(0, 3).map((h) => `${esc(h.name)} ${esc(h.ratio)}%`).join(", ")}${p.shareholders.total ? ` 등 (특수관계인 합계 ${esc(p.shareholders.total)}%)` : ""}`
    : "";

  const perf = p.performance;
  let perfTable = "";
  if (perf) {
    const cols = perf.years.map((_, i) => i).filter((i) => perf["매출액"][i] != null || perf["영업이익"][i] != null);
    if (cols.length) {
      perfTable = table(["구분", ...cols.map((i) => yy(perf.years[i]))], [
        ["매출액", ...cols.map((i) => num(perf["매출액"][i]))],
        ["영업이익", ...cols.map((i) => num(perf["영업이익"][i]))],
        ["영업이익률", ...cols.map((i) => (perf["영업이익률"][i] == null ? "-" : `${perf["영업이익률"][i].toFixed(1)}%`))],
      ], { caption: `(단위: 억원)${accNote}` });
    }
  }
  const SOURCE = { annual: "개별기준", audit: "개별기준, 감사보고서에서 자동 추출" };

  const overview = [
    line("설립", /^\d{8}$/.test(p.est_dt || "") ? `${yy(p.est_dt.slice(0, 4))} 설립` : ""),
    line("대표이사", ceo, career),
    line("인력", emp.count ? `${num(emp.count)}명 (${esc(emp.as_of)} 기준)` : "", [empNote ? `* ${empNote}` : ""]),
    listed ? line("시가총액", mk ? `${eokText(mk.cap)}원 (주가 ${num(mk.price)}원)` : "", [mkDate ? `* ${mkDate} 종가 기준` : ""]) : "",
    line("자산", as.total != null ? `${eokText(as.total)} (부채 ${eokText(as.debt)} / 자본 ${eokText(as.equity)})` : "",
      [as.debt_ratio != null ? `* 부채비율 ${Math.round(as.debt_ratio)}%` : ""]),
    line("주주", shareholders),
    block("경영 현황", SOURCE[p.fin_source], perfTable),
    line("본사", p.adres ? esc(p.adres) : ""),
  ].join("");

  // ---------- 2면: 재무현황 분석 ----------
  const FIN = [["재무", "총자산"], ["재무", "부채총계"], ["재무", "자본총계"], ["손익", "매출액"], ["손익", "영업이익"], ["손익", "당기순이익"]];
  function finTable(data, labels, yoyLabel) {
    const cols = labels.map((_, i) => i).filter((i) => FIN.some(([, k]) => data.rows[k] && data.rows[k][i] != null));
    const items = FIN.filter(([, k]) => data.rows[k] && cols.some((i) => data.rows[k][i] != null));
    if (!cols.length || !items.length) return "";
    return table(["구분", "항목", ...cols.map((i) => labels[i]), yoyLabel],
      items.map(([g, k]) => [g, k, ...cols.map((i) => num(data.rows[k][i])), rate(data.yoy[k])]),
      { groupCol: true, caption: `(단위: 억원)${accNote}` });
  }

  const fin = p.financials;
  const q = p.quarter;
  const r = p.ratios;
  if (!perfTable && !fin && !q) missing.add("재무제표");

  const RATIO = [
    ["안정성", "유동비율", "100% 이상 양호"], ["안정성", "부채비율", "200% 이하 양호"], ["안정성", "차입금의존도", "30% 이하 안정"],
    ["수익성", "영업이익률", ""], ["수익성", "총자본순이익률", ""], ["수익성", "매출액순이익률", ""],
    ["성장성", "총자산증가율", ""], ["성장성", "매출액증가율", ""], ["성장성", "유형자산증가율", ""],
    ["활동성", "매출채권회전율", "4회 이상 양호"], ["활동성", "매입채무회전율", "높을수록 지급능력 양호"],
  ];
  const UNIT = { 안정성: "%", 수익성: "%", 성장성: "%", 활동성: "회" };
  let ratioTable = "";
  if (r) {
    const rows = RATIO.filter(([, k]) => r.values[k] && r.values[k].some((v) => v != null))
      .map(([g, k, hint]) => [`${g}<small>(${UNIT[g]})</small>`, `${k}${hint ? `<small>${hint}</small>` : ""}`, ...r.values[k].map((v) => num(v, 1))]);
    if (rows.length) ratioTable = table(["구분", "지표", ...r.years.map(yy)], rows, { groupCol: true });
  }

  const analysis = [
    fin ? block("재무정보", "", bullets(fin.text) + finTable(fin, fin.years.map(yy), "전년 대비")) : "",
    q ? block(`${yy(q.years[1])} ${esc(q.label)} 실적 동향`, "",
      bullets(q.text) + finTable(q, [`${yy(q.years[0])} ${esc(q.label)}`, `${yy(q.years[1])} ${esc(q.label)}`], "전년 동기 대비")) : "",
    ratioTable ? block("재무비율 분석", "", bullets(r.text) + ratioTable) : "",
  ].join("");

  // ---------- 추가 정보 (DART 공시) ----------
  const dartLink = (no, text) => `<a href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(no)}" target="_blank" rel="noopener">${text}</a>`;
  const webLink = (u) => (u && /^(https?:\/\/)?[\w-]+(\.[\w-]+)+/i.test(u)
    ? `<a href="${esc(/^https?:\/\//i.test(u) ? u : `http://${u}`)}" target="_blank" rel="noopener">${esc(u)}</a>` : "");

  const basics = [
    ["정식 법인명", esc(p.corp_name)], ["영문명", esc(p.corp_name_eng)],
    ["설립일", fmtDate(p.est_dt)], ["결산월", p.acc_mt ? `${Number(p.acc_mt)}월` : ""],
    ["법인등록번호", esc(p.jurir_no)], ["사업자등록번호", esc(p.bizr_no)],
    ["대표 전화", esc(p.phn_no)], ["팩스", esc(p.fax_no)],
    ["업종코드", esc(p.induty_code)], ["홈페이지", webLink(p.hm_url)], ["IR", webLink(p.ir_url)],
  ].filter(([, v]) => v && v !== "-");
  const basicsHtml = basics.length ? `<dl class="pf-kv">${basics.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>` : "";

  const execs = (p.executives || []).filter((e) => e.name);
  const registered = execs.filter((e) => /이사|감사/.test(e.registered || "") && !/미등기/.test(e.registered || ""));
  const shownExecs = (registered.length ? registered : execs).slice(0, 12);
  const execTable = shownExecs.length ? table(["성명", "직위", "등기", "상근", "담당업무"], shownExecs.map((e) => [
    `${esc(e.name)}${e.birth_year ? `<small>${yy(e.birth_year)}생</small>` : ""}`,
    esc(e.position || "-"), esc(e.registered || "-"), esc(e.fulltime || "-"), esc(e.duty || "-"),
  ]), { textCols: [1, 2, 3, 4] }) : "";

  const audits = p.audit || [];
  const hasOpinion = audits.some((a) => a.opinion);
  const auditTable = audits.length ? table(["사업연도", "감사인", ...(hasOpinion ? ["감사의견"] : [])], audits.map((a) => [
    esc(a.period), a.rcept_no ? dartLink(a.rcept_no, esc(a.auditor)) : esc(a.auditor), ...(hasOpinion ? [esc(a.opinion || "-")] : []),
  ]), { textCols: [1, 2] }) : "";

  const divs = (p.dividends || []).filter((d) => d.values.some((v) => v && v !== "-"));
  const divTable = divs.length ? table(["구분", ...(perf ? perf.years.slice(1).map(yy) : ["전전기", "전기", "당기"])],
    divs.map((d) => [esc(d.item), ...d.values.map((v) => esc(v || "-"))])) : "";

  const invs = p.investments || [];
  const invTable = invs.length ? table(["법인명", "출자 목적", "지분율", "장부가액(억원)"], invs.map((v) => [
    esc(v.name), esc(v.purpose || "-"), v.ratio == null ? "-" : `${v.ratio}%`, num(v.book_eok),
  ]), { textCols: [1] }) : "";

  const filings = p.filings || [];
  const filingTable = filings.length ? table(["접수일", "보고서명", "제출인"], filings.map((f) => [
    fmtDate(f.date) || esc(f.date), dartLink(f.rcept_no, esc(f.title)), esc(f.filer),
  ]), { textCols: [1, 2] }) : "";

  const extra = [
    block("기업 기본정보", "", basicsHtml),
    block("임원 현황", registered.length ? "등기임원" : "", execTable),
    block("외부감사", "", auditTable),
    block("배당", "", divTable),
    block("타법인 출자", "장부가액 상위", invTable),
    block("최근 공시", "최근 1년", filingTable),
  ].join("");

  // ---------- 맺음: 표시하지 않은 항목, 참고 ----------
  const missingNote = p.corp_name
    ? `<p class="pf-missing">공시로 확인할 수 없어 표시하지 않은 항목: ${[...missing].join(", ")}</p>`
    : `<p class="pf-missing">아직 DART 데이터를 받지 못했습니다. 매일 오전 7시 30분에 갱신됩니다.</p>`;

  const ref = ratioTable ? `<details class="pf-ref"><summary><i class="ph ph-caret-right" aria-hidden="true"></i>재무비율 정의 보기</summary>
    <h3>[참고] 주요 재무비율 정의</h3>${table(["구분", "지표", "정의"], [
      ["안정성", "유동비율", "단기채무 상환능력 (유동자산 ÷ 유동부채 × 100)"],
      ["안정성", "부채비율", "자기자본 대비 부채 (부채총계 ÷ 자본총계 × 100)"],
      ["안정성", "차입금의존도", "자산 중 이자가 붙는 차입금 비중 (총차입금 ÷ 총자산 × 100)"],
      ["수익성", "영업이익률", "영업이익 ÷ 매출액 × 100"],
      ["수익성", "총자본순이익률", "당기순이익 ÷ 평균 총자산 × 100 (ROA)"],
      ["수익성", "매출액순이익률", "당기순이익 ÷ 매출액 × 100"],
      ["성장성", "총자산증가율", "전기 대비 총자산 증가율"],
      ["성장성", "매출액증가율", "전기 대비 매출액 증가율"],
      ["성장성", "유형자산증가율", "토지·건물·기계 등 유형자산의 증가율"],
      ["활동성", "매출채권회전율", "연간 매출액 ÷ 평균 매출채권"],
      ["활동성", "매입채무회전율", "매입액(매출원가로 대신함) ÷ 평균 매입채무"],
    ], { groupCol: true, cls: "text" })}</details>` : "";

  root.innerHTML = `<header class="pf-head"><h1>${esc(company.name)} 프로필</h1><ul class="meta">${meta}</ul></header>`
    + `<div class="pf-items">${overview}</div>`
    + (analysis ? `<h2 class="pf-part">재무현황 분석</h2><div class="pf-items">${analysis}</div>` : "")
    + (extra ? `<h2 class="pf-part">추가 정보</h2><div class="pf-items">${extra}</div>` : "")
    + missingNote + ref;

  const copyBtn = document.getElementById("copy-profile");
  copyBtn.hidden = false;
  copyBtn.addEventListener("click", () => window.CopyKit.copyNode(root, "프로필을 복사했습니다. Word에 붙여 넣으세요."));
})();
