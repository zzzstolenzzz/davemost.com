import * as THREE from "three";
import { buildCat } from "./cat.js";
import { ITEMS, TABS, UPGRADES, itemById } from "./shop.js";

const $ = (id) => document.getElementById(id);
// Where the preview camera looks, per slot (cat faces +Z, head is near (0, 0.95, 0.4)).
const FRAMES = {
  hat: { pos: [0.5, 1.6, 2.3], look: [0, 1.12, 0.4], fov: 35 },
  glasses: { pos: [0.5, 1.12, 2.7], look: [0, 1.0, 0.5], fov: 30 },
  neck: { pos: [0.7, 1.1, 2.1], look: [0, 0.85, 0.3], fov: 38 },
  back: { pos: [-1.9, 1.5, -1.9], look: [0, 0.8, 0], fov: 38 },
  fur: { pos: [1.9, 1.25, 2.5], look: [0, 0.65, 0], fov: 38 },
  fx: { pos: [-1.7, 1.2, -2.5], look: [0, 0.6, -0.2], fov: 40 },
};
const BG = { hats: "#ffe1e8", neck: "#dcebfb", glasses: "#ffeec2", looks: "#e2f6d5" };

export function createShop({ renderer, P, session, catCfg, onEquipChange, controls, sfx, hudCoin }) {
  const root = $("shop");
  let tab = "hats", open = false;
  const cache = new Map();
  let dirty = false; // previews draw into a corner of the main canvas; ask the game loop for one clean frame afterwards

  // --- preview rig: one cat, rendered into a corner of the main canvas and copied out ---
  const pscene = new THREE.Scene();
  pscene.add(new THREE.HemisphereLight(0xc4d2ff, 0xffdcb4, 2.0));
  const dl = new THREE.DirectionalLight(0xffe2bc, 2.6); dl.position.set(3, 5, 4); pscene.add(dl);
  const pcat = buildCat(catCfg); pscene.add(pcat.root);
  const pcam = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  const out = document.createElement("canvas"); out.width = out.height = 280;
  const octx = out.getContext("2d");
  const bgCol = new THREE.Color(), prevClear = new THREE.Color();

  function preview(it) {
    const key = it.id + "|" + (P.equipped.fur || "") + "|" + catCfg.id;
    if (cache.has(key)) return cache.get(key);
    const fur = it.slot === "fur" ? it.id : P.equipped.fur, fi = fur && itemById(fur);
    pcat.equip({ [it.slot]: it.id });
    pcat.setPalette(fi && fi.cat === catCfg.id ? fi.palette : null);
    pcat.setRainbowTail(it.id === "fx_rainbow");
    for (let i = 0; i < 6; i++) pcat.update(0.05, 1.5, false);
    const f = FRAMES[it.slot];
    pcam.fov = f.fov; pcam.updateProjectionMatrix(); pcam.position.set(...f.pos); pcam.lookAt(...f.look);
    const S = 180, pr = renderer.getPixelRatio(), size = renderer.getSize(new THREE.Vector2());
    renderer.getClearColor(prevClear); const prevA = renderer.getClearAlpha();
    renderer.setClearColor(bgCol.set(BG[it.tab] || "#ffe3ee"), 1);
    renderer.setScissorTest(true); renderer.setViewport(0, 0, S, S); renderer.setScissor(0, 0, S, S);
    renderer.render(pscene, pcam);
    octx.clearRect(0, 0, out.width, out.height);
    octx.drawImage(renderer.domElement, 0, renderer.domElement.height - S * pr, S * pr, S * pr, 0, 0, out.width, out.height);
    renderer.setScissorTest(false); renderer.setViewport(0, 0, size.x, size.y); renderer.setClearColor(prevClear, prevA);
    const url = out.toDataURL("image/png");
    cache.set(key, url);
    dirty = true;
    return url;
  }

  // --- UI ---
  const coinsEl = () => root.querySelector(".shop-coins b");
  function persist(patch) { session.save(patch); }
  function buy(it) {
    if (P.coins < it.price) { sfx.nope(); return; }
    P.coins -= it.price; P.owned[it.id] = true; P.equipped[it.slot] = it.id;
    persist({ coins: P.coins, ["owned/" + it.id]: true, ["equipped/" + it.slot]: it.id });
    sfx.buy(); onEquipChange(); render();
  }
  function toggle(it) {
    if (P.equipped[it.slot] === it.id) { delete P.equipped[it.slot]; persist({ ["equipped/" + it.slot]: null }); }
    else { P.equipped[it.slot] = it.id; persist({ ["equipped/" + it.slot]: it.id }); }
    sfx.tick(); onEquipChange(); render();
  }
  function upgrade(u) {
    const lvl = P.upgrades[u.id] | 0, next = u.tiers[lvl];
    if (!next || P.coins < next.price) { sfx.nope(); return; }
    P.coins -= next.price; P.upgrades[u.id] = lvl + 1;
    persist({ coins: P.coins, ["upgrades/" + u.id]: lvl + 1 });
    sfx.buy(); render();
  }

  function card(it) {
    const owned = !!P.owned[it.id], eq = P.equipped[it.slot] === it.id, can = P.coins >= it.price;
    const el = document.createElement("div");
    el.className = "card" + (eq ? " equipped" : owned ? " owned" : can ? "" : " locked");
    const img = new Image(); img.alt = it.name; img.src = preview(it);
    const state = eq ? '<span class="badge">Wearing</span>' : owned ? '<span class="badge own">Owned</span>' : `<span class="price">🐾 ${it.price}</span>`;
    el.append(img);
    el.insertAdjacentHTML("beforeend", `<div class="cname">${it.name}</div><div class="cstate">${state}</div>`);
    const b = document.createElement("button");
    if (eq) { b.textContent = "Take off"; b.className = "alt"; b.onclick = () => toggle(it); }
    else if (owned) { b.textContent = "Wear"; b.onclick = () => toggle(it); }
    else { b.textContent = can ? "Buy" : `Need ${it.price - P.coins} more`; b.disabled = !can; b.onclick = () => buy(it); }
    el.append(b);
    return el;
  }
  function upgradeCard(u) {
    const lvl = P.upgrades[u.id] | 0, next = u.tiers[lvl], el = document.createElement("div");
    el.className = "card up" + (next && P.coins < next.price ? " locked" : "");
    const cur = lvl ? u.desc(u.tiers[lvl - 1].value) : "Not unlocked yet";
    el.innerHTML = `<div class="bigicon">${u.icon}</div><div class="cname">${u.name}</div>
      <div class="pips">${u.tiers.map((_, i) => `<i class="${i < lvl ? "on" : ""}"></i>`).join("")}</div>
      <div class="cdesc">${next ? "Next: " + u.desc(next.value) : cur}</div>`;
    const b = document.createElement("button");
    if (!next) { b.textContent = "Maxed out!"; b.disabled = true; }
    else { const can = P.coins >= next.price; b.textContent = can ? `Upgrade  🐾 ${next.price}` : `🐾 ${next.price}  (need ${next.price - P.coins} more)`; b.disabled = !can; b.onclick = () => upgrade(u); }
    el.append(b);
    return el;
  }

  function render() {
    root.querySelector(".shop-coins b").textContent = P.coins;
    root.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === tab));
    const grid = root.querySelector(".grid");
    grid.replaceChildren();
    if (tab === "upgrades") UPGRADES.forEach((u) => grid.append(upgradeCard(u)));
    else ITEMS.filter((i) => i.tab === tab && (!i.cat || i.cat === catCfg.id)).forEach((i) => grid.append(card(i)));
  }

  root.innerHTML = `<div class="shop-box ui"><div class="shop-head"><h2>🏠 Cozy Shop</h2><div class="shop-coins">🐾 <b>0</b></div><button class="close" aria-label="Close">✕</button></div>
    <div class="tabs">${TABS.map((t) => `<button class="tab" data-tab="${t.id}"><span>${t.icon}</span>${t.name}</button>`).join("")}</div><div class="grid"></div></div>`;
  root.querySelector(".close").onclick = () => api.close();
  root.addEventListener("click", (e) => { if (e.target === root) api.close(); });
  root.querySelectorAll(".tab").forEach((t) => (t.onclick = () => { tab = t.dataset.tab; sfx.tick(); render(); root.querySelector(".grid").scrollTop = 0; }));

  const api = {
    get isOpen() { return open; },
    takeDirty() { const d = dirty; dirty = false; return d; },
    open(t) { if (t && TABS.some((x) => x.id === t)) tab = t; open = true; controls.blocked = true; root.hidden = false; render(); },
    close() { if (!open) return; open = false; root.hidden = true; hudCoin($("coinPill")); },
  };
  return api;
}
