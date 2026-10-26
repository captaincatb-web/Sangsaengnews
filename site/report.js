// 경영 현황 보고: 협력사 명단의 연간·분기 실적으로 보고용 2장(16:9)을 만든다.
(() => {
  // 데이터 정의·산식은 metrics.js(SB)와 같고, 조건은 대시보드에서 넘긴 주소의 필터를 그대로 쓴다
  const SB = window.SB;
  const META = SB.meta;
  const $ = (id) => document.getElementById(id);
  const { esc, pc, sg } = SB.fmt;
  const jo = SB.fmt.won;
  const { sum, growth, share } = SB.math;
  const { NA, HI_GROWTH, HI_MARGIN } = SB;
  const num = SB.fmt.num;

  const st = SB.fromQuery(location.search);
  // 대시보드 미리보기 안에서는 머리글·안내를 숨기고 보고서 2장만 보인다
  if (new URLSearchParams(location.search).has("embed")) document.body.classList.add("rp-embed");
  const F = SB.makeFilter(st, null);
  const recs = SB.recs.filter(F.inFilter);
  const bigCos = SB.recs.filter((r) => F.inBase(r) && SB.isBig(r));
  const bigNote = st.big === "exclude" ? `대형사 ${bigCos.length}곳 별도` : st.big === "only" ? "대형사만" : "대형사 포함";
  const FY = st.fy;
  const annual = SB.panel(recs, FY); // 대시보드와 같은 표본(영업이익이 비면 이익률 계산에서만 빠진다)
  const Q = SB.quarters(recs), qLabels = Q.labels, qPanel = Q.P;

  // ---------- 집계 ----------
  const stats = (list) => { const s = SB.stats(list); return { ...s, up: s.upN }; };
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
  // 시사점 한 줄: 관측(데이터 사실)과 해석(가설)을 나눠 적는다
  const bullet = (fact, read) => `<li><span class="rp-lb f">관측</span>${fact}${read ? ` <span class="rp-lb r">해석</span>${read}` : ""}</li>`;

  // ---------- 그리기 도구 ----------
  const COLORS = ["#3b6fe0", "#16a06a", "#f08a1c", "#9aa3b5"]; // 대시보드와 같은 색
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
      g += `<rect x="${x - w / 2}" y="${T + ph - h}" width="${w}" height="${h}" rx="3" fill="#3b6fe0"><title>${qLabels[i]} 매출 ${num(v)}억, 영업이익 ${num(o[i])}억</title></rect><text x="${x}" y="${T + ph + 18}" class="ax" text-anchor="middle">${qLabels[i]}</text>`;
      pts.push([x, T + ph - ((m[i] - mmin) / (mmax - mmin || 1)) * ph * 0.85 - 6, m[i]]);
    });
    g += `<polyline points="${pts.map((p) => p[0] + "," + p[1]).join(" ")}" fill="none" stroke="#16a06a" stroke-width="2.5"/>`;
    pts.forEach((p) => (g += `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#fff" stroke="#16a06a" stroke-width="2.5"/><text x="${p[0]}" y="${p[1] - 9}" class="mv" text-anchor="middle">${pc(p[2])}</text>`));
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
      bullet(`${A.n}개사 합산 매출 <b>${jo(A.s1)}원</b>, 전년 대비 <b>${sg(A.g)}</b>, 영업이익률 ${pc(A.m0)} → <b>${pc(A.m)}</b>(${SB.fmt.pp(dm)}).`,
        A.g >= 0 && dm >= -0.3 ? "외형 성장과 수익성 유지가 함께 나타났습니다." : A.g >= 0 ? "매출은 늘었지만 수익성이 낮아져 원가·단가 점검이 필요합니다." : "외형이 줄어 업황 영향 여부 확인이 필요합니다."),
      bullet(`매출이 늘어난 업체 <b>${pc(share(A.up, A.n), 0)}</b>(${A.up}곳), 업체 중앙값 성장률 ${sg(A.medG)}(합계 ${sg(A.g)}).`,
        Math.abs(A.medG - A.g) < 3 ? "성장이 업체 전반에 고르게 퍼진 편입니다." : A.g > A.medG ? "일부 큰 기업이 합계를 끌어올린 것으로 보입니다." : "일반 업체가 큰 기업보다 더 크게 성장했습니다."),
      A.eN ? bullet(`임직원 ${num(A.e0)} → <b>${num(A.e1)}명</b>(${sg(A.eg)}, ${A.eN}곳), 1인당 매출 ${A.prod.toFixed(1)}억원, 인원이 줄어든 업체 ${A.eDown}곳.`,
        Math.abs(A.g - A.eg) < 1 ? "매출과 인력이 비슷하게 움직여 1인당 매출은 거의 그대로입니다." : A.g > A.eg ? "매출 증가율이 인력 증가율보다 높아 1인당 매출이 늘었습니다." : "인력 증가율이 매출 증가율보다 높아 1인당 매출이 줄었습니다.") : "",
      bullet(`상위 10개사 매출 비중 <b>${pc(conc(10), 0)}</b>, 영업적자 ${A.loss}곳(${pc(A.lossP, 0)}).`,
        conc(10) >= 40 ? `상위 10개사를 빼면 성장률 ${sg(stats(top.slice(10)).g)}로, 합계만으로 업계 전반을 판단하기 어렵습니다.` : ""),
    ];
    return `
      <header class="sl-head"><div><p class="sl-tag">1 / 2 · 산업 전체</p><h2>반도체 소부장 협력사 경영실적 및 성장 추이</h2></div>
        <p class="sl-meta">${esc(SB.describe(st))} · 분석대상 ${A.n}개사 · 단위 억원 · 개별 기준</p></header>
      <div class="sl-kpis">
        ${kpi(`${FY}년 매출`, jo(A.s1), `전년 대비 ${sg(A.g)}`, tone(A.g))}
        ${kpi("영업이익", jo(A.o1), A.og == null ? "전년 적자" : `전년 대비 ${sg(A.og)}`, tone(A.og))}
        ${kpi("영업이익률", pc(A.m), `전년 ${pc(A.m0)} (${Math.abs(dm) < 0.05 ? "보합" : `${dm > 0 ? "+" : ""}${dm.toFixed(1)}%p`})`, tone(dm))}
        ${kpi("흑자 업체 비중", pc(100 - A.lossP, 0), `전년 대비 ${(-dLoss) >= 0 ? "+" : ""}${(-dLoss).toFixed(1)}%p`, tone(-dLoss))}
        ${kpi("중앙값 영업이익률", pc(A.medM), `평균(합산) ${pc(A.m)}`, "")}
      </div>
      <div class="sl-body">
        <section class="sl-col wide"><h3>① 분기별 매출액 및 영업이익률 <small>상장 ${qPanel.length}곳 · 최근 8개 분기</small></h3>${quarterChart()}
          ${q ? `<p class="sl-note">최근 4분기 매출 ${jo(q.ltm)}원, 직전 4분기 대비 ${sg(growth(q.ltm, q.prev))}</p>` : ""}</section>
        <section class="sl-col"><h3>② 매출 성장 업체 분포</h3>${stacked(growthDist)}
          <h3>③ 수익성 분포</h3>${stacked(marginDist)}
          <h3>④ 매출 상위 집중도</h3>${stacked([["상위 10개사", Math.round(conc(10))], ["11~100위", Math.round(conc(100) - conc(10))], ["기타", Math.round(100 - conc(100))]], ["#3b6fe0", "#16a06a", "#c5cad3"], "%")}</section>
      </div>
      <footer class="sl-foot"><h3>종합 분석 및 시사점</h3><ul>${bullets.join("")}</ul></footer>`;
  }

  // ---------- 2장 ----------
  const row = (label, s) => `<tr><th scope="row">${esc(label)}</th><td>${s.n}</td><td>${jo(s.s1)}</td><td>${s.n ? jo(s.avg) : "-"}</td><td class="${tone(s.g)}">${sg(s.g)}</td><td>${pc(s.m)}</td><td>${pc(s.medM)}</td><td>${pc(s.lossP, 0)}</td></tr>`;
  const head = (first) => `<thead><tr><th>${first}</th><th>업체 수</th><th>매출</th><th>업체당 평균</th><th>매출 성장률</th><th>영업이익률</th><th>이익률 중앙값</th><th>적자 비중</th></tr></thead>`;
  function quadrant() {
    const T = SB.TYPES, cells = Object.fromEntries(T.map((t) => [t, []]));
    annual.forEach((r) => cells[r.type] && cells[r.type].push(r));
    const box = (k, sub, cls) => {
      const l = cells[k];
      return `<div class="rp-q ${cls}"><p>${k}<small>${sub}</small></p><strong>${l.length}곳 <em>${pc(share(l.length, annual.length), 0)}</em></strong><span>${esc(l.sort((a, b) => b.s1 - a.s1).slice(0, 3).map((r) => r.n).join(" · ") || "-")}</span></div>`;
    };
    return `<div class="rp-quad"><div class="rp-axis y">영업이익률 ${HI_MARGIN}% 기준</div>
      ${box(T[1], `성장 ${HI_GROWTH}% 미만 · 이익률 ${HI_MARGIN}% 이상`, "t1")}${box(T[0], `성장 ${HI_GROWTH}% 이상 · 이익률 ${HI_MARGIN}% 이상`, "t0")}${box(T[3], `성장 ${HI_GROWTH}% 미만 · 이익률 ${HI_MARGIN}% 미만`, "t3")}${box(T[2], `성장 ${HI_GROWTH}% 이상 · 이익률 ${HI_MARGIN}% 미만`, "t2")}
      <div class="rp-axis x">매출 성장률 ${HI_GROWTH}% 기준</div></div>`;
  }
  function slide2() {
    const kinds = [...SB.KINDS].map((k) => [k, annual.filter((r) => r.kind === k)]).filter(([, l]) => l.length);
    const est = annual.filter((r) => r.kindEst).length;
    const ls = [["상장사", annual.filter((r) => r.l)], ["비상장사", annual.filter((r) => !r.l)]];
    const best = kinds.filter(([k]) => k !== NA).map(([k, l]) => [k, stats(l)]).sort((a, b) => b[1].g - a[1].g);
    const L = stats(ls[0][1]), U = stats(ls[1][1]);
    const hiM = best.slice().sort((a, b) => b[1].m - a[1].m)[0];
    const bullets = [
      best.length > 1 ? bullet(`성장 1위 <b>${best[0][0]}</b>(${sg(best[0][1].g)}), 수익성 1위 <b>${hiM[0]}</b>(${pc(hiM[1].m)}).`, best[0][0] === hiM[0] ? `${best[0][0]} 업종이 성장과 수익성 모두 앞서 있습니다.` : "성장과 수익성의 선두 업종이 달라 업종별 대응이 필요합니다.") : "",
      L.n && U.n ? bullet(`영업이익률 상장 ${pc(L.m)} · 비상장 ${pc(U.m)}, 성장률 ${sg(L.g)} · ${sg(U.g)}.`, Math.abs(L.g - U.g) < 3 ? "상장 여부에 따른 성장 격차는 크지 않습니다." : `${L.g > U.g ? "상장사" : "비상장사"}의 성장이 빠릅니다.`) : "",
      bullet(`매출 상위 10% 성장률 ${sg(gTop)} · 하위 50% ${sg(gLow)}, 이익률 10%↑ 업체 ${prevHiM} → ${curHiM}곳, 적자 업체 ${prevLoss} → ${A.loss}곳.`, Math.abs(gTop - gLow) >= 5 ? "규모에 따른 성장 양극화가 나타납니다." : "규모별 성장 격차는 크지 않습니다."),
      bullet(`매출 감소와 영업적자가 겹친 업체 <b>${weak.length}곳</b>${qPanel.length ? `, 최근 4분기 연속 적자(상장) ${q4loss.length}곳` : ""}.`, weak.length ? "상생협력 지원 우선 검토 대상이며, 일회성 요인 여부를 개별 확인해야 합니다." : ""),
    ].filter(Boolean);
    return `
      <header class="sl-head"><div><p class="sl-tag">2 / 2 · 업종별${L.n && U.n ? "·상장 여부별" : ""}</p><h2>소부장 업종별 경쟁력 및 경영 격차</h2></div>
        <p class="sl-meta">${esc(SB.describe(st))} · 분석대상 ${A.n}개사 · 업종 추정 ${est}곳 포함</p></header>
      <div class="sl-body two">
        <section class="sl-col"><h3>업종별 경영실적</h3><table class="sl-table">${head("구분")}<tbody>${kinds.map(([k, l]) => row(k, stats(l))).join("")}</tbody></table>
          ${L.n && U.n ? `<h3>상장·비상장 경영실적 비교</h3><table class="sl-table">${head("구분")}<tbody>${ls.map(([k, l]) => row(k, stats(l))).join("")}</tbody></table>` : ""}</section>
        <section class="sl-col"><h3>성장성·수익성 기반 업체 분류 <small>업체 ${A.n}곳</small></h3>${quadrant()}</section>
      </div>
      <footer class="sl-foot"><h3>종합 분석 및 시사점</h3><ul>${bullets.join("")}</ul></footer>`;
  }

  // ---------- 화면 ----------
  function fit() {
    document.querySelectorAll(".rp-stage").forEach((st) => {
      const sl = st.firstElementChild, k = Math.min(1, Math.max(window.innerWidth < 640 ? 0.2 : 0.55, st.clientWidth / 1280)); // 휴대폰은 한 장 전체가 보이게 맞춤
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
    $("lead").innerHTML = `조건: <strong>${esc(SB.describe(st))}</strong>. 연간 실적이 있는 ${A.n}곳을 대시보드와 같은 산식으로 정리했습니다. 분기 실적은 상장 ${qPanel.length}곳만 있습니다.`;
    $("basis").textContent = `기준 데이터 DART ${META.updated || "-"} · 생성 ${new Date().toLocaleString("ko-KR")} · ${bigNote}`;
    const qs = SB.toQuery(st);
    $("back").href = `dashboard.html${qs ? `?${qs}` : ""}#report`;
    $("formulas").innerHTML = SB.FORMULAS.map((f) => `<li>${f}</li>`).join("");
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
    const rows = [["업체코드", "업체명", "상장", "업종", "업종추정", "지역", "기간", "매출액(억원)", "영업이익(억원)", "당기순이익(억원)"]];
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
