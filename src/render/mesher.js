// Section mesher: turns a 16³ block section into GPU-ready geometry.
//
// - Greedy meshing: coplanar faces with identical texture/light/AO merge
//   into single quads (UVs tile via REPEAT on the texture array).
// - Per-corner ambient occlusion baked into vertices.
// - Face light sampled from the air cell the face looks into.
// - Cross-plants and fluids are meshed separately (no greedy).
//
// Vertex layout (floats): pos(3) uv(2) layer(1) sky(1) blk(1) ao(1) flags(1)

import { CHUNK_X, CHUNK_Y, CHUNK_Z, SECTION_Y, bIdx } from '../core/constants.js';
import { B, BLOCKS, blockById, isWater, isLava, isFluid, isShaped, shapeBoxes, connMask, fluidLevel, faceTexKey } from '../blocks.js';

const P = 18;                          // padded cube side
const pIdx = (x, y, z) => ((y + 1) * P + (z + 1)) * P + (x + 1);

// Per-direction basis: axis, u-axis, v-axis, positive-facing?
// Chosen so uAxis × vAxis == outward normal → CCW winding from outside.
const DIR_INFO = [
  { axis: 0, ua: 1, va: 2, pos: true  },  // +x
  { axis: 0, ua: 2, va: 1, pos: false },  // -x
  { axis: 1, ua: 2, va: 0, pos: true  },  // +y
  { axis: 1, ua: 0, va: 2, pos: false },  // -y
  { axis: 2, ua: 0, va: 1, pos: true  },  // +z
  { axis: 2, ua: 1, va: 0, pos: false },  // -z
];
const AXIS_VEC = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// Scratch buffers, reused between calls (single-threaded meshing).
const blocksCache = new Uint8Array(P * P * P);
const lightCache = new Uint8Array(P * P * P);
const mask = new Int32Array(256);
const maskAO = new Uint8Array(256);

class GeoBuffer {
  constructor() { this.verts = []; this.indices = []; this.vcount = 0; }
  quad(corners, uvs, layer, sky, blk, aos, flags, doubleSided = false, flipDiag = false) {
    const base = this.vcount;
    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      this.verts.push(c[0], c[1], c[2], uvs[i][0], uvs[i][1], layer, sky, blk, aos[i], flags);
    }
    this.vcount += 4;
    if (flipDiag) this.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    else this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    if (doubleSided) {
      if (flipDiag) this.indices.push(base + 3, base + 2, base + 1, base, base + 3, base + 1);
      else this.indices.push(base + 2, base + 1, base, base + 3, base + 2, base);
    }
  }
  build() {
    if (this.vcount === 0) return null;
    return { vertices: new Float32Array(this.verts), indices: new Uint32Array(this.indices) };
  }
}

let texLayerOf = null;   // key -> layer index, injected once at startup
export function setTextureLayerLookup(fn) { texLayerOf = fn; }

const faceLayer = (block, dir) => texLayerOf(faceTexKey(block, dir));

const occludes = (id) => {
  const b = BLOCKS[id];
  return b ? b.opaque : false;
};

// Fill the 18³ cache with blocks + light around the section.
function fillCache(world, cx, sy, cz) {
  const oy = sy * SECTION_Y;
  // 3×3 chunk refs
  const refs = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) refs.push(world.chunkAt(cx + dx, cz + dz));
  }
  let any = false;
  for (let z = -1; z <= 16; z++) {
    const rz = z < 0 ? 0 : z > 15 ? 2 : 1;
    for (let x = -1; x <= 16; x++) {
      const rx = x < 0 ? 0 : x > 15 ? 2 : 1;
      const chunk = refs[rz * 3 + rx];
      const lx = x & 15, lz = z & 15;
      for (let y = -1; y <= 16; y++) {
        const wy = oy + y;
        const pi = pIdx(x, y, z);
        if (wy < 0) { blocksCache[pi] = B.CORESTONE; lightCache[pi] = 0; continue; }
        if (wy >= CHUNK_Y || !chunk || !chunk.blocks) {
          blocksCache[pi] = B.AIR; lightCache[pi] = 15 << 4; continue;
        }
        const i = bIdx(lx, wy, lz);
        const id = chunk.blocks[i];
        blocksCache[pi] = id;
        lightCache[pi] = chunk.light[i];
        if (id !== B.AIR && x >= 0 && x <= 15 && y >= 0 && y <= 15 && z >= 0 && z <= 15) any = true;
      }
    }
  }
  return any;
}

