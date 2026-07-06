// Data-driven crafting. Two recipe forms:
//  - shaped:    pattern rows + key map (letters → item key or [alternatives])
//  - shapeless: flat ingredient list (multiset match)
// station: null (pocket 2×2) | 'worktable' (3×3) | 'kiln' (processing)

export const RECIPES = [];

function shaped(out, count, pattern, keyMap, station = null) {
  RECIPES.push({ type: 'shaped', out, count, pattern, keyMap, station });
}
function shapeless(out, count, ingredients, station = null) {
  RECIPES.push({ type: 'shapeless', out, count, ingredients, station });
}

const ANY_LOG = ['alder_log', 'fern_log'];
const ANY_PLANK = ['planks'];

// ── Basics ────────────────────────────────────────────────────────
shapeless('planks', 4, [ANY_LOG]);
shaped('rod', 4, ['P', 'P'], { P: 'planks' });
shaped('worktable', 1, ['PP', 'PP'], { P: 'planks' });
shaped('kiln', 1, ['RRR', 'R R', 'RRR'], { R: 'rubble' }, 'worktable');

// ── Tools (worktable) ─────────────────────────────────────────────
const toolMats = {
  timber: 'planks', stone: 'rubble', copper: 'copper_ingot',
  iron: 'iron_ingot', sunsteel: 'sunsteel_ingot',
};
for (const [tier, mat] of Object.entries(toolMats)) {
  shaped(`pick_${tier}`, 1, ['MMM', ' R ', ' R '], { M: mat, R: 'rod' }, 'worktable');
  shaped(`axe_${tier}`, 1, ['MM', 'MR', ' R'], { M: mat, R: 'rod' }, 'worktable');
  shaped(`shovel_${tier}`, 1, ['M', 'R', 'R'], { M: mat, R: 'rod' }, 'worktable');
  shaped(`hoe_${tier}`, 1, ['MM', ' R', ' R'], { M: mat, R: 'rod' }, 'worktable');
  shaped(`blade_${tier}`, 1, ['M', 'M', 'R'], { M: mat, R: 'rod' }, 'worktable');
}

// ── Building & light ──────────────────────────────────────────────
shaped('hewnstone', 4, ['SS', 'SS'], { S: 'stone' }, 'worktable');
shaped('copper_block', 1, ['II', 'II'], { I: 'copper_ingot' }, 'worktable');
shaped('iron_block', 1, ['II', 'II'], { I: 'iron_ingot' }, 'worktable');
shaped('sunstone_block', 1, ['SS', 'SS'], { S: 'sunstone' }, 'worktable');
shapeless('copper_ingot', 4, ['copper_block']);
shapeless('iron_ingot', 4, ['iron_block']);
shaped('lantern', 2, ['D', 'G', 'C'], { D: 'glimmer_dust', G: 'glass', C: 'copper_ingot' }, 'worktable');

// ── Kiln processing (fuel is part of the recipe) ──────────────────
shapeless('stone', 4, ['rubble', 'rubble', 'rubble', 'rubble', 'coal'], 'kiln');
shapeless('glass', 4, ['sand', 'sand', 'sand', 'sand', 'coal'], 'kiln');
shapeless('brick', 2, ['clay_lump', 'clay_lump', 'coal'], 'kiln');
shapeless('copper_ingot', 1, ['copper_ore_chunk', 'coal'], 'kiln');
shapeless('iron_ingot', 1, ['iron_ore_chunk', 'coal'], 'kiln');
shapeless('tuber_roast', 1, ['tuber', 'coal'], 'kiln');
shapeless('meat_roast', 1, ['meat_raw', 'coal'], 'kiln');
shapeless('coal', 2, [ANY_LOG, ANY_LOG], 'kiln');   // charcoal burn
shapeless('sunsteel_ingot', 1, ['smolder_shard', 'iron_ingot', 'coal'], 'kiln');
shapeless('clay_vessel', 1, ['clay_lump', 'clay_lump', 'clay_lump', 'coal'], 'kiln');
shapeless('voidglass', 4, ['voidstone', 'voidstone', 'voidstone', 'voidstone', 'coal'], 'kiln');

// ── Wave 2 utility ────────────────────────────────────────────────
shaped('wisp_torch', 4, ['C', 'R'], { C: 'coal', R: 'rod' });
shaped('rungs', 3, ['R R', 'RRR', 'R R'], { R: 'rod' }, 'worktable');
shapeless('bedroll', 1, ['hide', 'hide', 'planks']);
shaped('stowbox', 1, ['PPP', 'P P', 'PPP'], { P: 'planks' }, 'worktable');
shapeless('kindle_flint', 1, ['iron_ingot', 'rubble']);
shaped('scorchbrick', 4, ['SS', 'SS'], { S: 'scorchstone' }, 'worktable');

// ── Shaped blocks: ledges (slabs) & steps (stairs) ────────────────
// Ledges: 3 of a material in a row → 6 ledges. Steps: a 6-block stair
// pattern → 4 steps. Outputs are the shared shaped-block item keys.
for (const [mat, base] of [['planks', 'plank'], ['rubble', 'rubble'], ['scorchbrick', 'scorchbrick']]) {
  shaped(`${base}_ledge`, 6, ['MMM'], { M: mat }, 'worktable');
  shaped(`${base}_step`, 4, ['M  ', 'MM ', 'MMM'], { M: mat }, 'worktable');
}

// ── Auto-connecting shapes: palings, gate & ramparts ──────────────
// Palings & ramparts: two rows of the base material split by a rod core
// yield a run of connecting sections. The gate frames its opening with
// rods around a plank leaf.
shaped('timber_paling', 3, ['PRP', 'PRP'], { P: 'planks', R: 'rod' }, 'worktable');
shaped('timber_gate', 1, ['RPR', 'RPR'], { R: 'rod', P: 'planks' }, 'worktable');
shaped('rubble_rampart', 6, ['RRR', 'RRR'], { R: 'rubble' }, 'worktable');
shaped('hewnstone_rampart', 6, ['HHH', 'HHH'], { H: 'hewnstone' }, 'worktable');

// ── Rotational & thin openables: doors, flaps & panes ─────────────
// Doorleaves: two columns of the base material yield a leaf. Flapgates:
// a low slab of material. Panes: a wide+tall block of glass cut into a
// grid of thin panes (fence-style yield).
shaped('timber_door', 1, ['PP', 'PP', 'PP'], { P: 'planks' }, 'worktable');
shaped('ironbound_door', 1, ['II', 'II', 'II'], { I: 'iron_ingot' }, 'worktable');
shaped('timber_flap', 2, ['PPP', 'PPP'], { P: 'planks' }, 'worktable');
shaped('ironbound_flap', 2, ['III', 'III'], { I: 'iron_ingot' }, 'worktable');
shaped('glass_pane', 16, ['GGG', 'GGG'], { G: 'glass' }, 'worktable');
shaped('voidglass_pane', 16, ['GGG', 'GGG'], { G: 'voidglass' }, 'worktable');

shaped('dawn_beacon', 1, [' S ', 'SCS', ' S '], { S: 'sunstone_block', C: 'sovereign_core' }, 'worktable');

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
