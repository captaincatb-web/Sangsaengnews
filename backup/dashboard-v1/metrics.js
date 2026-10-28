// 공통 계산 모듈: 대시보드·경영진 보고서·CSV가 같은 데이터 정의와 산식을 쓰도록 한 곳에 모은다.
// 필요: data/financials.js, segments.js, universe.js, classify.js
(() => {
  // ---------- 숫자 표기 ----------
  const num = (v) => Math.round(v).toLocaleString("ko-KR");
  const won = (v) => (v == null || !isFinite(v) ? "-" : Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(1)}조` : `${num(v)}억`);
  const pc = (v, d = 1) => (v == null || !isFinite(v) ? "-" : `${v.toFixed(d)}%`);
  const sg = (v, d = 1) => (v == null || !isFinite(v) ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
  const pp = (v) => (v == null || !isFinite(v) ? "-" : Math.abs(v) < 0.05 ? "보합" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%p`);
  const tone = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- 계산 ----------
  const sum = (a) => a.reduce((s, v) => s + (v || 0), 0);
  const sorted = (a) => a.filter((v) => v != null && isFinite(v)).sort((x, y) => x - y);
  const quantile = (a, p) => { const s = sorted(a); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
  const med = (a) => quantile(a, 0.5);
  const growth = (a, b) => (b > 0 && a != null ? (a / b - 1) * 100 : null); // 전기 매출이 0 이하이면 계산하지 않는다
  const share = (n, d) => (d ? (n / d) * 100 : null);

  // ---------- 분류 기준(확정) ----------
  const NA = "미분류";
  const EXCLUDED_KINDS = ["수요", "IT·서비스"]; // 분석에서 뺀 업종: 수요기업, IT·서비스(7곳, 소부장이 아님)
  const KINDS = ["소재", "부품", "장비", NA], AREAS = ["서울", "경기", "충청", "경상", "전라", "기타"];
  const HI_GROWTH = 10, HI_MARGIN = 5;
  const TYPES = ["고성장·고수익", "저성장·고수익", "고성장·저수익", "저성장·저수익"]; // 판정이 아닌 위치 표시(중립 명칭)
  // 유형 색: 대시보드·보고서가 같은 색을 쓴다(저성장·저수익은 살펴볼 집단이라 경고색)
  const TYPE_COLOR = { [TYPES[0]]: "#16a06a", [TYPES[1]]: "#3b6fe0", [TYPES[2]]: "#f08a1c", [TYPES[3]]: "#c93a2e" };
  const typeIdx = (t) => TYPES.indexOf(t);
  const typeOf = (g, m) => (g >= HI_GROWTH ? (m >= HI_MARGIN ? TYPES[0] : TYPES[2]) : m >= HI_MARGIN ? TYPES[1] : TYPES[3]);
  const BIG = "1조 이상"; // 대형사: 최근 매출 1조 원 이상, 기본 포함(필터로 제외·대형사만 가능)

  // ---------- 기업 데이터 ----------
  const segs = window.COMPANY_SEGMENTS || {};
  const uniByKey = new Map((window.COMPANY_UNIVERSE || []).map((u) => [u[1], u]));
  const profileCodes = new Set((window.COMPANY_GROUPS || []).flatMap((g) => g.companies.map((c) => c[1])));
  const SHORT = { 서울특별시: "서울", 경기도: "경기", 인천광역시: "경기", 충청북도: "충청", 충청남도: "충청", 대전광역시: "충청", 세종특별자치시: "충청", 경상북도: "경상", 경상남도: "경상", 부산광역시: "경상", 울산광역시: "경상", 대구광역시: "경상", 전북특별자치도: "전라", 전라북도: "전라", 전라남도: "전라", 광주광역시: "전라" };
  const areaOf = (r) => {
    const u = r.k && uniByKey.get(r.k);
    if (u && u[2].length) return u[2][0][0];
    return SHORT[String(r.ad || "").trim().split(/\s+/)[0]] || "기타";
  };
  const recs = (window.COMPANY_FINANCIALS || []).map((r) => {
    const cl = window.classifyCompany(r, segs), last = r.s.filter((v) => v != null).pop();
    return { ...r, last: last ?? null, kind: cl.kind, kindEst: cl.est, area: areaOf(r), tier: last != null ? window.sizeTier(last) : "-", hasProfile: profileCodes.has(r.c), legal: "미입력", trade: "미입력", semi: null };
  }).filter((r) => !EXCLUDED_KINDS.includes(r.kind));
  const yearCount = {};
  recs.forEach((r) => r.y.length && (yearCount[r.y[r.y.length - 1]] = (yearCount[r.y[r.y.length - 1]] || 0) + 1));
  const DEFAULT_FY = Number(Object.keys(yearCount).sort((a, b) => yearCount[b] - yearCount[a] || b - a)[0]) || new Date().getFullYear() - 1;

  // ---------- 필터 ----------
  const DEFAULTS = { fy: DEFAULT_FY, kind: "all", area: "all", listed: "all", size: "all", smin: "", smax: "", big: "include", legal: "all", trade: "all" };
  const FILTER_KEYS = Object.keys(DEFAULTS);
  const isBig = (r) => r.tier === BIG;
  // 직접 입력한 매출 범위(억 원). 빈 칸이면 그쪽 제한 없음
  const inRange = (v, lo, hi) => v != null && (lo === "" || v >= Number(lo)) && (hi === "" || v <= Number(hi));
  const eok = (v) => (Number(v) >= 10000 ? `${(Number(v) / 10000).toLocaleString("ko-KR")}조` : `${Number(v).toLocaleString("ko-KR")}억`);
  const makeFilter = (st, internal) => {
    const inBase = (r) => (st.kind === "all" || r.kind === st.kind) && (st.area === "all" || r.area === st.area)
      && (st.listed === "all" || String(r.l) === st.listed) && (st.size === "all" || (st.size === "custom" ? inRange(r.last, st.smin, st.smax) : r.tier === st.size))
      && (!internal || ((st.legal === "all" || r.legal === st.legal) && (st.trade === "all" || r.trade === st.trade)));
    const inFilter = (r) => inBase(r) && (st.big === "include" || (st.big === "only" ? isBig(r) : !isBig(r)));
    return { inBase, inFilter };
  };
  const toQuery = (st) => FILTER_KEYS.filter((k) => String(st[k]) !== String(DEFAULTS[k]) && !(k === "legal" || k === "trade")).map((k) => `${k}=${encodeURIComponent(st[k])}`).join("&");
  const fromQuery = (search) => {
    const q = new URLSearchParams(search || location.search), st = { ...DEFAULTS };
    FILTER_KEYS.forEach((k) => { if (q.has(k)) st[k] = k === "fy" ? Number(q.get(k)) : q.get(k); });
    return st;
  };
  const describe = (st) => {
    const parts = [`${st.fy}년 사업연도`];
    if (st.kind !== "all") parts.push(`업종 ${st.kind}`);
    if (st.area !== "all") parts.push(`지역 ${st.area}`);
    if (st.listed !== "all") parts.push(st.listed === "1" ? "상장사" : "비상장사");
    if (st.size === "custom") parts.push(st.smin !== "" && st.smax !== "" ? `매출 ${eok(st.smin)}~${eok(st.smax)}` : st.smin !== "" ? `매출 ${eok(st.smin)} 이상` : st.smax !== "" ? `매출 ${eok(st.smax)} 이하` : "매출 직접 입력(범위 없음)");
    else if (st.size !== "all") parts.push(`매출 ${st.size}`);
    parts.push(st.big === "exclude" ? "대형사(매출 1조↑) 제외" : st.big === "only" ? "대형사만" : "대형사 포함");
    return parts.join(" · ");
  };

  // ---------- 집계 ----------
  const at = (r, arr, y) => { if (!arr) return null; const i = r.y.indexOf(y); return i < 0 ? null : arr[i]; };
  // 동일 기업 기준: 당기·전기 매출이 모두 있는 기업만 비교한다
  function panel(list, fy) {
    return list.map((r) => {
      const s1 = at(r, r.s, fy), s0 = at(r, r.s, fy - 1);
      if (!(s1 > 0) || !(s0 > 0)) return null;
      // 영업이익이 비어 있으면 매출 합계에만 넣고 이익률·흑자·유형 계산에서는 뺀다
      const o1 = at(r, r.o, fy), o0 = at(r, r.o, fy - 1), g = growth(s1, s0), m = o1 == null ? null : share(o1, s1);
      const tl = at(r, r.tl, fy), te = at(r, r.te, fy);
      return { ...r, s1, s0, o1, o0, s2: at(r, r.s, fy - 2), o2: at(r, r.o, fy - 2), g, m, m0: o0 == null ? null : share(o0, s0),
        e1: at(r, r.e, fy), e0: at(r, r.e, fy - 1), e2: at(r, r.e, fy - 2),
        prod: at(r, r.e, fy) > 0 ? s1 / at(r, r.e, fy) : null, // 1인당 매출(억원)
        debt: tl != null && te > 0 ? share(tl, te) : null, type: m == null ? "-" : typeOf(g, m) };
    }).filter(Boolean);
  }
  function stats(rows) {
    const s1 = sum(rows.map((r) => r.s1)), s0 = sum(rows.map((r) => r.s0)), o1 = sum(rows.map((r) => r.o1)), o0 = sum(rows.map((r) => r.o0));
    const three = rows.filter((r) => r.s2 > 0), withOp = rows.filter((r) => r.o1 != null), withOp0 = rows.filter((r) => r.o0 != null);
    const loss = withOp.filter((r) => r.o1 < 0).length;
    return {
      n: rows.length, nOp: withOp.length, s1, s0, o1, o0, g: growth(s1, s0), og: o0 > 0 ? growth(o1, o0) : null, m: share(o1, s1), m0: share(o0, s0),
      profit: share(withOp.filter((r) => r.o1 > 0).length, withOp.length), profit0: share(withOp0.filter((r) => r.o0 > 0).length, withOp0.length),
      loss, lossP: share(loss, withOp.length), loss0: withOp0.filter((r) => r.o0 < 0).length,
      upN: rows.filter((r) => r.g > 0).length, up: share(rows.filter((r) => r.g > 0).length, rows.length),
      avg: rows.length ? s1 / rows.length : null, medS: med(rows.map((r) => r.s1)), medG: med(rows.map((r) => r.g)), medM: med(rows.map((r) => r.m)),
      q1G: quantile(rows.map((r) => r.g), 0.25), q3G: quantile(rows.map((r) => r.g), 0.75), q1M: quantile(rows.map((r) => r.m), 0.25), q3M: quantile(rows.map((r) => r.m), 0.75),
      // 임직원: 두 해 모두 공시한 기업만 더해 증감을 비교한다
      ...(() => { const E = rows.filter((r) => r.e1 > 0 && r.e0 > 0); const e1 = sum(E.map((r) => r.e1)), e0 = sum(E.map((r) => r.e0)), s = sum(E.map((r) => r.s1));
        return { eN: E.length, e1, e0, eg: growth(e1, e0), prod: e1 ? s / e1 : null, medProd: med(rows.map((r) => r.prod)), eDown: E.filter((r) => r.e1 < r.e0).length }; })(),
      spark: { s: [sum(three.map((r) => r.s2)), sum(three.map((r) => r.s0)), sum(three.map((r) => r.s1))], o: [sum(three.map((r) => r.o2 || 0)), sum(three.map((r) => r.o0)), sum(three.map((r) => r.o1))] },
    };
  }
  // 전체 표본 기준: 각 연도에 매출이 있는 모든 기업의 합계(표본 구성 변화 영향 포함)
  function fullSample(list, fy) {
    const cur = list.filter((r) => at(r, r.s, fy) > 0), prev = list.filter((r) => at(r, r.s, fy - 1) > 0);
    const a = sum(cur.map((r) => at(r, r.s, fy))), b = sum(prev.map((r) => at(r, r.s, fy - 1)));
    return { n1: cur.length, n0: prev.length, s1: a, s0: b, g: growth(a, b) };
  }
  const concentration = (rows, n) => { const t = rows.slice().sort((a, b) => b.s1 - a.s1); return share(sum(t.slice(0, n).map((r) => r.s1)), sum(t.map((r) => r.s1))); };
  // 분기: 상장사 중 같은 8개 분기가 모두 있는 곳
  function quarters(list) {
    const c = {};
    list.forEach((r) => { if (r.q && r.q.labels.length === 8 && r.q.sales.every((v) => v != null)) { const k = r.q.labels.join(); c[k] = (c[k] || 0) + 1; } });
    const key = Object.keys(c).sort((a, b) => c[b] - c[a])[0];
    if (!key) return { labels: [], P: [], s: [], o: [] };
    const P = list.filter((r) => r.q && r.q.labels.join() === key && r.q.sales.every((v) => v != null) && r.q.op.every((v) => v != null));
    const labels = key.split(",");
    return { labels, P, s: labels.map((_, i) => sum(P.map((r) => r.q.sales[i]))), o: labels.map((_, i) => sum(P.map((r) => r.q.op[i]))) };
  }

  // ---------- 위험 신호(확정 기준) ----------
  const SIGNALS = [
    { key: "급감", sev: 1, label: "매출 급감", rule: "전년 대비 매출 −30% 이하", test: (r) => r.g <= -30, why: (r) => `매출 ${sg(r.g)}`, check: "업황, 사업 매각, 결산 범위 변경" },
    { key: "적자전환", sev: 1, label: "적자 전환", rule: "전년 흑자 → 당해 영업적자", test: (r) => r.o0 > 0 && r.o1 < 0, why: (r) => `영업이익 ${won(r.o0)} → ${won(r.o1)}`, check: "일회성 비용 여부" },
    { key: "적자지속", sev: 1, label: "적자 지속", rule: "2년 연속 영업적자", test: (r) => r.o0 < 0 && r.o1 < 0, why: (r) => `2년 연속 영업적자(${won(r.o1)})`, check: "구조적 수익성 문제" },
    { key: "악화", sev: 2, label: "수익성 악화", rule: "영업이익률 2년 연속 1%p 이상 하락", test: (r) => { const m2 = r.s2 > 0 && r.o2 != null ? share(r.o2, r.s2) : null; return m2 != null && r.m0 != null && r.m != null && r.m0 < m2 - 1 && r.m < r.m0 - 1; },
      why: (r) => `이익률 ${pc(share(r.o2, r.s2))} → ${pc(r.m0)} → ${pc(r.m)}`, check: "제품 구성, 원가, 가격" },
    { key: "정체", sev: 2, label: "성장 정체", rule: "2년 연속 성장률 3% 미만", test: (r) => r.s2 > 0 && growth(r.s0, r.s2) < 3 && r.g < 3, why: (r) => `성장률 ${sg(growth(r.s0, r.s2))} → ${sg(r.g)}`, check: "시장 성숙, 사업 전환" },
    { key: "인력감축", sev: 2, label: "인력 감축", rule: "임직원 전년 대비 −10% 이하", test: (r) => r.e0 > 0 && r.e1 != null && growth(r.e1, r.e0) <= -10, why: (r) => `임직원 ${num(r.e0)} → ${num(r.e1)}명(${sg(growth(r.e1, r.e0))})`, check: "구조조정·사업 축소 여부" },
    { key: "분기적자", sev: 1, label: "분기 연속 적자", rule: "최근 4개 분기 모두 영업적자(상장)", test: (r) => !!r.q && r.q.op.length >= 4 && r.q.op.slice(-4).every((v) => v != null && v < 0), why: () => "최근 4개 분기 모두 영업적자", check: "유동성" },
    { key: "이상", sev: 3, label: "데이터 이상", rule: "매출 5배 이상 변동 또는 ±200%", test: (r) => r.s1 / r.s0 >= 5 || r.s0 / r.s1 >= 5 || Math.abs(r.g) >= 200, why: (r) => `매출 ${won(r.s0)} → ${won(r.s1)}`, check: "단위·입력 오류" },
  ];
  // 심각도: 1 우선 확인(적자·급감), 2 주의(추세 둔화), 3 자료 점검
  const SEV = { 1: "우선 확인", 2: "주의", 3: "자료 점검" };
  const signalsOf = (r) => SIGNALS.filter((s) => s.test(r)).sort((a, b) => a.sev - b.sev);

  const FORMULAS = [
    "매출 성장률(동일 기업) = Σ당기 매출 ÷ Σ전기 매출 − 1, 두 해 매출이 모두 있는 기업",
    "영업이익률 = Σ영업이익 ÷ Σ매출(영업이익 결측 기업 제외), 중앙값은 기업별 이익률의 중앙값",
    "적자 기업 비중 = 영업이익 < 0 기업 수 ÷ 영업이익이 있는 기업 수",
    "상위 집중도 = 상위 N개사 매출 ÷ 비교 대상 전체 매출",
    `기업 유형 = 성장률 ${HI_GROWTH}%·영업이익률 ${HI_MARGIN}% 기준 4분류`,
    "대형사 = 최근 매출 1조 원 이상(기본 포함, 필터로 제외 가능)",
    "1인당 매출 = 매출 ÷ 연말 임직원 수(사업보고서 직원 현황), 임직원 증감은 두 해 모두 공시한 기업 합계",
  ];

  window.SB = {
    fmt: { num, won, pc, sg, pp, tone, esc }, math: { sum, med, quantile, growth, share },
    NA, KINDS, AREAS, TYPES, TYPE_COLOR, typeIdx, SEV, HI_GROWTH, HI_MARGIN, BIG, SIGNALS, FORMULAS,
    recs, DEFAULT_FY, DEFAULTS, FILTER_KEYS, typeOf, isBig, makeFilter, toQuery, fromQuery, describe,
    at, panel, stats, fullSample, concentration, quarters, signalsOf,
    meta: window.COMPANY_FINANCIALS_META || {},
  };
})();
