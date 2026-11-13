// Procedural accessories. Each builder returns a Group in the slot mount's local space
// (hat: top of head, glasses: eye level, neck: collar, back: shoulders). Each is ONE merged mesh + one outline hull.
// Optional userData.update(t, speed) animates it (the cape).
import * as THREE from "three";
import { toon, bake, bakedMesh, mat4 } from "./toon.js";
import { FANCY } from "./fancy.js";

const mat = toon("#ffffff", { vertexColors: true, rim: 0.35 });
const matDS = toon("#ffffff", { vertexColors: true, rim: 0.35, side: THREE.DoubleSide });
const matTrans = toon("#ffffff", { vertexColors: true, transparent: true, opacity: 0.55, rim: 0, side: THREE.DoubleSide });
const O = 0.012;
const ring = (n, fn) => Array.from({ length: n }, (_, i) => fn(i, (i / n) * Math.PI * 2));
const sph = (r) => new THREE.SphereGeometry(r, 16, 12);
const tor = (R, r, a = 6, b = 24, arc) => new THREE.TorusGeometry(R, r, a, b, arc);
const group = (parts, m = mat) => { const g = new THREE.Group(); g.add(bakedMesh(bake(parts), m)); return g; };
const pt = (g, c, p, o = O, extra = {}) => ({ g, c, p, ol: o, ...extra });
const temple = (c, sx, y = 0.01) => ({ g: new THREE.CylinderGeometry(0.008, 0.008, 0.3, 5), c, p: [sx * 0.3, y, -0.07], r: [Math.PI / 2, 0, 0] });

