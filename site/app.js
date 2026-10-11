// 첫 화면: 지정 기업의 매출·이익·주가를 한 표로 보여 준다. 검색·그룹·상장 여부로 거르고, 열 머리글로 정렬한다.
(() => {
  const groups = window.COMPANY_GROUPS || [];
  const profiles = window.COMPANY_PROFILES || {};
  const updated = window.COMPANY_PROFILES_UPDATED || "";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").toLowerCase().replace(/[\s().,㈜-]/g, "");
  const pct = (a, b) => (a != null && b ? Math.round((a / b) * 1000) / 10 : null);

  const COLUMNS = [
    { key: "name", label: "기업명", word: "기업명", text: true },
    { key: "code", label: "종목코드", word: "종목코드", text: true, fixed: true },
    { key: "period", label: "결산", word: "결산", text: true, fixed: true },
    { key: "sales", label: "매출액", word: "매출액(억원)" },
    { key: "op", label: "영업이익", word: "영업이익(억원)" },
    { key: "margin", label: "영업이익률", word: "영업이익률", pct: true },
    { key: "net", label: "순이익", word: "당기순이익(억원)" },
    { key: "debtRatio", label: "부채비율", word: "부채비율", pct: true },
    { key: "price", label: "주가", word: "주가(원)" },
    { key: "cap", label: "시가총액", word: "시가총액(억원)" },
  ];

  // 프로필 데이터에서 최근 결산 연도의 주요 숫자를 뽑는다
  function metrics(p) {
    const fin = p && p.financials;
    const last = fin ? fin.years.length - 1 : -1;
    const pick = (k) => (fin && fin.rows[k] ? fin.rows[k][last] : null);
    const sales = pick("매출액"), op = pick("영업이익");
    const ratio = p && p.ratios && p.ratios.values ? p.ratios.values["부채비율"] : null;
    return {
      period: fin && p.report_year ? `'${String(p.report_year).slice(2)}.${String(p.acc_mt || 12).padStart(2, "0")}` : "",
      sales, op, margin: pct(op, sales), net: pick("당기순이익"),
      debtRatio: ratio ? ratio[last] : pct(pick("부채총계"), pick("자본총계")),
      price: p && p.market ? p.market.price : null,
      cap: p && p.market ? p.market.cap : null,
      priceDate: p && p.market ? p.market.date : "",
    };
  }

  const companies = groups.flatMap((g) => g.companies.map(([name, corpCode, stockCode, note], order) => {
    const p = profiles[corpCode];
    return {
      name, corpCode, stockCode, note: note || "", groupId: g.id, groupLabel: g.label, order,
      code: stockCode || "비상장", legal: p ? `${p.corp_name || ""} ${p.corp_name_eng || ""}` : "",
      ...metrics(p),
    };
  }));

  // ---------- 첫머리 요약 ----------
  const listed = companies.filter((c) => c.stockCode).length;
  $("total").textContent = companies.length;
  $("summary").innerHTML = [
    `상장 <strong>${listed}</strong>곳`,
    `비상장 <strong>${companies.length - listed}</strong>곳`,
    updated ? `${esc(updated)} 갱신` : "",
  ].filter(Boolean).map((t) => `<li>${t}</li>`).join("");

  const dates = companies.map((c) => c.priceDate).filter(Boolean);
  const priceDate = dates.sort((a, b) => dates.filter((d) => d === b).length - dates.filter((d) => d === a).length)[0];
  $("table-note").textContent = `금액 단위 억원, 주가 원. 재무는 개별기준 최근 결산${priceDate ? `, 주가와 시가총액은 ${priceDate} 종가 기준` : ""}입니다.`;

  // ---------- 필터·정렬 상태 ----------
  const state = { query: "", group: "all", listedOnly: false, sortKey: null, sortDir: null };
  const tabs = [{ id: "all", label: "전체" }, ...groups.map((g) => ({ id: g.id, label: g.label }))];

  function matchesText(c) {
    if (state.listedOnly && !c.stockCode) return false;
    const q = norm(state.query);
    return !q || [c.name, c.note, c.corpCode, c.stockCode, c.legal].some((v) => norm(v).includes(q));
  }
  const matches = (c) => matchesText(c) && (state.group === "all" || c.groupId === state.group);

  function sortRows(rows) {
    const { sortKey: key, sortDir: dir } = state;
    if (!key) return rows.slice().sort((a, b) => a.order - b.order);
    const sign = dir === "asc" ? 1 : -1;
    return rows.slice().sort((a, b) => {
      const x = a[key], y = b[key];
      if (x == null || x === "") return 1; // 값이 없는 기업은 항상 아래로
      if (y == null || y === "") return -1;
      return (key === "name" ? String(x).localeCompare(String(y), "ko") : x - y) * sign;
    });
  }

  const fmt = (v, isPct) => (v == null ? "-" : isPct ? `${v.toFixed(1)}%` : Number(v).toLocaleString("ko-KR"));

  // ---------- 표 그리기 ----------
  const table = $("companies");
  $("table-head").innerHTML = COLUMNS.map((col) => {
    const cls = col.text ? ' class="text"' : "";
    if (col.fixed) return `<th scope="col"${cls}>${col.label}</th>`;
    return `<th scope="col"${cls} aria-sort="none"><button type="button" class="sort" data-sort="${col.key}">${col.label}`
      + `<i class="ph ph-caret-up-down" aria-hidden="true"></i></button></th>`;
  }).join("");

  const rowHtml = (c) => `<tr data-href="profile.html#${c.corpCode}">`
    + `<th scope="row" class="text"><a href="profile.html#${c.corpCode}">${esc(c.name)}</a></th>`
    + `<td class="text${c.stockCode ? "" : " muted"}">${esc(c.code)}</td>`
    + `<td class="text muted">${c.period || "-"}</td>`
    + COLUMNS.slice(3).map((col) => `<td${c[col.key] == null ? ' class="muted"' : ""}>${fmt(c[col.key], col.pct)}</td>`).join("")
    + "</tr>";

  function render() {
    const visible = companies.filter(matches);
    const body = groups.map((g) => {
      const rows = sortRows(visible.filter((c) => c.groupId === g.id));
      if (!rows.length) return "";
      return `<tbody><tr class="grp-row"><th colspan="${COLUMNS.length}" scope="rowgroup">`
        + `<span>${esc(g.label)} <small>${rows.length}곳</small></span></th></tr>${rows.map(rowHtml).join("")}</tbody>`;
    }).join("");
    table.querySelectorAll("tbody").forEach((t) => t.remove());
    table.insertAdjacentHTML("beforeend", body);
    table.hidden = !visible.length;
    $("empty").hidden = visible.length > 0;
    $("copy-table").disabled = !visible.length;
    $("result-count").textContent = `${visible.length}곳 표시`;

    // 그룹 탭의 숫자는 검색어·상장 필터를 반영한다
    $("group-filter").querySelectorAll("button").forEach((b) => {
      const n = companies.filter((c) => matchesText(c) && (b.dataset.group === "all" || c.groupId === b.dataset.group)).length;
      b.querySelector(".count").textContent = n;
    });
  }

  // ---------- 그룹 탭 ----------
  $("group-filter").innerHTML = tabs.map((t) => `<button type="button" role="radio" data-group="${t.id}" `
    + `aria-checked="${t.id === "all"}" tabindex="${t.id === "all" ? 0 : -1}">${esc(t.label)}<span class="count"></span></button>`).join("");

  function setGroup(id) {
    state.group = id;
    $("group-filter").querySelectorAll("button").forEach((b) => {
      const on = b.dataset.group === id;
      b.setAttribute("aria-checked", on);
      b.tabIndex = on ? 0 : -1;
    });
    render();
  }

  $("group-filter").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-group]");
    if (b) setGroup(b.dataset.group);
  });
  $("group-filter").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = tabs.findIndex((t) => t.id === state.group);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    setGroup(next.id);
    $("group-filter").querySelector(`[data-group="${next.id}"]`).focus();
  });

  // ---------- 정렬 ----------
  table.querySelector("thead").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sort]");
    if (!b) return;
    const key = b.dataset.sort;
    const first = key === "name" ? "asc" : "desc";
    if (state.sortKey !== key) Object.assign(state, { sortKey: key, sortDir: first });
    else if (state.sortDir === first) state.sortDir = first === "asc" ? "desc" : "asc";
    else Object.assign(state, { sortKey: null, sortDir: null }); // 세 번째 누르면 원래 순서
    table.querySelectorAll("thead th[aria-sort]").forEach((th) => {
      const k = th.querySelector("button").dataset.sort;
      const on = k === state.sortKey;
      th.setAttribute("aria-sort", on ? (state.sortDir === "asc" ? "ascending" : "descending") : "none");
      th.querySelector(".ph").className = `ph ${on ? (state.sortDir === "asc" ? "ph-caret-up" : "ph-caret-down") : "ph-caret-up-down"}`;
    });
    render();
  });

  // ---------- 행 누르면 프로필로 ----------
  table.addEventListener("click", (e) => {
    if (e.target.closest("a, button") || String(window.getSelection())) return; // 글자를 드래그해 고르는 중이면 이동하지 않는다
    const tr = e.target.closest("tr[data-href]");
    if (tr) location.href = tr.dataset.href;
  });

  // ---------- 검색·상장 필터·초기화 ----------
  $("search").addEventListener("input", (e) => { state.query = e.target.value; render(); });
  $("listed-only").addEventListener("change", (e) => { state.listedOnly = e.target.checked; render(); });
  $("reset-filters").addEventListener("click", () => {
    state.query = "";
    $("search").value = "";
    state.listedOnly = false;
    $("listed-only").checked = false;
    setGroup("all");
    $("search").focus();
  });

  // ---------- 표 복사 (Word·Excel 붙여 넣기용) ----------
  $("copy-table").addEventListener("click", () => {
    const clone = table.cloneNode(true);
    clone.querySelectorAll("thead th").forEach((th, i) => { th.textContent = COLUMNS[i].word; });
    clone.querySelectorAll(".grp-row th").forEach((th) => { th.textContent = th.textContent.replace(/\s+/g, " ").trim(); });
    const box = document.createElement("div");
    box.innerHTML = `<h2>반도체 상생 협력 기업 현황${updated ? ` (${esc(updated)} 기준)` : ""}</h2>`
      + `<p class="copy-note">${esc($("table-note").textContent)}</p>`;
    box.appendChild(clone);
    window.CopyKit.copyNode(box, "표를 복사했습니다. Word나 Excel에 붙여 넣으세요.");
  });

  render();
})();
