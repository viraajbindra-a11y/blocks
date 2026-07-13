// BLOCKS block registry — every block type and its physical / visual /
// gameplay properties. Data-driven: other systems read from here.
//
// Texture keys reference layers in the procedural atlas (render/atlas.js).
// Tool tiers: 0 hand · 1 wooden · 2 stone · 3 copper · 4 iron.

import { MAX_BLOCKS } from './core/constants.js';

export const B = {
  AIR: 0,          BEDROCK: 1,      STONE: 2,        DIRT: 3,
  GRASS_BLOCK: 4,  SAND: 5,         GRAVEL: 6,       CLAY: 7,
  SNOW: 8,         ICE: 9,          OAK_LOG: 10,     OAK_LEAVES: 11,
  SPRUCE_LOG: 12,  SPRUCE_LEAVES: 13, OAK_PLANKS: 14, WATER: 15,
  // 16..21 = flowing water, levels 6..1
  LAVA: 22,
  // 23..25 = flowing lava, levels 5/3/1
  GLASS: 26,       BRICKS: 27,      COPPER_BLOCK: 28, IRON_BLOCK: 29,
  GLOW_LICHEN: 30, LANTERN: 31,     COAL_ORE: 32,    COPPER_ORE: 33,
  IRON_ORE: 34,    DIAMOND_ORE: 35, CRAFTING_TABLE: 36, FURNACE: 37,
  SHORT_GRASS: 38, POPPY: 39,       CORNFLOWER: 40,  DEAD_BUSH: 41,
  CACTUS: 42,      SWEET_BERRY_BUSH: 43, SWEET_BERRY_BUSH_RIPE: 44, FARMLAND: 45,
  CROP_0: 46,      CROP_1: 47,      CROP_2: 48,      CROP_3: 49,
  SANDSTONE: 50,   DIAMOND_BLOCK: 51, STONE_BRICKS: 52, MOSSY_COBBLESTONE: 53,
  OBSIDIAN: 54,    VINES: 55,       MUD: 56,         COBBLESTONE: 57,
  OAK_SAPLING: 58, SPRUCE_SAPLING: 59,
  // ── Wave 2: utility + dimensions ──
  TORCH: 60,       LADDER: 61,      BED: 62,         CHEST: 63,
  NETHERRACK: 64,  SOUL_SAND: 65,   GLOWSTONE: 66,   NETHER_WART_BLOCK: 67,
  NETHER_BRICKS: 68, NETHER_PORTAL: 69, END_STONE: 70, END_MOSS: 71,
  END_GLASS: 72,   END_PORTAL: 73,  BEACON: 74,
  // ── Shaped blocks ─────────────────────────────────────────────────
  // Each slab uses 2 ids: bottom, top. Each stair uses 8 ids: 2 halves
  // × 4 facings. State is baked into the id so chunk storage stays a
  // flat Uint8Array. Laid out contiguously per material so the shape
  // helpers can address states by offset.
  OAK_SLAB: 75,             // 75 bottom, 76 top
  COBBLESTONE_SLAB: 77,     // 77 bottom, 78 top
  NETHER_BRICK_SLAB: 79,    // 79 bottom, 80 top
  OAK_STAIRS: 81,           // 81..88  (half<<2 | facing)
  COBBLESTONE_STAIRS: 89,   // 89..96
  NETHER_BRICK_STAIRS: 97,  // 97..104
  // ── Auto-connecting shapes ────────────────────────────────────────
  // Fences & walls are a single id each: their arm geometry is computed
  // at mesh/collision time from the 4 horizontal neighbors, not baked
  // into the id. The gate bakes 2 bits of state: axis (which line it
  // sits in) and open/closed.
  OAK_FENCE: 105,           // 105
  OAK_FENCE_GATE: 106,      // 106..109  (axis<<1 | open)
  COBBLESTONE_WALL: 110,    // 110
  STONE_BRICK_WALL: 111,    // 111
  // ── Rotational & thin openables ───────────────────────────────────
  // Doors are two cells tall; each material bakes 32 states into
  // contiguous ids: (half<<4 | hinge<<3 | open<<2 | facing). facing 0..3
  // = +z,-z,+x,-x is the direction the closed leaf faces; hinge 0/1 =
  // left/right post; open toggles the ^4 bit; half 0/1 = lower/upper.
  // Trapdoors bake 16 states: (attach<<3 | open<<2 | facing),
  // attach 0/1 = bottom/top of the cell, facing = the hinged edge.
  OAK_DOOR: 112,            // 112..143
  IRON_DOOR: 144,           // 144..175
  OAK_TRAPDOOR: 176,        // 176..191
  IRON_TRAPDOOR: 192,       // 192..207
  // Panes: one id each, arm geometry from neighbors like fences but thin
  // and non-tall (glass cross-section). Translucent, non-opaque.
  GLASS_PANE: 208,          // 208
  END_GLASS_PANE: 209,      // 209
  // ── Base content past the shaped families (mods start after this) ──
  TNT: 210,                 // 210
  ENCHANTING_TABLE: 211,    // 211
  // 16 colored wools occupy 212..227 (see WOOL_ORDER below)
  WOOL_WHITE: 212,
  WOOL_BLACK: 227,
  // Decorative building variants
  SMOOTH_STONE: 228,        CHISELED_STONE_BRICKS: 229, CRACKED_STONE_BRICKS: 230,
  MOSSY_STONE_BRICKS: 231,  SMOOTH_SANDSTONE: 232,      CUT_SANDSTONE: 233,
  CHISELED_SANDSTONE: 234,
  WHEAT_0: 235, WHEAT_1: 236, WHEAT_2: 237, WHEAT_3: 238,
  CARROT_0: 239, CARROT_1: 240, CARROT_2: 241, CARROT_3: 242,
  ANVIL: 243,
};

// ── Legacy internal aliases ───────────────────────────────────────
// The block set was renamed to familiar names, but a lot of worldgen /
// entity / interaction / fluid code still refers to blocks by their
// original internal names. These aliases point the old names at the
// SAME numeric ids (so saved chunks are unaffected — ids never moved).
// Not user-visible: display names live in the def() registrations below.
Object.assign(B, {
  GRASS: B.GRASS_BLOCK,        SOIL: B.DIRT,
  STOWBOX: B.CHEST,            PLANKS: B.OAK_PLANKS,
  RUBBLE: B.COBBLESTONE,       CORESTONE: B.BEDROCK,
  BERRYBUSH: B.SWEET_BERRY_BUSH, BERRYBUSH_RIPE: B.SWEET_BERRY_BUSH_RIPE,
  ALDER_LOG: B.OAK_LOG,        ALDER_LEAVES: B.OAK_LEAVES,
  ALDER_SPROUT: B.OAK_SAPLING, FERN_LOG: B.SPRUCE_LOG,
  FERN_LEAVES: B.SPRUCE_LEAVES, VINE: B.VINES,
  SPINEPLANT: B.CACTUS,        TALLGRASS: B.SHORT_GRASS,
  EMBERBLOOM: B.POPPY,         AZUREBELL: B.CORNFLOWER,
  DEADBUSH: B.DEAD_BUSH,       DUSTSTONE: B.SANDSTONE,
  MOSSROCK: B.MOSSY_COBBLESTONE, GLOWMOSS: B.GLOW_LICHEN,
  // Smolder (Nether-analog) blocks
  SCORCHSTONE: B.NETHERRACK,   EMBERASH: B.SOUL_SAND,
  CHARFUNGUS: B.NETHER_WART_BLOCK, GLOWVEIN_ORE: B.GLOWSTONE,
  SCORCHBRICK: B.NETHER_BRICKS, BASALT: B.OBSIDIAN,
  // Hollow (End-analog) blocks
  VOIDSTONE: B.END_STONE,      HOLLOWMOSS: B.END_MOSS,
  VOIDGLASS: B.END_GLASS,      SUNSTONE_BLOCK: B.DIAMOND_BLOCK,
  SUNSTONE_ORE: B.DIAMOND_ORE,
});

