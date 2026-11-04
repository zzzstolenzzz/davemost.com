import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, onValue, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig, PLAYERS } from "./config.js";

const SVGNS = "http://www.w3.org/2000/svg";
const PIECE_FILES = {
  w: { k: "blue-king", q: "blue-queen", b: "blue-bishop", n: "blue-knight", r: "blue-rook", p: "blue-pawn" },
  b: { k: "red-king", q: "red-queen", b: "red-bishop", n: "red-knight", r: "red-rook", p: "red-pawn" },
};
const PEN = "#2a3350";
const CHESS_MOVE_URL = "https://davemost.davemost.workers.dev/chess-move";
const CHESS_SUBSCRIBE_URL = "https://davemost.davemost.workers.dev/chess-subscribe";
const VAPID_PUBLIC = "BIii2uZwe9GuDRfbcUsFKmcXkDY36fV1PKMqxbzmn3InwAxnBeX9_nUXM-VQ3GPr6iorI0cwCTihAjuh7H2s5Fs"; // public key, not a secret
const $ = (id) => document.getElementById(id);
const opp = (c) => (c === "w" ? "b" : "w");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

// ---------- tiny helpers ----------

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage may be blocked */ } },
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (v) => v.toFixed(1);

// A slightly shaky pen line: jittered midpoints joined by quadratic curves
function wobblyLine(x1, y1, x2, y2, rng, jit = 2.2) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const n = Math.max(2, Math.round(len / 45));
  const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
  const at = (t, amount) => {
    const off = (rng() - 0.5) * 2 * amount;
    return `${f(x1 + (x2 - x1) * t + nx * off)},${f(y1 + (y2 - y1) * t + ny * off)}`;
  };
  let d = `M${at(0, jit)}`;
  for (let i = 1; i <= n; i++) d += `Q${at((i - 0.5) / n, jit * 1.6)} ${at(i / n, jit)}`;
  return d;
}

// Catmull-Rom points -> smooth cubic bezier path
function smoothPath(pts, closed) {
  const n = pts.length;
  const p = (i) => (closed ? pts[(i + n) % n] : pts[Math.min(n - 1, Math.max(0, i))]);
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return d + (closed ? "Z" : "");
}

// A hand-drawn circle that overshoots a little instead of closing perfectly
function wobblyCircle(cx, cy, r, rng) {
  const n = 12, start = rng() * Math.PI * 2, pts = [];
  for (let i = 0; i <= n; i++) {
    const a = start + (i / n) * Math.PI * 2 * 1.07;
    const rr = r * (1 + (rng() - 0.5) * 0.14);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return smoothPath(pts, false);
}

// ---------- sound (synthesized) ----------

let actx = null;
let muted = store.get("dc-muted") === "1";

const UNLOCK_EVENTS = ["pointerdown", "touchend", "click"];
let primed = false;

function unlockAudio() {
  // iPhone: play through the silent (ringer) switch (Safari 16.4+).
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) actx = new AC();
  }
  if (!actx) return;
  if (actx.state === "suspended") actx.resume();
  if (!primed) {
    // Classic iOS unlock: play one silent sample inside the gesture.
    primed = true;
    const src = actx.createBufferSource();
    src.buffer = actx.createBuffer(1, 1, actx.sampleRate);
    src.connect(actx.destination);
    src.start(0);
  }
  if (actx.state === "running") {
    UNLOCK_EVENTS.forEach((ev) => document.removeEventListener(ev, unlockAudio, true));
  }
}

function tone({ type = "sine", from, to = from, dur = 0.1, vol = 0.25, delay = 0, lowpass = 0, vibrato = false }) {
  if (!actx || muted) return;
  if (actx.state === "suspended") actx.resume();
  const t = actx.currentTime + delay;
  const osc = actx.createOscillator(), gain = actx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  if (lowpass) {
    const lp = actx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = lowpass;
    osc.connect(lp).connect(gain);
  } else {
    osc.connect(gain);
  }
  gain.connect(actx.destination);
  if (vibrato) {
    const lfo = actx.createOscillator(), depth = actx.createGain();
    lfo.frequency.value = 7;
    depth.gain.value = from * 0.03;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur);
  }
  osc.start(t);
  osc.stop(t + dur);
}

