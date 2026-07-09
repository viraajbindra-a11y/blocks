// In-game HUD: hotbar, ember health, leaf hunger, air bubbles, crosshair
// with break-progress ring, debug chip, toasts, damage flash, water tint.
// All DOM built once; per-frame updates only touch what changed.

import { MODE_BUILDER } from '../core/constants.js';
import { itemByKey } from '../items.js';

function el(tag, cls, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

export class HUD {
  /** @param {HTMLElement} root #hud element @param {(key:string)=>string} iconFor item icon dataURL */
  constructor(root, iconFor) {
    this.root = root;
    this.iconFor = iconFor;
    this.toastsEl = document.getElementById('toasts');
    this.damageEl = document.getElementById('damage-flash');
    this.tintEl = document.getElementById('water-tint');

    const cross = el('div', 'hud-cross', root);
    el('span', 'dot', cross);
    this.breakEl = el('div', 'hud-break', root);
    this.debugEl = el('div', 'hud-debug', root);

    this.bottom = el('div', 'hud-bottom', root);
    const stats = el('div', 'hud-stats', this.bottom);
    this.healthRow = el('div', 'hud-health', stats);
    this.hungerRow = el('div', 'hud-hunger', stats);
    this.airRow = el('div', 'hud-air', this.bottom);
    this.xpRow = el('div', 'hud-xp', this.bottom);
    this.xpFill = el('i', '', this.xpRow);
    this.xpLevelEl = el('span', 'hud-xp-level', this.xpRow);
    this.hotbarEl = el('div', 'hud-hotbar', this.bottom);

    this.embers = [];
    this.leaves = [];
    this.bubbles = [];
    this.slotEls = [];
    for (let i = 0; i < 10; i++) this.embers.push(el('span', 'ember', this.healthRow));
    for (let i = 0; i < 10; i++) this.leaves.push(el('span', 'leaf', this.hungerRow));
    for (let i = 0; i < 10; i++) this.bubbles.push(el('span', 'bubble', this.airRow));
    for (let i = 0; i < 9; i++) this.slotEls.push(el('div', 'slot', this.hotbarEl));

    this._hotbarSig = null;
    this._last = { health: -1, hunger: -1, air: -1, selected: -1,
      mode: null, underwater: null, debug: '', xpLevel: -1, xpProgress: -1 };
  }

  /** s: {health, hunger, air, maxAir, slots, selected, fps, pos, biomeName,
   *      timeString, showFps, mode, underwater} */
  update(s) {
    const L = this._last;
    if (s.mode !== L.mode) {
      L.mode = s.mode;
      this.bottom.classList.toggle('builder', s.mode === MODE_BUILDER);
    }
    if (s.mode !== MODE_BUILDER) {
      if (s.health !== L.health) {
        L.health = s.health;
        setPips(this.embers, s.health);
        this.healthRow.classList.toggle('low', s.health <= 4);
      }
      if (s.hunger !== L.hunger) {
        L.hunger = s.hunger;
        setPips(this.leaves, s.hunger);
      }
      const uw = !!s.underwater;
      if (uw !== L.underwater) {
        L.underwater = uw;
        this.airRow.classList.toggle('on', uw);
      }
      const air = Math.round(s.air);
      if (air !== L.air) {
        L.air = air;
        for (let i = 0; i < 10; i++) this.bubbles[i].classList.toggle('off', air < i + 1);
      }
      if (s.xpLevel !== L.xpLevel || s.xpProgress !== L.xpProgress) {
        L.xpLevel = s.xpLevel; L.xpProgress = s.xpProgress;
        this.xpFill.style.width = `${Math.round((s.xpProgress || 0) * 100)}%`;
        this.xpLevelEl.textContent = s.xpLevel > 0 ? String(s.xpLevel) : '';
      }
    }

    // Hotbar: rebuild only when slot contents actually change.
    let sig = '';
    for (let i = 0; i < 9; i++) {
      const st = s.slots[i];
      sig += st ? `${st.key}:${st.count}:${st.dur ?? ''}|` : '|';
    }
    if (sig !== this._hotbarSig) {
      this._hotbarSig = sig;
      this._rebuildHotbar(s.slots);
    }
    if (s.selected !== L.selected) {
      L.selected = s.selected;
      for (let i = 0; i < 9; i++) this.slotEls[i].classList.toggle('sel', i === s.selected);
    }

    // Debug chip
    if (s.showFps) {
      const [x, y, z] = s.pos;
      const text = `${Math.round(s.fps)} fps\n` +
        `${x.toFixed(1)}  ${y.toFixed(1)}  ${z.toFixed(1)}\n` +
        `${s.biomeName} · ${s.timeString}`;
      if (text !== L.debug) {
        L.debug = text;
        this.debugEl.textContent = text;
      }
      this.debugEl.classList.add('on');
    } else {
      this.debugEl.classList.remove('on');
    }
  }

  _rebuildHotbar(slots) {
    for (let i = 0; i < 9; i++) {
      const slot = this.slotEls[i];
      slot.textContent = '';
      slot.title = '';
      const st = slots[i];
      if (!st) continue;
      const def = itemByKey(st.key);
      slot.title = def ? def.name : st.key;
      const img = el('img', '', slot);
      img.src = this.iconFor(st.key);
      img.alt = '';
      if (st.count > 1) el('span', 'count', slot).textContent = st.count;
      if (st.dur !== undefined && def && def.tool) {
        const bar = el('div', 'durbar', slot);
        const fill = el('i', '', bar);
        const frac = Math.max(0, st.dur / def.tool.durability);
        fill.style.width = `${frac * 100}%`;
        fill.style.background = `hsl(${Math.round(frac * 105)}, 65%, 48%)`;
      }
    }
  }

  toast(msg, icon) {
    const t = el('div', 'toast', this.toastsEl);
    if (icon) {
      const img = el('img', '', t);
      img.src = icon;
      img.alt = '';
    }
    el('span', 'msg', t).textContent = msg;
    while (this.toastsEl.children.length > 5) this.toastsEl.firstChild.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 320);
    }, 3500);
  }

  flashDamage() {
    const e = this.damageEl;
    e.classList.remove('flash');
    void e.offsetWidth;   // restart animation
    e.classList.add('flash');
  }

  /** kind: 'water' | 'lava' | null */
  setWaterTint(kind) {
    this.tintEl.className = kind || '';
  }

  setVisible(v) {
    this.root.classList.toggle('hidden', !v);
  }

  /** frac 0..1 while mining, null to hide. */
  breakIndicator(frac) {
    if (frac == null) {
      this.breakEl.classList.remove('on');
      return;
    }
    this.breakEl.classList.add('on');
    this.breakEl.style.setProperty('--p', `${Math.round(frac * 360)}deg`);
  }
}

// 10 pips covering 20 points: full / half / off.
function setPips(els, v) {
  for (let i = 0; i < els.length; i++) {
    els[i].classList.toggle('off', v <= i * 2);
    els[i].classList.toggle('half', v === i * 2 + 1);
  }
}
