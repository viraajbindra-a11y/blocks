# BLOCKS Modding Guide

BLOCKS has a first-class, data-driven mod system. Mods can add blocks, items,
recipes, textures, and worldgen decorations, and react to game events —
all from a single dependency-free JavaScript file.

## Installing mods

Put mod files in the `mods/` folder and list them in `mods/index.json`:

```json
{ "mods": ["emberglass.js", "wildgarden.js"] }
```

Mods load at boot, in list order. The **Mods** button on the title screen
shows what loaded (and any load errors).

For the single-file build, `tools/build.mjs` inlines every listed mod into
`dist/blocks-standalone.html` automatically. You can also inject mods into
any build from the console/HTML before the game script runs:

```html
<script>window.BLOCKS_MODS = [`export default { id:'my-mod', init(api){...} }`];</script>
```

## Writing a mod

A mod is an ES module with **no imports** — the entire game surface arrives
through the `api` parameter (this keeps mods loadable from any build):

```js
export default {
  id: 'my-mod',            // unique, stable — used for world compatibility
  name: 'My Mod',
  version: '1.0',
  init(api) {
    // register content, subscribe to events
  },
};
```

## API reference

### `api.registerBlock(key, name, props) → blockId`

Registers a block, its inventory item, and its texture in one call.

```js
api.registerBlock('emberglass', 'Emberglass', {
  solid: true,          // collides with entities
  opaque: false,        // false = light passes / neighbor faces render
  translucent: true,    // rendered in the transparent pass
  cross: false,         // true = X-shaped plant quads
  light: 11,            // emitted light 0-15
  hardness: 0.6,        // seconds to break bare-handed
  tool: 'pick',         // 'pick'|'axe'|'shovel'|'hoe'|null
  minTier: 0,           // 0 hand · 1 timber · 2 stone · 3 copper · 4 iron
  drops: 'self',        // 'self' | [] | [{item, min, max, chance}]
  sound: 'glass',       // stone|soft|wood|sand|snow|glass|metal|plant
  sway: false,          // vegetation wind animation
  climbable: false,
  replaceable: false,   // placing into this cell overwrites it
  lightOpacity: 0,      // extra light absorption for non-opaque blocks
  placeOnKeys: ['grass', 'soil'],   // placement rule (block keys)
  texture: {...} | (pixels, rng) => {},        // one texture for all faces
  textures: { top: {...}, bottom: {...}, side: {...} },  // or per-face
  noItem: true,         // skip the auto inventory item
});
```

**Texture specs** are declarative 16×16 pixel-art descriptors:

```js
{ base: '#c97a2e',                  // fill color (auto value-noise)
  alpha: 165,                       // 0-255 (translucent blocks)
  speckle: ['#ffd27a', '#e8a13c'],  // scatter colors
  speckleDensity: 0.1,
  rim: '#ffe9c0',                   // 1px border
  glow: true }                      // bright center blob

{ plant: { stem: '#4a7a3c', bloom: '#cdd6ff', center: '#fff6cf' } }
```

Or full control: pass a painter `function (d, rng)` where `d` is a
`Uint8ClampedArray` of 16×16 RGBA pixels (deterministic `rng` provided).

### `api.registerItem(key, name, props) → item`

Non-block items: `{ maxStack, food: {restore}, desc, texture }`.

### `api.registerRecipe(recipe)`

```js
// Shaped (pattern rows; letters map to item keys or [alternatives]):
api.registerRecipe({ out: 'emberglass', count: 4,
  pattern: ['GG', 'GS'], keys: { G: 'glass', S: 'sunstone' },
  station: 'worktable' });          // null = pocket 2×2, or 'worktable' | 'kiln'

// Shapeless:
api.registerRecipe({ out: 'glimmer_dust', ingredients: ['moonbell', 'moonbell'] });
```

### `api.addSurfaceDecoration(deco)`

Deterministic worldgen scatter, applied by the generation workers:

```js
api.addSurfaceDecoration({
  biomes: ['plains', 'forest'],   // or api.biomes ids
  block: 'moonbell',
  chance: 0.012,                  // per surface column
  placeOn: ['grass'],             // optional surface filter
});
```

### `api.on(event, handler)`

| Event | Payload |
| --- | --- |
| `worldLoaded` | `{seed, mode}` |
| `tick` | `dt` (seconds, each sim frame) |
| `blockBroken` | `{x, y, z, id, key}` |
| `blockPlaced` | `{x, y, z, id, key}` |
| `playerDamage` | `{amount, cause}` |

### Utilities

- `api.biomes` — `{OCEAN, BEACH, PLAINS, FOREST, DESERT, SWAMP, TUNDRA, MOUNTAIN, RIVER}`
- `api.blockId(key)` / `api.blockByKey(key)` / `api.itemByKey(key)`
- `api.log(...)` — prefixed console logging

## Compatibility rules

- Block ids 210-255 are assigned to mods **in registration order**. Worlds
  store raw ids, so keep your mod list and order stable for a world.
  Each world remembers its mod list and warns when it changes.
- Removing a mod is safe: its blocks degrade to air; its items vanish
  from inventories on next interaction.
- Mod ids must be unique; duplicate ids refuse to load.

## Current limits (v1)

- No custom creatures or tools-with-new-behaviors yet (planned surface).
- Worldgen hooks are declarative scatter only — no custom cave/terrain code
  (generation runs in workers; arbitrary code doesn't cross that boundary).
- No inter-mod dependencies or load ordering beyond index.json order.

See `mods/emberglass.js` and `mods/wildgarden.js` for working examples.
