import * as THREE from "three";
import { toon, VC, bake, bakedMesh, mat4, INK } from "./toon.js";
import { ACCESSORIES } from "./accessories.js";

// Higher-res geometry is fine here: the cats are the only detailed things on screen.
const sphereG = new THREE.SphereGeometry(1, 32, 20);
const eyeSphereG = new THREE.SphereGeometry(1, 20, 14);
const bodyG = new THREE.CapsuleGeometry(0.3, 0.3, 10, 28);
const legG = new THREE.CapsuleGeometry(0.075, 0.17, 6, 14);
const coneG = new THREE.ConeGeometry(0.15, 0.3, 4);
const torusArcG = new THREE.TorusGeometry(0.305, 0.035, 8, 28, Math.PI * 1.15);
const whiskerG = new THREE.CylinderGeometry(0.004, 0.004, 0.3, 4);
const mouthG = new THREE.TorusGeometry(0.04, 0.009, 6, 14, Math.PI);
const browG = new THREE.BoxGeometry(0.03, 0.09, 0.02);
const RAINBOW = ["#ff6b6b", "#ffa94d", "#ffe066", "#8ce99a", "#74c0fc", "#b197fc", "#f783ac"].map((c) => new THREE.Color(c));
const TAIL_SEGS = 8;
// colour slots used by bake()
const S = { body: 0, belly: 1, mark: 2, ink: 3, inner: 4, nose: 5, cheek: 6, iris: 8, irisLight: 9, white: 11 };

