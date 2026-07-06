// Cellular fluid simulation. Water spreads 6 blocks from a source and
// falls forever; lava spreads 2 steps and flows slowly. Water touching
// lava quenches it to basalt (sources) or stone (flows).

import { FLUID_TICK_MS } from '../core/constants.js';
import {
  B, isWater, isLava, isFluid, fluidLevel, waterFlowId, lavaFlowId, blockById,
} from '../blocks.js';

const H4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class FluidSim {
  constructor(world) {
    this.world = world;
    this.queue = new Map();   // "x,y,z" -> dueTime
  }

  schedule(x, y, z, now, lava = false) {
    if (y < 0 || y > 127) return;
    const key = `${x},${y},${z}`;
    const due = now + FLUID_TICK_MS * (lava ? 3 : 1);
    const cur = this.queue.get(key);
    if (cur === undefined || due < cur) this.queue.set(key, due);
  }

  scheduleAround(x, y, z, now) {
    const w = this.world;
    for (const [cx, cy, cz] of [[x,y,z],[x+1,y,z],[x-1,y,z],[x,y+1,z],[x,y-1,z],[x,y,z+1],[x,y,z-1]]) {
      const id = w.getBlock(cx, cy, cz);
      if (isFluid(id)) this.schedule(cx, cy, cz, now, isLava(id));
    }
  }

  tick(now, budget = 400) {
    if (this.queue.size === 0) return;
    const due = [];
    for (const [key, t] of this.queue) {
      if (t <= now) { due.push(key); if (due.length >= budget) break; }
    }
    for (const key of due) {
      this.queue.delete(key);
      const [x, y, z] = key.split(',').map(Number);
      this.step(x, y, z, now);
    }
  }

  step(x, y, z, now) {
    const w = this.world;
    const id = w.getBlock(x, y, z);
    if (!isFluid(id)) return;
    const water = isWater(id);
    const source = id === B.WATER || id === B.LAVA;
    let level = fluidLevel(id);

    // Lava + water → rock (checked from the lava side)
    if (!water) {
      for (const [dx, dy, dz] of [[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]) {
        if (isWater(w.getBlock(x + dx, y + dy, z + dz))) {
          w.setBlock(x, y, z, source ? B.BASALT : B.STONE, { bySim: true });
          return;
        }
      }
    }

    const sameKind = i => water ? isWater(i) : isLava(i);

    // Non-source cells must be fed by a neighbor, or they drain away.
    if (!source) {
      let support = 0;
      if (sameKind(w.getBlock(x, y + 1, z))) support = water ? 6 : 5;
      else {
        const drop = water ? 1 : 2;
        for (const [dx, dz] of H4) {
          const n = w.getBlock(x + dx, y, z + dz);
          if (sameKind(n)) support = Math.max(support, fluidLevel(n) - drop);
        }
      }
      if (support <= 0) {
        w.setBlock(x, y, z, B.AIR, { bySim: true });
        this.scheduleAround(x, y, z, now);
        return;
      }
      if (support !== level) {
        const capped = Math.min(support, water ? 6 : 5);
        w.setBlock(x, y, z, water ? waterFlowId(capped) : lavaFlowId(capped), { bySim: true });
        level = capped;
        this.scheduleAround(x, y, z, now);
      }
      // Two adjacent sources over solid ground make a new source (ponds refill).
      if (water) {
        let sources = 0;
        for (const [dx, dz] of H4) if (w.getBlock(x + dx, y, z + dz) === B.WATER) sources++;
        const below = blockById(w.getBlock(x, y - 1, z));
        if (sources >= 2 && (below.solid || isWater(w.getBlock(x, y - 1, z)))) {
          w.setBlock(x, y, z, B.WATER, { bySim: true });
        }
      }
    }

    const canFlowInto = i => {
      if (i === B.AIR) return true;
      const b = blockById(i);
      if (b.replaceable && !isFluid(i)) return true;         // wash out plants
      if (sameKind(i) && i !== (water ? B.WATER : B.LAVA)) return true; // raise level
      return false;
    };

    // Fall
    const belowId = w.getBlock(x, y - 1, z);
    if (!water && isWater(belowId)) {
      w.setBlock(x, y - 1, z, B.STONE, { bySim: true });
      return;
    }
    if (water && isLava(belowId)) {
      w.setBlock(x, y - 1, z, belowId === B.LAVA ? B.BASALT : B.STONE, { bySim: true });
      return;
    }
    if (y > 0 && canFlowInto(belowId) && !sameKind(belowId)) {
      w.setBlock(x, y - 1, z, water ? waterFlowId(6) : lavaFlowId(5), { bySim: true });
      this.schedule(x, y - 1, z, now, !water);
      if (!source) return;   // falling stream doesn't also spread sideways
    }

    // Spread sideways over solid ground
    const belowNow = w.getBlock(x, y - 1, z);
    const grounded = blockById(belowNow).solid || sameKind(belowNow);
    const spread = water ? level - 1 : level - 2;
    if (grounded && spread >= 1) {
      for (const [dx, dz] of H4) {
        const nx = x + dx, nz = z + dz;
        const nid = w.getBlock(nx, y, nz);
        if (!water && isWater(nid)) continue;   // handled by quench rules
        if (sameKind(nid) && fluidLevel(nid) >= spread) continue;
        if (canFlowInto(nid) || (sameKind(nid) && fluidLevel(nid) < spread)) {
          if (water && isLava(nid)) {
            w.setBlock(nx, y, nz, nid === B.LAVA ? B.BASALT : B.STONE, { bySim: true });
          } else {
            w.setBlock(nx, y, nz, water ? waterFlowId(spread) : lavaFlowId(spread), { bySim: true });
            this.schedule(nx, y, nz, now, !water);
          }
        }
      }
    }
  }
}
