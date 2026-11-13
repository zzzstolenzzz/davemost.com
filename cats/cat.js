// The cat: one smooth skinned mesh (see catmesh.js) with fur markings painted by the shader from the rest pose,
// glossy shader-drawn eyes with real eyelids, and a small procedural skeleton animation.
// Looks stay config-driven (CATS in config.js): body / belly / markings / markingColor / eyes / nose.
import * as THREE from "three";
import { ramp, noiseTex } from "./toon.js";
import { ACCESSORIES } from "./accessories.js";
import { catGeometry, eyeGeometry, BONES, BONE, TAIL0, TAILD, TAIL_SEG, TAIL_N, NOSE, HEAD_PIVOT } from "./catmesh.js";

const v3 = (a) => `vec3(${a.map((x) => x.toFixed(4)).join(",")})`;
const FUR_PARS = `
  uniform vec3 uBody, uBelly, uMark, uNose, uInner; uniform float uMarkType, uRainbow; uniform sampler2D uNoise;
  varying vec3 vRest; varying vec3 vRestN; varying float vKind;
  float blob(vec3 p, vec3 c, vec3 r, float n){ return 1.0 - smoothstep(0.9, 1.02, length((p - c) / r) + n); }
  vec3 hue(float h){ return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
`;
const FUR_COLOR = `#include <color_fragment>
  {
    vec3 p = vRest; vec3 rn = normalize(vRestN); float ax = abs(p.x);
    float n1 = texture2D(uNoise, p.zy * 0.83 + vec2(0.13, 0.37)).r, n2 = texture2D(uNoise, p.xz * 1.07 + p.y * 0.61).g;
    float nz = n1 + n2 - 1.0;
    float tl = dot(p - ${v3(TAIL0)}, ${v3(TAILD)});
    float tailM = smoothstep(0.0, 0.05, tl), tailT = clamp(tl / ${(TAIL_SEG * TAIL_N).toFixed(3)}, 0.0, 1.0);
    float headM = smoothstep(0.0, 0.05, p.y - 0.8 + 0.5 * p.z) * (1.0 - tailM);
    // cream areas: tummy, bib, muzzle, socks, tail tip
    float belly = smoothstep(0.46, 0.36, p.y + nz * 0.04) * smoothstep(0.17, 0.08, ax) * step(-0.52, p.z);
    float bib = blob(p, vec3(0.0, 0.64, 0.42), vec3(0.17, 0.22, 0.2), nz * 0.3);
    float muzzle = max(blob(p, vec3(0.0, 0.885, 0.7), vec3(0.185, 0.11, 0.16), nz * 0.18), blob(p, vec3(0.0, 0.8, 0.6), vec3(0.14, 0.1, 0.16), nz * 0.18));
    float socks = smoothstep(0.19, 0.165, p.y + nz * 0.03);
    float tip = smoothstep(0.82, 0.88, tailT + nz * 0.07) * tailM;
    float cream = max(max(belly, bib), max(muzzle, max(socks, tip)));
    float mark = 0.0;
    if (uMarkType < 0.5) {            // tabby: stripes over the back, rings on tail and legs, forehead lines, cheek swooshes
      float back = smoothstep(0.44, 0.6, p.y + nz * 0.08) * (1.0 - headM) * (1.0 - tailM);
      mark = smoothstep(0.25, 0.55, sin((p.z - ax * 0.42 + nz * 0.1) * 27.0 + 0.6)) * back * smoothstep(0.03, 0.09, ax + (0.82 - p.y) * 0.4);
      mark = max(mark, (1.0 - smoothstep(0.035, 0.05, ax)) * smoothstep(0.7, 0.76, p.y) * (1.0 - headM) * (1.0 - tailM) * step(p.z, 0.05));
      float leg = smoothstep(0.2, 0.23, p.y) * (1.0 - smoothstep(0.4, 0.46, p.y)) * smoothstep(0.12, 0.2, ax);
      mark = max(mark, smoothstep(0.3, 0.6, sin(p.y * 62.0 + nz * 2.5 + 1.0)) * leg);
      mark = max(mark, smoothstep(0.15, 0.45, sin(tailT * 27.0 + 0.5)) * tailM);
      // the tabby "M": two lines fanning up from the brows plus a centre pair, then stripes running back over the skull
      float fh = smoothstep(1.13, 1.18, p.y - (p.z - 0.62) * 0.35) * headM * (1.0 - smoothstep(0.23, 0.27, ax)) * smoothstep(0.0, 0.18, p.z);
      float mx = ax - max(p.y - 1.14, 0.0) * 0.28 * step(0.55, p.z);
      mark = max(mark, smoothstep(0.45, 0.72, cos(mx * 50.0 + nz * 1.2)) * fh);
      float ck = headM * smoothstep(0.29, 0.35, ax) * smoothstep(0.86, 0.9, p.y) * (1.0 - smoothstep(1.06, 1.1, p.y)) * (1.0 - smoothstep(0.52, 0.62, p.z));
      mark = max(mark, smoothstep(0.4, 0.68, sin((p.y - ax * 0.35 + p.z * 0.2) * 62.0 + 2.2)) * ck);
    } else if (uMarkType < 1.5) {     // patches: big soft-edged blobs, one over an eye and ear, coloured tail
      float e = nz * 0.3;
      mark = blob(p, vec3(0.25, 1.13, 0.45), vec3(0.2, 0.2, 0.36), e);
      mark = max(mark, blob(p, vec3(0.34, 1.44, 0.28), vec3(0.2, 0.3, 0.2), e * 0.5));
      mark = max(mark, blob(p, vec3(-0.39, 1.58, 0.26), vec3(0.14, 0.17, 0.14), e));
      mark = max(mark, blob(p, vec3(0.1, 0.8, -0.08), vec3(0.27, 0.2, 0.3), e));
      mark = max(mark, blob(p, vec3(-0.27, 0.55, -0.4), vec3(0.2, 0.24, 0.24), e));
      mark = max(mark, blob(p, vec3(-0.3, 0.6, 0.15), vec3(0.12, 0.16, 0.16), e));
      mark = max(mark, smoothstep(0.3, 0.36, tailT + nz * 0.08) * tailM);
      cream *= 1.0 - tip;
    }
    mark *= 1.0 - cream;
    vec3 col = mix(uBody, uMark, mark);
    col = mix(col, uBelly, cream);
    if (uRainbow > 0.5) col = mix(col, hue(tailT * 1.15 + 0.02) * 0.8 + 0.2, tailM);
    // inner ears
    vec3 q = vec3(ax, p.y, p.z), ea = vec3(0.27, 1.2, 0.3), eb = vec3(0.4, 1.6, 0.25);
    float et = clamp(dot(q - ea, eb - ea) / dot(eb - ea, eb - ea), 0.0, 1.0);
    float ed = length((q - (ea + (eb - ea) * et)).xy);
    float inner = (1.0 - smoothstep(0.6, 1.0, ed / mix(0.12, 0.03, et))) * smoothstep(0.1, 0.4, rn.z) * smoothstep(1.27, 1.34, p.y) * smoothstep(0.27, 0.31, p.z) * headM;
    col = mix(col, uInner * mix(0.66, 1.05, smoothstep(0.3, 0.38, p.z)), inner);
    // nose, mouth, blush
    float nose = 1.0 - smoothstep(0.85, 1.05, length((p - ${v3(NOSE)}) / vec3(0.05, 0.034, 0.04)));
    vec2 m = vec2(ax, p.y - ${(NOSE[1] - 0.085).toFixed(3)});
    float md = m.y > 0.0 ? min(length(vec2(ax, max(m.y - 0.055, 0.0))), length(m - vec2(0.08, 0.0))) : abs(length(m - vec2(0.04, 0.0)) - 0.04);
    float mouth = (1.0 - smoothstep(0.005, 0.009, md)) * step(0.62, p.z);
    col = mix(col, vec3(0.33, 0.18, 0.2), mouth);
    col = mix(col, uNose, nose);
    float blush = (1.0 - smoothstep(0.2, 1.0, length(vec2(ax - 0.3, p.y - 0.92) / vec2(0.09, 0.055)))) * step(0.4, p.z);
    col = mix(col, vec3(1.0, 0.52, 0.56), blush * 0.1);
    // soft grounding: darker tummy / under the chin, a hint of fur grain
    col *= mix(0.8, 1.0, smoothstep(0.03, 0.5, p.y));
    col *= 1.0 - 0.2 * smoothstep(0.52, 0.7, p.y) * (1.0 - headM) * smoothstep(0.12, 0.3, p.z);
    col *= 0.975 + 0.05 * texture2D(uNoise, p.xy * 5.0 + p.z * 4.3).b;
    if (vKind > 0.5) col = vec3(1.0, 0.985, 0.95);
    diffuseColor.rgb = col;
  }`;
