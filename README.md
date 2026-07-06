# BLOCKS — a boundless voxel wilderness

**▶ [Play in your browser](https://viraajbindra-a11y.github.io/blocks/)** · or grab
[`dist/blocks-standalone.html`](dist/blocks-standalone.html) — the whole game in one downloadable file.

An original, fully self-contained voxel sandbox game for the browser.
Infinite procedural worlds, mining, crafting, farming, wildlife, weather,
day/night, survival — with **every texture, sound, and system generated
procedurally from code**. Zero dependencies, zero asset files, no build step.

> BLOCKS is inspired by the spirit of exploration-and-crafting sandboxes, but
> everything here — code, art, audio, UI, names, creatures — is original.

## Running

Any static file server works (ES modules need `http://`):

```bash
cd loam
python3 -m http.server 8642
# → http://localhost:8642
```

**Single-file build:** `node tools/build.mjs` produces
`dist/blocks-standalone.html` — one downloadable HTML file containing the
entire game (worker inlined as a blob). Double-click to play.

Requirements: a recent Chrome, Edge, Firefox, or Safari (WebGL2 + Web Audio
+ IndexedDB). Worlds save to your browser's IndexedDB.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move |
| `Mouse` | Look |
| `Space` | Jump / swim up (double-tap in Builder: toggle flight) |
| `Shift` | Crouch / sneak (won't fall off edges) / climb down |
| `Ctrl` | Sprint |
| `Left mouse` | Mine block / attack |
| `Right mouse` | Place block / use (worktable, kiln, berry bush) / eat |
| `Middle mouse` | Pick targeted block |
| `1–9`, wheel | Hotbar |
| `E` | Inventory / crafting |
| `Q` | Drop one item |
| `Esc` | Pause |

## Game modes

- **Journey** — survival: health, hunger, air, fall damage, tools with
  durability, tiered progression (timber → stone → copper → iron).
- **Builder** — creative: unlimited blocks, flight, instant breaking, no danger.

## Progression sketch

Punch a tree → planks → **worktable** (4 planks) → timber tools → mine stone
(rubble) → **stone kiln** (8 rubble) → smelt with coal → copper → iron.
Farm tubers on tilled soil, harvest bramble berries, hunt bristlebacks for
meat and hide, catch glimmer dust from embermoths at night for lanterns.
Deep down: glowing sunstone (needs an iron pick).

Then the realms open up. Craft a **kindle flint** (iron + rubble), build a
frame of **basalt** (quenched from lava, or mined deep) and strike it: a
rift to **the Smolder** tears open — a sealed underworld of lava seas,
emberash dunes, glowvein light, and hostile cinderlings. Smolder shards
forge **sunsteel**, the finest tool tier. A frame of **sunstone blocks**
opens the way to **the Hollow**: pale islands over a starlit void, home of
**the Hollow Sovereign**. Fell it, take its core, and raise a
**Dawn Beacon**.

Along the way: **wisp torches** for cheap light, **timber rungs** to climb,
a **bedroll** to set your spawn and sleep past dangerous nights (a
gloomstalker prowls the dark), **stowboxes** for storage, and **clay
vessels** to carry water and lava. Nights are no longer safe.

## Architecture

```
loam/
├─ index.html               entry (canvas + UI roots)
├─ styles.css               design system + menus
├─ styles-game.css          HUD + inventory
├─ tools/build.mjs          single-file bundler (esbuild via npx)
└─ src/
   ├─ main.js               game state machine + main loop + wiring
   ├─ blocks.js             block registry (210 blocks incl. shaped families: physics/light/sound/drops)
   ├─ items.js              item registry (tools/materials/food)
   ├─ crafting.js           data-driven shaped/shapeless/kiln recipes
   ├─ core/
   │  ├─ constants.js       world dimensions, physics, tuning
   │  ├─ config.js          persistent settings
   │  └─ input.js           keyboard/mouse + pointer lock
   ├─ math/
   │  ├─ noise.js           seeded simplex 2D/3D, fBm, ridge, PRNG, hashes
   │  └─ mat4.js            matrices, frustum planes, camera basis
   ├─ world/
   │  ├─ world.js           chunk streaming, edits, ticks, raycast, saves
   │  ├─ chunk.js           16×128×16 columns, 8 render sections
   │  ├─ lighting.js        BFS flood-fill sky+block light (4bit+4bit)
   │  ├─ fluids.js          cellular water/lava flow + quenching
   │  └─ gen/
   │     ├─ terrain.js      biomes, height blending, rivers, caves,
   │     │                  ravines, ores, decoration (deterministic per seed)
   │     └─ features.js     tree shapes (shared worker ↔ runtime regrowth)
   ├─ workers/genWorker.js  chunk generation worker (pool of 2-4)
   ├─ render/
   │  ├─ renderer.js        pass orchestration, frustum culling, env/sky palette
   │  ├─ mesher.js          greedy meshing + AO + per-face light
   │  ├─ shaders.js         GLSL (chunk/sky/clouds/particles/entities/…)
   │  ├─ atlas.js           procedural 16×16 texture array + item icons
   │  ├─ particles.js       CPU particles (debris, rain, snow)
   │  └─ gl.js              WebGL2 helpers
   ├─ player/
   │  ├─ player.js          AABB physics, swim/climb/sneak, survival stats, inventory
   │  └─ interaction.js     raycast mining/placing, stations, farming, melee
   ├─ entities/entities.js  wildlife AI (bristleback, mosshopper, embermoth) + item drops
   ├─ audio/audio.js        synthesized SFX + ambient beds + generative music
   ├─ weather.js            clear/cloudy/rain/storm, lightning, precipitation
   ├─ save/store.js         IndexedDB worlds + RLE chunk persistence
   └─ ui/                   menus, HUD, inventory/crafting (vanilla DOM)
```

### Engine notes

- **Chunks** are 16×128×16 columns split into eight 16³ render sections.
  Generation runs in a worker pool; lighting waits for the 4-neighborhood,
  meshing for the 8-neighborhood, so borders are always seamless.
- **Meshing** is greedy: coplanar faces with identical texture/light/AO
  merge into single quads; UVs tile via `TEXTURE_2D_ARRAY` + `REPEAT`.
  Baked per-vertex AO with anisotropy-corrected triangulation.
- **Light** is 4-bit sky + 4-bit block per voxel, BFS propagation with
  incremental add/remove on edits. Day/night scales sky light in-shader;
  block light is warm-tinted.
- **Culling**: frustum culling per section AABB, empty-section skip,
  face culling, distance fog matched to render distance.
- **Performance**: meshing/lighting budgeted per frame (time-sliced),
  scratch-buffer reuse in the mesher, one draw call per section per pass,
  DOM HUD updates throttled to 10 Hz.
- **Saving**: only player-modified chunks persist (RLE ≈ 200–800 bytes per
  chunk); untouched terrain regenerates deterministically from the seed.
- **Determinism**: identical seeds produce identical worlds regardless of
  exploration order (integer coordinate hashing for features).

## Mods

BLOCKS ships with a first-class mod system — see **[docs/MODDING.md](docs/MODDING.md)**.
Mods are single dependency-free JS files that register blocks, items,
recipes, textures (declarative pixel-art specs or painter functions),
worldgen decorations, and event handlers:

```js
export default {
  id: 'my-mod', name: 'My Mod', version: '1.0',
  init(api) {
    api.registerBlock('emberglass', 'Emberglass', {
      translucent: true, light: 11, sound: 'glass',
      texture: { base: '#c97a2e', alpha: 165, glow: true, rim: '#ffe9c0' },
    });
    api.registerRecipe({ out: 'emberglass', count: 4,
      pattern: ['GG', 'GS'], keys: { G: 'glass', S: 'sunstone' }, station: 'worktable' });
    api.addSurfaceDecoration({ biomes: ['plains'], block: 'emberglass', chance: 0.001 });
    api.on('blockBroken', (e) => api.log('broke', e.key));
  },
};
```

Drop the file in `mods/`, list it in `mods/index.json`, done. Two example
mods ship enabled: **Emberglass** (glowing translucent block) and
**Wild Garden** (moonbell night-flowers generated across meadows).
The standalone build inlines all listed mods automatically. Worlds remember
their mod list and warn when it changes.

## Extending the engine itself

- New vanilla block: add to `blocks.js` (+ a painter in `atlas.js`) —
  physics, lighting, meshing, items, and saving pick it up automatically.
- New recipe: one line in `crafting.js`.
- New creature: a species entry in `entities/entities.js` (parts + AI hooks).
- World tuning: every knob lives in `core/constants.js` and `gen/terrain.js`.
