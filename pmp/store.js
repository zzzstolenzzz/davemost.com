// All storage lives here. Two implementations, same async API:
//   firebase: RTDB under /pmp (owner-only by database.rules.json)
//   demo:     localStorage + built-in sample questions (localhost + ?demo=1 only)
import { firebaseConfig, OWNER_UID } from "./config.js";
import { DEMO_QUESTIONS } from "./demo-questions.js";

export const isDemo = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).get("demo") === "1";

// RTDB can return sequential-int-keyed data as an array (with nulls). Always return a plain id->value map.
const toMap = (v) => Object.fromEntries((Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v || {})).filter(([, x]) => x != null));

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";

async function firebaseStore() {
  const [{ initializeApp }, D, A] = await Promise.all([
    import(FB + "firebase-app.js"),
    import(FB + "firebase-database.js"),
    import(FB + "firebase-auth.js"),
  ]);
  const app = initializeApp(firebaseConfig);
  const db = D.getDatabase(app);
  const auth = A.getAuth(app);
  const val = async (path) => toMap((await D.get(D.ref(db, path))).val());
  return {
    watchAuth: (cb) => A.onAuthStateChanged(auth, cb),
    signIn() {
      const provider = new A.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      return A.signInWithPopup(auth, provider);
    },
    signOut: () => A.signOut(auth),
    loadQuestions: () => val("pmp/questions"),
    loadStats: () => val("pmp/stats"),
    loadSessions: async () => Object.values(await val("pmp/sessions")),
    saveStat: (id, stat) => D.update(D.ref(db, `pmp/stats/${id}`), stat),
    saveSession: (s) => D.push(D.ref(db, "pmp/sessions"), s),
    mergeQuestions: (map) => D.update(D.ref(db, "pmp/questions"), map),
    mergeStats: (map) => D.update(D.ref(db, "pmp/stats"), map),
    mergeSessions: (map) => D.update(D.ref(db, "pmp/sessions"), map),
    deleteBank: () => D.remove(D.ref(db, "pmp/questions")),
  };
}

function demoStore() {
  const get = (k, d) => { try { return JSON.parse(localStorage.getItem("pmp_demo_" + k)) ?? d; } catch { return d; } };
  const put = (k, v) => localStorage.setItem("pmp_demo_" + k, JSON.stringify(v));
  return {
    watchAuth: (cb) => setTimeout(() => cb({ uid: OWNER_UID, displayName: "Demo" }), 0),
    signIn: async () => {},
    signOut: async () => {},
    loadQuestions: async () => toMap(get("q", DEMO_QUESTIONS)),
    loadStats: async () => toMap(get("stats", {})),
    loadSessions: async () => Object.values(toMap(get("sessions", {}))),
    saveStat: async (id, stat) => { const s = get("stats", {}); s[id] = { ...s[id], ...stat }; put("stats", s); },
    saveSession: async (s) => put("sessions", { ...toMap(get("sessions", {})), ["s" + Date.now()]: s }),
    mergeStats: async (map) => put("stats", { ...get("stats", {}), ...map }),
    mergeSessions: async (map) => put("sessions", { ...toMap(get("sessions", {})), ...map }),
    mergeQuestions: async (map) => put("q", { ...get("q", DEMO_QUESTIONS), ...map }),
    deleteBank: async () => put("q", {}),
  };
}

export const open = () => (isDemo ? demoStore() : firebaseStore());
