import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toon, VC, bake, bakedMesh, mat4, outlineMaterial, time } from "./toon.js";
import { WATER_Y, POND, BRIDGE, COTTAGE, HILL, SPAWN, FISH_SPOTS, heightAt, terrainHeight, bridgeDeck, pondE, shoreD, clampToIsland, colliders, pathMask, PATHS } from "./terrain.js";

const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const dummy = new THREE.Object3D();
const col = new THREE.Color();
export const SKY = { horizon: "#cdeaff", mid: "#7ec9fa", top: "#3d8fee" };
const SUN_DIR = new THREE.Vector3(34, 55, 22).normalize();
const EXT = 125, DS = 384; // data texture covers [-EXT, EXT]
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

  // ---------- sky, fog, lights ----------
  scene.fog = new THREE.Fog(SKY.horizon, 80, 340);
  scene.background = new THREE.Color(SKY.horizon);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(450, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(SKY.top) }, mid: { value: new THREE.Color(SKY.mid) }, hor: { value: new THREE.Color(SKY.horizon) }, sun: { value: SUN_DIR } },
      vertexShader: "varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: `uniform vec3 top, mid, hor, sun; varying vec3 vD;
        void main(){
          vec3 d = normalize(vD); float h = clamp(d.y, 0.0, 1.0);
          vec3 c = mix(hor, mid, smoothstep(0.0, 0.25, h)); c = mix(c, top, smoothstep(0.2, 0.9, h));
          float s = max(dot(d, sun), 0.0);
          c += vec3(1.0, 0.82, 0.55) * (pow(s, 6.0) * 0.28 + pow(s, 40.0) * 0.35);   // warm glow
          c = mix(c, vec3(1.0, 0.98, 0.88), smoothstep(0.9968, 0.9982, s));            // soft sun disc
          c = mix(c, vec3(1.0, 0.93, 0.85), (1.0 - smoothstep(0.0, 0.12, h)) * 0.25);  // hazy horizon
          c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0; // de-band
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
  );
  sky.renderOrder = -1;
  scene.add(sky);
  world.sky = sky;

  // warm key, cool purple-blue sky fill (so shadows read cool, not grey)
  scene.add(new THREE.HemisphereLight(0xb9ccff, 0xf3d9b0, 1.05));
  const sun = new THREE.DirectionalLight(0xffe9c4, 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -22; sc.right = sc.top = 22; sc.near = 1; sc.far = 140;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  world.sun = sun;
  world.sunOffset = SUN_DIR.clone().multiplyScalar(66);
  world.shadowTexel = 44 / 1024;
  // light-space axes, for snapping the shadow camera to texels (stops shadow shimmer while moving)
  world.lightRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
  world.lightUp = new THREE.Vector3().crossVectors(SUN_DIR, world.lightRight).normalize();

  // ---------- terrain data texture: R height, G path mask (used by water, grass, flowers) ----------
  const data = new Uint16Array(DS * DS * 4), H = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < DS; j++) for (let i = 0; i < DS; i++) {
    const x = ((i + 0.5) / DS) * EXT * 2 - EXT, z = ((j + 0.5) / DS) * EXT * 2 - EXT, o = (j * DS + i) * 4;
    data[o] = H(terrainHeight(x, z)); data[o + 1] = H(pathMask(x, z)); data[o + 2] = 0; data[o + 3] = H(1);
  }
  const dataTex = new THREE.DataTexture(data, DS, DS, THREE.RGBAFormat, THREE.HalfFloatType);
  dataTex.minFilter = dataTex.magFilter = THREE.LinearFilter; dataTex.wrapS = dataTex.wrapT = THREE.ClampToEdgeWrapping; dataTex.needsUpdate = true;
  const pool = { uC: { value: new THREE.Vector2() }, uData: { value: dataTex } };
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

  // ---------- trees: 4 instanced variants (round x2, blossom, pine), vertex-colour canopies, shader sway ----------
  const clusters = [[-56, 6, 16], [48, -30, 14], [-30, -50, 18], [62, 40, 12], [10, 62, 12], [-62, -34, 10], [34, -62, 10], [-8, -30, 9], [40, 52, 10], [-50, 40, 9]];
  const trees = [];
  for (const [cx, cz, r] of clusters) scatter(Math.round(r * 0.7), (x, y, z) => trees.push({ x, y, z }), { minH: 1, pad: 1.5, spawn: 17 }, cx, cz, r);
  scatter(12, (x, y, z) => trees.push({ x, y, z }), { minH: 1, pad: 2, spawn: 17 });
  const trunk = (c) => ({ g: cyl(0.28, 0.42, 2.4, 7), c, p: [0, 1.2, 0] });
  const blob = (r, p, dark, light, seg = [10, 7]) => ({ g: sph(r, ...seg), p, grad: [dark, light] });
  const roundTree = (dark, light, trunkC) => bake([trunk(trunkC), blob(1.75, [0, 3.4, 0], dark, light), blob(1.2, [0.9, 4.5, 0.3], dark, light), blob(1.1, [-0.8, 4.2, -0.7], dark, light)], { aoH: 3 });
  const pineTree = () => bake([trunk("#8d5e3a"), ...[[1.7, 2.1, 2.4], [1.35, 1.9, 3.5], [1.0, 1.7, 4.6]].map(([r, h, y]) => ({ g: new THREE.ConeGeometry(r, h, 9), p: [0, y + h / 2 - 0.4, 0], grad: ["#1f7a6a", "#5fc88a"], gy: [y - 0.4, 0.35] }))], { aoH: 3 });
  const variants = [
    { geo: roundTree("#2f9a5a", "#8be07a", "#9a6a3e"), items: [], cast: true },
    { geo: roundTree("#4aa84f", "#d4ee7a", "#a8703f"), items: [], cast: true },
    { geo: roundTree("#d5668e", "#ffd0e2", "#8a5a46"), items: [], cast: true },
    { geo: pineTree(), items: [], cast: true },
  ];
  const treeMat = VC({ rim: 0.2, sway: 0.03 });
  for (const t of trees) {
    const r = rand(), v = r < 0.34 ? 0 : r < 0.62 ? 1 : r < 0.78 ? 2 : 3, s = 0.8 + rand() * 0.8;
    variants[v].items.push({ x: t.x, y: t.y - 0.05, z: t.z, s: [s, s * (0.95 + rand() * 0.2), s], ry: rand() * 6.28, c: col.setRGB(0.92 + rand() * 0.1, 0.92 + rand() * 0.1, 0.92 + rand() * 0.1).getHex() });
    colliders.push({ x: t.x, z: t.z, r: 0.45 * s });
  }
  variants.forEach((v) => { if (v.items.length) instanced(scene, v.geo.geo, treeMat, v.items, { cast: true, receive: false }); });

  // ---------- rocks, bushes, mushrooms ----------
  const rockG = bake([{ g: new THREE.IcosahedronGeometry(1, 1), grad: ["#9b97b8", "#d9d4e6"] }]).geo;
  const rocks = scatter(34, (x, y, z) => { const s = 0.4 + rand() * rand() * 1.8; if (s > 1.1) colliders.push({ x, z, r: s * 0.8 }); return { x, y: y + s * 0.15, z, s: [s, s * 0.65, s * 0.85], ry: rand() * 6, c: pick(["#ffffff", "#f1ecff", "#e6efff", "#fff6e6"]) }; }, { minH: 0.5 });
  instanced(scene, rockG, VC({ rim: 0.15 }), rocks, { cast: false });
  const bushG = bake([blob(0.7, [0, 0.45, 0], "#2e8f55", "#8be07a", [8, 5]), blob(0.5, [0.55, 0.35, 0.2], "#2e8f55", "#8be07a", [7, 4]), blob(0.5, [-0.5, 0.35, -0.2], "#2e8f55", "#8be07a", [7, 4])]).geo;
  const bushSpots = [...scatter(40, (x, y, z) => ({ x, y, z, s: 0.8 + rand() * 0.8, ry: rand() * 6, c: pick(["#ffffff", "#e6ffe6", "#fff0f0"]) }), { minH: 1 }), ...[[-18, 22], [-9, 22], [-19, 30], [-8, 30]].map(([x, z]) => ({ x, y: heightAt(x, z), z, s: 0.9, ry: rand() * 6, c: "#ffffff" }))];
  instanced(scene, bushG, VC({ rim: 0.15 }), bushSpots, { cast: false });
  const mush = [];
  for (const t of trees.filter((_, i) => i % 6 === 0)) scatter(3, (x, y, z) => mush.push({ x, y, z, s: 0.7 + rand() * 0.7, c: pick(["#ff6b6b", "#ff8fab", "#ffa94d", "#e599f7"]) }), { minH: 1 }, t.x, t.z, 3.2);
  instanced(scene, cyl(0.07, 0.09, 0.25, 7).translate(0, 0.125, 0), toon("#fff3e0"), mush.map((m) => ({ ...m, c: undefined })));
  instanced(scene, new THREE.SphereGeometry(0.2, 10, 6, 0, 6.283, 0, 1.45).translate(0, 0.24, 0), toon("#ffffff"), mush);

  // ---------- terrain mesh (painted look: vertex colours + paths + AO + shader noise) ----------
  const SEG = 100, SIZE = EXT * 2;
  const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  tg.rotateX(-Math.PI / 2);
  const pos = tg.attributes.position, colors = new Float32Array(pos.count * 3);
  const sand = new THREE.Color("#f8e1a6"), wet = new THREE.Color("#e8cc92"), seabed = new THREE.Color("#d9c08a"), dirt = new THREE.Color("#dcb98a"), dirtEdge = new THREE.Color("#c9ad76");
  const greens = ["#86d466", "#74c85f", "#9ee07a", "#66c06a", "#b3e27c"].map((c) => new THREE.Color(c));
  const meadowC = new THREE.Color("#b9e87c"), hillC = new THREE.Color("#a6e384"), tmp = new THREE.Color();
  const aoSpots = [...trees.map((t) => [t.x, t.z, 2.1, 0.78]), ...rocks.map((r) => [r.x, r.z, 1.3 * r.s[0], 0.84]), ...bushSpots.map((b) => [b.x, b.z, 1.2, 0.86])];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = terrainHeight(x, z);
    pos.setY(i, h);
    const n = 0.5 + 0.5 * Math.sin(x * 0.09 + 1) * Math.sin(z * 0.07) + 0.15 * Math.sin(x * 0.31 + z * 0.27);
    const gi = Math.min(3.999, Math.max(0, n * 4));
    tmp.copy(greens[Math.floor(gi)]).lerp(greens[Math.min(4, Math.floor(gi) + 1)], gi % 1);
    tmp.lerp(meadowC, meadow(x, z) * 0.55);
    if (h > 5) tmp.lerp(hillC, Math.min(1, (h - 5) / 6) * 0.5);
    tmp.lerp(wet, (1 - sstep(-0.1, 0.45, h)) * 0.0);
    const sandT = 1 - sstep(0.3, 0.95, h);
    tmp.lerp(sand, sandT);
    if (h < 0.35) tmp.lerp(wet, sstep(0.35, -0.1, h) * 0.6);
    if (h < WATER_Y - 0.4) tmp.lerp(seabed, 0.8);
    const pm = pathMask(x, z) * (1 - sandT);
    if (pm > 0) tmp.lerp(pm > 0.55 ? dirt : dirtEdge, Math.min(1, pm * 1.15));
    let ao = 1;
    for (let k = 0; k < aoSpots.length; k++) {
      const a = aoSpots[k], dx = x - a[0], dz = z - a[1];
      if (dx > -a[2] && dx < a[2] && dz > -a[2] && dz < a[2]) { const d = Math.hypot(dx, dz); if (d < a[2]) ao *= 1 - (1 - a[3]) * (1 - d / a[2]); }
    }
    tmp.multiplyScalar(ao);
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  tg.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  tg.computeVertexNormals();
  const terrainMat = toon("#ffffff", { vertexColors: true, rim: 0.05 });
  const tBase = terrainMat.onBeforeCompile;
  terrainMat.onBeforeCompile = (s, r) => {
    tBase(s, r);
    s.vertexShader = "varying vec2 vXZ;\n" + s.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
    s.fragmentShader = `varying vec2 vXZ;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }\n` +
      s.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= 0.9 + 0.2 * vn(vXZ * 0.11) + 0.07 * vn(vXZ * 0.9) - 0.04;");
  };
  terrainMat.customProgramCacheKey = () => "terrain";
  const terrain = new THREE.Mesh(tg, terrainMat);
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ---------- water: depth-aware colour, animated foam ring, sparkles, vertex waves ----------
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(760, 760, 56, 56),
    new THREE.ShaderMaterial({
      transparent: true, fog: true, depthWrite: false,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time, uData: pool.uData, shallow: { value: new THREE.Color("#8af0de") }, mid: { value: new THREE.Color("#45c0e6") }, deep: { value: new THREE.Color("#2f78d8") }, uWaterY: { value: WATER_Y } }]),
      vertexShader: `uniform float time; varying vec2 vP;
        #include <fog_pars_vertex>
        void main(){
          vec3 p = position; vec2 w = (modelMatrix * vec4(p, 1.0)).xz;
          p.z += 0.0; float k = 0.07 * (sin(w.x * 0.21 + time * 0.9) + sin(w.y * 0.27 - time * 0.7));
          vP = w;
          vec4 mvPosition = modelViewMatrix * vec4(p.x, p.y, p.z + k, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform float time; uniform vec3 shallow, mid, deep; uniform sampler2D uData; uniform float uWaterY; varying vec2 vP;
        #include <fog_pars_fragment>
        void main(){
          float h = texture2D(uData, (vP + ${EXT.toFixed(1)}) / ${(EXT * 2).toFixed(1)}).r;
          float depth = max(uWaterY - h, 0.0);
          float sd = smoothstep(0.0, 3.0, depth);
          vec3 c = mix(shallow, mid, smoothstep(0.0, 0.5, sd)); c = mix(c, deep, smoothstep(0.35, 1.0, sd));
          float ripple = sin(vP.x*0.8 + time*1.1) * sin(vP.y*0.7 - time*0.9);
          float foam = (1.0 - smoothstep(0.0, 0.5 + 0.12*ripple, depth + 0.1*sin(time*1.4 + depth*8.0 + vP.x*0.2))) * step(-0.02, uWaterY - h);
          float edge = smoothstep(0.55, 0.75, 1.0 - smoothstep(0.35, 0.6, depth + 0.08*sin(time*1.4 + vP.y*0.3)));
          float near = 1.0 - smoothstep(40.0, 160.0, length(cameraPosition.xz - vP));
          float w = sin(vP.x*0.37 + time*0.8 + sin(vP.y*0.21)*2.0) * sin(vP.y*0.43 - time*0.6 + sin(vP.x*0.17)*2.0) + 0.6*sin((vP.x+vP.y)*0.71 + time*1.3);
          c += vec3(0.8) * step(1.15, w) * 0.4 * near;
          c = mix(c, vec3(1.0, 0.99, 0.95), clamp(foam * 0.9 + edge * 0.25, 0.0, 1.0));
          gl_FragColor = vec4(c, mix(0.5, 0.93, smoothstep(0.0, 0.9, sd)) + foam * 0.3);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    })
  );
  water.material.uniforms.time = time; water.material.uniforms.uData = pool.uData; // merge() clones uniforms; re-share them
  water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y;
  scene.add(water);
  world.water = water;
  const pondM = new THREE.Mesh(new THREE.CircleGeometry(1, 40), toon("#74dcea", { transparent: true, opacity: 0.88, rim: 0.3 }));
  pondM.rotation.x = -Math.PI / 2; pondM.position.set(POND.x, POND.level, POND.z); pondM.scale.set(POND.a * 1.02, POND.b * 1.02, 1);
  scene.add(pondM);

  // ---------- pooled grass + flowers: instances recycle around the player, shader-placed, shader-swayed ----------
  const poolPatch = (mat, { win, f0, f1, kind }) => {
    const base = mat.onBeforeCompile;
    mat.onBeforeCompile = (s, r) => {
      base(s, r);
      s.uniforms.uC = pool.uC; s.uniforms.uData = pool.uData;
      s.vertexShader = `uniform vec2 uC; uniform sampler2D uData; attribute vec3 aSeed; ${MEADOW_GLSL}\n` + s.vertexShader.replace("#include <begin_vertex>", `
        vec2 o = aSeed.xy * ${win.toFixed(1)};
        vec2 wp = o + ${win.toFixed(1)} * floor((uC - o) / ${win.toFixed(1)} + 0.5);
        vec4 dd = texture2D(uData, (wp + ${EXT.toFixed(1)}) / ${(EXT * 2).toFixed(1)});
        float fade = 1.0 - smoothstep(${f0.toFixed(1)}, ${f1.toFixed(1)}, length(wp - uC));
        float ok = step(0.8, dd.r) * (1.0 - smoothstep(0.1, 0.4, dd.g)) ${kind === "flower" ? "* step(0.3, meadowAt(wp))" : ""};
        float sc = fade * ok * (0.6 + 0.55 * aSeed.z);
        float ang = aSeed.z * 40.0, ca = cos(ang), sa = sin(ang);
        vec3 transformed = vec3(position.x * ca - position.z * sa, position.y, position.x * sa + position.z * ca) * sc;
        transformed.x += sin(uTime * 1.7 + wp.x * 0.5 + wp.y * 0.3) * ${kind === "flower" ? "0.05" : "0.11"} * position.y * sc;
        transformed.z += cos(uTime * 1.3 + wp.y * 0.5) * 0.06 * position.y * sc;
        transformed += vec3(wp.x, dd.r - 0.03, wp.y);`);
      if (!s.vertexShader.includes("uniform float uTime")) s.vertexShader = "uniform float uTime;\n" + s.vertexShader;
    };
    mat.customProgramCacheKey = () => "pool" + kind;
    return mat;
  };
  const poolMesh = (geo, mat, count, tints) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    const seed = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { seed[i * 3] = rand(); seed[i * 3 + 1] = rand(); seed[i * 3 + 2] = rand(); dummy.position.set(0, 0, 0); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); if (tints) m.setColorAt(i, col.set(pick(tints))); }
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 3));
    m.frustumCulled = false; m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const blade = (rx, rz, h, w = 0.07) => { const g = new THREE.ConeGeometry(w, h, 3, 1, true); g.translate(0, h / 2, 0); g.rotateX(rx); g.rotateZ(rz); return g; };
  const tuftG = bake([{ g: blade(0, 0, 0.6), grad: ["#4aa05a", "#c4f08a"], gy: [0.3, 1.5] }, { g: blade(0.35, 0.2, 0.48), grad: ["#4aa05a", "#c4f08a"], gy: [0.3, 1.5] }, { g: blade(-0.3, -0.25, 0.42), grad: ["#4aa05a", "#c4f08a"], gy: [0.3, 1.5] }]).geo;
  const grass = poolMesh(tuftG, poolPatch(VC({ rim: 0.1, side: THREE.DoubleSide }), { win: 48, f0: 13, f1: 22, kind: "grass" }), 3400, ["#ffffff", "#f0ffe0", "#e2f5c8", "#ffffff"]);
  const fcol = ["#ff8fab", "#ffe066", "#ffffff", "#b197fc", "#ff9f6b", "#74c0fc"];
  const flowerHead = bake([{ g: new THREE.ConeGeometry(0.14, 0.08, 6, 1, true).rotateX(Math.PI), p: [0, 0.4, 0], c: "#ffffff" }]).geo;
  const flowerStem = bake([{ g: cyl(0.014, 0.018, 0.4, 3), p: [0, 0.2, 0], c: "#5dbb5d" }, { g: sph(0.05, 7, 5), p: [0, 0.42, 0], c: "#ffd43b" }]).geo;
  const fHead = poolMesh(flowerHead, poolPatch(VC({ rim: 0.1, side: THREE.DoubleSide }), { win: 64, f0: 20, f1: 31, kind: "flower" }), 700, fcol);
  const fStem = new THREE.InstancedMesh(flowerStem, poolPatch(VC({ rim: 0.1 }), { win: 64, f0: 20, f1: 31, kind: "flower" }), 700);
  flowerStem.setAttribute("aSeed", flowerHead.getAttribute("aSeed"));
  fStem.instanceMatrix = fHead.instanceMatrix; fStem.frustumCulled = false; fStem.receiveShadow = true;
  scene.add(fStem);
  world.grass = grass; world.flowers = [fHead, fStem];

  // ---------- pond lily pads ----------
  const pads = [];
  for (let i = 0; i < 11; i++) {
    const a = rand() * 6.28, r = Math.sqrt(rand()) * 0.78;
    const x = POND.x + Math.cos(a) * r * POND.a, z = POND.z + Math.sin(a) * r * POND.b;
    if (nearBridge(x, z, 0.8)) continue;
    pads.push({ x, y: POND.level + 0.03, z, s: [0.5 + rand() * 0.4, 1, 0.5 + rand() * 0.4], c: pick(["#5fcf7a", "#74d88a", "#4fbf6f"]) });
  }
  instanced(scene, cyl(1, 1, 0.04, 12), toon("#ffffff"), pads);
  instanced(scene, new THREE.SphereGeometry(0.2, 9, 5, 0, 6.283, 0, 1.4), toon("#ff8fab"), pads.filter((_, i) => i % 3 === 0).map((p) => ({ ...p, y: p.y + 0.03, s: 1, c: undefined })));

  // ---------- static decor, ONE mesh: bridge, fences, lantern posts, picnic ----------
  const wood = "#cf9a63", woodD = "#a76b3a";
  {
    const parts = [], N = 17, len = BRIDGE.halfLen * 2, step = len / N;
    for (let i = 0; i < N; i++) {
      const z = BRIDGE.z - BRIDGE.halfLen + (i + 0.5) * step, y = bridgeDeck(z), slope = Math.atan((bridgeDeck(z + 0.1) - bridgeDeck(z - 0.1)) / 0.2);
      parts.push({ g: box(BRIDGE.halfW * 2, 0.14, step * 0.88), p: [BRIDGE.x, y - 0.08, z], r: [-slope, 0, 0], c: i % 2 ? "#d6a46b" : wood });
    }
    for (const sx of [-1, 1]) for (let i = 0; i <= 8; i++) {
      const z = BRIDGE.z - BRIDGE.halfLen + (i / 8) * len, y = bridgeDeck(z);
      parts.push({ g: box(0.14, 0.9, 0.14), p: [BRIDGE.x + sx * (BRIDGE.halfW - 0.05), y + 0.4, z], c: woodD });
      if (i < 8) {
        const z2 = BRIDGE.z - BRIDGE.halfLen + ((i + 1) / 8) * len, y2 = bridgeDeck(z2), dz = z2 - z, dy = y2 - y;
        parts.push({ g: box(0.09, 0.09, Math.hypot(dz, dy) + 0.05), p: [BRIDGE.x + sx * (BRIDGE.halfW - 0.05), (y + y2) / 2 + 0.8, (z + z2) / 2], r: [-Math.atan2(dy, dz), 0, 0], c: "#b97a45" });
      }
    }
    // picket fence around the cottage garden (gap where the path comes in)
    const fence = (x0, z0, x1, z1) => {
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 1.5)), ang = Math.atan2(x1 - x0, z1 - z0);
      for (let i = 0; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n, z = z0 + ((z1 - z0) * i) / n, y = heightAt(x, z);
        parts.push({ g: box(0.16, 0.95, 0.1), p: [x, y + 0.45, z], r: [0, ang, 0], c: "#fff3e0" }, { g: sph(0.1, 6, 4), p: [x, y + 0.95, z], c: "#fff3e0" });
        colliders.push({ x, z, r: 0.5 });
        if (i < n) {
          const xm = x0 + ((x1 - x0) * (i + 0.5)) / n, zm = z0 + ((z1 - z0) * (i + 0.5)) / n, ym = heightAt(xm, zm);
          parts.push({ g: box(0.06, 0.1, 1.5), p: [xm, ym + 0.32, zm], r: [0, ang, 0], c: "#f4e2c8" }, { g: box(0.06, 0.1, 1.5), p: [xm, ym + 0.7, zm], r: [0, ang, 0], c: "#f4e2c8" });
        }
      }
    };
    fence(-24, 19, -18, 19); fence(-10, 19, -5, 19); fence(-24, 19, -24, 34); fence(-5, 19, -5, 34); fence(-24, 34, -5, 34);
    // lantern posts along the paths
    world.lanterns = [[3, 3], [-4, 17], [10, 11], [22, 11], [26, 33], [-12, 44], [-26, 44]].map(([x, z]) => {
      const y = heightAt(x, z);
      parts.push({ g: cyl(0.06, 0.09, 1.7, 6), p: [x, y + 0.85, z], c: "#5b4a6b" }, { g: box(0.34, 0.06, 0.34), p: [x, y + 1.78, z], c: "#5b4a6b" }, { g: new THREE.ConeGeometry(0.28, 0.2, 4), p: [x, y + 2.14, z], r: [0, Math.PI / 4, 0], c: "#5b4a6b" });
      return { x, y: y + 1.55, z };
    });
    // picnic blanket, basket and cushions
    const px = 8, pz = 36, py = heightAt(px, pz) + 0.04;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 6; j++) parts.push({ g: box(0.45, 0.04, 0.45), p: [px - 1.57 + i * 0.45, py, pz - 1.12 + j * 0.45], c: (i + j) % 2 ? "#ff6f7f" : "#fff6ea" });
    parts.push({ g: box(0.6, 0.35, 0.45), p: [px + 0.5, py + 0.2, pz], c: "#c98f5a" }, { g: tor(0.25, 0.03, 5, 12, Math.PI), p: [px + 0.5, py + 0.38, pz], r: [0, 0, 0], c: "#a76b3a" }, { g: sph(0.28, 8, 6), p: [px - 0.8, py + 0.2, pz + 0.3], s: [1, 0.55, 1], c: "#ffd43b" }, { g: sph(0.28, 8, 6), p: [px - 0.4, py + 0.2, pz - 0.5], s: [1, 0.55, 1], c: "#74c0fc" });
    const decor = bakedMesh(bake(parts), VC({ rim: 0.12 }), { cast: true, receive: true });
    decor.frustumCulled = false;
    scene.add(decor);
    world.decor = decor;
  }
  // lantern glass (unlit, warm)
  {
    const g = bake(world.lanterns.map((l) => ({ g: box(0.24, 0.3, 0.24), p: [l.x, l.y, l.z], c: "#ffe9a0" })));
    const m = new THREE.Mesh(g.geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
    m.frustumCulled = false; scene.add(m);
  }

  // ---------- cottage + lookout (hero props: merged, outlined) ----------
  {
    const cx = COTTAGE.x, cz = COTTAGE.z;
    const P = [
      { g: box(5.6, 0.5, 4.9), p: [0, 0.2, 0], c: "#c9c2d6" },
      { g: box(5, 2.5, 4.3), p: [0, 1.7, 0], c: "#fff0d6", ol: 0.04 },
      { g: new THREE.ConeGeometry(4.4, 2.3, 4), p: [0, 4.1, 0], r: [0, Math.PI / 4, 0], s: [1.15, 1, 1], c: "#ef6a5b", ol: 0.04 },
      { g: box(0.7, 1.9, 0.7), p: [1.4, 4.4, 0.8], c: "#e08a6a", ol: 0.03 }, { g: box(0.85, 0.2, 0.85), p: [1.4, 5.4, 0.8], c: "#c9c2d6" },
      { g: box(1, 1.7, 0.14), p: [0, 1.35, -2.2], c: "#a8623a" }, { g: sph(0.07, 8, 6), p: [0.3, 1.3, -2.3], c: "#ffd43b" }, { g: box(1.8, 0.2, 0.9), p: [0, 0.35, -2.75], c: "#d8cfe3" },
      { g: box(1, 0.9, 0.12), p: [-1.7, 1.9, -2.2], c: "#bfe9ff" }, { g: box(1.2, 1.1, 0.1), p: [-1.7, 1.9, -2.17], c: "#ffffff" },
      { g: box(1, 0.9, 0.12), p: [1.7, 1.9, -2.2], c: "#bfe9ff" }, { g: box(1.2, 1.1, 0.1), p: [1.7, 1.9, -2.17], c: "#ffffff" },
      { g: box(0.12, 0.9, 1), p: [2.5, 1.9, 0], c: "#bfe9ff" }, { g: box(0.1, 1.1, 1.2), p: [2.47, 1.9, 0], c: "#ffffff" },
      { g: box(1.5, 0.3, 0.4), p: [-1.7, 1.2, -2.5], c: "#a8623a" }, { g: box(1.5, 0.3, 0.4), p: [1.7, 1.2, -2.5], c: "#a8623a" },
      ...[-2.1, -1.7, -1.3].flatMap((x, i) => [{ g: sph(0.15, 8, 6), p: [x, 1.42, -2.5], c: ["#ff8fab", "#ffe066", "#ff8fab"][i] }, { g: sph(0.15, 8, 6), p: [x + 3.4, 1.42, -2.5], c: ["#ffe066", "#b197fc", "#ffe066"][i] }]),
    ];
    const m = bakedMesh(bake(P, { aoH: 3.2 }), VC({ rim: 0.18 }), { cast: true, receive: true });
    m.position.set(cx, terrainHeight(cx, cz), cz);
    scene.add(m);
    colliders.push({ x: cx, z: cz, r: 3.3 });
    world.door = { x: cx, z: cz - 3.4 };
  }
  {
    const hy = heightAt(HILL.x, HILL.z);
    const P = [{ g: box(4.4, 0.16, 4.4), p: [0, 0.07, 0], c: "#d6a06a" }];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push({ g: box(0.22, 2.9, 0.22), p: [sx * 2, 1.5, sz * 2], c: "#a76b3a", ol: 0.03 });
    for (const [x, z, rw, rd] of [[0, 2, 4.2, 0.1], [0, -2, 4.2, 0.1], [2, 0, 0.1, 4.2], [-2, 0, 0.1, 4.2]]) P.push({ g: box(rw, 0.1, rd), p: [x, 1.0, z], c: "#b97a45" }, { g: box(rw, 0.1, rd), p: [x, 0.55, z], c: "#b97a45" });
    P.push({ g: new THREE.ConeGeometry(3.6, 1.5, 4), p: [0, 3.65, 0], r: [0, Math.PI / 4, 0], c: "#ef6a5b", ol: 0.04 });
    P.push({ g: cyl(0.04, 0.04, 2.4, 6), p: [2.6, 1.3, -2.6], c: "#d9d9e3" }, { g: new THREE.ConeGeometry(0.4, 0.8, 3), p: [3.0, 2.2, -2.6], r: [0, 0, -Math.PI / 2], s: [1, 1, 0.1], c: "#ff6fa5" });
    const m = bakedMesh(bake(P), VC({ rim: 0.15 }), { cast: true, receive: true });
    m.position.set(HILL.x, hy, HILL.z);
    scene.add(m);
  }

  // ---------- clouds: ONE instanced mesh of puffy merged spheres ----------
  const cloudG = bake([[0, 0, 0, 7], [7, -1, 1, 5.5], [-6.5, -1.2, -1, 5], [3, 2.5, -1, 5], [-2, 2.2, 1.5, 4.5]].map(([x, y, z, r]) => ({ g: sph(r, 10, 7), p: [x, y, z], grad: ["#b4c6e6", "#ffffff"] }))).geo;
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
  const leafC = ["#ffb347", "#ff8a65", "#9be564"].map((c) => new THREE.Color(c)), pollenC = new THREE.Color("#fff6c8");
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
        bool leaf = aColor.r > 0.7 && aColor.b < 0.7;
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

  // ---------- quality ----------
  world.setQuality = (q) => {
    world.quality = q;
    grass.count = q.grass; fHead.count = fStem.count = q.flowers; amb.geometry.setDrawRange(0, q.ambient);
  };
  world.setQuality({ grass: 3400, flowers: 700, ambient: 150 });

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
