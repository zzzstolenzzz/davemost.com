// The cat's body as ONE smooth sculpted mesh, built once and shared by every cat.
// Shape = smooth union of ellipsoids / tapered capsules (an implicit surface), polygonised with surface nets,
// then snapped back onto the true surface and given exact normals. Skin weights come from the same primitives,
// so joints blend without seams. Colours are NOT baked here: the fur shader paints them from the rest position.
import * as THREE from "three";

const H = 0.028; // cell size (m). ~9k vertices / 18k triangles.
export const TAIL0 = [0, 0.6, -0.45], TAILD = [0, 0.6, -0.8], TAIL_SEG = 0.15, TAIL_N = 6;
export const NOSE = [0, 0.915, 0.776], EYE = { x: 0.2, y: 1.005, rx: 0.128, ry: 0.158 };
export const HEAD_PIVOT = [0, 0.8, 0.3];

// name, parent index, pivot
export const BONES = [
  ["root", -1, 0, 0, 0],
  ["body", 0, 0, 0.52, -0.12],
  ["chest", 1, 0, 0.55, 0.12],
  ["head", 2, ...HEAD_PIVOT],
  ["earL", 3, 0.25, 1.24, 0.34], ["earR", 3, -0.25, 1.24, 0.34],
  ["flU", 2, 0.165, 0.45, 0.25], ["flL", 6, 0.165, 0.24, 0.27],
  ["frU", 2, -0.165, 0.45, 0.25], ["frL", 8, -0.165, 0.24, 0.27],
  ["blU", 1, 0.19, 0.45, -0.28], ["blL", 10, 0.185, 0.24, -0.27],
  ["brU", 1, -0.19, 0.45, -0.28], ["brL", 12, -0.185, 0.24, -0.27],
];
const TAIL_BONE0 = BONES.length;
for (let i = 0; i < TAIL_N; i++) BONES.push(["tail" + i, i ? TAIL_BONE0 + i - 1 : 1, TAIL0[0], TAIL0[1] + TAILD[1] * TAIL_SEG * i, TAIL0[2] + TAILD[2] * TAIL_SEG * i]);
export const BONE = Object.fromEntries(BONES.map((b, i) => [b[0], i]));

// ---- primitives ----
const P = [];
const ell = (bone, c, r, k = 0.08, sub = false) => P.push({ t: 0, bone, c, r, k, sub, bc: c, br: Math.max(...r) });
const cone = (bone, a, b, r1, r2, k = 0.06, sz = 1) => P.push({ t: 1, bone, a, b: [b[0], b[1], a[2] + (b[2] - a[2]) / sz], r1, r2, k, sz, sub: false, bc: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], br: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2 + Math.max(r1, r2) });
// head
ell(3, [0, 1.0, 0.37], [0.43, 0.37, 0.37]);
for (const s of [1, -1]) ell(3, [s * 0.2, 0.9, 0.46], [0.25, 0.21, 0.23], 0.08);
ell(3, [0, 0.875, 0.68], [0.15, 0.105, 0.1], 0.05);
ell(3, NOSE, [0.043, 0.03, 0.03], 0.012);
// ears (flattened tapered capsules) with a scooped-out front
for (const s of [1, -1]) {
  cone(s > 0 ? 4 : 5, [s * 0.25, 1.24, 0.34], [s * 0.345, 1.51, 0.31], 0.155, 0.05, 0.05, 0.5);
  ell(s > 0 ? 4 : 5, [s * 0.305, 1.4, 0.43], [0.075, 0.135, 0.07], 0.03, true);
}
// torso
ell(2, [0, 0.56, 0.16], [0.27, 0.26, 0.3], 0.1);
cone(2, [0, 0.62, 0.22], [0, 0.82, 0.33], 0.23, 0.22, 0.08);
ell(2, [0, 0.6, 0.4], [0.17, 0.2, 0.13], 0.06);
ell(1, [0, 0.55, -0.2], [0.29, 0.27, 0.32], 0.1);
// legs
for (const s of [1, -1]) {
  const fu = s > 0 ? 6 : 8, bu = s > 0 ? 10 : 12;
  cone(fu, [s * 0.165, 0.45, 0.25], [s * 0.165, 0.24, 0.27], 0.115, 0.1, 0.06);
  cone(fu + 1, [s * 0.165, 0.24, 0.27], [s * 0.165, 0.1, 0.28], 0.1, 0.098, 0.03);
  ell(fu + 1, [s * 0.165, 0.076, 0.33], [0.11, 0.076, 0.135], 0.04);
  ell(bu, [s * 0.2, 0.44, -0.28], [0.15, 0.2, 0.2], 0.07);
  cone(bu + 1, [s * 0.19, 0.3, -0.3], [s * 0.185, 0.1, -0.27], 0.1, 0.098, 0.05);
  ell(bu + 1, [s * 0.185, 0.076, -0.22], [0.11, 0.076, 0.135], 0.04);
}
// tail
const TR = [0.082, 0.075, 0.071, 0.069, 0.069, 0.071, 0.064];
for (let i = 0; i < TAIL_N; i++) {
  const a = [0, TAIL0[1] + TAILD[1] * TAIL_SEG * i, TAIL0[2] + TAILD[2] * TAIL_SEG * i], b = [0, a[1] + TAILD[1] * TAIL_SEG, a[2] + TAILD[2] * TAIL_SEG];
  cone(TAIL_BONE0 + i, a, b, TR[i], TR[i + 1], i ? 0.04 : 0.07);
}

