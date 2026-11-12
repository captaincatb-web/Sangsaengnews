/* 국내업체/글로벌업체 성과비교: 업체 명단(data/pair-roster.json)에 성장 분석의 회사별 상세(data/growth-companies.json, 억 원)를 이름이 정확히 같은 곳만 연결해 보여 준다.
   수치가 없는 업체는 '자료 없음'으로 두고 추정하지 않는다. 해외 법인·지점은 모회사 실적으로 대체하지 않는다. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=v=>v==null?'–':Math.round(v).toLocaleString('ko-KR');
const pct=v=>v==null?'–':v.toFixed(1)+'%';
const sg=v=>v==null?'–':(v>0?'+':'')+v.toFixed(1)+'%';
const pp=v=>v==null?'–':(v>0?'+':'')+v.toFixed(1)+'%p';
const margin=(o,r)=>r?o/r*100:null,grow=(r,i)=>r[i-1]?(r[i]/r[i-1]-1)*100:null,cum=r=>r[0]?(r[2]/r[0]-1)*100:null;
const KIND={hq:'해외 본사',par:'본사 실적'},SIDE={dom:'국내업체',glo:'글로벌업체'},INK={dom:'var(--gc-ink-1)',glo:'var(--gc-ink-2)'};
const NO_DATA='3개년(2023~2025) 공시 실적이 확인된 업체만 수치를 보여 주며, 이 업체는 아직 확인되지 않았습니다.',NO_PAR='본사 실적이 3개년(2023~2025) 확인되지 않았습니다.';
let ROSTER=null,ALL=[],GEN='',sortKey=null,sortDir=1,RAW_PARENT={};

/* 명단 + 공개 회사별 수치 연결. 이름이 정확히 같은 행만 쓴다 */
/* 후보 수치: 같은 이름의 공개 행(비교 기준 모드 blend·cons_listed)과 따로 수집한 값(pair-extra)을 재무 기준별로 모은다. c=연결, s=개별·별도 */
const kindOf=sc=>sc==='연결'?'c':'s';
function build(R,modes,extra){const idx={};
 const add=(n,r)=>{const o=idx[n]||(idx[n]={c:null,s:null}),k=kindOf(r.s);if(r.ov||!o[k])o[k]=r};  /* ov: 재집계 전까지 이 화면에서 공개 성장값보다 우선하는 정정 행 */
 ['blend','cons_listed'].forEach(id=>{const m=(modes||[]).find(x=>x.id===id);((m&&m.rows)||[]).forEach(r=>add(r.n,r))});
 (extra||[]).forEach(r=>add(r.n,r));
 const out=[];
 R.groups.forEach(gr=>gr.items.forEach(it=>['dom','glo'].forEach(side=>it[side].forEach(e=>{
  /* 글로벌 업체는 본사 실적(e.p)을 쓴다: 공개 회사별 상세(p.m)에 없으면 따로 수집한 본사 공시(pair-extra.json, p.n). 국내업체는 자기 실적(m, 없으면 pair-extra) */
  const P=e.p||null,nm=P?(P.m||P.n):(e.m||e.n),cands=idx[nm]||{c:null,s:null};
  const kn=e.km||e.kx||null,kc=kn?(idx[kn]||{}):null,kr=kc?(kc.s||kc.c||null):null;  /* 글로벌 업체의 한국 법인(별도 재무) 값: 합계에는 넣지 않고 함께 보여 준다 */
  out.push({g:gr.g,i:it.i,side,e,cands,row:null,kr,kn,k:side==='glo'?e.k:null,ord:out.length,key:nm,bkey:nm})}))));return out}
const fbasis=()=> 'auto'; // 비교 화면 고정: 국내 개별 / 글로벌 본사 연결
/* 비교 화면 고정 기준. 국내 개별/별도, 글로벌 해외 본사 연결 외 값은 대체하지 않는다. */
const fval=()=>{const v=$('f-val');return v?v.value:'sum'};
function applyBasis(){ALL.forEach(x=>{x.key=x.bkey;x.row=x.side==='glo'?x.cands.c:x.cands.s})}

