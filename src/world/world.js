// World: chunk streaming, worker-pool generation, block access, light
// bookkeeping, fluid + random ticks, raycasting, and save flushing.

import {
  CHUNK_X, CHUNK_Y, CHUNK_Z, SECTION_Y, SECTIONS, SEA_LEVEL,
  RANDOM_TICK_MS, bIdx, DIRS,
} from '../core/constants.js';
import { Chunk, chunkKey, ST_LOADING, ST_BLOCKS, ST_LIT, computeHeightmap } from './chunk.js';
import { initChunkLight, relightBlockChange } from './lighting.js';
import { B, BLOCKS, blockById, isFluid, isLava, solidAt, opaqueAt, isShaped, shapeBoxes, connMask } from '../blocks.js';
import { BIOME } from './gen/terrain.js';
import { dimension as dimensionOf } from './dimensions.js';
import { FluidSim } from './fluids.js';
import { RedstoneSim } from './redstone.js';
import { placeAlder, placeFern, hasTreeRoom } from './gen/features.js';
import { mulberry32 } from '../math/noise.js';

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

function makeGenWorker() {
  // The standalone single-file build injects the worker source as a string.
  if (typeof window !== 'undefined' && (window.__BLOCKS_WORKER_SRC ?? window.__LOAM_WORKER_SRC)) {
    const blob = new Blob([window.__BLOCKS_WORKER_SRC ?? window.__LOAM_WORKER_SRC], { type: 'text/javascript' });
    return new Worker(URL.createObjectURL(blob));
  }
  return new Worker(new URL('../workers/genWorker.js', import.meta.url), { type: 'module' });
}

export class World {
  /**
   * @param {object} opts
   *   seed: world seed (string|number)
   *   persistence: {loadChunk(cx,cz)→Promise<{blocks,biomes}|null>, saveChunk(cx,cz,chunk)} | null
   *   renderDistance: chunks
   */
  constructor({ seed, persistence = null, renderDistance = 8, decorations = [], dimension = 'overworld' }) {
    this.seed = seed;
    this.dimension = dimension;
    this.persistence = persistence;
    this.renderDistance = renderDistance;
    this.generator = dimensionOf(dimension).makeGenerator(seed, decorations);
    this.chunks = new Map();          // key -> Chunk
    this.meshDirty = new Set();       // "cx,cz,sy" sections needing remesh
    this.fluids = new FluidSim(this);
    this.redstone = new RedstoneSim(this);   // hooks wired by main.js
    this.onChunkUnload = null;        // renderer hook: dispose meshes
    this.randomTickTimer = 0;
    this.rng = mulberry32((Date.now ? 12345 : 12345) ^ 0);  // gameplay-only randomness
    this._genQueue = [];              // chunk keys awaiting worker dispatch
    this._pending = new Map();        // key -> true while gen in flight
    this.stats = { loaded: 0, lit: 0, genQueue: 0 };

    const n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
    this.workers = [];
    for (let i = 0; i < n; i++) {
      const w = makeGenWorker();
      w.busy = 0;
      w.postMessage({ type: 'init', seed, decorations, dimension });
      w.onmessage = (e) => this._onWorkerMessage(w, e.data);
      this.workers.push(w);
    }
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    this.chunks.clear();
    this.meshDirty.clear();
  }

  // ── Chunk access ─────────────────────────────────────────────────
  chunkAt(cx, cz) { return this.chunks.get(chunkKey(cx, cz)); }
  chunkOf(x, z) { return this.chunks.get(chunkKey(x >> 4, z >> 4)); }

  getBlock(x, y, z) {
    if (y < 0) return B.CORESTONE;
    if (y >= CHUNK_Y) return B.AIR;
    const c = this.chunkOf(x, z);
    if (!c || !c.blocks) return B.AIR;
    return c.blocks[bIdx(x & 15, y, z & 15)];
  }

  // Physics: unloaded terrain is solid so nothing falls through it.
  isSolid(x, y, z) {
    if (y < 0) return true;
    if (y >= CHUNK_Y) return false;
    const c = this.chunkOf(x, z);
    if (!c || !c.blocks) return true;
    return solidAt(c.blocks[bIdx(x & 15, y, z & 15)]);
  }

  isLoaded(x, z) {
    const c = this.chunkOf(x, z);
    return !!(c && c.blocks);
  }

