// Procedural terrain generation. Deterministic per seed: the same seed
// always produces the same world, regardless of chunk generation order.
// Runs inside the generation worker; the main thread also imports it for
// spawn finding and biome queries.

import {
  CHUNK_X, CHUNK_Y, CHUNK_Z, CHUNK_VOL, SEA_LEVEL, bIdx,
} from '../../core/constants.js';
import { Simplex, mulberry32, hash2, hash3, normalizeSeed, clamp, lerp, smoothstep } from '../../math/noise.js';
import { B, waterFlowId, opaqueAt } from '../../blocks.js';
import { placeAlder, placeFern, placeSpineplant, placeBroadleaf } from './features.js';
import { placeStructures } from './structures.js';

export const BIOME = {
  OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, DESERT: 4,
  SWAMP: 5, TUNDRA: 6, MOUNTAIN: 7, RIVER: 8,
};
export const BIOME_NAMES = ['Ocean', 'Shore', 'Meadow', 'Alderwood', 'Duneland', 'Mirebog', 'Frostfell', 'Highreach', 'River'];

/**
 * @param rawSeed world seed
 * @param decorations mod surface decorations (declarative, so they can be
 *        shipped to gen workers as plain data):
 *        [{biomes:[biomeIds], blockId, chance, placeOn:[blockIds]|null}]
 */