const state=()=>({g:$('f-grp').value,i:$('f-item').value,q:($('f-q').value||'').trim().toLowerCase()});
function visible(){const s=state();return ALL.filter(x=>(!s.g||x.g===s.g)&&(!s.i||x.i===s.i)&&(!s.q||x.e.n.toLowerCase().includes(s.q)||x.e.f.toLowerCase().includes(s.q)))}
/* 고정 기준 이외 자료가 있어도 비교 합계에는 포함하지 않는다. */
const otherBasis=x=>{const wanted=x.side==='glo'?'해외 본사 연결':'국내업체 개별(별도)';
 const other=x.side==='glo'?x.cands.s:x.cands.c;
 return wanted+' 3개년 공시 실적 미확인'+(other?' (다른 재무 기준 참고값 존재)':'')};
const incX=()=>true; // 삼성에스디아이 항상 포함
const inSumRaw=x=>!!x.row;
const uniqSum=list=>{const seen=new Set();return list.filter(x=>{if(!inSumRaw(x)||seen.has(x.key))return false;seen.add(x.key);return true})};

function agg(list){const has=uniqSum(list),r2=has.reduce((t,x)=>t+x.row.r[2],0),o2=has.reduce((t,x)=>t+x.row.o[2],0),r0=has.reduce((t,x)=>t+x.row.r[0],0);
 return{n:list.length,k:has.length,rev:r2,op:o2,r0,m:has.length?margin(o2,r2):null,c:has.length&&r0?(r2/r0-1)*100:null}}
const krTxt=x=>x.kr?'한국 법인'+(x.kn&&x.kn!==x.e.n?'('+x.kn+')':'')+': 2025 매출 '+fmt(x.kr.r[2])+'억 · 영업이익률 '+pct(margin(x.kr.o[2],x.kr.r[2]))+' ('+x.kr.s+(x.kr.src?' · '+x.kr.src:'')+')':'';
/* 글로벌 원재료·부품 본사 공시 원문(개별/연결 구분). KRW 합계·성장률에는 미산입. */
const rawParent=x=>x.side==='glo'&&['원재료','부품'].includes(x.g)&&x.e.p?RAW_PARENT[x.e.p.n]:null;
function rawDetails(raw){
 const num=v=>v==null?'–':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2});
 const years=[2023,2024,2025].map((y,i)=>'<div class="pc-parent-year"><span><b>'+y+'</b> 매출 '+num(raw.revenue[i])+' / 영업 '+num(raw.operating_profit[i])+'</span><small>'+esc(raw.verification?.[i]||'원문 대조 전')+' · '+esc(raw.periods[i])+'</small></div>').join('');
 const links=(raw.sources||[]).filter(s=>/^https:\/\/[a-z0-9.-]+(?:\/|$)/i.test(s.url||'')).map(s=>'<a href="'+esc(s.url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.label)+'</a>').join(' · ');
 return '<details class="pc-parent-raw"><summary>본사 '+esc(raw.scope||'연결')+' 공시 참고실적 · '+esc(raw.currency)+' '+esc(raw.unit||'백만')+' (2023~2025)</summary><div class="pc-parent-rows">'+years+'</div><div class="pc-parent-status">'+esc(raw.status||'')+'</div><div class="pc-parent-why">'+esc(raw.note||'')+'</div>'+(links?'<div class="pc-parent-links">'+links+'</div>':'')+'<div class="pc-parent-hint">해당 원본 통화 수치는 원화 비교 집계·성장률 제외 · '+esc(raw.operating_label||'영업이익')+'</div></details>';
}
const tagOf=x=>[x.e.p?(x.row?'본사 실적: '+x.e.p.n:'본사 실적 참조: '+x.e.p.n):(x.k&&KIND[x.k]),x.row&&x.row.s,x.row&&x.row.src].filter(Boolean).join(' · ');

/* 구분→품목 선택지 */
function fillGroups(){const g=$('f-grp');ROSTER.groups.forEach(gr=>g.add(new Option(gr.g,gr.g)));fillItems()}
function fillItems(){const it=$('f-item'),cur=it.value,g=$('f-grp').value;it.length=1;
 ROSTER.groups.filter(gr=>!g||gr.g===g).forEach(gr=>gr.items.forEach(x=>{if(!g&&gr.items.length===1&&gr.g===x.i){it.add(new Option(x.i,x.i))}else it.add(new Option(g?x.i:gr.g+' › '+x.i,x.i))}));
 if([...it.options].some(o=>o.value===cur))it.value=cur}

