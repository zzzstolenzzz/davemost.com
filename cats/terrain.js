// Pure terrain math (no three.js) so the world, the player and the tests all agree.
export const R = 100;
export const WATER_Y = -0.2;
export const POND = { x: 24, z: 22, a: 11, b: 6.5, level: 0.1 };
export const BRIDGE = { x: 24, z: 22, halfLen: 8, halfW: 1.3 };
export const COTTAGE = { x: -14, z: 26 };
export const HILL = { x: -34, z: 50, h: 13, flat: 3.5, sig: 15 };
export const SPAWN = { x: 0, z: -4 };
export const FISH_SPOTS = [
  [12, 8], [-8, 17], [-17, 34], [24, 22], [39, 22],
  [-34, 50], [-56, 6], [52, -34], [66, 36], [-62, -34],
];
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

export function shoreD(x, z) {
  const th = Math.atan2(z, x);
  return (Math.hypot(x, z) / R) * (1 + 0.06 * Math.sin(3 * th + 1) + 0.04 * Math.sin(5 * th + 2));
}
export function pondE(x, z) { return Math.hypot((x - POND.x) / POND.a, (z - POND.z) / POND.b); }

export function terrainHeight(x, z) {
  let h = 1.3 + 0.8 * (0.55 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.05) + 0.35 * Math.sin(x * 0.09 - z * 0.07 + 2) + 0.2 * Math.sin(z * 0.13 + x * 0.05));
  h -= 4.5 * sstep(0.72, 1.0, shoreD(x, z));
  h = mix(h, 1.3, 1 - sstep(5, 11, Math.hypot(x - COTTAGE.x, z - COTTAGE.z)));
  const e = pondE(x, z);
  h = mix(h, 1.3, 1 - sstep(1.4, 2.4, e));
  if (e < 1.3) h -= 1.9 * (1 - sstep(0.6, 1.3, e));
  const dh = Math.max(0, Math.hypot(x - HILL.x, z - HILL.z) - HILL.flat) / HILL.sig;
  h += HILL.h * Math.exp(-dh * dh);
  return h;
}
export function bridgeDeck(z) { const u = (z - BRIDGE.z) / BRIDGE.halfLen; return 1.45 + 0.35 * (1 - u * u); }
export function heightAt(x, z) {
  const t = terrainHeight(x, z);
  if (Math.abs(x - BRIDGE.x) < BRIDGE.halfW && Math.abs(z - BRIDGE.z) < BRIDGE.halfLen) return Math.max(t, bridgeDeck(z));
  return t;
}
// Invisible wall: keep points inside the island.
export function clampToIsland(p) {
  const d = shoreD(p.x, p.z);
  if (d > 0.79) { const k = 0.79 / d; p.x *= k; p.z *= k; }
}
export const colliders = []; // {x,z,r}
export function resolveCollisions(p) {
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i], dx = p.x - c.x, dz = p.z - c.z, d2 = dx * dx + dz * dz, rr = c.r + 0.35;
    if (d2 < rr * rr) { const d = Math.sqrt(d2) || 0.001; p.x = c.x + (dx / d) * rr; p.z = c.z + (dz / d) * rr; }
  }
}
