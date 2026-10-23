// 소부장 분석 대시보드: 협력사 연간·분기 실적(financials.js)을 조건별로 집계해 그린다.
// 원칙: 핵심 지표는 위에 크게, 모든 숫자에 비교 기준(전년·평균), 색은 강조할 곳에만, 그래프마다 "그래서" 한 줄.
(() => {
  const FIN = window.COMPANY_FINANCIALS || [];
  const META = window.COMPANY_FINANCIALS_META || {};
  const segs = window.COMPANY_SEGMENTS || {};
  const universe = window.COMPANY_UNIVERSE || [];
  const uniByKey = new Map(universe.map((u) => [u[1], u]));
  const profileCodes = new Set((window.COMPANY_GROUPS || []).flatMap((g) => g.companies.map((c) => c[1])));
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NA = "미분류";

  // ---------- 숫자 ----------
  const num = (v) => Math.round(v).toLocaleString("ko-KR");
  const won = (v) => (Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(1)}조` : `${num(v)}억`);
  const pc = (v, d = 1) => (v == null || !isFinite(v) ? "-" : `${v.toFixed(d)}%`);
  const sg = (v, d = 1) => (v == null || !isFinite(v) ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
  const pp = (v) => (v == null || !isFinite(v) ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%p`);
  const tone = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
  const arrow = (v) => (v > 0 ? "▲" : v < 0 ? "▼" : "");
  const sum = (a) => a.reduce((s, v) => s + (v || 0), 0);
  const med = (a) => { const s = a.filter((v) => v != null && isFinite(v)).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const growth = (a, b) => (b > 0 && a != null ? (a / b - 1) * 100 : null);
  const share = (n, d) => (d ? (n / d) * 100 : null);

  // ---------- 기업 속성 ----------
  const KSIC = [[/^29/, "장비"], [/^(20|21|22|23|24)/, "소재"], [/^(25|26|27|28|30)/, "부품"]];
  const SHORT = { 서울특별시: "서울", 경기도: "경기", 인천광역시: "경기", 충청북도: "충청", 충청남도: "충청", 대전광역시: "충청", 세종특별자치시: "충청", 경상북도: "경상", 경상남도: "경상", 부산광역시: "경상", 울산광역시: "경상", 대구광역시: "경상", 전북특별자치도: "전라", 전라북도: "전라", 전라남도: "전라", 광주광역시: "전라" };
  const areaOf = (r) => {
    const u = r.k && uniByKey.get(r.k);
    if (u && u[2].length) return u[2][0][0];
    return SHORT[String(r.ad || "").trim().split(/\s+/)[0]] || "기타";
  };
  const recs = FIN.map((r) => {
    const seg = segs[r.c], est = !seg && KSIC.find(([re]) => re.test(r.ind || ""));
    return { ...r, kind: seg ? seg[0] : est ? est[1] : NA, area: areaOf(r) };
  }).filter((r) => r.kind !== "수요");

  const KINDS = ["소재", "부품", "장비", NA], AREAS = ["서울", "경기", "충청", "경상", "전라", "기타"];
  const TYPES = ["우량 성장형", "수익 안정형", "성장 투자형", "경영 취약형"];
  const typeOf = (g, m) => (g >= 10 ? (m >= 5 ? TYPES[0] : TYPES[2]) : m >= 5 ? TYPES[1] : TYPES[3]);

  // ---------- 필터 ----------
  const yearCount = {};
  recs.forEach((r) => r.y.length && (yearCount[r.y[r.y.length - 1]] = (yearCount[r.y[r.y.length - 1]] || 0) + 1));
  const DEFAULT_FY = Number(Object.keys(yearCount).sort((a, b) => yearCount[b] - yearCount[a] || b - a)[0]) || new Date().getFullYear() - 1;
  const state = { fy: DEFAULT_FY, kind: "all", area: "all", listed: "all", q: "", chip: "전체", sort: "g", dir: -1, more: false };
  const fill = (id, opts, val) => ($(id).innerHTML = opts.map(([v, l]) => `<option value="${v}"${String(v) === String(val) ? " selected" : ""}>${l}</option>`).join(""));
  function drawFilters() {
    fill("f-fy", [DEFAULT_FY, DEFAULT_FY - 1].map((y) => [y, `${y}년`]), state.fy);
    fill("f-kind", [["all", "전체"], ...KINDS.map((k) => [k, k])], state.kind);
    fill("f-area", [["all", "전체"], ...AREAS.map((a) => [a, a])], state.area);
    fill("f-listed", [["all", "전체"], ["1", "상장"], ["0", "비상장"]], state.listed);
  }
  $("filters").addEventListener("change", (e) => {
    const key = { "f-fy": "fy", "f-kind": "kind", "f-area": "area", "f-listed": "listed" }[e.target.id];
    if (!key) return;
    state[key] = key === "fy" ? Number(e.target.value) : e.target.value;
    state.more = false;
    render();
  });
  $("filters").addEventListener("reset", (e) => {
    e.preventDefault();
    Object.assign(state, { fy: DEFAULT_FY, kind: "all", area: "all", listed: "all", q: "", chip: "전체", more: false });
    $("q").value = "";
    drawFilters();
    render();
  });
  const inFilter = (r) => (state.kind === "all" || r.kind === state.kind) && (state.area === "all" || r.area === state.area)
    && (state.listed === "all" || String(r.l) === state.listed);

  // ---------- 집계 ----------
  const at = (r, arr, y) => { const i = r.y.indexOf(y); return i < 0 ? null : arr[i]; };
  function panel(list, fy) {
    return list.map((r) => {
      const s1 = at(r, r.s, fy), s0 = at(r, r.s, fy - 1);
      if (!(s1 > 0) || !(s0 > 0)) return null;
      const o1 = at(r, r.o, fy) ?? 0, o0 = at(r, r.o, fy - 1) ?? 0, g = growth(s1, s0), m = share(o1, s1);
      return { ...r, s1, s0, o1, o0, s2: at(r, r.s, fy - 2), o2: at(r, r.o, fy - 2), g, m, m0: share(o0, s0), type: typeOf(g, m) };
    }).filter(Boolean);
  }
  function stats(rows) {
    const s1 = sum(rows.map((r) => r.s1)), s0 = sum(rows.map((r) => r.s0)), o1 = sum(rows.map((r) => r.o1)), o0 = sum(rows.map((r) => r.o0));
    const three = rows.filter((r) => r.s2 > 0);
    return {
      n: rows.length, s1, s0, o1, o0, g: growth(s1, s0), og: o0 > 0 ? growth(o1, o0) : null, m: share(o1, s1), m0: share(o0, s0),
      profit: share(rows.filter((r) => r.o1 > 0).length, rows.length), profit0: share(rows.filter((r) => r.o0 > 0).length, rows.length),
      up: share(rows.filter((r) => r.g > 0).length, rows.length), medG: med(rows.map((r) => r.g)), medM: med(rows.map((r) => r.m)),
      loss: rows.filter((r) => r.o1 < 0).length,
      spark: { s: [sum(three.map((r) => r.s2)), sum(three.map((r) => r.s0)), sum(three.map((r) => r.s1))], o: [sum(three.map((r) => r.o2 || 0)), sum(three.map((r) => r.o0)), sum(three.map((r) => r.o1))] },
    };
  }

  // ---------- 그림 도구 ----------
  const W = 520;
  function sparkBars(vals) {
    const v = vals.filter((x) => x != null), max = Math.max(...v.map(Math.abs), 1), w = 100 / v.length;
    return `<svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">${v.map((x, i) => `<rect class="spark-bar${i === v.length - 1 ? " on" : ""}" x="${i * w + w * 0.18}" y="${28 - (Math.abs(x) / max) * 26}" width="${w * 0.64}" height="${(Math.abs(x) / max) * 26}" rx="1.5"/>`).join("")}</svg>`;
  }
  const kpi = (o) => `<article class="db-kpi${o.hero ? " hero" : ""}"><p class="lab"><i class="ph ${o.icon}" aria-hidden="true"></i>${o.label}</p>
    <strong>${o.value}</strong><p class="delta">${o.delta}</p>${o.spark ? sparkBars(o.spark) : ""}</article>`;
  const delta = (v, txt, unit = "pct") => `<b class="${tone(v)}">${arrow(v)} ${unit === "pp" ? pp(v) : sg(v)}</b><span class="vs">${txt}</span>`;

  function trendChart(rows) {
    const qs = rows.filter((r) => r.q && r.q.labels.length === 8 && r.q.sales.every((v) => v != null));
    const key = (() => { const c = {}; qs.forEach((r) => { const k = r.q.labels.join(); c[k] = (c[k] || 0) + 1; }); return Object.keys(c).sort((a, b) => c[b] - c[a])[0]; })();
    const P = qs.filter((r) => r.q.labels.join() === key);
    $("trend-sub").textContent = P.length ? `상장 ${P.length}곳 · 최근 8개 분기` : "";
    if (!P.length) return `<p class="db-empty">이 조건에는 분기 실적이 있는 상장사가 없습니다. 비상장사는 분기 실적을 공시하지 않습니다.</p>`;
    const labels = key.split(","), s = labels.map((_, i) => sum(P.map((r) => r.q.sales[i])));
    const H = 230, L = 46, R = 70, T = 18, B = 28, pw = W - L - R, ph = H - T - B, max = Math.max(...s) * 1.1, min = 0;
    const x = (i) => L + (pw * i) / (labels.length - 1), y = (v) => T + ph - ((v - min) / (max - min)) * ph;
    let g = "";
    for (let i = 0; i <= 4; i++) { const v = (max * i) / 4; g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${won(v)}</text>`; }
    labels.forEach((l, i) => (g += `<text class="ax" x="${x(i)}" y="${H - 8}" text-anchor="middle">${l}</text>`));
    g += `<path d="M${x(0)},${y(0)} ${s.map((v, i) => `L${x(i)},${y(v)}`).join(" ")} L${x(s.length - 1)},${y(0)}Z" fill="var(--blue)" opacity=".1"/>`;
    g += `<polyline points="${s.slice(0, 4).map((v, i) => `${x(i + 4)},${y(v)}`).join(" ")}" fill="none" stroke="var(--text-3)" stroke-width="1.6" stroke-dasharray="4 4"/>`;
    g += `<polyline points="${s.map((v, i) => `${x(i)},${y(v)}`).join(" ")}" fill="none" stroke="var(--blue)" stroke-width="2.5" stroke-linejoin="round"/>`;
    s.forEach((v, i) => (g += `<circle cx="${x(i)}" cy="${y(v)}" r="${i === 7 ? 5 : 3}" fill="${i === 7 ? "var(--blue)" : "var(--card)"}" stroke="var(--blue)" stroke-width="2"/><rect class="hit" x="${x(i) - 18}" y="${T}" width="36" height="${ph}" data-tip="${labels[i]} 매출 ${won(v)}${i >= 4 ? ` · 전년 동기 ${won(s[i - 4])} (${sg(growth(v, s[i - 4]))})` : ""}"/>`));
    const yoy = growth(s[7], s[3]), ltm = growth(sum(s.slice(4)), sum(s.slice(0, 4)));
    const cx = x(7) + 10, cy = Math.max(T + 2, y(s[7]) - 34);
    g += `<rect class="callout" x="${cx - 4}" y="${cy}" width="${R - 2}" height="34" rx="6"/><text class="callout-t" x="${cx + 2}" y="${cy + 14}">전년 동기</text><text class="callout-t" x="${cx + 2}" y="${cy + 28}">${sg(yoy)}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="분기 매출 추이. 최근 분기 전년 동기 대비 ${sg(yoy)}">${g}</svg>
      <p class="db-note"><i class="ph ph-info" aria-hidden="true"></i><span>최근 4분기 매출 ${won(sum(s.slice(4)))}원, 직전 4분기 대비 <b class="${tone(ltm)}">${sg(ltm)}</b>. ${ltm >= 0 ? "성장 흐름이 이어지고 있습니다." : "역성장 구간으로 원인 확인이 필요합니다."}</span></p>`;
  }

  function hbarList(items, opt = {}) {
    const max = Math.max(...items.map((i) => i.v), 1);
    const mark = opt.mark != null ? `<span class="mark" style="left:${(opt.mark / max) * 100}%"></span>` : "";
    return `<ul class="db-hbars${opt.wide ? " wide" : ""}">${items.map((i) => `<li class="${i.cls || ""}" data-tip="${esc(i.tip || "")}"><span class="nm">${i.href ? `<a href="${i.href}">${esc(i.label)}</a>` : esc(i.label)}</span><span class="track"><span class="fill" style="width:${(i.v / max) * 100}%"></span>${mark}</span><b>${i.right}</b><em class="${tone(i.g)}">${sg(i.g)}</em></li>`).join("")}</ul>`;
  }
  function regionCard(rows, S) {
    const items = AREAS.map((a) => { const rs = rows.filter((r) => r.area === a); const st = stats(rs); return { label: a, v: st.s1, right: won(st.s1), g: st.g, n: rs.length, tip: `${a} ${rs.length}곳 · 매출 ${won(st.s1)} · 영업이익률 ${pc(st.m)}` }; }).filter((i) => i.n);
    if (!items.length) return `<p class="db-empty">자료가 없습니다.</p>`;
    const top = items.slice().sort((a, b) => b.v - a.v)[0], worst = items.filter((i) => i.n >= 3).sort((a, b) => a.g - b.g)[0];
    top.cls = "hi";
    if (worst && worst.g < S.g - 5) worst.cls = "warn";
    const note = worst && worst.cls === "warn"
      ? `<p class="db-note warn"><i class="ph ph-warning" aria-hidden="true"></i><span><b>${worst.label}</b> 권역 매출 ${sg(worst.g)}로 전체(${sg(S.g)})보다 크게 낮습니다. 확인이 필요합니다.</span></p>`
      : `<p class="db-note"><i class="ph ph-info" aria-hidden="true"></i><span><b>${top.label}</b> 권역이 매출의 ${pc(share(top.v, S.s1), 0)}를 차지합니다.</span></p>`;
    return hbarList(items) + note;
  }

  function funnel(rows) {
    const steps = [
      ["분석 업체", rows],
      ["매출 증가", rows.filter((r) => r.g > 0)],
      ["증가 + 흑자", rows.filter((r) => r.g > 0 && r.o1 > 0)],
      ["이익률 5%↑", rows.filter((r) => r.g > 0 && r.m >= 5)],
      ["우량 성장", rows.filter((r) => r.g >= 10 && r.m >= 10)],
    ];
    const n0 = rows.length || 1;
    return `<ol class="db-funnel">${steps.map(([l, rs], i) => `<li data-tip="${l} ${rs.length}곳 (${pc(share(rs.length, n0), 0)})"><span>${l}</span><span class="bar"><span style="width:${Math.max(4, share(rs.length, n0))}%;opacity:${1 - i * 0.16}"></span></span><b>${rs.length}곳</b></li>`).join("")}</ol>
      <p class="db-funnel-note">우량 성장(성장 10%↑·이익률 10%↑) 비율 ${pc(share(steps[4][1].length, n0), 0)}</p>`;
  }

  function mixCard(rows, S) {
    const items = KINDS.map((k) => { const rs = rows.filter((r) => r.kind === k); const st = stats(rs); return { label: k, v: st.s1, right: pc(share(st.s1, S.s1), 0), g: st.g, n: rs.length, tip: `${k} ${rs.length}곳 · 매출 ${won(st.s1)} · 영업이익률 ${pc(st.m)}` }; }).filter((i) => i.n);
    if (!items.length) return `<p class="db-empty">자료가 없습니다.</p>`;
    const best = items.filter((i) => i.label !== NA).sort((a, b) => b.g - a.g)[0];
    if (best) best.cls = "hi";
    const unk = items.find((i) => i.label === NA);
    return hbarList(items) + `<p class="db-note"><i class="ph ph-info" aria-hidden="true"></i><span>${best ? `성장은 <b>${best.label}</b>(${sg(best.g)})이 가장 빠릅니다. ` : ""}오른쪽 숫자는 전년 대비 매출 성장률입니다.${unk ? ` 미분류 ${unk.n}곳은 업종 확인이 필요합니다.` : ""}</span></p>`;
  }

  function top10(rows) {
    const t = rows.slice().sort((a, b) => b.s1 - a.s1).slice(0, 10);
    if (!t.length) return `<p class="db-empty">자료가 없습니다.</p>`;
    const avg = sum(t.map((r) => r.s1)) / t.length;
    const items = t.map((r, i) => ({ label: r.n, href: profileCodes.has(r.c) ? `profile.html#${r.c}` : "", v: r.s1, right: won(r.s1), g: r.g, cls: i === 0 ? "hi" : r.g < 0 ? "warn" : "", tip: `${r.n} · ${r.kind} · 영업이익률 ${pc(r.m)}` }));
    const down = t.filter((r) => r.g < 0);
    return hbarList(items, { wide: 1, mark: avg })
      + `<p class="db-note${down.length ? " warn" : ""}"><i class="ph ${down.length ? "ph-warning" : "ph-info"}" aria-hidden="true"></i><span>${down.length ? `상위 10개사 중 <b>${down.map((r) => r.n).join(", ")}</b> 매출이 줄었습니다.` : "상위 10개사 모두 매출이 늘었습니다."} 점선은 상위 10개사 평균(${won(avg)})입니다.</span></p>`;
  }

  function summary(rows, S) {
    const tr = (label, st, foot) => `<tr>${foot ? `<td>${label}</td>` : `<th scope="row">${label}</th>`}<td>${st.n}</td><td>${won(st.s1)}</td><td>${pc(share(st.s1, S.s1), 0)}</td><td class="${tone(st.g)}">${sg(st.g)}</td><td>${pc(st.m)}</td><td>${pc(share(st.loss, st.n), 0)}</td></tr>`;
    const body = KINDS.map((k) => [k, rows.filter((r) => r.kind === k)]).filter(([, rs]) => rs.length).map(([k, rs]) => tr(k, stats(rs))).join("")
      + [["상장", rows.filter((r) => r.l)], ["비상장", rows.filter((r) => !r.l)]].filter(([, rs]) => rs.length).map(([k, rs]) => tr(k, stats(rs))).join("");
    return `<thead><tr><th>구분</th><th>업체</th><th>매출</th><th>비중</th><th>성장률</th><th>이익률</th><th>적자</th></tr></thead><tbody>${body}</tbody><tfoot>${tr("합계", S, true)}</tfoot>`;
  }

  function gauge(S) {
    const v = S.profit ?? 0, v0 = S.profit0 ?? 0, cx = 110, cy = 100, r = 80;
    const pt = (p) => { const a = Math.PI * (1 - p / 100); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
    const arc = (p) => { const [x, y] = pt(p); return `M${cx - r},${cy} A${r},${r} 0 0 1 ${x},${y}`; };
    const [bx, by] = pt(v0), [bx2, by2] = [cx + (r + 12) * Math.cos(Math.PI * (1 - v0 / 100)), cy - (r + 12) * Math.sin(Math.PI * (1 - v0 / 100))];
    return `<svg viewBox="0 0 220 130" role="img" aria-label="흑자 업체 비중 ${pc(v, 0)}, 전년 ${pc(v0, 0)}">
      <path d="${arc(100)}" fill="none" stroke="var(--grid)" stroke-width="16" stroke-linecap="round"/>
      <path d="${arc(v)}" fill="none" stroke="${v >= v0 ? "var(--green)" : "var(--down)"}" stroke-width="16" stroke-linecap="round"/>
      <line x1="${bx}" y1="${by}" x2="${bx2}" y2="${by2}" stroke="var(--text)" stroke-width="2"/>
      <text class="big" x="${cx}" y="${cy - 8}" text-anchor="middle">${pc(v, 0)}</text>
      <text class="small" x="${cx}" y="${cy + 12}" text-anchor="middle">흑자 ${S.n - S.loss}곳 / ${S.n}곳</text>
      <text class="small" x="${cx - r}" y="${cy + 24}" text-anchor="middle">0%</text><text class="small" x="${cx + r}" y="${cy + 24}" text-anchor="middle">100%</text></svg>
      <p>전년 ${pc(v0, 0)} → <b class="${tone(v - v0)}">${pp(v - v0)}</b> <span style="color:var(--text-3)">(눈금은 전년)</span></p>`;
  }

  function insights(rows, S) {
    const out = [];
    const dm = S.m - S.m0;
    out.push([S.g >= 0 && dm >= 0 ? "good" : S.g < 0 && dm < 0 ? "bad" : "", "ph-trend-up",
      `매출 ${sg(S.g)}, 영업이익률 ${pc(S.m)}(${pp(dm)})`,
      S.g >= 0 && dm >= 0 ? "외형과 수익성이 함께 좋아졌습니다." : S.g >= 0 ? "매출은 늘었지만 이익률이 낮아져 원가·단가 점검이 필요합니다." : dm >= 0 ? "매출은 줄었지만 수익성은 지켰습니다." : "매출과 수익성이 함께 약해졌습니다."]);
    const t10 = share(sum(rows.slice().sort((a, b) => b.s1 - a.s1).slice(0, 10).map((r) => r.s1)), S.s1);
    out.push([Math.abs(S.medG - S.g) > 5 ? "bad" : "", "ph-scales",
      `상위 10개사가 매출의 ${pc(t10, 0)} · 업체 중앙값 성장률 ${sg(S.medG)}`,
      S.g - S.medG > 5 ? "대형사 중심의 성장입니다. 일반 업체 체감은 이보다 약합니다." : S.medG - S.g > 5 ? "일반 업체가 대형사보다 더 크게 성장했습니다." : "성장이 업체 전반에 고르게 퍼져 있습니다."]);
    const weak = rows.filter((r) => r.o1 < 0 && r.g < 0);
    out.push([weak.length ? "bad" : "good", "ph-first-aid",
      `매출 감소와 영업적자가 겹친 업체 ${weak.length}곳`,
      weak.length ? `상생협력 지원 우선 검토 대상입니다: ${weak.sort((a, b) => b.s1 - a.s1).slice(0, 3).map((r) => r.n).join(", ")}${weak.length > 3 ? " 등" : ""}` : "동시에 악화된 업체가 없습니다."]);
    const best = rows.filter((r) => r.type === TYPES[0]);
    out.push(["good", "ph-rocket-launch", `우량 성장형 ${best.length}곳(${pc(share(best.length, S.n), 0)})`,
      best.length ? `대표 기업: ${best.sort((a, b) => b.s1 - a.s1).slice(0, 3).map((r) => r.n).join(", ")}` : "기준(성장 10%↑·이익률 5%↑)을 넘는 업체가 없습니다."]);
    return out.map(([c, ic, what, so]) => `<li><span class="ic ${c}"><i class="ph ${ic}" aria-hidden="true"></i></span><span><b>${what}</b><small>${so}</small></span></li>`).join("");
  }

  // ---------- 기업 목록(검색·칩·정렬) ----------
  const CHIPS = ["전체", ...TYPES, "영업적자"];
  const COLS = [["n", "기업"], ["kind", "업종"], ["l", "상장"], ["area", "지역"], ["s1", "매출"], ["g", "성장률"], ["m", "영업이익률"], ["type", "유형"]];
  let listRows = [];
  function drawList() {
    const q = state.q.trim().toLowerCase();
    let rows = listRows.filter((r) => (!q || r.n.toLowerCase().includes(q)) && (state.chip === "전체" || (state.chip === "영업적자" ? r.o1 < 0 : r.type === state.chip)));
    const k = state.sort;
    rows.sort((a, b) => { const x = a[k], y = b[k]; if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(y, "ko") : x - y) * state.dir; });
    $("list-count").textContent = `${rows.length}곳`;
    const total = rows.length;
    if (!state.more) rows = rows.slice(0, 15);
    const tag = (t) => `<span class="db-tag ${t === TYPES[0] ? "good" : t === TYPES[3] ? "bad" : ""}">${t}</span>`;
    $("c-list").innerHTML = `<thead><tr>${COLS.map(([c, l]) => `<th scope="col" aria-sort="${c === k ? (state.dir > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-sort="${c}">${l}</button></th>`).join("")}</tr></thead>`
      + `<tbody>${rows.map((r) => `<tr><th scope="row">${profileCodes.has(r.c) ? `<a href="profile.html#${r.c}">${esc(r.n)}</a>` : esc(r.n)}</th><td>${r.kind}</td><td>${r.l ? "상장" : "비상장"}</td><td>${r.area}</td><td>${won(r.s1)}</td><td class="${tone(r.g)}">${sg(r.g)}</td><td class="${r.m < 0 ? "down" : ""}">${pc(r.m)}</td><td>${tag(r.type)}</td></tr>`).join("") || `<tr><td colspan="8" class="db-empty">검색 결과가 없습니다.</td></tr>`}</tbody>`;
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

  // ---------- 그리기 ----------
  function render() {
    const rows = panel(recs.filter(inFilter), state.fy);
    const S = stats(rows);
    const fy = state.fy;
    $("sub").textContent = `${fy}년 사업연도 · 개별 기준 · 분석 ${S.n}곳 (상장 ${rows.filter((r) => r.l).length} · 비상장 ${rows.filter((r) => !r.l).length})`;
    if (!rows.length) {
      $("kpis").innerHTML = `<p class="db-empty">조건에 맞는 기업이 없습니다. 필터를 초기화해 보세요.</p>`;
      ["c-trend", "c-region", "c-funnel", "c-mix", "c-top", "c-summary", "c-gauge", "c-insight"].forEach((id) => ($(id).innerHTML = ""));
      listRows = [];
      drawList();
      return;
    }
    $("kpis").innerHTML = [
      { hero: 1, icon: "ph-currency-krw", label: `${fy}년 합산 매출`, value: `${won(S.s1)}<small>원</small>`, delta: delta(S.g, "전년 대비"), spark: S.spark.s },
      { icon: "ph-coins", label: "영업이익", value: won(S.o1), delta: S.og == null ? `<span class="vs">전년 적자</span>` : delta(S.og, "전년 대비"), spark: S.spark.o },
      { icon: "ph-percent", label: "영업이익률", value: pc(S.m), delta: delta(S.m - S.m0, `전년 ${pc(S.m0)}`, "pp") },
      { icon: "ph-check-circle", label: "흑자 업체 비중", value: pc(S.profit, 0), delta: delta(S.profit - S.profit0, "전년 대비", "pp") },
      { icon: "ph-arrow-fat-lines-up", label: "매출 증가 업체", value: pc(S.up, 0), delta: `<span class="vs">중앙값 성장률 ${sg(S.medG)}</span>` },
      { icon: "ph-buildings", label: "분석 업체", value: `${S.n}<small>곳</small>`, delta: `<span class="vs">영업적자 ${S.loss}곳</span>` },
    ].map(kpi).join("");
    $("c-trend").innerHTML = trendChart(recs.filter(inFilter));
    $("c-region").innerHTML = regionCard(rows, S);
    $("c-funnel").innerHTML = funnel(rows);
    $("c-mix").innerHTML = mixCard(rows, S);
    $("c-top").innerHTML = top10(rows);
    $("c-summary").innerHTML = summary(rows, S);
    $("c-gauge").innerHTML = gauge(S);
    $("c-insight").innerHTML = insights(rows, S);
    listRows = rows;
    drawList();
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

  // 사이드바: 보이는 구역 표시
  const links = [...document.querySelectorAll(".db-nav:not(.sub) a")];
  const io = new IntersectionObserver((ents) => ents.forEach((en) => {
    if (!en.isIntersecting) return;
    links.forEach((a) => a.setAttribute("aria-current", a.getAttribute("href") === `#${en.target.id}`));
  }), { rootMargin: "-30% 0px -60% 0px" });
  links.forEach((a) => { const t = document.querySelector(a.getAttribute("href")); if (t && t.id !== "main") io.observe(t); });

  $("csv").addEventListener("click", () => {
    const head = ["업체코드", "업체명", "상장", "업종", "지역", "기간", "매출액(억원)", "영업이익(억원)", "당기순이익(억원)"];
    const out = [head];
    recs.filter(inFilter).forEach((r) => {
      const base = [r.c, r.n, r.l ? "상장" : "비상장", r.kind, r.area];
      r.y.forEach((y, i) => out.push([...base, `FY${y}`, r.s[i], r.o[i], r.ni[i]]));
      if (r.q) r.q.labels.forEach((l, i) => out.push([...base, l, r.q.sales[i], r.q.op[i], r.q.net[i]]));
    });
    const csv = "﻿" + out.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: "소부장_실적_모판.csv" }).click();
  });

  $("updated").textContent = META.updated || "-";
  $("foot").textContent = "자료: 금융감독원 전자공시(DART) 사업보고서·감사보고서·분기보고서, 개별(별도) 기준. 분기 추이는 분기 실적을 공시하는 상장사만 포함합니다. "
    + "업종은 직접 분류한 기업 외에는 DART 업종코드로 추정했습니다. 삼성전자·SK하이닉스 등 수요기업은 제외했습니다.";
  if (!recs.length) {
    $("kpis").innerHTML = `<p class="db-empty">실적 데이터가 아직 없습니다. 다음 자동 갱신 후에 표시됩니다.</p>`;
    return;
  }
  drawFilters();
  render();
})();
