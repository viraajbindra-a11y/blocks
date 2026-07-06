// Keyboard + mouse input with pointer lock. Edge-triggered "pressed"
// states reset at the end of each frame (call endFrame()).

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();          // held key codes
    this.pressedKeys = new Set();   // pressed this frame
    this.lookDX = 0;
    this.lookDY = 0;
    this.wheel = 0;
    this.buttons = [false, false, false];
    this.buttonPressed = [false, false, false];
    this.locked = false;
    this.onLockChange = null;
    this.enabled = true;            // false while a menu owns the input

    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressedKeys.add(e.code);
      // Keep browser shortcuts from stealing game keys while locked
      if (this.locked && ['Space', 'Tab', 'KeyE'].includes(e.code)) e.preventDefault();
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons = [false, false, false]; });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button <= 2) { this.buttons[e.button] = true; this.buttonPressed[e.button] = true; }
      if (e.button === 1) e.preventDefault();
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button <= 2) this.buttons[e.button] = false;
    });
    document.addEventListener('wheel', (e) => {
      if (this.locked) this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.keys.clear(); this.buttons = [false, false, false]; }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  requestLock() {
    if (this.locked) return;
    try {
      // May reject without user activation (e.g. right after a slow load) —
      // harmless; the next canvas click re-requests it.
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* unsupported promise form */ }
  }
  releaseLock() {
    if (this.locked) document.exitPointerLock();
  }

  down(code) { return this.enabled && this.keys.has(code); }
  pressed(code) { return this.enabled && this.pressedKeys.has(code); }
  consumeLook() {
    const d = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0; this.lookDY = 0;
    return d;
  }
  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }

  endFrame() {
    this.pressedKeys.clear();
    this.buttonPressed = [false, false, false];
  }
}
