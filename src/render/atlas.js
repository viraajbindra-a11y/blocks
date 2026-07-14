// BLOCKS procedural texture atlas — every texture in the game is 16x16
// pixel art generated here, deterministically, from the texture key alone.
// Earthy, slightly desaturated palette: teal-leaning greens, warm stone.
//
// buildAtlas() paints one layer per key (block faces from blocks.js,
// item sprites from items.js, weather extras, crack decals) and also
// bakes 36x36 PNG data-URL icons for the DOM inventory.

import { mulberry32, normalizeSeed, clamp, smoothstep } from '../math/noise.js';
import { allTextureKeys, blockById, faceTexKey } from '../blocks.js';
import { spriteItemKeys, itemByKey } from '../items.js';

const W = 16;

// ── Color helpers ─────────────────────────────────────────────────
const shade = (c, f) => [(c[0] * f) | 0, (c[1] * f) | 0, (c[2] * f) | 0];
const jitter = (c, rnd, amt = 0.07) => shade(c, 1 + (rnd() * 2 - 1) * amt);

// ── Pixel helpers ─────────────────────────────────────────────────
function px(d, x, y, c, a = 255) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= W || y >= W) return;
  const i = (y * W + x) * 4;
  d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = a;
}

function fill(d, c, a = 255) {
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) px(d, x, y, c, a);
}

// Base fill with per-pixel value jitter — never a flat color.
function noisyFill(d, rnd, c, amt = 0.06, a = 255) {
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) px(d, x, y, jitter(c, rnd, amt), a);
}

// Scatter single pixels of the given tones.
function speckle(d, rnd, colors, density, a = 255) {
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    if (rnd() < density) px(d, x, y, colors[(rnd() * colors.length) | 0], a);
  }
}

function hline(d, x0, x1, y, c, a = 255) { for (let x = x0; x <= x1; x++) px(d, x, y, c, a); }
function vline(d, x, y0, y1, c, a = 255) { for (let y = y0; y <= y1; y++) px(d, x, y, c, a); }
function border(d, c, a = 255) {
  hline(d, 0, 15, 0, c, a); hline(d, 0, 15, 15, c, a);
  vline(d, 0, 0, 15, c, a); vline(d, 15, 0, 15, c, a);
}

function line(d, x0, y0, x1, y1, c, a = 255) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    px(d, x0, y0, c, a);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// Roughly-circular nugget/lump with light top-left, dark rim bottom-right.
function blob(d, rnd, cx, cy, rx, ry, main, opts = {}) {
  const light = opts.light || shade(main, 1.2);
  const dark = opts.dark || shade(main, 0.72);
  for (let y = Math.floor(cy - ry) - 1; y <= cy + ry + 1; y++) {
    for (let x = Math.floor(cx - rx) - 1; x <= cx + rx + 1; x++) {
      const nx = (x - cx) / rx, ny = (y - cy) / ry;
      const r = Math.hypot(nx, ny);
      if (r > 1 - (rnd() - 0.5) * 0.16) continue;
      const lit = (nx + ny) / 1.4;
      const c = r > 0.82 || lit > 0.45 ? dark : lit < -0.35 ? light : jitter(main, rnd, 0.06);
      px(d, x, y, c, opts.a ?? 255);
    }
  }
}

// Smooth value noise on a coarse grid, sampled at texel coords (0..15).
function noiseGrid(rnd, n) {
  const g = new Float32Array((n + 1) * (n + 1));
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  return (x, y) => {
    const fx = clamp((x / W) * n, 0, n - 0.001), fy = clamp((y / W) * n, 0, n - 0.001);
    const x0 = fx | 0, y0 = fy | 0;
    const tx = smoothstep(0, 1, fx - x0), ty = smoothstep(0, 1, fy - y0);
    const i = y0 * (n + 1) + x0;
    const a = g[i], b = g[i + 1], c = g[i + n + 1], e = g[i + n + 2];
    const top = a + (b - a) * tx, bot = c + (e - c) * tx;
    return top + (bot - top) * ty;
  };
}

// ── Palette ───────────────────────────────────────────────────────
const STONE = [136, 129, 118];
const SOIL = [121, 92, 60];
const WOOD_D = [92, 66, 42];   // dark tool handle wood
const WOOD_L = [124, 92, 60];
const CRACK = [20, 14, 10];

// ── Family painters ───────────────────────────────────────────────
function paintStony(d, rnd, base = STONE) {
  noisyFill(d, rnd, base, 0.05);
  speckle(d, rnd, [shade(base, 1.12)], 0.12);
  speckle(d, rnd, [shade(base, 0.86)], 0.14);
  for (let i = 0; i < 4; i++) {                       // short dark dashes
    const x = (rnd() * 15) | 0, y = (rnd() * 15) | 0, h = rnd() < 0.5;
    const c = shade(base, 0.72);
    px(d, x, y, c); px(d, x + (h ? 1 : 0), y + (h ? 0 : 1), c);
  }
}

function stony(base) { return (d, rnd) => paintStony(d, rnd, base); }

function orePainter(nugget, core = null) {
  const nl = shade(nugget, 1.22), nd = shade(nugget, 0.72);
  return (d, rnd) => {
    paintStony(d, rnd);
    const n = 4 + ((rnd() * 3) | 0);                  // 4-6 blobby nuggets
    for (let i = 0; i < n; i++) {
      const cx = 2 + rnd() * 11, cy = 2 + rnd() * 11, r = 1.1 + rnd() * 1.2;
      blob(d, rnd, cx, cy, r, r, nugget, { light: nl, dark: nd });
      if (core) { px(d, cx, cy, core); if (rnd() < 0.5) px(d, cx + 1, cy, core); }
    }
  };
}

function leavesPainter(base, light, dark) {
  return (d, rnd) => {
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const v = rnd();
      if (v < 0.2) continue;                          // transparent hole
      const c = v < 0.42 ? jitter(dark, rnd, 0.05)
        : v > 0.84 ? jitter(light, rnd, 0.05)
        : jitter(base, rnd, 0.06);
      px(d, x, y, c);
    }
  };
}

function logPainter(bark) {
  const groove = shade(bark, 0.76), ridge = shade(bark, 1.16);
  return (d, rnd) => {
    for (let x = 0; x < W; x++) {                     // vertical striation
      const t = rnd();
      const col = t < 0.22 ? groove : t > 0.8 ? ridge : bark;
      for (let y = 0; y < W; y++) px(d, x, y, jitter(col, rnd, 0.07));
    }
    if (rnd() < 0.8) {                                // bark knot
      const kx = 3 + ((rnd() * 10) | 0), ky = 3 + ((rnd() * 9) | 0);
      px(d, kx, ky, shade(groove, 0.8)); px(d, kx, ky + 1, groove);
    }
  };
}

function logEndPainter(bark, wood) {
  const ring = shade(wood, 0.8);
  return (d, rnd) => {
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5);
      let c;
      if (r > 7.4) c = jitter(bark, rnd, 0.08);
      else if (r > 6.4) c = jitter(shade(bark, 0.9), rnd, 0.06);
      else c = ((r * 1.35 + rnd() * 0.5) | 0) % 3 === 0 ? ring : jitter(wood, rnd, 0.05);
      px(d, x, y, c);
    }
    px(d, 7, 7, shade(wood, 0.65)); px(d, 8, 8, ring); // pith
  };
}

function crackPainter(stage) {
  return (d, rnd) => {
    const arms = 3 + (stage >> 1);
    const len = 2 + stage * 1.35;
    for (let i = 0; i < arms; i++) {
      let ang = rnd() * Math.PI * 2, x = 7.5, y = 7.5;
      const steps = Math.round(len * (0.7 + rnd() * 0.6));
      for (let s = 0; s < steps; s++) {
        x += Math.cos(ang); y += Math.sin(ang);
        ang += (rnd() - 0.5) * 0.9;
        px(d, x, y, CRACK, 215);
        if (stage >= 5 && rnd() < 0.3) px(d, x + 1, y, CRACK, 150);
        if (stage >= 7 && rnd() < 0.15) {             // branch
          let bx = x, by = y, ba = ang + (rnd() < 0.5 ? -1.2 : 1.2);
          for (let t = 0; t < 2 + stage * 0.4; t++) {
            bx += Math.cos(ba); by += Math.sin(ba);
            px(d, bx, by, CRACK, 175);
          }
        }
      }
    }
    px(d, 7, 7, CRACK, 230); px(d, 8, 8, CRACK, 200);
    if (stage === 9) speckle(d, rnd, [CRACK], 0.08, 160); // shattered
  };
}

// ── Individual block painters ─────────────────────────────────────
function paintSoil(d, rnd) {
  noisyFill(d, rnd, SOIL, 0.07);
  speckle(d, rnd, [shade(SOIL, 0.78)], 0.18);
  speckle(d, rnd, [shade(SOIL, 1.18)], 0.1);
  speckle(d, rnd, [[142, 134, 122]], 0.03);           // tiny stones
}

function paintGrassTop(d, rnd) {
  noisyFill(d, rnd, [95, 143, 62], 0.05);
  speckle(d, rnd, [[112, 160, 74]], 0.16);            // light blades
  speckle(d, rnd, [[72, 118, 60]], 0.16);             // shadow
  speckle(d, rnd, [[84, 136, 94]], 0.09);             // teal accent
}

function paintGrassSide(d, rnd) {
  paintSoil(d, rnd);
  for (let x = 0; x < W; x++) {                       // uneven fringe, 3-5px
    const h = 3 + ((rnd() * 3) | 0);
    for (let y = 0; y < h; y++) {
      const c = y === h - 1 ? [72, 118, 60] : jitter([95, 143, 62], rnd, 0.08);
      px(d, x, y, c);
    }
    if (rnd() < 0.2) px(d, x, h, [78, 122, 62]);      // drip
  }
}

function paintKilnSide(d, rnd) {
  paintStony(d, rnd, [124, 115, 104]);
  const seam = [88, 80, 72];
  hline(d, 0, 15, 5, seam); hline(d, 0, 15, 10, seam);
  for (let x = 2; x < W; x += 5) { vline(d, x, 0, 4, seam); vline(d, x + 2, 11, 15, seam); }
  for (let x = 4; x < W; x += 5) vline(d, x, 6, 9, seam);
  speckle(d, rnd, [[70, 62, 56]], 0.06);              // soot
}

function paintBerrybush(d, rndOwn, ripe) {
  const rnd = mulberry32(normalizeSeed('berrybush')); // shared silhouette
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const r = Math.hypot(x - 7.5, y - 8.5);
    if (r > 6.4 + (rnd() - 0.5) * 1.6 || rnd() < 0.14) continue;
    const v = rnd();
    const c = v < 0.35 ? [54, 88, 50] : v > 0.8 ? [90, 128, 66] : jitter([70, 106, 54], rnd, 0.07);
    px(d, x, y, c);
  }
  px(d, 7, 14, WOOD_D); px(d, 8, 15, WOOD_D);         // stem
  if (ripe) {
    for (let i = 0; i < 7; i++) {
      const bx = 3 + ((rndOwn() * 10) | 0), by = 4 + ((rndOwn() * 9) | 0);
      px(d, bx, by, [170, 62, 94]); px(d, bx + 1, by, [140, 46, 76]);
      px(d, bx, by - 1, [216, 112, 138]);             // highlight
    }
  }
}

function cropPainter(stage) {
  return (d, rnd) => {
    const green = [96, 142, 64], lite = [124, 170, 84], dark = [70, 112, 52];
    const maxH = [2, 5, 9, 12][stage];
    for (const x of [3, 6, 9, 12]) {
      const h = Math.max(2, maxH - ((rnd() * 3) | 0));
      for (let i = 0; i < h; i++) {
        const y = 15 - i;
        px(d, x, y, i === h - 1 ? lite : jitter(green, rnd, 0.1));
        if (stage >= 1 && i > 1 && rnd() < 0.35)      // leaf offshoots
          px(d, x + (rnd() < 0.5 ? -1 : 1), y, dark);
      }
      if (stage === 3 && rnd() < 0.8) {               // tuber crowns at base
        px(d, x + 1, 15, [190, 150, 90]); px(d, x - 1, 15, [166, 124, 74]);
      }
    }
  };
}

// Wheat crop: green when young, ripening to gold with grain heads.
function wheatCropPainter(stage) {
  return (d, rnd) => {
    const young = [110, 150, 74], ripe = [214, 184, 88], grain = [234, 208, 112];
    const golden = stage >= 2;
    const maxH = [3, 6, 10, 13][stage];
    for (const x of [3, 6, 9, 12]) {
      const h = Math.max(2, maxH - ((rnd() * 3) | 0));
      for (let i = 0; i < h; i++) {
        const y = 15 - i, top = i >= h - 2;
        px(d, x, y, golden && top ? jitter(grain, rnd, 0.08) : jitter(golden ? ripe : young, rnd, 0.1));
        if (stage === 3 && top && rnd() < 0.7) px(d, x + (rnd() < 0.5 ? -1 : 1), y, grain);
      }
    }
  };
}

// Carrot crop: leafy green stalks with orange crowns peeking out when ripe.
function carrotCropPainter(stage) {
  return (d, rnd) => {
    const green = [78, 140, 58], lite = [110, 172, 78], carrot = [232, 130, 40];
    const maxH = [3, 6, 9, 11][stage];
    for (const x of [3, 6, 9, 12]) {
      const h = Math.max(2, maxH - ((rnd() * 3) | 0));
      for (let i = 0; i < h; i++) {
        const y = 15 - i;
        px(d, x, y, i === h - 1 ? lite : jitter(green, rnd, 0.12));
        if (i > 1 && rnd() < 0.3) px(d, x + (rnd() < 0.5 ? -1 : 1), y, green);
      }
      if (stage === 3) { px(d, x, 15, carrot); px(d, x, 14, [248, 150, 54]); }
    }
  };
}

// ── Tool sprites ──────────────────────────────────────────────────
// Chunky, outlined, Minecraft-proportioned: a 2px wooden haft running
// lower-left → centre with a dark contour, and a bold metal head with a
// lit top-left edge, a shaded lower-right edge, and a near-black outline.
const WOOD_E = shade(WOOD_D, 0.55);   // handle contour

// 2px diagonal haft with a dark contour down each side.
function drawHaft(d, x0, y0, x1, y1) {
  line(d, x0 - 1, y0, x1 - 1, y1, WOOD_E);
  line(d, x0, y0, x1, y1, WOOD_D);
  line(d, x0 + 1, y0, x1 + 1, y1, WOOD_L);
  line(d, x0 + 2, y0, x1 + 2, y1, WOOD_E);
}

