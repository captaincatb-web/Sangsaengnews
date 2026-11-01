/* 공통 화면 모드(밝게·어둡게): 저장된 선택을 적용하고 머리글에 전환 버튼을 넣는다. 대시보드와 같은 저장 키(sobujang:theme)를 쓴다. */
(function () {
  "use strict";
  var root = document.documentElement, KEY = "sobujang:theme";
  function stored() { try { var t = localStorage.getItem(KEY); return t === "dark" || t === "light" ? t : null; } catch (e) { return null; } }
  function current() { return root.dataset.theme || (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); }
  var s = stored(); if (s) root.dataset.theme = s;
  function mount() {
    var host = document.querySelector(".head-actions");
    if (!host || host.querySelector(".th-btn")) return;
    var b = document.createElement("button"); b.type = "button"; b.className = "th-btn";
    function paint() { var d = current() === "dark"; b.innerHTML = '<i class="ph ' + (d ? "ph-sun" : "ph-moon") + '" aria-hidden="true"></i>'; b.setAttribute("aria-label", d ? "밝은 화면으로 전환" : "어두운 화면으로 전환"); b.title = b.getAttribute("aria-label"); }
    b.addEventListener("click", function () {
      var t = current() === "dark" ? "light" : "dark"; root.classList.add("th-switch"); setTimeout(function () { root.classList.remove("th-switch"); }, 600);
      root.dataset.theme = t; try { localStorage.setItem(KEY, t); } catch (e) { /* 저장 불가 환경 */ } paint();
    });
    paint(); host.insertBefore(b, host.firstChild);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
