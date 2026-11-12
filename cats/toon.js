import * as THREE from "three";

// 4-step toon ramp (nearest-filtered so the bands stay crisp).
const ramp = new THREE.DataTexture(new Uint8Array([100, 160, 215, 255]), 4, 1, THREE.RedFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
ramp.generateMipmaps = false;
ramp.needsUpdate = true;

export const toon = (color, opts = {}) => new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...opts });
export const INK = 0x3b2a4a;

// Inverted-hull outline: same geometry, back faces only, pushed out along the normals.
const outlineMats = new Map();
function outlineMat(t) {
  let m = outlineMats.get(t);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
    m.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>\ntransformed += normalize(normal) * ${t.toFixed(4)};`);
    };
    m.customProgramCacheKey = () => "outline" + t;
    outlineMats.set(t, m);
  }
  return m;
}
// Flat-shaded boxy geometry splits the hull at the edges, so "smooth" averages normals by position first.
function smoothedClone(geo) {
  const g = geo.clone(), pos = g.attributes.position, nor = g.attributes.normal, acc = new Map(), key = (i) => `${Math.round(pos.getX(i) * 1e3)},${Math.round(pos.getY(i) * 1e3)},${Math.round(pos.getZ(i) * 1e3)}`;
  for (let i = 0; i < pos.count; i++) { const k = key(i), a = acc.get(k) || [0, 0, 0]; a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i); acc.set(k, a); }
  for (let i = 0; i < pos.count; i++) { const a = acc.get(key(i)); nor.setXYZ(i, a[0], a[1], a[2]); }
  return g;
}
// t is in the mesh's local units (so it scales with the mesh).
export function addOutline(mesh, t = 0.03, smooth = false) {
  const geo = smooth ? smoothedClone(mesh.geometry) : mesh.geometry;
  const o = mesh.isInstancedMesh
    ? Object.assign(new THREE.InstancedMesh(geo, outlineMat(t), mesh.count), { instanceMatrix: mesh.instanceMatrix })
    : new THREE.Mesh(geo, outlineMat(t));
  o.frustumCulled = false;
  o.userData.outline = true;
  mesh.add(o);
  return mesh;
}
export function disposeTree(obj) { obj.traverse((o) => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); }); }