function toolPainter(type, head) {
  const light = shade(head, 1.3), dark = shade(head, 0.62), edge = shade(head, 0.4);
  return (d) => {
    if (type === 'blade') {
      // grip + pommel lower-left
      px(d, 2, 15, WOOD_E);
      line(d, 3, 15, 5, 12, WOOD_E); line(d, 4, 15, 6, 12, WOOD_D); line(d, 5, 15, 7, 12, WOOD_L);
      // crossguard across the diagonal
      line(d, 4, 10, 7, 13, dark); line(d, 5, 9, 8, 12, head); px(d, 4, 9, light);
      // 3px blade from guard up to the top-right point
      for (let i = 0; i < 8; i++) {
        const x = 6 + i, y = 11 - i;
        px(d, x - 1, y + 1, edge);      // shaded back edge
        px(d, x, y, head);
        px(d, x + 1, y - 1, light);     // lit fore edge
      }
      px(d, 14, 3, light); px(d, 15, 2, edge); px(d, 13, 4, head);   // point
      return;
    }
    drawHaft(d, 4, 14, 9, 8);
    if (type === 'pick') {
      // broad curved head spanning the top, tapering to two down-tips
      const arc = [[2, 8], [3, 7], [3, 6], [4, 5], [5, 4], [6, 4], [7, 3], [8, 3],
                   [9, 3], [10, 4], [11, 4], [12, 5], [13, 6], [13, 7], [14, 8]];
      for (const [x, y] of arc) {
        px(d, x, y - 1, light);         // lit crown
        px(d, x, y, head);
        px(d, x, y + 1, edge);          // outline underside
      }
      px(d, 2, 9, edge); px(d, 14, 9, edge);            // pointed tips
      px(d, 7, 2, light); px(d, 8, 2, light);
    } else if (type === 'axe') {
      // chunky wedge blade hugging the top of the haft
      for (let y = 2; y <= 9; y++) {
        const w = y <= 5 ? 1 + (y - 2) * 2 : Math.max(0, 1 + (9 - y) * 2);
        const xa = 7, xb = 7 + w;
        px(d, xa - 1, y, edge);
        for (let x = xa; x <= xb; x++) px(d, x, y, x === xa ? light : x >= xb - 1 ? dark : head);
        px(d, xb + 1, y, edge);
      }
      px(d, 12, 4, light); px(d, 12, 5, light);         // sheen
    } else if (type === 'shovel') {
      // rounded spade blade on top
      for (let y = 1; y <= 7; y++) for (let x = 7; x <= 13; x++) {
        const r = Math.hypot((x - 10) / 3.2, (y - 4) / 3.6);
        if (r > 1.02) continue;
        px(d, x, y, r > 0.82 ? edge : (x - 10) + (y - 4) < -1.5 ? light : head);
      }
      px(d, 9, 2, light); px(d, 10, 2, light);          // top sheen
    } else if (type === 'hoe') {
      // horizontal top bar with a short downward flange (L-shape)
      for (let x = 8; x <= 13; x++) { px(d, x, 2, light); px(d, x, 3, head); px(d, x, 4, edge); }
      px(d, 8, 5, head); px(d, 8, 6, dark); px(d, 7, 6, edge);   // flange
      px(d, 7, 2, edge); px(d, 14, 2, edge); px(d, 14, 3, edge); // contour
    }
  };
}

// ── Item sprites ──────────────────────────────────────────────────
function ingotPainter(c) {
  const light = shade(c, 1.28), dark = shade(c, 0.68);
  return (d, rnd) => {
    hline(d, 5, 11, 6, light);
    for (let y = 7; y <= 9; y++) hline(d, 4, 12, y, c);
    hline(d, 5, 12, 10, dark);
    px(d, 4, 7, light); px(d, 12, 7, dark); px(d, 12, 9, dark);
    px(d, 6, 7, light); px(d, 7, 7, light);           // sheen
    for (let i = 0; i < 6; i++) px(d, 5 + rnd() * 7, 8 + rnd() * 2, jitter(c, rnd, 0.1));
  };
}

function chunkPainter(fleck) {
  return (d, rnd) => {
    blob(d, rnd, 7.5, 8.5, 4.2, 3.8, [120, 114, 106]);
    for (let i = 0; i < 5; i++) {
      const x = 5 + rnd() * 6, y = 6 + rnd() * 5;
      px(d, x, y, fleck); if (rnd() < 0.5) px(d, x + 1, y, shade(fleck, 0.8));
    }
  };
}

function fishPainter(body, belly) {
  const dark = shade(body, 0.68);
  return (d, rnd) => {
    for (let y = 6; y <= 11; y++) for (let x = 3; x <= 11; x++) {
      if (Math.hypot((x - 6.5) / 4, (y - 8.5) / 2.6) > 1) continue;
      px(d, x, y, y > 9 ? belly : jitter(body, rnd, 0.06));
    }
    px(d, 11, 8, body); px(d, 12, 6, dark); px(d, 13, 8, dark); px(d, 12, 10, dark);   // tail fan
    px(d, 7, 5, dark); px(d, 6, 5, dark);                                               // dorsal fin
    px(d, 4, 8, [238, 238, 240]); px(d, 5, 8, [28, 28, 32]);                            // eye
  };
}

function haunchPainter(main, marble, boneShade) {
  const dark = shade(main, 0.72), light = shade(main, 1.22);
  const bone = shade([232, 228, 214], boneShade);
  return (d, rnd) => {
    blob(d, rnd, 9, 9.5, 4.4, 4.0, main, { light, dark });
    line(d, 7, 8, 10, 11, marble);                    // marbling streak
    line(d, 4, 5, 6, 7, bone); line(d, 5, 5, 7, 7, bone);
    px(d, 3, 4, bone); px(d, 4, 3, bone);             // knuckle
  };
}