const dists = new Float32Array(P.length);
function sdPrim(q, x, y, z) {
  if (q.t === 0) {
    const c = q.c, r = q.r, px = (x - c[0]) / r[0], py = (y - c[1]) / r[1], pz = (z - c[2]) / r[2];
    const k0 = Math.sqrt(px * px + py * py + pz * pz);
    if (k0 < 1e-5) return -Math.min(r[0], r[1], r[2]);
    const k1 = Math.sqrt((px / r[0]) ** 2 + (py / r[1]) ** 2 + (pz / r[2]) ** 2);
    return (k0 * (k0 - 1)) / k1;
  }
  const a = q.a, b = q.b, pax = x - a[0], pay = y - a[1], paz = (z - a[2]) / q.sz;
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz, rr = q.r1 - q.r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const yy = pax * bax + pay * bay + paz * baz, zz = yy - l2;
  const cx = pax * l2 - bax * yy, cy = pay * l2 - bay * yy, cz = paz * l2 - baz * yy;
  const x2 = cx * cx + cy * cy + cz * cz, y2 = yy * yy * l2, z2 = zz * zz * l2, k = Math.sign(rr) * rr * rr * x2;
  let d;
  if (Math.sign(zz) * a2 * z2 > k) d = Math.sqrt(x2 + z2) * il2 - q.r2;
  else if (Math.sign(yy) * a2 * y2 < k) d = Math.sqrt(x2 + y2) * il2 - q.r1;
  else d = (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - q.r1;
  return d * q.sz;
}
// Smooth union of everything. Primitives far from the point are skipped (they can't affect the surface there).
function sdf(x, y, z, keep) {
  let d = 0.4;
  for (let i = 0; i < P.length; i++) {
    const q = P[i], bx = x - q.bc[0], by = y - q.bc[1], bz = z - q.bc[2], R = q.br + 0.16;
    if (bx * bx + by * by + bz * bz > R * R) { if (keep) dists[i] = 1; continue; }
    const di = sdPrim(q, x, y, z), k = q.k;
    if (keep) dists[i] = di;
    if (q.sub) { const h = Math.max(k - Math.abs(d + di), 0) / k; d = Math.max(d, -di) + h * h * k * 0.25; }
    else { const h = Math.max(k - Math.abs(d - di), 0) / k; d = Math.min(d, di) - h * h * k * 0.25; }
  }
  return d;
}
const _g = [0, 0, 0];
function grad(x, y, z) {
  const e = 0.004;
  _g[0] = sdf(x + e, y, z) - sdf(x - e, y, z); _g[1] = sdf(x, y + e, z) - sdf(x, y - e, z); _g[2] = sdf(x, y, z + e) - sdf(x, y, z - e);
  const l = Math.hypot(_g[0], _g[1], _g[2]) || 1;
  _g[0] /= l; _g[1] /= l; _g[2] /= l;
  return _g;
}

function fixWinding(pos, nor, idx) {
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    if ((uy * vz - uz * vy) * nor[a] + (uz * vx - ux * vz) * nor[a + 1] + (ux * vy - uy * vx) * nor[a + 2] < 0) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  }
}

