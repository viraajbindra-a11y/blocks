// Voxel lighting: 4-bit sky light + 4-bit block light per cell, packed
// into one byte (sky<<4 | block). Propagation is breadth-first flood fill
// over world coordinates so it crosses chunk borders transparently.
//
// The world object passed in must provide:
//   lightGet(x,y,z)  -> packed byte, or -1 if the containing chunk has no light array
//   lightSet(x,y,z,packed)
//   getBlock(x,y,z)  -> block id (AIR when missing)
//   markLightDirty(x,y,z) -> flag the containing render section for remesh

import { CHUNK_X, CHUNK_Y, CHUNK_Z, MAX_LIGHT, bIdx, DIRS } from '../core/constants.js';
import { BLOCKS } from '../blocks.js';

export const SKY = 0, BLK = 1;

// How much light dies entering this block. 0 = free (air, glass, plants),
// 15 = fully opaque.
const OPACITY = new Uint8Array(256);
export function refreshLightOpacity() {
  for (let i = 0; i < 256; i++) {
    const b = BLOCKS[i];
    if (!b) { OPACITY[i] = 0; continue; }
    if (b.opaque) OPACITY[i] = 15;
    else if (b.key === 'alder_leaves' || b.key === 'fern_leaves') OPACITY[i] = 1;
    else if (b.translucent && b.key.startsWith('water')) OPACITY[i] = 2;
    else if (b.key === 'ice') OPACITY[i] = 2;
    else OPACITY[i] = b.lightOpacity ?? 0;   // mods may set their own
  }
}
refreshLightOpacity();
export const lightOpacity = id => OPACITY[id] ?? 0;

const getL = (world, x, y, z, kind) => {
  const p = world.lightGet(x, y, z);
  if (p < 0) return -1;
  return kind === SKY ? p >> 4 : p & 15;
};
const setL = (world, x, y, z, kind, v) => {
  const p = world.lightGet(x, y, z);
  if (p < 0) return;
  world.lightSet(x, y, z, kind === SKY ? (v << 4) | (p & 15) : (p & 0xf0) | v);
  world.markLightDirty(x, y, z);
};

// BFS spread. queue: flat array of [x,y,z] triples (mutated).
export function floodLight(world, queue, kind) {
  let head = 0;
  while (head < queue.length) {
    const [x, y, z] = queue[head++];
    const level = getL(world, x, y, z, kind);
    if (level <= 1) continue;
    for (let d = 0; d < 6; d++) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
      if (ny < 0 || ny >= CHUNK_Y) continue;
      const nid = world.getBlock(nx, ny, nz);
      const op = OPACITY[nid];
      if (op >= 15) continue;
      // Full sunlight falls straight down for free.
      const down15 = kind === SKY && d === 3 && level === MAX_LIGHT && op === 0;
      const nl = down15 ? MAX_LIGHT : level - Math.max(1, op);
      const cur = getL(world, nx, ny, nz, kind);
      if (cur < 0 || cur >= nl) continue;
      setL(world, nx, ny, nz, kind, nl);
      queue.push([nx, ny, nz]);
    }
  }
  queue.length = 0;
}

// BFS removal starting from a cell whose light source went away.
// Zeroes the affected region, then re-floods from its bright boundary.
export function unlight(world, sx, sy, sz, kind) {
  const startLevel = getL(world, sx, sy, sz, kind);
  if (startLevel <= 0) return;
  setL(world, sx, sy, sz, kind, 0);
  const queue = [[sx, sy, sz, startLevel]];
  const relight = [];
  let head = 0;
  while (head < queue.length) {
    const [x, y, z, level] = queue[head++];
    for (let d = 0; d < 6; d++) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
      if (ny < 0 || ny >= CHUNK_Y) continue;
      const nl = getL(world, nx, ny, nz, kind);
      if (nl <= 0) continue;
      const down15 = kind === SKY && d === 3 && level === MAX_LIGHT;
      if (nl < level || down15) {
        setL(world, nx, ny, nz, kind, 0);
        // A light-emitting block inside the zone keeps its own emission.
        if (kind === BLK) {
          const em = BLOCKS[world.getBlock(nx, ny, nz)]?.light ?? 0;
          if (em > 0) { setL(world, nx, ny, nz, kind, em); relight.push([nx, ny, nz]); }
        }
        queue.push([nx, ny, nz, nl]);
      } else {
        relight.push([nx, ny, nz]);
      }
    }
  }
  floodLight(world, relight, kind);
}

