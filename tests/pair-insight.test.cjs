"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const source=fs.readFileSync(path.join(__dirname,"../site/pair-compare.js"),"utf8");
const start=source.indexOf("function insight(dm,gl){");
const end=source.indexOf("\nfunction csv()",start);
assert.ok(start>=0&&end>start,"성장 요인 분석 함수");
const insightSrc=source.slice(start,end);

function company(side,g,i,name,rr,oo,parent){
 return {side,g,i,key:parent||name,e:{n:name,...(parent?{p:{n:parent}}:{})},row:{r:[rr[0],rr[0],rr[1]],o:[oo[0],oo[0],oo[1]]}};
}
function render(rows,filters={},kr=false){
 const controls={"pc-insight":{innerHTML:""},"pc-insight-cond":{textContent:""}};
 const state={g:"",i:"",q:"",...filters};
 const scope={
  $:id=>controls[id],
  state:()=>state,sdiOff:()=>false,krMode:()=>kr,
  uniqSum:list=>{const used=new Set();return list.filter(x=>x.row&&!used.has(x.key)&&!!used.add(x.key))},
  margin:(o,r)=>r?o/r*100:null,
  pct:v=>v==null?"–":v.toFixed(1)+"%",
  pp:v=>(v>0?"+":"")+v.toFixed(1)+"%p",
  chartMoney:v=>v>=1000?(v/10000).toFixed(2).replace(/\.?0+$/,"")+"조":Math.round(v)+"억",
  esc:v=>String(v==null?"":v).replace(/[&<>"]/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[t]))
 };
 vm.createContext(scope);
 vm.runInContext(insightSrc,scope,{filename:"pair-compare.js"});
 scope.insight(rows.filter(x=>x.side==="dom"),rows.filter(x=>x.side==="glo"));
 return controls["pc-insight"].innerHTML;
}

test("전체 선택: 설비·부품·원재료 중 절대 실적 기여도가 가장 큰 구분 설명",()=>{
 const rows=[
  company("dom","설비","전공정","세메스",[100,110],[10,14]),
  company("dom","부품","부품","코미코",[100,120],[10,13]),
  company("dom","원재료","PCB/소자","심텍",[100,180],[10,35]),
  company("glo","설비","전공정","ASML",[100,190],[10,35]),
  company("glo","부품","부품","싸이머코리아",[100,140],[10,18],"ASML"),
  company("glo","원재료","웨이퍼","GlobalWafers",[100,125],[10,11])
 ];
 const html=render(rows);
 assert.match(html,/<b>원재료<\/b>\([^)]*\) 매출 증가 주도/,"국내 전체의 매출 증가 원인=원재료");
 assert.match(html,/성장·감소 요인/);
 assert.doesNotMatch(html,/품목별 특징/);
 assert.match(html,/<b>설비<\/b>/,"글로벌 중복 본사 실적은 먼저 선택된 구분에 배정");
});

test("설비 선택: 전공정·후공정 세부 품목을 기준으로 설명",()=>{
 const r=[
  company("dom","설비","전공정","세메스",[100,120],[10,12]),
  company("dom","설비","후공정","와이씨",[100,160],[10,30]),
  company("glo","설비","전공정","ASML",[100,140],[10,25]),
  company("glo","설비","후공정","DISCO",[100,110],[10,13])
 ];
 const html=render(r,{g:"설비"});
 assert.match(html,/<b>후공정<\/b>/);
 assert.match(html,/<b>전공정<\/b>/);
 assert.doesNotMatch(html,/<b>와이씨<\/b>/,"구분 단위에서는 회사가 아니라 품목 기여도");
});

test("원재료 선택: PCB/소자 성장과 특수가스 감소를 기여 문장으로 설명",()=>{
 const r=[
  company("dom","원재료","PCB/소자","심텍",[100,200],[10,45]),
  company("dom","원재료","특수가스","후성",[100,80],[10,5]),
  company("glo","원재료","PCB/소자","Murata",[100,150],[10,15]),
  company("glo","원재료","웨이퍼","SUMCO",[100,75],[10,2])
 ];
 const html=render(r,{g:"원재료"});
 assert.match(html,/<b>PCB\/소자<\/b>\([^)]*\) 매출 증가 주도/);
 assert.match(html,/<b>특수가스<\/b>\([^)]*\) 일부 상쇄/);
 assert.match(html,/영업이익도 <b>PCB\/소자<\/b>\([^)]*\) 최대 증가/);
});