// 16 dye colors → colored wool block ids 212..227, in Minecraft order.
export const WOOL_ORDER = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime',
  'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
WOOL_ORDER.forEach((c, i) => { B['WOOL_' + c.toUpperCase()] = 212 + i; });

// 16-colour building families (each in WOOL_ORDER order).
export const CONCRETE_BASE = 244, TERRACOTTA_BASE = 260, GLAZED_BASE = 276;
WOOL_ORDER.forEach((c, i) => {
  const U = c.toUpperCase();
  B[U + '_CONCRETE'] = CONCRETE_BASE + i;
  B[U + '_TERRACOTTA'] = TERRACOTTA_BASE + i;
  B[U + '_GLAZED_TERRACOTTA'] = GLAZED_BASE + i;
});

// Cucurbits, sugar cane, cake (292..311)
Object.assign(B, {
  PUMPKIN: 292, CARVED_PUMPKIN: 293, JACK_O_LANTERN: 294, MELON: 295,
  PUMPKIN_STEM_0: 296, PUMPKIN_STEM_3: 299,
  MELON_STEM_0: 300, MELON_STEM_3: 303,
  SUGAR_CANE: 304,
  CAKE_0: 305, CAKE_6: 311,
  GRINDSTONE: 312, STONECUTTER: 313,
  EMERALD_ORE: 314, EMERALD_BLOCK: 315,
  // Redstone / automation (316..328)
  REDSTONE_BLOCK: 316, REDSTONE_WIRE: 317,
  REDSTONE_TORCH: 318, REDSTONE_TORCH_OFF: 319,
  LEVER: 320, LEVER_ON: 321,
  STONE_BUTTON: 322, STONE_BUTTON_ON: 323,
  REDSTONE_LAMP: 324, REDSTONE_LAMP_ON: 325,
  DISPENSER: 326, HOPPER: 327, REDSTONE_ORE: 328,
  RAIL: 329, POWERED_RAIL: 330, DETECTOR_RAIL: 331,
});

// ── Fluid helpers ─────────────────────────────────────────────────
export const isWater = id => id >= 15 && id <= 21;
export const isLava  = id => id >= 22 && id <= 25;
export const isFluid = id => id >= 15 && id <= 25;
export const waterFlowId = level => 22 - level;              // 6..1 → 16..21
export const lavaFlowId  = level => level >= 5 ? 23 : level >= 3 ? 24 : 25;
export function fluidLevel(id) {
  if (id === B.WATER || id === B.LAVA) return 7;
  if (isWater(id)) return 22 - id;
  if (id === 23) return 5;
  if (id === 24) return 3;
  if (id === 25) return 1;
  return 0;
}

// Ids 0-209 are reserved for the base game (0-74 terrain/utility, 75-104
// shaped-block state families, 105-111 auto-connecting shapes, 112-209
// door/trapdoor/pane families); 210+ are assigned to mods in
// registration order (block storage is Uint16Array — see MAX_BLOCKS).
export const BLOCKS = new Array(MAX_BLOCKS).fill(null);

const DEFAULTS = {
  name: '', key: '',
  solid: true,        // player/entity collision
  opaque: true,       // occludes neighbor faces & blocks light fully
  cross: false,       // rendered as crossed quads (plants)
  hardness: 1,        // seconds to break bare-handed with correct tool logic
  tool: null,         // 'pick' | 'axe' | 'shovel' | 'hoe' | null
  minTier: 0,         // tier needed for drops
  drops: 'self',      // 'self' | [] | [{item, min, max, chance}]
  light: 0,           // emitted block light 0..15
  sound: 'stone',     // footstep/dig sound family
  sway: false,        // vegetation wind sway in shader
  translucent: false, // rendered in the transparent pass
  climbable: false,
  replaceable: false, // placing a block into this cell replaces it
  placeOn: null,      // array of block ids the block must sit on
  use: null,          // right-click: 'worktable'|'kiln'|'berries'|'sleep'|'stowbox' (internal ids)
  randomTick: null,   // 'grass' | 'crop' | 'berry' | 'sprout'
  needsFloor: false,  // must sit on a solid block
  needsWall: false,   // must touch a solid block horizontally
  tex: null,          // {all} | {top, bottom, side} | {top, bottom, px,nx,pz,nz}
  viscosity: 0,       // movement drag for fluids
  // ── Shape system (non-cube blocks) ──────────────────────────────
  // shape !== 'cube' means the block occupies a subset of its voxel and
  // is meshed + collided via explicit AABBs instead of the greedy cube
  // path. Orientation/half state is baked into distinct block ids (see
  // the shape families below), so chunk storage stays a plain id array.
  shape: 'cube',      // 'cube'|'slab'|'stair'|'fence'|'gate'|'wall'|'door'|'flap'|'pane'
  half: null,         // slabs/stairs: 'bottom' | 'top'
  facing: null,       // stairs/doors: 0..3 = +z,-z,+x,-x
  axis: null,         // gate: 0 = line runs along x, 1 = along z
  open: false,        // gate/door/flap: true passes entities, false blocks them
  hinge: 0,           // door: 0 = hinge on left post, 1 = right post
  doorHalf: null,     // door: 'lower' | 'upper' (which of the 2 tall cells)
  attach: 0,          // flap: 0 = attached to cell bottom, 1 = to top
  signalGated: false, // door/flap: opens only via a Sparkwire power signal
  connects: false,    // true if neighbors auto-connect arms toward this
  tall: false,        // collision rises 1.5 cells (fences/walls block jumps)
  item: null,         // inventory item key all states share (null → key)
};

function def(id, key, name, props = {}) {
  const b = Object.assign({}, DEFAULTS, props, { id, key, name });
  if (!b.tex) b.tex = { all: key };
  BLOCKS[id] = b;
  return b;
}

// ── Terrain ───────────────────────────────────────────────────────
def(B.AIR, 'air', 'Air', { solid: false, opaque: false, drops: [], hardness: 0 });
def(B.BEDROCK, 'bedrock', 'Bedrock', { hardness: -1, drops: [], sound: 'stone' });
def(B.STONE, 'stone', 'Stone', {
  hardness: 6, tool: 'pick', minTier: 1, sound: 'stone',
  drops: [{ item: 'cobblestone', min: 1, max: 1 }],
});
def(B.DIRT, 'dirt', 'Dirt', { hardness: 0.6, tool: 'shovel', sound: 'soft' });
def(B.GRASS_BLOCK, 'grass_block', 'Grass Block', {
  hardness: 0.7, tool: 'shovel', sound: 'soft', randomTick: 'grass',
  tex: { top: 'grass_block_top', bottom: 'dirt', side: 'grass_block_side' },
  drops: [{ item: 'dirt', min: 1, max: 1 }],
});
def(B.SAND, 'sand', 'Sand', { hardness: 0.6, tool: 'shovel', sound: 'sand' });
def(B.GRAVEL, 'gravel', 'Gravel', {
  hardness: 0.7, tool: 'shovel', sound: 'sand',
  drops: [{ item: 'gravel', min: 1, max: 1 }, { item: 'flint', min: 1, max: 1, chance: 0.14 }],
});
def(B.CLAY, 'clay', 'Clay', {
  hardness: 0.7, tool: 'shovel', sound: 'soft',
  drops: [{ item: 'clay_ball', min: 3, max: 4 }],
});
def(B.SNOW, 'snow', 'Snow', { hardness: 0.5, tool: 'shovel', sound: 'snow' });
def(B.ICE, 'ice', 'Ice', {
  hardness: 0.8, tool: 'pick', sound: 'glass', translucent: true, opaque: false, drops: [],
});
def(B.MUD, 'mud', 'Mud', { hardness: 0.7, tool: 'shovel', sound: 'soft' });
def(B.SANDSTONE, 'sandstone', 'Sandstone', {
  hardness: 4, tool: 'pick', minTier: 1, sound: 'stone',
  tex: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone' },
});
// Quenched lava; also the Nether-portal frame material.
def(B.OBSIDIAN, 'obsidian', 'Obsidian', { hardness: 8, tool: 'pick', minTier: 2, sound: 'stone' });
def(B.COBBLESTONE, 'cobblestone', 'Cobblestone', { hardness: 5.5, tool: 'pick', minTier: 1, sound: 'stone' });
def(B.MOSSY_COBBLESTONE, 'mossy_cobblestone', 'Mossy Cobblestone', {
  hardness: 5.5, tool: 'pick', minTier: 1, sound: 'stone',
  drops: [{ item: 'cobblestone', min: 1, max: 1 }],
});