// Initial lighting for a freshly generated chunk. Requires the 4 edge
// neighbors to have block data so light can flow across borders.
export function initChunkLight(world, chunk) {
  const { blocks, light } = chunk;
  const ox = chunk.cx * CHUNK_X, oz = chunk.cz * CHUNK_Z;
  const skyQ = [], blkQ = [];

  // 1. Vertical sunlight: full 15 straight down until something absorbs it.
  for (let z = 0; z < CHUNK_Z; z++) {
    for (let x = 0; x < CHUNK_X; x++) {
      let lvl = MAX_LIGHT;
      for (let y = CHUNK_Y - 1; y >= 0 && lvl > 0; y--) {
        const i = bIdx(x, y, z);
        const op = OPACITY[blocks[i]];
        if (op >= 15) break;
        if (op > 0) lvl = Math.max(0, lvl - op);
        if (lvl > 0) light[i] = (lvl << 4) | (light[i] & 15);
      }
    }
  }

  // 2. Seed lateral sky spread from lit cells that border darker ones,
  //    and collect block-light emitters.
  for (let y = 0; y < CHUNK_Y; y++) {
    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        const i = bIdx(x, y, z);
        const em = BLOCKS[blocks[i]]?.light ?? 0;
        if (em > 0) {
          light[i] = (light[i] & 0xf0) | em;
          blkQ.push([ox + x, y, oz + z]);
        }
        const sky = light[i] >> 4;
        if (sky > 1) {
          // Only enqueue if a neighbor could receive light from us.
          for (let d = 0; d < 6; d++) {
            const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
            let nsky;
            if (nx < 0 || nx >= CHUNK_X || nz < 0 || nz >= CHUNK_Z) {
              nsky = getL(world, ox + nx, ny, oz + nz, SKY);
              if (nsky < 0) continue;
            } else if (ny < 0 || ny >= CHUNK_Y) continue;
            else nsky = light[bIdx(nx, ny, nz)] >> 4;
            if (nsky < sky - 1) { skyQ.push([ox + x, y, oz + z]); break; }
          }
        }
      }
    }
  }

  // 3. Pull light in from already-lit neighbor chunks across our borders.
  const pullBorder = (wx, wz) => {
    const p = world.lightGet(wx, 0, wz);
    if (p < 0) return;
    for (let y = 0; y < CHUNK_Y; y++) {
      const pk = world.lightGet(wx, y, wz);
      if (pk >> 4 > 1) skyQ.push([wx, y, wz]);
      if ((pk & 15) > 1) blkQ.push([wx, y, wz]);
    }
  };
  for (let x = 0; x < CHUNK_X; x++) { pullBorder(ox + x, oz - 1); pullBorder(ox + x, oz + CHUNK_Z); }
  for (let z = 0; z < CHUNK_Z; z++) { pullBorder(ox - 1, oz + z); pullBorder(ox + CHUNK_X, oz + z); }

  floodLight(world, skyQ, SKY);
  floodLight(world, blkQ, BLK);
}

// Incremental relight after a single block change.
export function relightBlockChange(world, x, y, z, oldId, newId) {
  const oldOp = OPACITY[oldId], newOp = OPACITY[newId];
  const oldEm = BLOCKS[oldId]?.light ?? 0, newEm = BLOCKS[newId]?.light ?? 0;

  if (newOp > oldOp) {
    // More opaque: kill light passing through this cell.
    unlight(world, x, y, z, SKY);
    unlight(world, x, y, z, BLK);
  } else if (newOp < oldOp) {
    // More transparent: pull light in from all neighbors. ny === CHUNK_Y is
    // allowed on purpose: the virtual sky cell above the world reads as
    // full sunlight and re-seeds the free-falling 15 column.
    const seeds = [];
    for (let d = 0; d < 6; d++) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
      if (ny < 0 || ny > CHUNK_Y) continue;
      seeds.push([nx, ny, nz]);
    }
    floodLight(world, seeds.slice(), SKY);
    floodLight(world, seeds, BLK);
  }

  if (oldEm > 0 && newEm === 0) unlight(world, x, y, z, BLK);
  if (newEm > 0) {
    const cur = getL(world, x, y, z, BLK);
    if (newEm > cur) {
      setL(world, x, y, z, BLK, newEm);
      floodLight(world, [[x, y, z]], BLK);
    }
  }
}
