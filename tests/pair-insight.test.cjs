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
 assert.match(html,/<b>원재료<\/b>[\s\S]*기여가 가장 컸습니다/,"국내 전체의 매출 증가 원인=원재료");
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
 assert.match(html,/매출 증가에는 <b>PCB\/소자<\/b>/);
 assert.match(html,/<b>특수가스<\/b>[\s\S]*증가폭을 일부 줄였습니다/);
 assert.match(html,/영업이익 증가에는 <b>PCB\/소자<\/b>/);
});

test("품목까지 선택: 해당 품목의 업체 증감액 기준으로 설명",()=>{
 const r=[
  company("dom","원재료","PCB/소자","심텍",[100,110],[10,13]),
  company("dom","원재료","PCB/소자","삼성전기",[100,160],[10,30]),
  company("glo","원재료","PCB/소자","Murata",[100,120],[10,18])
 ];
 const html=render(r,{g:"원재료",i:"PCB/소자"});
 assert.match(html,/매출 증가에는 <b>삼성전기<\/b>/);
 assert.doesNotMatch(html,/매출 증가에는 <b>PCB\/소자<\/b>/);
});

test("부품 선택: ASML 본사 연결 매출을 부품 자체의 성장 원인으로 기술하지 않음",()=>{
 const r=[
  company("dom","부품","부품","코미코",[100,155],[10,22]),
  company("dom","부품","부품","싸이노스",[100,110],[10,12]),
  company("glo","부품","부품","싸이머코리아",[100,145],[10,24],"ASML"),
  company("glo","부품","부품","케이엘에이텐코코리아",[100,120],[10,19],"KLA")
 ];
 const html=render(r,{g:"부품"});
 assert.match(html,/매출 증가에는 <b>코미코<\/b>/);
 assert.match(html,/장비 사업까지 포함된 해외 본사 연결 실적/);
 assert.doesNotMatch(html,/<b>ASML<\/b>/);
 assert.doesNotMatch(html,/<b>KLA<\/b>/);
 const krHtml=render(r,{g:"부품"},true);
 assert.doesNotMatch(krHtml,/장비 사업까지 포함된 해외 본사/);
 assert.match(krHtml,/<b>싸이머코리아<\/b>/,"한국 법인 모드에서는 현지 법인 이름으로 설명");
});