// ── Painter registry ──────────────────────────────────────────────
const P = {
  // Stone family
  corestone: (d, rnd) => {
    noisyFill(d, rnd, [54, 50, 54], 0.06);
    speckle(d, rnd, [[72, 68, 74], [64, 54, 68]], 0.16);
    speckle(d, rnd, [[38, 36, 40]], 0.2);
    speckle(d, rnd, [[98, 92, 88]], 0.04);            // jagged flecks
  },
  stone: (d, rnd) => paintStony(d, rnd),
  basalt: (d, rnd) => {
    noisyFill(d, rnd, [70, 68, 74], 0.05);
    for (let x = 0; x < W; x += 3) vline(d, x, 0, 15, [58, 56, 62]); // columns
    speckle(d, rnd, [[86, 84, 90]], 0.1);
    speckle(d, rnd, [[52, 50, 56]], 0.1);
  },
  duststone: (d, rnd) => {
    noisyFill(d, rnd, [186, 164, 118], 0.05);
    for (let y = 3; y < W; y += 4) hline(d, 0, 15, y, [164, 142, 98]); // strata
    speckle(d, rnd, [[200, 180, 132], [170, 148, 104]], 0.14);
  },
  duststone_top: (d, rnd) => {
    noisyFill(d, rnd, [192, 170, 124], 0.05);
    speckle(d, rnd, [[206, 186, 138], [172, 150, 106]], 0.2);
  },
  rubble: (d, rnd) => {
    noisyFill(d, rnd, [96, 90, 82], 0.06);            // mortar gaps
    for (const [cx, cy] of [[3, 3], [11, 3.5], [4, 11], [11.5, 11.5], [7.5, 7.5]]) {
      blob(d, rnd, cx + rnd(), cy + rnd(), 2.4 + rnd(), 2.2 + rnd(), shade(STONE, 0.82 + rnd() * 0.36));
    }
  },
  mossrock: (d, rnd) => {
    paintStony(d, rnd);
    for (let i = 0; i < 4; i++) {
      blob(d, rnd, 2 + rnd() * 12, 2 + rnd() * 12, 1.6 + rnd() * 1.4, 1.4 + rnd(),
        [92, 132, 90], { light: [112, 152, 102], dark: [72, 108, 76] });
    }
  },
  hewnstone: (d, rnd) => {
    paintStony(d, rnd, [142, 135, 124]);
    const seam = [94, 88, 80], bevel = [162, 154, 142];
    hline(d, 0, 15, 7, seam); hline(d, 0, 15, 15, seam);
    vline(d, 7, 0, 7, seam); vline(d, 3, 8, 15, seam); vline(d, 11, 8, 15, seam);
    hline(d, 0, 15, 0, bevel); hline(d, 0, 15, 8, bevel);
  },

  // Soft ground
  soil: paintSoil,
  grass_top: paintGrassTop,
  grass_side: paintGrassSide,
  mud: (d, rnd) => {
    noisyFill(d, rnd, [90, 68, 48], 0.06);
    speckle(d, rnd, [[70, 52, 36]], 0.22);
    speckle(d, rnd, [[122, 96, 66]], 0.07);           // wet gloss
  },
  sand: (d, rnd) => {
    noisyFill(d, rnd, [204, 183, 138], 0.04);
    speckle(d, rnd, [[218, 198, 152], [184, 162, 116]], 0.22);
    speckle(d, rnd, [[164, 142, 100]], 0.03);         // pits
  },
  gravel: (d, rnd) => {
    noisyFill(d, rnd, [112, 108, 100], 0.06);
    for (let i = 0; i < 14; i++) {
      blob(d, rnd, 1 + rnd() * 14, 1 + rnd() * 14, 1 + rnd(), 0.9 + rnd(),
        shade([134, 130, 122], 0.8 + rnd() * 0.4));
    }
  },
  clay: (d, rnd) => {
    noisyFill(d, rnd, [148, 146, 152], 0.04);
    speckle(d, rnd, [[162, 160, 166], [132, 130, 138]], 0.2);
    for (let i = 0; i < 3; i++) {                     // damp smears
      const y = 2 + ((rnd() * 12) | 0), x = (rnd() * 10) | 0;
      hline(d, x, x + 3 + ((rnd() * 3) | 0), y, [136, 134, 142]);
    }
  },
  snow: (d, rnd) => {
    noisyFill(d, rnd, [235, 239, 244], 0.02);
    speckle(d, rnd, [[220, 228, 238]], 0.16);
    speckle(d, rnd, [[255, 255, 255]], 0.05);         // sparkle
  },
  ice: (d, rnd) => {
    noisyFill(d, rnd, [168, 205, 235], 0.03, 208);
    speckle(d, rnd, [[190, 220, 244]], 0.12, 208);
    line(d, 3, 12, 9, 4, [216, 236, 250], 208);       // internal cracks
    line(d, 10, 13, 13, 8, [216, 236, 250], 208);
    px(d, 4, 4, [232, 244, 252], 220); px(d, 12, 3, [232, 244, 252], 220);
  },
  farmland: (d, rnd) => {
    noisyFill(d, rnd, [104, 78, 52], 0.07);
    speckle(d, rnd, [[84, 62, 42]], 0.18);
    for (let y = 1; y < W; y += 4) {                  // furrows
      for (let x = 0; x < W; x++) px(d, x, y, jitter([68, 50, 34], rnd, 0.08));
    }
    speckle(d, rnd, [[126, 98, 64]], 0.06);
  },

  // Wood
  alder_log: logPainter([112, 86, 58]),
  alder_log_end: logEndPainter([112, 86, 58], [176, 146, 100]),
  fern_log: logPainter([94, 86, 68]),
  fern_log_end: logEndPainter([94, 86, 68], [150, 138, 108]),
  alder_leaves: leavesPainter([84, 122, 58], [106, 146, 72], [62, 96, 50]),
  fern_leaves: leavesPainter([56, 110, 90], [76, 132, 106], [42, 86, 72]),
  planks: (d, rnd) => {
    const base = [168, 133, 84], seam = [108, 82, 52];
    const tones = [1, 0.93, 1.06, 0.97];
    for (let y = 0; y < W; y++) {
      const b = y >> 2;
      for (let x = 0; x < W; x++) {
        if ((y & 3) === 3) { px(d, x, y, jitter(seam, rnd, 0.06)); continue; }
        px(d, x, y, rnd() < 0.08 ? shade(base, 0.84) : jitter(shade(base, tones[b]), rnd, 0.05));
      }
    }
    for (let b = 0; b < 4; b++) {                     // board ends + nails
      const ex = (2 + b * 4 + ((rnd() * 4) | 0)) % 16;
      vline(d, ex, b * 4, b * 4 + 2, seam);
      px(d, (ex + 2) % 16, b * 4 + 1, [96, 96, 102]);
      px(d, (ex + 13) % 16, b * 4 + 1, [96, 96, 102]);
    }
  },

  // Fluids & glass
  water: (d, rnd) => {
    const n = noiseGrid(rnd, 4);
    const base = [40, 90, 160], lite = [58, 114, 186], dark = [32, 74, 138];
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const w = Math.sin((y + n(x, y) * 4) * (Math.PI / 4));
      const c = w > 0.55 ? lite : w < -0.6 ? dark : jitter(base, rnd, 0.03);
      px(d, x, y, c, 158);
    }
  },
  lava: (d, rnd) => {
    const n = noiseGrid(rnd, 5);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const v = n(x, y) * 0.75 + 0.25 * Math.sin((x + y * 0.6 + n(y, x) * 5) * 0.8) * 0.5 + 0.125;
      const c = v < 0.3 ? [148, 44, 12] : v < 0.55 ? [216, 88, 20]
        : v < 0.8 ? [244, 140, 36] : [255, 214, 92];
      px(d, x, y, jitter(c, rnd, 0.04), 255);
    }
    speckle(d, rnd, [[255, 232, 130]], 0.04);         // near-yellow sparks
  },
  glass: (d, rnd) => {
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++)
      px(d, x, y, jitter([205, 228, 232], rnd, 0.03), 46);
    for (let i = 0; i < W; i++) {                     // diagonal shine
      const x = 11 - i, y = i;
      px(d, x, y, [255, 255, 255], 120); px(d, x + 1, y, [255, 255, 255], 90);
    }
    border(d, [238, 246, 248], 255);                  // rim
  },

  // Crafted / building
  brick: (d, rnd) => {
    const mortar = [178, 168, 156];
    for (let y = 0; y < W; y++) {
      const row = y >> 2, off = (row & 1) * 4;
      for (let x = 0; x < W; x++) {
        if ((y & 3) === 0 || (x + off) % 8 === 0) { px(d, x, y, jitter(mortar, rnd, 0.04)); continue; }
        const cell = ((x + off) >> 3) + row * 2;
        px(d, x, y, jitter(shade([154, 86, 64], 0.92 + (cell % 3) * 0.06), rnd, 0.05));
      }
    }
    speckle(d, rnd, [[132, 70, 52]], 0.06);
  },
  copper_block: (d, rnd) => {
    noisyFill(d, rnd, [190, 118, 72], 0.05);
    line(d, 2, 13, 13, 2, [212, 140, 88]);            // sheen
    line(d, 5, 14, 14, 5, [206, 134, 84]);
    border(d, [150, 90, 54]);
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) px(d, x, y, [136, 80, 48]);
  },
  iron_block: (d, rnd) => {
    noisyFill(d, rnd, [206, 212, 218], 0.03);
    hline(d, 1, 14, 3, [228, 233, 238]); hline(d, 1, 14, 4, [222, 228, 234]);
    border(d, [168, 176, 184]);
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) px(d, x, y, [140, 148, 156]);
  },
  sunstone_block: (d, rnd) => {
    noisyFill(d, rnd, [244, 196, 110], 0.05);
    speckle(d, rnd, [[255, 240, 180]], 0.12);         // bright grains
    speckle(d, rnd, [[214, 150, 66]], 0.14);
    blob(d, rnd, 7.5, 7.5, 2.6, 2.6, [255, 224, 148], { light: [255, 246, 196], dark: [244, 196, 110] });
    border(d, [196, 134, 60]);
  },
  glowmoss: (d, rnd) => {
    const n = noiseGrid(rnd, 4);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const v = n(x, y);
      const c = v > 0.72 ? [198, 244, 168] : v > 0.55 ? [136, 208, 140]
        : v > 0.38 ? [74, 140, 96] : [42, 86, 62];
      px(d, x, y, jitter(c, rnd, 0.05));
    }
  },
  lantern: (d, rnd) => {
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - 7.5, y - 8);
      const c = r < 3 ? [255, 238, 176] : r < 6 ? [255, 219, 138] : [244, 196, 108];
      px(d, x, y, jitter(c, rnd, 0.04));
    }
    border(d, [58, 52, 46]);
    for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]]) {   // braces
      px(d, x, y, [58, 52, 46]); px(d, x, y === 1 ? 2 : 13, [74, 66, 58]);
    }
    px(d, 7, 0, [40, 36, 32]); px(d, 8, 0, [40, 36, 32]);          // hanger
  },
  worktable_top: (d, rnd) => {
    noisyFill(d, rnd, [178, 142, 92], 0.05);
    speckle(d, rnd, [[192, 156, 104], [160, 126, 80]], 0.16);
    border(d, [110, 82, 52]);
    for (let i = 4; i <= 11; i++) { px(d, i, 4, [126, 96, 62]); px(d, i, 11, [126, 96, 62]); }
    vline(d, 4, 5, 10, [126, 96, 62]); vline(d, 11, 5, 10, [126, 96, 62]);
    px(d, 2, 2, [112, 112, 118]); px(d, 13, 2, [112, 112, 118]);   // vise pins
  },
  worktable_side: (d, rnd) => {
    P.planks(d, rnd);
    hline(d, 0, 15, 0, [110, 82, 52]); hline(d, 0, 15, 1, [128, 98, 62]);
    for (let i = 6; i <= 10; i++) px(d, i, 8, [96, 72, 46]);       // drawer slot
    px(d, 8, 9, [88, 88, 94]);                                     // knob
  },
  kiln_top: (d, rnd) => {
    paintStony(d, rnd, [118, 110, 100]);
    for (let y = 5; y <= 10; y++) hline(d, 5, 10, y, [52, 46, 42]);
    for (let y = 6; y <= 9; y++) hline(d, 6, 9, y, [38, 32, 28]);
    px(d, 7, 8, [222, 120, 40]); px(d, 8, 9, [180, 84, 28]);       // embers below
  },
  kiln_side: paintKilnSide,
  kiln_front: (d, rnd) => {
    paintKilnSide(d, rnd);
    for (let y = 8; y <= 15; y++) {                   // arched firebox
      const w = y === 8 ? 2 : 3;
      hline(d, 7 - w, 8 + w, y, [36, 30, 26]);
    }
    hline(d, 5, 10, 7, [148, 82, 40]);                // heat-stained lintel
    for (const [x, y, c] of [[6, 14, [244, 140, 36]], [8, 15, [255, 214, 92]],
                             [9, 14, [216, 88, 20]], [7, 13, [190, 70, 20]]]) px(d, x, y, c);
  },

  // Ores
  coal_ore: orePainter([40, 38, 36]),
  copper_ore: orePainter([196, 122, 74]),
  iron_ore: orePainter([202, 169, 140]),
  sunstone_ore: orePainter([255, 210, 122], [255, 244, 190]),

  // Plants (cross quads — transparent background)
  tallgrass: (d, rnd) => {
    const tones = [[92, 138, 70], [110, 158, 80], [78, 128, 86]];
    for (let i = 0; i < 7; i++) {
      let x = 1 + ((rnd() * 14) | 0);
      const h = 5 + ((rnd() * 7) | 0);
      for (let j = 0; j < h; j++) {
        const y = 15 - j;
        px(d, x, y, j === h - 1 ? [128, 170, 96] : jitter(tones[i % 3], rnd, 0.08));
        if (j === ((h / 2) | 0) && rnd() < 0.6) x += rnd() < 0.5 ? -1 : 1; // lean
      }
    }
  },
  emberbloom: (d, rnd) => {
    vline(d, 7, 8, 15, [76, 112, 58]);
    px(d, 6, 12, [88, 126, 64]); px(d, 8, 10, [88, 126, 64]);      // leaves
    for (const [x, y] of [[7, 3], [8, 3], [6, 4], [9, 4], [6, 5], [9, 5], [7, 6], [8, 6]])
      px(d, x, y, jitter([206, 84, 32], rnd, 0.08));               // petal ring
    px(d, 7, 4, [240, 140, 52]); px(d, 8, 4, [240, 140, 52]);
    px(d, 7, 5, [240, 140, 52]); px(d, 8, 5, [255, 214, 110]);     // hot core
  },
  azurebell: (d, rnd) => {
    line(d, 8, 15, 7, 10, [76, 112, 58]); line(d, 7, 10, 7, 6, [76, 112, 58]);
    px(d, 8, 12, [88, 126, 64]);
    for (const [x, y] of [[4, 8], [9, 9], [6, 4]]) {               // hanging bells
      px(d, x, y, [140, 162, 220]); px(d, x + 1, y, [116, 140, 208]);
      px(d, x, y + 1, [116, 140, 208]); px(d, x + 1, y + 1, [86, 106, 176]);
      px(d, x, y + 2, [86, 106, 176]); px(d, x + 1, y + 2, [70, 88, 156]);
      px(d, x, y + 3, [226, 232, 246]);                            // clapper
      px(d, x + 1, y - 1, [76, 112, 58]);                          // stemlet
    }
  },
  deadbush: (d, rnd) => {
    const c = [148, 116, 72];
    vline(d, 8, 11, 15, shade(c, 0.85));
    line(d, 8, 12, 4, 8, c); line(d, 8, 11, 12, 7, c);
    line(d, 8, 13, 5, 12, shade(c, 0.9)); line(d, 8, 12, 11, 11, shade(c, 1.1));
    line(d, 4, 8, 3, 6, shade(c, 1.1)); line(d, 12, 7, 13, 5, shade(c, 0.8));
    speckle(d, rnd, [[116, 88, 52]], 0.015);
  },
  spineplant: (d, rnd) => {
    for (let x = 0; x < W; x++) {
      const rib = x % 3 === 1, edge = x === 0 || x === 15;
      const c = edge ? [64, 100, 60] : rib ? [72, 112, 66] : [94, 138, 86];
      for (let y = 0; y < W; y++) px(d, x, y, jitter(c, rnd, 0.06));
    }
    for (let y = 1; y < W; y += 4)                    // pale spines on ribs
      for (let x = 1; x < W; x += 3) px(d, x, y + ((x / 3) | 0) % 2, [218, 226, 198]);
  },
  spineplant_top: (d, rnd) => {
    noisyFill(d, rnd, [94, 138, 86], 0.06);
    border(d, [64, 100, 60]);
    line(d, 1, 1, 14, 14, [76, 116, 70]); line(d, 14, 1, 1, 14, [76, 116, 70]); // radial ribs
    hline(d, 1, 14, 7, [80, 122, 74]); vline(d, 7, 1, 14, [80, 122, 74]);
    px(d, 7, 7, [116, 156, 96]); px(d, 8, 8, [116, 156, 96]);
    for (const [x, y] of [[4, 4], [11, 4], [4, 11], [11, 11]]) px(d, x, y, [218, 226, 198]);
  },
  berrybush: (d, rnd) => paintBerrybush(d, rnd, false),
  berrybush_ripe: (d, rnd) => paintBerrybush(d, rnd, true),
  vine: (d, rnd) => {
    const tones = [[92, 140, 84], [74, 118, 72], [84, 130, 90]];
    for (let s = 0; s < 3; s++) {
      let x = 2 + s * 5 + ((rnd() * 2) | 0);
      for (let y = 0; y < W; y++) {
        px(d, x, y, jitter(tones[s], rnd, 0.09));
        if (rnd() < 0.28) px(d, x + (rnd() < 0.5 ? -1 : 1), y, [62, 102, 64]); // leaflet
        if (rnd() < 0.35) x = clamp(x + (rnd() < 0.5 ? -1 : 1), 0, 15);
      }
    }
  },
  alder_sprout: (d, rnd) => {
    vline(d, 7, 11, 15, [110, 84, 58]);
    for (let y = 5; y <= 12; y++) for (let x = 3; x <= 11; x++) {
      if (Math.hypot(x - 7, y - 8.5) > 3.6 + (rnd() - 0.5) || rnd() < 0.15) continue;
      const v = rnd();
      px(d, x, y, v < 0.3 ? [62, 96, 50] : v > 0.8 ? [106, 146, 72] : jitter([84, 122, 58], rnd, 0.07));
    }
  },
  fern_sprout: (d, rnd) => {
    const c = [66, 120, 98];
    line(d, 7, 15, 3, 9, c); line(d, 8, 15, 8, 6, shade(c, 1.1)); line(d, 8, 15, 12, 9, c);
    px(d, 3, 8, [90, 148, 122]); px(d, 8, 5, [90, 148, 122]); px(d, 12, 8, [90, 148, 122]);
    px(d, 4, 10, shade(c, 0.85)); px(d, 11, 10, shade(c, 0.85));
    px(d, 7, 15, [80, 62, 44]); px(d, 8, 15, [80, 62, 44]);        // rootstock
  },
  crop_0: cropPainter(0), crop_1: cropPainter(1),
  crop_2: cropPainter(2), crop_3: cropPainter(3),
  wheat_0: wheatCropPainter(0), wheat_1: wheatCropPainter(1),
  wheat_2: wheatCropPainter(2), wheat_3: wheatCropPainter(3),
  carrot_0: carrotCropPainter(0), carrot_1: carrotCropPainter(1),
  carrot_2: carrotCropPainter(2), carrot_3: carrotCropPainter(3),
  carrot: (d, rnd) => {
    for (let i = 0; i < 9; i++) { const x = 11 - i, y = 4 + i; px(d, x, y, jitter([232, 130, 40], rnd, 0.08)); px(d, x - 1, y, [200, 104, 30]); }
    px(d, 3, 13, [180, 92, 26]);
    for (const [lx, ly] of [[11, 3], [12, 2], [10, 2], [13, 3]]) px(d, lx, ly, [86, 150, 60]);
    px(d, 11, 4, [110, 170, 78]);
  },
  wheat_seeds: (d, rnd) => {
    for (const [x, y] of [[5, 7], [9, 6], [7, 10], [6, 12], [10, 10]]) {
      px(d, x, y, [196, 178, 110]); px(d, x + 1, y + 1, [164, 146, 86]); px(d, x, y + 1, [210, 192, 124]);
    }
  },
  wheat: (d, rnd) => {
    for (const bx of [4, 8, 12]) {
      for (let y = 13; y >= 5; y--) px(d, bx, y, jitter([214, 184, 88], rnd, 0.08));
      for (let y = 3; y <= 7; y++) { px(d, bx - 1, y, [234, 208, 112]); px(d, bx + 1, y, [206, 178, 88]); }
      px(d, bx, 3, [240, 216, 120]);
    }
  },
  bread: (d, rnd) => {
    blob(d, rnd, 8, 8.5, 5, 3.2, [176, 120, 60], { light: [212, 158, 92], dark: [132, 86, 44] });
    for (let i = 0; i < 4; i++) line(d, 4 + i * 2, 6, 5 + i * 2, 11, [140, 92, 50]);
    speckle(d, rnd, [[198, 150, 88]], 0.06);
  },

  // Weather
  rain: (d) => {
    for (let y = 3; y <= 12; y++) {
      px(d, 7, y, [172, 200, 235], 150);
      px(d, 8, y, [172, 200, 235], 105);
    }
  },
  snowflake: (d) => {
    const c = [245, 248, 252];
    px(d, 7, 7, c, 230);
    px(d, 6, 7, c, 230); px(d, 8, 7, c, 230);
    px(d, 7, 6, c, 230); px(d, 7, 8, c, 230);
  },

  // Materials
  rod: (d) => {
    line(d, 4, 13, 11, 6, WOOD_L); line(d, 5, 13, 12, 6, WOOD_D);
    px(d, 3, 14, shade(WOOD_D, 0.85)); px(d, 12, 5, shade(WOOD_L, 1.1));
  },
  coal: (d, rnd) => {
    blob(d, rnd, 8, 8.5, 3.8, 3.4, [42, 40, 38], { light: [70, 68, 66], dark: [24, 22, 22] });
    px(d, 6, 6, [82, 80, 78]); px(d, 9, 8, [64, 62, 60]);
  },
  clay_lump: (d, rnd) => {
    blob(d, rnd, 7, 9, 3.6, 3, [150, 148, 156]);
    blob(d, rnd, 10, 7, 2.4, 2.2, [160, 158, 166]);
  },
  copper_ore_chunk: chunkPainter([196, 122, 74]),
  iron_ore_chunk: chunkPainter([202, 169, 140]),
  copper_ingot: ingotPainter([196, 122, 74]),
  iron_ingot: ingotPainter([216, 221, 226]),
  sunstone: (d, rnd) => {
    for (let y = 5; y <= 11; y++) for (let x = 5; x <= 11; x++) {
      const m = Math.abs(x - 8) + Math.abs(y - 8);
      if (m > 3) continue;                             // faceted diamond
      px(d, x, y, m === 3 ? [214, 150, 66] : jitter([255, 210, 122], rnd, 0.05));
    }
    px(d, 8, 8, [255, 244, 190]); px(d, 7, 8, [255, 244, 190]);
    for (const [x, y] of [[4, 4], [12, 5], [11, 12], [3, 11]]) px(d, x, y, [255, 236, 170], 150);
  },
  hide: (d, rnd) => {
    blob(d, rnd, 8, 8.5, 5, 4.6, [176, 140, 96], { light: [196, 160, 112], dark: [140, 106, 70] });
    speckle(d, rnd, [[190, 154, 106]], 0.05);
    px(d, 6, 4, [104, 78, 52]); px(d, 10, 4, [104, 78, 52]);       // lace holes
  },
  glimmer_dust: (d, rnd) => {
    for (let i = 0; i < 6; i++) {
      const x = 2 + ((rnd() * 12) | 0), y = 2 + ((rnd() * 12) | 0);
      px(d, x, y, [255, 240, 170], 235);
      px(d, x - 1, y, [220, 200, 140], 150); px(d, x + 1, y, [220, 200, 140], 150);
      px(d, x, y - 1, [220, 200, 140], 150); px(d, x, y + 1, [220, 200, 140], 150);
    }
    for (let i = 0; i < 5; i++) px(d, 1 + rnd() * 14, 1 + rnd() * 14, [236, 220, 156], 120);
  },
  tuber_seed: (d, rnd) => {
    for (const [x, y] of [[5, 7], [9, 6], [7, 10]]) {
      px(d, x, y, [190, 158, 104]); px(d, x + 1, y, [190, 158, 104]);
      px(d, x, y + 1, [164, 130, 80]); px(d, x + 1, y + 1, [140, 112, 66]);
      px(d, x + 1, y - 1, jitter([206, 176, 120], rnd, 0.05));
    }
  },
  berries: (d, rnd) => {
    px(d, 8, 3, [76, 112, 58]); px(d, 8, 4, [76, 112, 58]);        // stem
    px(d, 7, 4, [88, 126, 64]); px(d, 9, 5, [88, 126, 64]);        // leaves
    for (const [x, y] of [[6, 8], [9, 7], [8, 10], [6, 11]]) {
      blob(d, rnd, x, y, 1.5, 1.5, [150, 54, 84], { light: [214, 110, 134], dark: [104, 36, 58] });
    }
  },
  tuber: (d, rnd) => {
    blob(d, rnd, 8, 8.5, 4.4, 3.2, [166, 124, 74], { light: [190, 148, 92], dark: [128, 94, 56] });
    for (const [x, y] of [[6, 8], [10, 7], [8, 10]]) px(d, x, y, [118, 86, 48]); // eyes
  },
  tuber_roast: (d, rnd) => {
    blob(d, rnd, 8, 8.5, 4.4, 3.2, [210, 152, 70], { light: [235, 190, 110], dark: [160, 108, 48] });
    line(d, 6, 7, 9, 7, [110, 70, 34]); line(d, 7, 10, 10, 10, [110, 70, 34]); // char lines
  },
  meat_raw: haunchPainter([198, 86, 74], [226, 130, 110], 1),
  meat_roast: haunchPainter([150, 88, 44], [190, 130, 70], 0.9),
  raw_beef: haunchPainter([176, 66, 62], [214, 108, 98], 1),
  cooked_beef: haunchPainter([120, 74, 44], [168, 112, 66], 0.9),
  raw_chicken: haunchPainter([228, 190, 166], [246, 220, 200], 1),
  cooked_chicken: haunchPainter([206, 150, 92], [232, 186, 122], 0.9),
  raw_mutton: haunchPainter([196, 92, 96], [224, 132, 132], 1),
  cooked_mutton: haunchPainter([148, 92, 64], [190, 130, 88], 0.9),
  raw_cod: fishPainter([150, 140, 120], [206, 200, 184]),
  cooked_cod: fishPainter([196, 150, 92], [224, 192, 140]),
  raw_salmon: fishPainter([202, 96, 78], [230, 150, 128]),
  cooked_salmon: fishPainter([196, 118, 74], [222, 160, 116]),
  fishing_rod: (d, rnd) => {
    const wood = [122, 86, 50], woodD = [92, 64, 38];
    line(d, 2, 14, 11, 3, wood); line(d, 3, 14, 12, 3, woodD);          // rod
    line(d, 12, 3, 13, 11, [222, 222, 228]);                           // line
    px(d, 13, 12, [206, 62, 60]); px(d, 13, 13, [240, 240, 240]);       // bobber
  },
  slimeball: (d, rnd) => {
    blob(d, rnd, 8, 8.5, 4.2, 3.8, [116, 190, 96], { light: [168, 224, 150], dark: [78, 146, 66], a: 235 });
    px(d, 6, 6, [206, 240, 196], 220); px(d, 7, 6, [190, 230, 180], 200);   // sheen
    speckle(d, rnd, [[92, 168, 80]], 0.06, 210);
  },
  ender_pearl: (d, rnd) => {
    blob(d, rnd, 8, 8.5, 4, 3.8, [26, 74, 70], { light: [64, 150, 138], dark: [14, 44, 44] });
    for (let i = 0; i < 7; i++) px(d, 5 + ((rnd() * 6) | 0), 6 + ((rnd() * 6) | 0), [120, 220, 200], 210);  // inner swirl
    px(d, 6, 6, [190, 245, 232], 230); px(d, 10, 10, [40, 110, 100]);
  },
  spider_eye: (d, rnd) => {
    blob(d, rnd, 8, 8.5, 3.8, 3.6, [150, 44, 42], { light: [196, 78, 74], dark: [96, 26, 26] });
    px(d, 7, 7, [246, 210, 120]); px(d, 8, 7, [255, 236, 150]);   // amber pupil
    px(d, 7, 8, [220, 60, 56]);
  },
  milk_bucket: (d, rnd) => {
    // pail body
    for (let y = 6; y <= 13; y++) for (let x = 4; x <= 11; x++) {
      const taper = y >= 12 ? (y - 11) : 0;
      if (x < 4 + taper || x > 11 - taper) continue;
      px(d, x, y, jitter(x <= 4 || x >= 11 ? [120, 124, 132] : [160, 164, 172], rnd, 0.05));
    }
    hline(d, 4, 11, 6, [210, 214, 220]);                    // rim
    for (let y = 7; y <= 9; y++) hline(d, 5, 10, y, jitter([244, 244, 240], rnd, 0.03));  // milk
    line(d, 4, 6, 8, 3, [150, 154, 162]); line(d, 11, 6, 8, 3, [150, 154, 162]);          // handle
  },
  feather: (d, rnd) => {
    const shaft = [206, 210, 220], vane = [244, 247, 252], vane2 = [216, 222, 232];
    for (let i = 0; i <= 10; i++) {                    // central quill, top-right → bottom-left
      const x = 12 - Math.round(i * 0.7), y = 3 + i;
      px(d, x, y, shaft);
      if (i > 0 && i < 9) {                            // barbs to either side
        px(d, x - 1, y, vane); px(d, x - 2, y + 1, vane2, 210);
        px(d, x + 1, y - 1, i < 8 ? vane : vane2);
      }
    }
    px(d, 12, 2, [188, 194, 204]);                     // quill tip
  },
  wool: (d, rnd) => {
    for (let y = 2; y <= 13; y++) for (let x = 2; x <= 13; x++) {
      if ((x <= 3 || x >= 12) && (y <= 3 || y >= 12)) continue;   // round the corners
      px(d, x, y, jitter([236, 238, 240], rnd, 0.05));
    }
    speckle(d, rnd, [[212, 214, 218]], 0.16);
    speckle(d, rnd, [[251, 251, 253]], 0.14);
  },
  gunpowder: (d, rnd) => {
    blob(d, rnd, 8, 10.5, 5, 2.6, [42, 42, 46], { light: [72, 72, 76], dark: [26, 26, 28] });
    for (let i = 0; i < 22; i++) {                     // scattered grains
      px(d, 3 + ((rnd() * 10) | 0), 5 + ((rnd() * 8) | 0), jitter([54, 54, 58], rnd, 0.2));
    }
    px(d, 6, 9, [96, 96, 100]); px(d, 10, 11, [80, 80, 84]);
  },
  bone: (d, rnd) => {
    const c = [238, 236, 226], c2 = [206, 202, 190], hi = [252, 250, 244];
    line(d, 5, 11, 11, 5, c); line(d, 6, 11, 12, 5, hi); line(d, 5, 12, 11, 6, c2);
    for (const [kx, ky] of [[4, 12], [12, 4]]) {       // knobbed ends
      px(d, kx, ky, c); px(d, kx + 1, ky, c); px(d, kx, ky + 1, c);
      px(d, kx - 1, ky - 1, c2); px(d, kx + 1, ky + 1, c2);
    }
  },
  bone_meal: (d, rnd) => {
    blob(d, rnd, 8, 10, 5, 2.8, [232, 232, 224], { light: [251, 251, 246], dark: [200, 200, 190] });
    speckle(d, rnd, [[248, 248, 242]], 0.2);
    for (let i = 0; i < 8; i++) px(d, 2 + rnd() * 12, 4 + rnd() * 6, [244, 244, 238], 150);
  },
  egg: (d, rnd) => {
    blob(d, rnd, 8, 8.5, 3.4, 4.2, [238, 232, 214], { light: [252, 248, 236], dark: [204, 194, 170] });
    px(d, 6, 6, [252, 249, 240]); px(d, 7, 6, [250, 246, 236]);   // highlight
    speckle(d, rnd, [[220, 210, 186]], 0.06);
  },
  flint: (d, rnd) => {
    for (let y = 4; y <= 13; y++) for (let x = 4; x <= 12; x++) {
      if (Math.abs(x - 8) + Math.abs(y - 8.5) > 4.6) continue;       // angular chip
      px(d, x, y, (x - 8) + (y - 8) < -2 ? [104, 102, 108] : jitter([58, 56, 62], rnd, 0.1));
    }
    line(d, 5, 7, 9, 5, [120, 118, 124]);                           // facet edge
    px(d, 11, 11, [32, 30, 34]); px(d, 6, 12, [36, 34, 38]);        // shadow corners
  },
  string: (d, rnd) => {
    const c = [226, 224, 216], c2 = [190, 188, 180];
    for (let y = 1; y <= 14; y++) {
      const x = 8 + Math.round(Math.sin(y * 0.85) * 2.4);
      px(d, x, y, c); px(d, x + 1, y, c2);
    }
    px(d, 10, 1, c); px(d, 11, 2, c2); px(d, 6, 14, c);             // frayed ends
  },
  arrow: (d, rnd) => {
    line(d, 3, 13, 12, 4, [120, 92, 60]); line(d, 4, 13, 13, 4, [92, 68, 44]);  // shaft
    px(d, 14, 2, [140, 140, 144]); px(d, 13, 3, [112, 112, 116]);   // flint head
    px(d, 12, 3, [92, 92, 96]); px(d, 13, 4, [92, 92, 96]);
    px(d, 3, 12, [232, 232, 236]); px(d, 2, 13, [210, 210, 216]);   // feather fletch
    px(d, 4, 13, [232, 232, 236]); px(d, 3, 14, [200, 200, 206]);
  },
  bow: (d, rnd) => {
    const wood = [128, 90, 52], woodD = [96, 66, 40], woodL = [156, 116, 70];
    const str = [228, 228, 232], ar = [120, 92, 60];
    const arc = [[6, 1], [8, 2], [10, 4], [11, 6], [11, 9], [10, 11], [8, 13], [6, 14]];
    for (const [x, y] of arc) { px(d, x, y, wood); px(d, x - 1, y, woodD); px(d, x + 1, y, woodL); }
    vline(d, 6, 2, 13, str);                                        // taut string
    line(d, 3, 7, 12, 7, ar); px(d, 13, 7, [128, 128, 132]);        // nocked arrow
    px(d, 3, 6, str); px(d, 3, 8, str);                             // fletch
  },
  shears: (d, rnd) => {
    const m = [196, 200, 208], mL = [230, 233, 238], mD = [128, 132, 140];
    line(d, 3, 13, 9, 6, m); line(d, 4, 13, 10, 6, mL);            // blade 1
    line(d, 13, 13, 7, 6, m); line(d, 12, 13, 6, 6, mL);           // blade 2
    px(d, 8, 7, [78, 80, 86]); px(d, 8, 8, [78, 80, 86]);          // pivot rivet
    px(d, 3, 14, mD); px(d, 13, 14, mD);                           // handle rings
  },
  shield: (d, rnd) => {
    const wood = [128, 88, 52], woodD = [96, 66, 40], iron = [176, 180, 188], ironL = [214, 218, 224];
    for (let y = 2; y <= 14; y++) for (let x = 3; x <= 12; x++) {
      const taper = y > 10 ? (y - 10) : 0;              // rounded/pointed base
      if (x < 3 + taper || x > 12 - taper) continue;
      px(d, x, y, jitter(x <= 3 ? woodD : wood, rnd, 0.05));
    }
    for (let y = 2; y <= 14; y++) { px(d, 7, y, iron); px(d, 8, y, ironL); }   // metal spine
    hline(d, 3, 12, 2, ironL); hline(d, 4, 11, 8, iron);                       // trim + boss line
    border(d, woodD, 120);
  },
};

