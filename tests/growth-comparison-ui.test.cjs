"use strict";
// 성장 비교 화면(growth-comparison.html) 브라우저 검사: 360·1200px에서 오류·가로 넘침·필터·차트 재그리기·값 전환·테마 전환.
// 사용: SITE_DIR=<site 복사본> node --test tests/growth-comparison-ui.test.cjs  (기본은 저장소 site/)
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const SITE = process.env.SITE_DIR ? path.resolve(process.env.SITE_DIR) : path.join(__dirname, "..", "site");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff" };
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

async function open(w, dark) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: dark ? "dark" : "light" }); const page = await ctx.newPage(); const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  page.on("response", (r) => { const u = new URL(r.url()); if (r.status() >= 400 && r.url().startsWith(base) && !u.pathname.endsWith("/favicon.ico")) errs.push(r.status() + " " + u.pathname); });
  await page.goto(base + "growth-comparison.html"); await page.waitForSelector("#chart svg", { timeout: 8000 }); await page.waitForTimeout(400);
  return { page, ctx, errs };
}

for (const w of [360, 1200]) {
  test(`성장 비교 화면 ${w}px`, async () => {
    const { page, ctx, errs } = await open(w);
    assert.deepEqual(errs, [], "콘솔 오류·404 없음");
    assert.ok((await page.locator("#chart svg").count()) >= 1, "차트 svg");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "가로 넘침 없음");
    const sel = await page.locator("#filters select").count(); assert.equal(sel, 6, "필터 6개");
    // 차트 안의 글자가 서로 겹치지 않는지(같은 svg 안 텍스트 상자 교차) — 막대 값 라벨은 막대 위에 놓이므로 제외하고 라벨끼리만 본다
    const overlaps = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll("#chart svg").forEach((svg, si) => {
        const ts = [...svg.querySelectorAll("text")].filter((t) => t.textContent.trim()).map((t) => ({ t: t.textContent, b: t.getBoundingClientRect() }));
        for (let i = 0; i < ts.length; i++) for (let k = i + 1; k < ts.length; k++) {
          const a = ts[i].b, b = ts[k].b, ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 2 && oy > 2) out.push(si + ":" + ts[i].t + "/" + ts[k].t);
        }
      });
      return out;
    });
    assert.deepEqual(overlaps, [], "차트 글자 겹침 없음");
    const txt = await page.evaluate(() => document.body.innerText);
    assert.ok(!/외국계 –|국내 소재 외국계/.test(txt), "3그룹 잔재(외국계 –) 없음");
    assert.ok(/현재 조건/.test(await page.locator("#result").innerText()), "결과 줄 표시");
    assert.ok((await page.locator("#ptbl").innerText()).includes("%p"), "수익성 변화 표에 %p 표기");
    assert.ok((await page.locator("#ptbl tr.gc-gap").count()) >= 1, "격차 행");
    assert.equal(await page.locator("#chart .gc-panel").first().locator("svg").count(), 2, "패널마다 매출·영업이익률 차트 분리");
    const groups = await page.evaluate(async () => (await (await fetch("data/growth-comparison-summary.json")).json()).groups.length);
    assert.equal(await page.locator("#legend li").count(), groups, "범례 수 = 그룹 수(데이터 기반)");
    await ctx.close();
  });
}

test("필터·값 전환·테마 전환", async () => {
  const { page, ctx, errs } = await open(1200);
  const row = await page.evaluate(() => { const ys = [...document.querySelectorAll("#filters select")].map((s) => Math.round(s.closest("label").getBoundingClientRect().top)); return new Set(ys).size; });
  assert.equal(row, 1, "필터 6개가 한 줄");
  const before = await page.locator("#chart .gc-panel").count();
  await page.selectOption("#f-chart", { index: 1 }); await page.waitForTimeout(250);
  assert.equal(await page.locator("#chart .gc-panel").count(), 1, "분류 선택 시 패널 1개");
  assert.ok(before > 1, "전체는 여러 패널");
  const d1 = page.locator("#f-d1");
  if (!(await d1.isDisabled())) {
    await d1.selectOption({ index: 1 }); await page.waitForTimeout(250);
    const need = await page.evaluate(async () => { const j = await (await fetch("data/growth-comparison-summary.json")).json(); const m = j.coverage.detail_missing["소재"] || {}; return Object.values(m).some((v) => v.no_detail > 0); });
    const shown = await page.locator("#detail-note").isVisible();
    assert.equal(shown, need, "상세구분이 없는 기업이 있으면 안내 표시");
    assert.ok(/현재 조건/.test(await page.locator("#result").innerText()), "필터 변경 시 결과 줄 갱신");
  }
  await page.selectOption("#f-chart", ""); await page.selectOption("#f-mode", "sum"); await page.waitForTimeout(250);
  assert.match(await page.locator("#chart svg").first().textContent(), /매출 합계/, "값 전환(합계)");
  await page.selectOption("#f-mode", "idx"); await page.waitForTimeout(250);
  assert.match(await page.locator("#chart svg").first().textContent(), /매출지수/, "값 전환(지수)");
  const t0 = await page.evaluate(() => document.documentElement.dataset.theme || "");
  await page.click("#theme-btn"); await page.waitForTimeout(150);
  const t1 = await page.evaluate(() => document.documentElement.dataset.theme || "");
  assert.notEqual(t0, t1, "테마 전환"); assert.deepEqual(errs, []);
  await ctx.close();
});

for (const w of [360, 1200]) {
  test(`비교 모드 선택 ${w}px`, async () => {
    const { page, ctx, errs } = await open(w);
    const modes = await page.evaluate(async () => (await (await fetch("data/growth-comparison-summary.json")).json()).modes || []);
    const opts = await page.locator("#f-view option").count();
    assert.equal(opts, modes.length || 1, "비교 기준 선택지 수 = JSON 모드 수");
    if (modes.length >= 3) assert.equal(opts, 3, "모드 3종");
    const seen = new Set();
    for (let i = 0; i < Math.max(modes.length, 1); i++) {
      if (modes.length) await page.selectOption("#f-view", { index: i }); await page.waitForTimeout(350);
      const cap = await page.locator("#mode-note").innerText();
      assert.ok(/이 비교의 재무 범위/.test(cap) && cap.length > 20, "재무 범위 설명이 항상 보임");
      seen.add(cap);
      assert.ok(await page.locator("#mode-note").isVisible(), "설명 표시");
      assert.ok(/비교 대상/.test(await page.locator("#mode-count").innerText()), "모드별 기업 수 줄");
      assert.ok((await page.locator("#chart svg").count()) >= 1 || /공개 기준/.test(await page.locator("#chart").innerText()), "차트 또는 공개 기준 미달 안내");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `모드 ${i} 가로 넘침 없음`);
      const labels = await page.locator("#legend li").allInnerTexts();
      if (modes.length) for (const g of modes[i].groups) assert.ok(labels.some((t) => t.includes(g.label)), "범례가 모드 그룹 라벨을 사용");
      assert.equal(await page.locator("#filters select").count(), 6, "필터 6개 유지");
    }
    if (modes.length > 1) assert.ok(seen.size > 1, "모드를 바꾸면 설명이 바뀜");
    assert.equal(await page.locator("#f-base").count(), 0, "옛 국내 기준 선택 제거");
    assert.deepEqual(errs, [], "콘솔 오류·404 없음");
    await ctx.close();
  });
}