function noise(dur, vol, delay = 0) {
  if (!actx || muted) return;
  if (actx.state === "suspended") actx.resume();
  const buf = actx.createBuffer(1, Math.ceil(actx.sampleRate * dur), actx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = actx.createBufferSource(), gain = actx.createGain();
  const t = actx.currentTime + delay;
  src.buffer = buf;
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(gain).connect(actx.destination);
  src.start(t);
}

const sounds = {
  boing: () => tone({ from: 300, to: 700, dur: 0.12 }),
  plop: () => tone({ type: "triangle", from: 220, to: 140, dur: 0.1, vol: 0.35 }),
  bwaap() {
    tone({ type: "sawtooth", from: 500, to: 80, dur: 0.4, vol: 0.3, lowpass: 900 });
    noise(0.12, 0.2);
  },
  uhoh() {
    tone({ type: "square", from: 600, dur: 0.14, vol: 0.12 });
    tone({ type: "square", from: 450, dur: 0.22, vol: 0.12, delay: 0.17 });
  },
  mate() {
    noise(0.3, 0.35);
    [392, 370, 349].forEach((hz, i) => tone({ type: "sawtooth", from: hz, dur: 0.38, vol: 0.2, delay: 0.3 + i * 0.4, vibrato: true, lowpass: 1200 }));
    tone({ type: "sawtooth", from: 330, to: 300, dur: 1.1, vol: 0.2, delay: 1.5, vibrato: true, lowpass: 1200 });
  },
};

function setMuted(value) {
  muted = value;
  store.set("dc-muted", muted ? "1" : "0");
  $("mute").textContent = muted ? "🔇" : "🔊";
}

// ---------- pieces ----------

const svgCache = {};

async function loadPieces() {
  const names = Object.values(PIECE_FILES).flatMap((set) => Object.values(set));
  await Promise.all(names.map(async (name) => {
    const res = await fetch(`pieces/${name}.svg`);
    if (!res.ok) throw new Error(`Missing pieces/${name}.svg`);
    svgCache[name] = await res.text();
  }));
}

// Inline the SVG (so currentColor and .eyes work) and wrap it in the wobble filter
function makePieceSvg(color, type) {
  const tpl = document.createElement("template");
  tpl.innerHTML = svgCache[PIECE_FILES[color][type]].trim();
  const svg = tpl.content.querySelector("svg");
  const g = document.createElementNS(SVGNS, "g");
  g.setAttribute("filter", "url(#wobble)");
  while (svg.firstChild) g.appendChild(svg.firstChild);
  svg.appendChild(g);
  return svg;
}

// ---------- game state ----------

let db, auth, gameRef;
let game = new Chess();
let mySide = null, flipped = false, moveCount = 0, synced = false, exists = false, serverVal = null, user = null;
let selected = null, targets = [], lastMove = null;
let replaying = false, replayTimers = [];
const pieceEls = new Map(); // square -> .piece element

const piecesLayer = document.querySelector(".pieces");
const fxLayer = document.querySelector(".fx");
const boardEl = $("board");
let underG, overG;

const initialState = () => ({ fen: new Chess().fen(), last: null, moveCount: 0, prevFen: null, prevLast: null, updated: serverTimestamp() });

function packMove(m) {
  const out = { from: m.from, to: m.to, san: m.san, flags: m.flags, piece: m.piece, color: m.color };
  if (m.captured) out.captured = m.captured;
  if (m.promotion) out.promotion = m.promotion;
  return out;
}

function squareToCR(sq) {
  const file = sq.charCodeAt(0) - 97, rank = Number(sq[1]) - 1;
  return flipped ? [7 - file, rank] : [file, 7 - rank];
}

function crToSquare(col, row) {
  const file = flipped ? 7 - col : col, rank = flipped ? row : 7 - row;
  return "abcdefgh"[file] + (rank + 1);
}

function findKing(color) {
  for (const row of game.board()) for (const p of row) if (p && p.type === "k" && p.color === color) return p.square;
  return null;
}

// ---------- board drawing ----------

function buildBoard() {
  const rng = mulberry32(20240607);
  let grid = "", hatch = "", border = "";
  for (let i = 0; i <= 8; i++) {
    for (let pass = 0; pass < 2; pass++) {
      grid += wobblyLine(i * 100, 0, i * 100, 800, rng) + wobblyLine(0, i * 100, 800, i * 100, rng);
    }
  }
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if ((row + col) % 2 === 0) continue;
      const x0 = col * 100 + 6, y0 = row * 100 + 6, x1 = x0 + 88, y1 = y0 + 88;
      for (let c = x0 + y0 + 13; c < x1 + y1; c += 13) { // lines where x + y = c
        const xa = Math.max(x0, c - y1), xb = Math.min(x1, c - y0);
        hatch += wobblyLine(xa, c - xa, xb, c - xb, rng, 1.2);
      }
    }
  }
  for (const o of [-4, 4]) {
    border += wobblyLine(o, o, 800 - o, o, rng, 3) + wobblyLine(800 - o, o, 800 - o, 800 - o, rng, 3)
      + wobblyLine(800 - o, 800 - o, o, 800 - o, rng, 3) + wobblyLine(o, 800 - o, o, o, rng, 3);
  }
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 800 800");
  svg.innerHTML = `
    <rect width="800" height="800" fill="rgba(253,251,243,.85)"/>
    <path d="${hatch}" fill="none" stroke="#7b8aa8" stroke-opacity=".55" stroke-width="2.4" stroke-linecap="round"/>
    <g id="under"></g>
    <path d="${grid}" fill="none" stroke="${PEN}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="${border}" fill="none" stroke="${PEN}" stroke-width="5" stroke-linecap="round"/>`;
  boardEl.prepend(svg);
  underG = svg.querySelector("#under");

  const over = document.createElementNS(SVGNS, "svg");
  over.setAttribute("viewBox", "0 0 800 800");
  over.setAttribute("class", "over");
  over.innerHTML = `<g id="over"></g>`;
  boardEl.appendChild(over);
  overG = over.querySelector("#over");
}

