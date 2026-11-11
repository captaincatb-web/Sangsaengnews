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
let ROSTER=null,ALL=[],GEN='',sortKey=null,sortDir=1;

/* 명단 + 공개 회사별 수치 연결. 이름이 정확히 같은 행만 쓴다 */
/* 후보 수치: 같은 이름의 공개 행(비교 기준 모드 blend·cons_listed)과 따로 수집한 값(pair-extra)을 재무 기준별로 모은다. c=연결, s=개별·별도 */
const kindOf=sc=>sc==='연결'?'c':'s';
function build(R,modes,extra){const idx={};
 const add=(n,r)=>{const o=idx[n]||(idx[n]={c:null,s:null}),k=kindOf(r.s);if(!o[k])o[k]=r};
 ['blend','cons_listed'].forEach(id=>{const m=(modes||[]).find(x=>x.id===id);((m&&m.rows)||[]).forEach(r=>add(r.n,r))});
 (extra||[]).forEach(r=>add(r.n,r));
 const out=[];
 R.groups.forEach(gr=>gr.items.forEach(it=>['dom','glo'].forEach(side=>it[side].forEach(e=>{
  /* 글로벌 업체는 본사 실적(e.p)을 쓴다: 공개 회사별 상세(p.m)에 없으면 따로 수집한 본사 공시(pair-extra.json, p.n). 국내업체는 자기 실적(m, 없으면 pair-extra) */
  const P=e.p||null,nm=P?(P.m||P.n):(e.m||e.n),cands=idx[nm]||{c:null,s:null};
  const kn=e.km||e.kx||null,kc=kn?(idx[kn]||{}):null,kr=kc?(kc.s||kc.c||null):null;  /* 글로벌 업체의 한국 법인(별도 재무) 값: 합계에는 넣지 않고 함께 보여 준다 */
  out.push({g:gr.g,i:it.i,side,e,cands,row:null,kr,kn,k:side==='glo'?e.k:null,ord:out.length,key:nm,bkey:nm})}))));return out}
const fbasis=()=>{const b=$('f-basis');return b?b.value:'auto'};
/* 재무 기준 적용: auto=개별 우선(없으면 연결, 성장 분석 규칙), c=연결만, s=개별·별도만 */
const fval=()=>{const v=$('f-val');return v?v.value:'sum'};
/* k: 한국 내 공시 — 글로벌 업체는 한국 법인(별도) 값, 국내업체는 자기 값(자동). 한국 법인은 업체마다 따로라 합계에서 서로 겹치지 않는다 */
function applyBasis(){const b=fbasis();ALL.forEach(x=>{const c=x.cands;
 if(b==='k'&&x.side==='glo'){x.row=x.kr;x.key='K:'+(x.kn||x.e.n)}
 else{x.key=x.bkey;x.row=b==='c'?c.c:b==='s'?c.s:(c.s||c.c)}})}

const state=()=>({g:$('f-grp').value,i:$('f-item').value,q:($('f-q').value||'').trim().toLowerCase()});
function visible(){const s=state();return ALL.filter(x=>(!s.g||x.g===s.g)&&(!s.i||x.i===s.i)&&(!s.q||x.e.n.toLowerCase().includes(s.q)||x.e.f.toLowerCase().includes(s.q)))}
/* 선택한 재무 기준의 수치가 없지만 다른 기준에는 있을 때의 안내 */
const otherBasis=x=>{const b=fbasis();if(b==='auto')return '';if(b==='k')return x.side==='glo'?(x.kn?'이 한국 법인의 공시 실적이 3개년 확인되지 않았습니다.':'명단에 한국 법인이 없거나 공시 실적이 확인되지 않았습니다.')+(x.cands.c||x.cands.s?' (본사 기준 값은 있음)':''):'';const have=[x.cands.c&&'연결',x.cands.s&&'개별·별도'].filter(Boolean);return have.length?(b==='c'?'연결':'개별·별도')+' 기준 자료가 없습니다(있는 기준: '+have.join('·')+').':''};
const incX=()=>{const c=$('f-x');return !c||c.checked};
const inSumRaw=x=>x.row&&(!x.e.x||incX());
const uniqSum=list=>{const seen=new Set();return list.filter(x=>{if(!inSumRaw(x)||seen.has(x.key))return false;seen.add(x.key);return true})};  /* 같은 본사·같은 업체는 합계에서 한 번만 센다 */  /* 전지 중심 기업 등(x 표시)은 필터에서 '합계에 포함'을 끄면 수치만 보여 주고 합계·그래프에서 뺀다 */
function agg(list){const has=uniqSum(list),r2=has.reduce((t,x)=>t+x.row.r[2],0),o2=has.reduce((t,x)=>t+x.row.o[2],0),r0=has.reduce((t,x)=>t+x.row.r[0],0);
 return{n:list.length,k:has.length,rev:r2,op:o2,r0,m:has.length?margin(o2,r2):null,c:has.length&&r0?(r2/r0-1)*100:null}}
