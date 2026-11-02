"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const U = require("../site/dashboard-map-utils.js");

test("all 17 province names can be normalized from their original labels", () => {
  assert.equal(U.regions.length, 17);
  assert.equal(new Set(U.regions).size, 17);
  for (const name of U.regions) assert.equal(U.provinceOf(name + " 회사 주소"), name);
});
test("legacy names, abbreviations and postal codes are matched conservatively", () => {
  const cases = {
    "서울시 마포구": "서울특별시",
    "경기 성남시": "경기도",
    "인천광역시 남동구": "인천광역시",
    "강원도 원주시": "강원특별자치도",
    "전라북도 군산시": "전북특별자치도",
    "[12345] 제주 제주시": "제주특별자치도",
    "(12345) 대전광역시 유성구": "대전광역시",
    "세종시 조치원읍": "세종특별자치시"
  };
  for (const [address, expected] of Object.entries(cases)) assert.equal(U.provinceOf(address), expected);
  for (const address of ["", "소재지 불명", "경기도광주시 퇴촌면", "광주시 태전동", "대전 대덕구 공장", null, undefined]) {
    // '대전 대덕구 공장' is explicit province prefix and is intentionally accepted.
    if (address === "대전 대덕구 공장") assert.equal(U.provinceOf(address), "대전광역시");
    else assert.equal(U.provinceOf(address), null);
  }
});
test("companies are counted exactly once and unrecognized addresses are not guessed", () => {
  const rows = [
    {c:"1", ad:"경기도 성남시",s1:110,s0:100},
    {c:"2", ad:"인천광역시 남동구",s1:90,s0:100},
    {c:"3", ad:"확인 불가",s1:120,s0:100},
    {c:"4", ad:"",s1:80,s0:100}
  ];
  const g = U.group(rows);
  const assigned=Object.values(g.byProvince).reduce((n,x)=>n+x.length,0);
  assert.equal(assigned+g.unknown.length,rows.length);
  assert.equal(g.byProvince["경기도"].length,1);
  assert.equal(g.byProvince["인천광역시"].length,1);
  assert.equal(g.unknown.length,2);
});
test("financial aggregation uses sums, not mean of company growth rates", () => {
  const a=[{s1:150,s0:100},{s1:250,s0:200}];
  assert.equal(U.metric(a,"count"),2);
  assert.equal(U.metric(a,"sales"),400);
  assert.ok(Math.abs(U.metric(a,"growth") - 33.33333333)<1e-6);
  assert.equal(U.metric([],"growth"),null);
  assert.equal(U.metric([],"count"),0);
});
test("market-cap metric matches DART codes, excludes unlisted/missing and preserves 억원 units", () => {
  const rows = [
    {c:"corp1", l:1, s1:130, s0:120},
    {c:"corp2", l:1, s1:200, s0:180},
    {c:"corp3", l:0, s1:75, s0:70},
    {c:"corp4", l:1, s1:80, s0:75},
    {c:"corp5", l:1, s1:90, s0:80}
  ];
  const market = {corp1:{cap:12000}, corp2:{cap:3500}, corp3:{cap:99999},
    corp4:{cap:0}, corp5:{cap:null}};
  assert.equal(U.capOf(rows[0], market),12000);
  assert.equal(U.capOf(rows[2], market),null);
  assert.equal(U.capOf(rows[3], market),null);
  assert.equal(U.metric(rows,"cap",market),15500);
  assert.equal(U.metric(rows,"count",market),5);
  assert.equal(U.metric([rows[2],rows[3]],"cap",market),null);
  assert.deepEqual(U.capCoverage(rows,market),{listed:4,known:2,missing:2,unlisted:1});
  assert.equal(U.metric(rows,"cap",{}),null);
  assert.equal(U.metric([], "cap",market),null);
  assert.equal(U.color(null,"cap",100,true),"#dce5df");
  assert.equal(U.color(100,"cap",100,true),"rgba(31,111,102,0.92)");
});
test("growth choropleth distinguishes negative, positive, zero and missing", () => {
  assert.match(U.color(-15,"growth",30,true), /^rgba\(187,75,67,/);
  assert.match(U.color(15,"growth",30,true), /^rgba\(31,111,102,/);
  assert.equal(U.color(0,"growth",30,true),"#a5b8b0");
  assert.equal(U.color(null,"growth",30,true),"#dce5df");
  assert.equal(U.color(100,"sales",100,true),"rgba(31,111,102,0.92)");
});
test("source SVG has exactly 17 allowed, unique province paths", () => {
  const src=fs.readFileSync(path.join(__dirname,"../site/data/geo/korea-sido.svg"),"utf8");
  const ids=[...src.matchAll(/<path\b[^>]*\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,17);
  assert.equal(new Set(ids.map(n=>U.canonical(n))).size,17);
  assert.ok(ids.every(n=>U.canonical(n)));
});
test("dashboard integration is additive and preserves original filters", () => {
  const html=fs.readFileSync(path.join(__dirname,"../site/dashboard.html"),"utf8");
  const js=fs.readFileSync(path.join(__dirname,"../site/dashboard.js"),"utf8");
  assert.ok(html.includes('id="v-industry"'));
  assert.ok(html.includes('id="sb-map"'));
  assert.ok(html.includes('<option value="cap">시가총액</option>'));
  assert.ok(html.includes('data/market.js'));
  const map = fs.readFileSync(path.join(__dirname,"../site/dashboard-map.js"),"utf8");
  assert.ok(map.includes("window.MARKET"));
  assert.ok(map.includes("U.capCoverage"));
  assert.ok(html.indexOf('dashboard-map-utils.js')<html.indexOf('dashboard-map.js'));
  assert.ok(html.indexOf('dashboard-map.js')<html.indexOf('dashboard.js'));
  assert.ok(html.includes('id="f-area"'));
  assert.ok(js.includes('window.SobujangMap.render(rows, state.fy)'));
  assert.ok(!html.includes('id="f-sido"'));
});
