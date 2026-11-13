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
let ROSTER=null,ALL=[],GEN='',RAW_PARENT={};

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
/* 글로벌 비교 기준: 해외 본사 연결(기본) 또는 한국 법인 별도. 한국 법인 모드에서 한국 법인이 없는 업체는 자료 없음으로 둔다 */
function applyBasis(){const kr=krMode();ALL.forEach(x=>{if(x.side==='glo'&&kr){x.row=x.kr||null;x.key=x.kr?'kr:'+x.kn:x.bkey}else{x.key=x.bkey;x.row=x.side==='glo'?(x.cands.c||(x.e.p&&x.e.p.f?x.cands.s:null)):x.cands.s}})}  /* p.f: 본사 연결 실적이 없는 비상장 본사는 개별(참고) 실적으로 대신 표시 */

const krMode=()=>{const e=$('f-kr');return !!e&&e.value==='kr'};
const sdiOff=()=>{const e=$('f-sdi');return !!e&&e.value==='ex'};
const state=()=>({g:$('f-grp').value,i:$('f-item').value,q:($('f-q').value||'').trim().toLowerCase()});
function visible(){const s=state();return ALL.filter(x=>!(sdiOff()&&x.e.x)&&(!s.g||x.g===s.g)&&(!s.i||x.i===s.i)&&(!s.q||x.e.n.toLowerCase().includes(s.q)||x.e.f.toLowerCase().includes(s.q)))}
/* 고정 기준 이외 자료가 있어도 비교 합계에는 포함하지 않는다. */
const otherBasis=x=>{const wanted=x.side==='glo'?(krMode()?'한국 법인 별도':'해외 본사 연결'):'국내업체 개별(별도)';
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
function rawDetails(raw,inSum){
 const num=v=>v==null?'–':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2});
 const years=[2023,2024,2025].map((y,i)=>'<div class="pc-parent-year"><span><b>'+y+'</b> 매출 '+num(raw.revenue[i])+' / 영업 '+num(raw.operating_profit[i])+'</span><small>'+esc(raw.verification?.[i]||'원문 대조 전')+' · '+esc(raw.periods[i])+'</small></div>').join('');
 const links=(raw.sources||[]).filter(s=>/^https:\/\/[a-z0-9.-]+(?:\/|$)/i.test(s.url||'')).map(s=>'<a href="'+esc(s.url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.label)+'</a>').join(' · ');
 return '<details class="pc-parent-raw"><summary>본사 '+esc(raw.scope||'연결')+' 공시 참고실적 · '+esc(raw.currency)+' '+esc(raw.unit||'백만')+' (2023~2025)</summary><div class="pc-parent-pop"><div class="pc-parent-rows">'+years+'</div><div class="pc-parent-status">'+esc(raw.status||'')+'</div><div class="pc-parent-why">'+esc(raw.note||'')+'</div>'+(links?'<div class="pc-parent-links">'+links+'</div>':'')+'<div class="pc-parent-hint">'+(inSum?'원화 환산 값은 표 수치와 합계에 반영됨':'해당 원본 통화 수치는 원화 비교 집계·성장률 제외')+' · '+esc(raw.operating_label||'영업이익')+'</div></div></details>';
}
const tagOf=x=>krMode()&&x.side==='glo'&&x.row?['한국 법인'+(x.kn&&x.kn!==x.e.n?': '+x.kn:''),x.row.s,x.row.src].filter(Boolean).join(' · '):[x.e.p?(x.row?'본사 실적: '+x.e.p.n:'본사 실적 참조: '+x.e.p.n):(x.k&&KIND[x.k]),x.row&&x.row.s,x.row&&x.row.src].filter(Boolean).join(' · ');

/* 구분→품목 선택지 */
function fillGroups(){const g=$('f-grp');ROSTER.groups.forEach(gr=>g.add(new Option(gr.g,gr.g)));fillItems()}
function fillItems(){const it=$('f-item'),cur=it.value,g=$('f-grp').value;it.length=1;
 ROSTER.groups.filter(gr=>!g||gr.g===g).forEach(gr=>gr.items.forEach(x=>{if(!g&&gr.items.length===1&&gr.g===x.i){it.add(new Option(x.i,x.i))}else it.add(new Option(g?x.i:gr.g+' › '+x.i,x.i))}));
 if([...it.options].some(o=>o.value===cur))it.value=cur}

