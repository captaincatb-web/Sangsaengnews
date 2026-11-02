/* Pure, testable helpers for the province map. No third-party runtime dependency. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SobujangMapUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const regions = [
    "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시",
    "대전광역시", "울산광역시", "세종특별자치시", "경기도", "강원특별자치도",
    "충청북도", "충청남도", "전북특별자치도", "전라남도", "경상북도",
    "경상남도", "제주특별자치도"
  ];
  const aliases = {
    "서울": "서울특별시", "서울시": "서울특별시",
    "부산": "부산광역시", "부산시": "부산광역시",
    "대구": "대구광역시", "대구시": "대구광역시",
    "인천": "인천광역시", "인천시": "인천광역시",
    "광주": "광주광역시", // do not assume bare "광주시": also a city in Gyeonggi-do
    "대전": "대전광역시", "대전시": "대전광역시",
    "울산": "울산광역시", "울산시": "울산광역시",
    "세종": "세종특별자치시", "세종시": "세종특별자치시",
    "경기": "경기도", "강원": "강원특별자치도", "강원도": "강원특별자치도",
    "충북": "충청북도", "충남": "충청남도",
    "전북": "전북특별자치도", "전라북도": "전북특별자치도",
    "전남": "전라남도", "경북": "경상북도", "경남": "경상남도",
    "제주": "제주특별자치도", "제주도": "제주특별자치도"
  };
  regions.forEach(r => { aliases[r] = r; });
  const canonical = name => Object.prototype.hasOwnProperty.call(aliases, name) ? aliases[name] : null;
  // Parse ONLY an explicit leading province token, not a six-region statistical bucket.
  // DART headquarters can contain "(우편번호)" or a leading postal code.
  function provinceOf(address) {
    if (typeof address !== "string") return null;
    const clean = address.trim()
      .replace(/^\(?\d{5,6}\)?[\s,]*/, "")
      .replace(/^\[\d{5,6}\][\s,]*/, "");
    const first = clean.split(/[\s,]+/)[0];
    return canonical(first);
  }
  function group(rows) {
    const byProvince = Object.fromEntries(regions.map(p => [p, []]));
    const unknown = [];
    (rows || []).forEach(r => {
      const p = provinceOf(r.ad);
      if (p) byProvince[p].push(r);
      else unknown.push(r);
    });
    return { byProvince, unknown };
  }
  const sum = (rows, field) => rows.reduce((a, r) => a + (Number(r[field]) || 0), 0);
  // MARKET.list is keyed by DART corporation code (r.c), not stock ticker.
  // Market caps are in 100-million KRW (억원). Never include an unlisted company
  // or interpret a missing/zero cap as a genuine zero-valued listing.
  function capOf(row, market) {
    if (!row || !row.l || !market || !Object.prototype.hasOwnProperty.call(market, row.c)) return null;
    const cap = market[row.c] && market[row.c].cap;
    return typeof cap === "number" && Number.isFinite(cap) && cap > 0 ? cap : null;
  }
  function capCoverage(rows, market) {
    const listed = rows.filter(r => Boolean(r.l));
    const known = listed.filter(r => capOf(r, market) != null);
    return { listed: listed.length, known: known.length, missing: listed.length - known.length,
      unlisted: rows.length - listed.length };
  }
  function metric(rows, mode, market) {
    if (mode === "count") return rows.length;
    if (mode === "sales") return sum(rows, "s1");
    if (mode === "cap") {
      const valid = rows.map(r => capOf(r, market)).filter(x => x != null);
      return valid.length ? valid.reduce((a, b) => a + b, 0) : null;
    }
    if (mode === "growth") {
      const prev = sum(rows, "s0");
      return prev > 0 ? (sum(rows, "s1") / prev - 1) * 100 : null;
    }
    return null;
  }
  function color(value, mode, upper, hasRows) {
    if (!hasRows || value == null || !Number.isFinite(value)) return "#dce5df";
    if (mode === "growth") {
      // Fixed +/-30% scale keeps comparisons consistent across filters.
      if (Math.abs(value) < 0.05) return "#a5b8b0";
      const alpha = (0.24 + Math.min(Math.abs(value) / 30, 1) * 0.65).toFixed(2);
      return value < 0 ? "rgba(187,75,67," + alpha + ")" : "rgba(31,111,102," + alpha + ")";
    }
    if (value <= 0) return "#dce5df";
    const alpha = (0.20 + Math.sqrt(value / Math.max(upper, 1)) * 0.72).toFixed(2);
    return "rgba(31,111,102," + alpha + ")";
  }
  // These pins summarize a province, never a specific company or factory address.
  function pinLabel(value, mode) {
    if (value == null || !Number.isFinite(value)) return "—";
    if (mode === "count") return String(Math.round(value));
    if (mode === "growth") return (value > 0 ? "+" : "") + value.toFixed(1) + "%";
    if (Math.abs(value) >= 10000) return (value / 10000).toFixed(1) + "조";
    return Math.round(value).toLocaleString("ko-KR") + "억";
  }
  function regionBreakdown(regionRows, allRows, market) {
    const kinds = ["소재", "부품", "장비"];
    const counts = Object.fromEntries(kinds.map(k => [k, 0]));
    for (const r of regionRows) if (Object.prototype.hasOwnProperty.call(counts, r.kind)) counts[r.kind]++;
    const classified = Object.values(counts).reduce((a,b)=>a+b,0);
    return { count:regionRows.length, share:allRows.length ? regionRows.length / allRows.length * 100 : null,
      kinds:counts, other:regionRows.length-classified, sales:metric(regionRows,"sales"),
      growth:metric(regionRows,"growth"), cap:metric(regionRows,"cap",market),
      capCoverage:capCoverage(regionRows,market) };
  }
  function pinSummaries(stats, mode, displayMode, selected, topN = 8) {
    if (displayMode === "none") return [];
    const populated = stats.filter(s => s.rows.length && s.v != null && Number.isFinite(s.v));
    const priority = s => mode === "growth" ? Math.abs(s.v) : s.v;
    populated.sort((a, b) => priority(b)-priority(a) || a.name.localeCompare(b.name,"ko"));
    const arr = displayMode === "all" ? populated : populated.slice(0,Math.max(1,topN));
    if (selected && !arr.some(s => s.name === selected)) {
      const chosen=stats.find(s=>s.name===selected);
      if(chosen)arr.unshift(chosen);
    }
    return arr.map(s => ({name:s.name,label:pinLabel(s.v,mode),
      value:s.v,n:s.rows.length,selected:s.name === selected}));
  }
  // Exact non-overlap is guaranteed for the returned set; impossible pins are
  // OMITTED rather than overlapping or rendered at unreadably small sizes.
  // Candidate w/h must come from the browser's actual badge dimensions.
  function layoutPins(candidates, width, height) {
    const placed=[];
    const sorted=candidates.slice().sort((a,b)=>Number(Boolean(b.selected))-Number(Boolean(a.selected)));
    for(const c of sorted) {
      const w=Math.max(1,Number(c.w)||Math.max(46,23+String(c.label||"").length*8));
      const h=Math.max(1,Number(c.h)||39);
      const originX=c.x,originY=c.y;
      if(width < w+4 || height < h+4) continue;
      let result=null;
      for(let ring=0;ring<=12 && !result;ring++) {
        const count=ring===0?1:Math.max(16,ring*20);
        const radius=ring*13;
        for(let j=0;j<count;j++){
          const angle=ring===0?0:(j/count)*Math.PI*2-Math.PI/2;
          const tx=originX+Math.cos(angle)*radius;
          const ty=originY+Math.sin(angle)*radius;
          const x=Math.max(w/2+2,Math.min(width-w/2-2,tx));
          const y=Math.max(h/2+2,Math.min(height-h/2-2,ty));
          if(placed.some(p=>Math.abs(x-p.x)<(w+p.w)/2+5 &&
            Math.abs(y-p.y)<(h+p.h)/2+5))continue;
          result={...c,x,y,anchorX:originX,anchorY:originY,w,h,
            displaced:Math.hypot(x-originX,y-originY)>12};
          break;
        }
      }
      if(result)placed.push(result);
    }
    return placed;
  }
  return { regions, canonical, provinceOf, group, capOf, capCoverage, metric, color,
    pinLabel, pinSummaries, layoutPins, regionBreakdown };
});