const FUR_RIM = `
  { float fr = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 2.4);
    outgoingLight += (diffuseColor.rgb * 0.42 + vec3(0.16, 0.13, 0.09)) * fr * (0.55 + 0.45 * max(normal.y, 0.0)); }
  #include <opaque_fragment>`;

function furMaterial(U) {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: ramp });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.vertexShader = "attribute float aKind; varying vec3 vRest; varying vec3 vRestN; varying float vKind;\n" + s.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvRest = position; vRestN = normal; vKind = aKind;");
    s.fragmentShader = FUR_PARS + s.fragmentShader.replace("#include <color_fragment>", FUR_COLOR).replace("#include <opaque_fragment>", FUR_RIM);
  };
  m.customProgramCacheKey = () => "catfur";
  return m;
}
function lineMaterial(U) {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide });
  m.onBeforeCompile = (s) => {
    s.uniforms.uLine = U.uLine;
    s.vertexShader = "attribute float aKind;\n" + s.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed = (transformed + normalize(normal) * 0.0105) * (1.0 - aKind);");
    s.fragmentShader = "uniform vec3 uLine;\n" + s.fragmentShader.replace("#include <color_fragment>", "diffuseColor.rgb = uLine;");
  };
  m.customProgramCacheKey = () => "catline";
  return m;
}
// Eyes: everything (iris gradient, pupil, catch-lights, lash line, eyelids) is drawn in the shader.
function eyeMaterial(U) {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: ramp });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.vertexShader = "attribute vec3 aEye; varying vec3 vEye;\n" + s.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvEye = aEye;");
    s.fragmentShader = "uniform vec3 uIris, uLid, uLid2; uniform float uBlink; uniform vec2 uGaze; varying vec3 vEye;\n" + s.fragmentShader.replace("#include <color_fragment>", `
      float sd = vEye.z;                                   // +1 = the cat's +x eye
      vec2 e = vec2(vEye.x * 0.972 + vEye.y * 0.235 * sd * 0.8, vEye.y * 0.972 - vEye.x * 0.235 * sd * 1.25);   // tilt: outer corner up
      float xo = e.x * sd;                                 // + toward the outer corner
      float w = clamp(1.0 - e.x * e.x * 1.04, 0.0, 1.0);
      float topO = 0.9 * pow(w, 0.55) * (1.0 + 0.08 * xo), bot = -0.74 * pow(w, 0.8) * (1.0 - 0.18 * xo);
      float top = mix(topO, bot + 0.04, uBlink);
      vec2 q = vec2(e.x * 1.25, e.y) - uGaze; float ir = length(q);
      vec3 iris = mix(uIris * 1.25 + 0.08, uIris * 0.5, smoothstep(-0.7, 0.8, q.y));
      iris = mix(iris, uIris * 1.5 + 0.2, smoothstep(0.35, 0.7, ir) * smoothstep(0.0, -0.7, q.y) * 0.65);   // bright lower crescent
      iris = mix(iris, uIris * 0.28, smoothstep(0.78, 1.0, ir));                                         // limbal ring, dark corners
      float pd = length(q / vec2(0.34, 0.7));
      vec3 pupil = mix(vec3(0.16, 0.1, 0.2), vec3(0.04, 0.02, 0.07), smoothstep(-0.6, 0.2, q.y));
      vec3 col = mix(iris, pupil, 1.0 - smoothstep(0.86, 1.0, pd));
      col *= mix(1.0, 0.55, smoothstep(0.35, 0.0, top - e.y));                                           // shade under the upper lid
      col = mix(col, vec3(1.0), 1.0 - smoothstep(0.17, 0.21, length(vec2(e.x * 1.25, e.y) - vec2(-0.3, 0.33))));
      col = mix(col, vec3(1.0), (1.0 - smoothstep(0.06, 0.09, length(vec2(e.x * 1.25, e.y) - vec2(0.3, -0.3)))) * 0.9);
      float lid = max(smoothstep(-0.03, 0.03, e.y - top), smoothstep(-0.03, 0.03, bot - e.y));
      float line = max((1.0 - smoothstep(0.0, 0.16, abs(e.y - top))) * w, (1.0 - smoothstep(0.0, 0.07, abs(e.y - bot))) * 0.75 * smoothstep(0.0, 0.2, w));
      vec3 lidC = mix(sd > 0.0 ? uLid2 : uLid, vec3(0.17, 0.1, 0.13), line);
      col = mix(col, vec3(0.13, 0.07, 0.11), line * (1.0 - lid));
      diffuseColor.rgb = mix(col * 0.5, lidC, lid);
      totalEmissiveRadiance += col * 0.55 * (1.0 - lid);`);
  };
  m.customProgramCacheKey = () => "cateye2";
  return m;
}

