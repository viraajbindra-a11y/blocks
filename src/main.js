// BLOCKS — boot, game state machine, and the main loop that wires every
// subsystem together: menu → loading → playing → pause/death → menu.

import { Settings } from './core/config.js';
import { Input } from './core/input.js';
import { TouchControls } from './core/touch.js';
import { NetSession } from './net/net.js';
import { World } from './world/world.js';
import { Renderer, computeEnv } from './render/renderer.js';
import { Particles } from './render/particles.js';
import { buildAtlas } from './render/atlas.js';
import { Player } from './player/player.js';
import { Interaction } from './player/interaction.js';
import { createAudio } from './audio/audio.js';
import { EntitySystem } from './entities/entities.js';
import { Weather } from './weather.js';
import { openStore } from './save/store.js';
import { Mods, loadMods } from './mods.js';
import { DIMENSIONS, dimension, riftTarget } from './world/dimensions.js';
import { tryIgnite, ensureArrivalPortal } from './world/portals.js';
import { Menus } from './ui/menus.js';
import { HUD } from './ui/hud.js';
import { InventoryUI } from './ui/inventory.js';
import { B, blockById, isWater, isLava, faceTexKey } from './blocks.js';
import { itemByKey } from './items.js';
import { tickFurnace } from './crafting.js';
import { BIOME_NAMES } from './world/gen/terrain.js';
import {
  DAY_LENGTH, TICK_DT, MODE_BUILDER, MAX_AIR, GAME_NAME, GAME_TAGLINE, CHUNK_X,
} from './core/constants.js';

const AUTOSAVE_MS = 20000;

class Game {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.settings = new Settings();
    this.state = 'boot';          // boot | menu | loading | playing | paused | dead
    this.world = null;
    this.player = null;
    this.meta = null;

