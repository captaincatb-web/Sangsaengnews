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
 const W=300,H=300,m=14,gw=W-2*m,bw=gw/(Y.length*2+1),grid=document.createElement('div');grid.className='gc-grid';
 const series=s=>{if(!s||!s.n)return null;const v=mode==='avg'?s.avg_rev:s.rev;if(mode==='idx'){const b=v[0];return v.map(x=>b?x/b*100:null)}return v};
 const growth=v=>v.map((x,i)=>i&&v[i-1]&&x!=null?(x/v[i-1]-1)*100:null);
 const mx=Math.max(1,...data.flatMap(d=>['dom','ov'].flatMap(r=>(series(d.x&&d.x[r])||[]).filter(v=>v!=null))));
 const mm=Math.max(5,...data.flatMap(d=>['dom','ov'].flatMap(r=>((d.x&&d.x[r]&&d.x[r].margin)||[]).filter(v=>v!=null))));
 const unit=mode==='idx'?'지수(2023=100)':'억 원';
 data.forEach(d=>{const svg=svgEl('svg',{viewBox:`0 0 ${W} ${H}`}),x0=m;
  svg.append(svgEl('text',{x:W/2,y:16,'text-anchor':'middle','font-weight':'bold'},d.c));
  const dn=d.x&&d.x.dom&&d.x.dom.n,on=d.x&&d.x.ov&&d.x.ov.n;
  svg.append(svgEl('text',{x:W/2,y:32,'text-anchor':'middle'},(dn?'국내 '+dn+'개사':'국내 –')+' · '+(on?'해외 '+on+'개사':'해외 –')));
  ['dom','ov'].forEach((r,ri)=>{const s=d.x&&d.x[r],v=series(s);if(!v)return;const base=H-36,top=base-150;
   const bx=yi=>x0+bw*(yi*2+ri+.5),cx=yi=>bx(yi)+bw*.45;
   v.forEach((val,yi)=>{if(val==null)return;const h=(val/mx)*150,e=svgEl('rect',{x:bx(yi),y:base-h,width:bw*.9,height:h,class:'bar-'+r});e.append(svgEl('title',{},(r==='dom'?'국내 ':'해외 ')+Y[yi]+' '+(mode==='idx'?'지수 '+val.toFixed(1)+' (매출 '+fmt((mode==='avg'?s.avg_rev:s.rev)[yi])+'억 원)':(mode==='avg'?'기업당 평균 매출 ':'매출 ')+fmt(val)+'억 원')));svg.append(e)});
   const top_pts=v.map((val,yi)=>val==null?null:[cx(yi),base-(val/mx)*150]).filter(Boolean);
   if(top_pts.length>1)svg.append(svgEl('polyline',{points:top_pts.map(q=>q.join(',')).join(' '),fill:'none',stroke:r==='dom'?'var(--blue)':'var(--orange)','stroke-width':1.5,'stroke-dasharray':'3 2'}));
   const g=growth(s.rev);g.forEach((val,yi)=>{if(val==null||!top_pts.length)return;const a=v[yi-1]==null?null:[cx(yi-1),base-(v[yi-1]/mx)*150],c2=[cx(yi),base-(v[yi]/mx)*150];if(!a)return;svg.append(svgEl('text',{x:(a[0]+c2[0])/2,y:Math.min(a[1],c2[1])-5-(ri?0:0)+(ri?-9:0),'text-anchor':'middle','font-size':'9',style:'fill:'+(r==='dom'?'var(--blue)':'var(--orange)')},(val>=0?'+':'')+val.toFixed(1)+'%'))});
   let pts='';s.margin.forEach((val,yi)=>{if(val==null)return;const x=bx(yi)+bw*.45,y=60+(1-val/mm)*60;pts+=`${x},${y} `;svg.append(svgEl('circle',{cx:x,cy:y,r:3,class:'bar-'+r}));svg.append(svgEl('text',{x,y:y+(ri?-7:14),'text-anchor':'middle','font-size':'10'},pct(val)))});
   svg.append(svgEl('polyline',{points:pts,fill:'none',stroke:r==='dom'?'var(--blue)':'var(--orange)','stroke-width':2}))});
  Y.forEach((y,yi)=>svg.append(svgEl('text',{x:x0+bw*(yi*2+1.5),y:H-18,'text-anchor':'middle'},String(y))));
  svg.append(svgEl('text',{x:W/2,y:H-4,'text-anchor':'middle','font-size':'10'},'막대: '+unit));grid.append(svg)});
 box.append(grid);if(!data.some(d=>d.x&&d.x.ov&&d.x.ov.n)){const n=document.createElement('p');n.className='gc-empty';n.textContent='해외: 공개 기준을 충족하는 비교 가능 기업이 없어 표시하지 않습니다(추정·모회사 실적 대체 없음).';box.append(n)}tbl(data)}
function tbl(data){const t=$('tbl');t.textContent='';if(!data.length)return;
 const h=t.createTHead().insertRow();['분류','구분','기업 수',...Y.map(y=>y+' 매출(억 원)'),'2025 영업이익률'].forEach(x=>{const c=document.createElement('th');c.textContent=x;h.append(c)});
 const b=t.createTBody();data.forEach(d=>['dom','ov'].forEach(r=>{const s=d.x&&d.x[r];if(!s||!s.n)return;const row=b.insertRow();[d.c,r==='dom'?'국내':'해외',s.n,...s.rev.map(fmt),pct(s.margin[2])].forEach(v=>row.insertCell().textContent=v)}))}
function notes(){const b=S.basis;$('notes').innerHTML=Object.values(b).map(x=>'<li>'+x.replace(/</g,'&lt;')+'</li>').join('');
 const c=S.coverage;$('cov').innerHTML='<p>국내 소부장 경영 정보 기업군 '+c.entities['국내']+'곳 중 3개년 실적이 확인된 '+c.balanced_panel['국내']+'곳, 해외 목록 '+c.entities['해외']+'개 법인 중 적격·실적 확인 '+c.balanced_panel['해외']+'곳을 비교합니다. 확인되지 않은 법인은 집계에서 제외하며 수치를 추정하지 않습니다.</p>';
 $('updated').textContent=S.generatedAt.slice(0,10)}
const tb=$('theme-btn');if(tb){const cur=()=>document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');const paint=()=>{const d=cur()==='dark';tb.innerHTML='<i class="ph ph-'+(d?'sun':'moon')+'" aria-hidden="true"></i>';tb.title=d?'밝은 화면으로':'어두운 화면으로'};tb.addEventListener('click',()=>{const t=cur()==='dark'?'light':'dark';document.documentElement.dataset.theme=t;try{localStorage.setItem('sobujang:theme',t)}catch(e){}paint()});paint()}
fetch('data/growth-comparison-summary.json',{cache:'no-cache'}).then(r=>r.json()).then(j=>{S=j;const cs=new Set();for(const k in S.cells){const c=JSON.parse(k)[0];if(c)cs.add(c)}CH.filter(c=>cs.has(c)).forEach(c=>$('f-chart').add(new Option(c,c)));notes();sync();draw();
 ['f-chart','f-d1','f-d2','f-d3','f-d4','f-d5','f-mode'].forEach(id=>$(id).addEventListener('change',()=>{if(id==='f-chart')for(let i=1;i<=5;i++)$('f-d'+i).value='';else if(/f-d/.test(id)){const n=+id.slice(3);for(let i=n+1;i<=5;i++)$('f-d'+i).value=''}sync();draw()}))}).catch(()=>{$('chart').innerHTML='<p class="gc-empty">집계 자료를 불러오지 못했습니다.</p>'});
})();