// Cracks + tools are generated families.
for (let i = 0; i < 10; i++) P[`crack${i}`] = crackPainter(i);
const TIER_HEAD = {
  timber: [138, 106, 66], stone: [144, 144, 144],
  copper: [196, 122, 74], iron: [216, 221, 226],
  sunsteel: [255, 205, 110],
};
for (const tier of Object.keys(TIER_HEAD)) {
  for (const type of ['pick', 'axe', 'shovel', 'hoe', 'blade']) {
    P[`${type}_${tier}`] = toolPainter(type, TIER_HEAD[tier]);
  }
}

// Armor: one silhouette per piece, tinted by tier.
function armorPainter(piece, col) {
  const L = shade(col, 1.24), D = shade(col, 0.66), E = shade(col, 0.42);
  return (d, rnd) => {
    if (piece === 'helmet') {
      for (let y = 3; y <= 9; y++) for (let x = 4; x <= 11; x++) {
        if (Math.hypot((x - 7.5) / 4, (y - 6.5) / 4.4) > 1) continue;
        px(d, x, y, y <= 4 ? L : jitter(col, rnd, 0.05));
      }
      hline(d, 4, 11, 10, D);                       // face-opening rim
      for (let x = 6; x <= 9; x++) px(d, x, 9, E);  // visor slit
      px(d, 6, 3, L); px(d, 7, 3, L);
    } else if (piece === 'chestplate') {
      for (let y = 3; y <= 12; y++) for (let x = 4; x <= 11; x++) {
        px(d, x, y, x <= 4 || x >= 11 ? E : x === 5 || x === 10 ? D : y <= 4 ? L : jitter(col, rnd, 0.05));
      }
      hline(d, 2, 4, 3, L); hline(d, 11, 13, 3, D); // shoulder tabs
      hline(d, 4, 11, 12, E); vline(d, 7, 4, 11, D);
    } else if (piece === 'leggings') {
      for (let y = 2; y <= 13; y++) for (let x = 4; x <= 11; x++) {
        if (x >= 7 && x <= 8 && y >= 6) continue;   // gap between legs
        px(d, x, y, x === 4 || x === 11 ? E : y <= 3 ? L : jitter(col, rnd, 0.05));
      }
      hline(d, 4, 11, 2, L);
    } else {                                        // boots
      for (let y = 7; y <= 13; y++) for (let x = 3; x <= 12; x++) {
        if (x >= 7 && x <= 8 && y <= 11) continue;
        px(d, x, y, y === 13 ? E : y <= 8 ? L : jitter(col, rnd, 0.05));
      }
      hline(d, 3, 6, 13, E); hline(d, 9, 12, 13, E);
    }
  };
}
const ARMOR_COL = { leather: [150, 102, 64], iron: [198, 202, 208], diamond: [110, 214, 206] };
for (const [tier, col] of Object.entries(ARMOR_COL)) {
  for (const pc of ['helmet', 'chestplate', 'leggings', 'boots']) {
    P[`${tier}_${pc}`] = armorPainter(pc, col);
  }
}

// TNT: red dynamite body with a cream label band + fuse cap on top.
P.tnt_side = (d, rnd) => {
  noisyFill(d, rnd, [172, 52, 42], 0.05);
  for (let y = 6; y <= 9; y++) for (let x = 0; x < 16; x++) px(d, x, y, jitter([228, 224, 210], rnd, 0.03));
  hline(d, 0, 15, 6, [182, 178, 166]); hline(d, 0, 15, 9, [150, 100, 60]);
  const dk = [64, 48, 42];
  hline(d, 1, 3, 7, dk); vline(d, 2, 7, 8, dk);                    // T
  vline(d, 6, 7, 8, dk); vline(d, 8, 7, 8, dk); px(d, 7, 7, dk);   // N
  hline(d, 11, 13, 7, dk); vline(d, 12, 7, 8, dk);                 // T
  speckle(d, rnd, [[150, 44, 36]], 0.05);
};
P.tnt_top = (d, rnd) => {
  noisyFill(d, rnd, [176, 54, 44], 0.05);
  blob(d, rnd, 8, 8, 3.6, 3.6, [188, 60, 48], { light: [214, 92, 78], dark: [120, 36, 30] });
  blob(d, rnd, 8, 8, 1.7, 1.7, [72, 54, 42], { light: [124, 96, 62] });
  px(d, 8, 8, [40, 32, 26]);
};
P.tnt_bottom = (d, rnd) => {
  noisyFill(d, rnd, [150, 46, 38], 0.05);
  border(d, [110, 34, 28]);
};

// Enchanting table: dark obsidian with a glowing violet rune + a red book.
P.enchanting_table_top = (d, rnd) => {
  noisyFill(d, rnd, [38, 30, 46], 0.05);
  const glow = [156, 96, 216];
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    px(d, 8 + Math.round(Math.cos(a) * 4), 8 + Math.round(Math.sin(a) * 4), glow);
  }
  px(d, 8, 8, [214, 168, 255]); px(d, 7, 8, [190, 140, 240]);
  speckle(d, rnd, [[64, 48, 80]], 0.06);
};
P.enchanting_table_side = (d, rnd) => {
  noisyFill(d, rnd, [40, 32, 48], 0.05);
  for (let y = 2; y <= 5; y++) for (let x = 3; x <= 12; x++) px(d, x, y, jitter([150, 40, 50], rnd, 0.06));
  hline(d, 3, 12, 2, [202, 82, 92]); hline(d, 3, 12, 5, [100, 26, 34]);
  vline(d, 7, 2, 5, [70, 18, 24]); vline(d, 8, 2, 5, [214, 194, 152]);   // spine + pages
  speckle(d, rnd, [[58, 46, 66]], 0.05);
};

