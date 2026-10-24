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
  const state = { ...SB.fromQuery(location.search), sig: "전체", sigMore: false, q: "", chip: "전체", sort: "g", dir: -1, more: false, co: null };
  let internal = null, ready = false;
  let F = SB.makeFilter(state, internal);
  const fill = (id, opts, val) => ($(id).innerHTML = opts.map(([v, l]) => `<option value="${v}"${String(v) === String(val) ? " selected" : ""}>${l}</option>`).join(""));
  function drawFilters() {
    fill("f-fy", [SB.DEFAULT_FY, SB.DEFAULT_FY - 1].map((y) => [y, `${y}년`]), state.fy);
    fill("f-kind", [["all", "전체"], ...KINDS.map((k) => [k, k])], state.kind);
    fill("f-area", [["all", "전체"], ...AREAS.map((a) => [a, a])], state.area);
    fill("f-listed", [["all", "전체"], ["1", "상장"], ["0", "비상장"]], state.listed);
    fill("f-size", [["all", "전체"], ...window.SIZE_TIERS.map((s) => [s, s])], state.size);
    fill("f-big", [["exclude", "제외(기본)"], ["include", "포함"], ["only", "대형사만"]], state.big);
    fill("f-legal", [["all", "전체"], ...["대기업", "중견", "중소", "미입력"].map((s) => [s, s])], state.legal);
    fill("f-trade", [["all", "전체"], ...["당사 거래", "비거래", "미입력"].map((s) => [s, s])], state.trade);
  }
  const IDS = { "f-fy": "fy", "f-kind": "kind", "f-area": "area", "f-listed": "listed", "f-size": "size", "f-big": "big", "f-legal": "legal", "f-trade": "trade" };
  $("filters").addEventListener("change", (e) => {
    const key = IDS[e.target.id];
    if (!key) return;
    state[key] = key === "fy" ? Number(e.target.value) : e.target.value;
    state.more = state.sigMore = false;
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
    document.querySelectorAll("#views-nav a").forEach((a) => a.setAttribute("aria-current", a.dataset.view === v));
    if (v === "company") drawCompany();
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
  const W = 520;
  function sparkBars(vals) {
    const v = vals.filter((x) => x != null), max = Math.max(...v.map(Math.abs), 1), w = 100 / v.length;
    return `<svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">${v.map((x, i) => `<rect class="spark-bar${i === v.length - 1 ? " on" : ""}" x="${i * w + w * 0.18}" y="${28 - (Math.abs(x) / max) * 26}" width="${w * 0.64}" height="${(Math.abs(x) / max) * 26}" rx="1.5"/>`).join("")}</svg>`;
  }
  const kpi = (o) => `<article class="db-kpi${o.hero ? " hero" : ""}"><p class="lab"><i class="ph ${o.icon}" aria-hidden="true"></i>${o.label}</p><strong>${o.value}</strong><p class="delta">${o.delta}</p>${o.spark ? sparkBars(o.spark) : ""}</article>`;
  const delta = (v, txt, unit = "pct") => `<b class="${tone(v)}">${arrow(v)} ${unit === "pp" ? pp(v) : sg(v)}</b><span class="vs">${txt}</span>`;
  const note = (html, warn) => `<p class="db-note${warn ? " warn" : ""}"><i class="ph ${warn ? "ph-warning" : "ph-info"}" aria-hidden="true"></i><span>${html}</span></p>`;
  function hbarList(items, opt = {}) {
    const max = Math.max(...items.map((i) => i.v), 1);
    const mark = opt.mark != null ? `<span class="mark" style="left:${(opt.mark / max) * 100}%"></span>` : "";
    return `<ul class="db-hbars${opt.wide ? " wide" : ""}">${items.map((i) => `<li class="${i.cls || ""}" data-tip="${esc(i.tip || "")}"><span class="nm">${i.link || esc(i.label)}</span><span class="track"><span class="fill" style="width:${(Math.max(0, i.v) / max) * 100}%"></span>${mark}</span><b>${i.right}</b><em class="${tone(i.g)}">${i.gText ?? sg(i.g)}</em></li>`).join("")}</ul>`;
  }
  // 산점도: 가로 성장률, 세로 이익률. 점선은 확정 기준(성장 10%, 이익률 5%)
  function scatter(points, opt = {}) {
    const H = opt.h || 300, L = 44, R = 14, T = 14, B = 34, pw = W - L - R, ph = H - T - B;
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
    g += `<line x1="${cx(SB.HI_GROWTH)}" x2="${cx(SB.HI_GROWTH)}" y1="${T}" y2="${T + ph}" stroke="var(--text-3)" stroke-dasharray="4 3"/><line x1="${L}" x2="${W - R}" y1="${cy(SB.HI_MARGIN)}" y2="${cy(SB.HI_MARGIN)}" stroke="var(--text-3)" stroke-dasharray="4 3"/>`;
    g += `<text class="ax" x="${W - R}" y="${T + 10}" text-anchor="end">우량 성장형 ↗</text><text class="ax" x="${L + 4}" y="${T + ph - 4}">↙ 경영 취약형</text><text class="ax" x="${(L + W - R) / 2}" y="${H - 3}" text-anchor="middle">매출 성장률 →  (세로: 영업이익률)</text>`;
    const rmax = Math.max(...points.map((p) => p.size || 1)), placed = [];
    points.forEach((p) => {
      const r = opt.sized ? 6 + 16 * Math.sqrt((p.size || 0) / rmax) : 4.5;
      g += `<circle cx="${cx(p.x)}" cy="${cy(p.y)}" r="${r}" fill="${p.color}" fill-opacity="${opt.sized ? 0.3 : 0.7}" stroke="${p.color}" stroke-width="1.2"${p.co ? ` data-co="${p.co}" class="pt"` : ""} data-tip="${esc(p.tip)}"/>`;
      if (p.label) {
        // 이미 놓인 라벨과 겹치면 점 아래로 옮긴다
        let ly = cy(p.y) - r - 3;
        if (placed.some(([x, y]) => Math.abs(x - cx(p.x)) < 60 && Math.abs(y - ly) < 13)) ly = cy(p.y) + r + 12;
        placed.push([cx(p.x), ly]);
        g += `<text class="val" x="${cx(p.x)}" y="${ly}" text-anchor="middle">${esc(p.label)}</text>`;
      }
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label || "성장률과 이익률 분포")}">${g}</svg>`;
  }
  const KIND_COLOR = { 소재: "var(--blue)", 부품: "var(--teal)", 장비: "var(--orange)", [NA]: "var(--gray)" };
  const TYPE_COLOR = { [TYPES[0]]: "var(--green)", [TYPES[1]]: "var(--blue)", [TYPES[2]]: "var(--orange)", [TYPES[3]]: "var(--down)" };

  // ---------- 01 Executive Overview ----------
  function kpis(rows, S, FS) {
    $("kpis").innerHTML = [
      { hero: 1, icon: "ph-currency-krw", label: `${state.fy}년 합산 매출 · ${S.n}곳`, value: `${won(S.s1)}<small>원</small>`, delta: `${delta(S.g, "동일 기업 기준")}<span class="vs db-sub2">전체 표본 ${sg(FS.g)} (${FS.n0}→${FS.n1}곳)</span>`, spark: S.spark.s },
      { icon: "ph-coins", label: "영업이익", value: won(S.o1), delta: S.og == null ? `<span class="vs">전년 적자</span>` : delta(S.og, "전년 대비"), spark: S.spark.o },
      { icon: "ph-percent", label: "영업이익률(합산)", value: pc(S.m), delta: delta(S.m - S.m0, `전년 ${pc(S.m0)} · 중앙값 ${pc(S.medM)}`, "pp") },
      { icon: "ph-check-circle", label: "흑자 업체 비중", value: pc(S.profit, 0), delta: delta(S.profit - S.profit0, `전년 대비 · 적자 ${S.loss}곳`, "pp") },
      { icon: "ph-arrow-fat-lines-up", label: "매출 증가 업체", value: pc(S.up, 0), delta: `<span class="vs">중앙값 성장률 ${sg(S.medG)}</span>` },
      { icon: "ph-scales", label: "상위 10개사 집중도", value: pc(SB.concentration(rows, 10), 0), delta: `<span class="vs">상위 50개사 ${pc(SB.concentration(rows, 50), 0)}</span>` },
    ].map(kpi).join("");
  }
  function trendChart(list) {
    const Q = SB.quarters(list);
    $("trend-sub").textContent = Q.P.length ? `상장 ${Q.P.length}곳 · 최근 8개 분기` : "";
    if (!Q.P.length) return `<p class="db-empty">이 조건에는 분기 실적이 있는 상장사가 없습니다. 비상장사는 분기 실적을 공시하지 않습니다.</p>`;
    const { labels, s } = Q, H = 230, L = 46, R = 70, T = 18, B = 28, pw = W - L - R, ph = H - T - B, max = Math.max(...s) * 1.1;
    const x = (i) => L + (pw * i) / (labels.length - 1), y = (v) => T + ph - (v / max) * ph;
    let g = "";
    for (let i = 0; i <= 4; i++) { const v = (max * i) / 4; g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${won(v)}</text>`; }
    labels.forEach((l, i) => (g += `<text class="ax" x="${x(i)}" y="${H - 8}" text-anchor="middle">${l}</text>`));
    g += `<path d="M${x(0)},${y(0)} ${s.map((v, i) => `L${x(i)},${y(v)}`).join(" ")} L${x(s.length - 1)},${y(0)}Z" fill="var(--blue)" opacity=".1"/>`;
    g += `<polyline points="${s.slice(0, 4).map((v, i) => `${x(i + 4)},${y(v)}`).join(" ")}" fill="none" stroke="var(--text-3)" stroke-width="1.6" stroke-dasharray="4 4"/>`;
    g += `<polyline points="${s.map((v, i) => `${x(i)},${y(v)}`).join(" ")}" fill="none" stroke="var(--blue)" stroke-width="2.5" stroke-linejoin="round"/>`;
    s.forEach((v, i) => (g += `<circle cx="${x(i)}" cy="${y(v)}" r="${i === 7 ? 5 : 3}" fill="${i === 7 ? "var(--blue)" : "var(--card)"}" stroke="var(--blue)" stroke-width="2"/><rect class="hit" x="${x(i) - 18}" y="${T}" width="36" height="${ph}" data-tip="${labels[i]} 매출 ${won(v)}${i >= 4 ? ` · 전년 동기 ${won(s[i - 4])} (${sg(growth(v, s[i - 4]))})` : ""}"/>`));
    const yoy = growth(s[7], s[3]), ltm = growth(sum(s.slice(4)), sum(s.slice(0, 4))), cx = x(7) + 10, cy = Math.max(T + 2, y(s[7]) - 34);
    g += `<rect class="callout" x="${cx - 4}" y="${cy}" width="${R - 2}" height="34" rx="6"/><text class="callout-t" x="${cx + 2}" y="${cy + 14}">전년 동기</text><text class="callout-t" x="${cx + 2}" y="${cy + 28}">${sg(yoy)}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="분기 매출 추이">${g}</svg>` + note(`최근 4분기 매출 ${won(sum(s.slice(4)))}원, 직전 4분기 대비 <b class="${tone(ltm)}">${sg(ltm)}</b>.`);
  }
  function kindScatter(rows) {
    const pts = [];
    KINDS.forEach((k) => [["상장", 1], ["비상장", 0]].forEach(([ln, l]) => {
      const rs = rows.filter((r) => r.kind === k && r.l === l);
      if (rs.length < 3) return;
      const st = SB.stats(rs);
      pts.push({ x: st.g, y: st.m, size: st.s1, color: KIND_COLOR[k], label: `${k}·${ln}`, tip: `${k} ${ln} ${st.n}곳 · 매출 ${won(st.s1)} · 성장 ${sg(st.g)} · 이익률 ${pc(st.m)}` });
    }));
    if (!pts.length) return `<p class="db-empty">자료가 없습니다.</p>`;
    return scatter(pts, { sized: 1, fit: 1, h: 270, label: "업종·상장 여부별 성장률과 이익률" }) + note(`점선은 기업 유형 기준(성장 ${SB.HI_GROWTH}%, 이익률 ${SB.HI_MARGIN}%)입니다. 3곳 미만 집단은 뺐습니다.`);
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
    out.push([Math.abs(FS.g - S.g) >= 2 ? "bad" : "", "ph-trend-up", `매출 성장률: 동일 기업 ${sg(S.g)} · 전체 표본 ${sg(FS.g)}`,
      Math.abs(FS.g - S.g) >= 2 ? `차이 ${Math.abs(FS.g - S.g).toFixed(1)}%p는 수집 표본 변화(${FS.n0}→${FS.n1}곳) 영향입니다. 기존 기업의 실제 변화는 동일 기업 기준을 보세요.` : "두 기준의 차이가 작아 표본 변화 영향은 크지 않습니다."]);
    const sorted = rows.slice().sort((a, b) => b.s1 - a.s1), t10 = share(sum(sorted.slice(0, 10).map((r) => r.s1)), S.s1), rest = SB.stats(sorted.slice(10));
    out.push([t10 >= 40 ? "bad" : "", "ph-scales", `상위 10개사 매출 비중 ${pc(t10, 0)} · 업체 중앙값 성장률 ${sg(S.medG)}`,
      (t10 >= 40 ? `상위 10개사를 빼면 성장률 ${sg(rest.g)}, 이익률 ${pc(rest.m)}입니다. ` : "") + (S.g - S.medG > 5 ? "합계 성장은 큰 기업들이 이끌었습니다." : S.medG - S.g > 5 ? "일반 업체가 상위 기업보다 더 크게 성장했습니다." : "업체 중앙값과 합계 성장률이 비슷합니다.")]);
    const tiers = window.SIZE_TIERS.map((t) => [t, SB.stats(rows.filter((r) => window.sizeTier(r.s1) === t))]).filter(([, s]) => s.n >= 5);
    if (tiers.length >= 2) {
      const a = tiers[0], b = tiers[tiers.length - 1];
      out.push([Math.abs(a[1].m - b[1].m) >= 3 ? "bad" : "", "ph-stack", `규모별 이익률: ${a[0]} ${pc(a[1].m)} · ${b[0]} ${pc(b[1].m)}`, `${b[0]} ${b[1].n}곳은 성장률 ${sg(b[1].g)}, 적자 비중 ${pc(b[1].lossP, 0)}입니다.`]);
    }
    const best = rows.filter((r) => r.type === TYPES[0]);
    out.push(["good", "ph-rocket-launch", `우량 성장형 ${best.length}곳(${pc(share(best.length, S.n), 0)})`, best.length ? `대표: ${best.slice().sort((x, y) => y.s1 - x.s1).slice(0, 3).map((r) => r.n).join(", ")}` : "기준을 넘는 업체가 없습니다."]);
    return out.map(([c, ic, what, so]) => `<li><span class="ic ${c}"><i class="ph ${ic}" aria-hidden="true"></i></span><span><b>${what}</b><small>${so}</small></span></li>`).join("");
  }

  // ---------- 02 산업·업종 분석 ----------
  function mixCard(rows, S) {
    const items = KINDS.map((k) => { const rs = rows.filter((r) => r.kind === k), st = SB.stats(rs); return { label: k, v: st.s1, right: pc(share(st.s1, S.s1), 0), g: st.g, n: rs.length, tip: `${k} ${rs.length}곳 · 매출 ${won(st.s1)} · 영업이익률 ${pc(st.m)}`, link: `<a href="#portfolio" data-kindgo="${k}">${k}</a>` }; }).filter((i) => i.n);
    if (!items.length) return `<p class="db-empty">자료가 없습니다.</p>`;
    const best = items.filter((i) => i.label !== NA).sort((a, b) => b.g - a.g)[0];
    if (best) best.cls = "hi";
    const unk = items.find((i) => i.label === NA), est = rows.filter((r) => r.kindEst).length;
    return hbarList(items) + note(`${best ? `성장은 <b>${best.label}</b>(${sg(best.g)})이 가장 빠릅니다. ` : ""}가운데는 매출 비중, 오른쪽은 성장률입니다. 업종 추정 ${est}곳${unk ? `, 미분류 ${unk.n}곳` : ""} 포함.`);
  }
  function regionCard(rows, S) {
    const items = AREAS.map((a) => { const rs = rows.filter((r) => r.area === a), st = SB.stats(rs); return { label: a, v: st.s1, right: won(st.s1), g: st.g, n: rs.length, tip: `${a} ${rs.length}곳 · 매출 ${won(st.s1)} · 영업이익률 ${pc(st.m)}` }; }).filter((i) => i.n);
    if (!items.length) return `<p class="db-empty">자료가 없습니다.</p>`;
    const top = items.slice().sort((a, b) => b.v - a.v)[0], worst = items.filter((i) => i.n >= 3).sort((a, b) => a.g - b.g)[0];
    top.cls = "hi";
    if (worst && worst.g < S.g - 5) worst.cls = "warn";
    return hbarList(items) + (worst && worst.cls === "warn" ? note(`<b>${worst.label}</b> 권역 매출 ${sg(worst.g)}로 전체(${sg(S.g)})보다 크게 낮습니다.`, 1) : note(`<b>${top.label}</b> 권역이 매출의 ${pc(share(top.v, S.s1), 0)}를 차지합니다.`));
  }
  function summary(rows, S) {
    const tr = (label, st, foot) => `<tr>${foot ? `<td>${label}</td>` : `<th scope="row">${label}</th>`}<td>${st.n}</td><td>${won(st.s1)}</td><td>${pc(share(st.s1, S.s1), 0)}</td><td class="${tone(st.g)}">${sg(st.g)}</td><td>${pc(st.m)}</td><td>${pc(st.medM)}</td><td>${pc(st.lossP, 0)}</td></tr>`;
    const grp = (label, rs) => (rs.length ? tr(label, SB.stats(rs)) : "");
    const body = `<tr class="grp"><td colspan="8">업종</td></tr>` + KINDS.map((k) => grp(k, rows.filter((r) => r.kind === k))).join("")
      + `<tr class="grp"><td colspan="8">상장 여부</td></tr>` + grp("상장", rows.filter((r) => r.l)) + grp("비상장", rows.filter((r) => !r.l))
      + `<tr class="grp"><td colspan="8">매출 규모</td></tr>` + window.SIZE_TIERS.map((t) => grp(t, rows.filter((r) => window.sizeTier(r.s1) === t))).join("");
    return `<thead><tr><th>구분</th><th>업체</th><th>매출</th><th>비중</th><th>성장률</th><th>이익률(합산)</th><th>이익률 중앙값</th><th>적자 비중</th></tr></thead><tbody>${body}</tbody><tfoot>${tr("합계", S, true)}</tfoot>`;
  }
  function concCard(rows) {
    const c10 = SB.concentration(rows, 10), c50 = SB.concentration(rows, 50), c100 = SB.concentration(rows, 100);
    const seg = [["상위 10", c10], ["11~50위", c50 - c10], ["51~100위", c100 - c50], ["기타", 100 - c100]];
    const colors = ["var(--blue)", "var(--teal)", "var(--gray)", "var(--line)"];
    return `<div class="db-stack">${seg.map(([l, v], i) => `<span style="flex:${Math.max(v, 0.01)};background:${colors[i]}" data-tip="${l} ${pc(v, 0)}">${v >= 8 ? pc(v, 0) : ""}</span>`).join("")}</div>`
      + `<ul class="db-legend stack">${seg.map(([l, v], i) => `<li><i style="background:${colors[i]}"></i>${l} <b>${pc(v, 0)}</b></li>`).join("")}</ul>`
      + note(`분석 대상 ${rows.length}곳 중 상위 10개사가 매출의 ${pc(c10, 0)}, 상위 100개사가 ${pc(c100, 0)}를 차지합니다. ${c10 >= 40 ? "소수 기업 의존도가 높습니다." : "특정 기업 쏠림은 크지 않습니다."}`, c10 >= 40);
  }
  function bigCard() {
    const big = SB.panel(recs.filter((r) => F.inBase(r) && SB.isBig(r)), state.fy), rest = SB.panel(recs.filter((r) => F.inBase(r) && !SB.isBig(r)), state.fy);
    if (!big.length) return `<p class="db-empty">조건에 맞는 대형사가 없습니다.</p>`;
    const B = SB.stats(big), O = SB.stats(rest), list = big.slice().sort((a, b) => b.s1 - a.s1);
    const status = state.big === "exclude" ? "다른 지표에서는 제외돼 있습니다." : state.big === "only" ? "지금은 대형사만 보고 있습니다." : "다른 지표에 포함돼 있습니다.";
    return `<div class="db-big-kpi"><div><span>업체</span><b>${B.n}곳</b></div><div><span>매출</span><b>${won(B.s1)}</b></div><div><span>성장률</span><b class="${tone(B.g)}">${sg(B.g)}</b></div><div><span>이익률</span><b>${pc(B.m)}</b></div></div>`
      + note(`대형사가 전체 매출의 ${pc(share(B.s1, B.s1 + O.s1), 0)}를 차지합니다. 나머지 ${O.n}곳은 성장률 ${sg(O.g)}, 이익률 ${pc(O.m)}입니다. ${status}`)
      + hbarList(list.slice(0, 8).map((r) => ({ label: r.n, link: coLink(r), v: r.s1, right: won(r.s1), g: r.g })), { wide: 1 });
  }

  // ---------- 03 기업 포트폴리오 ----------
  function coScatter(rows) {
    const pts = rows.filter((r) => r.m != null).map((r) => ({ x: r.g, y: r.m, color: TYPE_COLOR[r.type], co: r.c, tip: `${r.n} · 성장 ${sg(r.g)} · 이익률 ${pc(r.m)} · ${r.type}` }));
    $("cosc-legend").innerHTML = TYPES.map((t) => `<li><i class="dot" style="background:${TYPE_COLOR[t]}"></i>${t} ${rows.filter((r) => r.type === t).length}</li>`).join("");
    if (!pts.length) return `<p class="db-empty">자료가 없습니다.</p>`;
    return scatter(pts, { clipX: 80, clipY: 40, label: "기업별 성장률과 영업이익률" }) + note("성장률 ±80%, 이익률 ±40% 밖의 값은 가장자리에 표시합니다.");
  }
  function boxCard(rows) {
    const groups = KINDS.map((k) => [k, rows.filter((r) => r.kind === k)]).filter(([, rs]) => rs.length >= 5);
    if (!groups.length) return `<p class="db-empty">비교할 업종이 없습니다.</p>`;
    const draw = (title, key, lo, hi) => {
      const L = 54, R = 16, rowH = 28, H = groups.length * rowH + 30, x = (v) => L + ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * (W - L - R);
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
    return hbarList(t.map((r, i) => ({ label: r.n, link: coLink(r), v: r.s1, right: won(r.s1), g: r.g, cls: i === 0 ? "hi" : r.g < 0 ? "warn" : "", tip: `${r.n} · ${r.kind} · 영업이익률 ${pc(r.m)}` })), { wide: 1, mark: avg })
      + note(down.length ? `상위 10개사 중 <b>${down.map((r) => r.n).join(", ")}</b> 매출이 줄었습니다.` : "상위 10개사 모두 매출이 늘었습니다.", down.length);
  }
  // 고성장 기업: 전년 매출 100억 미만은 기저효과 표시
  function fastCard(rows) {
    const t = rows.filter((r) => r.g != null).sort((a, b) => b.g - a.g).slice(0, 10);
    if (!t.length) return `<p class="db-empty">자료가 없습니다.</p>`;
    const small = t.filter((r) => r.s0 < 100).length;
    return hbarList(t.map((r) => ({ label: r.n, link: coLink(r) + (r.s0 < 100 ? '<small class="db-est" title="전년 매출 100억 미만">기저</small>' : ""), v: r.g, right: sg(r.g, 0), g: r.m, gText: pc(r.m, 0), tip: `${r.n} · 매출 ${won(r.s0)} → ${won(r.s1)}` })), { wide: 1 })
      + note(`오른쪽은 영업이익률입니다. ${small ? `${small}곳은 전년 매출이 100억 미만이라 기저효과일 수 있습니다.` : "기저효과가 큰 소규모 기업은 없습니다."}`);
  }
  function funnel(rows) {
    const steps = [["분석 업체", rows], ["매출 증가", rows.filter((r) => r.g > 0)], ["증가 + 흑자", rows.filter((r) => r.g > 0 && r.o1 > 0)], ["이익률 5%↑", rows.filter((r) => r.g > 0 && r.m >= 5)], ["우량 성장", rows.filter((r) => r.type === TYPES[0])]];
    const n0 = rows.length || 1;
    return `<ol class="db-funnel">${steps.map(([l, rs], i) => `<li data-tip="${l} ${rs.length}곳 (${pc(share(rs.length, n0), 0)})"><span>${l}</span><span class="bar"><span style="width:${Math.max(4, share(rs.length, n0))}%;opacity:${1 - i * 0.16}"></span></span><b>${rs.length}곳</b></li>`).join("")}</ol>`
      + `<p class="db-funnel-note">우량 성장형(성장 ${SB.HI_GROWTH}%↑·이익률 ${SB.HI_MARGIN}%↑) ${pc(share(steps[4][1].length, n0), 0)}</p>`;
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
    const tag = (t) => `<span class="db-tag ${t === TYPES[0] ? "good" : t === TYPES[3] ? "bad" : ""}">${t}</span>`;
    $("c-list").innerHTML = `<thead><tr>${COLS.map(([c, l]) => `<th scope="col" aria-sort="${c === k ? (state.dir > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-sort="${c}">${l}</button></th>`).join("")}</tr></thead>`
      + `<tbody>${rows.map((r) => `<tr><th scope="row">${coLink(r)}</th><td>${r.kind}${r.kindEst ? '<small class="db-est" title="DART 업종코드·회사명으로 추정">추정</small>' : ""}</td><td>${r.l ? "상장" : "비상장"}</td><td>${r.area}</td><td>${won(r.s1)}</td><td class="${tone(r.g)}">${sg(r.g)}</td><td class="${r.m < 0 ? "down" : ""}">${pc(r.m)}</td><td>${r.debt == null ? "-" : pc(r.debt, 0)}</td><td>${tag(r.type)}</td>${internal ? `<td>${r.legal}</td><td>${r.trade}</td><td>${r.semi == null ? "-" : pc(r.semi, 0)}</td>` : ""}</tr>`).join("") || `<tr><td colspan="${COLS.length}" class="db-empty">검색 결과가 없습니다.</td></tr>`}</tbody>`;
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
    $("c-sigcards").innerHTML = SIGNALS.map((s) => `<button type="button" class="db-sig${state.sig === s.key ? " on" : ""}" data-sig="${s.key}"><span>${s.label}</span><b>${count(s.key)}<small>곳</small></b><em>${s.rule}</em></button>`).join("");
    $("sig-chips").innerHTML = [["전체", `전체 ${hits.length}`], ...SIGNALS.map((s) => [s.key, `${s.label} ${count(s.key)}`])]
      .map(([k, l]) => `<button type="button" role="radio" aria-checked="${state.sig === k}" data-sig="${k}">${l}</button>`).join("");
    let list = hits.filter((x) => state.sig === "전체" || x.h.some((s) => s.key === state.sig));
    list.sort((a, b) => b.h.length - a.h.length || b.r.s1 - a.r.s1);
    const total = list.length;
    if (!state.sigMore) list = list.slice(0, 15);
    const kindMed = {};
    KINDS.forEach((k) => (kindMed[k] = med(sigRows.filter((x) => x.kind === k).map((x) => x.m))));
    $("c-signal").innerHTML = `<thead><tr><th>기업</th><th>업종</th><th>매출</th><th>이익률 / 업종 중앙값</th><th>신호</th><th>근거</th></tr></thead><tbody>`
      + (list.map(({ r, h }) => `<tr><th scope="row">${coLink(r)}</th><td>${r.kind}</td><td>${won(r.s1)}</td><td>${pc(r.m)} / ${pc(kindMed[r.kind])}</td>`
        + `<td>${h.map((s) => `<span class="db-tag ${s.key === "이상" ? "" : "bad"}">${s.label}</span>`).join(" ")}</td><td class="db-why">${h.map((s) => esc(s.why(r))).join(" · ")}</td></tr>`).join("")
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
  $("sig-chips").addEventListener("click", pickSig);
  $("c-sigcards").addEventListener("click", pickSig);
  $("sig-more").addEventListener("click", () => { state.sigMore = !state.sigMore; drawSignals(); });
  $("c-rules").innerHTML = `<thead><tr><th>신호</th><th>규칙(확정)</th><th>확인할 사항</th></tr></thead><tbody>${SIGNALS.map((s) => `<tr><th scope="row">${s.label}</th><td>${s.rule}</td><td>${s.check}</td></tr>`).join("")}</tbody>`;

  // ---------- 05 기업 상세 ----------
  $("co-list").innerHTML = recs.slice().sort((a, b) => a.n.localeCompare(b.n, "ko")).map((r) => `<option value="${esc(r.n)}"></option>`).join("");
  $("co-q").addEventListener("change", () => { const r = recs.find((x) => x.n === $("co-q").value.trim()); if (r) { state.co = r.c; drawCompany(); } });
  function miniBars(labels, vals, ops) {
    const H = 200, L = 46, R = 12, T = 18, B = 26, pw = W - L - R, ph = H - T - B, max = Math.max(...vals.filter((v) => v != null), 1), bw = pw / labels.length;
    let g = "";
    for (let i = 0; i <= 3; i++) { const v = (max * i) / 3, y = T + ph - (v / max) * ph; g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="ax" x="${L - 6}" y="${y + 4}" text-anchor="end">${won(v)}</text>`; }
    labels.forEach((l, i) => {
      const v = vals[i], x = L + bw * i + bw * 0.2, w = bw * 0.6, op = ops[i];
      if (v != null) { const h = (Math.max(v, 0) / max) * ph; g += `<rect x="${x}" y="${T + ph - h}" width="${w}" height="${h}" rx="3" fill="var(--blue)" data-tip="${l} 매출 ${won(v)} · 영업이익 ${won(op)} (${pc(share(op, v))})"/>`; }
      else g += `<text class="ax" x="${x + w / 2}" y="${T + ph - 6}" text-anchor="middle">결측</text>`;
      g += `<text class="ax" x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${l}</text>`;
      if (v && op != null) g += `<text class="val" x="${x + w / 2}" y="${T + ph - (Math.max(v, 0) / max) * ph - 5}" text-anchor="middle"${op < 0 ? ' fill="var(--down)"' : ""}>${pc(share(op, v), 0)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="매출과 영업이익률">${g}</svg><p class="db-mini">막대 위 숫자는 영업이익률입니다.</p>`;
  }
  function drawCompany() {
    const P = SB.panel(recs, state.fy);
    if (!state.co) state.co = (P.slice().sort((a, b) => b.s1 - a.s1)[0] || recs[0] || {}).c;
    const base = recs.find((r) => r.c === state.co);
    if (!base) { $("c-company").innerHTML = `<p class="db-empty">기업을 선택하세요.</p>`; return; }
    $("co-q").value = base.n;
    const r = P.find((x) => x.c === base.c), peers = P.filter((x) => x.kind === base.kind);
    const rank = (key, v) => { if (v == null) return "-"; const vals = peers.map((x) => x[key]).filter((x) => x != null); return `상위 ${Math.max(1, Math.round((vals.filter((x) => x > v).length / vals.length) * 100) || 1)}%`; };
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
      <div class="db-co-kpis">${card(`${state.fy}년 매출`, r ? won(r.s1) : "-", r ? `${base.kind} ${peers.length}곳 중 ${salesRank}위` : "")}${card("매출 성장률", r ? sg(r.g) : "-", r ? `업종 ${rank("g", r.g)} · 중앙값 ${sg(med(peers.map((x) => x.g)))}` : "")}${card("영업이익률", r ? pc(r.m) : "-", r && r.m != null ? `업종 ${rank("m", r.m)} · 중앙값 ${pc(med(peers.map((x) => x.m)))}` : "")}${card("부채비율", r && r.debt != null ? pc(r.debt, 0) : "-", r && r.debt != null ? `업종 중앙값 ${pc(med(peers.map((x) => x.debt)), 0)}` : "자료 없음")}${card("기업 유형", r ? r.type : "-", `성장 ${SB.HI_GROWTH}%·이익률 ${SB.HI_MARGIN}% 기준`)}</div>
      <div class="db-grid r1">
        <section class="db-card"><div class="db-card-head"><h2>연도별 매출·영업이익률</h2></div>${miniBars(base.y.map((y) => `${y}`), base.s, base.o)}</section>
        <section class="db-card"><div class="db-card-head"><h2>분기별 매출·영업이익률</h2></div>${base.q ? miniBars(base.q.labels, base.q.sales, base.q.op) : `<p class="db-empty">${base.l ? "분기 실적이 없습니다." : "비상장사는 분기 실적을 공시하지 않아 연간만 표시합니다."}</p>`}</section>
      </div>
      <div class="db-grid r1">
        <section class="db-card"><div class="db-card-head"><h2>경영 변화 신호</h2></div>${sigs.length ? `<ul class="db-plain">${sigs.map((s) => `<li><span class="db-tag ${s.key === "이상" ? "" : "bad"}">${s.label}</span> ${esc(s.why(r))}<small> · 확인: ${s.check}</small></li>`).join("")}</ul>` : `<p class="db-empty">해당하는 신호가 없습니다.</p>`}</section>
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

  // ---------- 그리기 ----------
  function render() {
    F = SB.makeFilter(state, internal);
    const list = recs.filter(F.inFilter), rows = SB.panel(list, state.fy), S = SB.stats(rows), FS = SB.fullSample(list, state.fy);
    $("sub").textContent = `${SB.describe(state)} · 개별 기준 · 분석 ${S.n}곳 (상장 ${rows.filter((r) => r.l).length} · 비상장 ${rows.filter((r) => !r.l).length})`;
    const ids = ["c-trend", "c-kindsc", "c-changes", "c-insight", "c-mix", "c-region", "c-summary", "c-conc", "c-cosc", "c-box", "c-top", "c-fast", "c-funnel"];
    if (!rows.length) {
      $("kpis").innerHTML = `<p class="db-empty">조건에 맞는 기업이 없습니다. 필터를 초기화해 보세요.</p>`;
      ids.forEach((id) => ($(id).innerHTML = ""));
    } else {
      kpis(rows, S, FS);
      $("c-trend").innerHTML = trendChart(list);
      $("c-kindsc").innerHTML = kindScatter(rows);
      $("c-changes").innerHTML = changes(rows, S);
      $("c-insight").innerHTML = insights(rows, S, FS);
      $("c-mix").innerHTML = mixCard(rows, S);
      $("c-region").innerHTML = regionCard(rows, S);
      $("c-summary").innerHTML = summary(rows, S);
      $("c-conc").innerHTML = concCard(rows);
      $("c-cosc").innerHTML = coScatter(rows);
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
  }

  // 툴팁
  const tip = $("tip");
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

  $("updated").textContent = SB.meta.updated || "-";
  const offFy = recs.filter((r) => r.mt && r.mt !== "12").length;
  $("foot").textContent = "자료: 금융감독원 전자공시(DART) 사업보고서·감사보고서·분기보고서, 개별(별도) 기준. 분기 추이는 상장사만 포함합니다. "
    + "업종은 직접 분류 외에는 회사명·DART 업종코드로 추정했고, 매출 규모는 법적 기업규모 입력 전까지 쓰는 매출액 구간입니다. "
    + `12월 결산이 아닌 ${offFy}곳은 해당 사업연도로 맞췄습니다. 수요기업(삼성전자·SK하이닉스 등)은 제외했습니다.`;
  if (!recs.length) { $("kpis").innerHTML = `<p class="db-empty">실적 데이터가 아직 없습니다. 다음 자동 갱신 후에 표시됩니다.</p>`; return; }
  drawFilters();
  render();
  ready = true;
  showView(location.hash.slice(1));
})();
