// BLOCKS — menu screens: title, world select, create world, settings, pause,
// death, loading, how-to. Vanilla DOM rendered into #screens; styles.css owns
// all visuals. Screens are rebuilt from template strings on every show*().

import { GAME_NAME, GAME_TAGLINE, MODE_BUILDER, MODE_JOURNEY } from '../core/constants.js';

const ESC_CH = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC_CH[c]);

/** Relative time from a ms timestamp — '3 min ago'. */
function relTime(ts) {
  if (!ts) return 'never played';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  const d = Math.floor(s / 86400);
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  return new Date(ts).toLocaleDateString();
}

const CUBES = Array.from({ length: 7 }, (_, i) => `<i class="cube c${i}"></i>`).join('');

// key, label, min, max, step
const SLIDERS = [
  ['renderDistance', 'Render Distance (chunks)', 4, 14, 1],
  ['fov', 'Field of View', 60, 100, 1],
  ['sensitivity', 'Mouse Sensitivity', 0.2, 2.5, 0.05],
  ['volMaster', 'Master Volume', 0, 1, 0.01],
  ['volMusic', 'Music', 0, 1, 0.01],
  ['volSfx', 'Sound Effects', 0, 1, 0.01],
  ['volAmbient', 'Ambience', 0, 1, 0.01],
];
const TOGGLES = [
  ['headBob', 'Head Bob'],
  ['clouds', 'Clouds'],
  ['particles', 'Particles'],
  ['invertY', 'Invert Mouse Y'],
  ['showFps', 'Show FPS Counter'],
];

const KEYS = [
  ['W A S D', 'Move'],
  ['Space', 'Jump — double-tap in Builder to toggle flight'],
  ['Shift', 'Crouch (and hold your footing at edges)'],
  ['Ctrl', 'Sprint'],
  ['E', 'Open inventory'],
  ['Left Mouse', 'Mine / attack'],
  ['Right Mouse', 'Place block / use'],
  ['Middle Mouse', 'Pick block'],
  ['1–9 / Wheel', 'Select hotbar slot'],
  ['Esc', 'Pause'],
];

const TIPS = [
  'Fell a tree and split the logs into planks — four planks make a worktable, and the worktable makes real tools.',
  'The kiln smelts ore and cooks food, but it stays cold without coal. Dig for the dark seams.',
  'Hunger gnaws quietly: forage berries, plant crops, cook what you catch. A full belly mends wounds.',
  'Night belongs to other things in Journey mode. Torches and walls are worth more than courage.',
  'Deep water steals your breath and lava forgives nothing — but a pool of water breaks any fall.',
  'A bedroll sets your spawn, and sleeping skips the night. Gloomstalkers prowl after dark.',
  'Strike a basalt frame with kindle flint and the Smolder answers. Its shards forge sunsteel.',
  'A sunstone-block frame opens the Hollow. Something crowned is waiting there.',
  'Stowboxes hold what your pockets cannot. Clay vessels carry water — and worse.',
];

const fmtVal = (k, v) =>
  k.startsWith('vol') ? `${Math.round(v * 100)}%`
  : k === 'sensitivity' ? Number(v).toFixed(2)
  : String(Math.round(v));

