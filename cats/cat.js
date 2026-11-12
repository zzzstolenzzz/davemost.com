import * as THREE from "three";
import { toon, addOutline, INK } from "./toon.js";
import { ACCESSORIES } from "./accessories.js";

const sphereG = new THREE.SphereGeometry(1, 24, 16);
const bodyG = new THREE.CapsuleGeometry(0.3, 0.3, 6, 16);
const legG = new THREE.CapsuleGeometry(0.075, 0.17, 4, 8);
const coneG = new THREE.ConeGeometry(0.15, 0.3, 4);
const torusArcG = new THREE.TorusGeometry(0.305, 0.035, 8, 24, Math.PI * 1.15);
const whiskerG = new THREE.CylinderGeometry(0.004, 0.004, 0.3, 4);
const mouthG = new THREE.TorusGeometry(0.04, 0.009, 6, 12, Math.PI);
const browG = new THREE.BoxGeometry(0.03, 0.09, 0.02);
[sphereG, bodyG, legG, coneG, torusArcG, whiskerG, mouthG, browG].forEach((g) => (g.userData.shared = true));
const RAINBOW = ["#ff6b6b", "#ffa94d", "#ffe066", "#8ce99a", "#74c0fc", "#b197fc", "#f783ac"].map((c) => toon(c));
const TAIL_SEGS = 8;

