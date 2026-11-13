// "Where's my sister?": an edge pointer for each other cat that is off screen, plus a small north-up mini-map
// (north = straight ahead when the game starts, so "up" on the map is where the camera first looks).
import * as THREE from "three";
import { R, POND, BRIDGE, COTTAGE, HILL, PATHS, shoreD } from "./terrain.js";

const INK = "#3b2a4a";
const MAP = 100, MAPK = 48 / 92; // css px; px per world unit
const headSvg = (c) => `<svg viewBox="0 0 40 40" width="40" height="40"><path d="M5 5 L16 11 L24 11 L35 5 L35 22 Q35 36 20 36 Q5 36 5 22 Z" fill="${c.body}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="14" cy="21" r="3.2" fill="${c.eyes}" stroke="${INK}" stroke-width="1.5"/><circle cx="26" cy="21" r="3.2" fill="${c.eyes}" stroke="${INK}" stroke-width="1.5"/><path d="M18 27 h4 l-2 2.5 Z" fill="${c.nose}"/></svg>`;
const ARROW = `<svg class="arr" width="22" height="22" viewBox="0 0 22 22"><path d="M3 3 L19 11 L3 19 Z" fill="#ffd43b" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/></svg>`;

// Static island picture, drawn once from the real terrain numbers.
function drawIsland() {
  const S = MAP * 2, k = MAPK * 2, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d"), X = (x) => S / 2 - x * k, Z = (z) => S / 2 - z * k; // screen right = world -x, screen up = world +z
  g.fillStyle = "#8fd3f4"; g.fillRect(0, 0, S, S);
  const shore = (d) => { g.beginPath(); for (let i = 0; i <= 96; i++) { const th = (i / 96) * Math.PI * 2, f = 1 + 0.06 * Math.sin(3 * th + 1) + 0.04 * Math.sin(5 * th + 2), r = d * R / f; i ? g.lineTo(X(r * Math.cos(th)), Z(r * Math.sin(th))) : g.moveTo(X(r * Math.cos(th)), Z(r * Math.sin(th))); } g.closePath(); };
  shore(0.9); g.fillStyle = "#f6e3b4"; g.fill();
  shore(0.76); g.fillStyle = "#9bdc7a"; g.fill();
  g.beginPath(); g.arc(X(HILL.x), Z(HILL.z), 13 * k, 0, 7); g.fillStyle = "#7fc460"; g.fill();
  g.strokeStyle = "#ecd2a0"; g.lineWidth = 2.5 * k; g.lineCap = g.lineJoin = "round";
  for (const p of PATHS) { g.beginPath(); p.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.stroke(); }
  g.beginPath(); g.ellipse(X(POND.x), Z(POND.z), POND.a * k, POND.b * k, 0, 0, 7); g.fillStyle = "#6cc3ef"; g.fill();
  g.strokeStyle = "#b9824a"; g.lineWidth = 3 * k; g.lineCap = "butt"; g.beginPath(); g.moveTo(X(BRIDGE.x), Z(BRIDGE.z - BRIDGE.halfLen)); g.lineTo(X(BRIDGE.x), Z(BRIDGE.z + BRIDGE.halfLen)); g.stroke();
  const roof = (x, z, col) => { const px = X(x), pz = Z(z); g.fillStyle = "#fff"; g.fillRect(px - 5, pz - 1, 10, 7); g.strokeStyle = INK; g.lineWidth = 1.5; g.strokeRect(px - 5, pz - 1, 10, 7); g.beginPath(); g.moveTo(px - 7, pz - 1); g.lineTo(px, pz - 9); g.lineTo(px + 7, pz - 1); g.closePath(); g.fillStyle = col; g.fill(); g.stroke(); };
  roof(COTTAGE.x, COTTAGE.z, "#e8505b"); roof(HILL.x, HILL.z, "#b070e0");
  return c;
}

