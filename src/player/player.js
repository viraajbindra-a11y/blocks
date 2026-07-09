// Player: first-person controller with AABB voxel physics, survival
// stats, and inventory. Movement: walk/sprint/crouch/jump/swim/climb,
// smooth acceleration, air control, fall damage, head bob, builder flight.

import {
  GRAVITY, JUMP_SPEED, WALK_SPEED, SPRINT_SPEED, CROUCH_SPEED, SWIM_SPEED,
  CLIMB_SPEED, AIR_CONTROL, PLAYER_W, PLAYER_H, EYE_HEIGHT, EYE_CROUCH,
  FALL_SAFE, MAX_HEALTH, MAX_HUNGER, MAX_AIR, MODE_BUILDER, CHUNK_Y,
} from '../core/constants.js';
import { B, BLOCKS, blockById, isWater, isLava, isFluid } from '../blocks.js';
import { itemByKey } from '../items.js';
import { clamp, lerp } from '../math/noise.js';

const HALF_W = PLAYER_W / 2;

export class Player {
  constructor(world, mode) {
    this.world = world;
    this.mode = mode;
    this.pos = [0.5, 80, 0.5];        // feet position
    this.vel = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;

    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.air = MAX_AIR;
    this.dead = false;

    this.onGround = false;
    this.inWater = false;
    this.headInWater = false;
    this.headInLava = false;
    this.inLava = false;
    this.onClimbable = false;
    this.sprinting = false;
    this.crouching = false;
    this.flying = false;

    this.eyeOffset = EYE_HEIGHT;
    this.bobPhase = 0;
    this.bobAmp = 0;
    this.fallStart = null;
    this.fovExtra = 0;                // smoothed sprint FOV kick
    this.exhaustion = 0;              // accumulates → drains hunger
    this.regenTimer = 0;
    this.hurtTimer = 0;
    this.lastJumpPress = -10;

    // Inventory: 36 slots; 0-8 = hotbar. Slot: {key, count, dur?} | null
    this.slots = new Array(36).fill(null);
    this.selected = 0;
    // Worn armor: [helmet, chestplate, leggings, boots]
    this.armor = new Array(4).fill(null);
    this.shieldRaised = false;   // set by interaction while a raised shield is held

    // Event hooks set by main: onDamage(amount, cause), onDeath(cause),
    // onStep(blockId), onStateSound(kind)
    this.hooks = {};
  }

  // ── Inventory ────────────────────────────────────────────────────
  heldStack() { return this.slots[this.selected]; }
  heldItem() {
    const s = this.heldStack();
    return s ? itemByKey(s.key) : null;
  }

  // dur: optional durability carried by a dropped tool — preserved, never
  // reset to full (that would be a free repair exploit).
  addItem(key, count = 1, dur = undefined) {
    const def = itemByKey(key);
    if (!def) return count;
    let left = count;
    // Top up existing stacks (never stack tools)
    if (def.kind !== 'tool') {
      for (let i = 0; i < 36 && left > 0; i++) {
        const s = this.slots[i];
        if (s && s.key === key && s.dur === undefined && s.count < def.maxStack) {
          const take = Math.min(def.maxStack - s.count, left);
          s.count += take; left -= take;
        }
      }
    }
    // New stacks
    for (let i = 0; i < 36 && left > 0; i++) {
      if (!this.slots[i]) {
        const take = Math.min(def.maxStack, left);
        this.slots[i] = { key, count: take };
        if (def.kind === 'tool') this.slots[i].dur = dur ?? def.tool.durability;
        left -= take;
      }
    }
    return left;   // 0 if everything fit
  }

  consumeHeld(n = 1) {
    if (this.mode === MODE_BUILDER) return;
    const s = this.heldStack();
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
  }