export function makeGenerator(rawSeed, decorations = []) {
  const seed = normalizeSeed(rawSeed);
  const nCont   = new Simplex(seed ^ 0x9e3779b9);
  const nHills  = new Simplex(seed + 101);
  const nPeaks  = new Simplex(seed + 202);
  const nTemp   = new Simplex(seed + 303);
  const nMoist  = new Simplex(seed + 404);
  const nRiver  = new Simplex(seed + 505);
  const nCaveA  = new Simplex(seed + 606);
  const nCaveB  = new Simplex(seed + 707);
  const nCavern = new Simplex(seed + 808);
  const nRavine = new Simplex(seed + 909);
  const nDetail = new Simplex(seed + 1010);

  // ── Column-level queries ────────────────────────────────────────
  function columnInfo(wx, wz) {
    const cont = nCont.fbm2(wx * 0.0011, wz * 0.0011, 4);
    const hillNoise = nHills.fbm2(wx * 0.006, wz * 0.006, 4);
    const ero = (nHills.fbm2(wx * 0.0021 + 900, wz * 0.0021 - 900, 3) + 1) / 2;
    const detail = nDetail.fbm2(wx * 0.045, wz * 0.045, 2);

    let h = SEA_LEVEL + 4 + cont * 26;
    h += hillNoise * (5 + 13 * ero) * smoothstep(-0.12, 0.25, cont);

    const mMask = smoothstep(0.16, 0.5, cont) * ero;
    const ridge = nPeaks.ridge2(wx * 0.0038, wz * 0.0038, 4);
    const peaks = Math.pow(Math.max(0, ridge - 0.35) / 0.65, 2.2) * 64 * mMask;
    h += peaks + detail * 2;

    // Rivers: carve where a low-frequency noise crosses zero.
    const rv = Math.abs(nRiver.fbm2(wx * 0.0016, wz * 0.0016, 2));
    const riverW = 0.03;
    let riverT = 0;
    if (rv < riverW && h > SEA_LEVEL - 8) {
      riverT = smoothstep(riverW, riverW * 0.35, rv);
      h = lerp(h, SEA_LEVEL - 3.5, riverT);
    }

    h = clamp(Math.round(h), 8, CHUNK_Y - 10);

    const temp = nTemp.fbm2(wx * 0.0008, wz * 0.0008, 3) - Math.max(0, h - 72) * 0.012;
    const moist = nMoist.fbm2(wx * 0.001, wz * 0.001, 3);

    let biome;
    if (riverT > 0.6 && h <= SEA_LEVEL - 1) biome = BIOME.RIVER;
    else if (h < SEA_LEVEL - 3) biome = BIOME.OCEAN;
    else if (h <= SEA_LEVEL + 1) {
      biome = (moist > 0.34 && temp > 0.05) ? BIOME.SWAMP
            : (temp < -0.32 ? BIOME.TUNDRA : BIOME.BEACH);
    }
    else if (peaks > 26 || h > SEA_LEVEL + 44) biome = BIOME.MOUNTAIN;
    else if (temp < -0.32) biome = BIOME.TUNDRA;
    else if (temp > 0.32 && moist < -0.02) biome = BIOME.DESERT;
    else if (moist > 0.34 && temp > 0.05 && h < SEA_LEVEL + 9) biome = BIOME.SWAMP;
    else if (moist > 0.02) biome = BIOME.FOREST;
    else biome = BIOME.PLAINS;

    return { h, biome, temp, moist };
  }

  const heightAt = (wx, wz) => columnInfo(wx, wz).h;
  const biomeAt = (wx, wz) => columnInfo(wx, wz).biome;

  // ── Full chunk generation ───────────────────────────────────────
  function generateChunk(cx, cz) {
    const blocks = new Uint16Array(CHUNK_VOL);
    const hmap = new Uint8Array(CHUNK_X * CHUNK_Z);
    const biomes = new Uint8Array(CHUNK_X * CHUNK_Z);
    const heights = new Int16Array(CHUNK_X * CHUNK_Z);
    const ox = cx * CHUNK_X, oz = cz * CHUNK_Z;

    // 1. Base column fill
    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        const wx = ox + x, wz = oz + z;
        const { h, biome } = columnInfo(wx, wz);
        const ci = z * CHUNK_X + x;
        heights[ci] = h;
        biomes[ci] = biome;

        const bedrockTop = 1 + (hash2(wx, wz, seed) * 2 | 0);
        for (let y = 0; y <= bedrockTop; y++) blocks[bIdx(x, y, z)] = B.CORESTONE;

        for (let y = bedrockTop + 1; y <= h; y++) {
          const depth = h - y;
          let id = B.STONE;
          switch (biome) {
            case BIOME.OCEAN:
            case BIOME.RIVER:
              if (depth === 0) id = hash2(wx, wz, seed + 7) < 0.35 ? B.GRAVEL
                    : hash2(wx, wz, seed + 8) < 0.2 ? B.CLAY : B.SAND;
              else if (depth < 3) id = B.SAND;
              break;
            case BIOME.BEACH:
              if (depth < 4) id = B.SAND;
              break;
            case BIOME.DESERT:
              if (depth < 4) id = B.SAND;
              else if (depth < 9) id = B.DUSTSTONE;
              break;
            case BIOME.TUNDRA:
              if (depth === 0) id = B.SNOW;
              else if (depth < 4) id = B.SOIL;
              break;
            case BIOME.SWAMP:
              if (depth === 0) id = hash2(wx, wz, seed + 9) < 0.45 ? B.MUD : B.GRASS;
              else if (depth < 4) id = hash2(wx, wz, seed + 10) < 0.3 ? B.MUD : B.SOIL;
              break;
            case BIOME.MOUNTAIN:
              if (h > SEA_LEVEL + 40 && depth < 2) id = h > SEA_LEVEL + 46 ? B.SNOW : B.STONE;
              else if (h <= SEA_LEVEL + 40 && depth === 0) id = B.GRASS;
              else if (h <= SEA_LEVEL + 40 && depth < 3) id = B.SOIL;
              break;
            default: // PLAINS, FOREST
              if (depth === 0) id = B.GRASS;
              else if (depth < 4) id = B.SOIL;
          }
          blocks[bIdx(x, y, z)] = id;
        }

        // Water fill up to sea level
        for (let y = h + 1; y < SEA_LEVEL; y++) blocks[bIdx(x, y, z)] = B.WATER;
        // Frozen surfaces in the cold
        if (biome === BIOME.TUNDRA && h < SEA_LEVEL - 1) {
          blocks[bIdx(x, SEA_LEVEL - 1, z)] = B.ICE;
        }
      }
    }

    // 2. Caves, caverns, ravines (skip near ocean floors to avoid flooding)
    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        const ci = z * CHUNK_X + x;
        const h = heights[ci];
        const wx = ox + x, wz = oz + z;
        const nearWater = h < SEA_LEVEL + 2;
        const rav = Math.abs(nRavine.fbm2(wx * 0.0028, wz * 0.0028, 2));

        const maxY = nearWater ? h - 4 : h + 1;
        for (let y = 4; y <= maxY && y < CHUNK_Y; y++) {
          const i = bIdx(x, y, z);
          const id = blocks[i];
          if (id === B.AIR || id === B.WATER || id === B.CORESTONE) continue;

          let carve = false;
          // Winding tunnels: intersection of two noise "surfaces"
          const a = nCaveA.noise3D(wx * 0.014, y * 0.024, wz * 0.014);
          if (Math.abs(a) < 0.09) {
            const b = nCaveB.noise3D(wx * 0.014, y * 0.024, wz * 0.014);
            if (Math.abs(b) < 0.09) carve = true;
          }
          // Big caverns down deep
          if (!carve && y < 42) {
            const c = nCavern.fbm3(wx * 0.017, y * 0.024, wz * 0.017, 2);
            if (c > 0.44 + y * 0.004) carve = true;
          }
          // Ravines: V-shaped slots through the surface
          if (!carve && !nearWater && rav < 0.011 && y > 14) {
            const half = 0.0115 * smoothstep(14, h, y);
            if (rav < half) carve = true;
          }
          if (carve) blocks[i] = y <= 10 ? B.LAVA : B.AIR;
        }
      }
    }

    // 3. Ore veins + pockets (random walks, chunk-seeded)
    const rng = mulberry32((normalizeSeed(seed) ^ (cx * 341873128) ^ (cz * 132897987)) >>> 0);
    const vein = (ore, yMin, yMax, size) => {
      let x = rng() * CHUNK_X, y = yMin + rng() * (yMax - yMin), z = rng() * CHUNK_Z;
      for (let s = 0; s < size; s++) {
        const bx = x | 0, by = y | 0, bz = z | 0;
        for (const [dx, dy, dz] of [[0,0,0],[1,0,0],[0,1,0],[0,0,1]]) {
          const px = bx + dx, py = by + dy, pz = bz + dz;
          if (px < 0 || px > 15 || pz < 0 || pz > 15 || py < 1 || py > 126) continue;
          const i = bIdx(px, py, pz);
          if (blocks[i] === B.STONE) blocks[i] = ore;
        }
        x += (rng() - 0.5) * 2.4; y += (rng() - 0.5) * 1.6; z += (rng() - 0.5) * 2.4;
      }
    };
    for (let v = 0; v < 11; v++) vein(B.COAL_ORE, 8, 96, 4 + rng() * 5);
    for (let v = 0; v < 8; v++)  vein(B.COPPER_ORE, 6, 60, 3 + rng() * 4);
    for (let v = 0; v < 6; v++)  vein(B.IRON_ORE, 4, 38, 2 + rng() * 3);
    if (rng() < 0.75) vein(B.SUNSTONE_ORE, 4, 14, 1 + rng() * 2);
    if (rng() < 0.14) vein(B.EMERALD_ORE, 6, 30, 1 + (rng() * 2 | 0));   // rare, single-ish
    for (let v = 0; v < 2; v++) vein(B.LAPIS_ORE, 6, 34, 3 + rng() * 3);   // deep, small pockets
    for (let v = 0; v < 2; v++) vein(B.GOLD_ORE, 4, 30, 3 + rng() * 3);    // deep gold
    for (let v = 0; v < 4; v++)  vein(B.SOIL, 24, 72, 5 + rng() * 5);
    for (let v = 0; v < 3; v++)  vein(B.GRAVEL, 12, 64, 4 + rng() * 5);
    for (let v = 0; v < 2; v++)  vein(B.MOSSROCK, 30, 60, 3 + rng() * 4);

    // Glowmoss on cave walls
    for (let t = 0; t < 40; t++) {
      const x = rng() * 16 | 0, z = rng() * 16 | 0;
      const y = 6 + rng() * 44 | 0;
      const i = bIdx(x, y, z);
      if (blocks[i] !== B.STONE) continue;
      let touchesAir = false;
      if (y < 127 && blocks[bIdx(x, y + 1, z)] === B.AIR) touchesAir = true;
      if (!touchesAir && y > 1 && blocks[bIdx(x, y - 1, z)] === B.AIR) touchesAir = true;
      if (!touchesAir && x > 0 && blocks[bIdx(x - 1, y, z)] === B.AIR) touchesAir = true;
      if (!touchesAir && x < 15 && blocks[bIdx(x + 1, y, z)] === B.AIR) touchesAir = true;
      if (!touchesAir && z > 0 && blocks[bIdx(x, y, z - 1)] === B.AIR) touchesAir = true;
      if (!touchesAir && z < 15 && blocks[bIdx(x, y, z + 1)] === B.AIR) touchesAir = true;
      if (touchesAir && rng() < 0.5) blocks[i] = B.GLOWMOSS;
    }

    // 4. Surface decoration. Trees keep a 2-block margin so canopies
    //    stay inside the chunk (deterministic without neighbor writes).
    const setLocal = (wx2, wy, wz2, id, force) => {
      const lx = wx2 - ox, lz = wz2 - oz;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || wy < 0 || wy > 127) return;
      const i = bIdx(lx, wy, lz);
      if (force || blocks[i] === B.AIR) blocks[i] = id;
    };
    const getLocal = (wx2, wy, wz2) => {
      const lx = wx2 - ox, lz = wz2 - oz;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || wy < 0 || wy > 127) return B.AIR;
      return blocks[bIdx(lx, wy, lz)];
    };

    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        const ci = z * CHUNK_X + x;
        const h = heights[ci];
        const biome = biomes[ci];
        if (h < SEA_LEVEL) continue;
        const surf = blocks[bIdx(x, h, z)];
        const above = bIdx(x, h + 1, z);
        if (blocks[above] !== B.AIR) continue;
        const wx = ox + x, wz = oz + z;
        const r1 = hash2(wx, wz, seed + 21);
        const r2 = hash2(wx, wz, seed + 22);
        const treeOk = x >= 2 && x <= 13 && z >= 2 && z <= 13 &&
                       (surf === B.GRASS || surf === B.SOIL || surf === B.SNOW || surf === B.MUD);
        const treeRand = mulberry32((wx * 73856093 ^ wz * 19349663 ^ seed) >>> 0);

        switch (biome) {
          case BIOME.FOREST:
            if (treeOk && r1 < 0.055) {
              (r2 < 0.7 ? placeAlder : placeFern)(setLocal, getLocal, treeRand, wx, h + 1, wz, false);
            } else if (treeOk && r1 < 0.075) {
              placeBroadleaf(setLocal, getLocal, treeRand, wx, h + 1, wz, B.BIRCH_LOG, B.BIRCH_LEAVES, 6, 8, 2);
            } else if (surf === B.GRASS) {
              if (r1 < 0.16) blocks[above] = B.TALLGRASS;
              else if (r1 < 0.175) blocks[above] = B.BERRYBUSH_RIPE;
              else if (r1 < 0.19) blocks[above] = r2 < 0.5 ? B.EMBERBLOOM : B.AZUREBELL;
            }
            break;
          case BIOME.PLAINS:
            if (treeOk && r1 < 0.004) placeAlder(setLocal, getLocal, treeRand, wx, h + 1, wz, false);
            else if (treeOk && r1 < 0.007) placeBroadleaf(setLocal, getLocal, treeRand, wx, h + 1, wz, B.ACACIA_LOG, B.ACACIA_LEAVES, 5, 7, 3);
            else if (surf === B.GRASS) {
              if (r1 < 0.1) blocks[above] = B.TALLGRASS;
              else if (r1 < 0.12) blocks[above] = r2 < 0.5 ? B.EMBERBLOOM : B.AZUREBELL;
              else if (r1 < 0.125) blocks[above] = B.BERRYBUSH_RIPE;
            }
            break;
          case BIOME.SWAMP:
            if (treeOk && r1 < 0.03) placeAlder(setLocal, getLocal, treeRand, wx, h + 1, wz, true);
            else if (treeOk && r1 < 0.05) placeBroadleaf(setLocal, getLocal, treeRand, wx, h + 1, wz, B.JUNGLE_LOG, B.JUNGLE_LEAVES, 8, 12, 3);
            else if (r1 < 0.14 && (surf === B.GRASS || surf === B.SOIL)) blocks[above] = B.TALLGRASS;
            break;
          case BIOME.DESERT:
            if (r1 < 0.006 && surf === B.SAND) placeSpineplant(setLocal, getLocal, treeRand, wx, h + 1, wz);
            else if (r1 < 0.016 && surf === B.SAND) blocks[above] = B.DEADBUSH;
            break;
          case BIOME.TUNDRA:
            if (treeOk && r1 < 0.014) placeFern(setLocal, getLocal, treeRand, wx, h + 1, wz);
            else if (r1 < 0.02 && surf === B.SNOW) blocks[above] = B.DEADBUSH;
            break;
          case BIOME.MOUNTAIN:
            if (treeOk && r1 < 0.008 && h < SEA_LEVEL + 34) placeFern(setLocal, getLocal, treeRand, wx, h + 1, wz);
            break;
        }

        // Mod surface decorations (after vanilla, only into still-empty cells)
        for (let di = 0; di < decorations.length; di++) {
          const deco = decorations[di];
          if (blocks[above] !== B.AIR) break;
          if (!deco.biomes.includes(biome)) continue;
          if (hash2(wx, wz, seed + 50021 + di * 977) >= deco.chance) continue;
          const surfNow = blocks[bIdx(x, h, z)];
          if (deco.placeOn && deco.placeOn.length && !deco.placeOn.includes(surfNow)) continue;
          blocks[above] = deco.blockId;
        }
      }
    }

    // 4b. Structures (villages / desert temples / strongholds). Deterministic
    //     from the seed, drawn via setLocal so they clip to this chunk and
    //     span chunk borders without any neighbor writes.
    placeStructures(cx, cz, seed, heightAt, biomeAt, setLocal);

    // 5. Final heightmap: highest opaque block per column — must match
    //    computeHeightmap (chunk.js) and setBlock upkeep semantics exactly,
    //    or heightAt() changes meaning after a save/reload round-trip.
    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        let y = CHUNK_Y - 1;
        while (y > 0 && !opaqueAt(blocks[bIdx(x, y, z)])) y--;
        hmap[z * CHUNK_X + x] = y;
      }
    }

    return { blocks, hmap, biomes };
  }

  return { seed, heightAt, biomeAt, columnInfo, generateChunk };
}
