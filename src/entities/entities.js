// Wildlife + item-drop entities: per-creature AI state machines, voxel
// physics, and box-model render data (unit cubes posed by matrices).
// BLOCKS-original species: bristleback (stocky grazer), mosshopper (round
// hopper), embermoth (night-glowing flutterer).

import { GRAVITY } from '../core/constants.js';
import { B, isWater, isLava } from '../blocks.js';
import { BIOME } from '../world/gen/terrain.js';
import { mulberry32 } from '../math/noise.js';
import { identity, translate, rotateX, rotateY, scale } from '../math/mat4.js';
import { itemByKey } from '../items.js';

const TWO_PI = Math.PI * 2;
const CREATURE_CAP = 10;
const DESPAWN_DIST = 72;        // creatures vanish quietly beyond this
const ITEM_LIFE = 240;          // seconds before a dropped item fades
const ITEM_CAP = 128;
const SPAWN_GROUND = new Set([B.GRASS, B.SNOW, B.SOIL]);

// ── Species table ─────────────────────────────────────────────────
const SPECIES = {
  bristleback: {
    hw: 0.5, h: 1.0, health: 10, walkSpeed: 1.5, grazes: true, hopper: false,
    biomes: new Set([BIOME.PLAINS, BIOME.FOREST, BIOME.SWAMP]),
    drops(rng) {
      const out = [{ key: 'meat_raw', count: 1 + (rng() * 2 | 0) }];
      if (rng() < 0.5) out.push({ key: 'hide', count: 1 });
      return out;
    },
  },
  mosshopper: {
    hw: 0.3, h: 0.78, health: 5, walkSpeed: 2.4, grazes: true, hopper: true,
    biomes: new Set([BIOME.PLAINS, BIOME.FOREST, BIOME.TUNDRA]),
    drops(rng) { return rng() < 0.6 ? [{ key: 'meat_raw', count: 1 }] : []; },
  },
  embermoth: {
    hw: 0.25, h: 0.3, health: 3, walkSpeed: 1.3, grazes: false, hopper: false,
    flying: true, nightOnly: true,
    biomes: new Set([BIOME.BEACH, BIOME.PLAINS, BIOME.FOREST, BIOME.DESERT,
                     BIOME.SWAMP, BIOME.TUNDRA, BIOME.MOUNTAIN]),
    drops(rng) { return [{ key: 'glimmer_dust', count: 1 + (rng() * 2 | 0) }]; },
  },
  // ── Hostiles ──
  gloomstalker: {
    hw: 0.4, h: 1.9, health: 16, walkSpeed: 1.9, grazes: false, hopper: false,
    hostile: true, nightOnly: true, dmg: 4,
    biomes: new Set([BIOME.PLAINS, BIOME.FOREST, BIOME.SWAMP,
                     BIOME.TUNDRA, BIOME.MOUNTAIN, BIOME.DESERT]),
    drops(rng) { return [{ key: 'glimmer_dust', count: 1 + (rng() * 2 | 0) }]; },
  },
  cinderling: {
    hw: 0.35, h: 0.7, health: 8, walkSpeed: 2.2, grazes: false, hopper: false,
    hostile: true, dmg: 3, dims: new Set(['smolder']),
    biomes: new Set(),
    drops(rng) { return rng() < 0.6 ? [{ key: 'smolder_shard', count: 1 }] : []; },
  },
  hollowshade: {
    hw: 0.4, h: 1.1, health: 12, walkSpeed: 1.7, grazes: false, hopper: false,
    hostile: true, flying: true, dmg: 3, dims: new Set(['hollow']),
    biomes: new Set(),
    drops(rng) { return [{ key: 'glimmer_dust', count: 1 }]; },
  },
  sovereign: {
    hw: 0.9, h: 3.0, health: 220, walkSpeed: 1.6, grazes: false, hopper: false,
    hostile: true, boss: true, dmg: 9, dims: new Set(['hollow']),
    biomes: new Set(),
    drops(rng) {
      return [{ key: 'sovereign_core', count: 1 },
              { key: 'glimmer_dust', count: 3 + (rng() * 3 | 0) }];
    },
  },
};

// ── Palette (0..1 rgb) ────────────────────────────────────────────
const C = {
  bbBody:  [0.478, 0.361, 0.251],   // #7a5c40 dusty brown
  bbHead:  [0.443, 0.329, 0.227],
  bbLeg:   [0.345, 0.259, 0.176],
  bbRidge: [0.310, 0.235, 0.153],
  bbTusk:  [0.925, 0.886, 0.776],   // cream
  mhBody:  [0.416, 0.561, 0.302],   // #6a8f4d mossy green
  mhBelly: [0.627, 0.757, 0.494],
  mhFeet:  [0.333, 0.451, 0.243],
  mhSnow:      [0.812, 0.847, 0.831],   // #cfd8d4 tundra variant
  mhSnowBelly: [0.910, 0.930, 0.920],
  mhSnowFeet:  [0.667, 0.710, 0.694],
  emBody:  [0.325, 0.353, 0.412],   // slate
  emHead:  [0.420, 0.450, 0.510],
  emWing:  [1.000, 0.722, 0.302],   // #ffb84d glowing amber
  // gloomstalker — gaunt night stalker
  gsBody:  [0.180, 0.196, 0.235],   // dark slate
  gsLimb:  [0.129, 0.141, 0.176],
  gsHead:  [0.212, 0.231, 0.278],
  gsEye:   [0.878, 0.949, 0.902],   // pale glow
  // cinderling — ember imp
  clBody:  [0.114, 0.098, 0.094],   // charred black
  clCrack: [1.000, 0.435, 0.114],   // #ff6f1d lava glow
  clLeg:   [0.086, 0.075, 0.071],
  // hollowshade — pale violet wraith
  hsBody:  [0.545, 0.451, 0.706],   // translucent violet
  hsWisp:  [0.678, 0.588, 0.827],
  hsCore:  [0.878, 0.808, 0.973],
  // sovereign — Hollow boss
  svArmor: [0.235, 0.157, 0.353],   // dark violet
  svPlate: [0.318, 0.220, 0.451],
  svTrim:  [0.176, 0.114, 0.278],
  svCore:  [0.925, 0.878, 1.000],   // bright pale core
  svSpike: [0.278, 0.196, 0.408],
};

