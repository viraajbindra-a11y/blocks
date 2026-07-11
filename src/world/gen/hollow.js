// The Hollow — pale islands adrift in a violet void. The central island
// (around 0,0) is the Sovereign's arena — dead flat inside the fight
// ring for a fair bout — while shard crags and pancake isles drift
// beyond the ring gap. Same generator contract as terrain.js.

import { CHUNK_X, CHUNK_Y, CHUNK_Z, CHUNK_VOL, bIdx } from '../../core/constants.js';
import { Simplex, hash2, normalizeSeed, clamp, smoothstep } from '../../math/noise.js';
import { B, opaqueAt } from '../../blocks.js';

export const ARENA_Y = 64;          // main island surface height
const ARENA_FLAT_R = 26;            // dead-flat fight ring radius

export function makeHollowGenerator(rawSeed) {
  const seed = normalizeSeed(rawSeed) ^ 0x33CC33CC;
  const nIsle = new Simplex(seed + 7);
  const nShape = new Simplex(seed + 13);
  const nStyle = new Simplex(seed + 19);   // per-isle personality: shard vs pancake

  // Island field: dense center island + scattered outer isles.
  function islandStrength(wx, wz) {
    const d = Math.hypot(wx, wz);
    const center = smoothstep(46, 12, d);                       // big arena isle
    const field = Math.max(0, nIsle.fbm2(wx * 0.012, wz * 0.012, 3) - 0.34) * 1.8;
    const ring = d > 70 ? field : field * smoothstep(46, 80, d); // gap around arena
    return Math.max(center, ring);
  }

  function columnInfo(wx, wz) {
    const s = islandStrength(wx, wz);
    if (s <= 0.02) return { h: -1, biome: 0, thickness: 0 };
    const d = Math.hypot(wx, wz);
    const wob = nShape.fbm2(wx * 0.03, wz * 0.03, 2);
    let h, thickness;
    if (d < 46) {
      // Arena isle: perfectly flat inside the fight ring, soft rim beyond.
      const rim = smoothstep(ARENA_FLAT_R, 44, d);
      h = clamp(Math.round(ARENA_Y + wob * 3 * rim * s), 40, 90);
      thickness = Math.round(6 + s * 24 + wob * 2);
    } else {
      // Outer isles blend between two shapes: low flat pancakes and tall
      // shard-like crags, chosen by a slow per-isle style noise.
      const shard = smoothstep(0.1, 0.35, nStyle.fbm2(wx * 0.008, wz * 0.008, 2));
      h = clamp(Math.round(ARENA_Y - 2 + wob * (1 + 5 * shard) * 3 * s + shard * (6 + s * 12)), 40, 96);
      thickness = Math.round(3 + s * (8 + 26 * shard) + shard * 10);
    }
    return { h, biome: 0, thickness };
  }
  const heightAt = (x, z) => { const c = columnInfo(x, z); return c.h < 0 ? 0 : c.h; };
  const biomeAt = () => 0;

  function generateChunk(cx, cz) {
    const blocks = new Uint16Array(CHUNK_VOL);
    const hmap = new Uint8Array(CHUNK_X * CHUNK_Z);
    const biomes = new Uint8Array(CHUNK_X * CHUNK_Z);
    const ox = cx * CHUNK_X, oz = cz * CHUNK_Z;

    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        const wx = ox + x, wz = oz + z;
        const { h, thickness } = columnInfo(wx, wz);
        if (h < 0) continue;
        const d = Math.hypot(wx, wz);
        const bottom = Math.max(4, h - thickness);
        for (let y = bottom; y <= h; y++) {
          blocks[bIdx(x, y, z)] = B.VOIDSTONE;
        }
        blocks[bIdx(x, h, z)] = B.HOLLOWMOSS;

        // Sunstone glints tucked into island undersides — visible from
        // beneath, a reward for careful bridging.
        if (thickness >= 8 && hash2(wx, wz, seed + 29) < 0.03) {
          blocks[bIdx(x, bottom, z)] = B.SUNSTONE_ORE;
        }

        // Growth stays off the arena's fight ring.
        if (d > ARENA_FLAT_R + 2) {
          const r = hash2(wx, wz, seed + 17);
          if (d > 60 && r < 0.006) {
            // Voidglass spire: a slender crystal spike, 3-6 tall.
            const len = 3 + Math.floor(hash2(wx, wz, seed + 41) * 4);
            for (let k = 1; k <= len && h + k < CHUNK_Y - 1; k++) {
              blocks[bIdx(x, h + k, z)] = B.VOIDGLASS;
            }
          } else if (r < 0.026) {
            // A glowing voidglass nub — same violet light as the spires,
            // so the Hollow reads as one cohesive palette (no green moss).
            blocks[bIdx(x, h + 1, z)] = B.VOIDGLASS;
          }
        }
      }
    }

    // Heightmap: highest OPAQUE block (decorations don't count) — same
    // semantics as terrain.js. Void columns land on 0.
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
