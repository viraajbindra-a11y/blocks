// Block interaction: raycast targeting, mining with progress + cracks,
// placement with rules, station use, farming, eating, entity melee.

import { REACH, MODE_BUILDER } from '../core/constants.js';
import { B, BLOCKS, blockById, blockIdByKey, isFluid, isShaped, shapeBoxes, connMask } from '../blocks.js';
import { itemByKey } from '../items.js';
import { PLAYER_W, PLAYER_H } from '../core/constants.js';

export class Interaction {
  /**
   * hooks: {particles, audio, openStation(kind), dropItems(x,y,z,[{key,count}]),
   *         getEntities(), onEntityHit(e,dmg,dir), toast(msg), blockLayer(id)}
   */
  constructor(world, player, hooks) {
    this.world = world;
    this.player = player;
    this.hooks = hooks;
    this.target = null;
    this.breakProgress = 0;
    this.breakTarget = null;   // "x,y,z" being mined
    this.swing = 0;
    this.placeCooldown = 0;
    this.eatCooldown = 0;
    this.mineCooldown = 0;
  }

  update(dt, input, nowS) {
    const p = this.player;
    if (p.dead) { this.target = null; this.breakProgress = 0; return; }
    this.swing = Math.max(0, this.swing - dt * 3.4);
    this.placeCooldown = Math.max(0, this.placeCooldown - dt);
    this.eatCooldown = Math.max(0, this.eatCooldown - dt);
    this.mineCooldown = Math.max(0, this.mineCooldown - dt);

    // Ray from eye
    const eye = p.eyePos();
    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    const dir = [-sy * cp, sp, -cy * cp];
    this.target = this.world.raycast(eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], REACH);

    // ── Melee: left press hits a creature before blocks ──
    if (input.buttonPressed[0]) {
      const hit = this._entityUnderRay(eye, dir);
      if (hit && (!this.target || hit.dist < this.target.dist)) {
        const tool = p.heldItem()?.tool;
        const dmg = tool ? tool.damage : 1;
        this.hooks.onEntityHit(hit.entity, dmg, [dir[0], 0.4, dir[2]]);
        if (tool) p.damageHeldTool(1);
        this.swing = 1;
        this._resetMining();
        return;
      }
    }

    // ── Mining ──
    if (input.buttons[0] && this.target) {
      this._mine(dt, input);
    } else {
      this._resetMining();
    }

    // ── Use / place ──
    const rightHeld = input.buttons[2];
    if ((input.buttonPressed[2] || (rightHeld && this.placeCooldown <= 0))) {
      this._use(input);
    }