// ── Matrix helpers ────────────────────────────────────────────────
// Entity base transform: feet position + facing. Model forward is +z;
// yawOff lets the embermoth use +x forward so rotateX flaps its wings.
function baseMat(e, yawOff = 0) {
  const m = identity();
  translate(m, m, e.pos[0], e.pos[1], e.pos[2]);
  rotateY(m, m, e.yaw + yawOff);
  return m;
}

// part = base * T(pivot) * Rx(rx) * T(offset) * S(size); unit cube at origin.
function addPart(parts, base, color, px, py, pz, rx, ox, oy, oz, sx, sy, sz) {
  const m = new Float32Array(base);
  translate(m, m, px, py, pz);
  if (rx) rotateX(m, m, rx);
  if (ox || oy || oz) translate(m, m, ox, oy, oz);
  scale(m, m, sx, sy, sz);
  parts.push({ matrix: m, color });
}

// 0→1→0 head-dip curve over the graze state's duration.
function grazeDip(e) {
  if (e.state !== 'graze') return 0;
  const t = 1 - Math.max(0, e.stateT) / e.grazeDur;
  return Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
}

// ── Part builders ─────────────────────────────────────────────────
function bristlebackParts(e, parts) {
  const b = baseMat(e);
  const moving = Math.hypot(e.vel[0], e.vel[2]) > 0.2;
  const sw = moving ? Math.sin(e.walkPhase) * 0.55 : 0;
  const legs = [[-0.27, 0.38, 1], [0.27, 0.38, -1], [-0.27, -0.38, -1], [0.27, -0.38, 1]];
  for (const [lx, lz, sgn] of legs) {
    addPart(parts, b, C.bbLeg, lx, 0.34, lz, sw * sgn, 0, -0.17, 0, 0.17, 0.36, 0.17);
  }
  addPart(parts, b, C.bbBody, 0, 0.62, -0.05, 0, 0, 0, 0, 0.9, 0.58, 1.15);
  addPart(parts, b, C.bbRidge, 0, 0.94, -0.12, 0, 0, 0, 0, 0.2, 0.12, 0.8);
  const dip = grazeDip(e) * 0.85 + (moving ? Math.sin(e.walkPhase * 0.5) * 0.05 : 0);
  addPart(parts, b, C.bbHead, 0, 0.72, 0.55, dip, 0, -0.02, 0.2, 0.5, 0.44, 0.46);
  addPart(parts, b, C.bbTusk, 0, 0.72, 0.55, dip, 0.15, -0.18, 0.4, 0.06, 0.15, 0.06);
  addPart(parts, b, C.bbTusk, 0, 0.72, 0.55, dip, -0.15, -0.18, 0.4, 0.06, 0.15, 0.06);
}

function mosshopperParts(e, parts) {
  const snow = e.variant === 'snow';
  const cBody = snow ? C.mhSnow : C.mhBody;
  const cBelly = snow ? C.mhSnowBelly : C.mhBelly;
  const cFeet = snow ? C.mhSnowFeet : C.mhFeet;
  const b = baseMat(e);
  const air = !e.onGround;
  // pitch nose up while rising, down while falling; feet tuck mid-hop
  const pitch = air ? Math.max(-0.45, Math.min(0.45, -e.vel[1] * 0.06)) : 0;
  const b2 = new Float32Array(b);
  if (pitch) {
    translate(b2, b2, 0, 0.3, 0);
    rotateX(b2, b2, pitch);
    translate(b2, b2, 0, -0.3, 0);
  }
  const tuck = air ? -0.6 : 0;
  addPart(parts, b, cFeet, -0.13, 0.08, 0.05, tuck, 0, -0.03, 0.05, 0.17, 0.09, 0.34);
  addPart(parts, b, cFeet, 0.13, 0.08, 0.05, tuck, 0, -0.03, 0.05, 0.17, 0.09, 0.34);
  addPart(parts, b2, cBody, 0, 0.32, -0.02, 0, 0, 0, 0, 0.44, 0.36, 0.52);
  addPart(parts, b2, cBelly, 0, 0.18, 0.02, 0, 0, 0, 0, 0.38, 0.15, 0.44);
  const dip = grazeDip(e) * 0.7;
  addPart(parts, b2, cBody, 0, 0.52, 0.16, dip, 0, 0, 0.08, 0.28, 0.24, 0.26);
  addPart(parts, b2, cBody, -0.08, 0.68, 0.12, dip * 0.5, 0, 0, 0, 0.06, 0.18, 0.05);
  addPart(parts, b2, cBody, 0.08, 0.68, 0.12, dip * 0.5, 0, 0, 0, 0.06, 0.18, 0.05);
}

function embermothParts(e, parts, nowS) {
  const b = baseMat(e, -Math.PI / 2);        // +x forward: rotateX = wing flap
  const bob = Math.sin(nowS * 3 + e.phase) * 0.04;
  const flap = Math.sin(nowS * 26 + e.phase) * 0.95;
  addPart(parts, b, C.emBody, 0, 0.13 + bob, 0, 0, 0, 0, 0, 0.3, 0.09, 0.09);
  addPart(parts, b, C.emHead, 0.19, 0.15 + bob, 0, 0, 0, 0, 0, 0.09, 0.09, 0.09);
  addPart(parts, b, C.emWing, 0, 0.16 + bob, 0, flap, 0, 0, 0.2, 0.3, 0.02, 0.38);
  addPart(parts, b, C.emWing, 0, 0.16 + bob, 0, -flap, 0, 0, -0.2, 0.3, 0.02, 0.38);
}