  damageHeldTool(n = 1) {
    if (this.mode === MODE_BUILDER) return;
    const s = this.heldStack();
    if (!s || s.dur === undefined) return;
    s.dur -= n;
    if (s.dur <= 0) {
      this.slots[this.selected] = null;
      if (this.hooks.onToolBreak) this.hooks.onToolBreak(s.key);
    }
  }

  countOf(key) {
    let n = 0;
    for (const s of this.slots) if (s && s.key === key) n += s.count;
    return n;
  }

  // Total armor points across worn pieces (each ≈ 4% damage reduction).
  armorPoints() {
    let n = 0;
    for (const s of this.armor) {
      if (!s) continue;
      const def = itemByKey(s.key);
      if (def && def.armor) n += def.armor.points;
    }
    return n;
  }
  removeItems(key, count) {
    let left = count;
    for (let i = 0; i < 36 && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.key === key) {
        const take = Math.min(s.count, left);
        s.count -= take; left -= take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return count - left;
  }

  // ── Look ─────────────────────────────────────────────────────────
  applyLook(dx, dy, sensitivity, invertY) {
    const s = 0.0023 * sensitivity;
    this.yaw -= dx * s;
    this.pitch += (invertY ? dy : -dy) * s;
    const lim = Math.PI / 2 - 0.001;
    this.pitch = clamp(this.pitch, -lim, lim);
  }

  eyePos() {
    return [this.pos[0], this.pos[1] + this.eyeOffset, this.pos[2]];
  }

  // ── Physics step (fixed dt) ─────────────────────────────────────
  /** move: {fwd:-1..1, strafe:-1..1, jump, sprint, crouch, jumpPressed} */
  update(dt, move, nowS) {
    if (this.dead) return;
    const world = this.world;
    const builder = this.mode === MODE_BUILDER;

    // Double-tap space toggles flight in builder mode
    if (builder && move.jumpPressed) {
      if (nowS - this.lastJumpPress < 0.3) {
        this.flying = !this.flying;
        this.vel[1] = 0;
      }
      this.lastJumpPress = nowS;
    }
    if (!builder) this.flying = false;

    this._probeMedium();

    // Crouch state (keep crouching while under a low ceiling)
    if (move.crouch) this.crouching = true;
    else if (this.crouching && this._fits(this.pos, PLAYER_H)) this.crouching = false;
    const height = this.crouching ? 1.5 : PLAYER_H;

    this.sprinting = move.sprint && move.fwd > 0.01 && !this.crouching &&
      (builder || this.hunger > 6) && !this.inWater;

    // Wish direction in world space
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    let wx = (-sy * move.fwd) + (cy * move.strafe);
    let wz = (-cy * move.fwd) + (-sy * move.strafe);
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }

    const speed = this.flying ? SPRINT_SPEED * 2.4
      : this.inWater ? SWIM_SPEED
      : this.crouching ? CROUCH_SPEED
      : this.sprinting ? SPRINT_SPEED
      : WALK_SPEED;

    // Horizontal acceleration (full on ground, reduced in air)
    const accel = (this.onGround || this.flying || this.inWater ? 42 : 42 * AIR_CONTROL);
    this.vel[0] = approach(this.vel[0], wx * speed, accel * dt);
    this.vel[2] = approach(this.vel[2], wz * speed, accel * dt);

    // Vertical
    if (this.flying) {
      const upWish = (move.jump ? 1 : 0) - (move.crouch ? 1 : 0);
      this.vel[1] = approach(this.vel[1], upWish * speed, 60 * dt);
    } else if (this.inWater) {
      this.vel[1] += GRAVITY * 0.18 * dt;
      if (move.jump) this.vel[1] = approach(this.vel[1], SWIM_SPEED, 34 * dt);
      // Climb-out boost: swimming into a bank while moving lifts the player
      // so they can crest the lip instead of being pinned in the water.
      if (this._hitWall && (move.fwd !== 0 || move.strafe !== 0)) {
        this.vel[1] = Math.max(this.vel[1], 3.6);
      }
      this.vel[1] *= (1 - 1.8 * dt);                     // drag
      this.vel[1] = clamp(this.vel[1], -3.4, 4);
    } else if (this.onClimbable) {
      this.vel[1] = move.jump ? CLIMB_SPEED : move.crouch ? -CLIMB_SPEED
        : clamp(this.vel[1] + GRAVITY * dt, -1.2, CLIMB_SPEED);
      if (move.fwd !== 0 || move.strafe !== 0) this.vel[1] = Math.max(this.vel[1], -0.4);
    } else {
      if (move.jump && this.onGround) {
        this.vel[1] = JUMP_SPEED;
        this.onGround = false;
        this.exhaustion += 0.08;
        if (this.hooks.onJump) this.hooks.onJump();
      }
      this.vel[1] += GRAVITY * dt;
      this.vel[1] = Math.max(this.vel[1], -54);
    }
    if (this.inLava) {
      this.vel[0] *= (1 - 3 * dt); this.vel[2] *= (1 - 3 * dt);
      this.vel[1] = clamp(this.vel[1], -1.4, move.jump ? 1.6 : 1);
      if (move.jump) this.vel[1] = 1.6;
    }

    // Fall tracking
    if (!this.onGround && !this.inWater && !this.flying && !this.onClimbable) {
      if (this.fallStart === null) this.fallStart = this.pos[1];
      this.fallStart = Math.max(this.fallStart, this.pos[1]);
    }

    // Integrate with collision, axis by axis
    const wasOnGround = this.onGround;
    this._hitWall = false;   // set by _moveAxis on horizontal block; read next frame
    this._moveAxis(0, this.vel[0] * dt, height, wasOnGround && this.crouching);
    this._moveAxis(2, this.vel[2] * dt, height, wasOnGround && this.crouching);
    this._moveAxis(1, this.vel[1] * dt, height, false);

    // Landing: fall damage
    if (this.onGround && this.fallStart !== null) {
      const fall = this.fallStart - this.pos[1];
      this.fallStart = null;
      if (!builder && fall > FALL_SAFE && !this.inWater) {
        const dmg = Math.floor(fall - FALL_SAFE);
        if (dmg > 0) this.damage(dmg, 'fall');
      }
      if (fall > 1.2 && this.hooks.onLand) this.hooks.onLand(fall);
    }
    if (this.inWater || this.onClimbable) this.fallStart = null;

    // Eye height + head bob
    const targetEye = this.crouching ? EYE_CROUCH : EYE_HEIGHT;
    this.eyeOffset = lerp(this.eyeOffset, targetEye, Math.min(1, 14 * dt));
    const hSpeed = Math.hypot(this.vel[0], this.vel[2]);
    if (this.onGround && hSpeed > 0.5) {
      const prevPhase = this.bobPhase;
      this.bobPhase += dt * (this.sprinting ? 11.5 : 8.5);
      this.bobAmp = lerp(this.bobAmp, 1, Math.min(1, 8 * dt));
      // Footstep on each bob cycle bottom
      if (Math.floor(this.bobPhase / Math.PI) !== Math.floor(prevPhase / Math.PI)) {
        this._footstep();
      }
    } else {
      this.bobAmp = lerp(this.bobAmp, 0, Math.min(1, 10 * dt));
    }

    // Sprint FOV
    const fovTarget = this.sprinting ? 9 : this.flying ? 6 : 0;
    this.fovExtra = lerp(this.fovExtra, fovTarget, Math.min(1, 10 * dt));

    if (!builder) this._survivalTick(dt);
    if (this.hurtTimer > 0) this.hurtTimer -= dt;
  }

