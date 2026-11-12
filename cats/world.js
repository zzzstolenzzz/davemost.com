import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toon, addOutline } from "./toon.js";
import { R, WATER_Y, POND, BRIDGE, COTTAGE, HILL, SPAWN, FISH_SPOTS, heightAt, terrainHeight, bridgeDeck, pondE, shoreD, clampToIsland, colliders } from "./terrain.js";

const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const dummy = new THREE.Object3D();
const col = new THREE.Color();
export const SKY = { horizon: "#c9ecff", mid: "#74c6fb", top: "#3a8df0" };

// Bake many parts into one merged mesh per color (fewer draw calls) with a soft outline.
function prop(parent, parts, { outline = 0.04, cast = true } = {}) {
  const byColor = new Map();
  for (const p of parts) {
    const g = p.geo.clone();
    dummy.position.set(...(p.p || [0, 0, 0])); dummy.rotation.set(...(p.r || [0, 0, 0])); dummy.scale.set(...(p.s || [1, 1, 1]));
    dummy.updateMatrix(); g.applyMatrix4(dummy.matrix);
    if (!byColor.has(p.c)) byColor.set(p.c, []);
    byColor.get(p.c).push(g.index ? g : g);
  }
  for (const [c, geos] of byColor) {
    const m = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g : g))), toon(c));
    m.castShadow = cast; m.receiveShadow = true;
    if (outline) addOutline(m, outline, true);
    parent.add(m);
  }
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, n = 12) => new THREE.CylinderGeometry(rt, rb, h, n);
const sph = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);

function instanced(parent, geo, mat, items, { cast = false, outline = 0, color = true } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, i) => {
    dummy.position.set(it.x, it.y, it.z); dummy.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
    const s = it.s; typeof s === "number" ? dummy.scale.setScalar(s) : dummy.scale.set(...(s || [1, 1, 1]));
    dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix);
    if (color && it.c) m.setColorAt(i, col.set(it.c));
  });
  m.instanceMatrix.needsUpdate = true;
  m.frustumCulled = false; m.castShadow = cast; m.receiveShadow = true;
  if (outline) addOutline(m, outline);
  parent.add(m);
  return m;
}