// Gaunt tall stalker: dark slate body, long thin limbs, pale glowing eyes.
function gloomstalkerParts(e, parts) {
  const b = baseMat(e);
  const moving = Math.hypot(e.vel[0], e.vel[2]) > 0.2;
  const sw = moving ? Math.sin(e.walkPhase) * 0.7 : 0;
  // long thin legs
  addPart(parts, b, C.gsLimb, -0.18, 0.6, 0, sw, 0, -0.3, 0, 0.13, 0.62, 0.13);
  addPart(parts, b, C.gsLimb, 0.18, 0.6, 0, -sw, 0, -0.3, 0, 0.13, 0.62, 0.13);
  // narrow torso
  addPart(parts, b, C.gsBody, 0, 1.22, 0, 0, 0, 0, 0, 0.44, 0.68, 0.32);
  // hunched shoulders
  addPart(parts, b, C.gsBody, 0, 1.5, -0.04, 0, 0, 0, 0, 0.56, 0.16, 0.3);
  // long thin arms swinging opposite the legs
  addPart(parts, b, C.gsLimb, -0.31, 1.32, 0.02, -sw * 0.8, 0, -0.28, 0, 0.1, 0.6, 0.1);
  addPart(parts, b, C.gsLimb, 0.31, 1.32, 0.02, sw * 0.8, 0, -0.28, 0, 0.1, 0.6, 0.1);
  // gaunt head
  addPart(parts, b, C.gsHead, 0, 1.68, 0.03, 0, 0, 0, 0, 0.3, 0.32, 0.3);
  // pale glowing eyes
  addPart(parts, b, C.gsEye, -0.08, 1.72, 0.17, 0, 0, 0, 0, 0.07, 0.05, 0.05);
  addPart(parts, b, C.gsEye, 0.08, 1.72, 0.17, 0, 0, 0, 0, 0.07, 0.05, 0.05);
}

// Small squat ember imp: charred body, glowing lava cracks, stubby legs.
function cinderlingParts(e, parts, nowS) {
  const b = baseMat(e);
  const moving = Math.hypot(e.vel[0], e.vel[2]) > 0.2;
  const sw = moving ? Math.sin(e.walkPhase) * 0.5 : 0;
  const glow = 0.75 + Math.sin(nowS * 4 + e.phase) * 0.25;   // pulsing cracks
  const crack = [C.clCrack[0] * glow, C.clCrack[1] * glow, C.clCrack[2] * glow];
  // stubby legs
  addPart(parts, b, C.clLeg, -0.16, 0.11, 0, sw, 0, -0.05, 0, 0.16, 0.24, 0.16);
  addPart(parts, b, C.clLeg, 0.16, 0.11, 0, -sw, 0, -0.05, 0, 0.16, 0.24, 0.16);
  // squat charred body
  addPart(parts, b, C.clBody, 0, 0.42, 0, 0, 0, 0, 0, 0.56, 0.4, 0.5);
  // glowing lava cracks
  addPart(parts, b, crack, 0, 0.42, 0.26, 0, 0, 0, 0, 0.12, 0.28, 0.02);
  addPart(parts, b, crack, -0.2, 0.5, 0.02, 0, 0, 0, 0, 0.02, 0.2, 0.3);
  // blocky head with ember eyes
  addPart(parts, b, C.clBody, 0, 0.72, 0.04, 0, 0, 0, 0, 0.34, 0.28, 0.32);
  addPart(parts, b, crack, -0.08, 0.74, 0.19, 0, 0, 0, 0, 0.06, 0.05, 0.04);
  addPart(parts, b, crack, 0.08, 0.74, 0.19, 0, 0, 0, 0, 0.06, 0.05, 0.04);
}

// Floating pale wraith: translucent violet body, trailing tendrils, no legs.
function hollowshadeParts(e, parts, nowS) {
  const b = baseMat(e);
  const bob = Math.sin(nowS * 2 + e.phase) * 0.05;
  const sway = Math.sin(nowS * 2.4 + e.phase);
  // hooded body core
  addPart(parts, b, C.hsBody, 0, 0.7 + bob, 0, 0, 0, 0, 0, 0.44, 0.5, 0.4);
  // pale inner core
  addPart(parts, b, C.hsCore, 0, 0.72 + bob, 0.04, 0, 0, 0, 0, 0.16, 0.2, 0.16);
  // shrouded head
  addPart(parts, b, C.hsWisp, 0, 1.02 + bob, 0.02, 0, 0, 0, 0, 0.3, 0.3, 0.28);
  // trailing tendrils drifting below (swaying, no legs)
  addPart(parts, b, C.hsWisp, -0.13, 0.34 + bob, 0, sway * 0.4, 0, -0.16, 0, 0.1, 0.36, 0.1);
  addPart(parts, b, C.hsWisp, 0.13, 0.34 + bob, 0, -sway * 0.4, 0, -0.16, 0, 0.1, 0.36, 0.1);
  addPart(parts, b, C.hsWisp, 0, 0.28 + bob, 0.02, sway * 0.3, 0, -0.2, 0, 0.1, 0.42, 0.1);
}

