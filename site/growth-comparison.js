(function(){
"use strict";
const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg',Y=[2023,2024,2025],CH=['소재','부품','장비'];
let S=null;
const key=(c,p)=>JSON.stringify([c||null,p]);
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const fmt=v=>v==null?'–':Math.round(v).toLocaleString('ko-KR');
const compact=v=>v==null?'':(Math.abs(v)>=10000?(v/10000).toFixed(1)+'조':Math.round(v).toLocaleString('ko-KR'));
const pct=v=>v==null?'–':v.toFixed(1)+'%';
const pp=v=>v==null?'–':(v>=0?'+':'')+v.toFixed(2)+'%p';
const sg=v=>v==null?'–':(v>=0?'+':'')+v.toFixed(1)+'%';
const PAL=['var(--blue)','var(--orange)','var(--teal)','var(--purple)'];
let GR=[]; /* 표시 그룹(데이터 기반): [{key,label,full,color}] */
const base=()=>{const e=$('f-base');return S&&S.cells_cons&&e&&e.value==='cons'?S.cells_cons:S.cells};
const cell=(c,p)=>base()[key(c,p)];
const path=()=>{const p=[];for(let i=1;i<=5;i++){const v=$('f-d'+i).value;if(!v)break;p.push(v)}return p};
function opts(sel,vals){const cur=sel.value;sel.length=1;[...new Set(vals)].sort().forEach(v=>sel.add(new Option(v,v)));sel.value=cur;sel.disabled=sel.length<2}
function children(c,p){const out=[];for(const k in base()){const [cc,pp_]=JSON.parse(k);if((cc||null)===(c||null)&&pp_.length===p.length+1&&p.every((x,i)=>pp_[i]===x))out.push(pp_[p.length])}return out}
function sync(){const c=$('f-chart').value;let p=[];for(let i=1;i<=5;i++){const s=$('f-d'+i);if(i>1&&!$('f-d'+(i-1)).value){s.length=1;s.disabled=true;continue}opts(s,children(c,p));if(!s.value)break;p.push(s.value)}}
function svgEl(n,a,t){const e=document.createElementNS(NS,n);for(const k in a)e.setAttribute(k,a[k]);if(t!=null)e.textContent=t;return e}
function el(tag,cls,html){const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e}
const num=(s,r)=>s&&s.n?s[r]:null;

/* 값 전환: idx(2023=100) / sum / avg */
function series(s,mode){if(!s||!s.n)return null;const v=mode==='avg'?s.avg_rev:s.rev;if(mode==='idx'){const b=v[0];return v.map(x=>b?x/b*100:null)}return v}
const growthOf=s=>s&&s.n?s.rev.map((x,i)=>i&&s.rev[i-1]?(x/s.rev[i-1]-1)*100:null):null;

/* ---------- 차트 ---------- */
const W=320;
function revChart(d,mode,mx){
 const H=214,m=14,gw=W-2*m,sw=gw/Y.length,k=GR.length,bw=Math.min(34,sw*.8/k),BASE=150,BH=118;
 const svg=svgEl('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':d.c+' 매출 '+(mode==='idx'?'지수(2023=100)':mode==='avg'?'기업당 평균':'합계')});
 const bx=(yi,gi)=>m+yi*sw+(sw-bw*k)/2+gi*bw;
 if(mode==='idx'){const gy=BASE-(100/mx)*BH;svg.append(svgEl('line',{x1:m,x2:W-m,y1:gy,y2:gy,stroke:'var(--text-3)','stroke-width':.8,'stroke-dasharray':'2 3'}));svg.append(svgEl('text',{x:W-m,y:gy-3,'text-anchor':'end','font-size':'8',style:'fill:var(--text-3)'},'100'))}
 svg.append(svgEl('line',{x1:m,x2:W-m,y1:BASE,y2:BASE,stroke:'var(--line)','stroke-width':1}));
 GR.forEach((g,gi)=>{const s=d.x&&d.x[g.key],v=series(s,mode),gr=growthOf(s);if(!v)return;
  v.forEach((val,yi)=>{if(val==null)return;const h=Math.max(1,(val/mx)*BH),r=svgEl('rect',{x:bx(yi,gi),y:BASE-h,width:bw*.92,height:h,fill:g.color,class:'gc-bar'});
   r.append(svgEl('title',{},g.full+' '+Y[yi]+' · '+(mode==='idx'?'매출지수 '+val.toFixed(1)+' (매출 '+fmt(s.rev[yi])+'억 원)':(mode==='avg'?'기업당 평균 매출 ':'매출 ')+fmt(val)+'억 원')+(gr&&gr[yi]!=null?' · 전년 대비 '+sg(gr[yi]):'')));svg.append(r);
   svg.append(svgEl('text',{x:bx(yi,gi)+bw*.46,y:BASE-h-3,'text-anchor':'middle','font-size':'8.5','font-weight':'600',style:'fill:'+g.color},mode==='idx'?val.toFixed(0):compact(val)))})});
 Y.forEach((y,yi)=>svg.append(svgEl('text',{x:m+yi*sw+sw/2,y:BASE+14,'text-anchor':'middle','font-size':'10'},String(y))));
 GR.forEach((g,gi)=>{const gr=growthOf(d.x&&d.x[g.key]);
  Y.forEach((y,yi)=>{if(!gr||gr[yi]==null)return;svg.append(svgEl('text',{x:m+yi*sw+sw/2,y:BASE+30+gi*12,'text-anchor':'middle','font-size':'8.5',style:'fill:'+g.color},g.label+' '+sg(gr[yi])))})});
 svg.append(svgEl('text',{x:W/2,y:H-3,'text-anchor':'middle','font-size':'8',style:'fill:var(--text-3)'},'막대: '+(mode==='idx'?'매출지수(2023=100)':mode==='avg'?'기업당 평균 매출':'매출 합계')+' · 아래 숫자: 전년 대비'));
 return svg}
function marginChart(d,lo,hi){
 const H=140,m=14,gw=W-2*m,sw=gw/Y.length,T=24,B=88,span=(hi-lo)||1;
 const svg=svgEl('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':d.c+' 영업이익률 추이'});
 const X=yi=>m+yi*sw+sw/2,Yp=v=>B-((v-lo)/span)*(B-T);
 if(lo<0&&hi>0){const z=Yp(0);svg.append(svgEl('line',{x1:m,x2:W-m,y1:z,y2:z,stroke:'var(--text-3)','stroke-width':.8,'stroke-dasharray':'2 3'}));svg.append(svgEl('text',{x:W-m,y:z-3,'text-anchor':'end','font-size':'8',style:'fill:var(--text-3)'},'0%'))}
 GR.forEach((g,gi)=>{const s=d.x&&d.x[g.key];if(!s||!s.n)return;const mg=s.margin;
  const pts=mg.map((v,yi)=>v==null?null:[X(yi),Yp(v)]).filter(Boolean);
  if(pts.length>1)svg.append(svgEl('polyline',{points:pts.map(q=>q.join(',')).join(' '),fill:'none',stroke:g.color,'stroke-width':1.8}));
  mg.forEach((v,yi)=>{if(v==null)return;const c=svgEl('circle',{cx:X(yi),cy:Yp(v),r:3,fill:g.color});c.append(svgEl('title',{},g.full+' '+Y[yi]+' 영업이익률 '+pct(v)));svg.append(c)})});
 /* 라벨: 같은 연도에서 값이 큰 그룹은 점 위, 작은 그룹은 점 아래 */
 Y.forEach((y,yi)=>{const vals=GR.map((g,gi)=>{const s=d.x&&d.x[g.key];return s&&s.n&&s.margin[yi]!=null?{g,v:s.margin[yi]}:null}).filter(Boolean).sort((a,b)=>b.v-a.v);
  vals.forEach((o,i)=>{const up=i===0||vals.length===1;svg.append(svgEl('text',{x:X(yi),y:Yp(o.v)+(up?-7:13),'text-anchor':'middle','font-size':'9','font-weight':'600',style:'fill:'+o.g.color},pct(o.v)))});
  svg.append(svgEl('text',{x:X(yi),y:H-22,'text-anchor':'middle','font-size':'10'},String(y)))});
 svg.append(svgEl('text',{x:W/2,y:H-4,'text-anchor':'middle','font-size':'8',style:'fill:var(--text-3)'},'영업이익률 = 영업이익 합계 ÷ 매출 합계'));
 return svg}

