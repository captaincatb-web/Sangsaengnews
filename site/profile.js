// 협력사 프로필 화면. 수작업 프로필 문서(company-profile-generator 양식)와 같은 순서·표 구성으로 그린다.
(() => {
  const root = document.getElementById("profile");
  const code = decodeURIComponent(location.hash.slice(1));
  const company = (window.COMPANY_GROUPS || []).flatMap((g) =>
    g.companies.map(([name, corpCode, stockCode, note]) => ({ name, corpCode, stockCode, note: note || "", group: g.label }))
  ).find((c) => c.corpCode === code);

  if (!company) {
    root.innerHTML = `<div class="empty"><i class="ph ph-buildings" aria-hidden="true"></i>
      <p class="empty-title">기업을 찾을 수 없습니다</p>
      <p>주소가 바뀌었을 수 있습니다. 기업 목록에서 다시 선택해 주세요.</p>
      <a class="btn btn-ghost" href="./#directory">기업 목록으로</a></div>`;
    return;
  }

  const p = (window.COMPANY_PROFILES || {})[code] || {};
  document.title = `${company.name} 프로필 | 상생기업 프로필`;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NEED = `<span class="need">확인필요</span>`;
  const yy = (y) => `'${String(y).slice(2)}년`;
  const num = (v, d = 0) => (v == null ? "-" : Number(v).toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const rate = (v) => (v == null ? "-" : `${v > 0 ? "+ " : v < 0 ? "- " : ""}${Math.abs(v).toFixed(1)}%`);
  const eokText = (v) => {
    if (v == null) return "-";
    const jo = Math.floor(v / 10000), rest = v % 10000;
    return jo ? `${jo}조${rest ? ` ${num(rest)}` : ""}억` : `${num(v)}억`;
  };
  const listed = p.corp_cls ? ["Y", "K", "N"].includes(p.corp_cls) : !!company.stockCode;
  const item = (label, body, notes = []) => `
    <div class="pf-item"><p class="pf-line"><span class="sq" aria-hidden="true">□</span><span><strong>${label}</strong>${body ? ` : ${body}` : ""}</span></p>
    ${notes.filter(Boolean).map((n) => `<p class="pf-sub">${n}</p>`).join("")}</div>`;
  const bullets = (lines) => lines.map((l) => `<p class="pf-sub">- ${esc(l)}</p>`).join("");
  const table = (head, rows, opts = {}) => `
    <div class="tbl-wrap"><table class="pf-table${opts.cls ? ` ${opts.cls}` : ""}">
      ${opts.caption ? `<caption>${opts.caption}</caption>` : ""}
      <thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r, ri) => `<tr>${r.map((c, i) => {
        if (opts.groupCol && i === 0) {
          // 같은 구분(재무·손익, 안정성 등)이 이어지면 첫 행에만 세로로 합쳐 표시
          if (ri > 0 && rows[ri - 1][0] === c) return "";
          let span = 1;
          while (rows[ri + span] && rows[ri + span][0] === c) span++;
          return `<th scope="rowgroup" rowspan="${span}" class="grp">${c}</th>`;
        }
        return i === 0 || (opts.groupCol && i === 1) ? `<th scope="row">${c}</th>` : `<td>${c}</td>`;
      }).join("")}</tr>`).join("")}</tbody>
    </table></div>`;

  // ---------- 1면: 개요 ----------
  const shareholders = (() => {
    const s = p.shareholders;
    if (!s || !s.top || !s.top.length) return NEED;
    const top = s.top[0];
    return s.total && parseFloat(s.total) > parseFloat(top.ratio || 0)
      ? `${esc(top.name)} 外 특수관계인 ${esc(s.total)}%`
      : s.top.map((h) => `${esc(h.name)} ${esc(h.ratio)}%`).join(", ");
  })();
  const owner = p.ceo_nm && p.shareholders?.top?.[0] && p.ceo_nm.includes(p.shareholders.top[0].name) ? "○" : NEED;

  const est = /^\d{8}$/.test(p.est_dt || "") ? `- ${yy(p.est_dt.slice(0, 4))} 설립` : "";
  const ceo = p.ceo_nm
    ? `${esc(p.ceo_nm)}${p.ceo?.birth_year ? `(${yy(p.ceo.birth_year).replace("년", "년생")})` : ""}`
    : NEED;
  const perf = p.performance;
  const fin = p.financials;
  const q = p.quarter;
  const r = p.ratios;
  const accNote = p.acc_mt && p.acc_mt !== "12" ? `* 결산기준일: ${Number(p.acc_mt)}월 말일자` : "";
  const SOURCE = {
    annual: "* 개별기준 (사업보고서)",
    audit: "* 개별기준 (감사보고서 원문에서 자동 추출, 원문과 대조 권장)",
    quarter: "* 연간 재무 공시 없음, 최근 분기 실적만 제공",
  };
  const sourceNote = SOURCE[p.fin_source] || "* 개별기준";

  const page1 = `
    <header class="pf-head">
      <p class="pf-group">${esc(company.group)}${company.note ? ` · ${esc(company.note)}` : ""}</p>
      <h1>${esc(company.name)} 프로필</h1>
    </header>

    ${table(["XXX", "상장사", "기업규모", "XXX", "오너경영", "XXX"].map(esc), [], { cls: "pf-grid" }).replace("<tbody></tbody>",
      `<tbody><tr><td>-</td><td>${listed ? "○" : "×"}</td><td>${NEED}</td><td>-</td><td>${owner}</td><td>-</td></tr></tbody>`)}

    ${item("설립 및 이력", "", [est || NEED, est ? `<span class="muted">* 상세 연혁은 사업보고서 확인필요</span>` : ""])}
    ${item("대표이사", ceo, (p.ceo?.career || []).map((c, i) => `${i ? "" : "* "}${esc(c)}`))}
    ${item("인력", p.employees?.count ? `${num(p.employees.count)}명(${esc(p.employees.as_of)} 기준)` : NEED, [
      p.employees?.avg_tenure ? `* 평균 근속 ${p.employees.avg_tenure}년` : "",
      p.employees?.avg_salary_man ? `* 1인 평균 급여 ${num(p.employees.avg_salary_man)}만원` : "",
    ])}
    ${listed ? item("시총", p.market ? `${eokText(p.market.cap)}원 (주가 ${num(p.market.price)}원)` : NEED,
      [p.market ? `* ${yy(p.market.date.slice(0, 4))}${Number(p.market.date.slice(5, 7))}.${Number(p.market.date.slice(8))}일 종가 기준` : ""]) : ""}
    ${item("자산", p.assets?.total != null ? `${eokText(p.assets.total)}(부채 ${eokText(p.assets.debt)} / 자본 ${eokText(p.assets.equity)})` : NEED,
      [p.assets?.debt_ratio != null ? `* 부채비율 ${Math.round(p.assets.debt_ratio)}%` : ""])}
    ${item("주주", shareholders)}
    ${item("주요 제품", NEED)}
    ${item("경영 현황", `<span class="muted">${sourceNote}</span>`)}
    ${perf ? table(["[단위 : 억]", ...perf.years.map(yy)], [
      ["매출액", ...perf["매출액"].map((v) => num(v))],
      ["영업이익", ...perf["영업이익"].map((v) => num(v))],
      ["영업이익률", ...perf["영업이익률"].map((v) => (v == null ? "-" : `${v.toFixed(1)}%`))],
    ], { caption: accNote }) : `<p class="pf-sub">${NEED}</p>`}
    ${item("거래금액", perf ? perf.years.slice(1).map((y) => `${yy(y)} XXX억`).join(" → ") : "XXX", [`- 거래비중 : ${NEED}`])}
    ${item("본사 및 제조거점", p.adres ? `${esc(p.adres)} (본사)` : NEED, [p.adres ? `<span class="muted">* 제조거점 확인필요</span>` : ""])}
  `;

  // ---------- 2면: 재무현황 분석 ----------
  const finRows = (data, yoyLabel) => [
    ["재무", "총자산"], ["재무", "부채총계"], ["재무", "자본총계"], ["손익", "매출액"], ["손익", "영업이익"], ["손익", "당기순이익"],
  ].map(([grp, k]) => [grp, k, ...data.rows[k].map((v) => num(v)), rate(data.yoy[k])]);

  const RATIO_ROWS = [
    ["안정성<br>(%)", "유동비율", "* 100% 이상 → 양호"],
    ["안정성<br>(%)", "부채비율", "* 300% 이상 → 과다<br>200% 이하 → 양호"],
    ["안정성<br>(%)", "차입금의존도", "* 30% 이하 → 안정"],
    ["수익성<br>(%)", "영업이익률", ""],
    ["수익성<br>(%)", "총자본순이익률", ""],
    ["수익성<br>(%)", "매출액순이익률", ""],
    ["성장성<br>(%)", "총자산증가율", ""],
    ["성장성<br>(%)", "매출액증가율", ""],
    ["성장성<br>(%)", "유형자산증가율", ""],
    ["활동성<br>(회)", "매출채권회전율", "* 4회 이상 → 양호"],
    ["활동성<br>(회)", "매입채무회전율", "* 높을수록 지급능력↑"],
  ];
  const ratioTable = r ? table(
    ["주요 지표", "", ...r.years.map(yy), "업종평균", `현황<br>(${yy(r.years[2])} 기준)`],
    RATIO_ROWS.map(([grp, k, hint]) => [grp, `${k}${hint ? `<small>${hint}</small>` : ""}`,
      ...r.values[k].map((v) => num(v, 1)), NEED, r.status[k] ? esc(r.status[k]) : NEED]),
    { cls: "pf-ratio", groupCol: true }) : "";


  // ---------- 추가 정보 (DART 공시) ----------
  const dartLink = (no, text) => `<a href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(no)}" target="_blank" rel="noopener">${text}</a>`;
  const MARKETS = { Y: "유가증권시장", K: "코스닥", N: "코넥스", E: "기타(비상장)" };
  const fmtDate = (d) => (/^\d{8}$/.test(d || "") ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : esc(d));
  const basics = [
    ["정식 법인명", p.corp_name], ["영문명", p.corp_name_eng], ["시장 구분", MARKETS[p.corp_cls]],
    ["설립일", /^\d{8}$/.test(p.est_dt || "") ? fmtDate(p.est_dt) : ""], ["결산월", p.acc_mt ? `${Number(p.acc_mt)}월` : ""],
    ["법인등록번호", p.jurir_no], ["사업자등록번호", p.bizr_no], ["대표 전화", p.phn_no], ["팩스", p.fax_no],
    ["업종코드", p.induty_code], ["홈페이지", p.hm_url], ["IR 페이지", p.ir_url],
  ].filter(([, v]) => v);
  const safeHref = (u) => (/^https?:\/\//i.test(u) ? u : `http://${u}`);
  const basicRows = basics.map(([k, v]) => [k, /홈페이지|IR/.test(k) && /^[\w.-]+\.[a-z]{2,}/i.test(String(v).replace(/^https?:\/\//i, ""))
    ? `<a href="${esc(safeHref(v))}" target="_blank" rel="noopener">${esc(v)}</a>` : esc(v)]);

  const execs = (p.executives || []).filter((e) => e.name);
  const registered = execs.filter((e) => /이사|감사/.test(e.registered) && !/미등기/.test(e.registered));
  const shownExecs = (registered.length ? registered : execs).slice(0, 12);

  const extraHtml = `
    <h2 class="pf-part">추가 정보 <span class="pf-part-sub">DART 공시 기준</span></h2>
    ${basicRows.length ? `${item("기업 기본정보", "")}${table(["항목", "내용"], basicRows, { cls: "pf-kv" })}` : ""}

    ${p.shareholders?.top?.length ? `${item("주요 주주", p.shareholders.total ? `최대주주 및 특수관계인 합계 ${esc(p.shareholders.total)}%` : "")}
      ${table(["주주명", "관계", "지분율"], p.shareholders.top.map((h) => [esc(h.name), esc(h.relation || "-"), `${esc(h.ratio)}%`]), { cls: "pf-kv" })}` : ""}

    ${shownExecs.length ? `${item("임원 현황", `${registered.length ? "등기임원 " : ""}${shownExecs.length}명`)}
      ${table(["성명", "직위", "등기", "상근", "담당업무"], shownExecs.map((e) => [
        `${esc(e.name)}${e.birth_year ? ` <small>(${yy(e.birth_year).replace("년", "년생")})</small>` : ""}`,
        esc(e.position || "-"), esc(e.registered || "-"), esc(e.fulltime || "-"), esc(e.duty || "-")]), { cls: "pf-kv" })}` : ""}

    ${p.audit?.length ? `${item("외부감사", "")}
      ${table(["사업연도", "감사인", "감사의견"], p.audit.map((a) => [esc(a.period),
        a.rcept_no ? dartLink(a.rcept_no, esc(a.auditor)) : esc(a.auditor), a.opinion ? esc(a.opinion) : "-"]), { cls: "pf-kv" })}` : ""}

    ${p.dividends?.length && perf ? `${item("배당", "")}
      ${table(["구분", ...perf.years.slice(1).map(yy)], p.dividends.map((d) => [esc(d.item), ...d.values.map((v) => esc(v || "-"))]))}` : ""}

    ${p.investments?.length ? `${item("타법인 출자", `장부가액 상위 ${p.investments.length}곳`)}
      ${table(["법인명", "출자 목적", "지분율", "장부가액(억)"], p.investments.map((v) => [esc(v.name), esc(v.purpose || "-"),
        v.ratio == null ? "-" : `${v.ratio}%`, num(v.book_eok)]), { cls: "pf-kv" })}` : ""}

    ${p.filings?.length ? `${item("최근 공시", "최근 1년")}
      ${table(["접수일", "보고서명", "제출인"], p.filings.map((f) => [fmtDate(f.date), dartLink(f.rcept_no, esc(f.title)), esc(f.filer)]), { cls: "pf-kv pf-filings" })}` : ""}
  `;

  const page2 = `
    <h2 class="pf-part">재무현황 분석</h2>
    ${item("신용평가", "")}
    ${table(["", ...(perf ? perf.years.slice(1).map(yy) : ["-", "-", "-"])], [
      ["신용등급", NEED, NEED, NEED], ["현금흐름등급", NEED, NEED, NEED],
    ])}
    <p class="pf-note">* 신용등급 : BBB↑(우수), B↑(보통), CCC↓(미흡) &nbsp; * 현금흐름 등급 : A(우수), B(양호), C(보통), D(미흡)<br>
    * 신용평가 리포트(이크레더블 등)로 확인 후 기재</p>

    ${item("재무정보", "")}
    ${fin ? `${bullets(fin.text)}${table(["", "", ...fin.years.map(yy), "전년 대비"], finRows(fin), { groupCol: true, caption: `(단위: 억원)${accNote ? ` ${accNote}` : ""}` })}`
      : `<p class="pf-sub">${NEED} <span class="muted">DART 재무제표가 연결되면 표시됩니다. 사업보고서 제출 대상이 아닌 기업은 감사보고서로 확인해야 합니다.</span></p>`}

    ${q ? `${item(`${yy(q.years[1])} ${esc(q.label)} 실적 동향`, "")}${bullets(q.text || [])}
      ${table(["", "", `${yy(q.years[0])} ${esc(q.label)}`, `${yy(q.years[1])} ${esc(q.label)}`, "전년동기 대비"], finRows(q), { groupCol: true, caption: "(단위: 억원)" })}` : ""}

    ${item("재무비율 분석", "")}
    ${r ? `${bullets(r.text)}<p class="pf-note">(업종 : ${p.induty_code ? `업종코드 ${esc(p.induty_code)}` : NEED})</p>${ratioTable}` : `<p class="pf-sub">${NEED}</p>`}

    ${extraHtml}

    <section class="pf-ref">
      <h3>[참고 1] 경영성과 핵심지표</h3>
      <p>- 안정성: 단기채무 감당 능력, 부채의존도 확인<br>- 수익성: 이익을 얼마나 효율적으로 창출하고 있는지 파악<br>
      - 성장성: 미래 안정적으로 성장할지 판단<br>- 활동성: 자산/자원을 얼마나 효율적으로 운영하는가 평가</p>
      <h3>[참고 2] 주요 재무비율 정의</h3>
      ${table(["지표", "비율", "정의"], [
        ["안정성", "유동비율", "단기채무 상환능력 (유동자산 ÷ 유동부채 × 100)"],
        ["안정성", "부채비율", "자기자본 대비 부채 (부채총계 ÷ 자본총계 × 100)"],
        ["안정성", "차입금의존도", "자산 중 이자가 붙는 차입금 비중 (총차입금 ÷ 총자산 × 100)"],
        ["수익성", "영업이익률", "영업이익 ÷ 매출액 × 100"],
        ["수익성", "총자본순이익률(ROA)", "당기순이익 ÷ 평균 총자산 × 100"],
        ["수익성", "매출액순이익률", "당기순이익 ÷ 매출액 × 100"],
        ["성장성", "총자산증가율", "전기 대비 총자산 증가율"],
        ["성장성", "매출액증가율", "전기 대비 매출액 증가율"],
        ["성장성", "유형자산증가율", "토지·건물·기계 등 유형자산의 증가율"],
        ["활동성", "매출채권회전율", "연간 매출액 ÷ 평균 매출채권"],
        ["활동성", "매입채무회전율", "매입액(매출원가로 대신함) ÷ 평균 매입채무"],
      ], { cls: "pf-def", groupCol: true })}
    </section>
    <p class="pf-end">- 이 상 -</p>
  `;

  const ids = `
    <dl class="pf-ids">
      <div><dt>DART 고유번호</dt><dd>${esc(code)}</dd></div>
      <div><dt>종목코드</dt><dd>${company.stockCode ? esc(company.stockCode) : "비상장"}</dd></div>
      <div><dt>데이터 기준</dt><dd>${window.COMPANY_PROFILES_UPDATED ? `${esc(window.COMPANY_PROFILES_UPDATED)} 갱신` : "DART 연결 전"}</dd></div>
      ${company.stockCode ? `<div><dt>시세</dt><dd><a href="https://finance.naver.com/item/main.naver?code=${esc(company.stockCode)}" target="_blank" rel="noopener">네이버 증권 <i class="ph ph-arrow-up-right" aria-hidden="true"></i></a></dd></div>` : ""}
    </dl>`;

  root.innerHTML = ids + `<div class="pf-doc">${page1}${page2}</div>`;
})();
