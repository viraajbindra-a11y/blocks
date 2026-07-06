// Persistent user settings (localStorage-backed).

const KEY = 'loam.settings.v1';   // legacy internal key — kept so settings survive the rebrand

const DEFAULTS = {
  renderDistance: 8,      // chunks (4..14)
  fov: 75,                // degrees
  sensitivity: 1.0,       // mouse multiplier
  invertY: false,
  volMaster: 0.8,
  volMusic: 0.55,
  volSfx: 0.9,
  volAmbient: 0.7,
  headBob: true,
  clouds: true,
  particles: true,
  showFps: false,
};

export class Settings {
  constructor() {
    this.data = { ...DEFAULTS };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch { /* private mode etc. — run on defaults */ }
    this.listeners = new Map();
  }

  get(k) { return this.data[k]; }

  set(k, v) {
    this.data[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
    const ls = this.listeners.get(k);
    if (ls) for (const fn of ls) fn(v);
  }

  onChange(k, fn) {
    if (!this.listeners.has(k)) this.listeners.set(k, new Set());
    this.listeners.get(k).add(fn);
  }

  reset() {
    this.data = { ...DEFAULTS };
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }
}