function counts(d){return GR.map(g=>{const s=d.x&&d.x[g.key];return '<span style="color:'+g.color+'">'+esc(g.label)+' '+(s&&s.n?s.n+'곳':'공개 기준 미달')+'</span>'}).join(' · ')}

function draw(){
 const p=path(),mode=$('f-mode').value,sel=$('f-chart').value,cats=sel?[sel]:[null,...CH];
 const data=cats.map(c=>({c:c||'전체',cat:c,x:cell(c,p)})),box=$('chart');box.textContent='';
 /* 결과 줄: 현재 선택(그래프 분류·상세구분)의 비교 대상 수 */
 const cur=cell(sel||null,p),res=$('result');
 res.innerHTML='<b>현재 조건</b> '+esc([sel||'전체',...p].join(' › '))+' — '+(cur?counts({x:cur}):GR.map(g=>'<span style="color:'+g.color+'">'+esc(g.label)+' 공개 기준 미달</span>').join(' · '))+' <small>(3개년 실적이 확인된 법인, 한 곳 미만·5곳 미만 조합은 공개하지 않음)</small>';
 /* 상세구분 필터 안내 */
 const nt=$('detail-note');nt.hidden=true;nt.textContent='';
 if(p.length&&S.coverage&&S.coverage.detail_missing){const dm=S.coverage.detail_missing[sel||'전체']||{};const parts=GR.filter(g=>dm[g.key]&&dm[g.key].no_detail>0).map(g=>g.label+' '+dm[g.key].no_detail+'곳');
  if(parts.length){nt.hidden=false;nt.textContent='상세구분이 없는 기업('+parts.join(' · ')+')은 상세 필터에서 제외됩니다. 상세구분이 없는 기업을 임의로 분류하지 않습니다.'}}
 if(!data.some(d=>d.x&&GR.some(g=>d.x[g.key]))){box.innerHTML='<p class="gc-empty">이 조건에서는 공개 기준(그룹별 5곳 이상, 3개년 실적 확인)을 충족하는 비교 대상이 없습니다.</p>';$('influence').hidden=true;tbl([]);ptbl([]);return}
 const mx=Math.max(1,...data.flatMap(d=>GR.flatMap(g=>(series(d.x&&d.x[g.key],mode)||[]).filter(v=>v!=null))));
 const allM=data.flatMap(d=>GR.flatMap(g=>((d.x&&d.x[g.key]&&d.x[g.key].margin)||[]).filter(v=>v!=null))),hi=Math.max(5,...allM)+3,lo=Math.min(0,...allM)-3;
 const grid=el('div','gc-grid');
 data.forEach(d=>{const panel=el('div','gc-panel');panel.append(el('h3','gc-ph',esc(d.c)),el('p','gc-pc',counts(d)));
  if(!d.x||!GR.some(g=>d.x[g.key])){panel.append(el('p','gc-empty','공개 기준 미달(그룹별 5곳 미만)'));grid.append(panel);return}
  panel.append(el('p','gc-sub','매출'),revChart(d,mode,mx),el('p','gc-sub','영업이익률'),marginChart(d,lo,hi));grid.append(panel)});
 box.append(grid);
 influence(data,sel);tbl(data);ptbl(data)}