// Yellow highlighter scribble filling one square
function highlighter(sq, alpha) {
  const [col, row] = squareToCR(sq);
  const rng = mulberry32((sq.charCodeAt(0) * 8 + Number(sq[1])) * 97);
  let d = "";
  for (let i = 0; i < 5; i++) {
    const y = row * 100 + 14 + i * 18;
    d += wobblyLine(col * 100 + 12, y, col * 100 + 88, y + (i % 2 ? -5 : 5), rng, 3);
  }
  return `<path d="${d}" fill="none" stroke="rgba(255,225,0,${alpha})" stroke-width="20" stroke-linecap="round"/>`;
}

function refreshMarks() {
  let under = "", over = "";
  if (lastMove) under += highlighter(lastMove.from, 0.2) + highlighter(lastMove.to, 0.2);
  if (selected) under += highlighter(selected, 0.45);
  const rng = mulberry32(99);
  for (const sq of new Set(targets.map((m) => m.to))) {
    const [col, row] = squareToCR(sq);
    const isCapture = targets.some((m) => m.to === sq && m.captured);
    const ink = `var(--ink-${mySide})`;
    over += isCapture
      ? `<path d="${wobblyCircle(col * 100 + 50, row * 100 + 50, 42, rng)}" fill="none" style="stroke:${ink}" stroke-width="6" stroke-linecap="round"/>`
      : `<path d="${wobblyCircle(col * 100 + 50, row * 100 + 50, 11, rng)}" style="stroke:${ink};fill:${ink}" fill-opacity=".6" stroke-width="5" stroke-linecap="round"/>`;
  }
  underG.innerHTML = under;
  overG.innerHTML = over;

  const checkSq = game.isCheck() ? findKing(game.turn()) : null;
  for (const [sq, el] of pieceEls) {
    el.classList.toggle("selected", sq === selected);
    const inCheck = sq === checkSq;
    el.classList.toggle("in-check", inCheck);
    const sweat = el.querySelector(".sweat");
    if (inCheck && !sweat) el.querySelector(".piece-inner").appendChild(makeSweat());
    else if (!inCheck && sweat) sweat.remove();
  }
}

function makeSweat() {
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("class", "sweat");
  const drop = (cls, x, y) => `<path class="${cls}" d="M${x} ${y - 5}Q${x + 4} ${y + 1} ${x} ${y + 4}Q${x - 4} ${y + 1} ${x} ${y - 5}Z"/>`;
  svg.innerHTML = drop("d1", 24, 22) + drop("d2", 78, 16) + drop("d3", 84, 38);
  return svg;
}

// ---------- piece layer ----------

