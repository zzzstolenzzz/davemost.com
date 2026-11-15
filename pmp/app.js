import { OWNER_UID } from "./config.js";
import * as Store from "./store.js";

const app = document.getElementById("app");
let store, Q = {}, ST = {}, SESS = null, run = null;
let view = "home";

// ---------- helpers ----------
// All text goes through createTextNode / textContent, never innerHTML.
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c);
  return e;
}
function imgs(urls) { // https-only, lazy, hides itself on error
  return (Array.isArray(urls) ? urls : []).filter((u) => typeof u === "string" && u.startsWith("https://")).map((u) => {
    const note = h("p", { class: "muted small", hidden: true }, "image unavailable");
    const img = h("img", { class: "pic", src: u, loading: "lazy", alt: "" });
    img.addEventListener("error", () => { img.hidden = true; note.hidden = false; });
    return h("div", {}, img, note);
  });
}
const meta = (q) => (q.domain || q.sub) && h("p", { class: "muted small" }, [q.domain, q.sub].filter(Boolean).join(" \u00b7 "));
const show = (name, ...nodes) => { view = name; app.replaceChildren(...nodes.flat().filter(Boolean)); window.scrollTo(0, 0); };
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const LS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const LSset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const letter = (i) => String.fromCharCode(65 + i);
// Short AI summary + original explanation (collapsed when a summary exists). picked = Set of choice indexes the user chose.
function explainBody(q, picked) {
  const orig = [q.explain && h("p", { class: "etext" }, q.explain), imgs(q.eImages)];
  const a = q.ai;
  if (!a) return orig;
  const wrong = Object.keys(a.wrong || {}).sort();
  return [
    h("div", { class: "ai" },
      h("div", { class: "ai-row" }, h("span", { class: "ai-label" }, "Why"), h("span", { class: "ai-text" }, a.why)),
      wrong.length > 0 && h("div", { class: "ai-sec" }, h("p", { class: "ai-label" }, "Why not"),
        wrong.map((L) => h("div", { class: "ai-row ai-wrong" + (picked && picked.has(L.charCodeAt(0) - 65) ? " mine" : "") },
          h("span", { class: "ai-badge" }, L), h("span", { class: "ai-text" }, a.wrong[L])))),
      a.more && a.more.length > 0 && h("ul", { class: "ai-more" }, a.more.map((m) => h("li", {}, m))),
      a.tip && h("div", { class: "ai-tip" }, h("span", { class: "ai-label" }, "Remember"), h("span", { class: "ai-text" }, a.tip)),
      h("p", { class: "ai-cap" }, "AI summary")),
    h("details", { class: "orig" }, h("summary", {}, "Original explanation"), orig),
  ];
}
const topBar = (title, back = "Home") => h("header", { class: "bar" }, h("button", { class: "link", onclick: home }, "< " + back), h("h1", {}, title));

