// Item registry. Every placeable block is auto-registered as an item;
// tools, materials, and food are defined explicitly.
//
// Tool tiers: 1 wooden · 2 stone · 3 copper · 4 iron · 5 netherite.

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
const NO_ITEM = new Set([B.AIR, B.BEDROCK, B.WATER, B.LAVA,
  B.FARMLAND, B.CROP_0, B.CROP_1, B.CROP_2, B.CROP_3, B.SWEET_BERRY_BUSH_RIPE,
  B.WHEAT_0, B.WHEAT_1, B.WHEAT_2, B.WHEAT_3,
  B.CARROT_0, B.CARROT_1, B.CARROT_2, B.CARROT_3,
  B.PUMPKIN_STEM_0, B.PUMPKIN_STEM_0 + 1, B.PUMPKIN_STEM_0 + 2, B.PUMPKIN_STEM_3,
  B.MELON_STEM_0, B.MELON_STEM_0 + 1, B.MELON_STEM_0 + 2, B.MELON_STEM_3,
  B.CAKE_0, B.CAKE_0 + 1, B.CAKE_0 + 2, B.CAKE_0 + 3, B.CAKE_0 + 4, B.CAKE_0 + 5, B.CAKE_6,
  B.REDSTONE_TORCH_OFF, B.LEVER_ON, B.STONE_BUTTON_ON, B.REDSTONE_LAMP_ON,
  B.NETHER_PORTAL, B.END_PORTAL]);
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
  { id: 'wooden',    label: 'Wooden',    speed: 2.6,  durability: 64,   damage: 1 },
  { id: 'stone',     label: 'Stone',     speed: 4.6,  durability: 140,  damage: 2 },
  { id: 'copper',    label: 'Copper',    speed: 6.6,  durability: 260,  damage: 3 },
  { id: 'iron',      label: 'Iron',      speed: 9.2,  durability: 520,  damage: 4 },
  { id: 'netherite', label: 'Netherite', speed: 12.5, durability: 1140, damage: 5 },
];
// `type` is the internal tool-category string block defs check against;
// `item` is the Minecraft-style item-key suffix (wooden_pickaxe, iron_sword).
const TOOL_TYPES = [
  { type: 'pick',   item: 'pickaxe', label: 'Pickaxe' },
  { type: 'axe',    item: 'axe',     label: 'Axe' },
  { type: 'shovel', item: 'shovel',  label: 'Shovel' },
  { type: 'hoe',    item: 'hoe',     label: 'Hoe' },
  { type: 'blade',  item: 'sword',   label: 'Sword' },
];
for (let tier = 1; tier <= 5; tier++) {
  const t = TIERS[tier];
  for (const tt of TOOL_TYPES) {
    item(`${t.id}_${tt.item}`, `${t.label} ${tt.label}`, {
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
item('stick', 'Stick');
item('coal', 'Coal');
item('clay_ball', 'Clay Ball');
item('raw_copper', 'Raw Copper');
item('raw_iron', 'Raw Iron');
item('copper_ingot', 'Copper Ingot');
item('iron_ingot', 'Iron Ingot');
item('diamond', 'Diamond');
item('leather', 'Leather');
item('glowstone_dust', 'Glowstone Dust');
item('seeds', 'Seeds', { desc: 'Plant on farmland.' });
item('wheat_seeds', 'Wheat Seeds', { desc: 'Plant on farmland to grow wheat.' });
item('wheat', 'Wheat', { desc: 'Bundle into bread.' });
item('netherite_scrap', 'Netherite Scrap', { desc: 'Pulses with heat from the Nether.' });
item('netherite_ingot', 'Netherite Ingot');
item('dragon_core', 'Dragon Core', { desc: 'The still-beating heart of the End.' });
item('flint_and_steel', 'Flint and Steel', {
  maxStack: 1, desc: 'Strike an obsidian or diamond frame to open a portal.',
});
item('bucket', 'Bucket', {
  maxStack: 16, desc: 'Scoops up water or lava.',
});
item('water_bucket', 'Water Bucket', { maxStack: 1 });
item('lava_bucket', 'Lava Bucket', { maxStack: 1 });
item('feather', 'Feather', { desc: 'A light, downy quill.' });
item('wool', 'Wool', { desc: 'Soft sheared fleece.' });
item('gunpowder', 'Gunpowder', { desc: 'Volatile black dust.' });
item('bone', 'Bone', { desc: 'Grind into bone meal.' });
item('bone_meal', 'Bone Meal', { desc: 'Fertilizes crops and saplings.' });
item('flint', 'Flint', { desc: 'A sharp shard knapped from gravel.' });
item('string', 'String', { desc: 'Unraveled fibre for bows.' });
item('arrow', 'Arrow', { desc: 'Ammunition for a bow.' });
item('slimeball', 'Slimeball', { desc: 'Bouncy translucent goo.' });
item('ender_pearl', 'Ender Pearl', { maxStack: 16, desc: 'Throw it to blink to where it lands.' });

// ── Dyes (16) ─────────────────────────────────────────────────────
const DYE_ORDER = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
for (const c of DYE_ORDER) {
  const label = c.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  item(`${c}_dye`, `${label} Dye`, { desc: 'Dye wool and more.' });
}
item('milk_bucket', 'Milk Bucket', { kind: 'food', maxStack: 1, food: { restore: 1 }, desc: 'Refreshing. Empties to a bucket.' });

// ── Brewing ───────────────────────────────────────────────────────
item('nether_wart', 'Nether Wart', { desc: 'A brewing staple from the Nether.' });
item('magma_cream', 'Magma Cream', { desc: 'A warm brewing reagent.' });
item('glass_bottle', 'Glass Bottle', { maxStack: 16, desc: 'Fill at water for a water bottle.' });
item('water_bottle', 'Water Bottle', { maxStack: 1, desc: 'The base for brewing.' });
item('awkward_potion', 'Awkward Potion', { maxStack: 1, desc: 'A brewing base — add a reagent.' });
function potion(key, name, effect) {
  item(key, name, { kind: 'potion', maxStack: 1, potion: effect });   // own icon key = potion sprite
}
potion('potion_healing', 'Potion of Healing', { type: 'healing', instant: true, amount: 6, color: [232, 74, 92] });
potion('potion_regeneration', 'Potion of Regeneration', { type: 'regeneration', duration: 22, level: 1, color: [214, 96, 176] });
potion('potion_strength', 'Potion of Strength', { type: 'strength', duration: 45, level: 1, color: [150, 40, 34] });
potion('potion_swiftness', 'Potion of Swiftness', { type: 'swiftness', duration: 45, level: 1, color: [116, 196, 224] });
potion('potion_fire_resistance', 'Potion of Fire Resistance', { type: 'fire_resistance', duration: 90, level: 1, color: [228, 148, 54] });
potion('potion_poison', 'Potion of Poison', { type: 'poison', duration: 12, level: 1, color: [86, 154, 60] });

// ── Ranged + shears ───────────────────────────────────────────────
item('bow', 'Bow', {
  kind: 'tool', maxStack: 1,
  tool: { type: 'bow', tier: 0, speed: 2.4, durability: 240, damage: 1 },
  desc: 'Hold right-click to draw, release to loose an arrow.',
});
item('shears', 'Shears', {
  kind: 'tool', maxStack: 1,
  tool: { type: 'shears', tier: 2, speed: 5, durability: 238, damage: 1 },
  desc: 'Shear sheep for wool; snips leaves and plants.',
});
item('shield', 'Shield', {
  kind: 'tool', maxStack: 1,
  tool: { type: 'shield', tier: 0, speed: 0, durability: 336, damage: 1 },
  desc: 'Hold right-click to raise and block incoming blows.',
});
item('fishing_rod', 'Fishing Rod', {
  kind: 'tool', maxStack: 1,
  tool: { type: 'fishing_rod', tier: 0, speed: 0, durability: 64, damage: 1 },
  desc: 'Right-click water to cast; reel in when a fish bites.',
});
item('crossbow', 'Crossbow', {
  kind: 'tool', maxStack: 1,
  tool: { type: 'crossbow', tier: 0, speed: 2.4, durability: 326, damage: 1 },
  desc: 'Slower to load than a bow, but its bolt flies flat and hits harder.',
});

// ── Armor ─────────────────────────────────────────────────────────
// slot 0 helmet · 1 chestplate · 2 leggings · 3 boots. points reduce
// incoming damage (MC-style: ~4% per point, capped).
const ARMOR_TIERS = [
  { id: 'leather', label: 'Leather', mat: 'leather', pts: [1, 3, 2, 1] },
  { id: 'iron', label: 'Iron', mat: 'iron_ingot', pts: [2, 6, 5, 2] },
  { id: 'diamond', label: 'Diamond', mat: 'diamond', pts: [3, 8, 6, 3] },
];
const ARMOR_PIECES = [
  { slot: 0, id: 'helmet', label: 'Helmet' },
  { slot: 1, id: 'chestplate', label: 'Chestplate' },
  { slot: 2, id: 'leggings', label: 'Leggings' },
  { slot: 3, id: 'boots', label: 'Boots' },
];
for (const t of ARMOR_TIERS) {
  for (const pc of ARMOR_PIECES) {
    item(`${t.id}_${pc.id}`, `${t.label} ${pc.label}`, {
      kind: 'armor', maxStack: 1,
      armor: { slot: pc.slot, points: t.pts[pc.slot], mat: t.mat },
    });
  }
}

// ── Food ──────────────────────────────────────────────────────────
item('sweet_berries', 'Sweet Berries', { kind: 'food', food: { restore: 2 } });
item('potato', 'Potato', { kind: 'food', food: { restore: 3 } });
item('baked_potato', 'Baked Potato', { kind: 'food', food: { restore: 6 } });
item('bread', 'Bread', { kind: 'food', food: { restore: 5 } });
item('carrot', 'Carrot', { kind: 'food', food: { restore: 3 }, desc: 'Eat it, or plant it on farmland.' });
item('pumpkin_seeds', 'Pumpkin Seeds', { desc: 'Plant on farmland to grow pumpkins.' });
item('melon_seeds', 'Melon Seeds', { desc: 'Plant on farmland to grow melons.' });
item('melon_slice', 'Melon Slice', { kind: 'food', food: { restore: 2 } });
item('sugar', 'Sugar', { desc: 'Refined from sugar cane.' });
item('pumpkin_pie', 'Pumpkin Pie', { kind: 'food', food: { restore: 8 } });
item('nether_star', 'Nether Star', { maxStack: 1, desc: 'Torn from the Wither. A beacon\'s heart.' });
item('emerald', 'Emerald', { desc: 'A villager\'s currency.' });
item('minecart', 'Minecart', { maxStack: 1, desc: 'Set it on rails, then ride.' });
item('boat', 'Boat', { maxStack: 1, desc: 'Set it on water, then row.' });
item('lapis_lazuli', 'Lapis Lazuli', { desc: 'Fuels the enchanting table.' });
item('paper', 'Paper', { desc: 'Pressed from sugar cane.' });
item('book', 'Book', { desc: 'Shelve it to empower enchanting.' });
item('cake', 'Cake', { kind: 'block', block: B.CAKE_0, icon: 'cake_side', maxStack: 1, desc: 'Place it, then eat a slice at a time.' });
item('raw_porkchop', 'Raw Porkchop', { kind: 'food', food: { restore: 2 } });
item('cooked_porkchop', 'Cooked Porkchop', { kind: 'food', food: { restore: 7 } });
item('raw_beef', 'Raw Beef', { kind: 'food', food: { restore: 2 } });
item('cooked_beef', 'Steak', { kind: 'food', food: { restore: 7 } });
item('raw_chicken', 'Raw Chicken', { kind: 'food', food: { restore: 1 } });
item('cooked_chicken', 'Cooked Chicken', { kind: 'food', food: { restore: 5 } });
item('raw_mutton', 'Raw Mutton', { kind: 'food', food: { restore: 2 } });
item('cooked_mutton', 'Cooked Mutton', { kind: 'food', food: { restore: 6 } });
item('spider_eye', 'Spider Eye', { kind: 'food', food: { restore: 1 }, desc: 'Edible, but unpleasant.' });
item('raw_cod', 'Raw Cod', { kind: 'food', food: { restore: 1 } });
item('cooked_cod', 'Cooked Cod', { kind: 'food', food: { restore: 4 } });
item('raw_salmon', 'Raw Salmon', { kind: 'food', food: { restore: 1 } });
item('cooked_salmon', 'Cooked Salmon', { kind: 'food', food: { restore: 5 } });
item('egg', 'Egg', { maxStack: 16, desc: 'Throw it, or cook with it.' });

export const itemByKey = (key) => ITEMS.get(key) || null;

// ── Enchanting ────────────────────────────────────────────────────
export const ENCHANT_NAMES = {
  efficiency: 'Efficiency', sharpness: 'Sharpness', power: 'Power',
  protection: 'Protection', unbreaking: 'Unbreaking',
  fortune: 'Fortune', silk_touch: 'Silk Touch', fire_aspect: 'Fire Aspect',
  knockback: 'Knockback', flame: 'Flame', infinity: 'Infinity', feather_falling: 'Feather Falling',
};
// Which enchants may land on a given item.
export function enchantsFor(def) {
  if (!def) return [];
  if (def.kind === 'armor') return ['protection', 'unbreaking', 'feather_falling'];
  if (def.tool) {
    const t = def.tool.type;
    if (t === 'blade') return ['sharpness', 'unbreaking', 'fire_aspect', 'knockback'];
    if (t === 'bow') return ['power', 'unbreaking', 'flame', 'infinity'];
    if (t === 'pick' || t === 'shovel') return ['efficiency', 'unbreaking', 'fortune', 'silk_touch'];
    if (t === 'axe' || t === 'hoe') return ['efficiency', 'unbreaking', 'fortune'];
  }
  return [];
}

// ── Save migration ────────────────────────────────────────────────
// Older saves stored item keys from before the great renaming (block ids
// and dimension keys never changed, so item keys are the only legacy
// surface). Map every renamed key old → new; apply migrateItemKey()
// wherever saved item keys are read (player inventory + containers).
export const LEGACY_ITEM_KEYS = {
  // blocks
  soil: 'dirt',
  grass: 'grass_block',
  alder_log: 'oak_log',
  alder_leaves: 'oak_leaves',
  alder_sprout: 'oak_sapling',
  fern_log: 'spruce_log',
  fern_leaves: 'spruce_leaves',
  fern_sprout: 'spruce_sapling',
  planks: 'oak_planks',
  brick: 'bricks',
  glowmoss: 'glow_lichen',
  sunstone_ore: 'diamond_ore',
  sunstone_block: 'diamond_block',
  worktable: 'crafting_table',
  kiln: 'furnace',
  tallgrass: 'short_grass',
  emberbloom: 'poppy',
  azurebell: 'cornflower',
  deadbush: 'dead_bush',
  spineplant: 'cactus',
  berrybush: 'sweet_berry_bush',
  duststone: 'sandstone',
  hewnstone: 'stone_bricks',
  mossrock: 'mossy_cobblestone',
  basalt: 'obsidian',
  vine: 'vines',
  rubble: 'cobblestone',
  wisp_torch: 'torch',
  rungs: 'ladder',
  bedroll: 'bed',
  stowbox: 'chest',
  scorchstone: 'netherrack',
  emberash: 'soul_sand',
  glowvein_ore: 'glowstone',
  charfungus: 'nether_wart_block',
  scorchbrick: 'nether_bricks',
  voidstone: 'end_stone',
  hollowmoss: 'end_moss',
  voidglass: 'end_glass',
  dawn_beacon: 'beacon',
  plank_ledge: 'oak_slab',
  rubble_ledge: 'cobblestone_slab',
  scorchbrick_ledge: 'nether_brick_slab',
  plank_step: 'oak_stairs',
  rubble_step: 'cobblestone_stairs',
  scorchbrick_step: 'nether_brick_stairs',
  timber_paling: 'oak_fence',
  timber_gate: 'oak_fence_gate',
  rubble_rampart: 'cobblestone_wall',
  hewnstone_rampart: 'stone_brick_wall',
  timber_door: 'oak_door',
  ironbound_door: 'iron_door',
  timber_flap: 'oak_trapdoor',
  ironbound_flap: 'iron_trapdoor',
  voidglass_pane: 'end_glass_pane',
  // tools
  pick_timber: 'wooden_pickaxe',
  axe_timber: 'wooden_axe',
  shovel_timber: 'wooden_shovel',
  hoe_timber: 'wooden_hoe',
  blade_timber: 'wooden_sword',
  pick_stone: 'stone_pickaxe',
  axe_stone: 'stone_axe',
  shovel_stone: 'stone_shovel',
  hoe_stone: 'stone_hoe',
  blade_stone: 'stone_sword',
  pick_copper: 'copper_pickaxe',
  axe_copper: 'copper_axe',
  shovel_copper: 'copper_shovel',
  hoe_copper: 'copper_hoe',
  blade_copper: 'copper_sword',
  pick_iron: 'iron_pickaxe',
  axe_iron: 'iron_axe',
  shovel_iron: 'iron_shovel',
  hoe_iron: 'iron_hoe',
  blade_iron: 'iron_sword',
  pick_sunsteel: 'netherite_pickaxe',
  axe_sunsteel: 'netherite_axe',
  shovel_sunsteel: 'netherite_shovel',
  hoe_sunsteel: 'netherite_hoe',
  blade_sunsteel: 'netherite_sword',
  // materials
  rod: 'stick',
  clay_lump: 'clay_ball',
  copper_ore_chunk: 'raw_copper',
  iron_ore_chunk: 'raw_iron',
  sunstone: 'diamond',
  hide: 'leather',
  glimmer_dust: 'glowstone_dust',
  tuber_seed: 'seeds',
  smolder_shard: 'netherite_scrap',
  sunsteel_ingot: 'netherite_ingot',
  sovereign_core: 'dragon_core',
  kindle_flint: 'flint_and_steel',
  clay_vessel: 'bucket',
  vessel_water: 'water_bucket',
  vessel_lava: 'lava_bucket',
  // food
  berries: 'sweet_berries',
  tuber: 'potato',
  tuber_roast: 'baked_potato',
  meat_raw: 'raw_porkchop',
  meat_roast: 'cooked_porkchop',
};

// Map a (possibly legacy) saved item key to its current key.
export const migrateItemKey = (key) => LEGACY_ITEM_KEYS[key] ?? key;

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
    else if (it.kind === 'tool' || it.kind === 'armor') tools.push(it.key);
    else if (it.kind === 'food') food.push(it.key);
    else mats.push(it.key);
  }
  return { blocks, tools, mats, food };
}