let cached = null;
export function catGeometry() {
  if (cached) return cached;
  const ox = -0.54, oy = -0.045, oz = -1.3;
  const nx = Math.ceil(1.08 / H) + 1, ny = Math.ceil(1.68 / H) + 1, nz = Math.ceil(2.17 / H) + 1;
  const f = new Float32Array(nx * ny * nz);
  for (let k = 0, o = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++, o++) f[o] = sdf(ox + i * H, oy + j * H, oz + k * H);
  // surface nets: one vertex per cell the surface passes through
  const cx = nx - 1, cy = ny - 1, cz = nz - 1, cell = new Int32Array(cx * cy * cz).fill(-1), pos = [];
  const cv = new Float32Array(8), CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const ED = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) { const v = f[i + CO[c][0] + nx * (j + CO[c][1] + ny * (k + CO[c][2]))]; cv[c] = v; if (v < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let e = 0; e < 12; e++) {
      const a = ED[e][0], b = ED[e][1], va = cv[a], vb = cv[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += CO[a][0] + (CO[b][0] - CO[a][0]) * t; sy += CO[a][1] + (CO[b][1] - CO[a][1]) * t; sz += CO[a][2] + (CO[b][2] - CO[a][2]) * t; n++;
    }
    cell[i + cx * (j + cy * k)] = pos.length / 3;
    pos.push(ox + (i + sx / n) * H, oy + (j + sy / n) * H, oz + (k + sz / n) * H);
  }
  const idx = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d); };
  const C = (i, j, k) => cell[i + cx * (j + cy * k)];
  for (let k = 1; k < cz; k++) for (let j = 1; j < cy; j++) for (let i = 1; i < cx; i++) {
    const v0 = f[i + nx * (j + ny * k)] < 0;
    if (v0 !== f[i + 1 + nx * (j + ny * k)] < 0) quad(C(i, j - 1, k - 1), C(i, j, k - 1), C(i, j, k), C(i, j - 1, k), !v0);
    if (v0 !== f[i + nx * (j + 1 + ny * k)] < 0) quad(C(i - 1, j, k - 1), C(i - 1, j, k), C(i, j, k), C(i, j, k - 1), !v0);
    if (v0 !== f[i + nx * (j + ny * (k + 1))] < 0) quad(C(i - 1, j - 1, k), C(i, j - 1, k), C(i, j, k), C(i - 1, j, k), !v0);
  }
  // snap to the true surface, exact normals, skin weights
  const n = pos.length / 3, nor = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const bw = new Float32Array(BONES.length);
  for (let v = 0; v < n; v++) {
    let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    for (let it = 0; it < 3; it++) { const g = grad(x, y, z), d = sdf(x, y, z); x -= g[0] * d; y -= g[1] * d; z -= g[2] * d; }
    if (y < 0.002) y = 0.002;
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    const g = grad(x, y, z); nor[v * 3] = g[0]; nor[v * 3 + 1] = g[1]; nor[v * 3 + 2] = g[2];
    sdf(x, y, z, true);
    bw.fill(0);
    for (let i = 0; i < P.length; i++) { if (P[i].sub) continue; const w = Math.exp(-Math.max(dists[i], 0) / 0.035); if (w > bw[P[i].bone]) bw[P[i].bone] = w; }
    let tot = 0;
    for (let s = 0; s < 4; s++) { let b = 0; for (let i = 1; i < bw.length; i++) if (bw[i] > bw[b]) b = i; si[v * 4 + s] = b; sw[v * 4 + s] = bw[b] < 0.02 ? 0 : bw[b]; tot += sw[v * 4 + s]; bw[b] = -1; }
    for (let s = 0; s < 4; s++) sw[v * 4 + s] /= tot;
  }
  fixWinding(pos, nor, idx);
  // whiskers: thin tapered tubes, rigid to the head (aKind = 1 so the fur shader paints them white)
  const P3 = Array.from(pos), N3 = Array.from(nor), SI = Array.from(si), SW = Array.from(sw), kind = new Array(n).fill(0);
  for (const s of [1, -1]) for (let w = 0; w < 3; w++) {
    const base = [s * 0.3, 0.862 + w * 0.03, 0.6], dir = [s * 0.94, (w - 1) * 0.3 + 0.08, 0.2], len = 0.3 - Math.abs(w - 1) * 0.03, SEG = 5, RAD = 4, v0 = P3.length / 3;
    for (let a = 0; a <= SEG; a++) {
      const t = a / SEG, r = 0.008 * (1 - t * 0.85), px = base[0] + dir[0] * len * t, py = base[1] + dir[1] * len * t - 0.06 * t * t, pz = base[2] + dir[2] * len * t - 0.05 * t * t;
      for (let b = 0; b < RAD; b++) {
        const an = (b / RAD) * Math.PI * 2, ny2 = Math.cos(an), nz2 = Math.sin(an);
        P3.push(px, py + ny2 * r, pz + nz2 * r); N3.push(0, ny2, nz2); SI.push(BONE.head, 0, 0, 0); SW.push(1, 0, 0, 0); kind.push(1);
      }
    }
    for (let a = 0; a < SEG; a++) for (let b = 0; b < RAD; b++) {
      const p0 = v0 + a * RAD + b, p1 = v0 + a * RAD + ((b + 1) % RAD), p2 = p0 + RAD, p3 = p1 + RAD;
      if (s > 0) idx.push(p0, p2, p1, p1, p2, p3); else idx.push(p0, p1, p2, p1, p3, p2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(P3, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(N3, 3));
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(SI, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(SW, 4));
  geo.setAttribute("aKind", new THREE.Float32BufferAttribute(kind, 1));
  geo.setIndex(idx);
  geo.userData.shared = true;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.75, -0.2), 1.5);
  if (new URLSearchParams(location.search).get("debug")) console.log("cat mesh", P3.length / 3, "verts", idx.length / 3, "tris");
  cached = geo;
  return geo;
}

