(function(){
const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg',Y=[2023,2024,2025],CH=['소재','부품','장비'];
let S=null;const key=(c,p)=>JSON.stringify([c||null,p]);
const fmt=v=>v==null?'–':Math.round(v).toLocaleString('ko-KR'),pct=v=>v==null?'–':v.toFixed(1)+'%';
function cell(c,p){return S.cells[key(c,p)]}
function path(){const p=[];for(let i=1;i<=5;i++){const v=$('f-d'+i).value;if(!v)break;p.push(v)}return p}
function opts(sel,vals){const cur=sel.value;sel.length=1;[...new Set(vals)].sort().forEach(v=>sel.add(new Option(v,v)));sel.value=cur;sel.disabled=sel.length<2}
function children(c,p){const out=[];for(const k in S.cells){const [cc,pp]=JSON.parse(k);if((cc||null)===(c||null)&&pp.length===p.length+1&&p.every((x,i)=>pp[i]===x))out.push(pp[p.length])}return out}
function sync(){const c=$('f-chart').value;let p=[];for(let i=1;i<=5;i++){const s=$('f-d'+i);if(i>1&&!$('f-d'+(i-1)).value){s.length=1;s.disabled=true;continue}opts(s,children(c,p));if(!s.value)break;p.push(s.value)}}
function svgEl(n,a,t){const e=document.createElementNS(NS,n);for(const k in a)e.setAttribute(k,a[k]);if(t!=null)e.textContent=t;return e}
function draw(){
 const p=path(),mode=$('f-mode').value,sel=$('f-chart').value,cats=sel?[sel]:[null,...CH];
 const data=cats.map(c=>({c:c||'전체',x:cell(c,p)})),box=$('chart');box.textContent='';
 if(!data.some(d=>d.x&&(d.x.dom||d.x.ov))){box.innerHTML='<p class="gc-empty">이 조건에서는 공개 기준(양쪽 각 5개 사 이상, 3개년 실적 확인)을 충족하는 비교 대상이 없습니다.</p>';tbl([]);return}
 const W=320,H=394,m=30,gw=W-m-14,bw=gw/(Y.length*3+1),grid=document.createElement('div');grid.className='gc-grid';
 const series=s=>{if(!s||!s.n)return null;const v=mode==='avg'?s.avg_rev:s.rev;if(mode==='idx'){const b=v[0];return v.map(x=>b?x/b*100:null)}return v};
 const growth=v=>v.map((x,i)=>i&&v[i-1]&&x!=null?(x/v[i-1]-1)*100:null);
 const G=['dom','ov','fo'];
 const mx=Math.max(1,...data.flatMap(d=>G.flatMap(r=>(series(d.x&&d.x[r])||[]).filter(v=>v!=null))));
 const allM=data.flatMap(d=>G.flatMap(r=>((d.x&&d.x[r]&&d.x[r].margin)||[]).filter(v=>v!=null))),mmax=Math.max(5,...allM),mmin=Math.min(0,...allM);
 const OVL='해외(공시기업·한국 내 외국계)',COL={dom:'var(--blue)',ov:'var(--orange)',fo:'var(--teal)'},NAMES={dom:'국내',ov:OVL,fo:'국내 소재 외국계'},SHORT={dom:'국내',ov:'해외',fo:'외국계'};
 const BH=150,BASE=H-46,MB=[94,124]; /* 영업이익률 선 영역(위) / 막대 기준선 */
 data.forEach(d=>{const svg=svgEl('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':d.c+' 매출과 영업이익률'}),x0=m;
  svg.append(svgEl('text',{x:W/2,y:14,'text-anchor':'middle','font-weight':'bold'},d.c));
  const cnt=svgEl('text',{x:W/2,y:28,'text-anchor':'middle','font-size':'9.5'});
  G.forEach((r,i)=>{const s=d.x&&d.x[r],t=svgEl('tspan',{style:'fill:'+COL[r]},SHORT[r]+' '+(s&&s.n?s.n+'곳':'–'));if(i)cnt.append(svgEl('tspan',{style:'fill:var(--text-3)'},'  ·  '));cnt.append(t)});svg.append(cnt);
  const lab=(x,y,t,r,sz,anc)=>svg.append(svgEl('text',{x,y,'text-anchor':anc||'middle','font-size':sz||'9',style:'fill:'+COL[r]},t));
  svg.append(svgEl('text',{x:x0,y:42,'font-size':'8','text-anchor':'start',style:'fill:var(--text-3)'},'영업이익률'));
  svg.append(svgEl('text',{x:x0,y:142,'font-size':'8','text-anchor':'start',style:'fill:var(--text-3)'},'전년 대비 매출'));
  if(mode==='idx'){const gy=BASE-(100/mx)*BH;if(gy>190&&gy<BASE){svg.append(svgEl('line',{x1:x0,x2:W-10,y1:gy,y2:gy,stroke:'var(--text-3)','stroke-width':.8,'stroke-dasharray':'2 3'}));svg.append(svgEl('text',{x:x0-3,y:gy+3,'text-anchor':'end','font-size':'8',style:'fill:var(--text-3)'},'100'))}}
  G.forEach((r,ri)=>{const s=d.x&&d.x[r],v=series(s);if(!v)return;
   const bx=yi=>x0+bw*(yi*3+ri+.5),cx=yi=>bx(yi)+bw*.45,ty=val=>BASE-(val/mx)*BH;
   v.forEach((val,yi)=>{if(val==null)return;const h=(val/mx)*BH,e=svgEl('rect',{x:bx(yi),y:BASE-h,width:bw*.9,height:h,class:'bar-'+r});e.append(svgEl('title',{},NAMES[r]+' '+Y[yi]+' '+(mode==='idx'?'지수 '+val.toFixed(1)+' (매출 '+fmt((mode==='avg'?s.avg_rev:s.rev)[yi])+'억 원)':(mode==='avg'?'기업당 평균 매출 ':'매출 ')+fmt(val)+'억 원')));svg.append(e);
    if(mode==='idx'&&h>14)svg.append(svgEl('text',{x:cx(yi),y:BASE-h+11,'text-anchor':'middle','font-size':'9',style:'fill:#fff;font-weight:700'},val.toFixed(0)))});
   const tp=v.map((val,yi)=>val==null?null:[cx(yi),ty(val)]);const tpf=tp.filter(Boolean);
   if(tpf.length>1)svg.append(svgEl('polyline',{points:tpf.map(q=>q.join(',')).join(' '),fill:'none',stroke:COL[r],'stroke-width':1.3,'stroke-dasharray':'3 2'}));
   growth(s.rev).forEach((val,yi)=>{if(val==null||!tp[yi-1]||!tp[yi])return;lab((tp[yi-1][0]+tp[yi][0])/2,154+ri*12,(val>=0?'+':'')+val.toFixed(1)+'%',r,'8.5')});
   let pts='';s.margin.forEach((val,yi)=>{if(val==null)return;const x=cx(yi),y=MB[1]-((val-mmin)/(mmax-mmin||1))*(MB[1]-MB[0]);pts+=`${x},${y} `;svg.append(svgEl('circle',{cx:x,cy:y,r:2.5,class:'bar-'+r}));lab(x,54+ri*12,pct(val),r,'9')});
   svg.append(svgEl('polyline',{points:pts,fill:'none',stroke:COL[r],'stroke-width':1.8}))});
  Y.forEach((y,yi)=>svg.append(svgEl('text',{x:x0+bw*(yi*3+1.9),y:H-34,'text-anchor':'middle','font-size':'10'},String(y))));
  svg.append(svgEl('text',{x:W/2,y:H-20,'text-anchor':'middle','font-size':'8.5',style:'fill:var(--text-3)'},'점선: 막대 상단 연결(전년 대비 %) · 실선: 영업이익률'));svg.append(svgEl('text',{x:W/2,y:H-6,'text-anchor':'middle','font-size':'8.5',style:'fill:var(--text-3)'},'막대: '+(mode==='idx'?'매출지수(2023=100)':mode==='avg'?'기업당 평균 매출(억 원)':'매출 합계(억 원)')));grid.append(svg)});
 box.append(grid);if(!data.some(d=>d.x&&d.x.ov&&d.x.ov.n)){const n=document.createElement('p');n.className='gc-empty';n.textContent='해외(공시기업·한국 내 외국계): 공개 기준을 충족하는 비교 가능 기업이 없어 표시하지 않습니다(추정·모회사 실적 대체 없음).';box.append(n)}tbl(data)}
function tbl(data){const t=$('tbl');t.textContent='';if(!data.length)return;
 const h=t.createTHead().insertRow();['분류','구분','기업 수',...Y.map(y=>y+' 매출(억 원)'),'2025 영업이익률'].forEach(x=>{const c=document.createElement('th');c.textContent=x;h.append(c)});
 const b=t.createTBody();data.forEach(d=>['dom','ov','fo'].forEach(r=>{const s=d.x&&d.x[r];if(!s||!s.n)return;const row=b.insertRow();[d.c,{dom:'국내',ov:'해외(공시기업·한국 내 외국계)',fo:'국내 소재 외국계'}[r],s.n,...s.rev.map(fmt),pct(s.margin[2])].forEach(v=>row.insertCell().textContent=v)}))}
function notes(){const b=S.basis;$('notes').innerHTML=Object.values(b).map(x=>'<li>'+x.replace(/</g,'&lt;')+'</li>').join('')+'<li class="gc-disc"><b>유의:</b> 본 비교는 국내 기업의 별도재무제표와 해외 상장기업의 연결재무제표를 사용한 참고 분석입니다. 기업별 연결 범위, 사업 구성, 회계기간 및 환율의 차이가 있어 매출 규모와 수익성을 동일한 기준의 직접 비교 결과로 해석하기 어렵습니다. 해외 지표는 확인 가능한 일부 기업의 실적을 집계한 것으로, 해외 반도체 소부장 산업 전체를 대표하지 않습니다.</li>';
 const c=S.coverage;$('cov').innerHTML='<p>국내 소부장 경영 정보 기업군 '+c.entities['국내']+'곳 중 3개년 실적이 확인된 '+c.balanced_panel['국내']+'곳, 해외 목록 '+c.entities['해외']+'개 법인 중 적격·실적 확인 '+c.balanced_panel['해외']+'곳을 비교합니다. 확인되지 않은 법인은 집계에서 제외하며 수치를 추정하지 않습니다.</p>';
 $('updated').textContent=S.generatedAt.slice(0,10)}
const tb=$('theme-btn');if(tb){const cur=()=>document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');const paint=()=>{const d=cur()==='dark';tb.innerHTML='<i class="ph ph-'+(d?'sun':'moon')+'" aria-hidden="true"></i>';tb.title=d?'밝은 화면으로':'어두운 화면으로'};tb.addEventListener('click',()=>{const t=cur()==='dark'?'light':'dark';document.documentElement.dataset.theme=t;try{localStorage.setItem('sobujang:theme',t)}catch(e){}paint()});paint()}
fetch('data/growth-comparison-summary.json',{cache:'no-cache'}).then(r=>r.json()).then(j=>{S=j;const cs=new Set();for(const k in S.cells){const c=JSON.parse(k)[0];if(c)cs.add(c)}CH.filter(c=>cs.has(c)).forEach(c=>$('f-chart').add(new Option(c,c)));notes();sync();draw();
 ['f-chart','f-d1','f-d2','f-d3','f-d4','f-d5','f-mode'].forEach(id=>$(id).addEventListener('change',()=>{if(id==='f-chart')for(let i=1;i<=5;i++)$('f-d'+i).value='';else if(/f-d/.test(id)){const n=+id.slice(3);for(let i=n+1;i<=5;i++)$('f-d'+i).value=''}sync();draw()}))}).catch(()=>{$('chart').innerHTML='<p class="gc-empty">집계 자료를 불러오지 못했습니다.</p>'});
})();