export function meshSection(world, cx, sy, cz) {
  if (!fillCache(world, cx, sy, cz)) return { opaque: null, translucent: null };

  const opaque = new GeoBuffer();
  const translucent = new GeoBuffer();

  greedyPass(opaque, translucent);
  specialPass(opaque, translucent);

  return { opaque: opaque.build(), translucent: translucent.build() };
}

// True when this block goes through the greedy cube path.
function isCube(b, id) {
  return b.solid && !b.cross && !isFluid(id);
}

function greedyPass(opaque, translucent) {
  const cell = [0, 0, 0];
  for (let d = 0; d < 6; d++) {
    const { axis, ua, va, pos } = DIR_INFO[d];
    const n = AXIS_VEC[axis];
    const uVec = AXIS_VEC[ua], vVec = AXIS_VEC[va];

    for (let a = 0; a < 16; a++) {
      // Build the visibility mask for this slice
      mask.fill(0); maskAO.fill(0);
      for (let v = 0; v < 16; v++) {
        for (let u = 0; u < 16; u++) {
          cell[axis] = a; cell[ua] = u; cell[va] = v;
          const x = cell[0], y = cell[1], z = cell[2];
          const id = blocksCache[pIdx(x, y, z)];
          if (id === B.AIR || isFluid(id)) continue;
          const b = BLOCKS[id];
          if (!b || b.cross || b.shape !== 'cube') continue;   // shaped → specialPass
          const trans = b.translucent;
          const nx = x + (pos ? n[0] : -n[0]);
          const ny = y + (pos ? n[1] : -n[1]);
          const nz = z + (pos ? n[2] : -n[2]);
          const nid = blocksCache[pIdx(nx, ny, nz)];
          if (occludes(nid)) continue;
          if (nid === id) continue;                       // leaf-leaf, glass-glass
          if (trans && isWater(nid)) continue;            // ice under water: skip

          // Light from the cell the face looks into
          const lp = lightCache[pIdx(nx, ny, nz)];

          // AO: sample the 8 cells ringing the face's air cell
          let aoBits = 0;
          if (!trans) {
            const sOff = [uVec[0], uVec[1], uVec[2]];
            const tOff = [vVec[0], vVec[1], vVec[2]];
            const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
            for (let k = 0; k < 4; k++) {
              const [s, t] = corners[k];
              const s1 = occludes(blocksCache[pIdx(nx + s * sOff[0], ny + s * sOff[1], nz + s * sOff[2])]) ? 1 : 0;
              const s2 = occludes(blocksCache[pIdx(nx + t * tOff[0], ny + t * tOff[1], nz + t * tOff[2])]) ? 1 : 0;
              const cc = occludes(blocksCache[pIdx(
                nx + s * sOff[0] + t * tOff[0],
                ny + s * sOff[1] + t * tOff[1],
                nz + s * sOff[2] + t * tOff[2])]) ? 1 : 0;
              const ao = (s1 && s2) ? 0 : 3 - (s1 + s2 + cc);
              aoBits |= ao << (k * 2);
            }
          } else {
            aoBits = 0xff;   // 3,3,3,3
          }

          const layer = faceLayer(b, d);
          const flags = (b.sway ? 1 : 0) | (d << 2);
          const mi = v * 16 + u;
          // Key packs everything that must match for a merge.
          mask[mi] = 1 + (layer << 1) + (lp << 10) + (flags << 18) + (trans ? 1 << 26 : 0);
          maskAO[mi] = aoBits;
        }
      }

      // Greedy expansion over the mask
      for (let v = 0; v < 16; v++) {
        for (let u = 0; u < 16;) {
          const mi = v * 16 + u;
          const key = mask[mi];
          if (key === 0) { u++; continue; }
          const ao = maskAO[mi];
          // Width
          let w = 1;
          while (u + w < 16 && mask[mi + w] === key && maskAO[mi + w] === ao) w++;
          // Height
          let h = 1;
          outer: while (v + h < 16) {
            for (let k = 0; k < w; k++) {
              const j = (v + h) * 16 + u + k;
              if (mask[j] !== key || maskAO[j] !== ao) break outer;
            }
            h++;
          }
          // Zero out
          for (let dv = 0; dv < h; dv++)
            for (let du = 0; du < w; du++) mask[(v + dv) * 16 + u + du] = 0;

          emitGreedyQuad(key & (1 << 26) ? translucent : opaque,
            d, a, u, v, w, h, key, ao);
          u += w;
        }
      }
    }
  }
}