function createPiece(color, type) {
  const el = document.createElement("div");
  el.className = `piece ${color}`;
  el.dataset.key = color + type;
  el.style.setProperty("--blink-delay", `-${(Math.random() * 5).toFixed(2)}s`);
  el.style.setProperty("--blink-dur", `${(4 + Math.random() * 3).toFixed(1)}s`);
  const inner = document.createElement("div");
  inner.className = "piece-inner";
  inner.appendChild(makePieceSvg(color, type));
  el.appendChild(inner);
  return el;
}

function place(el, sq) {
  const [col, row] = squareToCR(sq);
  el.style.transform = `translate(${col * 100}%,${row * 100}%)`;
}

// Make the piece elements match the game position
function reconcile() {
  const want = new Map();
  for (const row of game.board()) for (const p of row) if (p) want.set(p.square, p.color + p.type);
  for (const [sq, el] of pieceEls) {
    if (want.get(sq) !== el.dataset.key) { el.remove(); pieceEls.delete(sq); }
  }
  for (const [sq, key] of want) {
    let el = pieceEls.get(sq);
    if (!el) {
      el = createPiece(key[0], key[1]);
      piecesLayer.appendChild(el);
      pieceEls.set(sq, el);
    }
    place(el, sq);
  }
  refreshMarks();
}

function slide(from, to) {
  const el = pieceEls.get(from);
  if (!el) return;
  pieceEls.delete(from);
  pieceEls.set(to, el);
  el.style.zIndex = 1;
  setTimeout(() => { el.style.zIndex = ""; }, 400);
  place(el, to);
}

function scribbleSvg(color) {
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("class", "scribble");
  svg.style.color = `var(--ink-${color})`;
  let d = "";
  for (let y = 16, i = 0; y < 90; y += 11, i++) {
    d += `${d ? "L" : "M"}${f((i % 2 ? 82 : 18) + Math.random() * 6)},${f(y + Math.random() * 4)}`;
  }
  svg.innerHTML = `<path pathLength="1" d="${d}"/>`;
  return svg;
}

// Captured piece: scribble it out, then it tumbles away
function sendTumbling(el, capturer) {
  fxLayer.appendChild(el);
  const inner = el.querySelector(".piece-inner");
  inner.appendChild(scribbleSvg(capturer));
  inner.classList.add("scribbling");
  setTimeout(() => {
    inner.style.setProperty("--dx", `${(Math.random() < 0.5 ? -1 : 1) * (80 + Math.random() * 120)}%`);
    inner.style.setProperty("--dy", `${250 + Math.random() * 150}%`);
    inner.classList.add("tumbling");
  }, 350);
  setTimeout(() => el.remove(), 1350);
}

function animateMove(m) {
  if (m.captured) {
    const capSq = m.flags.includes("e") ? m.to[0] + m.from[1] : m.to;
    const victim = pieceEls.get(capSq);
    if (victim) { pieceEls.delete(capSq); sendTumbling(victim, m.color); }
  }
  slide(m.from, m.to);
  if (m.flags.includes("k")) slide(`h${m.from[1]}`, `f${m.from[1]}`);
  if (m.flags.includes("q")) slide(`a${m.from[1]}`, `d${m.from[1]}`);
  refreshMarks();
  refreshStatus();
  setTimeout(reconcile, 400); // settles promotions and anything out of sync
}

// ---------- status, sounds, splat ----------

function refreshStatus() {
  const turn = game.turn();
  let text;
  if (!exists) text = "Waiting for the first game to start";
  else if (game.isCheckmate()) text = `Checkmate — ${PLAYERS[opp(turn)].name} wins!`;
  else if (game.isStalemate()) text = "Stalemate — nobody wins!";
  else if (game.isDraw()) text = "Draw!";
  else {
    if (!mySide) text = `${PLAYERS[turn].name}'s turn`;
    else text = turn === mySide ? `Your move, ${PLAYERS[mySide].name}!` : `Waiting for ${PLAYERS[turn].name}…`;
    if (game.isCheck()) text += " — Check!";
  }
  $("status").textContent = text;
}

function announce(m) {
  if (game.isCheckmate()) {
    sounds.mate();
    showSplat(opp(game.turn()), true);
  } else {
    (m.captured ? sounds.bwaap : sounds.plop)();
    if (game.isCheck()) setTimeout(sounds.uhoh, 300);
  }
}