function render(){
 applyBasis();const vis=visible(),dm=vis.filter(x=>x.side==='dom'),gl=vis.filter(x=>x.side==='glo');
 key(vis,dm,gl);trend(dm,gl);detail(vis);
 try{const s=state(),h=[];if(s.g)h.push('g='+encodeURIComponent(s.g));if(s.i)h.push('i='+encodeURIComponent(s.i));if(s.q)h.push('q='+encodeURIComponent(s.q));if(fval()!=='sum')h.push('v='+fval());history.replaceState(null,'',h.length?'#'+h.join('&'):location.pathname+location.search)}catch(e){}
}

/* 연도별 실적 추이: 왼쪽 국내업체, 오른쪽 글로벌업체. 매출(왼쪽 축)·영업이익(오른쪽 축) 막대 + 영업이익률 선(소부장 경영 정보의 연도별 실적 추이와 같은 구성) */
const YRS=[2023,2024,2025],NS='http://www.w3.org/2000/svg';
const axis=(vals,k)=>{const mn=Math.min(0,...vals),mx=Math.max(0,...vals),rg=(mx-mn)||1,e=Math.pow(10,Math.floor(Math.log10(rg/k)));
 for(const f of [1,1.2,1.5,2,2.5,3,4,5,6,8,10,12,15,20,25,30,40,50,100]){const step=f*e,lo=mn<0?-Math.ceil(-mn/step)*step:0;if(lo+step*k>=mx)return{lo,step}}return{lo:0,step:rg/k}};
