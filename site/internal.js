// 내부 정보(기업규모·거래 관계·반도체 매출 비중) 인증 화면.
// 공개 사이트에는 암호문(data/internal.enc.js)만 올리고, 비밀번호를 넣은 브라우저에서만 복호화한다.
// 암호: PBKDF2-SHA256(반복 310,000회)로 키를 만들고 AES-GCM 256으로 암호화. 비밀번호와 평문은 어디에도 저장하지 않는다.
(() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = { to: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))), from: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) };
  const ITER = 310000;

  async function deriveKey(password, salt, iter = ITER) {
    const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  }
  async function encrypt(obj, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
    return { v: 1, iter: ITER, salt: b64.to(salt), iv: b64.to(iv), data: b64.to(data), updated: new Date().toISOString().slice(0, 10) };
  }
  async function decryptWithKey(box, key) {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.from(box.iv) }, key, b64.from(box.data));
    return JSON.parse(dec.decode(plain));
  }

  // 같은 탭에서 다시 묻지 않도록 키(비밀번호 아님)만 탭 세션에 둔다
  const SKEY = "sobujang-internal-key";
  async function saveKey(key) { try { sessionStorage.setItem(SKEY, b64.to(await crypto.subtle.exportKey("raw", key))); } catch (e) { /* 저장 불가 환경 */ } }
  async function loadKey() {
    try { const raw = sessionStorage.getItem(SKEY); return raw ? crypto.subtle.importKey("raw", b64.from(raw), "AES-GCM", true, ["decrypt"]) : null; } catch (e) { return null; }
  }
  function forget() { try { sessionStorage.removeItem(SKEY); } catch (e) { /* 무시 */ } }

  const state = { data: null };
  const listeners = [];
  const emit = () => listeners.forEach((fn) => fn(state.data));

  async function unlock(password) {
    const box = window.INTERNAL_ENC;
    if (!box) throw new Error("none");
    const key = await deriveKey(password, b64.from(box.salt), box.iter);
    state.data = await decryptWithKey(box, key); // 비밀번호가 틀리면 여기서 실패
    await saveKey(key);
    emit();
  }
  async function resume() {
    const box = window.INTERNAL_ENC, key = box && (await loadKey());
    if (!key) return;
    try { state.data = await decryptWithKey(box, key); emit(); } catch (e) { forget(); }
  }
  function lock() { state.data = null; forget(); emit(); }

  // ---------- 화면: 잠금 버튼 + 비밀번호 대화상자 ----------
  function mount() {
    const btn = document.getElementById("lock-btn"), dlg = document.getElementById("auth-dialog");
    if (!btn || !dlg) return;
    const form = dlg.querySelector("form"), input = dlg.querySelector("#auth-pw"), msg = dlg.querySelector("#auth-msg"), go = dlg.querySelector("#auth-go");
    const paint = () => {
      const on = !!state.data;
      btn.classList.toggle("on", on);
      btn.innerHTML = on ? '<i class="ph ph-lock-open" aria-hidden="true"></i>내부 정보 표시 중 · 잠그기' : '<i class="ph ph-lock-key" aria-hidden="true"></i>내부 정보 보기';
    };
    btn.addEventListener("click", () => {
      if (state.data) { lock(); return; }
      msg.textContent = window.INTERNAL_ENC ? "" : "아직 등록된 내부 정보가 없습니다. 담당자가 암호화 도구로 파일을 만든 뒤 올려야 합니다.";
      input.value = "";
      dlg.hidden = false;
      input.focus();
    });
    // 닫으면 열었던 버튼으로 초점을 돌려준다
    const close = () => { if (dlg.hidden) return; dlg.hidden = true; btn.focus(); };
    dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close]")) close(); });
    document.addEventListener("keydown", (e) => {
      if (dlg.hidden) return;
      if (e.key === "Escape") { close(); return; }
      if (e.key !== "Tab") return;
      // 열려 있는 동안 Tab 이 대화상자 밖으로 나가지 않게 한다
      const f = [...dlg.querySelectorAll("input, button, a[href]")].filter((el) => !el.disabled && el.offsetParent);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!window.INTERNAL_ENC) return;
      go.disabled = true; msg.textContent = "확인 중…";
      try { await unlock(input.value); close(); msg.textContent = ""; }
      catch (err) { msg.textContent = "비밀번호가 맞지 않습니다. 다시 입력해 주세요."; input.select(); }
      finally { go.disabled = false; input.value = ""; }
    });
    listeners.push(paint);
    paint();
  }

  window.InternalData = {
    onChange: (fn) => { listeners.push(fn); if (state.data) fn(state.data); },
    get: () => state.data,
    encrypt, // 암호화 도구에서 사용
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { mount(); resume(); });
  else { mount(); resume(); }
})();
