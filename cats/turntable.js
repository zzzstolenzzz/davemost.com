// Start-screen stage: both cats on little turntables. Tap one to pick it. Disposed before the game starts.
import * as THREE from "three";
import { buildCat } from "./cat.js";
import { toon } from "./toon.js";
import { CATS } from "./config.js";

export function createTurntable(canvas, selectedId, onPick) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xc4d2ff, 0xffdcb4, 1.9));
  const sun = new THREE.DirectionalLight(0xffe2bc, 2.7); sun.position.set(2, 4, 3); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 1.5, 6.2); camera.lookAt(0, 0.7, 0);
  const slots = CATS.map((cfg, i) => {
    const g = new THREE.Group(), cat = buildCat(cfg);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.18, 36), toon(i ? "#9cc4f5" : "#ffa9c3", { rim: 0.1 }));
    base.position.y = -0.09;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.97, 0.04, 8, 36), toon("#ffffff", { rim: 0 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.0;
    cat.root.scale.setScalar(1.25);
    g.add(base, ring, cat.root);
    g.position.x = (i - (CATS.length - 1) / 2) * 2.5;
    scene.add(g);
    return { id: cfg.id, g, cat, base, spin: i ? 2.4 : 0.4, bounce: 0 };
  });
  let sel = selectedId, raf = 0, last = performance.now(), alive = true;
  function resize() {
    const w = canvas.clientWidth || 520, h = canvas.clientHeight || 300;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  resize(); addEventListener("resize", resize);
  function frame(now) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (const s of slots) {
      const on = s.id === sel;
      s.spin += dt * (on ? 0.9 : 0.3);
      s.g.rotation.y = on ? Math.sin(s.spin * 0.8) * 0.5 : s.spin * 0.3;
      s.bounce += ((on ? 1 : 0) - s.bounce) * Math.min(1, dt * 8);
      const k = 1 + s.bounce * 0.12;
      s.g.scale.setScalar(k); s.g.position.y = s.bounce * (0.1 + Math.abs(Math.sin(now / 400)) * 0.08);
      s.cat.update(dt, 0, false, 0);
    }
    renderer.render(scene, camera);
  }
  frame(performance.now());
  canvas.addEventListener("pointerdown", (e) => {
    const r = canvas.getBoundingClientRect(), i = Math.min(slots.length - 1, Math.floor(((e.clientX - r.left) / r.width) * slots.length));
    onPick(slots[i].id);
  });
  return {
    select(id) { sel = id; },
    dispose() { alive = false; cancelAnimationFrame(raf); removeEventListener("resize", resize); renderer.dispose(); renderer.forceContextLoss(); },
  };
}