const tick=big=>v=>big?(v/10000).toLocaleString('ko-KR',{maximumFractionDigits:1})+'조':Math.round(v).toLocaleString('ko-KR');
const money=v=>v==null?'–':Math.abs(v)>=10000?(v/10000).toLocaleString('ko-KR',{maximumFractionDigits:1})+'조 원':Math.round(v).toLocaleString('ko-KR')+'억 원';
/* 금액 옆 성장률. 영업 적자/흑자 전환은 숫자 성장률로 오인시키지 않는다. */
const chartMoney=v=>{if(v==null||!Number.isFinite(v))return '–';if(Math.abs(v)>=1000){const n=(v/10000).toFixed(2).replace(/\.?0+$/,'');return n+'조'}return Math.round(v).toLocaleString('ko-KR')+'억'};
function change(arr,i,profit){if(!i||arr[i]==null||arr[i-1]==null)return{label:'—',tone:''};
 const prev=arr[i-1],now=arr[i];
 if(profit){if(prev<0&&now>=0)return{label:'흑자전환',tone:'up'};if(prev>=0&&now<0)return{label:'적자전환',tone:'down'};if(prev<0&&now<0)return{label:Math.abs(now)<Math.abs(prev)?'적자축소':Math.abs(now)>Math.abs(prev)?'적자확대':'변동 없음',tone:Math.abs(now)<Math.abs(prev)?'up':'down'};}
 if(prev===0)return{label:now===0?'변동 없음':'비교 불가',tone:''};
 const rate=(now-prev)/Math.abs(prev)*100;
 return{label:Math.abs(rate).toFixed(1)+'%'+(rate>0?'↑':rate<0?'↓':'→'),tone:rate>0?'up':rate<0?'down':''};
}
function changeHtml(c){return '<span class="pc-change'+(c.tone?' is-'+c.tone:'')+'">'+esc(c.label)+'</span>'}
function trendSvg(side,list){
 const has=uniqSum(list),vm=fval();
 if(!has.length)return '<p class="gc-empty">'+SIDE[side]+' · 수치가 확인된 업체가 없습니다.</p>';
 const N=has.length,S=YRS.map((_,i)=>has.reduce((t,x)=>t+(x.row.r[i]||0),0)),O=YRS.map((_,i)=>has.reduce((t,x)=>t+(x.row.o[i]||0),0));
 const A=vm==='avg'?S.map(v=>v/N):vm==='idx'?S.map(v=>S[0]?v/S[0]*100:null):S;
 const B=vm==='avg'?O.map(v=>v/N):O;
 const W=560,H=264,L=66,R=61,top=34,bottom=219,k=4,pw=W-L-R,slot=pw/3,bw=28;
 const ax=axis(A.filter(Number.isFinite),k),ao=axis(B.filter(Number.isFinite),k);
 const sy=v=>bottom-(v-ax.lo)/(ax.step*k)*(bottom-top),oy=v=>bottom-(v-ao.lo)/(ao.step*k)*(bottom-top);
 const sz=sy(0),oz=oy(0),cx=i=>L+slot*(i+.5);
 const fmtA=v=>vm==='idx'?(v==null?'–':v.toFixed(0)):chartMoney(v);
 const info=YRS.map((y,i)=>y+'년 · 매출 '+chartMoney(S[i])+' '+change(S,i,false).label+' · 영업이익 '+chartMoney(O[i])+' '+change(O,i,true).label);
 let g='';
 for(let i=0;i<=k;i++){const yy=sy(ax.lo+ax.step*i);
  g+='<line class="grid" x1="'+L+'" x2="'+(W-R)+'" y1="'+yy+'" y2="'+yy+'"/>'+
  '<text class="ax axl" x="'+(L-7)+'" y="'+(yy+4)+'" text-anchor="end">'+(vm==='idx'?(ax.lo+ax.step*i).toFixed(0):chartMoney(ax.lo+ax.step*i))+'</text>'+
  '<text class="ax axr" x="'+(W-R+6)+'" y="'+(yy+4)+'">'+chartMoney(ao.lo+ao.step*i)+'</text>'}
 if(ao.lo<0)g+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+oz+'" y2="'+oz+'" stroke="var(--text-3)" stroke-width="1"/>';
 YRS.forEach((yr,i)=>{const x=cx(i),a=A[i]||0,o=B[i]||0,xs=x-35,xo=x+7,ys=Math.min(sy(a),sz),hs=Math.max(1,Math.abs(sy(a)-sz)),yo=Math.min(oy(o),oz),ho=Math.max(1,Math.abs(oy(o)-oz));
  const labelY=(v,y,h,z)=>v<0?z+h+12:y-6;
  g+='<g class="slot" style="--i:'+i+'" tabindex="0" data-i="'+i+'"><rect class="colbg" x="'+(x-slot/2+3)+'" y="'+top+'" width="'+(slot-6)+'" height="'+(bottom-top)+'" rx="8"/>'+
   '<rect class="bar" x="'+xs+'" y="'+ys+'" width="'+bw+'" height="'+hs+'" rx="3" fill="var(--blue)"/>'+
   '<rect class="bar" x="'+xo+'" y="'+yo+'" width="'+bw+'" height="'+ho+'" rx="3" fill="'+(o<0?'var(--down)':'var(--green)')+'"/>'+
   '<text class="val" x="'+(xs+bw/2)+'" y="'+labelY(a,ys,hs,sz)+'" text-anchor="middle">'+fmtA(A[i])+'</text>'+
   '<text class="val" x="'+(xo+bw/2)+'" y="'+labelY(o,yo,ho,oz)+'" text-anchor="middle">'+chartMoney(B[i])+'</text>'+
   '<text class="ax" x="'+x+'" y="'+(H-8)+'" text-anchor="middle">'+yr+'</text>'+
   '<rect class="hit" x="'+(x-slot/2)+'" y="'+top+'" width="'+slot+'" height="'+(bottom-top)+'"/></g>'});
 const cards=YRS.map((y,i)=>'<div class="pc-year-metrics"><b class="pc-year">'+y+'</b><div>매출 <strong>'+chartMoney(S[i])+'</strong> '+changeHtml(change(S,i,false))+'</div><div>영업 <strong>'+chartMoney(O[i])+'</strong> '+changeHtml(change(O,i,true))+'</div></div>').join('');
 return '<div class="pc-tp pc-'+side+'"><h3>'+SIDE[side]+' <small>수치 확인 '+has.length+'/'+list.length+'곳'+(vm==='avg'?' · 기업당 평균':vm==='idx'?' · 매출지수':' · 합계')+'</small></h3>'+
  '<div class="db-chart pcg"><svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(SIDE[side]+' 2023~2025 매출 및 영업이익. '+info.join(' / '))+'">'+g+'</svg></div>'+
  '<div class="pc-growth-grid" aria-label="'+SIDE[side]+' 연도별 금액과 전년 대비 변화">'+cards+'</div>'+
  '<p class="pc-strip" aria-live="polite" data-info="'+esc(JSON.stringify(info))+'">'+esc(info[2])+'</p></div>';
}
function trend(dm,gl){const box=$('pc-trend'),vm=fval();box.innerHTML=trendSvg('dom',dm)+trendSvg('glo',gl);
 const sq=c=>'<i class="sq" style="background:var('+c+')"></i>';
 $('pc-legend').innerHTML='<li>'+sq('--blue')+(vm==='idx'?'매출지수(2023=100)':vm==='avg'?'기업당 평균 매출':'매출')+' (왼쪽 축)</li><li>'+sq('--green')+(vm==='avg'?'기업당 평균 영업이익':'영업이익')+' (오른쪽 축)</li>';
 const n=$('pc-trend-note');if(n)n.textContent=vm==='idx'?'매출 막대만 2023년 지수(=100)로 표시하며 영업이익 막대는 실제 원화 합계입니다. 금액·증감률은 아래 연도별 요약을 참조하세요.':'국내와 글로벌 그래프는 각각 독립적인 눈금입니다. 매출은 왼쪽 축, 영업이익은 오른쪽 축을 읽으세요. 금액과 전년 대비 성장률은 각 연도 아래에 함께 표시합니다.';
 const sb=$('pc-trend-sub');if(sb)sb.textContent='2023~2025 · '+(vm==='avg'?'기업당 평균':vm==='idx'?'매출지수·영업이익 합계':'수치 확인 업체 합계')+' · 왼쪽 국내업체, 오른쪽 글로벌업체';
}
document.addEventListener('pointerover',e=>{const t=e.target.closest&&e.target.closest('.pcg .slot');if(t)strip(t)});
document.addEventListener('focusin',e=>{const t=e.target.closest&&e.target.closest('.pcg .slot');if(t)strip(t)});
function strip(t){const p=t.closest('.pc-tp').querySelector('.pc-strip');try{p.textContent=JSON.parse(p.dataset.info)[+t.dataset.i]}catch(e){}}

