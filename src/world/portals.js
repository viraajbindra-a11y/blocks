// Rift portals: strike a rectangular frame of the right material with a
// kindle flint and the interior fills with a rift. Standing in a rift
// carries you to the linked dimension.
//
// Frames are vertical rectangles in either the x/y or z/y plane, interior
// from 2x3 up to 6x6, fully enclosed by the frame material.

import { B, blockById } from '../blocks.js';
import { DIMENSIONS } from './dimensions.js';

const MAX_INNER = 6;

// Try to ignite starting from an air cell believed to be inside a frame.
// Returns true if a rift was lit.
export function tryIgnite(world, x, y, z) {
  for (const dimKey of ['smolder', 'hollow']) {
    const dim = DIMENSIONS[dimKey];
    for (const axis of ['x', 'z']) {
      const rect = findFrameInterior(world, x, y, z, axis, dim.portalMaterial);
      if (rect) {
        fillRect(world, rect, dim.riftBlock);
        return dimKey;
      }
    }
  }
  return null;
}

// Flood the air region in-plane from (x,y,z); if it is a small rectangle
// fully bounded by `material`, return its bounds.
function findFrameInterior(world, x, y, z, axis, material) {
  const uOf = (p) => axis === 'x' ? p[0] : p[2];
  const mk = (u, y2) => axis === 'x' ? [u, y2, z] : [x, y2, u];
  const isAir = (p) => world.getBlock(p[0], p[1], p[2]) === B.AIR;
  const isFrame = (p) => world.getBlock(p[0], p[1], p[2]) === material;

  // Expand a bounding box from the start cell over connected air (in-plane).
  const seen = new Set();
  const queue = [[uOf([x, y, z].slice(0)), y]];
  const startU = axis === 'x' ? x : z;
  queue[0] = [startU, y];
  let minU = startU, maxU = startU, minY = y, maxY = y;
  let head = 0;
  while (head < queue.length) {
    const [u, yy] = queue[head++];
    const key = `${u},${yy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > MAX_INNER * MAX_INNER + 8) return null;    // too big
    if (!isAir(mk(u, yy))) continue;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    minY = Math.min(minY, yy); maxY = Math.max(maxY, yy);
    queue.push([u + 1, yy], [u - 1, yy], [u, yy + 1], [u, yy - 1]);
  }
  const w = maxU - minU + 1, h = maxY - minY + 1;
  if (w < 2 || h < 3 || w > MAX_INNER || h > MAX_INNER) return null;

  // Every interior cell must be air; every border cell must be frame.
  for (let u = minU; u <= maxU; u++) {
    for (let yy = minY; yy <= maxY; yy++) {
      if (!isAir(mk(u, yy))) return null;
    }
  }
  for (let u = minU; u <= maxU; u++) {
    if (!isFrame(mk(u, minY - 1)) || !isFrame(mk(u, maxY + 1))) return null;
  }
  for (let yy = minY; yy <= maxY; yy++) {
    if (!isFrame(mk(minU - 1, yy)) || !isFrame(mk(maxU + 1, yy))) return null;
  }
  return { axis, minU, maxU, minY, maxY, x, z };
}

function fillRect(world, rect, riftId) {
  for (let u = rect.minU; u <= rect.maxU; u++) {
    for (let yy = rect.minY; yy <= rect.maxY; yy++) {
      if (rect.axis === 'x') world.setBlock(u, yy, rect.z, riftId);
      else world.setBlock(rect.x, yy, u, riftId);
    }
  }
}

// On arrival: reuse a nearby rift, or carve a platform and build a fresh
// return frame. riftKind names WHICH portal pair this is ('smolder' or
// 'hollow') regardless of which side we arrive on.
export function ensureArrivalPortal(world, riftKind, ax, ay, az) {
  const dim = DIMENSIONS[riftKind];
  const rift = dim.riftBlock, mat = dim.portalMaterial;

  // Existing rift nearby?
  for (let r = 0; r <= 12; r += 2) {
    for (let dx = -r; dx <= r; dx += 2) {
      for (let dz = -r; dz <= r; dz += 2) {
        for (let dy = -6; dy <= 6; dy++) {
          if (world.getBlock(ax + dx, ay + dy, az + dz) === rift) {
            return [ax + dx + 0.5, ay + dy, az + dz + 1.5];
          }
        }
      }
    }
  }

  // Build one: platform + frame with a 2x3 interior in the x/y plane.
  const px = Math.floor(ax), py = Math.floor(ay), pz = Math.floor(az);
  for (let dx = -2; dx <= 3; dx++) {
    for (let dz = -1; dz <= 2; dz++) {
      world.setBlock(px + dx, py - 1, pz + dz, mat);
      for (let dy = 0; dy <= 4; dy++) {
        const id = world.getBlock(px + dx, py + dy, pz + dz);
        if (id !== B.AIR && blockById(id).hardness >= 0) {
          world.setBlock(px + dx, py + dy, pz + dz, B.AIR);
        }
      }
    }
  }
  // Frame columns at dx -1..2 on the dz=0 line, interior dx 0..1, dy 0..2
  for (let dx = -1; dx <= 2; dx++) {
    world.setBlock(px + dx, py - 1, pz, mat);
    world.setBlock(px + dx, py + 3, pz, mat);
  }
  for (let dy = 0; dy <= 2; dy++) {
    world.setBlock(px - 1, py + dy, pz, mat);
    world.setBlock(px + 2, py + dy, pz, mat);
  }
  for (let dx = 0; dx <= 1; dx++) {
    for (let dy = 0; dy <= 2; dy++) {
      world.setBlock(px + dx, py + dy, pz, rift);
    }
  }
  return [px + 0.5, py, pz + 1.5];
}
