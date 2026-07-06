// Item registry. Every placeable block is auto-registered as an item;
// tools, materials, and food are defined explicitly.
//
// Tool tiers: 1 timber · 2 stone · 3 copper · 4 iron.

import { B, BLOCKS } from './blocks.js';

export const ITEMS = new Map();

function item(key, name, props = {}) {
  const it = Object.assign({
    key, name,
    kind: 'material',        // 'block' | 'tool' | 'material' | 'food'
    block: null,             // block id for kind 'block'
    maxStack: 64,
    tool: null,              // {type, tier, speed, durability, damage}
    food: null,              // {restore}
    icon: key,               // atlas texture key for sprites / DOM icons
    desc: '',
  }, props);
  ITEMS.set(key, it);
  return it;
}

// ── Block items (everything placeable) ────────────────────────────
const NO_ITEM = new Set([B.AIR, B.CORESTONE, B.WATER, B.LAVA,
  B.FARMLAND, B.CROP_0, B.CROP_1, B.CROP_2, B.CROP_3, B.BERRYBUSH_RIPE,
  B.RIFT_SMOLDER, B.RIFT_HOLLOW]);
for (const b of BLOCKS) {
  if (!b || NO_ITEM.has(b.id)) continue;
  if (b.key.startsWith('water_f') || b.key.startsWith('lava_f')) continue;
  // Shaped-block families share one item across all their state ids; only
  // the primary state (whose key === its item) registers the inventory
  // item. Placement picks the concrete state id from click position/yaw.
  if (b.shape !== 'cube' && b.item && b.item !== b.key) continue;
  const key = b.item ?? b.key;
  // Shaped blocks have no dedicated sprite key; reuse the base material's
  // texture (tex.all) for the inventory icon.
  const icon = b.shape !== 'cube' ? (b.tex.all ?? b.key) : key;
  item(key, b.name, { kind: 'block', block: b.id, icon });
}

// ── Tools ─────────────────────────────────────────────────────────
const TIERS = [
  null,
  { id: 'timber',   label: 'Timber',   speed: 2.6,  durability: 64,   damage: 1 },
  { id: 'stone',    label: 'Stone',    speed: 4.6,  durability: 140,  damage: 2 },
  { id: 'copper',   label: 'Copper',   speed: 6.6,  durability: 260,  damage: 3 },
  { id: 'iron',     label: 'Iron',     speed: 9.2,  durability: 520,  damage: 4 },
  { id: 'sunsteel', label: 'Sunsteel', speed: 12.5, durability: 1140, damage: 5 },
];
const TOOL_TYPES = [
  { type: 'pick',   label: 'Pick' },
  { type: 'axe',    label: 'Hewer' },
  { type: 'shovel', label: 'Spade' },
  { type: 'hoe',    label: 'Tiller' },
  { type: 'blade',  label: 'Blade' },
];
for (let tier = 1; tier <= 5; tier++) {
  const t = TIERS[tier];
  for (const tt of TOOL_TYPES) {
    item(`${tt.type}_${t.id}`, `${t.label} ${tt.label}`, {
      kind: 'tool', maxStack: 1,
      tool: {
        type: tt.type, tier,
        speed: t.speed,
        durability: t.durability,
        damage: tt.type === 'blade' ? t.damage + 3 : t.damage,
      },
    });
  }
}

// ── Materials ─────────────────────────────────────────────────────
item('rod', 'Timber Rod');
item('coal', 'Coal');
item('clay_lump', 'Clay Lump');
item('copper_ore_chunk', 'Raw Copper');
item('iron_ore_chunk', 'Raw Iron');
item('copper_ingot', 'Copper Ingot');
item('iron_ingot', 'Iron Ingot');
item('sunstone', 'Sunstone Shard');
item('hide', 'Tanned Hide');
item('glimmer_dust', 'Glimmer Dust');
item('tuber_seed', 'Tuber Seed', { desc: 'Plant on tilled soil.' });
item('smolder_shard', 'Smolder Shard', { desc: 'Pulses with heat from the Smolder.' });
item('sunsteel_ingot', 'Sunsteel Ingot');
item('sovereign_core', 'Sovereign Core', { desc: 'The still-beating heart of the Hollow.' });
item('kindle_flint', 'Kindle Flint', {
  maxStack: 1, desc: 'Strike a basalt or sunstone frame to open a rift.',
});
item('clay_vessel', 'Clay Vessel', {
  maxStack: 16, desc: 'Scoops up water or lava.',
});
item('vessel_water', 'Vessel of Water', { maxStack: 1 });
item('vessel_lava', 'Vessel of Lava', { maxStack: 1 });

// ── Food ──────────────────────────────────────────────────────────
item('berries', 'Bramble Berries', { kind: 'food', food: { restore: 2 } });
item('tuber', 'Tuber', { kind: 'food', food: { restore: 3 } });
item('tuber_roast', 'Roast Tuber', { kind: 'food', food: { restore: 6 } });
item('meat_raw', 'Raw Haunch', { kind: 'food', food: { restore: 2 } });
item('meat_roast', 'Roast Haunch', { kind: 'food', food: { restore: 7 } });

export const itemByKey = (key) => ITEMS.get(key) || null;

// Mod registration: same shape as internal definitions.
export function registerItem(key, name, props = {}) {
  if (ITEMS.has(key)) throw new Error(`item key "${key}" already registered`);
  return item(key, name, props);
}

// All non-block item texture keys the atlas must paint as sprites.
export function spriteItemKeys() {
  const out = [];
  for (const it of ITEMS.values()) {
    if (it.kind !== 'block') out.push(it.icon);
  }
  return [...new Set(out)];
}

// Creative catalog ordering for the Builder inventory.
export function catalogItems() {
  const blocks = [], tools = [], mats = [], food = [];
  for (const it of ITEMS.values()) {
    if (it.kind === 'block') blocks.push(it.key);
    else if (it.kind === 'tool') tools.push(it.key);
    else if (it.kind === 'food') food.push(it.key);
    else mats.push(it.key);
  }
  return { blocks, tools, mats, food };
}