const krTxt=x=>x.kr?'한국 법인'+(x.kn&&x.kn!==x.e.n?'('+x.kn+')':'')+': 2025 매출 '+fmt(x.kr.r[2])+'억 · 영업이익률 '+pct(margin(x.kr.o[2],x.kr.r[2]))+' ('+x.kr.s+(x.kr.src?' · '+x.kr.src:'')+')':'';
const tagOf=x=>fbasis()==='k'&&x.side==='glo'?['한국 법인'+(x.kn&&x.kn!==x.e.n?'('+x.kn+')':''),x.row&&x.row.s,x.row&&x.row.src].filter(Boolean).join(' · '):[x.e.p?(x.row?'본사 실적: '+x.e.p.n:''):(x.k&&KIND[x.k]),x.row&&x.row.s,x.row&&x.row.src].filter(Boolean).join(' · ');

/* 구분→품목 선택지 */
function fillGroups(){const g=$('f-grp');ROSTER.groups.forEach(gr=>g.add(new Option(gr.g,gr.g)));fillItems()}
function fillItems(){const it=$('f-item'),cur=it.value,g=$('f-grp').value;it.length=1;
 ROSTER.groups.filter(gr=>!g||gr.g===g).forEach(gr=>gr.items.forEach(x=>{if(!g&&gr.items.length===1&&gr.g===x.i){it.add(new Option(x.i,x.i))}else it.add(new Option(g?x.i:gr.g+' › '+x.i,x.i))}));
 if([...it.options].some(o=>o.value===cur))it.value=cur}

function render(){
 applyBasis();const vis=visible(),items=[];vis.forEach(x=>{const k=x.g+'\u0000'+x.i;if(!items.some(a=>a.k===k))items.push({k,g:x.g,i:x.i})});
 const dm=vis.filter(x=>x.side==='dom'),gl=vis.filter(x=>x.side==='glo');
 $('pc-count').textContent='국내 '+dm.length+'곳 · 글로벌 '+gl.length+'곳 (수치 확인 국내 '+dm.filter(x=>x.row).length+'곳 · 글로벌 '+gl.filter(x=>x.row).length+'곳)';
 key(vis,dm,gl);trend(dm,gl);summary(items,vis);pairs(items,vis);detail(vis);
 try{const s=state(),h=[];if(s.g)h.push('g='+encodeURIComponent(s.g));if(s.i)h.push('i='+encodeURIComponent(s.i));if(s.q)h.push('q='+encodeURIComponent(s.q));if(!incX())h.push('x=0');if(fbasis()!=='auto')h.push('b='+fbasis());if(fval()!=='sum')h.push('v='+fval());history.replaceState(null,'',h.length?'#'+h.join('&'):location.pathname+location.search)}catch(e){}}

/* 연도별 실적 추이: 왼쪽 국내업체, 오른쪽 글로벌업체. 매출(왼쪽 축)·영업이익(오른쪽 축) 막대 + 영업이익률 선(소부장 경영 정보의 연도별 실적 추이와 같은 구성) */
const YRS=[2023,2024,2025],NS='http://www.w3.org/2000/svg';
const axis=(vals,k)=>{const mn=Math.min(0,...vals),mx=Math.max(0,...vals),rg=(mx-mn)||1,e=Math.pow(10,Math.floor(Math.log10(rg/k)));
 for(const f of [1,1.2,1.5,2,2.5,3,4,5,6,8,10,12,15,20,25,30,40,50,100]){const step=f*e,lo=mn<0?-Math.ceil(-mn/step)*step:0;if(lo+step*k>=mx)return{lo,step}}return{lo:0,step:rg/k}};