// ── Brewing sprites ───────────────────────────────────────────────
function potionPainter(liquid) {
  const glass = [200, 210, 214], glassD = [150, 162, 170], cork = [120, 100, 70];
  return (d, rnd) => {
    for (let y = 6; y <= 14; y++) for (let x = 4; x <= 11; x++) {
      if (Math.hypot((x - 7.5) / 4, (y - 10.5) / 4.2) > 1) continue;
      px(d, x, y, y >= 8 ? jitter(liquid, rnd, 0.07) : (y <= 6 ? glassD : glass));
    }
    for (let y = 3; y <= 6; y++) { px(d, 7, y, glass); px(d, 8, y, glassD); }   // neck
    px(d, 7, 2, cork); px(d, 8, 2, cork);                                       // cork
    px(d, 6, 9, [255, 255, 255], 130);                                          // sheen
  };
}
P.nether_wart = (d, rnd) => {
  blob(d, rnd, 8, 9.5, 3.6, 3.4, [140, 40, 50], { light: [186, 70, 80], dark: [92, 24, 32] });
  speckle(d, rnd, [[176, 60, 70]], 0.12);
  px(d, 8, 5, [120, 30, 40]); px(d, 7, 6, [110, 28, 36]);
};
P.magma_cream = (d, rnd) => {
  blob(d, rnd, 8, 8.5, 4, 3.8, [62, 40, 34], { light: [104, 64, 46], dark: [40, 24, 22] });
  for (let i = 0; i < 7; i++) px(d, 5 + ((rnd() * 7) | 0), 6 + ((rnd() * 6) | 0), [255, 160, 60]);
  px(d, 8, 8, [255, 202, 92]);
};
P.glass_bottle = (d, rnd) => {
  const glass = [200, 210, 214], glassD = [150, 162, 170];
  for (let y = 6; y <= 14; y++) for (let x = 4; x <= 11; x++) {
    const r = Math.hypot((x - 7.5) / 4, (y - 10.5) / 4.2);
    if (r > 1) continue;
    px(d, x, y, r > 0.72 ? glassD : glass, 185);
  }
  for (let y = 3; y <= 6; y++) { px(d, 7, y, glass); px(d, 8, y, glassD); }
  px(d, 7, 2, [120, 100, 70]); px(d, 8, 2, [120, 100, 70]);
  px(d, 6, 9, [255, 255, 255], 160);
};
P.water_bottle = potionPainter([70, 120, 210]);
P.awkward_potion = potionPainter([120, 90, 170]);
const POTIONS = {
  potion_healing: [232, 74, 92], potion_regeneration: [214, 96, 176], potion_strength: [150, 40, 34],
  potion_swiftness: [116, 196, 224], potion_fire_resistance: [228, 148, 54], potion_poison: [86, 154, 60],
};
for (const [k, col] of Object.entries(POTIONS)) P[k] = potionPainter(col);

// ── Colored wool + dyes ───────────────────────────────────────────
const WOOL_COLORS = {
  white: [233, 236, 236], orange: [240, 118, 19], magenta: [199, 78, 189], light_blue: [58, 175, 217],
  yellow: [248, 197, 39], lime: [112, 185, 25], pink: [237, 141, 172], gray: [70, 76, 80],
  light_gray: [142, 142, 134], cyan: [21, 137, 145], purple: [121, 42, 172], blue: [60, 64, 160],
  brown: [114, 71, 40], green: [84, 109, 27], red: [160, 39, 34], black: [26, 27, 31],
};
function woolPainter(col) {
  return (d, rnd) => {
    noisyFill(d, rnd, col, 0.05);
    speckle(d, rnd, [shade(col, 1.12)], 0.14);
    speckle(d, rnd, [shade(col, 0.84)], 0.14);
    for (let i = 0; i < 6; i++) {
      const x = (rnd() * 14) | 0, y = (rnd() * 14) | 0;
      px(d, x, y, shade(col, 0.8)); px(d, x + 1, y + 1, shade(col, 1.12));
    }
  };
}
function dyePainter(col) {
  return (d, rnd) => {
    blob(d, rnd, 8, 10.5, 5, 2.6, col, { light: shade(col, 1.3), dark: shade(col, 0.62) });
    for (let i = 0; i < 16; i++) px(d, 3 + ((rnd() * 10) | 0), 6 + ((rnd() * 8) | 0), jitter(col, rnd, 0.18));
  };
}
for (const [c, col] of Object.entries(WOOL_COLORS)) {
  P[`${c}_wool`] = woolPainter(col);
  P[`${c}_dye`] = dyePainter(col);
}

// ── Concrete / terracotta / glazed terracotta (16 colors each) ─────
const cmix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const CLAY_BASE = [150, 92, 66];
function concretePainter(col) {                 // flat, vivid, near-uniform
  const c = shade(col, 1.05);
  return (d, rnd) => {
    noisyFill(d, rnd, c, 0.02);
    speckle(d, rnd, [shade(c, 1.05)], 0.04);
    speckle(d, rnd, [shade(c, 0.95)], 0.05);
  };
}
function terracottaPainter(col) {               // earthy — clay tinted by the dye
  const c = cmix(CLAY_BASE, col, 0.55);
  return (d, rnd) => {
    noisyFill(d, rnd, c, 0.07);
    speckle(d, rnd, [shade(c, 0.84)], 0.1);
    speckle(d, rnd, [shade(c, 1.13)], 0.06);
    hline(d, 0, 15, 5, shade(c, 0.9)); hline(d, 0, 15, 11, shade(c, 0.9));  // faint strata
  };
}
function glazedPainter(col) {                    // ornate symmetric ceramic motif
  const base = shade(col, 1.12), dark = shade(col, 0.58), lite = [236, 234, 226];
  return (d, rnd) => {
    noisyFill(d, rnd, base, 0.015);
    border(d, dark);
    for (let i = 2; i <= 13; i++) { px(d, i, i, lite); px(d, 15 - i, i, dark); }
    for (let i = 4; i <= 11; i++) px(d, i, 15 - i, lite);
    hline(d, 5, 10, 2, lite); vline(d, 2, 5, 10, lite);
    px(d, 7, 7, dark); px(d, 8, 8, dark); px(d, 7, 8, lite); px(d, 8, 7, lite);
  };
}
for (const [c, col] of Object.entries(WOOL_COLORS)) {
  P[`${c}_concrete`] = concretePainter(col);
  P[`${c}_terracotta`] = terracottaPainter(col);
  P[`${c}_glazed_terracotta`] = glazedPainter(col);
}

// ── Cucurbits, sugar cane, cake ────────────────────────────────────
const PUMP = [216, 126, 26], PUMP_D = [150, 82, 14], PUMP_RIB = [182, 100, 18];
P.pumpkin_top = (d, rnd) => {
  noisyFill(d, rnd, [176, 122, 42], 0.06); border(d, [120, 84, 26]);
  px(d, 7, 6, [130, 90, 30]); px(d, 8, 7, [130, 90, 30]);            // stalk stump
};
P.pumpkin_side = (d, rnd) => {
  noisyFill(d, rnd, PUMP, 0.05);
  for (let x = 1; x < 16; x += 3) vline(d, x, 0, 15, PUMP_RIB);       // vertical ribs
  speckle(d, rnd, [PUMP_D], 0.05);
};
function faceGourd(d, rnd, glow) {
  P.pumpkin_side(d, rnd);
  const eye = glow ? [255, 216, 88] : [64, 36, 10];
  px(d, 4, 6, eye); px(d, 5, 6, eye); px(d, 5, 7, eye);              // left eye
  px(d, 11, 6, eye); px(d, 10, 6, eye); px(d, 10, 7, eye);          // right eye
  hline(d, 4, 11, 10, eye); px(d, 5, 11, eye); px(d, 8, 11, eye); px(d, 10, 11, eye);  // grin
}
P.carved_pumpkin_face = (d, rnd) => faceGourd(d, rnd, false);
P.jack_o_lantern_face = (d, rnd) => faceGourd(d, rnd, true);
P.melon_top = (d, rnd) => { noisyFill(d, rnd, [116, 150, 40], 0.06); speckle(d, rnd, [[92, 126, 32]], 0.1); };
P.melon_side = (d, rnd) => {
  noisyFill(d, rnd, [70, 128, 44], 0.05);
  for (let x = 0; x < 16; x += 2) vline(d, x, 0, 15, [46, 96, 34]);   // rind stripes
  speckle(d, rnd, [[122, 162, 62]], 0.06);
};
P.crop_stem = (d) => {
  for (let y = 5; y < 16; y++) {
    const x = 7 + Math.round(Math.sin(y * 0.6) * 1.6);
    px(d, x, y, [92, 142, 42]); px(d, x + 1, y, [70, 118, 32]);
  }
};
P.sugar_cane = (d) => {
  for (let y = 0; y < 16; y++) { px(d, 7, y, [128, 198, 122]); px(d, 8, y, [152, 216, 142]); }
  hline(d, 6, 9, 5, [96, 160, 96]); hline(d, 6, 9, 11, [96, 160, 96]);  // node bands
};
P.cake_top = (d, rnd) => {
  noisyFill(d, rnd, [242, 236, 214], 0.03); border(d, [214, 190, 150]);
  for (let i = 0; i < 5; i++) px(d, 3 + ((rnd() * 10) | 0), 3 + ((rnd() * 10) | 0), [220, 60, 70]);
};
P.cake_side = (d, rnd) => {
  noisyFill(d, rnd, [220, 200, 168], 0.04);
  hline(d, 0, 15, 2, [246, 244, 232]); hline(d, 0, 15, 3, [232, 96, 110]);   // frosting
};
P.cake_bottom = (d, rnd) => noisyFill(d, rnd, [150, 108, 70], 0.05);
P.emerald = (d, rnd) => {                               // faceted green gem
  blob(d, rnd, 8, 8.5, 3.6, 4.2, [42, 176, 96], { light: [120, 232, 150], dark: [22, 110, 60] });
  vline(d, 8, 3, 13, [150, 240, 176]); hline(d, 4, 11, 6, [24, 120, 66]);
};
P.emerald_ore = (d, rnd) => {
  noisyFill(d, rnd, [128, 128, 130], 0.05);
  for (let i = 0; i < 5; i++) { const x = 3 + ((rnd() * 10) | 0), y = 3 + ((rnd() * 10) | 0);
    px(d, x, y, [42, 176, 96]); px(d, x + 1, y, [90, 216, 130]); px(d, x, y + 1, [26, 120, 66]); }
};
P.emerald_block = (d, rnd) => {
  noisyFill(d, rnd, [46, 190, 104], 0.05); border(d, [24, 120, 66]);
  vline(d, 5, 2, 13, [120, 232, 150]); vline(d, 10, 2, 13, [26, 130, 72]); hline(d, 3, 12, 8, [90, 216, 130]);
};
// ── Redstone / automation ──────────────────────────────────────────
const RED = [200, 20, 24], RED_D = [120, 10, 14], RED_HI = [248, 70, 60];
P.redstone = (d, rnd) => {                              // dust item
  for (let i = 0; i < 22; i++) px(d, 3 + ((rnd() * 10) | 0), 3 + ((rnd() * 10) | 0), i % 2 ? RED : RED_HI);
};
P.redstone_block = (d, rnd) => {
  noisyFill(d, rnd, RED, 0.06); border(d, RED_D);
  speckle(d, rnd, [RED_HI], 0.08); speckle(d, rnd, [RED_D], 0.08);
};
P.redstone_ore = (d, rnd) => {
  noisyFill(d, rnd, [128, 128, 130], 0.05);
  for (let i = 0; i < 6; i++) { const x = 3 + ((rnd() * 10) | 0), y = 3 + ((rnd() * 10) | 0);
    px(d, x, y, RED); px(d, x + 1, y, RED_HI); }
};
P.redstone_wire = (d) => {                              // ground cross of dust
  hline(d, 1, 14, 7, RED); hline(d, 1, 14, 8, RED_D);
  vline(d, 7, 1, 14, RED); vline(d, 8, 1, 14, RED_D);
  px(d, 7, 7, RED_HI); px(d, 8, 8, RED_HI);
};
function torchPainterR(head) {
  return (d) => {
    for (let y = 2; y <= 11; y++) { px(d, 7, y, [104, 76, 48]); px(d, 8, y, [80, 56, 34]); }  // stick
    px(d, 7, 12, head); px(d, 8, 12, head); px(d, 7, 13, head); px(d, 8, 13, head);           // tip
    px(d, 7, 14, shade(head, 1.3));
  };
}
P.redstone_torch = torchPainterR([230, 40, 36]);
P.redstone_torch_off = torchPainterR([96, 30, 30]);
P.lever = (d) => { for (let y = 2; y <= 9; y++) { px(d, 8, y, [120, 96, 70]); px(d, 9, y - 1, [150, 120, 88]); }
  hline(d, 6, 10, 11, [80, 80, 82]); hline(d, 6, 10, 12, [60, 60, 62]); };   // cobble base + handle right
P.lever_on = (d) => { for (let y = 2; y <= 9; y++) { px(d, 7, y, [150, 120, 88]); px(d, 6, y - 1, [120, 96, 70]); }
  hline(d, 6, 10, 11, [80, 80, 82]); hline(d, 6, 10, 12, [60, 60, 62]); };    // handle flipped left
P.stone_button = (d, rnd) => { for (let y = 6; y <= 9; y++) hline(d, 5, 10, y, jitter([120, 120, 122], rnd, 0.08));
  border(d, [80, 80, 82]); };
P.redstone_lamp = (d, rnd) => { noisyFill(d, rnd, [92, 70, 40], 0.05); border(d, [60, 46, 28]);
  for (let i = 0; i < 4; i++) px(d, 4 + ((rnd() * 8) | 0), 4 + ((rnd() * 8) | 0), [140, 108, 60]); };
P.redstone_lamp_on = (d, rnd) => { noisyFill(d, rnd, [236, 196, 108], 0.04); border(d, [200, 150, 70]);
  for (let i = 0; i < 6; i++) px(d, 4 + ((rnd() * 8) | 0), 4 + ((rnd() * 8) | 0), [255, 236, 170]); };
P.dispenser_front = (d, rnd) => { noisyFill(d, rnd, [124, 124, 126], 0.05); border(d, [80, 80, 82]);
  for (let y = 6; y <= 10; y++) hline(d, 5, 10, y, [30, 30, 32]); };   // dark launcher mouth
P.hopper_top = (d, rnd) => { noisyFill(d, rnd, [96, 96, 100], 0.05); border(d, [60, 60, 64]);
  for (let x = 2; x <= 13; x++) { px(d, x, 3, [40, 40, 44]); px(d, x, 12, [40, 40, 44]); } };
P.hopper_side = (d, rnd) => { noisyFill(d, rnd, [82, 82, 86], 0.05);
  for (let x = 4; x <= 11; x++) { px(d, x, 10, [50, 50, 54]); } vline(d, 7, 10, 15, [50, 50, 54]); vline(d, 8, 10, 15, [50, 50, 54]); };
