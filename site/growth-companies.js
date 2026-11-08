/* 회사별 상세 리스트: data/growth-companies.json(집계에 포함된 법인의 공시 수치, 억 원)을 비교 기준·그래프 분류와 함께 표시한다. */
(function(){
'use strict';
const $=id=>document.getElementById(id),esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const box=$('co-body');if(!box)return;
let D=null,sortKey='r2',sortDir=-1,shown=60;
const fmt=v=>v==null?'–':Math.round(v).toLocaleString('ko-KR'),pct=v=>v==null?'–':v.toFixed(1)+'%',sg=v=>v==null?'–':(v>0?'+':'')+v.toFixed(1)+'%';
const margin=(o,r)=>r?o/r*100:null,grow=(r,i)=>r[i-1]?(r[i]/r[i-1]-1)*100:null;
const COLS=[['n','회사',1],['g','구분',1],['c','분류',1],['s','재무 기준',1],['r0','2023 매출(억 원)',0],['r1','2024 매출',0],['r2','2025 매출',0],['o2','2025 영업이익(억 원)',0],['m0','2023 영업이익률',0],['m1','2024 영업이익률',0],['m2','2025 영업이익률',0],['g1','매출 성장 2024',0],['g2','매출 성장 2025',0]];
function val(x,k){switch(k){case'n':return x.n;case'g':return x.g==='dom'?'국내':'해외계';case'c':return x.c;case's':return x.s;case'r0':case'r1':case'r2':return x.r[+k[1]];case'o2':return x.o[2];case'm0':case'm1':case'm2':return margin(x.o[+k[1]],x.r[+k[1]]);case'g1':return grow(x.r,1);case'g2':return grow(x.r,2)}}
function mode(){const v=$('f-view');const id=v&&v.value;return D.modes.find(m=>m.id===id)||D.modes[0]}
function render(){
 const m=mode(),q=($('co-q').value||'').trim().toLowerCase(),g=$('co-g').value,c=($('f-chart')&&$('f-chart').value)||$('co-c').value;
 const sel=[];for(let i=1;i<=5;i++){const e=$('f-d'+i);if(!e||!e.value)break;sel.push(e.value)}  // 상단 상세구분 1~5 선택(앞에서부터 이어진 값)
 const pathOk=x=>!sel.length||(x.p||[]).some(p=>sel.every((v,i)=>p[i]===v));  // 한 회사가 여러 품목 경로를 가지면 하나라도 맞으면 포함. 해외계는 상세구분이 없어 상세 선택 시 제외(상단 차트와 같은 기준)
 let rows=m.rows.filter(x=>(!g||x.g===g)&&(!c||x.c===c)&&pathOk(x)&&(!q||x.n.toLowerCase().includes(q)||(x.d||'').toLowerCase().includes(q)));
 rows=rows.slice().sort((a,b)=>{const A=val(a,sortKey),B=val(b,sortKey);if(A==null&&B==null)return 0;if(A==null)return 1;if(B==null)return -1;return (typeof A==='string'?A.localeCompare(B,'ko'):A-B)*sortDir});
 const nd=rows.filter(x=>x.g==='dom').length,no=rows.length-nd;
 $('co-count').textContent='국내 '+nd+'곳 · 해외계 '+no+'곳 표시 (이 비교 기준에서 3개년 실적이 확인된 법인)'+(sel.length?' · 상세구분 필터 적용: '+sel.join(' > '):'');
 const head='<thead><tr>'+COLS.map(([k,l,s])=>'<th scope="col" class="'+(s?'l':'')+'" data-k="'+k+'" aria-sort="'+(sortKey===k?(sortDir>0?'ascending':'descending'):'none')+'"><button type="button">'+esc(l)+(sortKey===k?(sortDir>0?' ▲':' ▼'):'')+'</button></th>').join('')+'</tr></thead>';
 const body='<tbody>'+rows.slice(0,shown).map(x=>{const r=x.r,o=x.o;return '<tr><th scope="row" class="l"><span class="co-n">'+esc(x.n)+'</span>'+(x.d?'<small>'+esc(x.d)+'</small>':'')+(x.q==='calc'?'<small class="co-calc">영업이익 계산값</small>':'')+'</th><td class="l">'+(x.g==='dom'?'국내':'해외계')+'</td><td class="l">'+esc(x.c)+'</td><td class="l">'+esc(x.s)+'</td><td>'+fmt(r[0])+'</td><td>'+fmt(r[1])+'</td><td>'+fmt(r[2])+'</td><td>'+fmt(o[2])+'</td><td>'+pct(margin(o[0],r[0]))+'</td><td>'+pct(margin(o[1],r[1]))+'</td><td>'+pct(margin(o[2],r[2]))+'</td><td>'+sg(grow(r,1))+'</td><td>'+sg(grow(r,2))+'</td></tr>'}).join('')+'</tbody>';
 $('co-tbl').innerHTML=head+body;
 const more=$('co-more');more.hidden=rows.length<=shown;more.textContent='더 보기 ('+Math.min(shown,rows.length)+' / '+rows.length+')';
 $('co-empty').hidden=rows.length>0;
 const cn=$('co-calc-note'),cq=m.rows.filter(x=>x.q==='calc').map(x=>x.n);  // 계산값 법인이 이 비교 기준에 있을 때만 설명을 보인다
 if(cn){cn.hidden=!cq.length;cn.innerHTML=cq.length?'<b>영업이익 계산값</b>: 손익계산서에 영업이익 줄이 없는 기업('+cq.map(esc).join(', ')+')은 같은 연차보고서의 매출 − 매출원가 − 연구개발비 − 판관비로 계산했습니다. 따로 공시된 영업권·무형자산 손상 등은 빼지 않아, 그런 비용이 있는 해에는 실제 영업 결과보다 높게 나옵니다.':''}
}
fetch('data/growth-companies.json',{cache:'no-cache'}).then(r=>r.json()).then(j=>{D=j;
 window.GC_ROWS=j.modes.flatMap(m=>m.rows.map(x=>({c:x.c,p:x.p})));if(window.gcSync)window.gcSync();  // 상단 상세구분 선택지에 회사별 상세의 경로를 보탠다
 $('co-note').textContent=(j.note||'')+' 금액 단위: '+j.unit+'. 재무 기준은 비교 기준에 따라 다릅니다(별도·연결·개별).';
 const cs=[...new Set(j.modes.flatMap(m=>m.rows.map(x=>x.c)))].sort();$('co-c').innerHTML='<option value="">전체</option>'+cs.map(c=>'<option>'+esc(c)+'</option>').join('');
 ['co-q','co-g','co-c'].forEach(id=>$(id).addEventListener(id==='co-q'?'input':'change',()=>{shown=60;render()}));
 ['f-view','f-chart','f-d1','f-d2','f-d3','f-d4','f-d5'].forEach(id=>{const e=$(id);if(e)e.addEventListener('change',()=>{shown=60;setTimeout(render,0)})});  // 상단 필터가 하위 선택을 비운 뒤(같은 change 이벤트 처리 후) 다시 그린다
 $('co-tbl').addEventListener('click',e=>{const t=e.target.closest('th[data-k]');if(!t)return;const k=t.dataset.k;if(sortKey===k)sortDir=-sortDir;else{sortKey=k;sortDir=(k==='n'||k==='g'||k==='c'||k==='s')?1:-1}render()});
 $('co-more').addEventListener('click',()=>{shown+=100;render()});
 render();
}).catch(()=>{box.innerHTML='<p class="gc-empty">회사별 상세를 불러오지 못했습니다.</p>'});
})();
