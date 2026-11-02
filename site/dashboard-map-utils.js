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
  function metric(rows, mode) {
    if (mode === "count") return rows.length;
    if (mode === "sales") return sum(rows, "s1");
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
  return { regions, canonical, provinceOf, group, metric, color };
});
