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
  document.title = `${company.name} 프로필 | 협력사 프로필`;
  document.getElementById("crumb-current").textContent = company.name;

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
  const accNote = (() => {
    const m = Number(p.acc_mt || 12);
    if (m === 12 || !p.report_year) return "";
    const y = p.report_year, sm = m === 12 ? 1 : m + 1;
    return ` * ${m}월 결산: '${String(y).slice(2)}년 = '${String(y).slice(2)}.${sm}~'${String(y + 1).slice(2)}.${m}`;
  })();

  // 공시로 확인할 수 없어 표시하지 않는 항목. 회사마다 비어 있는 항목이 뒤에 더해진다.
  const missing = new Set(["기업규모", "주요 제품", "거래금액·비중", "신용등급", "업종평균"]);

  // □ 항목 한 줄(+ 아래 설명, 목록). 값이 없으면 그리지 않고 '표시하지 않은 항목'에 올린다.
  const line = (label, value, notes = [], extra = "") => {
    if (value == null || value === "") {
      missing.add(label);
      return "";
    }
    return `<div class="pf-item"><p class="pf-line"><span class="sq">□</span> <strong>${label}</strong> : ${value}</p>`
      + notes.filter(Boolean).map((n) => `<p class="pf-note">${n}</p>`).join("") + extra + "</div>";
  };
  // □ 항목 + 표·글머리 목록. 본문이 없으면 그리지 않는다.
  const block = (label, tag, body) => (body
    ? `<div class="pf-item"><p class="pf-line"><span class="sq">□</span> <strong>${label}</strong>${tag ? ` <span class="pf-tag">* ${tag}</span>` : ""}</p>${body}</div>`
    : "");
  const list = (items) => (items && items.length ? `<ul class="pf-bullets">${items.map((l) => `<li>${l}</li>`).join("")}</ul>` : "");
  const bullets = (lines) => list((lines || []).map(esc));
  const shortDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? `'${d.slice(2, 4)}.${Number(d.slice(5, 7))}.${Number(d.slice(8))}` : "");

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
    + (company.stockCode ? `<li data-nocopy><a href="https://search.naver.com/search.naver?query=${encodeURIComponent(`${p.stock_name || company.name} 주가`)}" target="_blank" rel="noopener">네이버 증권<i class="ph ph-arrow-up-right" aria-hidden="true"></i></a></li>` : "")
    + `<li data-nocopy><a href="https://dart.fss.or.kr/dsab001/main.do?autoSearch=Y&textCrpCik=${esc(code)}&textCrpNm=${encodeURIComponent(p.stock_name || company.name)}" target="_blank" rel="noopener">DART 공시<i class="ph ph-arrow-up-right" aria-hidden="true"></i></a></li>`;

  // ---------- 1면: 개요 ----------
  const holders = p.shareholders && p.shareholders.top ? p.shareholders.top : [];
  // 각자대표·공동대표는 사람별로 나눠 출생연도, 최대주주와의 관계, 경력을 따로 보여 준다
  const execs0 = p.executives || [];
  const same = (a, b) => String(a || "").replace(/\s/g, "") === String(b || "").replace(/\s/g, "");
  const ceoRaw = String(p.ceo_nm || "");
  const ceoNames = [...new Set(ceoRaw.replace(/\([^)]*\)/g, " ")
    .replace(/(?:각자|공동)?\s*대표\s*(?:이사)?/g, " ").replace(/외\s*\d+\s*(?:인|명)/g, " ")
    .split(/[,/·;]/).flatMap((part) => {
      const t = part.trim().split(/\s+/).filter(Boolean);
      return t.length > 1 && t.every((x) => /^[가-힣]{2,4}$/.test(x)) ? t : [t.join(" ")]; // '이경일 하형찬' 처럼 띄어 쓴 경우
    }).filter((n) => n.length >= 2))];
  // 개황의 대표 이름이 영문(예: Tae Hyuk Ahn)이라 임원 명단과 맞지 않으면, 임원 명단에서 대표이사를 찾아 쓴다
  if (ceoNames.length && !ceoNames.some((n) => execs0.some((x) => same(x.name, n)))) {
    const reps = execs0.filter((x) => /대표/.test(`${x.position || ""} ${x.duty || ""}`)).map((x) => x.name);
    if (reps.length) ceoNames.splice(0, ceoNames.length, ...new Set(reps));
  }
  const multiCeo = ceoNames.length > 1;
  const FAMILY = /배우자|자녀|아들|딸|장남|차남|삼남|장녀|차녀|형제|자매|부친|모친|친인척|친족|인척|사위|며느리|손자|손녀|조카|동생|처남|남편|부인/;
  const ceoTag = (name, e) => {
    const rel = String((e && e.relate) || "").replace(/^최대주주(?:의|와의)?\s*/, "").trim();
    const h = holders.find((x) => same(x.name, name));
    if (/본인/.test(rel) || (holders[0] && same(holders[0].name, name))) return "최대주주";
    if (FAMILY.test(rel)) return `최대주주의 ${rel}`;
    if (h && FAMILY.test(h.relation || "")) return `최대주주의 ${h.relation}`;
    if (h && /본인|최대주주/.test(h.relation || "")) return "최대주주";
    return e ? "전문경영인" : "";
  };
  const ceoPeople = ceoNames.map((name, i) => {
    const e = execs0.find((x) => same(x.name, name));
    const birth = e && e.birth_year ? e.birth_year : (i === 0 && p.ceo ? p.ceo.birth_year : null);
    const career = e && e.career && e.career.length ? e.career : (i === 0 && p.ceo && p.ceo.career ? p.ceo.career : []);
    return { name, birth, career, tag: ceoTag(name, e) };
  });
  const person = (c) => `${esc(c.name)}${c.birth ? `(${yy(c.birth)}생)` : ""}${c.tag ? ` <span class="pf-tag">* ${esc(c.tag)}</span>` : ""}`;
  const careerText = (c) => c.career.map(esc).join(", ");
  const ceoKind = /공동/.test(ceoRaw) ? "공동대표" : /각자/.test(ceoRaw) ? "각자대표" : `대표이사 ${ceoNames.length}인`;
  // 한 명이면 이름 줄 아래에 경력, 여러 명이면 사람마다 이름과 경력을 묶어 보여 준다
  const ceoItem = !ceoPeople.length ? line("대표이사", "")
    : !multiCeo ? line("대표이사", person(ceoPeople[0]), [ceoPeople[0].career.length ? `* ${careerText(ceoPeople[0])}` : ""])
      : line("대표이사", `${ceoNames.map(esc).join(", ")} (${ceoKind})`, [],
        list(ceoPeople.map((c) => `${person(c)}${c.career.length ? `<span class="pf-sub">${careerText(c)}</span>` : ""}`)));

  const emp = p.employees || {};
  const empNote = [emp.avg_tenure ? `평균 근속 ${emp.avg_tenure}년` : "", emp.avg_salary_man ? `1인 평균 급여 ${num(emp.avg_salary_man)}만원` : ""]
    .filter(Boolean).join(", ");

  const mk = p.market;
  const mkDate = mk && mk.date ? `'${mk.date.slice(2, 4)}.${Number(mk.date.slice(5, 7))}.${Number(mk.date.slice(8))}` : "";

  const shareholders = holders.length
    ? `${holders.slice(0, 3).map((h) => `${esc(h.name)} ${esc(h.ratio)}%`).join(", ")}${p.shareholders.total ? ` 등 (특수관계인 합계 ${esc(p.shareholders.total)}%)` : ""}`
    : "";

  // 경영 실적(최근 3년 + 올해 누적)과 재무 정보(최근 3년 + 최근 분기 말)
  const perf = p.performance;
  const fin = p.financials;
  const q = p.quarter;
  const r = p.ratios;
  const QN = { "1분기": "1Q", "반기": "2Q", "3분기": "3Q" };
  const qLabel = q ? `'${String(q.years[1]).slice(2)}.${QN[q.label] || esc(q.label)}` : "";
  const qv = (k) => (q && q.rows[k] ? q.rows[k][1] : null);
  const pctText = (v) => (v == null ? "-" : `${v.toFixed(1)}%`);
  const ratio = (a, b) => (a != null && b ? Math.round((a / b) * 1000) / 10 : null);
  const caption = `(단위: 억원)${accNote}`;

  let perfTable = "";
  {
    const cols = perf ? perf.years.map((_, i) => i).filter((i) => perf["매출액"][i] != null || perf["영업이익"][i] != null).slice(-3) : [];
    const withQ = qv("매출액") != null || qv("영업이익") != null;
    if (cols.length || withQ) {
      const qCell = (v) => (withQ ? [v] : []);
      perfTable = table(["구분", ...cols.map((i) => yy(perf.years[i])), ...qCell(`~${qLabel}`)], [
        ["매출액", ...cols.map((i) => num(perf["매출액"][i])), ...qCell(num(qv("매출액")))],
        ["영업이익", ...cols.map((i) => num(perf["영업이익"][i])), ...qCell(num(qv("영업이익")))],
        ["영업이익률", ...cols.map((i) => pctText(perf["영업이익률"][i])), ...qCell(pctText(ratio(qv("영업이익"), qv("매출액"))))],
      ], { caption });
    }
  }

  let bsTable = "";
  {
    const cols = fin ? fin.years.map((_, i) => i).filter((i) => fin.rows["총자산"][i] != null) : [];
    const withQ = qv("총자산") != null;
    if (cols.length || withQ) {
      const qCell = (v) => (withQ ? [v] : []);
      const debtRatio = (i) => (r && r.values["부채비율"] && r.values["부채비율"][i] != null
        ? r.values["부채비율"][i] : ratio(fin.rows["부채총계"][i], fin.rows["자본총계"][i]));
      const qDebt = q && q.debt_ratio && q.debt_ratio[1] != null ? q.debt_ratio[1] : ratio(qv("부채총계"), qv("자본총계"));
      const row = (label, k) => [label, ...cols.map((i) => num(fin.rows[k][i])), ...qCell(num(qv(k)))];
      bsTable = table(["구분", ...cols.map((i) => yy(fin.years[i])), ...qCell(qLabel)], [
        row("자산총계", "총자산"), row("부채총계", "부채총계"), row("자본총계", "자본총계"),
        ["부채비율", ...cols.map((i) => pctText(debtRatio(i))), ...qCell(pctText(qDebt))],
      ], { caption });
    }
  }
  const basis = `개별기준${p.standard ? `(${esc(p.standard)})` : ""}${p.fin_source === "audit" ? ", 감사보고서에서 자동 추출" : ""}`;

  // ---------- 설립 및 이력 ----------
  const est = /^\d{8}$/.test(p.est_dt || "") ? Number(p.est_dt.slice(0, 4)) : null;
  // 공시에 줄글 한 문장으로만 적힌 이력은 설립·사업·소재지로 나눠 한 줄씩 보여 준다
  const PLACE = /((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)[가-힣]*\s+[가-힣0-9 ]{1,20}?)에\s*(본사|제조시설|생산시설|공장|연구소)/;
  const END = [[/있습니다/g, "있음"], [/없습니다/g, "없음"], [/하였습니다|했습니다/g, "함"], [/되었습니다|됐습니다/g, "됨"], [/입니다/g, "임"]];
  const isProse = (t) => /(습니다|입니다)\.?$/.test(t.trim()) || (t.length > 50 && /설립되(어|었)/.test(t));
  function terse(h) {
    const t = h.text.replace(/^['’]?\d{2}년\s*/, "").replace(/당사는\s*/g, "").trim();
    const out = [];
    const d = t.match(/((?:19|20)\d{2})년\s*(\d{1,2})월(?:\s*(\d{1,2})일)?[^.,]*?설립/);
    const year = d ? Number(d[1]) : h.year;
    // 설립 월은 DART 기업개황의 설립일이 문장보다 정확하므로 같은 해이면 그 값을 쓴다
    const estMonth = /^\d{8}$/.test(p.est_dt || "") && Number(p.est_dt.slice(0, 4)) === year ? Number(p.est_dt.slice(4, 6)) : null;
    if (d) out.push({ year, text: `${estMonth || Number(d[2])}월 법인 설립` });
    const biz = (t.match(/설립되(?:어|었으며|었고)?[,\s]*(.+?)(?:을|를)\s*(?:주요\s*|주된\s*)?(?:사업으로|목적으로)/)
      || t.match(/^(.+?)(?:을|를)\s*목적으로/) || [])[1];
    if (biz) {
      // 품목이 여럿이면 한 줄로 이어 쓰고 맨 끝만 ~함으로 맺는다
      const items = biz.replace(/^[,\s]+/, "").trim().split(/(?<=(?:판매|제조|생산|공급|개발))(?:와|과),\s*/).map((x) => x.trim().replace(/(?:을|를)$/, ""));
      out.push({ year, bare: true, text: `주요 사업: ${items.join(", ")}${/(함|됨|음|임)$/.test(items[items.length - 1]) ? "" : "함"}` });
    }
    const pl = t.match(PLACE);
    if (pl) out.push({ year, bare: true, text: `${pl[1].trim()} ${pl[2]}` });
    if (out.length) return out;
    // 형식을 알 수 없는 문장은 연결어미에서 끊고 서술어를 명사형으로 줄인다
    const parts = t.split(/(?<=(?:하였으며|되었으며|하였고|되었고|있으며|하며)),\s*/).map((s) => {
      let x = s.replace(/\.$/, "");
      END.forEach(([re, to]) => { x = x.replace(re, to); });
      return x.replace(/(하였으며|되었으며|있으며)$/, (m) => ({ 하였으며: "함", 되었으며: "됨", 있으며: "있음" }[m]));
    }).filter(Boolean);
    return parts.map((x, i) => ({ year: h.year, bare: i > 0, text: x }));
  }
  const events = (p.history || []).filter((h) => h.text)
    .flatMap((h) => (isProse(h.text) ? terse(h) : [{ year: h.year || null, text: h.text }]))
    .map((h) => ({ year: h.year || null, text: h.text, bare: !!h.bare }));
  // 설립 줄이 이미 있으면(연도가 달라도) 한 번 더 넣지 않는다
  if (est && events.length && !events.some((h) => h.year === est || /(?:^|\s)(?:법인\s*|회사\s*)?설립(?:\s|$)/.test(h.text))) {
    events.push({ year: est, text: "법인 설립" });
  }
  const note = (window.COMPANY_NOTES || {})[code];
  // 직접 확인한 이력이 있으면 자동으로 읽은 줄글 대신 쓴다
  if (note && note.history && note.history.length) events.splice(0, events.length, ...note.history.map((h) => ({ year: h.year, text: h.text, bare: false })));
  if (note && note.business && note.business.length) {
    const kept = events.filter((h) => !/^주요 사업:/.test(h.text));
    if (est && !kept.some((h) => h.year === est || /설립/.test(h.text))) {
      const m = Number(p.est_dt.slice(4, 6));
      kept.unshift({ year: est, text: `${m ? `${m}월 ` : ""}법인 설립` });
    }
    const at = Math.max(0, kept.findIndex((h) => /설립/.test(h.text)) + 1);
    const yr = (kept[at - 1] && kept[at - 1].year) || est;
    kept.splice(at, 0, { year: yr, bare: true, text: `주요 사업: ${note.business.join(", ")}함` });
    events.splice(0, events.length, ...kept);
  }
  events.sort((a, b) => (a.year || 9999) - (b.year || 9999));
  if (!events.length) missing.add("연혁");
  const historyItem = events.length
    ? block("설립 및 이력", "", list(events.map((h) => `${h.year && !h.bare && !/^(19|20)\d{2}년/.test(h.text) ? `${yy(h.year)} ` : ""}${esc(h.text)}`)))
    : line("설립", est ? `${yy(est)} 설립` : "");

  // ---------- 본사 및 제조거점 ----------
  const sites = (p.sites || []).filter((x) => x.location && x.roles && x.roles.length);
  const roleSet = new Set(sites.flatMap((x) => x.roles));
  const hasPlant = roleSet.has("제조") || roleSet.has("사업장");
  if (!hasPlant) missing.add("제조거점");
  const siteLabel = hasPlant ? "본사 및 제조거점" : [...roleSet].some((x) => x !== "본사") ? "본사 및 사업장" : "본사";
  const address = p.adres ? esc(p.adres.replace(/\s*-\s*$/, "")) : "";
  const siteItem = sites.length
    ? line(siteLabel, sites.map((x) => `${esc(x.location)}(${x.roles.map(esc).join(", ")})`).join(", "), [address ? `* 본사 주소: ${address}` : ""])
    : line("본사", address);

  // ---------- 주요 특징 ----------
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? esc(u) : "");
  const highlightList = list((p.highlights || []).filter((h) => h.title).map((h) => {
    const title = safeUrl(h.url) ? `<a href="${safeUrl(h.url)}" target="_blank" rel="noopener">${esc(h.title)}</a>` : esc(h.title);
    const src = [shortDate(h.date), h.kind === "공시" ? "공시" : h.source].filter(Boolean).map(esc).join(", ");
    return `${title}${src ? ` <span class="pf-src">(${src})</span>` : ""}`;
  }));

  const overview = [
    historyItem,
    ceoItem,
    line("인력", emp.count ? `${num(emp.count)}명 (${esc(emp.as_of)} 기준)` : "", [empNote ? `* ${empNote}` : ""]),
    listed ? line("시가총액", mk ? `${eokText(mk.cap)}원 (주가 ${num(mk.price)}원)` : "", [mkDate ? `* ${mkDate} 종가 기준` : ""]) : "",
    line("주주", shareholders, [p.shareholders && p.shareholders.source ? `* ${esc(p.shareholders.source)} 기준` : ""]),
    block("경영 실적", basis, perfTable),
    block("재무 정보", basis, bsTable),
    siteItem,
    block("주요 특징", "최근 4개월 공시·뉴스에서 자동 선정", highlightList),
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
    fin ? block("재무 분석", "", bullets(fin.text) + finTable(fin, fin.years.map(yy), "전년 대비")) : "",
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

  // 맨 위 핵심 숫자 (화면용. Word 복사에는 넣지 않는다)
  const lastIdx = perf ? perf.years.map((_, i) => i).filter((i) => perf["매출액"][i] != null).pop() : undefined;
  const sg = (v) => (v == null ? "" : `<span class="${v >= 0 ? "up" : "down"}">전년 대비 ${rate(v)}</span>`);
  const kpiList = [];
  if (lastIdx != null) {
    const y = yy(perf.years[lastIdx]);
    kpiList.push(["매출액", `${eokText(perf["매출액"][lastIdx])}원`, `${y} ${sg(fin && fin.yoy ? fin.yoy["매출액"] : null)}`]);
    kpiList.push(["영업이익", `${eokText(perf["영업이익"][lastIdx])}원`, `영업이익률 ${pctText(perf["영업이익률"][lastIdx])}`]);
  }
  const debtVal = r && r.values["부채비율"] && r.values["부채비율"].filter((v) => v != null).pop();
  if (debtVal != null) kpiList.push(["부채비율", pctText(debtVal), debtVal <= 200 ? "200% 이하 양호" : "200% 초과"]);
  if (listed && mk) kpiList.push(["시가총액", `${eokText(mk.cap)}원`, `주가 ${num(mk.price)}원`]);
  else if (emp.count) kpiList.push(["인력", `${num(emp.count)}명`, esc(emp.as_of || "")]);
  const kpis = kpiList.length ? `<dl class="pf-kpis" data-nocopy>${kpiList.map(([k, v, s]) => `<div class="pf-kpi"><dt>${k}</dt><dd>${v}</dd><small>${s}</small></div>`).join("")}</dl>` : "";

  root.innerHTML = `<header class="pf-head"><h1>${esc(company.name)} 프로필</h1><ul class="meta">${meta}</ul>${kpis}</header>`
    + `<div class="pf-items" id="pf-overview">${overview}</div>`
    + (analysis ? `<h2 class="pf-part" id="pf-analysis">재무현황 분석</h2><div class="pf-items">${analysis}</div>` : "")
    + (extra ? `<h2 class="pf-part" id="pf-extra">추가 정보</h2><div class="pf-items">${extra}</div>` : "")
    + missingNote + ref;

  // 긴 프로필에서 구역을 바로 오가는 메뉴 (복사 대상인 #profile 밖에 둔다)
  const nav = document.getElementById("pf-nav");
  const parts = [["pf-overview", "개요"], analysis && ["pf-analysis", "재무현황 분석"], extra && ["pf-extra", "추가 정보"]].filter(Boolean);
  if (parts.length > 1) {
    nav.innerHTML = parts.map(([id, label], i) => `<a href="#${id}"${i === 0 ? ' aria-current="true"' : ""}>${label}</a>`).join("");
    nav.hidden = false;
    nav.addEventListener("click", (e) => {
      const a = e.target.closest("a");
      if (!a) return;
      e.preventDefault();
      history.replaceState(null, "", location.pathname + location.search + location.hash); // 기업 주소(#고유번호)는 그대로 둔다
      document.getElementById(a.getAttribute("href").slice(1)).scrollIntoView({ behavior: "smooth", block: "start" });
    });
    const spy = new IntersectionObserver((entries) => {
      entries.filter((en) => en.isIntersecting).forEach((en) => {
        nav.querySelectorAll("a").forEach((a) => a.toggleAttribute("aria-current", a.getAttribute("href") === `#${en.target.id}`));
      });
    }, { rootMargin: "-20% 0px -70% 0px" });
    parts.forEach(([id]) => spy.observe(document.getElementById(id)));
  }
  const top = document.getElementById("to-top");
  top.addEventListener("click", (e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  const showTop = () => { top.hidden = window.scrollY < 900; };
  window.addEventListener("scroll", showTop, { passive: true });
  showTop();

  const copyBtn = document.getElementById("copy-profile");
  copyBtn.hidden = false;
  copyBtn.addEventListener("click", () => window.CopyKit.copyNode(root, "프로필을 복사했습니다. Word에 붙여 넣으세요."));
})();
