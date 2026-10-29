/* 해외 기업 비교 화면: 해외 동종 기업(data/peers.js)과 국내 소부장(metrics.js)을 원화 기준으로 견준다.
   표에 없는 숫자는 만들지 않고 '-'와 이유로 표시한다. 모든 숫자는 올리면(또는 누르면) 출처가 보인다. */
(function () {
  "use strict";
  const SB = window.SB, { esc } = SB.fmt, { med } = SB.math;
  const $ = (id) => document.getElementById(id);
  const P = window.PEERS || {}, MK = (window.MARKET && window.MARKET.list) || {};
  const CTRY = { US: "미국", JP: "일본", NL: "네덜란드", DE: "독일", FR: "프랑스", IL: "이스라엘", CN: "중국", KR: "한국" };
  const CUR = { USD: "달러", JPY: "엔", EUR: "유로", CNY: "위안" };
  const peers = (P.list || []).filter((p) => p.ctry !== "KR");
  peers.forEach((p) => { if (!p.cat) { p.cat = p.kind; p.kind = ["장비", "부품", "소재"].includes(p.kind) ? p.kind : ""; } });
  const CATS = ["장비", "부품", "소재", "후공정·테스트", "팹리스·설계", "제조(IDM·메모리)", "반도체 제조"];
  const tagOf = (p) => p.seg1 || p.cat;
  const state = { kind: "sobu", ctry: "all", sortP: { k: "s1", d: -1 }, sortS: { k: "cap", d: -1 }, co: null };

  // ---------- 표기 ----------
  const nf = (v, d = 0) => v.toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const won = (v) => (v == null ? null : Math.abs(v) >= 10000 ? `${nf(v / 10000, 1)}조` : `${nf(v)}억`);
  const pct = (v, d = 1) => (v == null ? null : `${nf(v, d)}%`);
  const sgn = (v, d = 1) => (v == null ? null : `${v > 0 ? "▲ +" : v < 0 ? "▼ " : ""}${nf(v, d)}%`); // 방향을 기호로도 표시
  const ppp = (v) => (v == null ? null : Math.abs(v) < 0.05 ? "보합" : `${v > 0 ? "▲ +" : "▼ "}${nf(v, 1)}%p`);
  const mgf = (v) => `${v < 0 ? "▼ 적자 " : ""}${nf(v, Math.abs(v) < 0.1 && v !== 0 ? 2 : 1)}%`; // 영업이익률(적자면 글자로도 표시)
  const NA = (why) => `<span class="cm-na" tabindex="0" data-src="확인 필요 · ${esc(why)}">-</span>`;
  const V = (text, src, cls = "") => (text == null ? null : `<span class="cm-n ${cls}" tabindex="0" data-src="${esc(src)}">${text}</span>`);
  const cell = (text, src, why, cls) => V(text, src, cls) || NA(why);

  // ---------- 출처 문구 ----------
  const ST = { "확보": ["ph-check-circle", "ok"], "일부 확보": ["ph-circle-half", "part"], "미확보": ["ph-minus-circle", "no"], "파싱 실패": ["ph-warning", "no"], "접속 실패": ["ph-plugs", "no"] };
  const stBadge = (st, why) => { const [ic, c] = ST[st] || ST["미확보"]; return `<span class="cm-st ${c}" tabindex="0" data-src="${esc(st + (why ? " · " + why : ""))}"><i class="ph ${ic}" aria-hidden="true"></i>${esc(st)}</span>`; };
  const srcLink = (p) => (p.url ? `<a class="cm-src" href="${esc(p.url)}" target="_blank" rel="noopener" data-src="${esc(`${p.src} 원문 열기 · 결산일 ${(p.pe || [])[p.pe ? p.pe.length - 1 : 0] || "-"}`)}"><i class="ph ph-arrow-square-out" aria-hidden="true"></i>${esc(p.src)}</a>` : esc(p.src || "-"));
  const srcPeer = (p, what, i) => {
    const fx = p.fx && p.fx[i] ? ` · 원화 환산 ${p.y[i]}년 평균환율 ${nf(p.fx[i], p.fx[i] < 100 ? 2 : 1)}원/${CUR[p.cur] || p.cur}(ECB)` : "";
    const doc = p.src === "SEC EDGAR" ? "SEC EDGAR 10-K 연결재무제표(XBRL)" : p.src === "Yahoo Finance" ? "Yahoo Finance 연간 재무제표(비공식)" : p.src;
    return `${p.n} ${p.y[i]}년 ${what} · ${doc} · 쪽 번호 없음(공시 API 값)${fx}`;
  };
  const srcMk = (p, what) => `${p.n} ${what} · Yahoo Finance(비공식) · 수집 ${P.updated || "-"} · 쪽 번호 없음`;
  const srcDom = (r, what) => `${r.n} ${what} · DART 사업보고서 개별재무제표 · 쪽 번호 없음(OpenDART API 값)`;

  // ---------- 해외 기업 계산 ----------
  const at = (a, i) => (a && i >= 0 && a[i] != null ? a[i] : null);
  const ratio = (a, b) => (a != null && b != null && b !== 0 ? (a / b) * 100 : null);
  function derive(p) {
    let L = p.y.length - 1;
    while (L > 0 && p.s[L] == null) L--;
    const s1 = at(p.s, L), s0 = at(p.s, L - 1), o1 = at(p.o, L), o0 = at(p.o, L - 1);
    const m = ratio(o1, s1), m0 = s0 > 0 ? ratio(o0, s0) : null;
    return { p, L, fy: p.y[L], s1, s0, o1, g: s0 > 0 && s1 != null ? (s1 / s0 - 1) * 100 : null, m, dm: m != null && m0 != null ? m - m0 : null,
      nm: ratio(at(p.ni, L), s1), ...(() => { const k = Math.min(3, L); const b = at(p.s, L - k); return { cagr: k >= 2 && b > 0 && s1 > 0 ? (Math.pow(s1 / b, 1 / k) - 1) * 100 : null, cagrN: k }; })(),
      rd: ratio(at(p.rd, L), s1), debt: at(p.te, L) > 0 ? ratio(at(p.tl, L), at(p.te, L)) : null, roe: at(p.te, L) > 0 ? ratio(at(p.ni, L), at(p.te, L)) : null, mk: p.mk || {} };
  }
  let all = peers.map(derive), rows = [];

  // ---------- 국내 소부장(개별, 대시보드와 같은 산식) ----------
  const FY = SB.DEFAULT_FY;
  const dom = SB.panel(SB.recs.filter(SB.makeFilter({ ...SB.DEFAULTS, fy: FY }, null).inFilter), FY);
  const domKind = () => (SB.KINDS.includes(state.kind) ? dom.filter((r) => r.kind === state.kind) : dom);
  const domStat = (list) => ({ n: list.length, m: med(list.map((r) => r.m)), g: med(list.map((r) => r.g)) });

  // ---------- 기준 차이(표 위에 항상) ----------
  function basis() {
    const mts = [...new Set(rows.map((r) => r.p.mt).filter(Boolean))].sort((a, b) => a - b);
    const fys = rows.length ? `${Math.min(...rows.map((r) => r.fy))}~${Math.max(...rows.map((r) => r.fy))}` : "-";
    return `<div class="cm-basis" role="note"><b><i class="ph ph-info" aria-hidden="true"></i>비교 기준이 다릅니다</b><ul>
      <li><span>재무제표</span>해외 <b>연결</b> · 국내 <b>개별</b> — 같은 기준이 아닙니다</li>
      <li><span>결산</span>해외 ${mts.length ? mts.map((m) => m + "월").join("·") : "-"} 결산(최근 ${fys}년) · 국내 ${FY}년, 대부분 12월 결산</li>
      <li><span>통화</span>해외 ${[...new Set(rows.map((r) => CUR[r.p.cur] || r.p.cur))].join("·") || "-"} → <b>원화 환산</b>(손익은 회계연도 평균 환율, 재무상태표는 결산일 환율, ECB) · 국내 원화</li></ul></div>`;
  }

  // ---------- 막대 목록(원형 차트 없음, 음수 지원) ----------
  function bars(items, fmt) {
    const vals = items.filter((i) => i.v != null).map((i) => i.v);
    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1, z = ((0 - lo) / span) * 100;
    return `<ul class="cm-bars">${items.map((i) => {
      if (i.head) return `<li class="gh">${esc(i.head)}</li>`;
      const left = i.v == null ? 0 : ((Math.min(i.v, 0) - lo) / span) * 100, w = i.v == null ? 0 : (Math.abs(i.v) / span) * 100;
      return `<li class="${i.dom ? "dom" : ""}"><span class="nm">${esc(i.name)}<small>${esc(i.tag)}</small></span>
        <span class="trk"><i class="zero" style="left:${z}%"></i>${i.v == null ? "" : `<span class="bar ${i.v < 0 ? "neg" : ""}" style="left:${left}%;width:${Math.max(w, 0.8)}%"></span>`}</span>
        <b>${i.v == null ? NA(i.why || "값 없음") : V(fmt(i.v), i.src)}</b></li>`;
    }).join("")}</ul>`;
  }
  function group(metric, key, fmt, whyNone) {
    const items = [], d = domStat(domKind()), dv = d[key];
    items.push({ head: `국내 소부장 (개별 · ${FY}년 · ${d.n}곳 중앙값)` });
    items.push({ name: SB.KINDS.includes(state.kind) ? `국내 ${state.kind}` : "국내 소부장 중앙값", tag: "국내", dom: true, v: dv,
      src: `국내 ${d.n}곳 ${metric} 중앙값 · DART 사업보고서 개별재무제표 · ${FY}년`, why: "국내 소부장에 해당 업종이 없음" });
    const ctrys = [...new Set(rows.map((r) => r.p.ctry))];
    if (!state.each) { // 국가별 중앙값(기업이 많아도 30초 안에 읽히게). '기업별 보기'로 펼친다
      items.push({ head: `해외 (연결 · 원화 환산 · 국가별 중앙값)` });
      ctrys.map((c) => { const g = rows.filter((r) => r.p.ctry === c); return { c, n: g.length, v: med(g.map((r) => r[key])) }; })
        .sort((a, b) => (b.v ?? -1e9) - (a.v ?? -1e9))
        .forEach((x) => items.push({ name: CTRY[x.c] || x.c, tag: `${x.n}곳`, v: x.v, src: `${CTRY[x.c] || x.c} ${x.n}곳 ${metric} 중앙값 · 출처는 '기업별 보기'에서 회사별로 확인`, why: "값이 있는 기업이 없음" }));
    } else ctrys.forEach((c) => {
      const grp = rows.filter((r) => r.p.ctry === c).sort((a, b) => (b[key] ?? -1e9) - (a[key] ?? -1e9));
      items.push({ head: `${CTRY[c] || c} (연결 · 원화 환산 · ${grp.length}곳)` });
      grp.forEach((r) => items.push({ name: r.p.n, tag: tagOf(r.p), v: r[key], src: srcPeer(r.p, metric, r.L), why: whyNone(r) }));
    });
    return bars(items, fmt) + `<p class="db-more"><button class="db-link" type="button" data-each>${state.each ? "국가별 중앙값으로 접기" : `기업별 보기(${rows.length}곳)`}</button></p>`;
  }

  // ---------- 화면 ----------
  const kpi = (icon, lab, val, sub) => `<article class="db-kpi"><p class="lab"><i class="ph ${icon}" aria-hidden="true"></i>${lab}</p><strong>${val}</strong><p class="delta"><span class="vs">${sub}</span></p></article>`;
  const diff = (a, b, unit = "%p") => (a == null || b == null ? "비교 불가" : `${a - b >= 0 ? "▲ 해외가 " : "▼ 해외가 "}${nf(Math.abs(a - b), 1)}${unit} ${a - b >= 0 ? "높음" : "낮음"}`);

  function drawOverview() {
    const dk = domStat(domKind()), mm = med(rows.map((r) => r.m)), mg = med(rows.map((r) => r.g));
    const above = rows.filter((r) => r.m != null && dk.m != null && r.m > dk.m).length, withM = rows.filter((r) => r.m != null).length;
    const kindTxt = state.kind === "sobu" ? "소부장 " : state.kind === "all" ? "" : `${state.kind} `;
    $("headline").innerHTML = mm == null || dk.m == null ? "해외 비교 데이터를 확인하는 중입니다." :
      `해외 ${kindTxt}${rows.length}곳의 영업이익률 중앙값은 <b>${pct(mm)}</b>로 국내 소부장(${dk.n}곳) <b>${pct(dk.m)}</b>보다 <b>${nf(Math.abs(mm - dk.m), 1)}%p ${mm >= dk.m ? "높고" : "낮고"}</b>, 매출은 해외 ${sgn(mg)} · 국내 ${sgn(dk.g)}입니다.`;
    $("kpis").innerHTML = [
      kpi("ph-percent", "영업이익률 (중앙값)", `${pct(mm) || "-"} <small>vs 국내 ${pct(dk.m) || "-"}</small>`, diff(mm, dk.m)),
      kpi("ph-trend-up", "매출 증감률 (중앙값)", `${sgn(mg) || "-"} <small>vs 국내 ${sgn(dk.g) || "-"}</small>`, diff(mg, dk.g)),
      kpi("ph-ranking", "국내 중앙값보다 이익률 높은 해외 기업", `${above} / ${withM}곳`, "영업이익이 확인된 기업 기준"),
    ].join("");
    $("c-bm").innerHTML = group("영업이익률", "m", mgf, (r) => (r.p.o && r.o1 == null ? "영업이익 항목을 공시 API에서 받지 못함" : "영업이익률 계산 불가"));
    $("c-bg").innerHTML = group("매출 증감률", "g", (v) => sgn(v), () => "전년 매출이 없어 증감률 계산 불가");
  }

  // 정렬 가능한 표
  function table(cols, list, st, onSort) {
    const head = cols.map((c) => `<th scope="col" class="${c.l ? "l" : ""}" aria-sort="${st.k === c.k ? (st.d > 0 ? "ascending" : "descending") : "none"}">${c.sort === false ? c.t : `<button type="button" data-k="${c.k}">${c.t}<i>${st.k === c.k ? (st.d > 0 ? "▲" : "▼") : ""}</i></button>`}</th>`).join("");
    return `<table class="db-tbl cm-tbl"><thead><tr>${head}</tr></thead><tbody>${list.map((r) => `<tr>${cols.map((c) => (c.k === "n" ? `<th scope="row" class="l">${c.f(r)}</th>` : `<td class="${c.l ? "l" : ""}">${c.f(r)}</td>`)).join("")}</tr>`).join("")}</tbody></table>`;
  }
  const sortBy = (list, st) => list.slice().sort((a, b) => { const x = st.k === "n" ? a.p.n : sv(a, st.k), y = st.k === "n" ? b.p.n : sv(b, st.k); return (x == null) - (y == null) || (x > y ? 1 : x < y ? -1 : 0) * st.d; });
  const sv = (r, k) => (k in r ? r[k] : k in r.mk ? r.mk[k] : k === "cat" ? CATS.indexOf(r.p.cat) : k === "cagr" ? r.cagr : k === "ctry" ? r.p.ctry : k === "mt" ? r.p.mt : null);

  function drawPerf() {
    const co = (r) => `<a href="#perf" data-co="${r.p.k}">${esc(r.p.n)}</a>`;
    const why = (r, w) => `${r.p.n}: ${w}`;
    const cols = [
      { k: "n", t: "기업", l: 1, f: (r) => co(r) }, { k: "ctry", t: "국가", l: 1, f: (r) => CTRY[r.p.ctry] || r.p.ctry }, { k: "cat", t: "분야", l: 1, f: (r) => `${esc(r.p.cat)}${r.p.seg1 ? `<small>${esc(r.p.seg1)}${r.p.seg2 ? " · " + esc(r.p.seg2) : ""}</small>` : ""}` },
      { k: "mt", t: "결산", f: (r) => `${r.p.mt}월<small>${r.fy}년</small>` }, { k: "cur", t: "통화", sort: false, f: (r) => CUR[r.p.cur] || r.p.cur },
      { k: "s1", t: "매출", f: (r) => cell(won(r.s1), srcPeer(r.p, "매출", r.L), why(r, "매출 값을 받지 못함")) },
      { k: "g", t: "매출 증감률", f: (r) => cell(sgn(r.g), srcPeer(r.p, "매출 증감률(전년 대비)", r.L), why(r, "전년 매출이 없어 계산 불가")) },
      { k: "o1", t: "영업이익", f: (r) => cell(won(r.o1), srcPeer(r.p, "영업이익", r.L), why(r, "영업이익 항목을 받지 못함")) },
      { k: "m", t: "영업이익률", f: (r) => cell(r.m == null ? null : mgf(r.m), srcPeer(r.p, "영업이익률(영업이익÷매출)", r.L), why(r, "영업이익이 없어 계산 불가")) },
      { k: "rd", t: "R&amp;D 비중", f: (r) => cell(pct(r.rd), srcPeer(r.p, "R&D 비중(연구개발비÷매출)", r.L), why(r, "연구개발비 항목을 받지 못함")) },
      { k: "nm", t: "순이익률", f: (r) => cell(r.nm == null ? null : mgf(r.nm), srcPeer(r.p, "순이익률(순이익÷매출)", r.L), why(r, "순이익 항목을 받지 못함")) },
      { k: "cagr", t: "연평균 성장률", f: (r) => cell(r.cagr == null ? null : `${sgn(r.cagr)}<small>${r.cagrN}년</small>`, srcPeer(r.p, `매출 ${r.cagrN}년 연평균 성장률(CAGR)`, r.L), why(r, "비교할 과거 매출이 부족함")) },
      { k: "debt", t: "부채비율", f: (r) => cell(pct(r.debt, 0), srcPeer(r.p, "부채비율(부채÷자본)", r.L), why(r, "부채·자본 항목을 받지 못함")) },
      { k: "st", t: "원문", sort: false, f: (r) => srcLink(r.p) },
    ];
    $("c-ptbl").innerHTML = table(cols, sortBy(rows, state.sortP), state.sortP);
    $("c-ptbl").onclick = (e) => { const b = e.target.closest("button[data-k]"); if (b) { state.sortP = { k: b.dataset.k, d: state.sortP.k === b.dataset.k ? -state.sortP.d : -1 }; drawPerf(); } };
    $("c-mchg").innerHTML = bars([...rows].sort((a, b) => (b.dm ?? -1e9) - (a.dm ?? -1e9)).map((r) => ({ name: r.p.n, tag: tagOf(r.p), v: r.dm, src: srcPeer(r.p, "영업이익률 전년 대비 변화(%p)", r.L), why: "전년 영업이익률을 알 수 없음" })), (v) => ppp(v));
    const sel = $("co-sel");
    sel.innerHTML = rows.map((r) => `<option value="${esc(r.p.k)}"${r.p.k === state.co ? " selected" : ""}>${esc(r.p.n)}</option>`).join("");
    drawDetail();
  }

  function drawDetail() {
    const r = rows.find((x) => x.p.k === state.co) || rows[0];
    if (!r) { $("c-det").innerHTML = ""; return; }
    state.co = r.p.k;
    const p = r.p, ys = p.y, W = 360, H = 170, n = ys.length, cw = (W - 12) / n;
    const mx = Math.max(...p.s.filter((v) => v != null), 1), by = (v) => H - 40 - ((H - 60) * v) / mx;
    const bs = p.s.map((v, i) => (v == null ? "" : `<rect x="${6 + i * cw + cw * 0.25}" y="${by(v)}" width="${cw * 0.5}" height="${H - 40 - by(v)}" rx="3" fill="var(--blue)"/><text x="${6 + i * cw + cw / 2}" y="${by(v) - 4}" text-anchor="middle" font-size="10" fill="var(--text-2)">${won(v)}</text>`)).join("");
    const mg = p.s.map((v, i) => ratio(p.o && p.o[i], v));
    const xl = ys.map((y, i) => `<text x="${6 + i * cw + cw / 2}" y="${H - 14}" text-anchor="middle" font-size="10.5" fill="var(--text-3)">${y}년</text><text x="${6 + i * cw + cw / 2}" y="${H - 2}" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--text-2)">이익률 ${mg[i] == null ? "-" : nf(mg[i], 1) + "%"}</text>`).join("");
    const q = p.q, qt = q ? `<div class="db-tbl-wrap"><table class="db-tbl cm-tbl"><thead><tr><th class="l">분기</th>${q.labels.map((l) => `<th>${l}</th>`).join("")}</tr></thead><tbody>
      <tr><th class="l" scope="row">매출</th>${q.sales.map((v) => `<td>${cell(won(v), `${p.n} 분기 매출 · ${p.src} · 쪽 번호 없음`, "분기 매출 없음")}</td>`).join("")}</tr>
      <tr><th class="l" scope="row">영업이익</th>${q.op.map((v) => `<td>${cell(won(v), `${p.n} 분기 영업이익 · ${p.src} · 쪽 번호 없음`, "분기 영업이익 항목을 받지 못함")}</td>`).join("")}</tr></tbody></table></div>` : `<p class="db-note"><i class="ph ph-info" aria-hidden="true"></i><span>분기 실적을 받지 못했습니다(-).</span></p>`;
    $("t-det").textContent = `${p.n} · ${CTRY[p.ctry] || p.ctry} · ${p.cat}${p.seg1 ? " · " + p.seg1 : ""}`;
    const LN = { s: "매출", o: "영업이익", ni: "순이익", ta: "총자산", tl: "총부채", te: "자본" };
    const loc = p.loc && p.loc.s ? `원 통화(${p.loc.unit}) ${Object.keys(LN).filter((k) => p.loc[k]).map((k) => `${LN[k]} ${p.loc[k].map((v) => (v == null ? "-" : nf(v))).join("→")}`).join(" · ")}${p.fx ? ` · 평균환율 ${p.fx.map((x) => (x == null ? "-" : nf(x, x < 100 ? 2 : 1))).join("→")}원 (${p.fxs || "ECB"})` : ""}${p.pe ? ` · 결산일 ${p.pe.join(", ")}` : ""}` : "";
    $("c-det").innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(p.n)} 연간 매출(막대)과 영업이익률">${bs}${xl}</svg><p class="db-note"><i class="ph ph-info" aria-hidden="true"></i><span>${esc(loc)}${loc ? " · " : ""}${p.url ? `출처 ${srcLink(p)}` : ""}</span></p>${qt}`;
  }

  // 주식
  const sparkline = (t) => {
    if (!t || t.length < 3) return NA("주가 흐름을 받지 못함");
    const lo = Math.min(...t), hi = Math.max(...t), w = 70, h = 22, pts = t.map((v, i) => `${(i / (t.length - 1)) * w},${h - ((v - lo) / (hi - lo || 1)) * (h - 2) - 1}`).join(" ");
    return `<svg class="cm-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="최근 1년 주가 흐름"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
  };
  function drawStock() {
    const mkRows = rows.filter((r) => r.mk && r.mk.price != null);
    const mdl = (k, f) => med(mkRows.map((r) => (f ? f(r.mk[k]) : r.mk[k])).filter((v) => v != null && v > 0));
    const domM = Object.keys(MK).length ? dom.filter((r) => r.l && MK[r.c]).map((r) => MK[r.c]) : [];
    const dp = med(domM.map((m) => m.per).filter((v) => v > 0)), db = med(domM.map((m) => m.pbr).filter((v) => v > 0));
    const hp = mdl("per"), hb = mdl("pbr"), hr = med(mkRows.map((r) => r.mk.r1y).filter((v) => v != null));
    const cmp = (a, b, u) => (a == null || b == null ? "국내 값 없음" : `${a >= b ? "▲ 해외가 " : "▼ 해외가 "}${nf(Math.abs(a - b), 1)}${u} ${a >= b ? "높음" : "낮음"}`);
    $("kpis-s").innerHTML = [
      kpi("ph-percent", "PER (중앙값, 적자 제외)", `${hp == null ? "-" : nf(hp, 1) + "배"} <small>vs 국내 ${dp == null ? "-" : nf(dp, 1) + "배"}</small>`, cmp(hp, dp, "배")),
      kpi("ph-scales", "PBR (중앙값)", `${hb == null ? "-" : nf(hb, 2) + "배"} <small>vs 국내 ${db == null ? "-" : nf(db, 2) + "배"}</small>`, cmp(hb, db, "배")),
      kpi("ph-chart-line-up", "최근 1년 주가 수익률 (중앙값)", `${hr == null ? "-" : sgn(hr, 0)}`, `해외 ${mkRows.length}곳 · 현지 통화 기준`),
    ].join("");
    const ret = [...mkRows].filter((r) => r.mk.r1y != null).sort((a, b) => b.mk.r1y - a.mk.r1y);
    const it = (r) => ({ name: r.p.n, tag: `${CTRY[r.p.ctry] || r.p.ctry} · ${tagOf(r.p)}`, v: r.mk.r1y, src: srcMk(r.p, "최근 1년 주가 수익률") });
    const short = !state.retAll && ret.length > 15;
    $("c-ret").innerHTML = bars(short ? [{ head: "상위 10" }, ...ret.slice(0, 10).map(it), { head: "하위 5" }, ...ret.slice(-5).map(it)] : ret.map(it), (v) => sgn(v, 0))
      + (ret.length > 15 ? `<p class="db-more"><button class="db-link" type="button" data-retall>${state.retAll ? "상위·하위만 보기" : `전체 보기(${ret.length}곳)`}</button></p>` : "");
    const pts = rows.filter((r) => r.mk && r.mk.per > 0 && r.m != null);
    $("c-psc").innerHTML = scatter(pts);
    const co = (r) => esc(r.p.n);
    const w = (r, x) => `${r.p.n}: ${x}`;
    const cols = [
      { k: "n", t: "기업", l: 1, f: co }, { k: "cap", t: "시가총액", f: (r) => cell(won(r.mk.cap), srcMk(r.p, "시가총액(원화 환산)"), w(r, "시가총액을 받지 못함")) },
      { k: "price", t: "현재가", f: (r) => cell(r.mk.price == null ? null : `${nf(r.mk.price, r.mk.price >= 1000 ? 0 : 2)} ${CUR[r.mk.cur] || r.mk.cur}`, srcMk(r.p, "현재가"), w(r, "주가를 받지 못함")) },
      { k: "per", t: "PER", f: (r) => cell(r.mk.per > 0 ? `${nf(r.mk.per, 1)}배` : null, srcMk(r.p, "PER(최근 12개월 실적)"), w(r, r.mk.per <= 0 ? "적자라 PER 계산 불가" : "PER을 받지 못함")) },
      { k: "pbr", t: "PBR", f: (r) => cell(r.mk.pbr > 0 ? `${nf(r.mk.pbr, 2)}배` : null, srcMk(r.p, "PBR"), w(r, "PBR을 받지 못함")) },
      { k: "mroe", t: "ROE", f: (r) => cell(pct(r.mk.roe), srcMk(r.p, "ROE"), w(r, "ROE를 받지 못함")) },
      { k: "dy", t: "배당수익률", f: (r) => cell(pct(r.mk.dy, 2), srcMk(r.p, "배당수익률"), w(r, "배당 정보 없음(무배당이거나 미제공)")) },
      { k: "r1y", t: "1년 수익률", f: (r) => cell(sgn(r.mk.r1y, 0), srcMk(r.p, "최근 1년 주가 수익률"), w(r, "주가 이력을 받지 못함")) },
      { k: "trend", t: "1년 흐름", sort: false, f: (r) => sparkline(r.mk.trend) },
      { k: "up", t: "목표가 여력", f: (r) => cell(r.mk.target && r.mk.price ? sgn((r.mk.target / r.mk.price - 1) * 100, 0) : null, srcMk(r.p, "목표주가 평균 대비 현재가"), w(r, "증권사 목표주가를 받지 못함")) },
    ];
    mkRows.forEach((r) => { r.r1y = r.mk.r1y; r.up = r.mk.target && r.mk.price ? (r.mk.target / r.mk.price - 1) * 100 : null; r.cap = r.mk.cap; r.price = r.mk.price; r.per = r.mk.per > 0 ? r.mk.per : null; r.pbr = r.mk.pbr; r.mroe = r.mk.roe; });
    $("c-stbl").innerHTML = mkRows.length ? table(cols, sortBy(mkRows, state.sortS), state.sortS) : `<p class="db-note warn"><i class="ph ph-warning" aria-hidden="true"></i><span>주가 지표를 받지 못했습니다(-).</span></p>`;
    $("c-stbl").onclick = (e) => { const b = e.target.closest("button[data-k]"); if (b) { state.sortS = { k: b.dataset.k, d: state.sortS.k === b.dataset.k ? -state.sortS.d : -1 }; drawStock(); } };
  }
  const colOf = (c) => (c === "US" ? "var(--blue)" : c === "JP" ? "var(--orange)" : ["NL", "DE", "FR"].includes(c) ? "var(--purple)" : "var(--gray)");
  function scatter(pts) {
    if (pts.length < 2) return `<p class="db-note"><i class="ph ph-info" aria-hidden="true"></i><span>그릴 수 있는 기업이 부족합니다(-).</span></p>`;
    const W = 520, H = 300, L = 44, R = 16, T = 18, B = 34, xs = pts.map((r) => r.mk.per), ys = pts.map((r) => r.m);
    const CAP = 100, over = xs.filter((v) => v > CAP).length, x1 = Math.min(Math.max(...xs), CAP) * 1.1, y0 = Math.min(0, ...ys) - 2, y1 = Math.max(...ys) + 3, X = (v) => L + (v / x1) * (W - L - R), Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
    // 이름은 겹치지 않는 점에만 적는다(나머지는 점에 올리면 보인다)
    const placed = pts.map((r) => ({ x: X(Math.min(r.mk.per, 105)) - 5, y: Y(r.m), w: 10 })), labelOk = (x, y, w) => { if (placed.some((b) => x < b.x + b.w && x + w > b.x && Math.abs(y - b.y) < 12)) return false; placed.push({ x, y, w }); return true; };
    const order = pts.slice().sort((a, b) => b.p.s[b.L] - a.p.s[a.L]);
    const dots = order.map((r) => { const x = X(Math.min(r.mk.per, CAP * 1.05)), y = Y(r.m), w = r.p.n.length * 6 + 4, lab = x + 8 + w < W && labelOk(x + 8, y, w);
      return `<g class="cm-pt" tabindex="0" data-src="${esc(`${r.p.n}(${CTRY[r.p.ctry] || r.p.ctry}) · PER ${nf(r.mk.per, 1)}배 · 영업이익률 ${nf(r.m, 1)}% · ${srcMk(r.p, "PER")}`)}"><circle cx="${x}" cy="${y}" r="5" fill="${colOf(r.p.ctry)}" stroke="var(--card)" stroke-width="1.5"/>${lab ? `<text x="${x + 8}" y="${y + 4}" font-size="10.5" fill="var(--text-2)">${esc(r.p.n)}</text>` : ""}</g>`; }).join("");
    const ctrys = [...new Set(pts.map((r) => r.p.ctry))];
    const grpOf = (c) => (c === "US" ? "US" : c === "JP" ? "JP" : ["NL", "DE", "FR"].includes(c) ? "EU" : "ETC");
    const stepX = x1 > 80 ? 20 : x1 > 40 ? 10 : 5, stepY = y1 - y0 > 60 ? 20 : y1 - y0 > 25 ? 10 : 5, gx = [], gy = [];
    for (let v = 0; v <= x1; v += stepX) gx.push(v);
    for (let v = Math.ceil(y0 / stepY) * stepY; v <= y1; v += stepY) gy.push(v);
    const grid = gx.map((v) => `<line x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${H - B}" stroke="var(--grid)"/><text x="${X(v)}" y="${H - B + 14}" text-anchor="middle" font-size="10.5" fill="var(--text-3)">${v}</text>`).join("")
      + gy.map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v === 0 ? "var(--text-3)" : "var(--grid)"}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="10.5" fill="var(--text-3)">${v}%</text>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="PER과 영업이익률 분포">${grid}<text x="${W - R}" y="${H - 2}" text-anchor="end" font-size="11" fill="var(--text-3)">PER(배) →</text><text x="4" y="10" font-size="11" fill="var(--text-3)">영업이익률 ↑</text>${dots}</svg><ul class="db-legend">${[["US", "미국", "var(--blue)"], ["JP", "일본", "var(--orange)"], ["EU", "유럽", "var(--purple)"], ["ETC", "이스라엘·중국", "var(--gray)"]].filter(([g]) => ctrys.some((x) => grpOf(x) === g)).map(([, l, col]) => `<li><i class="sq" style="background:${col}"></i>${l}</li>`).join("")}<li>이름이 없는 점은 올리면 기업명이 보입니다</li>${over ? `<li>PER ${CAP}배 초과 ${over}곳은 오른쪽 끝에 모아 표시</li>` : ""}</ul>`;
  }

  // 국내 대비
  function drawDomestic() {
    const dk = domStat(domKind());
    const kinds = [...new Set([...SB.KINDS.filter((k) => k !== SB.NA && dom.some((r) => r.kind === k)), ...rows.map((r) => r.p.kind).filter(Boolean)])];
    const itemsFor = (key, fmt, metric) => {
      const it = [];
      kinds.forEach((k) => {
        const d = domStat(dom.filter((r) => r.kind === k)), h = med(rows.filter((r) => r.p.kind === k).map((r) => r[key])), hn = rows.filter((r) => r.p.kind === k).length;
        it.push({ head: k });
        it.push({ name: "해외 중앙값", tag: `${hn}곳 · 연결`, v: hn ? h : null, src: `해외 ${k} ${hn}곳 ${metric} 중앙값 · ${rows.map((r) => r.p.src)[0] || "-"} · 원화 환산`, why: "해외 비교 기업이 없음" });
        it.push({ name: "국내 중앙값", tag: `${d.n}곳 · 개별`, dom: true, v: d.n ? d[key] : null, src: `국내 ${k} ${d.n}곳 ${metric} 중앙값 · DART 사업보고서 개별재무제표 · ${FY}년`, why: "국내 소부장에 해당 업종이 없음(반도체 제조는 소부장이 아님)" });
      });
      return bars(it, fmt);
    };
    $("c-dm").innerHTML = itemsFor("m", mgf, "영업이익률");
    $("c-dg").innerHTML = itemsFor("g", (v) => sgn(v), "매출 증감률");
    const hm = med(rows.map((r) => r.m)), hg = med(rows.map((r) => r.g));
    $("kpis-d").innerHTML = [
      kpi("ph-percent", "영업이익률 격차(해외 − 국내)", dk.m == null || hm == null ? "-" : `${hm - dk.m >= 0 ? "▲ +" : "▼ "}${nf(hm - dk.m, 1)}%p`, `해외 ${pct(hm) || "-"} · 국내 ${pct(dk.m) || "-"}`),
      kpi("ph-trend-up", "매출 증감률 격차(해외 − 국내)", dk.g == null || hg == null ? "-" : `${hg - dk.g >= 0 ? "▲ +" : "▼ "}${nf(hg - dk.g, 1)}%p`, `해외 ${sgn(hg) || "-"} · 국내 ${sgn(dk.g) || "-"}`),
      kpi("ph-buildings", "비교 표본", `해외 ${rows.length}곳 · 국내 ${dk.n}곳`, "국내는 대시보드 기본 조건(대형사 포함)"),
    ].join("");
    // 밸류에이션 표
    const val = kinds.map((k) => {
      const d = dom.filter((r) => r.kind === k && r.l && MK[r.c]).map((r) => MK[r.c]), h = rows.filter((r) => r.p.kind === k && r.mk && r.mk.price != null).map((r) => r.mk);
      const m = (a, key) => med(a.map((x) => x[key]).filter((v) => v > 0));
      const c = (v, d_, src, u) => (v == null ? NA("해당 업종의 주가 지표 없음") : V(`${nf(v, d_)}${u}`, src));
      return `<tr><th scope="row" class="l">${esc(k)}</th><td>${c(m(h, "per"), 1, `해외 ${k} PER 중앙값 · Yahoo Finance(비공식)`, "배")}</td><td>${c(m(d, "per"), 1, `국내 ${k} PER 중앙값 · 네이버증권 ${(window.MARKET || {}).updated || ""}`, "배")}</td><td>${c(m(h, "pbr"), 2, `해외 ${k} PBR 중앙값 · Yahoo Finance(비공식)`, "배")}</td><td>${c(m(d, "pbr"), 2, `국내 ${k} PBR 중앙값 · 네이버증권`, "배")}</td></tr>`;
    }).join("");
    $("c-dv").innerHTML = `<table class="db-tbl cm-tbl"><thead><tr><th class="l">업종</th><th>해외 PER</th><th>국내 PER</th><th>해외 PBR</th><th>국내 PBR</th></tr></thead><tbody>${val}</tbody></table>`;
  }

  function limits() {
    const fy = rows.length ? [...new Set(rows.map((r) => r.fy))].sort().join("·") : "-";
    $("c-lim").innerHTML = [
      "해외는 연결, 국내는 개별 재무제표라 같은 기준이 아닙니다. 해외 기업은 규모와 사업 구조가 커 국내 협력사와 '업종 이름'만 같을 수 있습니다.",
      `결산월(해외 최근 ${fy}년 결산 vs 국내 ${FY}년)과 환율(평균환율 환산)이 달라 작은 차이는 의미가 없습니다. 비교 기업은 대표 기업을 고른 표본입니다.`,
      "해외 값은 공시·시세 API에서 받아 쪽 번호가 없고, 받지 못한 항목은 '-'로 두었습니다. 주가 지표는 비공식 출처(야후)를 포함합니다.",
    ].map((t) => `<li>${esc(t)}</li>`).join("");
  }

  // ---------- 필터·화면 전환 ----------
  function drawFilters() {
    const kinds = CATS.filter((c) => all.some((r) => r.p.cat === c)), ctrys = [...new Set(all.map((r) => r.p.ctry))];
    const opt = (v, t, c) => `<option value="${v}"${v === c ? " selected" : ""}>${t}</option>`;
    $("f-kind").innerHTML = opt("sobu", "소부장(장비·부품·소재·후공정)", state.kind) + opt("all", "전체(팹리스·IDM 포함)", state.kind) + kinds.map((k) => opt(k, k, state.kind)).join("");
    $("f-ctry").innerHTML = opt("all", "전체", state.ctry) + ctrys.map((c) => opt(c, CTRY[c] || c, state.ctry)).join("");
  }
  // 수집 현황: 기업 마스터 전체(실패 포함)와 품질 지표
  const MASTER = P.master || peers.map((p) => ({ k: p.k, n: p.n, ctry: p.ctry, cat: p.cat, seg1: p.seg1, tk: p.tk, src: p.src, st: p.st || "확보", why: p.why || "" }));
  const OFFICIAL = ["SEC EDGAR", "DART 연결"];
  function drawCoverage() {
    const M = MASTER.filter((m) => m.ctry !== "KR"), byK = new Map(peers.map((p) => [p.k, p]));
    const n = M.length, got = M.filter((m) => m.st === "확보" || m.st === "일부 확보").length, full = M.filter((m) => m.st === "확보").length;
    const withUrl = M.filter((m) => byK.get(m.k) && byK.get(m.k).url).length, official = M.filter((m) => OFFICIAL.includes(m.src)).length;
    const pc_ = (a) => (n ? `${nf((a / n) * 100, 0)}%` : "-");
    $("kpis-c").innerHTML = [
      kpi("ph-database", "재무정보 확보율", pc_(got), `${got} / ${n}곳 · 매출 등 일부라도 확보`),
      kpi("ph-check-square", "핵심 항목 완전성", pc_(full), `매출·영업이익·순이익 모두 확보 ${full}곳`),
      kpi("ph-link", "원문 추적률", pc_(withUrl), `출처 URL 연결 ${withUrl}곳 · 공식 공시(SEC·DART) ${official}곳`),
      kpi("ph-warning", "미확보·실패", `${n - got}곳`, P.sec === "blocked" ? "SEC는 클라우드 접속 차단 → 야후로 대체" : "상태 열의 이유 참고"),
    ].join("");
    $("cov-sub").textContent = `${n}곳 · 수집 ${P.at ? P.at.replace("T", " ").replace("Z", " UTC") : P.updated || "-"}`;
    $("st-legend").innerHTML = Object.keys(ST).map((k) => `<li>${stBadge(k, "")}</li>`).join("") + `<li class="rule">값이 없으면 0이 아니라 '-'로 둡니다. 상태에 올리면 이유가 보입니다.</li>`;
    $("c-cov").innerHTML = `<table class="db-tbl cm-tbl"><thead><tr><th class="l">기업</th><th class="l">국가</th><th class="l">분야</th><th class="l">티커</th><th class="l">출처</th><th class="l">결산일</th><th class="l">상태</th></tr></thead><tbody>${M.map((m) => {
      const p = byK.get(m.k);
      return `<tr><th scope="row" class="l">${esc(m.n)}</th><td class="l">${CTRY[m.ctry] || m.ctry}</td><td class="l">${esc(m.cat)}<small>${esc(m.seg1 || "")}</small></td><td class="l">${esc(m.tk || "-")}</td><td class="l">${p ? srcLink(p) : esc(m.src || "-")}</td><td class="l">${p && p.pe ? esc(p.pe[p.pe.length - 1]) : "-"}</td><td class="l">${stBadge(m.st, m.why)}</td></tr>`;
    }).join("")}</tbody></table>`;
    const routes = [["미국", P.sec === "blocked" ? "야후 파이낸스(비공식, 대체)" : "SEC EDGAR XBRL(공식)", P.sec === "blocked" ? "SEC가 클라우드 접속을 막아(403) 대체 중 · 사내 서버에서 실행하면 공식 경로 가능" : "공식 공시"], ["일본", "야후 파이낸스(비공식)", "EDINET 공식 API는 인증키 필요 → 다음 단계"], ["유럽", "야후 파이낸스(비공식)", "ESEF(filings.xbrl.org) 연동은 다음 단계"], ["이스라엘·중국", "야후 파이낸스(비공식)", "현지 공시(CNINFO 등)는 다음 단계"], ["한국 대형사(참고)", "DART 연결재무제표(공식)", "국내 비교 화면에서는 제외"]];
    $("c-route").innerHTML = `<table class="db-tbl cm-tbl"><thead><tr><th class="l">국가·지역</th><th class="l">현재 수집 경로</th><th class="l">상태·다음 단계</th></tr></thead><tbody>${routes.map((r) => `<tr><th scope="row" class="l">${r[0]}</th><td class="l">${r[1]}</td><td class="l">${r[2]}</td></tr>`).join("")}</tbody></table>`;
  }
  // 표준화 데이터(기업·연도별 한 줄): 원 통화 값과 원화 환산값, 환율·출처를 함께
  $("csv-std") && $("csv-std").addEventListener("click", () => {
    const head = ["company_id", "legal_name", "country_code", "ticker", "category", "primary_segment", "secondary_segment", "fiscal_year", "period_end", "currency",
      "revenue_mil", "operating_income_mil", "net_income_mil", "total_assets_mil", "total_liabilities_mil", "equity_mil",
      "revenue_krw_eok", "operating_income_krw_eok", "net_income_krw_eok", "fx_avg_krw", "fx_close_krw", "fx_source", "accounting_standard", "consolidation_scope", "source", "source_url", "status", "collected_at"];
    const v = (x) => (x == null ? "" : x);
    const lines = [];
    peers.forEach((p) => p.y.forEach((y, i) => {
      const L = p.loc || {};
      const loc = (k) => (L[k] ? L[k][i] : p.cur === "KRW" ? p[k] && p[k][i] : null);
      lines.push([p.k, p.n, p.ctry, p.tk, p.cat, p.seg1, p.seg2, y, (p.pe || [])[i], p.cur, loc("s"), loc("o"), loc("ni"), loc("ta"), loc("tl"), loc("te"),
        p.s[i], p.o && p.o[i], p.ni && p.ni[i], p.fx && p.fx[i], p.fxb && p.fxb[i], p.fxs, p.std, p.scope, p.src, p.url, p.st, p.at].map(v));
    }));
    const csv = "\ufeff" + [head, ...lines].map((a) => a.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `해외기업_재무_표준화_${P.updated || ""}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  const VIEWS = ["overview", "perf", "stock", "coverage", "domestic"];
  function show(v) {
    if (!VIEWS.includes(v)) v = "overview";
    document.querySelectorAll(".db-view").forEach((el) => (el.hidden = el.dataset.view !== v));
    document.querySelectorAll("#views-nav a").forEach((a) => a.setAttribute("aria-current", a.dataset.view === v));
    window.scrollTo({ top: 0 });
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
  function render() {
    const SOBU = ["장비", "부품", "소재", "후공정·테스트"];
    rows = all.filter((r) => (state.kind === "all" || (state.kind === "sobu" ? SOBU.includes(r.p.cat) : r.p.cat === state.kind)) && (state.ctry === "all" || r.p.ctry === state.ctry));
    document.querySelectorAll(".cm-basis-slot").forEach((el) => (el.innerHTML = basis()));
    $("sub").textContent = `해외 ${rows.length}곳 · 원화 환산 · 국내 소부장(${FY}년 개별 기준)과 비교`;
    if (!rows.length) {
      $("empty-panel").hidden = false;
      $("empty-panel").innerHTML = `<i class="ph ph-funnel-x" aria-hidden="true"></i><div><b>${all.length ? "조건에 맞는 해외 기업이 없습니다." : "해외 기업 데이터를 아직 받지 못했습니다."}</b><p>${all.length ? "업종·국가 조건을 풀어 보세요." : "매일 아침 자동으로 다시 수집합니다."}</p></div>`;
      document.querySelectorAll(".db-view").forEach((el) => (el.hidden = true));
      return;
    }
    $("empty-panel").hidden = true;
    show(location.hash.slice(1));
    drawOverview(); drawPerf(); drawStock(); drawCoverage(); drawDomestic(); limits();
  }

  $("filter-toggle").addEventListener("click", () => { const o = $("filters").classList.toggle("open"); $("filter-toggle").setAttribute("aria-expanded", o); });
  $("f-kind").addEventListener("change", (e) => { state.kind = e.target.value; render(); });
  $("f-ctry").addEventListener("change", (e) => { state.ctry = e.target.value; render(); });
  $("filters").addEventListener("reset", (e) => { e.preventDefault(); state.kind = "sobu"; state.ctry = "all"; drawFilters(); render(); });
  document.addEventListener("click", (e) => { if (e.target.closest("[data-each]")) { state.each = !state.each; drawOverview(); } if (e.target.closest("[data-retall]")) { state.retAll = !state.retAll; drawStock(); } });
  $("co-sel").addEventListener("change", (e) => { state.co = e.target.value; drawDetail(); });
  document.addEventListener("click", (e) => { const a = e.target.closest("[data-co]"); if (a) { state.co = a.dataset.co; $("co-sel").value = state.co; drawDetail(); } });
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));
  window.addEventListener("resize", pill);

  // ---------- 출처 말풍선(마우스·키보드·터치) ----------
  const tip = $("cm-tip");
  const place = (el) => {
    const t = el.closest("[data-src]");
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.dataset.src; tip.hidden = false;
    const r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    tip.style.top = `${r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8}px`;
  };
  document.addEventListener("mouseover", (e) => place(e.target));
  document.addEventListener("focusin", (e) => place(e.target));
  document.addEventListener("click", (e) => place(e.target));
  document.addEventListener("scroll", () => (tip.hidden = true), true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") tip.hidden = true; });

  // 화면 모드
  const tb = $("theme-btn");
  if (tb) {
    const cur = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const paint = () => { const d = cur() === "dark"; tb.innerHTML = `<i class="ph ph-${d ? "sun" : "moon"}" aria-hidden="true"></i>`; tb.title = d ? "밝은 화면으로" : "어두운 화면으로"; };
    tb.addEventListener("click", () => { const t = cur() === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = t; try { localStorage.setItem("sobujang:theme", t); } catch (e) { /* 저장 불가 */ } paint(); });
    paint();
  }

  $("updated").textContent = P.updated || "-";
  drawFilters();
  render();
  window.addEventListener("load", pill);
})();
