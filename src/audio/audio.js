// BLOCKS — fully procedural Web Audio engine. Every sound is synthesized at
// runtime from oscillators and filtered noise; no samples, no assets.
// All methods are safe no-ops until resume() is called after a user gesture.

/** @param {import('../core/config.js').Settings} settings */
export function createAudio(settings) {
  let ctx = null;
  let white = null, brown = null;          // shared noise buffers
  const bus = {};                           // master/sfx/music/ambient GainNodes
  const vols = {};                          // settings-driven bus volumes
  let paused = false;

  // Duck factors applied while menus are open (setPaused(true)).
  const DUCK = { master: 1, sfx: 0.45, music: 0.15, ambient: 0.2 };
  const KEYS = { volMaster: 'master', volSfx: 'sfx', volMusic: 'music', volAmbient: 'ambient' };
  for (const [k, b] of Object.entries(KEYS)) {
    vols[b] = settings.get(k) ?? 1;
    settings.onChange(k, v => { vols[b] = v; if (ctx) applyBusGain(b); });
  }

  function applyBusGain(name) {
    const v = vols[name] * (paused ? DUCK[name] : 1);
    bus[name].gain.setTargetAtTime(v, ctx.currentTime, 0.08);
  }

  // ── Buffers & tiny helpers ─────────────────────────────────────
  function makeNoise(secs, browny) {
    const n = Math.floor(ctx.sampleRate * secs);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (browny) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else d[i] = w;
    }
    return buf;
  }

  function ramp(param, v, secs) {
    const t = ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(v, t + secs);
  }

  function lfo(hz, amp, param, type = 'sine') {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz;
    const g = ctx.createGain(); g.gain.value = amp;
    o.connect(g); g.connect(param); o.start();
    return o;
  }

  // Short filtered-noise burst — the workhorse for steps/breaks/impacts.
  function burst({ at = 0, dur = 0.08, type = 'bandpass', freq = 700, q = 1, vol = 0.5,
                   pitch = 1, attack = 0.003, freqEnd = 0, rateDrop = 0,
                   buffer = white, dest = bus.sfx }) {
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = true;
    src.playbackRate.setValueAtTime(pitch, t);
    if (rateDrop) src.playbackRate.linearRampToValueAtTime(pitch * rateDrop, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(30, freq * pitch), t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd * pitch), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t); src.stop(t + dur + 0.05);
  }

  // Simple oscillator blip with optional pitch glide.
  function blip({ at = 0, type = 'sine', freq = 440, freqEnd = 0, dur = 0.1, vol = 0.25,
                  attack = 0.004, detune = 0, dest = bus.sfx }) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type; o.detune.value = detune;
    o.frequency.setValueAtTime(Math.max(20, freq), t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ── One-shot registry: name -> synth(vol, pitch) ───────────────
  const SYNTHS = {
    ui_click(v, p) {
      burst({ dur: 0.012, type: 'highpass', freq: 2600, q: 0.7, vol: 0.22 * v, pitch: p, attack: 0.001 });
    },
    ui_open(v, p) {
      blip({ type: 'sine', freq: 480 * p, dur: 0.06, vol: 0.14 * v });
      blip({ at: 0.055, type: 'sine', freq: 720 * p, dur: 0.08, vol: 0.14 * v });
    },
    ui_close(v, p) {
      blip({ type: 'sine', freq: 720 * p, dur: 0.06, vol: 0.14 * v });
      blip({ at: 0.055, type: 'sine', freq: 480 * p, dur: 0.08, vol: 0.14 * v });
    },
    eat(v, p) {
      for (let i = 0; i < 3; i++) {
        burst({ at: i * 0.11, dur: 0.06, type: 'lowpass', freq: 650 + Math.random() * 350,
                q: 1, vol: 0.4 * v, pitch: p * (0.9 + Math.random() * 0.2) });
      }
    },
    hurt(v, p) {
      blip({ type: 'sawtooth', freq: 380 * p, freqEnd: 150 * p, dur: 0.2, vol: 0.26 * v });
    },
    death(v, p) {
      blip({ type: 'triangle', freq: 220 * p, freqEnd: 82 * p, dur: 1.4, vol: 0.24 * v, attack: 0.02 });
      blip({ type: 'triangle', freq: 261.6 * p, freqEnd: 98 * p, dur: 1.4, vol: 0.17 * v, attack: 0.02 }); // minor third
      blip({ type: 'sine', freq: 110 * p, freqEnd: 55 * p, dur: 1.6, vol: 0.2 * v, attack: 0.02 });
    },
    tool_break(v, p) {
      burst({ dur: 0.1, type: 'bandpass', freq: 1500, q: 3, vol: 0.45 * v, pitch: p });
      blip({ at: 0.02, type: 'square', freq: 820 * p, freqEnd: 240 * p, dur: 0.28, vol: 0.14 * v });
    },
    pickup(v, p) {
      blip({ type: 'sine', freq: 660 * p, dur: 0.07, vol: 0.18 * v });
      blip({ at: 0.06, type: 'sine', freq: 990 * p, dur: 0.09, vol: 0.18 * v });
    },
    splash(v, p) {
      burst({ dur: 0.55, type: 'lowpass', freq: 320, freqEnd: 1900, q: 0.8,
              vol: 0.45 * v, pitch: p, attack: 0.06 });
      blip({ at: 0.03, type: 'sine', freq: 300 * p, freqEnd: 700 * p, dur: 0.1, vol: 0.12 * v });
    },
    jump_land(v, p) {
      burst({ dur: 0.09, type: 'lowpass', freq: 260, q: 0.8, vol: 0.38 * v, pitch: p });
      burst({ dur: 0.04, type: 'highpass', freq: 2000, q: 0.6, vol: 0.07 * v, pitch: p });
    },
    rift_travel(v, p) {
      // 1.2s whoosh: bandpassed noise sweeping up while a low sine falls away.
      burst({ dur: 1.2, type: 'bandpass', freq: 200, freqEnd: 2400, q: 1.4,
              vol: 0.55 * v, pitch: p, attack: 0.18 });
      blip({ type: 'sine', freq: 190 * p, freqEnd: 46 * p, dur: 1.1, vol: 0.3 * v, attack: 0.05 });
    },
    boss_sting(v, p) {
      // Two-note low brass-ish sting: detuned saws through a closing lowpass.
      const t = ctx.currentTime;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 1.2;
      lp.frequency.setValueAtTime(1000, t);
      lp.frequency.exponentialRampToValueAtTime(240, t + 1.5);
      lp.connect(bus.sfx);
      for (const [at, dur, f, vol] of [[0, 0.55, 92.5, 0.3], [0.5, 1.0, 69.3, 0.36]]) {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t + at);
        g.gain.linearRampToValueAtTime(vol * v, t + at + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
        g.connect(lp);
        for (const det of [-10, 10]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth'; o.frequency.value = f * p; o.detune.value = det;
          o.connect(g); o.start(t + at); o.stop(t + at + dur + 0.1);
        }
      }
    },
  };

  function play(name, opts = {}) {
    if (!ctx) return;
    const fn = SYNTHS[name];
    if (fn) fn(opts.vol ?? 1, opts.pitch ?? 1);
  }

  // ── Block-material sounds ──────────────────────────────────────
  const FAMILY = {
    stone:  { type: 'bandpass', freq: 720,  q: 2.5, vol: 0.5 },
    soft:   { type: 'lowpass',  freq: 300,  q: 0.7, vol: 0.55 },
    wood:   { type: 'bandpass', freq: 520,  q: 5,   vol: 0.45, knock: 185 },
    sand:   { type: 'highpass', freq: 1700, q: 0.7, vol: 0.35 },
    snow:   { type: 'lowpass',  freq: 950,  q: 1,   vol: 0.4,  crunch: true },
    glass:  { type: 'bandpass', freq: 2600, q: 3,   vol: 0.35, ping: 2100 },
    metal:  { type: 'bandpass', freq: 1500, q: 4,   vol: 0.35, ring: true },
    plant:  { type: 'lowpass',  freq: 1500, q: 0.4, vol: 0.3 },
    liquid: { type: 'lowpass',  freq: 750,  q: 1,   vol: 0.4,  blip: true },
  };
  const PREFIX = {
    step:  { dur: 0.06, vol: 0.55, jitter: 0.03 },
    hit:   { dur: 0.06, vol: 0.4 },
    place: { dur: 0.09, vol: 0.85 },
    break: { dur: 0.18, vol: 1.0, drop: true },
  };

  function blockSound(prefix, family) {
    if (!ctx) return;
    const f = FAMILY[family] || FAMILY.stone;
    const p = PREFIX[prefix] || PREFIX.step;
    const pitch = 0.88 + Math.random() * 0.24;
    const dur = p.dur + (p.jitter ? Math.random() * p.jitter : 0);
    const vol = f.vol * p.vol;
    burst({ dur, type: f.type, freq: f.freq, q: f.q, vol, pitch,
            freqEnd: p.drop ? f.freq * 0.5 : 0, rateDrop: p.drop ? 0.6 : 0 });
    if (f.crunch)  // snow: second micro-burst for the two-stage crunch
      burst({ at: 0.035, dur: dur * 0.7, type: f.type, freq: f.freq * 0.8, q: f.q,
              vol: vol * 0.7, pitch: pitch * 1.12 });
    if (f.knock) blip({ type: 'triangle', freq: f.knock * pitch, dur: Math.min(dur, 0.09), vol: vol * 0.5 });
    if (f.ping)  blip({ type: 'sine', freq: f.ping * pitch, dur: dur + 0.08, vol: vol * 0.45 });
    if (f.ring)  blip({ type: 'sine', freq: 1200 + Math.random() * 800, dur: dur + 0.1, vol: vol * 0.4 });
    if (f.blip)  blip({ type: 'sine', freq: 300 * pitch, freqEnd: 620 * pitch, dur: 0.08, vol: vol * 0.6 });
  }

  // ── Ambient scene ──────────────────────────────────────────────
  let scene = { night: 0, underground: false, weatherKind: 'clear', inWater: false, biome: 2,
                dimension: 'overworld' };
  let ambLP, windGain, rainGain, birdsGain, cricketsGain, caveGain, smolderGain, hollowGain;
  let birdsOn = false, caveOn = false, smolderOn = false, hollowOn = false;

  function loopNoise(dest, buffer = white) {
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = true;
    src.connect(dest); src.start();
    return src;
  }

  function buildAmbient() {
    // Everything ambient flows through one lowpass so inWater muffles it all.
    ambLP = ctx.createBiquadFilter();
    ambLP.type = 'lowpass'; ambLP.frequency.value = 16000;
    ambLP.connect(bus.ambient);

    // Wind — lowpassed noise with slow filter + amplitude wobble.
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass'; wf.frequency.value = 320; wf.Q.value = 0.9;
    lfo(0.07, 160, wf.frequency);
    const wob = ctx.createGain(); wob.gain.value = 1;
    lfo(0.05, 0.25, wob.gain);
    windGain = ctx.createGain(); windGain.gain.value = 0;
    loopNoise(wf); wf.connect(wob).connect(windGain).connect(ambLP);

    // Rain — brighter lowpassed noise with a gentle shimmer.
    const rf = ctx.createBiquadFilter();
    rf.type = 'lowpass'; rf.frequency.value = 1100; rf.Q.value = 0.5;
    lfo(0.3, 180, rf.frequency);
    rainGain = ctx.createGain(); rainGain.gain.value = 0;
    loopNoise(rf); rf.connect(rainGain).connect(ambLP);

    // Crickets — high sine pulsed by a square LFO.
    const am = ctx.createGain(); am.gain.value = 0.5;
    lfo(12, 0.5, am.gain, 'square');
    cricketsGain = ctx.createGain(); cricketsGain.gain.value = 0;
    for (const f of [4300, 4308]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      o.connect(am); o.start();
    }
    am.connect(cricketsGain).connect(ambLP);

    // Cave — detuned sub-drone; drips are scheduled separately.
    const cf = ctx.createBiquadFilter();
    cf.type = 'lowpass'; cf.frequency.value = 160;
    const cwob = ctx.createGain(); cwob.gain.value = 1;
    lfo(0.09, 0.3, cwob.gain);
    caveGain = ctx.createGain(); caveGain.gain.value = 0;
    for (const f of [52.5, 53.2]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      o.connect(cf); o.start();
    }
    cf.connect(cwob).connect(caveGain).connect(ambLP);

    // Birds — one-shot chirps routed through a crossfaded gain.
    birdsGain = ctx.createGain(); birdsGain.gain.value = 0;
    birdsGain.connect(ambLP);

    // Smolder — deep brown-noise rumble with a slow heave; embers scheduled below.
    const sf = ctx.createBiquadFilter();
    sf.type = 'lowpass'; sf.frequency.value = 90; sf.Q.value = 0.8;
    lfo(0.05, 32, sf.frequency);
    const swob = ctx.createGain(); swob.gain.value = 1;
    lfo(0.04, 0.3, swob.gain);
    smolderGain = ctx.createGain(); smolderGain.gain.value = 0;
    loopNoise(sf, brown); sf.connect(swob).connect(smolderGain).connect(ambLP);

    // Hollow — airy bandpassed wind with a slow shimmer; chimes scheduled below.
    const hf = ctx.createBiquadFilter();
    hf.type = 'bandpass'; hf.frequency.value = 300; hf.Q.value = 1.3;
    lfo(0.06, 95, hf.frequency);
    const hwob = ctx.createGain(); hwob.gain.value = 1;
    lfo(0.11, 0.22, hwob.gain);
    hollowGain = ctx.createGain(); hollowGain.gain.value = 0;
    loopNoise(hf); hf.connect(hwob).connect(hollowGain).connect(ambLP);

    schedule(() => 1500 + Math.random() * 6500, () => { if (birdsOn && !paused) chirp(); });
    schedule(() => 1200 + Math.random() * 5000, () => { if (caveOn && !paused) drip(); });
    schedule(() => 2000 + Math.random() * 4000, () => { if (smolderOn && !paused) ember(); });
    schedule(() => 8000 + Math.random() * 12000, () => { if (hollowOn && !paused) chime(); });
  }

  // setTimeout chain with a fresh random interval each round.
  function schedule(nextMs, fn) {
    const tick = () => { if (ctx) fn(); setTimeout(tick, nextMs()); };
    setTimeout(tick, nextMs());
  }

  function chirp() {
    const syll = 1 + (Math.random() * 3 | 0);
    for (let i = 0; i < syll; i++) {
      const at = i * (0.09 + Math.random() * 0.07) + Math.random() * 0.2;
      const t0 = ctx.currentTime + at;
      const f = 2200 + Math.random() * 1400;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t0);
      o.frequency.exponentialRampToValueAtTime(f * (0.7 + Math.random() * 0.6), t0 + 0.06);
      const m = ctx.createOscillator(); m.type = 'sine'; m.frequency.value = 25 + Math.random() * 40;
      const mg = ctx.createGain(); mg.gain.value = 200 + Math.random() * 400;
      m.connect(mg); mg.connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.045 + Math.random() * 0.045, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12 + Math.random() * 0.1);
      o.connect(g).connect(birdsGain);
      o.start(t0); o.stop(t0 + 0.35); m.start(t0); m.stop(t0 + 0.35);
    }
  }

  function drip() {
    const p = 0.8 + Math.random() * 0.5;
    blip({ type: 'sine', freq: 1050 * p, freqEnd: 340 * p, dur: 0.13, vol: 0.09, dest: caveGain });
    blip({ at: 0.16, type: 'sine', freq: 900 * p, freqEnd: 300 * p, dur: 0.11, vol: 0.035, dest: caveGain });
  }

  // Smolder embers — a handful of tiny filtered-noise ticks.
  function ember() {
    const n = 1 + (Math.random() * 3 | 0);
    for (let i = 0; i < n; i++) {
      burst({ at: i * (0.04 + Math.random() * 0.09), dur: 0.02 + Math.random() * 0.03,
              type: 'bandpass', freq: 1700 + Math.random() * 1800, q: 4,
              vol: 0.09 + Math.random() * 0.09, pitch: 0.7 + Math.random() * 0.8,
              attack: 0.001, dest: smolderGain });
    }
  }

  // Hollow chimes — a lone pentatonic sine with a long release, plus a
  // fainter octave partial for shimmer.
  function chime() {
    const t0 = ctx.currentTime + Math.random() * 0.3;
    const f = 660 * 2 ** ((Math.random() * 2 | 0) + SCALE[Math.random() * SCALE.length | 0] / 12);
    for (const [mul, vol] of [[1, 0.11], [2.01, 0.035]]) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f * mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.5 + Math.random() * 1.5);
      o.connect(g).connect(hollowGain);
      o.start(t0); o.stop(t0 + 5.2);
    }
  }

  function applyScene(secs) {
    const s = scene, ug = s.underground;
    const dim = s.dimension || 'overworld', over = dim === 'overworld';
    // Non-overworld dimensions have their own beds; overworld weather,
    // birds and crickets are suppressed there.
    const storm = over && s.weatherKind === 'storm';
    const raining = storm || (over && s.weatherKind === 'rain');
    let wind = storm ? 0.42 : raining ? 0.28 : s.weatherKind === 'snow' ? 0.26 : 0.17;
    if (ug) wind *= 0.08;
    if (!over) wind = 0;
    ramp(windGain.gain, wind, secs);
    let rn = storm ? 0.45 : raining ? 0.32 : 0;
    if (ug) rn *= 0.15;
    ramp(rainGain.gain, rn, secs);
    birdsOn = s.night < 0.3 && !ug && over;
    ramp(birdsGain.gain, birdsOn ? (raining ? 0.4 : 1) : 0, secs);
    ramp(cricketsGain.gain, s.night > 0.6 && !ug && over ? 0.07 : 0, secs);
    caveOn = ug && over;
    ramp(caveGain.gain, caveOn ? 0.5 : 0, secs);
    smolderOn = dim === 'smolder';
    ramp(smolderGain.gain, smolderOn ? 0.55 : 0, secs);
    hollowOn = dim === 'hollow';
    ramp(hollowGain.gain, hollowOn ? 0.38 : 0, secs);
    ambLP.frequency.setTargetAtTime(s.inWater ? 460 : 16000, ctx.currentTime, 0.25);
  }

  function setScene(s) {
    scene = { ...scene, ...s };
    if (ctx) applyScene(2);
  }

  // ── Thunder ────────────────────────────────────────────────────
  function thunder() {
    if (!ctx) return;
    setTimeout(() => {
      if (!ctx) return;
      const t = ctx.currentTime;
      const dur = 2.5 + Math.random() * 1.5;
      const src = ctx.createBufferSource();
      src.buffer = brown; src.loop = true;
      src.playbackRate.value = 0.3 + Math.random() * 0.25;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(420, t);
      lp.frequency.exponentialRampToValueAtTime(60, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.6, t + 0.06 + Math.random() * 0.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(lp).connect(g).connect(ambLP);   // through ambLP: muffled underwater
      src.start(t); src.stop(t + dur + 0.1);
    }, 500 + Math.random() * 1500);
  }

  // ── Generative music ───────────────────────────────────────────
  // A-minor pentatonic (A C D E G) across two octaves; sparse pads/plucks
  // into a feedback delay. Day: brighter register; night: lower + slower.
  const SCALE = [0, 3, 5, 7, 10];
  let musicOn = false, musicTimer = 0, delaySend = null;

  function buildMusicFx() {
    delaySend = ctx.createGain(); delaySend.gain.value = 0.35;
    const dly = ctx.createDelay(1); dly.delayTime.value = 0.4;
    const fb = ctx.createGain(); fb.gain.value = 0.35;
    delaySend.connect(dly); dly.connect(fb); fb.connect(dly);
    dly.connect(bus.music);
  }

  function musicNote(freq, { attack, hold, release, vol, cutoff }) {
    const t = ctx.currentTime;
    const end = attack + hold + release;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + end);
    lp.connect(g); g.connect(bus.music); g.connect(delaySend);
    for (const det of [-5, 5]) {
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = freq; o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + end + 0.1);
    }
  }

  function playPhrase() {
    if (paused) return;
    const night = scene.night > 0.5;
    const dim = scene.dimension || 'overworld';
    // Smolder sits low and dark; the Hollow floats a register higher.
    let base = night ? 110 : 220;
    let cutoff = night ? 750 : 1400;
    if (dim === 'smolder') { base = 82.4; cutoff = 620; }
    else if (dim === 'hollow') { base = 330; cutoff = 2200; }
    const note = () => base * 2 ** ((Math.random() * 2 | 0) + SCALE[Math.random() * SCALE.length | 0] / 12);
    if (Math.random() < 0.45) {
      // Pad chord: 2-3 slow-attack notes.
      const n = 2 + (Math.random() * 2 | 0);
      for (let i = 0; i < n; i++)
        musicNote(note(), { attack: 0.7 + Math.random() * 0.8, hold: 0.6,
                            release: 3 + Math.random() * 3, vol: 0.07, cutoff });
    } else {
      musicNote(note(), { attack: 0.012, hold: 0.05,
                          release: 3 + Math.random() * 3, vol: 0.13, cutoff });
    }
  }

  function scheduleMusic() {
    if (!musicOn) return;
    const dim = scene.dimension || 'overworld';
    let slow = scene.night > 0.5 ? 1.5 : 1;
    if (dim === 'smolder') slow = Math.max(slow, 1.6);        // lower + slower
    else if (dim === 'hollow') slow = Math.max(slow, 2.1);    // sparser
    musicTimer = setTimeout(() => {
      if (musicOn && ctx) playPhrase();
      scheduleMusic();
    }, (3000 + Math.random() * 4000) * slow);
  }

  function startMusic() {
    if (!ctx || musicOn) return;
    musicOn = true;
    scheduleMusic();
  }

  function stopMusic() {
    musicOn = false;
    clearTimeout(musicTimer);
  }

  // ── Lifecycle ──────────────────────────────────────────────────
  function resume() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    white = makeNoise(1.5, false);
    brown = makeNoise(4, true);

    // Bus graph: sfx/music/ambient -> master -> soft compressor -> out.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 20; comp.ratio.value = 4;
    comp.connect(ctx.destination);
    bus.master = ctx.createGain(); bus.master.connect(comp);
    for (const b of ['sfx', 'music', 'ambient']) {
      bus[b] = ctx.createGain();
      bus[b].connect(bus.master);
    }
    for (const b of ['master', 'sfx', 'music', 'ambient']) applyBusGain(b);

    buildAmbient();
    buildMusicFx();
    applyScene(0.1);
  }

  function setPaused(p) {
    paused = !!p;
    if (!ctx) return;
    for (const b of ['master', 'sfx', 'music', 'ambient']) applyBusGain(b);
  }

  return { resume, play, blockSound, setScene, startMusic, stopMusic, thunder, setPaused };
}
