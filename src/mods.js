// BLOCKS modding: loader + the API object handed to each mod.
//
// A mod is a dependency-free ES module:
//
//   export default {
//     id: 'my-mod', name: 'My Mod', version: '1.0',
//     init(api) { ...register content, subscribe to events... },
//   };
//
// Discovery order:
//   1. window.BLOCKS_MODS — array of module source strings (used by the
//      single-file build; also handy for pasting mods into the console).
//      window.LOAM_MODS is honored as a legacy alias.
//   2. mods/index.json — {"mods": ["file.js", ...]} next to index.html.
//
// Mods must not import game modules; everything arrives via `api` so mod
// code stays loadable from blob: URLs in any build.

import { B, BLOCKS, registerBlock, blockIdByKey, blockById } from './blocks.js';
import { registerItem, itemByKey } from './items.js';
import { registerShaped, registerShapeless } from './crafting.js';
import { registerTexture } from './render/atlas.js';
import { refreshLightOpacity } from './world/lighting.js';
import { BIOME } from './world/gen/terrain.js';

export class Mods {
  constructor() {
    this.list = [];          // {id, name, version, error?}
    this.decorations = [];   // plain data for gen workers
    this.handlers = new Map();
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }

  emit(event, payload) {
    const hs = this.handlers.get(event);
    if (!hs) return;
    for (const fn of hs) {
      try { fn(payload); }
      catch (e) { console.error(`BLOCKS mod handler for "${event}" threw`, e); }
    }
  }

  ids() { return this.list.filter((m) => !m.error).map((m) => m.id); }

  // The surface a mod sees. Everything is by string key; raw ids only leak
  // out (never in) so mods stay order-independent.
  apiFor(modId) {
    const mods = this;
    const toBlockId = (v) => typeof v === 'string' ? blockIdByKey(v) : v;
    return {
      version: 1,
      biomes: Object.freeze({ ...BIOME }),
      blockId: (key) => blockIdByKey(key),
      blockByKey: (key) => blockById(blockIdByKey(key)),
      itemByKey: (key) => itemByKey(key),

      /**
       * Register a block (+ its item, + its texture).
       * props: standard block registry fields (solid, opaque, cross, light,
       * hardness, tool, minTier, drops, sound, sway, translucent,
       * climbable, replaceable, lightOpacity) plus:
       *   texture: painter fn | spec object       (single all-faces texture)
       *   textures: {top, bottom, side}           (each a painter/spec)
       *   placeOnKeys: ['grass', ...]             (string form of placeOn)
       *   noItem: true                            (skip item registration)
       */
      registerBlock(key, name, props = {}) {
        const { texture, textures, placeOnKeys, noItem, ...blockProps } = props;
        if (texture) {
          registerTexture(key, texture);
          blockProps.tex = { all: key };
        } else if (textures) {
          const tex = {};
          for (const face of Object.keys(textures)) {
            const tkey = `${key}_${face}`;
            registerTexture(tkey, textures[face]);
            tex[face] = tkey;
          }
          blockProps.tex = tex;
        }
        if (placeOnKeys) blockProps.placeOn = placeOnKeys.map(toBlockId);
        const id = registerBlock(key, name, blockProps);
        if (!noItem) {
          registerItem(key, name, {
            kind: 'block', block: id,
            icon: blockProps.tex?.all ?? blockProps.tex?.side ?? key,
          });
        }
        return id;
      },

      /** Register a non-block item. props: {maxStack, food:{restore}, texture, desc} */
      registerItem(key, name, props = {}) {
        const { texture, ...itemProps } = props;
        if (texture) registerTexture(key, texture);
        return registerItem(key, name, { icon: key, ...itemProps });
      },

      /**
       * Shaped: {out, count?, pattern:['GG','GS'], keys:{G:'glass',...}, station?}
       * Shapeless: {out, count?, ingredients:['a','b'], station?}
       */
      registerRecipe(r) {
        if (r.pattern) registerShaped(r.out, r.count ?? 1, r.pattern, r.keys, r.station ?? null);
        else registerShapeless(r.out, r.count ?? 1, r.ingredients, r.station ?? null);
      },

      /**
       * Deterministic worldgen surface scatter.
       * {biomes:['plains','forest']|ids, block:'key'|id, chance:0..1,
       *  placeOn:['grass']|ids (optional)}
       */
      addSurfaceDecoration(d) {
        mods.decorations.push({
          biomes: (d.biomes || []).map((b) =>
            typeof b === 'string' ? BIOME[b.toUpperCase()] : b).filter((b) => b !== undefined),
          blockId: toBlockId(d.block),
          chance: d.chance ?? 0.01,
          placeOn: d.placeOn ? d.placeOn.map(toBlockId) : null,
        });
      },

      /**
       * Game events: 'worldLoaded' {seed, mode} · 'tick' dt ·
       * 'blockBroken' {x,y,z,id,key} · 'blockPlaced' {x,y,z,id,key} ·
       * 'playerDamage' {amount, cause}
       */
      on(event, fn) { mods.on(event, fn); },

      log: (...args) => console.log(`[mod:${modId}]`, ...args),
    };
  }
}

async function discoverSources() {
  const inline = typeof window !== 'undefined'
    ? (window.BLOCKS_MODS ?? window.LOAM_MODS)   // LOAM_MODS = legacy alias
    : null;
  if (Array.isArray(inline)) {
    return inline.map((src, i) => ({ name: `inline #${i + 1}`, inline: src }));
  }
  try {
    const idxUrl = new URL('../mods/index.json', import.meta.url);
    const res = await fetch(idxUrl);
    if (!res.ok) return [];
    const idx = await res.json();
    return (idx.mods || []).map((p) => ({
      name: p, url: new URL(`../mods/${p}`, import.meta.url).href,
    }));
  } catch {
    return [];   // no mods directory / file:// without inline mods — fine
  }
}

export async function loadMods(mods = new Mods()) {
  const sources = await discoverSources();
  for (const s of sources) {
    let blobUrl = null;
    try {
      if (s.inline) {
        blobUrl = URL.createObjectURL(new Blob([s.inline], { type: 'text/javascript' }));
      }
      const module = await import(/* @vite-ignore */ blobUrl ?? s.url);
      const mod = module.default;
      if (!mod || !mod.id || typeof mod.init !== 'function') {
        throw new Error('a mod must `export default {id, name, init(api)}`');
      }
      if (mods.list.some((m) => m.id === mod.id)) {
        throw new Error(`duplicate mod id "${mod.id}"`);
      }
      mod.init(mods.apiFor(mod.id));
      mods.list.push({ id: mod.id, name: mod.name || mod.id, version: mod.version || '1.0' });
      console.log(`BLOCKS: loaded mod "${mod.name || mod.id}"`);
    } catch (e) {
      console.error(`BLOCKS: mod "${s.name}" failed to load:`, e);
      mods.list.push({ id: s.name, name: s.name, version: '', error: String(e.message || e) });
    } finally {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }
  }
  // Mods may have added blocks with new opacity behavior.
  refreshLightOpacity();
  return mods;
}
