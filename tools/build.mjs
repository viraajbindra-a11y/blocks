#!/usr/bin/env node
// Build the single-file distributable: dist/blocks-standalone.html
// Everything (engine, worker, styles, procedural assets) inlined — the
// file runs from a double-click (file://) or any static host.
//
// Usage: node tools/build.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// JSON payloads land inside a script tag: a literal close-script sequence
// (or an HTML comment opener) in any bundled source — e.g. a user mod —
// would terminate the tag and corrupt the page. Escaping every "<" as a
// unicode escape is valid JSON and defuses both.
const inlineJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

const esbuild = (entry) =>
  execFileSync('npx', [
    '-y', 'esbuild', join(root, entry),
    '--bundle', '--format=iife', '--minify',
    '--target=es2021', '--legal-comments=none',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

console.log('· bundling worker…');
const workerJs = esbuild('src/workers/genWorker.js');
console.log('· bundling main…');
const mainJs = esbuild('src/main.js');

// Inline every mod listed in mods/index.json as source strings; the mod
// loader imports them from blob: URLs at runtime.
let modSources = [];
try {
  const idx = JSON.parse(readFileSync(join(root, 'mods', 'index.json'), 'utf8'));
  modSources = (idx.mods || []).map((p) => readFileSync(join(root, 'mods', p), 'utf8'));
  console.log(`· inlining ${modSources.length} mod(s)`);
} catch {
  console.log('· no mods/index.json — building without mods');
}

const css = readFileSync(join(root, 'styles.css'), 'utf8') + '\n' +
            readFileSync(join(root, 'styles-game.css'), 'utf8');

// Body markup mirrors index.html (kept in sync manually — small surface).
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BLOCKS — a boundless voxel wilderness</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect x='1' y='6' width='14' height='9' fill='%236b4a2f'/><rect x='1' y='4' width='14' height='3' fill='%235d8a3c'/></svg>">
<style>
${css}
</style>
</head>
<body>
  <canvas id="gl"></canvas>
  <div id="hud" class="hidden"></div>
  <div id="screens"></div>
  <div id="toasts"></div>
  <div id="vignette"></div>
  <div id="damage-flash"></div>
  <div id="water-tint"></div>
  <noscript>BLOCKS requires JavaScript.</noscript>
  <script>window.__BLOCKS_WORKER_SRC = window.__LOAM_WORKER_SRC = ${inlineJson(workerJs)};
window.BLOCKS_MODS = ${inlineJson(modSources)};</script>
  <script>
${mainJs}
  </script>
</body>
</html>
`;

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', 'blocks-standalone.html');
writeFileSync(out, html);
console.log(`✓ ${out} (${(html.length / 1024).toFixed(0)} KB)`);