function render(){
 applyBasis();const fb=document.querySelector('.pc-fixed-basis');if(fb)fb.textContent=krMode()?'※ 재무 기준: 국내업체 개별(별도) / 글로벌업체 한국 법인 별도(한국 법인이 없거나 공시가 없는 업체는 자료 없음).':'※ 재무 기준: 국내업체 개별(별도) / 글로벌업체 해외 본사 연결.';
 const vis=visible(),dm=vis.filter(x=>x.side==='dom'),gl=vis.filter(x=>x.side==='glo');
 key(vis,dm,gl);trend(dm,gl);insight(dm,gl);detail(vis);
 try{const s=state(),h=[];if(s.g)h.push('g='+encodeURIComponent(s.g));if(s.i)h.push('i='+encodeURIComponent(s.i));if(s.q)h.push('q='+encodeURIComponent(s.q));if(fval()!=='sum')h.push('v='+fval());if(sdiOff())h.push('sdi=ex');if(krMode())h.push('kr=1');history.replaceState(null,'',h.length?'#'+h.join('&'):location.pathname+location.search)}catch(e){}
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
function changeHtml(c){if(c.label==='—')return '';return '<span class="pc-change'+(c.tone?' is-'+c.tone:'')+'">'+esc(c.label)+'</span>'}
function trendSvg(side,list,over){
 const has=uniqSum(list),vm=fval();
 if(!has.length)return '<p class="gc-empty">'+SIDE[side]+' · 수치가 확인된 업체가 없습니다.</p>';
 const N=has.length,S=YRS.map((_,i)=>has.reduce((t,x)=>t+(x.row.r[i]||0),0)),O=YRS.map((_,i)=>has.reduce((t,x)=>t+(x.row.o[i]||0),0));
 const A=vm==='avg'?S.map(v=>v/N):vm==='idx'?S.map(v=>S[0]?v/S[0]*100:null):S;
 const B=vm==='avg'?O.map(v=>v/N):vm==='idx'?O.map(v=>O[0]>0?v/O[0]*100:null):O;
 const W=560,H=264,L=66,R=20,top=34,bottom=219,k=4,pw=W-L-R,slot=pw/3,bw=28;
 const shared=true,ax=over||axis((shared?A.concat(B):A).filter(Number.isFinite),k),ao=shared?ax:axis(B.filter(Number.isFinite),k);  /* 합계·평균은 매출·영업이익을 같은 눈금에 그려 영업이익 막대가 매출보다 작게 보이게 한다 */
 const sy=v=>bottom-(v-ax.lo)/(ax.step*k)*(bottom-top),oy=v=>bottom-(v-ao.lo)/(ao.step*k)*(bottom-top);
 const sz=sy(0),oz=oy(0),cx=i=>L+slot*(i+.5);
 const fmtA=v=>vm==='idx'?(v==null?'–':v.toFixed(0)):chartMoney(v);
 const lb=c=>c.label==='—'?'':' '+c.label+(c.label.slice(-1)==='%'||/[↑↓→]$/.test(c.label)?'(전년 대비)':''),info=YRS.map((y,i)=>y+'년 · 매출 '+chartMoney(S[i])+lb(change(S,i,false))+' · 영업이익 '+chartMoney(O[i])+lb(change(O,i,true)));
 const gtxt=c=>c.label==='—'?'':'<tspan class="g'+(c.tone?' g-'+c.tone:'')+'" dx="4">'+esc(c.label)+'</tspan>';
 let g='';
 for(let i=0;i<=k;i++){const yy=sy(ax.lo+ax.step*i);
  g+='<line class="grid" x1="'+L+'" x2="'+(W-R)+'" y1="'+yy+'" y2="'+yy+'"/>'+
  '<text class="ax axl" x="'+(L-7)+'" y="'+(yy+4)+'" text-anchor="end">'+(vm==='idx'?(ax.lo+ax.step*i).toFixed(0):chartMoney(ax.lo+ax.step*i))+'</text>'+
  (shared?'':'<text class="ax axr" x="'+(W-R+6)+'" y="'+(yy+4)+'">'+chartMoney(ao.lo+ao.step*i)+'</text>')}
 if(ao.lo<0)g+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+oz+'" y2="'+oz+'" stroke="var(--text-3)" stroke-width="1"/>';
 YRS.forEach((yr,i)=>{const x=cx(i),a=A[i]||0,o=B[i]||0,xs=x-44-bw/2,xo=x+44-bw/2,ys=Math.min(sy(a),sz),hs=Math.max(1,Math.abs(sy(a)-sz)),yo=Math.min(oy(o),oz),ho=Math.max(1,Math.abs(oy(o)-oz));
  const labelY=(v,y,h,z)=>v<0?z+h+12:y-6;
  g+='<g class="slot" style="--i:'+i+'" tabindex="0" data-i="'+i+'"><rect class="colbg" x="'+(x-slot/2+3)+'" y="'+top+'" width="'+(slot-6)+'" height="'+(bottom-top)+'" rx="8"/>'+
   '<rect class="bar" x="'+xs+'" y="'+ys+'" width="'+bw+'" height="'+hs+'" rx="3" fill="var(--blue)"/>'+
   '<rect class="bar" x="'+xo+'" y="'+yo+'" width="'+bw+'" height="'+ho+'" rx="3" fill="'+(o<0?'var(--down)':'var(--green)')+'"/>'+
   '<text class="val" x="'+(xs+bw/2)+'" y="'+labelY(a,ys,hs,sz)+'" text-anchor="middle">'+fmtA(A[i])+gtxt(change(S,i,false))+'</text>'+
   '<text class="val" x="'+(xo+bw/2)+'" y="'+(labelY(o,yo,ho,oz)+(o>=0?-13:0))+'" text-anchor="middle">'+(vm==='idx'?fmtA(B[i]):chartMoney(B[i]))+gtxt(change(O,i,true))+'</text>'+
   '<text class="ax" x="'+x+'" y="'+(H-8)+'" text-anchor="middle">'+yr+'</text>'+
   '<rect class="hit" x="'+(x-slot/2)+'" y="'+top+'" width="'+slot+'" height="'+(bottom-top)+'"/></g>'});
 return '<div class="pc-tp pc-'+side+'"><h3>'+SIDE[side]+' <small>수치 확인 '+has.length+'/'+list.length+'곳</small></h3>'+
  '<div class="db-chart pcg"><svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(SIDE[side]+' 2023~2025 매출 및 영업이익. '+info.join(' / '))+'">'+g+'</svg></div>'+
  '<p class="pc-strip" aria-live="polite" data-info="'+esc(JSON.stringify(info))+'">'+esc(info[2])+'</p></div>';
}
/* 매출지수 보기: 국내·글로벌 그래프가 같은 눈금을 쓰도록 두 쪽 값의 합친 범위로 축을 만든다 */
function idxAxis(dm,gl){const vals=[];[dm,gl].forEach(l=>{const h=uniqSum(l);if(!h.length)return;const S=[0,1,2].map(i=>h.reduce((t,x)=>t+(x.row.r[i]||0),0)),O=[0,1,2].map(i=>h.reduce((t,x)=>t+(x.row.o[i]||0),0));
  S.forEach(v=>S[0]&&vals.push(v/S[0]*100));if(O[0]>0)O.forEach(v=>vals.push(v/O[0]*100))});return vals.length?axis(vals,4):null}
function trend(dm,gl){const box=$('pc-trend'),vm=fval(),O0neg=[dm,gl].some(l=>{const h=uniqSum(l);return h.length&&h.reduce((t,x)=>t+(x.row.o[0]||0),0)<=0});const over=vm==='idx'?idxAxis(dm,gl):null;box.innerHTML=trendSvg('dom',dm,over)+trendSvg('glo',gl,over);
 const sq=c=>'<i class="sq" style="background:var('+c+')"></i>';
 $('pc-legend').innerHTML='<li>'+sq('--blue')+(vm==='idx'?'매출지수(2023=100)':vm==='avg'?'기업당 평균 매출':'매출')+'</li><li>'+sq('--green')+(vm==='avg'?'기업당 평균 영업이익':vm==='idx'?'영업이익지수(2023=100)':'영업이익')+'</li>';
 const n=$('pc-trend-note');if(n){n.textContent=vm==='idx'?'매출과 영업이익 모두 2023년을 100으로 둔 지수이며, 국내와 글로벌 그래프는 같은 눈금입니다.'+(O0neg?' 2023년 영업이익이 0 이하라 영업이익지수는 계산할 수 없습니다.':''):'';n.hidden=vm!=='idx'}
 const sb=$('pc-trend-sub');if(sb)sb.textContent='2023~2025 · '+(vm==='avg'?'기업당 평균':vm==='idx'?'매출지수·영업이익지수(2023=100)':'수치 확인 업체 합계')+' · 왼쪽 국내업체, 오른쪽 글로벌업체';
}
/* 회사명 칸 클릭·Enter·Space: 보조 정보 펼치기/접기(안의 링크·요약·펼침 영역을 누를 때는 건드리지 않는다) */
const toggleSub=th=>{const o=th.classList.toggle('is-open');th.setAttribute('aria-expanded',o?'true':'false')};
document.addEventListener('click',e=>{const th=e.target.closest&&e.target.closest('th.pc-has-sub');if(!th||e.target.closest('a,summary,.pc-parent-pop'))return;toggleSub(th)});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('th.pc-has-sub')){e.preventDefault();toggleSub(e.target)}});
document.addEventListener('pointerover',e=>{const t=e.target.closest&&e.target.closest('.pcg .slot');if(t)strip(t)});
/* 본사 공시 참고실적: 포인터 기기에서는 화살표(요약)에 마우스를 올리면 말풍선으로 펼치고 벗어나면 닫는다. 터치 기기는 탭으로 열고 닫는다 */
if(matchMedia('(hover:hover)').matches){document.addEventListener('mouseover',e=>{const d=e.target.closest&&e.target.closest('.pc-parent-raw');if(d&&!d.open)d.open=true});document.addEventListener('mouseout',e=>{const d=e.target.closest&&e.target.closest('.pc-parent-raw');if(d&&d.open&&!d.contains(e.relatedTarget))d.open=false})}
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
function detail(vis){
 /* 국내(왼쪽)·글로벌(오른쪽)을 한 표에 나란히: 품목별로 같은 순번끼리 한 줄 */
 const t=$('pc-tbl');$('pc-empty').hidden=vis.length>0;
 if(!vis.length){t.innerHTML='';return}
 const yh=YRS.map((y,i)=>'<th scope="col"'+(i===0?' class="pc-gs"':'')+'>’'+String(y).slice(2)+'년</th>').join('');
 const cg='<col class="pc-cn">'+'<col>'.repeat(6);
 const head='<colgroup>'+cg+cg+'</colgroup><thead><tr><th scope="colgroup" colspan="7" class="pc-side pc-side-dom">국내업체</th><th scope="colgroup" colspan="7" class="pc-side pc-side-glo pc-div">글로벌업체</th></tr>'+
  '<tr><th scope="col" rowspan="2" class="l">업체명</th><th scope="colgroup" colspan="3" class="pc-gs">매출액</th><th scope="colgroup" colspan="3" class="pc-gs">영업이익</th>'+
  '<th scope="col" rowspan="2" class="l pc-div">업체명</th><th scope="colgroup" colspan="3" class="pc-gs">매출액</th><th scope="colgroup" colspan="3" class="pc-gs">영업이익</th></tr>'+
  '<tr>'+yh+yh+yh+yh+'</tr></thead>';
 const nums=a=>a.map((v,i)=>'<td'+(i===0?' class="pc-gs"':'')+'>'+fmt(v)+'</td>').join('');
 const total=(side,entries)=>{const c=uniqSum(entries),sum=k=>YRS.map((_,i)=>c.reduce((n,x)=>n+(x.row[k][i]||0),0));
  const tip='실적 확인 '+c.length+'/'+entries.length+'곳 · 같은 본사 중복 제외';
  return '<th scope="row" class="l pc-tip'+(side==='glo'?' pc-div':'')+'" tabindex="0" title="'+esc(tip)+'">'+SIDE[side]+' 합계<small>'+esc(tip)+'</small></th>'+
   (c.length?nums(sum('r'))+nums(sum('o')):'<td colspan="6" class="pc-na pc-gs">비교 기준의 공시 실적 없음</td>')};
 const cell=(x,side)=>{const dv=side==='glo'?' pc-div':'';
  if(!x)return '<td class="l pc-blank'+dv+'"></td><td colspan="6" class="pc-blank pc-gs"></td>';
  /* 회사명 아래 보조 정보(본사 실적 기준·한국 법인·참고실적·사유)는 기본 숨기고, 회사명을 클릭(또는 Enter)하면 펼친다 */
  /* 항상 보이는 기본 기준 줄(국내 '별도…', 해외 본사 '해외 본사 · 연결…')과, 클릭하면 열리는 보조 정보를 나눈다 */
  const r=x.row,tg=tagOf(x),pri=tg&&(!x.e.p||krMode()),sub=
   (tg&&!pri?'<small>'+esc(tg)+'</small>':'')+(x.kr&&!krMode()?'<small class="pc-kr">'+esc(krTxt(x))+'</small>':'')+
   (rawParent(x)?rawDetails(rawParent(x),!!r):'')+
   (!r?'<small class="pc-why">'+esc(otherBasis(x)+' · '+(x.e.p&&x.e.p.w?x.e.p.w:x.e.w||NO_DATA))+'</small>':'')+
   (x.e.x?'<small class="pc-why">'+esc(x.e.x)+' · 합계에 포함</small>':''),
   nm='<span class="pc-n" title="'+esc(x.e.f)+'">'+esc(x.e.n)+'</span>'+(pri?'<small>'+esc(tg)+'</small>':'')+(sub?'<span class="pc-sub">'+sub+'</span>':'');
  return '<th scope="row" class="l'+dv+(r?'':' pc-none')+(sub?' pc-has-sub':'')+'"'+(sub?' tabindex="0" aria-expanded="false" title="클릭하면 상세 정보가 열립니다"':'')+'>'+nm+'</th>'+(r?nums(r.r)+nums(r.o):'<td colspan="6" class="pc-na pc-gs">자료 없음 (고정 재무기준)</td>')};
 const by=side=>vis.filter(x=>x.side===side);
 let body='<tr class="pc-total">'+total('dom',by('dom'))+total('glo',by('glo'))+'</tr>';
 const items=[];vis.forEach(x=>{const k=x.g+'\u0001'+x.i;if(!items.some(o=>o.k===k))items.push({k,g:x.g,i:x.i})});
 items.forEach(it=>{const d=vis.filter(x=>x.side==='dom'&&x.g===it.g&&x.i===it.i),g=vis.filter(x=>x.side==='glo'&&x.g===it.g&&x.i===it.i);
  body+='<tr class="pc-item"><th scope="colgroup" colspan="14" class="l">'+esc(it.g===it.i?it.i:it.g+' › '+it.i)+'</th></tr>';
  for(let n=0;n<Math.max(d.length,g.length);n++)body+='<tr>'+cell(d[n],'dom')+cell(g[n],'glo')+'</tr>'});
 t.innerHTML=head+'<tbody>'+body+'</tbody>';
}