/* 제목 아래 한 줄 요약: 이익률 대신 매출·영업이익을 표시 */
function key(vis,dm,gl){const k=$('pc-key'),a=agg(dm),b=agg(gl);
 if(!a.k&&!b.k){k.hidden=true;k.innerHTML='';return}
 const s=state(),cond=[s.g,s.i&&s.i!==s.g?s.i:''].filter(Boolean).join(' › ');
 const sp=(side,t)=>'<span style="color:'+INK[side]+'">'+SIDE[side]+' '+t+'</span>';
 k.hidden=false;k.innerHTML=(cond?'<span class="gc-key-c">'+esc(cond)+'</span>':'')+
  '<span><b>2025년 매출</b> '+sp('dom',money(a.rev))+' · '+sp('glo',money(b.rev))+'</span>'+
  '<span><b>2025년 영업이익</b> '+sp('dom',money(a.op))+' · '+sp('glo',money(b.op))+'</span>'}

/* 통합 비교표는 아래 detail()에서 국내·글로벌 합계 및 업체별 행을 렌더링한다. */
/* 단일 통합 비교표: 국내·글로벌 합계와 원본 법인별 상세를 하나의 표에 표시. */
const COLS=[['n','업체 / 구분',1],['r0','2023 매출',0],['r1','2024 매출',0],['r2','2025 매출 · 증감',0],['o0','2023 영업이익',0],['o1','2024 영업이익',0],['o2','2025 영업이익 · 증감',0],['m2','2025 영업이익률',0]];
function val(x,k){const r=x.row;if(k==='n')return x.e.n;if(!r)return null;
 if(k[0]==='r'||k[0]==='o')return r[k[0]][Number(k[1])];
 if(k==='m2')return margin(r.o[2],r.r[2]);return null;
}
function detail(vis){
 const t=$('pc-tbl');$('pc-empty').hidden=vis.length>0;
 if(!vis.length){t.innerHTML='';return}
 const head='<thead><tr>'+COLS.map(([k,label,left])=>'<th scope="col" class="'+(left?'l':'')+'" aria-sort="'+(sortKey===k?(sortDir>0?'ascending':'descending'):'none')+'"><button type="button" data-k="'+k+'">'+esc(label)+(sortKey===k?(sortDir>0?' ▲':' ▼'):'')+'</button></th>').join('')+'</tr></thead>';
 const amount=(v,arr,i,profit)=>'<td class="'+(i===2?'pc-primary':'')+'">'+fmt(v)+(i===2?'<small>'+changeHtml(change(arr,2,profit))+'</small>':'')+'</td>';
 const subtotal=(side,entries)=>{const counted=uniqSum(entries);
  const r=YRS.map((_,i)=>counted.reduce((n,x)=>n+(x.row.r[i]||0),0));
  const o=YRS.map((_,i)=>counted.reduce((n,x)=>n+(x.row.o[i]||0),0));
  return '<tr class="pc-total pc-total-'+side+'"><th scope="row" class="l">'+SIDE[side]+' 합계<small>실적 확인 '+counted.length+'/'+entries.length+'곳 · 같은 본사 중복 제외</small></th>'+
  (counted.length?'<td>'+fmt(r[0])+'</td><td>'+fmt(r[1])+'</td>'+amount(r[2],r,2,false)+
  '<td>'+fmt(o[0])+'</td><td>'+fmt(o[1])+'</td>'+amount(o[2],o,2,true)+'<td>'+pct(margin(o[2],r[2]))+'</td>':'<td colspan="7" class="pc-na">비교 기준의 공시 실적 없음</td>')+'</tr>'};
 const row=x=>{const r=x.row,tg=tagOf(x),nm='<span class="pc-n" title="'+esc(x.e.f)+'">'+esc(x.e.n)+'</span>'+
  '<small>'+esc(x.g===x.i?x.i:x.g+' › '+x.i)+'</small>'+
  (tg?'<small>'+esc(tg)+'</small>':'')+(x.kr?'<small class="pc-kr">'+esc(krTxt(x))+'</small>':'')+
  (rawParent(x)?rawDetails(rawParent(x)):'')+
  (!r?'<small class="pc-why">'+esc(otherBasis(x)+' · '+(x.e.p&&x.e.p.w?x.e.p.w:x.e.w||NO_DATA))+'</small>':'')+
  (x.e.x?'<small class="pc-why">'+esc(x.e.x)+' · 합계에 포함</small>':'');
  if(!r)return '<tr class="pc-none"><th scope="row" class="l">'+nm+'</th><td colspan="7" class="pc-na">자료 없음 (고정 재무기준)</td></tr>';
  return '<tr><th scope="row" class="l">'+nm+'</th><td>'+fmt(r.r[0])+'</td><td>'+fmt(r.r[1])+'</td>'+
   amount(r.r[2],r.r,2,false)+'<td>'+fmt(r.o[0])+'</td><td>'+fmt(r.o[1])+'</td>'+
   amount(r.o[2],r.o,2,true)+'<td>'+pct(margin(r.o[2],r.r[2]))+'</td></tr>'};
 const body=['dom','glo'].map(side=>{const entries=vis.filter(x=>x.side===side);if(!entries.length)return '';
  const list=entries.slice();if(sortKey)list.sort((a,b)=>{const A=val(a,sortKey),B=val(b,sortKey);if(A==null&&B==null)return 0;if(A==null)return 1;if(B==null)return -1;return(typeof A==='string'?A.localeCompare(B,'ko'):A-B)*sortDir});
  return subtotal(side,entries)+list.map(row).join('')}).join('');
 t.innerHTML=head+'<tbody>'+body+'</tbody>';
}

