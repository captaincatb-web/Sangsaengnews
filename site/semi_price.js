/* 국내 반도체 소부장 주가 추이(#sm-price): 최근 3년 분기 말 동일가중 지수(전체·소재·부품·장비)와 코스피·코스닥 비교, 기업별 표.
   데이터는 data/semi_price.js(검토용). 결측은 채우지 않고 '-'로 둔다. 지수 산식·기준일·산출 기업 수를 화면에서 확인할 수 있게 한다. */
(function () {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = (v, d = 0) => (v == null || !isFinite(v) ? "-" : v.toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pc = (v, d = 1) => (v == null || !isFinite(v) ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
  const tone = (v) => (v == null ? "" : v > 0 ? "up" : v < 0 ? "dn" : "");
  const ql = (d) => { const [y, m] = d.split("-"); return `'${y.slice(2)}.${Math.ceil(+m / 3)}Q`; };
  const SERIES = [["전체", "전체 소부장", "var(--text)", ""], ["소재", "소재", "var(--blue)", ""], ["부품", "부품", "var(--teal)", ""], ["장비", "장비", "var(--orange)", ""], ["KOSPI", "코스피", "var(--text-3)", "5 4"], ["KOSDAQ", "코스닥", "var(--purple)", "5 4"]];
  const MKT = { KOSPI: "코스피", KOSDAQ: "코스닥", KONEX: "코넥스" };
  const st = { hide: new Set(), pin: null, kind: "all", mk: "all", q: "", sort: "cum", dir: -1, co: null };
  const D = () => window.SEMI_PRICE || { status: "pending", companies: [] };

  function seriesData() {
    const d = D(), out = {};
    ["전체", "소재", "부품", "장비"].forEach((g) => { const s = d.indices && d.indices[g]; if (s) out[g] = s.series.map((p) => ({ date: p.date, v: p.index, n: p.n, qoq: p.qoq, cum: p.cum })); });
    ["KOSPI", "KOSDAQ"].forEach((g) => { const b = d.benchmarks && d.benchmarks[g]; if (b && b.series) { let prev = null; out[g] = b.series.map((p) => { const r = { date: p.date, v: p.index, n: null, qoq: prev == null || p.index == null ? null : (p.index / prev - 1) * 100, cum: p.index == null ? null : p.index - 100 }; prev = p.index; return r; }); } });
    return out;
  }
  function ticks(a, b, n) { const raw = (b - a) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag, step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag, out = []; for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(6)); return out; }

  function chart(S, qs) {
    const W = 720, H = 340, L = 46, R = 28, T = 14, B = 34, pw = W - L - R, ph = H - T - B;
    const vis = SERIES.filter(([k]) => S[k] && !st.hide.has(k));
    const vals = vis.flatMap(([k]) => S[k].map((p) => p.v).filter((v) => v != null));
    if (!vals.length) return `<p class="sm-empty"><i class="ph ph-chart-line" aria-hidden="true"></i>표시할 계열이 없습니다. 범례에서 계열을 켜 주세요.</p>`;
    const lo = Math.min(100, ...vals), hi = Math.max(100, ...vals), pad = (hi - lo) * 0.08 || 5, y0 = lo - pad, y1 = hi + pad;
    const x = (i) => L + (qs.length === 1 ? pw / 2 : (i / (qs.length - 1)) * pw), y = (v) => T + ph - ((v - y0) / (y1 - y0)) * ph;
    let g = ticks(y0, y1, 5).map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${nf(t)}</text>`).join("");
    g += `<line x1="${L}" x2="${W - R}" y1="${y(100)}" y2="${y(100)}" stroke="var(--text-3)" stroke-dasharray="2 3"/>`;
    qs.forEach((q, i) => { if (qs.length <= 8 || i % 2 === 0 || i === qs.length - 1) g += `<text class="ax" x="${x(i)}" y="${H - 12}" text-anchor="middle">${ql(q)}</text>`; });
    const lines = vis.map(([k, , col, dash]) => {
      const pts = S[k].map((p, i) => (p.v == null ? null : [x(i), y(p.v)]));
      let d = "", pen = false; pts.forEach((p) => { if (!p) { pen = false; return; } d += `${pen ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)} `; pen = true; });
      const dots = pts.map((p, i) => (p ? `<circle class="dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${st.pin === i ? 4.5 : 3}" fill="${col}"/>` : "")).join("");
      return `<g class="ln" data-k="${k}"><path d="${d}" fill="none" stroke="${col}" stroke-width="${k === "전체" ? 2.8 : 2}"${dash ? ` stroke-dasharray="${dash}"` : ""} stroke-linejoin="round" stroke-linecap="round" pathLength="1"/>${dots}</g>`;
    }).join("");
    const slots = qs.map((q, i) => `<g class="slot" data-i="${i}" tabindex="0" role="button" aria-label="${ql(q)} 지수 보기"><rect class="colbg" x="${x(i) - pw / (qs.length * 2)}" y="${T}" width="${pw / qs.length}" height="${ph}"/><rect class="hit" x="${x(i) - pw / (qs.length * 2)}" y="${T}" width="${pw / qs.length}" height="${ph}" fill="transparent"/></g>`).join("");
    return `<svg class="sp-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="소부장 동일가중 주가 지수 추이(기준일 100)">${g}${lines}${slots}</svg>`;
  }

  function strip(S, qs) {
    const i = st.pin != null ? st.pin : qs.length - 1;
    const rows = SERIES.filter(([k]) => S[k]).map(([k, nm, col]) => { const p = S[k][i]; return `<li class="${st.hide.has(k) ? "off" : ""}"><i class="sq" style="background:${col}"></i><span>${nm}</span><b>${p && p.v != null ? nf(p.v, 1) : "-"}</b><em class="${tone(p && p.qoq)}">${p ? pc(p.qoq) : "-"}</em></li>`; }).join("");
    return `<div class="sp-strip${st.pin != null ? " pinned" : ""}" id="sp-strip"><strong>${ql(qs[i])} 분기 말 <small>${esc(qs[i])}${st.pin != null ? " · 고정(다시 누르면 해제)" : " · 최근 값"}</small></strong><ul>${rows}</ul><p>지수=기준일 100 · 오른쪽 숫자는 직전 분기 대비</p></div>`;
  }

  function quarterTable(S, qs) {
    const rows = qs.map((q, i) => `<tr class="${st.pin === i ? "sel" : ""}" data-i="${i}"><th scope="row">${ql(q)}<small>${esc(q)}</small></th>${["전체", "소재", "부품", "장비", "KOSPI", "KOSDAQ"].map((k) => { const p = S[k] && S[k][i]; return `<td>${p && p.v != null ? nf(p.v, 1) : "-"}<small class="${tone(p && p.qoq)}">${p && i ? pc(p.qoq) : ""}</small></td>`; }).join("")}<td>${S["전체"] && S["전체"][i] ? nf(S["전체"][i].n) : "-"}</td><td class="${tone(S["전체"] && S["전체"][i] && S["전체"][i].cum)}">${S["전체"] && S["전체"][i] ? pc(S["전체"][i].cum) : "-"}</td></tr>`).join("");
    return `<div class="sm-scroll"><table class="sm-share sp-qt"><thead><tr><th>분기 말</th><th>전체 소부장</th><th>소재</th><th>부품</th><th>장비</th><th>코스피</th><th>코스닥</th><th>산출 기업 수</th><th>누적(전체)</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function companyRows() {
    const d = D(), qs = (d.meta && d.meta.quarters) || [], first = qs[0], last = qs[qs.length - 1], prev = qs[qs.length - 2];
    return (d.companies || []).map((c) => {
      const b = c.q[first], l = c.q[last], p = c.q[prev];
      return { c, b, l, cum: b != null && l != null ? (l / b - 1) * 100 : null, qoq: p != null && l != null ? (l / p - 1) * 100 : null, state: c.ok.all ? "3년 전체" : c.ok.base ? `일부 결측 ${c.ok.miss.length}분기` : "기준일 없음" };
    });
  }
  function companyTable() {
    let rows = companyRows().filter((r) => (st.kind === "all" || r.c.kind === st.kind) && (st.mk === "all" || r.c.market === st.mk) && (!st.q || (r.c.name + r.c.code).toLowerCase().includes(st.q.toLowerCase())));
    const key = { name: (r) => r.c.name, cum: (r) => r.cum, qoq: (r) => r.qoq, kind: (r) => r.c.kind, last: (r) => r.l };
    rows.sort((a, b) => { const x = key[st.sort](a), y = key[st.sort](b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(y, "ko") : x - y) * st.dir; });
    const th = (k, l) => `<th class="${st.sort === k ? "srt" : ""}"><button type="button" data-sort="${k}" aria-label="${l} 정렬">${l}${st.sort === k ? (st.dir > 0 ? " ▲" : " ▼") : ""}</button></th>`;
    return `<div class="sm-scroll"><table class="sm-co sp-co"><thead><tr>${th("name", "기업명")}<th>종목코드</th>${th("kind", "구분")}<th>시장</th><th class="r">기준일 주가</th>${th("last", "최신 주가")}${th("cum", "3년 누적")}${th("qoq", "최근 분기")}<th>데이터 상태</th></tr></thead><tbody>${rows.map((r, i) => `<tr style="--i:${Math.min(i, 24)}"><td><button type="button" class="sp-name" data-spco="${esc(r.c.code)}">${esc(r.c.name)}</button></td><td class="code">${esc(r.c.code)}</td><td>${r.c.kind}</td><td>${MKT[r.c.market] || r.c.market}</td><td class="r">${r.b != null ? nf(r.b) : "-"}</td><td class="r">${r.l != null ? nf(r.l) : "-"}</td><td class="r ${tone(r.cum)}">${pc(r.cum)}</td><td class="r ${tone(r.qoq)}">${pc(r.qoq)}</td><td><span class="sm-badge ${r.c.ok.all ? "확정" : r.c.ok.base ? "보류" : ""}">${r.state}</span></td></tr>`).join("")}</tbody></table></div><p class="sm-count">${nf(rows.length)}곳 표시 · 가격은 분할 반영 종가(원), 결측은 '-'</p>`;
  }

  function companyChart() {
    const d = D(), c = (d.companies || []).find((x) => x.code === st.co); if (!c) return "";
    const qs = d.meta.quarters, vals = qs.map((q) => c.q[q]), base = vals[0];
    const W = 520, H = 200, L = 46, R = 26, T = 12, B = 28, pw = W - L - R, ph = H - T - B, nn = vals.filter((v) => v != null);
    if (!nn.length) return `<section class="db-card sm-card"><p class="sm-empty">${esc(c.name)}: 수집된 분기 말 가격이 없습니다.</p></section>`;
    const lo = Math.min(...nn), hi = Math.max(...nn), pad = (hi - lo) * 0.1 || hi * 0.05, y0 = lo - pad, y1 = hi + pad, x = (i) => L + (i / (qs.length - 1)) * pw, y = (v) => T + ph - ((v - y0) / (y1 - y0)) * ph;
    let dd = "", pen = false; vals.forEach((v, i) => { if (v == null) { pen = false; return; } dd += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; pen = true; });
    const gr = ticks(y0, y1, 4).map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${nf(t)}</text>`).join("");
    const xl = qs.map((q, i) => (i % 2 === 0 || i === qs.length - 1 ? `<text class="ax" x="${x(i)}" y="${H - 8}" text-anchor="middle">${ql(q)}</text>` : "")).join("");
    const pts = vals.map((v, i) => (v == null ? "" : `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="var(--brand)"><title>${ql(qs[i])} ${nf(v)}원</title></circle>`)).join("");
    const cum = base != null && vals[vals.length - 1] != null ? (vals[vals.length - 1] / base - 1) * 100 : null;
    return `<section class="db-card sm-card sp-co-card" aria-labelledby="sp-cot"><div class="db-card-head"><h2 id="sp-cot">${esc(c.name)} <small>${esc(c.code)} · ${c.kind} · ${MKT[c.market] || c.market} · 3년 누적 <b class="${tone(cum)}">${pc(cum)}</b></small></h2><button type="button" class="sm-chip" id="sp-co-x">닫기</button></div>
      <svg class="sp-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.name)} 분기 말 주가">${gr}${xl}<path d="${dd}" fill="none" stroke="var(--brand)" stroke-width="2.4" stroke-linejoin="round"/>${pts}</svg>
      <p class="db-note"><i class="ph ph-info" aria-hidden="true"></i><span>${c.ok.miss.length ? `결측 분기 ${c.ok.miss.map(ql).join(", ")}(채우지 않음). ` : ""}출처 ${esc(c.src || "-")}${c.ok.splits ? ` · 주식분할 ${c.ok.splits}건 반영` : ""}${c.ok.xchk != null ? ` · 네이버와 최대 차이 ${c.ok.xchk}%` : ""}</span></p></section>`;
  }

  function csv() {
    const d = D(), qs = (d.meta && d.meta.quarters) || [], S = seriesData();
    const a = [["기업명", "종목코드", "구분", "시장", "출처", ...qs, "3년 누적(%)"]];
    companyRows().forEach((r) => a.push([r.c.name, r.c.code, r.c.kind, r.c.market, r.c.src || "", ...qs.map((q) => (r.c.q[q] == null ? "" : r.c.q[q])), r.cum == null ? "" : r.cum.toFixed(2)]));
    a.push([]); a.push(["지수", "", "", "", "", ...qs, ""]);
    SERIES.forEach(([k, nm]) => { if (S[k]) a.push([nm, "", "", "", "", ...S[k].map((p) => (p.v == null ? "" : p.v.toFixed(2))), ""]); });
    const text = "﻿" + a.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })), el = document.createElement("a");
    el.href = url; el.download = `semi_stock_price_${(d.meta.base_end || "").replace(/-/g, "")}.csv`; document.body.appendChild(el); el.click(); el.remove(); URL.revokeObjectURL(url);
  }

  function draw(root) {
    const d = D();
    if (d.status === "pending" || !(d.companies || []).length) {
      root.innerHTML = `<section class="db-card sm-card"><p class="sm-empty"><i class="ph ph-hourglass-medium" aria-hidden="true"></i>주가 추이 데이터가 아직 없습니다. 수집·지수 산출이 끝나면 이 화면이 채워집니다.</p></section>`; return;
    }
    const S = seriesData(), qs = d.meta.quarters, sm = d.summary || {}, N = sm.members || d.companies.length;
    const rate = N ? (sm.with_all_quarters / N) * 100 : null, latest = qs[qs.length - 1];
    root.innerHTML = `
      <p class="sm-disc" role="note"><i class="ph ph-warning" aria-hidden="true"></i><span>본 분석은 현재 검토 중인 ${nf(N)}개사를 대상으로 산출한 참고용 주가 지수입니다. 기업 모집단 및 소재·부품·장비 분류가 최종 확정되지 않았으며, 과거 상장폐지 기업이 포함되지 않아 생존 편향이 존재할 수 있습니다. 실제 산업 전체의 시장 성과를 대표하는 공식 지표가 아닙니다.</span></p>
      <section class="db-kpis sm-kpis sp-kpis" aria-label="주가 데이터 현황">
        <article class="db-kpi sm-kpi"><p class="lab"><i class="ph ph-buildings" aria-hidden="true"></i>분석 대상</p><strong>${nf(N)}<small>개사</small></strong><p class="delta">검토용 목록</p></article>
        <article class="db-kpi sm-kpi"><p class="lab"><i class="ph ph-database" aria-hidden="true"></i>기준일 주가 확보</p><strong>${nf(sm.with_base)}<small>개사</small></strong><p class="delta">지수 산출 바스켓(고정)</p></article>
        <article class="db-kpi sm-kpi"><p class="lab"><i class="ph ph-seal-check" aria-hidden="true"></i>3년 전체 확보</p><strong>${nf(sm.with_all_quarters)}<small>개사</small></strong><p class="delta">확보율 ${rate == null ? "-" : rate.toFixed(1) + "%"}</p></article>
        <article class="db-kpi sm-kpi"><p class="lab"><i class="ph ph-calendar-blank" aria-hidden="true"></i>분석 기간</p><strong class="sm-sm">${ql(qs[0])}~${ql(latest)}</strong><p class="delta">${esc(qs[0])} ~ ${esc(latest)}</p></article>
        <article class="db-kpi sm-kpi"><p class="lab"><i class="ph ph-clock" aria-hidden="true"></i>최신 기준일</p><strong class="sm-sm">${esc(latest)}</strong><p class="delta">최신 완결 분기 말</p></article>
        <article class="db-kpi sm-kpi"><p class="lab"><i class="ph ph-chart-line-up" aria-hidden="true"></i>전체 소부장 누적</p><strong class="${tone(S["전체"] && S["전체"][qs.length - 1].cum)}">${S["전체"] ? pc(S["전체"][qs.length - 1].cum) : "-"}</strong><p class="delta">동일가중 · 기준일 100</p></article>
      </section>
      <section class="db-card sm-card" aria-labelledby="sp-t1"><div class="db-card-head"><h2 id="sp-t1">주가 지수 추이 <small>분기 말 · 기준일 100 · 동일가중</small></h2><div class="sp-leg" id="sp-leg" role="group" aria-label="표시 계열">${SERIES.filter(([k]) => S[k]).map(([k, nm, col, dash]) => `<button type="button" class="sp-lg" data-k="${k}" aria-pressed="${!st.hide.has(k)}"><i class="sq" style="background:${col}${dash ? ";opacity:.7" : ""}"></i>${nm}</button>`).join("")}</div></div>
        <div id="sp-strip-wrap">${strip(S, qs)}</div><div id="sp-chart">${chart(S, qs)}</div></section>
      <section class="db-card sm-card" aria-labelledby="sp-t2"><div class="db-card-head"><h2 id="sp-t2">분기별 성과 비교</h2><button type="button" class="sm-chip sp-dl" id="sp-dl"><i class="ph ph-download-simple" aria-hidden="true"></i>CSV 내려받기</button></div><div id="sp-qt">${quarterTable(S, qs)}</div></section>
      <section class="db-card sm-card" aria-labelledby="sp-t3"><div class="db-card-head"><h2 id="sp-t3">기업별 주가</h2><div class="sm-tools"><input id="sp-q" type="search" placeholder="기업명·종목코드 검색" aria-label="기업명 또는 종목코드 검색" value="${esc(st.q)}">${["all|전체 구분", "소재|소재", "부품|부품", "장비|장비"].map((s) => { const [v, l] = s.split("|"); return `<button type="button" class="sm-chip" data-kd="${v}" aria-pressed="${st.kind === v}">${l}</button>`; }).join("")}${["all|전체 시장", "KOSPI|코스피", "KOSDAQ|코스닥", "KONEX|코넥스"].map((s) => { const [v, l] = s.split("|"); return `<button type="button" class="sm-chip" data-mk="${v}" aria-pressed="${st.mk === v}">${l}</button>`; }).join("")}</div></div><div id="sp-co-chart">${companyChart()}</div><div id="sp-table">${companyTable()}</div></section>
      <details class="db-card sm-card sm-basis"><summary><i class="ph ph-scales" aria-hidden="true"></i>산출 기준·출처·결측 처리</summary><ul>
        <li><b>가격</b> ${esc(d.meta.price_basis || "")}</li><li><b>지수</b> ${esc(d.meta.index_method || "")}</li>
        <li><b>출처</b> ${esc((d.meta.source) || "-")} · 수집 ${esc(d.meta.collected_note || "-")}</li>
        <li><b>산출 기업 수</b> 전체 ${nf(d.indices["전체"] && d.indices["전체"].basket_n)} · 소재 ${nf(d.indices["소재"] && d.indices["소재"].basket_n)} · 부품 ${nf(d.indices["부품"] && d.indices["부품"].basket_n)} · 장비 ${nf(d.indices["장비"] && d.indices["장비"].basket_n)}곳(기준일에 가격이 있는 기업으로 고정). 기준일 가격이 없어 제외: ${nf(((d.indices["전체"] || {}).excluded_no_base || []).length)}곳</li>
        <li><b>결측</b> 임의로 채우지 않고 해당 분기 산출 기업 수(n)에서 빠집니다. 신규상장 기업은 기준일 이전으로 소급 편입하지 않습니다.</li>
        <li><b>한계</b> ${esc(d.meta.survivorship_note || "")} 과거 시가총액은 당시 상장주식 수가 확인되어야 해서 이번에는 만들지 않았습니다.</li></ul></details>`;
    wire(root, S, qs);
  }

  function wire(root, S, qs) {
    const redraw = () => { root.querySelector("#sp-chart").innerHTML = chart(S, qs); root.querySelector("#sp-strip-wrap").innerHTML = strip(S, qs); root.querySelector("#sp-qt").innerHTML = quarterTable(S, qs); root.querySelectorAll(".sp-lg").forEach((b) => b.setAttribute("aria-pressed", !st.hide.has(b.dataset.k))); };
    const tbl = () => { root.querySelector("#sp-table").innerHTML = companyTable(); root.querySelector("#sp-co-chart").innerHTML = companyChart(); };
    root.addEventListener("click", (e) => {
      const lg = e.target.closest(".sp-lg"); if (lg) { st.hide.has(lg.dataset.k) ? st.hide.delete(lg.dataset.k) : st.hide.add(lg.dataset.k); return redraw(); }
      const sl = e.target.closest("#sp-chart .slot"); if (sl) { const i = +sl.dataset.i; st.pin = st.pin === i ? null : i; return redraw(); }
      const row = e.target.closest("#sp-qt tr[data-i]"); if (row) { const i = +row.dataset.i; st.pin = st.pin === i ? null : i; return redraw(); }
      const kd = e.target.closest("[data-kd]"); if (kd) { st.kind = kd.dataset.kd; root.querySelectorAll("[data-kd]").forEach((b) => b.setAttribute("aria-pressed", b === kd)); return tbl(); }
      const mk = e.target.closest("[data-mk]"); if (mk) { st.mk = mk.dataset.mk; root.querySelectorAll("[data-mk]").forEach((b) => b.setAttribute("aria-pressed", b === mk)); return tbl(); }
      const so = e.target.closest("[data-sort]"); if (so) { const k = so.dataset.sort; st.dir = st.sort === k ? -st.dir : (k === "name" || k === "kind" ? 1 : -1); st.sort = k; return tbl(); }
      const co = e.target.closest("[data-spco]"); if (co) { st.co = co.dataset.spco; return tbl(); }
      if (e.target.closest("#sp-co-x")) { st.co = null; return tbl(); }
      if (e.target.closest("#sp-dl")) return csv();
    });
    root.addEventListener("keydown", (e) => { const sl = e.target.closest && e.target.closest("#sp-chart .slot"); if (sl && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); const i = +sl.dataset.i; st.pin = st.pin === i ? null : i; redraw(); } });
    root.addEventListener("mouseover", (e) => { const sl = e.target.closest("#sp-chart .slot"); if (!sl || st.pin != null) return; const i = +sl.dataset.i; const w = root.querySelector("#sp-strip-wrap"); const old = st.pin; st.pin = i; w.innerHTML = strip(S, qs); st.pin = old; const s = w.querySelector(".sp-strip"); if (s) s.classList.remove("pinned"); });
    root.addEventListener("mouseout", (e) => { if (e.target.closest && e.target.closest("#sp-chart .slot") && st.pin == null) root.querySelector("#sp-strip-wrap").innerHTML = strip(S, qs); });
    const q = root.querySelector("#sp-q"); if (q) q.addEventListener("input", () => { st.q = q.value; tbl(); });
  }

  window.SemiPriceView = { draw };
})();
