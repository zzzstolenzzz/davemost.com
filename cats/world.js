import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toon, VC, bake, bakedMesh, mat4, outlineMaterial, time, ramp, noiseTex } from "./toon.js";
import { foliageMaterial, treeModels, bushModel, rockModel, mushroomModel } from "./foliage.js";
import { WATER_Y, POND, BRIDGE, COTTAGE, HILL, SPAWN, FISH_SPOTS, heightAt, terrainHeight, bridgeDeck, pondE, shoreD, clampToIsland, colliders, pathMask, PATHS } from "./terrain.js";

const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const dummy = new THREE.Object3D();
const col = new THREE.Color();
export const SKY = { fog: "#f7dcc4", low: "#fbe3c8", mid: "#a9d4f2", top: "#4f93e2" };
export const SUN_DIR = new THREE.Vector3(0.74, 0.5, 0.45).normalize();
const EXT = 125, DS = 512; // data texture covers [-EXT, EXT]
// "#hex" (sRGB) -> GLSL vec3 in the linear working space
const glc = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };
// Lawn colour: shared by the terrain (fragment) and the grass blades (vertex) so the blades melt into the ground.
const GROUND_GLSL = `uniform sampler2D uData, uNoise;
  vec3 grassCol(vec2 p, float meadow){
    float a = texture2D(uNoise, p * 0.013).r, b = texture2D(uNoise, p * 0.041 + 0.37).a;
    vec3 g = mix(${glc("#5fae52")}, ${glc("#82c85a")}, smoothstep(0.25, 0.72, a));
    g = mix(g, ${glc("#a3d463")}, smoothstep(0.45, 0.85, b) * 0.6);
    return mix(g, ${glc("#b4dc68")}, meadow * 0.45);
  }`;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Flower meadows: same function in JS (ground tint) and GLSL (where flowers grow), so they line up.
const meadow = (x, z) => sstep(0.25, 0.55, 0.6 * Math.sin(x * 0.061 + 1.7) * Math.sin(z * 0.057 + 0.3) + 0.4 * Math.sin(x * 0.13 - z * 0.11 + 2.0));
const MEADOW_GLSL = "float meadowAt(vec2 p){ float m = 0.6*sin(p.x*0.061+1.7)*sin(p.y*0.057+0.3) + 0.4*sin(p.x*0.13-p.y*0.11+2.0); return smoothstep(0.25,0.55,m); }";

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, n = 10) => new THREE.CylinderGeometry(rt, rb, h, n);
const sph = (r, w = 10, h = 7) => new THREE.SphereGeometry(r, w, h);
const tor = (R, r, a = 6, b = 16, arc) => new THREE.TorusGeometry(R, r, a, b, arc);

function instanced(parent, geo, mat, items, { cast = false, receive = true } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, i) => {
    dummy.position.set(it.x, it.y, it.z); dummy.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
    typeof it.s === "number" ? dummy.scale.setScalar(it.s) : dummy.scale.set(...(it.s || [1, 1, 1]));
    dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix);
    if (it.c) m.setColorAt(i, col.set(it.c));
  });
  m.instanceMatrix.needsUpdate = true;
  m.frustumCulled = false; m.castShadow = cast; m.receiveShadow = receive;
  parent.add(m);
  return m;
}

