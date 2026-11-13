// Fancy accessories (rare / epic / legendary extras). Same recipe as accessories.js: each builder returns a Group in the
// slot mount's space, mostly ONE merged vertex-coloured toon mesh + one outline hull. Epic and legendary pieces add a cheap
// animated flourish (one Points draw call of sparkle motes, a flapping wing, a spinning prop, a flame). Flourishes are
// skipped on the Low quality tier (fancy.on = false). userData.update(t, speed01) animates; nothing allocates per frame.
import * as THREE from "three";
import { toon, bake, bakedMesh, mat4, ramp } from "./toon.js";

export const fancy = { on: true };
const mat = toon("#ffffff", { vertexColors: true, rim: 0.35 });
const matDS = toon("#ffffff", { vertexColors: true, rim: 0.35, side: THREE.DoubleSide });
const matTrans = toon("#ffffff", { vertexColors: true, transparent: true, opacity: 0.6, rim: 0, side: THREE.DoubleSide });
const wingMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp, transparent: true, opacity: 0.82, side: THREE.DoubleSide });
const O = 0.012;
const ring = (n, fn) => Array.from({ length: n }, (_, i) => fn(i, (i / n) * Math.PI * 2));
const sph = (r) => new THREE.SphereGeometry(r, 14, 10);
const tor = (R, r, a = 6, b = 24, arc) => new THREE.TorusGeometry(R, r, a, b, arc);
const group = (parts, m = mat) => { const g = new THREE.Group(); g.add(bakedMesh(bake(parts), m)); return g; };
const pt = (g, c, p, o = O, extra = {}) => ({ g, c, p, ol: o, ...extra });
const temple = (c, sx, y = 0.01) => ({ g: new THREE.CylinderGeometry(0.008, 0.008, 0.3, 5), c, p: [sx * 0.3, y, -0.07], r: [Math.PI / 2, 0, 0] });
const lathe = (pts, seg = 28) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const bend = (geo, fn) => { const p = geo.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v); p.setXYZ(i, v.x, v.y, v.z); } geo.computeVertexNormals(); return geo; };
const onUpdate = (g, fn) => { const prev = g.userData.update; g.userData.update = prev ? (t, k) => { prev(t, k); fn(t, k); } : fn; };
const glowTex = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const x = c.getContext("2d"), r = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, "#fff"); r.addColorStop(0.35, "rgba(255,255,255,.6)"); r.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = r; x.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const haloMat = new THREE.MeshBasicMaterial({ color: 0xffd23a });
const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd44a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
const flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a2e, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
const flameMat2 = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });

// n sparkles drifting around a point: ONE Points draw call, positions rewritten in a fixed array.
function motes(g, n, rad, h, colors, size = 0.07, y0 = 0, z0 = 0) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), c = new THREE.Color();
  for (let i = 0; i < n; i++) { c.set(colors[i % colors.length]); col.set([c.r, c.g, c.b], i * 3); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(geo, m); pts.frustumCulled = false; g.add(pts);
  onUpdate(g, (t) => {
    pts.visible = fancy.on; if (!fancy.on) return;
    for (let i = 0; i < n; i++) {
      const a = t * 0.9 + i * 2.4, r = rad * (0.6 + 0.4 * Math.sin(t * 1.7 + i));
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = y0 + h * (0.5 + 0.5 * Math.sin(t * 1.3 + i * 1.9)); pos[i * 3 + 2] = z0 + Math.sin(a) * r;
    }
    geo.attributes.position.needsUpdate = true; m.size = size * (0.8 + 0.2 * Math.sin(t * 6));
  });
}
const wingShape = (curves) => { const s = new THREE.Shape(); s.moveTo(0, 0); for (const c of curves) s.bezierCurveTo(...c); return s; };
const roundRect = (w, h, r) => {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
};

