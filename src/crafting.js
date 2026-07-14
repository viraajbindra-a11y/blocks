// Data-driven crafting. Two recipe forms:
//  - shaped:    pattern rows + key map (letters → item key or [alternatives])
//  - shapeless: flat ingredient list (multiset match)
// station: null (inventory 2×2) | 'worktable' (crafting table 3×3) |
// 'kiln' (furnace processing) — internal station ids, not display names.

export const RECIPES = [];

function shaped(out, count, pattern, keyMap, station = null) {
  RECIPES.push({ type: 'shaped', out, count, pattern, keyMap, station });
}
function shapeless(out, count, ingredients, station = null) {
  RECIPES.push({ type: 'shapeless', out, count, ingredients, station });
}

const ANY_LOG = ['oak_log', 'spruce_log'];
const ANY_PLANK = ['oak_planks', 'birch_planks', 'jungle_planks', 'acacia_planks'];

// ── Basics ────────────────────────────────────────────────────────
shapeless('oak_planks', 4, [ANY_LOG]);
for (const w of ['birch', 'jungle', 'acacia']) shapeless(`${w}_planks`, 4, [`${w}_log`]);
shaped('stick', 4, ['P', 'P'], { P: ANY_PLANK });
shaped('crafting_table', 1, ['PP', 'PP'], { P: ANY_PLANK });
shaped('furnace', 1, ['RRR', 'R R', 'RRR'], { R: 'cobblestone' }, 'worktable');

// ── Tools (crafting table) ────────────────────────────────────────
const toolMats = {
  wooden: 'oak_planks', stone: 'cobblestone', copper: 'copper_ingot',
  iron: 'iron_ingot', netherite: 'netherite_ingot', golden: 'gold_ingot',
};
for (const [tier, mat] of Object.entries(toolMats)) {
  shaped(`${tier}_pickaxe`, 1, ['MMM', ' R ', ' R '], { M: mat, R: 'stick' }, 'worktable');
  shaped(`${tier}_axe`, 1, ['MM', 'MR', ' R'], { M: mat, R: 'stick' }, 'worktable');
  shaped(`${tier}_shovel`, 1, ['M', 'R', 'R'], { M: mat, R: 'stick' }, 'worktable');
  shaped(`${tier}_hoe`, 1, ['MM', ' R', ' R'], { M: mat, R: 'stick' }, 'worktable');
  shaped(`${tier}_sword`, 1, ['M', 'M', 'R'], { M: mat, R: 'stick' }, 'worktable');
}

// ── Building & light ──────────────────────────────────────────────
shaped('stone_bricks', 4, ['SS', 'SS'], { S: 'stone' }, 'worktable');
shapeless('chiseled_stone_bricks', 1, ['stone_bricks']);
shapeless('mossy_stone_bricks', 1, ['stone_bricks', 'vines']);
shaped('chiseled_sandstone', 1, ['S', 'S'], { S: 'sandstone' }, 'worktable');
shaped('cut_sandstone', 4, ['SS', 'SS'], { S: 'sandstone' }, 'worktable');
shaped('copper_block', 1, ['II', 'II'], { I: 'copper_ingot' }, 'worktable');
shaped('iron_block', 1, ['II', 'II'], { I: 'iron_ingot' }, 'worktable');
shaped('diamond_block', 1, ['SS', 'SS'], { S: 'diamond' }, 'worktable');
shapeless('copper_ingot', 4, ['copper_block']);
shapeless('iron_ingot', 4, ['iron_block']);
shaped('lantern', 2, ['D', 'G', 'C'], { D: 'glowstone_dust', G: 'glass', C: 'copper_ingot' }, 'worktable');

// ── Smelting (real furnace: one input + one fuel → output over time) ──
// SMELT maps a single input item key → its smelted result. The furnace
// consumes one input + burns fuel over COOK_SECONDS to yield the output.
// FUEL maps a fuel item key → how many seconds it burns. One furnace
// operation (COOK_SECONDS) uses that many seconds of fuel.
export const COOK_SECONDS = 8;

