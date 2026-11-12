// Shop catalog. Tweak prices here. Meshes for hat/glasses/neck/back ids live in accessories.js.
// slot: hat | glasses | neck | back | fur | fx.   tab: which shop tab shows it.
// Pricing guide: ~20 minutes of play earns roughly 400-600 coins (coins + fish bonuses).
import { CATS } from "./config.js";

export const TABS = [
  { id: "hats", name: "Hats", icon: "🎩" },
  { id: "neck", name: "Neck & Back", icon: "🎀" },
  { id: "glasses", name: "Glasses", icon: "🕶️" },
  { id: "looks", name: "Looks", icon: "✨" },
  { id: "upgrades", name: "Upgrades", icon: "⚡" },
];

const item = (id, name, slot, tab, price, extra = {}) => ({ id, name, slot, tab, price, ...extra });

export const ITEMS = [
  item("hat_party", "Party Hat", "hat", "hats", 60),
  item("hat_beanie", "Pom-pom Beanie", "hat", "hats", 90),
  item("hat_flowers", "Flower Crown", "hat", "hats", 120),
  item("hat_cowboy", "Cowboy Hat", "hat", "hats", 150),
  item("hat_wizard", "Wizard Hat", "hat", "hats", 220),
  item("hat_crown", "Royal Crown", "hat", "hats", 350),
  item("neck_bell", "Bell Collar", "neck", "neck", 50),
  item("neck_bandana", "Bandana", "neck", "neck", 70),
  item("neck_bowtie", "Bow Tie", "neck", "neck", 80),
  item("neck_scarf", "Cozy Scarf", "neck", "neck", 100),
  item("back_pack", "Tiny Backpack", "back", "neck", 130),
  item("back_cape", "Hero Cape", "back", "neck", 240),
  item("glasses_round", "Round Glasses", "glasses", "glasses", 70),
  item("glasses_heart", "Heart Shades", "glasses", "glasses", 110),
  item("glasses_star", "Star Shades", "glasses", "glasses", 160),
  // Looks: fur variants come from CATS[].variants (config.js); effects are below.
  ...CATS.flatMap((c) => (c.variants || []).map((v, i) => item(`fur_${c.id}_${v.id}`, v.name + " Fur", "fur", "looks", 150 + i * 50, { cat: c.id, palette: v }))),
  item("fx_rainbow", "Rainbow Tail", "fx", "looks", 200),
  item("fx_glitter", "Glitter Trail", "fx", "looks", 260),
  item("fx_paws", "Paw Prints", "fx", "looks", 120),
];

// Upgrades: tiers[i] = { price, value } for level i+1. Level 0 = base.
export const UPGRADES = [
  { id: "speed", name: "Zoomies", icon: "💨", desc: (v) => `Run speed x${v}`, base: 1, tiers: [{ price: 120, value: 1.15 }, { price: 260, value: 1.3 }, { price: 480, value: 1.5 }] },
  { id: "jump", name: "Bouncy Paws", icon: "🦘", desc: (v) => (v === "double" ? "Double jump!" : `Jump x${v}`), base: 1, tiers: [{ price: 100, value: 1.2 }, { price: 220, value: 1.4 }, { price: 450, value: "double" }] },
  { id: "magnet", name: "Coin Magnet", icon: "🧲", desc: (v) => `Pulls coins from ${v} steps`, base: 0, tiers: [{ price: 100, value: 4 }, { price: 220, value: 7 }, { price: 420, value: 11 }] },
  { id: "radar", name: "Fish Radar", icon: "📡", desc: (v) => `Arrow to fish within ${v} steps`, base: 0, tiers: [{ price: 150, value: 30 }, { price: 300, value: 60 }, { price: 520, value: 999 }] },
];
export const itemById = (id) => ITEMS.find((i) => i.id === id);
export const upgradeValue = (id, level) => { const u = UPGRADES.find((x) => x.id === id); return level > 0 ? u.tiers[level - 1].value : u.base; };

export const COIN_REWARD = { fish: 10, allFish: 50, butterfly: 2 };