  // Collision boxes for the block cell (x,y,z), in WORLD coords, as
  // [minX,minY,minZ,maxX,maxY,maxZ]. Cube solids → one full-cell box;
  // shaped solids → their sub-boxes; non-solid → empty. Unloaded terrain
  // returns a full box so entities never fall through it. `out` is reused
  // by the caller to avoid per-call allocation on the physics hot path.
  collideBoxes(x, y, z, out = []) {
    out.length = 0;
    if (y < 0) { out.push([x, y, z, x + 1, y + 1, z + 1]); return out; }
    if (y >= CHUNK_Y) return out;
    const c = this.chunkOf(x, z);
    if (!c || !c.blocks) { out.push([x, y, z, x + 1, y + 1, z + 1]); return out; }
    const id = c.blocks[bIdx(x & 15, y, z & 15)];
    if (!solidAt(id)) return out;
    if (!isShaped(id)) { out.push([x, y, z, x + 1, y + 1, z + 1]); return out; }
    const block = BLOCKS[id];
    // Connecting shapes grow arms toward their 4 horizontal neighbors, and
    // use the taller 1.5-cell collision so nothing jumps the line.
    const conn = block.connects
      ? connMask(block, (dx, dz) => this.getBlock(x + dx, y, z + dz))
      : 0;
    for (const b of shapeBoxes(block, conn, true)) {
      out.push([x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]]);
    }
    return out;
  }

  // ── Light accessors (used by lighting.js BFS) ────────────────────
  lightGet(x, y, z) {
    if (y >= CHUNK_Y) return 15 << 4;
    if (y < 0) return -1;
    const c = this.chunkOf(x, z);
    if (!c || !c.light) return -1;
    return c.light[bIdx(x & 15, y, z & 15)];
  }
  lightSet(x, y, z, v) {
    if (y < 0 || y >= CHUNK_Y) return;
    const c = this.chunkOf(x, z);
    if (!c || !c.light) return;
    c.light[bIdx(x & 15, y, z & 15)] = v;
  }
  // Packed light for rendering/gameplay; unloaded or sky = full daylight.
  lightAt(x, y, z) {
    const p = this.lightGet(x, y, z);
    return p < 0 ? 15 << 4 : p;
  }
  markLightDirty(x, y, z) {
    this._markSection(x, y, z);
    // A light change on a section border also re-shades faces in the
    // adjacent section, so dirty that one too.
    if ((x & 15) === 0) this._markSection(x - 1, y, z);
    if ((x & 15) === 15) this._markSection(x + 1, y, z);
    if ((z & 15) === 0) this._markSection(x, y, z - 1);
    if ((z & 15) === 15) this._markSection(x, y, z + 1);
    if ((y & 15) === 0 && y > 0) this._markSection(x, y - 1, z);
    if ((y & 15) === 15 && y < CHUNK_Y - 1) this._markSection(x, y + 1, z);
  }
  _markSection(x, y, z) {
    const sy = Math.min(SECTIONS - 1, Math.max(0, y >> 4));
    this.meshDirty.add(`${x >> 4},${z >> 4},${sy}`);
  }
  markDirtyAround(x, y, z) {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          this._markSection(x + dx, Math.min(CHUNK_Y - 1, Math.max(0, y + dy)), z + dz);
  }

  // ── Block editing ────────────────────────────────────────────────
  setBlock(x, y, z, id, opts = {}) {
    if (y < 0 || y >= CHUNK_Y) return false;
    const c = this.chunkOf(x, z);
    if (!c || !c.blocks) return false;
    const lx = x & 15, lz = z & 15;
    const i = bIdx(lx, y, lz);
    const old = c.blocks[i];
    if (old === id) return false;
    c.blocks[i] = id;
    c.modified = true;

    // Heightmap upkeep
    const hi = lz * CHUNK_X + lx;
    if (opaqueAt(id) && y > c.hmap[hi]) c.hmap[hi] = y;
    else if (!opaqueAt(id) && y === c.hmap[hi]) {
      let yy = y;
      while (yy > 0 && !opaqueAt(c.blocks[bIdx(lx, yy, lz)])) yy--;
      c.hmap[hi] = yy;
    }

    if (c.state >= ST_LIT && !opts.noLight) relightBlockChange(this, x, y, z, old, id);
    this.markDirtyAround(x, y, z);

    // Wake fluids around any edit
    const now = opts.now ?? performance.now();
    if (isFluid(id)) this.fluids.schedule(x, y, z, now, isLava(id));
    this.fluids.scheduleAround(x, y, z, now);
    if (this.redstone) this.redstone.onEdit(x, y, z, old, id);
    // Multiplayer: share this edit with peers (skip fluid churn + echoes).
    if (this.netBroadcast && !this._netSuppress && !isFluid(id) && !isFluid(old)) {
      this.netBroadcast(x, y, z, id);
    }
    return true;
  }

  // Apply a peer's block edit without re-broadcasting it back.
  applyRemoteBlock(x, y, z, id) {
    this._netSuppress = true;
    this.setBlock(x, y, z, id);
    this._netSuppress = false;
  }

  // ── Streaming ────────────────────────────────────────────────────
  setRenderDistance(d) {
    this.renderDistance = d;
    this._forceScan = true;   // grow/shrink the chunk ring immediately
  }

  update(dt, px, pz, nowMs) {
    const pcx = Math.floor(px / CHUNK_X), pcz = Math.floor(pz / CHUNK_Z);
    const genR = this.renderDistance + 2;

    // Request missing chunks, nearest first
    if (this._lastPcx !== pcx || this._lastPcz !== pcz || this.chunks.size === 0 || this._forceScan) {
      this._lastPcx = pcx; this._lastPcz = pcz; this._forceScan = false;
      const wanted = [];
      for (let dz = -genR; dz <= genR; dz++) {
        for (let dx = -genR; dx <= genR; dx++) {
          const cx = pcx + dx, cz = pcz + dz;
          if (!this.chunks.has(chunkKey(cx, cz))) wanted.push([cx, cz, dx * dx + dz * dz]);
        }
      }
      wanted.sort((a, b) => a[2] - b[2]);
      for (const [cx, cz] of wanted) this._requestChunk(cx, cz);

      // Unload far chunks
      const dropR = genR + 2;
      for (const [key, c] of this.chunks) {
        if (Math.abs(c.cx - pcx) > dropR || Math.abs(c.cz - pcz) > dropR) {
          if (c.modified && this.persistence) this.persistence.saveChunk(c.cx, c.cz, c);
          if (this.onChunkUnload) this.onChunkUnload(c);
          this.chunks.delete(key);
        }
      }
    }
    this._dispatchGen();

    // Simulation ticks
    this.fluids.tick(nowMs);
    if (this.redstone) this.redstone.tick(nowMs);
    this.randomTickTimer += dt * 1000;
    if (this.randomTickTimer >= RANDOM_TICK_MS) {
      this.randomTickTimer = 0;
      this._randomTicks(pcx, pcz, nowMs);
    }

    this.stats.loaded = this.chunks.size;
    this.stats.genQueue = this._genQueue.length + this._pending.size;
  }

  _requestChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    if (this.chunks.has(key)) return;
    const chunk = new Chunk(cx, cz);
    this.chunks.set(key, chunk);
    if (this.persistence) {
      this.persistence.loadChunk(cx, cz).then((data) => {
        // Identity check: the chunk may have been unloaded and re-requested
        // while the read was in flight — never touch the stale object.
        if (this.chunks.get(key) !== chunk) return;
        if (data) {
          chunk.attachBlocks(data.blocks, null, data.biomes);
          chunk.modified = false;
          this._onBlocksReady(chunk);
        } else {
          this._genQueue.push(key);
          this._dispatchGen();
        }
      }).catch(() => {
        if (this.chunks.get(key) !== chunk) return;
        this._genQueue.push(key);
        this._dispatchGen();
      });
    } else {
      this._genQueue.push(key);
    }
  }

  _dispatchGen() {
    if (this._genQueue.length === 0) return;
    for (const w of this.workers) {
      while (w.busy < 2 && this._genQueue.length > 0) {
        const key = this._genQueue.shift();
        const c = this.chunks.get(key);
        if (!c || c.blocks || this._pending.has(key)) continue;
        this._pending.set(key, w);
        w.busy++;
        w.postMessage({ type: 'gen', cx: c.cx, cz: c.cz });
      }
    }
  }

  _onWorkerMessage(w, m) {
    if (m.type !== 'chunk') return;
    w.busy--;
    const key = chunkKey(m.cx, m.cz);
    this._pending.delete(key);
    const chunk = this.chunks.get(key);
    if (chunk && !chunk.blocks) {
      chunk.attachBlocks(m.blocks instanceof Uint16Array ? m.blocks : new Uint16Array(m.blocks),
                         m.hmap, m.biomes);
      this._onBlocksReady(chunk);
    }
    this._dispatchGen();
  }

  _onBlocksReady(chunk) {
    // Try to light this chunk and any neighbor that was waiting on us.
    this._tryLight(chunk);
    for (const [dx, dz] of N4) {
      const n = this.chunkAt(chunk.cx + dx, chunk.cz + dz);
      if (n) this._tryLight(n);
    }
  }

  _tryLight(chunk) {
    if (chunk.state !== ST_BLOCKS) return;
    for (const [dx, dz] of N4) {
      const n = this.chunkAt(chunk.cx + dx, chunk.cz + dz);
      if (!n || !n.blocks) return;
    }
    initChunkLight(this, chunk);
    chunk.state = ST_LIT;
    this.stats.lit++;
    this._tryMeshReady(chunk);
    for (const [dx, dz] of N8) {
      const n = this.chunkAt(chunk.cx + dx, chunk.cz + dz);
      if (n) this._tryMeshReady(n);
    }
  }

  _tryMeshReady(chunk) {
    if (chunk.meshReady || chunk.state !== ST_LIT) return;
    for (const [dx, dz] of N8) {
      const n = this.chunkAt(chunk.cx + dx, chunk.cz + dz);
      if (!n || n.state !== ST_LIT) return;
    }
    chunk.meshReady = true;
    for (let sy = 0; sy < SECTIONS; sy++) {
      this.meshDirty.add(`${chunk.cx},${chunk.cz},${sy}`);
    }
  }

  // ── Random ticks: growth, spreading ──────────────────────────────
  _randomTicks(pcx, pcz, nowMs) {
    const r = Math.min(this.renderDistance, 5);
    for (const c of this.chunks.values()) {
      if (!c.blocks || c.state < ST_LIT) continue;
      if (Math.abs(c.cx - pcx) > r || Math.abs(c.cz - pcz) > r) continue;
      for (let t = 0; t < 3; t++) {
        const x = (this.rng() * 16) | 0, z = (this.rng() * 16) | 0;
        const y = (this.rng() * CHUNK_Y) | 0;
        const id = c.blocks[bIdx(x, y, z)];
        const b = BLOCKS[id];
        if (!b || !b.randomTick) continue;
        const wx = c.cx * CHUNK_X + x, wz = c.cz * CHUNK_Z + z;
        this._applyRandomTick(b.randomTick, id, wx, y, wz, nowMs);
      }
    }
  }

  _applyRandomTick(kind, id, x, y, z, now) {
    switch (kind) {
      case 'grass': {
        const above = this.getBlock(x, y + 1, z);
        if (opaqueAt(above) || isFluid(above)) { this.setBlock(x, y, z, B.SOIL, { now }); break; }
        if (this.rng() < 0.3) {
          const dx = (this.rng() * 3 | 0) - 1, dz = (this.rng() * 3 | 0) - 1;
          const dy = (this.rng() * 3 | 0) - 1;
          if (this.getBlock(x + dx, y + dy, z + dz) === B.SOIL &&
              this.getBlock(x + dx, y + dy + 1, z + dz) === B.AIR &&
              (this.lightAt(x + dx, y + dy + 1, z + dz) >> 4) >= 6) {
            this.setBlock(x + dx, y + dy, z + dz, B.GRASS, { now });
          }
        }
        break;
      }
      case 'crop': {
        const light = this.lightAt(x, Math.min(y + 1, 127), z);
        if (Math.max(light >> 4, light & 15) >= 8 && this.rng() < 0.4) {
          this.setBlock(x, y, z, id + 1, { now });
        }
        break;
      }
      case 'berry':
        if (this.rng() < 0.25) this.setBlock(x, y, z, B.BERRYBUSH_RIPE, { now });
        break;
      case 'stem': {
        // Mature stem: occasionally set its fruit on a free adjacent ground cell.
        if (this.rng() > 0.35) break;
        const fruit = BLOCKS[id].fruit;
        const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][(this.rng() * 4) | 0];
        if (this.getBlock(x + dx, y, z + dz) !== B.AIR) break;
        const below = this.getBlock(x + dx, y - 1, z + dz);
        if (below === B.FARMLAND || below === B.SOIL || below === B.GRASS || below === B.SAND) {
          this.setBlock(x + dx, y, z + dz, fruit, { now });
        }
        break;
      }
      case 'cane': {
        // Grow upward, capped at 3 tall.
        if (this.getBlock(x, y + 1, z) !== B.AIR) break;
        if (this.getBlock(x, y - 1, z) === B.SUGAR_CANE &&
            this.getBlock(x, y - 2, z) === B.SUGAR_CANE) break;
        if (this.rng() < 0.5) this.setBlock(x, y + 1, z, B.SUGAR_CANE, { now });
        break;
      }
      case 'sprout': {
        if (this.rng() > 0.2) break;
        const get = (gx, gy, gz) => this.getBlock(gx, gy, gz);
        if (!hasTreeRoom(get, x, y, z)) break;
        const set = (sx, sy, sz, bid, force) => {
          if (force || this.getBlock(sx, sy, sz) === B.AIR) this.setBlock(sx, sy, sz, bid, { now });
        };
        const rand = mulberry32((x * 73856093 ^ z * 19349663 ^ y) >>> 0);
        this.setBlock(x, y, z, B.AIR, { now });
        (id === B.ALDER_SPROUT ? placeAlder : placeFern)(set, get, rand, x, y, z);
        break;
      }
    }
  }

  // ── Queries ──────────────────────────────────────────────────────
  heightAt(x, z) {
    const c = this.chunkOf(x, z);
    if (c && c.hmap) return c.hmap[(z & 15) * CHUNK_X + (x & 15)];
    return this.generator.heightAt(x, z);
  }
  biomeAt(x, z) {
    const c = this.chunkOf(x, z);
    if (c && c.biomes) return c.biomes[(z & 15) * CHUNK_X + (x & 15)];
    return this.generator.biomeAt(x, z);
  }

  findSpawn() {
    if (this.dimension !== 'overworld') {
      // Non-overworld arrivals are placed by the portal system; this is a
      // fallback (e.g. corrupted meta): stand on the nearest generated ground.
      for (let r = 0; r < 400; r += 4) {
        const h = this.generator.heightAt(r, 0);
        if (h > 4) return [r + 0.5, h + 2, 0.5];
      }
      return [0.5, 80, 0.5];
    }
    for (let r = 0; r < 80; r++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const x = (r === 0 ? 0 : (Math.floor(Math.random() * r * 16) - r * 8));
        const z = (r === 0 ? 0 : (Math.floor(Math.random() * r * 16) - r * 8));
        const info = this.generator.columnInfo(x, z);
        if (info.biome !== BIOME.OCEAN && info.biome !== BIOME.RIVER && info.h >= SEA_LEVEL) {
          return [x + 0.5, info.h + 2.5, z + 0.5];
        }
      }
    }
    return [0.5, 90, 0.5];
  }

  // Voxel DDA raycast. Returns {x,y,z,nx,ny,nz,id} or null.
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    const frac = (v) => v - Math.floor(v);
    let tMaxX = dx !== 0 ? (dx > 0 ? (1 - frac(ox)) : frac(ox)) * tDeltaX : Infinity;
    let tMaxY = dy !== 0 ? (dy > 0 ? (1 - frac(oy)) : frac(oy)) * tDeltaY : Infinity;
    let tMaxZ = dz !== 0 ? (dz > 0 ? (1 - frac(oz)) : frac(oz)) * tDeltaZ : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let i = 0; i < 256; i++) {
      const id = this.getBlock(x, y, z);
      if (id !== B.AIR && !isFluid(id)) {
        return { x, y, z, nx, ny, nz, id, dist: t };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
      }
      if (t > maxDist) return null;
    }
    return null;
  }

  // Like raycast, but stops at the first fluid SOURCE block (for vessels).
  // Solid blocks still terminate the ray (returns null in that case).
  raycastFluid(ox, oy, oz, dx, dy, dz, maxDist) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    const frac = (v) => v - Math.floor(v);
    let tMaxX = dx !== 0 ? (dx > 0 ? (1 - frac(ox)) : frac(ox)) * tDeltaX : Infinity;
    let tMaxY = dy !== 0 ? (dy > 0 ? (1 - frac(oy)) : frac(oy)) * tDeltaY : Infinity;
    let tMaxZ = dz !== 0 ? (dz > 0 ? (1 - frac(oz)) : frac(oz)) * tDeltaZ : Infinity;
    let t = 0;
    for (let i = 0; i < 256; i++) {
      const id = this.getBlock(x, y, z);
      if (id === B.WATER || id === B.LAVA) return { x, y, z, id };
      if (id !== B.AIR && !isFluid(id)) return null;
      if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; }
      else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; }
      else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; }
      if (t > maxDist) return null;
    }
    return null;
  }

  // Persist all modified loaded chunks (autosave / quit).
  flushSaves() {
    if (!this.persistence) return Promise.resolve();
    const jobs = [];
    for (const c of this.chunks.values()) {
      if (c.modified && c.blocks) {
        jobs.push(this.persistence.saveChunk(c.cx, c.cz, c));
        c.modified = false;
      }
    }
    return Promise.all(jobs);
  }
}