export function buildCat(cfg) {
  const root = new THREE.Group();
  const bones = BONES.map(() => new THREE.Bone());
  BONES.forEach(([, parent, x, y, z], i) => {
    if (parent < 0) bones[i].position.set(x, y, z);
    else { const pp = BONES[parent]; bones[i].position.set(x - pp[2], y - pp[3], z - pp[4]); bones[parent].add(bones[i]); }
  });
  const U = {
    uBody: { value: new THREE.Color() }, uBelly: { value: new THREE.Color() }, uMark: { value: new THREE.Color() },
    uNose: { value: new THREE.Color(cfg.nose) }, uInner: { value: new THREE.Color("#ffb1bd") },
    uMarkType: { value: cfg.markings === "stripes" ? 0 : cfg.markings === "patches" ? 1 : 2 }, uRainbow: { value: 0 }, uNoise: { value: noiseTex },
    uLine: { value: new THREE.Color() },
  };
  const EU = { uIris: { value: new THREE.Color(cfg.eyes) }, uLid: U.uBody, uLid2: cfg.markings === "patches" ? U.uMark : U.uBody, uBlink: { value: 0 }, uGaze: { value: new THREE.Vector2() } };
  const geo = catGeometry();
  const mesh = new THREE.SkinnedMesh(geo, furMaterial(U));
  mesh.add(bones[0]);
  bones[0].updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const line = new THREE.SkinnedMesh(geo, lineMaterial(U));
  line.bind(skeleton, new THREE.Matrix4());
  line.frustumCulled = false; line.userData.outline = true;
  root.add(mesh, line);
  const B = (n) => bones[BONE[n]];
  const head = B("head"), body = B("body"), chest = B("chest"), rootB = B("root");
  const eyes = new THREE.Mesh(eyeGeometry(), eyeMaterial(EU));
  head.add(eyes);
  const legs = [["flU", "flL", 1, 1], ["frU", "frL", -1, 1], ["blU", "blL", -1, -1], ["brU", "brL", 1, -1]].map(([u, l, ph, front]) => ({ up: B(u), lo: B(l), ph, front }));
  const tail = Array.from({ length: TAIL_N }, (_, i) => B("tail" + i));
  const ears = [B("earL"), B("earR")];
  const bodyY = body.position.y;

  // mounts for shop accessories
  const mounts = { hat: new THREE.Group(), glasses: new THREE.Group(), neck: new THREE.Group(), back: new THREE.Group() };
  mounts.hat.position.set(0, 1.3 - HEAD_PIVOT[1], 0.36 - HEAD_PIVOT[2]); mounts.hat.scale.setScalar(0.92); head.add(mounts.hat);
  mounts.glasses.position.set(0, 1.04 - HEAD_PIVOT[1], 0.7 - HEAD_PIVOT[2]); mounts.glasses.scale.setScalar(1.14); head.add(mounts.glasses);
  mounts.neck.position.set(0, 0.69 - BONES[BONE.chest][3], 0.27 - BONES[BONE.chest][4]); chest.add(mounts.neck);
  mounts.back.position.set(0, 0.85 - BONES[BONE.body][3], 0.1 - BONES[BONE.body][4]); body.add(mounts.back);

  // ---- animation state ----
  let t = Math.random() * 10, phase = 0, blink = 2 + Math.random() * 3, blinkT = -1, squash = 0, squashV = 0, air = 0, wasAir = false;
  let tailYaw = 0, tailYawV = 0, headYaw = 0, headYawT = 0, crouch = 0, earT = 3 + Math.random() * 4, earK = 0, earSide = 0, lean = 0;
  let accUpdaters = [];
  const equipped = {};
  const TAIL_IDLE = [0.62, 0.45, 0.2, -0.12, -0.38, -0.5], TAIL_RUN = [0.2, 0.14, 0.1, 0.04, -0.06, -0.14];
  const clamp = THREE.MathUtils.clamp;

  const cat = {
    root, accessories: {},
    // turn: angular velocity (rad/s) of the body, drives a springy tail and a lean into the turn
    update(dt, speed, airborne, vy = 0, turn = 0) {
      t += dt;
      const k = Math.min(speed / 6, 1);
      phase += dt * (5.2 + speed * 1.5) * (speed > 0.3 ? 1 : 0);
      air += ((airborne ? 1 : 0) - air) * Math.min(1, dt * 14);
      const g = 1 - air, amp = (0.35 + 0.5 * k) * Math.min(1, speed / 1.2) * g;
      for (let i = 0; i < 4; i++) {
        const L = legs[i], s = Math.sin(phase) * L.ph, c = Math.cos(phase) * L.ph;
        L.up.rotation.x = -s * amp + air * (L.front > 0 ? -0.95 : 0.8);
        L.lo.rotation.x = Math.max(0, c) * amp * 1.1 * L.front + air * (L.front > 0 ? 0.6 : -0.5);
      }
      if (wasAir && !airborne) squashV -= 7;
      wasAir = airborne;
      const target = airborne ? clamp(vy * 0.018, -0.1, 0.16) : -0.17 * crouch;
      squashV += ((target - squash) * 220 - squashV * 14) * dt;
      squash += squashV * dt;
      rootB.scale.set(1 - squash * 0.5, 1 + squash, 1 - squash * 0.5);
      const mv = Math.min(1, speed / 1.2) * g, breathe = Math.sin(t * 2.2) * (1 - k);
      lean += (clamp(turn * 0.05, -0.3, 0.3) - lean) * Math.min(1, dt * 8);
      body.position.y = bodyY + Math.abs(Math.sin(phase)) * (0.02 + 0.03 * k) * mv;
      body.rotation.set(-air * 0.16 + Math.sin(phase * 2) * 0.025 * k * g, 0, Math.sin(phase) * 0.045 * mv - lean * 0.35);
      chest.rotation.set(Math.cos(phase * 2) * 0.03 * k * g, lean * 0.6, -Math.sin(phase) * 0.03 * mv);
      chest.scale.setScalar(1 + breathe * 0.012);
      // head: glance toward things of interest (set via look()), gentle idle tilt
      headYaw += (headYawT - headYaw) * Math.min(1, dt * 7);
      head.rotation.set(Math.sin(t * 1.3) * 0.025 - air * 0.14 - Math.cos(phase * 2) * 0.03 * k * g, headYaw + lean * 0.5, Math.sin(t * 0.7) * 0.035 * (1 - k) - headYaw * 0.12);
      EU.uGaze.value.set(clamp((headYawT - headYaw) * 0.6 + headYaw * 0.15, -0.2, 0.2), -air * 0.06);
      blink -= dt;
      if (blink < 0) { blinkT = 0; blink = 2.2 + Math.random() * 3.5; }
      let bl = 0;
      if (blinkT >= 0) { blinkT += dt; bl = 1 - Math.abs(blinkT / 0.08 - 1); if (blinkT > 0.16) { blinkT = -1; bl = 0; } }
      EU.uBlink.value = Math.max(bl, crouch * 0.35);
      // ears: lie back with speed / in the air, the odd flick while idle
      earT -= dt;
      if (earT < 0) { earT = 2.5 + Math.random() * 5; earK = 1; earSide = Math.random() < 0.5 ? 0 : 1; }
      earK = Math.max(0, earK - dt * 5);
      const flick = Math.sin(earK * Math.PI * 2) * 0.3 * earK;
      for (let i = 0; i < 2; i++) ears[i].rotation.set(-(0.18 * k + 0.4 * air), 0, (i ? 1 : -1) * (0.1 * k + 0.2 * air) + (i === earSide ? flick : 0));
      // tail: spring that lags behind body turns + travelling wave; curls up when idle, streams out when running
      tailYawV += ((-turn * 0.16 - tailYaw) * 90 - tailYawV * 9) * dt;
      tailYaw += tailYawV * dt;
      const ty = clamp(tailYaw, -0.8, 0.8), wamp = 0.07 + 0.09 * k, wsp = 1.8 + k * 5;
      for (let i = 0; i < TAIL_N; i++) {
        const w = Math.sin(t * wsp - i * 0.7) * wamp;
        tail[i].rotation.set(TAIL_IDLE[i] + (TAIL_RUN[i] - TAIL_IDLE[i]) * k + air * (i < 2 ? 0.25 : -0.1) + Math.sin(t * 1.1 - i * 0.5) * 0.04, (i === 0 ? ty : ty * 0.25) + w * 0.6, w);
      }
      for (let i = 0; i < accUpdaters.length; i++) accUpdaters[i](t, k);
    },
    setCrouch(v) { crouch = v; },
    bounce(k) { squashV += k; }, // extra squash-and-stretch kick (Bouncy Paws upgrade)
    look(yawRel) { headYawT = yawRel === null ? 0 : clamp(yawRel, -0.8, 0.8); },
    setPalette(p) {
      U.uBody.value.set(p ? p.body : cfg.body); U.uBelly.value.set(p ? p.belly : cfg.belly); U.uMark.value.set(p ? p.markingColor : cfg.markingColor);
      // outline: a deep, saturated version of the fur colour rather than black ink
      const hsl = { h: 0, s: 0, l: 0 }; U.uBody.value.getHSL(hsl);
      U.uLine.value.setHSL(hsl.s < 0.12 ? 0.72 : hsl.h - 0.03, Math.min(0.6, hsl.s * 0.7 + 0.2), Math.min(0.2, hsl.l * 0.3));
    },
    setRainbowTail(on) { U.uRainbow.value = on ? 1 : 0; },
    // map: slot -> item id for hat / glasses / neck / back
    equip(map) {
      accUpdaters = [];
      for (const slot of ["hat", "glasses", "neck", "back"]) {
        const id = map && map[slot];
        if (equipped[slot] !== id) {
          const old = cat.accessories[slot];
          if (old) {
            mounts[slot].remove(old);
            old.traverse((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
            cat.accessories[slot] = null;
          }
          equipped[slot] = id;
          if (id && ACCESSORIES[id]) { cat.accessories[slot] = ACCESSORIES[id](); mounts[slot].add(cat.accessories[slot]); }
        }
        const g = cat.accessories[slot];
        if (g && g.userData.update) accUpdaters.push(g.userData.update);
      }
    },
    head, bodyGroup: body, mounts,
  };
  cat.setPalette(null);
  cat.update(0.001, 0, false);
  return cat;
}

export function makeNameTag(text, dot) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 72;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(255,250,240,0.94)";
  g.beginPath(); g.roundRect(8, 8, 240, 56, 28); g.fill();
  g.lineWidth = 3; g.strokeStyle = "rgba(90,60,80,0.55)"; g.stroke();
  g.font = "600 34px Fredoka, ui-rounded, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  if (dot) { g.beginPath(); g.arc(44, 36, 13, 0, 7); g.fillStyle = dot; g.fill(); g.lineWidth = 3; g.strokeStyle = "#4a3350"; g.stroke(); }
  g.fillStyle = "#4a3350"; g.fillText(text, dot ? 144 : 128, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false }));
  s.scale.set(1.5, 0.42, 1);
  s.position.y = 2.05;
  return s;
}
