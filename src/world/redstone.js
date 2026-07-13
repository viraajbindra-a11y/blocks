// Redstone power simulation — a compact but real signal network.
//
// Sources (redstone block, lit lever, pressed button, redstone torch) emit
// power 15. Redstone dust carries it, dropping 1 per cell and climbing one
// block up/down so it runs over terrain. Consumers react to being powered:
// lamps light, primed-adjacent TNT ignites, dispensers fire on a rising edge.
//
// The world calls onEdit() whenever a block changes and tick() each frame;
// work only happens when something redstone-relevant actually changed.

import { B } from '../blocks.js';

const DIRS6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const SOURCES = new Set([B.REDSTONE_BLOCK, B.LEVER_ON, B.STONE_BUTTON_ON, B.REDSTONE_TORCH]);
const COMPONENT = new Set([...SOURCES, B.REDSTONE_WIRE, B.REDSTONE_LAMP, B.REDSTONE_LAMP_ON,
  B.DISPENSER, B.TNT, B.STONE_BUTTON, B.LEVER]);

const key = (x, y, z) => `${x},${y},${z}`;
const parse = (k) => k.split(',').map(Number);

export class RedstoneSim {
  constructor(world, hooks = {}) {
    this.world = world;
    this.hooks = hooks;
    this.comps = new Set();            // "x,y,z" of tracked components
    this.power = new Map();            // wire key -> level 1..15
    this.buttons = new Map();          // pressed button key -> press time (ms)
    this.poweredDispensers = new Set();
    this.dirty = true;
    this._now = 0;
    this._recomputing = false;
  }

  onEdit(x, y, z, oldId, newId) {
    const k = key(x, y, z);
    if (COMPONENT.has(newId)) this.comps.add(k); else this.comps.delete(k);
    if (newId === B.STONE_BUTTON_ON) this.buttons.set(k, this._now);
    if (this._recomputing) return;                       // our own consumer writes
    if (COMPONENT.has(newId) || COMPONENT.has(oldId)) this.dirty = true;
  }

  tick(nowMs) {
    this._now = nowMs;
    for (const [k, t] of this.buttons) {                 // momentary buttons pop back after 1s
      if (nowMs - t > 1000) {
        const [x, y, z] = parse(k);
        if (this.world.getBlock(x, y, z) === B.STONE_BUTTON_ON) {
          this.world.setBlock(x, y, z, B.STONE_BUTTON);
          this.dirty = true;
        }
        this.buttons.delete(k);
      }
    }
    if (!this.dirty) return;
    this.dirty = false;
    this._recompute();
  }

  _recompute() {
    const w = this.world;
    const power = new Map();
    const queue = [];
    const isSource = (x, y, z) => SOURCES.has(w.getBlock(x, y, z));

    // Seed: every wire touching a source starts at full strength.
    for (const k of this.comps) {
      const [x, y, z] = parse(k);
      if (w.getBlock(x, y, z) !== B.REDSTONE_WIRE) continue;
      for (const [dx, dy, dz] of DIRS6) {
        if (isSource(x + dx, y + dy, z + dz)) { power.set(k, 15); queue.push([x, y, z, 15]); break; }
      }
    }
    // Flood through connected dust, dropping one per step, climbing ±1 in y.
    while (queue.length) {
      const [x, y, z, l] = queue.shift();
      if (l <= 1) continue;
      for (const [dx, dz] of DIRS4) for (const dy of [0, 1, -1]) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (w.getBlock(nx, ny, nz) !== B.REDSTONE_WIRE) continue;
        const nk = key(nx, ny, nz);
        if ((power.get(nk) || 0) >= l - 1) continue;
        power.set(nk, l - 1);
        queue.push([nx, ny, nz, l - 1]);
      }
    }
    this.power = power;

    const poweredAt = (x, y, z) => {
      for (const [dx, dy, dz] of DIRS6) {
        const nx = x + dx, ny = y + dy, nz = z + dz, nid = w.getBlock(nx, ny, nz);
        if (SOURCES.has(nid)) return true;
        if (nid === B.REDSTONE_WIRE && (power.get(key(nx, ny, nz)) || 0) > 0) return true;
      }
      return false;
    };

    this._recomputing = true;
    const dispensersNow = new Set();
    for (const k of [...this.comps]) {
      const [x, y, z] = parse(k);
      const id = w.getBlock(x, y, z);
      const on = poweredAt(x, y, z);
      if (id === B.REDSTONE_LAMP && on) w.setBlock(x, y, z, B.REDSTONE_LAMP_ON);
      else if (id === B.REDSTONE_LAMP_ON && !on) w.setBlock(x, y, z, B.REDSTONE_LAMP);
      else if (id === B.TNT && on) { w.setBlock(x, y, z, B.AIR); this.comps.delete(k); this.hooks.primeTnt?.(x, y, z); }
      else if (id === B.DISPENSER && on) {
        dispensersNow.add(k);
        if (!this.poweredDispensers.has(k)) this.hooks.dispense?.(x, y, z);
      }
    }
    this._recomputing = false;
    this.poweredDispensers = dispensersNow;
  }

  // Power level of the dust at a cell (for tests / rendering), 0 if none.
  powerAt(x, y, z) { return this.power.get(key(x, y, z)) || 0; }
}