export function buildWorld(scene, renderer) {
  const world = { uniforms: { time: { value: 0 } } };
  const rand = rng(7);
  const pick = (a) => a[Math.floor(rand() * a.length)];

  // ---------- sky, fog, lights ----------
  scene.fog = new THREE.Fog(SKY.horizon, 70, 330);
  scene.background = new THREE.Color(SKY.horizon);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(450, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(SKY.top) }, mid: { value: new THREE.Color(SKY.mid) }, hor: { value: new THREE.Color(SKY.horizon) }, sun: { value: new THREE.Vector3(0.5, 0.45, 0.4).normalize() } },
      vertexShader: "varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: `uniform vec3 top, mid, hor, sun; varying vec3 vD;
        void main(){ float h = clamp(vD.y, 0.0, 1.0);
          vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, h)); c = mix(c, top, smoothstep(0.2, 0.85, h));
          float s = max(dot(normalize(vD), sun), 0.0);
          c += vec3(1.0, 0.85, 0.55) * pow(s, 8.0) * 0.25;
          c = mix(c, vec3(1.0, 0.97, 0.85), smoothstep(0.9965, 0.9975, s));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
  );
  sky.renderOrder = -1;
  scene.add(sky);
  world.sky = sky;

  scene.add(new THREE.HemisphereLight(0xcfeaff, 0xf6d8a8, 1.0));
  const sun = new THREE.DirectionalLight(0xfff0d0, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -24; sc.right = sc.top = 24; sc.near = 1; sc.far = 140;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  world.sun = sun;
  world.sunOffset = new THREE.Vector3(34, 55, 22);

  // ---------- terrain ----------
  const SEG = 150, SIZE = 250;
  const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  tg.rotateX(-Math.PI / 2);
  const pos = tg.attributes.position, colors = new Float32Array(pos.count * 3);
  const sand = new THREE.Color("#f7dfa2"), seabed = new THREE.Color("#e6cb92"), foam = new THREE.Color("#fffbe8");
  const greens = ["#8ad66a", "#79cc62", "#9ee07a", "#6fc46b"].map((c) => new THREE.Color(c));
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = terrainHeight(x, z);
    pos.setY(i, h);
    const n = 0.5 + 0.5 * Math.sin(x * 0.09 + 1) * Math.sin(z * 0.07) + 0.15 * Math.sin(x * 0.31 + z * 0.27);
    const gi = Math.min(2.999, Math.max(0, n * 3));
    tmp.copy(greens[Math.floor(gi)]).lerp(greens[Math.min(3, Math.floor(gi) + 1)], gi % 1);
    if (h > 6) tmp.lerp(greens[2], 0.35);
    const sandT = 1 - Math.min(1, Math.max(0, (h - 0.35) / 0.45));
    tmp.lerp(sand, sandT);
    if (h < WATER_Y + 0.15) tmp.lerp(foam, Math.min(1, (1 - Math.abs(h - (WATER_Y - 0.05)) / 0.35)) * 0.8 * (h > WATER_Y - 0.4 ? 1 : 0));
    if (h < WATER_Y - 0.4) tmp.lerp(seabed, 0.8);
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  tg.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, toon("#ffffff", { vertexColors: true }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ---------- water ----------
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.ShaderMaterial({
      transparent: true, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: world.uniforms.time, shallow: { value: new THREE.Color("#7ae8dc") }, deep: { value: new THREE.Color("#3f9fe0") } }]),
      vertexShader: `varying vec2 vP;
        #include <fog_pars_vertex>
        void main(){ vP = (modelMatrix * vec4(position,1.0)).xz; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform float time; uniform vec3 shallow, deep; varying vec2 vP;
        #include <fog_pars_fragment>
        void main(){
          float d = clamp((length(vP) - 70.0) / 70.0, 0.0, 1.0);
          vec3 c = mix(shallow, deep, d);
          float near = 1.0 - smoothstep(40.0, 160.0, length(cameraPosition.xz - vP));
          float w = sin(vP.x*0.37 + time*0.8 + sin(vP.y*0.21)*2.0) * sin(vP.y*0.43 - time*0.6 + sin(vP.x*0.17)*2.0) + 0.6*sin((vP.x+vP.y)*0.71 + time*1.3);
          c += vec3(0.8) * step(1.1, w) * 0.45 * near;               // toon sparkle patches
          c = mix(c, c * 1.1, step(0.5, w) * 0.5 * near);
          gl_FragColor = vec4(c, 0.86);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    })
  );
  water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y;
  scene.add(water);
  world.water = water;

  // pond
  const pondM = new THREE.Mesh(new THREE.CircleGeometry(1, 40), toon("#6ad7e8", { transparent: true, opacity: 0.88 }));
  pondM.rotation.x = -Math.PI / 2; pondM.position.set(POND.x, POND.level, POND.z); pondM.scale.set(POND.a * 1.02, POND.b * 1.02, 1);
  scene.add(pondM);

  // ---------- placement helpers ----------
  const nearBridge = (x, z, pad) => Math.abs(x - BRIDGE.x) < BRIDGE.halfW + pad && Math.abs(z - BRIDGE.z) < BRIDGE.halfLen + pad;
  const free = (x, z, opts = {}) => { const { minH = 0.9, pad = 0 } = opts; return (
    shoreD(x, z) < 0.78 && heightAt(x, z) >= minH && pondE(x, z) > 1.3 + pad * 0.05 && Math.hypot(x - COTTAGE.x, z - COTTAGE.z) > 7 + pad &&
    Math.hypot(x - SPAWN.x, z - SPAWN.z) > (opts.spawn || 5) && Math.hypot(x - HILL.x, z - HILL.z) > HILL.flat + 3.5 && !nearBridge(x, z, 2 + pad)); };
  const scatter = (n, fn, opts, cx = 0, cz = 0, rad = 78) => {
    const out = [];
    for (let tries = 0; out.length < n && tries < n * 30; tries++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * rad, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (free(x, z, opts)) out.push(fn(x, heightAt(x, z), z));
    }
    return out;
  };

  // ---------- trees (instanced: trunk + 2 canopy blobs, with outlines) ----------
  const clusters = [[-56, 6, 16], [48, -30, 14], [-30, -50, 18], [62, 40, 12], [10, 62, 12], [-62, -34, 10], [34, -62, 10], [-8, -30, 9], [40, 52, 10], [-50, 40, 9]];
  const trees = [];
  for (const [cx, cz, r] of clusters) scatter(Math.round(r * 0.75), (x, y, z) => trees.push({ x, y, z }), { minH: 1, pad: 1.5, spawn: 17 }, cx, cz, r);
  scatter(14, (x, y, z) => trees.push({ x, y, z }), { minH: 1, pad: 2, spawn: 17 });
  const trunkItems = [], canA = [], canB = [];
  const canopyCols = ["#6bd06f", "#55c27e", "#8fd86a", "#79cf7a", "#ffa6c9"];
  for (const t of trees) {
    const s = 0.8 + rand() * 0.8, ry = rand() * 6.28, c = rand() < 0.12 ? canopyCols[4] : pick(canopyCols.slice(0, 4));
    trunkItems.push({ x: t.x, y: t.y + 1.2 * s, z: t.z, s: [s, s, s], ry });
    canA.push({ x: t.x, y: t.y + 3.4 * s, z: t.z, s: s * (1 + rand() * 0.2), c });
    canB.push({ x: t.x + Math.cos(ry) * 0.9 * s, y: t.y + 4.8 * s, z: t.z + Math.sin(ry) * 0.9 * s, s: s * 0.68, c });
    colliders.push({ x: t.x, z: t.z, r: 0.45 * s });
  }
  instanced(scene, cyl(0.28, 0.42, 2.4, 8), toon("#a8703f"), trunkItems, { cast: true, outline: 0.05 });
  const canG = sph(1.75, 18, 14);
  instanced(scene, canG, toon("#ffffff"), canA, { cast: true, outline: 0.05 }).receiveShadow = false;
  instanced(scene, canG, toon("#ffffff"), canB, { cast: true, outline: 0.05 }).receiveShadow = false;

  // ---------- rocks ----------
  const rocks = scatter(38, (x, y, z) => { const s = 0.4 + rand() * rand() * 1.8; if (s > 1.1) colliders.push({ x, z, r: s * 0.8 }); return { x, y: y + s * 0.15, z, s: [s, s * 0.65, s * 0.85], ry: rand() * 6, c: pick(["#bdb6d3", "#c9c4d9", "#a9b2c9", "#d6cfc2"]) }; }, { minH: 0.5 });
  instanced(scene, new THREE.IcosahedronGeometry(1, 1), toon("#ffffff"), rocks, { cast: true, outline: 0.06 });

  // ---------- flowers ----------
  const petalG = mergeGeometries([...Array(5)].map((_, i) => { const a = (i / 5) * 6.283, g = sph(0.075, 8, 6); g.translate(Math.cos(a) * 0.09, 0.4, Math.sin(a) * 0.09); return g; }));
  const flowers = [];
  const fcols = ["#ff8fab", "#ffe066", "#ffffff", "#b197fc", "#ff9f6b", "#74c0fc"];
  for (const [cx, cz, r] of [[0, 20, 22], [-30, 10, 20], [30, -10, 24], [-10, -40, 22], [50, 10, 14], [-45, -10, 14]]) {
    scatter(75, (x, y, z) => flowers.push({ x, y, z, s: 0.8 + rand() * 0.6, c: pick(fcols), ry: rand() * 6 }), {}, cx, cz, r);
  }
  const grassMat = toon("#ffffff");
  instanced(scene, cyl(0.014, 0.018, 0.4, 4).translate(0, 0.2, 0), toon("#5dbb5d"), flowers, { color: false });
  instanced(scene, petalG, toon("#ffffff"), flowers);
  instanced(scene, sph(0.06, 8, 6).translate(0, 0.4, 0), toon("#ffd43b"), flowers, { color: false });

  // ---------- mushrooms ----------
  const mush = [];
  for (const t of trees.filter((_, i) => i % 5 === 0)) scatter(3, (x, y, z) => mush.push({ x, y, z, s: 0.7 + rand() * 0.7, c: pick(["#ff6b6b", "#ff8fab", "#ffa94d", "#e599f7"]) }), { minH: 1 }, t.x, t.z, 3.2);
  instanced(scene, cyl(0.07, 0.09, 0.25, 8).translate(0, 0.125, 0), toon("#fff3e0"), mush, { color: false, outline: 0.015 });
  instanced(scene, new THREE.SphereGeometry(0.2, 12, 8, 0, 6.283, 0, 1.45).translate(0, 0.24, 0), toon("#ffffff"), mush, { outline: 0.02 });
  instanced(scene, sph(0.035, 6, 4), toon("#ffffff"), mush.map((m) => ({ ...m, x: m.x + 0.06 * m.s, y: m.y + 0.42 * m.s, z: m.z + 0.05 * m.s, s: m.s, c: "#ffffff" })), { color: false });

  // ---------- grass tufts (instanced, swaying, no outlines) ----------
  const blade = (rx, rz, h) => { const g = new THREE.ConeGeometry(0.06, h, 4, 1); g.translate(0, h / 2, 0); g.rotateX(rx); g.rotateZ(rz); return g; };
  const tuftG = mergeGeometries([blade(0, 0, 0.55), blade(0.35, 0.2, 0.45), blade(-0.3, -0.25, 0.4), blade(0.1, -0.4, 0.35)]);
  const tuft = (x, y, z) => ({ x, y: y - 0.02, z, s: 0.7 + rand() * 0.9, ry: rand() * 6.28, c: pick(["#7fd367", "#92dd70", "#6cc65f", "#a6e57e"]) });
  const tufts = [...scatter(7500, tuft, { minH: 0.8 }), ...scatter(1800, tuft, { minH: 0.8 }, SPAWN.x, SPAWN.z, 24)];
  const tuftMesh = instanced(scene, tuftG, grassMat, tufts);
  grassMat.onBeforeCompile = (s) => {
    s.uniforms.time = world.uniforms.time;
    s.vertexShader = "uniform float time;\n" + s.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n transformed.x += sin(time*1.6 + instanceMatrix[3].x*0.4 + instanceMatrix[3].z*0.3) * 0.09 * position.y; transformed.z += cos(time*1.3 + instanceMatrix[3].z*0.4) * 0.06 * position.y;");
  };
  grassMat.customProgramCacheKey = () => "grass";
  tuftMesh.castShadow = false;

  // ---------- pond lily pads ----------
  const pads = [];
  for (let i = 0; i < 11; i++) {
    const a = rand() * 6.28, r = Math.sqrt(rand()) * 0.78;
    const x = POND.x + Math.cos(a) * r * POND.a, z = POND.z + Math.sin(a) * r * POND.b;
    if (nearBridge(x, z, 0.8)) continue;
    pads.push({ x, y: POND.level + 0.03, z, s: [0.5 + rand() * 0.4, 1, 0.5 + rand() * 0.4], c: pick(["#5fcf7a", "#74d88a", "#4fbf6f"]) });
  }
  instanced(scene, cyl(1, 1, 0.04, 14), toon("#ffffff"), pads, { outline: 0.03 });
  instanced(scene, new THREE.SphereGeometry(0.2, 10, 6, 0, 6.283, 0, 1.4), toon("#ff8fab"), pads.filter((_, i) => i % 3 === 0).map((p) => ({ ...p, y: p.y + 0.03, s: 1 })), { outline: 0.03, color: false });

  // ---------- bridge ----------
  {
    const parts = [], dark = [];
    const N = 17, len = BRIDGE.halfLen * 2, step = len / N;
    for (let i = 0; i < N; i++) {
      const z = BRIDGE.z - BRIDGE.halfLen + (i + 0.5) * step, y = bridgeDeck(z), slope = Math.atan((bridgeDeck(z + 0.1) - bridgeDeck(z - 0.1)) / 0.2);
      parts.push({ geo: box(BRIDGE.halfW * 2, 0.14, step * 0.88), p: [BRIDGE.x, y - 0.08, z], r: [-slope, 0, 0], c: i % 2 ? "#d09a63" : "#c98f5a" });
    }
    for (const sx of [-1, 1]) {
      for (let i = 0; i <= 8; i++) {
        const z = BRIDGE.z - BRIDGE.halfLen + (i / 8) * len, y = bridgeDeck(z);
        dark.push({ geo: box(0.14, 0.9, 0.14), p: [BRIDGE.x + sx * (BRIDGE.halfW - 0.05), y + 0.4, z], c: "#a76b3a" });
        if (i < 8) {
          const z2 = BRIDGE.z - BRIDGE.halfLen + ((i + 1) / 8) * len, y2 = bridgeDeck(z2), dz = z2 - z, dy = y2 - y;
          dark.push({ geo: box(0.09, 0.09, Math.hypot(dz, dy) + 0.05), p: [BRIDGE.x + sx * (BRIDGE.halfW - 0.05), (y + y2) / 2 + 0.8, (z + z2) / 2], r: [-Math.atan2(dy, dz), 0, 0], c: "#b97a45" });
        }
      }
    }
    const g = new THREE.Group();
    prop(g, [...parts, ...dark], { outline: 0.02 });
    scene.add(g);
  }

  // ---------- cottage ----------
  {
    const cx = COTTAGE.x, cz = COTTAGE.z, y = terrainHeight(cx, cz);
    const g = new THREE.Group();
    g.position.set(cx, y, cz);
    const P = [
      { geo: box(5.6, 0.5, 4.9), p: [0, 0.2, 0], c: "#c9c2d6" },
      { geo: box(5, 2.5, 4.3), p: [0, 1.7, 0], c: "#fff0d6" },
      { geo: new THREE.ConeGeometry(4.4, 2.3, 4), p: [0, 4.1, 0], r: [0, Math.PI / 4, 0], s: [1.15, 1, 1], c: "#ef6a5b" },
      { geo: box(0.7, 1.9, 0.7), p: [1.4, 4.4, 0.8], c: "#e08a6a" },
      { geo: box(0.85, 0.2, 0.85), p: [1.4, 5.4, 0.8], c: "#c9c2d6" },
      { geo: box(1, 1.7, 0.14), p: [0, 1.35, -2.2], c: "#a8623a" },
      { geo: sph(0.07), p: [0.3, 1.3, -2.3], c: "#ffd43b" },
      { geo: box(1.8, 0.2, 0.9), p: [0, 0.35, -2.75], c: "#d8cfe3" },
      { geo: box(1, 0.9, 0.12), p: [-1.7, 1.9, -2.2], c: "#bfe9ff" }, { geo: box(1.2, 1.1, 0.1), p: [-1.7, 1.9, -2.17], c: "#ffffff" },
      { geo: box(1, 0.9, 0.12), p: [1.7, 1.9, -2.2], c: "#bfe9ff" }, { geo: box(1.2, 1.1, 0.1), p: [1.7, 1.9, -2.17], c: "#ffffff" },
      { geo: box(0.12, 0.9, 1), p: [2.5, 1.9, 0], c: "#bfe9ff" }, { geo: box(0.1, 1.1, 1.2), p: [2.47, 1.9, 0], c: "#ffffff" },
      { geo: box(1.5, 0.3, 0.4), p: [-1.7, 1.2, -2.5], c: "#a8623a" }, { geo: box(1.5, 0.3, 0.4), p: [1.7, 1.2, -2.5], c: "#a8623a" },
      ...[-2.1, -1.7, -1.3].flatMap((x, i) => [{ geo: sph(0.15), p: [x, 1.42, -2.5], c: ["#ff8fab", "#ffe066", "#ff8fab"][i] }, { geo: sph(0.15), p: [x + 3.4, 1.42, -2.5], c: ["#ffe066", "#b197fc", "#ffe066"][i] }]),
    ];
    prop(g, P, { outline: 0.035 });
    scene.add(g);
    colliders.push({ x: cx, z: cz, r: 3.3 });
    world.door = { x: cx, z: cz - 3.4 };
  }

  // ---------- lookout on the hill ----------
  {
    const hy = heightAt(HILL.x, HILL.z), g = new THREE.Group();
    g.position.set(HILL.x, hy, HILL.z);
    const P = [{ geo: box(4.4, 0.16, 4.4), p: [0, 0.07, 0], c: "#d6a06a" }];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push({ geo: box(0.22, 2.9, 0.22), p: [sx * 2, 1.5, sz * 2], c: "#a76b3a" });
    for (const [x, z, rw, rd] of [[0, 2, 4.2, 0.1], [0, -2, 4.2, 0.1], [2, 0, 0.1, 4.2], [-2, 0, 0.1, 4.2]]) P.push({ geo: box(rw, 0.1, rd), p: [x, 1.0, z], c: "#b97a45" }, { geo: box(rw, 0.1, rd), p: [x, 0.55, z], c: "#b97a45" });
    P.push({ geo: new THREE.ConeGeometry(3.6, 1.5, 4), p: [0, 3.65, 0], r: [0, Math.PI / 4, 0], c: "#ef6a5b" });
    P.push({ geo: cyl(0.04, 0.04, 2.4, 6), p: [2.6, 1.3, -2.6], c: "#d9d9e3" }, { geo: new THREE.ConeGeometry(0.4, 0.8, 3), p: [3.0, 2.2, -2.6], r: [0, 0, -Math.PI / 2], s: [1, 1, 0.1], c: "#ff6fa5" });
    prop(g, P, { outline: 0.035 });
    scene.add(g);
  }

  // ---------- clouds ----------
  const cloudMat = toon("#ffffff");
  world.clouds = [];
  for (let i = 0; i < 9; i++) {
    const parts = [[0, 0, 0, 7], [7, -1, 1, 5.5], [-6.5, -1.2, -1, 5], [3, 2.5, -1, 5]].map(([x, y, z, r]) => ({ geo: sph(r, 12, 8), p: [x, y, z], c: "#ffffff" }));
    const geo = mergeGeometries(parts.map((p) => { const g = p.geo.clone(); g.translate(...p.p); return g; }));
    const m = new THREE.Mesh(geo, cloudMat);
    const a = (i / 9) * 6.283 + rand(), d = 140 + rand() * 120;
    m.position.set(Math.cos(a) * d, 50 + rand() * 40, Math.sin(a) * d);
    m.scale.set(1.2 + rand(), 0.7, 1.2 + rand() * 0.6);
    scene.add(m); world.clouds.push(m);
  }

  // ---------- golden fish ----------
  const fishParts = (c) => [
    { geo: sph(1, 14, 10), p: [0, 0, 0], s: [0.36, 0.22, 0.17], c: "#ffc93c" },
    { geo: new THREE.ConeGeometry(0.2, 0.34, 3), p: [-0.4, 0, 0], r: [0, 0, Math.PI / 2], s: [1, 1, 0.25], c: "#ffb020" },
    { geo: new THREE.ConeGeometry(0.1, 0.2, 3), p: [0, 0.22, 0], s: [1, 1, 0.25], c: "#ffb020" },
  ];
  const fishGroup = new THREE.Group();
  prop(fishGroup, fishParts(), { outline: 0.05, cast: false });
  const eye = new THREE.Mesh(sph(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0x3b2a4a }));
  const eyeW = new THREE.Mesh(sph(0.075, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  for (const sz of [-1, 1]) { eyeW.position.set(0.2, 0.05, sz * 0.13); eye.position.set(0.23, 0.05, sz * 0.15); fishGroup.add(eyeW.clone(), eye.clone()); }
  fishGroup.traverse((o) => { if (o.isMesh && !o.userData.outline && o.material.isMeshToonMaterial) { o.material.emissive = new THREE.Color("#ff9d00"); o.material.emissiveIntensity = 0.35; } });
  // glow sprite texture
  const gc = document.createElement("canvas"); gc.width = gc.height = 64;
  const gg = gc.getContext("2d"), grd = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,240,160,0.95)"); grd.addColorStop(0.4, "rgba(255,210,80,0.35)"); grd.addColorStop(1, "rgba(255,200,60,0)");
  gg.fillStyle = grd; gg.fillRect(0, 0, 64, 64);
  const glowTex = new THREE.CanvasTexture(gc); glowTex.colorSpace = THREE.SRGBColorSpace;
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const sparkG = mergeGeometries([0, 1, 2].map((i) => { const g = new THREE.OctahedronGeometry(0.06); g.scale(1, 2.2, 1); g.translate(0.5 * Math.cos(i * 2.1), 0.15 * (i - 1), 0.5 * Math.sin(i * 2.1)); return g; }));
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xfff3a0, fog: false });
  world.fish = FISH_SPOTS.map(([x, z], i) => {
    const g = new THREE.Group(), body = fishGroup.clone();
    const glow = new THREE.Sprite(glowMat); glow.scale.set(1.9, 1.9, 1);
    const sp = new THREE.Mesh(sparkG, sparkMat);
    g.add(body, glow, sp);
    const baseY = heightAt(x, z) + 1.1;
    g.position.set(x, baseY, z);
    scene.add(g);
    return { id: "fish" + (i + 1), group: g, body, sp, baseY, got: false };
  });

  // ---------- coins (instanced, paw-print faces) ----------
  const COIN_N = 25;
  const coinG = cyl(0.36, 0.36, 0.09, 16).rotateX(Math.PI / 2);
  const pawParts = [];
  for (const sz of [-1, 1]) {
    const pz = sz * 0.05;
    const pad = sph(1, 8, 6); pad.scale(0.12, 0.1, 0.02); pad.translate(0, -0.06, pz); pawParts.push(pad);
    [[-0.12, 0.07], [-0.04, 0.12], [0.04, 0.12], [0.12, 0.07]].forEach(([x, y]) => { const t = sph(1, 6, 4); t.scale(0.04, 0.045, 0.02); t.translate(x, y, pz); pawParts.push(t); });
  }
  const coinMesh = new THREE.InstancedMesh(coinG, toon("#ffd43b", { emissive: new THREE.Color("#ff9d00"), emissiveIntensity: 0.3 }), COIN_N);
  const pawMesh = new THREE.InstancedMesh(mergeGeometries(pawParts), toon("#e09500"), COIN_N);
  pawMesh.instanceMatrix = coinMesh.instanceMatrix;
  coinMesh.frustumCulled = pawMesh.frustumCulled = false;
  addOutline(coinMesh, 0.03);
  scene.add(coinMesh, pawMesh);
  world.coins = { mesh: coinMesh, paw: pawMesh, items: [...Array(COIN_N)].map(() => ({ x: 0, y: 0, z: 0, alive: false, respawn: rand() * 4, phase: rand() * 6 })) };
  world.randomSpot = (out) => { // random walkable spot, no allocation
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * 74;
      out.x = Math.cos(a) * r; out.z = Math.sin(a) * r;
      if (shoreD(out.x, out.z) < 0.76 && heightAt(out.x, out.z) > 0.7 && pondE(out.x, out.z) > 1.0 && Math.hypot(out.x - COTTAGE.x, out.z - COTTAGE.z) > 4.5) break;
    }
    out.y = heightAt(out.x, out.z);
  };

  // ---------- butterflies ----------
  const wingG = new THREE.CircleGeometry(0.16, 8); wingG.scale(1, 0.75, 1); wingG.translate(0.15, 0, 0);
  const bcols = ["#ff8fab", "#ffd43b", "#74c0fc", "#b197fc", "#ffa94d"];
  const wingMats = bcols.map((c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0x3b2a4a });
  const bodyG = new THREE.CapsuleGeometry(0.025, 0.14, 2, 4);
  bodyG.rotateX(Math.PI / 2);
  world.butterflies = [...Array(14)].map((_, i) => {
    const g = new THREE.Group(), l = new THREE.Mesh(wingG, wingMats[i % 5]), r = new THREE.Mesh(wingG, wingMats[i % 5]);
    l.rotation.x = r.rotation.x = Math.PI / 2; r.scale.x = -1;
    const lp = new THREE.Group(), rp = new THREE.Group();
    lp.add(l); rp.add(r); g.add(lp, rp, new THREE.Mesh(bodyG, bodyMat));
    const a = rand() * 6.28, d = 10 + rand() * 60;
    g.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    scene.add(g);
    return { group: g, lp, rp, dir: rand() * 6.28, turn: 0, hover: 1.2 + rand() * 1.5, ph: rand() * 10, cd: 0 };
  });

  // ---------- per-frame ----------
  const tmpO = { x: 0, z: 0 };
  world.update = (dt, t, px, pz) => {
    world.uniforms.time.value = t;
    for (const c of world.clouds) { c.position.x += dt * 1.2; if (c.position.x > 300) c.position.x = -300; }
    for (const b of world.butterflies) {
      const p = b.group.position, dx = p.x - px, dz = p.z - pz, d2 = dx * dx + dz * dz, flee = d2 < 36;
      b.cd = Math.max(0, b.cd - dt);
      b.turn += (Math.random() - 0.5) * dt * 8; b.turn *= 0.96;
      if (flee) { const want = Math.atan2(dx, dz), diff = Math.atan2(Math.sin(want - b.dir), Math.cos(want - b.dir)); b.dir += diff * Math.min(1, dt * 5); }
      else b.dir += b.turn * dt * 2;
      const sp = flee ? 4.6 : 1.6;
      p.x += Math.sin(b.dir) * sp * dt; p.z += Math.cos(b.dir) * sp * dt;
      tmpO.x = p.x; tmpO.z = p.z; clampToIsland(tmpO);
      if (tmpO.x !== p.x || tmpO.z !== p.z) { p.x = tmpO.x; p.z = tmpO.z; b.dir += 2.5; }
      p.y += (heightAt(p.x, p.z) + b.hover + Math.sin(t * 1.7 + b.ph) * 0.4 - p.y) * Math.min(1, dt * 3);
      b.group.rotation.y = b.dir;
      const f = Math.sin(t * (flee ? 28 : 16) + b.ph) * 0.9;
      b.lp.rotation.z = f; b.rp.rotation.z = -f;
    }
    world.fish.forEach((f, i) => {
      if (f.got) return;
      f.group.position.y = f.baseY + Math.sin(t * 2 + i) * 0.18;
      f.body.rotation.y = t * 2 + i;
      f.sp.rotation.y = -t * 1.5; f.sp.scale.setScalar(0.8 + 0.3 * Math.sin(t * 6 + i));
    });
  };
  return world;
}
