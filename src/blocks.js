// BLOCKS block registry — every block type and its physical / visual /
// gameplay properties. Data-driven: other systems read from here.
//
// Texture keys reference layers in the procedural atlas (render/atlas.js).
// Tool tiers: 0 hand · 1 timber · 2 stone · 3 copper · 4 iron.

export const B = {
  AIR: 0,          CORESTONE: 1,    STONE: 2,        SOIL: 3,
  GRASS: 4,        SAND: 5,         GRAVEL: 6,       CLAY: 7,
  SNOW: 8,         ICE: 9,          ALDER_LOG: 10,   ALDER_LEAVES: 11,
  FERN_LOG: 12,    FERN_LEAVES: 13, PLANKS: 14,      WATER: 15,
  // 16..21 = flowing water, levels 6..1
  LAVA: 22,
  // 23..25 = flowing lava, levels 5/3/1
  GLASS: 26,       BRICK: 27,       COPPER_BLOCK: 28, IRON_BLOCK: 29,
  GLOWMOSS: 30,    LANTERN: 31,     COAL_ORE: 32,    COPPER_ORE: 33,
  IRON_ORE: 34,    SUNSTONE_ORE: 35, WORKTABLE: 36,  KILN: 37,
  TALLGRASS: 38,   EMBERBLOOM: 39,  AZUREBELL: 40,   DEADBUSH: 41,
  SPINEPLANT: 42,  BERRYBUSH: 43,   BERRYBUSH_RIPE: 44, FARMLAND: 45,
  CROP_0: 46,      CROP_1: 47,      CROP_2: 48,      CROP_3: 49,
  DUSTSTONE: 50,   SUNSTONE_BLOCK: 51, HEWNSTONE: 52, MOSSROCK: 53,
  BASALT: 54,      VINE: 55,        MUD: 56,         RUBBLE: 57,
  ALDER_SPROUT: 58, FERN_SPROUT: 59,
  // ── Wave 2: utility + dimensions ──
  WISP_TORCH: 60,  RUNGS: 61,       BEDROLL: 62,     STOWBOX: 63,
  SCORCHSTONE: 64, EMBERASH: 65,    GLOWVEIN_ORE: 66, CHARFUNGUS: 67,
  SCORCHBRICK: 68, RIFT_SMOLDER: 69, VOIDSTONE: 70,  HOLLOWMOSS: 71,
  VOIDGLASS: 72,   RIFT_HOLLOW: 73, DAWN_BEACON: 74,
  // ── Shaped blocks ─────────────────────────────────────────────────
  // Each ledge (slab) uses 2 ids: bottom, top. Each step (stair) uses
  // 8 ids: 2 halves × 4 facings. State is baked into the id so chunk
  // storage stays a flat Uint8Array. Laid out contiguously per material
  // so the shape helpers can address states by offset.
  PLANK_LEDGE: 75,          // 75 bottom, 76 top
  RUBBLE_LEDGE: 77,         // 77 bottom, 78 top
  SCORCHBRICK_LEDGE: 79,    // 79 bottom, 80 top
  PLANK_STEP: 81,           // 81..88  (half<<2 | facing)
  RUBBLE_STEP: 89,          // 89..96
  SCORCHBRICK_STEP: 97,     // 97..104
  // ── Auto-connecting shapes ────────────────────────────────────────
  // Palings (fences) & ramparts (walls) are a single id each: their arm
  // geometry is computed at mesh/collision time from the 4 horizontal
  // neighbors, not baked into the id. The gate bakes 2 bits of state:
  // axis (which line it sits in) and open/closed.
  TIMBER_PALING: 105,       // 105
  TIMBER_GATE: 106,         // 106..109  (axis<<1 | open)
  RUBBLE_RAMPART: 110,      // 110
  HEWNSTONE_RAMPART: 111,   // 111
  // ── Rotational & thin openables ───────────────────────────────────
  // Doorleaves are two cells tall; each material bakes 32 states into
  // contiguous ids: (half<<4 | hinge<<3 | open<<2 | facing). facing 0..3
  // = +z,-z,+x,-x is the direction the closed leaf faces; hinge 0/1 =
  // left/right post; open toggles the ^4 bit; half 0/1 = lower/upper.
  // Flapgates (trapdoors) bake 16 states: (attach<<3 | open<<2 | facing),
  // attach 0/1 = bottom/top of the cell, facing = the hinged edge.
  TIMBER_DOOR: 112,         // 112..143
  IRONBOUND_DOOR: 144,      // 144..175
  TIMBER_FLAP: 176,         // 176..191
  IRONBOUND_FLAP: 192,      // 192..207
  // Panes: one id each, arm geometry from neighbors like palings but thin
  // and non-tall (glass cross-section). Translucent, non-opaque.
  GLASS_PANE: 208,          // 208
  VOIDGLASS_PANE: 209,      // 209
};

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
// doorleaf/flapgate/pane families); 210+ are assigned to mods in
// registration order (block storage is Uint8Array, so 256 ids total).
export const BLOCKS = new Array(256).fill(null);

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
  use: null,          // right-click: 'worktable'|'kiln'|'berries'|'sleep'|'stowbox'
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
def(B.CORESTONE, 'corestone', 'Corestone', { hardness: -1, drops: [], sound: 'stone' });
def(B.STONE, 'stone', 'Stone', {
  hardness: 6, tool: 'pick', minTier: 1, sound: 'stone',
  drops: [{ item: 'rubble', min: 1, max: 1 }],
});
def(B.SOIL, 'soil', 'Soil', { hardness: 0.6, tool: 'shovel', sound: 'soft' });
def(B.GRASS, 'grass', 'Meadow Soil', {
  hardness: 0.7, tool: 'shovel', sound: 'soft', randomTick: 'grass',
  tex: { top: 'grass_top', bottom: 'soil', side: 'grass_side' },
  drops: [{ item: 'soil', min: 1, max: 1 }],
});
def(B.SAND, 'sand', 'Sand', { hardness: 0.6, tool: 'shovel', sound: 'sand' });
def(B.GRAVEL, 'gravel', 'Gravel', { hardness: 0.7, tool: 'shovel', sound: 'sand' });
def(B.CLAY, 'clay', 'Clay Bed', {
  hardness: 0.7, tool: 'shovel', sound: 'soft',
  drops: [{ item: 'clay_lump', min: 3, max: 4 }],
});
def(B.SNOW, 'snow', 'Packed Snow', { hardness: 0.5, tool: 'shovel', sound: 'snow' });
def(B.ICE, 'ice', 'River Ice', {
  hardness: 0.8, tool: 'pick', sound: 'glass', translucent: true, opaque: false, drops: [],
});
def(B.MUD, 'mud', 'Mud', { hardness: 0.7, tool: 'shovel', sound: 'soft' });
def(B.DUSTSTONE, 'duststone', 'Duststone', {
  hardness: 4, tool: 'pick', minTier: 1, sound: 'stone',
  tex: { top: 'duststone_top', bottom: 'duststone_top', side: 'duststone' },
});
def(B.BASALT, 'basalt', 'Basalt', { hardness: 8, tool: 'pick', minTier: 2, sound: 'stone' });
def(B.RUBBLE, 'rubble', 'Rubble', { hardness: 5.5, tool: 'pick', minTier: 1, sound: 'stone' });
def(B.MOSSROCK, 'mossrock', 'Mossrock', {
  hardness: 5.5, tool: 'pick', minTier: 1, sound: 'stone',
  drops: [{ item: 'rubble', min: 1, max: 1 }],
});

