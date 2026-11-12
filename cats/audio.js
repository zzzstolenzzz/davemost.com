// Synthesized sounds only (Web Audio). Unlock pattern copied from chess/app.js.
let actx = null, primed = false, muted = false;
try { muted = localStorage.getItem("cats.muted") === "1"; } catch {}
const UNLOCK_EVENTS = ["touchstart", "touchend", "pointerdown", "mousedown", "keydown", "click"];

export function unlockAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) actx = new AC();
  }
  if (!actx) return;
  if (actx.state === "suspended") actx.resume();
  if (!primed) {
    primed = true;
    const src = actx.createBufferSource();
    src.buffer = actx.createBuffer(1, 1, actx.sampleRate);
    src.connect(actx.destination);
    src.start(0);
  }
  if (actx.state === "running") UNLOCK_EVENTS.forEach((ev) => document.removeEventListener(ev, unlockAudio, true));
}
UNLOCK_EVENTS.forEach((ev) => document.addEventListener(ev, unlockAudio, true));

export const isMuted = () => muted;
export function setMuted(m) { muted = m; try { localStorage.setItem("cats.muted", m ? "1" : "0"); } catch {} }

function tone({ type = "sine", from, to = from, dur = 0.1, vol = 0.2, delay = 0, lowpass = 0, vibrato = false }) {
  if (!actx || muted) return;
  if (actx.state === "suspended") actx.resume();
  const t = actx.currentTime + delay;
  const osc = actx.createOscillator(), gain = actx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  let node = osc;
  if (lowpass) { const lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = lowpass; osc.connect(lp); node = lp; }
  node.connect(gain);
  gain.connect(actx.destination);
  if (vibrato) {
    const lfo = actx.createOscillator(), depth = actx.createGain();
    lfo.frequency.value = 7; depth.gain.value = from * 0.06;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t); lfo.stop(t + dur);
  }
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

let noiseBuf = null;
export function step() { // soft paw patter
  if (!actx || muted) return;
  if (!noiseBuf) {
    noiseBuf = actx.createBuffer(1, Math.floor(actx.sampleRate * 0.05), actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  }
  const src = actx.createBufferSource(), bp = actx.createBiquadFilter(), g = actx.createGain();
  src.buffer = noiseBuf; bp.type = "bandpass"; bp.frequency.value = 700 + Math.random() * 500; g.gain.value = 0.16;
  src.connect(bp).connect(g).connect(actx.destination);
  src.start();
}
export const jump = () => tone({ type: "sine", from: 220, to: 520, dur: 0.16, vol: 0.22 });
export const jump2 = () => tone({ type: "sine", from: 330, to: 700, dur: 0.14, vol: 0.2 });
export const chime = () => [880, 1109, 1319, 1760].forEach((f, i) => tone({ type: "triangle", from: f, dur: 0.35, vol: 0.18, delay: i * 0.08 }));
export const coin = () => { tone({ type: "square", from: 988, dur: 0.07, vol: 0.07 }); tone({ type: "square", from: 1319, dur: 0.18, vol: 0.07, delay: 0.07 }); };
export const buy = () => [660, 880, 1320].forEach((f, i) => tone({ type: "triangle", from: f, dur: 0.25, vol: 0.16, delay: i * 0.07 }));
export const nope = () => tone({ type: "sine", from: 260, to: 180, dur: 0.2, vol: 0.15 });
export const tick = () => tone({ type: "sine", from: 700, dur: 0.05, vol: 0.1 });
export const meow = () => {
  tone({ type: "sawtooth", from: 520, to: 880, dur: 0.18, vol: 0.12, lowpass: 1800, vibrato: true });
  tone({ type: "sawtooth", from: 880, to: 520, dur: 0.28, vol: 0.12, lowpass: 1500, delay: 0.17, vibrato: true });
};
export const fanfare = () => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone({ type: "triangle", from: f, dur: 0.3, vol: 0.18, delay: i * 0.11 }));
