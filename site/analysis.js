// 성장 트렌드 분석: 기업 속성(상장·구분·지역 등)으로 거르고, 합산 추이·구분별·상장별·기업별 성장을 보여 준다.
(() => {
  const groups = window.COMPANY_GROUPS || [];
  const profiles = window.COMPANY_PROFILES || {};
  const segs = window.COMPANY_SEGMENTS || {};
  const attrs = window.COMPANY_ATTRS || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NA = "미입력";
  const num = (v) => Number(v).toLocaleString("ko-KR");
  const pct1 = (v) => (v == null ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
  const rate = (v) => (v == null ? "-" : `${v.toFixed(1)}%`);
  const growth = (a, b) => (a != null && b ? ((a - b) / Math.abs(b)) * 100 : null);

  const SIDO = { 서울특별시: "서울", 부산광역시: "부산", 대구광역시: "대구", 인천광역시: "인천", 광주광역시: "광주", 대전광역시: "대전", 울산광역시: "울산", 세종특별자치시: "세종", 경기도: "경기", 강원도: "강원", 강원특별자치도: "강원", 충청북도: "충북", 충청남도: "충남", 전라북도: "전북", 전북특별자치도: "전북", 전라남도: "전남", 경상북도: "경북", 경상남도: "경남", 제주특별자치도: "제주" };
  const place = (adres) => {
    const [a, b] = String(adres || "").trim().split(/\s+/);
    return { sido: SIDO[a] || (a ? a.slice(0, 2) : NA), city: b || "" };
  };

  // ---------- 기업 목록 ----------
  const all = groups.flatMap((g) => g.companies.map(([name, code, stock]) => {
    const p = profiles[code] || {};
    const fin = p.financials;
    const row = (k) => (fin && fin.rows[k]) || [];
    const [kind, sub] = segs[code] || [NA, NA];
    const at = attrs[code] || {};
    const loc = place(p.adres);
    return {
      name, code, listed: !!stock, kind, sub,
      size: at.size || NA, trade: at.trade || NA, semi: at.semiShare ?? null,
      accMt: p.acc_mt ? `${Number(p.acc_mt)}월` : NA, sido: loc.sido, city: loc.city,
      emp: p.employees && p.employees.count != null ? p.employees.count : null,
      std: p.standard || "별도",
      years: fin ? fin.years : [], sales: row("매출액"), op: row("영업이익"), net: row("당기순이익"),
    };
  }));
  const withData = all.filter((c) => c.years.length && c.sales.some((v) => v != null));

  // ---------- 필터 ----------
  const FILTERS = [
    { key: "listed", label: "상장 여부", get: (c) => (c.listed ? "상장" : "비상장") },
    { key: "kind", label: "소재·부품·장비", get: (c) => c.kind },
    { key: "sub", label: "세부업종", get: (c) => c.sub },
    { key: "size", label: "기업규모", get: (c) => c.size },
    { key: "trade", label: "거래 관계", get: (c) => c.trade },
    { key: "sido", label: "지역(시·도)", get: (c) => c.sido },
    { key: "accMt", label: "결산월", get: (c) => c.accMt },
  ];
  const state = {};
  FILTERS.forEach((f) => (state[f.key] = "all"));
  const ORDER = { 상장: 0, 비상장: 1, 소재: 0, 부품: 1, 장비: 2, 수요: 3, 대기업: 0, 중견: 1, 중소: 2 };
  const sortOpt = (a, b) => (a === NA) - (b === NA) || (ORDER[a] ?? 9) - (ORDER[b] ?? 9) || a.localeCompare(b, "ko");

  function drawFilters() {
    $("filters").innerHTML = FILTERS.map((f) => {
      const pool = all.filter((c) => FILTERS.every((g) => g.key === f.key || state[g.key] === "all" || g.get(c) === state[g.key]));
      const opts = [...new Set(pool.map(f.get))].sort(sortOpt);
      const none = opts.length === 1 && opts[0] === NA;
      return `<div class="field"><label for="f-${f.key}">${f.label}</label>`
        + `<select class="krds-select" id="f-${f.key}" data-key="${f.key}"${none ? " disabled" : ""}><option value="all">전체</option>`
        + opts.map((o) => `<option value="${esc(o)}"${state[f.key] === o ? " selected" : ""}>${esc(o)}${o === NA && none ? " (입력 전)" : ""}</option>`).join("")
        + "</select></div>";
    }).join("");
  }
  $("filters").addEventListener("change", (e) => {
    const k = e.target.dataset.key;
    if (!k) return;
    state[k] = e.target.value;
    update();
  });
  $("reset").addEventListener("click", () => { FILTERS.forEach((f) => (state[f.key] = "all")); update(); });

  // ---------- 집계 ----------
  const sum = (arr) => arr.reduce((s, v) => s + (v ?? 0), 0);
  function panel(list) {
    // 가장 많은 기업이 가진 최신 연도를 끝으로 최대 3개 연도를 잡고, 그 연도 매출이 모두 있는 기업만 쓴다.
    const lastCount = {};
    list.forEach((c) => { const y = c.years[c.years.length - 1]; lastCount[y] = (lastCount[y] || 0) + 1; });
    const end = Number(Object.keys(lastCount).sort((a, b) => lastCount[b] - lastCount[a] || b - a)[0]);
    if (!end) return { years: [], rows: [] };
    const years = [end - 2, end - 1, end];
    const rows = list.filter((c) => years.every((y) => c.sales[c.years.indexOf(y)] != null)).map((c) => {
      const at = (arr, y) => { const i = c.years.indexOf(y); return i < 0 ? null : arr[i]; };
      return { ...c, s: years.map((y) => at(c.sales, y)), o: years.map((y) => at(c.op, y)) };
    });
    return { years, rows };
  }
  function agg(rows) {
    const s = [0, 1, 2].map((i) => sum(rows.map((r) => r.s[i])));
    const o = [0, 1, 2].map((i) => sum(rows.map((r) => r.o[i])));
    return { n: rows.length, s, o, m: s.map((v, i) => (v ? (o[i] / v) * 100 : null)), g: growth(s[2], s[1]), g2: growth(s[1], s[0]), og: growth(o[2], o[1]) };
  }
  const by = (rows, fn) => rows.reduce((m, r) => { (m[fn(r)] ||= []).push(r); return m; }, {});

  // ---------- 그래프 ----------
  const W = 480;
  const svg = (h, inner, label) => `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;

  function trendChart(a, years) {
    const H = 250, L = 52, R = 44, T = 22, B = 34, pw = W - L - R, ph = H - T - B;
    const max = Math.max(...a.s, 1);
    const mv = a.m.filter((v) => v != null), mmax = Math.max(...mv, 1), mmin = Math.min(0, ...mv);
    const bw = pw / years.length;
    let g = "";
    for (let i = 0; i <= 3; i++) {
      const y = T + ph - (ph * i) / 3;
      g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="grid"/><text x="${L - 6}" y="${y + 4}" class="ax" text-anchor="end">${num(Math.round((max * i) / 3))}</text>`;
    }
    const pts = [];
    years.forEach((yr, i) => {
      const x = L + bw * i + bw / 2, h = (a.s[i] / max) * ph, w = Math.min(54, bw * 0.5);
      g += `<rect x="${x - w / 2}" y="${T + ph - h}" width="${w}" height="${h}" rx="3" class="bar"><title>${yr}년 매출 ${num(a.s[i])}억원, 영업이익 ${num(a.o[i])}억원</title></rect>`;
      g += `<text x="${x}" y="${T + ph + 18}" class="ax" text-anchor="middle">'${String(yr).slice(2)}</text>`;
      g += `<text x="${x}" y="${T + ph - h - 6}" class="val" text-anchor="middle">${num(Math.round(a.s[i]))}</text>`;
      if (a.m[i] != null) pts.push([x, T + ph - ((a.m[i] - mmin) / (mmax - mmin || 1)) * ph * 0.9, a.m[i]]);
    });
    g += `<polyline class="line" points="${pts.map((p) => p.slice(0, 2).join(",")).join(" ")}"/>`;
    pts.forEach((p) => { g += `<circle cx="${p[0]}" cy="${p[1]}" r="4" class="dot"/><text x="${p[0]}" y="${p[1] - 9}" class="val m" text-anchor="middle">${rate(p[2])}</text>`; });
    return svg(H, g, `연도별 합산 매출과 영업이익률: ${years.map((y, i) => `${y}년 ${num(Math.round(a.s[i]))}억원 ${rate(a.m[i])}`).join(", ")}`);
  }

  // 가로 막대: 0을 기준으로 양수는 오른쪽, 음수는 왼쪽
  function hbars(items, { unit = "%", label }) {
    if (!items.length) return '<p class="an-empty">비교할 자료가 없습니다.</p>';
    const rowH = 34, T = 8, L = 96, R = 70, H = T * 2 + rowH * items.length;
    const vals = items.map((i) => i.v ?? 0);
    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1;
    const x0 = L + ((0 - lo) / span) * (W - L - R);
    let g = `<line x1="${x0}" x2="${x0}" y1="${T}" y2="${H - T}" class="zero"/>`;
    items.forEach((it, i) => {
      const y = T + i * rowH, w = (Math.abs(it.v ?? 0) / span) * (W - L - R), x = (it.v ?? 0) >= 0 ? x0 : x0 - w;
      g += `<text x="${L - 8}" y="${y + rowH / 2 + 4}" class="ax" text-anchor="end">${esc(it.label)}</text>`;
      g += `<rect x="${x}" y="${y + 6}" width="${Math.max(w, 1)}" height="${rowH - 12}" rx="3" class="bar c${it.c ?? 0}"><title>${esc(it.label)} ${it.v == null ? "-" : it.v.toFixed(1) + unit}${it.note ? " · " + esc(it.note) : ""}</title></rect>`;
      const right = (it.v ?? 0) >= 0;
      g += `<text x="${right ? x + w + 6 : x - 6}" y="${y + rowH / 2 + 4}" class="val" text-anchor="${right ? "start" : "end"}">${it.v == null ? "-" : (unit === "%" && it.signed ? pct1(it.v) : rate(it.v))}</text>`;
    });
    return svg(H, g, label);
  }

  function scatter(rows) {
    const H = 280, L = 44, R = 14, T = 14, B = 36, pw = W - L - R, ph = H - T - B;
    const clampX = (v) => Math.max(-40, Math.min(80, v)), clampY = (v) => Math.max(-20, Math.min(40, v));
    const sx = (v) => L + ((clampX(v) + 40) / 120) * pw, sy = (v) => T + ph - ((clampY(v) + 20) / 60) * ph;
    let g = "";
    [-20, 0, 20, 40].forEach((v) => { g += `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" class="${v === 0 ? "zero" : "grid"}"/><text x="${L - 6}" y="${sy(v) + 4}" class="ax" text-anchor="end">${v}%</text>`; });
    [-40, 0, 40, 80].forEach((v) => { g += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${T}" y2="${T + ph}" class="${v === 0 ? "zero" : "grid"}"/><text x="${sx(v)}" y="${T + ph + 18}" class="ax" text-anchor="middle">${v}%</text>`; });
    rows.forEach((r) => {
      const gr = growth(r.s[2], r.s[1]), mg = r.s[2] ? (r.o[2] / r.s[2]) * 100 : null;
      if (gr == null || mg == null) return;
      g += `<circle cx="${sx(gr)}" cy="${sy(mg)}" r="5.5" class="pt c${KIND_C[r.kind] ?? 4}${r.listed ? "" : " open"}"><title>${esc(r.name)} · 성장률 ${pct1(gr)}, 영업이익률 ${rate(mg)}</title></circle>`;
    });
    return svg(H, g, "기업별 매출 성장률과 영업이익률 분포");
  }
  const KIND_C = { 소재: 0, 부품: 1, 장비: 2, 수요: 3 };

  // ---------- 분석 문장 ----------
  function insights(list, p, a) {
    const out = [];
    const y = p.years[2], yp = p.years[1];
    out.push(`분석 대상 ${p.rows.length}곳(재무가 ${p.years.join("·")}년 모두 있는 기업)의 '${String(y).slice(2)}년 합산 매출은 <strong>${num(Math.round(a.s[2]))}억원</strong>으로 전년 대비 <strong>${pct1(a.g)}</strong>, 영업이익은 ${num(Math.round(a.o[2]))}억원(${pct1(a.og)})입니다.`);
    const dm = a.m[2] != null && a.m[1] != null ? a.m[2] - a.m[1] : null;
    if (dm != null) out.push(`영업이익률은 ${rate(a.m[1])}에서 ${rate(a.m[2])}로 <strong>${Math.abs(dm).toFixed(1)}%p ${dm >= 0 ? "개선" : "하락"}</strong>했습니다. ${a.g > 0 && dm < 0 ? "매출은 늘었지만 이익률은 낮아져 외형 성장이 수익성으로 이어지지 못했습니다." : a.g > 0 && dm >= 0 ? "매출 증가와 수익성 개선이 함께 나타났습니다." : a.g <= 0 && dm >= 0 ? "매출은 줄었지만 수익성은 방어했습니다." : "매출과 수익성이 함께 약해졌습니다."}`);
    const sg = Object.entries(by(p.rows, (r) => r.kind)).filter(([k]) => k !== NA && k !== "수요").map(([k, rs]) => ({ k, ...agg(rs) })).filter((x) => x.g != null).sort((x, z) => z.g - x.g);
    if (sg.length >= 2) out.push(`구분별로는 <strong>${sg[0].k}</strong>(${pct1(sg[0].g)}, ${sg[0].n}곳)가 가장 빠르게 늘었고 <strong>${sg[sg.length - 1].k}</strong>(${pct1(sg[sg.length - 1].g)}, ${sg[sg.length - 1].n}곳)가 가장 더뎠습니다.`);
    const L = agg(p.rows.filter((r) => r.listed)), U = agg(p.rows.filter((r) => !r.listed));
    if (L.n && U.n) out.push(`상장사(${L.n}곳)는 매출 ${pct1(L.g)}·영업이익률 ${rate(L.m[2])}, 비상장사(${U.n}곳)는 ${pct1(U.g)}·${rate(U.m[2])}입니다. ${Math.abs(L.g - U.g) < 3 ? "성장 속도 차이는 크지 않습니다." : `성장은 ${L.g > U.g ? "상장" : "비상장"}사가 ${Math.abs(L.g - U.g).toFixed(1)}%p 앞섭니다.`}`);
    const gs = p.rows.map((r) => ({ r, g: growth(r.s[2], r.s[1]) })).filter((x) => x.g != null).sort((x, z) => z.g - x.g);
    if (gs.length >= 3) {
      const grew = gs.filter((x) => x.g > 0).length, loss = p.rows.filter((r) => r.o[2] < 0).length;
      out.push(`매출이 늘어난 기업은 ${gs.length}곳 중 <strong>${grew}곳</strong>이며 성장률 상위는 ${gs.slice(0, 3).map((x) => `${esc(x.r.name)}(${pct1(x.g)})`).join(", ")}입니다.${loss ? ` 영업적자 기업은 ${loss}곳입니다.` : ""}`);
    }
    const g2 = a.g2;
    if (g2 != null && a.g != null) out.push(`'${String(yp).slice(2)}년 ${pct1(g2)} → '${String(y).slice(2)}년 ${pct1(a.g)}로 성장세가 ${a.g > g2 ? "가속" : "둔화"}됐습니다.`);
    return out;
  }

  // ---------- 표 ----------
  const COLS = [
    { k: "name", t: "기업", text: 1 }, { k: "kind", t: "구분", text: 1 }, { k: "sub", t: "세부업종", text: 1 }, { k: "listed", t: "상장", text: 1 },
    { k: "sales", t: "매출액" }, { k: "g", t: "매출 성장률" }, { k: "m", t: "영업이익률" }, { k: "og", t: "영업이익 증감" }, { k: "emp", t: "종업원" }, { k: "sido", t: "지역", text: 1 },
  ];
  let sortKey = "g", sortDir = -1, showAll = false;
  $("rank-head").innerHTML = COLS.map((c) => `<th scope="col"${c.text ? ' class="text"' : ""} aria-sort="none"><button type="button" class="sort" data-sort="${c.k}">${c.t}<span class="arrow" aria-hidden="true"></span></button></th>`).join("");
  $("rank-head").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sort]");
    if (!b) return;
    sortDir = sortKey === b.dataset.sort ? -sortDir : -1;
    sortKey = b.dataset.sort;
    drawRank();
  });
  let rankRows = [];
  $("more").addEventListener("click", () => { showAll = !showAll; drawRank(); });
  function drawRank() {
    const rows = rankRows.map((r) => ({ ...r, sales: r.s[2], g: growth(r.s[2], r.s[1]), m: r.s[2] ? (r.o[2] / r.s[2]) * 100 : null, og: r.o[1] > 0 ? growth(r.o[2], r.o[1]) : null }));
    rows.sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      if (x == null || x === NA) return 1;
      if (y == null || y === NA) return -1;
      return (typeof x === "string" ? x.localeCompare(y, "ko") : x - y) * sortDir;
    });
    document.querySelectorAll("#rank-head th").forEach((th) => th.setAttribute("aria-sort", th.querySelector("[data-sort]").dataset.sort === sortKey ? (sortDir > 0 ? "ascending" : "descending") : "none"));
    const total = rows.length;
    if (!showAll) rows.length = Math.min(rows.length, 20);
    const cls = (v) => (v == null ? "" : v > 0 ? ' class="up"' : v < 0 ? ' class="down"' : "");
    $("rank").querySelector("tbody")?.remove();
    $("rank").insertAdjacentHTML("beforeend", "<tbody>" + rows.map((r) => `<tr><th scope="row" class="text"><a href="profile.html#${r.code}">${esc(r.name)}</a></th>`
      + `<td class="text">${esc(r.kind)}</td><td class="text">${esc(r.sub)}</td><td class="text">${r.listed ? "상장" : "비상장"}</td>`
      + `<td>${num(r.sales)}</td><td${cls(r.g)}>${pct1(r.g)}</td><td>${rate(r.m)}</td><td${cls(r.og)}>${pct1(r.og)}</td>`
      + `<td>${r.emp == null ? "-" : num(r.emp)}</td><td class="text">${esc(r.sido)}${r.city ? " " + esc(r.city) : ""}</td></tr>`).join("") + "</tbody>");
    const more = $("more");
    more.hidden = total <= 20;
    more.textContent = showAll ? "상위 20곳만 보기" : `전체 ${total}곳 보기`;
  }

  // ---------- 그리기 ----------
  function kpi(label, value, sub, tone) {
    return `<div class="an-kpi"><p class="an-kpi-label">${label}</p><p class="an-kpi-val">${value}</p><p class="an-kpi-sub${tone ? " " + tone : ""}">${sub}</p></div>`;
  }
  function update() {
    drawFilters();
    const list = withData.filter((c) => FILTERS.every((f) => state[f.key] === "all" || f.get(c) === state[f.key]));
    const p = panel(list), a = agg(p.rows);
    $("count").innerHTML = `선택 <strong>${list.length}</strong>곳 중 분석 포함 <strong>${p.rows.length}</strong>곳${list.length - p.rows.length ? ` (재무 3개년 미비 ${list.length - p.rows.length}곳 제외)` : ""}`;
    rankRows = p.rows;
    if (!p.rows.length) {
      ["kpis", "insights", "c-trend", "c-seg", "c-list", "c-sc"].forEach((id) => ($(id).innerHTML = ""));
      $("insights").innerHTML = "<li>조건에 맞는 기업이 없습니다. 필터를 줄여 보세요.</li>";
      $("rank").querySelector("tbody")?.remove();
      return;
    }
    const y = p.years[2];
    const tone = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
    $("kpis").innerHTML = kpi(`'${String(y).slice(2)}년 합산 매출`, `${num(Math.round(a.s[2]))}<small>억원</small>`, `전년 대비 ${pct1(a.g)}`, tone(a.g))
      + kpi("합산 영업이익", `${num(Math.round(a.o[2]))}<small>억원</small>`, `전년 대비 ${pct1(a.og)}`, tone(a.og))
      + kpi("영업이익률", rate(a.m[2]), `전년 ${rate(a.m[1])} · ${a.m[2] - a.m[1] >= 0 ? "+" : ""}${(a.m[2] - a.m[1]).toFixed(1)}%p`, tone(a.m[2] - a.m[1]))
      + kpi("매출 증가 기업", `${p.rows.filter((r) => r.s[2] > r.s[1]).length}<small>/ ${p.rows.length}곳</small>`, `${p.years[0]}→${y}년 연평균 ${pct1((Math.pow(a.s[2] / a.s[0], 1 / 2) - 1) * 100)}`, "");
    $("insights").innerHTML = insights(list, p, a).map((t) => `<li>${t}</li>`).join("");
    $("c-trend").innerHTML = trendChart(a, p.years);

    const kinds = Object.entries(by(p.rows, (r) => r.kind)).sort(([x], [z]) => sortOpt(x, z));
    $("s-seg").textContent = `'${String(y).slice(2)}년 매출 전년 대비 증감률. 괄호는 기업 수와 영업이익률.`;
    $("c-seg").innerHTML = hbars(kinds.map(([k, rs]) => { const g = agg(rs); return { label: k, v: g.g, c: KIND_C[k] ?? 4, signed: 1, note: `${g.n}곳 · 영업이익률 ${rate(g.m[2])}` }; }), { label: "소재·부품·장비 구분별 매출 성장률" });
    const lg = [["상장", (r) => r.listed], ["비상장", (r) => !r.listed]].map(([k, f]) => ({ k, a: agg(p.rows.filter(f)) })).filter((x) => x.a.n);
    $("c-list").innerHTML = `<p class="an-mini">매출 성장률</p>` + hbars(lg.map((x) => ({ label: `${x.k} ${x.a.n}곳`, v: x.a.g, c: 5, signed: 1 })), { label: "상장·비상장 매출 성장률" })
      + `<p class="an-mini">영업이익률</p>` + hbars(lg.map((x) => ({ label: `${x.k} ${x.a.n}곳`, v: x.a.m[2], c: 6 })), { label: "상장·비상장 영업이익률" });
    $("c-sc").innerHTML = scatter(p.rows) + `<ul class="an-legend">${["소재", "부품", "장비", "수요"].filter((k) => p.rows.some((r) => r.kind === k)).map((k) => `<li><i class="sw c${KIND_C[k]}"></i>${k}</li>`).join("")}<li><i class="sw ring"></i>속이 빈 점은 비상장</li></ul>`;
    $("s-rank").textContent = `'${String(y).slice(2)}년 기준. 열 머리글을 누르면 정렬됩니다. 영업이익 증감은 전년 영업이익이 흑자인 경우만 계산합니다.`;
    drawRank();
  }

  const upd = window.COMPANY_PROFILES_UPDATED || "";
  const filled = (k) => all.filter((c) => c[k] !== NA && c[k] != null).length;
  $("lead").innerHTML = `협력 기업 <strong>${all.length}</strong>곳의 매출·영업이익 성장 추이를 상장 여부, 소재·부품·장비, 지역 등으로 나눠 비교합니다.`;
  $("meta").innerHTML = [`분석 가능 ${withData.length}곳`, `분류 ${filled("kind")}곳`, `기업규모 ${filled("size")}곳 입력`, upd ? `${esc(upd)} 갱신` : ""].filter(Boolean).map((t) => `<li>${t}</li>`).join("");
  update();
})();
