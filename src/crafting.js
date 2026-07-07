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
const ANY_PLANK = ['oak_planks'];

// ── Basics ────────────────────────────────────────────────────────
shapeless('oak_planks', 4, [ANY_LOG]);
shaped('stick', 4, ['P', 'P'], { P: 'oak_planks' });
shaped('crafting_table', 1, ['PP', 'PP'], { P: 'oak_planks' });
shaped('furnace', 1, ['RRR', 'R R', 'RRR'], { R: 'cobblestone' }, 'worktable');

// ── Tools (crafting table) ────────────────────────────────────────
const toolMats = {
  wooden: 'oak_planks', stone: 'cobblestone', copper: 'copper_ingot',
  iron: 'iron_ingot', netherite: 'netherite_ingot',
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
  oak_log: { out: 'coal', count: 1 },      // → charcoal
  spruce_log: { out: 'coal', count: 1 },   // → charcoal
  end_stone: { out: 'end_glass', count: 1 },
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