/* ---------- 대형 법인·단일 법인 영향 안내 ---------- */
function influence(data,sel){
 const card=$('influence'),parts=[];
 const mx=S.mix||{};
 if(!sel&&mx.ov&&mx.ov['장비']){const o=mx.ov['장비'],dm=mx.dom&&mx.dom['장비'];
  parts.push(esc((GR.find(g=>g.key==='ov')||{label:'해외계'}).label)+' 2025년 장비 비중: 매출 '+o.rev_share_2025+'% · 영업이익 '+(o.op_share_2025==null?'–':o.op_share_2025+'%')+(dm?' (국내 장비: 매출 '+dm.rev_share_2025+'% · 영업이익 '+(dm.op_share_2025==null?'–':dm.op_share_2025+'%')+')':'')+'. 소재·부품·장비는 겹칠 수 있습니다. 전체 수익성 차이는 업종 구성과 대형 법인의 영향을 받으므로 업종별 값과 함께 해석하세요.')}
 const fl=[];data.forEach(d=>GR.forEach(g=>{const s=d.x&&d.x[g.key];if(!s||!s.flags)return;const yrs=[...new Set([...(s.flags.rev_single_driver_years||[]),...(s.flags.op_single_driver_years||[])])];if(yrs.length)fl.push(g.label+' '+d.c+' '+yrs.sort().join('·')+'년')}));
 if(fl.length)parts.push('특정 연도('+fl.join(', ')+')는 한 법인의 실적이 합계를 크게 좌우합니다(법인 비공개).');
 card.hidden=!parts.length;card.innerHTML=parts.map(t=>'<p>'+(t.indexOf('<')<0?t:t)+'</p>').join('')}