const tick=big=>v=>big?(v/10000).toLocaleString('ko-KR',{maximumFractionDigits:1})+'조':Math.round(v).toLocaleString('ko-KR');
const money=v=>v==null?'–':Math.abs(v)>=10000?(v/10000).toLocaleString('ko-KR',{maximumFractionDigits:1})+'조 원':Math.round(v).toLocaleString('ko-KR')+'억 원';
function trendSvg(side,list){const has=uniqSum(list),vm=fval();
 if(!has.length)return '<p class="gc-empty">수치가 확인된 업체가 없습니다.</p>';
 const N=has.length,S=YRS.map((_,i)=>has.reduce((t,x)=>t+x.row.r[i],0)),O=YRS.map((_,i)=>has.reduce((t,x)=>t+x.row.o[i],0)),M=S.map((v,i)=>v>0?O[i]/v*100:null);
 /* 값 선택: sum=합계, avg=기업당 평균, idx=매출지수(2023=100, 매출 막대만). 매출·영업이익은 한 눈금을 써서 영업이익 막대가 매출 막대보다 높아지지 않는다 */
 const A=vm==='avg'?S.map(v=>v/N):vm==='idx'?S.map(v=>S[0]?v/S[0]*100:null):S,B=vm==='avg'?O.map(v=>v/N):vm==='idx'?null:O;
 const W=520,H=290,L=54,R=B?54:18,T=14,Bm=28,k=4,band=92,pw=W-L-R,ph=H-T-Bm,bh=ph-band,top=T+band;
 const aS=axis(A.map(v=>v==null?0:v),k),big=Math.max(...A.map(v=>Math.abs(v||0)))>=10000&&vm!=='idx';
 const yS=v=>top+bh-(v-aS.lo)/(aS.step*k)*bh,zS=yS(Math.max(0,aS.lo));
 /* 영업이익은 오른쪽 축: 매출과 눈금이 달라도 영업이익 막대가 매출 막대보다 낮게(매출 막대 높이의 90% 이하) 나오도록 눈금 간격을 고른다 */
 const aO=B?(()=>{const mn=Math.min(0,...B),mx=Math.max(0,...B),rg=(mx-mn)||1,e0=Math.pow(10,Math.floor(Math.log10(rg/k)));let last=null;
  for(const e of [e0,e0*10]){for(const f of [1,1.2,1.5,2,2.5,3,4,5,6,8]){const step=f*e,lo=mn<0?-Math.ceil(-mn/step)*step:0;if(lo+step*k<mx)continue;last={lo,step};
   if(B.every((o,i)=>{if(!(o>0)||!(A[i]>0))return true;const yo=top+bh-(o-lo)/(step*k)*bh,ys=yS(A[i]);return yo>=ys+0.1*(zS-ys)}))return last}}
  return last||{lo:0,step:rg/k}})():null;
 const yO=v=>aO?top+bh-(v-aO.lo)/(aO.step*k)*bh:0,zO=aO?yO(Math.max(0,aO.lo)):0,bigO=B?Math.max(...B.map(Math.abs))>=10000:false;
 const mv=M.filter(v=>v!=null),mn=Math.min(...mv),mx=Math.max(...mv),pad=Math.max((mx-mn)*.25,.5),lo=mn-pad,sp=mx+pad-lo||1,ym=v=>T+18+(1-(v-lo)/sp)*(band-36);
 const slot=pw/3,bw=Math.min(34,slot*.3),cx=i=>L+slot*i+slot/2,tk=vm==='idx'?v=>Math.round(v).toLocaleString('ko-KR'):tick(big),tkO=tick(bigO),fm=vm==='idx'?v=>v==null?'–':Math.round(v).toString():money;
 let g='<text class="ax" x="'+(L-6)+'" y="'+(T+12)+'" text-anchor="end">이익률</text><line class="grid" x1="'+L+'" x2="'+(W-R)+'" y1="'+(top-6)+'" y2="'+(top-6)+'" stroke-dasharray="2 3"/>';
 for(let i=0;i<=k;i++){const yy=yS(aS.lo+aS.step*i);g+='<line class="grid" x1="'+L+'" x2="'+(W-R)+'" y1="'+yy+'" y2="'+yy+'"/><text class="ax axl" x="'+(L-6)+'" y="'+(yy+4)+'" text-anchor="end">'+tk(aS.lo+aS.step*i)+'</text>'+(aO?'<text class="ax axr" x="'+(W-R+6)+'" y="'+(yy+4)+'">'+tkO(aO.lo+aO.step*i)+'</text>':'')}
 if(aO&&aO.lo<0)g+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+zO+'" y2="'+zO+'" stroke="var(--text-3)" stroke-width="1"/>';
 const info=YRS.map((yr,i)=>vm==='idx'?yr+'년 · 매출지수 '+fm(A[i])+' (2023=100) · 영업이익률 '+pct(M[i]):yr+'년 · '+(vm==='avg'?'기업당 평균 ':'')+'매출 '+money(A[i])+' · 영업이익 '+money(B[i])+' · 영업이익률 '+pct(M[i]));
 YRS.forEach((yr,i)=>{const x=cx(i),a=A[i]==null?0:A[i],ys=Math.min(yS(a),zS),hs=Math.max(1,Math.abs(yS(a)-zS)),xs=B?x-bw-1:x-bw/2;
  g+='<g class="slot" style="--i:'+i+'" tabindex="0" data-i="'+i+'"><rect class="colbg" x="'+(x-slot/2+2)+'" y="'+T+'" width="'+(slot-4)+'" height="'+ph+'" rx="10"/>'+
   '<rect class="bar" x="'+xs+'" y="'+ys+'" width="'+bw+'" height="'+hs+'" rx="3" fill="var(--blue)"/>';
  if(B){const o=B[i],yo=Math.min(yO(o),zO),ho=Math.max(1,Math.abs(yO(o)-zO));g+='<rect class="bar" x="'+(x+1)+'" y="'+yo+'" width="'+bw+'" height="'+ho+'" rx="3" fill="'+(o<0?'var(--down)':'var(--green)')+'"/>'}
  g+='<text class="val" x="'+(xs+bw/2)+'" y="'+(ys-5)+'" text-anchor="middle">'+(vm==='idx'?fm(A[i]):tk(A[i]))+'</text>'+
   '<text class="ax" x="'+x+'" y="'+(H-8)+'" text-anchor="middle">'+yr+'</text><rect class="hit" x="'+(x-slot/2)+'" y="'+T+'" width="'+slot+'" height="'+ph+'"/></g>'});
 const pts=M.map((m,i)=>m==null?null:[cx(i),ym(m),m]).filter(Boolean);
 g+='<polyline points="'+pts.map(p=>p[0]+','+p[1]).join(' ')+'" fill="none" stroke="var(--orange)" stroke-width="2.2" stroke-linejoin="round"/>';
 pts.forEach(p=>{g+='<circle cx="'+p[0]+'" cy="'+p[1]+'" r="3.5" fill="var(--card)" stroke="var(--orange)" stroke-width="2"/><text class="mval" x="'+p[0]+'" y="'+(p[1]-8)+'" text-anchor="middle">'+pct(p[2])+'</text>'});
 return '<div class="pc-tp pc-'+side+'"><h3>'+SIDE[side]+' <small>수치 확인 '+has.length+'/'+list.length+'곳'+(vm==='avg'?' 평균':vm==='idx'?' 합계 기준':' 합계')+'</small></h3><div class="db-chart pcg"><svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+SIDE[side]+' 2023~2025 '+(vm==='idx'?'매출지수·영업이익률':'매출·영업이익·영업이익률')+'. '+esc(info.join(' / '))+'">'+g+'</svg></div><p class="pc-strip" aria-live="polite" data-info="'+esc(JSON.stringify(info))+'">'+esc(info[2])+'</p></div>'}
function trend(dm,gl){const box=$('pc-trend'),vm=fval();box.innerHTML=trendSvg('dom',dm)+trendSvg('glo',gl);
 const sq=c=>'<i class="sq" style="background:var('+c+')"></i>';
 $('pc-legend').innerHTML=vm==='idx'?'<li>'+sq('--blue')+'매출지수(2023=100)</li><li>'+sq('--orange')+'영업이익률</li>':'<li>'+sq('--blue')+(vm==='avg'?'기업당 평균 매출':'매출')+'(왼쪽 축)</li><li>'+sq('--green')+(vm==='avg'?'기업당 평균 영업이익':'영업이익')+'(오른쪽 축)</li><li>'+sq('--orange')+'영업이익률</li>';
 const n=$('pc-trend-note');if(n)n.textContent=vm==='idx'?'지수는 각 그래프의 2023년 매출 합계를 100으로 둔 값입니다. 영업이익률은 영업이익 합계 ÷ 매출 합계입니다.':'국내와 글로벌은 규모가 달라 두 그래프의 눈금이 서로 다릅니다. 매출은 왼쪽 축, 영업이익은 오른쪽 축 눈금입니다. 영업이익 막대가 매출 막대보다 낮게 나오도록 오른쪽 눈금을 맞췄으므로, 두 막대의 높이를 직접 견주지 말고 각 축의 값으로 읽어 주세요(적자는 0 아래).';
 const sb=$('pc-trend-sub');if(sb)sb.textContent='2023~2025 · 수치가 확인된 업체의 '+(vm==='avg'?'기업당 평균':vm==='idx'?'매출 합계 지수':'합계')+' · 왼쪽 국내업체, 오른쪽 글로벌업체'}
document.addEventListener('pointerover',e=>{const s=e.target.closest&&e.target.closest('.pcg .slot');if(s)strip(s)});document.addEventListener('focusin',e=>{const s=e.target.closest&&e.target.closest('.pcg .slot');if(s)strip(s)});
function strip(s){const p=s.closest('.pc-tp').querySelector('.pc-strip');try{p.textContent=JSON.parse(p.dataset.info)[+s.dataset.i]}catch(e){}}

/* 제목 아래 한 줄 요약 */
function key(vis,dm,gl){const k=$('pc-key'),a=agg(dm),b=agg(gl);
 if(!a.k||!b.k||a.m==null||b.m==null){k.hidden=true;k.innerHTML='';return}
 const s=state(),cond=[s.g,s.i&&s.i!==s.g?s.i:''].filter(Boolean).join(' › ');
 const gap=a.m-b.m,sp=(side,t)=>'<span style="color:'+INK[side]+'">'+SIDE[side]+' '+t+'</span>';
 k.hidden=false;k.innerHTML=(cond?'<span class="gc-key-c">'+esc(cond)+'</span>':'')+
  '<span><b>2025년 영업이익률</b> '+sp('dom',pct(a.m))+' · '+sp('glo',pct(b.m))+(Math.abs(gap)>=0.05?' <small>('+(gap>0?'국내':'글로벌')+'업체가 '+Math.abs(gap).toFixed(1)+'%p 높음)</small>':'')+'</span>'+
  '<span><b>2023→2025 매출</b> '+sp('dom',sg(a.c))+' · '+sp('glo',sg(b.c))+'</span>'}

/* 품목별 요약 표 */
function summary(items,vis){const t=$('pc-sum'),vm=fval();
 if(!items.length){t.innerHTML='';return}
 const lab=vm==='idx'?'2025 매출지수(2023=100)':vm==='avg'?'기업당 2025 매출(억 원)':'2025 매출(억 원)';
 const rv=a=>vm==='idx'?(a.r0?fmt(a.rev/a.r0*100):'–'):vm==='avg'?fmt(a.rev/a.k):fmt(a.rev);
 const cell=a=>a.k?'<td>'+rv(a)+'<small>'+a.k+'/'+a.n+'곳</small></td><td>'+pct(a.m)+'</td><td>'+sg(a.c)+'</td>':'<td class="pc-na">자료 없음<small>0/'+a.n+'곳</small></td><td>–</td><td>–</td>';
 const th='<thead><tr><th scope="col" rowspan="2" class="l">구분 › 품목</th><th scope="colgroup" colspan="3" class="pc-gh pc-dom">국내업체</th><th scope="colgroup" colspan="3" class="pc-gh pc-glo">글로벌업체</th><th scope="col" rowspan="2">영업이익률 차이<small>국내 − 글로벌</small></th></tr><tr>'+
  [lab,'2025 영업이익률','매출 성장 23→25',lab,'2025 영업이익률','매출 성장 23→25'].map(x=>'<th scope="col">'+x+'</th>').join('')+'</tr></thead>';
 const body=items.map(it=>{const l=vis.filter(x=>x.g===it.g&&x.i===it.i),a=agg(l.filter(x=>x.side==='dom')),b=agg(l.filter(x=>x.side==='glo')),d=a.m!=null&&b.m!=null?a.m-b.m:null;
  return '<tr><th scope="row" class="l">'+(it.g===it.i?esc(it.i):esc(it.g)+' › '+esc(it.i))+'</th>'+cell(a)+cell(b)+'<td class="pc-diff">'+pp(d)+'</td></tr>'}).join('');
 t.innerHTML=th+'<tbody>'+body+'</tbody>'}

/* 품목별 국내업체 | 글로벌업체 */
function pairs(items,vis){const box=$('pc-pairs');
 if(!items.length){box.innerHTML='<p class="gc-empty">조건에 맞는 업체가 없습니다.</p>';return}
 const col=(side,list)=>{const a=agg(list);
  const rows=list.map(x=>{const r=x.row,tg=tagOf(x),nm='<th scope="row" class="l"><span class="pc-n" title="'+esc(x.e.f)+'">'+esc(x.e.n)+'</span>'+(tg?'<small>'+esc(tg)+'</small>':'')+(x.kr&&fbasis()!=='k'?'<small class="pc-kr">'+esc(krTxt(x))+'</small>':'')+(!r?'<small class="pc-why">'+esc(otherBasis(x)||(x.e.p&&x.e.p.w?x.e.p.w:x.e.w||(x.e.p?NO_PAR:'')))+'</small>':'')+(x.e.x?'<small class="pc-why">'+esc(x.e.x)+' · 합계에 '+(incX()?'포함 중':'제외 중')+'</small>':'')+'</th>';
   return r?'<tr>'+nm+'<td>'+fmt(r.r[2])+'</td><td class="pc-hm">'+sg(grow(r.r,2))+'</td><td>'+pct(margin(r.o[2],r.r[2]))+'</td></tr>':'<tr class="pc-none">'+nm+'<td colspan="3" class="pc-na">자료 없음</td></tr>'}).join('');
  return '<div class="pc-col pc-'+side+'"><h4>'+SIDE[side]+' <small>수치 확인 '+a.k+'/'+a.n+'곳</small></h4><div class="db-tbl-wrap"><table class="db-tbl pc-tbl"><caption class="sr-only">'+SIDE[side]+' 2025년 매출·매출 증감·영업이익률</caption><thead><tr><th scope="col" class="l">업체</th><th scope="col">2025 매출(억 원)</th><th scope="col" class="pc-hm">매출 증감</th><th scope="col">영업이익률</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>'};
 box.innerHTML=items.map(it=>{const l=vis.filter(x=>x.g===it.g&&x.i===it.i);
  return '<section class="pc-item" aria-label="'+esc(it.g===it.i?it.i:it.g+' '+it.i)+'"><h3 class="pc-ih">'+(it.g===it.i?esc(it.i):esc(it.g)+' › '+esc(it.i))+'</h3><div class="pc-cols">'+col('dom',l.filter(x=>x.side==='dom'))+col('glo',l.filter(x=>x.side==='glo'))+'</div></section>'}).join('')}

/* 업체별 상세(성장 분석 회사별 상세와 같은 열) */
const COLS=[['n','업체',1],['side','구분',1],['s','재무 기준',1],['r0','2023 매출(억 원)',0],['r1','2024 매출',0],['r2','2025 매출',0],['o2','2025 영업이익(억 원)',0],['m0','2023 영업이익률',0],['m1','2024 영업이익률',0],['m2','2025 영업이익률',0],['g1','매출 성장 2024',0],['g2','매출 성장 2025',0],['kr2','한국 법인 2025 매출(억 원)',0],['krm','한국 법인 2025 영업이익률',0]];
function val(x,k){const r=x.row;if(k==='kr2')return x.kr?x.kr.r[2]:null;if(k==='krm')return x.kr?margin(x.kr.o[2],x.kr.r[2]):null;if(!r&&k!=='n'&&k!=='side'&&k!=='s')return null;switch(k){case'n':return x.e.n;case'side':return SIDE[x.side];case's':return tagOf(x);case'r0':case'r1':case'r2':return r.r[+k[1]];case'o2':return r.o[2];case'm0':case'm1':case'm2':return margin(r.o[+k[1]],r.r[+k[1]]);case'g1':return grow(r.r,1);case'g2':return grow(r.r,2)}}
function detail(vis){const rows=vis.filter(x=>x.row||x.kr),miss=vis.length-rows.length;
 let l=rows.slice();
 if(sortKey)l.sort((a,b)=>{const A=val(a,sortKey),B=val(b,sortKey);if(A==null&&B==null)return 0;if(A==null)return 1;if(B==null)return -1;return(typeof A==='string'?A.localeCompare(B,'ko'):A-B)*sortDir});
 $('pc-empty').hidden=l.length>0;
 const head='<thead><tr>'+COLS.map(([k,t,s])=>'<th scope="col" class="'+(s?'l':'')+'" aria-sort="'+(sortKey===k?(sortDir>0?'ascending':'descending'):'none')+'"><button type="button" data-k="'+k+'">'+esc(t)+(sortKey===k?(sortDir>0?' ▲':' ▼'):'')+'</button></th>').join('')+'</tr></thead>';
 const body='<tbody>'+l.map(x=>{const r=x.row?x.row.r:[null,null,null],o=x.row?x.row.o:[null,null,null],K=x.kr;return '<tr><th scope="row" class="l"><span class="co-n" title="'+esc(x.e.f)+'">'+esc(x.e.n)+'</span><small>'+esc(x.g===x.i?x.i:x.g+' › '+x.i)+'</small></th><td class="l pc-s-'+x.side+'">'+SIDE[x.side]+'</td><td class="l">'+esc(tagOf(x))+'</td><td>'+fmt(r[0])+'</td><td>'+fmt(r[1])+'</td><td>'+fmt(r[2])+'</td><td>'+fmt(o[2])+'</td><td>'+pct(margin(o[0],r[0]))+'</td><td>'+pct(margin(o[1],r[1]))+'</td><td>'+pct(margin(o[2],r[2]))+'</td><td>'+sg(grow(r,1))+'</td><td>'+sg(grow(r,2))+'</td><td>'+(K?fmt(K.r[2]):'–')+'</td><td>'+(K?pct(margin(K.o[2],K.r[2])):'–')+'</td></tr>'}).join('')+'</tbody>';
 $('pc-tbl').innerHTML=l.length?head+body:'';
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
  '위 \'재무 기준\'에서 자동(개별·별도 우선, 없으면 연결)·연결만·개별만·한국 내 공시(글로벌은 한국 법인의 별도 재무)를 고를 수 있고, \'값\'에서 매출지수(2023=100)·매출액 합계·기업당 평균을 골라 그래프와 품목별 요약에 적용할 수 있습니다. 선택한 기준의 수치가 없는 업체는 \'자료 없음\'으로 두고 있는 기준을 안내합니다(미국·네덜란드 본사처럼 연결 재무제표만 공시하는 곳은 개별이 없음). 재무 기준(별도·개별·연결)이 업체마다 다릅니다. 국내업체와 한국 법인은 별도(개별) 재무, 해외 본사는 개별 우선·미공시 시 연결입니다. 회계기간·환율 차이도 있어 직접 비교에는 한계가 있습니다.',
  '글로벌업체는 본사 소재지 기준으로 구분했고, 수치도 한국 법인·지점·현지 법인이 아닌 본사(모회사)의 실적입니다. 명단의 한국 법인 아래에 \'본사 실적: ○○\'로 어느 본사의 값인지 표시했습니다. 본사가 여러 사업을 하는 그룹이면 회사 전체 실적이라 반도체 소재 사업 실적과 차이가 큽니다.',
  '글로벌 업체 아래의 \'한국 법인: …\'은 그 본사의 한국 법인(별도 재무제표)의 2025년 값으로, 본사 값과 함께 참고용으로만 보여 주며 합계·그래프에는 넣지 않습니다. 한국 법인이 명단에 없거나 공시 실적이 없는 본사는 표시하지 않습니다.',
  '같은 본사가 여러 업체의 본사로 나오거나 여러 품목에 있으면(예: ASML) 표에는 각각 보이지만 합계·그래프에서는 한 번만 셉니다. 본사의 공시 실적이 없거나 본사가 확정되지 않은 업체는 \'자료 없음\'으로 두고 그룹 실적으로 대체하지 않습니다.',
  '재무 기준 옆에 \'사업보고서\'·\'감사보고서\'로 표시된 업체는 성장 분석 집계에 없어, DART 사업보고서 또는 외부감사 보고서의 개별(별도) 재무에서 따로 가져온 값입니다(2023~2025년 모두 확인된 업체만).',
  '자료 없음은 2023~2025년 3개년 공시 실적이 확인되지 않은 업체입니다(비공시 법인 등). 수치를 추정하거나 만들지 않습니다.',
  '전지 중심 기업(삼성에스디아이)은 회사 전체 실적이 반도체 소재 사업과 거리가 큽니다. 기본으로 합계·그래프에 포함하며, 위 필터의 \'합계에 포함\'을 끄면 수치는 그대로 두고 합계·그래프에서만 뺍니다.',
  '품목별 요약은 수치가 확인된 업체만 합산해, 확인된 업체가 적은 품목은 대표성이 낮습니다. 업체 명단의 순서는 표시 편의를 위한 것이며 순위나 구매액을 나타내지 않습니다.'].map(t=>'<li>'+esc(t)+'</li>').join('')}

