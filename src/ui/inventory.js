// Inventory & crafting UI: pocket 2×2 / worktable 3×3 / kiln 3×3 grids,
// container view (2×9 stowbox grid, no crafting), cursor-stack
// interactions (click/right-click/shift-click), tooltips, and the
// Builder catalog. Vanilla DOM; slots rerender on change only.

import { MODE_BUILDER } from '../core/constants.js';
import { itemByKey, catalogItems } from '../items.js';
import { matchRecipe } from '../crafting.js';

const TITLES = { pocket: 'Pockets', worktable: 'Worktable', kiln: 'Stone Kiln' };
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
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    this._binds = [];
    this._recipe = null;
    this.container = null;       // slots persist in the save system
    this.containerTitle = '';
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
      this.container ? this.containerTitle : TITLES[this.station || 'pocket'];

    if (this.container) {
      // Container 2×9 (no crafting area); slots mutate the live array in place.
      const cgrid = el('div', 'inv-grid inv-container', panel);
      const box = this.container;
      for (let i = 0; i < box.length; i++) {
        const idx = i;
        this._mkSlot(cgrid, 'container', () => box[idx], (v) => { box[idx] = v; });
      }
      this.resultEl = null;
    } else {
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

  _mkSlot(parent, zone, get, set) {
    const slotEl = el('div', 'slot', parent);
    const bind = { el: slotEl, zone, get, set };
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
    el('div', 'tt-name', tip).textContent = def.name;
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
