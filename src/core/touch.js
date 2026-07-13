// Touch controls for phones/tablets. Drives the SAME Input state that
// keyboard/mouse do — a virtual stick feeds movement keys, a drag area feeds
// look deltas, and on-screen buttons feed jump/sneak/mine/place/inventory.
//
// On a touch device we fake pointer-lock (input.locked = true) and no-op the
// real lock calls, so every gameplay gate that checks `locked` just works and
// the game never pauses for lack of a mouse.

export const isTouchDevice = () =>
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0) &&
  window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

const CSS = `
.touch-ui { position: fixed; inset: 0; z-index: 30; pointer-events: none;
  touch-action: none; -webkit-user-select: none; user-select: none; display: none; }
.touch-ui.on { display: block; }
.touch-look { position: absolute; inset: 0; pointer-events: auto; }
.touch-stick { position: absolute; left: 22px; bottom: 22px; width: 132px; height: 132px;
  border-radius: 50%; background: rgba(255,255,255,.09); border: 2px solid rgba(255,255,255,.22);
  pointer-events: auto; }
.touch-knob { position: absolute; left: 50%; top: 50%; width: 56px; height: 56px; margin: -28px;
  border-radius: 50%; background: rgba(255,255,255,.34); border: 2px solid rgba(255,255,255,.5); }
.touch-btns { position: absolute; right: 16px; bottom: 20px; display: grid;
  grid-template-columns: repeat(2, 64px); gap: 12px; pointer-events: none; }
.touch-btn { pointer-events: auto; width: 64px; height: 64px; border-radius: 50%;
  background: rgba(255,255,255,.12); border: 2px solid rgba(255,255,255,.28);
  color: #fff; font: 600 22px/64px system-ui, sans-serif; text-align: center;
  text-shadow: 0 1px 3px rgba(0,0,0,.6); }
.touch-btn:active, .touch-btn.held { background: rgba(255,255,255,.32); }
.touch-btn.wide { grid-column: span 2; width: auto; border-radius: 32px; }
.touch-top { position: absolute; right: 16px; top: 12px; display: flex; gap: 10px; pointer-events: none; }
@media (pointer: coarse) { .hud-hotbar .slot { min-width: 40px; min-height: 40px; } }
`;

export class TouchControls {
  constructor(canvas, input) {
    this.input = input;
    this.active = false;
    if (!isTouchDevice()) { this.enabled = false; return; }
    this.enabled = true;

    // Fake pointer lock so gameplay gates pass; neutralise real lock calls.
    input.locked = true;
    input.requestLock = () => {};
    input.releaseLock = () => {};

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.className = 'touch-ui';
    root.innerHTML = `
      <div class="touch-look"></div>
      <div class="touch-stick"><div class="touch-knob"></div></div>
      <div class="touch-top"><div class="touch-btn" data-k="inv">▤</div></div>
      <div class="touch-btns">
        <div class="touch-btn" data-k="break">⛏</div>
        <div class="touch-btn" data-k="place">▣</div>
        <div class="touch-btn" data-k="sneak">⤓</div>
        <div class="touch-btn" data-k="jump">⤒</div>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this._bindStick(root.querySelector('.touch-stick'), root.querySelector('.touch-knob'));
    this._bindLook(root.querySelector('.touch-look'));
    for (const b of root.querySelectorAll('.touch-btn')) this._bindButton(b);
    this._moveKeys = new Set();
  }

  setActive(on) {
    if (!this.enabled || on === this.active) return;
    this.active = on;
    this.root.classList.toggle('on', on);
    if (!on) this._clearMovement();
  }

  _clearMovement() {
    for (const k of this._moveKeys) this.input.keys.delete(k);
    this._moveKeys.clear();
  }

  // Left virtual stick → WASD keys based on the knob offset.
  _bindStick(base, knob) {
    let id = null, cx = 0, cy = 0;
    const R = 60;
    const start = (t) => {
      const r = base.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2; id = t.identifier; move(t);
    };
    const move = (t) => {
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const m = Math.hypot(dx, dy) || 1;
      if (m > R) { dx = dx / m * R; dy = dy / m * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const nx = dx / R, ny = dy / R;
      this._setKey('KeyW', ny < -0.3); this._setKey('KeyS', ny > 0.3);
      this._setKey('KeyA', nx < -0.3); this._setKey('KeyD', nx > 0.3);
    };
    const end = () => { id = null; knob.style.transform = ''; this._clearMovement(); };
    base.addEventListener('touchstart', (e) => { e.preventDefault(); if (id === null) start(e.changedTouches[0]); }, { passive: false });
    base.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === id) move(t);
    }, { passive: false });
    base.addEventListener('touchend', (e) => { for (const t of e.changedTouches) if (t.identifier === id) end(); }, { passive: false });
    base.addEventListener('touchcancel', end);
  }

  _setKey(code, on) {
    if (on) { this.input.keys.add(code); this._moveKeys.add(code); }
    else { this.input.keys.delete(code); this._moveKeys.delete(code); }
  }

  // Right-side drag → look deltas.
  _bindLook(area) {
    let id = null, lx = 0, ly = 0;
    area.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (id !== null) return;
      const t = e.changedTouches[0]; id = t.identifier; lx = t.clientX; ly = t.clientY;
    }, { passive: false });
    area.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === id) {
        this.input.lookDX += (t.clientX - lx) * 1.6;
        this.input.lookDY += (t.clientY - ly) * 1.6;
        lx = t.clientX; ly = t.clientY;
      }
    }, { passive: false });
    const end = (e) => { for (const t of e.changedTouches) if (t.identifier === id) id = null; };
    area.addEventListener('touchend', end);
    area.addEventListener('touchcancel', end);
  }

  _bindButton(el) {
    const kind = el.dataset.k;
    const press = (e) => {
      e.preventDefault(); e.stopPropagation(); el.classList.add('held');
      const inp = this.input;
      if (kind === 'jump') inp.keys.add('Space');
      else if (kind === 'sneak') { this._sneak = !this._sneak; el.classList.toggle('held', this._sneak); this._sneak ? inp.keys.add('ShiftLeft') : inp.keys.delete('ShiftLeft'); }
      else if (kind === 'break') { inp.buttons[0] = true; inp.buttonPressed[0] = true; }
      else if (kind === 'place') { inp.buttons[2] = true; inp.buttonPressed[2] = true; }
      else if (kind === 'inv') inp.pressedKeys.add('KeyE');
    };
    const release = (e) => {
      e.preventDefault(); const inp = this.input;
      if (kind === 'jump') { inp.keys.delete('Space'); el.classList.remove('held'); }
      else if (kind === 'break') { inp.buttons[0] = false; el.classList.remove('held'); }
      else if (kind === 'place') { inp.buttons[2] = false; el.classList.remove('held'); }
      else if (kind !== 'sneak') el.classList.remove('held');
    };
    el.addEventListener('touchstart', press, { passive: false });
    el.addEventListener('touchend', release, { passive: false });
    el.addEventListener('touchcancel', release, { passive: false });
  }
}
