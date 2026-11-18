import { CATS, ALLOWED_UIDS, PIN_PLAYERS, PIN_UIDS } from "./config.js";
import { mountPin, fakeLogin } from "./pinui.js";
import { unlockAudio } from "./audio.js";

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const DEV = q.get("dev") === "1"; // single-player, no Firebase, progress in localStorage
const show = (id) => { for (const s of ["loading", "locked", "start"]) $(s).hidden = s !== id; };
const hideAll = () => show("none");

const blankProgress = (cat) => ({ cat, fish: {}, coins: 0, owned: {}, equipped: {}, upgrades: {} });
const mergeProgress = (base, saved) => ({ ...base, ...saved, fish: saved.fish || {}, owned: saved.owned || {}, equipped: saved.equipped || {}, upgrades: saved.upgrades || {} });

async function boot() {
  show("loading");
  const LS = "cats.dev.progress";
  let net = null, user = null, saved = {};

  if (DEV && q.get("pinui") === "1") return lock({ fake: true }); // dev-only: look at the PIN screens without a server
  if (DEV) {
    try { saved = JSON.parse(localStorage.getItem(LS) || "{}"); } catch {}
    user = { uid: "dev", displayName: "Dev" };
  } else {
    try { net = await import("./net.js"); }
    catch (e) { return lock({ note: "Couldn't reach the game server. Check the internet and try again." }); }
    // If Firebase auth is slow to answer, show the locked screen; it reloads by itself once auth reports a user.
    // Coming back from Google: finish the redirect first so the locked screen doesn't flash.
    if (net.redirectPending()) $("loading").querySelector("p").textContent = "Signing in…";
    const redirectErr = await net.redirectResult;
    user = await new Promise((res) => { net.watchAuth(res); setTimeout(() => res(null), 6000); });
    net.watchAuth((u) => { if ((u && u.uid) !== (user && user.uid)) location.reload(); });
    if (!user) return lock({ note: redirectErr ? signInMessage(redirectErr) : "", retry: !!redirectErr });
    if (!ALLOWED_UIDS.includes(user.uid)) return lock({ uid: user.uid });
    try { saved = await net.loadProgress(user.uid); } catch (e) { saved = {}; }
  }

  // ---- cat picker ----
  const grid = $("cats");
  let chosen = CATS.find((c) => c.id === saved.cat)?.id || CATS[0].id;
  if (DEV && q.get("autostart") === "1") chosen = q.get("cat") || "cat1";
  const cards = CATS.map((c) => {
    const b = document.createElement("button");
    b.className = "cat-card"; b.dataset.id = c.id;
    b.innerHTML = `<span>${c.name}</span><em></em>`;
    b.onclick = () => { if (!b.disabled) { chosen = c.id; mark(); } };
    grid.append(b);
    return b;
  });
  let turn = null;
  const mark = () => { cards.forEach((b) => b.classList.toggle("sel", b.dataset.id === chosen)); turn && turn.select(chosen); };
  mark();
  // Remember who's online so two players can't both be the same cat (checked once more on Play).
  let taken = {}, unwatch = null;
  if (net) unwatch = net.watchPlayers((all) => {
    taken = {};
    for (const [key, v] of Object.entries(all)) if (key !== net.keyFor(user.uid) && net.isPresenceKey(key) && v) taken[v.cat] = true;
    cards.forEach((b) => { b.disabled = !!taken[b.dataset.id]; b.querySelector("em").textContent = b.disabled ? "playing now" : ""; });
    if (taken[chosen]) { chosen = CATS.find((c) => !taken[c.id])?.id || chosen; mark(); }
  });
  const kidName = PIN_UIDS[user.uid];
  $("hello").textContent = kidName ? `Hi ${kidName}!` : user.displayName ? `Hi ${user.displayName.split(" ")[0]}!` : "Hi!";
  $("switchPlayer").hidden = DEV;
  $("switchPlayer").onclick = () => net.logOut();
  $("signout-start").hidden = DEV;
  $("signout-start").onclick = () => net.logOut();

  const go = async () => {
    unlockAudio();
    if (turn) { turn.dispose(); turn = null; }
    if (unwatch) { unwatch(); unwatch = null; } // the start-screen listener must not keep firing during play
    show("loading");
    const P = mergeProgress(blankProgress(chosen), saved);
    P.cat = chosen;
    const session = DEV
      ? { uid: "dev", key: "dev_devdevdev1", P, save() { try { localStorage.setItem(LS, JSON.stringify(P)); } catch {} }, publish: null, watchPlayers: null }
      : { uid: user.uid, key: net.keyFor(user.uid), P, save: (patch) => net.saveProgress(user.uid, patch).catch(() => {}), publish: (s) => net.publish(user.uid, s).catch(() => {}), watchPlayers: net.watchPlayers };
    session.save({ cat: chosen });
    const flags = DEV ? Object.fromEntries(q.entries()) : {};
    const { startGame } = await import("./game.js");
    await startGame({ session, flags });
    hideAll();
    $("hud").hidden = false;
  };
  $("play").onclick = go;
  if (DEV && q.get("autostart") === "1") go();
  else {
    show("start");
    import("./turntable.js").then(({ createTurntable }) => { if (!$("start").hidden) { turn = createTurntable($("turn"), chosen, (id) => { const b = cards.find((x) => x.dataset.id === id); if (b && !b.disabled) { chosen = id; mark(); } }); } }).catch(() => {});
  }
}

