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
  // 시장 비중 필터: ①대기업 제외(삼성전기 등, 목록은 고르거나 더할 수 있음) ②프로필 기업 현황의 그룹(1·2·3그룹 등)만 보기. 둘 다 시총 합계를 종목 단위로 다시 계산한다.
  // 기본 제외 대기업: 공정거래위원회 공시대상기업집단(대기업집단) 계열사 또는 사용자가 지정한 대형 겸업 기업. 그룹은 언론 보도·공시 기준 확인(공정위 지정 목록으로 재확인 권장)
  const BIG_GROUP = { 삼성전기: "삼성", LG이노텍: "LG", LG화학: "LG", 두산: "두산", 고려아연: "고려아연(사용자 지정)", 한화비전: "한화", 롯데정밀화학: "롯데", OCI: "OCI" };
  const DEFAULT_BIG = ["삼성전기", "고려아연", "LG이노텍", "LG화학", "두산", "한화비전", "롯데정밀화학", "OCI"];
  const sf = { exclOn: false, excl: new Set(DEFAULT_BIG), groups: new Set() };
  const sfActive = () => sf.exclOn || sf.groups.size > 0;
  const grpCodes = () => { const m = {}; (window.COMPANY_GROUPS || []).forEach((g) => g.companies.forEach((c) => { if (c[2]) (m[c[2]] = m[c[2]] || []).push(g.id); })); return m; };
  function drawShare() {
    const root = $("c-share"); if (!root) return;
    const D = window.SEMI_SHARE;
    if (!D || !D.groups) { root.innerHTML = `<section class="db-card ms-empty"><i class="ph ph-hourglass-medium" aria-hidden="true"></i><p>시가총액·시장 비중 자료가 아직 없습니다.</p></section>`; return; }
    const G = D.groups, CP0 = window.SEMI_CAPS, active = sfActive() && CP0 && CP0.rows, GC = grpCodes();
    const passF = (r) => !(sf.exclOn && sf.excl.has(r.n)) && (!sf.groups.size || (GC[r.c] || []).some((id) => sf.groups.has(id)));
    const den = (D.marketTotal.KOSPI || 0) + (D.marketTotal.KOSDAQ || 0);
    const aggF = (fs) => { const have = fs.filter((f) => f.cap).sort((a, b) => b.cap - a.cap), cap = have.reduce((t, f) => t + f.cap, 0); return { n: fs.length, nCap: have.length, cap, share: den ? cap / den : null, top: have.slice(0, 3).map((f) => ({ n: f.n, cap: f.cap })) }; };
    const popF = active ? CP0.rows.filter(passF) : [];
    const GF = active ? { 전체: aggF(popF), 소재: aggF(popF.filter((r) => r.k === "소재")), 부품: aggF(popF.filter((r) => r.k === "부품")), 장비: aggF(popF.filter((r) => r.k === "장비")) } : G;
    const maxSh = Math.max(0, ...Object.values(GF).map((g) => g.share || 0));
    const tops = (g) => (g.top && g.top.length ? g.top.map((f) => `<span class="ms-co">${esc(f.n)}<small>${won(f.cap)}</small></span>`).join("") : '<span class="ms-na">-</span>');
    const row = (k, nm, cls, col) => {
      const g = GF[k]; if (!g) return "";
      const w = maxSh && g.share != null ? Math.max(2, (g.share / maxSh) * 100) : 0;
      return `<tr class="${cls}"><th scope="row">${col ? `<i class="sq" style="background:${col}"></i>` : ""}${nm}</th><td class="r">${g.nCap ? won(g.cap) : "-"}${g.nCap && g.nCap < g.n ? `<small class="ms-sub">${g.nCap}곳 합산</small>` : ""}</td>`
        + `<td class="r ms-sh">${g.share != null ? `<span class="ms-bar" aria-hidden="true"><i style="width:${w}%;${col ? `background:${col}` : ""}"></i></span><b>${pc2(g.share)}</b>` : "-"}</td><td class="r">${nf(g.n)}</td><td><div class="ms-tops">${tops(g)}</div></td></tr>`;
    };
    const kinds = ["소재", "부품", "장비"];
    const grpDefs = (window.COMPANY_GROUPS || []).map((g) => ({ id: g.id, label: g.label, listed: g.companies.filter((c) => c[2]).length, all: g.companies.length }));
    const capByName = {}; (CP0 && CP0.rows ? CP0.rows : []).forEach((r) => { capByName[r.n] = r; });
    const candNames = [...new Set([...DEFAULT_BIG, ...sf.excl])].filter((n) => capByName[n]);
    const exclList = candNames.filter((n) => sf.excl.has(n) && capByName[n].cap);
    const addOpts = (CP0 && CP0.rows ? CP0.rows : []).filter((r) => r.cap && !candNames.includes(r.n)).sort((a, b) => b.cap - a.cap).slice(0, 40).map((r) => `<option value="${esc(r.n)}">${esc(r.n)} (${won(r.cap)})</option>`).join("");
    const filt = `<section class="db-card ms-flt" aria-labelledby="ms-tf"><div class="db-card-head"><h2 id="ms-tf">보기 조건<small>업종 현황·코스피/코스닥 상세에 함께 적용</small></h2></div>
      <div class="ms-flt-row"><label class="ms-tg"><input type="checkbox" id="ms-excl-on"${sf.exclOn ? " checked" : ""}><span>대기업 제외</span></label>
        ${sf.exclOn ? `<div class="ms-chips" role="group" aria-label="제외할 대기업(체크한 기업을 뺌)">${candNames.map((n) => `<label class="ms-chip"><input type="checkbox" data-excl="${esc(n)}"${sf.excl.has(n) ? " checked" : ""}><span title="${esc(BIG_GROUP[n] || "사용자 추가")}">${esc(n)}<small>${capByName[n] && capByName[n].cap ? won(capByName[n].cap) : ""}</small></span></label>`).join("")}
          <label class="ms-add"><span class="sr-only">제외할 기업 더하기</span><select id="ms-excl-add"><option value="">+ 기업 더하기</option>${addOpts}</select></label></div>`
          : `<p class="ms-excl-sum">켜면 대기업 ${nf(exclList.length)}곳(${won(exclList.reduce((t, n) => t + capByName[n].cap, 0))})을 빼고 다시 계산합니다: ${exclList.map(esc).join("·")} <small>켠 뒤 목록을 고르거나 더할 수 있습니다.</small></p>`}</div>
      <div class="ms-flt-row"><span class="ms-flt-l">프로필 기업 현황 그룹</span>
        <div class="ms-chips" role="group" aria-label="프로필 그룹 선택">${grpDefs.map((g) => `<label class="ms-chip"><input type="checkbox" data-grp="${esc(g.id)}"${sf.groups.has(g.id) ? " checked" : ""}><span>${esc(g.label)}<small>상장 ${g.listed}/${g.all}곳</small></span></label>`).join("")}</div></div>
      ${active ? "" : `<p class="ms-hint2">조건을 고르면 선택한 기업만으로 시가총액·시장 비중을 다시 계산합니다.</p>`}
      <div id="ms-flt-res"></div></section>`;
    const fres = (() => {
      if (!active) return "";
      const gAll = G.전체, gF = GF.전체, bits = [];
      if (sf.exclOn && sf.excl.size) { const ex = [...sf.excl].filter((n) => capByName[n] && capByName[n].cap); bits.push(`대기업 ${ex.length}곳 제외(${won(ex.reduce((t, n) => t + capByName[n].cap, 0))}): ${ex.map(esc).join("·")}`); }
      if (sf.groups.size) bits.push(`프로필 그룹: ${grpDefs.filter((g) => sf.groups.has(g.id)).map((g) => g.label).join("·")}`);
      const perGroup = sf.groups.size ? grpDefs.filter((g) => sf.groups.has(g.id)).map((g) => { const codes = (window.COMPANY_GROUPS.find((x) => x.id === g.id) || { companies: [] }).companies.filter((c) => c[2]).map((c) => c[2]); const rs = popF.filter((r) => codes.includes(r.c)); const t = rs.reduce((a, r) => a + (r.cap || 0), 0); return `<li><b>${esc(g.label)}</b> ${nf(rs.length)}곳 · ${t ? won(t) : "-"}</li>`; }).join("") : "";
      const unlisted = sf.groups.size ? grpDefs.filter((g) => sf.groups.has(g.id)).reduce((t, g) => t + (g.all - g.listed), 0) : 0;
      const missing = sf.groups.size ? (window.COMPANY_GROUPS || []).filter((g) => sf.groups.has(g.id)).flatMap((g) => g.companies.filter((c) => c[2] && !(CP0.rows.find((r) => r.c === c[2]) && CP0.rows.find((r) => r.c === c[2]).cap)).map((c) => c[0])) : [];
      const list = popF.filter((r) => r.cap).sort((a, b) => b.cap - a.cap);
      return `<div class="ms-res" role="status" aria-live="polite"><p class="ms-res-h"><b>선택 조건 시가총액 합계 ${gF.nCap ? won(gF.cap) : "-"}</b> · 시장 비중 <b>${pc2(gF.share)}</b> · ${nf(gF.n)}곳(시가총액 확인 ${nf(gF.nCap)}곳)</p>
        <p class="ms-mut">${bits.join(" · ")} · 전체 소부장 ${won(gAll.cap)} 대비 ${gAll.cap ? nf((gF.cap / gAll.cap) * 100, 1) : "-"}%</p>
        ${perGroup ? `<ul class="ms-res-g">${perGroup}</ul>` : ""}
        ${unlisted ? `<p class="ms-mut">선택 그룹 중 비상장 ${nf(unlisted)}곳은 시가총액이 없어 합계에 포함하지 않습니다.</p>` : ""}${missing.length ? `<p class="ms-mut">소부장 핵심 모집단(시가총액 집계 대상)에 없어 합계에서 빠진 상장 기업: ${missing.map(esc).join("·")}</p>` : ""}
        <details class="ms-res-d"><summary>포함 기업 ${nf(list.length)}곳 보기</summary><ol class="ms-res-l" role="list">${list.map((r) => `<li><span>${esc(r.n)}<small>${esc(MKN[r.m] || r.m)} · ${esc(r.k)}</small></span><b>${won(r.cap)}</b></li>`).join("")}</ol></details></div>`;
    })();
    const main = `<section class="db-card ms-main" aria-labelledby="ms-t1"><div class="db-card-head"><h2 id="ms-t1">국내 반도체 소부장 업종 현황<small>${esc(D.asOf)} 종가 기준 · 검토용${active ? " · 조건 적용 중" : ""}</small></h2></div>
      <div class="ms-scroll"><table class="ms-tbl"><caption class="sr-only">업종별 시가총액, 시장 비중, 종목 수, 주요 종목</caption><thead><tr><th scope="col">업종</th><th scope="col" class="r">시가총액</th><th scope="col" class="r">시장 비중</th><th scope="col" class="r">종목 수</th><th scope="col">주요 종목 <small>(시가총액 상위)</small></th></tr></thead><tbody>`
      + row("전체", "반도체 국내 소부장", "ms-total") + kinds.map((k) => row(k, k, "ms-kind", KCOL[k])).join("") + `</tbody></table></div>
      <p class="ms-hint" aria-hidden="true"><i class="ph ph-arrows-horizontal"></i> 표를 좌우로 밀어 더 볼 수 있습니다</p>
      <p class="db-note"><i class="ph ph-info" aria-hidden="true"></i><span>${esc(D.basis)}입니다. ${D.konexIncluded ? `시장 비중은 소부장 상장 기업 시가총액을 코스피·코스닥·코넥스 전체 시가총액으로 나눈 값입니다.` : `시장 비중은 소부장 상장 기업(코스피·코스닥) 시가총액을 코스피·코스닥 전체 시가총액으로 나눈 값이며, 코넥스 ${D.konexN}곳은 종목 수에만 포함합니다.`}</span></p></section>`;
    const CP = window.SEMI_CAPS;
    const agg = (fs, den) => { const have = fs.filter((f) => f.cap).sort((a, b) => b.cap - a.cap), cap = have.reduce((t, f) => t + f.cap, 0); return { n: fs.length, nCap: have.length, cap, share: den ? cap / den : null, top: have.slice(0, 3).map((f) => ({ n: f.n, cap: f.cap })) }; };
    const mkCard = (m) => {
      let g = D.markets[m]; if (!g) return "";
      if (active) { const den = D.marketTotal[m], fs = CP.rows.filter((r) => r.m === m && passF(r)); g = { ...agg(fs, den), mcap: den, kinds: Object.fromEntries(kinds.map((k) => [k, agg(fs.filter((r) => r.k === k), den)])) }; }  // 상단 '보기 조건' 하나로 업종 현황과 같이 다시 계산(시장별 스위치 없음)
      const tg = active ? `<span class="ms-mk-on">보기 조건 적용 중</span>` : "";
      const rows = kinds.filter((k) => g.kinds && g.kinds[k]).map((k) => { const x = g.kinds[k]; return `<tr><th scope="row"><i class="sq" style="background:${KCOL[k]}"></i>${k}</th><td class="r">${nf(x.n)}</td><td class="r">${x.nCap ? won(x.cap) : "-"}</td><td class="r">${pc2(x.share)}</td><td><div class="ms-tops">${tops(x)}</div></td></tr>`; }).join("");
      return `<article class="ms-mk"><header><div class="ms-mk-h"><h3>${MKN[m]}</h3>${tg}</div><p><b>${g.nCap ? won(g.cap) : "-"}</b> · 시장 비중 <b>${pc2(g.share)}</b> · ${nf(g.n)}개 종목</p><p class="ms-mut">${MKN[m]} 전체 시가총액 ${won(g.mcap)} 중 소부장 비중</p></header>`
        + `<div class="ms-scroll"><table class="ms-tbl"><thead><tr><th scope="col">구분</th><th scope="col" class="r">종목 수</th><th scope="col" class="r">시가총액</th><th scope="col" class="r">${MKN[m]} 내 비중</th><th scope="col">주요 종목</th></tr></thead><tbody>${rows}</tbody></table></div><p class="ms-hint" aria-hidden="true"><i class="ph ph-arrows-horizontal"></i> 표를 좌우로 밀어 더 볼 수 있습니다</p></article>`;
    };
    const notes = `<details class="db-card ms-notes"><summary><i class="ph ph-scales" aria-hidden="true"></i> 산출 기준과 한계</summary><ul>
      <li><b>기준일·출처</b> ${esc(D.asOf)} ${esc(D.source)}. 위 표는 이 시점에 집계해 둔 값이며 자동으로 바뀌지 않습니다(다시 계산하면 갱신).</li>
      <li><b>시장 전체</b> 코스피 ${won(D.marketTotal.KOSPI)} · 코스닥 ${won(D.marketTotal.KOSDAQ)}(${D.konexIncluded ? `한국거래소 일별매매정보의 시장별 전 종목 합계${D.marketTotal.KONEX ? `, 코넥스 ${won(D.marketTotal.KONEX)} 포함` : ""}` : "같은 출처의 시장 목록 전 종목 합계, 우선주·ETF·리츠 등 모든 증권유형 포함"}). 보통주만 센 소부장 비중은 그만큼 다소 낮게 나옵니다.</li>
      ${G["전체"] && G["전체"].shareKK != null ? `<li><b>비중 기준 두 가지</b> 표의 시장 비중은 ${esc((D.denominator && D.denominator.share) || "코스피·코스닥")} 대비입니다. 코스피·코스닥 소부장만 코스피·코스닥 전체로 나눈 비중은 <b>${pc2(G["전체"].shareKK)}</b>입니다(분모와 분자에서 코넥스 제외). 소재 ${pc2(G["소재"] && G["소재"].shareKK)} · 부품 ${pc2(G["부품"] && G["부품"].shareKK)} · 장비 ${pc2(G["장비"] && G["장비"].shareKK)}.</li>` : ""}
      ${D.konexIncluded ? "" : `<li><b>출처 차이</b> 한국거래소 공식 시장 합계와는 출처·시점 차이로 1~2% 다를 수 있습니다(2026-10-30 비교: 코스피 -1.6%, 코스닥 -1.0%).</li>`}
      <li><b>명단·분류</b> ${D.universe ? `핵심 모집단 ${nf(D.universe.core)}개사(기존 ${nf(D.universe.existing)} + 신규 ${nf(D.universe.new)})의 소재·부품·장비 구분이며 확정 전입니다. 보류 ${nf(D.universe.hold)}·OSAT ${nf(D.universe.osat)}·유통 ${nf(D.universe.distribution)}곳은 별도 관리로 핵심 통계에서 제외했습니다.` : "검토 중인 소부장의 소재·부품·장비 구분이며 확정 전입니다."} 대형 겸업 기업(고려아연·LG화학·두산 등)의 포함 여부에 따라 업종 시가총액이 크게 달라집니다. 위 '보기 조건'의 대기업 제외로 빼고 볼 수 있습니다.</li>
      ${(() => { const d = G["전체"].cap - kinds.reduce((t, k) => t + (G[k] ? G[k].cap : 0), 0); return d ? `<li><b>집계 검산</b> 업종별 시가총액 합계가 전체 합계보다 ${nf(Math.abs(d))}억 원 ${d > 0 ? "작" : "큽"}니다. 원자료 확인 전까지 차이를 그대로 공개합니다.</li>` : ""; })()}
      <li><b>범위</b> 상단 실적 필터와 무관합니다. ${D.konexIncluded ? `코넥스 ${D.konexN}곳도 시가총액에 포함했습니다.` : `코넥스 ${D.konexN}곳은 상장주식 수를 확인하지 못해 시가총액·비중에서 빠지고 종목 수에만 들어갑니다.`}</li></ul></details>`;
    root.innerHTML = `${filt}${main}<section class="db-card" aria-labelledby="ms-t2"><div class="db-card-head"><h2 id="ms-t2">코스피·코스닥별 상세</h2></div><div class="ms-mks">${mkCard("KOSPI")}${mkCard("KOSDAQ")}</div></section>${notes}`;
    const rs = $("ms-flt-res"); if (rs) rs.innerHTML = fres;
    $("ms-excl-on").addEventListener("change", (e) => { sf.exclOn = e.target.checked; drawShare(); });
    root.querySelectorAll("input[data-excl]").forEach((el) => el.addEventListener("change", () => { el.checked ? sf.excl.add(el.dataset.excl) : sf.excl.delete(el.dataset.excl); if (el.checked) sf.exclOn = true; drawShare(); }));
    root.querySelectorAll("input[data-grp]").forEach((el) => el.addEventListener("change", () => { el.checked ? sf.groups.add(el.dataset.grp) : sf.groups.delete(el.dataset.grp); drawShare(); }));
    const ea = $("ms-excl-add"); if (ea) ea.addEventListener("change", (e) => { if (e.target.value) { sf.excl.add(e.target.value); sf.exclOn = true; drawShare(); } });
  }

  // ---------- 기업별 시가총액·주가 상세 ----------
  // data/semi_caps.js(시장 비중 표와 같은 기준·시점). 검색·시장·업종·구분·속성·공정 필터, 정렬. 상단 실적 필터와 무관하다.
  // 모바일(860px 이하)은 카드 목록, PC는 표. 두 보기는 같은 rows 를 쓰며 계산을 따로 하지 않는다.
  const cst = { q: "", m: "", k: "", g: "", at: "", pa: "", grp: new Set(), sort: "cap", dir: -1 }; // grp: 프로필 기업 현황의 그룹(1·2·3그룹·추가 기업) 선택 — 여러 개 고를 수 있음
  const grpLabel = {}; (window.COMPANY_GROUPS || []).forEach((g) => { grpLabel[g.id] = g.label; });
  const grpOf = (c) => { const m = {}; (window.COMPANY_GROUPS || []).forEach((g) => g.companies.forEach((x) => { if (x[2]) (m[x[2]] = m[x[2]] || []).push(g.id); })); return m[c] || []; };
  const pcs = (v) => (v == null || !isFinite(v) ? "-" : `<span class="${v > 0 ? "ms-up" : v < 0 ? "ms-dn" : ""}">${v > 0 ? "▲" : v < 0 ? "▼" : ""}${nf(Math.abs(v) * 100, 1)}%</span>`);
  const CCOL = [
    ["rank", "순위", 0], ["n", "기업", 1], ["m", "시장", 1], ["k", "업종", 1], ["p", "종가(원)", 0], ["d1", "분기말 대비", 0], ["d2", "반기말 대비", 0],
    ["s", "상장주식 수", 0], ["cap", "시가총액", 0], ["inK", "업종 내 비중", 0], ["inM", "시장 비중", 0],
  ];
  const SORTS = [["cap", -1, "시가총액 큰 순"], ["cap", 1, "시가총액 작은 순"], ["d1", -1, "분기말 대비 높은 순"], ["d1", 1, "분기말 대비 낮은 순"], ["n", 1, "기업명 순"]];
  const isInfra = (r) => /인프라/.test(r.x || ""), isBig = (r) => !!r.d;
  const tagsOf = (r) => [r.g === "N" ? ["new", "신규"] : null, r.k2 ? ["k2", `보조 ${r.k2}`] : null, isInfra(r) ? ["infra", "인프라"] : null, isBig(r) ? ["big", "대형 겸업"] : null, r.rv ? ["rv", "재검토"] : null, ...(r.grp || []).map((id) => ["grp", `프로필 ${grpLabel[id] || id}`])].filter(Boolean)
    .map(([c, t]) => `<span class="cp-tag cp-tag-${c}">${t}</span>`).join("");
  function capsRows(D) {
    const MT = (window.SEMI_SHARE && window.SEMI_SHARE.marketTotal) || {}, kindCap = {};
    D.rows.forEach((r) => { if (r.cap) kindCap[r.k] = (kindCap[r.k] || 0) + r.cap; });
    const rk = [...D.rows].filter((r) => r.cap).sort((a, b) => b.cap - a.cap).map((r) => r.c);
    const M = window.SEMI_MASTER, corp = {}; if (M) M.rows.forEach((x) => { if (x.corp) corp[x.c] = x.corp; });
    const GM = {}; (window.COMPANY_GROUPS || []).forEach((g) => g.companies.forEach((x) => { if (x[2]) (GM[x[2]] = GM[x[2]] || []).push(g.id); }));
    return D.rows.map((r) => ({ ...r, grp: GM[r.c] || [], corp: corp[r.c] || "", rank: r.cap ? rk.indexOf(r.c) + 1 : null, d1: r.p && r.q1 ? r.p / r.q1 - 1 : null, d2: r.p && r.q2 ? r.p / r.q2 - 1 : null,
      inK: r.cap ? r.cap / kindCap[r.k] : null, inM: r.cap && MT[r.m] ? r.cap / MT[r.m] : null }));
  }
  // 같은 기업임을 종목코드로 확인할 수 있을 때만 상세 화면으로 연결한다(이름이 비슷해도 연결하지 않음)
  const linksOf = (r) => (r.corp ? `<a href="profile.html#${r.corp}">기업 프로필</a><a href="dashboard.html?co=${r.corp}#company">재무 분석</a>` : "");
  const managedHtml = (D) => {
    if (!D.managed || !D.managed.length) return "";
    const G = { H: ["보류", "사업 적합성 추가 확인 중 · 확정 전까지 핵심 통계에서 제외", "필요"], O: ["OSAT(후공정 서비스)", "후공정 서비스 사업으로 소재·부품·장비와 별도 관리", "분류 정책 변경 시"], D: ["유통", "유통 사업으로 소재·부품·장비와 별도 관리", "분류 정책 변경 시"] };
    const sec = ["H", "O", "D"].map((g) => { const L = D.managed.filter((m) => m.g === g); return L.length ? `<h4>${G[g][0]} ${L.length}개사</h4><p class="ms-mut">${G[g][1]}</p><ul class="cp-mg">${L.map((m) => `<li><b>${esc(m.n)}</b><small>${esc(m.c)} · ${esc(m.k)}${m.pa ? ` · ${esc(m.pa)}` : ""} · 재검토 ${G[g][2]}</small></li>`).join("")}</ul>` : ""; }).join("");
    return `<details class="db-card cp-managed"><summary><i class="ph ph-archive" aria-hidden="true"></i> 별도 관리 기업 ${nf(D.managed.length)}곳 <small>핵심 모집단(${nf(D.universe ? D.universe.core : D.rows.length)}곳) 통계에는 포함하지 않습니다</small></summary>${sec}</details>`;
  };
  function drawCaps() {
    const root = $("c-caps"); if (!root) return;
    const D = window.SEMI_CAPS;
    if (!D || !D.rows) { root.innerHTML = `<section class="db-card ms-empty"><i class="ph ph-hourglass-medium" aria-hidden="true"></i><p>기업별 시가총액 자료가 아직 없습니다.</p></section>`; return; }
    const all = capsRows(D), q = cst.q.trim().toLowerCase();
    let rows = all.filter((r) => (!cst.m || r.m === cst.m) && (!cst.k || r.k === cst.k) && (!cst.g || r.g === cst.g) && (!q || r.n.toLowerCase().includes(q) || r.c.includes(q))
      && (!cst.at || (cst.at === "k2" ? !!r.k2 : cst.at === "infra" ? isInfra(r) : cst.at === "big" ? isBig(r) : cst.at === "rv" ? !!r.rv : true)) && (!cst.pa || (r.pa || "").startsWith(cst.pa)) && (!cst.grp.size || r.grp.some((id) => cst.grp.has(id))));
    const key = cst.sort, dir = cst.dir;
    rows.sort((a, b) => { const x = a[key], y = b[key]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(y, "ko") : x - y) * dir; });
    const sumCap = rows.reduce((t, r) => t + (r.cap || 0), 0), nCap = rows.filter((r) => r.cap).length;
    const th = CCOL.map(([k, l, left]) => `<th scope="col" class="${left ? "" : "r"}" aria-sort="${cst.sort === k ? (cst.dir > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-sort="${k}">${l}${cst.sort === k ? `<i class="ph ph-caret-${cst.dir > 0 ? "up" : "down"}" aria-hidden="true"></i>` : ""}</button></th>`).join("");
    const body = rows.map((r) => `<tr><td class="r">${r.rank ?? "-"}</td><th scope="row"><b>${esc(r.n)}</b><small>${esc(r.c)}</small>${tagsOf(r) ? `<span class="cp-tags">${tagsOf(r)}</span>` : ""}</th><td>${MKN[r.m] || "코넥스"}</td><td><i class="sq" style="background:${KCOL[r.k]}"></i>${r.k}</td>`
      + `<td class="r">${r.p ? nf(r.p) : "-"}</td><td class="r">${pcs(r.d1)}</td><td class="r">${pcs(r.d2)}</td><td class="r">${r.s ? nf(r.s) : "-"}</td><td class="r"><b>${r.cap ? won(r.cap) : "-"}</b></td><td class="r">${pc2(r.inK)}</td><td class="r">${r.m === "KONEX" ? "-" : pc2(r.inM)}</td></tr>`).join("");
    const cards = rows.map((r) => `<li><details class="cp-card"><summary><span class="cp-c1"><b>${esc(r.n)}</b><small>${esc(r.c)} · ${MKN[r.m] || "코넥스"} · <i class="sq" style="background:${KCOL[r.k]}"></i>${r.k}</small>${tagsOf(r) ? `<span class="cp-tags">${tagsOf(r)}</span>` : ""}</span>`
      + `<span class="cp-c2"><b>${r.cap ? won(r.cap) : "시총 미확보"}</b><small>${pcs(r.d1)}<em>분기말 대비</em></small></span></summary>`
      + `<dl class="cp-dl"><div><dt>순위</dt><dd>${r.rank ?? "-"}</dd></div><div><dt>종가</dt><dd>${r.p ? nf(r.p) + "원" : "-"}</dd></div><div><dt>반기말 대비</dt><dd>${pcs(r.d2)}</dd></div><div><dt>상장주식 수</dt><dd>${r.s ? nf(r.s) : "-"}</dd></div><div><dt>업종 내 비중</dt><dd>${pc2(r.inK)}</dd></div><div><dt>시장 비중</dt><dd>${r.m === "KONEX" ? "-" : pc2(r.inM)}</dd></div>${r.pa ? `<div><dt>적용 공정</dt><dd>${esc(r.pa)}</dd></div>` : ""}${r.k2 ? `<div><dt>보조분류</dt><dd>${esc(r.k2)}</dd></div>` : ""}</dl>`
      + (linksOf(r) ? `<p class="cp-links">${linksOf(r)}</p>` : "") + `</details></li>`).join("");
    const opt = (v, l, cur) => `<option value="${v}"${cur === v ? " selected" : ""}>${l}</option>`;
    const pas = [...new Set(D.rows.map((r) => r.pa).filter(Boolean))].sort(), fabs = pas.filter((x) => x.startsWith("FAB")), pts = pas.filter((x) => x.startsWith("P&T"));
    const keep = document.activeElement && document.activeElement.id === "cp-q";
    const U = D.universe || {}, SH = window.SEMI_SHARE || {};
    root.innerHTML = `<section class="db-card" aria-labelledby="cp-t"><div class="db-card-head"><h2 id="cp-t">기업별 시가총액·주가<small>${esc(D.asOf)} 종가 기준 · 검토용</small></h2></div>
      <p class="cp-def"><b>모집단</b> 핵심 소부장 ${nf(U.core || D.rows.length)}곳(기존 ${nf(U.existing || 0)} + 신규 ${nf(U.new || 0)}) · 시가총액 확인 <b>${nf((SH.counts && SH.counts.withCap) ?? D.rows.filter((r) => r.cap).length)}</b>곳, 미확보 <b>${nf((SH.counts && SH.counts.noCap) ?? D.rows.filter((r) => !r.cap).length)}</b>곳 · 재무 분석 화면의 명단(134곳)과는 목적이 달라 기업 수가 다릅니다</p>
      <div class="cp-tools"><label class="db-sel cp-search"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><span class="sr-only">기업명·종목코드 검색</span><input id="cp-q" type="search" placeholder="기업명·종목코드 검색" value="${esc(cst.q)}" autocomplete="off"></label>
        <label class="db-sel"><i class="ph ph-buildings" aria-hidden="true"></i><span>시장</span><select id="cp-m">${opt("", "전체", cst.m)}${opt("KOSPI", "코스피", cst.m)}${opt("KOSDAQ", "코스닥", cst.m)}${opt("KONEX", "코넥스", cst.m)}</select></label>
        <label class="db-sel"><i class="ph ph-stack" aria-hidden="true"></i><span>업종</span><select id="cp-k">${opt("", "전체", cst.k)}${["소재", "부품", "장비"].map((k) => opt(k, k, cst.k)).join("")}</select></label>
        <label class="db-sel"><i class="ph ph-sparkle" aria-hidden="true"></i><span>구분</span><select id="cp-g">${opt("", "전체", cst.g)}${opt("E", "기존 123", cst.g)}${opt("N", "신규 37", cst.g)}</select></label>
        <label class="db-sel"><i class="ph ph-tag" aria-hidden="true"></i><span>속성</span><select id="cp-at">${opt("", "전체", cst.at)}${opt("k2", "보조분류 있음", cst.at)}${opt("infra", "인프라", cst.at)}${opt("big", "대형 겸업", cst.at)}${opt("rv", "재검토 표시", cst.at)}</select></label>
        <label class="db-sel"><i class="ph ph-flow-arrow" aria-hidden="true"></i><span>적용 공정</span><select id="cp-pa">${opt("", "전체", cst.pa)}${opt("FAB", "FAB 전체", cst.pa)}${fabs.map((x) => opt(x, x, cst.pa)).join("")}${opt("P&T", "P&T 전체", cst.pa)}${pts.map((x) => opt(x, x, cst.pa)).join("")}</select></label>
        <label class="db-sel cp-sortsel"><i class="ph ph-sort-descending" aria-hidden="true"></i><span>정렬</span><select id="cp-sort">${SORTS.map(([k, d, l]) => opt(`${k}|${d}`, l, `${cst.sort}|${cst.dir}`)).join("")}</select></label>
        <div class="cp-grp" role="group" aria-label="프로필 기업 현황 그룹"><span class="cp-grp-l">프로필 그룹</span>${(window.COMPANY_GROUPS || []).map((g) => { const n = D.rows.filter((r) => grpOf(r.c).includes(g.id)).length; return `<label class="ms-chip"><input type="checkbox" data-cgrp="${esc(g.id)}"${cst.grp.has(g.id) ? " checked" : ""}><span>${esc(g.label)}<small>${nf(n)}곳</small></span></label>`; }).join("")}${cst.grp.size ? `<button type="button" class="cp-grp-x" id="cp-grp-x">선택 해제</button>` : ""}</div>
        <button type="button" class="db-btn cp-csv" id="cp-csv"><i class="ph ph-download-simple" aria-hidden="true"></i>CSV 내려받기</button>
        <p class="cp-sum" aria-live="polite"><b>${nf(rows.length)}</b>개 기업 · 시총 확인 ${nf(nCap)}곳 합계 <b>${won(sumCap) || "-"}</b></p></div>
      <div class="ms-scroll cp-tblwrap" tabindex="0" role="region" aria-label="기업별 시가총액 표(좌우로 스크롤)"><table class="ms-tbl cp-tbl"><caption class="sr-only">기업별 시가총액과 주가</caption><thead><tr>${th}</tr></thead><tbody>${body || `<tr><td colspan="11" class="ms-na">조건에 맞는 기업이 없습니다.</td></tr>`}</tbody></table></div>
      <p class="cp-hint" aria-hidden="true"><i class="ph ph-arrows-horizontal"></i> 표를 좌우로 밀어 더 볼 수 있습니다</p>
      <ul class="cp-cards" aria-label="기업 카드 목록">${cards || `<li class="ms-na">조건에 맞는 기업이 없습니다.</li>`}</ul>
      <p class="db-note"><i class="ph ph-info" aria-hidden="true"></i><span>${esc(D.source)}. 분기말 대비는 ${esc(D.prev[0])}, 반기말 대비는 ${esc(D.prev[1])} 종가와 비교한 값이며 액면분할·무상증자 등은 반영하지 않았습니다. 업종 내 비중은 표에 있는 기업 합계 기준, 시장 비중은 해당 시장 전체 시가총액 기준입니다. 시가총액이 비어 있는 기업은 데이터를 확보하지 못한 것이며 0이 아닙니다. 기업 프로필·재무 분석 링크는 종목코드로 같은 기업임을 확인한 경우에만 표시합니다. 투자 권유가 아닙니다.</span></p>
      <p class="cp-xlink"><a href="compare.html">해외 기업 비교 보기 <i class="ph ph-arrow-right" aria-hidden="true"></i></a></p></section>${managedHtml(D)}`;
    root.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => { const k = b.dataset.sort; if (cst.sort === k) cst.dir = -cst.dir; else { cst.sort = k; cst.dir = ["n", "m", "k"].includes(k) ? 1 : -1; } drawCaps(); }));
    [["cp-m", "m"], ["cp-k", "k"], ["cp-g", "g"], ["cp-at", "at"], ["cp-pa", "pa"]].forEach(([id, k]) => $(id).addEventListener("change", (e) => { cst[k] = e.target.value; drawCaps(); }));
    root.querySelectorAll("input[data-cgrp]").forEach((el) => el.addEventListener("change", () => { el.checked ? cst.grp.add(el.dataset.cgrp) : cst.grp.delete(el.dataset.cgrp); drawCaps(); }));
    const gx = $("cp-grp-x"); if (gx) gx.addEventListener("click", () => { cst.grp.clear(); drawCaps(); });
    $("cp-sort").addEventListener("change", (e) => { const [k, d] = e.target.value.split("|"); cst.sort = k; cst.dir = Number(d); drawCaps(); });
    $("cp-csv").addEventListener("click", () => {
      const pr = (v) => (v == null || !isFinite(v) ? "" : +(v * 100).toFixed(2)), mk = { KOSPI: "코스피", KOSDAQ: "코스닥", KONEX: "코넥스" };
      const head = ["순위", "기업명", "종목코드", "시장", "업종", "종가(원)", `${D.prev[0]} 종가(원)`, `${D.prev[1]} 종가(원)`, "분기말 대비(%)", "반기말 대비(%)", "상장주식 수(주)", "시가총액(억 원)", "업종 내 비중(%)", "시장 비중(%)", "기준일(종가)", "모집단 구분", "보조분류", "데이터 출처·산출 기준(비고)"];
      const note = `${D.source}. 시가총액=종가×상장주식 수(보통주). 분기말·반기말 대비는 수정주가 미반영. 빈 칸은 데이터 미확보이며 0이 아님. 핵심 소부장 모집단(기존 123+신규 37) 기준이며 투자 권유가 아닌 참고 자료`;
      const lines = rows.map((r) => [r.rank ?? "", r.n, r.c, mk[r.m] || r.m, r.k, r.p ?? "", r.q1 ?? "", r.q2 ?? "", pr(r.d1), pr(r.d2), r.s ?? "", r.cap ?? "", pr(r.inK), r.m === "KONEX" ? "" : pr(r.inM), D.asOf, r.g === "N" ? "신규" : "기존", r.k2 || "", note]);
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