    this.timeOfDay = 0.3;
    this.worldTime = 0;           // seconds since world start (shader time)
    this.lastFrame = performance.now();
    this.accumulator = 0;
    this.fps = 0;
    this._fpsFrames = 0;
    this._fpsTime = 0;
    this._lastAutosave = 0;
    this._lastSceneUpdate = 0;
    this._lastHudUpdate = 0;
    this._wasHeadInWater = false;
  }

  async boot() {
    // constants.js is the single source of truth for the game's name.
    document.title = `${GAME_NAME} — ${GAME_TAGLINE}`;
    // Mods first: they register blocks/items/recipes/textures that the
    // atlas and lighting tables must include.
    this.mods = await loadMods(new Mods());
    this.atlas = buildAtlas();
    this.audio = createAudio(this.settings);
    this.store = await openStore();
    this.input = new Input(this.canvas);
    this.touch = new TouchControls(this.canvas, this.input);   // no-op on desktop
    this.net = null;                                           // multiplayer session (lazy)
    this.renderer = new Renderer(this.canvas, this.settings);
    this.renderer.setAtlas(this.atlas.layers, this.atlas.layerOf);
    this.particles = new Particles();
    this.hud = new HUD(document.getElementById('hud'), (k) => this.atlas.iconFor(k));

    // Inventory UI lives in its own root so menus can't clobber it.
    const invRoot = document.createElement('div');
    invRoot.id = 'inv-root';
    document.body.appendChild(invRoot);
    this.invRoot = invRoot;

    // Lightning flash overlay
    const flash = document.createElement('div');
    flash.id = 'storm-flash';
    flash.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:40;';
    document.body.appendChild(flash);
    this.flashEl = flash;

    this.menus = new Menus(document.getElementById('screens'), this.settings, {
      listWorlds: () => this.store.listWorlds(),
      createWorld: (o) => this.store.createWorld(o),
      deleteWorld: (id) => this.store.deleteWorld(id),
      startWorld: (meta) => this.startWorld(meta),
      resumeGame: () => this.resumeFromPause(),
      saveAndQuit: () => this.saveAndQuit(),
      respawn: () => this.respawn(),
      modList: () => this.mods.list,
      audio: this.audio,
    });

    this.settings.onChange('renderDistance', (v) => {
      if (this.world) this.world.setRenderDistance(v);
    });

    // First user gesture unlocks audio; clicks on the canvas also
    // re-acquire pointer lock (needed after slow loads, where the original
    // user activation has expired by the time 'playing' starts).
    document.addEventListener('pointerdown', () => {
      this.audio.resume();
      if (this.state === 'playing' && !this.input.locked &&
          !(this.inventory && this.inventory.isOpen) && !this.menus.isOpen()) {
        this.input.requestLock();
      }
    });

    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' &&
          !(this.inventory && this.inventory.isOpen) && !this.menus.isOpen()) {
        this.pause();
      }
    };

    document.addEventListener('keydown', (e) => this._onKeyDown(e));
    window.addEventListener('beforeunload', () => {
      if (this.inventory && this.inventory.isOpen) this.inventory.close();
      this._flushAll();
    });

    this.state = 'menu';
    this.menus.showMain();
    this._tickId = 0;
    // Hidden tabs suspend rAF; keep simulating (and autosaving) at ~15fps.
    document.addEventListener('visibilitychange', () => this._scheduleNext());
    this._scheduleNext();
  }

  _scheduleNext() {
    const id = ++this._tickId;
    const run = (t) => { if (id === this._tickId) this._frame(t ?? performance.now()); };
    if (document.hidden) setTimeout(run, 66);
    else requestAnimationFrame(run);
  }

  // ── Session lifecycle ─────────────────────────────────────────────
  async startWorld(meta) {
    this.meta = meta;
    this.menus.showLoading(`Shaping ${meta.name}…`);
    this.state = 'loading';
    this.dimKey = meta.dim ?? 'overworld';

    this.world = new World({
      seed: meta.seed,
      persistence: this.store.persistenceFor(meta.id, this.dimKey),
      renderDistance: this.settings.get('renderDistance'),
      decorations: this.dimKey === 'overworld' ? this.mods.decorations : [],
      dimension: this.dimKey,
    });
    this._wireRedstone();

    // Worlds remember the mods they were created with; warn on drift
    // (removed mods degrade their blocks to air, new mods change gen).
    const activeMods = this.mods.ids();
    if (!meta.mods) meta.mods = activeMods;
    else if (JSON.stringify(meta.mods) !== JSON.stringify(activeMods)) {
      setTimeout(() => this.hud.toast('Mod list changed since this world was created'), 2000);
    }
    this.renderer.attachWorld(this.world);

    this.player = new Player(this.world, meta.mode);
    if (meta.player) {
      this.player.deserialize(meta.player);
      // A save written on the death screen must not resurrect a 0-HP
      // player where they fell — respawn them properly.
      if (this.player.health <= 0) {
        const sp = meta.spawn ?? this.world.findSpawn();
        this.player.respawn([sp[0], sp[1] + 1, sp[2]]);
      }
    } else {
      const spawn = this.world.findSpawn();
      meta.spawn = spawn;
      this.player.pos = [...spawn];
    }
    if (!meta.spawn) meta.spawn = [...this.player.pos];
    this.timeOfDay = meta.timeOfDay ?? 0.3;
    this.worldTime = 0;

    this._rebindSystems();
    if (meta.weather) this.weather.deserialize(meta.weather);
    this._initSessionUI(meta);
  }

  // Systems bound to the CURRENT world — rebuilt on dimension switches.
  _rebindSystems() {
    this.weather = new Weather(this.world, this.particles, this.audio);
    if (this.weather.setBlockLayerLookup) {
      this.weather.setBlockLayerLookup((k) => this.atlas.layerOf(k));
    }

    // Entities get an audio view with creature voices mapped onto the
    // synth engine (pitch-shifted per species).
    const entityAudio = Object.create(this.audio);
    entityAudio.creature = (species, kind) => {
      if (kind === 'idle') return;
      const pitch = { bristleback: 0.55, mosshopper: 1.5, embermoth: 1.9,
        gloomstalker: 0.7, cinderling: 1.1, hollowshade: 0.85, sovereign: 0.4,
        pig: 0.6, cow: 0.42, sheep: 0.8, chicken: 1.6,
        zombie: 0.55, skeleton: 0.95, creeper: 0.7,
        spider: 1.2, slime: 0.9, blaze: 0.8, phantom: 1.4, witch: 1.1, ghast: 0.5,
        enderman: 0.7, wither: 0.4, villager: 1.0, wolf: 1.3, cat: 1.7,
        horse: 0.9, minecart: 1.4, boat: 1.2 }[species] ?? 1;
      this.audio.play(kind === 'death' ? 'death' : 'hurt', { pitch, vol: 0.45 });
    };
    this.entities = new EntitySystem(this.world, {
      audio: entityAudio,
      particles: this.particles,
      pickupItem: (key, count, dur) => {
        const left = this.player.addItem(key, count, dur);
        const got = count - left;
        if (got > 0) {
          const def = itemByKey(key);
          this.hud.toast(`+${got} ${def ? def.name : key}`, this.atlas.iconFor(key));
        }
        return left;
      },
      attackPlayer: (dmg, dir, cause) => {
        this.player.damage(dmg, cause || 'slain');
        if (dir) {
          this.player.vel[0] += dir[0] * 6;
          this.player.vel[1] = Math.max(this.player.vel[1], 4);
          this.player.vel[2] += dir[2] * 6;
        }
      },
      getPlayer: () => this.player,
      dimension: () => this.dimKey,
      awardXp: (n) => this.player.addXp(n),
      splashPotion: (x, y, z, effect) => {
        const p = this.player;
        const d = Math.hypot(p.pos[0] - x, (p.pos[1] + 0.9) - y, p.pos[2] - z);
        if (d < 3.5 && effect) p.addEffect(effect, 8, 1);
      },
    });

    this.interaction = new Interaction(this.world, this.player, {
      particles: this.settings.get('particles') ? this.particles : null,
      audio: this.audio,
      blockLayer: (id) => this.atlas.layerOf(faceTexKey(blockById(id), 4)),
      openStation: (kind) => this.openInventory(kind),
      dropItems: (x, y, z, items) => this.entities.spawnDrops(x, y, z, items),
      getEntities: () => this.entities.entities,
      onEntityHit: (e, dmg, dir) => this.entities.hitEntity(e, dmg, dir),
      toast: (m) => this.hud.toast(m),
      onBroken: (x, y, z, id) => {
        if (id === B.STOWBOX) this._spillContainer(x, y, z);
        if (id === B.FURNACE) this._spillFurnace(x, y, z);
        this.mods.emit('blockBroken', { x, y, z, id, key: blockById(id).key });
      },
      onPlaced: (x, y, z, id) =>
        this.mods.emit('blockPlaced', { x, y, z, id, key: blockById(id).key }),
      sleep: (x, y, z) => this._trySleep(x, y, z),
      openContainer: (x, y, z) => this._openContainer(x, y, z),
      openFurnace: (x, y, z) => this._openFurnace(x, y, z),
      fireArrow: (origin, dir, power, dmg) => this.entities.spawnPlayerArrow(origin, dir, power, dmg),
      useOnEntity: (e, heldKey) => this.entities.useItemOn(e, heldKey),
      primeTnt: (x, y, z) => this.entities.primeTnt(x, y, z),
      mount: (e) => { this.player.riding = e; e.ridden = true; return true; },
      spawnVehicle: (species, x, y, z) => this.entities.spawnVehicle(species, x, y, z),
      awardXp: (n) => this.player.addXp(n),
      castBobber: (x, y, z) => this.entities.castBobber(x, y, z),
      reelBobber: (b) => this.entities.reelBobber(b),
      throwPearl: (origin, dir) => this.entities.throwPearl(origin, dir),
      teleportPlayer: (x, y, z) => {
        this.player.pos = [x, y + 0.1, z];
        this.player.vel = [0, 0, 0];
        this.player.damage(2.5, 'fall', true);   // pearl teleport jolt
      },
      ignite: (x, y, z) => {
        const dim = tryIgnite(this.world, x, y, z);
        if (dim) this.hud.toast(`A rift to ${DIMENSIONS[dim].name} tears open…`);
        return dim;
      },
    });

  }

  // Once per session (not per dimension): inventory UI + player hooks.
  _initSessionUI(meta) {
    this.inventory = new InventoryUI(this.invRoot, this.player, (k) => this.atlas.iconFor(k), {
      audio: this.audio,
      toast: (m) => this.hud.toast(m),
    });
    this.inventory.onClose = () => {
      if (this.state === 'playing') this.input.requestLock();
    };

    this._wirePlayerHooks();
    this._loadingStart = performance.now();
    this._loadingTarget = null;
    this._riftDwell = 0;
    this._riftCooldown = 0;
  }

  _wirePlayerHooks() {
    const p = this.player;
    p.hooks.onStep = (id) => this.audio.blockSound('step', blockById(id).sound);
    p.hooks.onLand = (fall) => {
      this.audio.play('jump_land', { vol: Math.min(1, 0.4 + fall * 0.1) });
      const bx = Math.floor(p.pos[0]), by = Math.floor(p.pos[1] - 0.1), bz = Math.floor(p.pos[2]);
      const id = this.world.getBlock(bx, by, bz);
      if (id !== B.AIR && fall > 2.5 && this.settings.get('particles')) {
        this.particles.burstBlock(bx, by + 0.6, bz, this.atlas.layerOf(faceTexKey(blockById(id), 2)), 6, 0.8);
      }
    };
    p.hooks.onDamage = (amount, cause) => {
      this.hud.flashDamage();
      this.audio.play('hurt');
      this.mods.emit('playerDamage', { amount, cause });
    };
    p.hooks.onDeath = (cause) => {
      this.audio.play('death');
      this.state = 'dead';
      // Order matters: state is already 'dead' so inventory.onClose won't
      // re-request pointer lock over the death screen.
      if (this.inventory && this.inventory.isOpen) this.inventory.close();
      this.input.releaseLock();
      const text = {
        fall: 'The ground came up too fast.',
        drown: 'The water kept you.',
        lava: 'The mountain’s blood burns.',
        hunger: 'You forgot to eat.',
      }[cause] || 'The wilderness won this time.';
      this.menus.showDeath(text);
    };
    p.hooks.onToolBreak = (key) => {
      this.audio.play('tool_break');
      const def = itemByKey(key);
      this.hud.toast(`${def ? def.name : 'Tool'} broke!`);
    };
  }

  respawn() {
    const spawnDim = this.meta.spawnDim ?? 'overworld';
    const spawn = this.meta.spawn ?? this.world.findSpawn();
    this.menus.hideAll();
    if (this.dimKey !== spawnDim) {
      this.player.respawn([spawn[0], spawn[1] + 1, spawn[2]]);
      this._switchDimension(spawnDim, { pos: [spawn[0], spawn[1] + 1, spawn[2]] });
      return;
    }
    this.player.respawn([spawn[0], spawn[1] + 1, spawn[2]]);
    this.state = 'playing';
    this.input.requestLock();
  }

  // ── Dimension travel ─────────────────────────────────────────────
  // opts: {portal: {ax, ay, az, riftKind}} — build/find an arrival portal
  //       {pos: [x,y,z]}                   — direct placement (respawn)
  // Lazily create the P2P session and route its events into the world.
  _netStart() {
    if (this.net) return this.net;
    this.net = new NetSession({
      onBlock: (x, y, z, id) => this.world.applyRemoteBlock(x, y, z, id),
      onPlayer: (id, x, y, z, yaw) => this.entities.setRemotePlayer(id, x, y, z, yaw),
      onChat: (id, s) => this.hud.toast(s),
      onPeerGone: (id) => this.entities.removeRemotePlayer(id),
      onStatus: (s) => this.hud.toast('Multiplayer: ' + s),
    });
    this.world.netBroadcast = (x, y, z, id) => this.net.broadcastBlock(x, y, z, id);
    return this.net;
  }

  // Minimal host/join modal — swaps SDP codes by hand, no server needed.
  _openMultiplayer() {
    if (document.getElementById('mp-modal')) return;
    const net = this._netStart();
    this.input.enabled = false;
    const m = document.createElement('div');
    m.id = 'mp-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);font:14px system-ui,sans-serif;color:#eee';
    const ta = (label, val, ro) => `<label style="display:block;margin:10px 0 2px;color:#939681">${label}</label>`
      + `<textarea ${ro ? 'readonly' : ''} style="width:100%;height:56px;background:#14160e;color:#9ad86f;border:1px solid #33372a;border-radius:6px;font:11px monospace">${val || ''}</textarea>`;
    m.innerHTML = `<div style="background:#1e2117;border:1px solid #33372a;border-radius:12px;padding:20px;width:min(520px,92vw);max-height:90vh;overflow:auto">
      <h2 style="margin:0 0 4px;font-size:18px">Multiplayer — peer to peer</h2>
      <p style="color:#939681;margin:0 0 12px">No server needed. Swap the codes below to link two players; your builds sync live.</p>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button id="mp-host" style="flex:1;padding:8px">Host a game</button>
        <button id="mp-join" style="flex:1;padding:8px">Join a game</button>
        <button id="mp-close" style="padding:8px 12px">✕</button>
      </div><div id="mp-body"></div></div>`;
    document.body.appendChild(m);
    const body = m.querySelector('#mp-body');
    const close = () => { this.input.enabled = true; m.remove(); };
    m.querySelector('#mp-close').onclick = close;
    m.querySelector('#mp-host').onclick = async () => {
      body.innerHTML = '<p>Generating code…</p>';
      const offer = await net.createOffer();
      body.innerHTML = ta('1 · Send this code to your friend:', offer, true)
        + ta('2 · Paste their reply here:', '', false)
        + '<button id="mp-go" style="margin-top:8px;padding:8px">Connect</button>';
      body.querySelector('#mp-go').onclick = async () => {
        try { await net.acceptAnswer(body.querySelectorAll('textarea')[1].value.trim()); this.hud.toast('Connecting…'); close(); }
        catch { this.hud.toast('Bad reply code'); }
      };
    };
    m.querySelector('#mp-join').onclick = () => {
      body.innerHTML = ta('1 · Paste the host\'s code:', '', false)
        + '<button id="mp-gen" style="margin-top:8px;padding:8px">Generate reply</button><div id="mp-ans"></div>';
      body.querySelector('#mp-gen').onclick = async () => {
        try {
          const answer = await net.acceptOffer(body.querySelector('textarea').value.trim());
          body.querySelector('#mp-ans').innerHTML = ta('2 · Send this reply back to the host:', answer, true);
        } catch { this.hud.toast('Bad host code'); }
      };
    };
  }

  // Feed the ridden vehicle this frame's steering (before it updates).
  _setRiderInput() {
    const e = this.player.riding, inp = this.input;
    e.riderInput = {
      fwd: (inp.down('KeyW') ? 1 : 0) - (inp.down('KeyS') ? 1 : 0),
      yaw: this.player.yaw,
      jump: inp.down('Space'),
    };
  }

  // Pin the player onto the vehicle after it moves; sneak dismounts.
  _snapRider() {
    const p = this.player, e = p.riding;
    if (!e || e.dead) { if (e) e.ridden = false; p.riding = null; return; }
    if (this.input.pressed('ShiftLeft') || this.input.pressed('ShiftRight')) {
      e.ridden = false; p.riding = null;
      p.pos = [e.pos[0] + 0.7, e.pos[1] + 0.6, e.pos[2]]; p.vel = [0, 0, 0];
      return;
    }
    const saddle = e.def.rideable === 'land' ? 1.1 : 0.4;
    p.pos[0] = e.pos[0]; p.pos[1] = e.pos[1] + saddle; p.pos[2] = e.pos[2];
    p.vel[0] = p.vel[1] = p.vel[2] = 0;
  }

  // Wire the current world's redstone sim to gameplay effects.
  _wireRedstone() {
    this.world.redstone.hooks = {
      primeTnt: (x, y, z) => this.entities?.primeTnt(x, y, z),
      dispense: (x, y, z) => {
        this.entities?.spawnPlayerArrow?.([x + 0.5, y + 0.9, z + 0.5], [0, 0.35, 1], 1, 4);
        this.audio?.play?.('bow', { vol: 0.3 });
      },
    };
  }

  _switchDimension(dimKey, opts) {
    const dim = DIMENSIONS[dimKey];
    this._flushAll();
    this.entities.clear();
    this.world.dispose();
    this.dimKey = dimKey;
    this.meta.dim = dimKey;
    this.world = new World({
      seed: this.meta.seed,
      persistence: this.store.persistenceFor(this.meta.id, dimKey),
      renderDistance: this.settings.get('renderDistance'),
      decorations: dimKey === 'overworld' ? this.mods.decorations : [],
      dimension: dimKey,
    });
    this._wireRedstone();
    this.renderer.attachWorld(this.world);
    this._rebindSystems();
    const p = this.player;
    if (opts.pos) {
      p.pos = [...opts.pos];
      this._arrival = null;
    } else {
      p.pos = [opts.portal.ax + 0.5, opts.portal.ay + 1, opts.portal.az + 0.5];
      this._arrival = opts.portal;
    }
    p.vel = [0, 0, 0];
    p.fallStart = null;
    this.menus.showLoading(`Crossing into ${dim.name}…`);
    this.state = 'loading';
    this._loadingStart = performance.now();
    this._loadingTarget = null;
    this._riftDwell = 0;
    this._riftCooldown = 3;
  }

  travelTo(targetDim) {
    if (this._traveling || this.state !== 'playing') return;
    this._traveling = true;
    const p = this.player;
    let ax, az;
    if (targetDim === 'hollow') { ax = 0; az = 0; }
    else if (this.dimKey === 'hollow') {
      const sp = this.meta.spawn ?? [0, 70, 0];
      ax = Math.floor(sp[0]); az = Math.floor(sp[2]);
    } else if (targetDim === 'smolder') {
      ax = Math.floor(p.pos[0] / 8); az = Math.floor(p.pos[2] / 8);
    } else {
      ax = Math.floor(p.pos[0] * 8); az = Math.floor(p.pos[2] * 8);
    }
    const riftKind = targetDim === 'overworld' ? this.dimKey : targetDim;
    try { this.audio.play('rift_travel'); } catch { /* synth optional */ }
    const dim = DIMENSIONS[targetDim];
    const ay = dim.arrivalY ?? Math.max(this.world.generator.heightAt(ax, az) + 1, 50);
    this._switchDimension(targetDim, { portal: { ax, ay, az, riftKind } });
    this._traveling = false;
  }

  _trySleep(x, y, z) {
    this.meta.spawn = [x + 0.5, y + 1.2, z + 0.5];
    this.meta.spawnDim = this.dimKey;
    const dim = dimension(this.dimKey);
    if (!dim.hasDayCycle) {
      this.hud.toast('Spawn set — though there is no dawn here.');
      return;
    }
    const env = computeEnv(this.timeOfDay, null);
    if (env.night > 0.4) {
      this.timeOfDay = 0.26;
      this.audio.play('ui_open');
      this.hud.toast('You sleep until dawn. Spawn set.');
    } else {
      this.hud.toast('Spawn set. You can only sleep at night.');
    }
  }

  // ── Containers (stowbox) ─────────────────────────────────────────
  _containerSlots(x, y, z) {
    if (!this.meta.containers) this.meta.containers = {};
    if (!this.meta.containers[this.dimKey]) this.meta.containers[this.dimKey] = {};
    const store = this.meta.containers[this.dimKey];
    const key = `${x},${y},${z}`;
    if (!store[key]) store[key] = new Array(18).fill(null);
    return store[key];
  }

  _openContainer(x, y, z) {
    const slots = this._containerSlots(x, y, z);
    this.input.releaseLock();
    if (this.inventory.openContainer) {
      this.inventory.openContainer('Stowbox', slots);
    } else {
      this.openInventory(null);
    }
  }

  _spillContainer(x, y, z) {
    const store = this.meta.containers?.[this.dimKey];
    if (!store) return;
    const key = `${x},${y},${z}`;
    const slots = store[key];
    if (!slots) return;
    delete store[key];
    const drops = slots.filter(Boolean).map((s) => ({ key: s.key, count: s.count, dur: s.dur }));
    if (drops.length) this.entities.spawnDrops(x + 0.5, y + 0.5, z + 0.5, drops);
  }

  // ── Furnaces ─────────────────────────────────────────────────────
  // Per-block smelting state lives in meta.furnaces[dim]["x,y,z"] and is
  // advanced every frame (below) whether or not its menu is open.
  _furnaceState(x, y, z) {
    if (!this.meta.furnaces) this.meta.furnaces = {};
    if (!this.meta.furnaces[this.dimKey]) this.meta.furnaces[this.dimKey] = {};
    const store = this.meta.furnaces[this.dimKey];
    const key = `${x},${y},${z}`;
    if (!store[key]) store[key] = { input: null, fuel: null, output: null, burn: 0, burnMax: 0, cook: 0 };
    return store[key];
  }

  _openFurnace(x, y, z) {
    const state = this._furnaceState(x, y, z);
    this.input.releaseLock();
    if (this.inventory.openFurnace) this.inventory.openFurnace('Furnace', state);
    else this.openInventory(null);
  }

  _spillFurnace(x, y, z) {
    const store = this.meta.furnaces?.[this.dimKey];
    if (!store) return;
    const key = `${x},${y},${z}`;
    const f = store[key];
    if (!f) return;
    delete store[key];
    const drops = [f.input, f.fuel, f.output].filter(Boolean).map((s) => ({ key: s.key, count: s.count }));
    if (drops.length) this.entities.spawnDrops(x + 0.5, y + 0.5, z + 0.5, drops);
  }

  // Advance every furnace in the current dimension; GC ones that have gone
  // cold and empty (but never the one whose menu is open).
  _tickFurnaces(dt) {
    const store = this.meta.furnaces?.[this.dimKey];
    if (!store) return;
    const openState = this.inventory && this.inventory.furnace;
    for (const key in store) {
      const f = store[key];
      tickFurnace(f, dt);
      if (f !== openState && !f.input && !f.fuel && !f.output && f.burn <= 0 && f.cook <= 0) {
        delete store[key];
      }
    }
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.releaseLock();
    this.audio.setPaused(true);
    this.menus.showPause();
    this._flushAll();
  }

  resumeFromPause() {
    if (this.state !== 'paused') return;
    this.menus.hideAll();
    this.state = 'playing';
    this.audio.setPaused(false);
    this.input.requestLock();
  }

  async saveAndQuit() {
    // Close the inventory first: it returns cursor/craft-grid items to the
    // player's slots so they are included in the save.
    if (this.inventory && this.inventory.isOpen) this.inventory.close();
    await this._flushAll();
    this.audio.stopMusic();
    this.audio.setPaused(false);
    this.hud.setVisible(false);
    this.hud.setWaterTint(null);
    if (this.entities) this.entities.clear();
    if (this.world) { this.world.dispose(); this.world = null; }
    this.renderer.attachWorld(null);
    this.player = null;
    this.state = 'menu';
    this.menus.showMain();
  }

  async _flushAll() {
    if (!this.world || !this.meta) return;
    this.meta.player = this.player.serialize();
    this.meta.timeOfDay = this.timeOfDay;
    this.meta.weather = this.weather.serialize();
    this.meta.playedAt = Date.now();
    try {
      await Promise.all([
        this.store.saveWorldMeta(this.meta),
        this.world.flushSaves(),
      ]);
    } catch (e) {
      console.warn('save failed', e);
    }
  }

  _rebuildRenderer() {
    console.warn('BLOCKS: context not restored — rebuilding canvas + renderer');
    this._lostSince = null;
    const fresh = this.canvas.cloneNode(false);
    this.canvas.parentNode.replaceChild(fresh, this.canvas);
    this.canvas = fresh;
    this.input.canvas = fresh;
    try {
      this.renderer = new Renderer(fresh, this.settings);
      this.renderer.setAtlas(this.atlas.layers, this.atlas.layerOf);
      this.renderer.attachWorld(this.world);
      this.renderer.remeshAll();
    } catch (e) {
      console.error('BLOCKS: renderer rebuild failed, will retry', e);
      this._lostSince = performance.now();
    }
  }

  openInventory(station) {
    if (!this.inventory) return;
    this.input.releaseLock();
    this.inventory.open(station);
  }

  // ── Input handling that isn't movement ────────────────────────────
  _onKeyDown(e) {
    if (this.state === 'playing' && !this.inventory.isOpen) {
      if (e.code === 'KeyE') {
        e.preventDefault();
        // Keep the inventory's own document-level listener (registered
        // later, so it runs after this one) from closing it immediately.
        e.stopImmediatePropagation();
        this.openInventory(null);
        return;
      }
      if (e.code === 'Escape') { this.pause(); return; }
      if (e.code === 'KeyQ') { this._dropHeld(); return; }
      if (e.code === 'KeyM') { e.preventDefault(); this._openMultiplayer(); return; }
      if (/^Digit[1-9]$/.test(e.code)) {
        this.player.selected = Number(e.code.slice(5)) - 1;
        return;
      }
    } else if (this.state === 'playing' && this.inventory.isOpen) {
      if (e.code === 'KeyE' || e.code === 'Escape') {
        e.preventDefault();
        this.inventory.close();
      }
    }
  }

  _dropHeld() {
    const p = this.player;
    const s = p.slots[p.selected];
    if (!s) return;
    const item = { key: s.key, count: 1, dur: s.dur };
    s.count--;
    if (s.count <= 0) p.slots[p.selected] = null;
    const eye = p.eyePos();
    const cp = Math.cos(p.pitch), cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    this.entities.spawnDrops(
      eye[0] - sy * cp * 1.2, eye[1] - 0.2, eye[2] - cy * cp * 1.2, [item]);
  }

  // ── Main loop ─────────────────────────────────────────────────────
  _frame(now) {
    this._scheduleNext();
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (dt > 0.1) dt = 0.1;

    this._fpsFrames++;
    this._fpsTime += dt;
    if (this._fpsTime >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsTime);
      this._fpsFrames = 0; this._fpsTime = 0;
    }

    switch (this.state) {
      case 'loading': this._loadingFrame(now, dt); break;
      case 'playing':
      case 'paused':
      case 'dead':
        this._playFrame(now, dt);
        break;
      default: break;   // menu: canvas idle behind CSS background
    }
    this.input.endFrame();
  }

  _loadingFrame(now, dt) {
    const w = this.world;
    if (!w) return;
    w.update(dt, this.player.pos[0], this.player.pos[2], now);
    this.renderer.meshTick(this.player.pos[0], this.player.pos[2], 14);
    if (this._loadingTarget === null && w.stats.genQueue > 0) {
      this._loadingTarget = w.stats.genQueue;
    }
    const t = this._loadingTarget;
    const frac = t ? Math.min(1, (t - w.stats.genQueue) / t) : 0;
    this.menus.updateLoading(frac * 0.7 + Math.min(0.3, (1 - w.meshDirty.size / 300) * 0.3),
      w.stats.genQueue > 0 ? 'Raising the land…' : 'Growing the meadows…');

    const pcx = Math.floor(this.player.pos[0] / CHUNK_X);
    const pcz = Math.floor(this.player.pos[2] / CHUNK_X);
    const spawnChunk = w.chunkAt(pcx, pcz);
    const ready = spawnChunk && spawnChunk.meshReady &&
      (w.stats.genQueue === 0 || now - this._loadingStart > 12000);
    if (ready) {
      if (this._arrival) {
        // Dimension travel: reuse or build the return portal, stand beside it.
        const a = this._arrival;
        this._arrival = null;
        const pos = ensureArrivalPortal(w, a.riftKind, a.ax, a.ay, a.az);
        this.player.pos = [pos[0], pos[1] + 0.1, pos[2]];
        this.player.vel = [0, 0, 0];
        this._riftCooldown = 3;
      } else if (!this.meta.player) {
        // Fresh world: snap the player to the actual surface.
        const h = w.heightAt(Math.floor(this.player.pos[0]), Math.floor(this.player.pos[2]));
        this.player.pos[1] = h + 1.2;
      }
      this.menus.hideAll();
      this.hud.setVisible(true);
      this.state = 'playing';
      this.audio.resume();
      this.audio.startMusic();
      this.input.requestLock();
      this._lastAutosave = now;
      this.mods.emit('worldLoaded', { seed: this.meta.seed, mode: this.meta.mode });
    }
  }

  _playFrame(now, dt) {
    const playing = this.state === 'playing';
    const uiOpen = this.inventory.isOpen || !playing;
    const p = this.player;
    this.touch.setActive(playing && !uiOpen);

    // Look
    if (playing && this.input.locked && !uiOpen) {
      const look = this.input.consumeLook();
      p.applyLook(look.dx, look.dy, this.settings.get('sensitivity'), this.settings.get('invertY'));
      const wheel = this.input.consumeWheel();
      if (wheel) p.selected = ((p.selected + wheel) % 9 + 9) % 9;
    } else {
      this.input.consumeLook();
      this.input.consumeWheel();
    }

    // Fixed-step simulation (world keeps living while inventory is open)
    if (this.state !== 'paused') {
      const move = (playing && !uiOpen && this.input.locked) ? {
        fwd: (this.input.down('KeyW') ? 1 : 0) - (this.input.down('KeyS') ? 1 : 0),
        strafe: (this.input.down('KeyD') ? 1 : 0) - (this.input.down('KeyA') ? 1 : 0),
        jump: this.input.down('Space'),
        jumpPressed: this.input.pressed('Space'),
        sprint: this.input.down('ControlLeft') || this.input.down('ControlRight'),
        crouch: this.input.down('ShiftLeft') || this.input.down('ShiftRight'),
      } : { fwd: 0, strafe: 0, jump: false, jumpPressed: false, sprint: false, crouch: false };

      this.accumulator = Math.min(this.accumulator + dt, 0.12);
      while (this.accumulator >= TICK_DT) {
        if (!p.riding) p.update(TICK_DT, move, now / 1000);   // riding: pose comes from the vehicle
        this.accumulator -= TICK_DT;
      }

      // Splash on entering water
      if (p.inWater && !this._wasInWater) this.audio.play('splash');
      this._wasInWater = p.inWater;

      if (playing && !uiOpen && this.input.locked) {
        this.interaction.update(dt, this.input, now / 1000);
      } else {
        this.interaction.target = null;
        this.interaction.breakProgress = 0;
      }

      this.timeOfDay = (this.timeOfDay + dt / DAY_LENGTH) % 1;
      this.worldTime += dt;
      this.mods.emit('tick', dt);
      this.world.update(dt, p.pos[0], p.pos[2], now);
      const dim = dimension(this.dimKey);
      const env = computeEnv(this.timeOfDay, dim.hasWeather ? this.weather : null, dim);
      if (p.riding) this._setRiderInput();
      this.entities.update(dt, p.pos, now / 1000, env.sunLevel);
      if (p.riding) this._snapRider();
      if (this.net && this.net.connected) {                    // share our pose ~10×/s
        this._netPoseT = (this._netPoseT || 0) + dt;
        if (this._netPoseT >= 0.1) { this._netPoseT = 0; this.net.broadcastPose(p.pos[0], p.pos[1], p.pos[2], p.yaw, p.pitch); }
      }
      this._tickFurnaces(dt);
      if (dim.hasWeather) this.weather.update(dt, p.pos, this.timeOfDay, now / 1000);
      this.particles.update(dt, this.world);

      // Standing in a rift carries you across
      if (this._riftCooldown > 0) this._riftCooldown -= dt;
      const feetId = this.world.getBlock(
        Math.floor(p.pos[0]), Math.floor(p.pos[1] + 0.4), Math.floor(p.pos[2]));
      if ((feetId === B.NETHER_PORTAL || feetId === B.END_PORTAL) &&
          this._riftCooldown <= 0 && !this._traveling) {
        this._riftDwell = (this._riftDwell ?? 0) + dt;
        if (this._riftDwell >= 1.2) {
          this._riftDwell = 0;
          this.travelTo(riftTarget(feetId, this.dimKey));
          return;
        }
      } else {
        this._riftDwell = 0;
      }

      // Ambient audio scene, throttled
      if (now - this._lastSceneUpdate > 1000) {
        this._lastSceneUpdate = now;
        const eyeY = p.pos[1] + p.eyeOffset;
        const sky = this.world.lightAt(Math.floor(p.pos[0]), Math.floor(eyeY), Math.floor(p.pos[2])) >> 4;
        this.audio.setScene({
          night: env.night,
          underground: sky < 4 && eyeY < 52 && this.dimKey === 'overworld',
          weatherKind: dim.hasWeather && this.weather.kind === 'storm' ? 'storm'
            : (dim.hasWeather && this.weather.kind === 'rain' ? 'rain' : 'clear'),
          inWater: p.headInWater,
          biome: this.world.biomeAt(Math.floor(p.pos[0]), Math.floor(p.pos[2])),
          dimension: this.dimKey,
        });
      }

      // Autosave
      if (now - this._lastAutosave > AUTOSAVE_MS) {
        this._lastAutosave = now;
        this._flushAll();
      }
    }

    // GPU context watchdog: if the browser never restores a lost context,
    // rebuild the canvas + renderer from scratch.
    if (this.renderer.contextLost) {
      this._lostSince = this._lostSince ?? now;
      if (now - this._lostSince > 2500) this._rebuildRenderer();
      return;
    }
    this._lostSince = null;

    // Meshing budget
    this.renderer.meshTick(p.pos[0], p.pos[2], playing ? 5 : 9);

    // ── Render ──
    const dimNow = dimension(this.dimKey);
    const env = computeEnv(this.timeOfDay, dimNow.hasWeather ? this.weather : null, dimNow);
    const bob = this.settings.get('headBob') ? p.bobOffset() : [0, 0];
    const eye = p.eyePos();
    const { right } = { right: [Math.cos(p.yaw), 0, -Math.sin(p.yaw)] };
    const cam = {
      x: eye[0] + right[0] * bob[0],
      y: eye[1] + bob[1],
      z: eye[2] + right[2] * bob[0],
      yaw: p.yaw, pitch: p.pitch,
      fov: this.settings.get('fov') + p.fovExtra,
    };
    const eyeBlock = this.world.getBlock(Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z));
    const underwater = isWater(eyeBlock) ? 'water' : isLava(eyeBlock) ? 'lava' : null;

    const heldDef = p.heldItem();
    const held = !heldDef ? null
      : heldDef.kind === 'block' ? { kind: 'block', blockId: heldDef.block }
      : { kind: 'sprite', texKey: heldDef.icon };
    const lightP = this.world.lightAt(Math.floor(eye[0]), Math.floor(eye[1]), Math.floor(eye[2]));
    const heldLight = Math.max(((lightP >> 4) / 15) * Math.max(env.sunLevel, 0.05), (lightP & 15) / 15);

    this.renderer.render({
      camera: cam,
      time: this.worldTime,
      timeOfDay: this.timeOfDay,
      dim: dimNow,
      weather: dimNow.hasWeather ? this.weather : null,
      cloudCover: dimNow.hasWeather ? this.weather.cloudCover : 0,
      underwater,
      target: this.interaction.target,
      breakProgress: this.interaction.breakProgress,
      entities: this.entities.renderList(),
      particles: this.settings.get('particles') ? this.particles : null,
      held,
      heldLight,
      swing: this.interaction.swing,
      viewBob: bob[1],
      renderDistance: this.settings.get('renderDistance'),
    });

    // Lightning flash overlay
    this.flashEl.style.opacity = dimNow.hasWeather ? (this.weather.flash * 0.55).toFixed(2) : '0';

    // Boss bar
    const boss = this.entities.bossInfo ? this.entities.bossInfo() : null;
    this._updateBossBar(boss);

    // ── HUD ──
    this.hud.setWaterTint(underwater);
    this.hud.breakIndicator(this.interaction.breakProgress > 0 ? this.interaction.breakProgress : null);
    if (now - this._lastHudUpdate > 100) {
      this._lastHudUpdate = now;
      this.hud.update({
        health: p.health, hunger: p.hunger, air: Math.ceil(p.air), maxAir: MAX_AIR,
        slots: p.slots, selected: p.selected,
        xpLevel: p.xpLevel, xpProgress: p.xpProgress(),
        effects: p.effects,
        fps: this.fps,
        pos: p.pos.map((v) => Math.round(v * 10) / 10),
        biomeName: BIOME_NAMES[this.world.biomeAt(Math.floor(p.pos[0]), Math.floor(p.pos[2]))] ?? '',
        timeString: timeString(this.timeOfDay),
        showFps: this.settings.get('showFps'),
        mode: p.mode,
        underwater: p.headInWater,
      });
    }
  }
}

