(() => {
  const groups = window.COMPANY_GROUPS || [];

  const companies = groups.flatMap((g) =>
    g.companies.map(([name, corpCode, stockCode, note]) => ({
      name, corpCode, stockCode, note: note || "",
      groupId: g.id, groupLabel: g.label,
    }))
  );

  const state = { query: "", group: "all", listedOnly: false };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => s.toLowerCase().replace(/[\s().,-]/g, "");

  // 첫 화면 숫자
  const listed = companies.filter((c) => c.stockCode).length;
  $("hero-total").textContent = companies.length;
  $("listed-count").textContent = `${listed}곳`;
  $("unlisted-count").textContent = `${companies.length - listed}곳`;
  $("group-stats").innerHTML = groups.map((g) => `
    <li><button type="button" data-group="${g.id}">
      <span class="g-name">${esc(g.label)} <i class="ph ph-arrow-right" aria-hidden="true"></i></span>
      <span class="g-count">${g.companies.length}<small>곳</small></span>
    </button></li>`).join("");
  $("group-stats").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-group]");
    if (!btn) return;
    setGroup(btn.dataset.group);
    $("directory").scrollIntoView();
  });

  // 그룹 필터
  const filterOptions = [{ id: "all", label: "전체" }, ...groups.map((g) => ({ id: g.id, label: g.label }))];
  $("group-filter").innerHTML = filterOptions.map((o) =>
    `<button type="button" role="radio" data-group="${o.id}" aria-checked="${o.id === "all"}">${esc(o.label)}</button>`).join("");
  $("group-filter").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-group]");
    if (btn) setGroup(btn.dataset.group);
  });
  $("group-filter").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = filterOptions.findIndex((o) => o.id === state.group);
    const next = filterOptions[(i + (e.key === "ArrowRight" ? 1 : -1) + filterOptions.length) % filterOptions.length];
    setGroup(next.id);
    $("group-filter").querySelector(`[data-group="${next.id}"]`).focus();
  });

  function setGroup(id) {
    state.group = id;
    $("group-filter").querySelectorAll("button").forEach((b) => {
      const on = b.dataset.group === id;
      b.setAttribute("aria-checked", on);
      b.tabIndex = on ? 0 : -1;
    });
    render();
  }

  $("search").addEventListener("input", (e) => { state.query = e.target.value; render(); });
  $("listed-only").addEventListener("change", (e) => { state.listedOnly = e.target.checked; render(); });
  $("reset-filters").addEventListener("click", () => {
    state.query = ""; $("search").value = "";
    state.listedOnly = false; $("listed-only").checked = false;
    setGroup("all");
    $("search").focus();
  });

  function matches(c) {
    if (state.group !== "all" && c.groupId !== state.group) return false;
    if (state.listedOnly && !c.stockCode) return false;
    const q = norm(state.query);
    if (!q) return true;
    return [c.name, c.note, c.corpCode, c.stockCode].some((v) => norm(v).includes(q));
  }

  function render() {
    const list = companies.filter(matches);
    $("result-count").innerHTML = `<strong>${list.length}</strong>곳 표시 중`;
    $("empty").hidden = list.length > 0;
    $("company-grid").innerHTML = list.map((c) => `
      <li><a class="company" href="profile.html#${c.corpCode}">
        <span class="company-top">
          <span><span class="company-name">${esc(c.name)}</span>
          ${c.note ? `<span class="company-note">${esc(c.note)}</span>` : ""}</span>
          <i class="ph ph-arrow-up-right" aria-hidden="true"></i>
        </span>
        <span class="company-meta">
          <span class="chip">${esc(c.groupLabel)}</span>
          ${c.stockCode ? `<span class="chip chip-accent">${c.stockCode}</span>` : `<span class="chip">비상장</span>`}
        </span>
      </a></li>`).join("");
  }

  const updated = window.COMPANY_PROFILES_UPDATED;
  $("profiles-status").textContent = updated
    ? `마지막 갱신: ${updated}`
    : "아직 연결되지 않아 기본 정보만 표시합니다.";

  setGroup("all");
})();