// ── Wood & foliage ───────────────────────────────────────────────
def(B.ALDER_LOG, 'alder_log', 'Alderwood Log', {
  hardness: 2.4, tool: 'axe', sound: 'wood',
  tex: { top: 'alder_log_end', bottom: 'alder_log_end', side: 'alder_log' },
});
def(B.ALDER_LEAVES, 'alder_leaves', 'Alder Canopy', {
  hardness: 0.3, sound: 'plant', opaque: false, sway: true,
  drops: [{ item: 'alder_sprout', min: 1, max: 1, chance: 0.08 },
          { item: 'rod', min: 1, max: 2, chance: 0.12 }],
});
def(B.FERN_LOG, 'fern_log', 'Fernwood Log', {
  hardness: 2.4, tool: 'axe', sound: 'wood',
  tex: { top: 'fern_log_end', bottom: 'fern_log_end', side: 'fern_log' },
});
def(B.FERN_LEAVES, 'fern_leaves', 'Fern Boughs', {
  hardness: 0.3, sound: 'plant', opaque: false, sway: true,
  drops: [{ item: 'fern_sprout', min: 1, max: 1, chance: 0.08 },
          { item: 'rod', min: 1, max: 2, chance: 0.12 }],
});
def(B.PLANKS, 'planks', 'Timber Planks', { hardness: 2.2, tool: 'axe', sound: 'wood' });

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
def(B.BRICK, 'brick', 'Fired Brick', { hardness: 5, tool: 'pick', minTier: 1, sound: 'stone' });
def(B.HEWNSTONE, 'hewnstone', 'Hewn Stone', { hardness: 5.5, tool: 'pick', minTier: 1, sound: 'stone' });
def(B.COPPER_BLOCK, 'copper_block', 'Copper Block', {
  hardness: 7, tool: 'pick', minTier: 2, sound: 'metal',
});
def(B.IRON_BLOCK, 'iron_block', 'Iron Block', {
  hardness: 9, tool: 'pick', minTier: 3, sound: 'metal',
});
def(B.SUNSTONE_BLOCK, 'sunstone_block', 'Sunstone Block', {
  hardness: 7, tool: 'pick', minTier: 3, sound: 'metal', light: 14,
});
def(B.GLOWMOSS, 'glowmoss', 'Glowmoss', {
  hardness: 0.4, sound: 'plant', light: 13, opaque: true,
});
def(B.LANTERN, 'lantern', 'Wisp Lantern', {
  hardness: 0.8, sound: 'metal', light: 15, opaque: false, solid: true,
});
def(B.WORKTABLE, 'worktable', 'Worktable', {
  hardness: 2.4, tool: 'axe', sound: 'wood', use: 'worktable',
  tex: { top: 'worktable_top', bottom: 'planks', side: 'worktable_side' },
});
def(B.KILN, 'kiln', 'Stone Kiln', {
  hardness: 5, tool: 'pick', minTier: 1, sound: 'stone', use: 'kiln',
  tex: { top: 'kiln_top', bottom: 'kiln_top', side: 'kiln_side', pz: 'kiln_front' },
});