// ── Wood & foliage ───────────────────────────────────────────────
def(B.OAK_LOG, 'oak_log', 'Oak Log', {
  hardness: 2.4, tool: 'axe', sound: 'wood',
  tex: { top: 'oak_log_end', bottom: 'oak_log_end', side: 'oak_log' },
});
def(B.OAK_LEAVES, 'oak_leaves', 'Oak Leaves', {
  hardness: 0.3, sound: 'plant', opaque: false, sway: true,
  drops: [{ item: 'oak_sapling', min: 1, max: 1, chance: 0.08 },
          { item: 'stick', min: 1, max: 2, chance: 0.12 }],
});
def(B.SPRUCE_LOG, 'spruce_log', 'Spruce Log', {
  hardness: 2.4, tool: 'axe', sound: 'wood',
  tex: { top: 'spruce_log_end', bottom: 'spruce_log_end', side: 'spruce_log' },
});
def(B.SPRUCE_LEAVES, 'spruce_leaves', 'Spruce Leaves', {
  hardness: 0.3, sound: 'plant', opaque: false, sway: true,
  drops: [{ item: 'spruce_sapling', min: 1, max: 1, chance: 0.08 },
          { item: 'stick', min: 1, max: 2, chance: 0.12 }],
});
def(B.OAK_PLANKS, 'oak_planks', 'Oak Planks', { hardness: 2.2, tool: 'axe', sound: 'wood' });

// ── Fluids ────────────────────────────────────────────────────────
const waterProps = lvl => ({
  solid: false, opaque: false, translucent: true, replaceable: true,
  hardness: -1, drops: [], sound: 'liquid', viscosity: 0.5,
  tex: { all: 'water' },
});
def(B.WATER, 'water', 'Water', waterProps(7));
for (let lvl = 6; lvl >= 1; lvl--) {
  def(waterFlowId(lvl), `water_f${lvl}`, 'Water', waterProps(lvl));
}
const lavaProps = () => ({
  solid: false, opaque: false, replaceable: true,
  hardness: -1, drops: [], light: 15, sound: 'liquid', viscosity: 0.82,
  tex: { all: 'lava' },
});
def(B.LAVA, 'lava', 'Lava', lavaProps());
def(23, 'lava_f5', 'Lava', lavaProps());
def(24, 'lava_f3', 'Lava', lavaProps());
def(25, 'lava_f1', 'Lava', lavaProps());

// ── Building & crafted ───────────────────────────────────────────
def(B.GLASS, 'glass', 'Glass', {
  hardness: 0.4, sound: 'glass', opaque: false, translucent: true, drops: [],
});
def(B.BRICKS, 'bricks', 'Bricks', { hardness: 5, tool: 'pick', minTier: 1, sound: 'stone' });
def(B.STONE_BRICKS, 'stone_bricks', 'Stone Bricks', { hardness: 5.5, tool: 'pick', minTier: 1, sound: 'stone' });
def(B.COPPER_BLOCK, 'copper_block', 'Block of Copper', {
  hardness: 7, tool: 'pick', minTier: 2, sound: 'metal',
});
def(B.IRON_BLOCK, 'iron_block', 'Block of Iron', {
  hardness: 9, tool: 'pick', minTier: 3, sound: 'metal',
});
// Still the End-portal frame material — mechanics unchanged.
def(B.DIAMOND_BLOCK, 'diamond_block', 'Block of Diamond', {
  hardness: 7, tool: 'pick', minTier: 3, sound: 'metal', light: 14,
});
def(B.GLOW_LICHEN, 'glow_lichen', 'Glow Lichen', {
  hardness: 0.4, sound: 'plant', light: 13, opaque: true,
});
def(B.LANTERN, 'lantern', 'Lantern', {
  hardness: 0.8, sound: 'metal', light: 15, opaque: false, solid: true,
});
def(B.CRAFTING_TABLE, 'crafting_table', 'Crafting Table', {
  hardness: 2.4, tool: 'axe', sound: 'wood', use: 'worktable',
  tex: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side' },
});
def(B.FURNACE, 'furnace', 'Furnace', {
  hardness: 5, tool: 'pick', minTier: 1, sound: 'stone', use: 'kiln',
  tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', pz: 'furnace_front' },
});

// ── Ores ──────────────────────────────────────────────────────────
def(B.COAL_ORE, 'coal_ore', 'Coal Ore', {
  hardness: 6, tool: 'pick', minTier: 1, sound: 'stone',
  drops: [{ item: 'coal', min: 1, max: 2 }],
});
def(B.COPPER_ORE, 'copper_ore', 'Copper Ore', {
  hardness: 6.5, tool: 'pick', minTier: 2, sound: 'stone',
  drops: [{ item: 'raw_copper', min: 1, max: 1 }],
});
def(B.IRON_ORE, 'iron_ore', 'Iron Ore', {
  hardness: 7, tool: 'pick', minTier: 3, sound: 'stone',
  drops: [{ item: 'raw_iron', min: 1, max: 1 }],
});
def(B.DIAMOND_ORE, 'diamond_ore', 'Diamond Ore', {
  hardness: 8, tool: 'pick', minTier: 4, sound: 'stone', light: 7,
  drops: [{ item: 'diamond', min: 1, max: 2 }],
});

