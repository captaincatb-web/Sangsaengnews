"use strict";
// 브라우저 기반 화면 검사(Playwright): 360·390·768·1440px에서 메뉴·제목 위치·가로 넘침·카드/표·필터·다크모드·수집 현황을 확인한다.
// 외부 데이터에 영향을 받지 않도록 저장소의 고정 데이터와 시험용 해외 수집 자료(peers.js 대체)만 쓴다. 가격 값 자체는 검사하지 않는다.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const SITE = path.join(__dirname, "..", "site");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".svg": "image/svg+xml" };
const mk = (k, n, ctry, cat, src, st, why) => ({ k, n, ctry, cat, kind: cat, seg1: "증착", tk: k.toUpperCase(), src, st, why });
const M = [mk("a", "AMAT", "US", "장비", "SEC EDGAR", "확보", ""), mk("b", "TEL", "JP", "장비", "야후 파이낸스", "일부 확보", "영업이익 없음"), mk("c", "Soitec", "FR", "소재", "야후 파이낸스", "접속 실패", "시간 초과")];
const rec = (m, s, o, ni) => ({ ...m, url: "https://example.com/" + m.k, scope: "연결", cur: "USD", mt: 12, y: [2024, 2025], pe: ["2024-12-31", "2025-12-31"], s: [1, s], o: [1, o], ni: [1, ni], at: "2026-11-02T22:00:00Z", loc: { s: [1, s], o: [1, o], ni: [1, ni], ta: [1, 1], tl: [1, 1], te: [1, 1] }, q: null });
const PEERS = { updated: "2026-11-02", at: "2026-11-02T22:00:00Z", sec: "blocked", master: M, list: [rec(M[0], 100, 20, 10), rec(M[1], 90, null, 5)] };

