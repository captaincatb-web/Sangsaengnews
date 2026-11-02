/* Regional map: reads only existing, already-filtered SB.panel rows.
 * Independent province drill-down; does not mutate the existing 6-region filter.
 */
(() => {
  "use strict";
  const root = document.getElementById("sb-map");
  if (!root || !window.SB) return;
  const SB = window.SB;
  const U = window.SobujangMapUtils;
  if (!U) return;
  const mapEl = document.getElementById("sb-map-svg");
  const details = document.getElementById("sb-map-details");
  const metricSel = document.getElementById("sb-map-metric");
  const resetBtn = document.getElementById("sb-map-reset");
  const coverage = document.getElementById("sb-map-coverage");
  const legend = document.getElementById("sb-map-legend");
  const regionNames = U.regions;
  const metricNames = { count:"기업 수", sales:"매출 합계", growth:"매출 성장률", cap:"시가총액" };
  const fmtNum = n => Number(n || 0).toLocaleString("ko-KR");
  const esc = SB.fmt.esc;
  const money = SB.fmt.won;
  const pct = SB.fmt.sg;
  const groupOf = (r) => U.provinceOf(r.ad);
  let rows = [], fy = null, selected = "", metric = "count", svg = null, loaded = false;
  function grouped() {
    const { byProvince, unknown } = U.group(rows);
    return { groups: byProvince, missing: unknown };
  }
  const marketList = () => (window.MARKET && window.MARKET.list) || {};
  const marketAsOf = () => (window.MARKET && window.MARKET.updated) || "기준일 미확인";
  const metricValue = (list) => U.metric(list, metric, marketList());
  function valueText(v) {
    if (v==null) return "자료 없음";
    if (metric==="count") return fmtNum(v)+"곳";
    if (metric==="sales" || metric==="cap") return money(v);
    return pct(v);
  }
  const fillFor = (value, max, hasRows) => U.color(value, metric, max, hasRows);
  function redraw() {
    if (!loaded) return;
    const { groups, missing } = grouped();
    const stats = regionNames.map(n => ({name:n, rows:groups[n], v:metricValue(groups[n])}));
    const mx=Math.max(.01,...stats.map(r=>Math.abs(r.v||0)));
    svg.querySelectorAll("path[id]").forEach(p=>{
      const raw=p.id;
      const name=U.canonical(raw);
      const st=stats.find(s=>s.name===name);
      if (!st) { p.style.fill="#dfe6e2"; return; }
      p.style.fill=fillFor(st.v,mx,st.rows.length > 0);
      p.classList.toggle("is-selected",selected===name);
      p.setAttribute("role","button");
      p.setAttribute("tabindex","0");
      p.setAttribute("aria-pressed",String(selected===name));
      p.setAttribute("aria-label",name+" "+metricNames[metric]+" "+valueText(st.v));
      p.dataset.region=name;
      let title=p.querySelector("title");
      if (!title) { title=document.createElementNS("http://www.w3.org/2000/svg","title"); p.prepend(title); }
      title.textContent=name+": "+valueText(st.v);
    });
    const mapped = rows.length - missing.length;
    const caps = U.capCoverage(rows.filter(r => U.provinceOf(r.ad)), marketList());
    coverage.textContent = "주소 확인 " + fmtNum(mapped) + " / 분석 " + fmtNum(rows.length) +
      "곳 · 소재지 미확인 " + fmtNum(missing.length) + "곳" +
      (metric === "cap" ? " · 시총 확인 " + fmtNum(caps.known) + " / 상장 " + fmtNum(caps.listed) +
      "곳" + (caps.unlisted ? " · 비상장 " + fmtNum(caps.unlisted) + "곳 제외" : "") : "");
    legend.textContent = metric === "growth"
      ? "청록: 성장 · 적색: 감소 · 회색: 미집계"
      : metric === "cap"
      ? "상장사 시가총액 합계(억원) · 진할수록 큼 · 회색: 미확인/해당 없음 · 네이버증권 " + marketAsOf() + " 수집"
      : "색이 진할수록 " + metricNames[metric] + "가 큼 · 회색: 0 또는 미집계";
    const yearEl = document.getElementById("sb-map-year");
    if (yearEl) yearEl.textContent = metric === "cap"
      ? "시총 " + marketAsOf() + " 수집 · 기업 표본 " + String(fy || "-") + "년 재무"
      : String(fy || "-") + "년 재무 · 본사 소재지 기준";
    const focus = selected ? stats.find(s=>s.name===selected) : null;
    const ranked = stats.filter(s => s.rows.length && (metric !== "cap" || s.v != null))
      .sort((a,b) => (b.v ?? -Infinity) - (a.v ?? -Infinity));
    const display = focus ? focus.rows.slice().sort((a,b) =>
      metric === "cap"
        ? (U.capOf(b, marketList()) ?? -1) - (U.capOf(a, marketList()) ?? -1)
        : b.s1 - a.s1) : [];
    const metricCaption=focus ? metricNames[metric]+": "+valueText(focus.v) : "전국 현황";
    details.innerHTML =
      '<div class="sb-map-panel-title"><div><span class="sb-map-eyebrow">'+(selected?"선택 지역":"지역 순위")+'</span><h3>'+esc(selected||"전국 17개 시·도")+'</h3></div><strong>'+esc(metricCaption)+'</strong></div>'
      +(focus ?
        '<div class="sb-map-subinfo">해당 지역 분석 기업 ' + fmtNum(display.length) +
          '곳 · 본사 소재지 기준' +
          (metric === "cap" ? ' · 시총 확인 ' + fmtNum(U.capCoverage(display, marketList()).known) + '곳(상장사만 합산)' : '') +
          '</div>'+
        (display.length ? '<div class="sb-map-company-list">'+display.slice(0,10).map(r =>
          '<a href="#company" data-co="' + esc(r.c) + '"><span><b>' + esc(r.n) +
          '</b><small>' + esc(r.kind) + (metric === "cap" && !r.l ? ' · 비상장' : '') +
          '</small></span><span>' + (metric === "cap" ? (U.capOf(r, marketList()) == null ? '시총 미확인' : money(U.capOf(r, marketList()))) : money(r.s1)) +
          '</span></a>').join("")+'</div>'+
          (display.length>10?'<p class="sb-map-fine">' + (metric === "cap" ? "시총 확인 기업 우선 상위 10곳만 표시" : "매출 상위 10곳만 표시") + '</p>':'') :
          '<p class="sb-map-no-data">이 지역은 현재 필터 조건에서 분석 가능한 기업이 없습니다.</p>')
        :
        '<div class="sb-map-ranks">'+ranked.slice(0,10).map((s,i)=>
          '<button type="button" data-sb-region="'+esc(s.name)+'"><span><em>'+String(i+1).padStart(2,"0")+'</em> '+esc(s.name)+'</span><strong>'+valueText(s.v)+'</strong></button>'
        ).join("")+'</div>'+(ranked.length===0?'<p class="sb-map-no-data">현재 조건에서 집계할 기업이 없습니다.</p>':'')
      );
    resetBtn.disabled=!selected;
  }
  function pick(name) { selected=selected===name?"":name; redraw(); }
  metricSel.addEventListener("change",()=>{
    metric=metricSel.value; redraw();
  });
  resetBtn.addEventListener("click",()=>{selected="";redraw();});
  root.addEventListener("click",e=>{
    const btn=e.target.closest("[data-sb-region]");
    if (btn) { pick(btn.dataset.sbRegion); return; }
    const path=e.target.closest("path[data-region]");
    if (path) pick(path.dataset.region);
  });
  root.addEventListener("keydown",e=>{
    const path=e.target.closest && e.target.closest("path[data-region]");
    if (!path) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(path.dataset.region); return; }
    const directions = {ArrowRight:1, ArrowDown:1, ArrowLeft:-1, ArrowUp:-1};
    if (Object.prototype.hasOwnProperty.call(directions, e.key)) {
      e.preventDefault();
      const paths=[...svg.querySelectorAll("path[data-region]")];
      const idx=paths.indexOf(path);
      const next=paths[(idx+directions[e.key]+paths.length)%paths.length];
      if (next) next.focus();
    }
  });
  fetch("data/geo/korea-sido.svg").then(r=>{
    if(!r.ok) throw new Error("HTTP "+r.status);
    return r.text();
  }).then(t=>{
    const doc = new DOMParser().parseFromString(t, "image/svg+xml");
    const original = doc.documentElement;
    const paths = [...original.querySelectorAll("path[id]")];
    const mapped = paths.map(p => U.canonical(p.id));
    if (original.localName !== "svg" || paths.length !== 17 ||
        mapped.some(n => !n) || new Set(mapped).size !== 17 ||
        paths.some(p => !p.getAttribute("d"))) {
      throw new Error("17개 시·도 경계 검증 실패");
    }
    // Import only a viewBox and geometry paths. Never inject upstream XML into the DOM.
    const ns = "http://www.w3.org/2000/svg";
    svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", original.getAttribute("viewBox") || "0 0 800 759");
    const g = document.createElementNS(ns, "g");
    paths.forEach(p => {
      const copy = document.createElementNS(ns, "path");
      copy.setAttribute("id", p.id);
      copy.setAttribute("d", p.getAttribute("d"));
      if (p.hasAttribute("fill-rule")) copy.setAttribute("fill-rule", p.getAttribute("fill-rule"));
      g.appendChild(copy);
    });
    svg.appendChild(g);
    svg.classList.add("sb-map-shape");
    svg.setAttribute("aria-label", "대한민국 시·도별 기업 분포");
    svg.setAttribute("role", "group");
    mapEl.replaceChildren(svg); loaded=true; redraw();
  }).catch(err=>{mapEl.textContent="지도를 불러오지 못했습니다: "+err.message;mapEl.classList.add("sb-map-error");});
  window.SobujangMap={
    render(nextRows,year) {
      rows=Array.isArray(nextRows)?nextRows:[];
      fy=year;
      redraw();
    },
    regionOf:groupOf
  };
})();