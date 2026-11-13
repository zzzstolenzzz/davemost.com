import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Soft toon ramp: a gentle gradient inside the shadow, then a smooth (not banded) terminator into full light.
const RW = 256, rampData = new Uint8Array(RW);
for (let i = 0; i < RW; i++) {
  const u = i / (RW - 1), t = Math.min(1, Math.max(0, (u - 0.43) / 0.2)), lit = t * t * (3 - 2 * t);
  rampData[i] = Math.round(255 * ((0.3 + 0.14 * u) * (1 - lit) + lit * (0.9 + 0.1 * u)));
}
export const ramp = new THREE.DataTexture(rampData, RW, 1, THREE.RedFormat);
ramp.minFilter = ramp.magFilter = THREE.LinearFilter;
ramp.generateMipmaps = false;
ramp.needsUpdate = true;

// Shared tileable noise (RGBA, 256px): R = big soft patches, G = medium, B = fine grain, A = a second big-patch field.
// Sampled by the terrain, grass, water, foliage and fur shaders instead of computing hash noise per pixel.
export const noiseTex = (() => {
  const N = 256, d = new Uint8Array(N * N * 4);
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const chan = (c, basePeriod, octaves) => {
    const acc = new Float32Array(N * N);
    let amp = 1, tot = 0;
    for (let o = 0, per = basePeriod; o < octaves; o++, per *= 2, amp *= 0.5) {
      const L = new Float32Array(per * per).map(rnd), cell = N / per;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy);
        let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        const x0 = ix % per, x1 = (ix + 1) % per, y0 = iy % per, y1 = (iy + 1) % per;
        const a = L[y0 * per + x0], b = L[y0 * per + x1], e = L[y1 * per + x0], f = L[y1 * per + x1];
        acc[y * N + x] += amp * (a + (b - a) * tx + (e - a + (f - b - e + a) * tx) * ty);
      }
      tot += amp;
    }
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < N * N; i++) { lo = Math.min(lo, acc[i]); hi = Math.max(hi, acc[i]); }
    for (let i = 0; i < N * N; i++) d[i * 4 + c] = Math.round(255 * (acc[i] - lo) / (hi - lo));
  };
  chan(0, 4, 5); chan(1, 12, 4); chan(2, 48, 2); chan(3, 5, 4);
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
})();

export const INK = 0x3b2a4a;
export const time = { value: 0 }; // shared shader clock (sway, shimmer)

// Toon material with a fresnel rim light (cool sky tint) and optional wind sway, patched in via onBeforeCompile.
// opts: rim (0..1), sway (0 = off; driven by local height, instanced meshes only), plus any material option.
export function toon(color, { rim = 0.12, sway = 0, ...opts } = {}) {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...opts });
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = time;
    s.fragmentShader = s.fragmentShader.replace("#include <opaque_fragment>",
      `float rimF = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 2.6);
       outgoingLight += (diffuseColor.rgb * 0.6 + vec3(0.4, 0.34, 0.26)) * rimF * ${rim.toFixed(3)} * 1.6;
       #include <opaque_fragment>`);
    if (sway) {
      s.vertexShader = "uniform float uTime;\n" + s.vertexShader.replace("#include <begin_vertex>",
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           float sw = max(position.y - 1.2, 0.0) * ${sway.toFixed(3)};
           transformed.x += sin(uTime * 1.3 + instanceMatrix[3].x * 0.3 + instanceMatrix[3].z * 0.2) * sw;
           transformed.z += cos(uTime * 1.1 + instanceMatrix[3].z * 0.3) * sw * 0.7;
         #endif`);
    }
  };
  m.customProgramCacheKey = () => `toon${rim}-${sway}`;
  return m;
}

// Inverted-hull outline. Thickness is a per-vertex attribute "ol" (local units) so one material serves everything.
let olMat = null;
export function outlineMaterial() {
  if (!olMat) {
    olMat = new THREE.MeshBasicMaterial({ color: 0x6a4250, side: THREE.BackSide });
    olMat.onBeforeCompile = (s) => {
      s.vertexShader = "attribute float ol;\n" + s.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed += normalize(normal) * ol;");
    };
    olMat.customProgramCacheKey = () => "outline-attr";
  }
  return olMat;
}

// Flat-faced geometry splits the hull at the edges, so average normals by position first.
function smoothNormals(geo) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, acc = new Map();
  const key = (i) => `${Math.round(pos.getX(i) * 500)},${Math.round(pos.getY(i) * 500)},${Math.round(pos.getZ(i) * 500)}`;
  for (let i = 0; i < pos.count; i++) { const k = key(i), a = acc.get(k) || [0, 0, 0]; a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i); acc.set(k, a); }
  for (let i = 0; i < pos.count; i++) { const a = acc.get(key(i)); nor.setXYZ(i, a[0], a[1], a[2]); }
}

