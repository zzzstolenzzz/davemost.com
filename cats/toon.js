import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// 4-step toon ramp (nearest-filtered so the bands stay crisp).
const ramp = new THREE.DataTexture(new Uint8Array([105, 165, 220, 255]), 4, 1, THREE.RedFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
ramp.generateMipmaps = false;
ramp.needsUpdate = true;

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
       outgoingLight += vec3(0.85, 0.88, 1.0) * rimF * ${rim.toFixed(3)} * (0.4 + 0.6 * max(dot(normal, vec3(0.0, 1.0, 0.0)), 0.0));
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
    olMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
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
// part: { g, m (Matrix4, overrides p/r/s), c: "#hex", p, r, s, ol: outline thickness (none if 0), slot, grad: ["#dark","#light"], gy: [y0, k], blush }
// Returns { geo, outGeo, slot, shade, blush, n }. `shade` = per-vertex up-facing factor (cats use it for fur gradient).
export function bake(parts, { aoH = 0, smooth = true } = {}) {
  const vis = [], out = [], slots = [], shades = [], blushes = [];
  for (const p of parts) {
    let g = p.g.clone();
    g.deleteAttribute("uv");
    if (g.index) g = g.toNonIndexed();
    g.computeBoundingBox();
    const y0 = g.boundingBox.min.y, yh = Math.max(1e-4, g.boundingBox.max.y - y0), posA = g.attributes.position;
    const n = posA.count, bl = new Float32Array(n);
    if (p.blush) for (let i = 0; i < n; i++) bl[i] = THREE.MathUtils.smoothstep((posA.getY(i) - y0) / yh, 0.45, 1);
    if (p.m) g.applyMatrix4(p.m);
    else {
      _o.position.set(...(p.p || [0, 0, 0])); _o.rotation.set(...(p.r || [0, 0, 0])); _o.scale.set(...(p.s || [1, 1, 1]));
      _o.updateMatrix();
      g.applyMatrix4(_o.matrix);
    }
    const nor = g.attributes.normal, col = new Float32Array(n * 3), sh = new Float32Array(n);
    const base = p.c ? new THREE.Color(p.c) : null, dark = p.grad ? new THREE.Color(p.grad[0]) : null, light = p.grad ? new THREE.Color(p.grad[1]) : null;
    for (let i = 0; i < n; i++) {
      const ny = nor.getY(i);
      sh[i] = ny > 0 ? 1 - 0.13 * ny : 1 - 0.1 * ny; // darker back, lighter belly
      if (p.grad) _c.copy(dark).lerp(light, THREE.MathUtils.smoothstep(0.5 + 0.55 * ny + (p.gy ? (posA.getY(i) - p.gy[0]) * p.gy[1] : 0), 0.15, 0.95));
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