export const SMELT = {
  cobblestone: { out: 'stone', count: 1 },
  sand: { out: 'glass', count: 1 },
  clay_ball: { out: 'bricks', count: 1 },
  raw_copper: { out: 'copper_ingot', count: 1 },
  raw_iron: { out: 'iron_ingot', count: 1 },
  potato: { out: 'baked_potato', count: 1 },
  raw_porkchop: { out: 'cooked_porkchop', count: 1 },
  raw_beef: { out: 'cooked_beef', count: 1 },
  raw_chicken: { out: 'cooked_chicken', count: 1 },
  raw_mutton: { out: 'cooked_mutton', count: 1 },
  raw_cod: { out: 'cooked_cod', count: 1 },
  raw_salmon: { out: 'cooked_salmon', count: 1 },
  oak_log: { out: 'coal', count: 1 },      // → charcoal
  spruce_log: { out: 'coal', count: 1 },   // → charcoal
  end_stone: { out: 'end_glass', count: 1 },
  cactus: { out: 'green_dye', count: 1 },  // cactus → green dye
  stone: { out: 'smooth_stone', count: 1 },
  stone_bricks: { out: 'cracked_stone_bricks', count: 1 },
  sandstone: { out: 'smooth_sandstone', count: 1 },
};

export const FUEL = {
  coal: 80,            // coal or charcoal — 8 items @ COOK_SECONDS
  oak_log: 15,
  spruce_log: 15,
  oak_planks: 15,
  crafting_table: 15,
  chest: 15,
  ladder: 15,
  oak_fence: 15,
  oak_sapling: 5,
  spruce_sapling: 5,
  stick: 5,
};

export function smeltRecipe(key) { return (key && SMELT[key]) || null; }
export function fuelSeconds(key) { return (key && FUEL[key]) || 0; }
export function isFuel(key) { return !!(key && FUEL[key]); }

// Advance one furnace by dt seconds. Mutates the furnace state object
// { input, fuel, output, burn, burnMax, cook } in place. Burns lit fuel
// down, lights fresh fuel only when there's something to smelt, and
// yields one output per COOK_SECONDS. Smelted outputs cap at 64.
// Returns true on the frame an item is produced. Pure of any DOM.
export function tickFurnace(f, dt) {
  const recipe = smeltRecipe(f.input && f.input.key);
  const canSmelt = !!(recipe && (!f.output ||
    (f.output.key === recipe.out && f.output.count + recipe.count <= 64)));

  if (f.burn > 0) f.burn = Math.max(0, f.burn - dt);

  // Light fresh fuel only when a valid smelt is waiting on heat.
  if (f.burn <= 0 && canSmelt && f.fuel) {
    const secs = fuelSeconds(f.fuel.key);
    if (secs > 0) {
      f.fuel.count -= 1;
      if (f.fuel.count <= 0) f.fuel = null;
      f.burn = secs;
      f.burnMax = secs;
    }
  }

  let produced = false;
  if (f.burn > 0 && canSmelt) {
    f.cook = (f.cook || 0) + dt;
    if (f.cook >= COOK_SECONDS) {
      f.cook -= COOK_SECONDS;
      if (!f.output) f.output = { key: recipe.out, count: recipe.count };
      else f.output.count += recipe.count;
      f.input.count -= 1;
      if (f.input.count <= 0) f.input = null;
      produced = true;
    }
  } else {
    f.cook = Math.max(0, (f.cook || 0) - dt * 2);   // progress relaxes
  }
  return produced;
}

// Moved off the old kiln grid onto the crafting table (they were never
// really "smelts"): fired clay vessel + netherite forging.
shapeless('bucket', 1, ['clay_ball', 'clay_ball', 'clay_ball'], 'worktable');
shapeless('netherite_ingot', 1, ['netherite_scrap', 'netherite_scrap', 'netherite_scrap', 'iron_ingot'], 'worktable');