// ── Ores ──────────────────────────────────────────────────────────
def(B.COAL_ORE, 'coal_ore', 'Coal Seam', {
  hardness: 6, tool: 'pick', minTier: 1, sound: 'stone',
  drops: [{ item: 'coal', min: 1, max: 2 }],
});
def(B.COPPER_ORE, 'copper_ore', 'Copper Vein', {
  hardness: 6.5, tool: 'pick', minTier: 2, sound: 'stone',
  drops: [{ item: 'copper_ore_chunk', min: 1, max: 1 }],
});
def(B.IRON_ORE, 'iron_ore', 'Iron Vein', {
  hardness: 7, tool: 'pick', minTier: 3, sound: 'stone',
  drops: [{ item: 'iron_ore_chunk', min: 1, max: 1 }],
});
def(B.SUNSTONE_ORE, 'sunstone_ore', 'Sunstone Seam', {
  hardness: 8, tool: 'pick', minTier: 4, sound: 'stone', light: 7,
  drops: [{ item: 'sunstone', min: 1, max: 2 }],
});

// ── Plants & farming ─────────────────────────────────────────────
const plant = (extra = {}) => Object.assign({
  solid: false, opaque: false, cross: true, hardness: 0.05,
  sound: 'plant', sway: true, placeOn: [B.GRASS, B.SOIL, B.MUD],
}, extra);
def(B.TALLGRASS, 'tallgrass', 'Wild Grass', plant({
  replaceable: true,
  drops: [{ item: 'tuber_seed', min: 1, max: 1, chance: 0.12 }],
}));
def(B.EMBERBLOOM, 'emberbloom', 'Emberbloom', plant());
def(B.AZUREBELL, 'azurebell', 'Azurebell', plant());
def(B.DEADBUSH, 'deadbush', 'Dry Scrub', plant({
  placeOn: [B.SAND, B.SOIL, B.DUSTSTONE],
  drops: [{ item: 'rod', min: 1, max: 2 }],
}));
def(B.SPINEPLANT, 'spineplant', 'Spineplant', {
  hardness: 0.5, sound: 'plant', opaque: false, solid: true,
  placeOn: [B.SAND, B.SPINEPLANT],
  tex: { top: 'spineplant_top', bottom: 'spineplant_top', side: 'spineplant' },
});
def(B.BERRYBUSH, 'berrybush', 'Bramble Bush', plant({
  hardness: 0.4, randomTick: 'berry', placeOn: [B.GRASS, B.SOIL],
  drops: [{ item: 'rod', min: 1, max: 1 }],
}));
def(B.BERRYBUSH_RIPE, 'berrybush_ripe', 'Bramble Bush (ripe)', plant({
  hardness: 0.4, use: 'berries', placeOn: [B.GRASS, B.SOIL],
  drops: [{ item: 'berries', min: 1, max: 2 }, { item: 'rod', min: 1, max: 1 }],
}));
def(B.FARMLAND, 'farmland', 'Tilled Soil', {
  hardness: 0.6, tool: 'shovel', sound: 'soft',
  drops: [{ item: 'soil', min: 1, max: 1 }],
  tex: { top: 'farmland', bottom: 'soil', side: 'soil' },
});
for (let s = 0; s < 4; s++) {
  def(B.CROP_0 + s, `crop_${s}`, 'Tuber Crop', plant({
    placeOn: [B.FARMLAND], randomTick: s < 3 ? 'crop' : null, replaceable: false,
    drops: s === 3
      ? [{ item: 'tuber', min: 1, max: 3 }, { item: 'tuber_seed', min: 1, max: 2 }]
      : [{ item: 'tuber_seed', min: 1, max: 1 }],
  }));
}
def(B.VINE, 'vine', 'Trailing Vine', plant({
  climbable: true, placeOn: null, replaceable: true, drops: [],
}));
def(B.ALDER_SPROUT, 'alder_sprout', 'Alder Sprout', plant({
  randomTick: 'sprout', placeOn: [B.GRASS, B.SOIL],
}));
def(B.FERN_SPROUT, 'fern_sprout', 'Fern Sprout', plant({
  randomTick: 'sprout', placeOn: [B.GRASS, B.SOIL, B.SNOW],
}));