export function buildCat(cfg) {
  const root = new THREE.Group();
  const fur = toon("#ffffff", { vertexColors: true, rim: 0.28 });
  const faceMat = toon("#ffffff", { vertexColors: true, rim: 0.15 });
  const eyeMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const registry = []; // { b, attr, over } so fur variants can recolour without rebuilding

  const mesh = (parent, parts, mat, opts) => {
    const b = bake(parts);
    const m = bakedMesh(b, mat, opts);
    parent.add(m);
    registry.push({ b, attr: b.geo.attributes.color, over: null, lit: mat !== eyeMat });
    return m;
  };

  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);
  const bodyParts = [
    { g: bodyG, slot: S.body, p: [0, 0.5, 0], r: [Math.PI / 2, 0, 0], ol: 0.025 },
    { g: sphereG, slot: S.belly, p: [0, 0.4, 0.08], s: [0.25, 0.22, 0.36] },
    { g: sphereG, slot: S.belly, p: [0, 0.52, 0.3], s: [0.19, 0.22, 0.14] },
  ];
  if (cfg.markings === "stripes") {
    for (const z of [-0.14, 0, 0.14]) bodyParts.push({ g: torusArcG, slot: S.mark, p: [0, 0.5, z], r: [0, 0, Math.PI / 2 - Math.PI * 0.575] });
  } else if (cfg.markings === "patches") {
    bodyParts.push({ g: sphereG, slot: S.mark, p: [0.17, 0.62, -0.05], s: [0.17, 0.12, 0.2] }, { g: sphereG, slot: S.mark, p: [-0.2, 0.55, 0.12], s: [0.12, 0.16, 0.16] }, { g: sphereG, slot: S.mark, p: [0, 0.78, -0.2], s: [0.16, 0.06, 0.16] });
  }
  mesh(bodyGroup, bodyParts, fur, { cast: true });

  // head
  const head = new THREE.Group();
  head.position.set(0, 0.92, 0.4);
  bodyGroup.add(head);
  const headParts = [{ g: sphereG, slot: S.body, s: [0.46, 0.4, 0.42], ol: 0.027 }];
  const faceParts = [];
  for (const sx of [-1, 1]) {
    const earM = mat4([sx * 0.26, 0.36, -0.02], [-0.1, Math.PI / 4, -sx * 0.3]);
    headParts.push({ g: coneG, slot: S.body, m: earM, ol: 0.026, blush: true });
    faceParts.push({ g: coneG, slot: S.inner, m: mat4([0, -0.02, 0.045], [0, 0, 0], [0.62, 0.7, 0.5], earM) });
    faceParts.push({ g: sphereG, slot: S.cheek, p: [sx * 0.31, -0.07, 0.27], s: [0.07, 0.045, 0.03], r: [0, sx * 0.9, 0] });
    for (let k = 0; k < 3; k++) {
      const wm = mat4([sx * 0.3, -0.07 + k * 0.035, 0.3], [0, sx * (0.5 + k * 0.1), (k - 1) * -0.22 * sx]);
      faceParts.push({ g: whiskerG, slot: S.ink, m: mat4([sx * 0.15, 0, 0], [0, 0, Math.PI / 2], [1, 1, 1], wm) });
    }
    faceParts.push({ g: mouthG, slot: S.ink, p: [sx * 0.04, -0.085, 0.4], r: [0, 0, Math.PI] });
  }
  if (cfg.markings === "stripes") {
    for (const x of [-0.07, 0, 0.07]) faceParts.push({ g: browG, slot: S.mark, p: [x, 0.3 - Math.abs(x) * 0.3, 0.26], r: [-0.75, 0, x * 3] });
  } else if (cfg.markings === "patches") {
    headParts.push({ g: sphereG, slot: S.mark, p: [-0.2, 0.16, 0.12], s: [0.2, 0.17, 0.2] });
  }
  faceParts.push({ g: sphereG, slot: S.nose, p: [0, -0.055, 0.405], s: [0.05, 0.035, 0.03] });
  mesh(head, headParts, fur, { cast: true });
  mesh(head, faceParts, faceMat);

  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(sx * 0.17, 0.03, 0.365);
    eye.rotation.y = sx * 0.3;
    head.add(eye);
    mesh(eye, [
      { g: eyeSphereG, slot: S.ink, s: [0.125, 0.15, 0.05] },
      { g: eyeSphereG, slot: S.iris, p: [0, 0, 0.01], s: [0.108, 0.135, 0.05] },
      { g: eyeSphereG, slot: S.irisLight, p: [0, -0.07, 0.02], s: [0.06, 0.04, 0.045] },
      { g: eyeSphereG, slot: S.ink, p: [0, -0.005, 0.025], s: [0.062, 0.098, 0.04] },
      { g: eyeSphereG, slot: S.white, p: [0.035, 0.05, 0.05], s: [0.036, 0.036, 0.02] },
      { g: eyeSphereG, slot: S.white, p: [-0.025, -0.035, 0.05], s: [0.02, 0.02, 0.015] },
    ], eyeMat);
    eyes.push(eye);
  }

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
    mesh(seg, [{ g: sphereG, slot: banded ? S.mark : S.body, p: [0, 0.03, 0], s: [r, r * 1.35, r], ol: 0.012 }], fur);
    tail.push({ seg, reg: registry[registry.length - 1] });
    parent = seg;
  }

  const legs = [];
  for (const [x, z] of [[-0.17, 0.2], [0.17, 0.2], [-0.17, -0.2], [0.17, -0.2]]) {
    const hip = new THREE.Group();
    hip.position.set(x, 0.36, z);
    root.add(hip);
    mesh(hip, [{ g: legG, slot: S.body, p: [0, -0.18, 0], ol: 0.022 }, { g: sphereG, slot: S.belly, p: [0, -0.33, 0.025], s: [0.09, 0.06, 0.11] }], fur);
    legs.push(hip);
  }

  // ---- palette / recolour ----
  const pal = [];
  const cols = { body: new THREE.Color(), belly: new THREE.Color(), mark: new THREE.Color() };
  const pink = new THREE.Color("#ff9fb5"), tmp = new THREE.Color();
  function recolor() {
    pal[S.body] = cols.body; pal[S.belly] = cols.belly; pal[S.mark] = cols.mark;
    pal[S.ink] = new THREE.Color(INK); pal[S.inner] = new THREE.Color("#ffb3c1"); pal[S.nose] = new THREE.Color(cfg.nose);
    pal[S.cheek] = tmp.copy(cols.body).lerp(pink, 0.6).clone();
    pal[S.iris] = new THREE.Color(cfg.eyes); pal[S.irisLight] = new THREE.Color(cfg.eyes).lerp(new THREE.Color("#ffffff"), 0.5); pal[S.white] = new THREE.Color("#ffffff");
    for (const e of registry) {
      const { b, attr } = e, a = attr.array;
      for (let i = 0; i < b.n; i++) {
        const s = b.slot[i];
        tmp.copy(e.over && s === S.body ? e.over : pal[s]);
        if (e.lit && s <= 2) tmp.multiplyScalar(b.shade[i]);
        if (b.blush[i] > 0) tmp.lerp(pink, b.blush[i] * 0.4);
        a[i * 3] = tmp.r; a[i * 3 + 1] = tmp.g; a[i * 3 + 2] = tmp.b;
      }
      attr.needsUpdate = true;
    }
  }

  // ---- animation state ----
  let t = Math.random() * 10, phase = 0, blink = 2 + Math.random() * 3, blinkT = -1, squash = 0, squashV = 0, air = 0, wasAir = false;
  let tailYaw = 0, tailYawV = 0, headYaw = 0, headYawT = 0, crouch = 0;
  let accUpdaters = [];
  const equipped = {};

  const cat = {
    root, accessories: {},
    // turn: angular velocity (rad/s) of the body, drives a springy tail
    update(dt, speed, airborne, vy = 0, turn = 0) {
      t += dt;
      const k = Math.min(speed / 6, 1);
      phase += dt * (6 + speed * 1.7) * (speed > 0.3 ? 1 : 0);
      air += ((airborne ? 1 : 0) - air) * Math.min(1, dt * 14);
      const sw = Math.sin(phase) * 0.9 * k * (1 - air);
      legs[0].rotation.x = sw - air * 0.6; legs[3].rotation.x = sw + air * 0.6;
      legs[1].rotation.x = -sw - air * 0.6; legs[2].rotation.x = -sw + air * 0.6;
      if (wasAir && !airborne) squashV -= 7;
      wasAir = airborne;
      const target = airborne ? THREE.MathUtils.clamp(vy * 0.018, -0.1, 0.16) : -0.17 * crouch;
      squashV += ((target - squash) * 220 - squashV * 14) * dt;
      squash += squashV * dt;
      const breathe = Math.sin(t * 2.2) * 0.015 * (1 - k);
      bodyGroup.scale.set(1 - squash * 0.5, 1 + squash + breathe, 1 - squash * 0.5);
      bodyGroup.position.y = Math.abs(Math.sin(phase)) * 0.07 * k * (1 - air);
      bodyGroup.rotation.x = -Math.sin(phase * 2) * 0.03 * k - air * 0.12;
      // head glances toward things of interest (set via look()), eased
      headYaw += (headYawT - headYaw) * Math.min(1, dt * 7);
      head.rotation.y = headYaw;
      head.rotation.x = Math.sin(t * 1.3) * 0.02 - air * 0.1;
      blink -= dt;
      if (blink < 0) { blinkT = 0; blink = 2.5 + Math.random() * 3; }
      let ey = 1;
      if (blinkT >= 0) { blinkT += dt; ey = Math.max(0.1, Math.abs(blinkT / 0.07 - 1)); if (blinkT > 0.14) blinkT = -1; }
      eyes[0].scale.y = eyes[1].scale.y = ey;
      // tail: spring that lags behind body turns (secondary motion) + travelling wave
      tailYawV += ((-turn * 0.18 - tailYaw) * 90 - tailYawV * 9) * dt;
      tailYaw += tailYawV * dt;
      tailBase.rotation.y = THREE.MathUtils.clamp(tailYaw, -0.7, 0.7);
      const amp = 0.1 + 0.16 * k;
      for (let i = 0; i < TAIL_SEGS; i++) tail[i].seg.rotation.y = Math.sin(t * (2 + k * 3) - i * 0.55) * amp;
      tailBase.rotation.x = -1.0 + k * 0.35 + air * 0.3;
      for (let i = 0; i < accUpdaters.length; i++) accUpdaters[i](t, k);
    },
    setCrouch(v) { crouch = v; },
    look(yawRel) { headYawT = yawRel === null ? 0 : THREE.MathUtils.clamp(yawRel, -0.9, 0.9); },
    setPalette(p) {
      cols.body.set(p ? p.body : cfg.body); cols.belly.set(p ? p.belly : cfg.belly); cols.mark.set(p ? p.markingColor : cfg.markingColor);
      recolor();
    },
    setRainbowTail(on) {
      tail.forEach((s, i) => { s.reg.over = on ? RAINBOW[i % RAINBOW.length] : null; });
      recolor();
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
  cat.setPalette(null);
  return cat;
}

export function makeNameTag(text) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 72;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(255,250,240,0.92)";
  g.beginPath(); g.roundRect(8, 8, 240, 56, 28); g.fill();
  g.lineWidth = 4; g.strokeStyle = "#3b2a4a"; g.stroke();
  g.fillStyle = "#3b2a4a"; g.font = "bold 34px Fredoka, ui-rounded, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 128, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false }));
  s.scale.set(1.5, 0.42, 1);
  s.position.y = 1.95;
  return s;
}
