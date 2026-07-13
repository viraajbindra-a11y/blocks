// Deterministic multi-chunk structures: villages, desert temples, strongholds.
//
// Chunks generate independently in the worker, so structures are placed by a
// region grid: each CELL-sized cell deterministically decides (from the seed)
// whether it holds a structure and its exact world origin + type. Every chunk
// that overlaps a structure redraws its own slice through `set` (which clips
// out-of-bounds writes), so a structure spans chunk borders seamlessly without
// any neighbor writes.

import { B } from '../../blocks.js';

const CELL = 40;                    // one structure candidate per 40×40 area
const MAX_R = 14;                   // largest structure half-footprint (for chunk overlap)

// Stable [0,1) hash for a cell + salt.
function cellRand(gx, gz, seed, salt) {
  let h = (gx * 374761393 + gz * 668265263 + seed * 2246822519 + salt * 3266489917) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A filled box (walls solid; hollow leaves an air interior).
function box(set, x0, y0, z0, x1, y1, z1, id, hollow) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const edge = x === x0 || x === x1 || z === z0 || z === z1 || y === y0 || y === y1;
        if (!hollow || edge) set(x, y, z, id, true);
        else set(x, y, z, B.AIR, true);
      }
}

// ── Village: a cluster of small plank huts + a cobblestone well ──────
function village(set, rng, sx, sy, sz) {
  const n = 3 + (rng() * 2 | 0);
  const placed = [];
  for (let i = 0; i < n; i++) {
    let hx, hz, tries = 0;
    do {
      hx = sx + ((rng() * 24 | 0) - 12);
      hz = sz + ((rng() * 24 | 0) - 12);
      tries++;
    } while (tries < 6 && placed.some(p => Math.abs(p[0] - hx) < 7 && Math.abs(p[1] - hz) < 7));
    placed.push([hx, hz]);
    hut(set, rng, hx, sy, hz);
  }
  // Central well.
  box(set, sx - 1, sy, sz - 1, sx + 1, sy, sz + 1, B.COBBLESTONE, false);
  set(sx, sy, sz, B.WATER, true);
  box(set, sx - 1, sy + 1, sz - 1, sx + 1, sy + 3, sz + 1, B.COBBLESTONE, true);
}

function hut(set, rng, x, y, z) {
  const wall = rng() < 0.5 ? B.OAK_PLANKS : B.COBBLESTONE;
  // Foundation + walls (5×5, 3 tall), hollow interior.
  box(set, x - 2, y, z - 2, x + 2, y, z + 2, B.COBBLESTONE, false);
  box(set, x - 2, y + 1, z - 2, x + 2, y + 3, z + 2, wall, true);
  // Doorway (a 1×2 gap on the south wall) + a glass window opposite.
  set(x, y + 1, z + 2, B.AIR, true); set(x, y + 2, z + 2, B.AIR, true);
  set(x, y + 2, z - 2, B.GLASS, true);
  // Flat plank roof, one block proud.
  box(set, x - 3, y + 4, z - 3, x + 3, y + 4, z + 3, B.OAK_PLANKS, false);
  set(x, y + 5, z, B.LANTERN, true);
}

// ── Desert temple: a stepped sandstone block with terracotta trim ──
function desertTemple(set, rng, sx, sy, sz) {
  for (let step = 0; step < 4; step++) {
    const r = 5 - step;
    box(set, sx - r, sy + step * 2, sz - r, sx + r, sy + step * 2 + 1, sz + r, B.SANDSTONE, false);
  }
  // Orange/blue terracotta face pattern (classic look).
  for (let dx = -1; dx <= 1; dx++) {
    set(sx + dx, sy + 1, sz - 5, dx === 0 ? B.BLUE_TERRACOTTA : B.ORANGE_TERRACOTTA, true);
    set(sx + dx, sy + 2, sz - 5, dx === 0 ? B.ORANGE_TERRACOTTA : B.BLUE_TERRACOTTA, true);
  }
  // Hollow treasure chamber below, with a chest.
  box(set, sx - 2, sy - 4, sz - 2, sx + 2, sy - 1, sz + 2, B.SANDSTONE, true);
  set(sx, sy - 3, sz, B.CHEST, true);
  set(sx, sy - 3, sz - 1, B.TNT, true);            // the classic trap
}

// ── Stronghold: a buried stone-brick room with a chest ─────────────
function stronghold(set, rng, sx, sy, sz) {
  const y0 = Math.max(6, sy - 20);
  box(set, sx - 3, y0, sz - 3, sx + 3, y0 + 4, sz + 3, B.STONE_BRICKS, true);
  // Weather the walls with cracked / mossy bricks.
  for (let i = 0; i < 24; i++) {
    const x = sx - 3 + (rng() * 7 | 0), z = sz - 3 + (rng() * 7 | 0), y = y0 + (rng() * 5 | 0);
    if (x === sx - 3 || x === sx + 3 || z === sz - 3 || z === sz + 3)
      set(x, y, z, rng() < 0.5 ? B.CRACKED_STONE_BRICKS : B.MOSSY_STONE_BRICKS, true);
  }
  set(sx, y0 + 1, sz, B.CHEST, true);
  set(sx - 2, y0 + 1, sz - 2, B.LANTERN, true);
}

// Decide the structure (if any) for a region cell.
function structureFor(gx, gz, seed, heightAt, biomeAt) {
  if (cellRand(gx, gz, seed, 1) > 0.34) return null;      // ~1 in 3 cells
  const jx = (cellRand(gx, gz, seed, 2) * (CELL - 24) | 0) + 12;
  const jz = (cellRand(gx, gz, seed, 3) * (CELL - 24) | 0) + 12;
  const sx = gx * CELL + jx, sz = gz * CELL + jz;
  const sy = heightAt(sx, sz);
  const biome = biomeAt(sx, sz);
  const roll = cellRand(gx, gz, seed, 4);
  const rng = mulberry((sx * 73856093 ^ sz * 19349663 ^ seed) >>> 0);
  // BIOME ids (see terrain.js): PLAINS 2, FOREST 3, DESERT 4.
  // Deserts get temples; flat green land gets villages; else a rare stronghold.
  if (biome === 4) return { type: 'desert_temple', sx, sy, sz, rng };
  if ((biome === 2 || biome === 3) && roll < 0.7) return { type: 'village', sx, sy, sz, rng };
  if (roll < 0.25) return { type: 'stronghold', sx, sy, sz, rng };
  return null;
}

// Draw every structure overlapping this chunk (parts outside are clipped).
export function placeStructures(cx, cz, seed, heightAt, biomeAt, set) {
  const ox = cx * 16, oz = cz * 16;
  const g0x = Math.floor((ox - MAX_R) / CELL), g1x = Math.floor((ox + 15 + MAX_R) / CELL);
  const g0z = Math.floor((oz - MAX_R) / CELL), g1z = Math.floor((oz + 15 + MAX_R) / CELL);
  for (let gx = g0x; gx <= g1x; gx++) {
    for (let gz = g0z; gz <= g1z; gz++) {
      const s = structureFor(gx, gz, seed, heightAt, biomeAt);
      if (!s || s.sy < 2) continue;
      if (s.type === 'village') village(set, s.rng, s.sx, s.sy + 1, s.sz);
      else if (s.type === 'desert_temple') desertTemple(set, s.rng, s.sx, s.sy + 1, s.sz);
      else stronghold(set, s.rng, s.sx, s.sy, s.sz);
    }
  }
}
