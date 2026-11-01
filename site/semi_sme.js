/* 국내 반도체 소부장 분석 화면(#v-semi): 소재·부품·장비 기업 수, 코스피·코스닥·코넥스 대비 비중, 시가총액, 기업 표.
   데이터는 data/semi_sme.js(승인된 데이터만). 값이 없으면 0으로 바꾸지 않고 '-' 또는 '확정 전'으로 보여 준다.
   분자·분모의 기준일이 다르면 시총 비중은 계산하지 않는다. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const D = window.SEMI_SME || { status: "pending", market: {}, members: [], cap: {} };
  const MK = [["KOSPI", "코스피"], ["KOSDAQ", "코스닥"], ["KONEX", "코넥스"]];
  const KINDS = ["장비", "부품", "소재"];
  const KCOL = { 장비: "var(--orange)", 부품: "var(--teal)", 소재: "var(--blue)" };
  const nf = (v, d = 0) => (v == null || !isFinite(v) ? "-" : v.toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (v) => (v == null || !isFinite(v) ? "-" : `${v.toFixed(2)}%`);
  const jo = (eok) => (eok == null ? "-" : Math.abs(eok) >= 10000 ? `${(eok / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}조 원` : `${nf(eok)}억 원`);
  const state = { mk: "all", kind: "all", status: "all", q: "", sort: "cap", all: false };
  const PAGE = 20; // 처음에는 시가총액 상위 20곳만 보여 주고 '전체 보기'로 펼친다
  const members = () => (D.members || []).filter((m) => MK.some(([k]) => k === m.market) && KINDS.includes(m.kind));
  const statusInfo = () => ({
    pending: { cls: "pending", icon: "ph-hourglass-medium", label: "확정 전", text: "승인된 소부장 목록이 아직 없습니다. 아래 틀은 KRX 시장 기준값만 채워져 있고, 기업 수와 시가총액은 승인 후 표시됩니다." },
    preview: { cls: "preview", icon: "ph-eye", label: "검토용", text: "검토용 데이터입니다. 사용자 승인 전 값이며 확정 통계로 인용하지 마세요." },
    approved: { cls: "approved", icon: "ph-seal-check", label: "승인됨", text: "사용자가 승인한 목록과 동일 기준일 시가총액으로 계산했습니다." }
  }[D.status] || { cls: "pending", icon: "ph-hourglass-medium", label: "확정 전", text: "" });

  function calc() {
    const ms = members(), mkt = D.market || {};
    const capOk = !!(D.cap && D.cap.asOf && mkt.asOf && D.cap.asOf === mkt.asOf);
    const out = { capOk, rows: {} };
    MK.forEach(([k]) => {
      const list = ms.filter((m) => m.market === k), base = mkt[k] || {};
      const byKind = {};
      KINDS.forEach((kd) => {
        const l = list.filter((m) => m.kind === kd), caps = l.map((m) => m.capEok);
        byKind[kd] = { n: l.length, cap: caps.some((c) => c != null) ? caps.reduce((a, c) => a + (c || 0), 0) : null, miss: caps.filter((c) => c == null).length };
      });
      const n = list.length, hasSec = list.length && list.every((m) => m.securities != null);
      const capVals = list.map((m) => m.capEok), cap = capVals.some((c) => c != null) ? capVals.reduce((a, c) => a + (c || 0), 0) : null;
      const denEok = base.capBillion != null ? base.capBillion * 10 : null; // 십억원 → 억원
      out.rows[k] = {
        n, byKind, cap, miss: capVals.filter((c) => c == null).length, sec: hasSec ? list.reduce((a, m) => a + m.securities, 0) : null,
        companies: base.companies ?? null, securities: base.securities ?? null, denEok,
        pCo: n && base.companies ? (n / base.companies) * 100 : null,
        pSec: hasSec && base.securities ? (list.reduce((a, m) => a + m.securities, 0) / base.securities) * 100 : null,
        pCap: capOk && n && cap != null && denEok && !capVals.some((c) => c == null) ? (cap / denEok) * 100 : null
      };
    });
    const all = MK.map(([k]) => out.rows[k]);
    const n = all.reduce((a, r) => a + r.n, 0);
    out.total = { n, byKind: Object.fromEntries(KINDS.map((kd) => [kd, all.reduce((a, r) => a + r.byKind[kd].n, 0)])), companies: all.reduce((a, r) => a + (r.companies || 0), 0) };
    out.total.pCo = n && out.total.companies ? (n / out.total.companies) * 100 : null;
    return out;
  }

  const kpi = (icon, label, value, sub, hero) => `<article class="db-kpi sm-kpi${hero ? " hero" : ""}"><p class="lab"><i class="ph ${icon}" aria-hidden="true"></i>${label}</p><strong>${value}</strong><p class="delta">${sub}</p></article>`;

  function stacked(c) {
    const max = Math.max(1, ...MK.map(([k]) => c.rows[k].n));
    return `<ul class="sm-stack">${MK.map(([k, nm], i) => {
      const r = c.rows[k], total = r.n;
      const segs = KINDS.map((kd, j) => `<span class="seg" style="--w:${total ? (r.byKind[kd].n / max) * 100 : 0}%;--c:${KCOL[kd]};--i:${i * 3 + j}" data-tip="${nm} ${kd} ${r.byKind[kd].n}곳"></span>`).join("");
      return `<li><span class="nm">${nm}</span><span class="track">${total ? segs : `<span class="empty">확정 전</span>`}</span><span class="v">${total ? `${nf(total)}곳` : "-"}<em>시장 ${nf(r.companies)}곳 중</em></span></li>`;
    }).join("")}</ul><ul class="db-legend sm-leg">${KINDS.map((kd) => `<li><i class="sq" style="background:${KCOL[kd]}"></i>${kd}</li>`).join("")}</ul>`;
  }

  function shareTable(c) {
    const row = (nm, r) => `<tr><th scope="row">${nm}</th>
      <td><b>${pct(r.pCo)}</b><small>${r.n ? nf(r.n) : "-"} / ${nf(r.companies)} 회사</small></td>
      <td><b>${pct(r.pSec)}</b><small>${r.sec != null ? nf(r.sec) : "-"} / ${nf(r.securities)} 종목</small></td>
      <td><b>${pct(r.pCap)}</b><small>${r.pCap == null && r.miss ? `시총 없는 ${nf(r.miss)}곳이 있어 비중 보류` : `${r.cap != null ? jo(r.cap) : "-"} / ${r.denEok != null ? jo(r.denEok) : "-"}`}</small></td></tr>`;
    return `<div class="sm-scroll"><table class="sm-share"><thead><tr><th></th><th>기업 수 비중<small>법인 기준</small></th><th>종목 수 비중<small>우선주 포함 시 별도 표기</small></th><th>시가총액 비중<small>상장기업 전체 가치</small></th></tr></thead><tbody>${MK.map(([k, nm]) => row(nm, c.rows[k])).join("")}</tbody></table></div>`;
  }

  function krxTable() {
    const mkt = D.market || {};
    return `<div class="sm-scroll"><table class="sm-krx"><thead><tr><th>시장</th><th>회사 수</th><th>종목 수</th><th>시가총액</th></tr></thead><tbody>${MK.map(([k, nm]) => { const b = mkt[k] || {}; return `<tr><th scope="row">${nm}</th><td>${nf(b.companies)}</td><td>${nf(b.securities)}</td><td>${b.capBillion != null ? jo(b.capBillion * 10) : "-"}</td></tr>`; }).join("")}</tbody></table></div>`;
  }

  function table(c) {
    let ms = members().filter((m) => (state.mk === "all" || m.market === state.mk) && (state.kind === "all" || m.kind === state.kind) && (state.status === "all" || m.status === state.status) && (!state.q || (m.name + m.code).toLowerCase().includes(state.q.toLowerCase())));
    ms = ms.slice().sort((a, b) => (state.sort === "name" ? a.name.localeCompare(b.name, "ko") : (b.capEok ?? -1) - (a.capEok ?? -1)));
    const total = ms.length; if (!state.all) ms = ms.slice(0, PAGE);
    const den = (mk) => { const r = c.rows[mk]; return r && r.denEok; };
    if (!members().length) return `<p class="sm-empty"><i class="ph ph-table" aria-hidden="true"></i>승인된 기업 목록이 들어오면 종목코드·분류·시가총액·상태가 여기에 표시됩니다.</p>`;
    return `<div class="sm-scroll"><table class="sm-co"><thead><tr><th>종목코드</th><th>기업명</th><th>구분</th><th>시장</th><th class="r">시가총액</th><th class="r">시장 내 비중</th><th>상태</th></tr></thead><tbody>${ms.map((m, i) => `<tr style="--i:${Math.min(i, 24)}"><td class="code">${esc(m.code)}</td><td><b>${esc(m.name)}</b></td><td><i class="sq" style="background:${KCOL[m.kind]}"></i>${m.kind}</td><td>${(MK.find(([k]) => k === m.market) || [])[1]}</td><td class="r">${m.capEok != null ? jo(m.capEok) : "<span class='na'>-</span>"}</td><td class="r">${c.capOk && m.capEok != null && den(m.market) ? pct((m.capEok / den(m.market)) * 100) : "-"}</td><td><span class="sm-badge ${esc(m.status || "")}">${esc(m.status || "-")}</span></td></tr>`).join("")}</tbody></table></div><div class="sm-more"><span class="sm-count">${nf(ms.length)}곳 표시 / 전체 ${nf(total)}곳 · 시가총액 없는 곳은 맨 아래</span>${total > PAGE ? `<button type="button" class="sm-chip sm-toggle" id="sm-more" aria-pressed="false">${state.all ? "상위 20곳만 보기" : "전체 보기"}</button>` : ""}</div>`;
  }

  function chips(id, opts, cur) {
    return `<div class="sm-chips" id="${id}" role="group">${opts.map(([v, l]) => `<button type="button" class="sm-chip" data-v="${v}" aria-pressed="${String(cur === v)}">${l}</button>`).join("")}</div>`;
  }

  function draw() {
    const root = $("c-semi");
    if (!root) return;
    const c = calc(), si = statusInfo(), mkt = D.market || {}, has = members().length > 0;
    const capNote = !D.cap || !D.cap.asOf ? "시가총액 기준일이 아직 없습니다." : c.capOk ? `시가총액 기준일 ${esc(D.cap.asOf)} · ${esc(D.cap.basis || "증권유형 미표기")}` : `시가총액 기준일(${esc(D.cap.asOf)})이 시장 기준일(${esc(mkt.asOf)})과 달라 시총 비중을 계산하지 않았습니다.`;
    const head = has
      ? `국내 상장 반도체 소부장은 <b>${nf(c.total.n)}곳</b>(장비 ${nf(c.total.byKind.장비)} · 부품 ${nf(c.total.byKind.부품)} · 소재 ${nf(c.total.byKind.소재)})이고, 전체 상장사(${nf(c.total.companies)}곳)의 <b>${pct(c.total.pCo)}</b>입니다.`
      : `국내 상장 반도체 소부장 분석 — <b>확정 전</b>입니다. 소재·부품·장비 기업 수와 시장 비중은 사용자 승인 후 채워집니다.`;
    const tag = D.status === "approved" ? "" : `<b class="sm-tag">${D.status === "preview" ? "검토용" : "확정 전"}</b> `;
    root.innerHTML = `
      <p class="db-headline sm-head" aria-live="polite">${tag}${head}</p>
      <section class="sm-status ${si.cls}" role="status"><i class="ph ${si.icon}" aria-hidden="true"></i><div><strong>${si.label}</strong><span>${si.text}</span></div>
        <dl><div><dt>시장 기준일</dt><dd>${esc(mkt.asOf || "-")}</dd></div><div><dt>시장 출처</dt><dd>${esc(mkt.source || "-")}</dd></div><div><dt>시총 기준</dt><dd>${capNote}</dd></div></dl></section>
      <section class="db-kpis sm-kpis" aria-label="핵심 지표">
        ${kpi("ph-cpu", "소부장 기업 수", has ? `${nf(c.total.n)}<small>곳</small>` : "-", has ? "승인 목록 기준" : "확정 전", true)}
        ${kpi("ph-factory", "장비", has ? `${nf(c.total.byKind.장비)}<small>곳</small>` : "-", "증착·식각·검사·테스트 등")}
        ${kpi("ph-circuitry", "부품", has ? `${nf(c.total.byKind.부품)}<small>곳</small>` : "-", "소켓·쿼츠·기판 등")}
        ${kpi("ph-flask", "소재", has ? `${nf(c.total.byKind.소재)}<small>곳</small>` : "-", "가스·케미칼·전구체 등")}
        ${kpi("ph-chart-pie-slice", "기업 수 비중", pct(c.total.pCo), `전체 상장 ${nf(c.total.companies)}곳 대비`)}
        ${kpi("ph-coins", "시가총액 비중", c.capOk && c.rows.KOSDAQ.pCap != null ? `${pct(c.rows.KOSDAQ.pCap)}<small>코스닥</small>` : "-", c.capOk ? `코스피 ${pct(c.rows.KOSPI.pCap)}` : "분자·분모 기준일 일치 시 표시")}
      </section>
      <div class="db-grid sm-grid">
        <section class="db-card sm-card" aria-labelledby="sm-t1"><div class="db-card-head"><h2 id="sm-t1">시장별 소부장 기업 수 <small>소재·부품·장비</small></h2></div>${stacked(c)}</section>
        <section class="db-card sm-card" aria-labelledby="sm-t2"><div class="db-card-head"><h2 id="sm-t2">KRX 시장 기준값 <small>분모 · ${esc(mkt.asOf || "-")}</small></h2></div>${krxTable()}
          <p class="db-note"><i class="ph ph-info" aria-hidden="true"></i><span>회사 수와 종목 수는 다릅니다(우선주·종류주권은 종목 수에만 포함). KOSDAQ GLOBAL은 코스닥에 포함된 하위 구분이라 따로 더하지 않습니다.</span></p></section>
      </div>
      <section class="db-card sm-card" aria-labelledby="sm-t3"><div class="db-card-head"><h2 id="sm-t3">시장 대비 비중 <small>기업 수 · 종목 수 · 시가총액을 따로 계산</small></h2></div>${shareTable(c)}
        <p class="db-note"><i class="ph ph-info" aria-hidden="true"></i><span>시가총액은 상장기업 <b>전체</b> 가치입니다. 다각화 기업의 반도체 사업부 가치가 아닙니다. 분자와 분모의 기준일·증권유형이 같을 때만 비중을 표시합니다.</span></p></section>
      <section class="db-card sm-card" aria-labelledby="sm-t4"><div class="db-card-head"><h2 id="sm-t4">소부장 기업 목록</h2>
        <div class="sm-tools"><input id="sm-q" type="search" placeholder="기업명·종목코드 검색" aria-label="기업명 또는 종목코드 검색" value="${esc(state.q)}">
        ${chips("sm-mk", [["all", "전체 시장"], ...MK.map(([k, l]) => [k, l])], state.mk)}${chips("sm-kd", [["all", "전체 구분"], ...KINDS.map((k) => [k, k])], state.kind)}</div></div>
        <div id="sm-table">${table(c)}</div></section>
      <details class="db-card sm-card sm-basis"><summary><i class="ph ph-scales" aria-hidden="true"></i>산정 기준과 한계</summary><ul>
        <li><b>대상</b> 반도체 제조공정에 직접 투입되는 소재·부품·장비 기업. 팹리스·설계, 후공정(OSAT)·유통사는 직접 소부장에 자동 포함하지 않습니다.</li>
        <li><b>모집단</b> 사용자가 승인한 목록만 표시합니다. 조건부·간접 공급망·기타 반도체 산업은 별도로 관리하며 이 통계에 합산하지 않습니다.</li>
        <li><b>회사 수·종목 수</b> 기업 수는 법인 기준 중복 제거, 종목 수는 우선주 등 상장증권 단위입니다.</li>
        <li><b>시가총액</b> 기준일·증권유형·출처를 함께 표기합니다. 값이 없으면 0으로 바꾸지 않고 '-'로 둡니다.</li>
        <li><b>한계</b> 시장 기준값은 사용자 제공 KRX 현황이며 독립 검증 전입니다. 코넥스 시총은 별도 원천이 필요합니다.</li></ul></details>`;
    wire();
  }

  function wire() {
    const c = calc();
    const re = () => { const t = $("sm-table"); if (t) t.innerHTML = table(c); };
    const chip = (id, key) => { const g = $(id); if (!g) return; g.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; state[key] = b.dataset.v; g.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); re(); }); };
    chip("sm-mk", "mk"); chip("sm-kd", "kind");
    const q = $("sm-q"); if (q) q.addEventListener("input", () => { state.q = q.value; re(); });
    const t = $("sm-table"); if (t) t.addEventListener("click", (e) => { if (e.target.closest("#sm-more")) { state.all = !state.all; re(); } });
  }

  window.SemiSmeView = { draw };
})();