test("품목까지 선택: 해당 품목의 업체 증감액 기준으로 설명",()=>{
 const r=[
  company("dom","원재료","PCB/소자","심텍",[100,110],[10,13]),
  company("dom","원재료","PCB/소자","삼성전기",[100,160],[10,30]),
  company("glo","원재료","PCB/소자","Murata",[100,120],[10,18])
 ];
 const html=render(r,{g:"원재료",i:"PCB/소자"});
 assert.match(html,/<b>삼성전기<\/b>\([^)]*\) 매출 증가 주도/);
 assert.doesNotMatch(html,/<b>PCB\/소자<\/b>\([^)]*\)의 매출 증가/);
});

test("부품 선택: ASML 본사 연결 매출을 부품 자체의 성장 원인으로 기술하지 않음",()=>{
 const r=[
  company("dom","부품","부품","코미코",[100,155],[10,22]),
  company("dom","부품","부품","싸이노스",[100,110],[10,12]),
  company("glo","부품","부품","싸이머코리아",[100,145],[10,24],"ASML"),
  company("glo","부품","부품","MKS Instruments",[100,120],[10,19])
 ];
 const html=render(r,{g:"부품"});
 assert.match(html,/<b>코미코<\/b>\([^)]*\) 매출 증가 주도/);
 assert.match(html,/장비 등 본사 전체 실적이 포함돼/);
 assert.doesNotMatch(html,/<b>ASML<\/b>/);
 assert.doesNotMatch(html,/<b>KLA<\/b>/);
 const krHtml=render(r,{g:"부품"},true);
 assert.doesNotMatch(krHtml,/장비 등 본사 전체 실적이 포함돼/);
 assert.match(krHtml,/<b>싸이머코리아<\/b>/,"한국 법인 모드에서는 현지 법인 이름으로 설명");
});

function title(rows,filters={}){const m=render(rows,filters).match(/<div class="pc-ins-summary"><strong>([^<]*)<\/strong>/);return m?m[1]:""}

test("결론 문장: 국내·글로벌 증감 조합별로 자연스럽게 달라지고 감소를 '증가율 우위'로 쓰지 않음",()=>{
 const mk=(dr,do_,gr,go)=>[company("dom","원재료","PCB/소자","A",[100,dr],[10,do_]),company("glo","원재료","PCB/소자","B",[100,gr],[10,go])];
 assert.equal(title(mk(116,13,109,8)),"국내 업체는 글로벌보다 매출이 더 많이 늘었고, 영업이익은 국내가 증가한 반면 글로벌은 감소했습니다.");
 assert.equal(title(mk(130,15,110,12)),"국내 업체는 글로벌보다 매출이 더 많이 늘었고, 영업이익도 국내가 더 크게 증가했습니다.");
 assert.equal(title(mk(110,12,130,15)),"글로벌이 국내보다 매출이 더 많이 늘었고, 영업이익도 글로벌이 더 크게 증가했습니다.");
 assert.equal(title(mk(110,16,130,13)),"글로벌이 국내보다 매출이 더 많이 늘었고, 영업이익은 국내가 더 크게 증가했습니다.");
 assert.equal(title(mk(120,12,90,8)),"국내 업체는 매출이 늘었지만 글로벌은 줄었고, 영업이익은 국내가 증가한 반면 글로벌은 감소했습니다.");
 assert.equal(title(mk(90,8,120,12)),"국내 업체는 매출이 줄었지만 글로벌은 늘었고, 영업이익은 국내가 감소한 반면 글로벌은 증가했습니다.");
 assert.match(title(mk(90,8,80,7)),/^국내와 글로벌 모두 매출이 줄었지만 국내의 감소폭이 더 작고, 영업이익은 양쪽 모두 나빠졌/);
 assert.match(title(mk(120,12,110,-5)),/영업이익은 국내가 증가한 반면 글로벌은 적자전환했습니다/);
 assert.match(title([company("dom","원재료","PCB/소자","A",[100,120],[-5,3]),company("glo","원재료","PCB/소자","B",[100,110],[10,12])]),/영업이익은 국내가 흑자전환한 반면 글로벌은 증가했습니다|영업이익/);
 assert.doesNotMatch(title(mk(116,13,109,8)),/증가율이 높/);
});

test("한쪽 실적만 있으면 비교할 수 없다고 안내",()=>{
 assert.match(title([company("dom","원재료","PCB/소자","A",[100,120],[10,13])]),/국내 업체의 실적만 확인/);
});