function csv(){const vis=visible(),Y=[2023,2024,2025],n1=v=>v==null?'':(+v).toFixed(1);
 const head=['구분','품목','국내/글로벌','업체명','분류','재무 기준',...Y.map(y=>y+' 매출(억 원)'),...Y.map(y=>y+' 영업이익(억 원)'),...Y.map(y=>y+' 영업이익률(%)'),'매출 성장 2024(%)','매출 성장 2025(%)','한국 법인','한국 법인 재무 기준',...Y.map(y=>'한국 법인 '+y+' 매출(억 원)'),...Y.map(y=>'한국 법인 '+y+' 영업이익(억 원)'),'비고'];
 const lines=vis.map(x=>{const r=x.row;return [x.g,x.i,SIDE[x.side],x.e.n,x.e.p?'본사 실적: '+x.e.p.n:(x.k?KIND[x.k]:'국내'),r?r.s:'',...(r?r.r.map(n1):['','','']),...(r?r.o.map(n1):['','','']),...(r?r.r.map((v,i)=>n1(margin(r.o[i],v))):['','','']),r?n1(grow(r.r,1)):'',r?n1(grow(r.r,2)):'',x.kr?(x.kn||x.e.n):'',x.kr?x.kr.s:'',...(x.kr?x.kr.r.map(n1):['','','']),...(x.kr?x.kr.o.map(n1):['','','']),r?'':(x.e.p&&x.e.p.w?x.e.p.w:x.e.w||'자료 없음(3개년 공시 실적 미확인)')]});
 const text='﻿'+[head,...lines].map(a=>a.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\r\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));a.download='국내글로벌_업체비교_'+String(GEN).slice(0,10)+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