// Large armored boss: dark-violet torso, broad shoulders, glowing chest core,
// crown-like head spikes.
function sovereignParts(e, parts, nowS) {
  const b = baseMat(e);
  const moving = Math.hypot(e.vel[0], e.vel[2]) > 0.2;
  const sw = moving ? Math.sin(e.walkPhase) * 0.4 : 0;
  const pulse = 0.8 + Math.sin(nowS * 2.5 + e.phase) * 0.2;
  const core = [C.svCore[0] * pulse, C.svCore[1] * pulse, C.svCore[2] * pulse];
  // heavy legs
  addPart(parts, b, C.svTrim, -0.34, 0.7, 0, sw, 0, -0.35, 0, 0.32, 0.72, 0.34);
  addPart(parts, b, C.svTrim, 0.34, 0.7, 0, -sw, 0, -0.35, 0, 0.32, 0.72, 0.34);
  // armored torso
  addPart(parts, b, C.svArmor, 0, 1.9, -0.02, 0, 0, 0, 0, 1.0, 1.1, 0.62);
  // chest plate
  addPart(parts, b, C.svPlate, 0, 1.95, 0.28, 0, 0, 0, 0, 0.7, 0.8, 0.14);
  // broad shoulders
  addPart(parts, b, C.svPlate, -0.72, 2.34, 0, 0, 0, 0, 0, 0.4, 0.4, 0.6);
  addPart(parts, b, C.svPlate, 0.72, 2.34, 0, 0, 0, 0, 0, 0.4, 0.4, 0.6);
  // arms
  addPart(parts, b, C.svArmor, -0.72, 1.7, 0.02, -sw * 0.7, 0, -0.42, 0, 0.28, 0.86, 0.32);
  addPart(parts, b, C.svArmor, 0.72, 1.7, 0.02, sw * 0.7, 0, -0.42, 0, 0.28, 0.86, 0.32);
  // glowing pale core in the chest
  addPart(parts, b, core, 0, 1.98, 0.37, 0, 0, 0, 0, 0.26, 0.3, 0.06);
  // head
  addPart(parts, b, C.svArmor, 0, 2.66, 0.04, 0, 0, 0, 0, 0.42, 0.42, 0.42);
  // crown-like head spikes
  addPart(parts, b, C.svSpike, 0, 2.98, 0.04, 0, 0, 0, 0, 0.08, 0.32, 0.08);
  addPart(parts, b, C.svSpike, -0.16, 2.94, 0.04, 0.35, 0, 0, 0, 0.07, 0.26, 0.07);
  addPart(parts, b, C.svSpike, 0.16, 2.94, 0.04, -0.35, 0, 0, 0, 0.07, 0.26, 0.07);
}

const PART_BUILDERS = {
  bristleback: bristlebackParts,
  mosshopper: mosshopperParts,
  embermoth: embermothParts,
  gloomstalker: gloomstalkerParts,
  cinderling: cinderlingParts,
  hollowshade: hollowshadeParts,
  sovereign: sovereignParts,
};

// Stable mid-tone tint per item key.
const TINTS = new Map();
function itemTint(key) {
  let t = TINTS.get(key);
  if (!t) {
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    const r = mulberry32(h >>> 0);
    t = [0.3 + r() * 0.65, 0.3 + r() * 0.65, 0.3 + r() * 0.65];
    TINTS.set(key, t);
  }
  return t;
}

function itemEntParts(e, parts, nowS) {
  const m = identity();
  const bob = Math.sin(nowS * 2.6 + e.phase) * 0.06;
  translate(m, m, e.pos[0], e.pos[1] + 0.16 + bob, e.pos[2]);
  rotateY(m, m, nowS * 1.8 + e.phase);
  scale(m, m, 0.22, 0.22, 0.22);
  parts.push({ matrix: m, color: itemTint(e.itemKey) });
}

function makeAabb() {
  return function () {
    return {
      min: [this.pos[0] - this.hw, this.pos[1], this.pos[2] - this.hw],
      max: [this.pos[0] + this.hw, this.pos[1] + this.h, this.pos[2] + this.hw],
    };
  };
}

// ── System ────────────────────────────────────────────────────────
export class EntitySystem {
  /**
   * @param {World} world
   * @param {object} hooks {audio, particles, pickupItem(key,count)→leftover}
   */
  constructor(world, hooks) {
    this.world = world;
    this.hooks = hooks || {};
    this.entities = [];
    this.rng = mulberry32((Math.random() * 0xffffffff) >>> 0);
    this.spawnT = 0;
    this.mergeT = 0;
    this._nowS = 0;
    this._sun = 1;
    this._lastPP = null;
    this._pSpeed = 0;             // smoothed player ground speed (sprint scare)
    this._bossDown = false;       // Hollow Sovereign killed this session
  }

  clear() { this.entities.length = 0; }

