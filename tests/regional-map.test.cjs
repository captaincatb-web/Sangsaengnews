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
test("summary pins use province aggregates and show metric-aware labels", () => {
  const stats=[
    {name:"경기도", rows:[{},{}], v:15320},
    {name:"서울특별시",rows:[{}],v:5000},
    {name:"인천광역시",rows:[{}],v:null}
  ];
  assert.equal(U.pinLabel(62,"count"),"62");
  assert.equal(U.pinLabel(15320,"cap"),"1.5조");
  assert.equal(U.pinLabel(-3.54,"growth"),"-3.5%");
  assert.equal(U.pinLabel(null,"cap"),"—");
  assert.equal(U.pinSummaries(stats,"cap","none","경기도").length,0);
  assert.deepEqual(U.pinSummaries(stats,"cap","top","",1).map(x=>x.name),["경기도"]);
  assert.deepEqual(U.pinSummaries(stats,"cap","top","서울특별시",1).map(x=>x.name),["경기도","서울특별시"]);
  assert.equal(U.pinSummaries(stats,"cap","all","").length,2);
  // A region without cap data is still pinnable if explicitly selected.
  assert.equal(U.pinSummaries(stats,"cap","top","인천광역시",1).at(-1).label,"—");
});
test("pin layout avoids collision and stays in bounds on mobile and desktop", () => {
  const candidates=[
    {name:"경기도",label:"67",x:100,y:90},{name:"서울특별시",label:"13",x:105,y:95},
    {name:"인천광역시",label:"3",x:100,y:99},{name:"충청남도",label:"14",x:115,y:155},
    {name:"충청북도",label:"7",x:168,y:148},{name:"경상북도",label:"6",x:215,y:130}
  ];
  for(const [w,h] of [[320,340],[570,560]]) {
    const layout=U.layoutPins(candidates,w,h);
    assert.equal(layout.length,candidates.length);
    for (const q of layout) {
      assert.ok(q.x>=q.w/2 && q.x<=w-q.w/2);
      assert.ok(q.y>=q.h/2 && q.y<=h-q.h/2);
      assert.ok(q.name && q.label);
    }
    for (let i=0;i<layout.length;i++) for(let j=i+1;j<layout.length;j++){
      const a=layout[i],b=layout[j];
      const ox=(a.w+b.w)/2-Math.abs(a.x-b.x);
      const oy=(a.h+b.h)/2-Math.abs(a.y-b.y);
      assert.ok(ox<=0 || oy<=0, a.name+" overlaps "+b.name+" on "+w+"px");
    }
  }
});
test("growth summary priority includes severe declines as well as increases",()=>{
  const rows=n=>Array.from({length:n},()=>({}));
  const stats=[{name:"경기도",rows:rows(3),v:2},
    {name:"서울특별시",rows:rows(2),v:-28},
    {name:"충청북도",rows:rows(2),v:12}];
  assert.deepEqual(U.pinSummaries(stats,"growth","top","",2).map(s=>s.name),
    ["서울특별시","충청북도"]);
  assert.deepEqual(U.pinSummaries(stats,"growth","top","경기도",2).map(s=>s.name),
    ["서울특별시","충청북도","경기도"]);
});
test("rendered pin dimensions are respected, and impossible labels are omitted",()=>{
  const pts=[{name:"first",label:"100",x:60,y:45,w:95,h:44,selected:true},
    {name:"second",label:"200",x:65,y:45,w:100,h:44},
    {name:"third",label:"300",x:70,y:45,w:100,h:44}];
  const tiny=U.layoutPins(pts,120,50);
  assert.equal(tiny.length,1);
  assert.equal(tiny[0].name,"first");
  const roomy=U.layoutPins(pts,320,230);
  assert.equal(roomy.length,3);
  for(let i=0;i<roomy.length;i++)for(let j=i+1;j<roomy.length;j++){
    const a=roomy[i],b=roomy[j];
    assert.ok(Math.abs(a.x-b.x)>=(a.w+b.w)/2+5||
      Math.abs(a.y-b.y)>=(a.h+b.h)/2+5);
  }
});
test("regional breakdown preserves current financial cohort and missing cap",()=>{
  const rows=[{c:"A",l:1,kind:"소재",s1:110,s0:100},
    {c:"B",l:0,kind:"장비",s1:220,s0:200},
    {c:"C",l:1,kind:"부품",s1:330,s0:300},
    {c:"D",l:0,kind:"장비",s1:440,s0:400}];
  const d=U.regionBreakdown(rows.slice(0,3),rows,{A:{cap:5000},C:{cap:null}});
  assert.equal(d.count,3);assert.equal(d.share,75);
  assert.deepEqual(d.kinds,{소재:1,부품:1,장비:1});
  assert.equal(d.sales,660);assert.ok(Math.abs(d.growth-10)<1e-8);assert.equal(d.cap,5000);
  assert.equal(d.capCoverage.known,1);
  assert.equal(U.regionBreakdown([],rows,{}).cap,null);
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
  assert.ok(html.includes('id="sb-map-pins"'));
  assert.ok(html.includes('시·도별 집계값'));
  assert.ok(html.includes('<option value="none">숨기기</option>'));
  assert.ok(html.includes('data/market.js'));
  const map = fs.readFileSync(path.join(__dirname,"../site/dashboard-map.js"),"utf8");
  assert.ok(map.includes("window.MARKET"));
  assert.ok(map.includes("U.capCoverage"));
  assert.ok(map.includes('data-sb-pin'));
  assert.ok(map.includes('U.layoutPins'));
  assert.ok(map.includes('anchorOnProvince'));
  assert.ok(map.includes('sb-map-region-picker'));
  assert.ok(map.includes('getBoundingClientRect'));
  assert.ok(map.includes('regionBreakdown'));
  assert.ok(html.includes('sb-map-announcement'));
  assert.ok(html.includes('sb-map-pin-status'));
  assert.ok(html.indexOf('dashboard-map-utils.js')<html.indexOf('dashboard-map.js'));
  assert.ok(html.indexOf('dashboard-map.js')<html.indexOf('dashboard.js'));
  assert.ok(html.includes('id="f-area"'));
  assert.ok(js.includes('window.SobujangMap.render(rows, state.fy)'));
  assert.ok(!html.includes('id="f-sido"'));
});