// ── Plants & farming ─────────────────────────────────────────────
const plant = (extra = {}) => Object.assign({
  solid: false, opaque: false, cross: true, hardness: 0.05,
  sound: 'plant', sway: true, placeOn: [B.GRASS_BLOCK, B.DIRT, B.MUD],
}, extra);
def(B.SHORT_GRASS, 'short_grass', 'Grass', plant({
  replaceable: true,
  drops: [{ item: 'seeds', min: 1, max: 1, chance: 0.12 },
          { item: 'wheat_seeds', min: 1, max: 1, chance: 0.12 }],
}));
def(B.POPPY, 'poppy', 'Poppy', plant());
def(B.CORNFLOWER, 'cornflower', 'Cornflower', plant());
def(B.DEAD_BUSH, 'dead_bush', 'Dead Bush', plant({
  placeOn: [B.SAND, B.DIRT, B.SANDSTONE],
  drops: [{ item: 'stick', min: 1, max: 2 }],
}));
def(B.CACTUS, 'cactus', 'Cactus', {
  hardness: 0.5, sound: 'plant', opaque: false, solid: true,
  placeOn: [B.SAND, B.CACTUS],
  tex: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus' },
});
def(B.SWEET_BERRY_BUSH, 'sweet_berry_bush', 'Sweet Berry Bush', plant({
  hardness: 0.4, randomTick: 'berry', placeOn: [B.GRASS_BLOCK, B.DIRT],
  drops: [{ item: 'stick', min: 1, max: 1 }],
}));
def(B.SWEET_BERRY_BUSH_RIPE, 'sweet_berry_bush_ripe', 'Sweet Berry Bush (ripe)', plant({
  hardness: 0.4, use: 'berries', placeOn: [B.GRASS_BLOCK, B.DIRT],
  drops: [{ item: 'sweet_berries', min: 1, max: 2 }, { item: 'stick', min: 1, max: 1 }],
}));
def(B.FARMLAND, 'farmland', 'Farmland', {
  hardness: 0.6, tool: 'shovel', sound: 'soft',
  drops: [{ item: 'dirt', min: 1, max: 1 }],
  tex: { top: 'farmland', bottom: 'dirt', side: 'dirt' },
});
for (let s = 0; s < 4; s++) {
  def(B.CROP_0 + s, `crop_${s}`, 'Potatoes', plant({
    placeOn: [B.FARMLAND], randomTick: s < 3 ? 'crop' : null, replaceable: false,
    drops: s === 3
      ? [{ item: 'potato', min: 1, max: 3 }, { item: 'seeds', min: 1, max: 2 }]
      : [{ item: 'seeds', min: 1, max: 1 }],
  }));
  def(B.WHEAT_0 + s, `wheat_${s}`, 'Wheat', plant({
    placeOn: [B.FARMLAND], randomTick: s < 3 ? 'crop' : null, replaceable: false,
    drops: s === 3
      ? [{ item: 'wheat', min: 1, max: 1 }, { item: 'wheat_seeds', min: 1, max: 2 }]
      : [{ item: 'wheat_seeds', min: 1, max: 1 }],
  }));
  def(B.CARROT_0 + s, `carrot_${s}`, 'Carrots', plant({
    placeOn: [B.FARMLAND], randomTick: s < 3 ? 'crop' : null, replaceable: false,
    drops: s === 3 ? [{ item: 'carrot', min: 2, max: 4 }] : [{ item: 'carrot', min: 1, max: 1 }],
  }));
}
def(B.VINES, 'vines', 'Vines', plant({
  climbable: true, placeOn: null, replaceable: true, drops: [],
}));
def(B.OAK_SAPLING, 'oak_sapling', 'Oak Sapling', plant({
  randomTick: 'sprout', placeOn: [B.GRASS_BLOCK, B.DIRT],
}));
def(B.SPRUCE_SAPLING, 'spruce_sapling', 'Spruce Sapling', plant({
  randomTick: 'sprout', placeOn: [B.GRASS_BLOCK, B.DIRT, B.SNOW],
}));

// ── Utility (wave 2) ─────────────────────────────────────────────
def(B.TORCH, 'torch', 'Torch', {
  solid: false, opaque: false, cross: true, hardness: 0.05,
  sound: 'wood', light: 13, needsFloor: true, drops: 'self',
});
def(B.LADDER, 'ladder', 'Ladder', {
  solid: false, opaque: false, cross: true, hardness: 0.4,
  sound: 'wood', climbable: true, needsWall: true, sway: false,
});
def(B.BED, 'bed', 'Bed', {
  hardness: 0.4, sound: 'soft', use: 'sleep', opaque: false, solid: true,
  tex: { top: 'bed_top', bottom: 'oak_planks', side: 'bed_side' },
});
def(B.CHEST, 'chest', 'Chest', {
  hardness: 2.4, tool: 'axe', sound: 'wood', use: 'stowbox',
  tex: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', pz: 'chest_front' },
});
def(B.BEACON, 'beacon', 'Beacon', {
  hardness: 6, tool: 'pick', minTier: 3, sound: 'metal', light: 15,
});
def(B.TNT, 'tnt', 'TNT', {
  hardness: 0, sound: 'grass',
  tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' },
});
def(B.ENCHANTING_TABLE, 'enchanting_table', 'Enchanting Table', {
  hardness: 5, tool: 'pick', minTier: 1, sound: 'stone', use: 'enchant', light: 7,
  tex: { top: 'enchanting_table_top', bottom: 'obsidian', side: 'enchanting_table_side' },
});
// Colored wool (212..227)
const titleCase = (s) => s.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
WOOL_ORDER.forEach((c, i) => def(212 + i, `${c}_wool`, `${titleCase(c)} Wool`, {
  hardness: 0.8, sound: 'soft', tex: { all: `${c}_wool` },
}));
// Concrete / terracotta / glazed terracotta (244..291)
WOOL_ORDER.forEach((c, i) => {
  const T = titleCase(c);
  def(CONCRETE_BASE + i, `${c}_concrete`, `${T} Concrete`, {
    hardness: 1.8, tool: 'pick', sound: 'stone', tex: { all: `${c}_concrete` } });
  def(TERRACOTTA_BASE + i, `${c}_terracotta`, `${T} Terracotta`, {
    hardness: 1.25, tool: 'pick', minTier: 1, sound: 'stone', tex: { all: `${c}_terracotta` } });
  def(GLAZED_BASE + i, `${c}_glazed_terracotta`, `${T} Glazed Terracotta`, {
    hardness: 1.4, tool: 'pick', minTier: 1, sound: 'stone', tex: { all: `${c}_glazed_terracotta` } });
});

// Pumpkins & melons (292..295)
def(B.PUMPKIN, 'pumpkin', 'Pumpkin', {
  hardness: 1, tool: 'axe', sound: 'wood', use: 'carve',
  tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side' } });
def(B.CARVED_PUMPKIN, 'carved_pumpkin', 'Carved Pumpkin', {
  hardness: 1, tool: 'axe', sound: 'wood',
  tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'carved_pumpkin_face' } });
def(B.JACK_O_LANTERN, 'jack_o_lantern', "Jack o'Lantern", {
  hardness: 1, tool: 'axe', sound: 'wood', light: 15,
  tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'jack_o_lantern_face' } });
def(B.MELON, 'melon', 'Melon', {
  hardness: 1, tool: 'axe', sound: 'wood', drops: [{ item: 'melon_slice', min: 3, max: 7 }],
  tex: { top: 'melon_top', bottom: 'melon_top', side: 'melon_side' } });

// Pumpkin/melon stems (296..303) — crop stages 0..2 grow via 'crop';
// the mature stage (3) spawns its fruit on an adjacent ground cell.
const STEM = { solid: false, opaque: false, cross: true, sway: true, hardness: 0,
  sound: 'plant', needsFloor: true, drops: [], tex: { all: 'crop_stem' } };
for (let i = 0; i < 4; i++) {
  def(296 + i, `pumpkin_stem_${i}`, 'Pumpkin Stem',
    { ...STEM, randomTick: i < 3 ? 'crop' : 'stem', fruit: B.PUMPKIN });
  def(300 + i, `melon_stem_${i}`, 'Melon Stem',
    { ...STEM, randomTick: i < 3 ? 'crop' : 'stem', fruit: B.MELON });
}

// Sugar cane (304) — grows up to 3 tall on sand/dirt beside water.
def(B.SUGAR_CANE, 'sugar_cane', 'Sugar Cane', {
  solid: false, opaque: false, cross: true, sway: true, hardness: 0, sound: 'plant',
  needsFloor: true, randomTick: 'cane', tex: { all: 'sugar_cane' },
  placeOn: [B.SAND, B.DIRT, B.GRASS_BLOCK, B.SUGAR_CANE, B.FARMLAND] });

// Cake (305..311) — 7 bite states; right-click eats a slice.
for (let i = 0; i < 7; i++) {
  def(305 + i, `cake_${i}`, 'Cake', {
    solid: true, opaque: false, hardness: 0.5, sound: 'soft', use: 'cake',
    tex: { top: 'cake_top', bottom: 'cake_bottom', side: 'cake_side' } });
}

