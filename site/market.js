/* 시장·밸류에이션 화면: 상장 협력사의 주가 지표(네이버증권, data/market.js)를 대시보드 필터와 함께 본다.
   dashboard.js 가 window.DB.rows() 로 현재 필터의 기업 목록을 넘겨 주고, 이 파일은 그 화면(#v-market)만 그린다. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const M = (window.MARKET && window.MARKET.list) || {};
  const nf = (v, d = 0) => (v == null || !isFinite(v) ? "-" : v.toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const won = (v) => (v == null ? "-" : Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(1)}조` : `${nf(v)}억`);
  const med = (a) => { const x = a.filter((v) => v != null && isFinite(v)).sort((p, q) => p - q); if (!x.length) return null; const m = x.length >> 1; return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2; };
  const state = { kind: "all", per: "", pbr: "", roe: "", sort: "cap", sel: null };

  // 색 점 기준(양호·보통·주의·나쁨). 값이 없으면 '-'. PER 은 적자(음수)면 의미가 없어 보통 대신 회색으로 둔다
  const LEVELS = ["g", "m", "w", "b"], LABEL = { g: "양호", m: "보통", w: "주의", b: "나쁨", n: "해당 없음" };
  const levelLow = (v, cut) => (v == null ? null : v < cut[0] ? "g" : v < cut[1] ? "m" : v < cut[2] ? "w" : "b"); // 낮을수록 좋은 지표
  const perLv = (v) => (v == null ? null : v <= 0 ? "n" : levelLow(v, [15, 30, 50]));
  const pbrLv = (v) => (v == null ? null : v <= 0 ? "n" : levelLow(v, [1, 3, 5]));
  const roeLv = (v) => (v == null ? null : v >= 10 ? "g" : v >= 5 ? "m" : v >= 0 ? "w" : "b");
  const dot = (lv, text) => (text === "-" || !lv ? "-" : `<i class="mk-dot ${lv}" title="${LABEL[lv]}"></i>${text}`);

  // 최근 확정 연도의 ROE(네이버 표에서). 추정치(E)가 아닌 마지막 열
  const lastActual = (fa, key) => { if (!fa || !fa[key]) return null; for (let i = fa[key].length - 1; i >= 0; i--) if (!fa.est[i] && fa[key][i] != null) return fa[key][i]; return null; };
  const upside = (m) => (m.target > 0 && m.price > 0 ? (m.target / m.price - 1) * 100 : null);

  function join() {
    const rows = (window.DB && window.DB.rows()) || [];
    return rows.filter((r) => r.l && M[r.c]).map((r) => {
      const m = M[r.c];
      return { r, m, per: m.per, pbr: m.pbr, roe: lastActual(m.fa, "roe"), up: upside(m) };
    });
  }

  function draw() {
    const root = $("c-market");
    if (!root) return;
    if (!Object.keys(M).length) {
      root.innerHTML = `<section class="db-card"><p class="db-note warn"><i class="ph ph-warning" aria-hidden="true"></i><span>시장 정보를 아직 받지 못했습니다. 매일 아침 자동으로 다시 수집합니다.</span></p></section>`;
      return;
    }
    const base = join();
    const f = base.filter((x) => (state.kind === "all" || x.r.kind === state.kind)
      && (state.per === "" || (x.per > 0 && x.per <= +state.per))
      && (state.pbr === "" || (x.pbr > 0 && x.pbr <= +state.pbr))
      && (state.roe === "" || (x.roe != null && x.roe >= +state.roe)));
    const key = { cap: (x) => -(x.m.cap || 0), per: (x) => (x.per > 0 ? x.per : 1e9), up: (x) => -(x.up ?? -1e9), pbr: (x) => (x.pbr > 0 ? x.pbr : 1e9) }[state.sort];
    f.sort((a, b) => key(a) - key(b));
    if (!f.some((x) => x.r.c === state.sel)) state.sel = f.length ? f[0].r.c : null;

    const perOk = base.map((x) => x.per).filter((v) => v > 0), pbrOk = base.map((x) => x.pbr).filter((v) => v > 0);
    const kpi = (icon, lab, val, sub) => `<article class="db-kpi"><p class="lab"><i class="ph ${icon}" aria-hidden="true"></i>${lab}</p><strong>${val}</strong><p class="delta"><span class="vs">${sub}</span></p></article>`;
    const mu = med(base.map((x) => x.up));
    const kinds = ["소재", "부품", "장비"];
    const opt = (v, t, cur) => `<option value="${v}"${String(cur) === String(v) ? " selected" : ""}>${t}</option>`;
    const inp = (id, lab, v, ph) => `<label class="mk-in"><span>${lab}</span><input id="${id}" inputmode="decimal" value="${esc(v)}" placeholder="${ph}"></label>`;
    const on = [state.kind !== "all" && state.kind, state.per !== "" && `PER ≤ ${state.per}`, state.pbr !== "" && `PBR ≤ ${state.pbr}`, state.roe !== "" && `ROE ≥ ${state.roe}%`].filter(Boolean);

    root.innerHTML = `
      <section class="db-kpis">
        ${kpi("ph-buildings", "상장사 (지표 있음)", `${base.length}곳`, "현재 필터 기준")}
        ${kpi("ph-percent", "PER 중앙값", perOk.length ? `${nf(med(perOk), 1)}배` : "-", `적자 ${base.length - perOk.length}곳 제외`)}
        ${kpi("ph-scales", "PBR 중앙값", pbrOk.length ? `${nf(med(pbrOk), 2)}배` : "-", `1배 미만 ${pbrOk.filter((v) => v < 1).length}곳`)}
        ${kpi("ph-target", "목표주가 여력", mu == null ? "-" : `${mu > 0 ? "+" : ""}${nf(mu, 0)}%`, "증권사 평균 목표가 대비 중앙값")}
      </section>
      <section class="db-card">
        <div class="db-card-head"><h2>조건으로 찾기</h2><span class="db-mini">${on.length ? on.join(" · ") + " → " : ""}${f.length}곳</span></div>
        <div class="mk-filters">
          <label class="mk-in"><span>구분</span><select id="mk-kind">${opt("all", "전체", state.kind)}${kinds.map((k) => opt(k, k, state.kind)).join("")}</select></label>
          ${inp("mk-per", "PER 최대", state.per, "예 30")}${inp("mk-pbr", "PBR 최대", state.pbr, "예 3")}${inp("mk-roe", "ROE 최소(%)", state.roe, "예 5")}
          <label class="mk-in"><span>정렬</span><select id="mk-sort">${opt("cap", "시가총액 큰 순", state.sort)}${opt("per", "PER 낮은 순", state.sort)}${opt("pbr", "PBR 낮은 순", state.sort)}${opt("up", "목표주가 여력 큰 순", state.sort)}</select></label>
          ${on.length ? `<button class="db-btn ghost" type="button" id="mk-reset">초기화</button>` : ""}
        </div>
      </section>
      <div class="mk-grid">
        <section class="db-card"><div class="db-card-head"><h2>종목 표 <small>행을 누르면 오른쪽에 상세</small></h2></div>
          <div class="db-tbl-wrap">${f.length ? table(f) : `<p class="db-note"><i class="ph ph-info" aria-hidden="true"></i><span>조건에 맞는 기업이 없습니다. 조건을 풀어 보세요.</span></p>`}</div>
          <ul class="mk-legend"><li><i class="mk-dot g"></i>양호</li><li><i class="mk-dot m"></i>보통</li><li><i class="mk-dot w"></i>주의</li><li><i class="mk-dot b"></i>나쁨</li>
            <li class="rule">PER 15·30·50 / PBR 1·3·5 / ROE 10·5·0% 기준 · 적자(PER 없음)는 점을 찍지 않습니다</li></ul>
        </section>
        <div id="mk-detail">${detail(f.find((x) => x.r.c === state.sel))}</div>
      </div>
      <p class="db-note"><i class="ph ph-info" aria-hidden="true"></i><span>주가 지표와 증권사 추정치는 네이버증권에서 가져옵니다(${esc((window.MARKET || {}).updated || "")} 기준). 실적 확정치는 위의 다른 화면과 같이 DART 공시입니다.</span></p>`;
    bind(root);
  }

  function table(f) {
    return `<table class="db-tbl mk-tbl"><thead><tr><th>기업</th><th>구분</th><th>시총</th><th>PER</th><th>PBR</th><th>ROE</th><th>여력</th></tr></thead><tbody>${f.map((x) => {
      const u = x.up;
      return `<tr data-mk="${esc(x.r.c)}" class="${x.r.c === state.sel ? "sel" : ""}" tabindex="0"><th scope="row">${esc(x.r.n)}</th><td>${esc(x.r.kind)}</td><td>${won(x.m.cap)}</td>
        <td>${dot(perLv(x.per), x.per > 0 ? nf(x.per, 1) : "-")}</td><td>${dot(pbrLv(x.pbr), x.pbr > 0 ? nf(x.pbr, 2) : "-")}</td><td>${dot(roeLv(x.roe), x.roe == null ? "-" : nf(x.roe, 1) + "%")}</td>
        <td class="${u == null ? "" : u >= 0 ? "up" : "dn"}">${u == null ? "-" : (u > 0 ? "+" : "") + nf(u, 0) + "%"}</td></tr>`;
    }).join("")}</tbody></table>`;
  }

  function detail(x) {
    if (!x) return "";
    const { r, m } = x, fa = m.fa;
    const pos = m.hi52 > m.lo52 && m.price ? Math.max(0, Math.min(100, ((m.price - m.lo52) / (m.hi52 - m.lo52)) * 100)) : null;
    const cell = (l, v) => `<div><span>${l}</span><b>${v}</b></div>`;
    return `<section class="db-card mk-det"><div class="db-card-head"><h2>${esc(r.n)} <small>${esc(r.kind)} · ${esc(m.sc)}</small></h2><a class="db-link" href="#company" data-co="${esc(r.c)}">기업 상세 <i class="ph ph-arrow-right" aria-hidden="true"></i></a></div>
      <div class="mk-cells">${cell("현재가", m.price ? nf(m.price) + "원" : "-")}${cell("시가총액", won(m.cap))}${cell("목표주가", m.target ? nf(m.target) + "원" : "-")}${cell("외국인 비율", m.fr != null ? nf(m.fr, 1) + "%" : "-")}
        ${cell("PER", m.per > 0 ? nf(m.per, 1) + "배" : "-")}${cell("PBR", m.pbr > 0 ? nf(m.pbr, 2) + "배" : "-")}${cell("배당수익률", m.dy != null ? nf(m.dy, 2) + "%" : "-")}${cell("투자의견", m.rec != null ? nf(m.rec, 1) + " / 5" : "-")}</div>
      ${pos == null ? "" : `<p class="mk-52"><span>52주 최저 ${nf(m.lo52)}</span><span>최고 ${nf(m.hi52)}</span></p><div class="mk-bar" role="img" aria-label="52주 범위에서 현재가 위치 ${Math.round(pos)}%"><i style="width:${pos}%"></i><b style="left:${pos}%"></b></div>`}
    </section>
    <section class="db-card"><div class="db-card-head"><h2>연간 실적과 증권사 추정</h2><span class="db-mini">점선 막대 = 추정</span></div>${fa ? annual(fa) : `<p class="db-note"><i class="ph ph-info" aria-hidden="true"></i><span>연간 실적 표를 받지 못했습니다.</span></p>`}</section>`;
  }

  // 매출 막대 + 영업이익률 선. 추정 연도는 점선 막대·빈 점
  function annual(fa) {
    const n = fa.p.length, s = fa.s || [], o = fa.o || [], W = 320, H = 150, L = 6, B = 24, T = 14, cw = (W - L * 2) / n;
    const vmax = Math.max(...s.filter((v) => v != null), 1), y = (v) => H - B - ((H - B - T) * v) / vmax;
    const mg = s.map((v, i) => (v > 0 && o[i] != null ? (o[i] / v) * 100 : null)), mmax = Math.max(...mg.filter((v) => v != null), 1), mmin = Math.min(...mg.filter((v) => v != null), 0);
    const my = (v) => H - B - ((H - B - T) * (v - mmin)) / (mmax - mmin || 1);
    const bars = s.map((v, i) => (v == null ? "" : `<rect x="${L + i * cw + cw * 0.22}" y="${y(v)}" width="${cw * 0.56}" height="${H - B - y(v)}" rx="3" ${fa.est[i] ? `fill="none" stroke="var(--blue)" stroke-width="1.5" stroke-dasharray="4 3"` : `fill="var(--blue)"`}><title>${fa.p[i]} 매출 ${won(v)}</title></rect>`)).join("");
    const pts = mg.map((v, i) => (v == null ? null : [L + i * cw + cw / 2, my(v), v, i]));
    const line = pts.filter(Boolean).map((p) => p.slice(0, 2).join(",")).join(" ");
    const dots = pts.filter(Boolean).map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3" ${fa.est[p[3]] ? `fill="var(--card)" stroke="var(--orange)" stroke-width="1.5"` : `fill="var(--orange)"`}><title>${fa.p[p[3]]} 영업이익률 ${nf(p[2], 1)}%</title></circle>`).join("");
    const lab = fa.p.map((p, i) => `<text x="${L + i * cw + cw / 2}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--text-3)">${p.slice(0, 4)}${fa.est[i] ? "E" : ""}</text>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="연간 매출(막대)과 영업이익률(선)">${bars}${line ? `<polyline points="${line}" fill="none" stroke="var(--orange)" stroke-width="2"/>` : ""}${dots}${lab}</svg>
      <ul class="db-legend"><li><i class="sq" style="background:var(--blue)"></i>매출</li><li><i class="sq" style="background:var(--orange)"></i>영업이익률</li></ul>`;
  }

  function bind(root) {
    const set = (id, k) => { const el = $(id); if (el) el.addEventListener("change", () => { state[k] = el.value.trim(); draw(); }); };
    set("mk-kind", "kind"); set("mk-per", "per"); set("mk-pbr", "pbr"); set("mk-roe", "roe"); set("mk-sort", "sort");
    const rs = $("mk-reset");
    if (rs) rs.addEventListener("click", () => { Object.assign(state, { kind: "all", per: "", pbr: "", roe: "" }); draw(); });
    const pick = (tr) => { state.sel = tr.dataset.mk; draw(); };
    root.querySelectorAll("tr[data-mk]").forEach((tr) => {
      tr.addEventListener("click", () => pick(tr));
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(tr); } });
    });
  }

  window.MarketView = { draw };
})();
