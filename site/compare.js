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
  // 구분은 소재·장비·부품 세 가지. 소부장이 아닌 기업(팹리스·IDM·OSAT)은 '참고'로 두고 선택할 때만 보인다
  const SOBU = ["소재", "장비", "부품"], REF = "참고(반도체 제조)";
  peers.forEach((p) => {
    if (!SOBU.includes(p.kind)) p.kind = "";
    p.cat = p.kind || REF;
  });
  const CATS = [...SOBU, REF];
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

  // ---------- 개요(대시보드 경영 개요와 같은 구성) ----------
  const { sum } = SB.math;
  // 해외 합산: 최근 회계연도(회사마다 결산월이 달라 각 사의 최근 연도를 더한다). 증감은 두 해 모두 있는 같은 기업 기준
  function aggP(list) {
    const two = list.filter((r) => r.s0 > 0 && r.s1 != null), op = list.filter((r) => r.o1 != null), op2 = list.filter((r) => r.o1 != null && at(r.p.o, r.L - 1) != null && r.s0 > 0);
    const o0 = sum(op2.map((r) => at(r.p.o, r.L - 1))), o1b = sum(op2.map((r) => r.o1));
    const m = share(sum(op.map((r) => r.o1)), sum(op.map((r) => r.s1))), m0 = share(o0, sum(op2.map((r) => r.s0)));
    return { n: list.length, s1: sum(list.map((r) => r.s1)), g: two.length ? (sum(two.map((r) => r.s1)) / sum(two.map((r) => r.s0)) - 1) * 100 : null,
      o1: sum(op.map((r) => r.o1)), og: o0 > 0 ? (o1b / o0 - 1) * 100 : null, m, m0, dm: m != null && m0 != null ? m - m0 : null,
      medM: med(list.map((r) => r.m)), medG: med(list.map((r) => r.g)), nOp: op.length, loss: op.filter((r) => r.o1 < 0).length,
      profit: share(op.filter((r) => r.o1 > 0).length, op.length), up: share(list.filter((r) => r.g > 0).length, two.length) };
  }
  const share = (a, b) => (b ? (a / b) * 100 : null);
  const delta = (v, txt, unit) => (v == null ? `<span class="vs">${txt} 비교 불가</span>` : `<b class="${v > 0 ? "up" : v < 0 ? "down" : ""}">${v > 0 ? "▲" : v < 0 ? "▼" : ""} ${unit === "pp" ? `${v > 0 ? "+" : ""}${nf(v, 1)}%p` : `${v > 0 ? "+" : ""}${nf(v, 1)}%`}</b><span class="vs">${txt}</span>`);
  const kpi6 = (o) => `<article class="db-kpi${o.hero ? " hero" : ""}"><p class="lab"><i class="ph ${o.icon}" aria-hidden="true"></i>${o.label}</p><strong>${o.value}</strong><p class="delta">${o.delta}</p></article>`;
  const checkRows = () => rows.filter((r) => (r.o1 != null && r.o1 < 0) || (r.dm != null && r.dm <= -5));

  function drawOverview() {
    const A = aggP(rows), D = SB.stats(domKind()), fys = [...new Set(rows.map((r) => r.fy))].sort(), fyTxt = fys.length > 1 ? `${fys[0]}~${fys[fys.length - 1]}` : fys[0];
    const chk = checkRows().length;
    $("headline").innerHTML = `<b>최근 회계연도(${fyTxt}년) 해외 ${A.n}곳 매출 ${won(A.s1)}원(${sgn(A.g) || "-"}), 영업이익률 ${pct(A.m) || "-"}(${ppp(A.dm) || "-"}).</b> `
      + (chk ? `<a href="#perf" data-checksort>적자·이익률 급락 확인 ${chk}곳 보기 <i class="ph ph-arrow-right" aria-hidden="true"></i></a>` : "");
    $("kpis").innerHTML = [
      { hero: 1, icon: "ph-currency-krw", label: `합산 매출 · ${A.n}곳 · 원화 환산`, value: `${won(A.s1)}<small>원</small>`, delta: delta(A.g, "동일 기업 기준") },
      { icon: "ph-coins", label: "영업이익", value: won(A.o1) || "-", delta: A.og == null ? `<span class="vs">전년 적자·비교 불가</span>` : delta(A.og, "전년 대비") },
      { icon: "ph-percent", label: "영업이익률(합산)", value: pct(A.m) || "-", delta: `${delta(A.dm, `전년 ${pct(A.m0) || "-"}`, "pp")}<span class="vs db-sub2">업체 중앙값 ${pct(A.medM) || "-"}</span>` },
      { icon: "ph-check-circle", label: "흑자 업체 비중", value: pct(A.profit, 0) || "-", delta: `<span class="vs">영업적자 ${A.loss}곳 / ${A.nOp}곳</span>` },
      { icon: "ph-arrow-fat-lines-up", label: "매출 증가 업체", value: pct(A.up, 0) || "-", delta: `<span class="vs">중앙값 성장률 ${sgn(A.medG) || "-"}</span>` },
      { icon: "ph-scales", label: "국내 소부장 대비 이익률", value: A.m != null && D.m != null ? `${A.m - D.m >= 0 ? "+" : ""}${nf(A.m - D.m, 1)}%p` : "-", delta: `<span class="vs">해외 ${pct(A.m) || "-"} · 국내 ${pct(D.m) || "-"}(개별 ${D.n}곳)</span>` },
    ].map(kpi6).join("");
    yearly(); quarterly();
    $("c-bm").innerHTML = group("영업이익률", "m", mgf, (r) => (r.p.o && r.o1 == null ? "영업이익 항목을 공시 API에서 받지 못함" : "영업이익률 계산 불가"));
    $("c-bg").innerHTML = group("매출 증감률", "g", (v) => sgn(v), () => "전년 매출이 없어 증감률 계산 불가");
    $("c-gm").innerHTML = distro(rows.filter((r) => r.g != null && r.m != null));
    $("c-kb").innerHTML = kindBubbles();
  }

  // 매출·영업이익 막대 + 영업이익률 선(위 띠). 대시보드 경영 개요와 같은 차트: 왼쪽 축=매출, 오른쪽 축=영업이익, 위 띠=이익률
  // 값은 원화 환산 합계. 칸에 올리면(또는 누르면) 위 요약 띠에 그 시점 값이 뜬다
  const CW = () => (window.innerWidth < 640 ? 380 : 520);
  const niceStep = (v) => { const e = Math.pow(10, Math.floor(Math.log10(v || 1))), f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; };
  const wonRow = (vals) => (Math.max(...vals.filter((v) => v != null).map(Math.abs), 0) >= 10000 ? (v) => (v == null ? "-" : `${nf(v / 10000, 1)}조`) : (v) => won(v) || "-");
  const w0 = (v) => won(v) || "-";
  // 값 범위에 맞춘 축(0부터가 아니라 값 주변). 두 축이 같은 격자선을 쓰도록 눈금 수를 함께 고른다
  function fitAxes(...series) {
    const base = series.map((vals) => {
      const v = vals.filter((x) => x != null);
      if (!v.length) return { lo0: 0, top: 1 };
      const mn = Math.min(...v), mx = Math.max(...v), up = Math.max((mx - mn) * 0.12, Math.abs(mx) * 0.01, 1), down = Math.max((mx - mn) * 0.35, Math.abs(mx) * 0.03, 1);
      return { lo0: mn >= 0 ? Math.max(0, mn - down) : mn - down, top: mx + up };
    });
    const fit = (b, k) => {
      const e10 = Math.pow(10, Math.floor(Math.log10((b.top - b.lo0) / k || 1)));
      for (const f of [1, 2, 2.5, 5, 10, 20, 25, 50]) { const step = f * e10, lo = Math.floor(b.lo0 / step) * step; if (lo + step * k >= b.top) return { lo, step, waste: (step * k) / (b.top - b.lo0) }; }
      return null;
    };
    let best = null;
    [3, 4, 5, 6].forEach((k) => { const ax = base.map((b) => fit(b, k)); if (ax.every(Boolean)) { const w = ax.reduce((t, x) => t + x.waste, 0); if (!best || w < best.w) best = { k, ax, w }; } });
    return best;
  }
  function combo(labels, sales, ops, note, opt = {}) {
    if (!sales.some((v) => v != null)) return `<p class="db-empty">표시할 실적이 없습니다.</p>`;
    const W = CW(), n = labels.length, H = 300, L = 50, R = 50, T = 18, B = 28, pw = W - L - R, ph = H - T - B, band = 100;
    const margins = sales.map((v, i) => (v > 0 && ops[i] != null ? (ops[i] / v) * 100 : null));
    const fx = fitAxes(sales, ops);
    if (!fx) return `<p class="db-empty">표시할 실적이 없습니다.</p>`;
    const { k, ax: [A] } = fx;
    const O = (() => { // 영업이익 축: 0에서 시작, 영업이익 막대가 같은 시점 매출 막대 높이의 90%를 넘지 않게
      const hs = (i) => Math.max(0.05, (sales[i] - A.lo) / (A.step * k));
      const req = Math.max(1, ...ops.map((o, i) => (o > 0 && sales[i] != null ? o / (0.9 * hs(i)) : 0)));
      const ov = ops.filter((x) => x != null), mn = Math.min(0, ...ov), mx = Math.max(0, ...ov), e10 = Math.pow(10, Math.floor(Math.log10(req / k)));
      for (const f of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 100]) {
        const step = f * e10, lo = mn < 0 ? -Math.ceil((-mn * 1.15) / step) * step : 0;
        if (step * k >= req && lo + step * k >= mx) return { lo, step };
      }
      return { lo: 0, step: niceStep(req / k) };
    })();
    const bh = ph - band, mk = (ax) => { const hi = ax.lo + ax.step * k; return (v) => T + band + bh - ((v - ax.lo) / (hi - ax.lo)) * bh; };
    const yS = mk(A), yO = mk(O), base = (ax) => (ax.lo < 0 ? 0 : ax.lo);
    const mv = margins.filter((v) => v != null), mn = mv.length ? Math.min(...mv) : 0, mx = mv.length ? Math.max(...mv) : 1, mpad = Math.max((mx - mn) * 0.2, 0.4), mLo = mn - mpad, span = mx + mpad - mLo || 1;
    const ym = (v) => T + 16 + (1 - (v - mLo) / span) * (band - 30);
    const slot = pw / n, bw = Math.min(opt.bw || (n > 5 ? 12 : n > 3 ? 22 : 34), slot * 0.32), cx = (i) => L + slot * i + slot / 2;
    const stripOf = (i) => `<b class="st-l">${esc(labels[i])}</b><span class="st-b" style="--c:var(--blue)">매출 <b>${w0(sales[i])}</b></span><span class="st-b" style="--c:var(--green)">영업이익 <b>${w0(ops[i])}</b></span><span class="st-b" style="--c:var(--orange)">이익률 <b>${pct(margins[i]) || "-"}</b></span>`;
    const lastI = (() => { for (let i = n - 1; i >= 0; i--) if (sales[i] != null) return i; return -1; })();
    const legend = opt.legend ? `<ul class="db-legend db-mini-leg"><li><i class="sq" style="background:var(--blue)"></i>매출(왼쪽 축)</li><li><i class="sq" style="background:var(--green)"></i>영업이익(오른쪽 축)</li><li><i style="background:var(--orange)"></i>영업이익률</li></ul>` : "";
    const strip = `<div class="db-strip th-only" aria-live="polite">${stripOf(lastI)}</div>`;
    let g = `<text class="ax" x="${L - 6}" y="${T + 12}" text-anchor="end">이익률</text><line class="grid" x1="${L}" x2="${W - R}" y1="${T + band - 4}" y2="${T + band - 4}" stroke-dasharray="2 3"/>`;
    const fS = wonRow([A.lo, A.lo + A.step * k]), fO = wonRow([O.lo, O.lo + O.step * k]);
    for (let i = 0; i <= k; i++) {
      const vs = A.lo + A.step * i, vo = O.lo + O.step * i, yy = yS(vs);
      g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text class="ax axl" x="${L - 6}" y="${yy + 4}" text-anchor="end">${fS(vs)}</text><text class="ax axr" x="${W - R + 6}" y="${yy + 4}">${fO(vo)}</text>`;
    }
    if (O.lo < 0) g += `<line x1="${L}" x2="${W - R}" y1="${yO(0)}" y2="${yO(0)}" stroke="var(--text-3)" stroke-width="1"/>`;
    labels.forEach((l, i) => {
      const x = cx(i), s = sales[i], o = ops[i];
      if (s == null) { g += `<text class="ax" x="${x}" y="${yS(base(A)) - 6}" text-anchor="middle">결측</text><text class="ax" x="${x}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`; return; }
      const tip = `${l} · ${note}`;
      g += `<g class="slot" style="--i:${i}" tabindex="0" data-strip="${esc(stripOf(i))}" data-src="${esc(tip)}"><rect class="colbg" x="${x - slot / 2 + 2}" y="${T}" width="${slot - 4}" height="${ph}" rx="10"/>`;
      g += `<rect class="bar${s < 0 ? " neg" : ""}" x="${x - bw - 1}" y="${Math.min(yS(s), yS(base(A)))}" width="${bw}" height="${Math.max(1, Math.abs(yS(s) - yS(base(A))))}" rx="3" fill="var(--blue)"/>`;
      if (o != null) g += `<rect class="bar${o < 0 ? " neg" : ""}" x="${x + 1}" y="${Math.min(yO(o), yO(base(O)))}" width="${bw}" height="${Math.max(1, Math.abs(yO(o) - yO(base(O))))}" rx="3" fill="${o < 0 ? "var(--down)" : "var(--green)"}"/>`;
      if (n <= 4) g += `<text class="val" x="${x - bw / 2 - 1}" y="${yS(s) - 5}" text-anchor="middle">${w0(s)}</text>`;
      g += `<text class="ax" x="${x}" y="${H - 8}" text-anchor="middle">${esc(l)}</text><rect class="hit" x="${x - slot / 2}" y="${T}" width="${slot}" height="${ph}"/></g>`;
    });
    const pts = margins.map((m, i) => (m == null ? null : [cx(i), ym(m), m])).filter(Boolean);
    g += `<polyline points="${pts.map((p) => p[0] + "," + p[1]).join(" ")}" fill="none" stroke="var(--orange)" stroke-width="2.2" stroke-linejoin="round"/>`;
    pts.forEach((p) => (g += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="var(--card)" stroke="var(--orange)" stroke-width="2"/><text class="mval" x="${p[0]}" y="${p[1] - 8}" text-anchor="middle">${pct(p[2])}</text>`));
    return `${legend}${strip}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="매출·영업이익(막대)과 영업이익률(선) 추이">${g}</svg>`;
  }
  // 차트 아래 실적 표(대시보드 경영 개요와 같은 구성): 매출·영업이익·영업이익률·임직원. 연도별은 마지막 열에 전년 대비
  const tone = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
  function sumTable(labels, S, O, note, yoy) {
    const n = labels.length, last = n - 1, M = S.map((v, i) => (v > 0 && O[i] != null ? (O[i] / v) * 100 : null)), fr = wonRow([...S, ...O]);
    const c = (t, src, why, cls = "") => `<td${cls ? ` class="${cls}"` : ""}>${cell(t, src, why)}</td>`;
    const gr = (a, b) => (a != null && b != null && b > 0 ? (a / b - 1) * 100 : null);
    const sg_ = gr(S[last], S[last - 1]);
    const od = n < 2 || O[last] == null || O[last - 1] == null ? null : O[last - 1] > 0 && O[last] < 0 ? ["적자 전환", "down"] : O[last - 1] < 0 && O[last] > 0 ? ["흑자 전환", "up"] : O[last - 1] < 0 ? ["적자 지속", "down"] : [sgn(gr(O[last], O[last - 1])), tone(gr(O[last], O[last - 1]))];
    const md = n > 1 && M[last] != null && M[last - 1] != null ? M[last] - M[last - 1] : null;
    const dc = (t, cls, why) => (yoy ? `<td class="${cls || ""}">${t == null ? NA(why) : t}</td>` : "");
    const row = (k, vals, f, d, src) => `<tr><th scope="row">${k}</th>${vals.map((v, i) => c(v == null ? null : f(v), `${labels[i]} ${k} · ${src}`, `${k} 없음`, typeof v === "number" && v < 0 ? "down" : "")).join("")}${d}</tr>`;
    return `<div class="db-qwrap"><table class="db-tbl db-ytbl${n > 6 ? " db-qtbl" : ""}"><thead><tr><th scope="col">구분</th>${labels.map((l) => `<th scope="col">${esc(l)}</th>`).join("")}${yoy ? '<th scope="col">전년 대비</th>' : ""}</tr></thead><tbody>`
      + row("매출", S, fr, dc(sgn(sg_), tone(sg_), "전년 매출 없음"), note) + row("영업이익", O, fr, dc(od && od[0], od && od[1], "영업이익 없음"), note)
      + row("영업이익률", M, (v) => mgf(v), dc(ppp(md), tone(md), "계산 불가"), "영업이익 ÷ 매출")
      + `<tr><th scope="row">임직원</th>${labels.map(() => `<td>${NA("해외 기업 임직원 수는 수집하지 않음(야후 파이낸스는 현재 인원 한 값만 제공)")}</td>`).join("")}${yoy ? `<td>${NA("해외 임직원 수 미수집")}</td>` : ""}</tr>`
      + `</tbody></table></div><p class="db-mini">임직원 수는 해외 기업에서는 수집하지 않아 "-"로 둡니다. 기준: ${esc(note)}</p>`;
  }
  // 회사마다 결산월이 달라 달력 연도로 맞추면 표본이 줄어든다 → 각 사의 '최근 회계연도'를 기준으로 거꾸로 맞춘다
  function yearly() {
    const pick = (n) => rows.filter((r) => r.L >= n - 1 && [...Array(n).keys()].every((k) => at(r.p.s, r.L - k) != null && at(r.p.o, r.L - k) != null));
    let n = 4, same = pick(4);
    if (same.length < rows.length * 0.6) { n = 3; same = pick(3); }
    const idx = [...Array(n).keys()].reverse(); // n-1 … 0 (0 = 최근)
    const S = idx.map((k) => sum(same.map((r) => r.p.s[r.L - k]))), O = idx.map((k) => sum(same.map((r) => r.p.o[r.L - k])));
    const fyOf = (k) => { const ys = [...new Set(same.map((r) => r.p.y[r.L - k]))].sort(); return ys.length > 1 ? `${ys[0]}~${String(ys[ys.length - 1]).slice(2)}` : `${ys[0]}`; };
    $("yearly-sub").textContent = `각 사 최근 회계연도 기준 · 같은 ${same.length}곳 합계`;
    const yNote = `${same.length}곳 합계 · 각 사 회계연도(결산월 상이) · 원화 환산`, yLab = idx.map((k) => (k === 0 ? `최근(${fyOf(0)})` : `${k}년 전`));
    $("c-yearly").innerHTML = same.length ? combo(yLab, S, O, yNote) + sumTable(yLab, S, O, yNote, true) : NA("연도별로 비교할 수 있는 기업이 없음");
  }
  function quarterly() {
    // 각 사 최근 분기부터 거꾸로 맞춘다(분기 실적이 빈 칸 없이 이어진 기업만)
    const tail = (r) => { const q = r.p.q; if (!q) return 0; let c = 0; for (let i = q.labels.length - 1; i >= 0 && q.sales[i] != null && q.op && q.op[i] != null; i--) c++; return c; };
    let n = 5, same = rows.filter((r) => tail(r) >= 5);
    if (same.length < rows.length * 0.5) { n = 4; same = rows.filter((r) => tail(r) >= 4); }
    if (same.length < 2) { $("trend-sub").textContent = ""; $("c-trend").innerHTML = NA("이어진 분기 실적을 공시한 기업이 부족함"); return; }
    const idx = [...Array(n).keys()].reverse(), val = (r, k, f) => r.p.q[f][r.p.q.labels.length - 1 - k];
    const S = idx.map((k) => sum(same.map((r) => val(r, k, "sales")))), O = idx.map((k) => sum(same.map((r) => val(r, k, "op"))));
    const lab = (k) => { const c = {}; same.forEach((r) => { const l = r.p.q.labels[r.p.q.labels.length - 1 - k]; c[l] = (c[l] || 0) + 1; }); return Object.keys(c).sort((x, y) => c[y] - c[x])[0]; };
    $("trend-sub").textContent = `각 사 최근 분기 기준 · 같은 ${same.length}곳 합계`;
    const qNote = `${same.length}곳 합계 · 각 사 최근 분기부터 맞춤(달력 분기는 가장 많은 기업 기준 표기) · 원화 환산`, qLab = idx.map((k) => lab(k));
    $("c-trend").innerHTML = combo(qLab, S, O, qNote) + sumTable(qLab, S, O, qNote, false);
  }
  // ---------- 산점도 공통(축·눈금·기준선) ----------
  const KCOL = { 소재: "var(--blue)", 부품: "var(--teal)", 장비: "var(--orange)" }, kcol = (c) => KCOL[c] || "var(--gray)";
  function frame(xs, ys, W, H) {
    const L = 46, R = 14, T = 14, B = 36, x0 = Math.min(-10, ...xs) - 3, x1 = Math.max(20, ...xs) + 5, y0 = Math.min(-5, ...ys) - 3, y1 = Math.max(15, ...ys) + 5;
    const X = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R), Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
    const tick = (a, b) => { const st = b - a > 120 ? 50 : b - a > 60 ? 20 : b - a > 30 ? 10 : 5, o = []; for (let v = Math.ceil(a / st) * st; v <= b; v += st) o.push(v); return o; };
    const axes = tick(x0, x1).map((v) => `<line x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${H - B}" stroke="${v === 0 ? "var(--text-3)" : "var(--grid)"}"/><text x="${X(v)}" y="${H - B + 14}" text-anchor="middle" font-size="11" fill="var(--text-3)">${v}%</text>`).join("")
      + tick(y0, y1).map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v === 0 ? "var(--text-3)" : "var(--grid)"}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--text-3)">${v}%</text>`).join("")
      + `<text x="${W - R}" y="${H - 3}" text-anchor="end" font-size="11" fill="var(--text-3)">매출 증감률 →</text><text x="4" y="11" font-size="11" fill="var(--text-3)">영업이익률 ↑</text>`;
    return { X, Y, axes };
  }
  // 라벨 겹침 방지: 이미 놓인 상자와 겹치지 않을 때만 쓴다
  const labeler = (W, taken) => { const placed = taken.slice(); return (x, y, w) => { if (x < 0 || x + w > W || placed.some((b) => x < b.x + b.w && x + w > b.x && Math.abs(y - b.y) < 12)) return false; placed.push({ x, y, w }); return true; }; };

  // 업종별(구분 × 국가 묶음) 성장률 × 이익률, 점 크기 = 매출. 국내 소부장은 점선 원으로 함께
  function kindBubbles() {
    const W = 520, H = 340, ctryGrp = (c) => (c === "US" ? "미국" : c === "JP" ? "일본" : ["NL", "DE", "FR"].includes(c) ? "유럽" : "기타");
    const pts = [];
    SOBU.forEach((k) => ["미국", "일본", "유럽", "기타"].forEach((g) => {
      const list = rows.filter((r) => r.p.cat === k && ctryGrp(r.p.ctry) === g);
      if (list.length < 2) return;
      const A = aggP(list);
      if (A.g == null || A.m == null) return;
      pts.push({ x: A.g, y: A.m, size: A.s1, color: kcol(k), label: `${k}·${g}`, tip: `해외 ${k} · ${g} ${list.length}곳 · 매출 합계 ${won(A.s1)} · 성장 ${sgn(A.g)} · 이익률 ${pct(A.m)} · 연결 · 원화 환산`, dom: false });
    }));
    SOBU.forEach((k) => {
      const list = dom.filter((r) => r.kind === k);
      if (list.length < 3) return;
      const st = SB.stats(list);
      if (st.g == null || st.m == null) return;
      pts.push({ x: st.g, y: st.m, size: st.s1, color: kcol(k), label: `국내 ${k}`, tip: `국내 ${k} ${list.length}곳 · 매출 합계 ${won(st.s1)} · 성장 ${sgn(st.g)} · 이익률 ${pct(st.m)} · 개별 · ${FY}년`, dom: true });
    });
    if (pts.length < 2) return NA("그릴 수 있는 업종 묶음이 부족함(2곳 미만 제외)");
    const cl = (v, a, b) => Math.max(a, Math.min(b, v)), xs = pts.map((p) => cl(p.x, -40, 120)), ys = pts.map((p) => cl(p.y, -30, 60));
    const { X, Y, axes } = frame(xs, ys, W, H), rmax = Math.max(...pts.map((p) => p.size)), rad = (p) => 7 + 24 * Math.sqrt(p.size / rmax);
    const ok = labeler(W, []);
    let g = axes, lab = "";
    pts.slice().sort((a, b) => b.size - a.size).forEach((p) => {
      const i = pts.indexOf(p), x = X(xs[i]), y = Y(ys[i]), r = rad(p), w = p.label.length * 6.4 + 4;
      g += `<g class="cm-pt" tabindex="0" data-src="${esc(p.tip)}"><circle cx="${x}" cy="${y}" r="${r}" ${p.dom ? `fill="none" stroke-dasharray="5 3"` : `fill="${p.color}" fill-opacity=".32"`} stroke="${p.color}" stroke-width="${p.dom ? 2 : 1.4}"/></g>`;
      const spot = [[x - w / 2, y - r - 5], [x - w / 2, y + r + 12], [x + r + 4, y + 4], [x - r - 4 - w, y + 4]].find(([lx, ly]) => ok(lx, ly, w));
      if (spot) lab += `<text x="${spot[0]}" y="${spot[1]}" font-size="11" font-weight="700" fill="var(--text)" paint-order="stroke" stroke="var(--card)" stroke-width="3">${esc(p.label)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="업종별 매출 성장률과 영업이익률. 점 크기는 매출">${g}${lab}</svg>
      <ul class="db-legend">${SOBU.map((k) => `<li><i class="sq" style="background:${kcol(k)}"></i>${k}</li>`).join("")}<li>○ 해외(색 채움)</li><li>◌ 국내(점선)</li><li>점 크기 = 매출 합계 · 2곳(국내 3곳) 미만 묶음 제외</li></ul>`;
  }

  // 기업별 성장률(가로) × 영업이익률(세로) 분포. 점을 누르면 기업 상세로 이동
  function distro(pts) {
    if (pts.length < 2) return NA("그릴 수 있는 기업이 부족함");
    const W = 520, H = 340, cl = (v, a, b) => Math.max(a, Math.min(b, v)), xs = pts.map((r) => cl(r.g, -50, 150)), ys = pts.map((r) => cl(r.m, -30, 70));
    const { X, Y, axes } = frame(xs, ys, W, H), ok = labeler(W, pts.map((r, i) => ({ x: X(xs[i]) - 5, y: Y(ys[i]), w: 10 })));
    let g = axes;
    pts.map((r, i) => [r, i]).sort((a, b) => b[0].s1 - a[0].s1).forEach(([r, i]) => {
      const x = X(xs[i]), y = Y(ys[i]), w = r.p.n.length * 6.2 + 4, lab = ok(x + 8, y, w);
      g += `<g class="cm-pt cm-go" tabindex="0" role="button" data-pt="${esc(r.p.k)}" aria-label="${esc(r.p.n)} 기업 상세 보기" data-src="${esc(`${r.p.n}(${CTRY[r.p.ctry] || r.p.ctry} · ${r.p.cat}) · 매출 증감률 ${nf(r.g, 1)}% · 영업이익률 ${nf(r.m, 1)}% · ${r.fy}년 · 누르면 기업 상세`)}"><circle cx="${x}" cy="${y}" r="5.5" fill="${kcol(r.p.cat)}" fill-opacity=".8" stroke="var(--card)" stroke-width="1.2"/>${lab ? `<text x="${x + 8}" y="${y + 4}" font-size="11" fill="var(--text-2)">${esc(r.p.n)}</text>` : ""}</g>`;
    });
    const cats = [...new Set(pts.map((r) => r.p.cat))];
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="기업별 매출 증감률과 영업이익률 분포">${g}</svg><ul class="db-legend">${CATS.filter((c) => cats.includes(c)).map((c) => `<li><i class="sq" style="background:${kcol(c)}"></i>${esc(c)}</li>`).join("")}<li>이름 없는 점은 올리면 보임 · 축 밖 값은 가장자리에 표시</li></ul>`;
  }

  // 정렬 가능한 표
  function table(cols, list, st, onSort) {
    const head = cols.map((c) => `<th scope="col" class="${c.l ? "l" : ""}" aria-sort="${st.k === c.k ? (st.d > 0 ? "ascending" : "descending") : "none"}">${c.sort === false ? c.t : `<button type="button" data-k="${c.k}">${c.t}<i>${st.k === c.k ? (st.d > 0 ? "▲" : "▼") : ""}</i></button>`}</th>`).join("");
    return `<table class="db-tbl cm-tbl"><thead><tr>${head}</tr></thead><tbody>${list.map((r) => `<tr>${cols.map((c) => (c.k === "n" ? `<th scope="row" class="l">${c.f(r)}</th>` : `<td class="${c.l ? "l" : ""}">${c.f(r)}</td>`)).join("")}</tr>`).join("")}</tbody></table>`;
  }
  const sortBy = (list, st) => list.slice().sort((a, b) => { const x = st.k === "n" ? a.p.n : sv(a, st.k), y = st.k === "n" ? b.p.n : sv(b, st.k); return (x == null) - (y == null) || (x > y ? 1 : x < y ? -1 : 0) * st.d; });
  const sv = (r, k) => (k in r ? r[k] : k in r.mk ? r.mk[k] : k === "cat" ? CATS.indexOf(r.p.cat) : k === "cagr" ? r.cagr : k === "ctry" ? r.p.ctry : k === "mt" ? r.p.mt : null);

  function drawPerf() {
    const co = (r) => `<a href="#company" data-co="${r.p.k}">${esc(r.p.n)}</a>`;
    const why = (r, w) => `${r.p.n}: ${w}`;
    const cols = [
      { k: "n", t: "기업", l: 1, f: (r) => co(r) }, { k: "ctry", t: "국가", l: 1, f: (r) => CTRY[r.p.ctry] || r.p.ctry }, { k: "cat", t: "구분", l: 1, f: (r) => `${esc(r.p.cat)}${r.p.seg1 ? `<small>${esc(r.p.seg1)}${r.p.seg2 ? " · " + esc(r.p.seg2) : ""}</small>` : ""}` },
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
  }

  // ---------- 기업 상세(대시보드 '기업 상세'와 같은 구성) ----------
  const TYPES = SB.TYPES, TCOL = SB.TYPE_COLOR;
  function signalsOf(r) {
    const p = r.p, L = r.L, o0 = at(p.o, L - 1), out = [];
    const d0 = at(p.te, L - 1) > 0 ? ratio(at(p.tl, L - 1), at(p.te, L - 1)) : null;
    if (r.o1 != null && r.o1 < 0 && o0 != null && o0 >= 0) out.push({ sev: 1, label: "적자 전환", why: `영업이익 ${won(o0)} → ${won(r.o1)}`, check: "일회성 비용·충당금인지, 본업 수익성 악화인지 사업보고서 주석을 확인" });
    else if (r.o1 != null && r.o1 < 0) out.push({ sev: 1, label: "영업적자", why: `${r.fy}년 영업이익 ${won(r.o1)}(이익률 ${pct(r.m) || "-"})`, check: "적자 원인과 개선 계획(가이던스)을 확인" });
    if (r.dm != null && r.dm <= -5) out.push({ sev: 2, label: "이익률 급락", why: `영업이익률 ${ppp(r.dm)} (${pct(r.m - r.dm)} → ${pct(r.m)})`, check: "원가·가격·제품 구성 변화를 실적 발표 자료에서 확인" });
    if (r.g != null && r.g < 0) out.push({ sev: 2, label: "매출 감소", why: `매출 ${sgn(r.g)} (${won(r.s0)} → ${won(r.s1)})`, check: "고객 수요·환율 영향(원화 환산)인지 구분해서 확인" });
    if (r.debt != null && d0 != null && r.debt - d0 >= 30) out.push({ sev: 2, label: "부채비율 급등", why: `부채비율 ${pct(d0, 0)} → ${pct(r.debt, 0)}`, check: "차입·인수 등 자금 용도를 확인" });
    return out;
  }
  function drawCompany() {
    const list = all.slice().sort((a, b) => (b.s1 || 0) - (a.s1 || 0));
    if (!list.length) { $("c-company").innerHTML = `<p class="db-empty">해외 기업 데이터가 없습니다.</p>`; return; }
    $("co-dl").innerHTML = list.map((r) => `<option value="${esc(r.p.n)}"></option>`).join("");
    const r = all.find((x) => x.p.k === state.co) || (rows.slice().sort((a, b) => (b.s1 || 0) - (a.s1 || 0))[0]) || list[0];
    state.co = r.p.k; $("co-q").value = r.p.n;
    const p = r.p, peersL = all.filter((x) => x.p.cat === p.cat), nP = peersL.length;
    const rank = (key, v) => { if (v == null) return "-"; const vals = peersL.map((x) => x[key]).filter((x) => x != null), q = Math.round((vals.filter((x) => x > v).length / vals.length) * 100); return q <= 50 ? `상위 ${Math.max(1, q)}%` : `하위 ${Math.max(1, 100 - q)}%`; };
    const salesRank = peersL.slice().sort((a, b) => (b.s1 || 0) - (a.s1 || 0)).findIndex((x) => x.p.k === p.k) + 1;
    const dk = SOBU.includes(p.cat) ? domStat(dom.filter((x) => x.kind === p.cat)) : null;
    const type = r.g != null && r.m != null ? SB.typeOf(r.g, r.m) : null;
    const sigs = signalsOf(r);
    const missing = [];
    p.y.forEach((y, i) => { if (at(p.o, i) == null) missing.push(`${y}년 영업이익`); if (at(p.ni, i) == null) missing.push(`${y}년 순이익`); });
    if (!p.q) missing.push("분기 실적(받지 못함)");
    if (!(p.tl && p.tl.some((v) => v != null))) missing.push("총부채");
    if (!(p.rd && p.rd.some((v) => v != null))) missing.push("연구개발비");
    if (r.g == null) missing.push("전년 매출(성장률 비교 불가)");
    const med_ = (k) => med(peersL.map((x) => x[k]));
    const card = (k, v, sub) => `<div><span>${k}</span><b>${v}</b><small>${sub || ""}</small></div>`;
    const sv_ = (t, src, why) => cell(t, src, why);
    const yl = p.y.map((y) => `${y}년`), Sm = p.s, Om = p.o || [];
    // 연도별 표(원화 환산 + 원 통화)
    const L2 = p.loc || {}, row = (nm, arr, f, what) => `<tr><th class="l" scope="row">${nm}</th>${p.y.map((y, i) => `<td>${sv_(f(arr && arr[i]), srcPeer(p, what, i), `${y}년 ${what} 없음`)}</td>`).join("")}</tr>`;
    const mgn = p.y.map((y, i) => ratio(at(p.o, i), at(p.s, i)));
    const yt = `<div class="db-tbl-wrap"><table class="db-tbl cm-tbl"><thead><tr><th class="l">구분(억 원 환산)</th>${yl.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>
      ${row("매출", Sm, won, "매출")}${row("영업이익", Om, won, "영업이익")}
      <tr><th class="l" scope="row">영업이익률</th>${p.y.map((y, i) => `<td>${sv_(mgn[i] == null ? null : mgf(mgn[i]), srcPeer(p, "영업이익률", i), "영업이익이 없어 계산 불가")}</td>`).join("")}</tr>
      ${row("순이익", p.ni, won, "순이익")}${row("연구개발비", p.rd, won, "연구개발비")}${row("총자산", p.ta, won, "총자산")}${row("총부채", p.tl, won, "총부채")}${row("자본", p.te, won, "자본")}
      ${L2.s ? `<tr><th class="l" scope="row">매출(원 통화)</th>${L2.s.map((v, i) => `<td>${sv_(v == null ? null : `${nf(v)}<small>${esc(L2.unit)}</small>`, `${p.n} ${p.y[i]}년 매출 원 통화 · ${p.src}`, "없음")}</td>`).join("")}</tr>` : ""}
      ${p.fx ? `<tr><th class="l" scope="row">평균 환율(원)</th>${p.fx.map((x) => `<td>${x == null ? NA("환율 없음") : nf(x, x < 100 ? 2 : 1)}</td>`).join("")}</tr>` : ""}
      </tbody></table></div>`;
    const q = p.q;
    const qt = q ? `<div class="db-tbl-wrap"><table class="db-tbl cm-tbl"><thead><tr><th class="l">분기</th>${q.labels.map((l) => `<th>${esc(l)}</th>`).join("")}</tr></thead><tbody>
      <tr><th class="l" scope="row">매출</th>${q.sales.map((v) => `<td>${sv_(won(v), `${p.n} 분기 매출 · ${p.src} · 쪽 번호 없음`, "분기 매출 없음")}</td>`).join("")}</tr>
      <tr><th class="l" scope="row">영업이익</th>${q.op.map((v) => `<td>${sv_(won(v), `${p.n} 분기 영업이익 · ${p.src} · 쪽 번호 없음`, "분기 영업이익 항목 없음")}</td>`).join("")}</tr>
      <tr><th class="l" scope="row">영업이익률</th>${q.sales.map((s_, i) => { const m = ratio(q.op[i], s_); return `<td>${m == null ? NA("계산 불가") : mgf(m)}</td>`; }).join("")}</tr></tbody></table></div>` : "";
    const mk = p.mk, pos = mk && mk.hi52 > mk.lo52 && mk.price ? Math.max(0, Math.min(100, ((mk.price - mk.lo52) / (mk.hi52 - mk.lo52)) * 100)) : null;
    const up = mk && mk.target && mk.price ? (mk.target / mk.price - 1) * 100 : null;
    const sm = (t, w) => sv_(t, srcMk(p, w), `${w} 없음`);
    const stock = mk ? `<div class="mk-cells">${[["현재가", mk.price == null ? null : `${nf(mk.price, mk.price >= 1000 ? 0 : 2)} ${CUR[mk.cur] || mk.cur}`], ["시가총액", won(mk.cap)], ["PER", mk.per > 0 ? `${nf(mk.per, 1)}배` : null], ["PBR", mk.pbr > 0 ? `${nf(mk.pbr, 2)}배` : null],
        ["ROE", pct(mk.roe)], ["배당수익률", pct(mk.dy, 2)], ["1년 수익률", sgn(mk.r1y, 0)], ["목표가 여력", sgn(up, 0)]].map(([k, v]) => `<div><span>${k}</span><b>${sm(v, k)}</b></div>`).join("")}</div>
      ${pos == null ? "" : `<p class="mk-52"><span>52주 최저 ${nf(mk.lo52)}</span><span>최고 ${nf(mk.hi52)}</span></p><div class="mk-bar" role="img" aria-label="52주 범위에서 현재가 위치 ${Math.round(pos)}%"><i style="width:${pos}%"></i><b style="left:${pos}%"></b></div>`}
      <div class="cm-trend">${sparkline(mk.trend)}<span>최근 1년 주가 흐름(시작=100)</span></div>`
      : `<p class="db-empty">주가 지표를 받지 못했습니다(-).</p>`;
    $("c-company").innerHTML = `
      <section class="db-card db-co-head">
        <div><h2>${esc(p.n)}</h2><p>${esc(p.cat)}${p.seg1 ? ` · ${esc(p.seg1)}${p.seg2 ? "·" + esc(p.seg2) : ""}` : ""} · ${CTRY[p.ctry] || p.ctry}${p.tk ? ` · ${esc(p.tk)}` : ""} · 결산 ${p.mt}월(${r.fy}년) · 통화 ${CUR[p.cur] || p.cur} · 출처 ${esc(p.src)} · 연결${p.st ? ` · ${stBadge(p.st, p.why)}` : ""}</p></div>
        <div class="db-co-act">${p.url ? `<a class="db-btn ghost" href="${esc(p.url)}" target="_blank" rel="noopener"><i class="ph ph-arrow-square-out" aria-hidden="true"></i>원문 열기</a>` : ""}<a class="db-btn ghost" href="#perf">목록으로</a></div>
      </section>
      <div class="db-co-kpis">${card(`${r.fy}년 매출`, sv_(won(r.s1), srcPeer(p, "매출", r.L), "매출 없음"), `${p.cat} ${nP}곳 중 ${salesRank}위 · 원화 환산`)}
        ${card("매출 성장률", sv_(sgn(r.g), srcPeer(p, "매출 증감률", r.L), "전년 매출 없음"), r.g == null ? "" : `구분 ${rank("g", r.g)} · 중앙값 ${sgn(med_("g")) || "-"}`)}
        ${card("영업이익률", sv_(r.m == null ? null : mgf(r.m), srcPeer(p, "영업이익률", r.L), "영업이익 없음"), r.m == null ? "" : `구분 ${rank("m", r.m)} · 중앙값 ${pct(med_("m")) || "-"}${dk && dk.m != null ? ` · 국내 ${p.cat} ${pct(dk.m)}` : ""}`)}
        ${card("부채비율", sv_(pct(r.debt, 0), srcPeer(p, "부채비율", r.L), "부채·자본 없음"), r.debt == null ? "자료 없음" : `구분 중앙값 ${pct(med_("debt"), 0) || "-"}`)}
        ${card("R&D 비중", sv_(pct(r.rd), srcPeer(p, "R&D 비중", r.L), "연구개발비 없음"), r.rd == null ? "자료 없음" : `구분 ${rank("rd", r.rd)} · 중앙값 ${pct(med_("rd")) || "-"}`)}
        ${card("기업 유형", type ? `<span style="color:${TCOL[type]}">${esc(type)}</span>` : "-", `성장 ${SB.HI_GROWTH}%·이익률 ${SB.HI_MARGIN}% 기준`)}</div>
      <div class="cm-2">
        <section class="db-card"><div class="db-card-head"><h2>연도별 실적</h2></div><div class="db-chart">${combo(yl, Sm, Om, `${p.n} · ${p.src} · 원화 환산`, { legend: 1 })}${yt}</div></section>
        <section class="db-card"><div class="db-card-head"><h2>분기별 실적</h2></div>${q ? `<div class="db-chart">${combo(q.labels, q.sales, q.op, `${p.n} 분기 · ${p.src} · 원화 환산`, { legend: 1 })}${qt}</div>` : `<p class="db-empty">분기 실적을 받지 못했습니다(-).</p>`}</section>
      </div>
      <div class="cm-2">
        <section class="db-card"><div class="db-card-head"><h2>주가·밸류에이션 <small>${mk && mk.asof ? esc(mk.asof) + " 기준" : ""}</small></h2></div>${stock}</section>
        <section class="db-card"><div class="db-card-head"><h2>경영 변화 신호</h2></div>${sigs.length ? `<ul class="db-plain">${sigs.map((x) => `<li><span class="db-tag sev${x.sev}">${x.label}</span> ${esc(x.why)}<small> · 확인: ${x.check}</small></li>`).join("")}</ul>` : `<p class="db-empty">해당하는 신호가 없습니다.</p>`}
          <div class="db-card-head" style="margin-top:14px"><h2>데이터 기준·결측</h2></div><ul class="db-plain"><li>연결 재무제표, ${esc(p.src)}${p.std ? ` · ${esc(p.std)}` : ""} 기준 · 원화 환산(손익 평균 환율, 재무상태표 결산일 환율)</li><li>비교 집단: 해외 ${esc(p.cat)} ${nP}곳(상단 필터와 무관)</li>${missing.length ? [...new Set(missing)].map((m) => `<li class="down">결측: ${m}</li>`).join("") : "<li>결측 항목 없음</li>"}</ul></section>
      </div>`;
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
    $("f-kind").innerHTML = opt("sobu", "전체(소재·장비·부품)", state.kind) + SOBU.filter((k) => kinds.includes(k)).map((k) => opt(k, k, state.kind)).join("") + (kinds.includes(REF) ? opt("all", "참고 기업 포함(팹리스·IDM·OSAT)", state.kind) : "");
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
    $("c-cov").innerHTML = `<table class="db-tbl cm-tbl"><thead><tr><th class="l">기업</th><th class="l">국가</th><th class="l">구분</th><th class="l">티커</th><th class="l">출처</th><th class="l">결산일</th><th class="l">상태</th></tr></thead><tbody>${M.map((m) => {
      const p = byK.get(m.k);
      return `<tr><th scope="row" class="l">${esc(m.n)}</th><td class="l">${CTRY[m.ctry] || m.ctry}</td><td class="l">${esc(p ? p.cat : SOBU.includes(m.kind) ? m.kind : m.cat)}<small>${esc(m.seg1 || "")}</small></td><td class="l">${esc(m.tk || "-")}</td><td class="l">${p ? srcLink(p) : esc(m.src || "-")}</td><td class="l">${p && p.pe ? esc(p.pe[p.pe.length - 1]) : "-"}</td><td class="l">${stBadge(m.st, m.why)}</td></tr>`;
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

  const VIEWS = ["overview", "perf", "company", "stock", "coverage", "domestic"];
  function show(v) {
    if (!VIEWS.includes(v)) v = "overview";
    document.querySelectorAll(".db-view").forEach((el) => (el.hidden = el.dataset.view !== v));
    document.querySelectorAll("#views-nav a").forEach((a) => a.setAttribute("aria-current", a.dataset.view === v));
    document.body.dataset.view = v; // 기업 상세는 상단 필터와 무관하므로 필터 막대를 숨긴다
    if (v === "company") drawCompany();
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
  // 분포의 점(또는 Enter·Space)으로 해당 기업의 상세(실적 비교 화면)로 이동
  const openCompany = (k) => {
    state.co = k;
    if (location.hash !== "#company") location.hash = "company"; else show("company");
  };
  document.addEventListener("click", (e) => { const pt = e.target.closest("[data-pt]"); if (pt) openCompany(pt.dataset.pt); });
  document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("[data-pt]")) { e.preventDefault(); openCompany(e.target.dataset.pt); } });
  document.addEventListener("click", (e) => { if (e.target.closest("[data-checksort]")) { state.sortP = { k: "dm", d: 1 }; drawPerf(); } });
  document.addEventListener("click", (e) => { if (e.target.closest("[data-each]")) { state.each = !state.each; drawOverview(); } if (e.target.closest("[data-retall]")) { state.retAll = !state.retAll; drawStock(); } });
  $("co-q").addEventListener("change", (e) => { const r = all.find((x) => x.p.n.toLowerCase() === e.target.value.trim().toLowerCase()) || all.find((x) => x.p.n.toLowerCase().includes(e.target.value.trim().toLowerCase())); if (r) openCompany(r.p.k); else e.target.value = (all.find((x) => x.p.k === state.co) || { p: { n: "" } }).p.n; });
  $("co-q").addEventListener("focus", (e) => e.target.select());
  document.addEventListener("click", (e) => { const a = e.target.closest("[data-co]"); if (a) { e.preventDefault(); openCompany(a.dataset.co); } });
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));
  window.addEventListener("resize", pill);


  // ---------- 차트 위 요약 띠(대시보드와 같은 동작): 올리면 그 칸 값, 벗어나면 최근 값, 누르면 고정·다시 누르면 해제 ----------
  const stripOfSlot = (g) => { const box = g.closest(".db-chart"); return box && box.querySelector(".db-strip"); };
  const showStrip = (g) => { const st = stripOfSlot(g); if (!st) return; if (!st.dataset.def) st.dataset.def = st.innerHTML; st.innerHTML = g.dataset.strip; };
  const resetStrip = (g) => { const st = stripOfSlot(g); if (st && st.dataset.def) st.innerHTML = st.classList.contains("pinned") ? st.dataset.pinHtml : st.dataset.def; };
  document.addEventListener("mouseover", (e) => { const g = e.target.closest && e.target.closest("g.slot"); if (g) showStrip(g); });
  document.addEventListener("mouseout", (e) => { const g = e.target.closest && e.target.closest("g.slot"); if (g && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest("g.slot"))) resetStrip(g); });
  document.addEventListener("focusin", (e) => { const g = e.target.closest && e.target.closest("g.slot"); if (g) showStrip(g); });
  document.addEventListener("focusout", (e) => { const g = e.target.closest && e.target.closest("g.slot"); if (g) resetStrip(g); });
  document.addEventListener("click", (e) => {
    const g = e.target.closest && e.target.closest("g.slot"), st = g && stripOfSlot(g);
    if (!st) return;
    if (!st.dataset.def) st.dataset.def = st.innerHTML;
    const was = g.classList.contains("pin");
    g.closest(".db-chart").querySelectorAll("g.slot.pin").forEach((x) => x.classList.remove("pin"));
    if (was) { st.classList.remove("pinned"); st.innerHTML = st.dataset.def; }
    else { g.classList.add("pin"); st.classList.add("pinned"); st.dataset.pinHtml = g.dataset.strip; st.innerHTML = g.dataset.strip; }
    st.classList.remove("pulse"); void st.offsetWidth; st.classList.add("pulse");
  });
  // 화면 폭이 바뀌어 차트 크기 단계(380/520)가 달라지면 다시 그린다
  let lastCW = CW();
  window.addEventListener("resize", () => { if (CW() !== lastCW) { lastCW = CW(); render(); } });

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
