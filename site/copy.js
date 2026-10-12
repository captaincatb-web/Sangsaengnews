// 복사 도우미: 화면 내용을 Word·Excel 에 붙여 넣기 좋은 서식(맑은 고딕, 검은 글자, 테두리 있는 표)으로 클립보드에 넣는다.
// 화면 테마(다크 모드 등)와 상관없이 항상 흰 바탕용 서식으로 복사된다.
(() => {
  const FONT = "font-family:'맑은 고딕','Malgun Gothic',sans-serif;color:#000;";
  const CELL = "border:1px solid #808080;padding:2pt 5pt;vertical-align:middle;";
  const S = {
    doc: `${FONT}font-size:10pt;line-height:1.5;`,
    h1: `${FONT}font-size:16pt;font-weight:bold;margin:0 0 4pt;`,
    h2: `${FONT}font-size:12pt;font-weight:bold;margin:14pt 0 6pt;`,
    h3: `${FONT}font-size:10.5pt;font-weight:bold;margin:12pt 0 4pt;`,
    p: `${FONT}font-size:10pt;margin:0 0 3pt;`,
    sub: `${FONT}font-size:10pt;margin:0 0 2pt 14pt;`,
    note: `${FONT}font-size:9pt;color:#444;margin:0 0 2pt 14pt;`,
    meta: `${FONT}font-size:9pt;color:#444;margin:0 0 10pt;`,
    caption: `${FONT}font-size:8pt;color:#444;margin:6pt 0 2pt;text-align:right;`,
    table: `${FONT}border-collapse:collapse;width:100%;margin:2pt 0 8pt;font-size:9pt;`,
    th: `${CELL}background:#F2F2F2;font-weight:bold;text-align:center;`,
    rowhead: `${CELL}font-weight:bold;text-align:left;`,
    group: `${CELL}background:#F2F2F2;font-weight:bold;text-align:center;`,
    td: `${CELL}text-align:right;`,
    tdText: `${CELL}text-align:left;`,
    small: "font-size:8pt;color:#555;font-weight:normal;",
  };

  function el(tag, style, html) {
    const node = document.createElement(tag);
    if (style) node.setAttribute("style", style);
    if (html != null) node.innerHTML = html;
    return node;
  }

  // 화면용 DOM 을 Word 용 DOM 으로 바꾼다 (클래스 대신 인라인 서식, Word 가 모르는 요소는 문단·표로 변환)
  function toWord(source) {
    const root = source.cloneNode(true);
    root.querySelectorAll("[data-nocopy], .ph, button, summary, script").forEach((n) => n.remove());
    root.querySelectorAll("details").forEach((d) => d.replaceWith(...d.childNodes));

    root.querySelectorAll("ul.meta").forEach((ul) => {
      const p = el("p", S.meta);
      p.textContent = [...ul.children].map((li) => li.textContent.trim()).filter(Boolean).join(" | ");
      ul.replaceWith(p);
    });
    // 목록 안의 보조 설명(대표이사 경력 등)은 줄을 바꿔 작은 글씨로
    root.querySelectorAll(".pf-sub").forEach((n) => n.replaceWith(el("br"), el("span", "font-size:9pt;color:#444;", n.innerHTML)));
    root.querySelectorAll("ul.pf-bullets").forEach((ul) => {
      const frag = document.createDocumentFragment();
      [...ul.children].forEach((li) => frag.appendChild(el("p", S.sub, `- ${li.innerHTML}`)));
      ul.replaceWith(frag);
    });
    root.querySelectorAll("dl.pf-kv").forEach((dl) => {
      const table = el("table", S.table);
      table.dataset.done = "1"; // 아래 공통 표 서식을 덮어쓰지 않도록 표시
      [...dl.children].forEach((row) => {
        const dt = row.querySelector("dt"), dd = row.querySelector("dd");
        if (!dt || !dd) return;
        const tr = table.insertRow();
        tr.appendChild(el("th", `${S.rowhead}background:#F2F2F2;width:28%;`, dt.innerHTML));
        tr.appendChild(el("td", S.tdText, dd.innerHTML));
      });
      dl.replaceWith(table);
    });
    root.querySelectorAll("table:not([data-done])").forEach((table) => {
      const isText = table.classList.contains("text");
      const cap = table.querySelector("caption");
      if (cap) {
        table.before(el("p", S.caption, cap.innerHTML));
        cap.remove();
      }
      table.setAttribute("style", S.table);
      table.querySelectorAll("thead th").forEach((c) => c.setAttribute("style", S.th));
      table.querySelectorAll("tbody th").forEach((c) => {
        c.setAttribute("style", c.classList.contains("grp") || c.hasAttribute("colspan") ? S.group : S.rowhead);
      });
      table.querySelectorAll("td").forEach((c) => c.setAttribute("style", isText || c.classList.contains("text") ? S.tdText : S.td));
      table.querySelectorAll("small").forEach((s) => {
        s.replaceWith(el("br"), el("span", S.small, s.innerHTML));
      });
      table.removeAttribute("class");
      table.removeAttribute("id");
    });

    const STYLE_BY_SELECTOR = [
      ["h1", S.h1], ["h2", S.h2], ["h3", S.h3],
      ["p.copy-note, p.pf-missing", S.meta], ["p.pf-note", S.note], ["p", S.p],
    ];
    STYLE_BY_SELECTOR.forEach(([sel, style]) => {
      root.querySelectorAll(sel).forEach((n) => { if (!n.getAttribute("style")) n.setAttribute("style", style); });
    });
    root.querySelectorAll("[class]").forEach((n) => n.removeAttribute("class"));
    root.querySelectorAll("[data-done]").forEach((n) => n.removeAttribute("data-done"));
    root.querySelectorAll("a").forEach((a) => a.setAttribute("style", "color:#000;"));

    const wrap = el("div", S.doc);
    wrap.append(...root.childNodes);
    return wrap;
  }

  function plainText(node) {
    // innerText 는 화면에 붙어 있어야 표의 칸·줄 구분이 살아나므로 잠시 화면 밖에 붙였다 뗀다
    const holder = el("div", "position:fixed;left:-99999px;top:0;width:800px;");
    holder.appendChild(node.cloneNode(true));
    document.body.appendChild(holder);
    const text = holder.innerText.replace(/\n{3,}/g, "\n\n").trim();
    holder.remove();
    return text;
  }

  async function copyRich(html, text) {
    const doc = `<html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([doc], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        })]);
        return true;
      }
    } catch (e) {
      // 아래의 선택 후 복사 방식으로 다시 시도한다
    }
    const holder = el("div", "position:fixed;left:-99999px;top:0;background:#fff;color:#000;", html);
    holder.contentEditable = "true";
    document.body.appendChild(holder);
    const range = document.createRange();
    range.selectNodeContents(holder);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    sel.removeAllRanges();
    holder.remove();
    return ok;
  }

  let toastTimer;
  function toast(message) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = message;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  async function copyNode(node, okMessage) {
    const word = toWord(node);
    const ok = await copyRich(word.outerHTML, plainText(word));
    toast(ok ? okMessage : "복사하지 못했습니다. 내용을 직접 선택해 복사해 주세요.");
    return ok;
  }

  window.CopyKit = { S, el, toWord, plainText, copyRich, copyNode, toast };
})();