// Utility stations (312..313)
def(B.GRINDSTONE, 'grindstone', 'Grindstone', {
  hardness: 3, tool: 'pick', minTier: 1, sound: 'stone', use: 'grindstone', opaque: false,
  tex: { top: 'grindstone_top', bottom: 'stone', side: 'grindstone_side' } });
def(B.STONECUTTER, 'stonecutter', 'Stonecutter', {
  hardness: 3.5, tool: 'pick', minTier: 1, sound: 'stone', use: 'stonecutter', opaque: false,
  tex: { top: 'stonecutter_top', bottom: 'stone', side: 'stonecutter_side' } });

// Emerald ore + block (314..315)
def(B.EMERALD_ORE, 'emerald_ore', 'Emerald Ore', {
  hardness: 4.5, tool: 'pick', minTier: 3, sound: 'stone',
  drops: [{ item: 'emerald', min: 1, max: 1 }], tex: { all: 'emerald_ore' } });
def(B.EMERALD_BLOCK, 'emerald_block', 'Block of Emerald', {
  hardness: 5, tool: 'pick', minTier: 3, sound: 'metal', tex: { all: 'emerald_block' } });

// ── Redstone / automation (316..328) ──────────────────────────────
def(B.REDSTONE_BLOCK, 'redstone_block', 'Block of Redstone', {
  hardness: 5, tool: 'pick', sound: 'stone', tex: { all: 'redstone_block' } });
def(B.REDSTONE_ORE, 'redstone_ore', 'Redstone Ore', {
  hardness: 4.5, tool: 'pick', minTier: 2, sound: 'stone', light: 3,
  drops: [{ item: 'redstone', min: 4, max: 5 }], tex: { all: 'redstone_ore' } });
// Ground dust — a cross sprite; placed by the 'redstone' item.
def(B.REDSTONE_WIRE, 'redstone_wire', 'Redstone Dust', {
  solid: false, opaque: false, cross: true, hardness: 0, sound: 'stone',
  needsFloor: true, item: 'redstone', tex: { all: 'redstone_wire' } });
def(B.REDSTONE_TORCH, 'redstone_torch', 'Redstone Torch', {
  solid: false, opaque: false, cross: true, hardness: 0, sound: 'wood', light: 7,
  needsFloor: true, tex: { all: 'redstone_torch' } });
def(B.REDSTONE_TORCH_OFF, 'redstone_torch_off', 'Redstone Torch', {
  solid: false, opaque: false, cross: true, hardness: 0, sound: 'wood',
  needsFloor: true, tex: { all: 'redstone_torch_off' } });
def(B.LEVER, 'lever', 'Lever', {
  solid: false, opaque: false, cross: true, hardness: 0, sound: 'wood',
  needsFloor: true, use: 'lever', tex: { all: 'lever' } });
def(B.LEVER_ON, 'lever_on', 'Lever', {
  solid: false, opaque: false, cross: true, hardness: 0, sound: 'wood',
  needsFloor: true, use: 'lever', light: 0, tex: { all: 'lever_on' } });
def(B.STONE_BUTTON, 'stone_button', 'Stone Button', {
  solid: false, opaque: false, cross: true, hardness: 0, sound: 'stone',
  needsFloor: true, use: 'button', tex: { all: 'stone_button' } });
def(B.STONE_BUTTON_ON, 'stone_button_on', 'Stone Button', {
  solid: false, opaque: false, cross: true, hardness: 0, sound: 'stone',
  needsFloor: true, use: 'button', tex: { all: 'stone_button' } });
def(B.REDSTONE_LAMP, 'redstone_lamp', 'Redstone Lamp', {
  hardness: 0.6, sound: 'glass', tex: { all: 'redstone_lamp' } });
def(B.REDSTONE_LAMP_ON, 'redstone_lamp_on', 'Redstone Lamp', {
  hardness: 0.6, sound: 'glass', light: 15, tex: { all: 'redstone_lamp_on' } });
def(B.DISPENSER, 'dispenser', 'Dispenser', {
  hardness: 3.5, tool: 'pick', minTier: 1, sound: 'stone',
  tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'dispenser_front' } });
def(B.HOPPER, 'hopper', 'Hopper', {
  hardness: 3, tool: 'pick', minTier: 1, sound: 'metal', opaque: false,
  tex: { top: 'hopper_top', bottom: 'iron_block', side: 'hopper_side' } });

// Rails (329..331) — flat tracks a minecart rides along.
const RAIL_DEF = { solid: false, opaque: false, cross: true, hardness: 0.7, tool: 'pick',
  sound: 'metal', needsFloor: true };
def(B.RAIL, 'rail', 'Rail', { ...RAIL_DEF, tex: { all: 'rail' } });
def(B.POWERED_RAIL, 'powered_rail', 'Powered Rail', { ...RAIL_DEF, tex: { all: 'powered_rail' } });
def(B.DETECTOR_RAIL, 'detector_rail', 'Detector Rail', { ...RAIL_DEF, tex: { all: 'detector_rail' } });
// Decorative stone/sandstone building variants (228..234)
const STONE_LIKE = { hardness: 6, tool: 'pick', minTier: 1, sound: 'stone' };
def(B.SMOOTH_STONE, 'smooth_stone', 'Smooth Stone', { ...STONE_LIKE });
def(B.CHISELED_STONE_BRICKS, 'chiseled_stone_bricks', 'Chiseled Stone Bricks', { ...STONE_LIKE, hardness: 5.5 });
def(B.CRACKED_STONE_BRICKS, 'cracked_stone_bricks', 'Cracked Stone Bricks', { ...STONE_LIKE, hardness: 5.5 });
def(B.MOSSY_STONE_BRICKS, 'mossy_stone_bricks', 'Mossy Stone Bricks', { ...STONE_LIKE, hardness: 5.5 });
def(B.SMOOTH_SANDSTONE, 'smooth_sandstone', 'Smooth Sandstone', { ...STONE_LIKE, hardness: 4 });
def(B.CUT_SANDSTONE, 'cut_sandstone', 'Cut Sandstone', { ...STONE_LIKE, hardness: 4 });
def(B.CHISELED_SANDSTONE, 'chiseled_sandstone', 'Chiseled Sandstone', { ...STONE_LIKE, hardness: 4 });
def(B.ANVIL, 'anvil', 'Anvil', {
  hardness: 5, tool: 'pick', minTier: 1, sound: 'metal', use: 'anvil', opaque: false,
  tex: { top: 'anvil_top', bottom: 'iron_block', side: 'anvil_side' },
});

// ── The Nether ───────────────────────────────────────────────────
def(B.NETHERRACK, 'netherrack', 'Netherrack', {
  hardness: 2.2, tool: 'pick', minTier: 1, sound: 'stone',
});
def(B.SOUL_SAND, 'soul_sand', 'Soul Sand', {
  hardness: 0.6, tool: 'shovel', sound: 'sand',
});
def(B.GLOWSTONE, 'glowstone', 'Glowstone', {
  hardness: 4.5, tool: 'pick', minTier: 2, sound: 'stone', light: 9,
  drops: [{ item: 'netherite_scrap', min: 1, max: 2 }],
});
def(B.NETHER_WART_BLOCK, 'nether_wart_block', 'Nether Wart Block', {
  solid: false, opaque: false, cross: true, hardness: 0.05, sound: 'plant',
  light: 4, placeOn: [B.NETHERRACK, B.SOUL_SAND], drops: [{ item: 'nether_wart', min: 1, max: 2 }],
});
def(B.NETHER_BRICKS, 'nether_bricks', 'Nether Bricks', {
  hardness: 5, tool: 'pick', minTier: 1, sound: 'stone',
});
def(B.NETHER_PORTAL, 'nether_portal', 'Nether Portal', {
  solid: false, opaque: false, translucent: true, hardness: -1, drops: [],
  light: 11, sound: 'glass',
});