export const FANCY = {
  hat_tophat() {
    const T = mat4([0, 0, 0.02], [-0.1, 0, 0]), mt = (p, r, s) => mat4(p, r, s, T);
    return group([
      { g: lathe([[0, 0], [0.34, 0], [0.37, 0.012], [0.35, 0.03], [0, 0.03]]), vg: ["#2a2236", "#3b3050"], m: T, ol: 0.012 },
      { g: lathe([[0, 0.02], [0.2, 0.02], [0.21, 0.28], [0.19, 0.32], [0, 0.325]]), vg: ["#2a2236", "#463a5e"], m: T, ol: 0.014 },
      { g: new THREE.CylinderGeometry(0.212, 0.212, 0.07, 28), c: "#e03131", m: mt([0, 0.07, 0]) },
      { g: new THREE.BoxGeometry(0.07, 0.085, 0.02), c: "#ffd43b", m: mt([0, 0.07, 0.21]), ol: 0.006 },
      { g: new THREE.BoxGeometry(0.035, 0.05, 0.022), c: "#e03131", m: mt([0, 0.07, 0.212]) },
    ]);
  },
  hat_pirate() {
    const T = mat4([0, -0.02, 0], [-0.08, 0, 0]), mt = (p, r, s) => mat4(p, r, s, T);
    return group([
      { g: new THREE.SphereGeometry(0.3, 26, 12, 0, Math.PI * 2, 0, Math.PI / 2), vg: ["#1f1b2b", "#3a3350"], m: mt([0, 0, 0.02], [0, 0, 0], [1.1, 0.78, 1]), ol: 0.014 },
      { g: tor(0.33, 0.05, 8, 36), c: "#2a2436", m: mt([0, 0.02, 0.02], [Math.PI / 2, 0, 0], [1.28, 0.9, 1]), ol: O },
      { g: tor(0.33, 0.012, 6, 36), c: "#ffd43b", m: mt([0, 0.075, 0.02], [Math.PI / 2, 0, 0], [1.28, 0.9, 1]) },
      { g: sph(0.05), c: "#ffffff", m: mt([0, 0.15, 0.31], [0, 0, 0], [1, 1.05, 0.5]), ol: 0.008 },
      { g: new THREE.BoxGeometry(0.05, 0.025, 0.02), c: "#ffffff", m: mt([0, 0.105, 0.31]) },
      { g: new THREE.CylinderGeometry(0.01, 0.01, 0.13, 6), c: "#ffffff", m: mt([0, 0.07, 0.315], [0, 0, 0.7]) },
      { g: new THREE.CylinderGeometry(0.01, 0.01, 0.13, 6), c: "#ffffff", m: mt([0, 0.07, 0.315], [0, 0, -0.7]) },
      { g: sph(0.011), c: "#1f1b2b", m: mt([-0.017, 0.155, 0.335]) }, { g: sph(0.011), c: "#1f1b2b", m: mt([0.017, 0.155, 0.335]) },
    ]);
  },
  hat_santa() {
    const cone = bend(lathe([[0, 0], [0.21, 0], [0.2, 0.1], [0.13, 0.28], [0.06, 0.44], [0.025, 0.5], [0, 0.52]], 24), (v) => { v.z -= v.y * v.y * 0.95; v.y -= v.y * v.y * 0.18; });
    return group([
      { g: cone, vg: ["#c92a2a", "#ff6b6b"], p: [0, 0, 0.02], r: [-0.05, 0, 0], ol: 0.014 },
      pt(tor(0.205, 0.05, 8, 28), "#ffffff", [0, 0.01, 0.02], 0.012, { r: [Math.PI / 2, 0, 0] }),
      pt(sph(0.075), "#ffffff", [0, 0.43, -0.22], 0.016),
    ]);
  },
  hat_bunny() {
    const ear = lathe([[0, 0], [0.065, 0.02], [0.095, 0.15], [0.09, 0.33], [0.058, 0.45], [0, 0.5]], 16);
    const parts = [{ g: tor(0.2, 0.014, 6, 24, Math.PI), c: "#ffffff", p: [0, -0.03, 0.03] }];
    for (const sx of [-1, 1]) {
      const m = mat4([sx * 0.1, -0.02, 0.03], [0.1, 0, -sx * 0.22]);
      parts.push({ g: ear, c: "#ffffff", m, ol: O }, { g: ear, c: "#ffb3c7", m: mat4([0, 0.02, 0.022], [0, 0, 0], [0.55, 0.78, 0.4], m) });
    }
    return group(parts);
  },
  hat_halo() {
    const g = new THREE.Group();
    const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.034, 10, 40), haloMat), glow = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 8, 40), glowMat);
    ringM.rotation.x = glow.rotation.x = Math.PI / 2;
    const h = new THREE.Group(); h.add(ringM, glow); h.position.set(0, 0.34, 0.02); g.add(h);
    motes(g, 8, 0.3, 0.4, ["#fff3b0", "#ffe27a"], 0.07, 0.1, 0.02);
    onUpdate(g, (t) => { h.position.y = 0.34 + Math.sin(t * 2) * 0.025; h.rotation.z = Math.sin(t * 1.3) * 0.06; h.rotation.x = 0.3; glow.scale.setScalar(1 + Math.sin(t * 3) * 0.06); });
    return g;
  },
  hat_unicorn() {
    const horn = new THREE.CylinderGeometry(0.004, 0.08, 0.52, 22, 28);
    bend(horn, (v) => { const th = Math.atan2(v.z, v.x), r = Math.hypot(v.x, v.z) * (1 + 0.13 * Math.sin(th * 3 + v.y * 30)); v.x = Math.cos(th) * r; v.z = Math.sin(th) * r; });
    const g = group([
      { g: horn, vg: ["#ffcf3a", "#fff6c8"], p: [0, 0.26, 0.08], r: [0.2, 0, 0], ol: 0.012 },
      pt(tor(0.075, 0.02, 7, 18), "#ffd43b", [0, 0.02, 0.07], 0.008, { r: [Math.PI / 2 - 0.2, 0, 0] }),
      pt(sph(0.04), "#ffb3d9", [-0.12, 0, 0.03], 0.01), pt(sph(0.04), "#b9a0ff", [0.12, 0, 0.03], 0.01), pt(sph(0.035), "#9be7ff", [0, 0, -0.06], 0.01),
    ]);
    motes(g, 12, 0.22, 0.55, ["#ff9ed8", "#ffe066", "#9be7ff", "#b9a0ff"], 0.08, 0.1, 0.08);
    return g;
  },
  hat_propeller() {
    const g = new THREE.Group(), cols = ["#ff6b6b", "#ffd43b", "#4dabf7", "#51cf66"];
    const parts = cols.map((c, i) => ({ g: new THREE.SphereGeometry(0.28, 12, 10, (i * Math.PI) / 2, Math.PI / 2, 0, Math.PI / 2), c, m: mat4([0, -0.02, 0.03], [0, 0, 0], [1.1, 0.8, 1.1]), ol: O }));
    parts.push({ g: tor(0.3, 0.025, 8, 28), c: "#ffffff", m: mat4([0, -0.02, 0.03], [Math.PI / 2, 0, 0], [1.1, 1.1, 1]) }, pt(sph(0.035), "#ffd43b", [0, 0.22, 0.03], 0.008), { g: new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), c: "#868e96", p: [0, 0.25, 0.03] });
    g.add(bakedMesh(bake(parts), matDS));
    const prop = new THREE.Group(); prop.position.set(0, 0.285, 0.03);
    prop.add(bakedMesh(bake([0, 1].map((i) => ({ g: sph(1), c: i ? "#ff6b6b" : "#4dabf7", m: mat4([(i ? -1 : 1) * 0.1, 0, 0], [0, i ? 0.25 : -0.25, 0], [0.11, 0.012, 0.04]), ol: 0.006 }))), mat));
    g.add(prop);
    onUpdate(g, (t, k) => { prop.rotation.y = t * (6 + k * 18); });
    return g;
  },
  glasses_goggles() {
    const g = group([
      ...[-1, 1].flatMap((sx) => [pt(tor(0.105, 0.03, 8, 28), "#c98a2e", [sx * 0.175, 0, 0.07], 0.007), pt(tor(0.135, 0.012, 6, 28), "#8a5a1a", [sx * 0.175, 0, 0.07], 0)]),
      { g: new THREE.BoxGeometry(0.1, 0.035, 0.02), c: "#8a5a1a", p: [0, 0, 0.075] },
      ...[-1, 1].map((sx) => ({ g: new THREE.CylinderGeometry(0.014, 0.014, 0.3, 6), c: "#5a3a12", p: [sx * 0.31, 0, -0.07], r: [Math.PI / 2, 0, 0] })),
    ]);
    g.add(bakedMesh(bake([-1, 1].map((sx) => ({ g: new THREE.CircleGeometry(0.1, 22), vg: ["#ff9a3c", "#ffe08a"], p: [sx * 0.175, 0, 0.068] }))), matTrans));
    return g;
  },
  glasses_3d() {
    const fr = () => { const s = roundRect(0.2, 0.14, 0.035); s.holes.push(new THREE.Path(roundRect(0.15, 0.09, 0.02).getPoints(8).reverse())); return new THREE.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2, curveSegments: 8 }); };
    const g = group([...[-1, 1].flatMap((sx) => [pt(fr(), "#fff7e0", [sx * 0.175, 0, 0.065], 0.006), temple("#fff7e0", sx)]), { g: new THREE.BoxGeometry(0.06, 0.02, 0.015), c: "#fff7e0", p: [0, 0.015, 0.072] }]);
    g.add(bakedMesh(bake([[-1, "#ff4d4d"], [1, "#33c9ff"]].map(([sx, c]) => ({ g: new THREE.ShapeGeometry(roundRect(0.16, 0.1, 0.022), 8), c, p: [sx * 0.175, 0, 0.07] }))), matTrans));
    return g;
  },
  neck_chain() {
    return group([
      pt(tor(0.3, 0.01, 6, 40), "#ffd43b", [0, 0, 0], 0.005, { r: [Math.PI / 2, 0, 0] }),
      pt(tor(0.036, 0.011, 6, 14), "#ffd43b", [0, -0.06, 0.318], 0.005),
      pt(new THREE.OctahedronGeometry(0.05, 1), "#ff4d8d", [0, -0.125, 0.318], 0.008, { s: [0.85, 1.25, 0.6] }),
      { g: sph(0.012), c: "#ffffff", p: [-0.015, -0.108, 0.345] },
    ]);
  },
  neck_pearls() {
    const parts = [];
    ring(26, (i, a) => parts.push({ g: new THREE.SphereGeometry(0.031, 9, 6), vg: ["#e6d9e0", "#ffffff"], p: [Math.sin(a) * 0.3, 0, Math.cos(a) * 0.29] }));
    parts.push(pt(new THREE.SphereGeometry(0.05, 12, 8), "#fff7fa", [0, -0.07, 0.31], 0.008), { g: tor(0.026, 0.008, 6, 12), c: "#ffd43b", p: [0, -0.02, 0.31] }, { g: sph(0.012), c: "#ffffff", p: [-0.015, -0.055, 0.345] });
    return group(parts);
  },
  neck_lei() {
    const parts = [{ g: tor(0.3, 0.02, 6, 36), c: "#3f9d4a", r: [Math.PI / 2, 0, 0] }], cols = ["#ff8fab", "#ffd43b", "#ffffff", "#ff922b", "#b197fc", "#ff6b9d"];
    ring(14, (i, a) => {
      const m = mat4([Math.sin(a) * 0.3, -0.015, Math.cos(a) * 0.29], [0, a, 0]);
      parts.push({ g: new THREE.SphereGeometry(0.058, 10, 6), c: cols[i % cols.length], m: mat4([0, 0, 0.012], [0.4, 0, 0], [1, 0.6, 1], m), ol: 0.008 }, { g: new THREE.SphereGeometry(0.02, 8, 5), c: i % 3 === 1 ? "#ff922b" : "#ffe066", m: mat4([0, 0.012, 0.035], [0, 0, 0], [1, 1, 1], m) });
    });
    return group(parts);
  },
  back_fairy() {
    const g = new THREE.Group(), wings = [];
    const up = new THREE.ExtrudeGeometry(wingShape([[0.12, 0.3, 0.42, 0.46, 0.52, 0.24], [0.56, 0.08, 0.3, 0, 0, 0]]), { depth: 0.004, bevelEnabled: false, curveSegments: 20 });
    const lo = new THREE.ExtrudeGeometry(wingShape([[0.22, -0.01, 0.36, -0.1, 0.3, -0.27], [0.22, -0.36, 0.05, -0.17, 0, 0]]), { depth: 0.004, bevelEnabled: false, curveSegments: 16 });
    const wb = bake([{ g: up, vg: ["#9be7ff", "#ffd6f5"] }, { g: lo, vg: ["#ffd6f5", "#b9a0ff"] }]);
    for (const sx of [-1, 1]) { const w = new THREE.Group(); w.position.set(sx * 0.07, 0.07, -0.1); w.add(bakedMesh(wb, wingMat)); w.scale.set(sx * 1.45, 1.45, 1.45); wings.push(w); g.add(w); }
    motes(g, 10, 0.4, 0.5, ["#ffffff", "#ffd6f5", "#9be7ff"], 0.07, 0, -0.2);
    onUpdate(g, (t, k) => { const f = Math.sin(t * (3 + k * 6)) * (0.12 + 0.18 * k); wings[0].rotation.set(0, -(0.55 - f), 0.1); wings[1].rotation.set(0, 0.55 - f, -0.1); });
    return g;
  },
  back_angel() {
    const g = new THREE.Group(), wings = [], feather = new THREE.SphereGeometry(1, 8, 5), parts = [];
    [[6, 0.4, 0.05, 0.28], [5, 0.3, -0.02, 0.3], [5, 0.17, -0.08, 0.34]].forEach(([n, len, y0, spread], ri) => {
      for (let j = 0; j < n; j++) {
        const a = -0.15 + (j / (n - 1)) * spread * (n - 1) * 0.9, dx = Math.sin(a), dy = Math.cos(a), r0 = 0.02 + j * 0.012;
        parts.push({ g: feather, vg: ri === 0 ? ["#e6f0ff", "#ffffff"] : ["#ffffff", "#fff4dc"], m: mat4([dx * (r0 + len / 2), y0 + dy * (r0 + len / 2) * 0.9, -0.002 * ri], [0, 0, -a], [0.05 + ri * 0.005, len / 2, 0.014]), ol: 0.008 });
      }
    });
    const wb = bake(parts);
    for (const sx of [-1, 1]) { const w = new THREE.Group(); w.position.set(sx * 0.06, 0.05, -0.1); w.add(bakedMesh(wb, mat)); w.scale.set(sx * 1.45, 1.45, 1.45); wings.push(w); g.add(w); }
    motes(g, 10, 0.45, 0.6, ["#fff3b0", "#ffffff", "#ffe27a"], 0.08, 0.1, -0.2);
    onUpdate(g, (t, k) => { const f = Math.sin(t * (1.6 + k * 3)) * (0.07 + 0.1 * k); wings[0].rotation.set(0, -(0.5 - f), 0.12); wings[1].rotation.set(0, 0.5 - f, -0.12); });
    return g;
  },
  back_jetpack() {
    const g = new THREE.Group(), tank = lathe([[0, 0], [0.06, 0.005], [0.078, 0.05], [0.078, 0.2], [0.06, 0.255], [0.03, 0.275], [0, 0.278]], 16), parts = [];
    for (const sx of [-1, 1]) parts.push(
      { g: tank, vg: ["#7d8aa5", "#d6deef"], p: [sx * 0.15, -0.2, -0.12], ol: 0.01 },
      { g: new THREE.ConeGeometry(0.05, 0.07, 12), c: "#ff6b35", p: [sx * 0.15, -0.235, -0.12], r: [Math.PI, 0, 0], ol: 0.008 },
      { g: new THREE.CylinderGeometry(0.081, 0.081, 0.035, 16), c: "#ffd43b", p: [sx * 0.15, -0.04, -0.12] },
      pt(sph(0.02), "#ff4d4d", [sx * 0.15, 0.03, -0.098], 0.005));
    parts.push({ g: new THREE.BoxGeometry(0.1, 0.05, 0.05), c: "#5c6b8a", p: [0, -0.1, -0.12], ol: 0.006 }, { g: tor(0.2, 0.014, 6, 16, Math.PI), c: "#7a4a24", p: [0, -0.05, 0] });
    g.add(bakedMesh(bake(parts), mat));
    const flames = [];
    for (const sx of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.28, 10, 1, true), flameMat), f2 = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.18, 8, 1, true), flameMat2);
      f.rotation.x = f2.rotation.x = Math.PI; f.position.set(sx * 0.15, -0.4, -0.17); f2.position.set(sx * 0.15, -0.35, -0.17); g.add(f, f2); flames.push(f, f2);
    }
    motes(g, 8, 0.17, 0.5, ["#ffb347", "#ffe9a0"], 0.06, -0.5, -0.12);
    onUpdate(g, (t, k) => { for (let i = 0; i < 4; i++) { const f = flames[i], s = (0.85 + 0.3 * Math.abs(Math.sin(t * 31 + i * 1.7))) * (1 + k * 0.4); f.scale.set(1, s, 1); f.position.y = (i < 2 ? -0.4 : -0.35) - (s - 1) * 0.12; } });
    g.scale.setScalar(1.3); g.position.y = 0.04;
    return g;
  },
};