export function createFinder({ camera, hud }) {
  // safe-area insets, read through a hidden probe
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.append(probe);
  const inset = { t: 0, r: 0, b: 0, l: 0 };
  const readInsets = () => { const s = getComputedStyle(probe); inset.t = parseFloat(s.paddingTop) || 0; inset.r = parseFloat(s.paddingRight) || 0; inset.b = parseFloat(s.paddingBottom) || 0; inset.l = parseFloat(s.paddingLeft) || 0; };
  readInsets(); addEventListener("resize", readInsets);

  const layer = document.createElement("div"); layer.id = "finder"; hud.append(layer);
  const map = document.createElement("div"); map.id = "minimap";
  const isl = drawIsland(); isl.className = "mm-bg"; map.append(isl);
  const me = document.createElement("div"); me.className = "mm-me";
  me.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18"><path d="M9 1 L16 16 L9 12.5 L2 16 Z" fill="#ff5d8f" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/></svg>`;
  map.append(me); hud.append(map);
  const ents = new Map(); // uid -> pointer + map dot state
  const v = new THREE.Vector3();
  const info = {};        // dev: last pointer placement per uid
  let mapT = 0, mx = -1e9, mz = -1e9, mr = -1e9;
  const pos = (el, x, y, rot) => { el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)` + (rot === undefined ? "" : ` rotate(${rot.toFixed(3)}rad)`); };

  function make(uid, r) {
    const el = document.createElement("div"); el.className = "fp pulse"; el.style.setProperty("--c", r.cfg.body);
    el.innerHTML = `<div class="rot">${ARROW}</div><div class="badge">${headSvg(r.cfg)}</div><div class="lb"><b></b> <span></span></div>`;
    el.querySelector("b").textContent = r.cfg.name;
    layer.append(el);
    const dot = document.createElement("div"); dot.className = "mm-dot"; dot.style.background = r.cfg.body; map.append(dot);
    const e = { el, dot, rot: el.firstChild, lbl: el.querySelector("span"), x: 0, y: 0, ax: -1e9, ay: -1e9, ar: -1e9, shown: true, txt: "", dx: -1e9, dz: -1e9, snap: true };
    el.addEventListener("animationend", () => el.classList.remove("pulse"));
    ents.set(uid, e); return e;
  }

  return {
    info,
    // call after the camera has moved this frame
    update(now, dt, remotes, pl, W, H) {
      camera.updateMatrixWorld(); camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      const th = Math.tan(camera.fov * 0.008726646), L = 54 + inset.l, Rr = W - 54 - inset.r, T = 112 + inset.t, B = H - 170 - inset.b;
      const cx = (L + Rr) / 2, cy = (T + B) / 2, hx = (Rr - L) / 2, hy = (B - T) / 2;
      for (const [uid, e] of ents) if (!remotes.has(uid)) { e.el.remove(); e.dot.remove(); ents.delete(uid); delete info[uid]; }
      for (const [uid, r] of remotes) {
        const e = ents.get(uid) || make(uid, r);
        // distance, readable name tag: grows with distance so it never gets smaller than it is at ~9 m
        const ddx = r.x - pl.x, ddz = r.z - pl.z, d = Math.hypot(ddx, ddz);
        if (r.tag) { const s = Math.min(7, Math.max(1, d / 9)); r.tag.scale.set(1.5 * s, 0.42 * s, 1); r.tag.position.y = 2.05 + (s - 1) * 0.15; }
        v.set(r.x, r.y + 1.1, r.z).applyMatrix4(camera.matrixWorldInverse); // view space: x right, y up, looks down -z
        const front = v.z < -0.1, sx = front ? (v.x / -v.z / (th * camera.aspect) + 1) * 0.5 * W : 0, sy = front ? (1 - v.y / -v.z / th) * 0.5 * H : 0;
        const on = front && sx > 24 && sx < W - 24 && sy > 24 && sy < H - 24;
        if (e.shown === on) { e.shown = !on; e.el.hidden = on; e.snap = true; }
        let ang = 0, px = e.x, py = e.y;
        if (!on) {
          let dx = v.x, dy = -v.y; const m = Math.hypot(dx, dy);
          if (m < 1e-3) { dx = 0; dy = 1; } else { dx /= m; dy /= m; }
          const s = Math.min(hx / (Math.abs(dx) || 1e-6), hy / (Math.abs(dy) || 1e-6));
          const k = e.snap ? 1 : 1 - Math.exp(-dt * 14); // smooth slide along the rim
          e.x += (cx + dx * s - e.x) * k; e.y += (cy + dy * s - e.y) * k; e.snap = false;
          ang = Math.atan2(dy, dx);
          if (Math.abs(e.x - e.ax) > 0.4 || Math.abs(e.y - e.ay) > 0.4) { e.ax = e.x; e.ay = e.y; pos(e.el, e.x, e.y); }
          if (Math.abs(ang - e.ar) > 0.01) { e.ar = ang; e.rot.style.transform = `rotate(${ang.toFixed(3)}rad)`; }
          const t = Math.round(d) + " m"; if (t !== e.txt) { e.txt = t; e.lbl.textContent = t; }
        }
        const i = info[uid] || (info[uid] = {});
        i.on = on; i.x = e.x; i.y = e.y; i.arrowDeg = ang * 57.29578; i.dist = d; i.front = front;
        e.dx = ddx; e.dz = ddz;
      }
      if (now - mapT > 100) {
        mapT = now;
        const h = pl.rot;
        if (Math.abs(pl.x - mx) > 0.2 || Math.abs(pl.z - mz) > 0.2 || Math.abs(h - mr) > 0.03) { mx = pl.x; mz = pl.z; mr = h; me.style.transform = `translate(${(MAP / 2 - pl.x * MAPK - 9).toFixed(1)}px,${(MAP / 2 - pl.z * MAPK - 9).toFixed(1)}px) rotate(${(-h).toFixed(3)}rad)`; }
        for (const [uid, e] of ents) { const r = remotes.get(uid); if (Math.abs(r.x - e.dotx) > 0.2 || Math.abs(r.z - e.dotz) > 0.2 || e.dotx === undefined) { e.dotx = r.x; e.dotz = r.z; pos(e.dot, MAP / 2 - r.x * MAPK - 6, MAP / 2 - r.z * MAPK - 6); } }
      }
    },
  };
}