// ── The End ──────────────────────────────────────────────────────
def(B.END_STONE, 'end_stone', 'End Stone', {
  hardness: 5, tool: 'pick', minTier: 1, sound: 'stone',
});
def(B.END_MOSS, 'end_moss', 'End Moss', {
  hardness: 0.7, tool: 'shovel', sound: 'soft', light: 2,
  tex: { top: 'end_moss_top', bottom: 'end_stone', side: 'end_moss_side' },
  drops: [{ item: 'end_stone', min: 1, max: 1 }],
});
def(B.END_GLASS, 'end_glass', 'End Glass', {
  hardness: 0.5, sound: 'glass', opaque: false, translucent: true, drops: [],
  light: 11,
});
def(B.END_PORTAL, 'end_portal', 'End Portal', {
  solid: false, opaque: false, translucent: true, hardness: -1, drops: [],
  light: 9, sound: 'glass',
});

// ── Shaped blocks: slabs & stairs ─────────────────────────────────
// Each material registers a family of ids, one per orientation/half
// state. All states share one inventory item (the `item` prop) and the
// base material's textures. Shaped blocks are solid but NOT opaque, so
// light passes and caves behave; their per-face geometry & collision
// AABBs come from shapeBoxes() below.
//
// STAIR id layout, relative to the family base: (half<<2) | facing,
// facing 0..3 = +z,-z,+x,-x (the stair's tall back wall faces `facing`).
const STAIR_STATES = 8;

function slabFamily(base, key, name, tex, from) {
  const p = {
    hardness: from.hardness, tool: from.tool, minTier: from.minTier,
    sound: from.sound, opaque: false, tex, shape: 'slab', item: key,
    // Every state drops the shared item (their own keys aren't items).
    drops: [{ item: key, min: 1, max: 1 }],
  };
  def(base + 0, key, name, { ...p, half: 'bottom' });
  def(base + 1, `${key}_top`, name, { ...p, half: 'top' });
}

function stairFamily(base, key, name, tex, from) {
  const p = {
    hardness: from.hardness, tool: from.tool, minTier: from.minTier,
    sound: from.sound, opaque: false, tex, shape: 'stair', item: key,
    drops: [{ item: key, min: 1, max: 1 }],
  };
  for (let s = 0; s < STAIR_STATES; s++) {
    const half = (s >> 2) === 1 ? 'top' : 'bottom';
    const facing = s & 3;
    def(base + s, s === 0 ? key : `${key}_${s}`, name,
      { ...p, half, facing });
  }
}

// Slabs keep the base material's uniform texture on every cut face.
slabFamily(B.OAK_SLAB, 'oak_slab', 'Oak Slab',
  { all: 'oak_planks' }, BLOCKS[B.OAK_PLANKS]);
slabFamily(B.COBBLESTONE_SLAB, 'cobblestone_slab', 'Cobblestone Slab',
  { all: 'cobblestone' }, BLOCKS[B.COBBLESTONE]);
slabFamily(B.NETHER_BRICK_SLAB, 'nether_brick_slab', 'Nether Brick Slab',
  { all: 'nether_bricks' }, BLOCKS[B.NETHER_BRICKS]);
stairFamily(B.OAK_STAIRS, 'oak_stairs', 'Oak Stairs',
  { all: 'oak_planks' }, BLOCKS[B.OAK_PLANKS]);
stairFamily(B.COBBLESTONE_STAIRS, 'cobblestone_stairs', 'Cobblestone Stairs',
  { all: 'cobblestone' }, BLOCKS[B.COBBLESTONE]);
stairFamily(B.NETHER_BRICK_STAIRS, 'nether_brick_stairs', 'Nether Brick Stairs',
  { all: 'nether_bricks' }, BLOCKS[B.NETHER_BRICKS]);

// ── Auto-connecting shapes: fences & walls ────────────────────────
// One id per material; the central post always renders and connecting
// arms are added at mesh/collision time toward each neighbor that the
// block joins (see connectsTo()). These are `tall`: their collision
// rises 1.5 cells so entities can't hop over a line of them. They are
// solid but not opaque (light + faces pass between the bars).
function connectingBlock(id, key, name, shape, tex, from) {
  def(id, key, name, {
    hardness: from.hardness, tool: from.tool, minTier: from.minTier,
    sound: from.sound, opaque: false, tex, shape,
    connects: true, tall: true,
    drops: [{ item: key, min: 1, max: 1 }],
  });
}
connectingBlock(B.OAK_FENCE, 'oak_fence', 'Oak Fence', 'fence',
  { all: 'oak_planks' }, BLOCKS[B.OAK_PLANKS]);
connectingBlock(B.COBBLESTONE_WALL, 'cobblestone_wall', 'Cobblestone Wall', 'wall',
  { all: 'cobblestone' }, BLOCKS[B.COBBLESTONE]);
connectingBlock(B.STONE_BRICK_WALL, 'stone_brick_wall', 'Stone Brick Wall', 'wall',
  { all: 'stone_bricks' }, BLOCKS[B.STONE_BRICKS]);

// Fence gate: a swinging leaf that plugs into a fence/wall line. Two
// axis states (line along x or z) × open/closed are baked into 4 ids;
// all share the `oak_fence_gate` item and the plank texture. Opening
// only changes collision + geometry, never the id family layout.
{
  const from = BLOCKS[B.OAK_PLANKS];
  const p = {
    hardness: from.hardness, tool: from.tool, minTier: from.minTier,
    sound: from.sound, opaque: false, tex: { all: 'oak_planks' }, shape: 'gate',
    connects: true, tall: true, item: 'oak_fence_gate', use: 'gate',
    drops: [{ item: 'oak_fence_gate', min: 1, max: 1 }],
  };
  for (let s = 0; s < 4; s++) {
    const axis = s >> 1, open = (s & 1) === 1;
    def(B.OAK_FENCE_GATE + s, s === 0 ? 'oak_fence_gate' : `oak_fence_gate_${s}`,
      'Oak Fence Gate', { ...p, axis, open });
  }
}

// ── Doors (2-tall rotational openables) ───────────────────────────
// A door occupies two stacked cells (lower + upper half); both halves
// carry the SAME facing/hinge/open so meshing & collision agree, and
// interacting with either toggles both. State is baked into 32 ids per
// material: (half<<4 | hinge<<3 | open<<2 | facing). All share one item
// (placing the item fills both cells) and drop that item once, from the
// lower half only. Doors are solid-but-thin: a slab on the closed face,
// nothing when open. Not opaque (light passes around the leaf).
function doorFamily(base, key, name, tex, from, extra = {}) {
  const item = `${key}`;
  const p = {
    hardness: from.hardness, tool: from.tool, minTier: from.minTier,
    sound: from.sound, opaque: false, tex, shape: 'door', item, use: 'door',
    // Only the lower half drops the item; the upper half drops nothing so a
    // door yields exactly one item however it is broken.
    ...extra,
  };
  for (let s = 0; s < 32; s++) {
    const facing = s & 3, open = (s >> 2) & 1, hinge = (s >> 3) & 1, upper = (s >> 4) & 1;
    def(base + s, s === 0 ? key : `${key}_${s}`, name, {
      ...p, facing, open: !!open, hinge, doorHalf: upper ? 'upper' : 'lower',
      drops: upper ? [] : [{ item, min: 1, max: 1 }],
    });
  }
}
doorFamily(B.OAK_DOOR, 'oak_door', 'Oak Door',
  { all: 'oak_door' }, BLOCKS[B.OAK_PLANKS]);