  bobOffset() {
    if (!this.bobAmp) return [0, 0];
    return [
      Math.sin(this.bobPhase) * 0.021 * this.bobAmp,
      -Math.abs(Math.cos(this.bobPhase)) * 0.030 * this.bobAmp,
    ];
  }

  _footstep() {
    const bx = Math.floor(this.pos[0]);
    const by = Math.floor(this.pos[1] - 0.05);
    const bz = Math.floor(this.pos[2]);
    const id = this.world.getBlock(bx, by, bz);
    if (id !== B.AIR && this.hooks.onStep) this.hooks.onStep(id);
  }

  _probeMedium() {
    const w = this.world;
    const [x, y, z] = this.pos;
    const feet = w.getBlock(Math.floor(x), Math.floor(y + 0.2), Math.floor(z));
    const mid = w.getBlock(Math.floor(x), Math.floor(y + 0.9), Math.floor(z));
    const head = w.getBlock(Math.floor(x), Math.floor(y + this.eyeOffset), Math.floor(z));
    this.inWater = isWater(feet) || isWater(mid);
    this.inLava = isLava(feet) || isLava(mid);
    this.headInWater = isWater(head);
    this.headInLava = isLava(head);
    this.onClimbable = blockById(feet).climbable || blockById(mid).climbable;
  }