// ── Wave 2 utility ────────────────────────────────────────────────
shaped('torch', 4, ['C', 'R'], { C: 'coal', R: 'stick' });
shaped('ladder', 3, ['R R', 'RRR', 'R R'], { R: 'stick' }, 'worktable');
shapeless('bed', 1, ['leather', 'leather', 'oak_planks']);
shaped('bread', 1, ['WWW'], { W: 'wheat' }, 'worktable');
shaped('bed', 1, ['WWW', 'PPP'], { W: 'wool', P: 'oak_planks' }, 'worktable');   // wool bed
shapeless('bone_meal', 3, ['bone']);                                             // grind bone
shaped('chest', 1, ['PPP', 'P P', 'PPP'], { P: 'oak_planks' }, 'worktable');
shapeless('flint_and_steel', 1, ['iron_ingot', 'cobblestone']);
shaped('nether_bricks', 4, ['SS', 'SS'], { S: 'netherrack' }, 'worktable');

// ── Shaped blocks: slabs & stairs ─────────────────────────────────
// Slabs: 3 of a material in a row → 6 slabs. Stairs: a 6-block stair
// pattern → 4 stairs. Outputs are the shared shaped-block item keys.
for (const [mat, slab, stairs] of [
  ['oak_planks', 'oak_slab', 'oak_stairs'],
  ['cobblestone', 'cobblestone_slab', 'cobblestone_stairs'],
  ['nether_bricks', 'nether_brick_slab', 'nether_brick_stairs'],
]) {
  shaped(slab, 6, ['MMM'], { M: mat }, 'worktable');
  shaped(stairs, 4, ['M  ', 'MM ', 'MMM'], { M: mat }, 'worktable');
}

// ── Auto-connecting shapes: fences, gate & walls ──────────────────
// Fences & walls: two rows of the base material split by a stick core
// yield a run of connecting sections. The gate frames its opening with
// sticks around a plank leaf.
shaped('oak_fence', 3, ['PRP', 'PRP'], { P: 'oak_planks', R: 'stick' }, 'worktable');
shaped('oak_fence_gate', 1, ['RPR', 'RPR'], { R: 'stick', P: 'oak_planks' }, 'worktable');
shaped('cobblestone_wall', 6, ['RRR', 'RRR'], { R: 'cobblestone' }, 'worktable');
shaped('stone_brick_wall', 6, ['HHH', 'HHH'], { H: 'stone_bricks' }, 'worktable');

// ── Rotational & thin openables: doors, trapdoors & panes ─────────
// Doors: two columns of the base material yield a leaf. Trapdoors:
// a low slab of material. Panes: a wide+tall block of glass cut into a
// grid of thin panes (fence-style yield).
shaped('oak_door', 1, ['PP', 'PP', 'PP'], { P: 'oak_planks' }, 'worktable');
shaped('iron_door', 1, ['II', 'II', 'II'], { I: 'iron_ingot' }, 'worktable');
shaped('oak_trapdoor', 2, ['PPP', 'PPP'], { P: 'oak_planks' }, 'worktable');
shaped('iron_trapdoor', 2, ['III', 'III'], { I: 'iron_ingot' }, 'worktable');
shaped('glass_pane', 16, ['GGG', 'GGG'], { G: 'glass' }, 'worktable');
shaped('end_glass_pane', 16, ['GGG', 'GGG'], { G: 'end_glass' }, 'worktable');

shaped('beacon', 1, [' S ', 'SCS', ' S '], { S: 'diamond_block', C: 'dragon_core' }, 'worktable');

// ── Ranged combat, shears & armor ─────────────────────────────────
shapeless('string', 4, ['wool']);                                    // unravel fleece
shaped('arrow', 4, ['F', 'R', 'E'], { F: 'flint', R: 'stick', E: 'feather' }, 'worktable');
shaped('bow', 1, [' RS', 'R S', ' RS'], { R: 'stick', S: 'string' }, 'worktable');
shaped('shears', 1, [' I', 'I '], { I: 'iron_ingot' }, 'worktable');
shaped('shield', 1, ['PIP', 'PPP', ' P '], { P: 'oak_planks', I: 'iron_ingot' }, 'worktable');
shaped('fishing_rod', 1, ['  R', ' RS', 'R S'], { R: 'stick', S: 'string' }, 'worktable');
shaped('crossbow', 1, ['SIS', 'RRR', ' R '], { S: 'string', I: 'iron_ingot', R: 'stick' }, 'worktable');
shaped('anvil', 1, ['III', ' i ', 'iii'], { I: 'iron_block', i: 'iron_ingot' }, 'worktable');

