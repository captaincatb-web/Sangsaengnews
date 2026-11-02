/* 모바일(860px 이하): 상단 메뉴(프로필~이용 안내)는 접어 두고 머리글의 '메뉴' 버튼으로 연다. 모든 화면이 같은 방식을 쓴다. */
(function () {
  "use strict";
  var head = document.querySelector(".krds-header"), nav = head && head.querySelector("nav.gnb");
  if (!nav) return;
  if (!nav.id) nav.id = "site-gnb";
  var btn = document.getElementById("site-menu");
  if (!btn) {
    var host = head.querySelector(".head-actions"); if (!host) return;
    btn = document.createElement("button"); btn.type = "button"; btn.id = "site-menu"; btn.className = "btn-navi site-menu";
    btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", nav.id);
    btn.innerHTML = '<i class="ph ph-list" aria-hidden="true"></i>메뉴';
    host.insertBefore(btn, host.querySelector(".btn-navi"));
  }
  function set(open) { head.classList.toggle("open", open); btn.setAttribute("aria-expanded", open ? "true" : "false"); }
  btn.addEventListener("click", function () { set(!head.classList.contains("open")); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && head.classList.contains("open")) { set(false); btn.focus(); } });
})();