function shuffle(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// Weighted sample without replacement.
function sampleWeighted(ids, n) {
  const pool = ids.map((id) => ({ id, w: weight(id) })), out = [];
  while (out.length < n && pool.length) {
    let r = Math.random() * pool.reduce((s, p) => s + p.w, 0), i = 0;
    while (i < pool.length - 1 && (r -= pool[i].w) > 0) i++;
    out.push(pool.splice(i, 1)[0].id);
  }
  return out;
}
const weight = (id) => { const s = ST[id]; return !s || !s.seen ? 3 : s.lastRight === false ? 3 : 1; };

function hash(text) { // stable id from question text (cyrb53)
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (const ch of text.trim().toLowerCase().replace(/\s+/g, " ")) {
    const c = ch.codePointAt(0);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return "q" + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// ---------- boot / auth ----------
async function boot() {
  try { store = await Store.open(); } catch (e) { return show("err", h("p", { class: "center" }, "Could not load: " + e.message)); }
  store.watchAuth(async (user) => {
    if (!user) return signInScreen();
    if (user.uid !== OWNER_UID) return privateScreen();
    show("load", h("p", { class: "muted center" }, "Loading..."));
    try {
      [Q, ST] = await Promise.all([store.loadQuestions(), store.loadStats()]);
    } catch (e) { return show("err", h("p", { class: "center" }, "Could not load data: " + e.message), signOutBtn()); }
    home();
    store.loadSessions().then((s) => { SESS = s; if (view === "home") home(); }).catch(() => { SESS = []; });
  }, () => signInScreen());
}
const signOutBtn = () => h("button", { class: "btn ghost", onclick: () => store.signOut() }, "Sign out");
function signInScreen(msg) {
  show("signin", h("div", { class: "gate" }, h("h1", {}, "PMP Practice"), h("p", { class: "muted" }, "Private study app."),
    h("button", { class: "btn", onclick: () => store.signIn().catch((e) => { if (!/popup-closed|cancelled/.test(e.code)) signInScreen("Sign-in failed: " + e.message); }) }, "Sign in with Google"),
    msg && h("p", { class: "bad-text" }, msg)));
}
const privateScreen = () => show("private", h("div", { class: "gate" }, h("h1", {}, "Private"), h("p", { class: "muted" }, "This app is private."), signOutBtn()));

// ---------- home ----------
const MODES = { mix: "Mix", unseen: "Unseen", missed: "Missed", flagged: "Flagged" };
function poolFor(mode) {
  const ids = Object.keys(Q);
  if (mode === "unseen") return ids.filter((id) => !ST[id]?.seen);
  if (mode === "missed") return ids.filter((id) => ST[id]?.lastRight === false);
  if (mode === "flagged") return ids.filter((id) => ST[id]?.flag);
  if (mode.startsWith("d:")) return ids.filter((id) => Q[id].domain === mode.slice(2));
  return ids;
}
function recent() { // % correct over the last ~100 answers, and the 100 before, from session records (whole sessions)
  if (!SESS) return null;
  const sorted = [...SESS].sort((a, b) => b.t - a.t);
  const win = [{ n: 0, c: 0 }, { n: 0, c: 0 }];
  let w = 0;
  for (const s of sorted) {
    if (w > 1) break;
    win[w].n += s.n; win[w].c += s.correct;
    if (win[w].n >= 100) w++;
  }
  return win;
}
function home() {
  const ids = Object.keys(Q);
  if (!ids.length) {
    return show("home", h("header", { class: "bar" }, h("h1", {}, "PMP Practice"), signOutBtn()),
      h("div", { class: "card center" }, h("p", {}, "The question bank is empty."), h("button", { class: "btn", onclick: importView }, "Import questions")));
  }
  const prefs = LS("pmp_prefs", { len: 20, mode: "mix" });
  const domains = [...new Set(ids.map((id) => Q[id].domain).filter(Boolean))].sort();
  const modes = [...Object.keys(MODES), ...domains.map((d) => "d:" + d)];
  if (!modes.includes(prefs.mode)) prefs.mode = "mix";
  const r = recent();
  const cur = r && r[0].n ? pct(r[0].c, r[0].n) : null;
  const delta = r && r[0].n && r[1].n ? cur - pct(r[1].c, r[1].n) : null;
  const chips = (items, sel, on) => h("div", { class: "chips" }, items.map(([key, label, off]) =>
    h("button", { class: "chip" + (sel === key ? " on" : ""), disabled: off, "aria-pressed": String(sel === key), onclick: () => on(key) }, label)));
  const draw = () => {
    LSset("pmp_prefs", prefs);
    const avail = poolFor(prefs.mode).length;
    startBox.replaceChildren(
      h("h2", {}, "Start"),
      h("p", { class: "label" }, "Questions"),
      chips([10, 20, 50].map((n) => [n, String(n)]), prefs.len, (n) => { prefs.len = n; draw(); }),
      h("p", { class: "label" }, "Mode"),
      chips(modes.map((m) => { const c = poolFor(m).length; return [m, (MODES[m] || m.slice(2)) + " (" + c + ")", !c]; }), prefs.mode, (m) => { prefs.mode = m; draw(); }),
      h("button", { class: "btn wide", disabled: !avail, onclick: () => start(prefs.mode, prefs.len) }, "Start " + Math.min(prefs.len, avail)));
  };
  const startBox = h("section", { class: "card" });
  show("home",
    h("header", { class: "bar" }, h("h1", {}, "PMP Practice"), signOutBtn()),
    h("section", { class: "card center" },
      h("div", { class: "big" }, cur == null ? "--" : cur + "%"),
      h("p", { class: "muted" }, cur == null ? "Answer questions to see your score" : "correct, last 100 answers" + (delta == null ? "" : " (" + (delta >= 0 ? "+" : "") + delta + " vs previous 100)")),
      h("p", { class: "muted" }, ids.length + " questions in bank")),
    startBox,
    h("div", { class: "row" }, h("button", { class: "btn ghost", onclick: statsView }, "Stats"), h("button", { class: "btn ghost", onclick: importView }, "Import")));
  draw();
}

// ---------- quiz ----------
function start(mode, len, idList) {
  const ids = idList || sampleOrder(mode, len);
  if (!ids.length) return;
  run = { mode, ids, i: 0, picked: new Set(), done: false, n: 0, correct: 0, byDomain: {}, missed: [], saved: false };
  question();
}
const sampleOrder = (mode, len) => (mode === "mix" ? sampleWeighted(poolFor(mode), len) : shuffle(poolFor(mode)).slice(0, len));

function question() {
  const id = run.ids[run.i], q = Q[id], multi = q.answer.length > 1, done = run.done;
  const correctSet = new Set(q.answer);
  const submit = async () => {
    const ok = run.picked.size === correctSet.size && [...run.picked].every((i) => correctSet.has(i));
    run.done = true; run.ok = ok; run.n++;
    if (ok) run.correct++; else run.missed.push(id);
    const d = q.domain || "General", bd = (run.byDomain[d] ||= { n: 0, correct: 0 });
    bd.n++; if (ok) bd.correct++;
    const s = ST[id] || {};
    ST[id] = { seen: (s.seen || 0) + 1, right: (s.right || 0) + (ok ? 1 : 0), last: Date.now(), lastRight: ok, flag: !!s.flag };
    store.saveStat(id, ST[id]).catch((e) => alert("Could not save: " + e.message));
    question();
  };
  const pick = (i) => {
    if (run.done) return;
    if (!multi) { run.picked = new Set([i]); return submit(); }
    run.picked.has(i) ? run.picked.delete(i) : run.picked.add(i);
    question();
  };
  const choices = q.choices.map((c, i) => {
    const on = run.picked.has(i), right = correctSet.has(i);
    const cls = "choice" + (done ? (right ? " ok" : on ? " bad" : "") : on ? " sel" : "");
    return h("button", { class: cls, "aria-pressed": multi && !done ? String(on) : null, onclick: () => pick(i) },
      h("span", { class: "let" }, letter(i)), h("span", { class: "txt" }, c),
      done && (right ? h("span", { class: "mark" }, on ? "Correct" : "Correct answer") : on ? h("span", { class: "mark" }, "Wrong") : null));
  });
  const flagBtn = () => h("button", { class: "flag" + (ST[id]?.flag ? " on" : ""), "aria-pressed": String(!!ST[id]?.flag), onclick: () => {
    ST[id].flag = !ST[id].flag; store.saveStat(id, { flag: ST[id].flag }).catch(() => {}); question();
  } }, ST[id]?.flag ? "★ Flagged" : "☆ Flag for review");
  const last = run.i === run.ids.length - 1;
  show("question",
    h("header", { class: "bar" }, h("button", { class: "link", "aria-label": "Quit", onclick: quit }, "✕"),
      h("span", { class: "count" }, (run.i + 1) + " / " + run.ids.length), h("span", { class: "score" }, run.correct + " right")),
    h("div", { class: "progress" }, h("div", { style: "width:" + (100 * (run.i + (done ? 1 : 0)) / run.ids.length) + "%" })),
    h("p", { class: "qtext" }, q.q),
    imgs(q.qImages),
    multi && !done && h("p", { class: "hint" }, "Choose " + q.answer.length),
    h("div", { class: "choices" }, choices),
    multi && !done && h("button", { class: "btn wide", disabled: !run.picked.size, onclick: submit }, "Submit"),
    done && h("section", { class: "card explain" }, h("p", { class: run.ok ? "ok-text" : "bad-text" }, run.ok ? "Correct" : "Not quite"),
      meta(q), explainBody(q, run.picked), flagBtn()),
    done && h("div", { class: "sticky" }, h("button", { class: "btn wide", onclick: () => {
      if (last) return finish();
      run.i++; run.picked = new Set(); run.done = false; question();
    } }, last ? "See results" : "Next")));
}
async function saveSession() {
  if (run.saved || !run.n) return;
  run.saved = true;
  const s = { t: Date.now(), n: run.n, correct: run.correct, mode: run.mode, byDomain: run.byDomain };
  (SESS ||= []).push(s);
  try { await store.saveSession(s); } catch (e) { alert("Could not save session: " + e.message); }
}
function quit() {
  if (!confirm("Quit this session?" + (run.n ? " Your " + run.n + " answers are kept." : ""))) return;
  saveSession(); home();
}
function finish() {
  saveSession();
  const bd = Object.entries(run.byDomain);
  show("results",
    h("header", { class: "bar" }, h("h1", {}, "Results")),
    h("section", { class: "card center" }, h("div", { class: "big" }, pct(run.correct, run.n) + "%"), h("p", { class: "muted" }, run.correct + " of " + run.n + " correct")),
    bd.length > 1 || (bd.length === 1 && bd[0][0] !== "General") ? h("section", { class: "card" }, h("h2", {}, "By domain"), bars(bd.map(([d, v]) => [d, v.correct, v.n]))) : null,
    run.missed.length ? h("section", { class: "card" }, h("h2", {}, "Missed (" + run.missed.length + ")"), run.missed.map((id) => {
      const q = Q[id];
      return h("details", {}, h("summary", {}, q.q),
        meta(q), h("p", { class: "qtext small" }, q.q), imgs(q.qImages),
        h("p", {}, h("strong", {}, "Correct: "), q.answer.map((i) => letter(i) + ". " + q.choices[i]).join("\n")),
        explainBody(q, null));
    })) : h("p", { class: "center ok-text" }, "No misses. Nice."),
    h("div", { class: "row" },
      run.missed.length > 0 && h("button", { class: "btn", onclick: () => start("redo", 0, shuffle(run.missed)) }, "Redo missed"),
      h("button", { class: "btn ghost", onclick: home }, "Home")));
}
function bars(rows) { // rows: [label, right, total], weakest first
  return rows.sort((a, b) => pct(a[1], a[2]) - pct(b[1], b[2])).map(([d, c, n]) =>
    h("div", { class: "barrow" }, h("div", { class: "barlabel" }, h("span", {}, d), h("span", {}, pct(c, n) + "% (" + c + "/" + n + ")")),
      h("div", { class: "track" }, h("div", { class: "fill", style: "width:" + pct(c, n) + "%" }))));
}

// ---------- stats ----------
const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; };
function chart(sessions) {
  const W = 340, H = 190, L = 34, R = 10, T = 10, B = 22, n = sessions.length;
  const X = (i) => (n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1)), Y = (v) => T + ((100 - v) * (H - T - B)) / 100;
  const el = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "Percent correct per session" });
  for (const g of [0, 25, 50, 75, 100]) {
    el.append(svg("line", { x1: L, x2: W - R, y1: Y(g), y2: Y(g), class: g === 75 ? "target" : "grid" }), svg("text", { x: L - 5, y: Y(g) + 4, class: "tick", "text-anchor": "end" }, g));
  }
  el.append(svg("text", { x: W - R, y: Y(75) - 4, class: "tlabel", "text-anchor": "end" }, "target"));
  const vals = sessions.map((s) => pct(s.correct, s.n));
  const line = (v, cls) => n > 1 && el.append(svg("polyline", { points: v.map((y, i) => X(i) + "," + Y(y)).join(" "), class: cls }));
  line(vals, "line");
  line(vals.map((_, i) => { const w = vals.slice(Math.max(0, i - 4), i + 1); return w.reduce((a, b) => a + b, 0) / w.length; }), "avg");
  vals.forEach((v, i) => el.append(svg("circle", { cx: X(i), cy: Y(v), r: 3.5, class: "dot" })));
  return el;
}
function streak(sessions) {
  const day = (t) => { const d = new Date(t); return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 864e5 + 0.5); };
  const days = new Set(sessions.map((s) => day(s.t)));
  let d = day(Date.now()), c = 0;
  if (!days.has(d)) d--;
  while (days.has(d)) { c++; d--; }
  return c;
}
// Compact plain-text study brief for pasting into a Claude chat (token-cheap).
function studyBrief() {
  const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
  const cut = (t, n) => { t = String(t).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "..." : t; };
  const ans = (q) => q.answer.map((i) => letter(i) + ". " + cut(q.choices[i], 50)).join("; ");
  const line = (id, tail = "") => "- [" + id + "] " + cut(Q[id].q, 110) + " -> " + ans(Q[id]) + tail;
  const seenIds = Object.keys(Q).filter((id) => ST[id]?.seen);
  const right = seenIds.reduce((a, id) => a + ST[id].right, 0), answered = seenIds.reduce((a, id) => a + ST[id].seen, 0);
  const out = ["PMP STUDY BRIEF " + d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()),
    "Overall: " + pct(right, answered) + "% (" + right + "/" + answered + " answers) | bank seen: " + seenIds.length + "/" + Object.keys(Q).length];
  const last5 = [...(SESS || [])].sort((a, b) => a.t - b.t).slice(-5);
  if (last5.length) out.push("Recent sessions: " + last5.map((s) => pct(s.correct, s.n) + "%").join(", "));
  const subs = {};
  for (const id of seenIds) if (Q[id].sub) { const x = (subs[Q[id].sub] ||= { sub: Q[id].sub, dom: Q[id].domain || "General", r: 0, n: 0 }); x.r += ST[id].right; x.n += ST[id].seen; }
  const weak = Object.values(subs).filter((x) => x.n >= 3).sort((a, b) => pct(a.r, a.n) - pct(b.r, b.n) || b.n - a.n).slice(0, 8);
  if (weak.length) out.push("Weakest sub-topics (min 3 answers):", ...weak.map((x) => "- " + x.sub + " (" + x.dom + "): " + pct(x.r, x.n) + "% of " + x.n));
  const miss = seenIds.filter((id) => ST[id].seen - ST[id].right > 0)
    .sort((a, b) => (ST[b].seen - ST[b].right) - (ST[a].seen - ST[a].right) || (ST[b].lastRight === false) - (ST[a].lastRight === false)).slice(0, 12);
  if (miss.length) out.push("Keep missing:", ...miss.map((id) => line(id, " (missed " + (ST[id].seen - ST[id].right) + " of " + ST[id].seen + ")")));
  const flagged = Object.keys(Q).filter((id) => ST[id]?.flag).slice(0, 10);
  if (flagged.length) out.push("Flagged:", ...flagged.map((id) => line(id)));
  return out.join("\n");
}
function briefCard() {
  const text = studyBrief(), note = h("p", { class: "muted small" });
  const fallback = () => {
    const ta = h("textarea", { rows: "10", readonly: true, "aria-label": "Study brief" }, text);
    ta.addEventListener("focus", () => ta.select());
    note.replaceChildren("Select all and copy."); note.after(ta);
  };
  return h("section", { class: "card" }, h("h2", {}, "Study brief"),
    h("button", { class: "btn wide", onclick: () => {
      if (!navigator.clipboard) return fallback();
      navigator.clipboard.writeText(text).then(() => note.replaceChildren("Copied. Paste it into Claude."), fallback);
    } }, "Export study brief"),
    note, h("details", {}, h("summary", {}, "Preview"), h("pre", { class: "brief small" }, text)));
}
async function statsView() {
  show("stats", topBar("Stats"), h("p", { class: "muted center" }, "Loading..."));
  try { SESS = await store.loadSessions(); } catch (e) { return show("stats", topBar("Stats"), h("p", { class: "bad-text center" }, "Could not load: " + e.message)); }
  const sessions = [...SESS].sort((a, b) => a.t - b.t);
  const byDom = {};
  let answered = 0, seen = 0;
  for (const id in Q) {
    const s = ST[id]; if (!s?.seen) continue;
    answered += s.seen; seen++;
    const d = Q[id].domain; if (!d) continue;
    const x = (byDom[d] ||= [d, 0, 0]); x[1] += s.right; x[2] += s.seen;
  }
  const total = Object.keys(Q).length;
  const stat = (v, l) => h("div", { class: "stat" }, h("div", { class: "num" }, String(v)), h("div", { class: "muted" }, l));
  show("stats", topBar("Stats"), briefCard(),
    h("section", { class: "card" }, h("h2", {}, "Score per session"),
      sessions.length ? chart(sessions) : h("p", { class: "muted" }, "No sessions yet. Finish a quiz to see your trend."),
      sessions.length ? h("p", { class: "muted small" }, sessions.length === 1 ? "One session so far." : "Dots: each session. Line: average of last 5.") : null),
    Object.keys(byDom).length ? h("section", { class: "card" }, h("h2", {}, "By domain"), bars(Object.values(byDom))) : null,
    h("section", { class: "card grid3" }, stat(answered, "answered"), stat(pct(seen, total) + "%", "bank seen"), stat(streak(sessions), "day streak")));
}

