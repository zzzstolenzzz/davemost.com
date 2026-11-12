// Procedural accessory meshes. Each builder returns a Group in the slot mount's local space
// (hat: top of head, glasses: eye level, neck: collar, back: shoulders). Optional userData.update(t, speed).
import * as THREE from "three";
import { toon, addOutline } from "./toon.js";

const mats = new Map();
const M = (c) => { if (!mats.has(c)) mats.set(c, toon(c)); return mats.get(c); };
function mk(parent, geo, color, { p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0], o = 0.012, side } = {}) {
  const m = new THREE.Mesh(geo, side ? Object.assign(toon(color), { side }) : M(color));
  m.position.set(...p); m.scale.set(...s); m.rotation.set(...r);
  if (o) addOutline(m, o);
  parent.add(m);
  return m;
}
const ring = (n, fn) => Array.from({ length: n }, (_, i) => fn(i, (i / n) * Math.PI * 2));
const sph = (r) => new THREE.SphereGeometry(r, 14, 10);

export const ACCESSORIES = {
  hat_party() {
    const g = new THREE.Group();
    const cone = mk(g, new THREE.ConeGeometry(0.17, 0.46, 12), "#ff7eb6", { p: [0, 0.2, 0], r: [-0.12, 0, 0], o: 0.014 });
    mk(cone, new THREE.TorusGeometry(0.1, 0.017, 6, 16), "#ffe066", { p: [0, -0.04, 0], r: [Math.PI / 2, 0, 0], o: 0 });
    mk(cone, new THREE.TorusGeometry(0.14, 0.017, 6, 16), "#74c0fc", { p: [0, -0.15, 0], r: [Math.PI / 2, 0, 0], o: 0 });
    mk(cone, sph(0.05), "#ffe066", { p: [0, 0.24, 0], o: 0.02 });
    return g;
  },
  hat_crown() {
    const g = new THREE.Group();
    mk(g, new THREE.CylinderGeometry(0.2, 0.18, 0.12, 12, 1, true), "#ffd43b", { p: [0, 0.05, 0.01], o: 0.012, side: THREE.DoubleSide });
    ring(5, (i, a) => {
      const x = Math.sin(a) * 0.19, z = Math.cos(a) * 0.19;
      mk(g, new THREE.ConeGeometry(0.05, 0.13, 4), "#ffd43b", { p: [x, 0.15, z + 0.01], o: 0.01 });
      mk(g, sph(0.025), i % 2 ? "#ff6b6b" : "#4dabf7", { p: [x * 1.02, 0.03, z * 1.02 + 0.01], o: 0 });
    });
    return g;
  },
  hat_wizard() {
    const g = new THREE.Group();
    mk(g, new THREE.CylinderGeometry(0.34, 0.34, 0.025, 20), "#7950f2", { p: [0, 0.01, 0], o: 0.012 });
    const cone = mk(g, new THREE.ConeGeometry(0.2, 0.52, 14), "#7950f2", { p: [0, 0.28, 0], r: [-0.15, 0, 0.12], o: 0.014 });
    mk(cone, new THREE.TorusGeometry(0.17, 0.02, 6, 18), "#ffd43b", { p: [0, -0.16, 0], r: [Math.PI / 2, 0, 0], o: 0 });
    mk(cone, new THREE.OctahedronGeometry(0.05), "#ffe066", { p: [0.02, 0.0, 0.18], s: [1, 1, 0.4], o: 0.012 });
    return g;
  },
  hat_flowers() {
    const g = new THREE.Group();
    const cols = ["#ff8fab", "#ffe066", "#ffffff", "#b197fc", "#ff8fab", "#ffe066", "#ffffff"];
    cols.forEach((c, i) => {
      const a = -1.15 + (i / (cols.length - 1)) * 2.3; // across the forehead, between the ears
      const x = Math.sin(a) * 0.33, z = Math.cos(a) * 0.26 + 0.02, y = 0.02 - Math.abs(a) * 0.06;
      mk(g, new THREE.TorusGeometry(0.035, 0.012, 5, 8), "#6fcf6f", { p: [x * 0.97, y - 0.02, z * 0.97], r: [0.9, a, 0], o: 0 });
      mk(g, sph(0.05), c, { p: [x, y, z], o: 0.015 });
      mk(g, sph(0.022), c === "#ffe066" ? "#ff922b" : "#ffe066", { p: [x * 1.06, y + 0.01, z * 1.06], o: 0 });
    });
    return g;
  },
  hat_beanie() {
    const g = new THREE.Group();
    mk(g, new THREE.SphereGeometry(0.34, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), "#4dabf7", { p: [0, -0.04, 0.03], s: [1, 0.85, 1], o: 0.014 });
    mk(g, new THREE.CylinderGeometry(0.345, 0.345, 0.07, 18), "#fa5252", { p: [0, -0.04, 0.03], o: 0.012 });
    mk(g, sph(0.08), "#ffffff", { p: [0, 0.3, 0.03], o: 0.02 });
    return g;
  },
  hat_cowboy() {
    const g = new THREE.Group();
    mk(g, new THREE.CylinderGeometry(0.4, 0.4, 0.025, 20), "#b5793f", { p: [0, 0.0, 0.02], s: [1, 1, 0.9], o: 0.012 });
    mk(g, new THREE.CylinderGeometry(0.15, 0.2, 0.2, 14), "#b5793f", { p: [0, 0.11, 0.02], o: 0.014 });
    mk(g, new THREE.CylinderGeometry(0.205, 0.205, 0.045, 14), "#7a4a24", { p: [0, 0.04, 0.02], o: 0 });
    return g;
  },
  neck_bell() {
    const g = new THREE.Group();
    mk(g, new THREE.TorusGeometry(0.3, 0.034, 8, 28), "#ff5d73", { r: [Math.PI / 2, 0, 0], s: [1, 0.95, 1], o: 0.012 });
    mk(g, sph(0.062), "#ffd43b", { p: [0, -0.05, 0.31], o: 0.014 });
    mk(g, new THREE.BoxGeometry(0.05, 0.008, 0.01), "#9a7b00", { p: [0, -0.06, 0.37], o: 0 });
    return g;
  },
  neck_bandana() {
    const g = new THREE.Group();
    mk(g, new THREE.TorusGeometry(0.3, 0.03, 8, 28), "#ff6b6b", { r: [Math.PI / 2, 0, 0], o: 0.012 });
    const tri = mk(g, new THREE.ConeGeometry(0.17, 0.26, 3), "#ff6b6b", { p: [0, -0.12, 0.27], r: [0, Math.PI, Math.PI], s: [1, 1, 0.22], o: 0.012 });
    [-0.05, 0, 0.05].forEach((x) => mk(tri, sph(0.018), "#ffffff", { p: [x, 0.02 - Math.abs(x), 0.05], o: 0 }));
    return g;
  },
  neck_bowtie() {
    const g = new THREE.Group();
    mk(g, new THREE.TorusGeometry(0.3, 0.02, 6, 28), "#5f3dc4", { r: [Math.PI / 2, 0, 0], o: 0 });
    for (const sx of [-1, 1]) mk(g, new THREE.ConeGeometry(0.085, 0.14, 3), "#845ef7", { p: [sx * 0.09, -0.03, 0.31], r: [0, 0, sx * Math.PI / 2], s: [1, 1, 0.45], o: 0.012 });
    mk(g, sph(0.04), "#5f3dc4", { p: [0, -0.03, 0.32], o: 0.012 });
    return g;
  },
  neck_scarf() {
    const g = new THREE.Group();
    mk(g, new THREE.TorusGeometry(0.3, 0.06, 8, 28), "#ef476f", { r: [Math.PI / 2, 0, 0], s: [1, 0.95, 0.9], o: 0.014 });
    ring(8, (i, a) => mk(g, new THREE.TorusGeometry(0.3, 0.063, 6, 4, 0.35), i % 2 ? "#ffd166" : "#ef476f", { r: [Math.PI / 2, 0, a], s: [1, 0.95, 0.9], o: 0 }));
    const tail = mk(g, new THREE.BoxGeometry(0.12, 0.3, 0.05), "#ef476f", { p: [0.14, -0.2, 0.27], r: [0.1, 0, -0.15], o: 0.012 });
    mk(tail, new THREE.BoxGeometry(0.125, 0.05, 0.055), "#ffd166", { p: [0, -0.05, 0], o: 0 });
    mk(tail, new THREE.BoxGeometry(0.125, 0.05, 0.055), "#ffd166", { p: [0, 0.09, 0], o: 0 });
    return g;
  },
  glasses_round() {
    const g = new THREE.Group();
    for (const sx of [-1, 1]) {
      mk(g, new THREE.TorusGeometry(0.105, 0.014, 8, 24), "#3b2a4a", { p: [sx * 0.175, 0, 0.07], o: 0 });
      mk(g, new THREE.CircleGeometry(0.1, 20), "#bfe9ff", { p: [sx * 0.175, 0, 0.068], o: 0, side: THREE.DoubleSide }).material.transparent = true;
      mk(g, new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), "#3b2a4a", { p: [sx * 0.3, 0.01, -0.07], r: [Math.PI / 2, 0, 0], o: 0 });
    }
    mk(g, new THREE.TorusGeometry(0.035, 0.01, 6, 10, Math.PI), "#3b2a4a", { p: [0, 0.02, 0.07], o: 0 });
    return g;
  },
  glasses_heart() {
    const g = new THREE.Group();
    const heart = new THREE.Shape();
    heart.moveTo(0, -0.09); heart.bezierCurveTo(-0.16, 0.02, -0.07, 0.14, 0, 0.06); heart.bezierCurveTo(0.07, 0.14, 0.16, 0.02, 0, -0.09);
    const geo = new THREE.ExtrudeGeometry(heart, { depth: 0.02, bevelEnabled: false });
    for (const sx of [-1, 1]) {
      mk(g, geo, "#ff4d8d", { p: [sx * 0.17, 0.005, 0.07], s: [0.95, 0.95, 1], o: 0.008 });
      mk(g, new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), "#ff4d8d", { p: [sx * 0.3, 0.03, -0.07], r: [Math.PI / 2, 0, 0], o: 0 });
    }
    return g;
  },
  glasses_star() {
    const g = new THREE.Group();
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.055 : 0.125; star[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r); }
    const geo = new THREE.ExtrudeGeometry(star, { depth: 0.02, bevelEnabled: false });
    for (const sx of [-1, 1]) {
      mk(g, geo, "#ffd43b", { p: [sx * 0.175, 0, 0.07], o: 0.008 });
      mk(g, new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), "#ffd43b", { p: [sx * 0.3, 0.02, -0.07], r: [Math.PI / 2, 0, 0], o: 0 });
    }
    mk(g, new THREE.BoxGeometry(0.08, 0.015, 0.015), "#ffd43b", { p: [0, 0.02, 0.08], o: 0 });
    return g;
  },
  back_pack() {
    const g = new THREE.Group();
    mk(g, sph(0.17), "#4dabf7", { p: [0, -0.05, -0.12], s: [1, 1.05, 0.75], o: 0.02 });
    mk(g, sph(0.1), "#339af0", { p: [0, -0.1, -0.24], s: [1, 0.8, 0.5], o: 0.02 });
    mk(g, new THREE.TorusGeometry(0.2, 0.015, 6, 14, Math.PI), "#ffd43b", { p: [0, -0.05, 0.0], r: [0, 0, 0], s: [1, 1, 1], o: 0 });
    mk(g, sph(0.035), "#ffd43b", { p: [0, 0.07, -0.25], o: 0.01 });
    return g;
  },
  back_cape() {
    const g = new THREE.Group();
    const segs = [];
    let parent = g;
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Group();
      if (i) s.position.y = -0.2;
      parent.add(s);
      mk(s, new THREE.BoxGeometry(0.5 - i * 0.04, 0.22, 0.025), i === 2 ? "#ff6b6b" : "#e03131", { p: [0, -0.11, -0.07], o: 0.01 });
      segs.push(s); parent = s;
    }
    mk(g, new THREE.TorusGeometry(0.15, 0.02, 6, 12), "#ffd43b", { p: [0, 0.0, 0.0], r: [Math.PI / 2, 0, 0], o: 0 });
    g.rotation.x = 0.25;
    g.userData.update = (t, k) => segs.forEach((s, i) => { s.rotation.x = 0.12 + k * 0.5 + Math.sin(t * 3 - i) * (0.06 + 0.1 * k); s.rotation.z = Math.sin(t * 2.3 - i * 0.8) * 0.05; });
    return g;
  },
};