// Iron door: TODO(sparkwire) — should only open when fed a power
// signal; until the Sparkwire system lands it toggles on interact like the
// oak door but is flagged so the wiring update can gate it.
doorFamily(B.IRON_DOOR, 'iron_door', 'Iron Door',
  { all: 'iron_door' }, BLOCKS[B.IRON_BLOCK], { signalGated: true });

// ── Trapdoors (thin horizontal openables) ─────────────────────────
// A thin slab clinging to the top or bottom of its cell; opening flips it
// up to vertical against the `facing` edge. 16 ids per material:
// (attach<<3 | open<<2 | facing). Solid-but-thin, not opaque.
function flapFamily(base, key, name, tex, from, extra = {}) {
  const item = `${key}`;
  const p = {
    hardness: from.hardness, tool: from.tool, minTier: from.minTier,
    sound: from.sound, opaque: false, tex, shape: 'flap', item, use: 'flap',
    drops: [{ item, min: 1, max: 1 }], ...extra,
  };
  for (let s = 0; s < 16; s++) {
    const facing = s & 3, open = (s >> 2) & 1, attach = (s >> 3) & 1;
    def(base + s, s === 0 ? key : `${key}_${s}`, name,
      { ...p, facing, open: !!open, attach });
  }
}
flapFamily(B.OAK_TRAPDOOR, 'oak_trapdoor', 'Oak Trapdoor',
  { all: 'oak_trapdoor' }, BLOCKS[B.OAK_PLANKS]);
flapFamily(B.IRON_TRAPDOOR, 'iron_trapdoor', 'Iron Trapdoor',
  { all: 'iron_trapdoor' }, BLOCKS[B.IRON_BLOCK], { signalGated: true });

// ── Panes (thin auto-connecting glass) ────────────────────────────
// Like fences, a central post + arms toward each connecting neighbor,
// but thin (glass cross-section) and NOT tall — you can hop them. They
// join other panes and solid opaque builds. Translucent + non-opaque.
function paneBlock(id, key, name, tex, from) {
  def(id, key, name, {
    hardness: from.hardness, tool: from.tool, minTier: from.minTier,
    sound: from.sound, opaque: false, translucent: true, drops: [],
    tex, shape: 'pane', connects: true, light: from.light,
  });
}
paneBlock(B.GLASS_PANE, 'glass_pane', 'Glass Pane',
  { all: 'glass' }, BLOCKS[B.GLASS]);
paneBlock(B.END_GLASS_PANE, 'end_glass_pane', 'End Glass Pane',
  { all: 'end_glass' }, BLOCKS[B.END_GLASS]);

// Connection bitmask: bit 0 = +x, 1 = -x, 2 = +z, 3 = -z. Matches the
// horizontal-neighbor order that the mesher / collision walk in. The bit
// direction vectors, for callers computing `conn`.
export const CONN_DIRS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

// Should a connecting block (fence/wall/gate) grow an arm toward `nid`?
// It joins any opaque cube (posts abut solid builds) and any other
// connecting block. A gate additionally only connects along its own axis
// so it plugs cleanly into a straight line.
export function connectsTo(self, nid, dirBit) {
  const n = BLOCKS[nid];
  if (!n) return false;
  if (self.shape === 'gate') {
    // axis 0 = line along x → connect on ±x (bits 0,1); axis 1 → ±z (2,3).
    const wantX = self.axis === 0;
    if (wantX !== (dirBit < 2)) return false;
  }
  // Panes are their own family: they join other panes and solid builds, but
  // not the chunky fence/wall/gate posts (mismatched thickness looks wrong).
  // The refusal must be mutual — fences must not grow arms toward panes.
  if (self.shape === 'pane') return n.shape === 'pane' || (n.opaque && n.solid);
  if (n.shape === 'pane') return false;
  if (n.connects) return true;         // fence↔fence, wall↔wall, gate lines
  return n.opaque && n.solid;          // solid cube builds
}

// Build the 4-bit connection mask for a connecting block via a neighbor
// id lookup `nAt(dx, dz)`. Bit order matches CONN_DIRS: +x,-x,+z,-z.
export function connMask(block, nAt) {
  let m = 0;
  for (let bit = 0; bit < 4; bit++) {
    const [dx, , dz] = CONN_DIRS[bit];
    if (connectsTo(block, nAt(dx, dz), bit)) m |= 1 << bit;
  }
  return m;
}

// Geometry constants for connecting shapes (local 0..1 coords). Fences use
// a slim post + thin rails; walls a chunkier post + bar. Tall shapes rise
// to POST_TOP for collision so entities can't jump the line.
const FENCE = { post: 0.375, arm: 0.4375, top: 0.9375, railLo: 0.375, railHi: 0.5625 };
const WALL  = { post: 0.3125, arm: 0.375, top: 1 };
// Panes: thin (2px-style) post + thin arms, full cell height, hop-able.
const PANE  = { post: 0.125, arm: 0.125, top: 1 };
export const POST_TOP = 1.5;   // tall-collision height for fences/walls

// Axis-aligned sub-boxes for a shaped block, in local 0..1 coords.
// Returned as [minX,minY,minZ, maxX,maxY,maxZ]. Used by BOTH the mesher
// (per-face geometry) and player/entity collision, so the visual and
// physical shape can never drift apart. Cube blocks are handled by the
// callers' fast paths and never reach here. `conn` is the 4-bit neighbor
// mask (only meaningful for connecting shapes); `collision` swaps arm
// heights for the taller physical box on fences/walls/gates.
export function shapeBoxes(block, conn = 0, collision = false) {
  if (block.shape === 'slab') {
    return block.half === 'top'
      ? [[0, 0.5, 0, 1, 1, 1]]
      : [[0, 0, 0, 1, 0.5, 1]];
  }
  if (block.shape === 'stair') {
    const bottom = block.half !== 'top';
    // Full half-height base, plus a quarter-depth upper step against the
    // wall the stair faces. facing 0..3 = +z,-z,+x,-x.
    const base = bottom ? [0, 0, 0, 1, 0.5, 1] : [0, 0.5, 0, 1, 1, 1];
    const yLo = bottom ? 0.5 : 0, yHi = bottom ? 1 : 0.5;
    let step;
    switch (block.facing) {
      case 0: step = [0, yLo, 0.5, 1, yHi, 1]; break;   // +z
      case 1: step = [0, yLo, 0, 1, yHi, 0.5]; break;   // -z
      case 2: step = [0.5, yLo, 0, 1, yHi, 1]; break;   // +x
      default: step = [0, yLo, 0, 0.5, yHi, 1]; break;  // -x
    }
    return [base, step];
  }
  if (block.shape === 'fence' || block.shape === 'wall' || block.shape === 'pane') {
    return connectingBoxes(block, conn, collision);
  }
  if (block.shape === 'gate') return gateBoxes(block, collision);
  if (block.shape === 'door') return doorBoxes(block);
  if (block.shape === 'flap') return flapBoxes(block);
  return [[0, 0, 0, 1, 1, 1]];
}