// ── Dyes + colored wool ───────────────────────────────────────────
// Primary dyes from natural sources, then Minecraft-style mixes.
shapeless('white_dye', 1, ['bone_meal']);
shapeless('black_dye', 1, ['coal']);
shapeless('red_dye', 1, ['poppy']);
shapeless('blue_dye', 1, ['cornflower']);
shapeless('yellow_dye', 1, ['glowstone_dust']);         // bright pigment
// (green_dye smelts from cactus — see SMELT above)
shapeless('brown_dye', 1, ['red_dye', 'green_dye']);
shapeless('orange_dye', 2, ['red_dye', 'yellow_dye']);
shapeless('lime_dye', 2, ['green_dye', 'white_dye']);
shapeless('pink_dye', 2, ['red_dye', 'white_dye']);
shapeless('gray_dye', 2, ['black_dye', 'white_dye']);
shapeless('light_gray_dye', 2, ['gray_dye', 'white_dye']);
shapeless('cyan_dye', 2, ['blue_dye', 'green_dye']);
shapeless('purple_dye', 2, ['red_dye', 'blue_dye']);
shapeless('magenta_dye', 2, ['purple_dye', 'pink_dye']);
shapeless('light_blue_dye', 2, ['blue_dye', 'white_dye']);
// Fleece → white wool block; dye white wool into any color.
shapeless('white_wool', 1, ['wool']);
for (const c of ['orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']) {
  shapeless(`${c}_wool`, 1, ['white_wool', `${c}_dye`], 'worktable');
}
// ── Concrete / terracotta / glazed terracotta (16 colours) ─────────
// Concrete: 4 sand + 4 gravel + dye (hardens directly). Terracotta:
// smelt clay → white terracotta, then dye it. Glazed: smelt terracotta.
const COLORS16 = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink',
  'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
for (const c of COLORS16) {
  shapeless(`${c}_concrete`, 8,
    ['sand', 'sand', 'sand', 'sand', 'gravel', 'gravel', 'gravel', 'gravel', `${c}_dye`], 'worktable');
  if (c !== 'white') {
    shapeless(`${c}_terracotta`, 8, [...Array(8).fill('white_terracotta'), `${c}_dye`], 'worktable');
  }
  SMELT[`${c}_terracotta`] = { out: `${c}_glazed_terracotta`, count: 1 };
}
SMELT.clay = { out: 'white_terracotta', count: 1 };   // fired clay block → terracotta

// ── Pumpkin / melon / sugar cane / cake ────────────────────────────
shapeless('pumpkin_seeds', 4, ['pumpkin']);
shapeless('melon_seeds', 1, ['melon_slice']);
shaped('melon', 1, ['SSS', 'SSS', 'SSS'], { S: 'melon_slice' }, 'worktable');
shapeless('sugar', 1, ['sugar_cane']);
shapeless('jack_o_lantern', 1, ['carved_pumpkin', 'glowstone_dust']);
shapeless('pumpkin_pie', 1, ['pumpkin', 'sugar', 'egg']);
shaped('cake', 1, ['MMM', 'SES', 'WWW'],
  { M: 'milk_bucket', S: 'sugar', E: 'egg', W: 'wheat' }, 'worktable');

// ── Utility stations ───────────────────────────────────────────────
shapeless('grindstone', 1, ['stone', 'stick', 'stick', 'oak_planks', 'oak_planks']);
shaped('stonecutter', 1, [' I ', 'SSS'], { I: 'iron_ingot', S: 'stone' }, 'worktable');
shaped('beacon', 1, ['GGG', 'GNG', 'OOO'],
  { G: 'glass', N: 'nether_star', O: 'obsidian' }, 'worktable');   // Wither drops the star
shaped('emerald_block', 1, ['EEE', 'EEE', 'EEE'], { E: 'emerald' }, 'worktable');
shapeless('emerald', 9, ['emerald_block']);