Game.prototype._updateBossBar = function (boss) {
  if (!boss) {
    if (this._bossEl) this._bossEl.style.display = 'none';
    return;
  }
  if (!this._bossEl) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:26px;left:50%;transform:translateX(-50%);width:min(480px,70vw);z-index:30;pointer-events:none;font-family:var(--font,system-ui);';
    el.innerHTML = '<div style="color:var(--ink,#f2e8d5);text-align:center;font-weight:700;letter-spacing:.08em;text-shadow:0 1px 3px #000c;margin-bottom:5px" data-b="name"></div>' +
      '<div style="height:10px;border-radius:6px;background:#0008;border:1px solid #0006;overflow:hidden">' +
      '<div data-b="fill" style="height:100%;width:100%;border-radius:6px;background:linear-gradient(90deg,#b389e0,#7f5bb5);transition:width .25s"></div></div>';
    document.body.appendChild(el);
    this._bossEl = el;
  }
  this._bossEl.style.display = 'block';
  this._bossEl.querySelector('[data-b=name]').textContent = boss.name;
  this._bossEl.querySelector('[data-b=fill]').style.width =
    `${Math.max(0, (boss.health / boss.max) * 100).toFixed(1)}%`;
};

function timeString(t) {
  const mins = Math.floor(((t + 0.0) * 24 * 60) % (24 * 60));
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── Boot ────────────────────────────────────────────────────────────
const game = new Game();
game.boot().catch((e) => {
  console.error(e);
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#14100c;color:#f2e8d5;font-family:system-ui;z-index:99;padding:2rem;text-align:center';
  el.innerHTML = `<div><h1 style="color:#e8a13c">BLOCKS could not start</h1><p>${e.message}</p><p style="opacity:.6">WebGL2 is required — try a recent Chrome, Edge, Firefox, or Safari.</p></div>`;
  document.body.appendChild(el);
});
window.GAME = game;