// ── Lapis + bookshelf ──────────────────────────────────────────────
const LAPIS = [38, 66, 168], LAPIS_HI = [86, 128, 224];
P.lapis_lazuli = (d, rnd) => { for (let i = 0; i < 20; i++) px(d, 3 + ((rnd() * 10) | 0), 3 + ((rnd() * 10) | 0), i % 3 ? LAPIS : LAPIS_HI); };
P.lapis_ore = (d, rnd) => {
  noisyFill(d, rnd, [128, 128, 130], 0.05);
  for (let i = 0; i < 6; i++) { const x = 3 + ((rnd() * 10) | 0), y = 3 + ((rnd() * 10) | 0);
    px(d, x, y, LAPIS); px(d, x + 1, y, LAPIS_HI); px(d, x, y + 1, shade(LAPIS, 0.7)); }
};
P.lapis_block = (d, rnd) => { noisyFill(d, rnd, LAPIS, 0.08); border(d, shade(LAPIS, 0.6)); speckle(d, rnd, [LAPIS_HI], 0.1); };
P.paper = (d, rnd) => { noisyFill(d, rnd, [236, 234, 224], 0.02); border(d, [206, 202, 188]);
  for (let y = 5; y <= 11; y += 2) hline(d, 4, 11, y, [176, 178, 196]); };
P.book = (d, rnd) => { for (let y = 3; y <= 13; y++) hline(d, 4, 11, y, [150, 40, 44]); border(d, [96, 24, 26]);
  vline(d, 4, 3, 13, [230, 226, 210]); px(d, 8, 8, [214, 178, 90]); };   // red cover + gold clasp
P.bookshelf = (d, rnd) => {
  noisyFill(d, rnd, [122, 88, 52], 0.05);                                // plank frame
  hline(d, 0, 15, 0, [80, 56, 32]); hline(d, 0, 15, 7, [80, 56, 32]); hline(d, 0, 15, 15, [80, 56, 32]);
  const spine = [[176, 52, 48], [72, 120, 180], [96, 168, 88], [214, 176, 70], [150, 90, 170]];
  for (let row = 0; row < 2; row++) for (let x = 1; x < 15; x += 2) {
    const c = spine[(x + row) % spine.length];
    for (let y = row * 7 + 1; y <= row * 7 + 6; y++) px(d, x, y, c);
  }
};

// ── Rails + vehicles ───────────────────────────────────────────────
function railPainter(tie) {
  return (d, rnd) => {
    vline(d, 4, 1, 14, [120, 120, 126]); vline(d, 11, 1, 14, [120, 120, 126]);   // two rails
    vline(d, 5, 1, 14, [80, 80, 86]); vline(d, 10, 1, 14, [80, 80, 86]);
    for (let y = 2; y <= 13; y += 4) { hline(d, 3, 12, y, [110, 82, 52]); if (tie) hline(d, 3, 12, y, tie(rnd)); }  // wooden ties
  };
}
P.rail = railPainter(null);
P.powered_rail = railPainter(() => [200, 40, 40]);
P.detector_rail = railPainter(() => [90, 120, 200]);
P.minecart = (d, rnd) => {
  noisyFill(d, rnd, [70, 70, 76], 0.04);
  for (let x = 3; x <= 12; x++) { px(d, x, 5, [110, 110, 116]); px(d, x, 11, [40, 40, 44]); }
  vline(d, 3, 5, 11, [110, 110, 116]); vline(d, 12, 5, 11, [110, 110, 116]);
  px(d, 5, 13, [30, 30, 32]); px(d, 10, 13, [30, 30, 32]);          // wheels
};
P.boat = (d, rnd) => {
  for (let y = 6; y <= 12; y++) { const w = 6 - Math.abs(y - 9); hline(d, 8 - w, 7 + w, y, [150, 112, 66]); }
  hline(d, 2, 13, 6, [110, 80, 44]); px(d, 7, 4, [110, 80, 44]); px(d, 8, 4, [110, 80, 44]);   // paddle
};
P.nether_star = (d, rnd) => {                           // 4-point pale star
  for (let i = 0; i < 16; i++) { px(d, 7, i, [236, 240, 246]); px(d, 8, i, [236, 240, 246]); }
  for (let x = 0; x < 16; x++) { px(d, x, 7, [236, 240, 246]); px(d, x, 8, [236, 240, 246]); }
  for (let i = 3; i <= 12; i++) { px(d, i, i, [210, 214, 230]); px(d, 15 - i, i, [210, 214, 230]); }
  blob(d, rnd, 7.5, 7.5, 2.4, 2.4, [255, 255, 255], { light: [255, 255, 255], dark: [200, 206, 224] });
};
P.pumpkin_seeds = (d, rnd) => {
  for (let i = 0; i < 9; i++) { const x = 4 + ((rnd() * 8) | 0), y = 4 + ((rnd() * 8) | 0);
    px(d, x, y, [226, 210, 152]); px(d, x, y + 1, [190, 170, 112]); }
};
P.melon_seeds = (d, rnd) => {
  for (let i = 0; i < 9; i++) { const x = 4 + ((rnd() * 8) | 0), y = 4 + ((rnd() * 8) | 0);
    px(d, x, y, [40, 50, 30]); px(d, x, y + 1, [72, 82, 52]); }
};
P.melon_slice = (d) => {                                  // wedge: green rind + red flesh
  for (let y = 3; y <= 13; y++) {
    const w = y - 3;
    for (let x = 7 - Math.ceil(w / 2); x <= 7 + Math.floor(w / 2); x++) px(d, x, y, [220, 60, 66]);
    px(d, 7 - Math.ceil(w / 2) - 1, y, [70, 150, 60]); px(d, 7 + Math.floor(w / 2) + 1, y, [70, 150, 60]);
  }
};
P.sugar = (d, rnd) => {
  blob(d, rnd, 8, 9, 4, 3.4, [238, 240, 246], { light: [255, 255, 255], dark: [198, 202, 214] });
  speckle(d, rnd, [[255, 255, 255]], 0.2);
};
P.pumpkin_pie = (d, rnd) => {
  blob(d, rnd, 8, 9, 5, 3.6, [206, 150, 54], { light: [236, 190, 96], dark: [150, 96, 26] });
  hline(d, 3, 12, 5, [236, 206, 150]); speckle(d, rnd, [[120, 70, 20]], 0.06);
};

// ── Grindstone / stonecutter ───────────────────────────────────────
const STONEG = [132, 132, 134];
P.grindstone_side = (d, rnd) => {
  noisyFill(d, rnd, [112, 100, 92], 0.05);                        // wooden frame
  vline(d, 2, 2, 13, [80, 66, 54]); vline(d, 13, 2, 13, [80, 66, 54]);
  for (let y = 4; y <= 11; y++) for (let x = 4; x <= 11; x++) {   // round grind wheel
    if (Math.hypot(x - 7.5, y - 7.5) <= 3.6) px(d, x, y, jitter(STONEG, rnd, 0.08));
  }
  border(d, [70, 58, 48], 0);
};
P.grindstone_top = (d, rnd) => {
  noisyFill(d, rnd, [104, 92, 82], 0.05);
  hline(d, 3, 12, 7, [72, 60, 50]); hline(d, 3, 12, 8, [140, 140, 142]);   // wheel edge
};
P.stonecutter_side = (d, rnd) => {
  noisyFill(d, rnd, STONEG, 0.05); border(d, shade(STONEG, 0.7));
  hline(d, 0, 15, 11, [96, 96, 98]);
};
P.stonecutter_top = (d, rnd) => {
  noisyFill(d, rnd, shade(STONEG, 0.9), 0.05);
  for (let x = 3; x <= 12; x++) px(d, x, 8, [210, 210, 214]);      // saw blade slot
  for (let x = 3; x <= 12; x += 2) { px(d, x, 7, [230, 230, 236]); px(d, x, 9, [180, 180, 186]); }  // teeth
};

// ── Building variants ─────────────────────────────────────────────
const SBRICK = [124, 122, 118], SAND2 = [216, 205, 160];
function sBrick(d, rnd, base) {
  const m = shade(base, 0.66);
  noisyFill(d, rnd, base, 0.05);
  speckle(d, rnd, [shade(base, 1.1)], 0.06); speckle(d, rnd, [shade(base, 0.85)], 0.08);
  hline(d, 0, 15, 7, m); hline(d, 0, 15, 15, m);        // two brick courses
  vline(d, 7, 0, 7, m); vline(d, 15, 0, 7, m);          // top course seams
  vline(d, 3, 8, 15, m); vline(d, 11, 8, 15, m);        // offset bottom course
}
P.smooth_stone = (d, rnd) => {
  noisyFill(d, rnd, [132, 132, 134], 0.03);
  speckle(d, rnd, [[120, 120, 122]], 0.04); hline(d, 0, 15, 15, [112, 112, 114]);
};
P.chiseled_stone_bricks = (d, rnd) => {
  noisyFill(d, rnd, SBRICK, 0.05); border(d, shade(SBRICK, 0.66));
  for (let y = 3; y <= 12; y++) { px(d, 7, y, shade(SBRICK, 0.75)); px(d, 8, y, shade(SBRICK, 1.12)); }
  hline(d, 4, 11, 3, shade(SBRICK, 0.7)); hline(d, 4, 11, 12, shade(SBRICK, 0.7));
};
P.cracked_stone_bricks = (d, rnd) => {
  sBrick(d, rnd, SBRICK);
  for (let i = 0; i < 3; i++) line(d, 2 + ((rnd() * 12) | 0), 2, 2 + ((rnd() * 12) | 0), 13, [42, 42, 44]);
};
P.mossy_stone_bricks = (d, rnd) => {
  sBrick(d, rnd, SBRICK); speckle(d, rnd, [[70, 104, 54], [92, 124, 66]], 0.13);
};
P.smooth_sandstone = (d, rnd) => {
  noisyFill(d, rnd, SAND2, 0.03); hline(d, 0, 15, 15, shade(SAND2, 0.82));
  speckle(d, rnd, [shade(SAND2, 0.94)], 0.05);
};
P.cut_sandstone = (d, rnd) => {
  noisyFill(d, rnd, SAND2, 0.04); const m = shade(SAND2, 0.78);
  hline(d, 0, 15, 7, m); vline(d, 7, 0, 15, m);
};
P.chiseled_sandstone = (d, rnd) => {
  noisyFill(d, rnd, SAND2, 0.04); border(d, shade(SAND2, 0.78));
  const m = shade(SAND2, 0.72);
  hline(d, 5, 10, 4, m); vline(d, 7, 5, 10, m); px(d, 6, 7, m); px(d, 9, 7, m); hline(d, 5, 10, 11, m);
};

// Anvil: dark iron profile (wide top, narrow waist, wide base).
P.anvil_side = (d, rnd) => {
  const dark = [58, 58, 64], mid = [88, 88, 96], lite = [122, 122, 130];
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 14; x++) px(d, x, y, jitter(mid, rnd, 0.06));
  hline(d, 1, 14, 1, lite); hline(d, 1, 14, 4, dark);
  for (let y = 5; y <= 9; y++) for (let x = 5; x <= 10; x++) px(d, x, y, jitter(dark, rnd, 0.06));
  for (let y = 10; y <= 14; y++) for (let x = 2; x <= 13; x++) px(d, x, y, jitter(mid, rnd, 0.06));
  hline(d, 2, 13, 14, dark); hline(d, 2, 13, 10, lite);
};
P.anvil_top = (d, rnd) => {
  const mid = [94, 94, 102], dark = [60, 60, 66], lite = [128, 128, 136];
  noisyFill(d, rnd, mid, 0.05); border(d, dark);
  hline(d, 3, 12, 3, lite); hline(d, 3, 12, 12, dark);
  for (let i = 0; i < 6; i++) px(d, 4 + i * 1.6, 7 + ((rnd() * 2) | 0), dark);
};
P.crossbow = (d, rnd) => {
  const wood = [122, 86, 50], woodD = [94, 66, 40], iron = [180, 184, 192], str = [226, 226, 230];
  for (let x = 2; x <= 12; x++) { px(d, x, 9, jitter(wood, rnd, 0.06)); px(d, x, 10, woodD); }   // stock
  line(d, 11, 3, 13, 6, iron); line(d, 11, 15, 13, 12, iron); px(d, 13, 9, iron);               // limbs
  line(d, 13, 6, 13, 12, str);                                                                  // string
  line(d, 4, 8, 12, 8, [112, 92, 66]); px(d, 3, 8, [142, 142, 146]);                            // loaded bolt
  px(d, 5, 11, woodD); px(d, 4, 11, woodD); px(d, 5, 12, woodD);                                // trigger/grip
};

// ── Extra block faces & item sprites ──────────────────────────────
// Furniture, the Smolder/Hollow dimensions, the Dawn beacon, plus the
// sunsteel tier's raw materials and a few utility items. Appended here
// (not in the P literal) so the entries above stay undisturbed.

// Wall/floor torch: dark timber rod at the base, cyan-white wisp flame.
P.wisp_torch = (d, rnd) => {
  const rod = [78, 58, 40], rodD = shade(rod, 0.74), rodL = shade(rod, 1.18);
  for (let y = 8; y <= 15; y++) {                      // stubby rod, 3px wide
    px(d, 7, y, jitter(rodL, rnd, 0.06));
    px(d, 8, y, jitter(rod, rnd, 0.06));
    px(d, 9, y, jitter(rodD, rnd, 0.06));
  }
  px(d, 7, 8, [120, 92, 60]); px(d, 9, 15, shade(rod, 0.6)); // grain nick + foot
  for (let y = 0; y <= 8; y++) for (let x = 4; x <= 12; x++) { // flame teardrop
    const r = Math.hypot((x - 8) / (2.4 - y * 0.06), (y - 4.5) / 4.2);
    if (r > 1) continue;
    const c = r < 0.34 ? [244, 255, 255] : r < 0.62 ? [176, 244, 252] : [96, 200, 236];
    px(d, x, y, jitter(c, rnd, 0.03));
  }
  px(d, 8, 4, [255, 255, 255]); px(d, 8, 5, [236, 255, 255]);  // white heart
  for (let i = 0; i < 4; i++)                                  // rising sparks
    px(d, 6 + ((rnd() * 5) | 0), (rnd() * 4) | 0, [180, 244, 250], 190);
};

// Timber ladder: two rails + rungs, transparent gaps (alpha 0).
P.rungs = (d, rnd) => {
  const rail = [128, 96, 60], railL = shade(rail, 1.16), railD = shade(rail, 0.72);
  for (const rx of [2, 3, 12, 13]) {                   // two 2px rails
    for (let y = 0; y < W; y++) {
      const c = rx === 2 || rx === 12 ? railL : railD;
      px(d, rx, y, jitter(c, rnd, 0.07));
    }
  }
  for (let ry = 2; ry < W; ry += 4) {                  // horizontal rungs
    for (let x = 4; x <= 11; x++) px(d, x, ry, jitter(rail, rnd, 0.06));
    hline(d, 4, 11, ry - 1, railL);                    // rounded top edge
    hline(d, 4, 11, ry + 1, railD);                    // shadow underside
  }
};

// Bedroll seen top-down: pillow band + quilted indigo blanket.
P.bedroll_top = (d, rnd) => {
  const cloth = [78, 82, 128], clothD = shade(cloth, 0.78), clothL = shade(cloth, 1.2);
  const cream = [222, 208, 176], creamD = shade(cream, 0.86);
  noisyFill(d, rnd, cloth, 0.05);
  for (let y = 0; y <= 3; y++) for (let x = 0; x < W; x++)     // pillow band
    px(d, x, y, jitter(y === 3 ? creamD : cream, rnd, 0.05));
  for (let y = 5; y < W; y += 3) hline(d, 1, 14, y, clothD);   // quilt seams
  for (let x = 2; x < W; x += 4) vline(d, x, 5, 15, clothD);
  for (let y = 6; y < W; y += 3) for (let x = 4; x < W; x += 4)
    px(d, x, y, clothL);                                       // stitch tufts
  border(d, [52, 54, 88]);
};

