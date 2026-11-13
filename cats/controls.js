// Touch-first controls: floating joystick (left half), jump button, drag-to-orbit (right half), keyboard + mouse fallback.
export function createControls(dom) {
  const { stick, knob, jumpBtn } = dom;
  const st = { mx: 0, my: 0, yaw: 0, pitch: 0.38, jump: false, blocked: false, jumpHeld: false, orbiting: false, lastOrbit: -1e9 }; // lastOrbit: performance.now() of the last manual camera drag
  const keys = new Set();
  let stickId = null, orbitId = null, sx = 0, sy = 0, lx = 0, ly = 0;
  const RADIUS = 55;

  // iOS: no scrolling, no pinch/double-tap zoom, no context menu.
  const stop = (e) => e.preventDefault();
  ["gesturestart", "gesturechange", "gestureend", "contextmenu", "dblclick"].forEach((ev) => document.addEventListener(ev, stop, { passive: false }));
  // ...except a drag inside the shop's item list, when that list really has more to scroll to
  document.addEventListener("touchmove", (e) => { const g = e.target.closest?.(".shop-box .grid"); if (!g || g.scrollHeight <= g.clientHeight) e.preventDefault(); }, { passive: false });
  document.addEventListener("touchstart", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

  // Camera zoom (a multiplier on the follow distance, read by game.js): pinch, mouse wheel, trackpad pinch (wheel + ctrlKey). Remembered for next time.
  const ZMIN = 0.5, ZMAX = 2.2;
  let saveT = 0;
  try { st.zoom = Math.min(ZMAX, Math.max(ZMIN, +localStorage.getItem("cats.zoom") || 1)); } catch { st.zoom = 1; }
  const setZoom = (z) => {
    st.zoom = Math.min(ZMAX, Math.max(ZMIN, z));
    clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem("cats.zoom", String(st.zoom)); } catch {} }, 400);
  };
  addEventListener("wheel", (e) => {
    if (e.ctrlKey) e.preventDefault(); // never let the browser zoom the page
    if (st.blocked || e.target !== dom.surface) return; // over the shop / other overlays the wheel is theirs
    e.preventDefault();
    setZoom(st.zoom * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015) * (e.deltaMode === 1 ? 16 : 1)));
  }, { passive: false });
  const touches = new Map(); // touch pointers down on the game surface: id -> {x, y}
  let pinch = null;          // { a, b, d0, z0 } while two fingers (neither the joystick) are zooming
  const pinchDist = () => { const [p, q] = [touches.get(pinch.a), touches.get(pinch.b)]; return Math.hypot(p.x - q.x, p.y - q.y) || 1; };

  const surface = dom.surface;
  surface.addEventListener("pointerdown", (e) => {
    if (st.blocked || e.target.closest("button, .ui")) return;
    if (e.pointerType === "touch") {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      surface.setPointerCapture?.(e.pointerId); // so its pointerup always reaches us, even over a HUD button
      const ids = [...touches.keys()];
      if (!pinch && ids.length === 2 && !ids.includes(stickId)) {
        orbitId = null; st.orbiting = false; st.lastOrbit = performance.now(); // the first finger was orbiting; it zooms now
        pinch = { a: ids[0], b: ids[1], d0: 0, z0: st.zoom }; pinch.d0 = pinchDist();
        return;
      }
      if (pinch) return;
    }
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
    if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      surface.setPointerCapture?.(e.pointerId); // so its pointerup always reaches us, even over a HUD button
      if (pinch && (e.pointerId === pinch.a || e.pointerId === pinch.b)) { setZoom(pinch.z0 * pinch.d0 / pinchDist()); return; }
    }
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
    touches.delete(e.pointerId);
    if (pinch && (e.pointerId === pinch.a || e.pointerId === pinch.b)) pinch = null; // the remaining finger does nothing until it lifts
    if (e.pointerId === stickId) { stickId = null; st.mx = st.my = 0; stick.classList.remove("on"); }
    if (e.pointerId === orbitId) { orbitId = null; st.orbiting = false; st.lastOrbit = performance.now(); }
  };
  surface.addEventListener("pointerup", end);
  surface.addEventListener("pointercancel", end);

  jumpBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); st.jump = true; st.jumpHeld = true; jumpBtn.classList.add("down"); });
  ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => jumpBtn.addEventListener(ev, () => { jumpBtn.classList.remove("down"); st.jumpHeld = false; }));

  addEventListener("keydown", (e) => {
    if (st.blocked) return;
    if (e.code === "Space") { st.jump = true; st.jumpHeld = true; e.preventDefault(); }
    keys.add(e.code);
  });
  addEventListener("keyup", (e) => { keys.delete(e.code); if (e.code === "Space") st.jumpHeld = false; });
  addEventListener("blur", () => { keys.clear(); st.jumpHeld = false; });

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