const _o = new THREE.Object3D(), _c = new THREE.Color();
// Merge many parts into ONE geometry (one draw call) with vertex colors, plus an optional merged outline hull.
// part: { g, m (Matrix4, overrides p/r/s), c: "#hex", p, r, s, ol: outline thickness (none if 0), slot, grad: ["#dark","#light"] (by normal), gy: [y0, k],
//         vg: ["#bottom","#top"] (by height within the part), keep: true (geometry already has vertex colours), blush }
// Returns { geo, outGeo, slot, shade, blush, n }. `shade` = per-vertex up-facing factor (cats use it for fur gradient).
export function bake(parts, { aoH = 0, smooth = true } = {}) {
  const vis = [], out = [], slots = [], shades = [], blushes = [];
  for (const p of parts) {
    let g = p.g.clone();
    g.deleteAttribute("uv");
    if (g.index) g = g.toNonIndexed();
    g.computeBoundingBox();
    const y0 = g.boundingBox.min.y, yh = Math.max(1e-4, g.boundingBox.max.y - y0), posA = g.attributes.position;
    const n = posA.count, bl = new Float32Array(n), vt = p.vg ? new Float32Array(n) : null, pre = p.keep ? g.attributes.color.array.slice() : null;
    if (vt) for (let i = 0; i < n; i++) vt[i] = (posA.getY(i) - y0) / yh;
    if (p.blush) for (let i = 0; i < n; i++) bl[i] = THREE.MathUtils.smoothstep((posA.getY(i) - y0) / yh, 0.45, 1);
    if (p.m) g.applyMatrix4(p.m);
    else {
      _o.position.set(...(p.p || [0, 0, 0])); _o.rotation.set(...(p.r || [0, 0, 0])); _o.scale.set(...(p.s || [1, 1, 1]));
      _o.updateMatrix();
      g.applyMatrix4(_o.matrix);
    }
    const nor = g.attributes.normal, col = new Float32Array(n * 3), sh = new Float32Array(n);
    const base = p.c ? new THREE.Color(p.c) : null, gr = p.vg || p.grad, dark = gr ? new THREE.Color(gr[0]) : null, light = gr ? new THREE.Color(gr[1]) : null;
    for (let i = 0; i < n; i++) {
      const ny = nor.getY(i);
      sh[i] = ny > 0 ? 1 - 0.13 * ny : 1 - 0.1 * ny; // darker back, lighter belly
      if (pre) _c.setRGB(pre[i * 3], pre[i * 3 + 1], pre[i * 3 + 2]);
      else if (vt) _c.copy(dark).lerp(light, vt[i]);
      else if (p.grad) _c.copy(dark).lerp(light, THREE.MathUtils.smoothstep(0.5 + 0.55 * ny + (p.gy ? (posA.getY(i) - p.gy[0]) * p.gy[1] : 0), 0.15, 0.95));
      else if (base) _c.copy(base);
      else _c.setRGB(1, 1, 1);
      if (aoH) _c.multiplyScalar(THREE.MathUtils.lerp(0.68, 1, THREE.MathUtils.clamp(posA.getY(i) / aoH, 0, 1)));
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    vis.push(g); slots.push(new Uint8Array(n).fill(p.slot || 0)); shades.push(sh); blushes.push(bl);
    if (p.ol) {
      const o = g.clone();
      o.deleteAttribute("color");
      o.setAttribute("ol", new THREE.BufferAttribute(new Float32Array(n).fill(p.ol), 1));
      out.push(o);
    }
  }
  const geo = mergeGeometries(vis);
  const cat = (arrs, T) => { const r = new T(arrs.reduce((a, b) => a + b.length, 0)); let o = 0; for (const a of arrs) { r.set(a, o); o += a.length; } return r; };
  let outGeo = null;
  if (out.length) { outGeo = mergeGeometries(out); if (smooth) smoothNormals(outGeo); }
  return { geo, outGeo, slot: cat(slots, Uint8Array), shade: cat(shades, Float32Array), blush: cat(blushes, Float32Array), n: geo.attributes.position.count };
}

// Mesh (vertex-colored toon) + optional outline child from a bake() result.
export function bakedMesh(b, mat, { cast = false, receive = false } = {}) {
  const m = new THREE.Mesh(b.geo, mat);
  m.castShadow = cast; m.receiveShadow = receive;
  if (b.outGeo) { const o = new THREE.Mesh(b.outGeo, outlineMaterial()); o.userData.outline = true; m.add(o); }
  return m;
}
export const VC = (opts) => toon("#ffffff", { vertexColors: true, ...opts });

// Matrix helper: transform from position / euler rotation / scale, optionally chained under a parent matrix.
export function mat4(p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], parent) {
  const o = new THREE.Object3D();
  o.position.set(...p); o.rotation.set(...r); o.scale.set(...s); o.updateMatrix();
  return parent ? new THREE.Matrix4().multiplyMatrices(parent, o.matrix) : o.matrix.clone();
}