  // Does the player AABB [pos..pos+height]×HALF_W overlap any solid
  // collision box in the scanned cell range? Shaped blocks expose sub-boxes
  // via world.collideBoxes, so a bottom slab only blocks its lower half.
  _overlaps(pos, height) {
    const w = this.world;
    const pMinX = pos[0] - HALF_W, pMaxX = pos[0] + HALF_W;
    const pMinY = pos[1], pMaxY = pos[1] + height - 0.001;
    const pMinZ = pos[2] - HALF_W, pMaxZ = pos[2] + HALF_W;
    const minX = Math.floor(pMinX), maxX = Math.floor(pMaxX);
    // Scan one cell below the AABB: tall shapes (fences/walls/gates) own
    // collision boxes reaching 0.5 above their cell, which would otherwise
    // be invisible once the feet pass the cell ceiling.
    const minY = Math.floor(pMinY) - 1, maxY = Math.floor(pMaxY);
    const minZ = Math.floor(pMinZ), maxZ = Math.floor(pMaxZ);
    const out = this._boxScratch ?? (this._boxScratch = []);
    for (let y = minY; y <= maxY; y++)
      for (let z = minZ; z <= maxZ; z++)
        for (let x = minX; x <= maxX; x++) {
          w.collideBoxes(x, y, z, out);
          for (let i = 0; i < out.length; i++) {
            const bx = out[i];
            if (pMaxX > bx[0] && pMinX < bx[3] &&
                pMaxY > bx[1] && pMinY < bx[4] &&
                pMaxZ > bx[2] && pMinZ < bx[5]) return true;
          }
        }
    return false;
  }

  _fits(pos, height) {
    return !this._overlaps(pos, height);
  }

  _moveAxis(axis, delta, height, edgeGuard) {
    if (delta === 0) { if (axis === 1) this._groundCheck(height); return; }
    const pos = this.pos;
    const orig = pos[axis];
    pos[axis] += delta;

    const hit = this._overlaps(pos, height);

    if (hit) {
      if (axis === 1) {
        if (delta < 0) pos[1] = this._resolveDown(orig, height);
        else pos[1] = this._resolveUp(orig, height);
        this.vel[1] = 0;
        if (delta < 0) this.onGround = true;
      } else {
        // Auto step-up: a grounded walk into a rise of ≤0.5 (ledges, steps)
        // climbs it instead of stopping dead. Also allowed while swimming,
        // so cresting a bank flows straight into a step out of the water.
        let stepped = false;
        if (this.onGround || this.inWater) {
          const savedY = pos[1];
          pos[1] = savedY + 0.501;
          if (!this._overlaps(pos, height)) {
            const rest = this._resolveDown(pos[1], height);
            if (rest > savedY + 0.001 && rest <= savedY + 0.502) {
              pos[1] = rest;
              stepped = true;
            }
          }
          if (!stepped) pos[1] = savedY;
        }
        if (!stepped) {
          pos[axis] = orig;
          this.vel[axis] = 0;
          this._hitWall = true;   // read by the swim climb-out boost
        }
      }
    } else if (axis === 1) {
      this.onGround = false;
    }

    // Crouch edge guard: don't walk off ledges while sneaking
    if (edgeGuard && axis !== 1 && !hit) {
      if (!this._hasSupport()) {
        pos[axis] = orig;
        this.vel[axis] = 0;
      }
    }
  }