// ── Utility (wave 2) ─────────────────────────────────────────────
def(B.WISP_TORCH, 'wisp_torch', 'Wisp Torch', {
  solid: false, opaque: false, cross: true, hardness: 0.05,
  sound: 'wood', light: 13, needsFloor: true, drops: 'self',
});
def(B.RUNGS, 'rungs', 'Timber Rungs', {
  solid: false, opaque: false, cross: true, hardness: 0.4,
  sound: 'wood', climbable: true, needsWall: true, sway: false,
});
def(B.BEDROLL, 'bedroll', 'Bedroll', {
  hardness: 0.4, sound: 'soft', use: 'sleep', opaque: false, solid: true,
  tex: { top: 'bedroll_top', bottom: 'planks', side: 'bedroll_side' },
});
def(B.STOWBOX, 'stowbox', 'Stowbox', {
  hardness: 2.4, tool: 'axe', sound: 'wood', use: 'stowbox',
  tex: { top: 'stowbox_top', bottom: 'stowbox_top', side: 'stowbox_side', pz: 'stowbox_front' },
});
def(B.DAWN_BEACON, 'dawn_beacon', 'Dawn Beacon', {
  hardness: 6, tool: 'pick', minTier: 3, sound: 'metal', light: 15,
});

// ── The Smolder ──────────────────────────────────────────────────
def(B.SCORCHSTONE, 'scorchstone', 'Scorchstone', {
  hardness: 2.2, tool: 'pick', minTier: 1, sound: 'stone',
});
def(B.EMBERASH, 'emberash', 'Emberash', {
  hardness: 0.6, tool: 'shovel', sound: 'sand',
});
def(B.GLOWVEIN_ORE, 'glowvein_ore', 'Glowvein', {
  hardness: 4.5, tool: 'pick', minTier: 2, sound: 'stone', light: 9,
  drops: [{ item: 'smolder_shard', min: 1, max: 2 }],
});
def(B.CHARFUNGUS, 'charfungus', 'Charfungus', {
  solid: false, opaque: false, cross: true, hardness: 0.05, sound: 'plant',
  light: 4, placeOn: [B.SCORCHSTONE, B.EMBERASH], drops: 'self',
});
def(B.SCORCHBRICK, 'scorchbrick', 'Scorchbrick', {
  hardness: 5, tool: 'pick', minTier: 1, sound: 'stone',
});
def(B.RIFT_SMOLDER, 'rift_smolder', 'Smolder Rift', {
  solid: false, opaque: false, translucent: true, hardness: -1, drops: [],
  light: 11, sound: 'glass',
});

