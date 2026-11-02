/* Regional map: reads only existing, already-filtered SB.panel rows.
 * Independent province drill-down; does not mutate the existing 6-region filter.
 */
(() => {
  "use strict";
  const root = document.getElementById("sb-map");
  if (!root || !window.SB) return;
  const SB = window.SB;
  const mapEl = document.getElementById("sb-map-svg");
  const details = document.getElementById("sb-map-details");
  const metricSel = document.getElementById("sb-map-metric");
  const resetBtn = document.getElementById("sb-map-reset");
  const coverage = document.getElementById("sb-map-coverage");
  const legend = document.getElementById("sb-map-legend");
  const regionNames = [
    "서울특별시","부산광역시","대구광역시","인천광역시","광주광역시",
    "대전광역시","울산광역시","세종특별자치시","경기도","강원특별자치도",
    "충청북도","충청남도","전북특별자치도","전라남도","경상북도","경상남도",
    "제주특별자치도"
  ];
  const short = {
    "서울특별시":"서울","부산광역시":"부산","대구광역시":"대구",
    "인천광역시":"인천","광주광역시":"광주","대전광역시":"대전",
    "울산광역시":"울산","세종특별자치시":"세종","경기도":"경기",
    "강원특별자치도":"강원","충청북도":"충북","충청남도":"충남",
    "전북특별자치도":"전북","전라남도":"전남","경상북도":"경북",
    "경상남도":"경남","제주특별자치도":"제주"
  };
  const alias = {
    "서울":"서울특별시","부산":"부산광역시","대구":"대구광역시",
    "인천":"인천광역시","광주":"광주광역시","대전":"대전광역시",
    "울산":"울산광역시","세종":"세종특별자치시",
    "강원도":"강원특별자치도","강원특별자치도":"강원특별자치도",
    "전라북도":"전북특별자치도","전북특별자치도":"전북특별자치도",
    "제주도":"제주특별자치도","제주특별자치도":"제주특별자치도",
    "경기도":"경기도","충청북도":"충청북도","충청남도":"충청남도",
    "전라남도":"전라남도","경상북도":"경상북도","경상남도":"경상남도",
    "서울특별시":"서울특별시","부산광역시":"부산광역시",
    "대구광역시":"대구광역시","인천광역시":"인천광역시",
    "광주광역시":"광주광역시","대전광역시":"대전광역시",
    "울산광역시":"울산광역시","세종특별자치시":"세종특별자치시"
  };
  const metricNames = { count:"기업 수", sales:"매출 합계", growth:"매출 성장률" };
  const fmtNum = n => Number(n || 0).toLocaleString("ko-KR");
  const esc = SB.fmt.esc;
  const money = SB.fmt.won;
  const pct = SB.fmt.sg;
  const groupOf = (r) => {
    // Only DART headquarters address is considered. Do not infer it from a 6-region bucket.
    const ad = String(r.ad || "").trim().replace(/^\(?\d{5}\)?\s*/, "");
    const p = ad.split(/\s+/)[0];
    return alias[p] || null;
  };
  let rows = [], fy = null, selected = "", metric = "count", svg = null, loaded = false;
  function grouped() {
    const groups = Object.fromEntries(regionNames.map(n => [n, []]));
    const missing = [];
    rows.forEach(r => {
      const p = groupOf(r);
      if (p && groups[p]) groups[p].push(r);
      else missing.push(r);
    });
    return { groups, missing };
  }
  function metricValue(rs) {
    if (metric === "count") return rs.length;
    if (metric === "sales") return rs.reduce((s,r) => s+(Number(r.s1)||0),0);
    const a=rs.reduce((s,r) => s+(Number(r.s1)||0),0), b=rs.reduce((s,r) => s+(Number(r.s0)||0),0);
    return b>0 ? (a/b-1)*100 : null;
  }
  function valueText(v) {
    if (v==null) return "자료 없음";
    if (metric==="count") return fmtNum(v)+"곳";
    if (metric==="sales") return money(v);
    return pct(v);
  }
  function fillFor(v, max) {
    if (v==null) return "#dfe6e2";
    if (metric==="growth") {
      const alpha=Math.min(.84,.23 + Math.abs(v) / Math.max(max,.01)*.55);
      return v<0 ? "rgba(201,74,66,"+alpha.toFixed(2)+")" : "rgba(31,111,102,"+alpha.toFixed(2)+")";
    }
    if (v<=0) return "#e3e9e5";
    return "rgba(31,111,102,"+(.20+.72*Math.sqrt(v/Math.max(max,1))).toFixed(2)+")";
  }
  function redraw() {
    if (!loaded) return;
    const { groups, missing } = grouped();
    const stats = regionNames.map(n => ({name:n, rows:groups[n], v:metricValue(groups[n])}));
    const mx=Math.max(.01,...stats.map(r=>Math.abs(r.v||0)));
    svg.querySelectorAll("path[id]").forEach(p=>{
      const raw=p.id;
      const name=alias[raw] || raw;
      const st=stats.find(s=>s.name===name);
      if (!st) { p.style.fill="#dfe6e2"; return; }
      p.style.fill=fillFor(st.v,mx);
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
    const mapped=rows.length-missing.length;
    coverage.textContent="주소 확인 "+fmtNum(mapped)+" / 분석 "+fmtNum(rows.length)+"곳 · 소재지 미확인 "+fmtNum(missing.length)+"곳";
    legend.textContent=metric==="growth" ? "청록: 성장 · 적색: 감소 · 회색: 미집계" : "색이 진할수록 "+metricNames[metric]+"가 큼 · 회색: 0 또는 미집계";
    const focus = selected ? stats.find(s=>s.name===selected) : null;
    const ranked=stats.filter(s=>s.rows.length).sort((a,b)=>(b.v??-Infinity)-(a.v??-Infinity));
    const display=focus ? focus.rows.slice().sort((a,b)=>b.s1-a.s1) : [];
    const metricCaption=focus ? metricNames[metric]+": "+valueText(focus.v) : "전국 현황";
    details.innerHTML =
      '<div class="sb-map-panel-title"><div><span class="sb-map-eyebrow">'+(selected?"선택 지역":"지역 순위")+'</span><h3>'+esc(selected||"전국 17개 시·도")+'</h3></div><strong>'+esc(metricCaption)+'</strong></div>'
      +(focus ?
        '<div class="sb-map-subinfo">해당 지역 분석 기업 '+fmtNum(display.length)+'곳 · 본사 소재지 기준</div>'+
        (display.length ? '<div class="sb-map-company-list">'+display.slice(0,10).map(r=>'<a href="#company" data-co="'+esc(r.c)+'"><span><b>'+esc(r.n)+'</b><small>'+esc(r.kind)+'</small></span><span>'+money(r.s1)+'</span></a>').join("")+'</div>'+
          (display.length>10?'<p class="sb-map-fine">매출 상위 10곳만 표시</p>':'') :
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
    metric=metricSel.value; selected=""; redraw();
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
    if (path && (e.key==="Enter" || e.key===" ")) {e.preventDefault();pick(path.dataset.region);}
  });
  fetch("data/geo/korea-sido.svg").then(r=>{
    if(!r.ok) throw new Error("HTTP "+r.status);
    return r.text();
  }).then(t=>{
    const doc=new DOMParser().parseFromString(t,"image/svg+xml");
    const el=doc.documentElement;
    if(el.tagName.toLowerCase()!=="svg" || el.querySelectorAll("path[id]").length!==17) throw new Error("17개 시도 경계 검증 실패");
    svg=document.importNode(el,true);
    svg.removeAttribute("width");svg.removeAttribute("height");
    svg.classList.add("sb-map-shape");
    svg.setAttribute("aria-label","대한민국 시도별 기업 분포");
    svg.setAttribute("role","group");
    mapEl.replaceChildren(svg); loaded=true; redraw();
  }).catch(err=>{mapEl.textContent="지도를 불러오지 못했습니다: "+err.message;mapEl.classList.add("sb-map-error");});
  window.SobujangMap={
    render(nextRows,year) {
      rows=Array.isArray(nextRows)?nextRows:[];
      fy=year;
      const y=document.getElementById("sb-map-year");
      if(y) y.textContent=String(fy||"-")+"년 재무 · 본사 소재지 기준";
      redraw();
    },
    regionOf:groupOf
  };
})();