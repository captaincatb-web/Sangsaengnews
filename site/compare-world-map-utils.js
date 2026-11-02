/* Pure regional analytics for overseas company map; values already converted to 억원 by PEERS. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object" && module.exports)module.exports=api;
  if(root)root.CompareWorldUtils=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const LABELS={US:"미국",JP:"일본",NL:"네덜란드",DE:"독일",FR:"프랑스",IL:"이스라엘",CN:"중국",KR:"한국",
    TW:"대만",GB:"영국",CH:"스위스",BE:"벨기에",SG:"싱가포르",MY:"말레이시아"};
  const NUM=x=>typeof x==="number" && Number.isFinite(x)?x:null;
  function summarize(list){
    const rows=Array.isArray(list)?list:[];
    const sales=rows.map(r=>NUM(r.s1)).filter(x=>x!=null);
    const comparable=rows.filter(r=>NUM(r.s0)>0 && NUM(r.s1)!=null);
    const s1=comparable.reduce((n,r)=>n+r.s1,0);
    const s0=comparable.reduce((n,r)=>n+r.s0,0);
    return {n:rows.length,sales:sales.length?sales.reduce((a,b)=>a+b,0):null,
      growth:s0>0?(s1/s0-1)*100:null,salesKnown:sales.length,growthKnown:comparable.length,rows};
  }
  function countryGroups(rows){
    const groups={};
    for(const r of rows||[]){
      const code=r && r.p && r.p.ctry;
      if(typeof code!=="string" || !/^[A-Z]{2}$/.test(code))continue;
      (groups[code] ||= []).push(r);
    }
    return Object.fromEntries(Object.entries(groups).map(([code,list])=>[code,summarize(list)]));
  }
  function value(stats,metric){return stats?(metric==="count"?stats.n:metric==="sales"?stats.sales:metric==="growth"?stats.growth:null):null;}
  function label(v,metric){
    if(v==null || !Number.isFinite(v))return "자료 없음";
    if(metric==="count")return v.toLocaleString("ko-KR")+"곳";
    if(metric==="growth")return (v>0?"+":"")+v.toFixed(1)+"%";
    return Math.abs(v)>=10000?(v/10000).toFixed(1)+"조":Math.round(v).toLocaleString("ko-KR")+"억";
  }
  function fill(v,metric,upper){
    if(v==null||!Number.isFinite(v))return "#d7dfe2";
    if(metric==="growth"){
      const alpha=(.28+Math.min(Math.abs(v)/40,1)*.64).toFixed(2);
      return v<0?"rgba(189,85,72,"+alpha+")":v>0?"rgba(31,113,104,"+alpha+")":"#99b4ad";
    }
    if(v<=0)return "#d7dfe2";
    return "rgba(30,110,106,"+(.22+.72*Math.sqrt(v/Math.max(upper,.1))).toFixed(2)+")";
  }
  // Avoid on-map pin overlap: always keep full information in country list.
  function layoutPins(points,w,h){
    const result=[];
    for(const p of points){
      const badgeW=p.w||70,badgeH=p.h||32;
      if(badgeW+4>w||badgeH+4>h)continue;
      let spot=null;
      for(let ring=0;ring<10&&!spot;ring++){
        const n=ring?Math.max(12,ring*14):1;
        for(let j=0;j<n;j++){
          const angle=2*Math.PI*j/n,dist=ring*13;
          const x=Math.max(badgeW/2+3,Math.min(w-badgeW/2-3,p.x+Math.cos(angle)*dist));
          const y=Math.max(badgeH/2+3,Math.min(h-badgeH/2-3,p.y+Math.sin(angle)*dist));
          if(result.some(q=>Math.abs(q.x-x)<(q.w+badgeW)/2+5 && Math.abs(q.y-y)<(q.h+badgeH)/2+5))continue;
          spot={...p,x,y,w:badgeW,h:badgeH,anchorX:p.x,anchorY:p.y};break;
        }
      }
      if(spot)result.push(spot);
    }
    return result;
  }
  return {LABELS,summarize,countryGroups,value,label,fill,layoutPins};
});