/* ---------- 표 ---------- */
function th(t,cls){const c=document.createElement('th');c.textContent=t;if(cls)c.className=cls;return c}
function tbl(data){const t=$('tbl');t.textContent='';if(!data.length)return;
 const h=t.createTHead().insertRow();['분류','구분','기업 수',...Y.map(y=>y+' 매출(억 원)'),'매출 성장 2024','매출 성장 2025',...Y.map(y=>y+' 영업이익률')].forEach(x=>h.append(th(x)));
 const b=t.createTBody();data.forEach(d=>GR.forEach(g=>{const s=d.x&&d.x[g.key];if(!s||!s.n)return;const gr=growthOf(s),row=b.insertRow();
  [d.c,g.full,s.n,...s.rev.map(fmt),sg(gr[1]),sg(gr[2]),...s.margin.map(pct)].forEach(v=>row.insertCell().textContent=v)}))}
function ptbl(data){const t=$('ptbl');t.textContent='';if(!data.length)return;
 const h=t.createTHead().insertRow();['분류','구분',...Y.map(y=>y+' 영업이익률'),'변화 2024(%p)','변화 2025(%p)'].forEach(x=>h.append(th(x)));
 const b=t.createTBody(),a=GR[0],z=GR[1];
 data.forEach(d=>{GR.forEach(g=>{const s=d.x&&d.x[g.key];if(!s||!s.n)return;const m=s.margin,row=b.insertRow();
   [d.c,g.full,...m.map(pct),m[1]==null||m[0]==null?'–':pp(m[1]-m[0]),m[2]==null||m[1]==null?'–':pp(m[2]-m[1])].forEach(v=>row.insertCell().textContent=v)});
  if(a&&z){const sa=d.x&&d.x[a.key],sz=d.x&&d.x[z.key];if(sa&&sa.n&&sz&&sz.n){const gap=sa.margin.map((v,i)=>v==null||sz.margin[i]==null?null:v-sz.margin[i]),row=b.insertRow();row.className='gc-gap';
    [d.c,a.label+' − '+z.label+' 격차',...gap.map(pp),gap[1]==null||gap[0]==null?'–':pp(gap[1]-gap[0]),gap[2]==null||gap[1]==null?'–':pp(gap[2]-gap[1])].forEach(v=>row.insertCell().textContent=v)}}})}