function emitGreedyQuad(buf, d, a, u0, v0, w, h, key, aoBits) {
  const { axis, ua, va, pos } = DIR_INFO[d];
  const layer = (key >> 1) & 0x1ff;
  const lp = (key >> 10) & 0xff;
  const flags = (key >> 18) & 0xff;
  const sky = lp >> 4, blk = lp & 15;
  const plane = pos ? a + 1 : a;

  // Corners in (u,v) space: (0,0) (w,0) (w,h) (0,h)
  const corners = [];
  const uvs = [];
  const cuv = [[0, 0], [w, 0], [w, h], [0, h]];
  for (let i = 0; i < 4; i++) {
    const p = [0, 0, 0];
    p[axis] = plane;
    p[ua] = u0 + cuv[i][0];
    p[va] = v0 + cuv[i][1];
    corners.push(p);
    // Texture coords from position → seamless tiling, upright sides
    if (axis === 1) uvs.push([p[0], p[2]]);
    else if (axis === 0) uvs.push([p[2], -p[1]]);
    else uvs.push([p[0], -p[1]]);
  }
  const aos = [aoBits & 3, (aoBits >> 2) & 3, (aoBits >> 4) & 3, (aoBits >> 6) & 3];
  // Flip triangulation when AO is stronger across the other diagonal
  const flip = aos[0] + aos[2] < aos[1] + aos[3];
  buf.quad(corners, uvs, layer, sky, blk, aos, flags, false, flip);
}

// Cross plants + fluids, cell by cell.
function specialPass(opaque, translucent) {
  for (let y = 0; y < 16; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const id = blocksCache[pIdx(x, y, z)];
        if (id === B.AIR) continue;
        const b = BLOCKS[id];
        if (!b) continue;
        if (b.cross) emitCross(opaque, b, x, y, z);
        else if (b.shape !== 'cube') emitShaped(b.translucent ? translucent : opaque, b, x, y, z);
        else if (isFluid(id)) emitFluid(translucent, id, x, y, z);
      }
    }
  }
}

function emitCross(buf, b, x, y, z) {
  const lp = lightCache[pIdx(x, y, z)];
  const sky = lp >> 4, blk = lp & 15;
  const layer = texLayerOf(b.tex.all ?? b.key);
  const flags = (b.sway ? 1 : 0) | (2 << 2);   // top-light shading
  const k = 0.146;                              // inset so the X fits the cell
  const aos = [3, 3, 3, 3];
  const q1 = [
    [x + k, y, z + k], [x + 1 - k, y, z + 1 - k],
    [x + 1 - k, y + 1, z + 1 - k], [x + k, y + 1, z + k],
  ];
  const q2 = [
    [x + k, y, z + 1 - k], [x + 1 - k, y, z + k],
    [x + 1 - k, y + 1, z + k], [x + k, y + 1, z + 1 - k],
  ];
  const uv = [[0, 1], [1, 1], [1, 0], [0, 0]];
  buf.quad(q1, uv, layer, sky, blk, aos, flags, true);
  buf.quad(q2, uv, layer, sky, blk, aos, flags, true);
}

// Shaped blocks (slabs, stairs): emit explicit geometry for each sub-box.
// Non-greedy, cell-local. Each of a box's six faces is a quad; a face that
// lies on the voxel boundary (0 or 1) is culled when the neighbor fully
// covers it (opaque, or an identical shaped id sitting flush against it).
// Faces on interior planes (a slab's top at 0.5, a step's ledges) always
// render. UVs come from world position so textures tile like cube faces.
function emitShaped(buf, b, x, y, z) {
  const lpSelf = lightCache[pIdx(x, y, z)];
  // Connecting shapes read their 4 horizontal neighbors to grow arms.
  const conn = b.connects
    ? connMask(b, (dx, dz) => blocksCache[pIdx(x + dx, y, z + dz)])
    : 0;
  const boxes = shapeBoxes(b, conn);
  // Per-face outward info: [dir, axis, sign, constCoord(0|1)]
  // dir order matches DIR_INFO / faceLayer: 0..5 = +x,-x,+y,-y,+z,-z
  for (const box of boxes) {
    const [x0, y0, z0, x1, y1, z1] = box;
    for (let dir = 0; dir < 6; dir++) {
      const axis = dir >> 1;                 // 0:x 1:y 2:z
      const positive = (dir & 1) === 0;
      // The box face on this axis + its plane value in local coords.
      const lo = axis === 0 ? x0 : axis === 1 ? y0 : z0;
      const hi = axis === 0 ? x1 : axis === 1 ? y1 : z1;
      const plane = positive ? hi : lo;
      // Only boundary faces can be occluded by a neighbor; cull them when
      // the neighbor covers the whole cell face.
      if (plane === (positive ? 1 : 0)) {
        const nx = x + (axis === 0 ? (positive ? 1 : -1) : 0);
        const ny = y + (axis === 1 ? (positive ? 1 : -1) : 0);
        const nz = z + (axis === 2 ? (positive ? 1 : -1) : 0);
        const nid = blocksCache[pIdx(nx, ny, nz)];
        if (occludes(nid)) continue;
        // Same-id flush cull is only safe for connecting shapes meeting
        // side-on (fence arm ↔ fence arm). Stacked slabs/steps of one id
        // do NOT cover each other's shared face — culling leaves holes.
        if (nid === blocksCache[pIdx(x, y, z)] && b.connects && axis !== 1) continue;
      }
      emitShapedFace(buf, b, dir, axis, positive, plane, box, x, y, z, lpSelf);
    }
  }
}