/* 수치 미확인 업체 목록(명단 전체 기준) */
function missing(){const m=ALL.filter(x=>!x.cands.c&&!x.cands.s);$('pc-miss-h').textContent='수치가 확인되지 않은 업체 ('+m.length+'곳 / 명단 '+ALL.length+'곳)';
 $('pc-miss').innerHTML=m.map(x=>'<li><b>'+esc(x.e.n)+'</b> <small>'+SIDE[x.side]+' · '+esc(x.g===x.i?x.i:x.g+' › '+x.i)+'</small> — '+esc(x.e.p&&x.e.p.w?x.e.p.w:x.e.w||(x.e.p?NO_PAR:NO_DATA))+'</li>').join('')||'<li>모든 업체의 수치가 확인되었습니다.</li>'}

/* 초기화 */
const tb=$('theme-btn');if(tb){const cur=()=>document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');const paint=()=>{const d=cur()==='dark';tb.innerHTML='<i class="ph ph-'+(d?'sun':'moon')+'" aria-hidden="true"></i>';tb.title=d?'밝은 화면으로':'어두운 화면으로'};tb.addEventListener('click',()=>{const t=cur()==='dark'?'light':'dark';document.documentElement.dataset.theme=t;try{localStorage.setItem('sobujang:theme',t)}catch(e){}paint()});paint()}
const get=u=>fetch(u,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(u+' '+r.status);return r.json()});
Promise.all([get('data/pair-roster.json'),get('data/growth-companies.json'),get('data/pair-extra.json').catch(()=>({rows:[]}))]).then(([R,G,X])=>{
 ROSTER=R;GEN=G.generatedAt||'';const bl=(G.modes||[]).find(m=>m.id==='blend')||(G.modes||[])[0];ALL=build(R,G.modes||[],X&&X.rows);applyBasis();
 basis();missing();fillGroups();{const xs=[...new Set(ALL.filter(x=>x.e.x).map(x=>x.e.n))];$('f-x-l').textContent=xs.join('·')+' 합계에 포함';if(!xs.length)$('f-x').parentElement.hidden=true}
 try{const p=new URLSearchParams(location.hash.slice(1));if(p.get('g')&&[...$('f-grp').options].some(o=>o.value===p.get('g'))){$('f-grp').value=p.get('g');fillItems()}if(p.get('i')&&[...$('f-item').options].some(o=>o.value===p.get('i')))$('f-item').value=p.get('i');if(p.get('q'))$('f-q').value=p.get('q');if(p.get('x')==='0')$('f-x').checked=false;if(['c','s','k'].includes(p.get('b')))$('f-basis').value=p.get('b');if(['idx','avg'].includes(p.get('v')))$('f-val').value=p.get('v')}catch(e){}
 $('updated').textContent=GEN.slice(0,10)||'-';
 const ds=document.querySelector('.site-data-status__item');if(ds&&GEN){const n=ds.querySelector('.site-data-status__date'),t=ds.querySelector('.site-data-status__state');if(n)n.textContent=GEN.slice(0,10)+' 기준 · 업체 '+ALL.length+'곳 중 수치 확인 '+ALL.filter(x=>x.row).length+'곳';if(t){t.textContent='최근 집계 완료';t.className='site-data-status__state is-fresh'}}
 $('f-grp').addEventListener('change',()=>{fillItems();$('f-item').value='';render()});$('f-item').addEventListener('change',render);$('f-q').addEventListener('input',render);$('f-x').addEventListener('change',render);$('f-basis').addEventListener('change',render);$('f-val').addEventListener('change',render);
 $('pc-tbl').addEventListener('click',e=>{const b=e.target.closest('button[data-k]');if(!b)return;const k=b.dataset.k;if(sortKey===k)sortDir=-sortDir;else{sortKey=k;sortDir=(k==='n'||k==='side'||k==='s')?1:-1}render()});
 $('pc-csv').addEventListener('click',csv);
 render();
}).catch(()=>{const m='<p class="gc-empty">업체 비교 자료를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>';['pc-pairs'].forEach(id=>{const e=$(id);if(e)e.innerHTML=m});$('pc-count').textContent=''});
})();
