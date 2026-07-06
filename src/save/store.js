// BLOCKS — IndexedDB persistence for worlds, chunks and player state.
// Falls back to a volatile in-memory store when indexedDB is unavailable.

import { SAVE_VERSION, CHUNK_VOL } from '../core/constants.js';

const DB_NAME = 'loam';   // legacy internal name — kept so pre-rebrand saves still load
const DB_VERSION = 1;
const BIOMES_LEN = 256;

// ── RLE codec (byte pairs: count 1..255, value) ───────────────────
function rleEncode(src) {
  const out = new Uint8Array(src.length * 2);
  let o = 0, i = 0;
  while (i < src.length) {
    const v = src[i];
    let run = 1;
    while (run < 255 && i + run < src.length && src[i + run] === v) run++;
    out[o++] = run;
    out[o++] = v;
    i += run;
  }
  return out.slice(0, o);
}

// Returns Uint8Array(expected) or null on corruption.
function rleDecode(enc, expected) {
  if (!(enc instanceof Uint8Array) || enc.length & 1) return null;
  const out = new Uint8Array(expected);
  let o = 0;
  for (let i = 0; i < enc.length; i += 2) {
    const n = enc[i];
    if (n === 0 || o + n > expected) return null;
    out.fill(enc[i + 1], o, o + n);
    o += n;
  }
  return o === expected ? out : null;
}

const chunkKey = (worldId, cx, cz) => `${worldId}:${cx}:${cz}`;

function newMeta({ name, seed, mode }) {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name, seed, mode,
    createdAt: now,
    playedAt: now,
    timeOfDay: 0.3,
    player: null,
    weather: null,
    version: SAVE_VERSION,
  };
}

// Encode a live chunk into a storable record (copies — chunk keeps mutating).
function packChunk(chunk) {
  return { b: rleEncode(chunk.blocks), bio: chunk.biomes.slice() };
}

function unpackChunk(rec) {
  if (!rec) return null;
  const blocks = rleDecode(rec.b, CHUNK_VOL);
  if (!blocks) return null;
  const biomes = rec.bio instanceof Uint8Array && rec.bio.length === BIOMES_LEN
    ? rec.bio : new Uint8Array(BIOMES_LEN);
  return { blocks, biomes };
}

class StoreBase {
  /**
   * Bound adapter handed to World({persistence}). Chunks are namespaced
   * per dimension; 'overworld' keeps the legacy un-prefixed keys.
   */
  persistenceFor(worldId, dim = 'overworld') {
    const scopedId = dim === 'overworld' ? worldId : `${worldId}/${dim}`;
    return {
      loadChunk: (cx, cz) => this.loadChunk(scopedId, cx, cz),
      saveChunk: (cx, cz, chunk) => this.saveChunk(scopedId, cx, cz, chunk),
    };
  }
}

// ── IndexedDB-backed store ────────────────────────────────────────
const reqP = r => new Promise((res, rej) => {
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const txDone = tx => new Promise((res, rej) => {
  tx.oncomplete = () => res();
  tx.onerror = () => rej(tx.error);
  tx.onabort = () => rej(tx.error);
});

class IDBStore extends StoreBase {
  constructor(db) {
    super();
    this.db = db;
  }

  async listWorlds() {
    const tx = this.db.transaction('worlds', 'readonly');
    const all = await reqP(tx.objectStore('worlds').getAll());
    return all.sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0));
  }

  async createWorld(opts) {
    const meta = newMeta(opts);
    await this.saveWorldMeta(meta);
    return meta;
  }

  async getWorldMeta(id) {
    const tx = this.db.transaction('worlds', 'readonly');
    const meta = await reqP(tx.objectStore('worlds').get(id));
    return meta ?? null;
  }

  async saveWorldMeta(meta) {
    const tx = this.db.transaction('worlds', 'readwrite');
    tx.objectStore('worlds').put(meta);
    await txDone(tx);
  }

  async deleteWorld(id) {
    const tx = this.db.transaction(['worlds', 'chunks'], 'readwrite');
    tx.objectStore('worlds').delete(id);
    // ':' sorts just below ';', so this range covers exactly `${id}:*`.
    tx.objectStore('chunks').delete(IDBKeyRange.bound(id + ':', id + ';', false, true));
    await txDone(tx);
  }

  async saveChunk(worldId, cx, cz, chunk) {
    const rec = packChunk(chunk);
    const tx = this.db.transaction('chunks', 'readwrite');
    tx.objectStore('chunks').put(rec, chunkKey(worldId, cx, cz));
    await txDone(tx);
  }

  async loadChunk(worldId, cx, cz) {
    const tx = this.db.transaction('chunks', 'readonly');
    const rec = await reqP(tx.objectStore('chunks').get(chunkKey(worldId, cx, cz)));
    return unpackChunk(rec);
  }

  close() {
    this.db.close();
  }
}

// ── In-memory fallback (does not survive reloads) ─────────────────
class MemStore extends StoreBase {
  constructor() {
    super();
    this.worlds = new Map();   // id → meta
    this.chunks = new Map();   // `${worldId}:${cx}:${cz}` → record
  }

  async listWorlds() {
    return [...this.worlds.values()].sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0));
  }

  async createWorld(opts) {
    const meta = newMeta(opts);
    this.worlds.set(meta.id, meta);
    return meta;
  }

  async getWorldMeta(id) {
    return this.worlds.get(id) ?? null;
  }

  async saveWorldMeta(meta) {
    this.worlds.set(meta.id, meta);
  }

  async deleteWorld(id) {
    this.worlds.delete(id);
    const prefix = id + ':';
    for (const key of this.chunks.keys()) {
      if (key.startsWith(prefix)) this.chunks.delete(key);
    }
  }

  async saveChunk(worldId, cx, cz, chunk) {
    this.chunks.set(chunkKey(worldId, cx, cz), packChunk(chunk));
  }

  async loadChunk(worldId, cx, cz) {
    return unpackChunk(this.chunks.get(chunkKey(worldId, cx, cz)));
  }

  close() {}
}

/** Open the save store; resolves to an IDBStore, or MemStore if IndexedDB is unusable. */
export async function openStore() {
  if (typeof indexedDB === 'undefined') {
    console.warn(`${DB_NAME}: indexedDB unavailable — saves will not survive reloads.`);
    return new MemStore();
  }
  try {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('worlds')) d.createObjectStore('worlds', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('database open blocked'));
    });
    return new IDBStore(db);
  } catch (e) {
    console.warn(`${DB_NAME}: failed to open IndexedDB — falling back to in-memory store.`, e);
    return new MemStore();
  }
}
