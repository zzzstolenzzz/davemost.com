// Dev overlay (?dev=1&debug=1): fps, per-subsystem CPU ms, renderer.info, frame-time graph, long-frame log.
const NAMES = ["input", "world", "hud", "net", "render"];
export function createPerf(renderer) {
  const el = document.createElement("div");
  el.id = "perf";
  const txt = document.createElement("pre");
  const cv = document.createElement("canvas");
  cv.width = 240; cv.height = 48;
  el.append(txt, cv);
  document.body.appendChild(el);
  const g = cv.getContext("2d");
  const hist = new Float32Array(240); let hi = 0;
  const acc = new Float32Array(NAMES.length), cur = new Float32Array(NAMES.length);
  let t0 = 0, tm = 0, k = 0, lastNow = 0, seen = 0, n = 0, sum = 0, worst = 0, lastText = 0, lastLog = 0, longs = 0;
  return {
    begin(now) { tm = t0 = performance.now(); k = 0; this.frameMs = lastNow ? now - lastNow : 16; lastNow = now; },
    mark() { const p = performance.now(); cur[k] = p - tm; tm = p; k++; },
    end(pixelRatio, tier) {
      const total = performance.now() - t0;
      for (let i = 0; i < NAMES.length; i++) acc[i] += cur[i];
      n++; seen++; sum += this.frameMs; worst = Math.max(worst, this.frameMs);
      hist[hi++ % 240] = this.frameMs;
      if (this.frameMs > 25 && t0 - lastLog > 1000 && seen > 30) { // long frame: say which subsystem ate the time
        lastLog = t0; longs++;
        console.warn(`LONG FRAME ${this.frameMs.toFixed(1)}ms cpu ${total.toFixed(1)}ms: ` + NAMES.map((nm, i) => `${nm} ${cur[i].toFixed(1)}`).join(" "));
      }
      if (t0 - lastText > 500) {
        lastText = t0;
        const i = renderer.info;
        txt.textContent = `${Math.round(1000 * n / sum)} fps  avg ${(sum / n).toFixed(1)}ms  worst ${worst.toFixed(0)}ms  long ${longs}\n` +
          `cpu ms: ` + NAMES.map((nm, j) => `${nm} ${(acc[j] / n).toFixed(2)}`).join(" ") + `\n` +
          `calls ${i.render.calls}  tris ${i.render.triangles}  tex ${i.memory.textures}  geo ${i.memory.geometries}  prog ${i.programs.length}\n` +
          `pixelRatio ${pixelRatio.toFixed(2)}  tier ${tier}`;
        acc.fill(0); n = 0; sum = 0; worst = 0;
        g.clearRect(0, 0, 240, 48);
        for (let x = 0; x < 240; x++) {
          const ms = hist[(hi + x) % 240], h = Math.min(48, ms * 1.2);
          g.fillStyle = ms > 33 ? "#f66" : ms > 18 ? "#fd6" : "#6f6";
          g.fillRect(x, 48 - h, 1, h);
        }
        g.fillStyle = "rgba(255,255,255,.4)"; g.fillRect(0, 48 - 16.7 * 1.2, 240, 1);
      }
    },
    frameMs: 16,
  };
}