export class Menus {
  /**
   * @param root #screens element
   * @param settings Settings instance
   * @param hooks {listWorlds, createWorld, deleteWorld, startWorld,
   *               resumeGame, saveAndQuit, respawn, audio?}
   */
  constructor(root, settings, hooks) {
    this.root = root;
    this.settings = settings;
    this.hooks = hooks;
    this.current = null;      // active screen name, or null
    this._escBack = null;     // Escape action for the active screen
    this._inGame = false;     // true while pause/death chain is active

    // hover tick — delegated so dynamically added buttons are covered
    root.addEventListener('mouseover', (e) => {
      const t = e.target.closest?.('.btn, .mode-card, .world-card');
      if (t && !t.contains(e.relatedTarget)) this.hooks.audio?.play('ui_click');
    });

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this._escBack) return;
      e.preventDefault();
      const back = this._escBack;
      this._escBack = null;
      back();
    });
  }

  // ── plumbing ─────────────────────────────────────────────────────

  /** Replace root content with one screen. Returns the .screen element. */
  _render(name, inner, { overlay = false, escBack = null, cls = '' } = {}) {
    this.current = name;
    this._escBack = escBack;
    this.root.innerHTML = `
      <div class="screen ${overlay ? 'screen--overlay' : 'screen--solid'} ${cls}" data-screen="${name}">
        ${overlay ? '' : `<div class="float-cubes">${CUBES}</div>`}
        <div class="screen-inner">${inner}</div>
      </div>`;
    return this.root.firstElementChild;
  }

  _q(sel) { return this.root.querySelector(sel); }

  _on(sel, fn) {
    const el = this._q(sel);
    if (el) el.addEventListener('click', fn);
    return el;
  }

  hideAll() {
    this.root.innerHTML = '';
    this.current = null;
    this._escBack = null;
  }

  isOpen() { return this.current !== null; }

  // ── main menu ────────────────────────────────────────────────────

  showMain() {
    this._inGame = false;
    const letters = GAME_NAME.split('')
      .map((c, i) => `<span style="--i:${i}">${esc(c)}</span>`).join('');
    this._render('main', `
      <div class="menu-main">
        <div class="wordmark">${letters}</div>
        <div class="tagline">${esc(GAME_TAGLINE)}</div>
        <div class="menu-btns">
          <button class="btn btn-primary btn-big" data-a="play">Play</button>
          <button class="btn btn-ghost btn-big" data-a="settings">Settings</button>
          <button class="btn btn-ghost btn-big" data-a="howto">How to Play</button>
          <button class="btn btn-ghost btn-big" data-a="mods">Mods</button>
        </div>
        <div class="menu-footer">an original voxel sandbox &middot; saves live in your browser</div>
      </div>`);
    this._on('[data-a=play]', () => this.showWorldSelect());
    this._on('[data-a=settings]', () => this.showSettings(() => this.showMain()));
    this._on('[data-a=howto]', () => this.showHowTo());
    this._on('[data-a=mods]', () => this.showMods());
  }

  showMods() {
    const mods = this.hooks.modList ? this.hooks.modList() : [];
    const rows = mods.length === 0
      ? `<div class="list-empty">No mods installed.<br>
         Drop mod files in the <b>mods/</b> folder and list them in <b>mods/index.json</b>.</div>`
      : mods.map((m) => `
        <div class="world-card">
          <div class="world-info">
            <div class="world-head">
              <span class="world-name">${esc(m.name)}</span>
              <span class="mode-badge ${m.error ? 'badge-journey' : 'badge-builder'}">${m.error ? 'failed' : 'v' + esc(m.version)}</span>
            </div>
            ${m.error ? `<div class="world-meta">${esc(m.error)}</div>` : `<div class="world-meta">id: ${esc(m.id)}</div>`}
          </div>
        </div>`).join('');
    this._render('mods', `
      <div class="panel panel-md">
        <h2 class="panel-title">Mods</h2>
        <div class="world-list">${rows}</div>
        <div class="row-end">
          <button class="btn btn-ghost" data-a="back">Back</button>
        </div>
      </div>`, { escBack: () => this.showMain() });
    this._on('[data-a=back]', () => this.showMain());
  }

  // ── world select ─────────────────────────────────────────────────

  showWorldSelect() {
    this._render('worlds', `
      <div class="panel panel-md">
        <h2 class="panel-title">Your Worlds</h2>
        <div class="world-list"><div class="list-empty">Looking for worlds&hellip;</div></div>
        <div class="row-end">
          <button class="btn btn-ghost" data-a="back">Back</button>
          <button class="btn btn-primary" data-a="new">New World</button>
        </div>
      </div>`, { escBack: () => this.showMain() });
    this._on('[data-a=back]', () => this.showMain());
    this._on('[data-a=new]', () => this.showCreateWorld());
    this._loadWorlds();
  }

  async _loadWorlds() {
    let metas = [];
    try { metas = (await this.hooks.listWorlds()) || []; }
    catch (err) { console.error('listWorlds failed', err); }
    if (this.current !== 'worlds') return;      // user navigated away
    const list = this._q('.world-list');
    if (!list) return;
    list.innerHTML = '';
    if (!metas.length) {
      list.innerHTML = `<div class="list-empty">No worlds yet — carve out your first.</div>`;
      return;
    }
    metas = metas.slice().sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0));
    for (const m of metas) list.appendChild(this._worldCard(m));
  }

  _worldCard(m) {
    const builder = m.mode === MODE_BUILDER;
    const card = document.createElement('div');
    card.className = 'world-card';
    card.innerHTML = `
      <div class="world-info">
        <div class="world-head">
          <span class="world-name">${esc(m.name)}</span>
          <span class="mode-badge ${builder ? 'badge-builder' : 'badge-journey'}">${builder ? 'Builder' : 'Journey'}</span>
        </div>
        <div class="world-meta">seed ${esc(m.seed)} &middot; ${esc(relTime(m.playedAt))}</div>
      </div>
      <div class="world-actions"></div>`;
    const actions = card.querySelector('.world-actions');

    const normal = () => {
      actions.innerHTML = `
        <button class="btn btn-primary btn-sm">Play</button>
        <button class="btn btn-ghost btn-sm">Delete</button>`;
      actions.children[0].addEventListener('click', () => this.hooks.startWorld(m));
      actions.children[1].addEventListener('click', confirm);
    };
    const confirm = () => {
      actions.innerHTML = `
        <span class="confirm-label">Delete forever?</span>
        <button class="btn btn-danger btn-sm">Delete</button>
        <button class="btn btn-ghost btn-sm">Keep</button>`;
      actions.children[1].addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        try { await this.hooks.deleteWorld(m.id); }
        catch (err) { console.error('deleteWorld failed', err); }
        this._loadWorlds();
      });
      actions.children[2].addEventListener('click', normal);
    };
    normal();
    return card;
  }

  // ── create world ─────────────────────────────────────────────────

  showCreateWorld() {
    const scr = this._render('create', `
      <div class="panel panel-md">
        <h2 class="panel-title">New World</h2>
        <label class="field"><span>Name</span>
          <input class="input" type="text" value="New World" maxlength="32" data-f="name">
        </label>
        <label class="field"><span>Seed</span>
          <input class="input" type="text" placeholder="leave blank for random" maxlength="32" data-f="seed">
        </label>
        <div class="field"><span>Mode</span>
          <div class="mode-pick">
            <div class="mode-card selected" data-mode="${MODE_JOURNEY}" role="button" tabindex="0">
              <h3>Journey</h3>
              <p>Survival. Gather, craft, and stay alive — hunger bites and the night has teeth.</p>
            </div>
            <div class="mode-card" data-mode="${MODE_BUILDER}" role="button" tabindex="0">
              <h3>Builder</h3>
              <p>Unlimited blocks, flight, no danger. Pure creation from horizon to horizon.</p>
            </div>
          </div>
        </div>
        <div class="row-end">
          <button class="btn btn-ghost" data-a="back">Back</button>
          <button class="btn btn-primary" data-a="create">Create World</button>
        </div>
      </div>`, { escBack: () => this.showWorldSelect() });

    let mode = MODE_JOURNEY;
    const cards = scr.querySelectorAll('.mode-card');
    for (const c of cards) {
      const pick = () => {
        mode = c.dataset.mode;
        for (const x of cards) x.classList.toggle('selected', x === c);
      };
      c.addEventListener('click', pick);
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    }

    const create = async () => {
      const btn = this._q('[data-a=create]');
      if (!btn || btn.disabled) return;
      btn.disabled = true;
      btn.textContent = 'Creating…';
      const name = this._q('[data-f=name]').value.trim() || 'New World';
      const seed = this._q('[data-f=seed]').value.trim();
      try {
        const meta = await this.hooks.createWorld({ name, seed, mode });
        await this.hooks.startWorld(meta);
      } catch (err) {
        console.error('createWorld failed', err);
        if (this.current === 'create' && this._q('[data-a=create]')) {
          const b = this._q('[data-a=create]');
          b.disabled = false;
          b.textContent = 'Create World';
        }
      }
    };
    this._on('[data-a=create]', create);
    this._on('[data-a=back]', () => this.showWorldSelect());
    for (const inp of scr.querySelectorAll('.input'))
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
    this._q('[data-f=name]').select();
  }

  // ── settings ─────────────────────────────────────────────────────

  showSettings(onBack) {
    const s = this.settings;
    const sliders = SLIDERS.map(([k, label, min, max, step]) => `
      <label class="set-row">
        <span class="set-label">${label}</span>
        <span class="set-val" data-val="${k}">${fmtVal(k, s.get(k))}</span>
        <input type="range" min="${min}" max="${max}" step="${step}" value="${s.get(k)}" data-set="${k}">
      </label>`).join('');
    const toggles = TOGGLES.map(([k, label]) => `
      <label class="set-row">
        <span class="set-label">${label}</span>
        <span class="toggle"><input type="checkbox" data-tog="${k}" ${s.get(k) ? 'checked' : ''}><i class="knob"></i></span>
      </label>`).join('');

    const scr = this._render('settings', `
      <div class="panel panel-md">
        <h2 class="panel-title">Settings</h2>
        <div class="panel-scroll">
          <div class="set-group">${sliders}</div>
          <div class="set-group">${toggles}</div>
        </div>
        <div class="row-end"><button class="btn btn-ghost" data-a="back">Back</button></div>
      </div>`, { overlay: this._inGame, escBack: () => onBack() });

    for (const input of scr.querySelectorAll('input[type=range]')) {
      input.addEventListener('input', () => {
        const k = input.dataset.set;
        let v = parseFloat(input.value);
        if (parseFloat(input.step) >= 1) v = Math.round(v);
        s.set(k, v);
        const val = scr.querySelector(`[data-val="${k}"]`);
        if (val) val.textContent = fmtVal(k, v);
      });
    }
    for (const box of scr.querySelectorAll('input[type=checkbox]')) {
      box.addEventListener('change', () => {
        s.set(box.dataset.tog, box.checked);
        this.hooks.audio?.play('ui_click');
      });
    }
    this._on('[data-a=back]', () => onBack());
  }

  // ── pause / death ────────────────────────────────────────────────

  showPause() {
    this._inGame = true;
    this._render('pause', `
      <div class="panel panel-sm">
        <h2 class="panel-title">Paused</h2>
        <div class="stack">
          <button class="btn btn-primary" data-a="resume">Resume</button>
          <button class="btn btn-ghost" data-a="settings">Settings</button>
          <button class="btn btn-ghost" data-a="quit">Save &amp; Quit to Title</button>
        </div>
      </div>`, { overlay: true, escBack: () => this.hooks.resumeGame() });
    this._on('[data-a=resume]', () => this.hooks.resumeGame());
    this._on('[data-a=settings]', () => this.showSettings(() => this.showPause()));
    this._on('[data-a=quit]', () => this.hooks.saveAndQuit());
  }

  showDeath(causeText) {
    this._inGame = true;
    this._render('death', `
      <div class="panel panel-sm">
        <h2 class="death-title">You faded away.</h2>
        <p class="death-cause">${esc(causeText)}</p>
        <div class="stack">
          <button class="btn btn-primary" data-a="respawn">Respawn</button>
          <button class="btn btn-ghost" data-a="quit">Save &amp; Quit</button>
        </div>
      </div>`, { overlay: true, cls: 'screen--death' });
    this._on('[data-a=respawn]', () => this.hooks.respawn());
    this._on('[data-a=quit]', () => this.hooks.saveAndQuit());
  }

  // ── loading ──────────────────────────────────────────────────────

  showLoading(title) {
    this._render('loading', `
      <div class="load-wrap">
        <div class="wordmark wordmark-sm">${esc(GAME_NAME)}</div>
        <div class="load-title">${esc(title)}</div>
        <div class="dots"><span></span><span></span><span></span></div>
        <div class="progress indeterminate"><div class="progress-fill"></div></div>
        <div class="load-msg"></div>
      </div>`);
  }

  /** frac 0..1, or null for indeterminate. msg optional status line. */
  updateLoading(frac, msg) {
    const bar = this._q('.progress');
    if (bar) {
      if (frac == null) {
        bar.classList.add('indeterminate');
      } else {
        bar.classList.remove('indeterminate');
        const f = Math.max(0, Math.min(1, frac));
        bar.querySelector('.progress-fill').style.width = `${(f * 100).toFixed(1)}%`;
      }
    }
    if (msg != null) {
      const m = this._q('.load-msg');
      if (m) m.textContent = msg;
    }
  }

  // ── how to play ──────────────────────────────────────────────────

  showHowTo() {
    const keys = KEYS.map(([k, d]) =>
      `<span class="kbd">${esc(k)}</span><span class="key-desc">${esc(d)}</span>`).join('');
    const tips = TIPS.map(t => `<li>${esc(t)}</li>`).join('');
    this._render('howto', `
      <div class="panel panel-md">
        <h2 class="panel-title">How to Play</h2>
        <div class="panel-scroll">
          <div class="howto-sub">Controls</div>
          <div class="keys">${keys}</div>
          <div class="howto-sub">Field Notes</div>
          <ul class="tips">${tips}</ul>
        </div>
        <div class="row-end"><button class="btn btn-ghost" data-a="back">Back</button></div>
      </div>`, { escBack: () => this.showMain() });
    this._on('[data-a=back]', () => this.showMain());
  }
}