/* 선정 기준·유의(설명) */
function basis(){const M=['①','②','③','④'];
 $('pc-basis').innerHTML=ROSTER.basis.map((t,i)=>'<li><span class="pc-bn" aria-hidden="true">'+(M[i]||'')+'</span><span>'+esc(t)+'</span></li>').join('');
 $('pc-notes').innerHTML=[
  '수치는 성장 분석의 회사별 상세(공시 기준, 억 원 환산)와 같은 값입니다. 매출·영업이익은 기업 전체 실적이며 반도체 사업만의 실적이 아닙니다.',
  '위 \'재무 기준\'에서 자동(국내업체는 개별·별도, 글로벌업체는 연결 기준 — 없으면 다른 기준)·연결만·개별만·한국 내 공시(글로벌은 한국 법인의 별도 재무)를 고를 수 있고, \'값\'에서 매출지수(2023=100)·매출액 합계·기업당 평균을 골라 그래프와 품목별 요약에 적용할 수 있습니다. 선택한 기준의 수치가 없는 업체는 \'자료 없음\'으로 두고 있는 기준을 안내합니다(미국·네덜란드 본사처럼 연결 재무제표만 공시하는 곳은 개별이 없음). 재무 기준(별도·개별·연결)이 업체마다 다릅니다. 국내업체와 한국 법인은 별도(개별) 재무, 해외 본사는 개별 우선·미공시 시 연결입니다. 회계기간·환율 차이도 있어 직접 비교에는 한계가 있습니다.',
  '글로벌업체는 본사 소재지 기준으로 구분했고, 수치도 한국 법인·지점·현지 법인이 아닌 본사(모회사)의 실적입니다. 명단의 한국 법인 아래에 \'본사 실적: ○○\'로 어느 본사의 값인지 표시했습니다. 본사가 여러 사업을 하는 그룹이면 회사 전체 실적이라 반도체 소재 사업 실적과 차이가 큽니다.',
  '글로벌 업체 아래의 \'한국 법인: …\'은 그 본사의 한국 법인(별도 재무제표)의 2025년 값으로, 본사 값과 함께 참고용으로만 보여 주며 합계·그래프에는 넣지 않습니다. 한국 법인이 명단에 없거나 공시 실적이 없는 본사는 표시하지 않습니다.',
  '같은 본사가 여러 업체의 본사로 나오거나 여러 품목에 있으면(예: ASML) 표에는 각각 보이지만 합계·그래프에서는 한 번만 셉니다. 본사의 공시 실적이 없거나 본사가 확정되지 않은 업체는 \'자료 없음\'으로 두고 그룹 실적으로 대체하지 않습니다.',
  '재무 기준 옆에 \'사업보고서\'·\'감사보고서\'로 표시된 업체는 성장 분석 집계에 없어, DART 사업보고서 또는 외부감사 보고서의 개별(별도) 재무에서 따로 가져온 값입니다(2023~2025년 모두 확인된 업체만).',
  '자료 없음은 2023~2025년 3개년 공시 실적이 확인되지 않은 업체입니다(비공시 법인 등). 수치를 추정하거나 만들지 않습니다.',
  '글로벌 원재료·부품 업체명 아래에는 본사 공시 참고실적을 현지 통화(백만 단위)로 표시합니다. 연도별 원문 검증 상태(공식 대조/2차 출처/대조 전)를 구분하며, 연결·개별 기준을 섞지 않습니다. 참고실적은 원화 합계·그래프·성장률에 포함하지 않습니다.',
  '전지 중심 기업(삼성에스디아이)은 회사 전체 실적이 반도체 소재 사업과 거리가 큽니다. 기본으로 합계·그래프에 포함하며, 위 필터의 \'합계에 포함\'을 끄면 수치는 그대로 두고 합계·그래프에서만 뺍니다.',
  '품목별 요약은 수치가 확인된 업체만 합산해, 확인된 업체가 적은 품목은 대표성이 낮습니다. 업체 명단의 순서는 표시 편의를 위한 것이며 순위나 구매액을 나타내지 않습니다.'].map(t=>'<li>'+esc(t)+'</li>').join('')}