/* 3개년 트렌드 분석: 선택한 필터의 국내·글로벌 합계로 '추세'와 '이유(업체별 수치 기여)' 두 줄을 자동 생성 */
function insight(dm,gl){
 const box=$('pc-insight'),cond=$('pc-insight-cond');if(!box)return;
 const s=state(),parts=[s.g,s.i&&s.i!==s.g?s.i:''].filter(Boolean);
 if(sdiOff())parts.push('삼성SDI 제외');if(krMode())parts.push('글로벌 한국 법인 기준');if(s.q)parts.push('검색 “'+s.q+'”');
 cond.textContent=parts.length?parts.join(' › '):'전체';
 const side=l=>{const h=uniqSum(l);if(!h.length)return null;
  const R=[0,1,2].map(i=>h.reduce((t,x)=>t+(x.row.r[i]||0),0)),O=[0,1,2].map(i=>h.reduce((t,x)=>t+(x.row.o[i]||0),0));
  const nm=x=>x.side==='glo'&&x.e.p?x.e.p.n:x.e.n;
  return{n:h.length,R,O,m0:margin(O[0],R[0]),m2:margin(O[2],R[2]),rg:R[0]?(R[2]/R[0]-1)*100:null,
   dR:h.map(x=>({n:nm(x),v:x.row.r[2]-x.row.r[0]})),dO:h.map(x=>({n:nm(x),v:x.row.o[2]-x.row.o[0]}))}};
 const D=side(dm),G=side(gl);
 if(!D&&!G){box.innerHTML='<p class="gc-empty">선택한 조건에 수치가 확인된 업체가 없어 분석할 수 없습니다.</p>';return}
 const sgn=v=>(v>0?'+':v<0?'−':'')+Math.abs(v).toFixed(1)+'%';
 const opShort=(a,b)=>a>0&&b>0?sgn((b/a-1)*100):a<=0&&b>0?'흑자전환':a>0&&b<=0?'적자전환':Math.abs(b)<Math.abs(a)?'적자 축소':'적자 확대';
 const gr=(a,b)=>a?(b-a)/Math.abs(a)*100:null;
 const sm=v=>(v>0?'+':'−')+chartMoney(Math.abs(v));
 /* 국내를 기준으로 해외와 비교한 판정 문구 */
 const verdict=(gd,gg)=>{if(gd==null||gg==null)return{t:'비교 불가',c:'pc-flat'};const d=gd-gg;
  if(Math.abs(d)<2)return{t:'국내·해외 비슷',c:'pc-flat'};
  if(gd>0&&gg>0)return d>0?{t:'국내가 더 성장',c:'pc-up'}:{t:'국내가 덜 성장',c:'pc-down'};
  if(gd<=0&&gg<=0)return d>0?{t:'국내가 덜 감소',c:'pc-up'}:{t:'국내가 더 크게 감소',c:'pc-down'};
  return gd>0?{t:'국내 성장·해외 감소',c:'pc-up'}:{t:'국내 감소·해외 성장',c:'pc-down'}};
 let l1,l2;
 if(D&&G){const vr=verdict(D.rg,G.rg),vo=verdict(gr(D.O[0],D.O[2]),gr(G.O[0],G.O[2]));
  l1='매출은 <b class="'+vr.c+'">'+vr.t+'</b>(국내 '+sgn(D.rg)+' vs 해외 '+sgn(G.rg)+'), 영업이익은 <b class="'+vo.c+'">'+vo.t+'</b>(국내 '+esc(opShort(D.O[0],D.O[2]))+' vs 해외 '+esc(opShort(G.O[0],G.O[2]))+')입니다.';
  /* 구분만 선택(품목 2개 이상): 이유는 품목별 비교(어느 품목의 매출·영업이익 증가폭이 큰지). 품목까지 선택하면 아래 업체별 기여 설명을 쓴다 */
  const items=[...new Set(dm.concat(gl).map(x=>x.i))];
  if(s.g&&!s.i&&items.length>=2){
   const stat=l=>items.map(it=>{const h=uniqSum(l.filter(x=>x.i===it));if(!h.length)return null;const sum=(k,i)=>h.reduce((t,x)=>t+(x.row[k][i]||0),0);const R0=sum('r',0),R2=sum('r',2);return{n:it,rg:R0?(R2/R0-1)*100:null,dO:sum('o',2)-sum('o',0)}}).filter(x=>x&&x.rg!=null);
   const line=(lab,st)=>{if(!st.length)return lab+' 수치 확인 업체 없음';if(st.length===1)return lab+' — '+st[0].n+'만 확인: 매출 '+sgn(st[0].rg)+', 영업이익 '+sm(st[0].dO);
    const byR=st.slice().sort((a,b)=>b.rg-a.rg),top=byR[0],bot=byR[byR.length-1],byO=st.slice().sort((a,b)=>b.dO-a.dO),oTop=byO[0].dO>0?byO[0]:byO[byO.length-1];
    return lab+' — 매출 '+(top.rg>=0?'증가폭 최대':'감소폭 최소')+': <b>'+esc(top.n)+'</b>('+sgn(top.rg)+'), '+(bot.rg>=0?'증가폭 최소':'감소폭 최대')+': '+esc(bot.n)+'('+sgn(bot.rg)+') / 영업이익 '+(oTop.dO>=0?'증가폭 최대':'감소폭 최대')+': <b>'+esc(oTop.n)+'</b>('+sm(oTop.dO)+')'};
   l2=line('국내 '+s.g,stat(dm))+'</span><span class="pc-ins-row">'+line('해외 '+s.g,stat(gl))}
  else{
  const drv=(lab,x)=>{const tot=x.dO.reduce((t,e)=>t+e.v,0),up=tot>=0,srt=x.dO.slice().sort((a,b)=>up?b.v-a.v:a.v-b.v);
   const lead=srt.filter(e=>up?e.v>0:e.v<0).slice(0,2),drag=srt.slice().reverse().find(e=>up?e.v<0:e.v>0);
   const fm=e=>esc(e.n)+'('+sm(e.v)+')';
   return lab+'는 '+(lead.length?lead.map(fm).join('·')+(up?'가 이익 증가를 견인':'가 이익 감소를 주도'):'특정 업체 편중 없이')+(drag?', '+fm(drag)+'가 상쇄':'')+'했고 이익률은 '+pct(x.m0)+'→'+pct(x.m2)+'입니다'};
  l2=drv('국내',D)+'.</span><span class="pc-ins-row">'+drv('해외',G)+'.'}}
 else{const x=D||G,lab=D?'국내':'해외';l1=lab+'만 수치가 확인되어 비교할 수 없습니다. 매출 '+sgn(x.rg)+', 영업이익 '+esc(opShort(x.O[0],x.O[2]))+'.';l2='이익률 '+pct(x.m0)+'→'+pct(x.m2)+'.'}
 box.innerHTML='<p class="pc-ins-line"><b class="pc-ins-k">추세</b><span>'+l1+'</span></p><p class="pc-ins-line"><b class="pc-ins-k">이유</b><span class="pc-ins-rows"><span class="pc-ins-row">'+l2+'</span></span></p>';
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
  '비교 재무 기준은 국내업체 개별(별도), 글로벌업체 해외 본사 연결로 고정합니다. 해당 기준의 2023~2025년 실적이 없는 회사는 다른 재무 기준으로 대체하거나 합계에 넣지 않습니다.',
  '매출액과 영업이익은 기업 전체 실적이며 반도체 관련 사업만의 실적이 아닐 수 있습니다. 차트 값(합계/평균/매출지수)은 그래프에만 적용하며 통합표에는 실제 억 원 단위 금액을 표시합니다.',
  '글로벌업체는 본사 소재지 기준으로 구분합니다. 현지 법인·지점이 아니라 해외 본사 연결 실적을 비교합니다. 한국 법인 실적은 회사명 아래 참고용으로만 표시합니다.',
  '같은 본사가 여러 업체나 품목에 나오면 표에는 각각 표시하되 합계·그래프에서는 한 번만 집계합니다.',
  '삼성에스디아이는 기본으로 합계와 그래프에 포함하며, 삼성SDI 필터에서 제외할 수 있습니다. 전지 중심 사업 실적도 포함되므로 소부장 사업만의 성장성으로 해석하지 마세요.',
  '글로벌 원재료·부품 기업의 현지 통화 참고실적은 연도별 검증 상태를 구분하며, 원화 비교 집계·성장률에 포함하지 않습니다.',
  '회계기간·환율·사업범위 차이로 직접 비교에는 한계가 있습니다. 미확인 실적은 0으로 대체하지 않으며 영업이익 증감은 흑자·적자 전환을 구분합니다.'
 ].map(t=>'<li>'+esc(t)+'</li>').join('')}

