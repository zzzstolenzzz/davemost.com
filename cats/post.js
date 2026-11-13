// Post pipeline (High tier only; Low renders straight to the screen):
//   scene -> HDR target -> bright pass at 1/4 res -> two small blur levels (1/4 and 1/8) -> composite:
//   FXAA + bloom + warm/cool colour grade + vignette, then ACES + sRGB.
import * as THREE from "three";

const vert = "varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }";
const bright = `
  uniform sampler2D tDiffuse; uniform vec2 uInv; varying vec2 vUv;
  void main(){
    vec3 c = 0.25 * (texture2D(tDiffuse, vUv + uInv * vec2(-1.0, -1.0)).rgb + texture2D(tDiffuse, vUv + uInv * vec2(1.0, -1.0)).rgb + texture2D(tDiffuse, vUv + uInv * vec2(-1.0, 1.0)).rgb + texture2D(tDiffuse, vUv + uInv * vec2(1.0, 1.0)).rgb);
    c = min(c, vec3(8.0));
    float l = max(c.r, max(c.g, c.b));
    gl_FragColor = vec4(c * smoothstep(1.0, 2.1, l), 1.0);
  }`;
const blur = `
  uniform sampler2D tDiffuse; uniform vec2 uDir; varying vec2 vUv;
  void main(){
    vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227;
    c += (texture2D(tDiffuse, vUv + uDir * 1.385).rgb + texture2D(tDiffuse, vUv - uDir * 1.385).rgb) * 0.316;
    c += (texture2D(tDiffuse, vUv + uDir * 3.231).rgb + texture2D(tDiffuse, vUv - uDir * 3.231).rgb) * 0.0703;
    gl_FragColor = vec4(c, 1.0);
  }`;
const frag = `
  uniform sampler2D tDiffuse, tBloomA, tBloomB; uniform vec2 uInv; varying vec2 vUv;
  vec3 smp(vec2 uv){ return texture2D(tDiffuse, uv).rgb; }
  float lum(vec3 c){ return dot(sqrt(max(c, 0.0)), vec3(0.299, 0.587, 0.114)); }
  void main(){
    vec2 uv = vUv;
    vec3 rgbM = smp(uv), nw = smp(uv + vec2(-1.0, -1.0) * uInv), ne = smp(uv + vec2(1.0, -1.0) * uInv), sw = smp(uv + vec2(-1.0, 1.0) * uInv), se = smp(uv + vec2(1.0, 1.0) * uInv);
    float lM = lum(rgbM), lNW = lum(nw), lNE = lum(ne), lSW = lum(sw), lSE = lum(se);
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
    float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078);
    dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), -6.0, 6.0) * uInv;
    vec3 a = 0.5 * (smp(uv + dir * (1.0 / 3.0 - 0.5)) + smp(uv + dir * (2.0 / 3.0 - 0.5)));
    vec3 b = a * 0.5 + 0.25 * (smp(uv + dir * -0.5) + smp(uv + dir * 0.5));
    float lB = lum(b);
    vec3 c = (lB < lMin || lB > lMax) ? a : b;
    // bloom: tight glow + wide soft haze
    c += texture2D(tBloomA, uv).rgb * 0.45 + texture2D(tBloomB, uv).rgb * 0.6;
    // grade: richer colour, golden highlights, cool violet shadows
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, 1.14);
    c *= mix(vec3(0.95, 0.97, 1.09), vec3(1.05, 1.0, 0.92), smoothstep(0.03, 0.75, l));
    vec2 q = uv - 0.5;
    c *= 1.0 - dot(q, q) * 0.5;
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  }`;

export function createPost(renderer) {
  const ext = renderer.extensions;
  const half = ext.has("EXT_color_buffer_float") || ext.has("EXT_color_buffer_half_float");
  const type = half ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const mk = (depth) => new THREE.WebGLRenderTarget(4, 4, { type, depthBuffer: depth, samples: 0, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const rt = mk(true), a1 = mk(false), a2 = mk(false), b1 = mk(false), b2 = mk(false);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const sm = (fragmentShader, uniforms, tone = false) => new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader, depthTest: false, depthWrite: false, uniforms, toneMapped: tone });
  const brightM = sm(bright, { tDiffuse: { value: rt.texture }, uInv: { value: new THREE.Vector2() } });
  const blurM = sm(blur, { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } });
  const mat = sm(frag, { tDiffuse: { value: rt.texture }, tBloomA: { value: a1.texture }, tBloomB: { value: b1.texture }, uInv: { value: new THREE.Vector2() } }, true);
  const quad = new THREE.Mesh(geo, mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let qw = 1, qh = 1, ew = 1, eh = 1;
  const pass = (m, target) => { quad.material = m; renderer.setRenderTarget(target); renderer.render(scene, cam); };
  const blurPass = (src, dst, dx, dy) => { blurM.uniforms.tDiffuse.value = src.texture; blurM.uniforms.uDir.value.set(dx, dy); pass(blurM, dst); };
  return {
    setSize(w, h) {
      rt.setSize(w, h); mat.uniforms.uInv.value.set(1 / w, 1 / h); brightM.uniforms.uInv.value.set(1 / w, 1 / h);
      qw = Math.max(2, w >> 2); qh = Math.max(2, h >> 2); ew = Math.max(2, w >> 3); eh = Math.max(2, h >> 3);
      a1.setSize(qw, qh); a2.setSize(qw, qh); b1.setSize(ew, eh); b2.setSize(ew, eh);
    },
    render(s, camera) {
      renderer.setRenderTarget(rt);
      renderer.render(s, camera);
      pass(brightM, a1);
      blurPass(a1, a2, 1 / qw, 0); blurPass(a2, a1, 0, 1 / qh);
      blurPass(a1, b2, 1 / ew, 0); blurPass(b2, b1, 0, 1 / eh);
      blurPass(b1, b2, 1.7 / ew, 0); blurPass(b2, b1, 0, 1.7 / eh);
      pass(mat, null);
    },
  };
}