  update(dt, playerPos, nowS, sunLevel) {
    dt = Math.min(dt, 0.1);
    this._nowS = nowS;
    this._sun = sunLevel;

    if (this._lastPP && dt > 0) {
      const dx = playerPos[0] - this._lastPP[0], dz = playerPos[2] - this._lastPP[2];
      this._pSpeed = this._pSpeed * 0.85 + (Math.hypot(dx, dz) / dt) * 0.15;
    }
    this._lastPP = [playerPos[0], playerPos[1], playerPos[2]];

    this.spawnT += dt;
    if (this.spawnT >= 2) { this.spawnT = 0; this._trySpawn(playerPos, sunLevel); }
    this.mergeT += dt;
    const doMerge = this.mergeT >= 0.5;
    if (doMerge) this.mergeT = 0;

    const list = this.entities;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!e.dead) {
        if (e.kind === 'item') this._updateItem(e, dt, playerPos);
        else this._updateCreature(e, dt, playerPos, sunLevel, nowS);
        if (e.pos[1] < -10) e.dead = true;
        if (e.kind === 'creature') {
          const dx = e.pos[0] - playerPos[0], dz = e.pos[2] - playerPos[2];
          if (dx * dx + dz * dz > DESPAWN_DIST * DESPAWN_DIST) e.dead = true;
        }
      }
      if (e.dead) list.splice(i, 1);
    }
    if (doMerge) this._mergeItems();
  }

  // Which species may spawn in the current dimension? A species with a
  // `dims` Set only spawns in those dimensions; one without `dims` is
  // overworld-only (preserves grazers/moth as overworld inhabitants).
  _dimOk(s, dim) {
    return s.dims ? s.dims.has(dim) : dim === 'overworld';
  }

  // ── Spawning ─────────────────────────────────────────────────────
  _trySpawn(pp, sun) {
    const dim = this.hooks.dimension ? this.hooks.dimension() : 'overworld';

    // Boss: spawn the Hollow Sovereign once when the player is in the
    // Hollow and none is alive (and it hasn't been slain this session).
    if (dim === 'hollow' && !this._bossDown && !this._bossAlive()) {
      if (this._spawnBoss(pp)) return;
    }

    // Separate caps: grazers must not starve out night flyers (and vice
    // versa) — a full meadow of mosshoppers would otherwise mean no
    // embermoths can ever appear at night. Hostiles get their own cap so
    // they don't overwhelm the world.
    let grounded = 0, flyers = 0, hostiles = 0;
    for (const e of this.entities) {
      if (e.kind !== 'creature') continue;
      if (e.def.hostile) hostiles++;
      if (e.def.flying) flyers++; else grounded++;
    }
    const groundedFull = grounded >= CREATURE_CAP - 2;
    const flyersFull = flyers >= 4;
    const hostilesFull = hostiles >= 6;
    if (groundedFull && flyersFull) return;
    const r = this.rng, w = this.world;
    for (let attempt = 0; attempt < 4; attempt++) {
      const ang = r() * TWO_PI, d = 20 + r() * 24;
      const x = Math.floor(pp[0] + Math.sin(ang) * d);
      const z = Math.floor(pp[2] + Math.cos(ang) * d);
      if (!w.isLoaded(x, z)) continue;
      const gy = w.heightAt(x, z);
      if (!SPAWN_GROUND.has(w.getBlock(x, gy, z))) continue;
      const biome = w.biomeAt(x, z);
      const options = [];
      for (const name of Object.keys(SPECIES)) {
        const s = SPECIES[name];
        if (s.boss) continue;                          // boss spawns via _spawnBoss
        if (!this._dimOk(s, dim)) continue;
        if (s.nightOnly && sun >= 0.25) continue;
        if (s.hostile && hostilesFull) continue;
        if (s.flying ? flyersFull : groundedFull) continue;
        // hostiles in their home dimension don't gate on biome (those
        // dims carry a single biome); overworld species still do.
        if (s.dims ? true : s.biomes.has(biome)) options.push(name);
      }
      if (options.length === 0) continue;
      const species = options[(r() * options.length) | 0];
      const y = gy + 1 + (SPECIES[species].flying ? 2 : 0);
      if (w.isSolid(x, y, z) || w.isSolid(x, y + 1, z)) continue;
      this.entities.push(this._makeCreature(species, x + 0.5, y, z + 0.5, biome));
      return;
    }
  }

  _bossAlive() {
    for (const e of this.entities) {
      if (e.kind === 'creature' && e.def.boss && !e.dead) return true;
    }
    return false;
  }

  // Spawn the Hollow Sovereign a little away from the player on solid ground.
  _spawnBoss(pp) {
    const r = this.rng, w = this.world;
    for (let attempt = 0; attempt < 6; attempt++) {
      const ang = r() * TWO_PI, d = 12 + r() * 8;
      const x = Math.floor(pp[0] + Math.sin(ang) * d);
      const z = Math.floor(pp[2] + Math.cos(ang) * d);
      if (!w.isLoaded(x, z)) continue;
      const gy = w.heightAt(x, z);
      const y = gy + 1;
      if (w.isSolid(x, y, z) || w.isSolid(x, y + 1, z)) continue;
      const biome = w.biomeAt(x, z);
      this.entities.push(this._makeCreature('sovereign', x + 0.5, y, z + 0.5, biome));
      return true;
    }
    return false;
  }

  // Live boss status for the HUD boss bar, or null if none alive.
  bossInfo() {
    for (const e of this.entities) {
      if (e.kind === 'creature' && e.def.boss && !e.dead) {
        return { name: 'The Hollow Sovereign', health: Math.max(0, e.health), max: e.def.health };
      }
    }
    return null;
  }

  _makeCreature(species, x, y, z, biome) {
    const s = SPECIES[species], r = this.rng;
    return {
      kind: 'creature', species, def: s,
      pos: [x, y, z], vel: [0, 0, 0],
      yaw: r() * TWO_PI, targetYaw: 0,
      hw: s.hw, h: s.h,
      health: s.health, dead: false,
      state: 'idle', stateT: 1 + r() * 3, grazeDur: 2,
      tgt: null, threat: null,
      walkPhase: 0, flash: 0, onGround: false,
      hopWait: 0, hopCd: 0, probeT: r() * 0.3, avoidT: 0, avoidYaw: 0,
      atkCd: 0,                               // hostile melee cooldown
      driftT: 0, lightT: r() * 0.6,
      phase: r() * TWO_PI,
      alt: 2 + r() * 4,                       // embermoth cruising height
      variant: species === 'mosshopper' && biome === BIOME.TUNDRA ? 'snow' : null,
      aabb: makeAabb(),
    };
  }

  // ── Creature AI ──────────────────────────────────────────────────
  _updateCreature(e, dt, pp, sun, nowS) {
    e.flash = Math.max(0, e.flash - dt * 4);
    const s = e.def;
    if (s.hostile) { this._updateHostile(e, dt, pp, sun, nowS); return; }
    if (s.flying) { this._updateMoth(e, dt, sun, nowS); return; }

    if (this.rng() < dt * 0.05) this.hooks.audio?.creature?.(e.species, 'idle');

    // mosshoppers bolt when a sprinting player gets close
    if (s.hopper && e.state !== 'flee') {
      const dx = e.pos[0] - pp[0], dz = e.pos[2] - pp[2];
      if (dx * dx + dz * dz < 9 && this._pSpeed > 5.2) this._startFlee(e, pp);
    }

    e.stateT -= dt;
    if (e.stateT <= 0) this._nextState(e);

    let moving = false, speed = s.walkSpeed;
    if (e.state === 'wander' && e.tgt) {
      const dx = e.tgt[0] - e.pos[0], dz = e.tgt[1] - e.pos[2];
      if (dx * dx + dz * dz < 0.6) {
        e.state = 'idle'; e.stateT = 1 + this.rng() * 3;
      } else {
        e.targetYaw = Math.atan2(dx, dz); moving = true;
      }
    } else if (e.state === 'flee') {
      if (e.threat) e.targetYaw = Math.atan2(e.pos[0] - e.threat[0], e.pos[2] - e.threat[2]);
      moving = true; speed = s.walkSpeed * 1.7;
    }

    // hazard probe: fluid or big drop ahead → veer away
    if (moving) {
      e.probeT -= dt;
      if (e.probeT <= 0) {
        e.probeT = 0.3;
        if (!this._groundAheadOk(e)) {
          e.avoidT = 0.9;
          e.avoidYaw = e.yaw + Math.PI + (this.rng() - 0.5) * 1.4;
          if (e.state === 'wander') {
            this._pickWander(e, e.avoidYaw);
            e.stateT = Math.max(e.stateT, 2);
          }
        }
      }
      if (e.avoidT > 0) { e.avoidT -= dt; e.targetYaw = e.avoidYaw; }
    }

    // smooth turn (shortest arc)
    let dyaw = e.targetYaw - e.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    e.yaw += dyaw * Math.min(1, dt * (e.state === 'flee' ? 10 : 5));

    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
    if (s.hopper) {
      e.hopWait -= dt;
      if (moving && e.onGround && e.hopWait <= 0) {
        const flee = e.state === 'flee';
        e.vel[1] = 6.2 + this.rng() * 1.2;
        e.vel[0] = fx * speed * (flee ? 1.15 : 1);
        e.vel[2] = fz * speed * (flee ? 1.15 : 1);
        e.hopWait = flee ? 0.12 + this.rng() * 0.15 : 0.35 + this.rng() * 0.6;
        e.onGround = false;
      } else if (e.onGround) {
        e.vel[0] = 0; e.vel[2] = 0;
      }
    } else if (moving) {
      e.vel[0] = fx * speed; e.vel[2] = fz * speed;
    } else {
      const f = Math.max(0, 1 - dt * 8);
      e.vel[0] *= f; e.vel[2] *= f;
    }

    this._stepPhysics(e, dt);
    e.walkPhase += Math.hypot(e.vel[0], e.vel[2]) * dt * (s.hopper ? 4 : 5);
  }

  _updateMoth(e, dt, sun, nowS) {
    if (sun >= 0.25) { e.dead = true; return; }      // gone at dawn
    const r = this.rng;
    if (r() < dt * 0.04) this.hooks.audio?.creature?.(e.species, 'idle');

    e.driftT -= dt;
    if (e.driftT <= 0) { e.driftT = 2 + r() * 3; e.targetYaw = e.yaw + (r() - 0.5) * 3; }

    // drawn toward block light (lanterns, glowmoss) when brighter than here
    e.lightT -= dt;
    if (e.lightT <= 0) {
      e.lightT = 0.6;
      const w = this.world;
      const by = Math.floor(e.pos[1]);
      const here = w.lightAt(Math.floor(e.pos[0]), by, Math.floor(e.pos[2])) & 15;
      let best = here + 1, bestYaw = null;
      for (const off of [-0.9, 0, 0.9]) {
        const a = e.yaw + off;
        const lx = Math.floor(e.pos[0] + Math.sin(a) * 5);
        const lz = Math.floor(e.pos[2] + Math.cos(a) * 5);
        const l = w.lightAt(lx, by, lz) & 15;
        if (l >= best) { best = l; bestYaw = a; }
      }
      if (bestYaw != null) { e.targetYaw = bestYaw; e.driftT = 1.5; }
    }

    let dyaw = e.targetYaw - e.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    e.yaw += dyaw * Math.min(1, dt * 2.5);

    const gy = this.world.heightAt(Math.floor(e.pos[0]), Math.floor(e.pos[2]));
    const targetY = gy + 1 + e.alt + Math.sin(nowS * 0.8 + e.phase) * 0.9;
    e.vel[0] = Math.sin(e.yaw) * e.def.walkSpeed;
    e.vel[2] = Math.cos(e.yaw) * e.def.walkSpeed;
    e.vel[1] = Math.max(-1.6, Math.min(1.6, (targetY - e.pos[1]) * 1.5));

    const hitX = this._moveAxis(e, 0, e.vel[0] * dt);
    const hitZ = this._moveAxis(e, 2, e.vel[2] * dt);
    this._moveAxis(e, 1, e.vel[1] * dt);
    if (hitX || hitZ) { e.targetYaw = e.yaw + Math.PI; e.driftT = 1.5; }
  }

  // Hostiles: chase the player within range, melee on cooldown, wander when
  // far. Grounded stalkers use gravity + step-up; hollowshade-style flyers
  // hover toward the player like the moth. Grazers' logic is untouched.
  _updateHostile(e, dt, pp, sun, nowS) {
    const s = e.def;
    if (s.nightOnly && sun >= 0.25) { e.dead = true; return; }   // gone at dawn
    if (this.rng() < dt * 0.04) this.hooks.audio?.creature?.(e.species, 'idle');

    e.atkCd = Math.max(0, (e.atkCd || 0) - dt);

    const dx = pp[0] - e.pos[0], dz = pp[2] - e.pos[2];
    const distSq = dx * dx + dz * dz;
    const chasing = distSq < 16 * 16;
    const wandering = distSq > 24 * 24;

    let moving = false, speed = s.walkSpeed;
    if (chasing) {
      e.targetYaw = Math.atan2(dx, dz);
      moving = true;
      // melee when close and cooldown ready
      if (distSq < 1.6 * 1.6 && e.atkCd <= 0) {
        const d = Math.sqrt(distSq) || 1;
        this.hooks.attackPlayer?.(s.dmg, [dx / d, 0, dz / d]);
        e.atkCd = 1;
        this.hooks.audio?.creature?.(e.species, 'attack');
      }
    } else if (wandering) {
      // idle wander (reuse existing timed state machine)
      e.stateT -= dt;
      if (e.stateT <= 0) {
        if (this.rng() < 0.5) {
          e.state = 'wander'; e.stateT = 3 + this.rng() * 4; this._pickWander(e);
        } else {
          e.state = 'idle'; e.stateT = 1 + this.rng() * 3;
        }
      }
      if (e.state === 'wander' && e.tgt) {
        const wx = e.tgt[0] - e.pos[0], wz = e.tgt[1] - e.pos[2];
        if (wx * wx + wz * wz < 0.6) { e.state = 'idle'; e.stateT = 1 + this.rng() * 3; }
        else { e.targetYaw = Math.atan2(wx, wz); moving = true; }
      }
      speed = s.walkSpeed * 0.6;
    }

    // smooth turn (shortest arc)
    let dyaw = e.targetYaw - e.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    e.yaw += dyaw * Math.min(1, dt * (chasing ? 8 : 4));

    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);

    if (s.flying) {
      // moth-style hover toward/around the player
      const gy = this.world.heightAt(Math.floor(e.pos[0]), Math.floor(e.pos[2]));
      const targetY = gy + 1 + e.alt + Math.sin(nowS * 0.9 + e.phase) * 0.6;
      e.vel[0] = moving ? fx * speed : e.vel[0] * Math.max(0, 1 - dt * 6);
      e.vel[2] = moving ? fz * speed : e.vel[2] * Math.max(0, 1 - dt * 6);
      e.vel[1] = Math.max(-1.6, Math.min(1.6, (targetY - e.pos[1]) * 1.5));
      this._moveAxis(e, 0, e.vel[0] * dt);
      this._moveAxis(e, 2, e.vel[2] * dt);
      this._moveAxis(e, 1, e.vel[1] * dt);
    } else {
      if (moving) {
        // hazard probe so chasers don't march into fluid/off cliffs
        e.probeT -= dt;
        if (e.probeT <= 0) {
          e.probeT = 0.3;
          if (!this._groundAheadOk(e)) { e.vel[0] = 0; e.vel[2] = 0; moving = false; }
        }
        if (moving) { e.vel[0] = fx * speed; e.vel[2] = fz * speed; }
      } else {
        const f = Math.max(0, 1 - dt * 8);
        e.vel[0] *= f; e.vel[2] *= f;
      }
      this._stepPhysics(e, dt);
    }
    e.walkPhase += Math.hypot(e.vel[0], e.vel[2]) * dt * 5;
  }

  _nextState(e) {
    const r = this.rng;
    if (e.state === 'flee') {
      e.state = 'idle'; e.stateT = 1 + r() * 2; e.threat = null; return;
    }
    const roll = r();
    if (roll < 0.45) {
      e.state = 'wander'; e.stateT = 3 + r() * 4; this._pickWander(e);
    } else if (roll < 0.7 && e.def.grazes) {
      e.state = 'graze'; e.stateT = e.grazeDur;
    } else {
      e.state = 'idle'; e.stateT = 1 + r() * 3;
    }
  }

  _pickWander(e, biasYaw) {
    const r = this.rng;
    const ang = biasYaw != null ? biasYaw + (r() - 0.5) : r() * TWO_PI;
    const d = 3 + r() * 6;
    e.tgt = [e.pos[0] + Math.sin(ang) * d, e.pos[2] + Math.cos(ang) * d];
  }

  _startFlee(e, threatPos) {
    e.state = 'flee'; e.stateT = 4;
    e.threat = [threatPos[0], threatPos[2]];
  }

  // Is the footing one block ahead walkable? (no fluid, drop ≤ 3)
  _groundAheadOk(e) {
    const w = this.world;
    const px = Math.floor(e.pos[0] + Math.sin(e.yaw) * (e.hw + 0.8));
    const pz = Math.floor(e.pos[2] + Math.cos(e.yaw) * (e.hw + 0.8));
    const fy = Math.floor(e.pos[1] + 0.01);
    const ahead = w.getBlock(px, fy, pz);
    if (isWater(ahead) || isLava(ahead)) return false;
    for (let i = 0; i <= 3; i++) {
      const id = w.getBlock(px, fy - 1 - i, pz);
      if (isWater(id) || isLava(id)) return false;
      if (w.isSolid(px, fy - 1 - i, pz)) return true;
    }
    return false;
  }

  // ── Physics ──────────────────────────────────────────────────────
  _stepPhysics(e, dt) {
    const w = this.world;
    const feet = w.getBlock(Math.floor(e.pos[0]), Math.floor(e.pos[1] + 0.1), Math.floor(e.pos[2]));
    const inWater = isWater(feet);
    e.vel[1] += GRAVITY * dt * (inWater ? 0.25 : 1);
    if (inWater) {
      e.vel[1] = Math.min(e.vel[1] + 30 * dt, 2.5);      // buoyancy
      const f = Math.max(0, 1 - dt * 2);
      e.vel[0] *= f; e.vel[2] *= f;
    }
    if (e.vel[1] < -38) e.vel[1] = -38;

    const hitX = this._moveAxis(e, 0, e.vel[0] * dt);
    const hitZ = this._moveAxis(e, 2, e.vel[2] * dt);
    if (hitX) e.vel[0] = 0;
    if (hitZ) e.vel[2] = 0;
    if (e.kind === 'creature') {
      e.hopCd -= dt;
      // hop up single-block steps
      if ((hitX || hitZ) && e.onGround && e.hopCd <= 0) {
        e.vel[1] = 7; e.hopCd = 0.7;
      }
    }
    const dy = e.vel[1] * dt;
    const hitY = this._moveAxis(e, 1, dy);
    e.onGround = hitY && dy < 0;
    if (hitY) e.vel[1] = 0;
  }

  // Move along one axis and clamp against solid voxels overlapping the AABB.
  _moveAxis(e, axis, d) {
    if (d === 0) return false;
    e.pos[axis] += d;
    const w = this.world, hw = e.hw, eps = 0.001;
    const minX = e.pos[0] - hw, maxX = e.pos[0] + hw;
    const minY = e.pos[1], maxY = e.pos[1] + e.h;
    const minZ = e.pos[2] - hw, maxZ = e.pos[2] + hw;
    for (let by = Math.floor(minY); by <= Math.floor(maxY - eps); by++) {
      for (let bx = Math.floor(minX); bx <= Math.floor(maxX - eps); bx++) {
        for (let bz = Math.floor(minZ); bz <= Math.floor(maxZ - eps); bz++) {
          if (!w.isSolid(bx, by, bz)) continue;
          if (axis === 0) e.pos[0] = d > 0 ? bx - hw - eps : bx + 1 + hw + eps;
          else if (axis === 1) e.pos[1] = d > 0 ? by - e.h - eps : by + 1 + eps;
          else e.pos[2] = d > 0 ? bz - hw - eps : bz + 1 + hw + eps;
          return true;
        }
      }
    }
    return false;
  }

  // ── Item entities ────────────────────────────────────────────────
  spawnDrops(x, y, z, items) {
    const r = this.rng;
    for (const it of items || []) {
      if (!it || !it.key || !(it.count > 0)) continue;
      let itemCount = 0;
      for (const e of this.entities) if (e.kind === 'item') itemCount++;
      if (itemCount >= ITEM_CAP) {
        const idx = this.entities.findIndex(e => e.kind === 'item');
        if (idx >= 0) this.entities.splice(idx, 1);
      }
      const ang = r() * TWO_PI, sp = 1 + r() * 1.6;
      this.entities.push({
        kind: 'item', species: it.key, itemKey: it.key, count: it.count,
        dur: it.dur,   // damaged tools keep their wear through a drop

        pos: [x, y, z], vel: [Math.sin(ang) * sp, 3.2 + r() * 2, Math.cos(ang) * sp],
        hw: 0.13, h: 0.26, dead: false, onGround: false,
        age: 0, pickT: 0.4, phase: r() * TWO_PI,
        aabb: makeAabb(),
      });
    }
  }

  _updateItem(e, dt, pp) {
    e.age += dt;
    if (e.age >= ITEM_LIFE) { e.dead = true; return; }
    e.pickT -= dt;

    // magnet toward the player's torso
    const dx = pp[0] - e.pos[0], dy = pp[1] + 0.9 - (e.pos[1] + 0.2), dz = pp[2] - e.pos[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1.8 && dist > 1e-4) {
      const k = Math.min(1, dt * 8), sp = 7 / dist;
      e.vel[0] += (dx * sp - e.vel[0]) * k;
      e.vel[1] += (dy * sp - e.vel[1]) * k;
      e.vel[2] += (dz * sp - e.vel[2]) * k;
    }
    if (dist < 0.6 && e.pickT <= 0) {
      const left = this.hooks.pickupItem ? this.hooks.pickupItem(e.itemKey, e.count, e.dur) : e.count;
      if (left <= 0) {
        this.hooks.audio?.play?.('pickup');
        e.dead = true;
        return;
      }
      e.count = left; e.pickT = 0.5;
    }

    this._stepPhysics(e, dt);
    if (e.onGround) {
      const f = Math.max(0, 1 - dt * 10);
      e.vel[0] *= f; e.vel[2] *= f;
    }
  }

  _mergeItems() {
    const list = this.entities;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.kind !== 'item' || a.dead) continue;
      const max = itemByKey(a.itemKey)?.maxStack ?? 64;
      for (let j = i + 1; j < list.length && a.count < max; j++) {
        const b = list[j];
        if (b.kind !== 'item' || b.dead || b.itemKey !== a.itemKey) continue;
        if (a.dur !== undefined || b.dur !== undefined) continue;  // tools never merge
        const dx = a.pos[0] - b.pos[0], dy = a.pos[1] - b.pos[1], dz = a.pos[2] - b.pos[2];
        if (dx * dx + dy * dy + dz * dz > 1) continue;
        const take = Math.min(b.count, max - a.count);
        a.count += take; b.count -= take;
        if (b.count <= 0) b.dead = true;
      }
    }
  }

  // ── Combat ───────────────────────────────────────────────────────
  hitEntity(e, dmg, dir) {
    if (!e || e.dead || e.kind !== 'creature') return;
    e.health -= dmg;
    e.flash = 1;
    const kx = (dir && dir[0]) || 0, kz = (dir && dir[2]) || 0;
    const kl = Math.hypot(kx, kz) || 1;
    e.vel[0] += (kx / kl) * 5.5;
    e.vel[2] += (kz / kl) * 5.5;
    e.vel[1] = Math.max(e.vel[1], 4.2);
    e.onGround = false;

    if (e.health <= 0) {
      e.dead = true;
      if (e.def.boss) this._bossDown = true;   // don't respawn the boss this session
      this.hooks.audio?.creature?.(e.species, 'death');
      this.spawnDrops(e.pos[0], e.pos[1] + e.h * 0.5, e.pos[2], e.def.drops(this.rng));
      this.hooks.particles?.burstBlock?.(
        Math.floor(e.pos[0]), Math.floor(e.pos[1]), Math.floor(e.pos[2]), 0, 12, 0.7, this.rng);
      return;
    }
    this.hooks.audio?.creature?.(e.species, 'hurt');
    if (e.def.hostile) {
      // hostiles keep coming — just refresh facing toward the attacker
      e.targetYaw = Math.atan2(-kx, -kz);
    } else if (e.def.flying) {
      e.targetYaw = Math.atan2(kx, kz);
      e.driftT = 2;
    } else {
      e.state = 'flee'; e.stateT = 4;
      e.threat = [e.pos[0] - kx / kl, e.pos[2] - kz / kl];
    }
  }

  // ── Rendering ────────────────────────────────────────────────────
  renderList() {
    const out = [], w = this.world, nowS = this._nowS;
    for (const e of this.entities) {
      if (e.dead) continue;
      const parts = [];
      if (e.kind === 'item') itemEntParts(e, parts, nowS);
      else PART_BUILDERS[e.species](e, parts, nowS);
      let light = 1;
      if (e.species !== 'embermoth') {          // the moth glows on its own
        const l = w.lightAt(
          Math.floor(e.pos[0]), Math.floor(e.pos[1] + e.h * 0.5), Math.floor(e.pos[2]));
        light = Math.max(0.08, Math.max(((l >> 4) / 15) * this._sun, (l & 15) / 15));
      }
      out.push({ parts, light, flash: e.flash || 0 });
    }
    return out;
  }
}
