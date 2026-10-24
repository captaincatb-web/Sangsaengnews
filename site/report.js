// 경영 현황 보고: 협력사 명단의 연간·분기 실적으로 보고용 2장(16:9)을 만든다.
(() => {
  const FIN = window.COMPANY_FINANCIALS || [];
  const META = window.COMPANY_FINANCIALS_META || {};
  const segs = window.COMPANY_SEGMENTS || {};
  const attrs = window.COMPANY_ATTRS || {};
  const universe = window.COMPANY_UNIVERSE || [];
  const uniByKey = new Map(universe.map((u) => [u[1], u]));
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NA = "미분류";

  // 성장·수익 분류 기준(4유형)
  const HI_GROWTH = 10, HI_MARGIN = 5;

  const num = (v) => Math.round(v).toLocaleString("ko-KR");
  const jo = (v) => (Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(1)}조` : `${num(v)}억`);
  const pc = (v, d = 1) => (v == null || !isFinite(v) ? "-" : `${v.toFixed(d)}%`);
  const sg = (v, d = 1) => (v == null || !isFinite(v) ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const med = (a) => { const s = a.filter((v) => v != null && isFinite(v)).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const growth = (a, b) => (b > 0 ? (a / b - 1) * 100 : null);
  const share = (n, d) => (d ? (n / d) * 100 : null);

  // ---------- 기업 정보 ----------
  const AREA = { 서울: "서울", 경기: "경기", 인천: "경기", 충북: "충청", 충남: "충청", 대전: "충청", 세종: "충청", 경북: "경상", 경남: "경상", 부산: "경상", 울산: "경상", 대구: "경상", 전북: "전라", 전남: "전라", 광주: "전라" };
  const SHORT = { 서울특별시: "서울", 경기도: "경기", 인천광역시: "인천", 충청북도: "충북", 충청남도: "충남", 대전광역시: "대전", 세종특별자치시: "세종", 경상북도: "경북", 경상남도: "경남", 부산광역시: "부산", 울산광역시: "울산", 대구광역시: "대구", 전북특별자치도: "전북", 전라북도: "전북", 전라남도: "전남", 광주광역시: "광주" };
  const areaOf = (r) => {
    const u = r.k && uniByKey.get(r.k);
    if (u && u[2].length) return u[2][0][0];
    const a = SHORT[String(r.ad || "").trim().split(/\s+/)[0]];
    return AREA[a] || "기타";
  };

  const recs = FIN.map((r) => {
    const cl = window.classifyCompany(r, segs);
    const at = attrs[r.c] || {};
    return { ...r, kind: cl.kind, kindEst: cl.est, area: areaOf(r), size: at.size || "미입력" };
  }).filter((r) => r.kind !== "수요");

  // 연간: 가장 많은 기업이 가진 최신 연도 기준
  const mode = (arr) => { const c = {}; arr.forEach((v) => (c[v] = (c[v] || 0) + 1)); return Number(Object.keys(c).sort((a, b) => c[b] - c[a] || b - a)[0]); };
  const FY = mode(recs.filter((r) => r.y.length).map((r) => r.y[r.y.length - 1]));
  const annual = recs.map((r) => {
    const i = r.y.indexOf(FY), j = r.y.indexOf(FY - 1);
    if (i < 0 || j < 0 || !(r.s[i] > 0) || !(r.s[j] > 0) || r.o[i] == null) return null; // 영업이익이 없으면 이익률을 왜곡하므로 뺀다
    return { ...r, s1: r.s[i], s0: r.s[j], o1: r.o[i] ?? 0, o0: r.o[j] ?? 0, g: growth(r.s[i], r.s[j]), m: share(r.o[i] ?? 0, r.s[i]), m0: share(r.o[j] ?? 0, r.s[j]) };
  }).filter(Boolean);

  // 분기: 상장사 중 최근 8개 분기가 모두 있는 곳
  const qLabels = (() => { const c = {}; recs.forEach((r) => { if (r.q && r.q.labels.length === 8) { const k = r.q.labels.join(","); c[k] = (c[k] || 0) + 1; } }); const k = Object.keys(c).sort((a, b) => c[b] - c[a])[0]; return k ? k.split(",") : []; })();
  const qPanel = recs.filter((r) => r.q && r.q.labels.join(",") === qLabels.join(",") && r.q.sales.every((v) => v != null) && r.q.op.every((v) => v != null));

  // ---------- 집계 ----------
  function stats(list) {
    const s1 = sum(list.map((r) => r.s1)), s0 = sum(list.map((r) => r.s0)), o1 = sum(list.map((r) => r.o1)), o0 = sum(list.map((r) => r.o0));
    return {
      n: list.length, s1, s0, o1, o0, g: growth(s1, s0), og: o0 > 0 ? growth(o1, o0) : null, m: share(o1, s1), m0: share(o0, s0),
      loss: list.filter((r) => r.o1 < 0).length, lossP: share(list.filter((r) => r.o1 < 0).length, list.length),
      avg: list.length ? s1 / list.length : null, medS: med(list.map((r) => r.s1)), medG: med(list.map((r) => r.g)), medM: med(list.map((r) => r.m)),
      up: list.filter((r) => r.g > 0).length,
    };
  }
  const A = stats(annual);
  const top = annual.slice().sort((a, b) => b.s1 - a.s1);
  const conc = (n) => share(sum(top.slice(0, n).map((r) => r.s1)), A.s1);
  const growthDist = [["10% 이상 성장", (r) => r.g >= 10], ["0~10% 성장", (r) => r.g >= 0 && r.g < 10], ["매출 감소", (r) => r.g < 0]].map(([l, f]) => [l, annual.filter(f).length]);
  const marginDist = [["이익률 10% 이상", (r) => r.m >= 10], ["0~10%", (r) => r.m >= 0 && r.m < 10], ["영업적자", (r) => r.m < 0]].map(([l, f]) => [l, annual.filter(f).length]);
  const prevLoss = annual.filter((r) => r.o0 < 0).length, prevHiM = annual.filter((r) => r.m0 >= 10).length, curHiM = marginDist[0][1];
  const decileTop = top.slice(0, Math.max(1, Math.round(annual.length * 0.1))), half = top.slice(Math.floor(top.length / 2));
  const gTop = stats(decileTop).g, gLow = stats(half).g;
  const weak = annual.filter((r) => r.o1 < 0 && r.g < 0);
  const q4loss = qPanel.filter((r) => r.q.op.slice(-4).every((v) => v < 0));

  // ---------- 그리기 도구 ----------
  const COLORS = ["#5b4bdb", "#0b8f7a", "#d97706", "#7c8696"];
  function stacked(parts, colors = COLORS, unit = "곳") {
    const total = sum(parts.map((p) => p[1])) || 1;
    return `<div class="rp-stack">${parts.map((p, i) => `<span style="flex:${Math.max(p[1], 0.0001)};background:${colors[i % colors.length]}" title="${esc(p[0])} ${p[1]}${unit}">${p[1] / total >= 0.12 ? pc(share(p[1], total), 0) : ""}</span>`).join("")}</div>`
      + `<ul class="rp-legend">${parts.map((p, i) => `<li><i style="background:${colors[i % colors.length]}"></i>${esc(p[0])} <b>${p[1]}${unit}</b>${unit === "곳" ? ` (${pc(share(p[1], total), 0)})` : ""}</li>`).join("")}</ul>`;
  }

  function quarterChart() {
    if (!qPanel.length) return `<p class="rp-empty">분기 실적을 아직 받지 못했습니다. 다음 갱신 때 채워집니다.</p>`;
    const W = 560, H = 250, L = 52, R = 40, T = 20, B = 30, pw = W - L - R, ph = H - T - B;
    const s = qLabels.map((_, i) => sum(qPanel.map((r) => r.q.sales[i]))), o = qLabels.map((_, i) => sum(qPanel.map((r) => r.q.op[i])));
    const m = s.map((v, i) => share(o[i], v)), max = Math.max(...s);
    const mmax = Math.max(...m, 1), mmin = Math.min(0, ...m), bw = pw / s.length;
    let g = "";
    for (let i = 0; i <= 3; i++) { const y = T + ph - (ph * i) / 3; g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#e3e5ee"/><text x="${L - 6}" y="${y + 4}" class="ax" text-anchor="end">${jo((max * i) / 3)}</text>`; }
    const pts = [];
    s.forEach((v, i) => {
      const x = L + bw * i + bw / 2, h = (v / max) * ph, w = bw * 0.55;
      g += `<rect x="${x - w / 2}" y="${T + ph - h}" width="${w}" height="${h}" rx="3" fill="#5b4bdb"><title>${qLabels[i]} 매출 ${num(v)}억, 영업이익 ${num(o[i])}억</title></rect><text x="${x}" y="${T + ph + 18}" class="ax" text-anchor="middle">${qLabels[i]}</text>`;
      pts.push([x, T + ph - ((m[i] - mmin) / (mmax - mmin || 1)) * ph * 0.85 - 6, m[i]]);
    });
    g += `<polyline points="${pts.map((p) => p[0] + "," + p[1]).join(" ")}" fill="none" stroke="#0b8f7a" stroke-width="2.5"/>`;
    pts.forEach((p) => (g += `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#fff" stroke="#0b8f7a" stroke-width="2.5"/><text x="${p[0]}" y="${p[1] - 9}" class="mv" text-anchor="middle">${pc(p[2])}</text>`));
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="분기별 합산 매출과 영업이익률">${g}</svg>`;
  }

  // ---------- 1장 ----------
  const kpi = (label, val, sub, tone) => `<div class="rp-kpi"><p>${label}</p><strong>${val}</strong><span class="${tone || ""}">${sub}</span></div>`;
  const tone = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
  const dm = A.m - A.m0;
  function slide1() {
    const dLoss = A.lossP - share(prevLoss, annual.length);
    const q = qPanel.length ? (() => {
      const s = qLabels.map((_, i) => sum(qPanel.map((r) => r.q.sales[i])));
      return { ltm: sum(s.slice(4)), prev: sum(s.slice(0, 4)) };
    })() : null;
    const bullets = [
      `${A.n}개사 합산 매출은 <b>${jo(A.s1)}원</b>으로 전년 대비 <b>${sg(A.g)}</b>, 영업이익률은 ${pc(A.m0)}에서 <b>${pc(A.m)}</b>(${dm >= 0 ? "+" : ""}${dm.toFixed(1)}%p)입니다.`,
      `매출이 늘어난 업체는 <b>${pc(share(A.up, A.n), 0)}</b>(${A.up}곳)이고, 업체 중앙값 성장률은 ${sg(A.medG)}로 합산(${sg(A.g)})과 ${Math.abs(A.medG - A.g) < 3 ? "비슷해 성장이 고르게 퍼진 편" : A.g > A.medG ? "차이가 커 일부 대형사가 합계를 끌어올린 모습" : "달리 일반 업체가 더 크게 성장한 모습"}입니다.`,
      `상위 10개사가 매출의 <b>${pc(conc(10), 0)}</b>를 차지합니다${conc(10) >= 40 ? `. 이들을 빼면 성장률 <b>${sg(stats(top.slice(10)).g)}</b>, 이익률 ${pc(stats(top.slice(10)).m)}로 합계와 ${Math.abs(stats(top.slice(10)).g - A.g) >= 3 ? "차이가 큽니다" : "비슷합니다"}` : ""}. 영업적자 업체는 ${A.loss}곳(${pc(A.lossP, 0)})입니다.`,
    ];
    return `
      <header class="sl-head"><div><p class="sl-tag">1 / 2 · 산업 전체</p><h2>반도체 소부장 협력사 경영실적 및 성장 추이</h2></div>
        <p class="sl-meta">분석대상 ${A.n}개사 · ${FY}년(연간) · 단위 억원 · 개별 기준</p></header>
      <div class="sl-kpis">
        ${kpi(`${FY}년 매출`, jo(A.s1), `전년 대비 ${sg(A.g)}`, tone(A.g))}
        ${kpi("영업이익", jo(A.o1), A.og == null ? "전년 적자" : `전년 대비 ${sg(A.og)}`, tone(A.og))}
        ${kpi("영업이익률", pc(A.m), `전년 ${pc(A.m0)} (${dm >= 0 ? "+" : ""}${dm.toFixed(1)}%p)`, tone(dm))}
        ${kpi("흑자 업체 비중", pc(100 - A.lossP, 0), `전년 대비 ${(-dLoss) >= 0 ? "+" : ""}${(-dLoss).toFixed(1)}%p`, tone(-dLoss))}
        ${kpi("중앙값 영업이익률", pc(A.medM), `평균(합산) ${pc(A.m)}`, "")}
      </div>
      <div class="sl-body">
        <section class="sl-col wide"><h3>① 분기별 매출액 및 영업이익률 <small>상장 ${qPanel.length}곳 · 최근 8개 분기</small></h3>${quarterChart()}
          ${q ? `<p class="sl-note">최근 4분기 매출 ${jo(q.ltm)}원, 직전 4분기 대비 ${sg(growth(q.ltm, q.prev))}</p>` : ""}</section>
        <section class="sl-col"><h3>② 매출 성장 업체 분포</h3>${stacked(growthDist)}
          <h3>③ 수익성 분포</h3>${stacked(marginDist)}
          <h3>④ 매출 상위 집중도</h3>${stacked([["상위 10개사", Math.round(conc(10))], ["11~100위", Math.round(conc(100) - conc(10))], ["기타", Math.round(100 - conc(100))]], ["#5b4bdb", "#0b8f7a", "#c5cad3"], "%")}</section>
      </div>
      <footer class="sl-foot"><h3>종합 분석 및 시사점</h3><ul>${bullets.map((b) => `<li>${b}</li>`).join("")}</ul></footer>`;
  }

  // ---------- 2장 ----------
  const row = (label, s) => `<tr><th scope="row">${esc(label)}</th><td>${s.n}</td><td>${jo(s.s1)}</td><td>${s.n ? jo(s.avg) : "-"}</td><td class="${tone(s.g)}">${sg(s.g)}</td><td>${pc(s.m)}</td><td>${pc(s.medM)}</td><td>${pc(s.lossP, 0)}</td></tr>`;
  const head = (first) => `<thead><tr><th>${first}</th><th>업체 수</th><th>매출</th><th>업체당 평균</th><th>매출 성장률</th><th>영업이익률</th><th>이익률 중앙값</th><th>적자 비중</th></tr></thead>`;
  function quadrant() {
    const cells = { "우량 성장형": [], "수익 안정형": [], "성장 투자형": [], "경영 취약형": [] };
    annual.forEach((r) => { const hg = r.g >= HI_GROWTH, hm = r.m >= HI_MARGIN; cells[hg ? (hm ? "우량 성장형" : "성장 투자형") : hm ? "수익 안정형" : "경영 취약형"].push(r); });
    const box = (k, sub, cls) => {
      const l = cells[k];
      return `<div class="rp-q ${cls}"><p>${k}<small>${sub}</small></p><strong>${l.length}곳 <em>${pc(share(l.length, annual.length), 0)}</em></strong><span>${esc(l.sort((a, b) => b.s1 - a.s1).slice(0, 3).map((r) => r.n).join(" · ") || "-")}</span></div>`;
    };
    return `<div class="rp-quad"><div class="rp-axis y">영업이익률 ${HI_MARGIN}% 기준</div>
      ${box("수익 안정형", "저성장 · 고수익", "b")}${box("우량 성장형", "고성장 · 고수익", "a")}${box("경영 취약형", "저성장 · 저수익", "d")}${box("성장 투자형", "고성장 · 저수익", "c")}
      <div class="rp-axis x">매출 성장률 ${HI_GROWTH}% 기준</div></div>`;
  }
  function slide2() {
    const kinds = ["소재", "부품", "장비", NA].map((k) => [k, annual.filter((r) => r.kind === k)]).filter(([, l]) => l.length);
    const est = annual.filter((r) => r.kindEst).length;
    const ls = [["상장사", annual.filter((r) => r.l)], ["비상장사", annual.filter((r) => !r.l)]];
    const best = kinds.filter(([k]) => k !== NA).map(([k, l]) => [k, stats(l)]).sort((a, b) => b[1].g - a[1].g);
    const L = stats(ls[0][1]), U = stats(ls[1][1]);
    const bullets = [
      best.length > 1 ? `성장은 <b>${best[0][0]}</b>(${sg(best[0][1].g)}), 수익성은 <b>${best.slice().sort((a, b) => b[1].m - a[1].m)[0][0]}</b>(${pc(best.slice().sort((a, b) => b[1].m - a[1].m)[0][1].m)})이 앞섭니다.` : "",
      L.n && U.n ? `상장사 영업이익률 ${pc(L.m)} · 비상장사 ${pc(U.m)}, 성장률은 ${sg(L.g)} 대 ${sg(U.g)}로 ${Math.abs(L.g - U.g) < 3 ? "격차가 크지 않습니다" : (L.g > U.g ? "상장사" : "비상장사") + "가 앞섭니다"}.` : "",
      `양극화: 매출 상위 10% 성장률 ${sg(gTop)} · 하위 50% ${sg(gLow)}. 이익률 10%↑ 업체 ${prevHiM}곳→${curHiM}곳, 적자 업체 ${prevLoss}곳→${A.loss}곳입니다.`,
      `경영 취약: 매출 감소와 영업적자가 겹친 업체 <b>${weak.length}곳</b>${qPanel.length ? `, 최근 4분기 연속 적자(상장) ${q4loss.length}곳` : ""}. 상생협력 지원 우선 검토 대상입니다.`,
    ].filter(Boolean);
    return `
      <header class="sl-head"><div><p class="sl-tag">2 / 2 · 업종별·상장 여부별</p><h2>소부장 업종별 경쟁력 및 경영 격차</h2></div>
        <p class="sl-meta">${FY}년 기준 · 분석대상 ${A.n}개사 · 구분 추정 ${est}곳 포함</p></header>
      <div class="sl-body two">
        <section class="sl-col"><h3>소재·부품·장비별 경영실적</h3><table class="sl-table">${head("구분")}<tbody>${kinds.map(([k, l]) => row(k, stats(l))).join("")}</tbody></table>
          <h3>상장·비상장 경영실적 비교</h3><table class="sl-table">${head("구분")}<tbody>${ls.filter(([, l]) => l.length).map(([k, l]) => row(k, stats(l))).join("")}</tbody></table></section>
        <section class="sl-col"><h3>성장성·수익성 기반 업체 분류 <small>업체 ${A.n}곳</small></h3>${quadrant()}</section>
      </div>
      <footer class="sl-foot"><h3>종합 분석 및 시사점</h3><ul>${bullets.map((b) => `<li>${b}</li>`).join("")}</ul></footer>`;
  }

  // ---------- 화면 ----------
  function fit() {
    document.querySelectorAll(".rp-stage").forEach((st) => {
      const sl = st.firstElementChild, k = Math.min(1, Math.max(0.55, st.clientWidth / 1280));
      sl.style.transform = `scale(${k})`;
      st.style.height = `${720 * k}px`;
    });
  }
  function render() {
    if (!annual.length) {
      $("lead").textContent = "실적 데이터가 아직 없습니다. 다음 자동 갱신 후에 표시됩니다.";
      $("csv").disabled = true;
      return;
    }
    $("lead").innerHTML = `협력사 명단 ${recs.length}곳 중 연간 실적이 있는 <strong>${A.n}곳</strong>을 보고용 2장으로 정리했습니다. 분기 실적은 상장 ${qPanel.length}곳만 있습니다.`;
    $("basis").textContent = `수집 ${META.updated || ""} · 명단에서 못 찾은 곳 ${(META.missing || []).length}곳`;
    $("slide1").innerHTML = slide1();
    $("slide2").innerHTML = slide2();
    fit();
  }
  window.addEventListener("resize", fit);
  window.addEventListener("beforeprint", () => document.querySelectorAll(".slide").forEach((s) => (s.style.transform = "none")));
  window.addEventListener("afterprint", fit);
  $("print").addEventListener("click", () => window.print());

  // 모판(CSV): 업체코드·분기·매출액·영업이익을 세로로 쌓는다
  $("csv").addEventListener("click", () => {
    const rows = [["업체코드", "업체명", "상장", "구분", "구분추정", "지역", "기간", "매출액(억원)", "영업이익(억원)", "당기순이익(억원)"]];
    recs.forEach((r) => {
      const base = [r.c, r.n, r.l ? "상장" : "비상장", r.kind, r.kindEst ? "추정" : "", r.area];
      r.y.forEach((y, i) => rows.push([...base, `FY${y}`, r.s[i], r.o[i], r.ni[i]]));
      if (r.q) r.q.labels.forEach((l, i) => rows.push([...base, l, r.q.sales[i], r.q.op[i], r.q.net[i]]));
    });
    const csv = "﻿" + rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: "소부장_실적_모판.csv" });
    a.click();
  });
  render();
})();
