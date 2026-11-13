import * as THREE from "three";
import { buildWorld } from "./world.js";
import { buildCat, makeNameTag } from "./cat.js";
import { createControls } from "./controls.js";
import { createPerf } from "./perf.js";
import { createPost } from "./post.js";
import { createFX } from "./fx.js";
import { createShop } from "./shopui.js";
import { createFinder } from "./finder.js";
import { fancy } from "./fancy.js";
import { toon } from "./toon.js";
import * as sfx from "./audio.js";
import { CATS } from "./config.js";
import { itemById, upgradeValue, COIN_REWARD } from "./shop.js";
import { heightAt, clampToIsland, resolveCollisions, SPAWN } from "./terrain.js";

const $ = (id) => document.getElementById(id);
const FISH_TOTAL = 10;

export function applyLook(cat, eq, catId) {
  eq = eq || {};
  cat.equip(eq);
  const fur = eq.fur && itemById(eq.fur);
  cat.setPalette(fur && fur.cat === catId ? fur.palette : null);
  cat.setRainbowTail(eq.fx === "fx_rainbow");
}

// session: { uid, P (progress), save(patch), publish(state)|null, watchPlayers(cb)|null }
export async function startGame({ session, flags }) {
  const P = session.P;
  if (flags.coins) P.coins = +flags.coins || 0; // dev only (flags is empty outside ?dev=1)
  const catCfg = CATS.find((c) => c.id === P.cat) || CATS[0];

  if (startGame.started) return; // never run two render loops
  startGame.started = true;

  // ---------- renderer + quality tiers ----------
  const canvas = $("c");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" }); // AA comes from FXAA in the post pass
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 900);
  const dpr = devicePixelRatio || 1;
  const TIERS = {
    high: { post: true, maxPR: Math.min(dpr, 2), grass: 3900, grassFar: 2400, flowers: 700, ambient: 150, shadow: 2048 },
    low: { post: false, maxPR: Math.min(dpr, 1.25), grass: 2000, grassFar: 1100, flowers: 350, ambient: 60, shadow: 1024 },
  };
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  let setting = flags.tier || ls.get("cats.quality") || "auto"; // auto | high | low
  let tier = setting === "auto" ? ls.get("cats.tier") || "high" : setting;
  if (!TIERS[tier]) tier = "high";
  const fixedQuality = !!flags.fixed; // dev: no automatic changes (swiftshader is slow by nature)
  let scale = Math.min(TIERS[tier].maxPR, 1.5), scaleCeil = TIERS[tier].maxPR;
  const post = createPost(renderer);
  const fx = createFX(scene);
  const world = buildWorld(scene);
  function applyScale() {
    renderer.setPixelRatio(scale);
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    post.setSize(Math.round(innerWidth * scale), Math.round(innerHeight * scale));
    fx.setViewportHeight(innerHeight * scale); world.setViewportHeight(innerHeight * scale, scale);
  }
  function setTier(name, persistAuto) {
    tier = name;
    fancy.on = tier === "high"; // sparkle flourishes on accessories: High only
    const T = TIERS[tier];
    world.setQuality(T);
    scaleCeil = T.maxPR; scale = Math.min(scale, T.maxPR);
    if (persistAuto) ls.set("cats.tier", tier);
    document.querySelectorAll("#settings [data-q]").forEach((b) => b.classList.toggle("on", b.dataset.q === setting));
    $("qualityNote").textContent = `Now: ${tier === "high" ? "High" : "Low"}`;
    applyScale();
  }
  setTier(tier, false);
  addEventListener("resize", applyScale);
  $("gearBtn").addEventListener("click", () => ($("settings").hidden = !$("settings").hidden));
  document.querySelectorAll("#settings [data-q]").forEach((b) => b.addEventListener("click", () => {
    setting = b.dataset.q; ls.set("cats.quality", setting);
    setTier(setting === "auto" ? (ls.get("cats.tier") || "high") : setting, false);
  }));
  // dynamic resolution: rolling frame time with hysteresis; falls to Low tier only in Auto mode
  const ad = { ema: 16.7, bad: 0, good: 0, cool: 0, frames: 0, raisedAt: -1e9, lowSince: 0 };
  function adapt(ms, nowS) {
    if (fixedQuality || ms > 120) return;
    ad.frames++; ad.ema += (ms - ad.ema) * 0.06;
    if (ad.frames < 120 || nowS - ad.cool < 1.5 || shop.isOpen) return;
    if (ad.ema > 20) {
      ad.bad++; ad.good = 0;
      if (ad.bad > 40) {
        ad.bad = 0; ad.cool = nowS;
        if (nowS - ad.raisedAt < 5) scaleCeil = Math.max(0.75, scale - 0.125); // the last raise didn't hold: don't try that again
        if (scale > 0.76) { scale = Math.max(0.75, scale - 0.125); applyScale(); }
        else if (tier === "high" && setting === "auto" && ad.ema > 24) { setTier("low", true); }
      }
    } else if (ad.ema < 17.8) {
      ad.good++; ad.bad = 0;
      if (ad.good > 360 && scale < scaleCeil - 0.01) { ad.good = 0; ad.cool = nowS; ad.raisedAt = nowS; scale = Math.min(scaleCeil, scale + 0.125); applyScale(); }
    } else { ad.bad = 0; ad.good = 0; }
  }

  const controls = createControls({ surface: canvas, stick: $("stick"), knob: $("knob"), jumpBtn: $("jump") });
  const close = flags.cam === "close";
  controls.yaw = close ? Math.PI : 0.3;
  controls.pitch = close ? 0.1 : 0.5;
  if (flags.yaw) controls.yaw = +flags.yaw;
  if (flags.pitch) controls.pitch = +flags.pitch;

  // ---------- player ----------
  const me = buildCat(catCfg);
  scene.add(me.root);
  const pl = { x: SPAWN.x, y: heightAt(SPAWN.x, SPAWN.z), z: SPAWN.z, vy: 0, vx: 0, vz: 0, rot: 0, grounded: true, speed: 0, usedDouble: false };
  if (flags.at) { const [ax, az] = flags.at.split(",").map(Number); pl.x = ax; pl.z = az; pl.y = heightAt(ax, az); }
  me.root.position.set(pl.x, pl.y, pl.z);
  applyLook(me, P.equipped, catCfg.id);

  // ---------- HUD ----------
  const fishCount = () => Object.keys(P.fish).length;
  const setFishHud = () => ($("fishCount").textContent = `Fish ${fishCount()}/${FISH_TOTAL}`);
  let coinShown = P.coins, coinText = -1;
  const popEl = (text, cls = "") => {
    const d = document.createElement("div");
    d.className = "pop " + cls; d.textContent = text;
    $("hud").appendChild(d);
    setTimeout(() => d.remove(), 1400);
  };
  const bump = (el) => { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); };
  let saveTimer = 0;
  const saveCoinsSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => session.save({ coins: P.coins }), 1500); };
  addEventListener("pagehide", () => session.save({ coins: P.coins }));
  const addCoins = (n, label) => {
    P.coins += n; saveCoinsSoon(); sfx.coin(); bump($("coinPill"));
    if (label !== false) popEl(`+${n} 🐾`, "coin");
  };
  const banner = (text) => { const b = $("banner"); b.textContent = text; b.classList.add("show"); setTimeout(() => b.classList.remove("show"), 4200); };
  setFishHud();
  $("coinPill").hidden = false;

  // ---------- fish ----------
  for (const f of world.fish) if (P.fish[f.id]) f.got = true;
  const collectFish = (f) => {
    f.got = true; P.fish[f.id] = true;
    session.save({ cat: P.cat, ["fish/" + f.id]: true });
    sfx.chime(); popEl("+1 🐟"); setFishHud(); bump($("fishPill"));
    fx.ring(f.x, f.group.position.y - 0.4, f.z); fx.burst(f.x, f.group.position.y, f.z, 26, 3.2, 0.9, 0.22, "#ffe27a", 2);
    addCoins(COIN_REWARD.fish, false); popEl(`+${COIN_REWARD.fish} 🐾`, "coin2");
    if (fishCount() >= FISH_TOTAL) {
      addCoins(COIN_REWARD.allFish, false);
      sfx.fanfare(); setTimeout(sfx.meow, 900);
      burstConfetti(); banner("You found all the fish! 🎉  +" + COIN_REWARD.allFish + " 🐾");
    }
  };

  // ---------- confetti ----------
  const CN = 160;
  const conf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.2, 0.12), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false }), CN);
  conf.frustumCulled = false; conf.visible = false;
  const cdat = new Float32Array(CN * 8); // x y z vx vy vz spin life
  const cd = new THREE.Object3D(), cc = new THREE.Color(), CCOLS = ["#ff6b6b", "#ffd43b", "#69db7c", "#4dabf7", "#da77f2", "#ff8fab"];
  for (let i = 0; i < CN; i++) conf.setColorAt(i, cc.set(CCOLS[i % 6]));
  scene.add(conf);
  let confT = 0;
  function burstConfetti() {
    for (let i = 0; i < CN; i++) {
      const a = Math.random() * 6.283, s = 2 + Math.random() * 6, o = i * 8;
      cdat[o] = pl.x; cdat[o + 1] = pl.y + 1.2; cdat[o + 2] = pl.z;
      cdat[o + 3] = Math.cos(a) * s; cdat[o + 4] = 6 + Math.random() * 7; cdat[o + 5] = Math.sin(a) * s;
      cdat[o + 6] = Math.random() * 10; cdat[o + 7] = 0;
    }
    confT = 4; conf.visible = true;
  }
  function updateConfetti(dt) {
    if (confT <= 0) return;
    confT -= dt;
    for (let i = 0; i < CN; i++) {
      const o = i * 8;
      cdat[o + 4] -= 9 * dt; cdat[o + 3] *= 0.99; cdat[o + 5] *= 0.99;
      cdat[o] += cdat[o + 3] * dt; cdat[o + 1] += cdat[o + 4] * dt; cdat[o + 2] += cdat[o + 5] * dt;
      cdat[o + 7] += dt;
      const gy = heightAt(cdat[o], cdat[o + 2]) + 0.05;
      if (cdat[o + 1] < gy) { cdat[o + 1] = gy; cdat[o + 3] *= 0.8; cdat[o + 4] = 0; cdat[o + 5] *= 0.8; }
      cd.position.set(cdat[o], cdat[o + 1], cdat[o + 2]);
      cd.rotation.set(cdat[o + 6] + cdat[o + 7] * 6, cdat[o + 7] * 3, 0);
      cd.scale.setScalar(confT < 1 ? Math.max(0, confT) : 1);
      cd.updateMatrix(); conf.setMatrixAt(i, cd.matrix);
    }
    conf.instanceMatrix.needsUpdate = true;
    if (confT <= 0) conf.visible = false;
  }

  // ---------- coins ----------
  const C = world.coins, spot = { x: 0, y: 0, z: 0 }, cdum = new THREE.Object3D();
  C.items.forEach((c) => { world.randomSpot(spot); c.x = spot.x; c.y = spot.y; c.z = spot.z; c.alive = true; c.pop = 1; });
  function updateCoins(dt, t) {
    const mag = upgradeValue("magnet", P.upgrades.magnet | 0), lk = upgradeValue("lucky", P.upgrades.lucky | 0);
    let magNear = false;
    for (let i = 0; i < C.items.length; i++) {
      const c = C.items[i];
      if (!c.alive) {
        c.respawn -= dt;
        if (c.respawn <= 0) { world.randomSpot(spot); c.x = spot.x; c.y = spot.y; c.z = spot.z; c.alive = true; c.pop = 0; }
        cdum.scale.setScalar(0); cdum.updateMatrix(); C.mesh.setMatrixAt(i, cdum.matrix);
        continue;
      }
      let dx = pl.x - c.x, dz = pl.z - c.z, dy = pl.y + 0.6 - (c.y + 0.9);
      const d = Math.hypot(dx, dy, dz);
      if (mag && d < mag) {
        const sp = (4 + 14 * (1 - d / mag)) * dt / Math.max(d, 0.01); c.x += dx * sp; c.z += dz * sp; c.y += dy * sp; magNear = true;
        if (Math.random() < dt * 14) fx.emit(c.x, c.y + 0.9, c.z, 0, 0.2, 0, 0.35, 0.16, "#ffe9a0", 0, -0.6); // sparkle trail on coins streaming in
      }
      if (d < 1.2) {
        c.alive = false; c.respawn = 7 + Math.random() * 8; addCoins(1 + lk, false); popEl(`+${1 + lk} 🐾`, "coin"); fx.burst(c.x, c.y + 0.9, c.z, 9, 2.6, 0.55, 0.2, "#ffe27a", 3);
        if (lk) fx.burst(c.x, c.y + 1.0, c.z, 6 + lk * 3, 2.2, 0.8, 0.22, "#ffd43b", -1); // Lucky Paw: golden sparkle
        continue;
      }
      c.pop = Math.min(1, c.pop + dt * 3);
      cdum.position.set(c.x, c.y + 0.9 + Math.sin(t * 2.5 + c.phase) * 0.12, c.z);
      cdum.rotation.set(0, t * 2.2 + c.phase, 0);
      cdum.scale.setScalar(c.pop);
      cdum.updateMatrix(); C.mesh.setMatrixAt(i, cdum.matrix);
    }
    C.mesh.instanceMatrix.needsUpdate = true;
    // Coin Magnet: a faint pulsing ring at the pull radius while coins are in range
    magRing.visible = magNear;
    if (magNear) { magRing.position.set(pl.x, pl.y + 0.08, pl.z); magRing.scale.setScalar(mag * (0.97 + 0.03 * Math.sin(t * 5))); magRing.material.opacity = 0.2 + 0.12 * Math.sin(t * 5); }
  }
  const magRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffd43b, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  magRing.rotation.x = -Math.PI / 2; magRing.visible = false; scene.add(magRing);

  // Leaf Glide canopy: a little leaf umbrella over the cat while gliding (local player only)
  const GLIDE_FALL = [0, 3.2, 2.2, 1.3];
  const canopy = new THREE.Group();
  { const dome = new THREE.Mesh(new THREE.LatheGeometry([[0, 0.34], [0.18, 0.32], [0.38, 0.2], [0.5, 0.04], [0.46, 0.0]].map(([r, y]) => new THREE.Vector2(r, y)), 24), toon("#7ed957", { rim: 0.3, side: THREE.DoubleSide }));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 6), toon("#8a5a2b"));
    dome.position.y = 0.45; stem.position.y = 0.2; canopy.add(dome, stem); canopy.position.y = 1.55; canopy.visible = false; me.root.add(canopy); }
  let canopyS = 0, gliding = false, glideT = 0;
  function updateGlide(dt, t) {
    const gl = P.upgrades.glide | 0;
    canopyS += ((gliding ? 1 : 0) - canopyS) * Math.min(1, dt * 10);
    canopy.visible = canopyS > 0.03;
    if (!canopy.visible) return;
    canopy.scale.setScalar(canopyS * (0.8 + 0.12 * gl));
    canopy.rotation.set(Math.sin(t * 3) * 0.08, t * 1.5, Math.cos(t * 2.4) * 0.08);
    if (gliding && (glideT -= dt) < 0) { glideT = 0.12; fx.emit(pl.x + (Math.random() - 0.5) * 0.7, pl.y + 1.4, pl.z + (Math.random() - 0.5) * 0.7, 0, -0.4, 0, 0.7, 0.16, "#b2f2bb", 0, -0.5); }
  }

  // Zoomies: coloured wind streaks while running; the top tier shimmers through rainbow colours
  const SPEED_COL = ["#ffffff", "#9be7ff", "#ffe066", "#ff9ecb"];
  let speedT = 0, speedI = 0;
  function updateSpeedFx(dt) {
    const lv = P.upgrades.speed | 0;
    if (!lv || !pl.grounded || pl.speed < 4.5) return;
    if ((speedT -= dt) > 0) return;
    speedT = [0, 0.07, 0.045, 0.025][lv];
    const side = (Math.random() - 0.5) * 0.6, bx = -Math.cos(pl.rot), bz = Math.sin(pl.rot);
    fx.emit(pl.x - Math.sin(pl.rot) * 0.3 + bx * side, pl.y + 0.15 + Math.random() * 0.5, pl.z - Math.cos(pl.rot) * 0.3 + bz * side, -pl.vx * 0.25, 0.1, -pl.vz * 0.25, 0.4, 0.14 + lv * 0.04, lv === 3 ? TCOLS[speedI++ % 5] : SPEED_COL[lv], 0, -0.7);
  }

  // ---------- trails (local player only): glitter via the shared particle pool, paw prints as decals ----------
  const pawG = new THREE.CircleGeometry(0.1, 8); pawG.scale(1, 1.1, 1);
  const pawParts = [pawG.clone()];
  [[-0.14, 0.14], [-0.05, 0.2], [0.05, 0.2], [0.14, 0.14]].forEach(([x, z]) => { const g = new THREE.CircleGeometry(0.045, 6); g.translate(x, z, 0); pawParts.push(g); });
  const pawPos = []; pawParts.forEach((g) => { const gi = g.index ? g.toNonIndexed() : g, a = gi.attributes.position; for (let i = 0; i < a.count; i++) pawPos.push(a.getX(i), a.getY(i), a.getZ(i)); });
  const pawGeo = new THREE.BufferGeometry(); pawGeo.setAttribute("position", new THREE.Float32BufferAttribute(pawPos, 3));
  const pawI = new THREE.InstancedMesh(pawGeo, new THREE.MeshBasicMaterial({ color: 0x7a5a3a, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }), 30);
  pawI.frustumCulled = false;
  for (let i = 0; i < 30; i++) { cdum.scale.setScalar(0); cdum.updateMatrix(); pawI.setMatrixAt(i, cdum.matrix); }
  const tr = { pw: new Float32Array(30 * 5), pi: 0, tS: 0, tP: 0, foot: 1, pawActive: false };
  const TCOLS = ["#ff9ecb", "#ffe066", "#8ce99a", "#74c0fc", "#d0a8ff"];
  scene.add(pawI);
  function updateTrails(dt, moving) {
    const fxId = P.equipped.fx;
    if (fxId === "fx_glitter" && moving) { tr.tS -= dt; if (tr.tS <= 0) { tr.tS = 0.04; fx.emit(pl.x + (Math.random() - 0.5) * 0.5, pl.y + 0.3 + Math.random() * 0.5, pl.z + (Math.random() - 0.5) * 0.5, 0, 0.5 + Math.random() * 0.4, 0, 0.8, 0.2, TCOLS[(Math.random() * 5) | 0], 0, -0.6); } }
    if (fxId === "fx_paws" && moving && pl.grounded) {
      tr.tP -= dt;
      if (tr.tP <= 0) { tr.tP = 0.3; tr.foot = -tr.foot; const o = tr.pi++ % 30 * 5, c = Math.cos(pl.rot), s = Math.sin(pl.rot); tr.pw[o] = pl.x + c * tr.foot * 0.17; tr.pw[o + 1] = pl.y + 0.04; tr.pw[o + 2] = pl.z - s * tr.foot * 0.17; tr.pw[o + 3] = pl.rot; tr.pw[o + 4] = 4; tr.pawActive = true; }
    }
    if (!tr.pawActive) return;
    let any = false;
    cdum.rotation.order = "YXZ";
    for (let i = 0; i < 30; i++) {
      const o = i * 5; tr.pw[o + 4] = Math.max(0, tr.pw[o + 4] - dt);
      if (tr.pw[o + 4] > 0) any = true;
      cdum.position.set(tr.pw[o], tr.pw[o + 1], tr.pw[o + 2]); cdum.rotation.set(Math.PI / 2, tr.pw[o + 3], 0);
      cdum.scale.setScalar(Math.min(1, tr.pw[o + 4]));
      cdum.updateMatrix(); pawI.setMatrixAt(i, cdum.matrix);
    }
    cdum.rotation.order = "XYZ";
    pawI.instanceMatrix.needsUpdate = true;
    tr.pawActive = any;
  }

  // ---------- remote players ----------
  const remotes = new Map();
  const finder = createFinder({ camera, hud: $("hud") });
  function onPlayers(all) {
    const now = performance.now();
    for (const [uid, v] of Object.entries(all)) {
      if (uid === session.key || !v || !/^[A-Za-z0-9]+_[a-z0-9]{8,10}$/.test(uid)) continue; // not me (full uid_sid key); old bare-uid records ignored
      const cfg = CATS.find((c) => c.id === v.cat); if (!cfg) continue;
      let r = remotes.get(uid);
      if (!r || r.catId !== v.cat) {
        if (r) scene.remove(r.cat.root);
        const name = cfg.name + (v.cat === catCfg.id ? " 2" : ""), cat = buildCat(cfg), tag = makeNameTag(name, cfg.body); // same cat as mine: "2" tells them apart
        tag.material.depthTest = false; tag.renderOrder = 5; // stays readable behind hills and trees
        cat.root.add(tag);
        scene.add(cat.root);
        r = { cat, tag, cfg, name, catId: v.cat, x: v.x, y: v.y, z: v.z, rot: v.rotY, speed: 0, eq: "" };
        cat.root.position.set(v.x, v.y, v.z); remotes.set(uid, r);
        sfx.chime(); // her sister just came online
      }
      r.tx = v.x; r.ty = v.y; r.tz = v.z; r.trot = v.rotY; r.seen = now;
      const eqs = JSON.stringify(v.equipped || {});
      if (eqs !== r.eq) { r.eq = eqs; applyLook(r.cat, v.equipped, v.cat); }
    }
    for (const [uid, r] of remotes) if (!all[uid]) { scene.remove(r.cat.root); remotes.delete(uid); }
  }
  if (session.watchPlayers) session.watchPlayers(onPlayers);
  // dev (?dev=1&ghost=1): a fake second player wandering the island, fed through the same onPlayers path as a real one.
  // ghostat=x,z parks it; window.__g.ghost.fixed = {x, z} does the same from a test.
  const ghost = { wear: flags.ghostwear ? Object.fromEntries(flags.ghostwear.split(",").map((id) => [itemById(id)?.slot, id]).filter(([k]) => k)) : null, key: session.uid + "_ghost00001", fixed: flags.ghostat ? { x: +flags.ghostat.split(",")[0], z: +flags.ghostat.split(",")[1] } : null };
  if (flags.ghost) {
    const other = CATS.find((c) => c.id !== catCfg.id) || CATS[0];
    const tick = () => {
      const a = performance.now() / 1000 * 0.35;
      let x = -10 + 20 * Math.cos(a), z = 30 + 15 * Math.sin(a), rot = Math.atan2(-20 * Math.sin(a), 15 * Math.cos(a));
      if (ghost.fixed) { x = ghost.fixed.x; z = ghost.fixed.z; }
      onPlayers({ [ghost.key]: { cat: other.id, x, y: heightAt(x, z), z, rotY: rot, ...(ghost.wear ? { equipped: ghost.wear } : {}) } });
    };
    tick(); setInterval(tick, 110);
  }
  const angleLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
  function updateRemotes(dt) {
    const now = performance.now();
    for (const [uid, r] of remotes) {
      if (now - r.seen > 30000) { scene.remove(r.cat.root); remotes.delete(uid); continue; }
      const k = 1 - Math.exp(-dt * 9), ox = r.x, oz = r.z;
      r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; r.z += (r.tz - r.z) * k; r.rot = angleLerp(r.rot, r.trot, k);
      const sp = Math.hypot(r.x - ox, r.z - oz) / Math.max(dt, 0.001);
      r.speed += (sp - r.speed) * Math.min(1, dt * 8);
      r.cat.root.position.set(r.x, r.y, r.z); r.cat.root.rotation.y = r.rot;
      r.cat.update(dt, r.speed, r.y - heightAt(r.x, r.z) > 0.25, 0);
    }
  }

  // ---------- shop ----------
  const shop = createShop({ renderer, P, session, catCfg, onEquipChange: () => applyLook(me, P.equipped, catCfg.id), controls, sfx, hudCoin: bump });
  $("shopBtn").addEventListener("click", () => shop.open());
  $("shopPrompt").addEventListener("click", () => shop.open());
  addEventListener("keydown", (e) => { if (e.code === "KeyE" && !shop.isOpen && !$("shopPrompt").hidden) shop.open(); if (e.code === "Escape") shop.close(); });

  // ---------- camera / light ----------
  const camTarget = new THREE.Vector3(pl.x, pl.y + 1.1, pl.z), camPos = new THREE.Vector3(), want = new THREE.Vector3();
  let camInit = false;
  const camDist0 = close ? 3.4 : 8.6;
  let zoomS = controls.zoom, idleF = 1, idleT = 0; // zoomS: the player's pinch/wheel zoom, eased; idleF: the slow ease-in when standing still
  function updateCamera(dt) {
    const ty = pl.y + (close ? 0.95 : 1.15), kt = 1 - Math.exp(-dt * 10);
    camTarget.x += (pl.x - camTarget.x) * kt; camTarget.y += (ty - camTarget.y) * kt; camTarget.z += (pl.z - camTarget.z) * kt;
    zoomS += (controls.zoom - zoomS) * (1 - Math.exp(-dt * 9));
    idleF += ((idleT > 2.5 ? 0.86 : 1) - idleF) * (1 - Math.exp(-dt * 1.4)); // gently ease in when standing still
    const camDist = camDist0 * zoomS * idleF;
    const cp = Math.cos(controls.pitch), sp = Math.sin(controls.pitch);
    want.set(camTarget.x - Math.sin(controls.yaw) * cp * camDist, camTarget.y + sp * camDist, camTarget.z - Math.cos(controls.yaw) * cp * camDist);
    want.y = Math.max(want.y, heightAt(want.x, want.z) + 0.9);
    if (!camInit) { camPos.copy(want); camInit = true; } else camPos.lerp(want, 1 - Math.exp(-dt * 7));
    camPos.y = Math.max(camPos.y, heightAt(camPos.x, camPos.z) + 0.6);
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
  }

  // ---------- main loop ----------
  const mv = { x: 0, y: 0 }, inp = { held: false, ang: 0, yaw: controls.yaw };
  // dev (?camtest=1): hold the stick toward the screen for 5 s of game time and log camera yaw vs heading + path straightness
  const camTest = flags.camtest ? {
    t: 0, n: 0, x0: 0, z0: 0, dev: 0, hx: 0, hz: 0, done: false,
    drive(m) { if (this.t > 0.5 && this.t < 5.5) { m.x = 0; m.y = -1; } },
    log(dt) {
      if (this.done) return;
      this.t += dt;
      if (this.t > 1.0 && !this.hx && !this.hz) { this.x0 = pl.x; this.z0 = pl.z; this.hx = Math.sin(pl.rot); this.hz = Math.cos(pl.rot); }
      if (this.hx || this.hz) this.dev = Math.max(this.dev, Math.abs((pl.x - this.x0) * this.hz - (pl.z - this.z0) * this.hx));
      const d = Math.atan2(Math.sin(pl.rot - controls.yaw), Math.cos(pl.rot - controls.yaw));
      if (this.n++ % 6 === 0) console.log(`CAMTEST t=${this.t.toFixed(2)} yaw=${controls.yaw.toFixed(3)} heading=${pl.rot.toFixed(3)} off=${(d * 57.3).toFixed(1)}deg speed=${pl.speed.toFixed(1)} pos=${pl.x.toFixed(2)},${pl.z.toFixed(2)}`);
      if (this.t > 5.5) { this.done = true; console.log(`CAMTEST done: final off=${(d * 57.3).toFixed(1)}deg, max sideways drift of path=${this.dev.toFixed(3)}m`); }
    },
  } : null;
  const perf = flags.debug ? createPerf(renderer) : null;
  let last = performance.now(), t = 0, stepT = 0, lastSent = 0, sentMoving = false, lastDoorCheck = 0, prevRot = 0, turnRate = 0, lastGrounded = true;
  const hasRadar = () => (P.upgrades.radar | 0) > 0;
  let radarNear = -1;
  const radarEl = $("radar"), radarArrow = $("radarArrow"), radarDist = $("radarDist");
  const door = world.door;

  let camSync = false;
  function frame(now) {
    if (!camSync) requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    if (perf) perf.begin(now);
    renderer.info.reset();

    // input -> velocity (camera relative)
    controls.blocked = shop.isOpen;
    controls.read(mv);
    if (camTest) camTest.drive(mv);
    // Movement is camera-relative, but the camera now swings behind the cat by itself. To stop that feeding back
    // (stick held toward the screen -> camera turns -> "toward the screen" changes -> cat curves), the camera yaw used
    // for input is LATCHED while the stick is held roughly steady. It re-latches when the stick is released, moved to a
    // clearly new direction (> ~35 degrees), or while the player is dragging the camera.
    {
      const m = Math.hypot(mv.x, mv.y);
      if (m < 0.15) inp.held = false;
      else {
        const a = Math.atan2(mv.x, mv.y);
        if (!inp.held || controls.orbiting || Math.abs(Math.atan2(Math.sin(a - inp.ang), Math.cos(a - inp.ang))) > 0.6) { inp.held = true; inp.ang = a; inp.yaw = controls.yaw; }
      }
    }
    const sy = Math.sin(inp.yaw), cy = Math.cos(inp.yaw);
    const maxSp = 7.2 * upgradeValue("speed", P.upgrades.speed | 0), mag = Math.min(1, Math.hypot(mv.x, mv.y));
    const dx = sy * mv.y - cy * mv.x, dz = cy * mv.y + sy * mv.x;
    const dl = Math.hypot(dx, dz) || 1;
    const k = 1 - Math.exp(-dt * (pl.grounded ? 12 : 4));
    pl.vx += ((dx / dl) * mag * maxSp - pl.vx) * k;
    pl.vz += ((dz / dl) * mag * maxSp - pl.vz) * k;
    pl.x += pl.vx * dt; pl.z += pl.vz * dt;
    clampToIsland(pl); resolveCollisions(pl);
    pl.speed = Math.hypot(pl.vx, pl.vz);
    if (pl.speed > 0.4) pl.rot = angleLerp(pl.rot, Math.atan2(pl.vx, pl.vz), 1 - Math.exp(-dt * 12));

    // jump / gravity / terrain
    const jv = upgradeValue("jump", P.upgrades.jump | 0), jumpV = 8.8 * (jv === "double" ? 1.4 : jv), ground = heightAt(pl.x, pl.z);
    if (controls.takeJump()) {
      if (pl.grounded && !pl.wind) { pl.wind = 0.09; me.setCrouch(1); } // anticipation squash, then launch
      else if (!pl.grounded && jv === "double" && !pl.usedDouble) {
        pl.vy = jumpV * 0.9; pl.usedDouble = true; sfx.jump2(); me.bounce(5);
        fx.ring(pl.x, pl.y + 0.1, pl.z); fx.burst(pl.x, pl.y + 0.3, pl.z, 12, 2.2, 0.6, 0.26, "#ffe27a", 0); fx.burst(pl.x, pl.y + 0.3, pl.z, 8, 1.6, 0.5, 0.22, "#ff9ecb", 0); fx.dust(pl.x, pl.y, pl.z, 5, 1);
      }
    }
    if (pl.wind) {
      pl.wind -= dt;
      if (pl.wind <= 0) { pl.wind = 0; me.setCrouch(0); if (pl.grounded) { pl.vy = jumpV; pl.grounded = false; pl.usedDouble = false; sfx.jump(); fx.dust(pl.x, pl.y, pl.z, 4 + 2 * (P.upgrades.jump | 0), 0.8); me.bounce(1.5 * (P.upgrades.jump | 0)); } }
    }
    if (pl.grounded) {
      gliding = false;
      pl.y += (ground - pl.y) * Math.min(1, dt * 25);
      if (pl.y - ground > 0.4) pl.grounded = false; // walked off a ledge
    } else {
      pl.vy -= 24 * dt;
      const gf = GLIDE_FALL[Math.min(3, P.upgrades.glide | 0)];
      gliding = gf > 0 && controls.jumpHeld && pl.vy < 0 && !shop.isOpen && !pl.wind;
      if (gliding) pl.vy = Math.max(pl.vy, -gf);
      pl.y += pl.vy * dt;
      if (pl.y <= ground && pl.vy <= 0) { pl.y = ground; pl.vy = 0; pl.grounded = true; }
    }
    me.root.position.set(pl.x, pl.y, pl.z);
    me.root.rotation.y = pl.rot;
    if (pl.grounded && !lastGrounded) { fx.dust(pl.x, pl.y, pl.z, 9, 1.5); sfx.step(); } // landing puff
    lastGrounded = pl.grounded;
    const dRot = Math.atan2(Math.sin(pl.rot - prevRot), Math.cos(pl.rot - prevRot)); prevRot = pl.rot;
    turnRate += (dRot / Math.max(dt, 0.001) - turnRate) * Math.min(1, dt * 10);
    // glance at the nearest collectible / butterfly
    let nd = 49, nx = 0, nz = 0;
    for (let i = 0; i < world.fish.length; i++) { const f = world.fish[i]; if (f.got) continue; const q = (f.x - pl.x) ** 2 + (f.z - pl.z) ** 2; if (q < nd) { nd = q; nx = f.x; nz = f.z; } }
    for (let i = 0; i < world.butterflies.length; i++) { const p = world.butterflies[i].group.position, q = (p.x - pl.x) ** 2 + (p.z - pl.z) ** 2; if (q < nd) { nd = q; nx = p.x; nz = p.z; } }
    for (let i = 0; i < C.items.length; i++) { const c = C.items[i]; if (!c.alive) continue; const q = (c.x - pl.x) ** 2 + (c.z - pl.z) ** 2; if (q < nd) { nd = q; nx = c.x; nz = c.z; } }
    me.look(nd < 49 && !flags.nolook ? Math.atan2(Math.sin(Math.atan2(nx - pl.x, nz - pl.z) - pl.rot), Math.cos(Math.atan2(nx - pl.x, nz - pl.z) - pl.rot)) : null);
    me.update(dt, pl.grounded ? pl.speed : pl.speed * 0.6, !pl.grounded, pl.vy, turnRate);
    idleT = pl.speed < 0.3 && pl.grounded ? idleT + dt : 0;
    stepT += dt * pl.speed * 0.55;
    if (stepT > 1) { stepT = 0; if (pl.grounded && pl.speed > 1) { sfx.step(); if (pl.speed > 5) fx.dust(pl.x - pl.vx * 0.04, pl.y, pl.z - pl.vz * 0.04, 2, 0.5); } }

    if (perf) perf.mark();
    // world + gameplay
    world.update(dt, t, pl.x, pl.z);
    for (const f of world.fish) {
      if (f.got) continue;
      const p = f.group.position, ddx = p.x - pl.x, ddz = p.z - pl.z;
      if (ddx * ddx + ddz * ddz < 2.2 && Math.abs(p.y - (pl.y + 0.6)) < 1.8) collectFish(f);
    }
    for (const b of world.butterflies) {
      if (b.cd > 0) continue;
      const p = b.group.position, ddx = p.x - pl.x, ddz = p.z - pl.z;
      if (ddx * ddx + ddz * ddz < 1.3 && Math.abs(p.y - (pl.y + 0.6)) < 1.6) { b.cd = 10; addCoins(COIN_REWARD.butterfly, false); popEl(`+${COIN_REWARD.butterfly} 🦋`, "coin2"); }
    }
    for (let i = 0; i < world.fish.length; i++) { const f = world.fish[i]; if (!f.got && Math.random() < dt * 2.2 && (f.x - pl.x) ** 2 + (f.z - pl.z) ** 2 < 900) fx.emit(f.x + (Math.random() - 0.5) * 0.8, f.group.position.y + (Math.random() - 0.5) * 0.6, f.z + (Math.random() - 0.5) * 0.8, 0, 0.5, 0, 0.9, 0.14, "#fff6b0", 0, -0.5); }
    updateCoins(dt, t);
    fx.update(dt);
    updateConfetti(dt);
    updateTrails(dt, pl.speed > 1);
    updateSpeedFx(dt); updateGlide(dt, t);
    updateRemotes(dt);

    if (perf) perf.mark();
    // hud
    coinShown += (P.coins - coinShown) * Math.min(1, dt * 9);
    if (Math.abs(P.coins - coinShown) < 0.5) coinShown = P.coins;
    const ct = Math.round(coinShown);
    if (ct !== coinText) { coinText = ct; $("coinCount").textContent = ct; }
    if (now - lastDoorCheck > 150) {
      lastDoorCheck = now;
      $("shopPrompt").hidden = shop.isOpen || Math.hypot(pl.x - door.x, pl.z - door.z) > 4.2;
    }
    const lvl = P.upgrades.radar | 0;
    if (lvl) {
      let best = null, bd = 1e9;
      for (const f of world.fish) if (!f.got) { const d = Math.hypot(f.group.position.x - pl.x, f.group.position.z - pl.z); if (d < bd) { bd = d; best = f; } }
      if (best && bd <= upgradeValue("radar", lvl)) {
        radarEl.hidden = false;
        const rel = Math.atan2(best.group.position.x - pl.x, best.group.position.z - pl.z) - controls.yaw;
        radarArrow.style.transform = `rotate(${-rel}rad)`;
        const near = Math.round(10 * (1 - Math.min(bd, Math.min(upgradeValue("radar", lvl), 60)) / Math.min(upgradeValue("radar", lvl), 60))) / 10; // 0 far .. 1 close: stronger glow + faster ping
        if (near !== radarNear) { radarNear = near; radarEl.style.setProperty("--near", near); }
        radarDist.textContent = Math.round(bd) + " steps";
      } else radarEl.hidden = true;
    } else radarEl.hidden = true;

    if (perf) perf.mark();
    // network
    if (session.publish) {
      const moving = pl.speed > 0.3 || !pl.grounded;
      if (now - lastSent > (moving ? 110 : 4000) && (moving || sentMoving || now - lastSent > 4000)) {
        lastSent = now; sentMoving = moving;
        session.publish({ cat: P.cat, x: +pl.x.toFixed(2), y: +pl.y.toFixed(2), z: +pl.z.toFixed(2), rotY: +pl.rot.toFixed(2), anim: +pl.speed.toFixed(2), ...(Object.keys(P.equipped).length ? { equipped: P.equipped } : {}) });
      }
    }

    if (perf) perf.mark();
    // light follows the player; snap the shadow camera to whole shadow-map texels so shadows don't shimmer
    {
      const R = world.lightRight, U = world.lightUp, tx = world.shadowTexel;
      const pr = pl.x * R.x + pl.y * R.y + pl.z * R.z, pu = pl.x * U.x + pl.y * U.y + pl.z * U.z;
      const dr = Math.round(pr / tx) * tx - pr, du = Math.round(pu / tx) * tx - pu;
      const sx = pl.x + R.x * dr + U.x * du, sy2 = pl.y + R.y * dr + U.y * du, sz = pl.z + R.z * dr + U.z * du;
      world.sun.position.set(sx + world.sunOffset.x, sy2 + world.sunOffset.y, sz + world.sunOffset.z);
      world.sun.target.position.set(sx, sy2, sz);
    }
    // auto-follow: while the cat is moving (and the player hasn't touched the camera for a moment) ease the camera
    // round to behind the cat's heading. Gentle when a little off, quicker when the cat runs toward the screen.
    if (pl.speed > 1.2 && !controls.orbiting && now - controls.lastOrbit > 1700 && !shop.isOpen) {
      const d = Math.atan2(Math.sin(pl.rot - controls.yaw), Math.cos(pl.rot - controls.yaw)), ad = Math.abs(d);
      const u = Math.min(1, Math.max(0, (ad - 1.0) / 1.2)), k = 2.0 + 3.0 * u * u * (3 - 2 * u);
      controls.yaw += d * (1 - Math.exp(-k * dt));
    }
    if (camTest) camTest.log(dt);
    world.sky.position.copy(camera.position);
    updateCamera(dt);
    finder.update(now, dt, remotes, pl, innerWidth, innerHeight);

    if (flags.camtest === "2" && !camTest.done) { /* dev: logic-only frames so the scripted test runs quickly */ }
    else if (!shop.isOpen || shop.takeDirty()) { if (TIERS[tier].post) post.render(scene, camera); else renderer.render(scene, camera); }
    if (perf) { perf.mark(); perf.end(scale, tier + (setting === "auto" ? " (auto)" : "")); }
    adapt(perf ? perf.frameMs : (now - lastFrameNow), now / 1000);
    lastFrameNow = now;
  }
  let lastFrameNow = performance.now();
  requestAnimationFrame((n) => { last = n; frame(n); });
  if (flags.camtest === "2") { camSync = true; let n = performance.now(); last = n; for (let i = 0; i < 400; i++) { n += 16.7; frame(n); } camSync = false; } // dev: run the scripted camera test at a simulated 60 fps

  if (flags.wear) { // dev: &wear=hat_halo,back_fairy,... puts any items on
    P.equipped = {};
    for (const id of flags.wear.split(",")) { const it = itemById(id); if (it) P.equipped[it.slot] = id; }
    applyLook(me, P.equipped, catCfg.id);
  }
  if (flags.dress) {
    P.equipped = { hat: "hat_crown", glasses: "glasses_heart", neck: "neck_scarf" };
    applyLook(me, P.equipped, catCfg.id);
  }
  if (flags.shop) setTimeout(() => { shop.open(flags.shop === "1" ? "hats" : flags.shop); }, 600);
  if (flags.debug) window.__g = { pl, world, P, shop, scene, renderer, controls, camera, ghost, finder, remotes, onPlayers, session, me, applyLook };
  if (flags.debug === "2") { // dev: list the heaviest meshes
    const rows = [];
    scene.traverse((o) => { if (!o.geometry) return; const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); rows.push([Math.round(n), o.type, o.castShadow ? "shadow" : "", o.material.customProgramCacheKey ? o.material.customProgramCacheKey() : o.material.type]); });
    rows.sort((a, b) => b[0] - a[0]); console.log("MESHES " + rows.slice(0, 22).map((r) => r.join(" ")).join(" | "));
  }
  setTimeout(() => sfx.meow(), 400);
  return { renderer };
}
