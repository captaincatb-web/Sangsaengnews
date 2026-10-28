// 소부장 협력사 경영 대시보드: 6개 화면(Overview·산업·포트폴리오·위험 신호·기업 상세·보고서).
// 데이터 정의와 산식은 metrics.js(SB) 한 곳에서 가져오고, 모든 화면이 같은 필터 상태를 쓴다.
(() => {
  const SB = window.SB;
  const { won, pc, sg, pp, tone, esc } = SB.fmt;
  const { sum, growth, share, med } = SB.math;
  const { recs, KINDS, AREAS, TYPES, NA, SIGNALS } = SB;
  const $ = (id) => document.getElementById(id);
  const arrow = (v) => (v > 0 ? "▲" : v < 0 ? "▼" : "");
  const coLink = (r) => `<a href="#company" data-co="${r.c}">${esc(r.n)}</a>`;

  // ---------- 필터 상태(모든 화면 공유) ----------
  const state = { ...SB.fromQuery(location.search), sig: "전체", sigMore: false, sigSort: "sig", sigDir: 1, q: "", chip: "전체", sort: "g", dir: -1, more: false, co: new URLSearchParams(location.search).get("co") };
  // 지금 조건(과 선택 기업)을 주소에 남겨 링크로 공유할 수 있게 한다
  function syncUrl() {
    const qs = [SB.toQuery(state), state.co && location.hash === "#company" ? `co=${state.co}` : ""].filter(Boolean).join("&");
    history.replaceState(null, "", `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`);
  }
  let internal = null, ready = false;
  let F = SB.makeFilter(state, internal);
  const fill = (id, opts, val) => ($(id).innerHTML = opts.map(([v, l]) => `<option value="${v}"${String(v) === String(val) ? " selected" : ""}>${l}</option>`).join(""));
  function drawFilters() {
    fill("f-fy", [SB.DEFAULT_FY, SB.DEFAULT_FY - 1].map((y) => [y, `${y}년`]), state.fy);
    fill("f-kind", [["all", "전체"], ...KINDS.map((k) => [k, k])], state.kind);
    fill("f-area", [["all", "전체"], ...AREAS.map((a) => [a, a])], state.area);
    fill("f-listed", [["all", "전체"], ["1", "상장"], ["0", "비상장"]], state.listed);
    fill("f-size", [["all", "전체"], ...window.SIZE_TIERS.map((s) => [s, s === "1조 이상" && state.big === "exclude" ? "1조 이상(대형사 포함으로 전환)" : s]), ["custom", "직접 입력"]], state.size);
    $("w-srange").hidden = state.size !== "custom";
    $("f-smin").value = state.smin; $("f-smax").value = state.smax;
    $("f-listed").closest("label").hidden = recs.every((r) => r.l) || recs.every((r) => !r.l); // 전부 상장(또는 비상장)이면 고를 게 없다
    fill("f-big", [["include", "포함(기본)"], ["exclude", "제외"], ["only", "대형사만"]], state.big);
    fill("f-legal", [["all", "전체"], ...["대기업", "중견", "중소", "미입력"].map((s) => [s, s])], state.legal);
    fill("f-trade", [["all", "전체"], ...["당사 거래", "비거래", "미입력"].map((s) => [s, s])], state.trade);
  }
  const IDS = { "f-fy": "fy", "f-kind": "kind", "f-area": "area", "f-listed": "listed", "f-size": "size", "f-smin": "smin", "f-smax": "smax", "f-big": "big", "f-legal": "legal", "f-trade": "trade" };
  $("filters").addEventListener("change", (e) => {
    const key = IDS[e.target.id];
    if (!key) return;
    state[key] = key === "fy" ? Number(e.target.value) : key === "smin" || key === "smax" ? (e.target.value === "" ? "" : String(Math.max(0, Math.round(Number(e.target.value))))) : e.target.value;
    if (key === "size" && state.size !== "custom") state.smin = state.smax = "";
    if (key === "size" && state.size === "custom") setTimeout(() => $("f-smin").focus(), 0);
    // 모순되는 조합(1조 이상 + 대형사 제외)은 항상 0곳이므로 서로 맞춘다
    if (key === "size" && state.size === "1조 이상" && state.big === "exclude") state.big = "include";
    if (key === "big" && state.big === "exclude" && state.size === "1조 이상") state.size = "all";
    state.more = state.sigMore = false;
    drawFilters();
    render();
  });
  $("filters").addEventListener("reset", (e) => {
    e.preventDefault();
    Object.assign(state, SB.DEFAULTS, { sig: "전체", q: "", chip: "전체", more: false, sigMore: false });
    $("q").value = "";
    drawFilters();
    render();
  });
  window.InternalData && window.InternalData.onChange((data) => {
    internal = data;
    recs.forEach((r) => { const d = data && data[r.c]; r.legal = (d && d.size) || "미입력"; r.trade = (d && d.trade) || "미입력"; r.semi = d && d.semi != null ? d.semi : null; });
    $("w-legal").hidden = $("w-trade").hidden = !data;
    if (!data) state.legal = state.trade = "all";
    if (ready) { drawFilters(); render(); }
  });

  // ---------- 화면 전환(#overview 등) ----------
  const VIEWS = ["overview", "industry", "portfolio", "signals", "company", "report"];
  function showView(v) {
    if (!VIEWS.includes(v)) v = "overview";
    document.querySelectorAll(".db-view").forEach((el) => (el.hidden = el.dataset.view !== v));
    document.body.dataset.view = v; // 기업 상세는 필터와 무관하므로 필터 막대를 숨긴다
    document.querySelectorAll("#views-nav a").forEach((a) => a.setAttribute("aria-current", a.dataset.view === v));
    const fl = document.getElementById("filters"); // 화면을 바꾸면 모바일 필터 패널은 접는다
    if (fl.classList.contains("open")) { fl.classList.remove("open"); document.getElementById("filter-toggle").setAttribute("aria-expanded", false); }
    if (v === "company") drawCompany();
    if (v === "report") loadPreview();
    syncUrl();
    window.scrollTo({ top: 0 });
  }
  window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-co]");
    if (!a) return;
    e.preventDefault();
    state.co = a.dataset.co;
    if (location.hash === "#company") showView("company"); else location.hash = "company";
  });

  // ---------- 그림 도구 ----------
  // 차트 그림 폭: 좁은 화면에서는 좁게 그려 글자가 덜 줄어들게 한다
  let W = 520;
  const chartW = () => (window.innerWidth < 640 ? 380 : 520);
  const kpi = (o) => `<article class="db-kpi${o.hero ? " hero" : ""}"><p class="lab"><i class="ph ${o.icon}" aria-hidden="true"></i>${o.label}</p><strong>${o.value}</strong><p class="delta">${o.delta}</p></article>`;
  const delta = (v, txt, unit = "pct") => `<b class="${tone(v)}">${arrow(v)} ${unit === "pp" ? pp(v) : sg(v)}</b><span class="vs">${txt}</span>`;
  const note = (html, warn) => `<p class="db-note${warn ? " warn" : ""}"><i class="ph ${warn ? "ph-warning" : "ph-info"}" aria-hidden="true"></i><span>${html}</span></p>`;
  function hbarList(items, opt = {}) {
    const max = Math.max(...items.map((i) => i.v), 1);
    const mark = opt.mark != null ? `<span class="mark" style="left:${(opt.mark / max) * 100}%"></span>` : "";
    const head = opt.head ? `<li class="hd" aria-hidden="true"><span></span><span></span><b>${opt.head[0]}</b><em>${opt.head[1]}</em></li>` : "";
    return `<ul class="db-hbars${opt.wide ? " wide" : ""}">${head}${items.map((i) => `<li class="${i.cls || ""}" data-tip="${esc(i.tip || "")}"><span class="nm">${i.link || esc(i.label)}</span><span class="track"><span class="fill" style="width:${(Math.max(0, i.v) / max) * 100}%"></span>${mark}</span><b>${i.right}</b><em class="${tone(i.g)}">${i.gText ?? sg(i.g)}</em></li>`).join("")}</ul>`;
  }
  // 산점도: 가로 성장률, 세로 이익률. 점선은 확정 기준(성장 10%, 이익률 5%)
  function scatter(points, opt = {}) {
    const H = opt.h || 300, L = 54, R = 14, T = 14, B = 34, pw = W - L - R, ph = H - T - B;
    const cxv = (v) => (opt.clipX ? Math.max(-opt.clipX, Math.min(opt.clipX, v)) : v), cyv = (v) => (opt.clipY ? Math.max(-opt.clipY, Math.min(opt.clipY, v)) : v);
    const xs = points.map((p) => cxv(p.x)), ys = points.map((p) => cyv(p.y));
    // fit: 점이 적을 때(업종 집단) 범위를 자료에 맞춰 좁혀 점이 겹치지 않게 한다. 기준선(성장 10%, 이익률 5%)은 늘 포함
    const xmin = opt.fit ? Math.min(SB.HI_GROWTH, ...xs) - 4 : Math.min(-20, ...xs) - 2, xmax = opt.fit ? Math.max(SB.HI_GROWTH, ...xs) + 4 : Math.max(40, ...xs) + 2;
    const ymin = opt.fit ? Math.min(SB.HI_MARGIN, ...ys) - 3 : Math.min(-10, ...ys) - 2, ymax = opt.fit ? Math.max(SB.HI_MARGIN, ...ys) + 3 : Math.max(20, ...ys) + 2;
    const cx = (v) => L + ((cxv(v) - xmin) / (xmax - xmin)) * pw, cy = (v) => T + ph - ((cyv(v) - ymin) / (ymax - ymin)) * ph;
    const ticks = (a, b, n) => { const raw = (b - a) / n, step = raw <= 2.5 ? 2 : raw <= 6 ? 5 : Math.ceil(raw / 10) * 10, out = []; for (let v = Math.ceil(a / step) * step; v <= b; v += step) out.push(v); return out; };
    let g = "";
    ticks(ymin, ymax, 4).forEach((v) => (g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${cy(v)}" y2="${cy(v)}"/><text class="ax" x="${L - 6}" y="${cy(v) + 4}" text-anchor="end">${v}%</text>`));
    ticks(xmin, xmax, 5).forEach((v) => (g += `<text class="ax" x="${cx(v)}" y="${H - 18}" text-anchor="middle">${v}%</text>`));
    // 기준선: 기본은 유형 기준(성장 10%·이익률 5%), opt.zero면 0%(매출 증감·흑자/적자 경계)
    const [rx, ry] = opt.zero ? [0, 0] : [SB.HI_GROWTH, SB.HI_MARGIN];
    g += `<line x1="${cx(rx)}" x2="${cx(rx)}" y1="${T}" y2="${T + ph}" stroke="var(--text-3)" stroke-dasharray="4 3"/><line x1="${L}" x2="${W - R}" y1="${cy(ry)}" y2="${cy(ry)}" stroke="var(--text-3)" stroke-dasharray="4 3"/>`;
    g += `<text class="ax" x="${(L + W - R) / 2}" y="${H - 3}" text-anchor="middle">매출 성장률 →</text><text class="ax" transform="translate(13 ${T + ph / 2}) rotate(-90)" text-anchor="middle">영업이익률 →</text>`;
    // 사분면 이름은 점 위에 바탕색 테두리를 둘러 마지막에 그린다(점에 가리지 않게)
    const qlab = opt.zero ? "" : `<text class="ax qlab" x="${W - R - 4}" y="${T + 12}" text-anchor="end">${TYPES[0]} ↗</text><text class="ax qlab" x="${L + 6}" y="${T + ph - 6}">↙ ${TYPES[3]}</text>`;
    const rmax = Math.max(...points.map((p) => p.size || 1)), placed = [];
    // 기업 점은 왼쪽부터 놓아 화살표 키 이동 순서가 화면 순서와 같게 한다. Tab 정지는 첫 점 하나만
    if (points.some((p) => p.co)) points = points.slice().sort((a, b) => cxv(a.x) - cxv(b.x));
    let first = true;
    points.forEach((p) => {
      const r = opt.sized ? 6 + 16 * Math.sqrt((p.size || 0) / rmax) : 4.5;
      g += `<circle cx="${cx(p.x)}" cy="${cy(p.y)}" r="${r}" fill="${p.color}" fill-opacity="${opt.sized ? 0.3 : 0.7}" stroke="${p.color}" stroke-width="1.2"${p.co ? ` data-co="${p.co}" class="pt" tabindex="${first ? 0 : -1}" role="button" aria-label="${esc(p.tip)}"` : ""} data-tip="${esc(p.tip)}"/>`;
      if (p.co) first = false;
      if (p.label) {
        // 이미 놓인 라벨과 겹치면 점 아래로 옮긴다
        // 위·아래·오른쪽·왼쪽 순으로 이미 놓인 라벨과 겹치지 않는 자리를 고른다
        const lw = p.label.length * 6.6, px = cx(p.x), py = cy(p.y);
        const spots = [[px, py - r - 4, "middle"], [px, py + r + 12, "middle"], [px + r + 4, py + 4, "start"], [px - r - 4, py + 4, "end"]];
        const box = ([x, y, a]) => { const x0 = a === "middle" ? x - lw / 2 : a === "start" ? x : x - lw; return [x0, y - 10, x0 + lw, y + 2]; };
        const hit = (b) => placed.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
        const s = spots.find((sp) => !hit(box(sp))) || spots[0];
        placed.push(box(s));
        g += `<text class="val" x="${s[0]}" y="${s[1]}" text-anchor="${s[2]}">${esc(p.label)}</text>`;
      }
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="${points.some((p) => p.co) ? "group" : "img"}" aria-label="${esc(opt.label || "성장률과 이익률 분포")}${points.some((p) => p.co) ? " · 화살표 키로 기업 이동, Enter로 열기" : ""}">${g}${qlab}</svg>`;
  }
  const KIND_COLOR = { 소재: "var(--blue)", 부품: "var(--teal)", 장비: "var(--orange)", "IT·서비스": "var(--purple)", [NA]: "var(--gray)" };
  const TYPE_COLOR = SB.TYPE_COLOR;
  const sevOf = (r) => Math.min(9, ...SB.signalsOf(r).map((s) => s.sev));

  // ---------- 01 경영 개요 ----------
  function kpis(rows, S, FS) {
    // 기본은 대형사 제외: 빠진 규모를 첫 카드에 바로 보여 주고 누르면 포함으로 바꾼다
    const BG = state.big === "exclude" ? SB.stats(SB.panel(recs.filter((r) => F.inBase(r) && SB.isBig(r)), state.fy)) : null;
    const bigLine = BG && BG.n ? `<button type="button" class="db-bigswitch" data-big="include"><span>대형사 ${BG.n}곳(${won(BG.s1)}) 별도</span><span>포함 시 ${won(S.s1 + BG.s1)}</span><i class="ph ph-arrow-right" aria-hidden="true"></i></button>` : "";
    $("kpis").innerHTML = [
      { hero: 1, icon: "ph-currency-krw", label: `${state.fy}년 합산 매출 · ${S.n}곳`, value: `${won(S.s1)}<small>원</small>`, delta: delta(S.g, "동일 기업 기준") + bigLine },
      { icon: "ph-coins", label: "영업이익", value: won(S.o1), delta: S.og == null ? `<span class="vs">전년 적자</span>` : delta(S.og, "전년 대비") },
      { icon: "ph-percent", label: "영업이익률(합산)", value: pc(S.m), delta: `${delta(S.m - S.m0, `전년 ${pc(S.m0)}`, "pp")}<span class="vs db-sub2">업체 중앙값 ${pc(S.medM)}</span>` },
      { icon: "ph-check-circle", label: "흑자 업체 비중", value: pc(S.profit, 0), delta: `${delta(S.profit - S.profit0, "전년 대비", "pp")}<span class="vs db-sub2">영업적자 ${S.loss}곳</span>` },
      { icon: "ph-arrow-fat-lines-up", label: "매출 증가 업체", value: pc(S.up, 0), delta: `<span class="vs">중앙값 성장률 ${sg(S.medG)}</span>` },
      { icon: "ph-scales", label: "상위 10개사 집중도", value: pc(SB.concentration(rows, 10), 0), delta: `<span class="vs">상위 50개사 ${pc(SB.concentration(rows, 50), 0)}</span>` },
    ].map(kpi).join("");
  }
  // 개요 맨 위 한 줄 결론: 규모·수익성·우선 확인 대상
  function headline(rows, S) {
    const pri = rows.filter((r) => sevOf(r) === 1).length;
    $("headline").innerHTML = `<b>${state.fy}년 ${S.n}곳 매출 ${won(S.s1)}원(${sg(S.g)}), 영업이익률 ${pc(S.m)}(${pp(S.m - S.m0)}).</b> ${pri ? `<a href="#signals">우선 확인 신호 ${pri}곳 보기 <i class="ph ph-arrow-right" aria-hidden="true"></i></a>` : "우선 확인 신호에 해당하는 기업은 없습니다."}`;
  }
  const niceStep = (v) => { const e = Math.pow(10, Math.floor(Math.log10(v || 1))), f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; };
  // 매출·영업이익 막대(아래) + 영업이익률 선(위쪽 띠)
  // 값 범위에 맞춘 축: 0부터가 아니라 값 주변으로(예: 86.5~94.5조 → 80~100조). 양수만 있으면 0 아래로는 내리지 않는다
  // 두 축(매출·영업이익)이 같은 격자선을 쓰도록 눈금 수 k를 함께 고르고, 빈 공간이 가장 적은 k를 택한다
  function fitAxes(...series) {
    const base = series.map((vals) => {
      const v = vals.filter((x) => x != null);
      if (!v.length) return { lo0: 0, top: 1 };
      const mn = Math.min(...v), mx = Math.max(...v), pad = Math.max((mx - mn) * 0.5, Math.abs(mx) * 0.05, 1);
      return { lo0: mn >= 0 ? Math.max(0, mn - pad) : mn - pad, top: mx + pad };
    });
    const fit = (b, k) => {
      const e10 = Math.pow(10, Math.floor(Math.log10((b.top - b.lo0) / k || 1)));
      for (const f of [1, 2, 2.5, 5, 10, 20, 25, 50]) { const step = f * e10, lo = Math.floor(b.lo0 / step) * step; if (lo + step * k >= b.top) return { lo, step, waste: (step * k) / (b.top - b.lo0) }; }
      return null;
    };
    let best = null;
    [3, 4, 5].forEach((k) => { const ax = base.map((b) => fit(b, k)); if (ax.every(Boolean)) { const w = ax.reduce((t, x) => t + x.waste, 0); if (!best || w < best.w) best = { k, ax, w }; } });
    return best;
  }
  // 매출 막대(왼쪽 축) + 영업이익 막대(오른쪽 축) + 영업이익률 선(위쪽 띠)
  function comboChart(labels, sales, ops, opt = {}) {
    const n = labels.length, H = 260, L = 50, R = 50, T = 18, B = 28, pw = W - L - R, ph = H - T - B, band = 62; // 위 62px는 이익률 선, 아래는 막대
    const margins = sales.map((v, i) => (v > 0 && ops[i] != null ? share(ops[i], v) : null));
    const legend = opt.legend ? `<ul class="db-legend db-mini-leg"><li><i class="sq" style="background:var(--blue)"></i>매출(왼쪽 축)</li><li><i class="sq" style="background:var(--green)"></i>영업이익(오른쪽 축)</li><li><i style="background:var(--orange)"></i>영업이익률</li></ul>` : "";
    // 두 축의 눈금 수를 맞춰 격자선을 함께 쓴다
    const { k, ax: [A] } = fitAxes(sales, ops);
    // 영업이익 축: 0에서 시작하고, 영업이익 막대가 같은 시점 매출 막대 높이의 60%를 넘지 않게 범위를 넓힌다
    const O = (() => {
      const hs = (i) => Math.max(0.05, (sales[i] - A.lo) / (A.step * k));
      const req = Math.max(1, ...ops.map((o, i) => (o > 0 && sales[i] != null ? o / (0.6 * hs(i)) : 0)));
      const mn = Math.min(0, ...ops.filter((x) => x != null)), mx = Math.max(0, ...ops.filter((x) => x != null));
      const e10 = Math.pow(10, Math.floor(Math.log10(req / k)));
      for (const f of [1, 2, 2.5, 5, 10, 20, 25, 50, 100]) {
        const step = f * e10, lo = mn < 0 ? -Math.ceil((-mn * 1.15) / step) * step : 0;
        if (step * k >= req && lo + step * k >= mx) return { lo, step };
      }
      return { lo: 0, step: niceStep(req / k) };
    })();
    const bh = ph - band, mk = (ax) => { const hi = ax.lo + ax.step * k; return (v) => T + band + bh - ((v - ax.lo) / (hi - ax.lo)) * bh; };
    const yS = mk(A), yO = mk(O), base = (ax) => (ax.lo < 0 ? 0 : ax.lo); // 막대는 0(축 안에 있으면) 또는 축 하한에서 시작
    const mv = margins.filter((v) => v != null), mLo = Math.min(0, ...mv), mHi = Math.max(...mv, mLo + 5), span = mHi - mLo; // 0을 기준으로 그려 작은 변화를 과장하지 않는다
    const ym = (v) => T + 16 + (1 - (v - mLo) / span) * (band - 30);
    const slot = pw / n, bw = Math.min(opt.bw || 22, slot * 0.32), cx = (i) => L + slot * i + slot / 2;
    let g = "";
    g += `<text class="ax" x="${L - 6}" y="${T + 12}" text-anchor="end">이익률</text><line class="grid" x1="${L}" x2="${W - R}" y1="${T + band - 4}" y2="${T + band - 4}" stroke-dasharray="2 3"/>`;
    const fS = wonRow([A.lo, A.lo + A.step * k]), fO = wonRow([O.lo, O.lo + O.step * k]); // 한 축은 같은 단위(조 또는 억)
    for (let i = 0; i <= k; i++) {
      const vs = A.lo + A.step * i, vo = O.lo + O.step * i, yy = yS(vs);
      g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text class="ax axl" x="${L - 6}" y="${yy + 4}" text-anchor="end">${fS(vs)}</text><text class="ax axr" x="${W - R + 6}" y="${yy + 4}">${fO(vo)}</text>`;
    }
    if (O.lo < 0) g += `<line x1="${L}" x2="${W - R}" y1="${yO(0)}" y2="${yO(0)}" stroke="var(--text-3)" stroke-width="1"/>`;
    labels.forEach((l, i) => {
      const x = cx(i), s = sales[i], o = ops[i];
      if (s == null) { g += `<text class="ax" x="${x}" y="${yS(base(A)) - 6}" text-anchor="middle">결측</text><text class="ax" x="${x}" y="${H - 8}" text-anchor="middle">${l}</text>`; return; }
      g += `<rect x="${x - bw - 1}" y="${Math.min(yS(s), yS(base(A)))}" width="${bw}" height="${Math.max(1, Math.abs(yS(s) - yS(base(A))))}" rx="3" fill="var(--blue)"/>`;
      if (o != null) g += `<rect x="${x + 1}" y="${Math.min(yO(o), yO(base(O)))}" width="${bw}" height="${Math.max(1, Math.abs(yO(o) - yO(base(O))))}" rx="3" fill="${o < 0 ? "var(--down)" : "var(--green)"}"/>`;
      if (opt.values) g += `<text class="val" x="${x - bw / 2 - 1}" y="${yS(s) - 5}" text-anchor="middle">${won(s)}</text>`;
      g += `<text class="ax" x="${x}" y="${H - 8}" text-anchor="middle">${l}</text>`;
      g += `<rect class="hit" x="${x - slot / 2}" y="${T}" width="${slot}" height="${ph}" data-tip="${l} 매출 ${won(s)} · 영업이익 ${won(o)} · 이익률 ${pc(margins[i])}"/>`;
    });
    const pts = margins.map((m, i) => (m == null ? null : [cx(i), ym(m), m])).filter(Boolean);
    g += `<polyline points="${pts.map((p) => p[0] + "," + p[1]).join(" ")}" fill="none" stroke="var(--orange)" stroke-width="2.2" stroke-linejoin="round"/>`;
    pts.forEach((p) => (g += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="var(--card)" stroke="var(--orange)" stroke-width="2"/><text class="mval" x="${p[0]}" y="${p[1] - 8}" text-anchor="middle">${pc(p[2])}</text>`));
    return `${legend}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${opt.label}">${g}</svg>`;
  }
  // 연도별 수치 표: 매출·영업이익·이익률·임직원, 마지막 열은 전년 대비
  // 한 줄 안에서는 같은 단위(조 또는 억)로 맞춘다
  const wonRow = (vals) => (Math.max(...vals.filter((v) => v != null).map(Math.abs), 0) >= 10000 ? (v) => (v == null ? "-" : `${(v / 10000).toFixed(1)}조`) : won);
  const people = (v) => (v == null ? "-" : `${Math.round(v).toLocaleString("ko-KR")}명`);
  // sE: 임직원 공시 기업의 매출(1인당 매출 계산용, 기업 하나면 s와 같다)
  function yearTable(years, s, o, e, eNote, sE = s) {
    const n = years.length, last = n - 1, m = s.map((v, i) => (v > 0 && o[i] != null ? share(o[i], v) : null));
    const chg = (a, b, f) => (a == null || b == null ? "-" : f(a, b));
    const row = (k, vals, fmt, d) => `<tr><th scope="row">${k}</th>${vals.map((v) => `<td>${fmt(v)}</td>`).join("")}<td class="${d.cls || ""}">${d.txt}</td></tr>`;
    const gr = (a, b) => { const v = growth(a, b); return { txt: sg(v), cls: tone(v) }; };
    const sd = n > 1 ? gr(s[last], s[last - 1]) : { txt: "-" }, od = n < 2 || o[last] == null || o[last - 1] == null ? { txt: "-" }
      : o[last - 1] > 0 && o[last] < 0 ? { txt: "적자 전환", cls: "down" } : o[last - 1] < 0 && o[last] > 0 ? { txt: "흑자 전환", cls: "up" }
      : o[last - 1] < 0 ? { txt: "적자 지속", cls: "down" } : gr(o[last], o[last - 1]);
    const md = n > 1 && m[last] != null && m[last - 1] != null ? { txt: pp(m[last] - m[last - 1]), cls: tone(m[last] - m[last - 1]) } : { txt: "-" };
    const ed = n > 1 && e && e[last] != null && e[last - 1] > 0 ? (() => { const d = e[last] - e[last - 1]; return { txt: `${d > 0 ? "+" : ""}${d.toLocaleString("ko-KR")}명 (${sg(growth(e[last], e[last - 1]))})`, cls: tone(d) }; })() : { txt: "-" };
    return `<table class="db-tbl db-ytbl"><thead><tr><th scope="col">구분</th>${years.map((y) => `<th scope="col">${y}</th>`).join("")}<th scope="col">전년 대비</th></tr></thead><tbody>`
      + row("매출", s, wonRow(s), sd) + row("영업이익", o, wonRow(o), od) + row("영업이익률", m, (v) => pc(v), md)
      + row("임직원", e || years.map(() => null), people, ed)
      + (() => { const pv = years.map((_, i) => (e && e[i] > 0 && sE[i] != null ? sE[i] / e[i] : null)); return pv.some((v) => v != null) ? row("1인당 매출", pv, (v) => (v == null ? "-" : `${v.toFixed(1)}억`), n > 1 ? gr(pv[last], pv[last - 1]) : { txt: "-" }) : ""; })()
      + `</tbody></table>${eNote ? `<p class="db-mini">${eNote}</p>` : ""}`;
  }
  // 기준 연도까지 최대 3년: 자료가 있는 해만 쓴다(예: 2024년 기준이면 수집된 2023·2024년)
  function yearlyChart(rows) {
    const fy = state.fy, at = (r, k, y) => SB.at(r, r[k], y);
    const Y = [fy - 2, fy - 1, fy].filter((y) => rows.some((r) => at(r, "s", y) > 0));
    const P = Y.length ? rows.filter((r) => Y.every((y) => at(r, "s", y) > 0 && at(r, "o", y) != null)) : [];
    $("yearly-sub").textContent = P.length ? `${Y.length}년 실적이 모두 있는 ${P.length}곳` : "";
    if (!P.length) return `<p class="db-empty">이 조건에는 연도별 실적이 모두 있는 기업이 없습니다.</p>`;
    const tot = (list, k) => Y.map((y) => sum(list.map((r) => at(r, k, y))));
    const s = tot(P, "s"), o = tot(P, "o");
    const PE = P.filter((r) => Y.every((y) => at(r, "e", y) > 0)), e = PE.length ? tot(PE, "e") : null, sE = tot(PE, "s");
    const yrs = Y.map((y) => `${y}년`);
    return comboChart(yrs, s, o, { values: true, bw: 34, label: "연도별 매출·영업이익·영업이익률" })
      + yearTable(yrs, s, o, e, e ? `임직원은 ${Y.length}년 모두 사업보고서로 공시한 ${PE.length}곳 합계입니다(감사보고서만 내는 비상장사는 공시하지 않음).` : "임직원 수는 사업보고서 제출 기업만 공시합니다. 다음 자동 갱신 후 표시됩니다.", sE)
      + (Y.length < 3 ? `<p class="db-mini">${fy - 2}년 실적은 수집 범위(최근 3개 사업연도) 밖이라 ${Y[0]}년부터 표시합니다.</p>` : "");
  }
  // 분기 수치 표: 임직원은 반기말(2Q)·연말(4Q)만 공시돼 그 칸에만 들어간다
  function quarterTable(labels, s, o, e, eNote) {
    const m = s.map((v, i) => (v > 0 && o[i] != null ? share(o[i], v) : null));
    const row = (k, vals, fmt) => `<tr><th scope="row">${k}</th>${vals.map((v) => `<td${typeof v === "number" && v < 0 ? ' class="down"' : ""}>${fmt(v)}</td>`).join("")}</tr>`;
    // 임직원은 반기 단위: 1Q·2Q(3Q·4Q) 두 칸을 합쳐 반기말 인원을 한 번만 적는다
    const eCells = [];
    for (let i = 0; i < labels.length; i++) {
      const half = /\.(1|3)Q$/.test(labels[i]) && labels[i + 1] && /\.(2|4)Q$/.test(labels[i + 1]);
      const l = half ? labels[i + 1] : labels[i], v = e ? e[l] : null;
      eCells.push(`<td${half ? ' colspan="2" class="half"' : ""}>${v == null ? "-" : `${people(v)}<small>${/\.2Q$/.test(l) ? "반기말" : /\.4Q$/.test(l) ? "연말" : ""}</small>`}</td>`);
      if (half) i++;
    }
    return `<div class="db-qwrap"><table class="db-tbl db-ytbl db-qtbl"><thead><tr><th scope="col">구분</th>${labels.map((l) => `<th scope="col">${l}</th>`).join("")}</tr></thead><tbody>`
      + row("매출", s, wonRow(s)) + row("영업이익", o, wonRow(o)) + row("영업이익률", m, (v) => pc(v)) + `<tr><th scope="row">임직원</th>${eCells.join("")}</tr>`
      + `</tbody></table></div><p class="db-mini">${eNote}</p>`;
  }
  // 좁은 화면 분기 라벨: 해가 바뀌는 1Q와 첫 칸에만 연도를 남긴다
  const qShort = (labels) => (W < 450 ? labels.map((l, i) => l.replace(/^'(\d\d)\.(\d)Q$/, (m, y, q) => (i === 0 || q === "1" ? m : `${q}Q`))) : labels);
  function trendChart(list) {
    const Q = SB.quarters(list);
    $("trend-sub").textContent = Q.P.length ? `상장 ${Q.P.length}곳 · 최근 8개 분기` : "";
    if (!Q.P.length) return `<p class="db-empty">이 조건에는 분기 실적이 있는 상장사가 없습니다. 비상장사는 분기 실적을 공시하지 않습니다.</p>`;
    const { labels, s, o } = Q, ltm = growth(sum(s.slice(4)), sum(s.slice(0, 4))), yoy = growth(s[7], s[3]);
    const short = qShort(labels);
    // 임직원: 반기말·연말 인원이 모두 있는 기업만 더해 시점끼리 비교되게 한다
    const eL = labels.filter((l) => /\.(2|4)Q$/.test(l)), PE = Q.P.filter((r) => r.qe && eL.every((l) => r.qe[l] != null));
    const e = PE.length ? Object.fromEntries(eL.map((l) => [l, sum(PE.map((r) => r.qe[l]))])) : null;
    return comboChart(short, s, o, { bw: 12, label: "분기 매출·영업이익·영업이익률" })
      + quarterTable(labels, s, o, e, e ? `임직원은 반기보고서(6월 말)·사업보고서(12월 말)에만 공시돼 반기 단위로 표시합니다(모두 공시한 ${PE.length}곳 합계).` : "임직원은 반기말(2Q)·연말(4Q)만 공시합니다. 다음 자동 갱신 후 표시됩니다.")
      + note(`최근 분기(${labels[7]}) 매출 전년 동기 대비 <b class="${tone(yoy)}">${sg(yoy)}</b> · 최근 4분기 합계 ${won(sum(s.slice(4)))}원, 직전 4분기 대비 <b class="${tone(ltm)}">${sg(ltm)}</b>.`);
  }
  function kindScatter(rows) {
    const pts = [];
    // 상장·비상장이 섞여 있을 때만 나눠 그린다(대상사가 모두 상장사면 업종만)
    const split = rows.some((r) => r.l) && rows.some((r) => !r.l);
    const groups = split ? [["상장", 1], ["비상장", 0]] : [["", null]];
    KINDS.forEach((k) => groups.forEach(([ln, l]) => {
      const rs = rows.filter((r) => r.kind === k && (l == null || r.l === l));
      if (rs.length < 3) return;
      const st = SB.stats(rs);
      pts.push({ x: st.g, y: st.m, size: st.s1, color: KIND_COLOR[k], label: ln ? `${k}·${ln}` : k, tip: `${k}${ln ? " " + ln : ""} ${st.n}곳 · 매출 ${won(st.s1)} · 성장 ${sg(st.g)} · 이익률 ${pc(st.m)}` });
    }));
    if (!pts.length) return `<p class="db-empty">자료가 없습니다.</p>`;
    return scatter(pts, { sized: 1, fit: 1, h: 270, label: "업종별 성장률과 이익률" }) + note(`점선은 기업 유형 기준(성장 ${SB.HI_GROWTH}%, 이익률 ${SB.HI_MARGIN}%)입니다. 3곳 미만 집단은 뺐습니다.`);
  }
  // 주요 변화 3건: 관측(데이터로 확인된 사실)과 해석(가설)을 나눠 적는다
  function changes(rows, S) {
    const out = [];
    const ks = KINDS.filter((k) => k !== NA).map((k) => [k, SB.stats(rows.filter((r) => r.kind === k))]).filter(([, s]) => s.n >= 5);
    if (ks.length) {
      const fast = ks.slice().sort((a, b) => b[1].g - a[1].g)[0];
      out.push({ t: `성장 선두 업종: ${fast[0]}`, fact: `${fast[0]} ${fast[1].n}곳 매출 ${sg(fast[1].g)}(전체 ${sg(S.g)}), 업체 중앙값 ${sg(fast[1].medG)}`,
        read: fast[1].g - fast[1].medG > 5 ? "합계가 중앙값보다 크게 높아 일부 기업이 성장을 이끈 것으로 보입니다." : fast[1].g > S.g + 3 ? "업종 전반으로 수요가 늘었을 가능성이 있습니다." : "업종 간 성장 속도 차이는 크지 않습니다.", kind: fast[0] });
      const worst = ks.slice().sort((a, b) => (a[1].m - a[1].m0) - (b[1].m - b[1].m0))[0], dm = worst[1].m - worst[1].m0;
      out.push({ t: dm < 0 ? `수익성 하락 업종: ${worst[0]}` : "업종 수익성", fact: `${worst[0]} 영업이익률 ${pc(worst[1].m0)} → ${pc(worst[1].m)}(${pp(dm)}), 적자 ${worst[1].loss}곳`,
        read: dm < -1 ? "원가 상승이나 가격 경쟁 가능성이 있습니다. 위험 신호의 '수익성 악화' 기업에서 확인하세요." : "업종 단위로 뚜렷한 수익성 악화는 보이지 않습니다.", kind: worst[0] });
    }
    const weak = rows.filter((r) => r.o1 < 0 && r.g < 0), turn = rows.filter((r) => r.o0 > 0 && r.o1 < 0);
    out.push({ t: "추가 검토 기업군", fact: `매출 감소와 영업적자가 겹친 기업 ${weak.length}곳, 적자 전환 ${turn.length}곳`,
      read: weak.length ? `대표: ${weak.slice().sort((a, b) => b.s1 - a.s1).slice(0, 3).map((r) => r.n).join(", ")}. 일회성 요인인지 구조적 부진인지 확인이 필요합니다.` : "동시에 악화된 기업은 없습니다.", link: "#signals" });
    return out.slice(0, 3).map((c) => `<li><b>${c.t}</b><p><span class="db-lbl fact">관측</span>${c.fact}</p><p><span class="db-lbl read">해석</span>${c.read}</p>${c.kind ? `<a class="db-link" href="#portfolio" data-kindgo="${c.kind}">${c.kind} 기업 보기 →</a>` : `<a class="db-link" href="${c.link}">위험 신호 보기 →</a>`}</li>`).join("");
  }
  function insights(rows, S, FS) {
    const out = [];
    out.push([S.g < 0 ? "bad" : "", "ph-trend-up", `매출 성장률 ${sg(S.g)} · 영업이익 ${S.og == null ? "전년 적자" : sg(S.og)}`,
      `두 해 매출이 모두 있는 ${S.n}곳의 합계로 비교했습니다.`]);
    const sorted = rows.slice().sort((a, b) => b.s1 - a.s1), t10 = share(sum(sorted.slice(0, 10).map((r) => r.s1)), S.s1), rest = SB.stats(sorted.slice(10));
    out.push([t10 >= 40 ? "bad" : "", "ph-scales", `상위 10개사 매출 비중 ${pc(t10, 0)} · 업체 중앙값 성장률 ${sg(S.medG)}`,
      (t10 >= 40 ? `상위 10개사를 빼면 성장률 ${sg(rest.g)}, 이익률 ${pc(rest.m)}입니다. ` : "") + (S.g - S.medG > 2 ? "합계 성장은 큰 기업들이 이끌었습니다." : S.medG - S.g > 2 ? "일반 업체가 상위 기업보다 더 크게 성장했습니다." : "업체 중앙값과 합계 성장률이 비슷합니다.")]);
    const tiers = window.SIZE_TIERS.map((t) => [t, SB.stats(rows.filter((r) => window.sizeTier(r.s1) === t))]).filter(([, s]) => s.n >= 5);
    if (tiers.length >= 2) {
      const a = tiers[0], b = tiers[tiers.length - 1];
      out.push([Math.abs(a[1].m - b[1].m) >= 3 ? "bad" : "", "ph-stack", `규모별 이익률: ${a[0]} ${pc(a[1].m)} · ${b[0]} ${pc(b[1].m)}`, `${b[0]} ${b[1].n}곳은 성장률 ${sg(b[1].g)}, 적자 비중 ${pc(b[1].lossP, 0)}입니다.`]);
    }
    if (S.eN) out.push([S.eg < 0 ? "bad" : "", "ph-users-three", `임직원 ${people(S.e1)}(${sg(S.eg)}) · 1인당 매출 ${S.prod.toFixed(1)}억`,
      `두 해 모두 공시한 ${S.eN}곳 기준, 인원이 줄어든 곳 ${S.eDown}곳. ${Math.abs(S.g - S.eg) < 1 ? "매출과 인력이 비슷하게 늘었습니다." : S.g > S.eg ? "매출이 인력보다 빠르게 늘어 생산성이 높아졌습니다." : "인력이 매출보다 빠르게 늘었습니다."}`]);
    const best = rows.filter((r) => r.type === TYPES[0]);
    out.push(["good", "ph-rocket-launch", `${TYPES[0]} ${best.length}곳(${pc(share(best.length, S.n), 0)})`, best.length ? `대표: ${best.slice().sort((x, y) => y.s1 - x.s1).slice(0, 3).map((r) => r.n).join(", ")}` : "기준을 넘는 업체가 없습니다."]);
    return out.map(([c, ic, what, so]) => `<li><span class="ic ${c}"><i class="ph ${ic}" aria-hidden="true"></i></span><span><b>${what}</b><small>${so}</small></span></li>`).join("");
  }

  // ---------- 02 산업·업종 분석 ----------
  function mixCard(rows, S) {
    const items = KINDS.map((k) => { const rs = rows.filter((r) => r.kind === k), st = SB.stats(rs); return { label: k, v: st.s1, right: pc(share(st.s1, S.s1), 0), g: st.g, n: rs.length, tip: `${k} ${rs.length}곳 · 매출 ${won(st.s1)} · 영업이익률 ${pc(st.m)}`, link: `<a href="#portfolio" data-kindgo="${k}">${k}</a>` }; }).filter((i) => i.n);
    if (!items.length) return `<p class="db-empty">자료가 없습니다.</p>`;
    const best = items.filter((i) => i.label !== NA).sort((a, b) => b.g - a.g)[0];
    if (best) best.cls = "hi";
    const unk = items.find((i) => i.label === NA), est = rows.filter((r) => r.kindEst).length;
    return hbarList(items, { head: ["비중", "성장률"] }) + note(`${best ? `성장은 <b>${best.label}</b>(${sg(best.g)})이 가장 빠릅니다. ` : ""}가운데는 매출 비중, 오른쪽은 성장률입니다. 업종 추정 ${est}곳${unk ? `, 미분류 ${unk.n}곳` : ""} 포함.`);
  }
  function regionCard(rows, S) {
    const items = AREAS.map((a) => { const rs = rows.filter((r) => r.area === a), st = SB.stats(rs); return { label: a, v: st.s1, right: won(st.s1), g: st.g, n: rs.length, tip: `${a} ${rs.length}곳 · 매출 ${won(st.s1)} · 영업이익률 ${pc(st.m)}` }; }).filter((i) => i.n);
    if (!items.length) return `<p class="db-empty">자료가 없습니다.</p>`;
    const top = items.slice().sort((a, b) => b.v - a.v)[0], worst = items.filter((i) => i.n >= 3).sort((a, b) => a.g - b.g)[0];
    top.cls = "hi";
    if (worst && worst.g < S.g - 5) worst.cls = "warn";
    return hbarList(items, { head: ["매출", "성장률"] }) + (worst && worst.cls === "warn" ? note(`<b>${worst.label}</b> 권역 매출 ${sg(worst.g)}로 전체(${sg(S.g)})보다 크게 낮습니다.`, 1) : note(`<b>${top.label}</b> 권역이 매출의 ${pc(share(top.v, S.s1), 0)}를 차지합니다.`));
  }
  function summary(rows, S) {
    const tr = (label, st, foot) => `<tr>${foot ? `<td>${label}</td>` : `<th scope="row">${label}</th>`}<td>${st.n}</td><td>${won(st.s1)}</td><td>${pc(share(st.s1, S.s1), 0)}</td><td class="${tone(st.g)}">${sg(st.g)}</td><td>${pc(st.m)}</td><td>${pc(st.medM)}</td><td>${pc(st.lossP, 0)}</td></tr>`;
    const grp = (label, rs) => (rs.length ? tr(label, SB.stats(rs)) : "");
    const body = `<tr class="grp"><td colspan="8">업종</td></tr>` + KINDS.map((k) => grp(k, rows.filter((r) => r.kind === k))).join("")
      + (rows.some((r) => r.l) && rows.some((r) => !r.l) ? `<tr class="grp"><td colspan="8">상장 여부</td></tr>` + grp("상장", rows.filter((r) => r.l)) + grp("비상장", rows.filter((r) => !r.l)) : "")
      + `<tr class="grp"><td colspan="8">매출 규모</td></tr>` + window.SIZE_TIERS.map((t) => grp(t, rows.filter((r) => window.sizeTier(r.s1) === t))).join("");
    return `<thead><tr><th>구분</th><th>업체</th><th>매출</th><th>비중</th><th>성장률</th><th>이익률(합산)</th><th>이익률 중앙값</th><th>적자 비중</th></tr></thead><tbody>${body}</tbody><tfoot>${tr("합계", S, true)}</tfoot>`;
  }
  function concCard(rows) {
    const c10 = SB.concentration(rows, 10), c50 = SB.concentration(rows, 50), c100 = SB.concentration(rows, 100);
    const seg = [["상위 10", c10], ["11~50위", c50 - c10], ["51~100위", c100 - c50], ["기타", 100 - c100]];
    const colors = ["var(--stk-1)", "var(--stk-2)", "var(--stk-3)", "var(--stk-4)"];
    return `<div class="db-stack">${seg.map(([l, v], i) => `<span class="s${i + 1}" style="flex:${Math.max(v, 0.01)};background:${colors[i]}" data-tip="${l} ${pc(v, 0)}">${v >= 8 ? pc(v, 0) : ""}</span>`).join("")}</div>`
      + `<ul class="db-legend stack">${seg.map(([l, v], i) => `<li><i style="background:${colors[i]}"></i>${l} <b>${pc(v, 0)}</b></li>`).join("")}</ul>`
      + concTrend(rows)
      + note(c10 >= 40 ? "소수 기업 의존도가 높습니다." : "특정 기업 쏠림은 크지 않습니다.", c10 >= 40);
  }
  // 같은 기업(3개년 매출 보유) 기준으로 해마다 집중도를 비교해 쏠림이 커지는지 본다. HHI = Σ(매출 비중%)²
  function concTrend(rows) {
    const three = rows.filter((r) => r.s2 > 0);
    if (three.length < 20) return "";
    const yrs = [[state.fy - 2, "s2"], [state.fy - 1, "s0"], [state.fy, "s1"]].map(([y, k]) => {
      const v = three.map((r) => r[k]).sort((a, b) => b - a), tot = sum(v);
      return { y, c10: share(sum(v.slice(0, 10)), tot), c50: share(sum(v.slice(0, 50)), tot), hhi: sum(v.map((x) => (x / tot * 100) ** 2)) };
    });
    const d = yrs[2].c10 - yrs[0].c10;
    return `<table class="db-tbl db-conc-t"><thead><tr><th>연도</th><th>상위 10</th><th>상위 50</th><th><abbr title="허핀달-허쉬만 지수: 기업별 매출 비중(%) 제곱의 합">HHI</abbr></th></tr></thead><tbody>${yrs.map((x) => `<tr><th scope="row">${x.y}년</th><td>${pc(x.c10, 1)}</td><td>${pc(x.c50, 1)}</td><td>${Math.round(x.hhi).toLocaleString("ko-KR")}</td></tr>`).join("")}</tbody></table>`
      + `<p class="db-mini">3개년 매출이 모두 있는 ${three.length}곳 기준. 상위 10개사 비중이 ${Math.abs(d) < 0.5 ? "거의 변하지 않았습니다" : `${pp(d)} ${d > 0 ? "높아져 쏠림이 커졌습니다" : "낮아져 쏠림이 줄었습니다"}`}. HHI(집중 지수)는 매출 비중을 제곱해 더한 값으로, 1,500 미만이면 집중도가 낮은 구조로 봅니다.</p>`;
  }
  function bigCard() {
    const big = SB.panel(recs.filter((r) => F.inBase(r) && SB.isBig(r)), state.fy), rest = SB.panel(recs.filter((r) => F.inBase(r) && !SB.isBig(r)), state.fy);
    if (!big.length) return `<p class="db-empty">조건에 맞는 대형사가 없습니다.</p>`;
    const B = SB.stats(big), O = SB.stats(rest), list = big.slice().sort((a, b) => b.s1 - a.s1);
    const status = state.big === "exclude" ? "다른 지표에서는 제외돼 있습니다." : state.big === "only" ? "지금은 대형사만 보고 있습니다." : "다른 지표에 포함돼 있습니다.";
    return `<div class="db-big-kpi"><div><span>업체</span><b>${B.n}곳</b></div><div><span>매출</span><b>${won(B.s1)}</b></div><div><span>성장률</span><b class="${tone(B.g)}">${sg(B.g)}</b></div><div><span>이익률</span><b>${pc(B.m)}</b></div></div>`
      + note(`대형사가 전체 매출의 ${pc(share(B.s1, B.s1 + O.s1), 0)}를 차지합니다. 나머지 ${O.n}곳은 성장률 ${sg(O.g)}, 이익률 ${pc(O.m)}입니다. ${status}`)
      + hbarList(list.map((r) => ({ label: r.n, link: coLink(r), v: r.s1, right: won(r.s1), g: r.g })), { wide: 1, head: ["매출", "성장률"] });
  }

  // ---------- 03 기업 포트폴리오 ----------
  function coScatter(rows, legendId = "cosc-legend", zero = false) {
    const pts = rows.filter((r) => r.m != null).map((r) => ({ x: r.g, y: r.m, color: TYPE_COLOR[r.type], co: r.c, tip: `${r.n} · 성장 ${sg(r.g)} · 이익률 ${pc(r.m)} · ${r.type}` }));
    $(legendId).innerHTML = TYPES.map((t) => `<li><i class="dot" style="background:${TYPE_COLOR[t]}"></i>${t} ${rows.filter((r) => r.type === t).length}</li>`).join("");
    if (!pts.length) return `<p class="db-empty">자료가 없습니다.</p>`;
    return scatter(pts, { clipX: 80, clipY: 40, zero, label: "기업별 성장률과 영업이익률" })
      + note(`${zero ? `점선은 0%(오른쪽은 매출 증가, 위는 영업흑자)입니다. 점 색은 기업 유형(성장 ${SB.HI_GROWTH}%·이익률 ${SB.HI_MARGIN}% 기준)입니다. ` : ""}성장률 ±80%, 이익률 ±40% 밖의 값은 가장자리에 표시합니다.`);
  }
  function boxCard(rows) {
    const groups = KINDS.map((k) => [k, rows.filter((r) => r.kind === k)]).filter(([, rs]) => rs.length >= 5);
    if (!groups.length) return `<p class="db-empty">비교할 업종이 없습니다.</p>`;
    const draw = (title, key, lo, hi) => {
      const L = 76, R = 16, rowH = 28, H = groups.length * rowH + 30, x = (v) => L + ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * (W - L - R);
      let g = `<line x1="${x(0)}" x2="${x(0)}" y1="4" y2="${H - 22}" stroke="var(--line)"/>`;
      [lo, (lo + hi) / 2, hi].forEach((v) => (g += `<text class="ax" x="${x(v)}" y="${H - 6}" text-anchor="middle">${v}%</text>`));
      groups.forEach(([k, rs], i) => {
        const vals = rs.map((r) => r[key]), q1 = SB.math.quantile(vals, 0.25), q2 = med(vals), q3 = SB.math.quantile(vals, 0.75), y = 6 + i * rowH;
        g += `<text class="ax" x="${L - 8}" y="${y + 15}" text-anchor="end">${k}</text><rect x="${x(q1)}" y="${y + 3}" width="${Math.max(2, x(q3) - x(q1))}" height="16" rx="3" fill="${KIND_COLOR[k]}" fill-opacity=".25" stroke="${KIND_COLOR[k]}" data-tip="${k} ${rs.length}곳 · 25% ${pc(q1)} · 중앙값 ${pc(q2)} · 75% ${pc(q3)}"/><line x1="${x(q2)}" x2="${x(q2)}" y1="${y + 1}" y2="${y + 21}" stroke="var(--text)" stroke-width="2"/>`;
      });
      return `<p class="db-mini">${title}</p><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title} 사분위">${g}</svg>`;
    };
    return draw("매출 성장률", "g", -20, 40) + draw("영업이익률", "m", -5, 25) + note("상자는 가운데 50% 기업의 범위, 굵은 선은 중앙값입니다. 상자가 넓을수록 업종 안 기업 간 격차가 큽니다.");
  }
  function top10(rows) {
    const t = rows.slice().sort((a, b) => b.s1 - a.s1).slice(0, 10);
    if (!t.length) return `<p class="db-empty">자료가 없습니다.</p>`;
    const avg = sum(t.map((r) => r.s1)) / t.length, down = t.filter((r) => r.g < 0);
    return hbarList(t.map((r, i) => ({ label: r.n, link: coLink(r), v: r.s1, right: won(r.s1), g: r.g, cls: i === 0 ? "hi" : r.g < 0 ? "warn" : "", tip: `${r.n} · ${r.kind} · 영업이익률 ${pc(r.m)}` })), { wide: 1, mark: avg, head: ["매출", "성장률"] })
      + note(down.length ? `상위 10개사 중 <b>${down.map((r) => r.n).join(", ")}</b> 매출이 줄었습니다.` : "상위 10개사 모두 매출이 늘었습니다.", down.length);
  }
  // 고성장 기업: 전년 매출 100억 미만은 기저효과 표시
  function fastCard(rows) {
    const t = rows.filter((r) => r.g != null).sort((a, b) => b.g - a.g).slice(0, 10);
    if (!t.length) return `<p class="db-empty">자료가 없습니다.</p>`;
    const small = t.filter((r) => r.s0 < 100).length;
    return hbarList(t.map((r) => ({ label: r.n, link: coLink(r) + (r.s0 < 100 ? '<small class="db-est" title="전년 매출 100억 미만">기저</small>' : ""), v: r.g, right: sg(r.g), g: r.m, gText: pc(r.m), tip: `${r.n} · 매출 ${won(r.s0)} → ${won(r.s1)}` })), { wide: 1, head: ["성장률", "이익률"] })
      + note(`${small ? `${small}곳은 전년 매출이 100억 미만이라 기저효과일 수 있습니다.` : "기저효과가 큰 소규모 기업은 없습니다."}`);
  }
  function funnel(rows) {
    const steps = [["분석 업체", rows], ["매출 증가", rows.filter((r) => r.g > 0)], ["증가 + 흑자", rows.filter((r) => r.g > 0 && r.o1 > 0)], ["이익률 5%↑", rows.filter((r) => r.g > 0 && r.m >= 5)], [TYPES[0], rows.filter((r) => r.type === TYPES[0])]];
    const n0 = rows.length || 1;
    return `<ol class="db-funnel">${steps.map(([l, rs], i) => `<li data-tip="${l} ${rs.length}곳 (${pc(share(rs.length, n0), 0)})"><span>${l}</span><span class="bar"><span style="width:${Math.max(4, share(rs.length, n0))}%;${i === steps.length - 1 ? `background:${TYPE_COLOR[TYPES[0]]}` : `opacity:${1 - i * 0.16}`}"></span></span><b>${rs.length}곳</b></li>`).join("")}</ol>`
      + `<p class="db-funnel-note">${TYPES[0]}(성장 ${SB.HI_GROWTH}%↑·이익률 ${SB.HI_MARGIN}%↑) ${pc(share(steps[4][1].length, n0), 0)}</p>`;
  }
  const CHIPS = ["전체", ...TYPES, "영업적자"];
  const BASE_COLS = [["n", "기업"], ["kind", "업종"], ["l", "상장"], ["area", "지역"], ["s1", "매출"], ["g", "성장률"], ["m", "영업이익률"], ["debt", "부채비율"], ["type", "유형"]];
  let listRows = [];
  function drawList() {
    const q = state.q.trim().toLowerCase();
    let rows = listRows.filter((r) => (!q || r.n.toLowerCase().includes(q)) && (state.chip === "전체" || (state.chip === "영업적자" ? r.o1 < 0 : r.type === state.chip)));
    const k = state.sort;
    rows.sort((a, b) => { const x = a[k], y = b[k]; if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(y, "ko") : x - y) * state.dir; });
    $("list-count").textContent = `${rows.length}곳`;
    const total = rows.length;
    if (!state.more) rows = rows.slice(0, 15);
    const COLS = internal ? [...BASE_COLS, ["legal", "기업규모"], ["trade", "거래"], ["semi", "반도체 비중"]] : BASE_COLS;
    const tag = (t) => (SB.typeIdx(t) < 0 ? "-" : `<span class="db-tag t${SB.typeIdx(t)}">${t}</span>`);
    $("c-list").innerHTML = `<thead><tr>${COLS.map(([c, l]) => `<th scope="col" aria-sort="${c === k ? (state.dir > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-sort="${c}">${l}</button></th>`).join("")}</tr></thead>`
      + `<tbody>${rows.map((r) => `<tr><th scope="row">${coLink(r)}</th><td data-label="업종">${r.kind}${r.kindEst ? '<small class="db-est" title="DART 업종코드·회사명으로 추정">추정</small>' : ""}</td><td data-label="상장">${r.l ? "상장" : "비상장"}</td><td data-label="지역">${r.area}</td><td data-label="매출">${won(r.s1)}</td><td data-label="성장률" class="${tone(r.g)}">${sg(r.g)}</td><td data-label="영업이익률" class="${r.m < 0 ? "down" : ""}">${pc(r.m)}</td><td data-label="부채비율">${r.debt == null ? "-" : pc(r.debt, 0)}</td><td data-label="유형">${tag(r.type)}</td>${internal ? `<td data-label="기업규모">${r.legal}</td><td data-label="거래">${r.trade}</td><td data-label="반도체 비중">${r.semi == null ? "-" : pc(r.semi, 0)}</td>` : ""}</tr>`).join("") || `<tr><td colspan="${COLS.length}" class="db-empty">검색 결과가 없습니다.</td></tr>`}</tbody>`;
    $("more").hidden = total <= 15;
    $("more").textContent = state.more ? "15곳만 보기" : `전체 ${total}곳 보기`;
  }
  $("chips").innerHTML = CHIPS.map((c) => `<button type="button" role="radio" aria-checked="${c === state.chip}" data-chip="${c}">${c}</button>`).join("");
  $("chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-chip]");
    if (!b) return;
    state.chip = b.dataset.chip;
    $("chips").querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", x === b));
    drawList();
  });
  $("q").addEventListener("input", (e) => { state.q = e.target.value; drawList(); });
  $("more").addEventListener("click", () => { state.more = !state.more; drawList(); });
  $("c-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sort]");
    if (!b) return;
    state.dir = state.sort === b.dataset.sort ? -state.dir : (["n", "kind", "area", "type"].includes(b.dataset.sort) ? 1 : -1);
    state.sort = b.dataset.sort;
    drawList();
  });
  // 업종을 누르면 그 업종으로 거른 포트폴리오로 이동(산업 → 기업 연결)
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-kindgo]");
    if (!a) return;
    e.preventDefault();
    state.kind = a.dataset.kindgo;
    drawFilters();
    render();
    location.hash = "portfolio";
  });

  // ---------- 04 경영 변화·위험 신호 ----------
  let sigRows = [];
  function drawSignals() {
    const hits = sigRows.map((r) => ({ r, h: SB.signalsOf(r) })).filter((x) => x.h.length);
    const count = (k) => hits.filter((x) => x.h.some((s) => s.key === k)).length;
    // 카드 = 거르기 버튼. 해당 0곳인 신호는 숨기고, 심각도 순으로 놓는다
    const card = (k, label, n, sub, sev) => `<button type="button" class="db-sig${sev ? ` sev${sev}` : ""}${state.sig === k ? " on" : ""}" data-sig="${k}" aria-pressed="${state.sig === k}"><span>${label}${sev ? `<small class="db-sev">${SB.SEV[sev]}</small>` : ""}</span><b>${n}<small>곳</small></b><em>${sub}</em><i class="ph ph-caret-right" aria-hidden="true"></i></button>`;
    $("c-sigcards").innerHTML = card("전체", "전체", hits.length, "신호가 하나라도 있는 기업", 0)
      + SIGNALS.slice().sort((a, b) => a.sev - b.sev).filter((s) => count(s.key) || state.sig === s.key).map((s) => card(s.key, s.label, count(s.key), s.rule, s.sev)).join("");
    let list = hits.filter((x) => state.sig === "전체" || x.h.some((s) => s.key === state.sig));
    // 정렬: 기본은 심각도 → 신호 수 → 매출. 머리글을 누르면 그 열로
    const kindMed = {};
    KINDS.forEach((k) => (kindMed[k] = med(sigRows.filter((x) => x.kind === k).map((x) => x.m))));
    const sk = state.sigSort, sd = state.sigDir;
    const val = { n: (x) => x.r.n, kind: (x) => x.r.kind, s1: (x) => x.r.s1, m: (x) => x.r.m, sig: (x) => x.h[0].sev * 100 - x.h.length };
    list.sort((a, b) => { if (sk === "sig") return (val.sig(a) - val.sig(b)) * sd || b.r.s1 - a.r.s1; const x = val[sk](a), y = val[sk](b); if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(y, "ko") : x - y) * sd; });
    const total = list.length;
    if (!state.sigMore) list = list.slice(0, 15);
    const th = (k, l) => `<th scope="col" aria-sort="${k === sk ? (sd > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-ssort="${k}">${l}</button></th>`;
    $("c-signal").innerHTML = `<thead><tr>${th("n", "기업")}${th("kind", "업종")}${th("s1", "매출")}${th("m", "이익률 / 업종 중앙값")}${th("sig", "신호")}<th scope="col">근거</th></tr></thead><tbody>`
      + (list.map(({ r, h }) => `<tr><th scope="row">${coLink(r)}</th><td data-label="업종">${r.kind}</td><td data-label="매출">${won(r.s1)}</td><td data-label="이익률 / 업종">${pc(r.m)} / ${pc(kindMed[r.kind])}</td>`
        + `<td data-label="신호">${h.map((s) => `<span class="db-tag sev${s.sev}">${s.label}</span>`).join(" ")}</td><td class="db-why" data-label="근거">${h.map((s) => esc(s.why(r))).join(" · ")}</td></tr>`).join("")
        || `<tr><td colspan="6" class="db-empty">해당 기업이 없습니다.</td></tr>`) + "</tbody>";
    $("sig-more").hidden = total <= 15;
    $("sig-more").textContent = state.sigMore ? "15곳만 보기" : `전체 ${total}곳 보기`;
  }
  const pickSig = (e) => {
    const b = e.target.closest("[data-sig]");
    if (!b) return;
    state.sig = b.classList.contains("db-sig") && state.sig === b.dataset.sig ? "전체" : b.dataset.sig;
    state.sigMore = false;
    drawSignals();
  };
  $("c-sigcards").addEventListener("click", pickSig);
  $("sig-more").addEventListener("click", () => { state.sigMore = !state.sigMore; drawSignals(); });
  $("c-signal").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ssort]");
    if (!b) return;
    const k = b.dataset.ssort;
    state.sigDir = state.sigSort === k ? -state.sigDir : ["n", "kind", "sig", "m"].includes(k) ? 1 : -1; // 신호는 심각한 것부터, 이익률은 낮은 것부터
    state.sigSort = k;
    drawSignals();
  });
  $("c-rules").innerHTML = `<thead><tr><th>신호</th><th>규칙(확정)</th><th>확인할 사항</th></tr></thead><tbody>${SIGNALS.slice().sort((a, b) => a.sev - b.sev).map((s) => `<tr><th scope="row"><span class="db-tag sev${s.sev}">${s.label}</span> <small class="db-sev">${SB.SEV[s.sev]}</small></th><td>${s.rule}</td><td>${s.check}</td></tr>`).join("")}</tbody>`;

  // ---------- 05 기업 상세 ----------
  // 기업 선택: 검색어로 거르고 매출이 큰 순서로 보여 주는 목록(브라우저 기본 자동완성은 모바일에서 잘 안 보인다)
  const coAll = recs.map((r) => ({ r, key: r.n.replace(/\s/g, "").toLowerCase(), last: r.s.filter((v) => v != null).pop() || 0 }));
  let coHits = [], coIdx = -1;
  function coRender(all) {
    const q = all ? "" : $("co-q").value.replace(/\s/g, "").toLowerCase(); // 처음 누르면 선택된 이름과 상관없이 전체 목록
    coHits = coAll.filter((x) => !q || x.key.includes(q))
      .sort((a, b) => (q ? (b.key.startsWith(q) - a.key.startsWith(q)) : 0) || b.last - a.last).slice(0, 80);
    coIdx = coHits.length ? 0 : -1;
    $("co-list").innerHTML = coHits.length
      ? coHits.map((x, i) => `<li role="option" id="co-opt-${i}" data-i="${i}" aria-selected="${i === coIdx}"><b>${esc(x.r.n)}</b><span>${x.r.kind} · ${x.r.area} · ${won(x.last)}</span></li>`).join("")
      : `<li class="empty">"${esc($("co-q").value)}"와 맞는 기업이 없습니다.</li>`;
    $("co-list").hidden = false;
    $("co-q").setAttribute("aria-expanded", "true");
  }
  function coClose() { $("co-list").hidden = true; $("co-q").setAttribute("aria-expanded", "false"); }
  function coPick(i) {
    const x = coHits[i];
    if (!x) return;
    state.co = x.r.c; coClose(); drawCompany(); syncUrl();
    if (matchMedia("(pointer: coarse)").matches) $("co-q").blur();
  }
  function coMove(d) {
    if (!coHits.length) return;
    coIdx = (coIdx + d + coHits.length) % coHits.length;
    $("co-list").querySelectorAll("li[data-i]").forEach((li) => li.setAttribute("aria-selected", Number(li.dataset.i) === coIdx));
    const el = $("co-opt-" + coIdx); if (el) el.scrollIntoView({ block: "nearest" });
    $("co-q").setAttribute("aria-activedescendant", "co-opt-" + coIdx);
  }
  $("co-q").addEventListener("focus", () => { $("co-q").select(); coRender(true); });
  $("co-q").addEventListener("input", () => coRender());
  $("co-q").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if ($("co-list").hidden) coRender(true); else coMove(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); coMove(-1); }
    else if (e.key === "Enter") { e.preventDefault(); coPick(coIdx); }
    else if (e.key === "Escape") coClose();
  });
  $("co-list").addEventListener("mousedown", (e) => e.preventDefault()); // 누르는 동안 입력칸이 포커스를 잃지 않게
  $("co-list").addEventListener("click", (e) => { const li = e.target.closest("li[data-i]"); if (li) coPick(Number(li.dataset.i)); });
  $("co-q").addEventListener("blur", () => setTimeout(coClose, 150));
  function drawCompany() {
    const P = SB.panel(recs, state.fy);
    if (!state.co) state.co = (P.filter(F.inFilter).sort((a, b) => b.s1 - a.s1)[0] || P[0] || recs[0] || {}).c; // 처음엔 지금 조건의 매출 1위 기업
    const base = recs.find((r) => r.c === state.co);
    if (!base) { $("c-company").innerHTML = `<p class="db-empty">기업을 선택하세요.</p>`; return; }
    $("co-q").value = base.n;
    const r = P.find((x) => x.c === base.c), peers = P.filter((x) => x.kind === base.kind);
    const rank = (key, v) => { if (v == null) return "-"; const vals = peers.map((x) => x[key]).filter((x) => x != null); const p = Math.round((vals.filter((x) => x > v).length / vals.length) * 100); return p <= 50 ? `상위 ${Math.max(1, p)}%` : `하위 ${Math.max(1, 100 - p)}%`; };
    const salesRank = r ? peers.slice().sort((a, b) => b.s1 - a.s1).findIndex((x) => x.c === r.c) + 1 : null;
    const sigs = r ? SB.signalsOf(r) : [];
    const missing = [];
    base.y.forEach((y, i) => { if (base.o[i] == null) missing.push(`${y}년 영업이익`); });
    if (!base.q) missing.push(base.l ? "분기 실적(수집되지 않음)" : "분기 실적(비상장사는 공시하지 않음)");
    if (!base.tl || !base.tl.some((v) => v != null)) missing.push("총자산·부채(다음 자동 갱신 후 표시)");
    if (!r) missing.push(`${state.fy}년 또는 전년 매출(성장률 비교 불가)`);
    const card = (k, v, s) => `<div><span>${k}</span><b>${v}</b><small>${s || ""}</small></div>`;
    $("c-company").innerHTML = `
      <section class="db-card db-co-head">
        <div><h2>${esc(base.n)}</h2><p>${base.kind}${base.kindEst ? "(추정)" : ""} · ${base.l ? "상장" : "비상장"} · ${base.area} · 결산 ${base.mt ? Number(base.mt) + "월" : "-"} · 출처 ${base.src || "-"}${SB.isBig(base) ? ' · <span class="db-tag">대형사</span>' : ""}${internal ? ` · 기업규모 ${base.legal} · 거래 ${base.trade}${base.semi != null ? ` · 반도체 비중 ${pc(base.semi, 0)}` : ""}` : ""}</p></div>
        <div class="db-co-act">${base.hasProfile ? `<a class="db-btn ghost" href="profile.html#${base.c}">기업 프로필</a>` : ""}<a class="db-btn ghost" href="#portfolio">목록으로</a></div>
      </section>
      <div class="db-co-kpis">${card(`${state.fy}년 매출`, r ? won(r.s1) : "-", r ? `${base.kind} ${peers.length}곳 중 ${salesRank}위` : "")}${card("매출 성장률", r ? sg(r.g) : "-", r ? `업종 ${rank("g", r.g)} · 중앙값 ${sg(med(peers.map((x) => x.g)))}` : "")}${card("영업이익률", r ? pc(r.m) : "-", r && r.m != null ? `업종 ${rank("m", r.m)} · 중앙값 ${pc(med(peers.map((x) => x.m)))}` : "")}${card("부채비율", r && r.debt != null ? pc(r.debt, 0) : "-", r && r.debt != null ? `업종 중앙값 ${pc(med(peers.map((x) => x.debt)), 0)}` : "자료 없음")}${card("1인당 매출", r && r.prod != null ? `${r.prod.toFixed(1)}억` : "-", r && r.prod != null ? `업종 ${rank("prod", r.prod)} · 중앙값 ${(med(peers.map((x) => x.prod)) ?? 0).toFixed(1)}억` : "임직원 공시 없음")}${card("기업 유형", r ? r.type : "-", `성장 ${SB.HI_GROWTH}%·이익률 ${SB.HI_MARGIN}% 기준`)}</div>
      <div class="db-grid r1">
        <section class="db-card"><div class="db-card-head"><h2>연도별 실적</h2></div><div class="db-chart">${comboChart(base.y.map((y) => `${y}년`), base.s, base.o, { values: true, bw: 30, legend: true, label: "연도별 매출·영업이익·영업이익률" })}${yearTable(base.y.map((y) => `${y}년`), base.s, base.o, base.e, base.e ? "" : base.src === "감사보고서" ? "임직원 수: 감사보고서만 내는 회사라 공시하지 않습니다." : "임직원 수: 다음 자동 갱신 후 표시됩니다.")}</div></section>
        <section class="db-card"><div class="db-card-head"><h2>분기별 실적 <small>임직원은 반기말·연말만 공시</small></h2></div>${base.q ? (() => `<div class="db-chart">${comboChart(qShort(base.q.labels), base.q.sales, base.q.op, { bw: 12, legend: true, label: "분기 매출·영업이익·영업이익률" })}${quarterTable(base.q.labels, base.q.sales, base.q.op, base.qe || null, base.qe ? "임직원은 반기보고서(6월 말)·사업보고서(12월 말)에만 공시돼 반기 단위로 표시합니다." : "임직원은 반기말(2Q)·연말(4Q)만 공시합니다. 다음 자동 갱신 후 표시됩니다.")}</div>`)() : `<p class="db-empty">${base.l ? "분기 실적이 없습니다." : "비상장사는 분기 실적을 공시하지 않아 연간만 표시합니다."}</p>`}</section>
      </div>
      <div class="db-grid r1">
        <section class="db-card"><div class="db-card-head"><h2>경영 변화 신호</h2></div>${sigs.length ? `<ul class="db-plain">${sigs.map((s) => `<li><span class="db-tag sev${s.sev}">${s.label}</span> ${esc(s.why(r))}<small> · 확인: ${s.check}</small></li>`).join("")}</ul>` : `<p class="db-empty">해당하는 신호가 없습니다.</p>`}</section>
        <section class="db-card"><div class="db-card-head"><h2>데이터 기준·결측</h2></div><ul class="db-plain"><li>개별(별도) 재무제표, ${base.src || "-"} 기준</li><li>비교 집단: ${base.kind} ${peers.length}곳(대형사 포함, 상단 필터와 무관)</li>${missing.length ? missing.map((m) => `<li class="down">결측: ${m}</li>`).join("") : "<li>결측 항목 없음</li>"}</ul></section>
      </div>`;
  }

  // ---------- 06 경영진 보고서 ----------
  function drawReport(S) {
    const qs = SB.toQuery(state);
    $("rep-open").href = `report.html${qs ? `?${qs}` : ""}`;
    $("c-repmeta").innerHTML = `<div><dt>조건</dt><dd>${SB.describe(state)}</dd></div><div><dt>분석 대상</dt><dd>${S.n}곳</dd></div><div><dt>기준 데이터</dt><dd>DART 수집 ${SB.meta.updated || "-"}</dd></div>${internal ? "<div><dt>내부 정보</dt><dd>보고서 링크에는 넣지 않습니다</dd></div>" : ""}`;
  }
  $("c-formulas").innerHTML = SB.FORMULAS.map((f) => `<li>${f}</li>`).join("");
  // 보고서 화면을 열었을 때만 미리보기를 불러온다(조건이 바뀌면 다시)
  function loadPreview() {
    const href = $("rep-open").getAttribute("href"), fr = $("rep-frame"), src = `${href}${href.includes("?") ? "&" : "?"}embed=1`;
    if (fr && fr.getAttribute("src") !== src) fr.setAttribute("src", src);
  }
  function fitPreview() {
    const fr = $("rep-frame");
    try { const h = fr.contentDocument.documentElement.scrollHeight; if (h) fr.style.height = `${h}px`; } catch (e) { /* 다른 출처면 CSS 높이 유지 */ }
  }
  $("rep-frame").addEventListener("load", () => { fitPreview(); setTimeout(fitPreview, 300); });
  window.addEventListener("resize", () => setTimeout(fitPreview, 200));

  // ---------- 그리기 ----------
  function render() {
    W = chartW();
    F = SB.makeFilter(state, internal);
    const list = recs.filter(F.inFilter), rows = SB.panel(list, state.fy), S = SB.stats(rows), FS = SB.fullSample(list, state.fy);
    $("sub").textContent = `${SB.describe(state)} · 개별 기준 · 분석 ${S.n}곳${rows.some((r) => !r.l) && rows.some((r) => r.l) ? ` (상장 ${rows.filter((r) => r.l).length} · 비상장 ${rows.filter((r) => !r.l).length})` : ""}`;
    const ids = ["c-yearly", "c-trend", "c-kindsc", "c-cosc2", "c-changes", "c-insight", "c-mix", "c-region", "c-summary", "c-conc", "c-cosc", "c-box", "c-top", "c-fast", "c-funnel"];
    document.body.classList.toggle("db-nodata", !rows.length);
    $("empty-panel").hidden = !!rows.length;
    if (!rows.length) {
      ids.forEach((id) => ($(id).innerHTML = ""));
      $("kpis").innerHTML = $("headline").innerHTML = "";
      ["yearly-sub", "trend-sub"].forEach((id) => ($(id).textContent = ""));
      const NAMES = { fy: "기준 연도", kind: "업종", area: "지역", listed: "상장 여부", size: "매출 규모", smin: "매출 최소", smax: "매출 최대", big: "대형사", legal: "기업규모", trade: "거래 관계" };
      const on = SB.FILTER_KEYS.filter((k) => k !== "fy" && String(state[k]) !== String(SB.DEFAULTS[k]));
      $("empty-panel").innerHTML = `<i class="ph ph-funnel-x" aria-hidden="true"></i><div><b>조건에 맞는 기업이 없습니다.</b><p>아래 조건 중 하나를 풀어 보세요.</p><div class="db-empty-chips">${on.map((k) => `<button type="button" data-unset="${k}">${NAMES[k]}: ${esc($(Object.keys(IDS).find((id) => IDS[id] === k)).selectedOptions[0]?.textContent || state[k])} <span aria-hidden="true">×</span></button>`).join("")}<button type="button" data-unset="all">필터 모두 초기화</button></div></div>`;
    } else {
      kpis(rows, S, FS);
      headline(rows, S);
      $("c-yearly").innerHTML = yearlyChart(rows);
      $("c-trend").innerHTML = trendChart(list);
      $("c-kindsc").innerHTML = kindScatter(rows);
      $("c-changes").innerHTML = changes(rows, S);
      $("c-insight").innerHTML = insights(rows, S, FS);
      $("c-mix").innerHTML = mixCard(rows, S);
      $("c-region").innerHTML = regionCard(rows, S);
      $("c-summary").innerHTML = summary(rows, S);
      $("c-conc").innerHTML = concCard(rows);
      $("c-cosc").innerHTML = coScatter(rows);
      $("c-cosc2").innerHTML = coScatter(rows, "cosc2-legend", true);
      $("c-box").innerHTML = boxCard(rows);
      $("c-top").innerHTML = top10(rows);
      $("c-fast").innerHTML = fastCard(rows);
      $("c-funnel").innerHTML = funnel(rows);
    }
    $("c-big").innerHTML = bigCard();
    sigRows = rows; drawSignals();
    listRows = rows; drawList();
    drawReport(S);
    if (!$("v-company").hidden) drawCompany();
    if (!$("v-report").hidden) loadPreview();
    syncUrl();
    updateFilterCount();
  }

  // 좁은 화면: 필터를 접어 두고, 적용된 조건 수만 보여 준다
  function updateFilterCount() {
    const n = SB.FILTER_KEYS.filter((k) => k !== "smin" && k !== "smax" && String(state[k]) !== String(SB.DEFAULTS[k])).length; // 직접 입력 범위는 '매출 규모' 하나로 센다
    $("filter-toggle").innerHTML = `<i class="ph ph-sliders-horizontal" aria-hidden="true"></i>필터${n ? ` <b>${n}</b>` : ""}`;
  }
  $("filter-toggle").addEventListener("click", () => {
    const open = $("filters").classList.toggle("open");
    $("filter-toggle").setAttribute("aria-expanded", open);
  });
  let lastW = chartW();
  window.addEventListener("resize", () => { if (chartW() !== lastW) { lastW = chartW(); render(); } });

  $("empty-panel").addEventListener("click", (e) => {
    const b = e.target.closest("[data-unset]");
    if (!b) return;
    if (b.dataset.unset === "all") { $("filters").requestSubmit ? $("clear").click() : $("filters").reset(); return; }
    state[b.dataset.unset] = SB.DEFAULTS[b.dataset.unset];
    drawFilters(); render();
  });
  // 차트 점(기업)도 키보드로: Tab으로 차트에 들어와 화살표로 옮기고 Enter로 연다
  document.addEventListener("keydown", (e) => {
    const el = e.target.closest && e.target.closest("circle[data-co]");
    if (!el) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.dispatchEvent(new MouseEvent("click", { bubbles: true })); return; }
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -1e9, End: 1e9 }[e.key];
    if (!d) return;
    e.preventDefault();
    const pts = [...el.ownerSVGElement.querySelectorAll("circle[data-co]")], to = pts[Math.max(0, Math.min(pts.length - 1, pts.indexOf(el) + d))];
    el.setAttribute("tabindex", "-1"); to.setAttribute("tabindex", "0"); to.focus();
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-big]");
    if (!b) return;
    state.big = b.dataset.big;
    drawFilters(); render();
  });
  // 툴팁
  const tip = $("tip");
  document.addEventListener("focusin", (e) => {
    const el = e.target.closest && e.target.closest("[data-tip]");
    if (!el || !el.dataset.tip) { tip.hidden = true; return; }
    const b = el.getBoundingClientRect();
    tip.textContent = el.dataset.tip; tip.hidden = false;
    tip.style.left = `${Math.min(b.left, innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${b.bottom + 8}px`;
  });
  document.addEventListener("focusout", () => (tip.hidden = true));
  document.addEventListener("mousemove", (e) => {
    const el = e.target.closest && e.target.closest("[data-tip]");
    if (!el || !el.dataset.tip) { tip.hidden = true; return; }
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    tip.style.left = `${Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${e.clientY + 14}px`;
  });

  // 실적 모판(CSV): 현재 필터의 기업을 업체코드·기간 단위로 세로 적재
  $("csv").addEventListener("click", () => {
    const out = [["업체코드", "업체명", "상장", "업종", "업종추정", "지역", "대형사", "기간", "매출액(억원)", "영업이익(억원)", "당기순이익(억원)", "총자산(억원)", "부채총계(억원)", "자본총계(억원)"]];
    recs.filter(F.inFilter).forEach((r) => {
      const b = [r.c, r.n, r.l ? "상장" : "비상장", r.kind, r.kindEst ? "추정" : "", r.area, SB.isBig(r) ? "Y" : ""];
      r.y.forEach((y, i) => out.push([...b, `FY${y}`, r.s[i], r.o[i], r.ni[i], r.ta ? r.ta[i] : "", r.tl ? r.tl[i] : "", r.te ? r.te[i] : ""]));
      if (r.q) r.q.labels.forEach((l, i) => out.push([...b, l, r.q.sales[i], r.q.op[i], r.q.net[i], "", "", ""]));
    });
    const csv = "﻿" + out.map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: "소부장_실적_모판.csv" }).click();
  });

  // 좁은 화면: 사이트 메뉴는 접어 두고 '메뉴' 버튼으로 연다(대시보드 메뉴는 아래 탭)
  $("site-menu").addEventListener("click", () => {
    const open = document.querySelector(".krds-header").classList.toggle("open");
    $("site-menu").setAttribute("aria-expanded", open);
  });
  $("updated").textContent = SB.meta.updated || "-";
  const offFy = recs.filter((r) => r.mt && r.mt !== "12").length;
  $("foot").textContent = "자료: 금융감독원 전자공시(DART) 사업보고서·감사보고서·분기보고서, 개별(별도) 기준. 분기 추이는 상장사만 포함합니다. "
    + "업종은 직접 분류 외에는 회사명·DART 업종코드로 추정했고, 매출 규모는 법적 기업규모 입력 전까지 쓰는 매출액 구간입니다. "
    + `12월 결산이 아닌 ${offFy}곳은 해당 사업연도로 맞췄습니다. 수요기업(삼성전자·SK하이닉스 등)과 IT·서비스 업종 7곳은 제외했습니다.`;
  if (!recs.length) { $("kpis").innerHTML = `<p class="db-empty">실적 데이터가 아직 없습니다. 다음 자동 갱신 후에 표시됩니다.</p>`; return; }
  drawFilters();
  render();
  ready = true;
  showView(location.hash.slice(1));
})();
