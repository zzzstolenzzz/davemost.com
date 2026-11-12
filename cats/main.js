import { CATS, ALLOWED_UIDS } from "./config.js";
import { unlockAudio } from "./audio.js";

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const DEV = q.get("dev") === "1"; // single-player, no Firebase, progress in localStorage
const show = (id) => { for (const s of ["loading", "locked", "start"]) $(s).hidden = s !== id; };
const hideAll = () => show("none");

// Little SVG cat face for the picker, drawn from the same config as the 3D cat.
function faceSVG(c) {
  const stripes = c.markings === "stripes" ? `<path d="M60 22v12M50 24l2 11M70 24l-2 11" stroke="${c.markingColor}" stroke-width="5" stroke-linecap="round"/>` : "";
  const patch = c.markings === "patches" ? `<ellipse cx="38" cy="48" rx="15" ry="13" fill="${c.markingColor}"/>` : "";
  return `<svg viewBox="0 0 120 110" aria-hidden="true">
    <path d="M18 52 14 10 48 28Z" fill="${c.body}" stroke="#3b2a4a" stroke-width="4" stroke-linejoin="round"/><path d="M102 52 106 10 72 28Z" fill="${c.body}" stroke="#3b2a4a" stroke-width="4" stroke-linejoin="round"/>
    <path d="M24 42 22 22 38 31Z M96 42 98 22 82 31Z" fill="#ffb3c1"/>
    <ellipse cx="60" cy="62" rx="46" ry="40" fill="${c.body}" stroke="#3b2a4a" stroke-width="4"/>${patch}${stripes}
    <ellipse cx="38" cy="62" rx="9" ry="11" fill="${c.eyes}" stroke="#3b2a4a" stroke-width="3"/><ellipse cx="82" cy="62" rx="9" ry="11" fill="${c.eyes}" stroke="#3b2a4a" stroke-width="3"/>
    <ellipse cx="38" cy="64" rx="4.5" ry="7" fill="#3b2a4a"/><ellipse cx="82" cy="64" rx="4.5" ry="7" fill="#3b2a4a"/>
    <circle cx="41" cy="59" r="3" fill="#fff"/><circle cx="85" cy="59" r="3" fill="#fff"/>
    <ellipse cx="60" cy="76" rx="5" ry="3.5" fill="${c.nose}"/><path d="M60 80q-5 7-11 3M60 80q5 7 11 3" stroke="#3b2a4a" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <circle cx="24" cy="76" r="6" fill="#ff9fb5" opacity=".55"/><circle cx="96" cy="76" r="6" fill="#ff9fb5" opacity=".55"/></svg>`;
}

const blankProgress = (cat) => ({ cat, fish: {}, coins: 0, owned: {}, equipped: {}, upgrades: {} });
const mergeProgress = (base, saved) => ({ ...base, ...saved, fish: saved.fish || {}, owned: saved.owned || {}, equipped: saved.equipped || {}, upgrades: saved.upgrades || {} });

async function boot() {
  show("loading");
  const LS = "cats.dev.progress";
  let net = null, user = null, saved = {};

  if (DEV) {
    try { saved = JSON.parse(localStorage.getItem(LS) || "{}"); } catch {}
    user = { uid: "dev", displayName: "Dev" };
  } else {
    try { net = await import("./net.js"); }
    catch (e) { return lock({ note: "Couldn't reach the game server. Check the internet and try again." }); }
    // If Firebase auth is slow to answer, show the locked screen; it reloads by itself once auth reports a user.
    user = await new Promise((res) => { net.watchAuth(res); setTimeout(() => res(null), 6000); });
    net.watchAuth((u) => { if ((u && u.uid) !== (user && user.uid)) location.reload(); });
    if (!user) return lock({});
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
    b.innerHTML = `${faceSVG(c)}<span>${c.name}</span><em></em>`;
    b.onclick = () => { if (!b.disabled) { chosen = c.id; mark(); } };
    grid.append(b);
    return b;
  });
  const mark = () => cards.forEach((b) => b.classList.toggle("sel", b.dataset.id === chosen));
  mark();
  // Remember who's online so two players can't both be the same cat (checked once more on Play).
  let taken = {};
  if (net) net.watchPlayers((all) => {
    taken = {};
    for (const [uid, v] of Object.entries(all)) if (uid !== user.uid && v) taken[v.cat] = true;
    cards.forEach((b) => { b.disabled = !!taken[b.dataset.id]; b.querySelector("em").textContent = b.disabled ? "playing now" : ""; });
    if (taken[chosen]) { chosen = CATS.find((c) => !taken[c.id])?.id || chosen; mark(); }
  });
  $("hello").textContent = user.displayName ? `Hi ${user.displayName.split(" ")[0]}!` : "Hi!";
  $("signout-start").hidden = DEV;
  $("signout-start").onclick = () => net.logOut();

  const go = async () => {
    unlockAudio();
    show("loading");
    const P = mergeProgress(blankProgress(chosen), saved);
    P.cat = chosen;
    const session = DEV
      ? { uid: "dev", P, save() { try { localStorage.setItem(LS, JSON.stringify(P)); } catch {} }, publish: null, watchPlayers: null }
      : { uid: user.uid, P, save: (patch) => net.saveProgress(user.uid, patch).catch(() => {}), publish: (s) => net.publish(user.uid, s).catch(() => {}), watchPlayers: net.watchPlayers };
    session.save({ cat: chosen });
    const flags = DEV ? Object.fromEntries(q.entries()) : {};
    const { startGame } = await import("./game.js");
    await startGame({ session, flags });
    hideAll();
    $("hud").hidden = false;
  };
  $("play").onclick = go;
  if (DEV && q.get("autostart") === "1") go(); else show("start");
}

function lock({ uid, note }) {
  show("locked");
  $("locked-note").textContent = note || "";
  $("uid-box").hidden = !uid;
  $("signin").hidden = !!uid || !!note;
  $("signout").hidden = !uid;
  if (uid) $("my-uid").textContent = uid;
  $("signin").onclick = async () => {
    const net = await import("./net.js");
    net.signIn().catch((err) => { if (!/popup-closed|cancelled/.test(err.code || "")) $("locked-note").textContent = "Couldn't sign in: " + err.message; });
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
