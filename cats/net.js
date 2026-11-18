// Firebase glue. Same project + SDK version as chess. Only imported in real mode (never with ?dev=1).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, onValue, get, set, update, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signInWithCustomToken, getRedirectResult, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence], popupRedirectResolver: browserPopupRedirectResolver });

const PENDING = "cats.signin.pending";
const store = (fn) => { try { return fn(sessionStorage); } catch { return null; } };
export const redirectPending = () => store((s) => s.getItem(PENDING)) === "1";

// iPhone/iPad (iPadOS reports as Mac) and installed home-screen apps can't use popups reliably.
export function needsRedirect(nav = navigator, standaloneMq = () => matchMedia("(display-mode: standalone)").matches) {
  const ua = nav.userAgent || "";
  const ios = /iPad|iPhone|iPod/.test(ua) || (nav.maxTouchPoints > 1 && /Macintosh/.test(ua));
  let standalone = nav.standalone === true;
  try { standalone = standalone || standaloneMq(); } catch {}
  return ios || standalone;
}

// Resolves to null, or the error from coming back from Google. Await it before trusting the auth state.
export const redirectResult = getRedirectResult(auth).then(() => null, (e) => e).then((e) => { store((s) => s.removeItem(PENDING)); return e; });

export const watchAuth = (cb) => onAuthStateChanged(auth, cb);
function goRedirect(provider) {
  store((s) => s.setItem(PENDING, "1"));
  return signInWithRedirect(auth, provider).catch((e) => { store((s) => s.removeItem(PENDING)); throw e; });
}
const POPUP_FALLBACK = ["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/web-storage-unsupported", "auth/cancelled-popup-request"];
export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  if (needsRedirect()) return goRedirect(provider);
  try { return await signInWithPopup(auth, provider); }
  catch (e) { if (POPUP_FALLBACK.includes(e.code)) return goRedirect(provider); throw e; }
}
const LOGIN_URL = "https://davemost.davemost.workers.dev/cats-login";
// Name + PIN login. Returns { ok } or { status, error, triesLeft?, retryAfter? }.
export async function pinLogin(player, pin) {
  let r, body = {};
  try { r = await fetch(LOGIN_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ player, pin }) }); }
  catch { return { error: "network" }; }
  try { body = await r.json(); } catch {}
  if (r.ok && body.token) {
    try { await signInWithCustomToken(auth, body.token); return { ok: true }; }
    catch (e) { return { error: "token", code: e.code }; }
  }
  return { status: r.status, error: body.error || "error", triesLeft: body.triesLeft, retryAfter: body.retryAfter };
}
export const logOut = () => signOut(auth);

export async function loadProgress(uid) {
  const snap = await get(ref(db, `cats/progress/${uid}`));
  return snap.val() || {};
}
// patch uses RTDB multi-path keys, e.g. {"fish/fish3": true, coins: 12, "equipped/hat": null}
export const saveProgress = (uid, patch) => update(ref(db, `cats/progress/${uid}`), patch);

export function watchPlayers(cb) {
  return onValue(ref(db, "cats/players"), (s) => cb(s.val() || {}));
}
// Presence is per page load (uid_sid), so one account on two devices shows two cats. Progress stays per uid.
const sid = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
export const keyFor = (uid) => `${uid}_${sid}`;
export const isPresenceKey = (k) => /^[A-Za-z0-9]+_[a-z0-9]{8,10}$/.test(k); // ignores old bare-uid records
let presenceRef = null;
// onDisconnect is consumed when it fires, so re-arm it on every (re)connect.
onValue(ref(db, ".info/connected"), (s) => { if (s.val() && presenceRef) onDisconnect(presenceRef).remove(); });
export function publish(uid, state) {
  if (!presenceRef) {
    presenceRef = ref(db, `cats/players/${keyFor(uid)}`);
    onDisconnect(presenceRef).remove();
  }
  return set(presenceRef, { ...state, t: serverTimestamp() });
}