export function buildWorld(scene) {
  const world = { quality: null };
  const rand = rng(7);
  const pick = (a) => a[Math.floor(rand() * a.length)];

  // ---------- sky, fog, lights (late-afternoon gold: warm low sun, cool lavender fill) ----------
  scene.fog = new THREE.Fog(SKY.fog, 55, 330);
  scene.background = new THREE.Color(SKY.fog);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(450, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(SKY.top) }, mid: { value: new THREE.Color(SKY.mid) }, low: { value: new THREE.Color(SKY.low) }, hor: { value: new THREE.Color(SKY.fog) }, sun: { value: SUN_DIR }, uNoise: { value: noiseTex }, time },
      vertexShader: "varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: `uniform vec3 top, mid, low, hor, sun; uniform sampler2D uNoise; uniform float time; varying vec3 vD;
        void main(){
          vec3 d = normalize(vD); float h = clamp(d.y, 0.0, 1.0);
          vec3 c = mix(hor, low, smoothstep(0.0, 0.1, h)); c = mix(c, mid, smoothstep(0.03, 0.24, h)); c = mix(c, top, smoothstep(0.3, 0.95, h));
          float s = max(dot(d, sun), 0.0);
          vec2 sd = normalize(vec2(d.x, d.z) + 1e-4), ss = normalize(vec2(sun.x, sun.z));
          float az = max(dot(sd, ss), 0.0);
          c = mix(c, vec3(1.0, 0.8, 0.6), pow(az, 3.0) * (1.0 - smoothstep(0.0, 0.5, h)) * 0.5);     // warm side of the sky
          // soft painted cloud streaks, lit warm
          vec2 cu = d.xz / (d.y + 0.25) * 0.11 + time * 0.0012;
          float cl = smoothstep(0.6, 0.86, texture2D(uNoise, cu).r * 0.7 + texture2D(uNoise, cu * 2.7).g * 0.3) * smoothstep(0.03, 0.22, h) * (1.0 - smoothstep(0.55, 0.9, h));
          c = mix(c, mix(vec3(1.0, 0.9, 0.86), vec3(1.0, 0.96, 0.84), az), cl * 0.6);
          c += vec3(1.0, 0.72, 0.4) * (pow(s, 5.0) * 0.3 + pow(s, 30.0) * 0.5 + pow(s, 300.0) * 1.2);  // sun glow (HDR, blooms)
          c = mix(c, vec3(3.2, 2.9, 2.2), smoothstep(0.9972, 0.9984, s));                              // sun disc
          c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;   // de-band
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
  );
  sky.renderOrder = -1;
  scene.add(sky);
  world.sky = sky;

  scene.add(new THREE.HemisphereLight(0xb4c0ff, 0xffd9b0, 1.95));
  const sun = new THREE.DirectionalLight(0xffd6a6, 2.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -24; sc.right = sc.top = 24; sc.near = 1; sc.far = 150;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);
  world.sun = sun;
  world.sunOffset = SUN_DIR.clone().multiplyScalar(70);
  world.shadowTexel = 48 / 2048;
  world.setShadowSize = (n) => {
    if (sun.shadow.mapSize.x === n) return;
    sun.shadow.mapSize.set(n, n); world.shadowTexel = 48 / n;
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  };
  // light-space axes, for snapping the shadow camera to texels (stops shadow shimmer while moving)
  world.lightRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
  world.lightUp = new THREE.Vector3().crossVectors(SUN_DIR, world.lightRight).normalize();

  // ---------- terrain data texture: R height, G path, B contact shade (1 = none), A meadow. Read by terrain, water, grass, flowers ----------
  const dataF = new Float32Array(DS * DS * 4), data = new Uint16Array(DS * DS * 4);
  for (let j = 0; j < DS; j++) for (let i = 0; i < DS; i++) {
    const x = ((i + 0.5) / DS) * EXT * 2 - EXT, z = ((j + 0.5) / DS) * EXT * 2 - EXT, o = (j * DS + i) * 4;
    dataF[o] = terrainHeight(x, z); dataF[o + 1] = pathMask(x, z); dataF[o + 2] = 1;
    const sandK = Math.max(sstep(0.655, 0.735, shoreD(x, z) + 0.012 * Math.sin(x * 0.4) * Math.sin(z * 0.37)), sstep(1.5, 1.27, pondE(x, z)));
    dataF[o + 3] = sandK > 0 ? -sandK : meadow(x, z);
  }
  const dataTex = new THREE.DataTexture(data, DS, DS, THREE.RGBAFormat, THREE.HalfFloatType);
  dataTex.minFilter = dataTex.magFilter = THREE.LinearFilter; dataTex.wrapS = dataTex.wrapT = THREE.ClampToEdgeWrapping;
  // soft blob of shade under things (trees, bushes, rocks, buildings) so they sit in the world
  const shadeSpot = (x, z, r, k) => {
    const c = (v) => ((v + EXT) / (EXT * 2)) * DS - 0.5, i0 = Math.max(0, Math.floor(c(x - r))), i1 = Math.min(DS - 1, Math.ceil(c(x + r))), j0 = Math.max(0, Math.floor(c(z - r))), j1 = Math.min(DS - 1, Math.ceil(c(z + r)));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = ((i + 0.5) / DS) * EXT * 2 - EXT - x, dz = ((j + 0.5) / DS) * EXT * 2 - EXT - z, d = Math.hypot(dx, dz) / r;
      if (d < 1) dataF[(j * DS + i) * 4 + 2] *= 1 - k * (1 - d * d) * (1 - d * d);
    }
  };
  // clear the meadow / grass where something stands (pass k = 0 shade to only clear)
  const clearSpot = (x, z, r) => {
    const c = (v) => ((v + EXT) / (EXT * 2)) * DS - 0.5;
    for (let j = Math.max(0, Math.floor(c(z - r))); j <= Math.min(DS - 1, Math.ceil(c(z + r))); j++) for (let i = Math.max(0, Math.floor(c(x - r))); i <= Math.min(DS - 1, Math.ceil(c(x + r))); i++) {
      const dx = ((i + 0.5) / DS) * EXT * 2 - EXT - x, dz = ((j + 0.5) / DS) * EXT * 2 - EXT - z;
      if (dx * dx + dz * dz < r * r) dataF[(j * DS + i) * 4 + 1] = Math.max(dataF[(j * DS + i) * 4 + 1], 0.75);
    }
  };
  const bakeData = () => { const H = THREE.DataUtils.toHalfFloat; for (let i = 0; i < dataF.length; i++) data[i] = H(dataF[i]); dataTex.needsUpdate = true; };
  const pool = { uC: { value: new THREE.Vector2() }, uData: { value: dataTex }, uNoise: { value: noiseTex } };
  world.setPlayerPos = (x, z) => pool.uC.value.set(x, z);

  // ---------- placement helpers ----------
  const nearBridge = (x, z, pad) => Math.abs(x - BRIDGE.x) < BRIDGE.halfW + pad && Math.abs(z - BRIDGE.z) < BRIDGE.halfLen + pad;
  const free = (x, z, opts = {}) => {
    const { minH = 0.9, pad = 0 } = opts;
    return shoreD(x, z) < 0.78 && heightAt(x, z) >= minH && pondE(x, z) > 1.3 + pad * 0.05 && Math.hypot(x - COTTAGE.x, z - COTTAGE.z) > 7 + pad &&
      Math.hypot(x - SPAWN.x, z - SPAWN.z) > (opts.spawn || 5) && Math.hypot(x - HILL.x, z - HILL.z) > HILL.flat + 3.5 && !nearBridge(x, z, 2 + pad) && pathMask(x, z) < 0.15;
  };
  const scatter = (n, fn, opts, cx = 0, cz = 0, rad = 78) => {
    const out = [];
    for (let tries = 0; out.length < n && tries < n * 30; tries++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * rad, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (free(x, z, opts)) out.push(fn(x, heightAt(x, z), z));
    }
    return out;
  };

  // ---------- trees: groves with their own character. One instanced mesh per (grove, species), frustum-culled ----------
  // species: 0 oak, 1 birch, 2 blossom, 3 pine
  const groves = [[-56, 6, 16, [0, 0, 1]], [48, -30, 14, [2, 2, 2, 1]], [-30, -50, 18, [3, 3, 0]], [62, 40, 12, [1, 1, 0]], [10, 62, 12, [2, 1, 2]], [-62, -34, 10, [3]], [34, -62, 10, [0, 3]], [-8, -30, 9, [1, 2]], [40, 52, 10, [0]], [-50, 40, 9, [3, 1]]];
  const fol = foliageMaterial(SUN_DIR), models = treeModels(), trees = [];
  groves.forEach(([cx, cz, r, sp], gi) => scatter(Math.round(r * 0.62), (x, y, z) => trees.push({ x, y, z, gi, v: pick(sp) }), { minH: 1, pad: 1.5, spawn: 17 }, cx, cz, r));
  scatter(10, (x, y, z) => { let gi = 0, bd = 1e9; groves.forEach(([cx, cz], i) => { const d = Math.hypot(x - cx, z - cz); if (d < bd) { bd = d; gi = i; } }); trees.push({ x, y, z, gi, v: pick([0, 1, 0, 2]) }); }, { minH: 1, pad: 2, spawn: 17 });
  world.blossoms = [];
  const buckets = new Map();
  for (const t of trees) {
    const s = 0.85 + rand() * 0.65;
    const it = { x: t.x, y: t.y - 0.08, z: t.z, s: [s, s * (0.92 + rand() * 0.2), s], ry: rand() * 6.28, c: col.setRGB(0.9 + rand() * 0.14, 0.92 + rand() * 0.12, 0.88 + rand() * 0.14).getHex() };
    const key = t.gi * 4 + t.v;
    if (!buckets.has(key)) buckets.set(key, { v: t.v, items: [] });
    buckets.get(key).items.push(it);
    colliders.push({ x: t.x, z: t.z, r: 0.5 * s });
    shadeSpot(t.x, t.z, 3.4 * s, 0.5);
    if (t.v === 2) world.blossoms.push(t);
  }
  for (const b of buckets.values()) {
    const m = instanced(scene, models[b.v], fol, b.items, { cast: true, receive: false });
    m.computeBoundingSphere(); m.boundingSphere.radius += 2; m.frustumCulled = true;
  }

  // ---------- rocks, bushes, toadstools ----------
  const rocks = scatter(30, (x, y, z) => { const s = 0.5 + rand() * rand() * 1.9; if (s > 1.1) colliders.push({ x, z, r: s * 0.8 }); return { x, y: y - 0.05, z, s: [s, s * (0.8 + rand() * 0.4), s * (0.8 + rand() * 0.3)], ry: rand() * 6, c: pick(["#ffffff", "#f3ecff", "#e8f0ff", "#fff3e2"]) }; }, { minH: 0.5 });
  instanced(scene, rockModel(5), fol, rocks, { cast: false });
  rocks.forEach((r) => shadeSpot(r.x, r.z, 1.8 * r.s[0], 0.5));
  const bushSpots = [...scatter(44, (x, y, z) => ({ x, y, z, s: 0.9 + rand() * 0.9, ry: rand() * 6, c: pick(["#ffffff", "#eaffea", "#fff4e8"]) }), { minH: 1 })];
  // shrubs tucked against the grove edges and the pond
  for (const t of trees.filter((_, i) => i % 3 === 0)) { const a = rand() * 6.28, x = t.x + Math.cos(a) * 2.6, z = t.z + Math.sin(a) * 2.6; if (free(x, z, { minH: 1 })) bushSpots.push({ x, y: heightAt(x, z), z, s: 0.8 + rand() * 0.7, ry: rand() * 6, c: "#ffffff" }); }
  const bushA = bushSpots.filter((_, i) => i % 3 !== 0), bushB = bushSpots.filter((_, i) => i % 3 === 0);
  instanced(scene, bushModel(3, ["#2a7a4e", "#4aa757", "#a9da62"]), fol, bushA, { cast: false });
  instanced(scene, bushModel(8, ["#2f8052", "#58b15c", "#c2e36c"], "#ff9fc0"), fol, bushB, { cast: false });
  bushSpots.forEach((b) => shadeSpot(b.x, b.z, 1.5 * b.s, 0.45));
  const mush = [];
  for (const t of trees.filter((_, i) => i % 4 === 0)) scatter(3, (x, y, z) => mush.push({ x, y: y - 0.02, z, s: 0.8 + rand() * 0.9, ry: rand() * 6, c: pick(["#ffffff", "#ffd0dc", "#ffc890", "#f0b0ff"]) }), { minH: 1 }, t.x, t.z, 3.4);
  instanced(scene, mushroomModel(), fol, mush, { cast: false });

  // ---------- terrain mesh: painted in the shader (grass patches, worn paths with pebbles, sand, baked contact shade) ----------
  const SEG = 96, SIZE = EXT * 2;
  const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  tg.rotateX(-Math.PI / 2);
  const pos = tg.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  tg.computeVertexNormals();
  const terrainMat = toon("#ffffff", { rim: 0 });
  const tBase = terrainMat.onBeforeCompile;
  terrainMat.onBeforeCompile = (s, r) => {
    tBase(s, r);
    s.uniforms.uData = pool.uData; s.uniforms.uNoise = pool.uNoise;
    s.vertexShader = "varying vec2 vXZ;\n" + s.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
    s.fragmentShader = `varying vec2 vXZ;\n${GROUND_GLSL}\n` + s.fragmentShader.replace("#include <color_fragment>", `
      vec4 dd = texture2D(uData, (vXZ + ${EXT.toFixed(1)}) / ${(EXT * 2).toFixed(1)});
      vec4 nA = texture2D(uNoise, vXZ * 0.09), nB = texture2D(uNoise, vXZ * 0.55);
      float h = dd.r;
      float mdw = max(dd.a, 0.0);
      vec3 col = grassCol(vXZ, mdw) * (0.9 + 0.2 * nA.g) * (0.93 + 0.14 * nB.b);
      col = mix(col, col * vec3(0.78, 0.9, 0.7), smoothstep(0.6, 0.72, nB.g) * 0.45);                 // darker clover tufts
      col = mix(col, col * vec3(1.12, 1.1, 0.8), smoothstep(0.66, 0.8, nB.r) * 0.3);                  // sun-bleached strokes
      float pe = dd.g + (nA.g - 0.5) * 0.5 + (nB.b - 0.5) * 0.22;
      float pm = smoothstep(0.4, 0.52, pe);
      vec3 dirt = mix(${glc("#d9b27c")}, ${glc("#ecd2a0")}, nA.r) * (0.9 + 0.2 * nB.b);
      dirt = mix(dirt, ${glc("#f3e4c6")}, smoothstep(0.8, 0.84, nB.g) * 0.6);                         // pebbles
      dirt = mix(dirt, dirt * 0.8, smoothstep(0.3, 0.2, nB.g) * 0.5);                                  // dints
      col = mix(col, col * vec3(0.8, 0.8, 0.62), smoothstep(0.18, 0.4, pe) * (1.0 - pm) * 0.7);        // worn grass at the path edge
      col = mix(col, dirt, pm);
      float sandT = smoothstep(0.3, 0.6, -dd.a + (nA.g - 0.5) * 0.35);
      vec3 sand = mix(${glc("#f3d9a2")}, ${glc("#fbeac0")}, nA.r) * (0.94 + 0.12 * nB.b);
      sand = mix(sand, ${glc("#d8b784")}, 1.0 - smoothstep(-0.3, 0.25, h));
      col = mix(col, sand, sandT);
      col = mix(col * vec3(0.5, 0.55, 0.78), col, dd.b);
      diffuseColor.rgb = col;`);
  };
  terrainMat.customProgramCacheKey = () => "terrain2";
  const terrain = new THREE.Mesh(tg, terrainMat);
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ---------- water: depth colour, caustics, shore foam, sky reflection, sun glitter. One shader for sea and pond ----------
  const waterMat = (level, depthK, vertexWaves) => {
    const m = new THREE.ShaderMaterial({
      transparent: true, fog: true, depthWrite: false,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time, uData: pool.uData, uNoise: pool.uNoise, shallow: { value: new THREE.Color("#8ff2df") }, mid: { value: new THREE.Color("#3fbfe0") }, deep: { value: new THREE.Color("#2b6fd0") },
        uSky: { value: new THREE.Color(SKY.low) }, uSun: { value: SUN_DIR }, uLevel: { value: level }, uDepthK: { value: depthK }, uRefl: { value: vertexWaves ? 1 : 0.35 } }]),
      vertexShader: `uniform float time; varying vec2 vP; varying vec3 vW;
        #include <fog_pars_vertex>
        void main(){
          vec3 p = position; vec4 w = modelMatrix * vec4(p, 1.0);
          ${vertexWaves ? "p.z += 0.07 * (sin(w.x * 0.21 + time * 0.9) + sin(w.z * 0.27 - time * 0.7));" : ""}
          vP = w.xz; vW = w.xyz;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform float time, uLevel, uDepthK, uRefl; uniform vec3 shallow, mid, deep, uSky, uSun; uniform sampler2D uData, uNoise; varying vec2 vP; varying vec3 vW;
        #include <fog_pars_fragment>
        void main(){
          float h = texture2D(uData, (vP + ${EXT.toFixed(1)}) / ${(EXT * 2).toFixed(1)}).r;
          float depth = max(uLevel - h, 0.0), sd = smoothstep(0.0, uDepthK, depth);
          vec3 c = mix(shallow, mid, smoothstep(0.0, 0.5, sd)); c = mix(c, deep, smoothstep(0.35, 1.0, sd));
          vec4 a = texture2D(uNoise, vP * 0.05 + time * vec2(0.011, 0.007)), b = texture2D(uNoise, vP * 0.093 - time * vec2(0.009, 0.013));
          vec3 n = normalize(vec3(a.g + b.a - 1.0, 1.6, a.a + b.g - 1.0));
          vec3 V = normalize(cameraPosition - vW);
          float ca = 1.0 - smoothstep(0.0, 0.07, abs(texture2D(uNoise, vP * 0.21 + time * 0.021).g - texture2D(uNoise, vP * 0.17 - time * 0.017 + 0.5).g));
          c += vec3(0.75, 1.0, 0.85) * ca * 0.2 * (1.0 - sd);
          float fres = pow(1.0 - max(dot(V, n), 0.0), 3.0);
          c = mix(c, uSky, clamp(fres * 0.7, 0.0, 0.7) * uRefl);
          float near = 1.0 - smoothstep(60.0, 220.0, length(cameraPosition.xz - vP));
          float sp = max(dot(reflect(-V, n), uSun), 0.0);
          c += vec3(1.0, 0.86, 0.62) * (pow(sp, 90.0) * 1.6 + step(0.93, a.b * b.b + pow(sp, 10.0) * 0.6) * 1.2 * near);
          float wob = (a.g - 0.5) * 0.3 + 0.05 * sin(time * 1.3 + vP.x * 0.25 + vP.y * 0.2);
          float foam = 1.0 - smoothstep(0.08, 0.2, depth + wob);
          float band = (1.0 - smoothstep(0.0, 0.07, abs(fract(depth * 1.5 - time * 0.11 + a.g * 0.5) - 0.5))) * (1.0 - smoothstep(0.25, 0.9, depth)) * smoothstep(0.5, 0.65, b.g + 0.2);
          float f = clamp(foam + band * 0.55, 0.0, 1.0) * step(-0.03, uLevel - h);
          c = mix(c, vec3(1.0, 0.99, 0.95), f);
          gl_FragColor = vec4(c, mix(0.5, 0.95, smoothstep(0.0, 0.8, sd)) + f * 0.4);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    m.uniforms.time = time; m.uniforms.uData = pool.uData; m.uniforms.uNoise = pool.uNoise; // merge() clones uniforms; re-share them
    return m;
  };
  const water = new THREE.Mesh(new THREE.PlaneGeometry(760, 760, 48, 48), waterMat(WATER_Y, 3.0, true));
  water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y;
  scene.add(water);
  world.water = water;
  const pondM = new THREE.Mesh(new THREE.CircleGeometry(1, 40), waterMat(POND.level, 1.7, false));
  pondM.rotation.x = -Math.PI / 2; pondM.position.set(POND.x, POND.level, POND.z); pondM.scale.set(POND.a * 1.25, POND.b * 1.25, 1);
  pondM.renderOrder = 1;
  scene.add(pondM);

  // ---------- lawn + flowers: instances recycle around the player; placed, coloured (from the ground) and blown by wind in the shader ----------
  const poolPatch = (mat, kind) => {
    const U = { uWin: { value: new THREE.Vector4(48, 13, 22, 1) } };
    mat.onBeforeCompile = (s) => {
      s.uniforms.uC = pool.uC; s.uniforms.uData = pool.uData; s.uniforms.uNoise = pool.uNoise; s.uniforms.uTime = time; s.uniforms.uWin = U.uWin;
      s.vertexShader = `uniform vec2 uC; uniform vec4 uWin; uniform float uTime; attribute vec3 aSeed; attribute float aPart;\n${GROUND_GLSL}\n` + s.vertexShader.replace("#include <begin_vertex>", `
        vec2 o = aSeed.xy * uWin.x;
        vec2 wp = o + uWin.x * floor((uC - o) / uWin.x + 0.5);
        vec4 dd = texture2D(uData, (wp + ${EXT.toFixed(1)}) / ${(EXT * 2).toFixed(1)});
        vec4 nA = texture2D(uNoise, wp * 0.09);
        float fade = 1.0 - smoothstep(uWin.y, uWin.z, length(wp - uC));
        float mdw = max(dd.a, 0.0);
        float ok = step(-0.3, dd.a + (nA.g - 0.5) * 0.3) * (1.0 - smoothstep(0.24, 0.4, dd.g + (nA.g - 0.5) * 0.5));
        ${kind === "flower" ? "ok *= step(1.0 - mdw * 1.05 - 0.04, fract(aSeed.z * 7.31));" : ""}
        float sc = fade * ok * (0.7 + 0.6 * aSeed.z) * uWin.w${kind === "flower" ? "" : " * (1.0 + 0.3 * mdw)"};
        float ang = aSeed.z * 61.0, ca = cos(ang), sa = sin(ang);
        vec3 transformed = vec3(position.x * ca - position.z * sa, position.y, position.x * sa + position.z * ca) * sc;
        float gust = texture2D(uNoise, wp * 0.017 + uTime * vec2(0.034, 0.021)).r;
        float gs = smoothstep(0.35, 0.8, gust), y2 = position.y * position.y * sc;
        transformed.x += y2 * (0.3 + 1.5 * gs) * ${kind === "flower" ? "0.5" : "1.0"} + sin(uTime * 2.1 + wp.x * 1.3 + wp.y) * 0.05 * position.y * sc;
        transformed.z += y2 * (0.15 + 0.8 * gs) * ${kind === "flower" ? "0.5" : "1.0"} + cos(uTime * 1.7 + wp.y * 1.1) * 0.035 * position.y * sc;
        transformed += vec3(wp.x, dd.r - 0.02, wp.y);
        ${kind === "flower" ? `
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb = color * mix(vec3(1.0), instanceColor.rgb, aPart);
        #endif` : `
        vec3 gc = grassCol(wp, mdw) * (0.9 + 0.2 * nA.g);
        float hh = clamp(position.y / 0.4, 0.0, 1.0);
        vColor.rgb = mix(gc * 0.9, mix(gc, ${glc("#d8ef7a")}, 0.26) * (1.04 + 0.22 * gs), hh);`}
        vColor.rgb = mix(vColor.rgb * vec3(0.5, 0.55, 0.78), vColor.rgb, mix(1.0, dd.b, 0.85));`);
      s.fragmentShader = s.fragmentShader.replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize(vNormal);");
    };
    mat.customProgramCacheKey = () => "pool2" + kind;
    mat.userData.U = U;
    return mat;
  };
  const poolMesh = (geo, mat, count, tints) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    const seed = new Float32Array(count * 3);
    dummy.position.set(0, 0, 0); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
    for (let i = 0; i < count; i++) { seed[i * 3] = rand(); seed[i * 3 + 1] = rand(); seed[i * 3 + 2] = rand(); m.setMatrixAt(i, dummy.matrix); if (tints) m.setColorAt(i, col.set(pick(tints))); }
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 3));
    m.frustumCulled = false; m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  // a clump of curved blades (quad + tip each); normals point up so the lawn shades like the ground it grows from
  const clumpGeo = (blades) => {
    const P = [], N = [];
    for (let b = 0; b < blades; b++) {
      const a = (b / blades) * 6.283 + rand() * 1.2, h = 0.26 + rand() * 0.2, w = 0.05 + rand() * 0.025, lean = 0.12 + rand() * 0.3, r0 = rand() * 0.13;
      const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx, bx = dx * r0, bz = dz * r0;
      const at = (t, side, wk) => [bx + dx * lean * h * t * t + px * side * w * wk, h * t, bz + dz * lean * h * t * t + pz * side * w * wk];
      const bl = at(0, -0.5, 1), br = at(0, 0.5, 1), ml = at(0.55, -0.5, 0.72), mr = at(0.55, 0.5, 0.72), tp = at(1, 0, 0);
      P.push(...bl, ...br, ...mr, ...bl, ...mr, ...ml, ...ml, ...mr, ...tp);
      for (let i = 0; i < 9; i++) N.push(0, 1, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
    return g;
  };
  const grassMat = () => poolPatch(new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: ramp, vertexColors: true, side: THREE.DoubleSide }), "grass");
  const GRASS_MAX = [3900, 2400];
  const gNearMat = grassMat(), gFarMat = grassMat();
  gNearMat.userData.U.uWin.value.set(24, 8.5, 12, 1); gFarMat.userData.U.uWin.value.set(60, 22, 30, 1.7);
  const grassNear = poolMesh(clumpGeo(4), gNearMat, GRASS_MAX[0]), grassFar = poolMesh(clumpGeo(3), gFarMat, GRASS_MAX[1]);
  // flower: stem + six petals + centre in ONE geometry; aPart = 1 on petals (tinted per instance)
  const flowerGeo = (() => {
    const P = [], C = [], A = [], sg = new THREE.Color("#5cae52"), ye = new THREE.Color("#ffc93c"), wh = new THREE.Color("#ffffff");
    const tri = (a, b, c, colr, part) => { P.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) { C.push(colr.r, colr.g, colr.b); A.push(part); } };
    const H = 0.4;
    for (let i = 0; i < 3; i++) { const a0 = (i / 3) * 6.283, a1 = ((i + 1) / 3) * 6.283, r = 0.014; const p0 = [Math.cos(a0) * r, 0, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, 0, Math.sin(a1) * r], q0 = [p0[0], H, p0[2]], q1 = [p1[0], H, p1[2]]; tri(p0, p1, q1, sg, 0); tri(p0, q1, q0, sg, 0); }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 6.283, a0 = a - 0.42, a1 = a + 0.42, r = 0.125;
      const tip = [Math.cos(a) * r, H + 0.035, Math.sin(a) * r], l = [Math.cos(a0) * r * 0.62, H + 0.012, Math.sin(a0) * r * 0.62], rr = [Math.cos(a1) * r * 0.62, H + 0.012, Math.sin(a1) * r * 0.62];
      tri([0, H, 0], l, rr, wh, 1); tri(l, tip, rr, wh, 1);
    }
    for (let i = 0; i < 5; i++) { const a0 = (i / 5) * 6.283, a1 = ((i + 1) / 5) * 6.283, r = 0.04; tri([0, H + 0.05, 0], [Math.cos(a1) * r, H + 0.016, Math.sin(a1) * r], [Math.cos(a0) * r, H + 0.016, Math.sin(a0) * r], ye, 0); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(C, 3)); g.setAttribute("aPart", new THREE.Float32BufferAttribute(A, 1));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(P.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    return g;
  })();
  const fMat = poolPatch(new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: ramp, vertexColors: true, side: THREE.DoubleSide }), "flower");
  fMat.userData.U.uWin.value.set(64, 24, 31, 1.15);
  const flowers = poolMesh(flowerGeo, fMat, 700, ["#ff8fab", "#ffe066", "#ffffff", "#c9a7ff", "#ff9f6b", "#ffffff", "#ffd0e0", "#8ecbff"]);
  world.grass = grassNear;

  // ---------- places: cottage + garden, pond + bridge, hilltop lookout, picnic, jetty. A handful of merged meshes ----------
  const HOT = (hex, k) => new THREE.Color(hex).multiplyScalar(k); // HDR colour: unlit + brighter than white, so it blooms
  const glowParts = [];
  world.lanterns = [];
  // place a list of local-space parts into the world (keeps p / r / s authoring simple)
  const placeParts = (out, parts, x, y, z, ry = 0) => { const pm = mat4([x, y, z], [0, ry, 0]); for (const p of parts) out.push({ ...p, m: p.m ? new THREE.Matrix4().multiplyMatrices(pm, p.m) : mat4(p.p, p.r, p.s, pm), p: undefined, r: undefined, s: undefined }); };
  const STONE = ["#9f95b5", "#ddd6e6"], PLASTER = ["#f1d6ae", "#fff7e6"], WOOD = "#b5774a", WOOD_D = "#7c4c33", WOOD_L = "#d9a26a", ROOF = ["#c9503f", "#f08a68"], TEAL = "#5fb3a6", LEAF = ["#3c8f52", "#9bd866"];
  const lantern = (out, x, z, ry = 0) => {
    const y = heightAt(x, z), parts = [
      { g: cyl(0.07, 0.11, 2.3, 7), p: [0, 1.15, 0], vg: ["#4a3a52", "#75607c"] }, { g: cyl(0.16, 0.2, 0.18, 8), p: [0, 0.09, 0], c: "#5d4a66" },
      { g: tor(0.3, 0.035, 5, 10, Math.PI * 0.55), p: [0.3, 2.28, 0], r: [0, 0, Math.PI * 0.45], c: "#5d4a66" },
      { g: new THREE.ConeGeometry(0.2, 0.16, 6), p: [0.55, 2.3, 0], c: "#5d4a66" }, { g: cyl(0.13, 0.1, 0.05, 6), p: [0.55, 1.93, 0], c: "#5d4a66" },
    ];
    placeParts(out, parts, x, y, z, ry);
    const c = Math.cos(ry), s = Math.sin(ry), lx = x + c * 0.55, lz = z - s * 0.55;
    glowParts.push({ g: cyl(0.1, 0.12, 0.26, 6), p: [lx, y + 2.08, lz], c: HOT("#ffc874", 2.6) });
    world.lanterns.push({ x: lx, y: y + 2.08, z: lz });
  };
  const flowerTuft = (out, x, y, z, cols, n = 4, r = 0.3) => { for (let i = 0; i < n; i++) { const a = (i / n) * 6.28 + rand(), d = r * (0.3 + rand() * 0.7); out.push({ g: sph(0.13, 7, 5), p: [x + Math.cos(a) * d, y + 0.02 + rand() * 0.08, z + Math.sin(a) * d], c: cols[i % cols.length] }); } out.push({ g: sph(r * 0.95, 8, 5), p: [x, y - 0.08, z], s: [1, 0.55, 1], grad: LEAF }); };

  // --- cottage (the shop) and its garden ---
  {
    const cx = COTTAGE.x, cz = COTTAGE.z, gy = terrainHeight(cx, cz), P = [], out = [];
    P.push({ g: box(6.0, 0.6, 5.0), p: [0, 0.2, 0], vg: STONE });
    for (let i = 0; i < 11; i++) for (const sz of [-1, 1]) P.push({ g: sph(0.3, 8, 6), p: [-2.75 + i * 0.55, 0.2 + (i % 2) * 0.05, sz * 2.5], s: [1, 0.8, 0.45], grad: STONE });
    P.push({ g: box(5.2, 2.5, 4.3), p: [0, 1.72, 0], vg: PLASTER });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push({ g: box(0.26, 2.6, 0.26), p: [sx * 2.6, 1.75, sz * 2.15], c: WOOD_D });
    for (const sz of [-1, 1]) P.push({ g: box(5.5, 0.22, 0.2), p: [0, 2.96, sz * 2.17], c: WOOD_D }, { g: box(5.5, 0.16, 0.16), p: [0, 0.6, sz * 2.17], c: WOOD_D });
    for (const sx of [-1, 1]) P.push({ g: box(0.2, 0.22, 4.4), p: [sx * 2.62, 2.96, 0], c: WOOD_D }, { g: box(0.14, 2.4, 0.2), p: [sx * 2.64, 1.75, 0], c: WOOD_D });
    // gable roof: overlapping shingle rows, ridge cap, white bargeboards
    const RA = Math.atan2(2.2, 2.95), RL = Math.hypot(2.2, 2.95), ROWS = 6;
    for (const sz of [-1, 1]) {
      for (let i = 0; i < ROWS; i++) {
        const t = (i + 0.5) / ROWS, zz = sz * 2.95 * (1 - t), yy = 2.82 + 2.2 * t;
        P.push({ g: box(6.5 - (i % 2) * 0.12, 0.13, RL / ROWS + 0.2), p: [0, yy + 0.06, zz], r: [sz * (RA + 0.07), 0, 0], c: i % 2 ? "#e27458" : "#d96450" });
      }
      for (const sx of [-1, 1]) P.push({ g: box(0.12, 0.2, RL + 0.25), p: [sx * 3.22, 3.9, sz * 1.5], r: [sz * RA, 0, 0], c: "#fff3e0" });
      P.push({ g: box(6.2, 0.1, RL), p: [0, 3.82, sz * 1.48], r: [sz * RA, 0, 0], c: "#b9735a" });
    }
    P.push({ g: cyl(0.16, 0.16, 6.6, 8), p: [0, 5.12, 0], r: [0, 0, Math.PI / 2], c: "#b94a3c" });
    const gable = new THREE.Shape(); gable.moveTo(-2.3, 0); gable.lineTo(2.3, 0); gable.lineTo(0, 1.72); gable.lineTo(-2.3, 0);
    const gableG = new THREE.ExtrudeGeometry(gable, { depth: 0.2, bevelEnabled: false });
    for (const sx of [-1, 1]) {
      P.push({ g: gableG, p: [sx * 2.6 - 0.1, 2.96, 0], r: [0, Math.PI / 2, 0], vg: ["#fbe8c8", "#fff7e6"] });
      P.push({ g: cyl(0.36, 0.36, 0.1, 14), p: [sx * 2.72, 3.6, 0], r: [0, 0, Math.PI / 2], c: "#fff3e0" });
      glowParts.push({ g: cyl(0.27, 0.27, 0.12, 14), m: mat4([sx * 2.74, 3.6, 0], [0, 0, Math.PI / 2], [1, 1, 1], mat4([cx, gy, cz])), c: HOT("#ffcf7a", 1.9) });
    }
    // chimney
    P.push({ g: box(0.8, 2.3, 0.8), p: [1.55, 4.5, 0.95], vg: STONE }, { g: box(1.0, 0.2, 1.0), p: [1.55, 5.7, 0.95], c: "#b9b0c9" }, { g: cyl(0.2, 0.24, 0.35, 8), p: [1.55, 5.95, 0.95], c: "#c9654f" });
    world.chimney = { x: cx + 1.55, y: gy + 6.15, z: cz + 0.95 };
    // door with arched top, steps, lamp, hanging paw sign
    P.push({ g: box(1.36, 1.9, 0.14), p: [0, 1.42, -2.2], c: WOOD_D }, { g: cyl(0.68, 0.68, 0.14, 18), p: [0, 2.37, -2.2], r: [Math.PI / 2, 0, 0], c: WOOD_D });
    P.push({ g: box(1.08, 1.8, 0.12), p: [0, 1.4, -2.27], vg: ["#9a5a36", "#c98352"] }, { g: cyl(0.54, 0.54, 0.12, 18), p: [0, 2.3, -2.27], r: [Math.PI / 2, 0, 0], c: "#c98352" });
    for (const x of [-0.27, 0.27]) P.push({ g: box(0.025, 1.75, 0.02), p: [x, 1.4, -2.335], c: "#8a4f30" });
    P.push({ g: sph(0.07, 8, 6), p: [0.36, 1.35, -2.36], c: "#ffd76a" }, { g: tor(0.2, 0.035, 6, 14), p: [0, 2.2, -2.34], c: "#fff3e0" });
    glowParts.push({ g: cyl(0.18, 0.18, 0.04, 12), m: mat4([0, 2.2, -2.34], [Math.PI / 2, 0, 0], [1, 1, 1], mat4([cx, gy, cz])), c: HOT("#ffcf7a", 2.0) });
    P.push({ g: box(1.9, 0.24, 0.9), p: [0, 0.38, -2.85], vg: STONE }, { g: box(2.3, 0.2, 0.7), p: [0, 0.16, -3.45], vg: STONE }, { g: box(1.1, 0.03, 0.6), p: [0, 0.515, -2.85], c: "#e2725b" });
    P.push({ g: box(0.06, 0.06, 0.8), p: [1.15, 2.75, -2.55], c: WOOD_D }, { g: box(0.7, 0.52, 0.07), p: [1.15, 2.4, -2.85], c: WOOD_L }, { g: box(0.78, 0.6, 0.04), p: [1.15, 2.4, -2.85], c: WOOD_D });
    for (const [x, y, r] of [[0, -0.07, 0.11], [-0.15, 0.08, 0.05], [-0.05, 0.14, 0.05], [0.05, 0.14, 0.05], [0.15, 0.08, 0.05]]) for (const sz of [-1, 1]) P.push({ g: cyl(r, r, 0.02, 10), p: [1.15 + x, 2.4 + y, -2.85 + sz * 0.04], r: [Math.PI / 2, 0, 0], c: "#ff8fab" });
    // windows: frame, glowing glass, muntins, shutters, flower boxes
    const win = (x, y, z, ry) => {
      const W = [{ g: box(1.2, 1.2, 0.12), p: [0, 0, 0], c: "#fff3e0" }, { g: box(0.05, 0.92, 0.05), p: [0, 0, -0.1], c: "#fff3e0" }, { g: box(0.92, 0.05, 0.05), p: [0, 0, -0.1], c: "#fff3e0" }, { g: box(1.34, 0.1, 0.24), p: [0, -0.63, -0.06], c: "#fff3e0" }];
      for (const sx of [-1, 1]) W.push({ g: box(0.36, 1.16, 0.07), p: [sx * 0.8, 0, -0.06], c: TEAL }, { g: box(0.26, 0.04, 0.03), p: [sx * 0.8, 0.3, -0.11], c: "#4a968b" }, { g: box(0.26, 0.04, 0.03), p: [sx * 0.8, -0.3, -0.11], c: "#4a968b" });
      W.push({ g: box(1.3, 0.26, 0.34), p: [0, -0.85, -0.2], vg: ["#8a5536", "#b5774a"] });
      const fc = ["#ff8fab", "#ffe066", "#ffffff", "#c9a7ff", "#ff9f6b"];
      for (let i = 0; i < 5; i++) W.push({ g: sph(0.14, 7, 5), p: [-0.5 + i * 0.25, -0.64 + (i % 2) * 0.05, -0.22], c: fc[(i + (x > 0 ? 2 : 0)) % 5] }, { g: sph(0.13, 6, 4), p: [-0.4 + i * 0.22, -0.73, -0.3], grad: LEAF });
      const pm = mat4([x, y, z], [0, ry, 0]);
      for (const w of W) P.push({ ...w, m: mat4(w.p, [0, 0, 0], [1, 1, 1], pm), p: undefined });
      glowParts.push({ g: box(0.94, 0.94, 0.06), m: mat4([0, 0, -0.04], [0, 0, 0], [1, 1, 1], mat4([x, y, z], [0, ry, 0], [1, 1, 1], mat4([cx, gy, cz]))), c: HOT("#ffd07c", 1.9) });
    };
    win(-1.72, 1.9, -2.17, 0); win(1.72, 1.9, -2.17, 0); win(2.62, 1.9, 0.2, -Math.PI / 2); win(-2.62, 1.9, 0.2, Math.PI / 2);
    // ivy on a corner, barrel and crate
    for (let i = 0; i < 9; i++) P.push({ g: sph(0.22 + rand() * 0.14, 7, 5), p: [-2.72 + rand() * 0.5, 0.7 + i * 0.26, -2.25 + rand() * 0.2], s: [1, 0.8, 0.6], grad: LEAF });
    P.push({ g: cyl(0.36, 0.3, 0.75, 10), p: [2.15, 0.86, -2.75], vg: ["#8a5536", "#c08552"] }, { g: tor(0.345, 0.03, 5, 12), p: [2.15, 1.0, -2.75], r: [Math.PI / 2, 0, 0], c: "#6b5a70" }, { g: tor(0.33, 0.03, 5, 12), p: [2.15, 0.68, -2.75], r: [Math.PI / 2, 0, 0], c: "#6b5a70" });
    P.push({ g: box(0.6, 0.5, 0.6), p: [-2.2, 0.74, -2.85], r: [0, 0.3, 0], vg: ["#a8683f", "#d9a26a"] });
    placeParts(out, P, cx, gy, cz);
    colliders.push({ x: cx, z: cz, r: 3.3 });
    world.door = { x: cx, z: cz - 3.4 };
    shadeSpot(cx, cz, 5.2, 0.6); clearSpot(cx, cz, 3.6);
    // picket fence with pointed tops (gap = the gate), gate posts with lamps
    const picket = new THREE.ConeGeometry(0.1, 0.16, 4);
    const fence = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 0.5)), ang = Math.atan2(x1 - x0, z1 - z0);
      for (let i = 0; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n, z = z0 + ((z1 - z0) * i) / n, y = heightAt(x, z), post = i % 3 === 0, hh = post ? 1.0 : 0.82;
        out.push({ g: box(post ? 0.16 : 0.12, hh, post ? 0.16 : 0.05), p: [x, y + hh / 2, z], r: [0, ang, 0], vg: ["#e9d6bd", "#fffaf0"] }, { g: picket, p: [x, y + hh + 0.07, z], r: [0, ang + Math.PI / 4, 0], s: post ? [1.15, 1, 1.15] : [0.85, 1, 0.4], c: "#fffaf0" });
        if (post) colliders.push({ x, z, r: 0.5 });
      }
      for (const yy of [0.3, 0.62]) out.push({ g: box(0.05, 0.09, len), p: [(x0 + x1) / 2, heightAt((x0 + x1) / 2, (z0 + z1) / 2) + yy, (z0 + z1) / 2], r: [0, ang, 0], c: "#f0dfc6" });
    };
    fence(-24, 19, -17.5, 19); fence(-10.5, 19, -5, 19); fence(-24, 19, -24, 34); fence(-5, 19, -5, 34); fence(-24, 34, -5, 34);
    for (const gx of [-17.3, -10.7]) { const y = heightAt(gx, 19); out.push({ g: box(0.3, 1.5, 0.3), p: [gx, y + 0.75, 19], vg: ["#e9d6bd", "#fffaf0"] }, { g: sph(0.2, 8, 6), p: [gx, y + 1.62, 19], c: "#fffaf0" }); }
    // stepping-stone path from the gate to the door
    for (let i = 0; i < 6; i++) { const x = cx + Math.sin(i * 1.7) * 0.35, z = 19.4 + i * 0.62, y = heightAt(x, z); out.push({ g: cyl(0.42, 0.46, 0.1, 9), p: [x, y + 0.03, z], r: [0, i, 0], s: [1, 1, 0.8], vg: STONE }); clearSpot(x, z, 0.9); }
    // mailbox
    { const x = -9.6, z = 18.2, y = heightAt(x, z); out.push({ g: cyl(0.06, 0.07, 1.1, 6), p: [x, y + 0.55, z], c: WOOD_D }, { g: cyl(0.2, 0.2, 0.5, 10, 1, false, 0, Math.PI), p: [x, y + 1.2, z], r: [Math.PI / 2, Math.PI / 2, 0], c: "#ff6f7f" }, { g: box(0.4, 0.2, 0.5), p: [x, y + 1.1, z], c: "#ff6f7f" }, { g: box(0.03, 0.22, 0.12), p: [x + 0.22, y + 1.32, z + 0.1], c: "#ffd76a" }); }
    // vegetable patch
    for (let r = 0; r < 3; r++) {
      const z = 27.5 + r * 1.3;
      out.push({ g: sph(1, 10, 6), p: [-20.3, gy + 0.02, z], s: [2.6, 0.2, 0.45], grad: ["#7a5238", "#a87850"] });
      for (let i = 0; i < 6; i++) { const x = -22.4 + i * 0.84; if (r === 1) out.push({ g: sph(0.24, 8, 6), p: [x, gy + 0.3, z], s: [1, 0.8, 1], grad: ["#5aa05a", "#c4ec8a"] }); else out.push({ g: new THREE.ConeGeometry(0.2, 0.5, 6), p: [x, gy + 0.42, z], grad: LEAF }, { g: sph(0.09, 6, 4), p: [x, gy + 0.2, z], c: r ? "#ff8a4a" : "#ff6f7f" }); }
      clearSpot(-20.3, z, 0.9); clearSpot(-22, z, 0.9); clearSpot(-18.6, z, 0.9);
    }
    // well
    {
      const wx = -8.5, wz = 30, y = heightAt(wx, wz), W = [{ g: cyl(0.85, 0.95, 0.8, 14), p: [0, 0.4, 0], vg: STONE }, { g: tor(0.85, 0.1, 6, 14), p: [0, 0.8, 0], r: [Math.PI / 2, 0, 0], c: "#ddd6e6" }, { g: cyl(0.72, 0.72, 0.02, 14), p: [0, 0.74, 0], c: "#3f78b8" }];
      for (const sx of [-1, 1]) W.push({ g: box(0.14, 1.9, 0.14), p: [sx * 0.8, 1.3, 0], c: WOOD_D }, { g: box(1.25, 0.1, 0.9), p: [sx * 0.5, 2.5, 0], r: [0, 0, sx * -0.6], c: sx > 0 ? "#e27458" : "#d96450" });
      W.push({ g: cyl(0.05, 0.05, 1.7, 6), p: [0, 1.9, 0], r: [0, 0, Math.PI / 2], c: WOOD }, { g: cyl(0.012, 0.012, 0.7, 4), p: [0, 1.55, 0], c: "#e8dcc8" }, { g: cyl(0.16, 0.13, 0.26, 8), p: [0, 1.15, 0], c: WOOD_L });
      placeParts(out, W, wx, y, wz, 0.4); colliders.push({ x: wx, z: wz, r: 1.0 }); shadeSpot(wx, wz, 1.9, 0.5);
    }
    // bench under the window, flower clumps in the beds
    { const B = [{ g: box(1.6, 0.08, 0.5), p: [0, 0.5, 0], c: WOOD_L }, { g: box(1.6, 0.5, 0.07), p: [0, 0.85, 0.24], r: [-0.15, 0, 0], c: WOOD_L }]; for (const sx of [-1, 1]) B.push({ g: box(0.09, 0.5, 0.45), p: [sx * 0.7, 0.25, 0], c: WOOD_D }); placeParts(out, B, -18.3, gy, 23.2, 0.5); }
    for (const [x, z] of [[-11.2, 23.1], [-16.6, 22.9], [-10.2, 25.5], [-17.9, 26], [-12, 20], [-16, 20.2], [-6.2, 20.5], [-22.8, 20.3], [-6.5, 32.6], [-13, 32.8], [-19, 32.9]]) flowerTuft(out, x, heightAt(x, z) + 0.28, z, pick([["#ff8fab", "#ffd0e0", "#ffffff"], ["#ffe066", "#ff9f6b"], ["#c9a7ff", "#ffffff", "#8ecbff"]]), 5, 0.42);
    lantern(out, -18.4, 18.2, Math.PI);
    const m = bakedMesh(bake(out, { aoH: 0 }), VC({ rim: 0.14 }), { cast: true, receive: true });
    scene.add(m);
  }

  // --- pond: arched bridge, reeds, lily pads with lotus flowers, stones in the shallows; plus the picnic spot ---
  {
    const out = [], N = 17, len = BRIDGE.halfLen * 2, step = len / N;
    for (let i = 0; i < N; i++) {
      const z = BRIDGE.z - BRIDGE.halfLen + (i + 0.5) * step, y = bridgeDeck(z), slope = Math.atan((bridgeDeck(z + 0.1) - bridgeDeck(z - 0.1)) / 0.2);
      out.push({ g: box(BRIDGE.halfW * 2 + 0.1, 0.14, step * 0.9), p: [BRIDGE.x, y - 0.08, z], r: [-slope, 0, 0], c: i % 2 ? "#dcaa72" : "#c99560" });
    }
    for (const sx of [-1, 1]) {
      const x = BRIDGE.x + sx * (BRIDGE.halfW + 0.02);
      for (let i = 0; i <= 8; i++) {
        const z = BRIDGE.z - BRIDGE.halfLen + (i / 8) * len, y = bridgeDeck(z), end = i === 0 || i === 8;
        out.push({ g: cyl(end ? 0.12 : 0.075, end ? 0.14 : 0.085, end ? 1.25 : 0.95, 7), p: [x, y + (end ? 0.5 : 0.38), z], vg: [WOOD_D, WOOD] }, { g: sph(end ? 0.16 : 0.1, 7, 5), p: [x, y + (end ? 1.16 : 0.88), z], c: WOOD });
        if (i < 8) {
          const z2 = BRIDGE.z - BRIDGE.halfLen + ((i + 1) / 8) * len, y2 = bridgeDeck(z2), dz = z2 - z, dy = y2 - y;
          for (const hh of [0.72, 0.4]) out.push({ g: cyl(0.045, 0.045, Math.hypot(dz, dy) + 0.05, 5), p: [x, (y + y2) / 2 + hh, (z + z2) / 2], r: [Math.PI / 2 - Math.atan2(dy, dz), 0, 0], c: "#c58a55" });
        }
      }
      // beam under the deck edge
      for (let i = 0; i < 8; i++) { const z = BRIDGE.z - BRIDGE.halfLen + ((i + 0.5) / 8) * len, y = bridgeDeck(z), sl = Math.atan((bridgeDeck(z + 0.1) - bridgeDeck(z - 0.1)) / 0.2); out.push({ g: box(0.14, 0.22, len / 8 + 0.05), p: [x - sx * 0.12, y - 0.24, z], r: [-sl, 0, 0], c: WOOD_D }); }
    }
    // reeds and cattails round the banks
    for (let k = 0; k < 13; k++) {
      const a = k * 0.483 * Math.PI + 0.4, ex = 1.02 + rand() * 0.12, bx = POND.x + Math.cos(a) * POND.a * ex, bz = POND.z + Math.sin(a) * POND.b * ex;
      if (nearBridge(bx, bz, 2.2)) continue;
      for (let i = 0; i < 6; i++) {
        const x = bx + (rand() - 0.5) * 1.3, z = bz + (rand() - 0.5) * 1.3, y = Math.max(heightAt(x, z), POND.level - 0.2), h = 0.9 + rand() * 0.8, lean = (rand() - 0.5) * 0.25;
        out.push({ g: cyl(0.018, 0.03, h, 4), p: [x, y + h / 2, z], r: [lean, 0, lean * 0.7], vg: ["#4f9450", "#a5d86a"] });
        if (i % 2) out.push({ g: new THREE.CapsuleGeometry(0.05, 0.2, 2, 6), p: [x - lean * 0.7 * h * 0.5, y + h, z + lean * h * 0.5], r: [lean, 0, lean * 0.7], c: "#8a5a3a" });
        else out.push({ g: new THREE.ConeGeometry(0.07, h * 0.9, 3), p: [x + 0.08, y + h * 0.42, z], r: [lean - 0.2, rand() * 3, 0.25], s: [1, 1, 0.3], grad: ["#4f9450", "#b4e070"] });
      }
    }
    // lily pads (notched) and lotus blooms
    const padG = new THREE.CylinderGeometry(1, 1, 0.03, 14, 1, false, 0.3, 5.7), petalG = new THREE.SphereGeometry(1, 6, 4);
    for (let i = 0; i < 13; i++) {
      const a = rand() * 6.28, r = Math.sqrt(rand()) * 0.8, x = POND.x + Math.cos(a) * r * POND.a, z = POND.z + Math.sin(a) * r * POND.b, s = 0.42 + rand() * 0.4;
      if (nearBridge(x, z, 0.9)) continue;
      out.push({ g: padG, p: [x, POND.level + 0.02, z], r: [0, rand() * 6, 0], s: [s, 1, s], c: pick(["#58b96a", "#6ccb7c", "#4aa862"]) });
      if (i % 3 === 0) {
        for (let k = 0; k < 7; k++) { const pa = (k / 7) * 6.283; out.push({ g: petalG, p: [x + Math.cos(pa) * 0.11, POND.level + 0.13, z + Math.sin(pa) * 0.11], r: [0, -pa, 0.75], s: [0.15, 0.035, 0.075], c: k % 2 ? "#ff9fc0" : "#ffd3e2" }); }
        out.push({ g: sph(0.07, 6, 5), p: [x, POND.level + 0.14, z], c: "#ffd76a" });
      }
    }
    for (let i = 0; i < 6; i++) { const a = 2.35 + i * 0.16, x = POND.x + Math.cos(a) * POND.a * (0.93 - i * 0.012), z = POND.z + Math.sin(a) * POND.b * (0.93 - i * 0.012), s = 0.42 + rand() * 0.2; out.push({ g: sph(1, 9, 6), p: [x, POND.level + 0.0, z], s: [s, 0.16, s * 0.85], grad: STONE }); }
    // picnic: gingham blanket, basket, cushions, a plate of treats
    const px = 8, pz = 36, py = heightAt(px, pz) + 0.035, K = [];
    for (let i = 0; i < 8; i++) for (let j = 0; j < 6; j++) K.push({ g: box(0.45, 0.03, 0.45), p: [-1.57 + i * 0.45, 0, -1.12 + j * 0.45], c: (i + j) % 2 ? "#ff7f8e" : i % 2 ? "#ffd9de" : "#fff7ec" });
    K.push({ g: cyl(0.34, 0.3, 0.36, 10), p: [0.6, 0.2, 0.1], s: [1.25, 1, 1], vg: ["#b07a48", "#deb078"] }, { g: tor(0.3, 0.03, 5, 12, Math.PI), p: [0.6, 0.38, 0.1], c: "#a76b3a" }, { g: box(0.5, 0.03, 0.46), p: [0.5, 0.39, 0.1], r: [0, 0, 0.25], c: "#ffe9a8" });
    K.push({ g: sph(0.3, 10, 7), p: [-0.9, 0.14, 0.4], s: [1, 0.45, 1], c: "#ffd76a" }, { g: sph(0.3, 10, 7), p: [-0.4, 0.14, -0.6], s: [1, 0.45, 1], c: "#8ecbff" }, { g: cyl(0.26, 0.2, 0.03, 12), p: [-0.2, 0.04, 0.5], c: "#ffffff" });
    for (let i = 0; i < 3; i++) K.push({ g: sph(0.08, 7, 5), p: [-0.28 + i * 0.09, 0.11, 0.48 + (i % 2) * 0.08], c: ["#ff6f7f", "#ffb347", "#ff6f7f"][i] });
    placeParts(out, K, px, py, pz, 0.35); clearSpot(px, pz, 1.2);
    lantern(out, 22.1, 12.6, 0.6); lantern(out, 25.9, 31.4, -2.5);
    scene.add(bakedMesh(bake(out), VC({ rim: 0.12 }), { cast: true, receive: true }));
  }

  // --- hilltop lookout: a little gazebo with a bench, a telescope and a flag ---
  {
    const hy = heightAt(HILL.x, HILL.z), P = [], out = [];
    P.push({ g: cyl(2.75, 2.9, 0.3, 8), p: [0, 0.1, 0], vg: ["#b98a5c", "#e0b684"] });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.283 + Math.PI / 8, x = Math.cos(a) * 2.5, z = Math.sin(a) * 2.5;
      P.push({ g: cyl(0.1, 0.12, 2.7, 7), p: [x, 1.55, z], vg: [WOOD_D, WOOD] });
      if (i !== 5) { const a2 = ((i + 1) / 8) * 6.283 + Math.PI / 8, x2 = Math.cos(a2) * 2.5, z2 = Math.sin(a2) * 2.5; for (const hh of [0.75, 1.1]) P.push({ g: box(0.07, 0.09, Math.hypot(x2 - x, z2 - z)), p: [(x + x2) / 2, hh, (z + z2) / 2], r: [0, Math.atan2(x2 - x, z2 - z), 0], c: "#c58a55" }); }
    }
    const roofG = new THREE.LatheGeometry([[3.35, 0], [2.6, 0.32], [1.5, 0.95], [0.45, 1.75], [0.12, 2.1], [0.001, 2.12]].map(([x, y]) => new THREE.Vector2(x, y)), 8);
    P.push({ g: roofG, p: [0, 2.85, 0], r: [0, Math.PI / 8, 0], vg: ROOF }, { g: cyl(3.3, 3.35, 0.1, 8), p: [0, 2.84, 0], r: [0, Math.PI / 8, 0], c: "#fff3e0" }, { g: sph(0.16, 8, 6), p: [0, 5.02, 0], c: "#ffd76a" });
    P.push({ g: cyl(0.03, 0.03, 1.5, 5), p: [0, 5.7, 0], c: "#e9e2f0" }, { g: new THREE.ConeGeometry(0.34, 0.8, 3), p: [0.42, 6.15, 0], r: [0, 0, -Math.PI / 2], s: [1, 1, 0.08], c: "#ff6fa5" });
    P.push({ g: box(1.8, 0.09, 0.5), p: [0, 0.72, 1.75], c: WOOD_L }, { g: box(0.1, 0.45, 0.45), p: [-0.75, 0.48, 1.75], c: WOOD_D }, { g: box(0.1, 0.45, 0.45), p: [0.75, 0.48, 1.75], c: WOOD_D });
    P.push({ g: cyl(0.03, 0.05, 1.2, 5), p: [-1.5, 0.85, -1.3], r: [0.2, 0, 0.15], c: WOOD_D }, { g: cyl(0.03, 0.05, 1.2, 5), p: [-1.75, 0.85, -1.1], r: [-0.15, 0, -0.2], c: WOOD_D }, { g: cyl(0.03, 0.05, 1.2, 5), p: [-1.45, 0.85, -1.0], r: [-0.2, 0, 0.2], c: WOOD_D });
    P.push({ g: cyl(0.09, 0.13, 0.9, 10), p: [-1.57, 1.55, -1.13], r: [Math.PI / 2 - 0.25, 0, 0.6], c: "#ffd76a" });
    placeParts(out, P, HILL.x, hy, HILL.z, 0.3);
    shadeSpot(HILL.x, HILL.z, 3.6, 0.45); clearSpot(HILL.x, HILL.z, 2.9);
    scene.add(bakedMesh(bake(out), VC({ rim: 0.14 }), { cast: true, receive: true }));
  }

  // --- along the paths: lamp posts, a signpost at the crossroads; out on the east shore: a jetty and a rowing boat ---
  {
    const out = [];
    [[3.2, 2.2, 2.6], [-4.6, 17.2, 0.3], [10.4, 11.6, 2], [-12, 45.2, 1.2], [-25.5, 47.4, 1.4], [18, -21.6, 0.2], [38, -27.2, 0.3]].forEach(([x, z, ry]) => lantern(out, x, z, ry));
    { const x = -3.4, z = 1.2, y = heightAt(x, z), S = [{ g: cyl(0.07, 0.1, 2.2, 7), p: [0, 1.1, 0], vg: [WOOD_D, WOOD] }, { g: sph(0.11, 7, 5), p: [0, 2.25, 0], c: WOOD }];
      [[1.85, 0.5, "#ffd9a0"], [1.5, -1.9, "#ffc9d6"], [1.15, 2.6, "#c9ecc0"]].forEach(([yy, ry, c]) => { const pm = mat4([0, yy, 0], [0, ry, 0]); S.push({ g: box(0.9, 0.24, 0.05), m: mat4([0.42, 0, 0], [0, 0, 0], [1, 1, 1], pm), c }, { g: new THREE.ConeGeometry(0.17, 0.2, 3), m: mat4([0.94, 0, 0], [0, 0, -Math.PI / 2], [1, 1, 0.16], pm), c }); });
      const tmp = []; placeParts(tmp, S.filter((s) => s.p), x, y, z); out.push(...tmp);
      const wm = mat4([x, y, z]); for (const s of S.filter((q) => !q.p)) out.push({ ...s, m: new THREE.Matrix4().multiplyMatrices(wm, s.m) }); }
    { const J = [], jx = 77, jz = 6;
      for (let i = 0; i < 14; i++) J.push({ g: box(0.9, 0.1, 2.2), p: [i * 0.95, 0.55, 0], r: [0, (i % 3 - 1) * 0.03, 0], c: i % 2 ? "#dcaa72" : "#c99560" });
      for (let i = 0; i < 5; i++) for (const sz of [-1, 1]) J.push({ g: cyl(0.13, 0.15, 2.4, 7), p: [0.3 + i * 3, -0.3, sz * 1.05], vg: [WOOD_D, WOOD] });
      J.push({ g: new THREE.SphereGeometry(1, 12, 8, 0, 6.283, Math.PI / 2, Math.PI / 2), p: [11.5, 0.42, 2.6], s: [1.9, 0.75, 0.85], vg: ["#b5553f", "#f08a68"] }, { g: sph(1, 12, 4), p: [11.5, 0.36, 2.6], s: [1.8, 0.05, 0.78], c: WOOD_L }, { g: box(0.2, 0.08, 1.5), p: [11.2, 0.42, 2.6], c: "#fff3e0" });
      placeParts(out, J, jx, WATER_Y, jz, -0.12); }
    scene.add(bakedMesh(bake(out), VC({ rim: 0.12 }), { cast: true, receive: true }));
    // far-off islands for depth (fog does the aerial perspective)
    const far = [], fr = rng(77);
    [[310, 0.5, 60, 26], [330, 1.25, 85, 34], [300, 2.3, 55, 22], [345, 3.3, 95, 30], [320, 4.4, 70, 28], [335, 5.5, 60, 20]].forEach(([d, a, w, h]) => {
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      far.push({ g: sph(1, 14, 8), p: [x, -2, z], s: [w, h, w * 0.7], r: [0, a, 0], grad: ["#7fb7a8", "#b9dfa6"] }, { g: sph(1, 12, 7), p: [x + Math.cos(a + 1.5) * w * 0.7, -2, z + Math.sin(a + 1.5) * w * 0.7], s: [w * 0.55, h * 0.55, w * 0.5], grad: ["#7fb7a8", "#b9dfa6"] });
      for (let i = 0; i < 7; i++) { const ta = fr() * 6.28, tr = fr() * 0.6; far.push({ g: sph(1, 6, 5), p: [x + Math.cos(ta) * w * tr, h * (1 - tr * tr) * 0.98 - 2 + 3, z + Math.sin(ta) * w * tr * 0.7], s: [5 + fr() * 4, 6 + fr() * 4, 5 + fr() * 4], grad: ["#5fa58c", "#a5d697"] }); }
    });
    const fm = bakedMesh(bake(far), VC({ rim: 0 }), {});
    fm.frustumCulled = false; scene.add(fm);
  }
  // everything that glows (windows, lamps): one unlit HDR mesh
  { const m = new THREE.Mesh(bake(glowParts).geo, new THREE.MeshBasicMaterial({ vertexColors: true })); m.frustumCulled = false; scene.add(m); }

  // ---------- clouds: ONE instanced mesh of puffy merged spheres ----------
  const cloudG = bake([[0, 0, 0, 7], [7, -1, 1, 5.5], [-6.5, -1.2, -1, 5], [3, 2.5, -1, 5], [-2, 2.2, 1.5, 4.5]].map(([x, y, z, r]) => ({ g: sph(r, 10, 7), p: [x, y, z], grad: ["#e0aab4", "#fff6e4"] }))).geo;
  const clouds = [];
  for (let i = 0; i < 11; i++) { const a = (i / 11) * 6.283 + rand(), d = 140 + rand() * 120; clouds.push({ x: Math.cos(a) * d, y: 55 + rand() * 40, z: Math.sin(a) * d, s: [1.1 + rand(), 0.55, 1.1 + rand() * 0.6] }); }
  const cloudMesh = instanced(scene, cloudG, new THREE.MeshBasicMaterial({ vertexColors: true }), clouds, { receive: false });
  world.clouds = clouds;

  // ---------- birds: instanced, wing flap in the vertex shader ----------
  const birdG = new THREE.BufferGeometry();
  birdG.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0.5, -1.2, 0, -0.1, 0, 0, -0.35, 0, 0, 0.5, 0, 0, -0.35, 1.2, 0, -0.1], 3));
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x4a4560, side: THREE.DoubleSide });
  birdMat.onBeforeCompile = (s) => { s.uniforms.uTime = time; s.vertexShader = "uniform float uTime;\n" + s.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed.y += abs(position.x) * sin(uTime * 7.0 + instanceMatrix[3].x) * 0.55;"); };
  birdMat.customProgramCacheKey = () => "bird";
  const birds = [...Array(5)].map((_, i) => ({ r: 55 + i * 12, y: 38 + (i % 3) * 7, sp: (0.05 + i * 0.012) * (i % 2 ? 1 : -1), a: i * 1.3 }));
  const birdMesh = instanced(scene, birdG, birdMat, birds.map(() => ({ x: 0, y: 0, z: 0 })), { receive: false });

  // ---------- ambient particles: pollen + drifting leaves (one Points draw, motion entirely in the shader) ----------
  const AN = 150, aSeed = new Float32Array(AN * 4), aCol = new Float32Array(AN * 3), aPos = new Float32Array(AN * 3);
  const leafC = ["#ffb7cf", "#ffd9e6", "#ffc48a"].map((c) => new THREE.Color(c)), pollenC = new THREE.Color("#fff6c8");
  for (let i = 0; i < AN; i++) {
    aSeed.set([rand(), rand(), rand(), rand()], i * 4);
    const leaf = i % 5 === 0, c = leaf ? leafC[i % 3] : pollenC; aCol.set([c.r, c.g, c.b], i * 3);
  }
  const ambG = new THREE.BufferGeometry();
  ambG.setAttribute("position", new THREE.BufferAttribute(aPos, 3)); ambG.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 4)); ambG.setAttribute("aColor", new THREE.BufferAttribute(aCol, 3));
  const ambU = { uC: pool.uC, uData: pool.uData, uTime: time, uScale: { value: 800 }, uPx: { value: 1 } };
  const amb = new THREE.Points(ambG, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: ambU,
    vertexShader: `uniform vec2 uC; uniform sampler2D uData; uniform float uTime, uScale, uPx; attribute vec4 aSeed; attribute vec3 aColor; varying vec3 vC; varying float vA;
      void main(){
        vec2 o = aSeed.xy * 40.0; vec2 wp = o + 40.0 * floor((uC - o) / 40.0 + 0.5);
        wp += vec2(sin(uTime * 0.3 + aSeed.w * 20.0), cos(uTime * 0.25 + aSeed.z * 20.0)) * 1.6;
        float h = texture2D(uData, (wp + ${EXT.toFixed(1)}) / ${(EXT * 2).toFixed(1)}).r;
        bool leaf = aColor.g < 0.8;
        float y = leaf ? 7.0 - mod(uTime * 0.7 + aSeed.w * 9.0, 7.0) : 0.8 + aSeed.z * 3.2 + sin(uTime * 0.8 + aSeed.w * 30.0) * 0.4;
        vec3 p = vec3(wp.x, max(h, ${WATER_Y.toFixed(1)}) + y, wp.y);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = length(wp - uC);
        vA = (1.0 - smoothstep(14.0, 20.0, d)) * (leaf ? 0.9 : 0.55 + 0.45 * sin(uTime * 2.0 + aSeed.w * 40.0));
        vC = aColor;
        gl_PointSize = min((leaf ? 0.16 : 0.09) * uScale / max(-mv.z, 0.5), 9.0 * uPx);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying vec3 vC; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = (1.0 - smoothstep(0.5, 1.0, d)) * vA; if (a < 0.02) discard; gl_FragColor = vec4(vC, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  amb.frustumCulled = false;
  scene.add(amb);

  // ---------- glow points (additive): fish halos + lantern light ----------
  const fishCount = FISH_SPOTS.length, GN = fishCount + world.lanterns.length;
  const gPos = new Float32Array(GN * 3), gSize = new Float32Array(GN), gAlpha = new Float32Array(GN), gCol = new Float32Array(GN * 3);
  for (let i = 0; i < GN; i++) { const f = i < fishCount; (f ? col.set("#ffd54a") : col.set("#ffc46b")); gCol.set([col.r, col.g, col.b], i * 3); }
  const glowG = new THREE.BufferGeometry();
  const gPosA = new THREE.BufferAttribute(gPos, 3).setUsage(THREE.DynamicDrawUsage), gSizeA = new THREE.BufferAttribute(gSize, 1).setUsage(THREE.DynamicDrawUsage), gAlphaA = new THREE.BufferAttribute(gAlpha, 1).setUsage(THREE.DynamicDrawUsage);
  glowG.setAttribute("position", gPosA); glowG.setAttribute("aSize", gSizeA); glowG.setAttribute("aAlpha", gAlphaA); glowG.setAttribute("aColor", new THREE.BufferAttribute(gCol, 3));
  const glowU = { uScale: { value: 800 } };
  const glow = new THREE.Points(glowG, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: glowU,
    vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uScale; varying float vA; varying vec3 vC;
      void main(){ vA = aAlpha; vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(-mv.z, 0.5); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; varying vec3 vC;
      void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = pow(1.0 - clamp(d, 0.0, 1.0), 2.0) * vA; gl_FragColor = vec4(vC * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  glow.frustumCulled = false;
  scene.add(glow);
  world.lanterns.forEach((l, i) => { const o = (fishCount + i) * 3; gPos.set([l.x, l.y, l.z], o); gSize[fishCount + i] = 1.5; gAlpha[fishCount + i] = 0.8; });
  world.setViewportHeight = (px, pr = 1) => { ambU.uScale.value = px * 0.96; ambU.uPx.value = pr; glowU.uScale.value = px * 0.96; };

  // ---------- golden fish: ONE instanced mesh (+ instanced outline) ----------
  const fishB = bake([
    { g: sph(1, 14, 10), s: [0.36, 0.22, 0.17], grad: ["#ffae20", "#ffe27a"], ol: 0.03 },
    { g: new THREE.ConeGeometry(0.2, 0.34, 3), p: [-0.4, 0, 0], r: [0, 0, Math.PI / 2], s: [1, 1, 0.25], c: "#ffb020", ol: 0.02 },
    { g: new THREE.ConeGeometry(0.1, 0.2, 3), p: [0, 0.22, 0], s: [1, 1, 0.25], c: "#ffb020", ol: 0.015 },
    ...[-1, 1].flatMap((sz) => [{ g: sph(0.075, 8, 6), p: [0.2, 0.05, sz * 0.13], c: "#ffffff" }, { g: sph(0.05, 8, 6), p: [0.23, 0.05, sz * 0.15], c: "#3b2a4a" }]),
  ], { smooth: false });
  const fishMesh = new THREE.InstancedMesh(fishB.geo, VC({ rim: 0.3, emissive: new THREE.Color("#ff9d00"), emissiveIntensity: 0.3 }), fishCount);
  const fishOutline = new THREE.InstancedMesh(fishB.outGeo, outlineMaterial(), fishCount);
  fishOutline.instanceMatrix = fishMesh.instanceMatrix;
  fishMesh.frustumCulled = fishOutline.frustumCulled = false;
  scene.add(fishMesh, fishOutline);
  world.fish = FISH_SPOTS.map(([x, z], i) => ({ id: "fish" + (i + 1), i, baseY: heightAt(x, z) + 1.1, x, z, got: false, group: { position: new THREE.Vector3(x, heightAt(x, z) + 1.1, z) } }));

  // ---------- coins: instanced coin + paw print (shared matrices) ----------
  const COIN_N = 25;
  const coinG = cyl(0.36, 0.36, 0.09, 18).rotateX(Math.PI / 2);
  const pawParts = [];
  for (const sz of [-1, 1]) {
    const pz = sz * 0.05;
    const pad = sph(1, 8, 6); pad.scale(0.12, 0.1, 0.02); pad.translate(0, -0.06, pz); pawParts.push(pad);
    [[-0.12, 0.07], [-0.04, 0.12], [0.04, 0.12], [0.12, 0.07]].forEach(([x, y]) => { const t = sph(1, 6, 4); t.scale(0.04, 0.045, 0.02); t.translate(x, y, pz); pawParts.push(t); });
  }
  const pawGeo = mergeGeometries(pawParts.map((g) => { g.deleteAttribute("uv"); return g.index ? g.toNonIndexed() : g; }));
  const coinMesh = new THREE.InstancedMesh(coinG, toon("#ffd43b", { emissive: new THREE.Color("#ff9d00"), emissiveIntensity: 0.35, rim: 0.3 }), COIN_N);
  const pawMesh = new THREE.InstancedMesh(pawGeo, toon("#e09500"), COIN_N);
  pawMesh.instanceMatrix = coinMesh.instanceMatrix;
  coinMesh.frustumCulled = pawMesh.frustumCulled = false;
  scene.add(coinMesh, pawMesh);
  world.coins = { mesh: coinMesh, paw: pawMesh, items: [...Array(COIN_N)].map(() => ({ x: 0, y: 0, z: 0, alive: false, respawn: rand() * 4, phase: rand() * 6 })) };
  world.randomSpot = (out) => {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * 74;
      out.x = Math.cos(a) * r; out.z = Math.sin(a) * r;
      if (shoreD(out.x, out.z) < 0.76 && heightAt(out.x, out.z) > 0.7 && pondE(out.x, out.z) > 1.0 && Math.hypot(out.x - COTTAGE.x, out.z - COTTAGE.z) > 4.5) break;
    }
    out.y = heightAt(out.x, out.z);
  };

  // ---------- butterflies: instanced wings + bodies ----------
  const BN = 14;
  const wingG = new THREE.CircleGeometry(0.17, 10); wingG.scale(1, 0.8, 1); wingG.rotateX(-Math.PI / 2); wingG.translate(0.16, 0, 0);
  const wings = new THREE.InstancedMesh(wingG, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), BN * 2);
  const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.025, 0.14, 2, 5).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3b2a4a }), BN);
  const bcols = ["#ff8fab", "#ffd43b", "#74c0fc", "#b197fc", "#ffa94d"];
  wings.frustumCulled = bodies.frustumCulled = false;
  scene.add(wings, bodies);
  world.butterflies = [...Array(BN)].map((_, i) => {
    wings.setColorAt(i * 2, col.set(bcols[i % 5])); wings.setColorAt(i * 2 + 1, col.set(bcols[i % 5]));
    const a = rand() * 6.28, d = 10 + rand() * 60;
    return { group: { position: new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d) }, dir: rand() * 6.28, turn: 0, hover: 1.2 + rand() * 1.5, ph: rand() * 10, cd: 0, flee: false };
  });

  // ---------- chimney smoke: a few soft puffs, animated entirely in the shader ----------
  {
    const SN = 9, g = new THREE.BufferGeometry(), sd = new Float32Array(SN).map((_, i) => i / SN);
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SN * 3), 3)); g.setAttribute("aS", new THREE.BufferAttribute(sd, 1));
    const smoke = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uTime: time, uScale: ambU.uScale, uO: { value: new THREE.Vector3(world.chimney.x, world.chimney.y, world.chimney.z) } },
      vertexShader: `uniform float uTime, uScale; uniform vec3 uO; attribute float aS; varying float vA;
        void main(){ float t = fract(uTime * 0.11 + aS);
          vec3 p = uO + vec3(t * 1.6 + sin(aS * 40.0 + t * 4.0) * 0.25 * t, t * 4.2, cos(aS * 31.0 + t * 3.0) * 0.25 * t + t * 0.5);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); vA = (1.0 - t) * smoothstep(0.0, 0.12, t) * 0.55;
          gl_PointSize = (0.5 + t * 1.5) * uScale / max(-mv.z, 0.5); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = (1.0 - smoothstep(0.3, 1.0, d)) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vec3(1.0, 0.95, 0.9), a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    smoke.frustumCulled = false; scene.add(smoke);
  }

  // ---------- quality ----------
  world.setQuality = (q) => {
    world.quality = q;
    grassNear.count = Math.min(GRASS_MAX[0], q.grass); grassFar.count = Math.min(GRASS_MAX[1], q.grassFar); flowers.count = Math.min(700, q.flowers); amb.geometry.setDrawRange(0, q.ambient);
    world.setShadowSize(q.shadow);
  };
  world.setQuality({ grass: 3900, grassFar: 2400, flowers: 700, ambient: 150, shadow: 2048 });
  bakeData();

  // ---------- per-frame ----------
  const tmpO = { x: 0, z: 0 };
  const fishWob = (f, t) => f.baseY + Math.sin(t * 2 + f.i) * 0.18;
  world.update = (dt, t, px, pz) => {
    time.value = t;
    pool.uC.value.set(px, pz);
    for (let i = 0; i < clouds.length; i++) { const c = clouds[i]; c.x += dt * 1.2; if (c.x > 300) c.x = -300; dummy.position.set(c.x, c.y, c.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(...c.s); dummy.updateMatrix(); cloudMesh.setMatrixAt(i, dummy.matrix); }
    cloudMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i]; b.a += b.sp * dt;
      dummy.position.set(Math.cos(b.a) * b.r, b.y + Math.sin(b.a * 3) * 2, Math.sin(b.a) * b.r);
      dummy.rotation.set(0, -b.a + (b.sp > 0 ? 0 : Math.PI) + Math.PI, 0); dummy.scale.setScalar(1.3); dummy.updateMatrix(); birdMesh.setMatrixAt(i, dummy.matrix);
    }
    birdMesh.instanceMatrix.needsUpdate = true;
    // butterflies
    for (let i = 0; i < world.butterflies.length; i++) {
      const b = world.butterflies[i], p = b.group.position, dx = p.x - px, dz = p.z - pz, d2 = dx * dx + dz * dz, flee = d2 < 36;
      b.flee = flee; b.cd = Math.max(0, b.cd - dt);
      b.turn += (Math.random() - 0.5) * dt * 8; b.turn *= 0.96;
      if (flee) { const want = Math.atan2(dx, dz), diff = Math.atan2(Math.sin(want - b.dir), Math.cos(want - b.dir)); b.dir += diff * Math.min(1, dt * 5); }
      else b.dir += b.turn * dt * 2;
      const sp = flee ? 4.6 : 1.6;
      p.x += Math.sin(b.dir) * sp * dt; p.z += Math.cos(b.dir) * sp * dt;
      tmpO.x = p.x; tmpO.z = p.z; clampToIsland(tmpO);
      if (tmpO.x !== p.x || tmpO.z !== p.z) { p.x = tmpO.x; p.z = tmpO.z; b.dir += 2.5; }
      p.y += (heightAt(p.x, p.z) + b.hover + Math.sin(t * 1.7 + b.ph) * 0.4 - p.y) * Math.min(1, dt * 3);
      const f = Math.sin(t * (flee ? 28 : 16) + b.ph) * 0.9;
      dummy.position.copy(p); dummy.rotation.set(0, b.dir, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); bodies.setMatrixAt(i, dummy.matrix);
      dummy.rotation.order = "YXZ";
      dummy.rotation.set(0, b.dir, f); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); wings.setMatrixAt(i * 2, dummy.matrix);
      dummy.rotation.set(0, b.dir, -f); dummy.scale.set(-1, 1, 1); dummy.updateMatrix(); wings.setMatrixAt(i * 2 + 1, dummy.matrix);
      dummy.rotation.order = "XYZ";
    }
    bodies.instanceMatrix.needsUpdate = wings.instanceMatrix.needsUpdate = true;
    // fish (spin + bob), glow halos
    for (let i = 0; i < world.fish.length; i++) {
      const f = world.fish[i];
      if (f.got) { dummy.scale.setScalar(0); dummy.position.set(0, -50, 0); dummy.updateMatrix(); fishMesh.setMatrixAt(i, dummy.matrix); gAlpha[i] = 0; continue; }
      const y = fishWob(f, t);
      f.group.position.y = y;
      dummy.position.set(f.x, y, f.z); dummy.rotation.set(0, t * 2 + i, 0); dummy.scale.setScalar(1.15); dummy.updateMatrix(); fishMesh.setMatrixAt(i, dummy.matrix);
      gPos[i * 3] = f.x; gPos[i * 3 + 1] = y; gPos[i * 3 + 2] = f.z; gSize[i] = 2.3 + Math.sin(t * 3 + i) * 0.4; gAlpha[i] = 0.55 + Math.sin(t * 3 + i) * 0.15;
    }
    fishMesh.instanceMatrix.needsUpdate = true; gPosA.needsUpdate = gSizeA.needsUpdate = gAlphaA.needsUpdate = true;
  };
  return world;
}