// Bedroll from the side: mattress stripe + a folded, rolled edge.
P.bedroll_side = (d, rnd) => {
  const cloth = [78, 82, 128], clothD = shade(cloth, 0.76), clothL = shade(cloth, 1.2);
  const cream = [222, 208, 176];
  noisyFill(d, rnd, SOIL, 0.06);                        // ground below
  for (let y = 4; y <= 11; y++) for (let x = 0; x < W; x++)    // mattress body
    px(d, x, y, jitter(cloth, rnd, 0.05));
  hline(d, 0, 15, 7, clothD); hline(d, 0, 15, 4, cream);       // seam + top piping
  for (let y = 3; y <= 12; y++) {                              // rolled fold, left end
    for (let x = 0; x <= 3; x++) {
      const rr = Math.hypot(x - 2, y - 7.5);
      if (rr > 4.4) continue;
      px(d, x, y, rr < 2 ? clothL : rr > 3.4 ? clothD : jitter(cloth, rnd, 0.05));
    }
  }
  px(d, 2, 7, cream); px(d, 2, 8, cream);              // roll's cream core
  hline(d, 0, 15, 12, shade(cloth, 0.6));              // bottom shadow
};

// ── Stowbox (storage crate) faces ─────────────────────────────────
const CRATE = [156, 118, 74], CRATE_D = [108, 80, 50], IRON = [92, 96, 104];
const IRON_L = [140, 146, 154], IRON_D = [60, 62, 70];

P.stowbox_top = (d, rnd) => {
  noisyFill(d, rnd, CRATE, 0.05);
  for (let y = 0; y < W; y += 4) hline(d, 0, 15, y, CRATE_D); // plank seams
  speckle(d, rnd, [shade(CRATE, 1.12)], 0.07);
  for (const [x, y] of [[0, 0], [13, 0], [0, 13], [13, 13]]) { // corner brackets
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++)
      px(d, x + dx, y + dy, (dx === 0 || dy === 0) ? IRON_L : IRON);
  }
  for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) { // central clasp
    const c = dx === 0 || dy === 0 ? IRON_L : dx === 3 || dy === 3 ? IRON_D : IRON;
    px(d, 6 + dx, 6 + dy, c);
  }
  px(d, 7, 8, [40, 42, 48]); px(d, 8, 8, [40, 42, 48]);       // clasp slot
};

P.stowbox_side = (d, rnd) => {
  for (let x = 0; x < W; x++) {                         // vertical planks
    const seam = x % 4 === 0;
    for (let y = 0; y < W; y++)
      px(d, x, y, seam ? jitter(CRATE_D, rnd, 0.06) : jitter(CRATE, rnd, 0.06));
  }
  for (const by of [1, 2, 13, 14]) for (let x = 0; x < W; x++) // iron bands
    px(d, x, by, (by === 1 || by === 13) ? jitter(IRON_L, rnd, 0.05) : jitter(IRON, rnd, 0.05));
  for (const bx of [1, 14]) { px(d, bx, 1, IRON_D); px(d, bx, 14, IRON_D); } // rivets
  px(d, 1, 2, [40, 42, 48]); px(d, 14, 2, [40, 42, 48]);
  px(d, 1, 13, [40, 42, 48]); px(d, 14, 13, [40, 42, 48]);
};

P.stowbox_front = (d, rnd) => {
  P.stowbox_side(d, rnd);
  for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++) { // latch plate
    const c = dx === 0 || dy === 0 ? IRON_L : dx === 5 || dy === 5 ? IRON_D : IRON;
    px(d, 5 + dx, 5 + dy, c);
  }
  vline(d, 7, 7, 9, [36, 38, 44]); px(d, 8, 7, [36, 38, 44]); // keyhole
  px(d, 7, 10, [36, 38, 44]); px(d, 9, 7, [36, 38, 44]);
  px(d, 6, 6, [176, 182, 190]);                        // plate glint
};

// ── Doorleaves & flapgates ────────────────────────────────────────
// Timber door: vertical planks framed by a border with a raised inner
// panel and a round handle on the right.
P.timber_door = (d, rnd) => {
  const base = [158, 122, 76], seam = [104, 78, 48], panel = [172, 136, 88];
  for (let x = 0; x < W; x++) {                          // vertical planks
    const s = x % 5 === 0;
    for (let y = 0; y < W; y++)
      px(d, x, y, s ? jitter(seam, rnd, 0.06) : jitter(base, rnd, 0.06));
  }
  for (let y = 3; y <= 12; y++) for (let x = 3; x <= 12; x++)   // raised panel
    px(d, x, y, jitter(panel, rnd, 0.05));
  for (let y = 3; y <= 12; y++) { px(d, 3, y, seam); px(d, 12, y, seam); }
  hline(d, 3, 12, 3, seam); hline(d, 3, 12, 12, seam);
  border(d, [88, 64, 40]);                               // outer frame
  px(d, 13, 8, [66, 54, 40]); px(d, 14, 8, [72, 60, 44]);   // handle
  px(d, 13, 7, [92, 78, 58]);
};

// Ironbound door: dark timber banded with iron straps and a ring pull.
P.ironbound_door = (d, rnd) => {
  const wood = [96, 74, 52], seam = [64, 48, 34];
  for (let x = 0; x < W; x++) {
    const s = x % 5 === 0;
    for (let y = 0; y < W; y++)
      px(d, x, y, s ? jitter(seam, rnd, 0.06) : jitter(wood, rnd, 0.06));
  }
  for (const by of [2, 3, 12, 13]) for (let x = 0; x < W; x++)   // iron straps
    px(d, x, by, (by === 2 || by === 12) ? jitter(IRON_L, rnd, 0.05) : jitter(IRON, rnd, 0.05));
  for (const bx of [1, 14]) { px(d, bx, 2, IRON_D); px(d, bx, 13, IRON_D); }   // rivets
  border(d, [52, 54, 60]);
  for (let a = 0; a < 8; a++) {                           // ring pull
    const ang = (a / 8) * Math.PI * 2;
    px(d, Math.round(12 + Math.cos(ang) * 2), Math.round(8 + Math.sin(ang) * 2), [176, 182, 190]);
  }
};

// Flapgates: a short slatted panel (reads well as a thin horizontal leaf).
P.timber_flap = (d, rnd) => {
  const base = [162, 128, 82], seam = [100, 74, 46];
  for (let y = 0; y < W; y++) {
    const s = y % 4 === 0;
    for (let x = 0; x < W; x++)
      px(d, x, y, s ? jitter(seam, rnd, 0.06) : jitter(base, rnd, 0.06));
  }
  for (let i = 2; i <= 13; i++) { px(d, i, 1, [92, 68, 44]); px(d, i, 14, [92, 68, 44]); }
  border(d, [86, 62, 40]);
  px(d, 8, 7, [70, 56, 42]); px(d, 8, 8, [70, 56, 42]);   // pull
};

P.ironbound_flap = (d, rnd) => {
  const wood = [98, 76, 54], seam = [64, 48, 34];
  for (let y = 0; y < W; y++) {
    const s = y % 4 === 0;
    for (let x = 0; x < W; x++)
      px(d, x, y, s ? jitter(seam, rnd, 0.06) : jitter(wood, rnd, 0.06));
  }
  for (const bx of [2, 13]) for (let y = 0; y < W; y++)   // vertical iron straps
    px(d, bx, y, jitter(IRON, rnd, 0.05));
  for (const bx of [1, 14]) { px(d, bx, 2, IRON_D); px(d, bx, 13, IRON_D); }
  border(d, [52, 54, 60]);
  px(d, 8, 7, [176, 182, 190]); px(d, 8, 8, [140, 146, 154]);   // ring
};

// ── The Smolder (fiery underworld) ────────────────────────────────
// Near-black igneous bedrock with faint ember-red veins.
P.scorchstone = (d, rnd) => {
  noisyFill(d, rnd, [34, 26, 26], 0.06);
  speckle(d, rnd, [[52, 40, 38], [24, 18, 18]], 0.16);
  const ember = [176, 52, 24];
  for (let i = 0; i < 3; i++) {                         // faint hairline veins
    let x = (rnd() * 15) | 0, y = (rnd() * 15) | 0;
    for (let s = 0; s < 5 + ((rnd() * 4) | 0); s++) {
      px(d, x, y, jitter(ember, rnd, 0.1), 150);
      x = clamp(x + (rnd() < 0.5 ? -1 : 1), 0, 15);
      y = clamp(y + (rnd() < 0.5 ? 0 : 1), 0, 15);
    }
  }
};

// Warm ashen volcanic soil with orange ember flecks.
P.emberash = (d, rnd) => {
  noisyFill(d, rnd, [96, 84, 78], 0.06);
  speckle(d, rnd, [[112, 98, 90], [78, 66, 62]], 0.18);
  speckle(d, rnd, [[80, 70, 66]], 0.1);
  for (let i = 0; i < 7; i++) {                         // glowing ember flecks
    const x = (rnd() * 15) | 0, y = (rnd() * 15) | 0;
    px(d, x, y, [236, 132, 44], 230);
    if (rnd() < 0.5) px(d, x, y + 1, [176, 72, 24], 200);
  }
};

// Scorchstone shot through with bright glowing orange-gold veins.
P.glowvein_ore = (d, rnd) => {
  P.scorchstone(d, rnd);
  const glow = [255, 168, 48], core = [255, 232, 150];
  const n = 4 + ((rnd() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const cx = 2 + rnd() * 11, cy = 2 + rnd() * 11, r = 1.1 + rnd() * 1.1;
    blob(d, rnd, cx, cy, r, r, glow, { light: [255, 208, 96], dark: [204, 108, 20] });
    px(d, cx, cy, core); if (rnd() < 0.5) px(d, cx + 1, cy, core);
  }
  speckle(d, rnd, [[255, 200, 80]], 0.03, 200);        // faint scattered glint
};

// Charred fungal block: crimson cap with lighter gills.
P.charfungus = (d, rnd) => {
  noisyFill(d, rnd, [104, 34, 34], 0.06);
  speckle(d, rnd, [[132, 46, 44], [76, 22, 24]], 0.18);
  for (let i = 0; i < 5; i++) {                         // pale radiating gills
    const cx = 2 + ((rnd() * 12) | 0), cy = 2 + ((rnd() * 12) | 0);
    line(d, cx, cy, cx + (rnd() < 0.5 ? -3 : 3), cy + (rnd() < 0.5 ? -2 : 2), [196, 148, 130]);
  }
  speckle(d, rnd, [[214, 172, 156]], 0.05);            // gill flecks
  speckle(d, rnd, [[40, 14, 16]], 0.06);               // char pores
};

// Refined dark basalt bricks with red heat glow in the cracks.
P.scorchbrick = (d, rnd) => {
  const mortar = [24, 18, 18], brickC = [58, 46, 46];
  for (let y = 0; y < W; y++) {
    const row = y >> 2, off = (row & 1) * 4;
    for (let x = 0; x < W; x++) {
      if ((y & 3) === 0 || (x + off) % 8 === 0) {       // mortar — glows faintly
        px(d, x, y, rnd() < 0.16 ? [150, 52, 24] : jitter(mortar, rnd, 0.1));
        continue;
      }
      const cell = ((x + off) >> 3) + row * 2;
      px(d, x, y, jitter(shade(brickC, 0.9 + (cell % 3) * 0.07), rnd, 0.06));
    }
  }
  speckle(d, rnd, [[200, 76, 32]], 0.02, 200);         // hot flecks in seams
};

// Portal rift to the Smolder: swirling molten orange/red energy.
P.rift_smolder = (d, rnd) => {
  const n = noiseGrid(rnd, 4);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const swirl = Math.sin((x - 7.5) * 0.5 + (y - 7.5) * 0.5 + n(x, y) * 6);
    const v = n(x, y) * 0.6 + swirl * 0.4;
    const c = v < -0.2 ? [128, 24, 12] : v < 0.2 ? [208, 72, 20]
      : v < 0.6 ? [248, 138, 40] : [255, 224, 128];
    px(d, x, y, jitter(c, rnd, 0.05));
  }
  speckle(d, rnd, [[255, 240, 170]], 0.05);            // bright sparks
  border(d, [80, 16, 8]);                              // dark rift edge
};

// ── The Hollow (pale echoing underworld) ──────────────────────────
// Cool bone-white / lilac stone with dark pits.
P.voidstone = (d, rnd) => {
  noisyFill(d, rnd, [206, 200, 214], 0.04);
  speckle(d, rnd, [[220, 214, 228], [186, 180, 200]], 0.16);
  speckle(d, rnd, [[168, 160, 182]], 0.08);
  for (let i = 0; i < 4; i++) {                         // dark pits
    const cx = 2 + rnd() * 12, cy = 2 + rnd() * 12, r = 0.9 + rnd();
    blob(d, rnd, cx, cy, r, r, [64, 58, 78], { light: [96, 88, 110], dark: [40, 36, 52] });
  }
};

// Pale violet moss over voidstone, top view — luminous lilac fuzz.
P.hollowmoss_top = (d, rnd) => {
  const n = noiseGrid(rnd, 4);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const v = n(x, y);
    const c = v > 0.72 ? [222, 196, 244] : v > 0.54 ? [190, 156, 224]
      : v > 0.36 ? [150, 120, 190] : [110, 88, 150];
    px(d, x, y, jitter(c, rnd, 0.05));
  }
  speckle(d, rnd, [[236, 216, 252]], 0.06);            // luminous fuzz tips
};

// Voidstone side with a band of violet moss overhanging the top edge.
P.hollowmoss_side = (d, rnd) => {
  P.voidstone(d, rnd);
  for (let x = 0; x < W; x++) {                         // uneven moss fringe
    const h = 3 + ((rnd() * 3) | 0);
    for (let y = 0; y < h; y++) {
      const c = y === h - 1 ? [150, 120, 190] : jitter([190, 156, 224], rnd, 0.07);
      px(d, x, y, c);
    }
    if (rnd() < 0.25) px(d, x, h, [166, 134, 202]);     // drip
    if (rnd() < 0.2) px(d, x, 0, [236, 216, 252]);      // bright tip
  }
};

// Translucent violet-tinted glass with a pale frame.
P.voidglass = (d, rnd) => {
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++)
    px(d, x, y, jitter([196, 176, 226], rnd, 0.03), 150);
  for (let i = 0; i < W; i++) {                         // diagonal shine
    const x = 11 - i, y = i;
    px(d, x, y, [244, 236, 255], 190); px(d, x + 1, y, [244, 236, 255], 140);
  }
  border(d, [224, 212, 244], 235);                     // pale frame
};

// Portal rift to the Hollow: swirling violet / starlight energy.
P.rift_hollow = (d, rnd) => {
  const n = noiseGrid(rnd, 4);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const swirl = Math.sin((x - 7.5) * 0.5 - (y - 7.5) * 0.5 + n(x, y) * 6);
    const v = n(x, y) * 0.6 + swirl * 0.4;
    const c = v < -0.2 ? [58, 30, 84] : v < 0.2 ? [110, 62, 168]
      : v < 0.6 ? [166, 120, 220] : [226, 210, 252];
    px(d, x, y, jitter(c, rnd, 0.05));
  }
  for (let i = 0; i < 6; i++)                           // starlight glimmers
    px(d, 1 + ((rnd() * 14) | 0), 1 + ((rnd() * 14) | 0), [255, 255, 255], 220);
  border(d, [40, 22, 60]);                             // dark rift edge
};

