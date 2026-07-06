// Weather state machine. Markov transitions between clear/cloudy/rain/storm,
// smoothed values published for the renderer (overcast, cloudCover, flash),
// wind level for the audio scene, and precipitation particle spawning.
// Audio scene switching is owned by main; this module only fires thunder().

import { BIOME } from './world/gen/terrain.js';

const TARGETS = {
  clear:  { overcast: 0,    cover: 0.32, wind: 0.15 },
  cloudy: { overcast: 0.35, cover: 0.5,  wind: 0.3  },
  rain:   { overcast: 0.7,  cover: 0.62, wind: 0.55 },
  storm:  { overcast: 0.95, cover: 0.72, wind: 0.9  },
};

// Per-state [next kind, probability] rows; probabilities sum to 1.
const TRANSITIONS = {
  clear:  [['cloudy', 0.5], ['clear', 0.5]],
  cloudy: [['rain', 0.4], ['clear', 0.4], ['storm', 0.2]],
  rain:   [['cloudy', 0.5], ['rain', 0.3], ['storm', 0.2]],
  storm:  [['rain', 0.6], ['cloudy', 0.4]],
};

const SMOOTH_RATE = 0.15;     // per-second approach rate for published values
const FLASH_DECAY = 3;        // lightning flash fade per second

const stateDuration = () => 120 + Math.random() * 240;

export class Weather {
  constructor(world, particles, audio) {
    this.world = world;
    this.particles = particles;
    this.audio = audio;

    this.kind = 'clear';                  // persisted
    this.timer = stateDuration();         // persisted; seconds until next transition
    this.overcast = 0;
    this.cloudCover = 0.32;
    this.flash = 0;
    this.windLevel = 0.15;

    this._layerOf = null;                 // (texKey) -> atlas layer, injected by main
    this._boltAt = null;                  // absolute time (nowS) of next lightning
    this._spawnAcc = 0;                   // fractional particle carry-over
  }

  setBlockLayerLookup(fn) { this._layerOf = fn; }

  update(dt, playerPos, timeOfDay, nowS) {
    this.timer -= dt;
    if (this.timer <= 0) this._transition();

    const t = TARGETS[this.kind];
    const k = Math.min(1, SMOOTH_RATE * dt);
    this.overcast += (t.overcast - this.overcast) * k;
    this.cloudCover += (t.cover - this.cloudCover) * k;
    this.windLevel += (t.wind - this.windLevel) * k;
    this.flash = Math.max(0, this.flash - FLASH_DECAY * dt);

    if (this.kind === 'storm') {
      if (this._boltAt === null) this._boltAt = nowS + 4 + Math.random() * 10;
      if (nowS >= this._boltAt) {
        this.flash = 1;
        if (this.audio && this.audio.thunder) this.audio.thunder();
        this._boltAt = nowS + 4 + Math.random() * 10;
      }
    } else {
      this._boltAt = null;
    }

    if (this.kind === 'rain' || this.kind === 'storm') this._precipitate(dt, playerPos);
    else this._spawnAcc = 0;
  }

  _transition() {
    const r = Math.random();
    let acc = 0;
    for (const [next, p] of TRANSITIONS[this.kind]) {
      acc += p;
      if (r < acc) { this.kind = next; break; }
    }
    this.timer = stateDuration();
  }

  _precipitate(dt, playerPos) {
    if (!this._layerOf || !playerPos) return;
    const snow = (() => {
      const b = this.world.biomeAt(Math.floor(playerPos[0]), Math.floor(playerPos[2]));
      return b === BIOME.TUNDRA || b === BIOME.MOUNTAIN;
    })();
    const layer = this._layerOf(snow ? 'snowflake' : 'rain');
    if (layer == null) return;

    this._spawnAcc += (this.kind === 'storm' ? 160 : 90) * dt;
    let n = Math.floor(this._spawnAcc);
    this._spawnAcc -= n;

    for (; n > 0; n--) {
      const x = playerPos[0] + (Math.random() * 2 - 1) * 18;
      const z = playerPos[2] + (Math.random() * 2 - 1) * 18;
      const y = Math.min(126, playerPos[1] + 10 + Math.random() * 6);
      const bx = Math.floor(x), bz = Math.floor(z);
      if (this.world.heightAt(bx, bz) >= y) continue;   // indoors / under canopy stays dry
      const sky = (this.world.lightAt(bx, Math.floor(y), bz) >> 4) / 15;
      const bright = Math.max(0.25, sky);
      if (snow) {
        this.particles.spawn({
          x, y, z, vx: (Math.random() - 0.5) * 0.6, vy: -2.2, vz: (Math.random() - 0.5) * 0.6,
          gravity: 0, life: 8, size: 0.07, layer, bright, dieOnHit: true,
        });
      } else {
        this.particles.spawn({
          x, y, z, vy: -34, gravity: 0, life: 1.2, size: 0.05, stretchY: 5,
          layer, bright, alpha: 0.5, dieOnHit: true,
        });
      }
    }
  }

  serialize() {
    return { kind: this.kind, timer: this.timer };
  }

  deserialize(d) {
    if (!d) return;
    if (TARGETS[d.kind]) this.kind = d.kind;
    if (Number.isFinite(d.timer)) this.timer = Math.max(1, d.timer);
    // Snap published values so the sky looks right immediately after load.
    const t = TARGETS[this.kind];
    this.overcast = t.overcast;
    this.cloudCover = t.cover;
    this.windLevel = t.wind;
    this._boltAt = null;
  }
}