// Central post + one arm per connected side. Fences run two thin rails
// (upper + lower); walls run a single tall bar. Collision replaces the
// visual arm heights with a full POST_TOP wall so nothing hops the line.
function connectingBoxes(block, conn, collision) {
  const g = block.shape === 'wall' ? WALL : block.shape === 'pane' ? PANE : FENCE;
  const tall = block.tall;   // fences/walls block jumps; panes do not
  const lo = 0.5 - g.post / 2, hi = 0.5 + g.post / 2;
  const alo = 0.5 - g.arm / 2, ahi = 0.5 + g.arm / 2;
  const top = collision && tall ? POST_TOP : g.top;
  const boxes = [[lo, 0, lo, hi, top, hi]];   // post
  const railsFor = (a0, a1, axisX) => {
    if (collision && tall) {
      // One solid arm the full tall height blocks pathing/jumping.
      return axisX ? [[a0, 0, alo, a1, POST_TOP, ahi]]
                   : [[alo, 0, a0, ahi, POST_TOP, a1]];
    }
    if (block.shape === 'wall' || block.shape === 'pane') {
      return axisX ? [[a0, 0, alo, a1, g.top, ahi]]
                   : [[alo, 0, a0, ahi, g.top, a1]];
    }
    // Fence: two rails at railLo and railHi bands.
    const bands = [[FENCE.railLo, FENCE.railLo + 0.1875],
                   [FENCE.railHi, FENCE.railHi + 0.1875]];
    const out = [];
    for (const [y0, y1] of bands) {
      out.push(axisX ? [a0, y0, alo, a1, y1, ahi]
                     : [alo, y0, a0, ahi, y1, a1]);
    }
    return out;
  };
  if (conn & 1) boxes.push(...railsFor(hi, 1, true));    // +x
  if (conn & 2) boxes.push(...railsFor(0, lo, true));    // -x
  if (conn & 4) boxes.push(...railsFor(hi, 1, false));   // +z
  if (conn & 8) boxes.push(...railsFor(0, lo, false));   // -z
  return boxes;
}

// Gate: two posts flanking the opening + a swinging leaf. Closed, the leaf
// fills the gap; open, the leaf is empty (entities pass) but the posts
// stay. axis 0 = line along x (posts at ±x edges, leaf spans x); axis 1 =
// line along z. Collision uses the tall height so a closed gate blocks
// jumps like the fences it joins.
function gateBoxes(block, collision) {
  const alongX = block.axis === 0;
  const top = collision ? POST_TOP : 0.9375;
  const pw = 0.1875;               // post half-thickness footprint
  const lo = 0.5 - 0.125, hi = 0.5 + 0.125;   // thin band across the line
  const boxes = [];
  if (alongX) {
    boxes.push([0, 0, lo, pw, top, hi]);          // -x post
    boxes.push([1 - pw, 0, lo, 1, top, hi]);      // +x post
    if (!block.open) boxes.push([pw, 0, lo, 1 - pw, top, hi]);   // leaf
  } else {
    boxes.push([lo, 0, 0, hi, top, pw]);          // -z post
    boxes.push([lo, 0, 1 - pw, hi, top, 1]);      // +z post
    if (!block.open) boxes.push([lo, 0, pw, hi, top, 1 - pw]);   // leaf
  }
  return boxes;
}

// Door: a thin leaf spanning the cell. Closed, it lies flat against the
// `facing` face (a slab on that side of the cell). Opening swings it 90°
// about the hinge post to lie flat against the perpendicular wall on the
// hinge side. Both halves return the same footprint so the full 2-tall leaf
// is one continuous slab. facing 0..3 = +z,-z,+x,-x; hinge 0/1 = left/right.
const DOOR_T = 0.1875;   // leaf thickness
function doorBoxes(block) {
  const t = DOOR_T;
  // The closed leaf sits on the `facing` face of the cell; the open leaf
  // rotates 90° toward one side, ending flush against a perpendicular face.
  // Which perpendicular face depends on facing + hinge. We enumerate the
  // resulting axis-aligned slab for each (facing, open, hinge).
  const f = block.facing, open = block.open, hinge = block.hinge;
  // Closed slabs, per facing (thin band on that face):
  //   +z → z in [1-t,1]; -z → [0,t]; +x → x in [1-t,1]; -x → [0,t]
  if (!open) {
    switch (f) {
      case 0: return [[0, 0, 1 - t, 1, 1, 1]];   // +z
      case 1: return [[0, 0, 0, 1, 1, t]];       // -z
      case 2: return [[1 - t, 0, 0, 1, 1, 1]];   // +x
      default: return [[0, 0, 0, t, 1, 1]];      // -x
    }
  }
  // Open: swing about the hinge side to a perpendicular face. For a leaf
  // facing ±z the open leaf runs along z on either the +x or -x face
  // (chosen by hinge); facing ±x opens onto the ±z face.
  const perpPos = hinge === 1;   // hinge right → open toward +side
  if (f === 0 || f === 1) {
    return perpPos ? [[1 - t, 0, 0, 1, 1, 1]]    // +x face
                   : [[0, 0, 0, t, 1, 1]];       // -x face
  }
  return perpPos ? [[0, 0, 1 - t, 1, 1, 1]]      // +z face
                 : [[0, 0, 0, 1, 1, t]];         // -z face
}

// Trapdoor: a thin horizontal slab clinging to the cell's top or bottom.
// Opening flips it to vertical against the `facing` edge. attach 0/1 =
// bottom/top; facing 0..3 = +z,-z,+x,-x is the hinged edge it rests on.
const FLAP_T = 0.1875;   // slab thickness
function flapBoxes(block) {
  const t = FLAP_T;
  if (!block.open) {
    // Horizontal slab at the attached face.
    return block.attach === 1 ? [[0, 1 - t, 0, 1, 1, 1]]   // top
                              : [[0, 0, 0, 1, t, 1]];      // bottom
  }
  // Open → vertical slab standing on the `facing` edge, full cell height.
  switch (block.facing) {
    case 0: return [[0, 0, 1 - t, 1, 1, 1]];   // +z edge
    case 1: return [[0, 0, 0, 1, 1, t]];       // -z edge
    case 2: return [[1 - t, 0, 0, 1, 1, 1]];   // +x edge
    default: return [[0, 0, 0, t, 1, 1]];      // -x edge
  }
}

// True when a block uses the non-greedy shaped path (mesher + collision).
export const isShaped = id => {
  const b = BLOCKS[id];
  return !!b && b.shape !== 'cube';
};

// ── Lookups ───────────────────────────────────────────────────────
export const blockById = id => BLOCKS[id] || BLOCKS[0];
const keyToId = new Map();
for (const b of BLOCKS) if (b) keyToId.set(b.key, b.id);
export const blockIdByKey = key => keyToId.get(key) ?? 0;

// ── Mod registration ─────────────────────────────────────────────
// Assigns the next free id ≥ 210. Ids are stable for a given mod list +
// order (worlds save raw ids, so changing the mod list can orphan blocks —
// they degrade gracefully to air).
let nextModId = 332;   // 210-328 base content; 329-331 rails; mods after
export function registerBlock(key, name, props = {}) {
  if (keyToId.has(key)) throw new Error(`block key "${key}" already registered`);
  while (nextModId < MAX_BLOCKS && BLOCKS[nextModId]) nextModId++;
  if (nextModId >= MAX_BLOCKS) throw new Error('block id space exhausted (MAX_BLOCKS)');
  const b = def(nextModId, key, name, props);
  keyToId.set(key, b.id);
  return b.id;
}

// True if this block stops light entirely.
export const opaqueAt = id => BLOCKS[id] ? BLOCKS[id].opaque : false;
export const solidAt  = id => BLOCKS[id] ? BLOCKS[id].solid : false;

// Every distinct texture key, in registry order (atlas builds one layer each,
// plus the 10 crack decals appended at the end).
export function allTextureKeys() {
  const keys = new Set();
  for (const b of BLOCKS) {
    if (!b || b.id === 0) continue;
    const t = b.tex;
    for (const k of Object.values(t)) keys.add(k);
  }
  for (let i = 0; i < 10; i++) keys.add(`crack${i}`);
  return [...keys];
}

// Per-face texture key. dir: 0..5 = +x,-x,+y,-y,+z,-z
export function faceTexKey(block, dir) {
  const t = block.tex;
  if (t.all) return t.all;
  if (dir === 2) return t.top ?? t.side;
  if (dir === 3) return t.bottom ?? t.side;
  const faceKey = ['px', 'nx', null, null, 'pz', 'nz'][dir];
  return (faceKey && t[faceKey]) || t.side;
}
