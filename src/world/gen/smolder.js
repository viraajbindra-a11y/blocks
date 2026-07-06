// The Smolder — a scorched underworld: a sealed cavern realm with lava
// seas, emberash dune fields, glowvein seams, floor-to-ceiling scorchstone
// pillars, basalt outcrops, and charfungus groves.
// Same generator contract as terrain.js: {seed, heightAt, biomeAt,
// columnInfo, generateChunk}.

import { CHUNK_X, CHUNK_Y, CHUNK_Z, CHUNK_VOL, bIdx } from '../../core/constants.js';
import { Simplex, mulberry32, hash2, normalizeSeed, clamp } from '../../math/noise.js';
import { B, opaqueAt } from '../../blocks.js';

export const LAVA_LEVEL = 32;
const CEILING = 108;
const PILLAR_CELL = 12;             // one pillar candidate per 12×12 world cell

export function makeSmolderGenerator(rawSeed) {
  const seed = normalizeSeed(rawSeed) ^ 0x5A5A5A5A;
  const nFloor = new Simplex(seed + 11);
  const nCeil = new Simplex(seed + 22);
  const nCave = new Simplex(seed + 33);
  const nDune = new Simplex(seed + 44);
  const nField = new Simplex(seed + 55);   // emberash dune-field regions
  const nGrove = new Simplex(seed + 66);   // charfungus grove regions

  function columnInfo(wx, wz) {
    const f = nFloor.fbm2(wx * 0.008, wz * 0.008, 4);
    const dune = Math.max(0, nDune.fbm2(wx * 0.02, wz * 0.02, 2)) * 6;
    const h = clamp(Math.round(LAVA_LEVEL + 4 + f * 22 + dune), 12, 88);
    return { h, biome: 0 };
  }
  const heightAt = (x, z) => columnInfo(x, z).h;
  const biomeAt = () => 0;
  const ceilAt = (wx, wz) =>
    CEILING - Math.round(Math.abs(nCeil.fbm2(wx * 0.01, wz * 0.01, 3)) * 26);

  function generateChunk(cx, cz) {
    const blocks = new Uint8Array(CHUNK_VOL);
    const hmap = new Uint8Array(CHUNK_X * CHUNK_Z);
    const biomes = new Uint8Array(CHUNK_X * CHUNK_Z);
    const ox = cx * CHUNK_X, oz = cz * CHUNK_Z;
    const rng = mulberry32((seed ^ (cx * 341873128) ^ (cz * 132897987)) >>> 0);

    // Scorchstone pillars: hash-gated candidates on a coarse world grid so
    // trunks line up seamlessly across chunk borders. Radius 1-2.
    const pillars = [];
    const g0x = Math.floor((ox - 2) / PILLAR_CELL), g1x = Math.floor((ox + CHUNK_X + 1) / PILLAR_CELL);
    const g0z = Math.floor((oz - 2) / PILLAR_CELL), g1z = Math.floor((oz + CHUNK_Z + 1) / PILLAR_CELL);
    for (let gz = g0z; gz <= g1z; gz++) {
      for (let gx = g0x; gx <= g1x; gx++) {
        if (hash2(gx, gz, seed + 101) > 0.3) continue;
        pillars.push({
          px: gx * PILLAR_CELL + 2 + Math.floor(hash2(gx, gz, seed + 103) * (PILLAR_CELL - 4)),
          pz: gz * PILLAR_CELL + 2 + Math.floor(hash2(gx, gz, seed + 105) * (PILLAR_CELL - 4)),
          pr: hash2(gx, gz, seed + 107) < 0.55 ? 1 : 2,
        });
      }
    }

    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        const wx = ox + x, wz = oz + z;
        const { h } = columnInfo(wx, wz);
        const ceil = ceilAt(wx, wz);

        // Bedrock floor and roof
        blocks[bIdx(x, 0, z)] = B.CORESTONE;
        blocks[bIdx(x, CHUNK_Y - 1, z)] = B.CORESTONE;
        for (let y = 1; y <= h; y++) blocks[bIdx(x, y, z)] = B.SCORCHSTONE;
        for (let y = ceil; y < CHUNK_Y - 1; y++) blocks[bIdx(x, y, z)] = B.SCORCHSTONE;

        let inPillar = false;
        for (const p of pillars) {
          const dx = wx - p.px, dz = wz - p.pz;
          if (dx * dx + dz * dz <= p.pr * p.pr) { inPillar = true; break; }
        }

        // Emberash dune fields: coherent low-freq regions rather than speckle.
        if (!inPillar && h > LAVA_LEVEL + 6 && nField.fbm2(wx * 0.006, wz * 0.006, 2) > 0.12) {
          const depth = 2 + Math.round(Math.max(0, nDune.fbm2(wx * 0.03, wz * 0.03, 2)) * 3);
          for (let d = 0; d < depth && h - d > 1; d++) blocks[bIdx(x, h - d, z)] = B.EMBERASH;
        }
        // Lava sea fills the basins
        for (let y = h + 1; y <= LAVA_LEVEL; y++) blocks[bIdx(x, y, z)] = B.LAVA;

        // Winding air pockets through the scorchstone mass
        for (let y = 2; y < h - 2; y++) {
          const c = nCave.noise3D(wx * 0.02, y * 0.03, wz * 0.02);
          if (Math.abs(c) < 0.07) blocks[bIdx(x, y, z)] = B.AIR;
        }

        if (inPillar) {
          // Floor-to-ceiling trunk (rises straight out of lava basins too).
          for (let y = h + 1; y < ceil; y++) blocks[bIdx(x, y, z)] = B.SCORCHSTONE;
        } else {
          // Surface life: charfungus groves around a gated noise field,
          // sparse glowmoss elsewhere.
          const surf = blocks[bIdx(x, h, z)];
          if (h > LAVA_LEVEL && h + 2 < ceil && (surf === B.SCORCHSTONE || surf === B.EMBERASH)) {
            const r = hash2(wx, wz, seed + 91);
            if (nGrove.fbm2(wx * 0.025, wz * 0.025, 2) > 0.28) {
              if (r < 0.22) blocks[bIdx(x, h + 1, z)] = B.CHARFUNGUS;
            } else if (r < 0.008) {
              blocks[bIdx(x, h + 1, z)] = B.GLOWMOSS;
            }
          }
        }
        biomes[z * CHUNK_X + x] = 0;
      }
    }

    // Glowvein seams — most hug the lava sea so nearby caves glitter.
    for (let v = 0; v < 10; v++) {
      let x = rng() * 16, z = rng() * 16;
      let y = v < 7
        ? LAVA_LEVEL - 10 + rng() * 20   // biased to LAVA_LEVEL ± 10
        : 8 + rng() * 60;                // a few strays anywhere
      const size = 3 + rng() * 5;
      for (let s = 0; s < size; s++) {
        const bx = x | 0, by = y | 0, bz = z | 0;
        if (bx >= 0 && bx < 16 && bz >= 0 && bz < 16 && by > 1 && by < 126) {
          const i = bIdx(bx, by, bz);
          if (blocks[i] === B.SCORCHSTONE) blocks[i] = B.GLOWVEIN_ORE;
        }
        x += (rng() - 0.5) * 2.2; y += (rng() - 0.5) * 1.8; z += (rng() - 0.5) * 2.2;
      }
    }

    // Basalt outcrops: small surface clusters — frame material for the
    // return rift, so a few spawn in every chunk's area.
    const nOutcrops = 2 + ((rng() * 3) | 0);
    for (let o = 0; o < nOutcrops; o++) {
      const bx = 2 + ((rng() * 12) | 0), bz = 2 + ((rng() * 12) | 0);
      const ceilO = ceilAt(ox + bx, oz + bz);
      let sy = ceilO - 1;
      while (sy > LAVA_LEVEL && blocks[bIdx(bx, sy, bz)] === B.AIR) sy--;
      const sb = blocks[bIdx(bx, sy, bz)];
      if (sb !== B.SCORCHSTONE && sb !== B.EMBERASH) continue;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx !== 0 || dz !== 0) && rng() > 0.55) continue;
          const gx = bx + dx, gz = bz + dz;
          let gy = Math.min(sy + 2, ceilO - 2);
          if (blocks[bIdx(gx, gy, gz)] !== B.AIR) continue;
          while (gy > LAVA_LEVEL && blocks[bIdx(gx, gy - 1, gz)] === B.AIR) gy--;
          const gb = blocks[bIdx(gx, gy - 1, gz)];
          if (gb !== B.SCORCHSTONE && gb !== B.EMBERASH) continue;
          blocks[bIdx(gx, gy, gz)] = B.BASALT;
          if (dx === 0 && dz === 0 && rng() < 0.5 && gy + 1 < ceilO) {
            blocks[bIdx(gx, gy + 1, gz)] = B.BASALT;
          }
        }
      }
    }

    // Rare lava falls (~1 per 4-6 chunks): a source block set into the
    // roof with open air beneath — the fluid sim animates the fall.
    if (hash2(cx, cz, seed + 71) < 0.18) {
      for (let a = 0; a < 8; a++) {
        const fx = 1 + ((rng() * 14) | 0), fz = 1 + ((rng() * 14) | 0);
        const ceilF = ceilAt(ox + fx, oz + fz);
        let open = true;
        for (let y = ceilF - 1; y >= ceilF - 8; y--) {
          if (blocks[bIdx(fx, y, fz)] !== B.AIR) { open = false; break; }
        }
        if (!open) continue;
        blocks[bIdx(fx, ceilF, fz)] = B.LAVA;
        break;
      }
    }

    // Heightmap: highest OPAQUE block (decorations don't count) — same
    // semantics as terrain.js.
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