// ── Redstone / automation ──────────────────────────────────────────
shaped('redstone_block', 1, ['RRR', 'RRR', 'RRR'], { R: 'redstone' }, 'worktable');
shapeless('redstone', 9, ['redstone_block']);
shaped('redstone_torch', 1, ['R', 'S'], { R: 'redstone', S: 'stick' }, 'worktable');
shaped('lever', 1, ['S', 'C'], { S: 'stick', C: 'cobblestone' });
shapeless('stone_button', 1, ['stone']);
shaped('redstone_lamp', 1, [' R ', 'RGR', ' R '], { R: 'redstone', G: 'glowstone' }, 'worktable');
shaped('dispenser', 1, ['CCC', 'CBC', 'CRC'], { C: 'cobblestone', B: 'bow', R: 'redstone' }, 'worktable');
shaped('hopper', 1, ['I I', 'ICI', ' I '], { I: 'iron_ingot', C: 'chest' }, 'worktable');

// ── Rails + vehicles ───────────────────────────────────────────────
shaped('rail', 16, ['I I', 'ISI', 'I I'], { I: 'iron_ingot', S: 'stick' }, 'worktable');
shaped('powered_rail', 6, ['C C', 'CRC', 'CSC'], { C: 'copper_ingot', R: 'redstone', S: 'stick' }, 'worktable');
shaped('detector_rail', 6, ['I I', 'IRI', 'ISI'], { I: 'iron_ingot', R: 'redstone', S: 'stone' }, 'worktable');
shaped('minecart', 1, ['I I', 'III'], { I: 'iron_ingot' }, 'worktable');
shaped('boat', 1, ['P P', 'PPP'], { P: 'oak_planks' }, 'worktable');

// ── Enchanting supplies ────────────────────────────────────────────
shaped('paper', 3, ['SSS'], { S: 'sugar_cane' }, 'worktable');
shapeless('book', 1, ['paper', 'paper', 'paper', 'leather']);
shaped('bookshelf', 1, ['PPP', 'BBB', 'PPP'], { P: 'oak_planks', B: 'book' }, 'worktable');
shaped('lapis_block', 1, ['LLL', 'LLL', 'LLL'], { L: 'lapis_lazuli' }, 'worktable');
shapeless('lapis_lazuli', 9, ['lapis_block']);

// ── Gold ───────────────────────────────────────────────────────────
SMELT.raw_gold = { out: 'gold_ingot', count: 1 };
shaped('gold_block', 1, ['GGG', 'GGG', 'GGG'], { G: 'gold_ingot' }, 'worktable');
shapeless('gold_ingot', 9, ['gold_block']);
shaped('gold_ingot', 1, ['NNN', 'NNN', 'NNN'], { N: 'gold_nugget' }, 'worktable');
shapeless('gold_nugget', 9, ['gold_ingot']);
shaped('golden_apple', 1, ['GGG', 'GAG', 'GGG'], { G: 'gold_ingot', A: 'apple' }, 'worktable');
shaped('golden_carrot', 1, ['NNN', 'NCN', 'NNN'], { N: 'gold_nugget', C: 'carrot' }, 'worktable');

// ── Trident + elytra (obtainable here; found, not crafted, in Minecraft) ──
shaped('trident', 1, ['I I', 'III', ' I '], { I: 'iron_ingot' }, 'worktable');
shaped('elytra', 1, ['L L', 'LSL', 'L L'], { L: 'leather', S: 'string' }, 'worktable');

shapeless('flint_and_steel', 1, ['iron_ingot', 'flint']);           // MC-accurate alt
shaped('tnt', 1, ['GSG', 'SGS', 'GSG'], { G: 'gunpowder', S: 'sand' }, 'worktable');
shaped('enchanting_table', 1, [' D ', 'DOD', 'OOO'], { D: 'diamond', O: 'obsidian' }, 'worktable');

