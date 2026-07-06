// BLOCKS — engine-wide constants. Single source of truth; import from here, never redefine.

// ── World dimensions ──────────────────────────────────────────────
export const CHUNK_X = 16;          // chunk width  (x)
export const CHUNK_Y = 128;         // world height (y)
export const CHUNK_Z = 16;          // chunk depth  (z)
export const SECTION_Y = 16;        // render-section height
export const SECTIONS = CHUNK_Y / SECTION_Y;   // 8 sections per column
export const SEA_LEVEL = 48;
export const CHUNK_VOL = CHUNK_X * CHUNK_Y * CHUNK_Z;

// Block index inside a chunk. x:0-15, z:0-15, y:0-127.
export const bIdx = (x, y, z) => (y << 8) | (z << 4) | x;

// ── Time ──────────────────────────────────────────────────────────
export const DAY_LENGTH = 900;      // seconds per full day/night cycle (15 min)
export const TICK_DT = 1 / 60;      // fixed physics step
export const RANDOM_TICK_MS = 400;  // crop/berry growth cadence
export const FLUID_TICK_MS = 220;   // water spread cadence (lava = 3x slower)

// ── Player physics ────────────────────────────────────────────────
export const GRAVITY = -26;
export const JUMP_SPEED = 8.2;
export const WALK_SPEED = 4.3;
export const SPRINT_SPEED = 6.4;
export const CROUCH_SPEED = 1.8;
export const SWIM_SPEED = 3.2;
export const CLIMB_SPEED = 2.4;
export const AIR_CONTROL = 0.28;    // fraction of ground accel while airborne
export const PLAYER_W = 0.6;        // AABB width
export const PLAYER_H = 1.8;        // AABB height
export const EYE_HEIGHT = 1.62;
export const EYE_CROUCH = 1.32;
export const REACH = 5;             // block interaction distance
export const FALL_SAFE = 3.2;       // blocks of free fall before damage

// ── Survival ──────────────────────────────────────────────────────
export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
export const MAX_AIR = 10;

// ── Rendering ─────────────────────────────────────────────────────
export const DEFAULT_RENDER_DIST = 8;   // chunks
export const FOG_START_FRAC = 0.72;     // fraction of view distance where fog begins
export const CLOUD_HEIGHT = 132;

// ── Light ─────────────────────────────────────────────────────────
export const MAX_LIGHT = 15;
export const packLight = (sky, block) => (sky << 4) | block;
export const skyOf = l => l >> 4;
export const blockOf = l => l & 15;

// ── Game modes ────────────────────────────────────────────────────
export const MODE_JOURNEY = 'journey';   // survival
export const MODE_BUILDER = 'builder';   // creative

// ── Directions: [dx,dy,dz] for +x,-x,+y,-y,+z,-z ─────────────────
export const DIRS = [
  [ 1, 0, 0], [-1, 0, 0],
  [ 0, 1, 0], [ 0,-1, 0],
  [ 0, 0, 1], [ 0, 0,-1],
];

export const GAME_NAME = 'BLOCKS';
export const GAME_TAGLINE = 'a boundless voxel wilderness';
export const SAVE_VERSION = 1;