/* 수치 미확인 업체 목록(명단 전체 기준) */
function missing(){const m=ALL.filter(x=>!x.cands.c&&!x.cands.s);$('pc-miss-h').textContent='비교용 원화 3개년 실적이 없는 업체 ('+m.length+'곳 / 명단 '+ALL.length+'곳)';
 $('pc-miss').innerHTML=m.map(x=>'<li><b>'+esc(x.e.n)+'</b> <small>'+SIDE[x.side]+' · '+esc(x.g===x.i?x.i:x.g+' › '+x.i)+'</small> — '+esc(rawParent(x)?'본사 공시 참고실적 있음(원본 통화·연도별 검증 상태는 업체명 아래 펼침 참고). 원화 합계에는 미포함.':(x.e.p&&x.e.p.w?x.e.p.w:x.e.w||(x.e.p?NO_PAR:NO_DATA)))+'</li>').join('')||'<li>모든 업체의 원화 3개년 실적이 확인되었습니다.</li>'}

/* 초기화 */
const tb=$('theme-btn');if(tb){const cur=()=>document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');const paint=()=>{const d=cur()==='dark';tb.innerHTML='<i class="ph ph-'+(d?'sun':'moon')+'" aria-hidden="true"></i>';tb.title=d?'밝은 화면으로':'어두운 화면으로'};tb.addEventListener('click',()=>{const t=cur()==='dark'?'light':'dark';document.documentElement.dataset.theme=t;try{localStorage.setItem('sobujang:theme',t)}catch(e){}paint()});paint()}
const get=u=>fetch(u,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(u+' '+r.status);return r.json()});
Promise.all([get('data/pair-roster.json'),get('data/growth-companies.json'),get('data/pair-extra.json').catch(()=>({rows:[]})),get('data/pair-parent-consolidated.json').catch(()=>({companies:[]}))]).then(([R,G,X,P])=>{
 RAW_PARENT=Object.fromEntries(((P&&P.companies)||[]).map(c=>[c.name,c]));
 ROSTER=R;GEN=G.generatedAt||'';const bl=(G.modes||[]).find(m=>m.id==='blend')||(G.modes||[])[0];ALL=build(R,G.modes||[],X&&X.rows);applyBasis();
 basis();missing();fillGroups();{const xs=[...new Set(ALL.filter(x=>x.e.x).map(x=>x.e.n))];$('f-x-l').textContent=xs.join('·')+' 합계에 포함';if(!xs.length)$('f-x').parentElement.hidden=true}
 try{const p=new URLSearchParams(location.hash.slice(1));if(p.get('g')&&[...$('f-grp').options].some(o=>o.value===p.get('g'))){$('f-grp').value=p.get('g');fillItems()}if(p.get('i')&&[...$('f-item').options].some(o=>o.value===p.get('i')))$('f-item').value=p.get('i');if(p.get('q'))$('f-q').value=p.get('q');if(p.get('x')==='0')$('f-x').checked=false;if(['c','s','k'].includes(p.get('b')))$('f-basis').value=p.get('b');if(['idx','avg'].includes(p.get('v')))$('f-val').value=p.get('v')}catch(e){}
 $('updated').textContent=GEN.slice(0,10)||'-';
 const ds=document.querySelector('.site-data-status__item');if(ds&&GEN){const n=ds.querySelector('.site-data-status__date'),t=ds.querySelector('.site-data-status__state');if(n)n.textContent=GEN.slice(0,10)+' 기준 · 업체 '+ALL.length+'곳 중 수치 확인 '+ALL.filter(x=>x.row).length+'곳';if(t){t.textContent='최근 집계 완료';t.className='site-data-status__state is-fresh'}}
 $('f-grp').addEventListener('change',()=>{fillItems();$('f-item').value='';render()});$('f-item').addEventListener('change',render);$('f-q').addEventListener('input',render);$('f-x').addEventListener('change',render);$('f-basis').addEventListener('change',render);$('f-val').addEventListener('change',render);
 $('pc-tbl').addEventListener('click',e=>{const b=e.target.closest('button[data-k]');if(!b)return;const k=b.dataset.k;if(sortKey===k)sortDir=-sortDir;else{sortKey=k;sortDir=(k==='n'||k==='side'||k==='s')?1:-1}render()});
 $('pc-csv').addEventListener('click',csv);
 render();
}).catch(()=>{const m='<p class="gc-empty">업체 비교 자료를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>';['pc-pairs'].forEach(id=>{const e=$(id);if(e)e.innerHTML=m})});
})();
