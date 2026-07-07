// Dimension registry: each realm has its own generator, sky/environment,
// travel rules, and portal materials.

import { makeGenerator } from './gen/terrain.js';
import { makeSmolderGenerator, LAVA_LEVEL } from './gen/smolder.js';
import { makeHollowGenerator, ARENA_Y } from './gen/hollow.js';
import { B } from '../blocks.js';

export const DIMENSIONS = {
  overworld: {
    key: 'overworld',
    name: 'the Overworld',
    makeGenerator: (seed, decorations) => makeGenerator(seed, decorations),
    hasWeather: true,
    hasDayCycle: true,
    skyMode: 0,             // sun/moon/stars as usual
    travelScale: 1,
    env: null,              // computed from time of day
  },
  smolder: {
    key: 'smolder',
    name: 'the Smolder',
    makeGenerator: (seed) => makeSmolderGenerator(seed),
    hasWeather: false,
    hasDayCycle: false,
    skyMode: 1,             // ember haze, no celestial bodies
    travelScale: 8,         // 1 block here = 8 overworld blocks
    portalMaterial: B.BASALT,
    riftBlock: B.NETHER_PORTAL,
    arrivalY: LAVA_LEVEL + 10,
    env: {
      sunLevel: 0.34, night: 0,
      zenith: [0.10, 0.025, 0.015], horizon: [0.30, 0.09, 0.04],
      skyTint: [1.0, 0.62, 0.45], fogColor: [0.24, 0.07, 0.035],
      sunDir: [0, 1, 0],
    },
  },
  hollow: {
    key: 'hollow',
    name: 'the Hollow',
    makeGenerator: (seed) => makeHollowGenerator(seed),
    hasWeather: false,
    hasDayCycle: false,
    skyMode: 2,             // eternal starfield, no sun
    travelScale: 0,         // fixed arrival at the arena
    portalMaterial: B.SUNSTONE_BLOCK,
    riftBlock: B.END_PORTAL,
    arrivalY: ARENA_Y + 2,
    env: {
      sunLevel: 0.5, night: 0.9,
      zenith: [0.02, 0.015, 0.05], horizon: [0.10, 0.08, 0.17],
      skyTint: [0.78, 0.74, 0.98], fogColor: [0.08, 0.065, 0.14],
      sunDir: [0, 1, 0],
    },
  },
};

export const dimension = (key) => DIMENSIONS[key] ?? DIMENSIONS.overworld;

// Which dimension a rift block leads to (from where).
export function riftTarget(riftId, currentDim) {
  if (riftId === B.NETHER_PORTAL) return currentDim === 'smolder' ? 'overworld' : 'smolder';
  if (riftId === B.END_PORTAL) return currentDim === 'hollow' ? 'overworld' : 'hollow';
  return null;
}