function showSplat(winner, burst) {
  const rng = mulberry32((Math.random() * 4294967296) >>> 0);
  const n = 18, pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = i % 5 === 2 ? 165 + rng() * 25 : 100 + rng() * 45; // every fifth point is a spike
    pts.push([200 + Math.cos(a) * r, 200 + Math.sin(a) * r]);
  }
  let drops = "";
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2, dist = 170 + rng() * 70;
    drops += `<circle class="splat-drop" cx="200" cy="200" r="${f(4 + rng() * 9)}" style="--dx:${f(Math.cos(a) * dist)}px;--dy:${f(Math.sin(a) * dist)}px;animation-delay:${f(0.15 + rng() * 0.15)}s"/>`;
  }
  const box = $("splat");
  box.style.setProperty("--splat-ink", `var(--ink-${winner})`);
  box.innerHTML = `<svg viewBox="0 0 400 400"><path class="splat-blob" d="${smoothPath(pts, true)}"/>${drops}</svg>
    <p class="splat-text">Checkmate!</p><p class="splat-sub"></p>${mySide ? '<button type="button" id="splat-new">New game</button>' : ""}`;
  box.querySelector(".splat-sub").textContent = `${PLAYERS[winner].name} wins!`;
  box.classList.toggle("still", !burst);
  box.hidden = false;
}

// ---------- interaction ----------

function select(sq) {
  selected = sq;
  targets = sq ? game.moves({ square: sq, verbose: true }) : [];
  refreshMarks();
}

function onSquare(sq) {
  if (replaying) return;
  if (game.isGameOver() || game.turn() !== mySide) return;
  const hits = targets.filter((m) => m.to === sq);
  if (hits.length) {
    if (hits[0].promotion) askPromotion(selected, sq);
    else makeMove(selected, sq);
    return;
  }
  const piece = game.get(sq);
  if (piece && piece.color === mySide && sq !== selected) {
    select(sq);
    sounds.boing();
  } else {
    select(null);
  }
}

function askPromotion(from, to) {
  const promo = $("promo");
  const box = document.createElement("div");
  box.className = "promo-box";
  for (const type of "qrbn") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.style.color = `var(--ink-${mySide})`;
    btn.appendChild(makePieceSvg(mySide, type));
    btn.addEventListener("click", () => { promo.hidden = true; makeMove(from, to, type); });
    box.appendChild(btn);
  }
  promo.replaceChildren(box);
  promo.hidden = false;
}

function makeMove(from, to, promotion) {
  const fromFen = game.fen();
  let m;
  try { m = game.move({ from, to, promotion }); } catch { return; }
  const toFen = game.fen();
  moveCount++;
  lastMove = m;
  selected = null;
  targets = [];
  animateMove(m);
  announce(m);
  runTransaction(gameRef, (cur) => {
    if (cur === null) return null; // retry with the server's data
    if (cur.fen !== fromFen) return undefined; // someone else moved first: abort
    return { fen: toFen, last: packMove(m), moveCount: cur.moveCount + 1, prevFen: fromFen, prevLast: cur.last ?? null, updated: serverTimestamp() };
  }).then((res) => {
    if (!res.committed) fullRender(res.snapshot.val());
    else fetch(CHESS_MOVE_URL, { method: "POST" }).catch(() => {});
  }).catch((err) => {
    if (/permission_denied/i.test(`${err.code} ${err.message}`)) {
      fullRender(serverVal);
      $("status").textContent = "That move wasn't allowed.";
    } else {
      $("status").textContent = "Couldn't save that move. Check your connection.";
    }
  });
}

// ---------- syncing ----------

function fullRender(val) {
  if (!val) return;
  game.load(val.fen);
  moveCount = val.moveCount;
  lastMove = val.last || null;
  selected = null;
  targets = [];
  reconcile();
  refreshStatus();
  if (game.isCheckmate()) showSplat(opp(game.turn()), false);
  else $("splat").hidden = true;
}

