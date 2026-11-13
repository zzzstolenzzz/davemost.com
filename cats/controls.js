// Touch-first controls: floating joystick (left half), jump button, drag-to-orbit (right half), keyboard + mouse fallback.
export function createControls(dom) {
  const { stick, knob, jumpBtn } = dom;
  const st = { mx: 0, my: 0, yaw: 0, pitch: 0.38, jump: false, blocked: false, orbiting: false, lastOrbit: -1e9 }; // lastOrbit: performance.now() of the last manual camera drag
  const keys = new Set();
  let stickId = null, orbitId = null, sx = 0, sy = 0, lx = 0, ly = 0;
  const RADIUS = 55;

  // iOS: no scrolling, no pinch/double-tap zoom, no context menu.
  const stop = (e) => e.preventDefault();
  ["gesturestart", "gesturechange", "gestureend", "contextmenu", "dblclick"].forEach((ev) => document.addEventListener(ev, stop, { passive: false }));
  document.addEventListener("touchmove", stop, { passive: false });
  document.addEventListener("touchstart", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

  const surface = dom.surface;
  surface.addEventListener("pointerdown", (e) => {
    if (st.blocked || e.target.closest("button, .ui")) return;
    surface.setPointerCapture?.(e.pointerId);
    if (e.pointerType === "mouse") { orbitId = e.pointerId; lx = e.clientX; ly = e.clientY; st.orbiting = true; st.lastOrbit = performance.now(); return; }
    if (e.clientX < innerWidth / 2 && stickId === null) {
      stickId = e.pointerId; sx = e.clientX; sy = e.clientY;
      stick.style.left = sx + "px"; stick.style.top = sy + "px"; stick.classList.add("on");
      knob.style.transform = "translate(-50%,-50%)";
    } else if (e.clientX >= innerWidth / 2 && orbitId === null) {
      orbitId = e.pointerId; lx = e.clientX; ly = e.clientY; st.orbiting = true; st.lastOrbit = performance.now();
    }
  });
  surface.addEventListener("pointermove", (e) => {
    if (e.pointerId === stickId) {
      let dx = e.clientX - sx, dy = e.clientY - sy;
      const d = Math.hypot(dx, dy);
      if (d > RADIUS) { dx *= RADIUS / d; dy *= RADIUS / d; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const m = Math.min(1, d / RADIUS), dead = m < 0.12 ? 0 : (m - 0.12) / 0.88;
      st.mx = d ? (dx / Math.min(d, RADIUS)) * dead : 0;
      st.my = d ? (-dy / Math.min(d, RADIUS)) * dead : 0;
    } else if (e.pointerId === orbitId) {
      st.yaw += (e.clientX - lx) * 0.006;
      st.pitch = Math.min(1.25, Math.max(0.06, st.pitch + (e.clientY - ly) * 0.005));
      lx = e.clientX; ly = e.clientY; st.lastOrbit = performance.now();
    }
  });
  const end = (e) => {
    if (e.pointerId === stickId) { stickId = null; st.mx = st.my = 0; stick.classList.remove("on"); }
    if (e.pointerId === orbitId) { orbitId = null; st.orbiting = false; st.lastOrbit = performance.now(); }
  };
  surface.addEventListener("pointerup", end);
  surface.addEventListener("pointercancel", end);

  jumpBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); st.jump = true; jumpBtn.classList.add("down"); });
  ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => jumpBtn.addEventListener(ev, () => jumpBtn.classList.remove("down")));

  addEventListener("keydown", (e) => {
    if (st.blocked) return;
    if (e.code === "Space") { st.jump = true; e.preventDefault(); }
    keys.add(e.code);
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());

  // Combine joystick + keyboard into out.mx/my (each in -1..1).
  st.read = (out) => {
    let kx = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    let ky = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    if (kx && ky) { kx *= 0.7071; ky *= 0.7071; }
    out.x = st.blocked ? 0 : st.mx + kx;
    out.y = st.blocked ? 0 : st.my + ky;
    const m = Math.hypot(out.x, out.y);
    if (m > 1) { out.x /= m; out.y /= m; }
  };
  st.takeJump = () => { const j = st.jump; st.jump = false; return j; };
  return st;
}