  // Falling: rest the feet on the highest solid box top strictly below the
  // pre-move feet, within the player's horizontal footprint. Handles slabs
  // (top at y+0.5) and stairs, not just integer floors.
  _resolveDown(origY, height) {
    const w = this.world;
    const pMinX = this.pos[0] - HALF_W, pMaxX = this.pos[0] + HALF_W;
    const pMinZ = this.pos[2] - HALF_W, pMaxZ = this.pos[2] + HALF_W;
    const minX = Math.floor(pMinX), maxX = Math.floor(pMaxX);
    const minZ = Math.floor(pMinZ), maxZ = Math.floor(pMaxZ);
    const minY = Math.floor(this.pos[1]) - 1, maxY = Math.ceil(origY);
    const out = this._boxScratch ?? (this._boxScratch = []);
    let top = -Infinity;
    for (let y = minY; y <= maxY; y++)
      for (let z = minZ; z <= maxZ; z++)
        for (let x = minX; x <= maxX; x++) {
          w.collideBoxes(x, y, z, out);
          for (let i = 0; i < out.length; i++) {
            const bx = out[i];
            if (bx[3] <= pMinX || bx[0] >= pMaxX ||
                bx[5] <= pMinZ || bx[2] >= pMaxZ) continue;
            if (bx[4] <= origY + 0.501 && bx[4] > top) top = bx[4];
          }
        }
    return top === -Infinity ? origY : top + 0.0001;
  }

  // Rising: clamp the head just under the lowest solid box bottom above the
  // pre-move head, within the footprint.
  _resolveUp(origY, height) {
    const w = this.world;
    const pMinX = this.pos[0] - HALF_W, pMaxX = this.pos[0] + HALF_W;
    const pMinZ = this.pos[2] - HALF_W, pMaxZ = this.pos[2] + HALF_W;
    const minX = Math.floor(pMinX), maxX = Math.floor(pMaxX);
    const minZ = Math.floor(pMinZ), maxZ = Math.floor(pMaxZ);
    const headOrig = origY + height;
    const minY = Math.floor(headOrig - 0.001) - 1, maxY = Math.floor(this.pos[1] + height);
    const out = this._boxScratch ?? (this._boxScratch = []);
    let bot = Infinity;
    for (let y = minY; y <= maxY; y++)
      for (let z = minZ; z <= maxZ; z++)
        for (let x = minX; x <= maxX; x++) {
          w.collideBoxes(x, y, z, out);
          for (let i = 0; i < out.length; i++) {
            const bx = out[i];
            if (bx[3] <= pMinX || bx[0] >= pMaxX ||
                bx[5] <= pMinZ || bx[2] >= pMaxZ) continue;
            if (bx[1] >= headOrig - 0.001 && bx[1] < bot) bot = bx[1];
          }
        }
    return bot === Infinity ? origY : bot - height - 0.0001;
  }

  _groundCheck(height) {
    const pos = this.pos;
    // Probe a thin slab just beneath the feet against any solid box top.
    const probe = [pos[0], pos[1] - 0.03, pos[2]];
    this.onGround = this._overlaps(probe, 0.03);
  }

  _hasSupport() {
    const pos = this.pos;
    const probe = [pos[0], pos[1] - 0.05, pos[2]];
    return this._overlaps(probe, 0.05);
  }

