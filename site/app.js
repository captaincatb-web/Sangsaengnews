(() => {
  const groups = window.COMPANY_GROUPS || [];
  const profiles = window.COMPANY_PROFILES || {};
  const MARKETS = { Y: "유가증권시장", K: "코스닥", N: "코넥스", E: "기타" };

  const companies = groups.flatMap((g) =>
    g.companies.map(([name, corpCode, stockCode, note]) => ({
      name, corpCode, stockCode, note: note || "",
      groupId: g.id, groupLabel: g.label,
      profile: profiles[corpCode] || null,
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
      <li><button class="company" type="button" data-code="${c.corpCode}">
        <span class="company-top">
          <span><span class="company-name">${esc(c.name)}</span>
          ${c.note ? `<span class="company-note">${esc(c.note)}</span>` : ""}</span>
          <i class="ph ph-arrow-up-right" aria-hidden="true"></i>
        </span>
        <span class="company-meta">
          <span class="chip">${esc(c.groupLabel)}</span>
          ${c.stockCode ? `<span class="chip chip-accent">${c.stockCode}</span>` : `<span class="chip">비상장</span>`}
        </span>
      </button></li>`).join("");
  }

  // 상세 창
  const dialog = $("detail");
  $("company-grid").addEventListener("click", (e) => {
    const btn = e.target.closest(".company");
    if (btn) openDetail(companies.find((c) => c.corpCode === btn.dataset.code));
  });
  $("detail-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  const fact = (label, value, wide) => `<div${wide ? ' class="wide"' : ""}><dt>${label}</dt><dd>${value}</dd></div>`;
  const fmtDate = (d) => (/^\d{8}$/.test(d || "") ? `${d.slice(0, 4)}년 ${+d.slice(4, 6)}월 ${+d.slice(6)}일` : "");
  const safeUrl = (u) => {
    if (!u) return "";
    const url = /^https?:\/\//i.test(u) ? u : `http://${u}`;
    return /^https?:\/\/[^\s"<>]+$/i.test(url) ? url : "";
  };

  function openDetail(c) {
    $("detail-group").textContent = c.groupLabel;
    $("detail-name").textContent = c.name;
    $("detail-note").textContent = c.note;

    const copy = `<button class="copy-btn" type="button" data-copy="${c.corpCode}" aria-label="고유번호 복사"><i class="ph ph-copy" aria-hidden="true"></i></button>`;
    $("detail-ids").innerHTML =
      fact("DART 고유번호", `${c.corpCode}${copy}`) +
      fact("종목코드", c.stockCode || "비상장");

    const p = c.profile;
    if (p) {
      const home = safeUrl(p.hm_url);
      $("detail-profile").innerHTML = `<dl class="facts">${[
        p.ceo_nm && fact("대표자", esc(p.ceo_nm)),
        p.est_dt && fact("설립일", fmtDate(p.est_dt)),
        p.corp_cls && fact("시장 구분", MARKETS[p.corp_cls] || esc(p.corp_cls)),
        p.phn_no && fact("대표 전화", esc(p.phn_no)),
        p.adres && fact("주소", esc(p.adres), true),
        home && fact("홈페이지", `<a href="${esc(home)}" target="_blank" rel="noopener">${esc(p.hm_url)}</a>`, true),
      ].filter(Boolean).join("")}</dl>`;
    } else {
      $("detail-profile").innerHTML = `<div class="profile-empty"><i class="ph ph-info" aria-hidden="true"></i>
        <p>대표자, 설립일, 주소는 DART 기업개황 데이터를 연결하면 이곳에 표시됩니다.</p></div>`;
    }

    $("detail-links").innerHTML = [
      c.stockCode && `<a class="btn btn-primary" href="https://finance.naver.com/item/main.naver?code=${c.stockCode}" target="_blank" rel="noopener">네이버 증권 <i class="ph ph-arrow-up-right" aria-hidden="true"></i></a>`,
      `<a class="btn btn-ghost" href="https://dart.fss.or.kr/" target="_blank" rel="noopener">DART 공시 검색 <i class="ph ph-arrow-up-right" aria-hidden="true"></i></a>`,
    ].filter(Boolean).join("");

    dialog.showModal();
  }

  dialog.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-copy]");
    if (!btn) return;
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      toast("고유번호를 복사했습니다");
    } catch {
      toast("복사하지 못했습니다. 번호를 직접 선택해 주세요");
    }
  });

  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  const updated = window.COMPANY_PROFILES_UPDATED;
  $("profiles-status").textContent = updated
    ? `마지막 갱신: ${updated}`
    : "아직 연결되지 않아 기본 정보만 표시합니다.";

  setGroup("all");
})();