// ---------- import ----------
function cleanAi(a, nChoices) {
  const str = (v) => typeof v === "string" && v.trim();
  if (!a || typeof a !== "object" || Array.isArray(a) || !str(a.why)) return null;
  const out = { why: a.why };
  if (a.wrong && typeof a.wrong === "object" && !Array.isArray(a.wrong)) {
    const w = {};
    for (const [L, t] of Object.entries(a.wrong)) if (/^[A-H]$/.test(L) && L.charCodeAt(0) - 65 < nChoices && str(t)) w[L] = t;
    if (Object.keys(w).length) out.wrong = w;
  }
  if (Array.isArray(a.more)) { const m = a.more.filter(str).slice(0, 6); if (m.length) out.more = m; }
  if (str(a.tip)) out.tip = a.tip;
  return out;
}
function validate(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return { error: "Not valid JSON: " + e.message }; }
  const wrapper = data && !Array.isArray(data) && typeof data === "object" && data.questions && typeof data.q !== "string";
  const qs = wrapper ? data.questions : data;
  const entries = Array.isArray(qs) ? qs.map((x, i) => [x && x.id, x, i + 1]) : qs && typeof qs === "object" ? Object.entries(qs).map(([k, x]) => [k, x, k]) : null;
  if (!entries) return { error: "Expected an array, an id->question object, or {questions, stats, sessions}." };
  const good = {}, errors = [], stats = {}, sessions = {};
  const isObj = (o) => o && typeof o === "object";
  const num = (v) => typeof v === "number" && isFinite(v);
  for (const [k, s] of Object.entries(wrapper && isObj(data.stats) ? data.stats : {})) {
    if (isObj(s) && num(s.seen) && num(s.right)) stats[k.replace(/[.$#[\]/]/g, "_")] = { seen: s.seen, right: s.right, last: num(s.last) ? s.last : 0, lastRight: !!s.lastRight, flag: !!s.flag };
    else if (s != null) errors.push("stats " + k + ": bad record");
  }
  for (const [k, s] of Object.entries(wrapper && isObj(data.sessions) ? data.sessions : {})) {
    if (isObj(s) && num(s.t) && num(s.n) && num(s.correct)) sessions[k.replace(/[.$#[\]/]/g, "_")] = { t: s.t, n: s.n, correct: s.correct, mode: String(s.mode || ""), byDomain: isObj(s.byDomain) ? s.byDomain : {} };
    else if (s != null) errors.push("session " + k + ": bad record");
  }
  for (const [id0, x, label] of entries) {
    const bad = (m) => errors.push("#" + label + ": " + m);
    if (!x || typeof x !== "object") { bad("not an object"); continue; }
    const ans = Array.isArray(x.answer) ? x.answer : typeof x.answer === "number" ? [x.answer] : null;
    if (typeof x.q !== "string" || !x.q.trim()) bad("empty question");
    else if (!Array.isArray(x.choices) || x.choices.length < 2 || x.choices.some((c) => typeof c !== "string")) bad("needs at least 2 text choices");
    else if (!ans || !ans.length || ans.some((a) => !Number.isInteger(a) || a < 0 || a >= x.choices.length) || new Set(ans).size !== ans.length) bad("answer index out of range");
    else if (typeof x.explain !== "string") bad("explain must be a string");
    else {
      const id = typeof id0 === "string" && id0 ? id0.replace(/[.$#[\]/]/g, "_") : hash(x.q);
      good[id] = { q: x.q, choices: x.choices, answer: ans, explain: x.explain };
      if (typeof x.domain === "string" && x.domain) good[id].domain = x.domain;
      if (typeof x.src === "string" && x.src) good[id].src = x.src;
      if (typeof x.sub === "string" && x.sub) good[id].sub = x.sub;
      const ai = cleanAi(x.ai, x.choices.length);
      if (ai) good[id].ai = ai;
      for (const f of ["qImages", "eImages"]) if (Array.isArray(x[f])) good[id][f] = x[f].filter((u) => typeof u === "string" && u.startsWith("https://"));
    }
  }
  return { good, stats, sessions, errors, valid: Object.keys(good).length, invalid: errors.length };
}
function importView() {
  let res = null;
  const ta = h("textarea", { rows: "8", placeholder: "Paste JSON here", "aria-label": "Question JSON" });
  const out = h("div", {}), msg = h("p", { class: "muted" });
  const merge = h("button", { class: "btn wide", disabled: true, onclick: async () => {
    merge.disabled = true; msg.textContent = "Writing...";
    try {
      await store.mergeQuestions(res.good); Object.assign(Q, res.good);
      const fresh = Object.fromEntries(Object.entries(res.stats).filter(([id]) => !ST[id])); // never overwrite live history
      if (Object.keys(fresh).length) { await store.mergeStats(fresh); Object.assign(ST, fresh); }
      if (Object.keys(res.sessions).length) { await store.mergeSessions(res.sessions); SESS = null; store.loadSessions().then((s) => { SESS = s; }); }
      msg.textContent = "Merged " + res.valid + " questions, " + Object.keys(fresh).length + " new history records, " + Object.keys(res.sessions).length + " sessions. Bank now has " + Object.keys(Q).length + ".";
    } catch (e) { msg.textContent = "Failed: " + e.message; merge.disabled = false; }
  } }, "Merge into bank");
  const check = () => {
    msg.textContent = ""; res = ta.value.trim() ? validate(ta.value) : null;
    out.replaceChildren();
    if (res?.error) out.append(h("p", { class: "bad-text" }, res.error));
    else if (res) out.append(h("p", {}, h("strong", {}, res.valid + " valid, " + res.invalid + " invalid")), (Object.keys(res.stats).length || Object.keys(res.sessions).length) && h("p", {}, res.valid + " questions, " + Object.keys(res.stats).length + " history records, " + Object.keys(res.sessions).length + " past sessions"), ...res.errors.slice(0, 5).map((e) => h("p", { class: "bad-text small" }, e)));
    merge.disabled = !(res && res.valid);
  };
  ta.addEventListener("input", check);
  const file = h("input", { type: "file", accept: ".json,application/json", "aria-label": "Choose a JSON file", onchange: async () => { if (file.files[0]) { ta.value = await file.files[0].text(); check(); } } });
  const word = h("input", { type: "text", placeholder: "Type DELETE", autocomplete: "off", "aria-label": "Type DELETE to confirm" });
  const del = h("button", { class: "btn danger wide", disabled: true, onclick: async () => {
    try { await store.deleteBank(); Q = {}; home(); } catch (e) { alert("Failed: " + e.message); }
  } }, "Delete entire bank");
  word.addEventListener("input", () => { del.disabled = word.value !== "DELETE"; });
  show("import", topBar("Import"),
    h("section", { class: "card" }, h("p", { class: "label" }, "JSON file"), file, h("p", { class: "label" }, "Or paste"), ta, out, merge, msg),
    h("section", { class: "card" }, h("h2", {}, "Delete bank"), h("p", { class: "muted" }, "Removes all questions. Your stats are kept."), word, del));
}

boot();