    // ── Pick block ──
    if (input.buttonPressed[1] && this.target) {
      this._pickBlock();
    }
  }

  _resetMining() {
    this.breakProgress = 0;
    this.breakTarget = null;
  }

  _mine(dt, input) {
    const p = this.player;
    const t = this.target;
    const key = `${t.x},${t.y},${t.z}`;
    const block = blockById(t.id);
    if (block.hardness < 0) { this._resetMining(); return; }

    if (p.mode === MODE_BUILDER) {
      if (this.mineCooldown > 0) return;
      this.mineCooldown = 0.22;
      this._breakBlock(t, block, false);
      return;
    }

    if (this.breakTarget !== key) {
      this.breakTarget = key;
      this.breakProgress = 0;
      this._hitTick = 0;
    }
    const tool = p.heldItem()?.tool ?? null;
    const { time, canHarvest } = breakTime(block, tool);
    const slow = p.headInWater ? 2.2 : 1;
    this.breakProgress += dt / (time * slow);
    this.swing = Math.max(this.swing, 0.55);

    // Periodic hit feedback
    this._hitTick = (this._hitTick ?? 0) + dt;
    if (this._hitTick > 0.24) {
      this._hitTick = 0;
      this.hooks.audio.blockSound('hit', block.sound);
      if (this.hooks.particles) {
        this.hooks.particles.burstBlock(t.x, t.y, t.z, this.hooks.blockLayer(t.id), 2,
          this._brightAt(t.x, t.y, t.z));
      }
    }

    if (this.breakProgress >= 1) {
      this._breakBlock(t, block, canHarvest);
      if (block.tool && tool && tool.type === block.tool) p.damageHeldTool(1);
      else if (tool && block.hardness >= 1) p.damageHeldTool(1);
    }
  }

  // The cell holding a door's other half: upper sits at y+1 of its lower.
  // Returns {x,y,z,id} of the matching-family half, or null.
  _doorOtherHalf(x, y, z, block) {
    const dy = block.doorHalf === 'lower' ? 1 : -1;
    const oid = this.world.getBlock(x, y + dy, z);
    const ob = blockById(oid);
    if (ob.shape === 'door' && ob.item === block.item &&
        ob.doorHalf !== block.doorHalf) return { x, y: y + dy, z, id: oid };
    return null;
  }

  // Toggle a door open/closed. Flipping the ^4 open bit on both halves keeps
  // the leaf continuous; geometry + collision follow the new ids next step.
  _toggleDoor(t, block) {
    this.world.setBlock(t.x, t.y, t.z, t.id ^ 4);
    const other = this._doorOtherHalf(t.x, t.y, t.z, block);
    if (other) this.world.setBlock(other.x, other.y, other.z, other.id ^ 4);
    this.hooks.audio.blockSound(block.open ? 'break' : 'place', block.sound);
  }

  _breakBlock(t, block, canHarvest) {
    const w = this.world;
    this._resetMining();
    this.swing = 1;
    // Doors are 2 cells tall: breaking either half removes the whole leaf so
    // no orphaned half is left floating. Only the LOWER half carries the
    // drop table, so breaking via the upper half rolls the lower's drops.
    if (block.shape === 'door') {
      const other = this._doorOtherHalf(t.x, t.y, t.z, block);
      if (other) {
        if (block.doorHalf === 'upper' &&
            this.player.mode !== MODE_BUILDER && canHarvest) {
          const drops = rollDrops(blockById(other.id));
          if (drops.length) {
            this.hooks.dropItems(other.x + 0.5, other.y + 0.35, other.z + 0.5, drops);
          }
        }
        w.setBlock(other.x, other.y, other.z, B.AIR);
        if (other.y > t.y) this._popUnsupported(other.x, other.y + 1, other.z);
      }
    }
    // Vines above crops/plants: breaking support pops the plant too
    w.setBlock(t.x, t.y, t.z, B.AIR);
    this._popUnsupported(t.x, t.y + 1, t.z);
    this.hooks.audio.blockSound('break', block.sound);
    if (this.hooks.particles) {
      this.hooks.particles.burstBlock(t.x, t.y, t.z, this.hooks.blockLayer(block.id), 14,
        this._brightAt(t.x, t.y, t.z));
    }
    if (this.player.mode !== MODE_BUILDER && canHarvest) {
      const drops = rollDrops(block);
      if (drops.length) this.hooks.dropItems(t.x + 0.5, t.y + 0.35, t.z + 0.5, drops);
    }
    if (this.hooks.onBroken) this.hooks.onBroken(t.x, t.y, t.z, block.id);
  }

  // A plant sitting on a broken block breaks with it.
  _popUnsupported(x, y, z) {
    const id = this.world.getBlock(x, y, z);
    const b = blockById(id);
    if (id === B.AIR || !b.cross) return;
    this.world.setBlock(x, y, z, B.AIR);
    if (this.player.mode !== MODE_BUILDER) {
      const drops = rollDrops(b);
      if (drops.length) this.hooks.dropItems(x + 0.5, y + 0.3, z + 0.5, drops);
    }
  }

  _use(input) {
    const p = this.player;
    const t = this.target;
    const held = p.heldItem();

    // 1. Interactive blocks (unless sneaking)
    if (t && !p.crouching) {
      const block = blockById(t.id);
      if (block.use === 'worktable') {
        if (input.buttonPressed[2]) {
          this.hooks.openStation(block.use);
          this.placeCooldown = 0.3;
        }
        return;
      }
      if (block.use === 'kiln') {
        if (input.buttonPressed[2] && this.hooks.openFurnace) {
          this.hooks.openFurnace(t.x, t.y, t.z);
          this.placeCooldown = 0.3;
        }
        return;
      }
      if (block.use === 'sleep') {
        if (input.buttonPressed[2] && this.hooks.sleep) {
          this.hooks.sleep(t.x, t.y, t.z);
          this.placeCooldown = 0.4;
        }
        return;
      }
      if (block.use === 'stowbox') {
        if (input.buttonPressed[2] && this.hooks.openContainer) {
          this.hooks.openContainer(t.x, t.y, t.z);
          this.placeCooldown = 0.3;
        }
        return;
      }
      if (block.use === 'gate') {
        if (input.buttonPressed[2]) {
          // Toggle the open bit (id ^ 1); geometry + collision follow the
          // new state on the next mesh/physics step.
          this.world.setBlock(t.x, t.y, t.z, t.id ^ 1);
          this.hooks.audio.blockSound(block.open ? 'break' : 'place', block.sound);
          this.placeCooldown = 0.3;
          this.swing = 0.6;
        }
        return;
      }
      if (block.use === 'door') {
        if (input.buttonPressed[2]) {
          // TODO(sparkwire): ironbound doors are signalGated — once the
          // Sparkwire power system lands, block interact-toggle on them and
          // drive `open` from the wire signal instead. For now they toggle.
          this._toggleDoor(t, block);
          this.placeCooldown = 0.3;
          this.swing = 0.6;
        }
        return;
      }
      if (block.use === 'flap') {
        if (input.buttonPressed[2]) {
          // TODO(sparkwire): ironbound flaps are signalGated (see doors).
          this.world.setBlock(t.x, t.y, t.z, t.id ^ 4);   // flip open bit
          this.hooks.audio.blockSound(block.open ? 'break' : 'place', block.sound);
          this.placeCooldown = 0.3;
          this.swing = 0.6;
        }
        return;
      }
      if (block.use === 'berries') {
        this.world.setBlock(t.x, t.y, t.z, B.BERRYBUSH);
        const n = 1 + (Math.random() * 2 | 0);
        this.hooks.dropItems(t.x + 0.5, t.y + 0.4, t.z + 0.5, [{ key: 'sweet_berries', count: n }]);
        this.hooks.audio.blockSound('break', 'plant');
        this.placeCooldown = 0.3;
        this.swing = 0.7;
        return;
      }
    }

    if (!held) return;

    // 1b. Vessels: scoop / pour fluids
    if (held.key === 'bucket' || held.key === 'water_bucket' || held.key === 'lava_bucket') {
      if (input.buttonPressed[2]) this._useVessel(held);
      return;
    }

    // 1c. Kindle flint: ignite a rift frame
    if (held.key === 'flint_and_steel') {
      if (input.buttonPressed[2] && t && this.hooks.ignite) {
        const dim = this.hooks.ignite(t.x + t.nx, t.y + t.ny, t.z + t.nz);
        if (dim) {
          this.hooks.audio.blockSound('place', 'glass');
          this.swing = 1;
        } else {
          this.hooks.audio.blockSound('hit', 'stone');
        }
        this.placeCooldown = 0.4;
      }
      return;
    }

    // 2. Food
    if (held.kind === 'food') {
      if (this.eatCooldown <= 0 && p.eat(held.food)) {
        p.consumeHeld(1);
        this.hooks.audio.play('eat');
        this.eatCooldown = 0.9;
        this.swing = 0.8;
      }
      return;
    }

    if (!t) return;

    // 3. Tiller: till soil into farmland
    if (held.tool?.type === 'hoe') {
      if ((t.id === B.GRASS || t.id === B.SOIL) && t.ny === 1 &&
          this.world.getBlock(t.x, t.y + 1, t.z) === B.AIR) {
        this.world.setBlock(t.x, t.y, t.z, B.FARMLAND);
        this.hooks.audio.blockSound('hit', 'soft');
        p.damageHeldTool(1);
        this.placeCooldown = 0.28;
        this.swing = 0.8;
      }
      return;
    }

    // 4. Seeds
    if (held.key === 'seeds') {
      if (t.id === B.FARMLAND && this.world.getBlock(t.x, t.y + 1, t.z) === B.AIR) {
        this.world.setBlock(t.x, t.y + 1, t.z, B.CROP_0);
        p.consumeHeld(1);
        this.hooks.audio.blockSound('place', 'plant');
        this.placeCooldown = 0.24;
        this.swing = 0.7;
      }
      return;
    }

    // 5. Block placement
    if (held.kind === 'block') {
      this._placeBlock(t, held);
    }
  }

  _placeBlock(t, held) {
    const w = this.world;
    const p = this.player;
    const block = blockById(held.block);

    // Ledge stacking: click the exposed half of a matching ledge to complete
    // it into a full block, filling the SAME cell instead of a neighbor.
    if (block.shape === 'slab') {
      const merged = this._tryLedgeMerge(t, block);
      if (merged) return;
    }

    const px = t.x + t.nx, py = t.y + t.ny, pz = t.z + t.nz;
    if (py < 0 || py > 127) return;
    const destId = w.getBlock(px, py, pz);
    const dest = blockById(destId);
    if (destId !== B.AIR && !dest.replaceable) return;

    // Resolve the concrete shaped state id from click position + yaw.
    const placeId = block.shape === 'cube'
      ? held.block
      : this._resolveShapedState(block, t, px, py, pz);

    // Doors occupy two stacked cells: the resolved lower half here + an upper
    // half in the cell above. Both must be free and clear of the player.
    if (block.shape === 'door') {
      if (py + 1 > 127) return;
      const upId = w.getBlock(px, py + 1, pz);
      const up = blockById(upId);
      if (upId !== B.AIR && !up.replaceable) return;
      const upperId = placeId + (1 << 4);   // same facing/hinge/open, upper half
      if (this._intersectsPlayer(px, py, pz, placeId) ||
          this._intersectsPlayer(px, py + 1, pz, upperId)) return;
      w.setBlock(px, py, pz, placeId);
      w.setBlock(px, py + 1, pz, upperId);
      p.consumeHeld(1);
      this.hooks.audio.blockSound('place', block.sound);
      this.placeCooldown = 0.24;
      this.swing = 0.8;
      if (this.hooks.onPlaced) {
        this.hooks.onPlaced(px, py, pz, placeId);
        this.hooks.onPlaced(px, py + 1, pz, upperId);
      }
      return;
    }

    // Support rules (plants need the right ground)
    if (block.placeOn) {
      const below = w.getBlock(px, py - 1, pz);
      if (!block.placeOn.includes(below)) return;
    }
    if (block.needsFloor && !w.isSolid(px, py - 1, pz)) return;
    if (block.needsWall &&
        !(w.isSolid(px + 1, py, pz) || w.isSolid(px - 1, py, pz) ||
          w.isSolid(px, py, pz + 1) || w.isSolid(px, py, pz - 1))) return;
    // Don't place a solid box inside yourself (shaped blocks test sub-boxes).
    if (block.solid && this._intersectsPlayer(px, py, pz, placeId)) return;

    w.setBlock(px, py, pz, placeId);
    p.consumeHeld(1);
    this.hooks.audio.blockSound('place', block.sound);
    this.placeCooldown = 0.24;
    this.swing = 0.8;
    if (this.hooks.onPlaced) this.hooks.onPlaced(px, py, pz, placeId);
  }

  // Fractional hit point on the targeted face (eye + dir*dist).
  _hitPoint(t) {
    const p = this.player;
    const eye = p.eyePos();
    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    const dir = [-sy * cp, sp, -cy * cp];
    const d = t.dist ?? 0;
    return [eye[0] + dir[0] * d, eye[1] + dir[1] * d, eye[2] + dir[2] * d];
  }

  // Which half (bottom/top) does the click imply for a slab/stair placed in
  // cell (px,py,pz)? Top when clicking the underside of a block, or the
  // upper half of a vertical face; bottom otherwise.
  _clickHalfTop(t, py) {
    if (t.ny === -1) return true;          // placed against a ceiling → top
    if (t.ny === 1) return false;          // placed on a floor → bottom
    const hy = this._hitPoint(t)[1] - py;  // 0..1 within the target cell
    return (hy - Math.floor(hy)) > 0.5;
  }

  _resolveShapedState(block, t, px, py, pz) {
    const top = this._clickHalfTop(t, py);
    if (block.shape === 'slab') {
      return block.id + (top ? 1 : 0);     // base+0 bottom, base+1 top
    }
    // Palings, ramparts & panes carry no baked state — geometry is all from
    // neighbors, so the base id is placed as-is.
    if (block.shape === 'fence' || block.shape === 'wall' || block.shape === 'pane')
      return block.id;
    // Door: facing from player yaw (the leaf faces away from the player, so
    // it swings open away). hinge picks the left post. Placed closed, lower
    // half; the upper half is added by _placeBlock. State: half<<4 | hinge<<3
    // | open<<2 | facing.
    if (block.shape === 'door') {
      return block.id + this._facingFromYaw();   // lower, closed, hinge 0
    }
    // Flap: attach top/bottom from where the click lands; facing = the edge
    // the player faces (the hinge). State: attach<<3 | open<<2 | facing.
    if (block.shape === 'flap') {
      const top = this._clickHalfTop(t, py);
      return block.id + ((top ? 1 : 0) << 3) + this._facingFromYaw();
    }
    // Gate: axis from player yaw. Looking mostly along z (yaw ~0/π) sets a
    // line that runs along x (axis 0); looking along x sets axis 1. It is
    // placed closed. State layout: axis<<1 | open.
    if (block.shape === 'gate') {
      const yaw = this.player.yaw;
      const alongX = Math.abs(Math.cos(yaw)) >= Math.abs(Math.sin(yaw));
      return block.id + ((alongX ? 0 : 1) << 1);
    }
    // Stair: facing from player yaw (which cardinal the player looks along).
    return block.id + ((top ? 1 : 0) << 2 | this._facingFromYaw());
  }

  // Cardinal the player looks along → facing 0..3 = +z,-z,+x,-x. yaw 0 looks
  // toward -z. Shared by stairs, doors and flaps.
  _facingFromYaw() {
    const yaw = this.player.yaw;
    const s = Math.sin(yaw), c = Math.cos(yaw);
    // Look dir is (-sin, -cos): yaw 0 looks -z. Both branches return the
    // cardinal looked ALONG, matching the shape-box facing convention.
    if (Math.abs(c) >= Math.abs(s)) return c > 0 ? 1 : 0;   // -z / +z
    return s > 0 ? 3 : 2;                                   // -x / +x
  }

  // Complete a matching ledge already in the world into a full block.
  // Two ways to trigger: clicking the ledge's exposed half directly, or
  // clicking its exposed face such that the neighbor cell IS the ledge.
  _tryLedgeMerge(t, block) {
    const w = this.world;
    const p = this.player;
    const full = this._fullBlockFor(block.item);
    if (full == null) return false;
    // Candidate cells: the hit cell, and the cell we'd place into. A same-item
    // ledge in either, whose exposed half faces the click, completes it.
    const cands = [[t.x, t.y, t.z], [t.x + t.nx, t.y + t.ny, t.z + t.nz]];
    for (const [cx, cy, cz] of cands) {
      const b = BLOCKS[w.getBlock(cx, cy, cz)];
      if (!b || b.shape !== 'slab' || b.item !== block.item) continue;
      // The ledge's empty half is what we fill: bottom ledge → top, & vice
      // versa. Require the click to approach from that empty side so you can
      // still place a separate ledge against the solid side.
      const fillTop = b.half === 'bottom';
      // Clicking the top face of a bottom ledge (or bottom face of a top
      // ledge) always fills; side clicks use the vertical hit position.
      let approachesEmpty;
      if (t.ny === 1) approachesEmpty = fillTop;          // hit top face
      else if (t.ny === -1) approachesEmpty = !fillTop;   // hit bottom face
      else approachesEmpty = this._clickHalfTop(t, cy) === fillTop;
      if (!approachesEmpty) continue;
      if (blockById(full).solid && this._intersectsPlayer(cx, cy, cz, full)) return true;
      w.setBlock(cx, cy, cz, full);
      p.consumeHeld(1);
      this.hooks.audio.blockSound('place', block.sound);
      this.placeCooldown = 0.24;
      this.swing = 0.8;
      if (this.hooks.onPlaced) this.hooks.onPlaced(cx, cy, cz, full);
      return true;
    }
    return false;
  }

  // The full cube a stacked ledge collapses into, keyed by shared item.
  _fullBlockFor(item) {
    switch (item) {
      case 'oak_slab': return B.PLANKS;
      case 'cobblestone_slab': return B.RUBBLE;
      case 'nether_brick_slab': return B.SCORCHBRICK;
      default: return null;
    }
  }

  _useVessel(held) {
    const p = this.player;
    const w = this.world;
    const eye = p.eyePos();
    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    const dir = [-sy * cp, sp, -cy * cp];

    if (held.key === 'bucket') {
      const hit = w.raycastFluid(eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], REACH);
      if (!hit) return;
      const filled = hit.id === B.WATER ? 'water_bucket' : 'lava_bucket';
      w.setBlock(hit.x, hit.y, hit.z, B.AIR);
      p.consumeHeld(1);
      if (p.addItem(filled, 1) > 0) this.hooks.dropItems(eye[0], eye[1], eye[2], [{ key: filled, count: 1 }]);
      this.hooks.audio.play('splash', { vol: 0.7, pitch: hit.id === B.LAVA ? 0.6 : 1.1 });
      this.placeCooldown = 0.35;
      this.swing = 0.8;
    } else {
      const t = this.target;
      if (!t) return;
      const px = t.x + t.nx, py = t.y + t.ny, pz = t.z + t.nz;
      const dest = blockById(this.world.getBlock(px, py, pz));
      if (this.world.getBlock(px, py, pz) !== B.AIR && !dest.replaceable) return;
      w.setBlock(px, py, pz, held.key === 'water_bucket' ? B.WATER : B.LAVA);
      p.consumeHeld(1);
      if (p.addItem('bucket', 1) > 0) this.hooks.dropItems(eye[0], eye[1], eye[2], [{ key: 'bucket', count: 1 }]);
      this.hooks.audio.play('splash', { vol: 0.8 });
      this.placeCooldown = 0.35;
      this.swing = 0.8;
    }
  }

  _intersectsPlayer(bx, by, bz, id = null) {
    const p = this.player.pos;
    const h = this.player.crouching ? 1.5 : PLAYER_H;
    const hw = PLAYER_W / 2;
    const pMinX = p[0] - hw, pMaxX = p[0] + hw;
    const pMinZ = p[2] - hw, pMaxZ = p[2] + hw;
    const pMinY = p[1], pMaxY = p[1] + h;
    // Shaped blocks only occupy their sub-boxes — placing a bottom ledge at
    // the player's head, or a top ledge at their feet, must not be blocked.
    // Test the COLLISION geometry (tall posts, connection arms), not the
    // visual boxes, or a placement can embed the player in a fence.
    const boxes = (id != null && isShaped(id))
      ? shapeBoxes(
          BLOCKS[id],
          BLOCKS[id].connects
            ? connMask(BLOCKS[id], (dx, dz) => this.world.getBlock(bx + dx, by, bz + dz))
            : 0,
          true)
      : [[0, 0, 0, 1, 1, 1]];
    for (const b of boxes) {
      if (pMaxX > bx + b[0] && pMinX < bx + b[3] &&
          pMaxY > by + b[1] && pMinY < by + b[4] &&
          pMaxZ > bz + b[2] && pMinZ < bz + b[5]) return true;
    }
    return false;
  }

  _pickBlock() {
    const p = this.player;
    const tb = blockById(this.target.id);
    // Shaped states share one item; pick that rather than the state key.
    const key = tb.item ?? tb.key;
    if (!itemByKey(key)) return;
    // Already in hotbar?
    for (let i = 0; i < 9; i++) {
      if (p.slots[i]?.key === key) { p.selected = i; return; }
    }
    if (p.mode === MODE_BUILDER) {
      p.slots[p.selected] = { key, count: 1 };
    } else {
      // Pull from backpack if we have it
      for (let i = 9; i < 36; i++) {
        if (p.slots[i]?.key === key) {
          const tmp = p.slots[p.selected];
          p.slots[p.selected] = p.slots[i];
          p.slots[i] = tmp;
          return;
        }
      }
    }
  }

  _entityUnderRay(eye, dir) {
    const entities = this.hooks.getEntities ? this.hooks.getEntities() : [];
    let best = null;
    for (const e of entities) {
      if (e.kind === 'item' || e.dead) continue;
      const t = rayAABB(eye, dir, e.aabb());
      if (t !== null && t < 3.6 && (!best || t < best.dist)) {
        best = { entity: e, dist: t };
      }
    }
    return best;
  }

  _brightAt(x, y, z) {
    const l = this.world.lightAt(x, y + 1, z);
    return Math.max(0.25, Math.max((l >> 4) / 15, (l & 15) / 15));
  }
}

export function breakTime(block, tool) {
  if (block.hardness < 0) return { time: Infinity, canHarvest: false };
  let speed = 1;
  let canHarvest = true;
  if (block.tool) {
    if (tool && tool.type === block.tool) {
      if (tool.tier >= block.minTier) speed = tool.speed;
      else canHarvest = false;
    } else {
      canHarvest = block.minTier <= 0;
    }
  }
  let time = block.hardness / speed;
  if (!canHarvest) time *= 3.3;
  return { time: Math.max(time, 0.05), canHarvest };
}

export function rollDrops(block) {
  if (block.drops === 'self') return [{ key: block.key, count: 1 }];
  const out = [];
  for (const d of block.drops) {
    if (d.chance !== undefined && Math.random() > d.chance) continue;
    const count = d.min + Math.floor(Math.random() * (d.max - d.min + 1));
    if (count > 0) out.push({ key: d.item, count });
  }
  return out;
}

function rayAABB(o, d, box) {
  let tmin = 0, tmax = 64;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < box.min[i] || o[i] > box.max[i]) return null;
    } else {
      let t1 = (box.min[i] - o[i]) / d[i];
      let t2 = (box.max[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}