// Kid-friendly line, with the error code in small text for a parent.
function signInMessage(err) {
  const code = err.code || "unknown";
  const storage = /web-storage|operation-not-supported|internal-error|network/.test(code);
  return { text: storage ? "Sign-in is blocked here. Open davemost.com/cats in Safari and sign in there." : "Sign-in didn't finish. Tap Sign in to try again.", code };
}

function lock({ uid, note, retry, fake }) {
  show("locked");
  const n = $("locked-note");
  n.textContent = "";
  if (note && note.text) { n.append(note.text, " "); const s = document.createElement("small"); s.textContent = "(" + note.code + ")"; n.append(s); }
  else n.textContent = note || "";
  $("uid-box").hidden = !uid;
  const askPin = !uid && !(note && !retry);
  $("who-box").hidden = !askPin;
  $("locked-head").hidden = askPin;
  if (askPin) mountPin($("who-box"), PIN_PLAYERS, fake ? fakeLogin() : async (p, pin) => (await import("./net.js")).pinLogin(p, pin));
  $("signin").hidden = !!fake || !!uid || (!!note && !retry);
  $("signin").textContent = retry ? "Try again" : "Grown-up sign-in";
  $("signout").hidden = !uid;
  if (uid) $("my-uid").textContent = uid;
  $("signin").onclick = async () => {
    const net = await import("./net.js");
    $("locked-note").textContent = "Signing in…";
    net.signIn().catch((err) => {
      $("locked-note").textContent = "";
      if (err.code === "auth/popup-closed-by-user") return;
      lock({ note: signInMessage(err), retry: true });
    });
  };
  $("signout").onclick = async () => (await import("./net.js")).logOut();
  $("copy-uid").onclick = async () => {
    try { await navigator.clipboard.writeText(uid); $("copy-uid").textContent = "Copied!"; }
    catch { const r = document.createRange(); r.selectNodeContents($("my-uid")); getSelection().removeAllRanges(); getSelection().addRange(r); $("copy-uid").textContent = "Press copy"; }
    setTimeout(() => ($("copy-uid").textContent = "Copy"), 1800);
  };
}

boot().catch((e) => { console.error(e); lock({ note: "Something went wrong: " + e.message }); });
$("muteBtn").onclick = async () => {
  const a = await import("./audio.js");
  a.setMuted(!a.isMuted()); $("muteBtn").textContent = a.isMuted() ? "🔇" : "🔊";
};
import("./audio.js").then((a) => ($("muteBtn").textContent = a.isMuted() ? "🔇" : "🔊"));
