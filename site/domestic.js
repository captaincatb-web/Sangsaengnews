/* 국내 소부장 실적 화면: 대시보드와 같은 데이터·산식(metrics.js)으로 매출·영업이익·영업이익률을 업종·규모·기업별로 정리한다.
   공시에 없는 값은 만들지 않고 '-'와 이유로 둔다. 숫자에 올리면(누르면) 출처가 보인다. */
(function () {
  "use strict";
  const SB = window.SB, { esc } = SB.fmt, { med, sum, growth, share } = SB.math;
  const $ = (id) => document.getElementById(id);
  const st = { ...SB.DEFAULTS, ...SB.fromQuery(location.search), sort: { k: "s1", d: -1 }, q: "", more: false };

  // ---------- 표기 ----------
  const nf = (v, d = 0) => v.toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const won = (v) => (v == null ? null : Math.abs(v) >= 10000 ? `${nf(v / 10000, 1)}조` : `${nf(v)}억`);
  const pct = (v, d = 1) => (v == null || !isFinite(v) ? null : `${v < 0 ? "▼ " : ""}${nf(v, d)}%`);
  const sgn = (v, d = 1) => (v == null || !isFinite(v) ? null : `${v > 0 ? "▲ +" : v < 0 ? "▼ " : ""}${nf(v, d)}%`);
  const ppp = (v) => (v == null || !isFinite(v) ? null : Math.abs(v) < 0.05 ? "보합" : `${v > 0 ? "▲ +" : "▼ "}${nf(v, 1)}%p`);
  const NA = (why) => `<span class="cm-na" tabindex="0" data-src="확인 필요 · ${esc(why)}">-</span>`;
  const V = (text, src) => (text == null ? null : `<span class="cm-n" tabindex="0" data-src="${esc(src)}">${text}</span>`);
  const cell = (text, src, why) => V(text, src) || NA(why);
  const doc = (r) => (r.src === "감사보고서" ? "DART 감사보고서 원문(개별 재무제표)" : "DART 사업보고서 개별재무제표(OpenDART API)");
  const src = (r, y, what) => `${r.n} ${y}년 ${what} · ${doc(r)} · 쪽 번호 없음(공시 API 값)`;
  const srcAgg = (n, y, what) => `${n}곳 ${y}년 ${what} · DART 사업·감사보고서 개별재무제표 합산(대시보드와 같은 산식)`;

  // ---------- 필터 ----------
  const fill = (id, opts, val) => ($(id).innerHTML = opts.map(([v, l]) => `<option value="${v}"${String(v) === String(val) ? " selected" : ""}>${l}</option>`).join(""));
  function drawFilters() {
    fill("f-fy", [SB.DEFAULT_FY, SB.DEFAULT_FY - 1].map((y) => [y, `${y}년`]), st.fy);
    fill("f-kind", [["all", "전체"], ...SB.KINDS.map((k) => [k, k])], st.kind);
    fill("f-listed", [["all", "전체"], ["1", "상장"], ["0", "비상장"]], st.listed);
    fill("f-size", [["all", "전체"], ...window.SIZE_TIERS.map((s) => [s, s])], st.size);
    fill("f-big", [["include", "포함(기본)"], ["exclude", "제외"], ["only", "대형사만"]], st.big);
  }
  const IDS = { "f-fy": "fy", "f-kind": "kind", "f-listed": "listed", "f-size": "size", "f-big": "big" };
  $("filters").addEventListener("change", (e) => {
    const k = IDS[e.target.id]; if (!k) return;
    st[k] = k === "fy" ? Number(e.target.value) : e.target.value;
    if (k === "size" && st.size === "1조 이상" && st.big === "exclude") st.big = "include";
    if (k === "big" && st.big === "exclude" && st.size === "1조 이상") st.size = "all";
    st.more = false; drawFilters(); render();
  });
  $("filters").addEventListener("reset", (e) => { e.preventDefault(); Object.assign(st, SB.DEFAULTS, { more: false }); drawFilters(); render(); });
  $("filter-toggle").addEventListener("click", () => { const o = $("filters").classList.toggle("open"); $("filter-toggle").setAttribute("aria-expanded", o); });

  // ---------- 집계 ----------
  // 합계 기준 이익률: 영업이익이 있는 기업만(매출·영업이익 모두 같은 기업)
  function agg(rows) {
    const op = rows.filter((r) => r.o1 != null), op0 = rows.filter((r) => r.o0 != null && r.s0 > 0);
    const s1 = sum(rows.map((r) => r.s1)), s0 = sum(rows.map((r) => r.s0)), o1 = sum(op.map((r) => r.o1)), o0 = sum(op.map((r) => r.o0 || 0));
    const m = share(o1, sum(op.map((r) => r.s1))), m0 = share(sum(op0.map((r) => r.o0)), sum(op0.map((r) => r.s0)));
    return { n: rows.length, s1, s0, g: growth(s1, s0), o1, o0, og: o0 > 0 ? growth(o1, o0) : null, m, m0, dm: m != null && m0 != null ? m - m0 : null,
      medM: med(rows.map((r) => r.m)), medG: med(rows.map((r) => r.g)), loss: op.filter((r) => r.o1 < 0).length, nOp: op.length,
      profitP: share(op.filter((r) => r.o1 > 0).length, op.length) };
  }

  // ---------- 그리기 ----------
  const kpi = (icon, lab, val, sub) => `<article class="db-kpi"><p class="lab"><i class="ph ${icon}" aria-hidden="true"></i>${lab}</p><strong>${val}</strong><p class="delta"><span class="vs">${sub}</span></p></article>`;
  function bars(items, fmt) {
    const vals = items.filter((i) => i.v != null).map((i) => i.v);
    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1, z = ((0 - lo) / span) * 100;
    return `<ul class="cm-bars">${items.map((i) => {
      const left = i.v == null ? 0 : ((Math.min(i.v, 0) - lo) / span) * 100, w = i.v == null ? 0 : (Math.abs(i.v) / span) * 100;
      return `<li><span class="nm">${i.link || esc(i.name)}<small>${esc(i.tag || "")}</small></span><span class="trk"><i class="zero" style="left:${z}%"></i>${i.v == null ? "" : `<span class="bar ${i.v < 0 ? "neg" : ""}" style="left:${left}%;width:${Math.max(w, 0.8)}%"></span>`}</span><b>${i.v == null ? NA(i.why || "값 없음") : V(fmt(i.v), i.src)}${i.extra ? `<small class="dm-x">${i.extra}</small>` : ""}</b></li>`;
    }).join("")}</ul>`;
  }
  const coLink = (r) => `<a href="dashboard.html?co=${encodeURIComponent(r.c)}#company">${esc(r.n)}</a>`;

  function summary(rows, fy) {
    const A = agg(rows);
    $("headline").innerHTML = `${fy}년 국내 소부장 ${A.n}곳 매출은 <b>${won(A.s1)}</b>(${sgn(A.g) || "-"}), 영업이익은 <b>${won(A.o1)}</b>(${sgn(A.og) || "-"})이고, 영업이익률은 <b>${pct(A.m) || "-"}</b>로 전년보다 <b>${ppp(A.dm) || "-"}</b>입니다. 적자 기업은 ${A.loss}곳입니다.`;
    $("kpis").innerHTML = [
      kpi("ph-chart-bar", "매출 합계", V(won(A.s1), srcAgg(A.n, fy, "매출 합계")) || "-", `전년 대비 ${sgn(A.g) || "-"}`),
      kpi("ph-coins", "영업이익 합계", V(won(A.o1), srcAgg(A.nOp, fy, "영업이익 합계")) || "-", `전년 대비 ${sgn(A.og) || "계산 불가(전년 적자)"}`),
      kpi("ph-percent", "영업이익률 (합계 기준)", V(pct(A.m), srcAgg(A.nOp, fy, "영업이익 합계 ÷ 매출 합계")) || "-", `전년 대비 ${ppp(A.dm) || "-"} · 중앙값 ${pct(A.medM) || "-"}`),
      kpi("ph-scales", "흑자 기업 비율", `${pct(A.profitP, 0) || "-"}`, `적자 ${A.loss}곳 / 영업이익 확인 ${A.nOp}곳`),
    ].join("");
    // 3개년: 세 해 모두 매출이 있는 같은 기업
    const same = rows.filter((r) => r.s2 > 0), ys = [fy - 2, fy - 1, fy];
    const S = [sum(same.map((r) => r.s2)), sum(same.map((r) => r.s0)), sum(same.map((r) => r.s1))];
    const opSame = same.filter((r) => r.o2 != null && r.o0 != null && r.o1 != null);
    const O = [sum(opSame.map((r) => r.o2)), sum(opSame.map((r) => r.o0)), sum(opSame.map((r) => r.o1))];
    const OS = [sum(opSame.map((r) => r.s2)), sum(opSame.map((r) => r.s0)), sum(opSame.map((r) => r.s1))];
    const M = O.map((o, i) => share(o, OS[i]));
    const td = (t, s, w) => `<td>${cell(t, s, w)}</td>`;
    $("trend-sub").textContent = `세 해 모두 공시한 같은 ${same.length}곳 기준(영업이익은 ${opSame.length}곳)`;
    $("c-trend").innerHTML = `<table class="db-tbl cm-tbl"><thead><tr><th class="l">구분</th>${ys.map((y) => `<th>${y}년</th>`).join("")}<th>전년 대비</th></tr></thead><tbody>
      <tr><th scope="row" class="l">매출</th>${S.map((v, i) => td(won(v), srcAgg(same.length, ys[i], "매출 합계"), "공시 없음")).join("")}<td>${sgn(growth(S[2], S[1])) || "-"}</td></tr>
      <tr><th scope="row" class="l">영업이익</th>${O.map((v, i) => td(won(v), srcAgg(opSame.length, ys[i], "영업이익 합계"), "공시 없음")).join("")}<td>${O[1] > 0 ? sgn(growth(O[2], O[1])) : "계산 불가"}</td></tr>
      <tr><th scope="row" class="l">영업이익률</th>${M.map((v, i) => td(pct(v), srcAgg(opSame.length, ys[i], "영업이익률(합계 기준)"), "계산 불가")).join("")}<td>${ppp(M[2] - M[1]) || "-"}</td></tr>
      <tr><th scope="row" class="l">영업이익률 중앙값</th>${[same.map((r) => (r.o2 != null && r.s2 > 0 ? (r.o2 / r.s2) * 100 : null)), same.map((r) => r.m0), same.map((r) => r.m)].map((a, i) => td(pct(med(a)), `${same.length}곳 ${ys[i]}년 기업별 영업이익률의 중앙값`, "계산 불가")).join("")}<td>-</td></tr>
    </tbody></table>`;
    const big = rows.filter((r) => r.s1 >= 100);
    const top = (key, fmt, what) => bars(big.filter((r) => r[key] != null).sort((a, b) => b[key] - a[key]).slice(0, 10).map((r) => ({ link: coLink(r), name: r.n, tag: r.kind, v: r[key], src: src(r, fy, what), extra: won(r.s1) })), fmt);
    $("c-topm").innerHTML = top("m", (v) => pct(v), "영업이익률(영업이익÷매출)");
    $("c-topg").innerHTML = top("g", (v) => sgn(v), "매출 증감률(전년 대비)");
  }

  function groupTable(groups, rowsOf, fy, label) {
    const head = `<thead><tr><th class="l">${label}</th><th>기업 수</th><th>매출 합계</th><th>매출 증감률</th><th>영업이익 합계</th><th>영업이익 증감률</th><th>영업이익률<small>합계 기준</small></th><th>전년 대비</th><th>영업이익률<small>중앙값</small></th><th>적자 기업</th></tr></thead>`;
    const body = groups.map((g) => {
      const R = rowsOf(g); if (!R.length) return "";
      const A = agg(R), S = (w) => srcAgg(A.n, fy, `${g} ${w}`);
      return `<tr><th scope="row" class="l">${esc(g)}</th><td>${A.n}곳</td><td>${cell(won(A.s1), S("매출 합계"), "-")}</td><td>${cell(sgn(A.g), S("매출 증감률"), "전년 매출 없음")}</td><td>${cell(won(A.o1), S("영업이익 합계"), "-")}</td><td>${cell(sgn(A.og), S("영업이익 증감률"), "전년 영업이익이 0 이하라 계산 불가")}</td><td>${cell(pct(A.m), S("영업이익률(합계)"), "-")}</td><td>${ppp(A.dm) || "-"}</td><td>${cell(pct(A.medM), S("영업이익률 중앙값"), "-")}</td><td>${A.loss ? `▼ ${A.loss}곳` : "없음"}</td></tr>`;
    }).join("");
    return `<table class="db-tbl cm-tbl">${head}<tbody>${body}</tbody></table>`;
  }
  function group(rows, fy) {
    const kinds = SB.KINDS.filter((k) => rows.some((r) => r.kind === k)), sizes = window.SIZE_TIERS.filter((t) => rows.some((r) => r.tier === t));
    $("c-kind").innerHTML = groupTable([...kinds, "전체"], (k) => (k === "전체" ? rows : rows.filter((r) => r.kind === k)), fy, "업종");
    $("c-size").innerHTML = groupTable([...sizes, "전체"], (t) => (t === "전체" ? rows : rows.filter((r) => r.tier === t)), fy, "매출 규모");
    // 세부업종(분류표에 있는 기업만): 기업 수 많은 순
    const subs = [...new Set(rows.map((r) => r.sub).filter(Boolean))].map((x) => [x, rows.filter((r) => r.sub === x)]).sort((a, b) => b[1].length - a[1].length);
    const noSub = rows.filter((r) => !r.sub).length;
    $("c-sub").innerHTML = subs.length ? groupTable(subs.map((x) => x[0]), (x) => rows.filter((r) => r.sub === x), fy, "세부업종") + (noSub ? `<p class="db-note"><i class="ph ph-info" aria-hidden="true"></i><span>세부업종이 아직 분류되지 않은 ${noSub}곳은 이 표에서 뺐습니다.</span></p>` : "") : `<p class="db-note"><i class="ph ph-info" aria-hidden="true"></i><span>세부업종 분류가 없습니다.</span></p>`;
    const bar = (list, of) => bars(list.map((g) => { const A = agg(of(g)); return { name: g, tag: `${A.n}곳`, v: A.m, src: srcAgg(A.nOp, fy, `${g} 영업이익률(합계)`), extra: `전년 대비 ${ppp(A.dm) || "-"}`, why: "영업이익 공시 기업 없음" }; }), (v) => pct(v));
    $("c-kindbar").innerHTML = bar(kinds, (k) => rows.filter((r) => r.kind === k));
    $("c-sizebar").innerHTML = bar(sizes, (t) => rows.filter((r) => r.tier === t));
  }

  // 기업별 표
  const COLS = (fy) => [
    { k: "n", t: "기업", l: 1, f: (r) => coLink(r) }, { k: "kind", t: "업종", l: 1, f: (r) => `${esc(r.kind)}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}` }, { k: "l", t: "상장", f: (r) => (r.l ? "상장" : "비상장") },
    { k: "s2", t: `매출<small>${fy - 2}</small>`, f: (r) => cell(won(r.s2), src(r, fy - 2, "매출"), "해당 연도 공시 없음") },
    { k: "s0", t: `매출<small>${fy - 1}</small>`, f: (r) => cell(won(r.s0), src(r, fy - 1, "매출"), "해당 연도 공시 없음") },
    { k: "s1", t: `매출<small>${fy}</small>`, f: (r) => cell(won(r.s1), src(r, fy, "매출"), "해당 연도 공시 없음") },
    { k: "g", t: "매출<small>증감률</small>", f: (r) => cell(sgn(r.g), src(r, fy, "매출 증감률(전년 대비)"), "전년 매출 없음") },
    { k: "o0", t: `영업이익<small>${fy - 1}</small>`, f: (r) => cell(won(r.o0), src(r, fy - 1, "영업이익"), "영업이익 공시 없음") },
    { k: "o1", t: `영업이익<small>${fy}</small>`, f: (r) => cell(won(r.o1), src(r, fy, "영업이익"), "영업이익 공시 없음(감사보고서에 항목 없음 등)") },
    { k: "m0", t: `이익률<small>${fy - 1}</small>`, f: (r) => cell(pct(r.m0), src(r, fy - 1, "영업이익률"), "영업이익 공시 없음") },
    { k: "m", t: `이익률<small>${fy}</small>`, f: (r) => cell(pct(r.m), src(r, fy, "영업이익률(영업이익÷매출)"), "영업이익 공시 없음") },
    { k: "dm", t: "이익률<small>변화</small>", f: (r) => cell(ppp(r.dm), src(r, fy, "영업이익률 전년 대비 변화"), "두 해 영업이익이 모두 있어야 계산") },
    { k: "debt", t: "부채비율", f: (r) => cell(pct(r.debt, 0), src(r, fy, "부채비율(부채÷자본)"), "부채·자본 공시 없음 또는 자본잠식") },
    { k: "e1", t: "임직원", f: (r) => cell(r.e1 ? `${nf(r.e1)}명` : null, `${r.n} ${fy}년 임직원 · DART 사업보고서 직원 현황`, "직원 현황 미공시(감사보고서 제출 기업 등)") },
  ];
  const LIMIT = 50;
  function list(rows, fy) {
    const q = st.q.trim().toLowerCase(), cols = COLS(fy);
    rows.forEach((r) => { r.dm = r.m != null && r.m0 != null ? r.m - r.m0 : null; });
    const f = rows.filter((r) => !q || r.n.toLowerCase().includes(q));
    const k = st.sort.k, d = st.sort.d;
    f.sort((a, b) => { const x = a[k], y = b[k]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(y, "ko") : x - y) * d; });
    const shown = st.more ? f : f.slice(0, LIMIT);
    const head = cols.map((c) => `<th scope="col" class="${c.l ? "l" : ""}" aria-sort="${k === c.k ? (d > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-k="${c.k}">${c.t}<i>${k === c.k ? (d > 0 ? "▲" : "▼") : ""}</i></button></th>`).join("");
    $("c-dmlist").innerHTML = f.length ? `<table class="db-tbl cm-tbl dm-tbl"><thead><tr>${head}</tr></thead><tbody>${shown.map((r) => `<tr>${cols.map((c) => (c.k === "n" ? `<th scope="row" class="l">${c.f(r)}</th>` : `<td class="${c.l ? "l" : ""}">${c.f(r)}</td>`)).join("")}</tr>`).join("")}</tbody></table>`
      : `<p class="db-note"><i class="ph ph-info" aria-hidden="true"></i><span>조건에 맞는 기업이 없습니다.</span></p>`;
    $("list-sub").textContent = `${f.length}곳 · 열 제목을 누르면 정렬 · 숫자에 올리면 출처`;
    $("more").hidden = f.length <= LIMIT;
    $("more").textContent = st.more ? "접기" : `${f.length - LIMIT}곳 더 보기`;
    lastList = f;
  }
  let lastList = [], curRows = [];
  $("c-dmlist").addEventListener("click", (e) => { const b = e.target.closest("button[data-k]"); if (!b) return; st.sort = { k: b.dataset.k, d: st.sort.k === b.dataset.k ? -st.sort.d : b.dataset.k === "n" || b.dataset.k === "kind" ? 1 : -1 }; list(curRows, st.fy); });
  $("q").addEventListener("input", (e) => { st.q = e.target.value; list(curRows, st.fy); });
  $("more").addEventListener("click", () => { st.more = !st.more; list(curRows, st.fy); });
  $("csv").addEventListener("click", () => {
    const fy = st.fy, head = ["기업", "업종", "상장", `매출${fy - 2}(억원)`, `매출${fy - 1}(억원)`, `매출${fy}(억원)`, "매출증감률(%)", `영업이익${fy - 1}(억원)`, `영업이익${fy}(억원)`, `영업이익률${fy - 1}(%)`, `영업이익률${fy}(%)`, "부채비율(%)", "임직원", "출처"];
    const v = (x, d = 1) => (x == null || !isFinite(x) ? "" : typeof x === "number" ? x.toFixed(d) : x);
    const lines = lastList.map((r) => [r.n, r.kind, r.sub, r.l ? "상장" : "비상장", v(r.s2, 0), v(r.s0, 0), v(r.s1, 0), v(r.g), v(r.o0, 0), v(r.o1, 0), v(r.m0), v(r.m), v(r.debt, 0), v(r.e1, 0), doc(r)]);
    const csv = "﻿" + [head, ...lines].map((a) => a.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `국내소부장_실적_${fy}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  function basis(rows, fy) {
    const audit = rows.filter((r) => r.src === "감사보고서").length;
    return `<div class="cm-basis" role="note"><b><i class="ph ph-info" aria-hidden="true"></i>집계 기준</b><ul>
      <li><span>재무제표</span><b>개별</b> 재무제표(연결 아님) · 사업보고서 ${rows.length - audit}곳, 감사보고서 ${audit}곳</li>
      <li><span>기준 연도</span>${fy}년 사업연도(대부분 12월 결산) · 단위 억 원</li>
      <li><span>범위</span>${esc(SB.describe(st))} · 수요기업·IT·서비스 제외</li></ul></div>`;
  }
  function limits() {
    $("c-lim").innerHTML = [
      "영업이익률(합계 기준) = 영업이익이 공시된 기업의 영업이익 합계 ÷ 같은 기업의 매출 합계. 중앙값은 기업별 이익률을 줄 세운 가운데 값입니다.",
      "연도별 실적은 세 해 모두 공시한 같은 기업만 더해 비교합니다(표본 변화 영향 제거). 매출 증감률은 전년 매출이 있는 기업만 계산합니다.",
      "개별 재무제표라 자회사 실적은 들어가지 않습니다. 공시에 없는 값은 '-'로 두었고, 이유는 '-'에 올리면 보입니다.",
    ].map((t) => `<li>${esc(t)}</li>`).join("");
  }

  // ---------- 시장 비중(업종별 시가총액·시장 비중·종목 수·주요 종목) ----------
  // 검토 중인 소부장 핵심 모집단(기존 123 + 신규 37 = 160개사)을 기준으로 집계해 둔 값(data/semi_share.js)을 보여 준다. 상단 실적 필터와 무관하다.
  // 시장 비중 = 소부장 시가총액 ÷ 코스피·코스닥 전체 시가총액(같은 출처·같은 시점). 코넥스는 종목 수만 센다.
  const MKN = { KOSPI: "코스피", KOSDAQ: "코스닥" };
  const KCOL = { 소재: "var(--blue)", 부품: "var(--teal, var(--green))", 장비: "var(--orange)" };
  const pc2 = (v) => (v == null || !isFinite(v) ? "-" : `${nf(v * 100, 2)}%`);
  function drawShare() {
    const root = $("c-share"); if (!root) return;
    const D = window.SEMI_SHARE;
    if (!D || !D.groups) { root.innerHTML = `<section class="db-card ms-empty"><i class="ph ph-hourglass-medium" aria-hidden="true"></i><p>시가총액·시장 비중 자료가 아직 없습니다.</p></section>`; return; }
    const G = D.groups, maxSh = Math.max(0, ...Object.values(G).map((g) => g.share || 0));
    const tops = (g) => (g.top && g.top.length ? g.top.map((f) => `<span class="ms-co">${esc(f.n)}<small>${won(f.cap)}</small></span>`).join("") : '<span class="ms-na">-</span>');
    const row = (k, nm, cls, col) => {
      const g = G[k]; if (!g) return "";
      const w = maxSh && g.share != null ? Math.max(2, (g.share / maxSh) * 100) : 0;
      return `<tr class="${cls}"><th scope="row">${col ? `<i class="sq" style="background:${col}"></i>` : ""}${nm}</th><td class="r">${g.nCap ? won(g.cap) : "-"}${g.nCap && g.nCap < g.n ? `<small class="ms-sub">${g.nCap}곳 합산</small>` : ""}</td>`
        + `<td class="r ms-sh">${g.share != null ? `<span class="ms-bar" aria-hidden="true"><i style="width:${w}%;${col ? `background:${col}` : ""}"></i></span><b>${pc2(g.share)}</b>` : "-"}</td><td class="r">${nf(g.n)}</td><td><div class="ms-tops">${tops(g)}</div></td></tr>`;
    };
    const kinds = ["소재", "부품", "장비"];
    const main = `<section class="db-card ms-main" aria-labelledby="ms-t1"><div class="db-card-head"><h2 id="ms-t1">국내 반도체 소부장 업종 현황<small>${esc(D.asOf)} 종가 기준 · 검토용</small></h2></div>
      <div class="ms-scroll"><table class="ms-tbl"><caption class="sr-only">업종별 시가총액, 시장 비중, 종목 수, 주요 종목</caption><thead><tr><th scope="col">업종</th><th scope="col" class="r">시가총액</th><th scope="col" class="r">시장 비중</th><th scope="col" class="r">종목 수</th><th scope="col">주요 종목 <small>(시가총액 상위)</small></th></tr></thead><tbody>`
      + row("전체", "반도체 국내 소부장", "ms-total") + kinds.map((k) => row(k, k, "ms-kind", KCOL[k])).join("") + `</tbody></table></div>
      <p class="db-note"><i class="ph ph-info" aria-hidden="true"></i><span>${esc(D.basis)}입니다. ${D.konexIncluded ? `시장 비중은 소부장 상장 기업 시가총액을 코스피·코스닥·코넥스 전체 시가총액으로 나눈 값입니다.` : `시장 비중은 소부장 상장 기업(코스피·코스닥) 시가총액을 코스피·코스닥 전체 시가총액으로 나눈 값이며, 코넥스 ${D.konexN}곳은 종목 수에만 포함합니다.`}</span></p></section>`;
    const mkCard = (m) => {
      const g = D.markets[m]; if (!g) return "";
      const rows = kinds.filter((k) => g.kinds && g.kinds[k]).map((k) => { const x = g.kinds[k]; return `<tr><th scope="row"><i class="sq" style="background:${KCOL[k]}"></i>${k}</th><td class="r">${nf(x.n)}</td><td class="r">${x.nCap ? won(x.cap) : "-"}</td><td class="r">${pc2(x.share)}</td><td><div class="ms-tops">${tops(x)}</div></td></tr>`; }).join("");
      return `<article class="ms-mk"><header><h3>${MKN[m]}</h3><p><b>${g.nCap ? won(g.cap) : "-"}</b> · 시장 비중 <b>${pc2(g.share)}</b> · ${nf(g.n)}개 종목</p><p class="ms-mut">${MKN[m]} 전체 시가총액 ${won(g.mcap)} 중 소부장 비중</p></header>`
        + `<div class="ms-scroll"><table class="ms-tbl"><thead><tr><th scope="col">구분</th><th scope="col" class="r">종목 수</th><th scope="col" class="r">시가총액</th><th scope="col" class="r">${MKN[m]} 내 비중</th><th scope="col">주요 종목</th></tr></thead><tbody>${rows}</tbody></table></div></article>`;
    };
    const notes = `<details class="db-card ms-notes"><summary><i class="ph ph-scales" aria-hidden="true"></i> 산출 기준과 한계</summary><ul>
      <li><b>기준일·출처</b> ${esc(D.asOf)} ${esc(D.source)}. 위 표는 이 시점에 집계해 둔 값이며 자동으로 바뀌지 않습니다(다시 계산하면 갱신).</li>
      <li><b>시장 전체</b> 코스피 ${won(D.marketTotal.KOSPI)} · 코스닥 ${won(D.marketTotal.KOSDAQ)}(${D.konexIncluded ? `한국거래소 일별매매정보의 시장별 전 종목 합계${D.marketTotal.KONEX ? `, 코넥스 ${won(D.marketTotal.KONEX)} 포함` : ""}` : "같은 출처의 시장 목록 전 종목 합계, 우선주·ETF·리츠 등 모든 증권유형 포함"}). 보통주만 센 소부장 비중은 그만큼 다소 낮게 나옵니다.</li>
      ${D.konexIncluded ? "" : `<li><b>출처 차이</b> 한국거래소 공식 시장 합계와는 출처·시점 차이로 1~2% 다를 수 있습니다(2026-10-30 비교: 코스피 -1.6%, 코스닥 -1.0%).</li>`}
      <li><b>명단·분류</b> ${D.universe ? `핵심 모집단 ${nf(D.universe.core)}개사(기존 ${nf(D.universe.existing)} + 신규 ${nf(D.universe.new)})의 소재·부품·장비 구분이며 확정 전입니다. 보류 ${nf(D.universe.hold)}·OSAT ${nf(D.universe.osat)}·유통 ${nf(D.universe.distribution)}곳은 별도 관리로 핵심 통계에서 제외했습니다.` : "검토 중인 소부장의 소재·부품·장비 구분이며 확정 전입니다."} 대형 겸업 기업(고려아연·LG화학·두산 등)의 포함 여부에 따라 업종 시가총액이 크게 달라집니다.</li>
      ${(() => { const d = G["전체"].cap - kinds.reduce((t, k) => t + (G[k] ? G[k].cap : 0), 0); return d ? `<li><b>집계 검산</b> 업종별 시가총액 합계가 전체 합계보다 ${nf(Math.abs(d))}억 원 ${d > 0 ? "작" : "큽"}니다. 원자료 확인 전까지 차이를 그대로 공개합니다.</li>` : ""; })()}
      <li><b>범위</b> 상단 실적 필터와 무관합니다. ${D.konexIncluded ? `코넥스 ${D.konexN}곳도 시가총액에 포함했습니다.` : `코넥스 ${D.konexN}곳은 상장주식 수를 확인하지 못해 시가총액·비중에서 빠지고 종목 수에만 들어갑니다.`}</li></ul></details>`;
    root.innerHTML = `${main}<section class="db-card" aria-labelledby="ms-t2"><div class="db-card-head"><h2 id="ms-t2">코스피·코스닥별 상세</h2></div><div class="ms-mks">${mkCard("KOSPI")}${mkCard("KOSDAQ")}</div></section>${notes}`;
  }

  // ---------- 기업별 시가총액·주가 상세 ----------
  // data/semi_caps.js(시장 비중 표와 같은 기준·시점). 검색·시장·업종 필터, 열 머리글 클릭으로 정렬. 상단 실적 필터와 무관하다.
  const cst = { q: "", m: "", k: "", sort: "cap", dir: -1 };
  const pcs = (v) => (v == null || !isFinite(v) ? "-" : `<span class="${v > 0 ? "ms-up" : v < 0 ? "ms-dn" : ""}">${v > 0 ? "▲" : v < 0 ? "▼" : ""}${nf(Math.abs(v) * 100, 1)}%</span>`);
  const CCOL = [
    ["rank", "순위", 0], ["n", "기업", 1], ["m", "시장", 1], ["k", "업종", 1], ["p", "종가(원)", 0], ["d1", "분기말 대비", 0], ["d2", "반기말 대비", 0],
    ["s", "상장주식 수", 0], ["cap", "시가총액", 0], ["inK", "업종 내 비중", 0], ["inM", "시장 비중", 0],
  ];
  function capsRows(D) {
    const MT = (window.SEMI_SHARE && window.SEMI_SHARE.marketTotal) || {}, kindCap = {}, allCap = {};
    D.rows.forEach((r) => { if (r.cap) { kindCap[r.k] = (kindCap[r.k] || 0) + r.cap; allCap.t = (allCap.t || 0) + r.cap; } });
    const rk = [...D.rows].filter((r) => r.cap).sort((a, b) => b.cap - a.cap).map((r) => r.c);
    return D.rows.map((r) => ({ ...r, rank: r.cap ? rk.indexOf(r.c) + 1 : null, d1: r.p && r.q1 ? r.p / r.q1 - 1 : null, d2: r.p && r.q2 ? r.p / r.q2 - 1 : null,
      inK: r.cap ? r.cap / kindCap[r.k] : null, inM: r.cap && MT[r.m] ? r.cap / (MT[r.m] / 1) : null }));
  }
  function drawCaps() {
    const root = $("c-caps"); if (!root) return;
    const D = window.SEMI_CAPS;
    if (!D || !D.rows) { root.innerHTML = `<section class="db-card ms-empty"><i class="ph ph-hourglass-medium" aria-hidden="true"></i><p>기업별 시가총액 자료가 아직 없습니다.</p></section>`; return; }
    const all = capsRows(D), q = cst.q.trim().toLowerCase();
    let rows = all.filter((r) => (!cst.m || r.m === cst.m) && (!cst.k || r.k === cst.k) && (!q || r.n.toLowerCase().includes(q) || r.c.includes(q)));
    const key = cst.sort, dir = cst.dir;
    rows.sort((a, b) => { const x = a[key], y = b[key]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(y, "ko") : x - y) * dir; });
    const sumCap = rows.reduce((t, r) => t + (r.cap || 0), 0);
    const th = CCOL.map(([k, l, left]) => `<th scope="col" class="${left ? "" : "r"}" aria-sort="${cst.sort === k ? (cst.dir > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-sort="${k}">${l}${cst.sort === k ? `<i class="ph ph-caret-${cst.dir > 0 ? "up" : "down"}" aria-hidden="true"></i>` : ""}</button></th>`).join("");
    const body = rows.map((r) => `<tr><td class="r">${r.rank ?? "-"}</td><th scope="row"><b>${esc(r.n)}</b><small>${esc(r.c)}</small></th><td>${MKN[r.m] || "코넥스"}</td><td><i class="sq" style="background:${KCOL[r.k]}"></i>${r.k}</td>`
      + `<td class="r">${r.p ? nf(r.p) : "-"}</td><td class="r">${pcs(r.d1)}</td><td class="r">${pcs(r.d2)}</td><td class="r">${r.s ? nf(r.s) : "-"}</td><td class="r"><b>${r.cap ? won(r.cap) : "-"}</b></td><td class="r">${pc2(r.inK)}</td><td class="r">${r.m === "KONEX" ? "-" : pc2(r.inM)}</td></tr>`).join("");
    const opt = (v, l, cur) => `<option value="${v}"${cur === v ? " selected" : ""}>${l}</option>`;
    const keep = document.activeElement && document.activeElement.id === "cp-q";
    root.innerHTML = `<section class="db-card" aria-labelledby="cp-t"><div class="db-card-head"><h2 id="cp-t">기업별 시가총액·주가<small>${esc(D.asOf)} 종가 기준 · 검토용</small></h2></div>
      <div class="cp-tools"><label class="db-sel cp-search"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><span class="sr-only">기업명·종목코드 검색</span><input id="cp-q" type="search" placeholder="기업명·종목코드 검색" value="${esc(cst.q)}" autocomplete="off"></label>
        <label class="db-sel"><i class="ph ph-buildings" aria-hidden="true"></i><span>시장</span><select id="cp-m">${opt("", "전체", cst.m)}${opt("KOSPI", "코스피", cst.m)}${opt("KOSDAQ", "코스닥", cst.m)}${opt("KONEX", "코넥스", cst.m)}</select></label>
        <label class="db-sel"><i class="ph ph-stack" aria-hidden="true"></i><span>업종</span><select id="cp-k">${opt("", "전체", cst.k)}${["소재", "부품", "장비"].map((k) => opt(k, k, cst.k)).join("")}</select></label>
        <button type="button" class="db-btn cp-csv" id="cp-csv"><i class="ph ph-download-simple" aria-hidden="true"></i>CSV 내려받기</button>
        <p class="cp-sum" aria-live="polite"><b>${nf(rows.length)}</b>개 기업 · 시가총액 합계 <b>${won(sumCap) || "-"}</b></p></div>
      <div class="ms-scroll"><table class="ms-tbl cp-tbl"><caption class="sr-only">기업별 시가총액과 주가</caption><thead><tr>${th}</tr></thead><tbody>${body || `<tr><td colspan="11" class="ms-na">조건에 맞는 기업이 없습니다.</td></tr>`}</tbody></table></div>
      <p class="db-note"><i class="ph ph-info" aria-hidden="true"></i><span>${esc(D.source)}. 분기말 대비는 ${esc(D.prev[0])}, 반기말 대비는 ${esc(D.prev[1])} 종가와 비교한 값이며 액면분할·무상증자 등은 반영하지 않았습니다. 업종 내 비중은 표에 있는 기업 합계 기준, 시장 비중은 해당 시장 전체 시가총액 기준입니다. 코넥스는 상장주식 수를 확인하지 못해 시가총액을 구하지 못했습니다. 투자 권유가 아닙니다.</span></p></section>`;
    root.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => { const k = b.dataset.sort; if (cst.sort === k) cst.dir = -cst.dir; else { cst.sort = k; cst.dir = ["n", "m", "k"].includes(k) ? 1 : -1; } drawCaps(); }));
    $("cp-m").addEventListener("change", (e) => { cst.m = e.target.value; drawCaps(); });
    $("cp-k").addEventListener("change", (e) => { cst.k = e.target.value; drawCaps(); });
    $("cp-csv").addEventListener("click", () => {
      const pr = (v) => (v == null || !isFinite(v) ? "" : +(v * 100).toFixed(2)), mk = { KOSPI: "코스피", KOSDAQ: "코스닥", KONEX: "코넥스" };
      const head = ["순위", "기업명", "종목코드", "시장", "업종", "종가(원)", `${D.prev[0]} 종가(원)`, `${D.prev[1]} 종가(원)`, "분기말 대비(%)", "반기말 대비(%)", "상장주식 수(주)", "시가총액(억 원)", "업종 내 비중(%)", "시장 비중(%)"];
      const lines = rows.map((r) => [r.rank ?? "", r.n, r.c, mk[r.m] || r.m, r.k, r.p ?? "", r.q1 ?? "", r.q2 ?? "", pr(r.d1), pr(r.d2), r.s ?? "", r.cap ?? "", pr(r.inK), r.m === "KONEX" ? "" : pr(r.inM)]);
      const q = (c) => `"${String(c).replace(/"/g, '""')}"`;
      const csv = "\ufeff" + [head.map(q).join(","), ...lines.map((a) => a.map((c) => (typeof c === "number" ? c : q(c))).join(","))].join("\r\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = `국내소부장_기업별_시가총액_${D.asOf}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    const qi = $("cp-q"); qi.addEventListener("input", (e) => { cst.q = e.target.value; const pos = e.target.selectionStart; drawCaps(); const n = $("cp-q"); n.focus(); n.setSelectionRange(pos, pos); });
    if (keep) qi.focus();
  }

  // ---------- 화면 전환 ----------
  const VIEWS = ["share", "caps", "summary", "group", "list"];
  const STATIC_VIEWS = ["share", "caps"]; // 실적 필터와 무관한 보기
  const SHARE_SUB = "상장 소부장 기업의 시가총액과 시장 비중";
  const CAPS_SUB = "기업별 시가총액·주가·시장 비중 상세";
  let subText = "";
  const curView = () => (VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "share");
  function show(v) {
    if (!VIEWS.includes(v)) v = "share";
    document.body.dataset.view = v;
    $("sub").textContent = v === "share" ? SHARE_SUB : v === "caps" ? CAPS_SUB : subText;
    document.querySelectorAll(".db-view").forEach((el) => (el.hidden = el.dataset.view !== v));
    document.querySelectorAll("#views-nav a").forEach((a) => a.setAttribute("aria-current", a.dataset.view === v));
    pill();
  }
  function pill() {
    const ul = $("views-nav"), a = ul.querySelector('a[aria-current="true"]');
    if (!a || !getComputedStyle(document.documentElement).getPropertyValue("--brand").trim()) return;
    const u = ul.getBoundingClientRect(), r = a.getBoundingClientRect();
    ul.style.setProperty("--py", `${r.top - u.top}px`); ul.style.setProperty("--ph", `${r.height}px`);
    ul.style.setProperty("--px", `${r.left - u.left}px`); ul.style.setProperty("--pw", `${r.width}px`);
    ul.classList.add("th-ready");
  }
  window.addEventListener("hashchange", () => { show(location.hash.slice(1)); window.scrollTo({ top: 0 }); });
  window.addEventListener("resize", pill);

  function render() {
    const F = SB.makeFilter(st, null), rows = SB.panel(SB.recs.filter(F.inFilter), st.fy);
    curRows = rows;
    const q = SB.toQuery(st);
    history.replaceState(null, "", `${location.pathname}${q ? `?${q}` : ""}${location.hash}`);
    subText = `${SB.describe(st)} · 개별 기준 · ${rows.length}곳`;
    $("sub").textContent = curView() === "share" ? SHARE_SUB : curView() === "caps" ? CAPS_SUB : subText;
    document.querySelector(".cm-basis-slot").innerHTML = basis(rows, st.fy);
    drawShare(); drawCaps();
    if (!rows.length) {
      const onShare = STATIC_VIEWS.includes(curView()); // 시장 비중 보기는 실적 필터와 무관하므로 실적이 비어도 보여 준다
      document.body.dataset.view = curView();
      $("empty-panel").hidden = onShare;
      $("empty-panel").innerHTML = `<i class="ph ph-funnel-x" aria-hidden="true"></i><div><b>${SB.recs.length ? "조건에 맞는 기업이 없습니다." : "실적 데이터를 아직 받지 못했습니다."}</b><p>${SB.recs.length ? "조건을 풀어 보세요." : "매일 아침 자동으로 다시 수집합니다."}</p></div>`;
      document.querySelectorAll(".db-view").forEach((el) => (el.hidden = !(onShare && el.dataset.view === curView())));
      document.querySelectorAll("#views-nav a").forEach((a) => a.setAttribute("aria-current", a.dataset.view === curView()));
      pill();
      return;
    }
    $("empty-panel").hidden = true;
    show(location.hash.slice(1));
    summary(rows, st.fy); group(rows, st.fy); list(rows, st.fy); limits();
  }

  // ---------- 출처 말풍선 ----------
  const tip = $("cm-tip");
  const place = (el) => {
    const t = el.closest && el.closest("[data-src]");
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.dataset.src; tip.hidden = false;
    const r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    tip.style.top = `${r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8}px`;
  };
  ["mouseover", "focusin", "click"].forEach((ev) => document.addEventListener(ev, (e) => place(e.target)));
  document.addEventListener("scroll", () => (tip.hidden = true), true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") tip.hidden = true; });

  const tb = $("theme-btn");
  if (tb) {
    const cur = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const paint = () => { const d = cur() === "dark"; tb.innerHTML = `<i class="ph ph-${d ? "sun" : "moon"}" aria-hidden="true"></i>`; tb.title = d ? "밝은 화면으로" : "어두운 화면으로"; };
    tb.addEventListener("click", () => { const t = cur() === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = t; try { localStorage.setItem("sobujang:theme", t); } catch (e) { /* 저장 불가 */ } paint(); });
    paint();
  }
  $("updated").textContent = SB.meta.updated || "-";
  drawFilters();
  render();
  window.addEventListener("load", pill);
})();