  // ── Survival ─────────────────────────────────────────────────────
  _survivalTick(dt) {
    // Exhaustion from sprinting
    if (this.sprinting) this.exhaustion += dt * 0.12;
    if (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      this.hunger = Math.max(0, this.hunger - 1);
    }
    // Starvation / regeneration
    if (this.hunger <= 0) {
      this.regenTimer += dt;
      if (this.regenTimer >= 4) { this.regenTimer = 0; this.damage(1, 'hunger', true); }
    } else if (this.hunger >= 15 && this.health < MAX_HEALTH) {
      this.regenTimer += dt;
      if (this.regenTimer >= 3.2) {
        this.regenTimer = 0;
        this.health = Math.min(MAX_HEALTH, this.health + 1);
        this.exhaustion += 1.2;
      }
    } else {
      this.regenTimer = 0;
    }
    // Drowning
    if (this.headInWater) {
      this.airTimer = (this.airTimer ?? 0) + dt;
      if (this.airTimer >= 1.1) {
        this.airTimer = 0;
        if (this.air > 0) this.air--;
        else this.damage(2, 'drown', true);
      }
    } else {
      this.air = Math.min(MAX_AIR, this.air + dt * 4);
      this.airTimer = 0;
    }
    // Lava
    if (this.inLava || this.headInLava) {
      this.lavaTimer = (this.lavaTimer ?? 0) + dt;
      if (this.lavaTimer >= 0.5) { this.lavaTimer = 0; this.damage(4, 'lava', true); }
    } else {
      this.lavaTimer = 0;
    }
  }

  damage(amount, cause, bypassCooldown = false) {
    if (this.dead || this.mode === MODE_BUILDER) return;
    if (!bypassCooldown && this.hurtTimer > 0) return;
    this.hurtTimer = 0.5;
    const blockable = cause !== 'drown' && cause !== 'hunger' && cause !== 'fall';
    // A raised shield soaks most of a blockable blow.
    if (blockable && this.shieldRaised) amount *= 0.25;
    // Armor blunts contact/attack damage but not drown/hunger/fall.
    if (blockable) {
      const reduce = Math.min(0.8, this.armorPoints() * 0.04);
      amount = amount * (1 - reduce);
    }
    this.health -= amount;
    if (this.hooks.onDamage) this.hooks.onDamage(amount, cause);
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      if (this.hooks.onDeath) this.hooks.onDeath(cause);
    }
  }

  eat(foodDef) {
    if (this.hunger >= MAX_HUNGER) return false;
    this.hunger = Math.min(MAX_HUNGER, this.hunger + foodDef.restore);
    return true;
  }

  respawn(spawnPos) {
    this.pos = [...spawnPos];
    this.vel = [0, 0, 0];
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.air = MAX_AIR;
    this.dead = false;
    this.fallStart = null;
  }

  serialize() {
    return {
      pos: this.pos, yaw: this.yaw, pitch: this.pitch,
      health: this.health, hunger: this.hunger, air: this.air,
      slots: this.slots, selected: this.selected, flying: this.flying,
      armor: this.armor,
    };
  }
  deserialize(d) {
    if (!d) return;
    this.pos = d.pos ?? this.pos;
    this.yaw = d.yaw ?? 0;
    this.pitch = d.pitch ?? 0;
    this.health = d.health ?? MAX_HEALTH;
    this.hunger = d.hunger ?? MAX_HUNGER;
    this.air = d.air ?? MAX_AIR;
    this.slots = d.slots ?? this.slots;
    this.selected = d.selected ?? 0;
    this.flying = d.flying ?? false;
    if (Array.isArray(d.armor)) for (let i = 0; i < 4; i++) this.armor[i] = d.armor[i] ?? null;
  }
}

function approach(cur, target, maxDelta) {
  const d = target - cur;
  if (Math.abs(d) <= maxDelta) return target;
  return cur + Math.sign(d) * maxDelta;
}