function emitShapedFace(buf, b, dir, axis, positive, plane, box, x, y, z, lp) {
  const [x0, y0, z0, x1, y1, z1] = box;
  // Corners of the face rectangle, CCW from outside (uAxis × vAxis = normal).
  const { ua, va } = DIR_INFO[dir];
  const p = plane;
  const lows = [x0, y0, z0], highs = [x1, y1, z1];
  const cornerUV = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const corners = [];
  const uvs = [];
  for (let i = 0; i < 4; i++) {
    const [su, sv] = cornerUV[i];
    const c = [0, 0, 0];
    c[axis] = p;
    c[ua] = su ? highs[ua] : lows[ua];
    c[va] = sv ? highs[va] : lows[va];
    const wx = x + c[0], wy = y + c[1], wz = z + c[2];
    corners.push([wx, wy, wz]);
    if (axis === 1) uvs.push([wx, wz]);
    else if (axis === 0) uvs.push([wz, -wy]);
    else uvs.push([wx, -wy]);
  }
  const sky = lp >> 4, blk = lp & 15;
  const layer = faceLayer(b, dir);
  const flags = (dir << 2);
  const aos = [3, 3, 3, 3];
  buf.quad(corners, uvs, layer, sky, blk, aos, flags);
}

function fluidHeight(id, above) {
  if (above) return 1;
  const lvl = fluidLevel(id);
  return lvl >= 7 ? 0.875 : 0.125 + (lvl / 7) * 0.72;
}

function emitFluid(buf, id, x, y, z) {
  const water = isWater(id);
  const same = (i) => water ? isWater(i) : isLava(i);
  const lp = lightCache[pIdx(x, y, z)];
  const sky = lp >> 4, blk = lp & 15;
  const layer = texLayerOf(water ? 'water' : 'lava');
  const aboveSame = same(blocksCache[pIdx(x, y + 1, z)]);
  const hgt = fluidHeight(id, aboveSame);
  const waveFlags = (water ? 2 : 0) | (2 << 2);
  const sideFlags = (2 << 2);
  const aos = [3, 3, 3, 3];

  // Top
  if (!aboveSame) {
    const q = [
      [x, y + hgt, z], [x, y + hgt, z + 1],
      [x + 1, y + hgt, z + 1], [x + 1, y + hgt, z],
    ];
    buf.quad(q, [[x, z], [x, z + 1], [x + 1, z + 1], [x + 1, z]], layer, sky, blk, aos, waveFlags);
  }
  // Bottom
  const below = blocksCache[pIdx(x, y - 1, z)];
  if (!same(below) && !occludes(below)) {
    const q = [
      [x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1],
    ];
    buf.quad(q, [[x, z], [x + 1, z], [x + 1, z + 1], [x, z + 1]], layer, sky, blk, aos, sideFlags);
  }
  // Sides
  const sides = [
    { dx: 1, dz: 0, c: [[x + 1, y, z + 1], [x + 1, y, z], [x + 1, y + hgt, z], [x + 1, y + hgt, z + 1]] },
    { dx: -1, dz: 0, c: [[x, y, z], [x, y, z + 1], [x, y + hgt, z + 1], [x, y + hgt, z]] },
    { dx: 0, dz: 1, c: [[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + hgt, z + 1], [x, y + hgt, z + 1]] },
    { dx: 0, dz: -1, c: [[x + 1, y, z], [x, y, z], [x, y + hgt, z], [x + 1, y + hgt, z]] },
  ];
  for (const s of sides) {
    const nid = blocksCache[pIdx(x + s.dx, y, z + s.dz)];
    if (same(nid) || occludes(nid)) continue;
    const uv = [[0, hgt], [1, hgt], [1, 0], [0, 0]];
    buf.quad(s.c, uv, layer, sky, blk, aos, sideFlags);
  }
}
