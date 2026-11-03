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
 const p=path(),avg=$('f-mode').value==='avg',sel=$('f-chart').value,cats=sel?[sel]:CH;
 const data=cats.map(c=>({c,x:cell(c,p)})),box=$('chart');box.textContent='';
 const any=data.some(d=>d.x&&(d.x.dom||d.x.ov));
 if(!any){box.innerHTML='<p class="gc-empty">이 조건에서는 공개 기준(양쪽 각 5개 사 이상, 3개년 실적 확인)을 충족하는 비교 대상이 없습니다.</p>';tbl([]);return}
 const W=300,H=270,m=14,gw=W-2*m,grid=document.createElement('div');grid.className='gc-grid';
 const rv=s=>s&&s.n?(avg?s.avg_rev:s.rev):null;
 const mx=Math.max(1,...data.flatMap(d=>['dom','ov'].flatMap(r=>(rv(d.x&&d.x[r])||[]).filter(v=>v!=null))));
 const mm=Math.max(5,...data.flatMap(d=>['dom','ov'].flatMap(r=>((d.x&&d.x[r]&&d.x[r].margin)||[]).filter(v=>v!=null))));
 data.forEach(d=>{const svg=svgEl('svg',{viewBox:`0 0 ${W} ${H}`}),x0=m,bw=gw/(Y.length*2+1);
  svg.append(svgEl('text',{x:W/2,y:16,'text-anchor':'middle','font-weight':'bold'},d.c));
  const dn=d.x&&d.x.dom&&d.x.dom.n,on=d.x&&d.x.ov&&d.x.ov.n;
  svg.append(svgEl('text',{x:W/2,y:32,'text-anchor':'middle'},(dn?'국내 '+dn+'개사':'국내 –')+' · '+(on?'해외 '+on+'개사':'해외 –')));
  ['dom','ov'].forEach((r,ri)=>{const s=d.x&&d.x[r];if(!s||!s.n)return;const v=rv(s);
   v.forEach((val,yi)=>{if(val==null)return;const h=(val/mx)*130,bx=x0+bw*(yi*2+ri+.5);svg.append((()=>{const e=svgEl('rect',{x:bx,y:H-36-h,width:bw*.9,height:h,class:'bar-'+r});e.append(svgEl('title',{},(r==='dom'?'국내 ':'해외 ')+Y[yi]+' 매출 '+fmt(val)+'억 원'));return e})())});
   let pts='';s.margin.forEach((val,yi)=>{if(val==null)return;const cx=x0+bw*(yi*2+1),cy=60+(1-val/mm)*70;pts+=`${cx},${cy} `;svg.append(svgEl('circle',{cx,cy,r:3,class:'bar-'+r}));svg.append(svgEl('text',{x:cx,y:cy+(ri?-7:14),'text-anchor':'middle','font-size':'10'},pct(val)))});
   svg.append(svgEl('polyline',{points:pts,fill:'none',stroke:r==='dom'?'var(--blue)':'var(--orange)','stroke-width':2}))});
  Y.forEach((y,yi)=>svg.append(svgEl('text',{x:x0+bw*(yi*2+1.5),y:H-18,'text-anchor':'middle'},String(y))));grid.append(svg)});
 box.append(grid);tbl(data)}
function tbl(data){const t=$('tbl');t.textContent='';if(!data.length)return;
 const h=t.createTHead().insertRow();['분류','구분','기업 수',...Y.map(y=>y+' 매출(억 원)'),'2025 영업이익률'].forEach(x=>{const c=document.createElement('th');c.textContent=x;h.append(c)});
 const b=t.createTBody();data.forEach(d=>['dom','ov'].forEach(r=>{const s=d.x&&d.x[r];if(!s||!s.n)return;const row=b.insertRow();[d.c,r==='dom'?'국내':'해외',s.n,...s.rev.map(fmt),pct(s.margin[2])].forEach(v=>row.insertCell().textContent=v)}))}
function notes(){const b=S.basis;$('notes').innerHTML=Object.values(b).map(x=>'<li>'+x.replace(/</g,'&lt;')+'</li>').join('');
 const c=S.coverage;$('cov').innerHTML='<p>모집단(목록) 국내 '+c.entities['국내']+'개 법인 · 해외 '+c.entities['해외']+'개 법인 중 비교 가능(동일 기업군): 국내 '+c.balanced_panel['국내']+'개, 해외 '+c.balanced_panel['해외']+'개. 확인되지 않은 법인은 집계에서 제외하며 수치를 추정하지 않습니다.</p>';
 $('updated').textContent=S.generatedAt.slice(0,10)}
const tb=$('theme-btn');if(tb){const cur=()=>document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');const paint=()=>{const d=cur()==='dark';tb.innerHTML='<i class="ph ph-'+(d?'sun':'moon')+'" aria-hidden="true"></i>';tb.title=d?'밝은 화면으로':'어두운 화면으로'};tb.addEventListener('click',()=>{const t=cur()==='dark'?'light':'dark';document.documentElement.dataset.theme=t;try{localStorage.setItem('sobujang:theme',t)}catch(e){}paint()});paint()}
fetch('data/growth-comparison-summary.json',{cache:'no-cache'}).then(r=>r.json()).then(j=>{S=j;const cs=new Set();for(const k in S.cells){const c=JSON.parse(k)[0];if(c)cs.add(c)}CH.filter(c=>cs.has(c)).forEach(c=>$('f-chart').add(new Option(c,c)));notes();sync();draw();
 ['f-chart','f-d1','f-d2','f-d3','f-d4','f-d5','f-mode'].forEach(id=>$(id).addEventListener('change',()=>{if(id==='f-chart')for(let i=1;i<=5;i++)$('f-d'+i).value='';else if(/f-d/.test(id)){const n=+id.slice(3);for(let i=n+1;i<=5;i++)$('f-d'+i).value=''}sync();draw()}))}).catch(()=>{$('chart').innerHTML='<p class="gc-empty">집계 자료를 불러오지 못했습니다.</p>'});
})();