function onSnapshot(val) {
  serverVal = val;
  exists = !!val;
  refreshUndo();
  if (replaying) { stopReplay(); synced = false; } // a real update always wins: fall through to a full render
  if (!val) { resetBoard(); reconcile(); refreshStatus(); return; }
  if (!synced) { synced = true; fullRender(val); return; }
  if (val.fen === game.fen()) { moveCount = val.moveCount; refreshStatus(); return; }
  if (val.moveCount === moveCount + 1 && val.last) {
    game.load(val.fen);
    moveCount = val.moveCount;
    lastMove = val.last;
    selected = null;
    targets = [];
    animateMove(val.last);
    announce(val.last);
  } else {
    fullRender(val);
  }
}

function canUndo() {
  return !!(mySide && serverVal && serverVal.last?.color === mySide && typeof serverVal.prevFen === "string");
}

function refreshUndo() {
  $("undo").disabled = !canUndo();
  $("replay").disabled = replaying || !(serverVal?.last && typeof serverVal.prevFen === "string");
}

function stopReplay() {
  replayTimers.forEach(clearTimeout);
  replayTimers = [];
  replaying = false;
  refreshUndo();
}

// Abort a replay and put the board back to the real position.
function cancelReplay() {
  if (!replaying) return;
  stopReplay();
  fullRender(serverVal);
}

// Re-animate the last move locally. Nothing is written to Firebase.
function replay() {
  if (replaying || $("replay").disabled) return;
  const v = serverVal;
  replaying = true;
  selected = null;
  targets = [];
  refreshUndo();
  game.load(v.prevFen);
  lastMove = v.prevLast || null;
  reconcile();
  replayTimers.push(setTimeout(() => {
    game.load(v.fen);
    lastMove = v.last;
    animateMove(v.last);
    (v.last.captured ? sounds.bwaap : sounds.plop)();
    replayTimers.push(setTimeout(() => {
      stopReplay();
      refreshStatus();
    }, 450));
  }, 450));
}

// Take back my own last move, as long as the opponent hasn't replied. The snapshot drives the re-render.
function undo() {
  if (!canUndo()) return;
  cancelReplay();
  runTransaction(gameRef, (cur) => {
    if (cur === null) return null; // retry with the server's data
    if (cur.last?.color !== mySide || typeof cur.prevFen !== "string") return undefined; // too late: abort
    return { fen: cur.prevFen, last: cur.prevLast ?? null, moveCount: cur.moveCount - 1, prevFen: null, prevLast: null, updated: serverTimestamp() };
  }).then((res) => {
    if (res.committed) sounds.plop();
  }).catch((err) => {
    if (/permission_denied/i.test(`${err.code} ${err.message}`)) $("status").textContent = "Couldn't undo that.";
  });
}

function newGame() {
  if (!mySide || !confirm("Start a new game? The current one will be wiped.")) return;
  cancelReplay();
  runTransaction(gameRef, () => initialState()).catch(() => {});
}

// ---------- move alerts (Web Push) ----------

const swReady = "serviceWorker" in navigator ? navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready).catch(() => null) : Promise.resolve(null);

async function refreshAlerts() {
  let on = false;
  try { on = !!(await (await swReady)?.pushManager.getSubscription()); } catch { /* label stays off */ }
  $("alerts").textContent = on ? "🔔 On" : "🔔 Alerts";
}

async function enableAlerts() {
  const standalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  if (!("PushManager" in window) || !standalone && /iPad|iPhone|iPod/.test(navigator.userAgent) || !("Notification" in window)) {
    $("alerts-help").hidden = false;
    return;
  }
  const perm = await Notification.requestPermission(); // first await: must stay inside the tap for iOS
  if (perm !== "granted") {
    if (perm === "denied") $("status").textContent = "Notifications are blocked — allow them in Settings.";
    return;
  }
  try {
    const reg = await swReady;
    const key = Uint8Array.from(atob(VAPID_PUBLIC.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const res = await fetch(CHESS_SUBSCRIBE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: await user.getIdToken(), subscription: sub.toJSON() }),
    });
    if (!res.ok) throw new Error(res.status);
    $("alerts").textContent = "🔔 On";
  } catch {
    $("status").textContent = "Couldn't turn on alerts.";
  }
}

// ---------- screens and sign-in ----------

function show(screen) {
  $("setup").hidden = screen !== "setup";
  $("play").hidden = screen !== "play";
  $("footer").hidden = screen !== "play";
}

