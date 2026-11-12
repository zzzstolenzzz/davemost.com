// Cheap particle effects: ONE Points draw call for dust / sparkles / glitter, plus a few pooled glow rings.
import * as THREE from "three";

const N = 220;
const vert = `
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
  uniform float uScale; varying float vA; varying vec3 vC;
  void main() {
    vA = aAlpha; vC = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(-mv.z, 0.5);
    gl_Position = projectionMatrix * mv;
  }`;
const frag = `
  varying float vA; varying vec3 vC;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.55, 1.0, d)) * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vC, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function createFX(scene) {
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N);
  const vel = new Float32Array(N * 3), life = new Float32Array(N), maxLife = new Float32Array(N), grav = new Float32Array(N), baseSize = new Float32Array(N), grow = new Float32Array(N);
  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3), aCol = new THREE.BufferAttribute(col, 3), aSize = new THREE.BufferAttribute(size, 1), aAlpha = new THREE.BufferAttribute(alpha, 1);
  [aPos, aCol, aSize, aAlpha].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("position", aPos); geo.setAttribute("aColor", aCol); geo.setAttribute("aSize", aSize); geo.setAttribute("aAlpha", aAlpha);
  const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, uniforms: { uScale: { value: 800 } } });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  let next = 0, active = 0;
  const c = new THREE.Color();

  // rings (fish pickup)
  const rings = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.75, 1, 28), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    m.rotation.x = -Math.PI / 2; m.visible = false; m.userData.t = 0; scene.add(m);
    return m;
  });
  let ringI = 0;

  return {
    setViewportHeight(px) { mat.uniforms.uScale.value = px * 0.96; },
    // hex colour, size in world units, gravity (+ falls), grow = size multiplier over life
    emit(x, y, z, vx, vy, vz, lifeS, sz, hex, g = 0, gr = 0) {
      const i = next++ % N, o = i * 3;
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z; vel[o] = vx; vel[o + 1] = vy; vel[o + 2] = vz;
      life[i] = maxLife[i] = lifeS; grav[i] = g; baseSize[i] = sz; grow[i] = gr;
      c.set(hex); col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
      active = N;
    },
    burst(x, y, z, n, speed, lifeS, sz, hex, g = 4) {
      for (let k = 0; k < n; k++) {
        const a = Math.random() * 6.283, e = Math.random() * 1.2, s = speed * (0.4 + Math.random() * 0.8);
        this.emit(x, y, z, Math.cos(a) * s * Math.cos(e), Math.sin(e) * s + 1, Math.sin(a) * s * Math.cos(e), lifeS * (0.7 + Math.random() * 0.5), sz, hex, g);
      }
    },
    dust(x, y, z, n = 5, strength = 1) {
      for (let k = 0; k < n; k++) {
        const a = Math.random() * 6.283, s = (0.5 + Math.random()) * strength;
        this.emit(x + Math.cos(a) * 0.15, y + 0.08, z + Math.sin(a) * 0.15, Math.cos(a) * s, 0.5 + Math.random() * 0.7, Math.sin(a) * s, 0.5 + Math.random() * 0.3, 0.32, "#f5ecd6", -0.4, 1.2);
      }
    },
    ring(x, y, z) {
      const r = rings[ringI++ % 3];
      r.position.set(x, y, z); r.userData.t = 0.7; r.visible = true;
    },
    update(dt) {
      for (const r of rings) {
        if (!r.visible) continue;
        r.userData.t -= dt;
        if (r.userData.t <= 0) { r.visible = false; continue; }
        const k = 1 - r.userData.t / 0.7;
        r.scale.setScalar(0.4 + k * 2.6); r.material.opacity = (1 - k) * 0.9;
      }
      if (!active) return;
      let alive = 0;
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) { alpha[i] = 0; size[i] = 0; continue; }
        life[i] -= dt; alive++;
        const o = i * 3, k = 1 - life[i] / maxLife[i];
        vel[o + 1] -= grav[i] * dt; vel[o] *= 1 - dt * 1.5; vel[o + 2] *= 1 - dt * 1.5;
        pos[o] += vel[o] * dt; pos[o + 1] += vel[o + 1] * dt; pos[o + 2] += vel[o + 2] * dt;
        alpha[i] = life[i] > 0 ? Math.min(1, (1 - k) * 1.6) : 0;
        size[i] = baseSize[i] * (1 + grow[i] * k);
      }
      aPos.needsUpdate = aCol.needsUpdate = aSize.needsUpdate = aAlpha.needsUpdate = true;
      if (!alive) active = 0;
    },
  };
}