/* ---------- 산출 기준·구성 ---------- */
function notes(){
 const nl=S.notes_list||[];
 $('notes').innerHTML=nl.map(x=>'<li>'+esc(x)+'</li>').join('')+(S.cells_cons&&S.basis&&S.basis.scope_cons?'<li>'+esc(S.basis.scope_cons)+'</li>':'')+
  '<li class="gc-disc"><b>유의:</b> 기업별 연결 범위, 사업 구성, 회계기간 및 환율의 차이가 있어 매출 규모와 수익성을 동일한 기준의 직접 비교 결과로 해석하기 어렵습니다. 자세한 산출 방법은 방법론 문서(docs/growth-comparison-methodology.md)를 참고하세요.</li>';
 const c=S.coverage||{},cp=c.composition,bp=c.balanced_panel||{},en=c.entities||{};
 const ov=GR.find(g=>g.key==='ov'),dm=GR.find(g=>g.key==='dom');
 let h='<p>';
 if(dm)h+=esc(dm.label)+': 기업군 '+(en['국내']!=null?en['국내']+'곳 중 ':'')+'3개년 실적이 확인된 '+(bp['국내']!=null?bp['국내']:'–')+'곳. ';
 if(ov){h+=esc(ov.label)+': 3개년 실적이 확인된 '+(bp['해외']!=null?bp['해외']:'–')+'곳';
  if(cp)h+=' = 공시 본사 '+cp.listed_or_direct+'곳 + 한국 내 외국계 '+cp.kr_incorporated_affiliates+'곳(이중 집계 방지로 제외 '+cp.kr_affiliates_excluded_double_count+'곳)';
  h+='. '}
 h+='확인되지 않은 법인은 집계에서 제외하며 수치를 추정하지 않습니다.</p>';
 $('cov').innerHTML=h;
 $('updated').textContent=(S.generatedAt||'').slice(0,10)}
function legend(){$('legend').innerHTML=GR.map(g=>'<li><i class="sq" style="background:'+g.color+'"></i>'+esc(g.full)+'</li>').join('')}

/* ---------- 초기화 ---------- */
const tb=$('theme-btn');if(tb){const cur=()=>document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');const paint=()=>{const d=cur()==='dark';tb.innerHTML='<i class="ph ph-'+(d?'sun':'moon')+'" aria-hidden="true"></i>';tb.title=d?'밝은 화면으로':'어두운 화면으로'};tb.addEventListener('click',()=>{const t=cur()==='dark'?'light':'dark';document.documentElement.dataset.theme=t;try{localStorage.setItem('sobujang:theme',t)}catch(e){}paint()});paint()}
fetch('data/growth-comparison-summary.json',{cache:'no-cache'}).then(r=>r.json()).then(j=>{S=j;
 GR=(S.groups||[{key:'dom',label:'국내'},{key:'ov',label:'해외계'}]).map((g,i)=>({key:g.key,label:g.label,color:PAL[i%PAL.length],full:g.key==='ov'?g.label+'(공시 본사·한국 내 외국계)':g.label}));
 const cs=new Set();for(const k in S.cells){const c=JSON.parse(k)[0];if(c)cs.add(c)}CH.filter(c=>cs.has(c)).forEach(c=>$('f-chart').add(new Option(c,c)));
 legend();notes();sync();draw();
 if(S.cells_cons){const w=$('w-base');if(w)w.hidden=false}
 ['f-chart','f-d1','f-d2','f-d3','f-d4','f-d5','f-mode','f-base'].forEach(id=>$(id).addEventListener('change',()=>{if(id==='f-chart')for(let i=1;i<=5;i++)$('f-d'+i).value='';else if(/f-d/.test(id)){const n=+id.slice(3);for(let i=n+1;i<=5;i++)$('f-d'+i).value=''}sync();draw()}))
}).catch(e=>{$('chart').innerHTML='<p class="gc-empty">집계 자료를 불러오지 못했습니다.</p>'});
})();