// ── Brewing (via the crafting table, simplified) ──────────────────
shaped('glass_bottle', 3, ['G G', ' G '], { G: 'glass' }, 'worktable');
shapeless('magma_cream', 1, ['slimeball', 'netherite_scrap']);
shapeless('awkward_potion', 1, ['water_bottle', 'nether_wart'], 'worktable');
shapeless('potion_healing', 1, ['awkward_potion', 'sweet_berries'], 'worktable');
shapeless('potion_regeneration', 1, ['awkward_potion', 'glowstone_dust'], 'worktable');
shapeless('potion_strength', 1, ['awkward_potion', 'netherite_scrap'], 'worktable');
shapeless('potion_swiftness', 1, ['awkward_potion', 'feather'], 'worktable');
shapeless('potion_fire_resistance', 1, ['awkward_potion', 'magma_cream'], 'worktable');
shapeless('potion_poison', 1, ['awkward_potion', 'spider_eye'], 'worktable');
for (const [tier, mat] of [['leather', 'leather'], ['iron', 'iron_ingot'], ['diamond', 'diamond']]) {
  shaped(`${tier}_helmet`, 1, ['MMM', 'M M'], { M: mat }, 'worktable');
  shaped(`${tier}_chestplate`, 1, ['M M', 'MMM', 'MMM'], { M: mat }, 'worktable');
  shaped(`${tier}_leggings`, 1, ['MMM', 'M M', 'M M'], { M: mat }, 'worktable');
  shaped(`${tier}_boots`, 1, ['M M', 'M M'], { M: mat }, 'worktable');
}

// ── Mod registration ─────────────────────────────────────────────
export function registerShaped(out, count, pattern, keyMap, station = null) {
  shaped(out, count, pattern, keyMap, station);
}
export function registerShapeless(out, count, ingredients, station = null) {
  shapeless(out, count, ingredients, station);
}

// ── Matching ──────────────────────────────────────────────────────
const matches = (want, have) =>
  Array.isArray(want) ? want.includes(have) : want === have;

// grid: array of item keys (null for empty), size×size row-major.
export function matchRecipe(grid, size, station) {
  // Trim grid to bounding box
  let minR = size, maxR = -1, minC = size, maxC = -1;
  const keys = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const k = grid[r * size + c];
      if (k) {
        keys.push(k);
        if (r < minR) minR = r; if (r > maxR) maxR = r;
        if (c < minC) minC = c; if (c > maxC) maxC = c;
      }
    }
  }
  if (keys.length === 0) return null;

  for (const recipe of RECIPES) {
    if (recipe.station && recipe.station !== station) continue;
    if (recipe.type === 'shapeless') {
      if (shapelessMatch(recipe, keys)) return recipe;
    } else {
      if (shapedMatch(recipe, grid, size, minR, maxR, minC, maxC)) return recipe;
    }
  }
  return null;
}

function shapelessMatch(recipe, keys) {
  if (recipe.ingredients.length !== keys.length) return false;
  const pool = [...keys];
  for (const want of recipe.ingredients) {
    const idx = pool.findIndex((k) => matches(want, k));
    if (idx < 0) return false;
    pool.splice(idx, 1);
  }
  return true;
}

function shapedMatch(recipe, grid, size, minR, maxR, minC, maxC) {
  const rows = recipe.pattern.length;
  const cols = Math.max(...recipe.pattern.map((r) => r.length));
  if (maxR - minR + 1 !== rows || maxC - minC + 1 !== cols) return false;
  if (rows > size || cols > size) return false;
  const tryMatch = (mirror) => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const pc = mirror ? cols - 1 - c : c;
        const ch = recipe.pattern[r][pc] ?? ' ';
        const want = ch === ' ' ? null : recipe.keyMap[ch];
        const have = grid[(minR + r) * size + (minC + c)];
        if (want === null) { if (have) return false; }
        else if (!have || !matches(want, have)) return false;
      }
    }
    return true;
  };
  return tryMatch(false) || tryMatch(true);
}

// Recipes craftable at a station (for the recipe book UI).
export function recipesForStation(station) {
  return RECIPES.filter((r) =>
    r.station === null || r.station === station ||
    (station === 'worktable' && r.station === null));
}