// Triumphant beacon: golden radiant core in a pale sunstone frame.
P.dawn_beacon = (d, rnd) => {
  noisyFill(d, rnd, [244, 232, 196], 0.04);            // pale sunstone frame
  speckle(d, rnd, [[255, 246, 214]], 0.1);
  border(d, [206, 176, 108]);
  hline(d, 0, 15, 1, [255, 250, 226]);                 // bevel highlight
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const r = Math.hypot(x - 7.5, y - 7.5);
    if (r > 5.4) continue;                              // radiant core
    const c = r < 1.6 ? [255, 255, 236] : r < 3 ? [255, 236, 150]
      : r < 4.4 ? [255, 206, 96] : [246, 176, 68];
    px(d, x, y, jitter(c, rnd, 0.04));
  }
  for (const [x, y] of [[7, 1], [8, 1], [1, 7], [14, 7], [7, 14], [8, 14]])
    px(d, x, y, [255, 250, 220], 220);                 // emanating rays
  px(d, 7, 7, [255, 255, 255]); px(d, 8, 8, [255, 255, 255]);
};

// ── Item sprites (transparent background) ─────────────────────────
// Jagged glowing ember-orange crystal shard.
P.smolder_shard = (d, rnd) => {
  const body = [230, 108, 36], edge = [150, 52, 18], hot = [255, 220, 130];
  const col = [                                         // per-column [y0,y1]
    [8, 9], [6, 11], [5, 12], [3, 13], [4, 12], [6, 10], [7, 9],
  ];
  for (let i = 0; i < col.length; i++) {
    const x = 5 + i, [y0, y1] = col[i];
    for (let y = y0; y <= y1; y++) {
      const c = x <= 6 ? shade(body, 1.14) : x >= 10 ? edge : body;
      px(d, x, y, jitter(c, rnd, 0.06));
    }
    px(d, x, y0, edge);                                 // dark upper facet
  }
  vline(d, 6, 5, 12, hot);                              // bright inner spine
  px(d, 6, 4, [255, 244, 200]); px(d, 7, 3, [255, 244, 200]); // sparkling tip
  px(d, 5, 7, hot); px(d, 8, 10, [255, 176, 90]);      // glints
};

// Sun-gold metal ingot — same form language as ingotPainter.
P.sunsteel_ingot = ingotPainter([255, 205, 110]);

// Boss trophy: ornate dark-violet orb with a glowing pale core.
P.sovereign_core = (d, rnd) => {
  blob(d, rnd, 8, 8.5, 5, 4.8, [72, 40, 96], { light: [116, 76, 148], dark: [40, 20, 60] });
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { // glowing pale core
    const r = Math.hypot(x - 8, y - 8.5);
    if (r > 2.4) continue;
    px(d, x, y, r < 1 ? [244, 236, 255] : r < 1.8 ? [206, 176, 240] : [166, 130, 210]);
  }
  for (const [x, y] of [[4, 5], [12, 5], [4, 12], [12, 12]]) // ornate gold studs
    px(d, x, y, [222, 186, 96]);
  line(d, 5, 4, 11, 4, [150, 108, 190], 200);          // banded filigree
  px(d, 6, 6, [214, 194, 244], 220);                   // rim sheen
};

// Striker tool: curved steel striker + flint chip, with sparks.
P.kindle_flint = (d, rnd) => {
  const steel = [176, 182, 190], steelD = shade(steel, 0.68), steelL = shade(steel, 1.22);
  const arc = [[4, 6], [3, 7], [3, 8], [4, 9], [5, 10], [6, 11], [7, 11]]; // striker curve
  for (const [x, y] of arc) { px(d, x, y, steel); px(d, x, y + 1, steelD); px(d, x - 1, y, steelL); }
  px(d, 4, 5, WOOD_D); px(d, 3, 6, WOOD_D);            // wooden grip end
  for (const [x, y] of [[10, 8], [11, 8], [10, 9], [11, 9], [12, 9], [11, 10]]) // flint chip
    px(d, x, y, jitter([64, 60, 72], rnd, 0.1));
  px(d, 12, 8, [96, 92, 104]);                         // flint edge
  for (const [x, y, a] of [[13, 6, 255], [14, 5, 200], [12, 5, 180], [13, 4, 150]])
    px(d, x, y, [255, 226, 120], a);                   // sparks
  px(d, 13, 7, [255, 176, 60], 220);
};

// ── Clay vessel + fills ───────────────────────────────────────────
const VESSEL_C = [178, 108, 72], VESSEL_D = [128, 74, 48], VESSEL_L = [206, 138, 96];

// Shared terracotta body; `fill` optional inner liquid painter (d, rnd).
function paintVessel(d, rnd, inner) {
  for (let y = 3; y <= 14; y++) for (let x = 3; x <= 12; x++) {
    const r = Math.hypot((x - 7.5) / 4.4, (y - 9) / 5);
    if (r > 1) continue;
    const c = x <= 5 ? VESSEL_L : x >= 11 ? VESSEL_D : jitter(VESSEL_C, rnd, 0.06);
    px(d, x, y, c);
  }
  hline(d, 4, 11, 3, VESSEL_L); hline(d, 4, 11, 4, VESSEL_C); // flared rim
  px(d, 3, 4, VESSEL_D); px(d, 12, 4, VESSEL_D);
  hline(d, 5, 10, 5, [40, 26, 20]);                    // mouth interior
  if (inner) inner(d, rnd);                            // liquid surface
  px(d, 5, 7, VESSEL_L);                               // clay highlight
}

P.clay_vessel = (d, rnd) => paintVessel(d, rnd, null);

P.vessel_water = (d, rnd) => paintVessel(d, rnd, () => {
  for (let y = 5; y <= 7; y++) hline(d, 5, 10, y, [48, 108, 176], 235);
  hline(d, 5, 10, 5, [96, 156, 214], 235);             // rippling surface
  px(d, 7, 6, [150, 200, 240], 235); px(d, 9, 7, [70, 130, 194], 235);
});

P.vessel_lava = (d, rnd) => paintVessel(d, rnd, () => {
  for (let y = 5; y <= 7; y++) hline(d, 5, 10, y, [222, 96, 24]);
  hline(d, 5, 10, 5, [255, 178, 60]);                  // glowing surface
  px(d, 7, 6, [255, 232, 130]); px(d, 9, 7, [190, 64, 16]);
  px(d, 6, 6, [255, 208, 96], 235);                    // ember glint
});

// ── Mod textures ─────────────────────────────────────────────────
// Mods register either a painter function (d, rnd) => void, or a
// declarative spec (see specPainter). Must run before buildAtlas().
const MOD_PAINTERS = new Map();

const hex2rgb = (h) => {
  const s = String(h).replace('#', '');
  const v = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

// spec: {base:'#hex', alpha?, speckle?:['#hex',...], speckleDensity?,
//        rim?:'#hex', glow?:boolean} | {plant:{stem,bloom,center}}
function specPainter(spec) {
  return (d, rnd) => {
    if (spec.plant) {
      const stem = hex2rgb(spec.plant.stem ?? '#4a7a3c');
      const bloom = hex2rgb(spec.plant.bloom ?? '#d8d8ff');
      const center = hex2rgb(spec.plant.center ?? '#fff2c8');
      vline(d, 8, 7, 15, stem);
      px(d, 7, 10, stem); px(d, 9, 9, stem);
      blob(d, rnd, 8, 5, 3, 2.6, bloom, {});
      px(d, 8, 5, center); px(d, 7, 5, center); px(d, 8, 4, center);
      return;
    }
    const base = hex2rgb(spec.base ?? '#888888');
    const alpha = spec.alpha ?? 255;
    noisyFill(d, rnd, base, 0.07, alpha);
    if (spec.speckle) {
      speckle(d, rnd, spec.speckle.map(hex2rgb), spec.speckleDensity ?? 0.12, alpha);
    }
    if (spec.glow) {
      blob(d, rnd, 8, 8, 3.2, 3.2, shade(base, 1.45), {});
      px(d, 8, 8, [255, 255, 240], Math.min(255, alpha + 70));
    }
    if (spec.rim) border(d, hex2rgb(spec.rim), 255);
  };
}

export function registerTexture(key, painterOrSpec) {
  if (P[key] || MOD_PAINTERS.has(key)) {
    throw new Error(`atlas: texture key "${key}" already exists`);
  }
  MOD_PAINTERS.set(key,
    typeof painterOrSpec === 'function' ? painterOrSpec : specPainter(painterOrSpec));
}

// ── Atlas assembly ────────────────────────────────────────────────
// The block/item set was renamed to familiar names, but the procedural
// painters in `P` are still keyed by their original names. This maps the
// new texture keys back to the painter that draws them; paints seed with
// the resolved (original) key so textures stay pixel-identical.
const TEX_ALIAS = {
  bedrock: 'corestone', dirt: 'soil', grass_block_top: 'grass_top',
  grass_block_side: 'grass_side', oak_log_end: 'alder_log_end', oak_log: 'alder_log',
  oak_leaves: 'alder_leaves', spruce_log_end: 'fern_log_end', spruce_log: 'fern_log',
  spruce_leaves: 'fern_leaves', oak_planks: 'planks', bricks: 'brick',
  glow_lichen: 'glowmoss', diamond_ore: 'sunstone_ore', crafting_table_top: 'worktable_top',
  crafting_table_side: 'worktable_side', furnace_top: 'kiln_top', furnace_side: 'kiln_side',
  furnace_front: 'kiln_front', short_grass: 'tallgrass', poppy: 'emberbloom',
  cornflower: 'azurebell', dead_bush: 'deadbush', cactus_top: 'spineplant_top',
  cactus: 'spineplant', sweet_berry_bush: 'berrybush', sweet_berry_bush_ripe: 'berrybush_ripe',
  sandstone_top: 'duststone_top', sandstone: 'duststone', diamond_block: 'sunstone_block',
  stone_bricks: 'hewnstone', mossy_cobblestone: 'mossrock', obsidian: 'basalt',
  vines: 'vine', cobblestone: 'rubble', oak_sapling: 'alder_sprout',
  spruce_sapling: 'fern_sprout', torch: 'wisp_torch', ladder: 'rungs',
  bed_top: 'bedroll_top', bed_side: 'bedroll_side', chest_top: 'stowbox_top',
  chest_side: 'stowbox_side', chest_front: 'stowbox_front', netherrack: 'scorchstone',
  soul_sand: 'emberash', glowstone: 'glowvein_ore', nether_wart_block: 'charfungus',
  nether_bricks: 'scorchbrick', nether_portal: 'rift_smolder', end_stone: 'voidstone',
  end_moss_top: 'hollowmoss_top', end_moss_side: 'hollowmoss_side', end_glass: 'voidglass',
  end_portal: 'rift_hollow', beacon: 'dawn_beacon', oak_door: 'timber_door',
  iron_door: 'ironbound_door', oak_trapdoor: 'timber_flap', iron_trapdoor: 'ironbound_flap',
  wooden_pickaxe: 'pick_timber', wooden_axe: 'axe_timber', wooden_shovel: 'shovel_timber',
  wooden_hoe: 'hoe_timber', wooden_sword: 'blade_timber', stone_pickaxe: 'pick_stone',
  stone_axe: 'axe_stone', stone_shovel: 'shovel_stone', stone_hoe: 'hoe_stone',
  stone_sword: 'blade_stone', copper_pickaxe: 'pick_copper', copper_axe: 'axe_copper',
  copper_shovel: 'shovel_copper', copper_hoe: 'hoe_copper', copper_sword: 'blade_copper',
  iron_pickaxe: 'pick_iron', iron_axe: 'axe_iron', iron_shovel: 'shovel_iron',
  iron_hoe: 'hoe_iron', iron_sword: 'blade_iron', netherite_pickaxe: 'pick_sunsteel',
  netherite_axe: 'axe_sunsteel', netherite_shovel: 'shovel_sunsteel', netherite_hoe: 'hoe_sunsteel',
  netherite_sword: 'blade_sunsteel', stick: 'rod', clay_ball: 'clay_lump',
  raw_copper: 'copper_ore_chunk', raw_iron: 'iron_ore_chunk', diamond: 'sunstone',
  leather: 'hide', glowstone_dust: 'glimmer_dust', seeds: 'tuber_seed',
  netherite_scrap: 'smolder_shard', netherite_ingot: 'sunsteel_ingot', dragon_core: 'sovereign_core',
  flint_and_steel: 'kindle_flint', bucket: 'clay_vessel', water_bucket: 'vessel_water',
  lava_bucket: 'vessel_lava', sweet_berries: 'berries', potato: 'tuber',
  baked_potato: 'tuber_roast', raw_porkchop: 'meat_raw', cooked_porkchop: 'meat_roast',
};

function paintKey(key) {
  let painter = P[key] ?? MOD_PAINTERS.get(key);
  let seedKey = key;
  if (!painter) {
    const a = TEX_ALIAS[key];
    if (a) { painter = P[a] ?? MOD_PAINTERS.get(a); seedKey = a; }
  }
  if (!painter) throw new Error(`atlas: no painter for texture key "${key}"`);
  const d = new Uint8ClampedArray(W * W * 4);
  painter(d, mulberry32(normalizeSeed(seedKey)));
  return d;
}

export function buildAtlas() {
  const layers = [];
  const index = new Map();
  const keys = [...allTextureKeys(), ...spriteItemKeys(), 'rain', 'snowflake', ...MOD_PAINTERS.keys()];
  for (const key of keys) {
    if (index.has(key)) continue;
    index.set(key, layers.length);
    layers.push({ data: paintKey(key), width: W, height: W });
  }

  function layerOf(key) {
    const i = index.get(key);
    if (i === undefined) throw new Error(`atlas: unknown texture key "${key}"`);
    return i;
  }

  // 16x16 canvas of a layer, rgb multiplied by f (for shaded cube faces).
  const texCanvases = new Map();
  function texCanvas(key, f = 1) {
    const ck = `${key}|${f}`;
    let cv = texCanvases.get(ck);
    if (cv) return cv;
    const src = layers[layerOf(key)].data;
    const data = new Uint8ClampedArray(src);
    if (f !== 1) {
      for (let i = 0; i < data.length; i += 4) {
        data[i] *= f; data[i + 1] *= f; data[i + 2] *= f;
      }
    }
    cv = document.createElement('canvas');
    cv.width = cv.height = W;
    cv.getContext('2d').putImageData(new ImageData(data, W, W), 0, 0);
    texCanvases.set(ck, cv);
    return cv;
  }

  // Small isometric cube: top diamond + two skewed, darkened side faces.
  function drawCube(ctx, block) {
    ctx.imageSmoothingEnabled = false;
    const top = faceTexKey(block, 2);
    const right = faceTexKey(block, 0);               // +x
    const left = faceTexKey(block, 4);                // +z (kiln front etc.)
    ctx.setTransform(15 / 16, 7.5 / 16, -15 / 16, 7.5 / 16, 18, 3);
    ctx.drawImage(texCanvas(top), 0, 0);
    ctx.setTransform(15 / 16, 7.5 / 16, 0, 15 / 16, 3, 10.5);
    ctx.drawImage(texCanvas(left, 0.8), 0, 0);
    ctx.setTransform(15 / 16, -7.5 / 16, 0, 15 / 16, 18, 18);
    ctx.drawImage(texCanvas(right, 0.62), 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  const iconCache = new Map();
  function iconFor(itemKey) {
    const hit = iconCache.get(itemKey);
    if (hit) return hit;
    const it = itemByKey(itemKey);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 36;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const block = it && it.kind === 'block' ? blockById(it.block) : null;
    if (block && !block.cross) {
      drawCube(ctx, block);
    } else {
      const key = block ? faceTexKey(block, 0) : it ? it.icon : itemKey;
      ctx.drawImage(texCanvas(key), 2, 2, 32, 32);    // nearest-neighbor 2x
    }
    const url = cv.toDataURL('image/png');
    iconCache.set(itemKey, url);
    return url;
  }

  return { layers, layerOf, iconFor };
}