/* 수치 미확인 업체 목록(명단 전체 기준) */
function missing(){applyBasis();const m=ALL.filter(x=>!x.row);$('pc-miss-h').textContent='고정 재무기준의 원화 3개년 실적이 없는 업체 ('+m.length+'곳 / 명단 '+ALL.length+'곳)';
 $('pc-miss').innerHTML=m.map(x=>'<li><b>'+esc(x.e.n)+'</b> <small>'+SIDE[x.side]+' · '+esc(x.g===x.i?x.i:x.g+' › '+x.i)+'</small> — '+esc(rawParent(x)?'본사 공시 참고실적 있음(원본 통화·연도별 검증 상태는 업체명 아래 펼침 참고). 원화 합계에는 미포함.':(x.e.p&&x.e.p.w?x.e.p.w:x.e.w||(x.e.p?NO_PAR:NO_DATA)))+'</li>').join('')||'<li>모든 업체의 원화 3개년 실적이 확인되었습니다.</li>'}

/* 초기화 */
const tb=$('theme-btn');if(tb){const cur=()=>document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');const paint=()=>{const d=cur()==='dark';tb.innerHTML='<i class="ph ph-'+(d?'sun':'moon')+'" aria-hidden="true"></i>';tb.title=d?'밝은 화면으로':'어두운 화면으로'};tb.addEventListener('click',()=>{const t=cur()==='dark'?'light':'dark';document.documentElement.dataset.theme=t;try{localStorage.setItem('sobujang:theme',t)}catch(e){}paint()});paint()}
const get=u=>fetch(u,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(u+' '+r.status);return r.json()});
Promise.all([get('data/pair-roster.json'),get('data/growth-companies.json'),get('data/pair-extra.json').catch(()=>({rows:[]})),get('data/pair-parent-consolidated.json').catch(()=>({companies:[]}))]).then(([R,G,X,P])=>{
 RAW_PARENT=Object.fromEntries(((P&&P.companies)||[]).map(c=>[c.name,c]));
 ROSTER=R;GEN=G.generatedAt||'';const bl=(G.modes||[]).find(m=>m.id==='blend')||(G.modes||[])[0];ALL=build(R,G.modes||[],X&&X.rows);applyBasis();
 basis();missing();fillGroups();
  try{const p=new URLSearchParams(location.hash.slice(1));if(p.get('g')&&[...$('f-grp').options].some(o=>o.value===p.get('g'))){$('f-grp').value=p.get('g');fillItems()}if(p.get('i')&&[...$('f-item').options].some(o=>o.value===p.get('i')))$('f-item').value=p.get('i');if(p.get('q'))$('f-q').value=p.get('q');if(['idx','avg'].includes(p.get('v')))$('f-val').value=p.get('v');if(p.get('sdi')==='ex')$('f-sdi').value='ex';if(p.get('kr')==='1')$('f-kr').value='kr'}catch(e){}
 $('updated').textContent=GEN.slice(0,10)||'-';
 const ds=document.querySelector('.site-data-status__item');if(ds&&GEN){const n=ds.querySelector('.site-data-status__date'),t=ds.querySelector('.site-data-status__state');if(n)n.textContent=GEN.slice(0,10)+' 기준 · 업체 '+ALL.length+'곳 중 수치 확인 '+ALL.filter(x=>x.row).length+'곳';if(t){t.textContent='최근 집계 완료';t.className='site-data-status__state is-fresh'}}
 $('f-grp').addEventListener('change',()=>{fillItems();$('f-item').value='';render()});$('f-item').addEventListener('change',()=>{const v=$('f-item').value;if(v){const gr=ROSTER.groups.find(g=>g.items.some(it=>it.i===v));if(gr&&$('f-grp').value!==gr.g){$('f-grp').value=gr.g;fillItems();$('f-item').value=v}}render()});$('f-q').addEventListener('input',render);$('f-val').addEventListener('change',render);$('f-sdi').addEventListener('change',render);$('f-kr').addEventListener('change',render);
 $('pc-csv').addEventListener('click',csv);
 render();
}).catch(()=>{const e=$('pc-empty');if(e){e.hidden=false;e.textContent='업체 비교 자료를 불러오지 못했습니다. 다시 열어 주세요.'}});
})();
