// "Who's playing?" + PIN pad. login(playerId, pin) -> { ok } | { error, status, triesLeft, retryAfter }.
const LAST = "cats.lastPlayer";
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function mountPin(root, players, login) {
  let stopKeys = null;
  const last = ls.get(LAST);

  function showWho() {
    if (stopKeys) { stopKeys(); stopKeys = null; }
    root.replaceChildren();
    root.append(el("h2", "who-title", "Who's playing?"));
    const row = el("div", "who-row");
    for (const p of players) {
      const b = el("button", "who-btn" + (p.id === last ? " last" : ""), p.name);
      b.type = "button";
      b.onclick = () => showPad(p);
      row.append(b);
    }
    root.append(row);
  }

  function showPad(p) {
    ls.set(LAST, p.id);
    root.replaceChildren();
    let pin = "", busy = false;
    const title = el("h2", "who-title", `Hi ${p.name}! Your secret number?`);
    const dots = el("div", "pin-dots");
    for (let i = 0; i < 4; i++) dots.append(el("i"));
    const msg = el("p", "pin-msg");
    msg.setAttribute("role", "status");
    const spin = el("div", "pin-spin"); spin.hidden = true;
    const pad = el("div", "pin-pad");
    const keys = [];
    const key = (label, cls, fn) => { const b = el("button", "pin-key " + cls, label); b.type = "button"; b.onclick = fn; keys.push(b); return b; };
    for (const d of "123456789") pad.append(key(d, "", () => press(d)));
    pad.append(key("←", "alt", () => leave()), key("0", "", () => press("0")), key("⌫", "alt", () => back()));
    const backBtn = keys[9];
    backBtn.setAttribute("aria-label", "Back"); keys[11].setAttribute("aria-label", "Delete");
    root.append(title, dots, msg, spin, pad);

    const draw = () => [...dots.children].forEach((d, i) => d.classList.toggle("on", i < pin.length));
    const setBusy = (v) => { busy = v; keys.forEach((b) => (b.disabled = v)); spin.hidden = !v; };
    const leave = () => { if (!busy) showWho(); };
    const back = () => { if (busy) return; pin = pin.slice(0, -1); draw(); };
    const press = async (d) => {
      if (busy || pin.length >= 4) return;
      pin += d; msg.textContent = ""; draw();
      if (pin.length < 4) return;
      setBusy(true);
      let r;
      try { r = await login(p.id, pin); } catch { r = { error: "network" }; }
      if (r.ok) { msg.textContent = "Welcome!"; setTimeout(() => setBusy(false), 8000); return; }
      setBusy(false);
      pin = ""; draw();
      if (r.error === "wrong") {
        msg.textContent = "Oops, try again!" + (r.triesLeft <= 2 ? ` (${r.triesLeft} ${r.triesLeft === 1 ? "try" : "tries"} left)` : "");
        dots.classList.remove("shake"); void dots.offsetWidth; dots.classList.add("shake");
      } else if (r.error === "locked") {
        const m = Math.max(1, Math.ceil((r.retryAfter || 900) / 60));
        msg.textContent = `Too many tries. Ask Dad, or wait ${m} minute${m === 1 ? "" : "s"}.`;
      } else if (r.status === 429) {
        msg.textContent = "Too many tries from here. Ask Dad, or wait a little.";
      } else {
        msg.textContent = "Can't sign in right now. Ask Dad.";
      }
    };
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === "Backspace") { e.preventDefault(); back(); }
      else if (e.key === "Escape") leave();
    };
    document.addEventListener("keydown", onKey);
    stopKeys = () => document.removeEventListener("keydown", onKey);
  }

  showWho();
}

// Dev-only stand-in for the server (?dev=1&pinui=1): 0000 works, anything else is wrong, 5 wrong locks.
export function fakeLogin() {
  let wrong = 0;
  return async (_player, pin) => {
    await new Promise((r) => setTimeout(r, 500));
    if (wrong >= 5) return { status: 429, error: "locked", retryAfter: 900 };
    if (pin === "0000") return { ok: true };
    wrong++;
    return wrong >= 5 ? { status: 429, error: "locked", retryAfter: 900 } : { status: 401, error: "wrong", triesLeft: 5 - wrong };
  };
}