export const ACCESSORIES = {
  hat_party() {
    const coneM = mat4([0, 0.2, 0], [-0.12, 0, 0]);
    return group([
      { g: new THREE.ConeGeometry(0.17, 0.46, 16), c: "#ff7eb6", m: coneM, ol: 0.014 },
      { g: tor(0.1, 0.017), c: "#ffe066", m: mat4([0, -0.04, 0], [Math.PI / 2, 0, 0], [1, 1, 1], coneM) },
      { g: tor(0.14, 0.017), c: "#74c0fc", m: mat4([0, -0.15, 0], [Math.PI / 2, 0, 0], [1, 1, 1], coneM) },
      { g: sph(0.05), c: "#ffe066", m: mat4([0, 0.24, 0], [0, 0, 0], [1, 1, 1], coneM), ol: 0.02 },
    ]);
  },
  hat_crown() {
    const parts = [{ g: new THREE.CylinderGeometry(0.2, 0.18, 0.12, 16, 1, true), c: "#ffd43b", p: [0, 0.05, 0.01], ol: O }];
    ring(5, (i, a) => {
      const x = Math.sin(a) * 0.19, z = Math.cos(a) * 0.19;
      parts.push(pt(new THREE.ConeGeometry(0.05, 0.13, 4), "#ffd43b", [x, 0.15, z + 0.01], 0.01), { g: sph(0.025), c: i % 2 ? "#ff6b6b" : "#4dabf7", p: [x * 1.02, 0.03, z * 1.02 + 0.01] });
    });
    return group(parts, matDS);
  },
  hat_wizard() {
    const coneM = mat4([0, 0.28, 0], [-0.15, 0, 0.12]);
    return group([
      pt(new THREE.CylinderGeometry(0.34, 0.34, 0.025, 24), "#7950f2", [0, 0.01, 0]),
      { g: new THREE.ConeGeometry(0.2, 0.52, 16), c: "#7950f2", m: coneM, ol: 0.014 },
      { g: tor(0.17, 0.02, 6, 20), c: "#ffd43b", m: mat4([0, -0.16, 0], [Math.PI / 2, 0, 0], [1, 1, 1], coneM) },
      { g: new THREE.OctahedronGeometry(0.05), c: "#ffe066", m: mat4([0.02, 0, 0.18], [0, 0, 0], [1, 1, 0.4], coneM), ol: O },
    ]);
  },
  hat_flowers() {
    const parts = [];
    ["#ff8fab", "#ffe066", "#ffffff", "#b197fc", "#ff8fab", "#ffe066", "#ffffff"].forEach((c, i, arr) => {
      const a = -1.15 + (i / (arr.length - 1)) * 2.3;
      const x = Math.sin(a) * 0.33, z = Math.cos(a) * 0.26 + 0.02, y = 0.02 - Math.abs(a) * 0.06;
      parts.push({ g: tor(0.035, 0.012, 5, 8), c: "#6fcf6f", p: [x * 0.97, y - 0.02, z * 0.97], r: [0.9, a, 0] }, pt(sph(0.05), c, [x, y, z], 0.015), { g: sph(0.022), c: c === "#ffe066" ? "#ff922b" : "#ffe066", p: [x * 1.06, y + 0.01, z * 1.06] });
    });
    return group(parts);
  },
  hat_beanie() {
    return group([
      pt(new THREE.SphereGeometry(0.34, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), "#4dabf7", [0, -0.04, 0.03], 0.014, { s: [1, 0.85, 1] }),
      pt(new THREE.CylinderGeometry(0.345, 0.345, 0.07, 20), "#fa5252", [0, -0.04, 0.03]),
      pt(sph(0.08), "#ffffff", [0, 0.3, 0.03], 0.02),
    ], matDS);
  },
  hat_cowboy() {
    return group([
      pt(new THREE.CylinderGeometry(0.4, 0.4, 0.025, 24), "#b5793f", [0, 0, 0.02], O, { s: [1, 1, 0.9] }),
      pt(new THREE.CylinderGeometry(0.15, 0.2, 0.2, 16), "#b5793f", [0, 0.11, 0.02], 0.014),
      { g: new THREE.CylinderGeometry(0.205, 0.205, 0.045, 16), c: "#7a4a24", p: [0, 0.04, 0.02] },
    ]);
  },
  neck_bell() {
    return group([
      pt(tor(0.3, 0.034, 8, 32), "#ff5d73", [0, 0, 0], O, { r: [Math.PI / 2, 0, 0], s: [1, 0.95, 1] }),
      pt(sph(0.062), "#ffd43b", [0, -0.05, 0.31], 0.014),
      { g: new THREE.BoxGeometry(0.05, 0.008, 0.01), c: "#9a7b00", p: [0, -0.06, 0.37] },
    ]);
  },
  neck_bandana() {
    return group([
      pt(tor(0.3, 0.03, 8, 32), "#ff6b6b", [0, 0, 0], O, { r: [Math.PI / 2, 0, 0] }),
      pt(new THREE.ConeGeometry(0.17, 0.26, 3), "#ff6b6b", [0, -0.12, 0.27], O, { r: [0, Math.PI, Math.PI], s: [1, 1, 0.22] }),
      ...[-0.05, 0, 0.05].map((x) => ({ g: sph(0.018), c: "#ffffff", p: [x, -0.06 + Math.abs(x), 0.3] })),
    ], matDS);
  },
  neck_bowtie() {
    const parts = [{ g: tor(0.3, 0.02, 6, 32), c: "#5f3dc4", r: [Math.PI / 2, 0, 0] }, pt(sph(0.04), "#5f3dc4", [0, -0.03, 0.32])];
    for (const sx of [-1, 1]) parts.push(pt(new THREE.ConeGeometry(0.085, 0.14, 3), "#845ef7", [sx * 0.09, -0.03, 0.31], O, { r: [0, 0, sx * Math.PI / 2], s: [1, 1, 0.45] }));
    return group(parts, matDS);
  },
  neck_scarf() {
    const parts = [pt(tor(0.3, 0.06, 8, 32), "#ef476f", [0, 0, 0], 0.014, { r: [Math.PI / 2, 0, 0], s: [1, 0.95, 0.9] })];
    ring(8, (i, a) => { if (i % 2) parts.push({ g: tor(0.3, 0.063, 6, 4, 0.8), c: "#ffd166", r: [Math.PI / 2, 0, a], s: [1, 0.95, 0.9] }); });
    const tm = mat4([0.14, -0.2, 0.27], [0.1, 0, -0.15]);
    parts.push({ g: new THREE.BoxGeometry(0.12, 0.3, 0.05), c: "#ef476f", m: tm, ol: O }, { g: new THREE.BoxGeometry(0.125, 0.05, 0.055), c: "#ffd166", m: mat4([0, -0.05, 0], [0, 0, 0], [1, 1, 1], tm) }, { g: new THREE.BoxGeometry(0.125, 0.05, 0.055), c: "#ffd166", m: mat4([0, 0.09, 0], [0, 0, 0], [1, 1, 1], tm) });
    return group(parts);
  },
  glasses_round() {
    const g = group([
      ...[-1, 1].flatMap((sx) => [pt(tor(0.105, 0.014, 8, 28), "#3b2a4a", [sx * 0.175, 0, 0.07], 0), temple("#3b2a4a", sx)]),
      { g: tor(0.035, 0.01, 6, 10, Math.PI), c: "#3b2a4a", p: [0, 0.02, 0.07] },
    ]);
    g.add(bakedMesh(bake([-1, 1].map((sx) => ({ g: new THREE.CircleGeometry(0.1, 20), c: "#bfe9ff", p: [sx * 0.175, 0, 0.068] }))), matTrans));
    return g;
  },
  glasses_heart() {
    const heart = new THREE.Shape();
    heart.moveTo(0, -0.09); heart.bezierCurveTo(-0.16, 0.02, -0.07, 0.14, 0, 0.06); heart.bezierCurveTo(0.07, 0.14, 0.16, 0.02, 0, -0.09);
    const geo = new THREE.ExtrudeGeometry(heart, { depth: 0.02, bevelEnabled: false });
    return group([...[-1, 1].flatMap((sx) => [pt(geo, "#ff4d8d", [sx * 0.17, 0.005, 0.07], 0.008, { s: [0.74, 0.74, 1] }), temple("#ff4d8d", sx, 0.03)])]);
  },
  glasses_star() {
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.055 : 0.125; star[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r); }
    const geo = new THREE.ExtrudeGeometry(star, { depth: 0.02, bevelEnabled: false });
    return group([...[-1, 1].flatMap((sx) => [pt(geo, "#ffd43b", [sx * 0.175, 0, 0.07], 0.008, { s: [0.8, 0.8, 1] }), temple("#ffd43b", sx, 0.02)]), { g: new THREE.BoxGeometry(0.08, 0.015, 0.015), c: "#ffd43b", p: [0, 0.02, 0.08] }]);
  },
  back_pack() {
    return group([
      pt(sph(0.17), "#4dabf7", [0, -0.05, -0.12], 0.02, { s: [1, 1.05, 0.75] }),
      pt(sph(0.1), "#339af0", [0, -0.1, -0.24], 0.02, { s: [1, 0.8, 0.5] }),
      { g: tor(0.2, 0.015, 6, 14, Math.PI), c: "#ffd43b", p: [0, -0.05, 0] },
      pt(sph(0.035), "#ffd43b", [0, 0.07, -0.25], 0.01),
    ]);
  },
  back_cape() {
    const g = new THREE.Group(), segs = [];
    let parent = g;
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Group();
      if (i) s.position.y = -0.2;
      parent.add(s);
      s.add(bakedMesh(bake([pt(new THREE.BoxGeometry(0.5 - i * 0.04, 0.22, 0.025), i === 2 ? "#ff6b6b" : "#e03131", [0, -0.11, -0.07])]), mat));
      segs.push(s); parent = s;
    }
    g.add(bakedMesh(bake([{ g: tor(0.15, 0.02, 6, 14), c: "#ffd43b", r: [Math.PI / 2, 0, 0] }]), mat));
    g.rotation.x = 0.25;
    g.userData.update = (t, k) => segs.forEach((s, i) => { s.rotation.x = 0.12 + k * 0.5 + Math.sin(t * 3 - i) * (0.06 + 0.1 * k); s.rotation.z = Math.sin(t * 2.3 - i * 0.8) * 0.05; });
    return g;
  },
  ...FANCY,
};