export function buildCat(cfg) {
  const root = new THREE.Group();
  const bodyM = toon(cfg.body), bellyM = toon(cfg.belly), markM = toon(cfg.markingColor);
  const eyeM = toon(cfg.eyes), noseM = toon(cfg.nose), innerM = toon("#ffb3c1"), darkM = toon(INK);
  const cheekM = toon("#ff9fb5", { transparent: true, opacity: 0.55 });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const add = (parent, geo, mat, { p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0], o = 0, cast = false } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...p); m.scale.set(...s); m.rotation.set(...r);
    if (o) addOutline(m, o);
    m.castShadow = cast;
    parent.add(m);
    return m;
  };

  const bodyGroup = new THREE.Group(); // bobs / squashes
  root.add(bodyGroup);
  add(bodyGroup, bodyG, bodyM, { p: [0, 0.5, 0], r: [Math.PI / 2, 0, 0], o: 0.025, cast: true });
  add(bodyGroup, sphereG, bellyM, { p: [0, 0.4, 0.08], s: [0.25, 0.22, 0.36] });
  add(bodyGroup, sphereG, bellyM, { p: [0, 0.52, 0.3], s: [0.19, 0.22, 0.14] });
  if (cfg.markings === "stripes") {
    for (const z of [-0.14, 0, 0.14]) add(bodyGroup, torusArcG, markM, { p: [0, 0.5, z], r: [0, 0, Math.PI / 2 - Math.PI * 0.575] });
  } else if (cfg.markings === "patches") {
    add(bodyGroup, sphereG, markM, { p: [0.17, 0.62, -0.05], s: [0.17, 0.12, 0.2] });
    add(bodyGroup, sphereG, markM, { p: [-0.2, 0.55, 0.12], s: [0.12, 0.16, 0.16] });
    add(bodyGroup, sphereG, markM, { p: [0, 0.78, -0.2], s: [0.16, 0.06, 0.16] });
  }

  // head
  const head = new THREE.Group();
  head.position.set(0, 0.92, 0.4);
  bodyGroup.add(head);
  add(head, sphereG, bodyM, { s: [0.46, 0.4, 0.42], o: 0.06, cast: true });
  for (const sx of [-1, 1]) {
    const ear = add(head, coneG, bodyM, { p: [sx * 0.26, 0.36, -0.02], r: [-0.1, Math.PI / 4, -sx * 0.3], o: 0.028 });
    add(ear, coneG, innerM, { p: [0, -0.02, 0.045], s: [0.62, 0.7, 0.5] });
  }
  if (cfg.markings === "stripes") {
    for (const x of [-0.07, 0, 0.07]) add(head, browG, markM, { p: [x, 0.3 - Math.abs(x) * 0.3, 0.26], r: [-0.75, 0, x * 3] });
  } else if (cfg.markings === "patches") {
    add(head, sphereG, markM, { p: [-0.2, 0.16, 0.12], s: [0.2, 0.17, 0.2] });
  }
  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(sx * 0.17, 0.03, 0.365);
    eye.rotation.y = sx * 0.3;
    head.add(eye);
    add(eye, sphereG, darkM, { s: [0.125, 0.15, 0.05] });
    add(eye, sphereG, eyeM, { p: [0, 0, 0.01], s: [0.108, 0.135, 0.05] });
    add(eye, sphereG, darkM, { p: [0, -0.005, 0.025], s: [0.065, 0.1, 0.04] });
    add(eye, sphereG, white, { p: [0.035, 0.05, 0.05], s: [0.036, 0.036, 0.02] });
    add(eye, sphereG, white, { p: [-0.025, -0.035, 0.05], s: [0.02, 0.02, 0.015] });
    eyes.push(eye);
    add(head, sphereG, cheekM, { p: [sx * 0.31, -0.07, 0.27], s: [0.07, 0.045, 0.03], r: [0, sx * 0.9, 0] });
    for (let k = 0; k < 3; k++) {
      const w = new THREE.Group();
      w.position.set(sx * 0.3, -0.07 + k * 0.035, 0.3);
      w.rotation.set(0, sx * (0.5 + k * 0.1), (k - 1) * -0.22 * sx);
      add(w, whiskerG, darkM, { p: [sx * 0.15, 0, 0], r: [0, 0, Math.PI / 2] });
      head.add(w);
    }
  }
  add(head, sphereG, noseM, { p: [0, -0.055, 0.405], s: [0.05, 0.035, 0.03] });
  for (const sx of [-1, 1]) add(head, mouthG, darkM, { p: [sx * 0.04, -0.085, 0.4], r: [0, 0, Math.PI] });

  // mounts for shop accessories (head-local / body-local)
  const mounts = { hat: new THREE.Group(), glasses: new THREE.Group(), neck: new THREE.Group(), back: new THREE.Group() };
  mounts.hat.position.set(0, 0.34, 0.02); head.add(mounts.hat);
  mounts.glasses.position.set(0, 0.03, 0.4); head.add(mounts.glasses);
  mounts.neck.position.set(0, 0.6, 0.3); bodyGroup.add(mounts.neck);
  mounts.back.position.set(0, 0.8, -0.05); bodyGroup.add(mounts.back);

  // tail: chain of nested segments, each curls a little
  const tailBase = new THREE.Group();
  tailBase.position.set(0, 0.5, -0.4);
  tailBase.rotation.x = -1.0;
  bodyGroup.add(tailBase);
  const tail = [];
  let parent = tailBase;
  for (let i = 0; i < TAIL_SEGS; i++) {
    const seg = new THREE.Group();
    if (i) { seg.position.y = 0.13; seg.rotation.x = 0.2; }
    parent.add(seg);
    const r = 0.095 - i * 0.004;
    const banded = cfg.markings === "stripes" ? i % 2 === 1 : cfg.markings === "patches" ? i > 5 : false;
    const m = add(seg, sphereG, banded ? markM : bodyM, { s: [r, r * 1.35, r], p: [0, 0.03, 0], o: 0.07 });
    m.userData.baseMat = m.material;
    tail.push({ seg, mesh: m });
    parent = seg;
  }

  // legs: hip pivots in root space
  const legs = [];
  for (const [x, z] of [[-0.17, 0.2], [0.17, 0.2], [-0.17, -0.2], [0.17, -0.2]]) {
    const hip = new THREE.Group();
    hip.position.set(x, 0.36, z);
    root.add(hip);
    add(hip, legG, bodyM, { p: [0, -0.18, 0], o: 0.022 });
    add(hip, sphereG, bellyM, { p: [0, -0.33, 0.025], s: [0.09, 0.06, 0.11] });
    legs.push(hip);
  }

  // ---- animation state ----
  let t = Math.random() * 10, phase = 0, blink = 2 + Math.random() * 3, blinkT = -1, squash = 0, squashV = 0, air = 0, wasAir = false;
  let accUpdaters = [];
  const equipped = {};

  const cat = {
    root, accessories: {},
    update(dt, speed, airborne, vy = 0) {
      t += dt;
      const k = Math.min(speed / 6, 1);
      phase += dt * (6 + speed * 1.7) * (speed > 0.3 ? 1 : 0);
      air += ((airborne ? 1 : 0) - air) * Math.min(1, dt * 14);
      const sw = Math.sin(phase) * 0.9 * k * (1 - air);
      legs[0].rotation.x = sw - air * 0.6; legs[3].rotation.x = sw + air * 0.6;
      legs[1].rotation.x = -sw - air * 0.6; legs[2].rotation.x = -sw + air * 0.6;
      // squash & stretch (spring)
      if (wasAir && !airborne) squashV -= 7;
      wasAir = airborne;
      const target = airborne ? THREE.MathUtils.clamp(vy * 0.018, -0.1, 0.16) : 0;
      squashV += ((target - squash) * 220 - squashV * 14) * dt;
      squash += squashV * dt;
      const breathe = Math.sin(t * 2.2) * 0.015 * (1 - k);
      bodyGroup.scale.set(1 - squash * 0.5, 1 + squash + breathe, 1 - squash * 0.5);
      bodyGroup.position.y = Math.abs(Math.sin(phase)) * 0.07 * k * (1 - air);
      bodyGroup.rotation.x = -Math.sin(phase * 2) * 0.03 * k - air * 0.12;
      head.rotation.x = Math.sin(t * 1.3) * 0.02 - air * 0.1;
      // blink
      blink -= dt;
      if (blink < 0) { blinkT = 0; blink = 2.5 + Math.random() * 3; }
      let ey = 1;
      if (blinkT >= 0) { blinkT += dt; ey = Math.max(0.1, Math.abs(blinkT / 0.07 - 1)); if (blinkT > 0.14) blinkT = -1; }
      eyes[0].scale.y = eyes[1].scale.y = ey;
      // tail sway / swish
      const amp = 0.1 + 0.16 * k;
      for (let i = 0; i < TAIL_SEGS; i++) tail[i].seg.rotation.y = Math.sin(t * (2 + k * 3) - i * 0.55) * amp;
      tailBase.rotation.x = -1.0 + k * 0.35 + air * 0.3;
      for (let i = 0; i < accUpdaters.length; i++) accUpdaters[i](t, k);
    },
    // fur variant overlay; null = base config colors
    setPalette(p) {
      bodyM.color.set(p ? p.body : cfg.body);
      bellyM.color.set(p ? p.belly : cfg.belly);
      markM.color.set(p ? p.markingColor : cfg.markingColor);
    },
    setRainbowTail(on) {
      tail.forEach((s, i) => { s.mesh.material = on ? RAINBOW[i % RAINBOW.length] : s.mesh.userData.baseMat; });
    },
    // map: slot -> item id for hat / glasses / neck / back
    equip(map) {
      accUpdaters = [];
      for (const slot of ["hat", "glasses", "neck", "back"]) {
        const id = map && map[slot];
        if (equipped[slot] !== id) {
          const old = cat.accessories[slot];
          if (old) {
            mounts[slot].remove(old);
            old.traverse((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
            cat.accessories[slot] = null;
          }
          equipped[slot] = id;
          if (id && ACCESSORIES[id]) { cat.accessories[slot] = ACCESSORIES[id](); mounts[slot].add(cat.accessories[slot]); }
        }
        const g = cat.accessories[slot];
        if (g && g.userData.update) accUpdaters.push(g.userData.update);
      }
    },
    head, bodyGroup, mounts,
  };
  return cat;
}

export function makeNameTag(text) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 72;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(255,250,240,0.92)";
  g.beginPath(); g.roundRect(8, 8, 240, 56, 28); g.fill();
  g.lineWidth = 4; g.strokeStyle = "#3b2a4a"; g.stroke();
  g.fillStyle = "#3b2a4a"; g.font = "bold 34px ui-rounded, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 128, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false }));
  s.scale.set(1.5, 0.42, 1);
  s.position.y = 1.95;
  return s;
}