let server, base, browser;
test.before(async () => {
  server = http.createServer((req, res) => {
    const p = path.join(SITE, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
    if (!p.startsWith(SITE) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" }); fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});
test.after(async () => { await browser.close(); server.close(); });

async function open(w, url, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: opts.dark ? "dark" : "light" }); const page = await ctx.newPage(); const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.route("**/data/peers.js*", (r) => r.fulfill({ contentType: "application/javascript", body: "window.PEERS=" + JSON.stringify(PEERS) + ";" }));
  await page.goto(base + url); await page.waitForTimeout(500);
  return { page, ctx, errs };
}
const PAGES = ["dashboard.html", "domestic.html#share", "compare.html", "index.html", "analysis2.html", "guide.html"];

for (const w of [360, 390, 768]) {
  test(`모바일 ${w}px: 가로 넘침 없음·메뉴 접힘·제목 위치 동일·기준일 패널 맨 아래·화면 모드 버튼 머리글`, async () => {
    const tops = new Set();
    for (const u of PAGES) {
      const { page, ctx, errs } = await open(w, u);
      const r = await page.evaluate(() => { const h = document.querySelector(".krds-header"), t = document.querySelector("h1").getBoundingClientRect().top, main = document.querySelector("main"), vis = [...main.children].filter((e) => e.offsetHeight > 0), st = document.querySelector(".site-data-status");
        return { hs: document.documentElement.scrollWidth > innerWidth, gnb: document.querySelector("nav.gnb").offsetHeight > 0, menu: !!document.getElementById("site-menu") && document.getElementById("site-menu").offsetHeight > 0, top: Math.round(t), statusLast: vis[vis.length - 1] === st, themeInHeader: !!h.querySelector("#theme-btn, .th-btn, .th-icon") }; });
      assert.equal(r.hs, false, `${u} 가로 넘침`); assert.equal(r.gnb, false, `${u} 상단 메뉴가 접혀 있어야 함`); assert.equal(r.menu, true, `${u} 메뉴 버튼`);
      assert.equal(r.statusLast, true, `${u} 데이터 기준일 패널은 본문 맨 아래`); assert.equal(r.themeInHeader, true, `${u} 화면 모드 버튼은 머리글`);
      tops.add(r.top); assert.deepEqual(errs, [], `${u} 스크립트 오류`);
      await page.click("#site-menu"); assert.equal(await page.evaluate(() => document.querySelector("nav.gnb").offsetHeight > 0), true, `${u} 메뉴 열림`);
      await ctx.close();
    }
    assert.equal(tops.size, 1, `제목 시작 위치가 화면마다 같아야 함: ${[...tops]}`);
  });
}

test("PC 1440px: 상단 메뉴 표시·메뉴 버튼 없음·가로 넘침 없음·오류 없음", async () => {
  for (const u of PAGES) {
    const { page, ctx, errs } = await open(1440, u);
    const r = await page.evaluate(() => ({ hs: document.documentElement.scrollWidth > innerWidth, gnb: document.querySelector("nav.gnb").offsetHeight > 0, menu: getComputedStyle(document.getElementById("site-menu") || document.body).display !== "none" && !!document.getElementById("site-menu"), theme: !!document.querySelector(".krds-header #theme-btn, .krds-header .th-btn") }));
    assert.deepEqual([r.hs, r.gnb, r.menu, r.theme], [false, true, false, true], u); assert.deepEqual(errs, [], u); await ctx.close();
  }
});

test("국내 소부장 기업별 시총: 모바일은 카드·PC는 표, 160곳, 구분·속성 필터, 별도 관리 29곳", async () => {
  const { page, ctx, errs } = await open(390, "domestic.html#caps");
  assert.equal(await page.locator(".cp-card").count(), 160);
  assert.deepEqual(await page.evaluate(() => [getComputedStyle(document.querySelector(".cp-cards")).display, getComputedStyle(document.querySelector(".cp-tblwrap")).display]), ["grid", "none"]);
  const n = async (sel, v) => { await page.selectOption(sel, v); return page.locator(".cp-card").count(); };
  assert.equal(await n("#cp-g", "N"), 37); await page.selectOption("#cp-g", "");
  assert.equal(await n("#cp-g", "E"), 123); await page.selectOption("#cp-g", "");
  assert.equal(await n("#cp-at", "infra"), 4); assert.equal(await n("#cp-at", "big"), 3); await page.selectOption("#cp-at", "");
  await page.locator(".cp-card summary").first().click(); assert.equal(await page.locator(".cp-card[open] .cp-dl").count(), 1);
  await page.evaluate(() => (document.querySelector(".cp-managed").open = true));
  assert.equal(await page.locator(".cp-mg li").count(), 29); assert.deepEqual(await page.locator(".cp-managed h4").allInnerTexts(), ["보류 22개사", "OSAT(후공정 서비스) 4개사", "유통 3개사"]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.deepEqual(errs, []); await ctx.close();
  const d = await open(1440, "domestic.html#caps");
  assert.equal(await d.page.evaluate(() => [getComputedStyle(document.querySelector(".cp-cards")).display, document.querySelectorAll(".cp-tbl tbody tr").length]).then((x) => x.join()), "none,160"); await d.ctx.close();
});

test("국내 소부장 시장 비중: 대형 겸업 포함 필터가 코스피 상자 값을 바꾸고 되돌림", async () => {
  const { page, ctx } = await open(390, "domestic.html#share");
  const head = () => page.locator(".ms-mk").first().locator("header p").first().innerText();
  const a = await head(); await page.locator('input[data-big="KOSPI"]').uncheck(); const b = await head(); assert.notEqual(a, b);
  await page.locator('input[data-big="KOSPI"]').check(); assert.equal(await head(), a); await ctx.close();
});

test("해외 비교 수집 현황: KPI 6개·상세 펼침·국내 모집단 현황 분리·가로 넘침 없음", async () => {
  const { page, ctx, errs } = await open(390, "compare.html#coverage");
  assert.equal(await page.locator("#kpis-c > *").count(), 6); assert.equal(await page.locator(".cm-covrow").count(), 3);
  await page.locator(".cm-more").nth(1).click(); assert.match(await page.locator(".cm-det:not([hidden])").innerText(), /영업이익/);
  assert.match(await page.locator("#c-domcov").innerText(), /160곳/); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.deepEqual(errs, []); await ctx.close();
});

test("다크모드(390px): 배경이 어둡고 본문 글자와 대비가 충분", async () => {
  for (const u of ["domestic.html#caps", "index.html", "compare.html#coverage"]) {
    const { page, ctx } = await open(390, u, { dark: true });
    const c = await page.evaluate(() => { const p = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number), L = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      const bg = p(getComputedStyle(document.body).backgroundColor), fg = p(getComputedStyle(document.querySelector("h1")).color); const l1 = L(bg), l2 = L(fg); return { bgL: l1, ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }; });
    assert.ok(c.bgL < 0.2, `${u} 다크 배경`); assert.ok(c.ratio >= 4.5, `${u} 제목 대비 ${c.ratio.toFixed(1)}`); await ctx.close();
  }
});

test("하단 메뉴바: 항목 5개 이하 화면은 390px 한 화면에 모두 표시", async () => {
  for (const u of ["domestic.html#share", "index.html", "guide.html", "analysis2.html"]) {
    const { page, ctx } = await open(390, u);
    const off = await page.evaluate(() => [...document.querySelectorAll(".site-side .db-nav > li, .site-side .site-side-nav > button")].filter((e) => { const r = e.getBoundingClientRect(); return r.right > innerWidth + 0.5 || r.left < -0.5; }).length);
    assert.equal(off, 0, `${u} 하단 메뉴 넘침`); await ctx.close();
  }
});