// ── The Hollow ───────────────────────────────────────────────────
def(B.VOIDSTONE, 'voidstone', 'Voidstone', {
  hardness: 5, tool: 'pick', minTier: 1, sound: 'stone',
});
def(B.HOLLOWMOSS, 'hollowmoss', 'Hollowmoss', {
  hardness: 0.7, tool: 'shovel', sound: 'soft', light: 2,
  tex: { top: 'hollowmoss_top', bottom: 'voidstone', side: 'hollowmoss_side' },
  drops: [{ item: 'voidstone', min: 1, max: 1 }],
});
def(B.VOIDGLASS, 'voidglass', 'Voidglass', {
  hardness: 0.5, sound: 'glass', opaque: false, translucent: true, drops: [],
  light: 11,
});
def(B.RIFT_HOLLOW, 'rift_hollow', 'Hollow Rift', {
  solid: false, opaque: false, translucent: true, hardness: -1, drops: [],
  light: 9, sound: 'glass',
});

// ── Shaped blocks: ledges (slabs) & steps (stairs) ────────────────
// Each material registers a family of ids, one per orientation/half
// state. All states share one inventory item (the `item` prop) and the
// base material's textures. Shaped blocks are solid but NOT opaque, so
// light passes and caves behave; their per-face geometry & collision
// AABBs come from shapeBoxes() below.
//
// STEP id layout, relative to the family base: (half<<2) | facing,
// facing 0..3 = +z,-z,+x,-x (the step's tall back wall faces `facing`).
const STEP_STATES = 8;

function ledgeFamily(base, key, name, tex, from) {
  const item = `${key}_ledge`;
  const p = {
    hardness: from.hardness, tool: from.tool, minTier: from.minTier,
    sound: from.sound, opaque: false, tex, shape: 'slab', item,
    // Every state drops the shared item (their own keys aren't items).
    drops: [{ item, min: 1, max: 1 }],
  };
  def(base + 0, `${key}_ledge`, name, { ...p, half: 'bottom' });
  def(base + 1, `${key}_ledge_top`, name, { ...p, half: 'top' });
}

function stepFamily(base, key, name, tex, from) {
  const item = `${key}_step`;
  const p = {
    hardness: from.hardness, tool: from.tool, minTier: from.minTier,
    sound: from.sound, opaque: false, tex, shape: 'stair', item,
    drops: [{ item, min: 1, max: 1 }],
  };
  for (let s = 0; s < STEP_STATES; s++) {
    const half = (s >> 2) === 1 ? 'top' : 'bottom';
    const facing = s & 3;
    def(base + s, s === 0 ? `${key}_step` : `${key}_step_${s}`, name,
      { ...p, half, facing });
  }
}

// Ledges keep the base material's uniform texture on every cut face.
ledgeFamily(B.PLANK_LEDGE, 'plank', 'Timber Ledge',
  { all: 'planks' }, BLOCKS[B.PLANKS]);
ledgeFamily(B.RUBBLE_LEDGE, 'rubble', 'Rubble Ledge',
  { all: 'rubble' }, BLOCKS[B.RUBBLE]);
ledgeFamily(B.SCORCHBRICK_LEDGE, 'scorchbrick', 'Scorchbrick Ledge',
  { all: 'scorchbrick' }, BLOCKS[B.SCORCHBRICK]);
