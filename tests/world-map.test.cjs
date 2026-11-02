"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const U=require("../site/compare-world-map-utils.js");
test("world map includes 170+ unique countries including all 7 existing overseas markets",()=>{
  const text=fs.readFileSync(path.join(__dirname,"../site/data/geo/world-110m.svg"),"utf8");
  const ids=[...text.matchAll(/<path data-iso="([^"]+)"/g)].map(m=>m[1]);
  assert.ok(ids.length>=170);
  assert.equal(new Set(ids).size,ids.length);
  for(const country of ["US","JP","NL","DE","FR","IL","CN"])
    assert.ok(ids.includes(country),country+" missing");
  assert.equal((text.match(/<script/g)||[]).length,0);
  assert.match(text,/data-source="Natural Earth 1:110m/);
});
test("country grouping derives solely from currently filtered overseas peers",()=>{
  const rows=[
    {p:{ctry:"US"},s1:120,s0:100},
    {p:{ctry:"US"},s1:200,s0:100},
    {p:{ctry:"JP"},s1:50,s0:null},
    {p:{ctry:"KR"},s1:1000,s0:500},
    {p:{ctry:"??"},s1:90,s0:80}
  ].filter(r=>r.p.ctry!=="KR");
  const c=U.countryGroups(rows);
  assert.deepEqual(Object.keys(c).sort(),["JP","US"]);
  assert.equal(c.US.n,2);
  assert.equal(c.US.sales,320);
  assert.ok(Math.abs(c.US.growth-60)<1e-9);
  assert.equal(c.US.growthKnown,2);
  assert.equal(c.JP.growth,null);
  assert.equal(c.JP.salesKnown,1);
});
test("missing sales is not represented as a valid zero amount",()=>{
  const c=U.summarize([{p:{ctry:"FR"},s1:null,s0:null}]);
  assert.equal(c.n,1);
  assert.equal(c.sales,null);
  assert.equal(c.growth,null);
  assert.equal(U.label(null,"sales"),"자료 없음");
  assert.equal(U.fill(null,"sales",100),"#d7dfe2");
  assert.match(U.label(10000,"sales"),/조$/);
  assert.equal(U.label(12,"count"),"12곳");
  assert.equal(U.label(-5,"growth"),"-5.0%");
});
test("country pin collision layout respects bounds and never overlaps",()=>{
  const pts=[
    {code:"NL",x:153,y:112,w:82,h:40},{code:"DE",x:156,y:116,w:86,h:40},
    {code:"FR",x:150,y:120,w:80,h:40},{code:"IL",x:172,y:150,w:79,h:40}
  ];
  for(const [w,h] of [[320,190],[700,350]]){
    const v=U.layoutPins(pts,w,h);
    assert.ok(v.length>0);
    for(const p of v){assert.ok(p.x>=p.w/2&&p.x<=w-p.w/2);assert.ok(p.y>=p.h/2&&p.y<=h-p.h/2)}
    for(let i=0;i<v.length;i++)for(let j=i+1;j<v.length;j++){
      const a=v[i],b=v[j];
      assert.ok(Math.abs(a.x-b.x)>=(a.w+b.w)/2+5 ||
        Math.abs(a.y-b.y)>=(a.h+b.h)/2+5, a.code+" overlaps "+b.code);
    }
  }
});
test("world map integrated into overseas overview without altering six existing screens",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../site/compare.html"),"utf8");
  const source=fs.readFileSync(path.join(__dirname,"../site/compare.js"),"utf8");
  const js=fs.readFileSync(path.join(__dirname,"../site/compare-world-map.js"),"utf8");
  assert.ok(html.includes('id="cm-world"'));
  assert.ok(html.includes('id="v-overview"'));
  assert.ok(html.indexOf("compare-world-map-utils.js")<html.indexOf("compare-world-map.js"));
  assert.ok(html.indexOf("compare-world-map.js")<html.indexOf("compare.js"));
  assert.ok(html.includes('value="sales"')&&html.includes('value="growth"'));
  assert.ok(source.includes("window.CompareWorldMap.render(kindRows, state.ctry)"));
  assert.ok(source.includes("render(true)"));
  assert.ok(source.includes('f-ctry'));
  for(const view of ["overview","perf","company","stock","coverage","domestic"])
    assert.ok(html.includes('id="v-'+view+'"'));
  assert.ok(js.includes("data/geo/world-110m.svg"));
  assert.ok(js.includes("DOMParser"));
  assert.ok(!js.includes("eval("));
});
