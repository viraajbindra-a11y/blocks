// Inventory & crafting UI: pocket 2×2 / worktable 3×3 / kiln 3×3 grids,
// container view (2×9 stowbox grid, no crafting), cursor-stack
// interactions (click/right-click/shift-click), tooltips, and the
// Builder catalog. Vanilla DOM; slots rerender on change only.

import { MODE_BUILDER } from '../core/constants.js';
import { itemByKey, catalogItems, ENCHANT_NAMES } from '../items.js';
import { matchRecipe, smeltRecipe, isFuel, COOK_SECONDS } from '../crafting.js';

const TITLES = { pocket: 'Pockets', worktable: 'Crafting Table', kiln: 'Furnace' };
const TABS = [['blocks', 'Blocks'], ['tools', 'Tools'], ['mats', 'Materials'], ['food', 'Food']];

function el(tag, cls, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

export class InventoryUI {
  /** @param {HTMLElement} root @param {import('../player/player.js').Player} player
   *  @param {(key:string)=>string} iconFor @param {{audio?:object, toast?:(msg:string)=>void}} hooks */
  constructor(root, player, iconFor, hooks) {
    this.root = root;
    this.player = player;
    this.iconFor = iconFor;
    this.hooks = hooks || {};
    this.isOpen = false;
    this.onClose = null;         // set by main; fired after close cleanup

    this.cursor = null;          // stack held by the mouse
    this.station = null;
    this.container = null;       // live 18-slot array (save-system owned)
    this.containerTitle = '';
    this.furnace = null;         // live furnace state (save-system owned)
    this.furnaceTitle = '';
    this._furnaceTimer = null;
    this._furnaceBinds = [];
    this.gridSize = 2;
    this.craft = [];
    this._recipe = null;
    this._binds = [];
    this._tab = 'blocks';
    this._mx = 0;
    this._my = 0;
    this._tipOn = false;
  }

  /** station: null (pocket 2×2) | 'worktable' | 'kiln' */
  open(station = null) {
    if (this.isOpen) return;
    this.isOpen = true;
    this.station = station;
    this.container = null;
    this.gridSize = station ? 3 : 2;
    this.craft = new Array(this.gridSize * this.gridSize).fill(null);
    this._attach();
  }

  /** Container view: 2×9 grid over the backpack/hotbar, no crafting.
   *  @param {string} title @param {Array<{key:string,count:number,dur?:number}|null>} slotsArray
   *  slotsArray is a LIVE reference owned by the save system — mutated in place. */
  openContainer(title, slotsArray) {
    if (this.isOpen) return;
    this.isOpen = true;
    this.station = null;
    this.container = slotsArray;
    this.containerTitle = title;
    this.craft = [];
    this._attach();
  }

  /** Furnace view: input + fuel + output slots with live smelt gauges.
   *  @param {string} title
   *  @param {{input,fuel,output,burn,burnMax,cook}} state  LIVE reference the
   *  game loop ticks every frame; the UI only reflects + edits its slots. */
  openFurnace(title, state) {
    if (this.isOpen) return;
    this.isOpen = true;
    this.station = 'kiln';
    this.container = null;
    this.furnace = state;
    this.furnaceTitle = title;
    this.gridSize = 0;
    this.craft = [];
    this._attach();
    // Poll the live furnace state so background smelting shows up.
    this._furnaceTimer = setInterval(() => {
      if (!this.furnace) return;
      for (const b of this._furnaceBinds) this._renderSlot(b.el, b.get());
      this._renderFurnaceGauges();
    }, 120);
  }

  // Build the DOM and register the (single) key/mouse handlers.
  _attach() {
    this._build();
    this._onKey = (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyE' || e.code === 'Escape') {
        e.preventDefault();
        this.close();
      }
    };
    this._onMove = (e) => this._trackMouse(e);
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('mousemove', this._onMove);
    this.hooks.audio?.play?.('ui_open');
  }

  /** Idempotent — safe if both main and our key handler call it. */
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    // Return craft grid + cursor contents to the inventory.
    let lost = false;
    for (let i = 0; i < this.craft.length; i++) {
      const s = this.craft[i];
      this.craft[i] = null;
      if (s && this._giveRange(s, 0, 36) > 0) lost = true;
    }
    if (this.cursor) {
      if (this._giveRange(this.cursor, 0, 36) > 0) lost = true;
      this.cursor = null;
    }
    if (lost) this.hooks.toast?.('Inventory full — items lost');
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('mousemove', this._onMove);
    if (this._furnaceTimer) { clearInterval(this._furnaceTimer); this._furnaceTimer = null; }
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    this._binds = [];
    this._furnaceBinds = [];
    this._recipe = null;
    this.container = null;       // slots persist in the save system
    this.containerTitle = '';
    this.furnace = null;         // slots persist in the save system
    this.furnaceTitle = '';
    this.resultEl = null;
    this.hooks.audio?.play?.('ui_close');
    if (this.onClose) this.onClose();
  }

  // ── DOM ──────────────────────────────────────────────────────────
  _build() {
    const ov = el('div', 'inv-overlay');
    ov.addEventListener('contextmenu', (e) => e.preventDefault());
    this.overlay = ov;
    this._binds = [];

    const panel = el('div', 'inv-panel', ov);
    el('div', 'inv-title', panel).textContent =
      this.furnace ? this.furnaceTitle
      : this.container ? this.containerTitle
      : TITLES[this.station || 'pocket'];

    if (this.furnace) {
      this._buildFurnace(panel);
    } else if (this.container) {
      // Container 2×9 (no crafting area); slots mutate the live array in place.
      const cgrid = el('div', 'inv-grid inv-container', panel);
      const box = this.container;
      for (let i = 0; i < box.length; i++) {
        const idx = i;
        this._mkSlot(cgrid, 'container', () => box[idx], (v) => { box[idx] = v; });
      }
      this.resultEl = null;
    } else {
      // Worn-armor strip (survival inventory only, MC-style)
      if (!this.station) this._buildArmor(panel);
      // Crafting area: grid → arrow → result
      const craft = el('div', 'inv-craft', panel);
      const grid = el('div', 'inv-grid inv-craft-grid', craft);
      grid.style.setProperty('--n', String(this.gridSize));
      for (let i = 0; i < this.craft.length; i++) {
        const idx = i;
        this._mkSlot(grid, 'craft', () => this.craft[idx], (v) => { this.craft[idx] = v; });
      }
      el('div', 'inv-arrow', craft);
      this.resultEl = el('div', 'slot inv-result', craft);
      this.resultEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        this._takeResult();
      });
      if (this.station === 'kiln') {
        el('div', 'inv-hint', panel).textContent = 'Add coal as fuel in the grid';
      }
    }

    // Backpack 3×9 (slots 9..35), then hotbar row (slots 0..8)
    const pack = el('div', 'inv-grid inv-pack', panel);
    for (let i = 9; i < 36; i++) {
      const idx = i;
      this._mkSlot(pack, 'pack', () => this.player.slots[idx], (v) => { this.player.slots[idx] = v; });
    }
    const hot = el('div', 'inv-grid inv-hotrow', panel);
    for (let i = 0; i < 9; i++) {
      const idx = i;
      this._mkSlot(hot, 'hotbar', () => this.player.slots[idx], (v) => { this.player.slots[idx] = v; });
    }

    if (this.player.mode === MODE_BUILDER) this._buildCatalog(ov);

    this.cursorEl = el('div', 'inv-cursor', ov);
    this.tipEl = el('div', 'inv-tooltip', ov);

    this.root.appendChild(ov);
    if (this.resultEl) this._updateResult();
    this._renderAll();
  }

  _mkSlot(parent, zone, get, set, accept) {
    const slotEl = el('div', 'slot', parent);
    const bind = { el: slotEl, zone, get, set, accept };
    slotEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      this._slotClick(bind, e);
    });
    slotEl.addEventListener('mouseenter', () => this._showTip(bind));
    slotEl.addEventListener('mouseleave', () => this._hideTip());
    this._binds.push(bind);
    return bind;
  }

  // ── Armor ────────────────────────────────────────────────────────
  // Four worn-armor slots (helmet/chest/legs/boots) backed by player.armor;
  // each only accepts the matching piece.
  _buildArmor(panel) {
    const wrap = el('div', 'inv-armor', panel);
    el('div', 'inv-armor-label', wrap).textContent = 'Armor';
    const row = el('div', 'inv-grid inv-armor-row', wrap);
    const P = this.player;
    const names = ['Helmet', 'Chestplate', 'Leggings', 'Boots'];
    for (let i = 0; i < 4; i++) {
      const idx = i;
      const bind = this._mkSlot(row, 'armor', () => P.armor[idx], (v) => { P.armor[idx] = v; },
        (stack) => { const dd = itemByKey(stack.key); return !!(dd && dd.armor && dd.armor.slot === idx); });
      bind.el.title = names[i];
    }
  }

  // ── Furnace ──────────────────────────────────────────────────────
  // Input (top) + fuel (bottom) split by a flame gauge, an animated
  // smelt arrow, and a take-only output slot. State is ticked by the
  // game loop; this view reflects it and edits the input/fuel slots.
  _buildFurnace(panel) {
    this.resultEl = null;
    const f = this.furnace;
    const wrap = el('div', 'inv-furnace', panel);

    const col = el('div', 'inv-furnace-col', wrap);
    const inBind = this._mkSlot(col, 'furnace', () => f.input, (v) => { f.input = v; });
    const flame = el('div', 'inv-flame', col);
    this._flameFill = el('i', '', flame);
    const fuelBind = this._mkSlot(col, 'furnace', () => f.fuel, (v) => { f.fuel = v; });

    const arrow = el('div', 'inv-smelt-arrow', wrap);
    this._arrowFill = el('i', '', arrow);

    const outBind = this._mkFurnaceOutput(wrap);
    this._furnaceBinds = [inBind, fuelBind, outBind];
    this._renderFurnaceGauges();
  }

  _mkFurnaceOutput(parent) {
    const slotEl = el('div', 'slot inv-result inv-furnace-out', parent);
    const bind = { el: slotEl, zone: 'furnace-out', get: () => this.furnace.output, set: () => {} };
    slotEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this._takeFurnaceOutput(e.shiftKey);
      this._hideTip();
      this._renderAll();
      this.hooks.audio?.play?.('ui_click');
    });
    slotEl.addEventListener('mouseenter', () => this._showTip(bind));
    slotEl.addEventListener('mouseleave', () => this._hideTip());
    this._binds.push(bind);
    return bind;
  }

  // Take from the output: shift → straight to inventory, else onto cursor.
  _takeFurnaceOutput(toInv) {
    const f = this.furnace;
    const s = f.output;
    if (!s) return;
    if (toInv) {
      const leftover = this._giveRange(s, 0, 36);
      f.output = leftover > 0 ? s : null;
      return;
    }
    const def = itemByKey(s.key);
    const max = def ? def.maxStack : 64;
    if (this.cursor) {
      if (this.cursor.key !== s.key || this.cursor.dur !== undefined) return;
      const take = Math.min(max - this.cursor.count, s.count);
      if (take <= 0) return;
      this.cursor.count += take;
      s.count -= take;
    } else {
      this.cursor = { key: s.key, count: s.count };
      s.count = 0;
    }
    if (s.count <= 0) f.output = null;
  }

  // Shift-click routing into the furnace: smeltables → input, fuels → fuel.
  _giveIntoFurnace(stack) {
    const f = this.furnace;
    const targets = [];
    if (smeltRecipe(stack.key)) targets.push('input');
    if (isFuel(stack.key)) targets.push('fuel');
    if (!targets.length) return stack.count;
    const def = itemByKey(stack.key);
    const max = def ? def.maxStack : 64;
    for (const which of targets) {
      if (stack.count <= 0) break;
      const cur = f[which];
      if (!cur) { f[which] = { key: stack.key, count: stack.count }; stack.count = 0; }
      else if (cur.key === stack.key && cur.dur === undefined && cur.count < max) {
        const take = Math.min(max - cur.count, stack.count);
        cur.count += take; stack.count -= take;
      }
    }
    return stack.count;
  }

  _renderFurnaceGauges() {
    const f = this.furnace;
    if (!f) return;
    if (this._flameFill) {
      const lit = f.burnMax > 0 ? Math.max(0, Math.min(1, f.burn / f.burnMax)) : 0;
      this._flameFill.style.height = `${Math.round(lit * 100)}%`;
    }
    if (this._arrowFill) {
      const prog = Math.max(0, Math.min(1, (f.cook || 0) / COOK_SECONDS));
      this._arrowFill.style.width = `${Math.round(prog * 100)}%`;
    }
  }

  _buildCatalog(ov) {
    this._catalog = catalogItems();
    const panel = el('div', 'inv-catalog', ov);
    const row = el('div', 'inv-tabs', panel);
    this._tabBtns = new Map();
    for (const [id, label] of TABS) {
      const b = el('button', 'inv-tab', row);
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => this._setTab(id));
      this._tabBtns.set(id, b);
    }
    this.catGrid = el('div', 'inv-grid inv-catalog-grid', panel);
    this._setTab(this._tab);
  }

  _setTab(id) {
    this._tab = id;
    for (const [k, b] of this._tabBtns) b.classList.toggle('on', k === id);
    this.catGrid.textContent = '';
    for (const key of this._catalog[id]) {
      const def = itemByKey(key);
      if (!def) continue;
      const cell = el('div', 'slot', this.catGrid);
      cell.title = def.name;
      const img = el('img', '', cell);
      img.src = this.iconFor(key);
      img.alt = '';
      cell.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        this._catalogTake(def, e.shiftKey);
      });
      cell.addEventListener('mouseenter', () => this._showTipFor(def, null));
      cell.addEventListener('mouseleave', () => this._hideTip());
    }
  }

  // ── Interactions ─────────────────────────────────────────────────
  _slotClick(bind, e) {
    if (e.button === 0 && e.shiftKey) this._quickMove(bind);
    else if (e.button === 0) this._leftClick(bind);
    else this._rightClick(bind);
    if (bind.zone === 'craft') this._updateResult();
    this._hideTip();
    this._renderAll();
    this.hooks.audio?.play?.('ui_click');
  }

  _leftClick(bind) {
    const cur = this.cursor;
    const s = bind.get();
    if (cur && bind.accept && !bind.accept(cur)) return;   // slot rejects this item
    if (!cur) {
      if (s) { bind.set(null); this.cursor = s; }
      return;
    }
    if (!s) { bind.set(cur); this.cursor = null; return; }
    const def = itemByKey(s.key);
    if (def && s.key === cur.key && s.dur === undefined && cur.dur === undefined &&
        s.count < def.maxStack) {
      const take = Math.min(def.maxStack - s.count, cur.count);
      s.count += take;
      cur.count -= take;
      if (cur.count <= 0) this.cursor = null;
      bind.set(s);
    } else {
      bind.set(cur);
      this.cursor = s;
    }
  }

  _rightClick(bind) {
    const cur = this.cursor;
    const s = bind.get();
    if (cur && bind.accept && !bind.accept(cur)) return;   // slot rejects this item
    if (!cur) {                       // pick up half
      if (!s) return;
      const half = Math.ceil(s.count / 2);
      this.cursor = { ...s, count: half };
      s.count -= half;
      bind.set(s.count > 0 ? s : null);
      return;
    }
    if (!s) {                         // place one
      bind.set({ ...cur, count: 1 });
      cur.count -= 1;
      if (cur.count <= 0) this.cursor = null;
      return;
    }
    const def = itemByKey(s.key);
    if (def && s.key === cur.key && s.dur === undefined && cur.dur === undefined &&
        s.count < def.maxStack) {
      s.count += 1;
      cur.count -= 1;
      if (cur.count <= 0) this.cursor = null;
      bind.set(s);
    }
  }

  _quickMove(bind) {
    const s = bind.get();
    if (!s) return;
    let leftover;
    if (bind.zone === 'container') {
      leftover = this._giveRange(s, 0, 36);         // container → player inv
    } else if (bind.zone === 'armor') {
      leftover = this._giveRange(s, 0, 36);         // unequip → player inv
    } else if ((bind.zone === 'pack' || bind.zone === 'hotbar') && itemByKey(s.key)?.armor
               && !this.furnace && !this.container) {
      const slot = itemByKey(s.key).armor.slot;     // shift-click → equip
      if (!this.player.armor[slot]) { this.player.armor[slot] = s; leftover = 0; }
      else leftover = bind.zone === 'hotbar' ? this._giveRange(s, 9, 36) : this._giveRange(s, 0, 9);
    } else if (bind.zone === 'furnace') {
      leftover = this._giveRange(s, 0, 36);         // furnace slot → player inv
    } else if (this.furnace && (bind.zone === 'pack' || bind.zone === 'hotbar')) {
      const before = s.count;
      leftover = this._giveIntoFurnace(s);          // route smeltables/fuel in
      if (leftover === before) {                    // furnace took nothing
        leftover = bind.zone === 'hotbar' ? this._giveRange(s, 9, 36) : this._giveRange(s, 0, 9);
      }
    } else if (this.container) {                    // pack/hotbar → container
      leftover = this._giveInto(this.container, s, 0, this.container.length);
    } else if (bind.zone === 'hotbar') leftover = this._giveRange(s, 9, 36);
    else if (bind.zone === 'pack') leftover = this._giveRange(s, 0, 9);
    else leftover = this._giveRange(s, 0, 36);      // craft grid → anywhere
    bind.set(leftover > 0 ? s : null);
  }

  // Move a stack into player.slots[lo..hi): merge first, then empties.
  // Mutates stack.count; returns leftover count.
  _giveRange(stack, lo, hi) {
    return this._giveInto(this.player.slots, stack, lo, hi);
  }

  // Same, into an arbitrary slot array (e.g. a live container).
  _giveInto(slots, stack, lo, hi) {
    const def = itemByKey(stack.key);
    if (!def) return stack.count;
    if (stack.dur === undefined && def.maxStack > 1) {
      for (let i = lo; i < hi && stack.count > 0; i++) {
        const s = slots[i];
        if (s && s.key === stack.key && s.dur === undefined && s.count < def.maxStack) {
          const take = Math.min(def.maxStack - s.count, stack.count);
          s.count += take;
          stack.count -= take;
        }
      }
    }
    for (let i = lo; i < hi && stack.count > 0; i++) {
      if (!slots[i]) {
        const take = Math.min(def.maxStack, stack.count);
        const ns = { key: stack.key, count: take };
        if (stack.dur !== undefined) ns.dur = stack.dur;
        slots[i] = ns;
        stack.count -= take;
      }
    }
    return stack.count;
  }

  _catalogTake(def, shift) {
    if (shift) {                      // straight to inventory
      this.player.addItem(def.key, def.maxStack);
    } else {                          // full stack to cursor (infinite source)
      if (this.cursor) {
        // Stow the held stack first; if the inventory can't take all of it,
        // keep holding the remainder instead of destroying it.
        if (this._giveRange(this.cursor, 0, 36) > 0) {
          this.hooks.toast?.('Inventory full');
          this._renderAll();
          return;
        }
        this.cursor = null;
      }
      const stack = { key: def.key, count: def.maxStack };
      if (def.kind === 'tool') stack.dur = def.tool.durability;
      this.cursor = stack;
    }
    this._renderAll();
    this.hooks.audio?.play?.('ui_click');
  }

  // ── Crafting ─────────────────────────────────────────────────────
  _updateResult() {
    if (!this.resultEl) return;      // container mode: no crafting area
    const keys = this.craft.map((s) => (s ? s.key : null));
    this._recipe = matchRecipe(keys, this.gridSize, this.station);
    const r = this.resultEl;
    r.textContent = '';
    r.title = '';
    r.classList.toggle('has', !!this._recipe);
    if (!this._recipe) return;
    const def = itemByKey(this._recipe.out);
    r.title = def ? def.name : this._recipe.out;
    const img = el('img', '', r);
    img.src = this.iconFor(this._recipe.out);
    img.alt = '';
    if (this._recipe.count > 1) el('span', 'count', r).textContent = this._recipe.count;
  }

  _takeResult() {
    const recipe = this._recipe;
    if (!recipe) return;
    const def = itemByKey(recipe.out);
    if (!def) return;
    if (this.cursor) {                // merge into cursor if same key & fits
      if (this.cursor.key !== recipe.out || this.cursor.dur !== undefined ||
          this.cursor.count + recipe.count > def.maxStack) return;
      this.cursor.count += recipe.count;
    } else {
      this.cursor = { key: recipe.out, count: recipe.count };
      if (def.kind === 'tool') this.cursor.dur = def.tool.durability;
    }
    for (let i = 0; i < this.craft.length; i++) {   // consume 1 of each
      const s = this.craft[i];
      if (s) {
        s.count -= 1;
        if (s.count <= 0) this.craft[i] = null;
      }
    }
    this.hooks.audio?.play?.('ui_click');
    this._updateResult();
    this._renderAll();
  }

  // ── Rendering (event-driven, never per frame) ────────────────────
  _renderAll() {
    for (const b of this._binds) this._renderSlot(b.el, b.get());
    this._renderCursor();
  }

  _renderSlot(slotEl, st) {
    slotEl.textContent = '';
    slotEl.title = '';
    if (!st) return;
    const def = itemByKey(st.key);
    if (def) slotEl.title = def.name;
    const img = el('img', '', slotEl);
    img.src = this.iconFor(st.key);
    img.alt = '';
    if (st.count > 1) el('span', 'count', slotEl).textContent = st.count;
    if (st.dur !== undefined && def && def.tool) {
      const bar = el('div', 'durbar', slotEl);
      const fill = el('i', '', bar);
      const frac = Math.max(0, st.dur / def.tool.durability);
      fill.style.width = `${frac * 100}%`;
      fill.style.background = `hsl(${Math.round(frac * 105)}, 65%, 48%)`;
    }
  }

  _renderCursor() {
    const c = this.cursorEl;
    c.classList.toggle('on', !!this.cursor);
    c.textContent = '';
    if (!this.cursor) return;
    this._hideTip();
    const img = el('img', '', c);
    img.src = this.iconFor(this.cursor.key);
    img.alt = '';
    if (this.cursor.count > 1) el('span', 'count', c).textContent = this.cursor.count;
    c.style.left = `${this._mx}px`;
    c.style.top = `${this._my}px`;
  }

  // ── Tooltip + cursor tracking ────────────────────────────────────
  _trackMouse(e) {
    this._mx = e.clientX;
    this._my = e.clientY;
    if (this.cursorEl) {
      this.cursorEl.style.left = `${e.clientX}px`;
      this.cursorEl.style.top = `${e.clientY}px`;
    }
    if (this._tipOn) this._placeTip();
  }

  _showTip(bind) {
    const s = bind.get();
    if (!s) { this._hideTip(); return; }
    this._showTipFor(itemByKey(s.key), s);
  }

  _showTipFor(def, stack) {
    if (!def || this.cursor) return;   // no tooltips while holding a stack
    const tip = this.tipEl;
    tip.textContent = '';
    el('div', 'tt-name', tip).textContent = (stack && stack.name) || def.name;
    if (stack && stack.ench) {
      for (const [k, lv] of Object.entries(stack.ench)) {
        if (lv > 0) el('div', 'tt-ench', tip).textContent = `${ENCHANT_NAMES[k] || k} ${lv}`;
      }
    }
    if (def.desc) el('div', 'tt-desc', tip).textContent = def.desc;
    if (def.tool && stack && stack.dur !== undefined) {
      el('div', 'tt-dur', tip).textContent = `Durability ${stack.dur}/${def.tool.durability}`;
    }
    tip.classList.add('on');
    this._tipOn = true;
    this._placeTip();
  }

  _hideTip() {
    if (!this.tipEl) return;
    this.tipEl.classList.remove('on');
    this._tipOn = false;
  }

  _placeTip() {
    const tip = this.tipEl;
    const pad = 14;
    const r = tip.getBoundingClientRect();
    let x = this._mx + pad;
    let y = this._my + pad;
    if (x + r.width > innerWidth - 8) x = this._mx - r.width - pad;
    if (y + r.height > innerHeight - 8) y = this._my - r.height - pad;
    tip.style.left = `${Math.max(4, x)}px`;
    tip.style.top = `${Math.max(4, y)}px`;
  }
}