// Eyes: two domed patches that hug the head surface (head-bone local space). aEye = position inside the eye (-1..1).
let eyeCached = null;
export function eyeGeometry() {
  if (eyeCached) return eyeCached;
  const pos = [], nor = [], uv = [], idx = [], RINGS = 9, SEGS = 28;
  for (const s of [1, -1]) {
    // find the head surface in front of the eye centre, and its normal
    let z = 1.0;
    for (let i = 0; i < 40; i++) z -= sdf(s * EYE.x, EYE.y, z);
    const g = grad(s * EYE.x, EYE.y, z), n0 = new THREE.Vector3(g[0], g[1], g[2]);
    n0.lerp(new THREE.Vector3(0, 0, 1), 0.35).normalize(); // face a little more forward than the skull does
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), n0).normalize(), up = new THREE.Vector3().crossVectors(n0, right);
    const c0 = new THREE.Vector3(s * EYE.x, EYE.y, z), p = new THREE.Vector3(), v0 = pos.length / 3;
    const put = (u, v) => {
      p.copy(c0).addScaledVector(right, u * EYE.rx).addScaledVector(up, v * EYE.ry).addScaledVector(n0, 0.2);
      for (let i = 0; i < 30; i++) p.addScaledVector(n0, -sdf(p.x, p.y, p.z));
      const gg = grad(p.x, p.y, p.z), r2 = Math.min(1, u * u + v * v), bulge = 0.004 + 0.03 * Math.sqrt(1 - r2 * 0.96);
      pos.push(p.x + gg[0] * bulge - HEAD_PIVOT[0], p.y + gg[1] * bulge - HEAD_PIVOT[1], p.z + gg[2] * bulge - HEAD_PIVOT[2]);
      nor.push(gg[0], gg[1], gg[2]); uv.push(u, v);
    };
    put(0, 0);
    for (let r = 1; r <= RINGS; r++) for (let a = 0; a < SEGS; a++) { const an = (a / SEGS) * Math.PI * 2, rr = r / RINGS; put(Math.cos(an) * rr, Math.sin(an) * rr); }
    for (let a = 0; a < SEGS; a++) idx.push(v0, v0 + 1 + a, v0 + 1 + ((a + 1) % SEGS));
    for (let r = 1; r < RINGS; r++) for (let a = 0; a < SEGS; a++) {
      const a0 = v0 + 1 + (r - 1) * SEGS + a, a1 = v0 + 1 + (r - 1) * SEGS + ((a + 1) % SEGS), b0 = a0 + SEGS, b1 = a1 + SEGS;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }
  fixWinding(pos, nor, idx);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("aEye", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.userData.shared = true;
  eyeCached = geo;
  return geo;
}
