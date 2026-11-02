/* World country overview. SVG geometry is sourced from Natural Earth, not company coordinates. */
(function(){
  "use strict";
  const root=document.getElementById("cm-world");
  const U=window.CompareWorldUtils;
  if(!root||!U)return;
  const canvas=root.querySelector("#cm-world-canvas");
  const list=root.querySelector("#cm-world-country-list");
  const metricSel=root.querySelector("#cm-world-metric");
  const legend=root.querySelector("#cm-world-legend");
  const coverage=root.querySelector("#cm-world-coverage");
  const announcements=root.querySelector("#cm-world-status");
  const svgNs="http://www.w3.org/2000/svg";
  const NAMES={count:"기업 수",sales:"매출 합계",growth:"매출 증감률"};
  let svg=null,pinLayer=null,mapLoaded=false,loading=false,metric="count";
  let groups={},chosen="all",baseRows=[],onSelect=null,pinFrame=0,firstLoad=true;
  function countryName(code){return U.LABELS[code]||code;}
  function inMap(code){return svg&&[...svg.querySelectorAll("path[data-iso]")].some(p=>p.dataset.iso===code);}
  function select(code){
    if(code!=="all"&&!Object.prototype.hasOwnProperty.call(groups,code))return;
    if(typeof onSelect==="function")onSelect(code);
    announcements.textContent=(code==="all"?"전체 국가":countryName(code))+" 선택";
  }
  function makeWires(w,h){
    const el=document.createElementNS(svgNs,"svg");
    el.classList.add("cm-world-pin-wires");
    el.setAttribute("viewBox","0 0 "+w+" "+h);
    el.setAttribute("aria-hidden","true");
    return el;
  }
  function paintPins(){
    if(!mapLoaded||!pinLayer||!root.isConnected)return;
    const focused=document.activeElement?.dataset.worldPin;
    pinLayer.replaceChildren();
    const box=canvas.getBoundingClientRect();
    if(box.width<120||box.height<90)return;
    const priority=Object.keys(groups).sort((a,b)=>
      (a===chosen?-1:b===chosen?1:0)||U.value(groups[b],metric)-U.value(groups[a],metric));
    const candidates=[];
    const probe=document.createElement("div");
    probe.className="cm-world-layer-probe";
    pinLayer.appendChild(probe);
    const ctm=svg.getScreenCTM();
    for(const code of priority){
      const el=svg.querySelector('path[data-iso="'+code+'"]');
      if(!el||!ctm||!el.hasAttribute("data-x"))continue;
      const nativeX=Number(el.dataset.x),nativeY=Number(el.dataset.y);
      if(!Number.isFinite(nativeX)||!Number.isFinite(nativeY))continue;
      const pt=new DOMPoint(nativeX,nativeY).matrixTransform(ctm);
      const text=countryName(code)+" "+U.label(U.value(groups[code],metric),metric);
      const button=document.createElement("button");button.className="cm-world-pin";button.textContent=text;probe.appendChild(button);
      const b=button.getBoundingClientRect();
      candidates.push({code,label:text,x:pt.x-box.left,y:pt.y-box.top,w:b.width,h:b.height,
        selected:chosen===code});
    }
    probe.remove();
    const pins=U.layoutPins(candidates,box.width,box.height);
    const wires=makeWires(box.width,box.height);
    for(const p of pins)if(Math.hypot(p.x-p.anchorX,p.y-p.anchorY)>9){
      const line=document.createElementNS(svgNs,"line");
      line.setAttribute("x1",p.anchorX);line.setAttribute("y1",p.anchorY);
      line.setAttribute("x2",p.x);line.setAttribute("y2",p.y);
      wires.appendChild(line);
    }
    pinLayer.appendChild(wires);
    for(const p of pins){
      const button=document.createElement("button");button.type="button";
      button.className="cm-world-pin";
      button.dataset.worldPin=p.code;
      button.style.left=p.x+"px";button.style.top=p.y+"px";
      button.setAttribute("aria-pressed",String(chosen===p.code));
      button.setAttribute("aria-label",countryName(p.code)+" "+NAMES[metric]+" "+U.label(U.value(groups[p.code],metric),metric)+
        ", 분석 기업 "+groups[p.code].n+"곳. 국가 필터 적용");
      button.textContent=p.label;
      pinLayer.appendChild(button);
      if(focused===p.code)button.focus({preventScroll:true});
    }
  }
  function schedulePins(){cancelAnimationFrame(pinFrame);pinFrame=requestAnimationFrame(paintPins);}
  function update(){
    groups=U.countryGroups(baseRows);
    const ordered=Object.keys(groups).sort((a,b)=>groups[b].n-groups[a].n||a.localeCompare(b));
    const upper=Math.max(.1,...ordered.map(c=>Math.abs(U.value(groups[c],metric)||0)));
    const n=ordered.reduce((sum,c)=>sum+groups[c].n,0);
    coverage.textContent="현재 업종 필터 기준 해외 "+n.toLocaleString("ko-KR")+"개사 · "+ordered.length+
      "개국 · 국가별 본사 소재국 분류";
    legend.textContent=metric==="growth"?
      "청록: 증가 · 붉은색: 감소 · 회색: 값 미확인 또는 대상 없음 · 비교 가능한 기업만 합산":
      "진할수록 "+NAMES[metric]+"가 큼 · 값 범위 0~"+U.label(upper,metric)+
      " (현재 업종 필터 기준) · 회색: 대상 없음";
    list.replaceChildren();
    const allBtn=document.createElement("button");
    allBtn.type="button";allBtn.dataset.worldCountry="all";
    allBtn.setAttribute("aria-pressed",String(chosen==="all"));
    const allLabel=document.createElement("span");allLabel.textContent="전체 해외 국가";
    const allValue=document.createElement("strong");allValue.textContent=n+"곳";
    allBtn.append(allLabel,allValue);list.appendChild(allBtn);
    for(const code of ordered){
      const st=groups[code];
      const btn=document.createElement("button");btn.type="button";
      btn.dataset.worldCountry=code;
      btn.setAttribute("aria-pressed",String(chosen===code));
      btn.setAttribute("aria-label",countryName(code)+" "+st.n+"개사, "+NAMES[metric]+" "+U.label(U.value(st,metric),metric)+"; 국가 필터 적용");
      const name=document.createElement("span");name.textContent=countryName(code);
      const val=document.createElement("strong");val.textContent=U.label(U.value(st,metric),metric);
      btn.append(name,val);list.appendChild(btn);
    }
    if(!ordered.length){
      const msg=document.createElement("p");msg.className="cm-world-no-data";msg.textContent="선택된 업종의 해외 기업이 없습니다.";
      list.appendChild(msg);
    }
    if(svg){
      svg.querySelectorAll("path[data-iso]").forEach(p=>{
        const code=p.dataset.iso,st=groups[code],v=U.value(st,metric);
        p.classList.toggle("is-covered",Boolean(st));
        p.classList.toggle("is-selected",Boolean(st)&&chosen===code);
        p.style.fill=U.fill(v,metric,upper);
        if(st){
          p.setAttribute("role","button");p.setAttribute("tabindex","0");
          p.setAttribute("aria-pressed",String(chosen===code));
          p.setAttribute("aria-label",countryName(code)+" "+st.n+"개사 · "+NAMES[metric]+" "+U.label(v,metric));
        }else{
          p.removeAttribute("role");p.removeAttribute("tabindex");
          p.removeAttribute("aria-pressed");p.removeAttribute("aria-label");
        }
      });
      schedulePins();
    }
  }
  function load(){
    if(loading)return;
    loading=true;
    canvas.textContent="세계지도를 불러오는 중…";
    fetch("data/geo/world-110m.svg").then(r=>{
      if(!r.ok)throw Error("HTTP "+r.status);
      return r.text();
    }).then(str=>{
      const doc=new DOMParser().parseFromString(str,"image/svg+xml");
      const element=doc.documentElement;
      const paths=[...element.querySelectorAll("path[data-iso]")];
      if(element.localName!=="svg" || paths.length<170 ||
        paths.some(p=>!p.getAttribute("d") || !/^[A-Z0-9_-]{2,8}$/.test(p.getAttribute("data-iso"))))throw Error("지도 데이터 검증 실패");
      svg=document.createElementNS(svgNs,"svg");
      svg.setAttribute("viewBox","0 0 1080 540");
      svg.setAttribute("role","group");
      svg.setAttribute("aria-label","세계 국가별 분석 대상 기업 분포 지도");
      svg.classList.add("cm-world-map");
      for(const old of paths){
        const p=document.createElementNS(svgNs,"path");
        p.dataset.iso=old.getAttribute("data-iso");
        p.setAttribute("d",old.getAttribute("d"));
        for(const k of ["data-x","data-y","fill-rule"])if(old.hasAttribute(k))p.setAttribute(k,old.getAttribute(k));
        const title=document.createElementNS(svgNs,"title");title.textContent=countryName(p.dataset.iso);p.appendChild(title);
        svg.appendChild(p);
      }
      pinLayer=document.createElement("div");pinLayer.className="cm-world-pins";
      canvas.replaceChildren(svg,pinLayer);mapLoaded=true;loading=false;update();
    }).catch(err=>{
      loading=false;mapLoaded=false;
      const msg=document.createElement("div");msg.className="cm-world-no-data";
      msg.textContent="세계지도를 불러오지 못했습니다 ("+err.message+"). 국가 목록은 계속 사용할 수 있습니다. ";
      const retry=document.createElement("button");retry.type="button";retry.textContent="지도 다시 불러오기";retry.dataset.worldRetry="";
      msg.appendChild(retry);canvas.replaceChildren(msg);
    });
  }
  root.addEventListener("click",e=>{
    const retry=e.target.closest("[data-world-retry]");
    if(retry){load();return;}
    const el=e.target.closest("[data-world-country],[data-world-pin],path.is-covered");
    if(!el)return;
    const code=el.dataset.worldCountry||el.dataset.worldPin||el.dataset.iso;
    if(code)select(code===chosen?"all":code);
  });
  root.addEventListener("keydown",e=>{
    const path=e.target.closest("path.is-covered");
    if(path && (e.key==="Enter"||e.key===" ")){e.preventDefault();select(path.dataset.iso===chosen?"all":path.dataset.iso);}
  });
  metricSel.addEventListener("change",()=>{metric=metricSel.value;update();announcements.textContent="세계지도 지표 "+NAMES[metric];});
  if(typeof ResizeObserver!=="undefined")new ResizeObserver(schedulePins).observe(canvas);
  window.addEventListener("resize",schedulePins);
  load();
  window.CompareWorldMap={
    render(allRows,selectedCountry){
      baseRows=Array.isArray(allRows)?allRows:[];
      chosen=selectedCountry||"all";
      update();
    },
    set onSelect(fn){onSelect=fn;}
  };
})();
