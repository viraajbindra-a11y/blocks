// Chunk: a 16×128×16 column of blocks + packed light + metadata.

import { CHUNK_VOL, CHUNK_X, CHUNK_Z, SECTIONS, bIdx } from '../core/constants.js';

// Lifecycle states
export const ST_LOADING = 0;   // requested from persistence/worker
export const ST_BLOCKS = 1;    // block data present
export const ST_LIT = 2;       // lighting computed

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.key = `${cx},${cz}`;
    this.state = ST_LOADING;
    this.blocks = null;    // Uint8Array(CHUNK_VOL)
    this.light = null;     // Uint8Array(CHUNK_VOL), sky<<4 | block
    this.hmap = null;      // Uint8Array(256): highest opaque y per column (0 if none)
    this.biomes = null;    // Uint8Array(256)
    this.modified = false; // has unsaved player/simulation edits
    // Per-section render handles, owned by the renderer.
    this.meshes = new Array(SECTIONS).fill(null);
  }

  attachBlocks(blocks, hmap, biomes) {
    this.blocks = blocks;
    this.hmap = hmap ?? computeHeightmap(blocks);
    this.biomes = biomes ?? new Uint8Array(CHUNK_X * CHUNK_Z);
    this.light = new Uint8Array(CHUNK_VOL);
    this.state = ST_BLOCKS;
  }

  get(x, y, z) { return this.blocks[bIdx(x, y, z)]; }
  set(x, y, z, id) { this.blocks[bIdx(x, y, z)] = id; }
  getLight(x, y, z) { return this.light[bIdx(x, y, z)]; }
  setLight(x, y, z, v) { this.light[bIdx(x, y, z)] = v; }
  biome(x, z) { return this.biomes[z * CHUNK_X + x]; }
  height(x, z) { return this.hmap[z * CHUNK_X + x]; }
}

import { opaqueAt } from '../blocks.js';

export function computeHeightmap(blocks, out = new Uint8Array(CHUNK_X * CHUNK_Z)) {
  for (let z = 0; z < CHUNK_Z; z++) {
    for (let x = 0; x < CHUNK_X; x++) {
      let y = 127;
      while (y > 0 && !opaqueAt(blocks[bIdx(x, y, z)])) y--;
      out[z * CHUNK_X + x] = y;
    }
  }
  return out;
}

export const chunkKey = (cx, cz) => `${cx},${cz}`;
