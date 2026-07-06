// Surface features (trees, plants) shared by the generation worker and
// runtime regrowth (sprouts). All writes go through a `set` callback:
//   set(x, y, z, id, force) — force=true overwrites non-air.

import { B } from '../../blocks.js';

// Roundish deciduous tree. Height 5-7, blobby canopy.
export function placeAlder(set, get, rand, x, y, z, withVines = false) {
  const h = 5 + (rand() * 3 | 0);
  const topY = y + h - 1;
  // Canopy: two fat layers + cap
  for (let dy = -2; dy <= 1; dy++) {
    const r = dy <= -1 ? 2 : 1;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (dx === 0 && dz === 0 && dy < 1) continue; // trunk passes through
        const corner = Math.abs(dx) === r && Math.abs(dz) === r;
        if (corner && (r === 1 || rand() < 0.55)) continue;
        set(x + dx, topY + dy, z + dz, B.ALDER_LEAVES, false);
        if (withVines && rand() < 0.3 && Math.abs(dx) + Math.abs(dz) >= r) {
          const vlen = 1 + (rand() * 3 | 0);
          for (let v = 1; v <= vlen; v++) set(x + dx, topY + dy - v, z + dz, B.VINE, false);
        }
      }
    }
  }
  set(x, topY + 2, z, B.ALDER_LEAVES, false);
  for (let i = 0; i < h; i++) set(x, y + i, z, B.ALDER_LOG, true);
}

// Tall conifer. Height 7-10, conical boughs.
export function placeFern(set, get, rand, x, y, z) {
  const h = 7 + (rand() * 4 | 0);
  for (let i = 0; i < h; i++) set(x, y + i, z, B.FERN_LOG, true);
  let r = 2;
  for (let dy = h - 2; dy >= 2; dy -= 2) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (dx === 0 && dz === 0) continue;
        if (Math.abs(dx) + Math.abs(dz) > r + (rand() < 0.5 ? 0 : 1)) continue;
        set(x + dx, y + dy, z + dz, B.FERN_LEAVES, false);
      }
    }
    if (r < 3) r++;
  }
  set(x, y + h, z, B.FERN_LEAVES, false);
  set(x, y + h + 1, z, B.FERN_LEAVES, false);
}

// Desert column plant, 2-3 tall.
export function placeSpineplant(set, get, rand, x, y, z) {
  const h = 2 + (rand() < 0.4 ? 1 : 0);
  for (let i = 0; i < h; i++) set(x, y + i, z, B.SPINEPLANT, false);
}

// Check a tree has room to grow at runtime (sprout growth).
export function hasTreeRoom(get, x, y, z, height = 8, radius = 2) {
  for (let dy = 1; dy < height; dy++) {
    const r = dy < 3 ? 0 : radius;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const id = get(x + dx, y + dy, z + dz);
        if (id !== B.AIR && id !== B.ALDER_LEAVES && id !== B.FERN_LEAVES &&
            id !== B.TALLGRASS && id !== B.VINE) return false;
      }
    }
  }
  return true;
}
