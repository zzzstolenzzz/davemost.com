// Sculpted foliage: trees, bushes and rocks. Each model is ONE merged geometry (trunk + lumpy canopy + leaf cards),
// drawn instanced with ONE shared material. Leaf cards are camera-facing alpha cut-outs that break up the silhouette.
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { ramp, noiseTex, time } from "./toon.js";

// ---- leaf-clump texture (generated once): R = brightness variation, A = cut-out ----
function leafTexture() {
  const S = 128, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  let seed = 99;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  g.translate(S / 2, S / 2);
  g.fillStyle = "rgb(205,205,205)"; g.beginPath(); g.arc(0, 0, 37, 0, 6.3); g.fill();
  for (let ring = 0; ring < 2; ring++) {
    const n = ring ? 9 : 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rnd() * 0.4, d = ring ? 12 + rnd() * 8 : 31 + rnd() * 7, len = 22 + rnd() * 8, w = 13 + rnd() * 4, sh = 190 + Math.floor(rnd() * 65);
      g.save(); g.rotate(a); g.translate(d, 0);
      g.fillStyle = `rgb(${sh},${sh},${sh})`;
      g.beginPath(); g.moveTo(-len / 2, 0); g.quadraticCurveTo(0, -w, len / 2 + 3, 0); g.quadraticCurveTo(0, w, -len / 2, 0); g.fill();
      g.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  return t;
}

let mat = null;
export function foliageMaterial(sunDir) {
  if (mat) return mat;
  const leaf = leafTexture();
  mat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: ramp, vertexColors: true });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = time; s.uniforms.uLeaf = { value: leaf }; s.uniforms.uNoise = { value: noiseTex }; s.uniforms.uSun = { value: sunDir };
    s.vertexShader = "uniform float uTime; attribute vec4 aCard; varying vec3 vCuv; varying vec3 vLocal;\n" + s.vertexShader
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vCuv = vec3(aCard.zw, 0.0); vLocal = position;
        #ifdef USE_INSTANCING
          float sw = max(position.y - 1.0, 0.0) * 0.03, ph = instanceMatrix[3].x * 0.3 + instanceMatrix[3].z * 0.2;
          transformed.x += sin(uTime * 1.3 + ph) * sw; transformed.z += cos(uTime * 1.1 + ph * 1.3) * sw * 0.7;
        #endif`)
      .replace("#include <project_vertex>", `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          float cs = length(instanceMatrix[0].xyz);
        #else
          float cs = 1.0;
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        mvPosition.xy += aCard.xy * cs * (1.0 + 0.07 * sin(uTime * 2.1 + position.x * 5.0 + position.y * 3.0));
        gl_Position = projectionMatrix * mvPosition;`);
    s.fragmentShader = "uniform sampler2D uLeaf, uNoise; uniform vec3 uSun; varying vec3 vCuv; varying vec3 vLocal;\n" + s.fragmentShader
      .replace("#include <color_fragment>", `#include <color_fragment>
        float leafy = 1.0;
        if (vCuv.x > -0.5) { vec4 lf = texture2D(uLeaf, vCuv.xy); if (lf.a < 0.42) discard; diffuseColor.rgb *= 0.84 + 0.22 * lf.r; }
        else { leafy = vCuv.y; diffuseColor.rgb *= 0.9 + 0.2 * texture2D(uNoise, vLocal.xy * 0.33 + vLocal.z * 0.21).g; }`)
      .replace("#include <opaque_fragment>", `
        { vec3 sunV = normalize((viewMatrix * vec4(uSun, 0.0)).xyz), vd = normalize(vViewPosition);
          float back = pow(max(dot(-vd, sunV), 0.0), 3.0), fr = pow(1.0 - saturate(dot(vd, normal)), 2.0);
          outgoingLight += diffuseColor.rgb * vec3(1.0, 0.86, 0.5) * (back * 0.32 * leafy + fr * 0.28 * max(dot(normal, sunV) + 0.5, 0.0)); }
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => "foliage";
  return mat;
}

// ---- geometry helpers ----
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const C = (h) => new THREE.Color(h);
const smooth = (g) => { g.deleteAttribute("uv"); g.deleteAttribute("normal"); g = mergeVertices(g, 1e-4); g.computeVertexNormals(); return g; };

// A cloud-like lump: an icosphere pushed out to the union of a few overlapping spheres, smooth-shaded.
export function lump(detail, rand, { lobes = 6, core = 0.7, squash = 0.86, up = 0.2 } = {}) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute("uv"); g.deleteAttribute("normal"); g = mergeVertices(g, 1e-4);
  const L = [];
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * 6.283 + rand() * 0.9, y = -0.25 + rand() * 0.9 + up * 0.3, d = 0.32 + rand() * 0.28, r = 0.48 + rand() * 0.22, h = Math.sqrt(Math.max(0.05, 1 - y * y));
    L.push([Math.cos(a) * h * d, y * d, Math.sin(a) * h * d, r]);
  }
  const p = g.attributes.position;
  let mx = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let t = core;
    for (const [cx, cy, cz, r] of L) { const b = x * cx + y * cy + z * cz, disc = b * b - (cx * cx + cy * cy + cz * cz) + r * r; if (disc > 0) t = Math.max(t, b + Math.sqrt(disc)); }
    p.setXYZ(i, x * t, y * t * squash, z * t); mx = Math.max(mx, t);
  }
  g.scale(1 / mx, 1 / mx, 1 / mx);
  g.computeVertexNormals();
  return g;
}

class Builder {
  constructor() { this.P = []; this.N = []; this.Cc = []; this.A = []; }
  // geo: any geometry with normals. colour(x, y, z, nx, ny, nz) -> THREE.Color. leafy 0/1 (takes the back-light glow).
  add(geo, m, colour, leafy = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) g.applyMatrix4(m);
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const c = colour(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i));
      this.P.push(p.getX(i), p.getY(i), p.getZ(i)); this.N.push(n.getX(i), n.getY(i), n.getZ(i)); this.Cc.push(c.r, c.g, c.b); this.A.push(0, 0, -1, leafy);
    }
    return g;
  }
  // camera-facing leaf card centred at p with shading normal n
  card(p, n, size, c, rand) {
    const a = rand() * 6.283, ca = Math.cos(a) * size, sa = Math.sin(a) * size;
    const corner = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    for (const [u, v] of corner) {
      this.P.push(p[0], p[1], p[2]); this.N.push(n[0], n[1], n[2]); this.Cc.push(c.r, c.g, c.b);
      this.A.push(u * ca - v * sa, u * sa + v * ca, u * 0.5 + 0.5, v * 0.5 + 0.5);
    }
  }
  // scatter cards over the surface of a (transformed) geometry returned by add()
  cards(g, count, size, colour, rand, minY = -1e9) {
    const p = g.attributes.position, n = g.attributes.normal;
    for (let k = 0, tries = 0; k < count && tries < count * 8; tries++) {
      const i = Math.floor(rand() * p.count), y = p.getY(i);
      if (y < minY) continue;
      const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i), s = size * (0.75 + rand() * 0.5);
      this.card([p.getX(i) + nx * s * 0.25, y + ny * s * 0.25, p.getZ(i) + nz * s * 0.25], [nx, ny, nz], s, colour(p.getX(i), y, p.getZ(i), nx, ny, nz), rand);
      k++;
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.Cc, 3)); g.setAttribute("aCard", new THREE.Float32BufferAttribute(this.A, 4));
    g.computeBoundingSphere();
    return g;
  }
}
const M = (p, s = [1, 1, 1], r = [0, 0, 0]) => new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), typeof s === "number" ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s));
const tmpC = new THREE.Color();
// canopy colour: deep cool underside -> rich mid -> sunny top
const canopy = (dark, midc, light, y0, y1) => { const d = C(dark), m = C(midc), l = C(light); return (x, y, z, nx, ny) => { const t = THREE.MathUtils.clamp((y - y0) / (y1 - y0) * 0.65 + ny * 0.35 + 0.1, 0, 1); return t < 0.5 ? tmpC.copy(d).lerp(m, t * 2).clone() : tmpC.copy(m).lerp(l, t * 2 - 1).clone(); }; };
const bark = (dark, light, h) => { const d = C(dark), l = C(light); return (x, y) => tmpC.copy(d).lerp(l, THREE.MathUtils.clamp(y / h, 0, 1) * 0.8 + 0.1).multiplyScalar(0.72 + 0.28 * Math.min(1, y / 0.9)).clone(); };

// trunk with flared, lobed roots and a gentle bend
function trunk(h, r, rand, bend = 0.25) {
  const pts = [[r * 2.0, 0], [r * 1.35, h * 0.07], [r * 1.05, h * 0.2], [r * 0.9, h * 0.55], [r * 0.78, h]].map(([x, y]) => new THREE.Vector2(x, y));
  const g = smooth(new THREE.LatheGeometry(pts, 9)), p = g.attributes.position, ph = rand() * 6, ba = rand() * 6.283;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), k = 1 + 0.45 * Math.max(0, Math.cos(a * 4 + ph)) * Math.max(0, 1 - y / (h * 0.22)), b = Math.sin((y / h) * 1.7) * bend;
    p.setXYZ(i, x * k + Math.cos(ba) * b, y, z * k + Math.sin(ba) * b);
  }
  g.computeVertexNormals();
  g.userData.top = [Math.cos(ba) * Math.sin(1.7) * bend, h, Math.sin(ba) * Math.sin(1.7) * bend];
  return g;
}
const branch = (len, r) => smooth(new THREE.CylinderGeometry(r * 0.55, r, len, 6, 1).translate(0, len / 2, 0));

function broadleaf(seed, { h, r, barkC, cols, R, sats, cardN, cardS, squash = 0.86 }) {
  const rand = rng(seed), b = new Builder();
  const tg = trunk(h, r, rand), top = tg.userData.top;
  b.add(tg, null, bark(barkC[0], barkC[1], h));
  const y0 = h - R * 0.3, y1 = h + R * 1.5, cc = canopy(...cols, y0, y1);
  const main = b.add(lump(2, rand, { squash }), M([top[0], h + R * 0.55, top[2]], R), cc, 1);
  b.cards(main, Math.round(cardN * 0.55), cardS * R, cc, rand, h + R * 0.05);
  sats.forEach(([ang, dist, yy, sr], i) => {
    const a = ang + rand() * 0.5, px = top[0] + Math.cos(a) * dist * R, pz = top[2] + Math.sin(a) * dist * R, py = h + yy * R;
    const s = b.add(lump(1, rand, { lobes: 4, squash: 0.9 }), M([px, py, pz], sr * R), cc, 1);
    b.cards(s, Math.round((cardN * 0.45) / sats.length), cardS * R * 0.85, cc, rand, py - sr * R * 0.2);
    if (i < 2) b.add(branch(Math.hypot(dist * R, 0.6) * 0.9, r * 0.5), M([top[0] * 0.6, h * 0.62, top[2] * 0.6], 1, [0, -a, 0]).multiply(M([0, 0, 0], 1, [0, 0, -1.05])), bark(barkC[0], barkC[1], h));
  });
  return b.build();
}

export function treeModels() {
  const pine = (() => {
    const rand = rng(41), b = new Builder(), cc = canopy("#1d6558", "#35916d", "#8fd08a", 1.0, 6.4);
    b.add(trunk(1.9, 0.26, rand, 0.05), null, bark("#6e4a35", "#9a6b48", 1.9));
    [[1.95, 2.2, 1.1], [1.6, 2.0, 2.3], [1.25, 1.8, 3.4], [0.85, 1.7, 4.4]].forEach(([rr, hh, y], ti) => {
      const pts = [[0.001, hh], [rr * 0.45, hh * 0.5], [rr * 0.95, 0.12], [rr, 0], [rr * 0.6, 0.2], [0.001, 0.32]].map(([x, yy]) => new THREE.Vector2(x, yy));
      const g = smooth(new THREE.LatheGeometry(pts, 11)), p = g.attributes.position, ph = rand() * 6;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), y2 = p.getY(i), a = Math.atan2(z, x), k = 1 + 0.16 * Math.cos(a * 6 + ph) * (1 - y2 / hh); p.setXYZ(i, x * k, y2 - 0.12 * Math.cos(a * 6 + ph) * (1 - y2 / hh), z * k); }
      g.computeVertexNormals();
      const t = b.add(g, M([0, y, 0]), cc, 1);
      b.cards(t, 7 - ti, 0.5, cc, rand);
    });
    return b.build();
  })();
  return [
    broadleaf(11, { h: 2.7, r: 0.3, barkC: ["#6f4a34", "#a8744a"], cols: ["#256f52", "#46a455", "#b4dc5c"], R: 2.0, sats: [[0.3, 0.85, 0.05, 0.62], [2.5, 0.8, 0.25, 0.55], [4.4, 0.75, 0.0, 0.5]], cardN: 44, cardS: 0.36 }),
    broadleaf(23, { h: 3.4, r: 0.22, barkC: ["#b9a88f", "#efe6d6"], cols: ["#5d9a3c", "#a5cf4c", "#eef089"], R: 1.5, sats: [[1.0, 0.5, 1.15, 0.72], [3.6, 0.3, 1.95, 0.5]], cardN: 38, cardS: 0.4, squash: 1.0 }),
    broadleaf(37, { h: 2.3, r: 0.27, barkC: ["#4f3530", "#7d564a"], cols: ["#c95c8c", "#f394b6", "#ffe0ea"], R: 1.85, sats: [[0.8, 0.9, 0.1, 0.6], [2.9, 0.9, 0.2, 0.58], [4.9, 0.8, -0.05, 0.5]], cardN: 48, cardS: 0.36, squash: 0.74 }),
    pine,
  ];
}

export function bushModel(seed, cols, flowerC) {
  const rand = rng(seed), b = new Builder(), cc = canopy(...cols, 0, 1.2);
  const g1 = b.add(lump(1, rand, { squash: 0.72, lobes: 5, core: 0.8 }), M([0, 0.42, 0], [0.95, 0.8, 0.95]), cc, 1);
  b.cards(g1, 20, 0.27, cc, rand, 0.25);
  if (flowerC) {
    const fc = C(flowerC), ye = C("#fff3b0"), dot = new THREE.OctahedronGeometry(0.05, 0), p = g1.attributes.position, n = g1.attributes.normal;
    dot.computeVertexNormals();
    for (let k = 0; k < 11; k++) { const i = Math.floor(rand() * p.count); if (n.getY(i) < 0.1) { k -= 0.5; continue; } b.add(dot, M([p.getX(i) + n.getX(i) * 0.05, p.getY(i) + n.getY(i) * 0.05, p.getZ(i) + n.getZ(i) * 0.05], 0.8 + rand() * 0.6), () => (rand() < 0.25 ? ye : fc)); }
  }
  return b.build();
}

// rounded boulder with a mossy cap
export function rockModel(seed) {
  const rand = rng(seed), b = new Builder(), lo = C("#8e88a6"), hi = C("#d9d2dc"), moss = C("#86b85a");
  const g = lump(2, rand, { lobes: 5, core: 0.82, squash: 0.7 });
  b.add(g, M([0, 0.28, 0]), (x, y, z, nx, ny) => { const c = tmpC.copy(lo).lerp(hi, THREE.MathUtils.clamp(y / 0.8 * 0.6 + ny * 0.4, 0, 1)); if (ny > 0.62 && y > 0.5) c.lerp(moss, Math.min(1, (ny - 0.62) * 4)); return c.clone(); });
  return b.build();
}

// toadstool: stem + domed cap with spots (cap tinted per instance through vertex colour = white)
export function mushroomModel() {
  const b = new Builder(), stem = C("#fff1dc"), stemD = C("#e0c9a8"), white = C("#ffffff"), red = C("#ff5a5f"), redD = C("#c93a52");
  b.add(smooth(new THREE.CylinderGeometry(0.06, 0.09, 0.26, 6)), M([0, 0.13, 0]), (x, y) => tmpC.copy(stemD).lerp(stem, y / 0.26).clone());
  b.add(smooth(new THREE.SphereGeometry(0.22, 10, 4, 0, 6.283, 0, 1.5)), M([0, 0.22, 0], [1, 0.85, 1]), (x, y, z, nx, ny) => tmpC.copy(redD).lerp(red, THREE.MathUtils.clamp(ny * 1.2, 0, 1)).clone());
  const dot = new THREE.OctahedronGeometry(0.04, 0); dot.computeVertexNormals();
  [[0, 0.405, 0], [0.11, 0.36, 0.04], [-0.08, 0.37, 0.09], [-0.05, 0.36, -0.12], [0.09, 0.33, -0.13], [-0.16, 0.31, -0.03], [0.02, 0.32, 0.17]].forEach((p) => b.add(dot, M(p, [1, 0.5, 1]), () => white));
  return b.build();
}
