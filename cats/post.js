// One full-screen post pass (skipped on the Low tier): FXAA, gentle colour grade, vignette, then ACES + sRGB output.
import * as THREE from "three";

const vert = "varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }";
const frag = `
  uniform sampler2D tDiffuse; uniform vec2 uInv; varying vec2 vUv;
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
    // grade: a touch more saturation, warm highlights / cool shadows
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, 1.14);
    c *= mix(vec3(0.97, 0.99, 1.06), vec3(1.05, 1.0, 0.93), smoothstep(0.05, 0.7, l));
    // vignette
    vec2 q = uv - 0.5;
    c *= 1.0 - dot(q, q) * 0.55;
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  }`;

export function createPost(renderer) {
  const ext = renderer.extensions;
  const half = ext.has("EXT_color_buffer_float") || ext.has("EXT_color_buffer_half_float");
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: true, samples: 0, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, depthTest: false, depthWrite: false, uniforms: { tDiffuse: { value: rt.texture }, uInv: { value: new THREE.Vector2() } } });
  const quad = new THREE.Mesh(geo, mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    setSize(w, h) { rt.setSize(w, h); mat.uniforms.uInv.value.set(1 / w, 1 / h); },
    render(s, camera) {
      renderer.setRenderTarget(rt);
      renderer.render(s, camera);
      renderer.setRenderTarget(null);
      renderer.render(scene, cam);
    },
  };
}