function renderAuthUi() {
  $("signin").hidden = !!user;
  $("signout").hidden = !user;
  $("new-game").hidden = !mySide;
  $("undo").hidden = !mySide;
  $("alerts").hidden = !mySide;
  if (mySide) refreshAlerts();
  refreshUndo();
  $("watching").hidden = !!mySide;
  $("spectator").hidden = !user || !!mySide;
  $("my-uid").textContent = user ? user.uid : "";
}

function applyAuth(u) {
  user = u;
  const uid = u ? u.uid : null;
  mySide = uid && uid === PLAYERS.w.uid ? "w" : uid && uid === PLAYERS.b.uid ? "b" : null;
  flipped = mySide === "b";
  selected = null;
  targets = [];
  $("promo").hidden = true;
  renderAuthUi();
  reconcile();
  refreshStatus();
  if (mySide) runTransaction(gameRef, (cur) => cur ?? initialState()).catch(() => {});
}

function resetBoard() {
  game = new Chess();
  moveCount = 0;
  synced = false;
  lastMove = null;
  selected = null;
  targets = [];
  for (const el of pieceEls.values()) el.remove();
  pieceEls.clear();
  fxLayer.replaceChildren();
  $("splat").hidden = true;
  $("promo").hidden = true;
}

// ---------- idle fidgets ----------

function fidget() {
  if (!synced || reduceMotion.matches) return;
  const waiting = [...pieceEls.values()].filter((el) =>
    el.classList.contains(opp(game.turn())) && !el.classList.contains("selected") && !el.classList.contains("in-check"));
  if (!waiting.length) return;
  const inner = waiting[Math.floor(Math.random() * waiting.length)].querySelector(".piece-inner");
  const cls = ["fid-hop", "fid-tilt", "fid-wiggle"][Math.floor(Math.random() * 3)];
  inner.classList.add(cls);
  setTimeout(() => inner.classList.remove(cls), 800);
}

// ---------- start up ----------

function wireUi() {
  UNLOCK_EVENTS.forEach((ev) => document.addEventListener(ev, unlockAudio, true));
  $("mute").addEventListener("click", () => setMuted(!muted));
  $("signin").addEventListener("click", () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    signInWithPopup(auth, provider).catch((err) => {
      if (err.code !== "auth/popup-closed-by-user" && err.code !== "auth/cancelled-popup-request") {
        $("status").textContent = `Couldn't sign in: ${err.message}`;
      }
    });
  });
  $("signout").addEventListener("click", () => signOut(auth));
  $("copy-uid").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("my-uid").textContent);
      $("copy-uid").textContent = "Copied!";
    } catch {
      $("copy-uid").textContent = "Select it and copy";
    }
  });
  $("new-game").addEventListener("click", newGame);
  $("undo").addEventListener("click", undo);
  $("replay").addEventListener("click", replay);
  $("alerts").addEventListener("click", enableAlerts);
  $("alerts-ok").addEventListener("click", () => { $("alerts-help").hidden = true; });
  $("promo").addEventListener("click", (e) => { if (e.target === $("promo")) $("promo").hidden = true; });
  $("splat").addEventListener("click", (e) => {
    if (e.target.id === "splat-new") newGame();
    else $("splat").hidden = true;
  });
  boardEl.addEventListener("pointerdown", (e) => {
    if (!mySide || !$("splat").hidden || !$("promo").hidden) return;
    const r = boardEl.getBoundingClientRect();
    const col = Math.floor(((e.clientX - r.left) / r.width) * 8);
    const row = Math.floor(((e.clientY - r.top) / r.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return;
    onSquare(crToSquare(col, row));
  });
  setMuted(muted);
}

async function start() {
  wireUi();
  buildBoard();
  if (Object.values(firebaseConfig).some((v) => String(v).includes("PASTE_ME"))) {
    show("setup");
    return;
  }
  try {
    await loadPieces();
  } catch (err) {
    show("setup");
    $("setup").innerHTML = `<h2>Oops</h2><p>Couldn't load the piece drawings (${err.message}). Serve this folder over http, not file://.</p>`;
    return;
  }
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  onValue(ref(db, ".info/connected"), (snap) => { $("offline").hidden = snap.val() === true; });
  setInterval(fidget, 2000);

  gameRef = ref(db, "game");
  show("play");
  $("status").textContent = "Loading…";
  onValue(gameRef, (snap) => onSnapshot(snap.val()));
  auth = getAuth(app);
  onAuthStateChanged(auth, applyAuth);
}

start();
