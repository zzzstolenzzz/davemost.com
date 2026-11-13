// Firebase glue. Same project + SDK version as chess. Only imported in real mode (never with ?dev=1).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, onValue, get, set, update, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

export const watchAuth = (cb) => onAuthStateChanged(auth, cb);
export function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth, provider);
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