stepFamily(B.PLANK_STEP, 'plank', 'Timber Step',
  { all: 'planks' }, BLOCKS[B.PLANKS]);
stepFamily(B.RUBBLE_STEP, 'rubble', 'Rubble Step',
  { all: 'rubble' }, BLOCKS[B.RUBBLE]);
stepFamily(B.SCORCHBRICK_STEP, 'scorchbrick', 'Scorchbrick Step',
  { all: 'scorchbrick' }, BLOCKS[B.SCORCHBRICK]);

// ── Auto-connecting shapes: palings (fences) & ramparts (walls) ───
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
connectingBlock(B.TIMBER_PALING, 'timber_paling', 'Timber Palings', 'fence',
  { all: 'planks' }, BLOCKS[B.PLANKS]);
connectingBlock(B.RUBBLE_RAMPART, 'rubble_rampart', 'Rubble Rampart', 'wall',
  { all: 'rubble' }, BLOCKS[B.RUBBLE]);
connectingBlock(B.HEWNSTONE_RAMPART, 'hewnstone_rampart', 'Hewnstone Rampart', 'wall',
  { all: 'hewnstone' }, BLOCKS[B.HEWNSTONE]);

// Palings Gate: a swinging leaf that plugs into a paling/wall line. Two
// axis states (line along x or z) × open/closed are baked into 4 ids;
// all share the `timber_gate` item and the plank texture. Opening only
// changes collision + geometry, never the id family layout.
{
  const from = BLOCKS[B.PLANKS];
  const p = {
    hardness: from.hardness, tool: from.tool, minTier: from.minTier,
    sound: from.sound, opaque: false, tex: { all: 'planks' }, shape: 'gate',
    connects: true, tall: true, item: 'timber_gate', use: 'gate',
    drops: [{ item: 'timber_gate', min: 1, max: 1 }],
  };
  for (let s = 0; s < 4; s++) {
    const axis = s >> 1, open = (s & 1) === 1;
    def(B.TIMBER_GATE + s, s === 0 ? 'timber_gate' : `timber_gate_${s}`,
      'Palings Gate', { ...p, axis, open });
  }
}

// ── Doorleaves (2-tall rotational openables) ──────────────────────
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
doorFamily(B.TIMBER_DOOR, 'timber_door', 'Timber Door',
  { all: 'timber_door' }, BLOCKS[B.PLANKS]);
// Ironbound door: TODO(sparkwire) — should only open when fed a power
// signal; until the Sparkwire system lands it toggles on interact like the
// timber door but is flagged so the wiring update can gate it.
doorFamily(B.IRONBOUND_DOOR, 'ironbound_door', 'Ironbound Door',
  { all: 'ironbound_door' }, BLOCKS[B.IRON_BLOCK], { signalGated: true });

// ── Flapgates (thin horizontal trapdoors) ─────────────────────────
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
flapFamily(B.TIMBER_FLAP, 'timber_flap', 'Timber Flap',
  { all: 'timber_flap' }, BLOCKS[B.PLANKS]);
flapFamily(B.IRONBOUND_FLAP, 'ironbound_flap', 'Ironbound Flap',
  { all: 'ironbound_flap' }, BLOCKS[B.IRON_BLOCK], { signalGated: true });

// ── Panes (thin auto-connecting glass) ────────────────────────────
// Like palings, a central post + arms toward each connecting neighbor,
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
paneBlock(B.VOIDGLASS_PANE, 'voidglass_pane', 'Voidglass Pane',
  { all: 'voidglass' }, BLOCKS[B.VOIDGLASS]);

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
// jumps like the palings it joins.
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

// Doorleaf: a thin leaf spanning the cell. Closed, it lies flat against the
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

// Flapgate: a thin horizontal slab clinging to the cell's top or bottom.
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
let nextModId = 210;
export function registerBlock(key, name, props = {}) {
  if (keyToId.has(key)) throw new Error(`block key "${key}" already registered`);
  while (nextModId < 256 && BLOCKS[nextModId]) nextModId++;
  if (nextModId >= 256) throw new Error('block id space exhausted (256 max)');
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
