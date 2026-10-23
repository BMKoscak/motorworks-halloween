// WebAudio engine: buses (master/voice/sfx/music), per-character dialogue FX chains,
// synthesised engine/tire/siren/horn/alarm/impact sounds, ambience and the haunted radio.
import dialogueData from '../data/dialogue.json';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.vol = { master: 0.8, voice: 1.0, sfx: 0.8, music: 0.6 };
    this.lineCache = new Map();
    this.manifest = null;
    this.stats = { linesPlayed: 0, linesFailed: 0, fallbackTTS: 0, lastLine: null, lastDuration: 0 };
    this.sirens = new Map();
  }

  async init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.masterGain = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 4;
    this.masterGain.connect(comp).connect(ctx.destination);
    this.voice = ctx.createGain(); this.voice.connect(this.masterGain);
    this.sfx = ctx.createGain(); this.sfx.connect(this.masterGain);
    this.music = ctx.createGain(); this.music.connect(this.masterGain);
    this.applyVolumes();
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.irLong = this._impulse(3.2, 2.2);
    this.irShort = this._impulse(0.7, 3);
    this.distCurve = this._curve(18);
    this.heavyCurve = this._curve(120);
    try { this.manifest = await (await fetch('audio/dialogue/manifest.json')).json(); } catch (e) { this.manifest = {}; }
    this._ambience();
    this.radio = new Radio(this);
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.voice.gain.setTargetAtTime(this.vol.voice * 1.4, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.music.gain.setTargetAtTime(this.vol.music, t, 0.05);
  }

  _impulse(sec, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return b;
  }

  _curve(k) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
    return c;
  }

  _noiseSrc(loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    s.loopStart = Math.random();
    return s;
  }

  // ------------------------------------------------------------------ dialogue
  async _buffer(id) {
    if (this.lineCache.has(id)) return this.lineCache.get(id);
    const m = this.manifest && this.manifest[id];
    if (!m) throw new Error('no audio for ' + id);
    const p = fetch('audio/dialogue/' + m.file).then((r) => r.arrayBuffer()).then((a) => this.ctx.decodeAudioData(a));
    this.lineCache.set(id, p);
    return p;
  }

  preload(ids) { if (this.ctx) ids.forEach((id) => this._buffer(id).catch(() => {})); }

  _fxChain(fx, out) {
    const ctx = this.ctx;
    const input = ctx.createGain();
    const extra = [];
    if (fx === 'radio') {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 450;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2900;
      const ws = ctx.createWaveShaper(); ws.curve = this.distCurve;
      const g = ctx.createGain(); g.gain.value = 0.55;
      input.connect(hp).connect(lp).connect(ws).connect(g).connect(out);
      const n = this._noiseSrc(); const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 2500;
      const ng = ctx.createGain(); ng.gain.value = 0.035;
      n.connect(nf).connect(ng).connect(out); n.start();
      extra.push(n);
    } else if (fx === 'ghost') {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
      const conv = ctx.createConvolver(); conv.buffer = this.irLong;
      const wet = ctx.createGain(); wet.gain.value = 0.7;
      const dl = ctx.createDelay(); dl.delayTime.value = 0.32;
      const fb = ctx.createGain(); fb.gain.value = 0.35;
      input.connect(lp); lp.connect(out); lp.connect(conv).connect(wet).connect(out);
      lp.connect(dl); dl.connect(fb).connect(dl); dl.connect(out);
    } else if (fx === 'robot') {
      const ring = ctx.createGain(); ring.gain.value = 0;
      const osc = ctx.createOscillator(); osc.frequency.value = 55; osc.connect(ring.gain); osc.start();
      const dry = ctx.createGain(); dry.gain.value = 0.6;
      input.connect(ring).connect(out); input.connect(dry).connect(out);
      extra.push(osc);
    } else if (fx === 'rattle') {
      const trem = ctx.createGain(); trem.gain.value = 0.75;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 11; const depth = ctx.createGain(); depth.gain.value = 0.25;
      lfo.connect(depth).connect(trem.gain); lfo.start();
      const conv = ctx.createConvolver(); conv.buffer = this.irShort; const wet = ctx.createGain(); wet.gain.value = 0.25;
      input.connect(trem).connect(out); trem.connect(conv).connect(wet).connect(out);
      extra.push(lfo);
    } else if (fx === 'room') {
      const conv = ctx.createConvolver(); conv.buffer = this.irShort; const wet = ctx.createGain(); wet.gain.value = 0.22;
      input.connect(out); input.connect(conv).connect(wet).connect(out);
    } else input.connect(out);
    return { input, extra };
  }

  /** Speak a dialogue line. Resolves with { duration } once playback has started. */
  async speakLine(id) {
    const line = dialogueData.lines[id];
    if (!line) return { duration: 0 };
    const voice = dialogueData.voices[line[0]];
    this.stats.lastLine = id;
    if (!this.ctx) return this._tts(line[1], voice);
    try {
      const buf = await this._buffer(id);
      if (this.current) { try { this.current.stop(); } catch (e) { /* already stopped */ } }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      // ElevenLabs takes are already in character; only the local SAPI fallback needs pitch shaping
      const m = this.manifest && this.manifest[id];
      src.playbackRate.value = m && m.engine === 'elevenlabs' ? (voice.elevenPitch || 1) : (voice.pitch || 1);
      const { input, extra } = this._fxChain(voice.fx, this.voice);
      src.connect(input);
      src.start();
      this.current = src;
      if (this.radio) this.radio.duck(buf.duration / src.playbackRate.value + 0.5);
      src.onended = () => extra.forEach((e) => { try { e.stop(); } catch (er) { /* noop */ } });
      if (voice.fx === 'radio') this.blip(1400, 0.06);
      this.stats.linesPlayed++;
      this.stats.lastDuration = buf.duration / src.playbackRate.value;
      return { duration: this.stats.lastDuration, source: 'file' };
    } catch (e) {
      this.stats.linesFailed++;
      return this._tts(line[1], voice);
    }
  }

  _tts(text, voice) {
    // Fallback: browser speech synthesis with the character's pitch/rate.
    this.stats.fallbackTTS++;
    if (!window.speechSynthesis) return { duration: text.length * 0.06 };
    const u = new SpeechSynthesisUtterance(text);
    u.pitch = Math.max(0.1, Math.min(2, voice.pitch || 1));
    u.rate = 1 + (voice.rate || 0) * 0.08;
    u.volume = this.vol.voice * this.vol.master;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    return { duration: text.length * 0.065, source: 'tts' };
  }

  stopVoice() { if (this.current) { try { this.current.stop(); } catch (e) { /* noop */ } this.current = null; } }

  // ------------------------------------------------------------------ one-shots
  _env(node, t, a, peak, d, end = 0.0001) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(end, t + a + d);
  }

  tone(freq, dur, type = 'sine', vol = 0.3, when = 0, dest = this.sfx, slideTo = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain(); this._env(g, t, 0.005, vol, dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }

  noiseBurst(dur, freq, q = 1, vol = 0.4, type = 'bandpass', when = 0, dest = this.sfx) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const s = this._noiseSrc(false);
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); this._env(g, t, 0.004, vol, dur);
    s.connect(f).connect(g).connect(dest); s.start(t); s.stop(t + dur + 0.1);
  }

  blip(f = 1200, d = 0.05) { this.tone(f, d, 'square', 0.08); }
  crash(intensity = 1) {
    const v = Math.min(1, intensity / 12);
    this.noiseBurst(0.35 + v * 0.4, 600, 0.7, 0.5 * v + 0.15, 'lowpass');
    this.tone(70, 0.3, 'sine', 0.5 * v + 0.1, 0, this.sfx, 35);
    this.noiseBurst(0.25, 3500, 2, 0.15 * v, 'bandpass', 0.05);
  }
  stamp() { this.tone(55, 0.5, 'sine', 0.9, 0, this.sfx, 28); this.noiseBurst(0.4, 300, 0.8, 0.6, 'lowpass'); this.noiseBurst(0.15, 4000, 3, 0.2); }
  weld() { this.noiseBurst(0.12 + Math.random() * 0.1, 5000 + Math.random() * 2000, 4, 0.12, 'highpass'); }
  spray(dur = 0.4) { this.noiseBurst(dur, 6000, 0.6, 0.06, 'highpass'); }
  clunk() { this.tone(110, 0.12, 'square', 0.15, 0, this.sfx, 60); this.noiseBurst(0.08, 1200, 2, 0.15); }
  hydraulic() { this.noiseBurst(0.8, 900, 1.5, 0.08, 'bandpass'); this.tone(180, 0.8, 'sawtooth', 0.03, 0, this.sfx, 120); }
  chime() { [72, 76, 79, 84].forEach((m, i) => this.tone(mtof(m), 0.35, 'triangle', 0.22, i * 0.08)); }
  ding() { this.tone(1318, 0.4, 'sine', 0.25); this.tone(1760, 0.5, 'sine', 0.15, 0.06); }
  sting(bad = true) { (bad ? [64, 63, 62, 58] : [60, 64, 67, 72]).forEach((m, i) => this.tone(mtof(m), 0.3, 'sawtooth', 0.12, i * 0.12)); }
  doorOpen() { this.tone(240, 0.08, 'square', 0.08, 0, this.sfx, 180); this.noiseBurst(0.12, 1800, 3, 0.08); }
  doorShut() { this.tone(90, 0.15, 'sine', 0.4, 0, this.sfx, 50); this.noiseBurst(0.1, 800, 1, 0.25, 'lowpass'); }
  rattle(dur = 2.5) {
    if (!this.ctx) return;
    for (let i = 0; i < dur * 14; i++) this.noiseBurst(0.04, 900 + Math.random() * 600, 4, 0.06, 'bandpass', i / 14);
  }
  footstep() { this.noiseBurst(0.05, 500, 1, 0.05, 'lowpass'); }
  owl() { this.tone(420, 0.35, 'sine', 0.06, 0, this.sfx, 380); this.tone(400, 0.6, 'sine', 0.06, 0.5, this.sfx, 360); }
  crow() { for (let i = 0; i < 3; i++) this.noiseBurst(0.18, 1100, 6, 0.06, 'bandpass', i * 0.32); }
  hotwire() { for (let i = 0; i < 6; i++) this.noiseBurst(0.05, 3000, 5, 0.12, 'bandpass', i * 0.15 + Math.random() * 0.08); }

  horn(on) {
    if (!this.ctx) return;
    if (on && !this.hornNodes) {
      const g = this.ctx.createGain(); g.gain.value = 0.12;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
      const os = [392, 494].map((f) => { const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(lp); o.start(); return o; });
      lp.connect(g).connect(this.sfx);
      this.hornNodes = { os, g };
    } else if (!on && this.hornNodes) {
      this.hornNodes.os.forEach((o) => o.stop());
      this.hornNodes = null;
    }
  }

  alarm(seconds = 6) {
    if (!this.ctx) return;
    for (let i = 0; i < seconds * 4; i++) this.tone(i % 2 ? 900 : 1250, 0.2, 'square', 0.07, i * 0.25);
  }

  // ------------------------------------------------------------------ continuous: engine, tires, sirens
  engine() {
    const ctx = this.ctx;
    const out = ctx.createGain(); out.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 2;
    const ws = ctx.createWaveShaper(); ws.curve = this.distCurve;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const g2 = ctx.createGain(); g2.gain.value = 0.5;
    o1.connect(ws); o2.connect(g2).connect(ws); ws.connect(lp).connect(out).connect(this.sfx);
    const whine = ctx.createOscillator(); whine.type = 'sine';
    const wg = ctx.createGain(); wg.gain.value = 0;
    whine.connect(wg).connect(this.sfx);
    const tire = this._noiseSrc(); const tf = ctx.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = 950; tf.Q.value = 5;
    const tg = ctx.createGain(); tg.gain.value = 0;
    tire.connect(tf).connect(tg).connect(this.sfx);
    [o1, o2, whine, tire].forEach((n) => n.start());
    return {
      update: (rpm, throttle, cyl, opts = {}) => {
        const t = ctx.currentTime;
        const f = (rpm / 60) * (cyl / 2) * 0.5;
        o1.frequency.setTargetAtTime(f, t, 0.03);
        o2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
        lp.frequency.setTargetAtTime(300 + throttle * 1800 + rpm * 0.12, t, 0.05);
        out.gain.setTargetAtTime(0.09 + throttle * 0.13, t, 0.05);
        whine.frequency.setTargetAtTime(rpm * (opts.turbo ? 0.9 : 0.55), t, 0.05);
        wg.gain.setTargetAtTime(opts.blower || opts.turbo ? 0.015 + throttle * 0.03 : 0, t, 0.1);
        tg.gain.setTargetAtTime(opts.slip ? 0.16 : 0, t, 0.05);
      },
      stop: () => { [o1, o2, whine, tire].forEach((n) => n.stop()); out.disconnect(); },
    };
  }

  siren(id, pos, listener, on) {
    if (!this.ctx) return;
    let s = this.sirens.get(id);
    if (on && !s) {
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 900;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.35;
      const lg = ctx.createGain(); lg.gain.value = 380;
      lfo.connect(lg).connect(o.frequency);
      const g = ctx.createGain(); g.gain.value = 0;
      const pan = ctx.createStereoPanner();
      o.connect(g).connect(pan).connect(this.sfx);
      o.start(); lfo.start();
      s = { o, lfo, g, pan };
      this.sirens.set(id, s);
    }
    if (!s) return;
    if (!on) { s.o.stop(); s.lfo.stop(); this.sirens.delete(id); return; }
    const dx = pos.x - listener.pos.x, dz = pos.z - listener.pos.z;
    const d = Math.hypot(dx, dz);
    const right = listener.right;
    s.g.gain.setTargetAtTime(Math.min(0.12, 2.2 / (d + 6)), this.ctx.currentTime, 0.1);
    s.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, (dx * right.x + dz * right.z) / (d + 1))), this.ctx.currentTime, 0.1);
  }

  _ambience() {
    const ctx = this.ctx;
    const wind = this._noiseSrc(); const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 380;
    const wg = ctx.createGain(); wg.gain.value = 0.05;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08; const lg = ctx.createGain(); lg.gain.value = 0.03;
    lfo.connect(lg).connect(wg.gain);
    wind.connect(wf).connect(wg).connect(this.sfx); wind.start(); lfo.start();
    this.ambient = { wg, wf };
    this.humGain = ctx.createGain(); this.humGain.gain.value = 0;
    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 60;
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 180;
    hum.connect(hf).connect(this.humGain).connect(this.sfx); hum.start();
  }

  updateAmbience(zone, dt) {
    if (!this.ctx || !this.ambient) return;
    const t = this.ctx.currentTime;
    this.humGain.gain.setTargetAtTime(zone === 'factory' ? 0.05 : 0, t, 0.5);
    this.ambient.wg.gain.setTargetAtTime(zone === 'cemetery' ? 0.09 : zone === 'factory' ? 0.015 : 0.05, t, 1);
    this._amb = (this._amb || 0) - dt;
    if (this._amb < 0) {
      this._amb = 7 + Math.random() * 10;
      if (zone === 'cemetery') Math.random() < 0.5 ? this.crow() : this.owl();
      else if (zone === 'town' && Math.random() < 0.4) this.owl();
    }
  }
}

// ======================================================================== RADIO
const STATIONS = [
  { name: 'WHOO 66.6 FM · Synthwave from Beyond', bpm: 104, style: 'synth' },
  { name: 'KRYP 13.13 · Graveyard Rock', bpm: 138, style: 'rock' },
];

class Radio {
  constructor(audio) {
    this.a = audio;
    this.station = -1;
    this.step = 0;
    this.timer = null;
    this.djTimer = 0;
    const ctx = audio.ctx;
    this.out = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
    this.out.connect(lp).connect(audio.music);
    this.duckGain = this.out;
  }

  get name() { return this.station < 0 ? 'Radio Off' : STATIONS[this.station].name; }
  get on() { return this.station >= 0; }

  cycle() {
    this.station = this.station + 1 >= STATIONS.length ? -1 : this.station + 1;
    this.a.noiseBurst(0.25, 2500, 0.5, 0.12, 'bandpass');
    if (this.station >= 0) this.start(); else this.stop();
    return this.name;
  }

  start() {
    const ctx = this.a.ctx;
    this.stop();
    this.next = ctx.currentTime + 0.1;
    this.step = 0;
    this.djTimer = 6 + Math.random() * 4;
    this.timer = setInterval(() => this._tick(), 25);
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  off() { this.station = -1; this.stop(); }

  duck(sec) {
    if (!this.a.ctx) return;
    const t = this.a.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0.25, t, 0.08);
    this.out.gain.setTargetAtTime(1, t + sec, 0.4);
  }

  _tick() {
    const ctx = this.a.ctx, st = STATIONS[this.station];
    if (!st) return;
    const stepDur = 60 / st.bpm / 4;
    while (this.next < ctx.currentTime + 0.15) {
      if (st.style === 'synth') this._synth(this.step, this.next, stepDur);
      else this._rock(this.step, this.next, stepDur);
      this.next += stepDur;
      this.step++;
    }
    this.djTimer -= 0.025;
    if (this.djTimer <= 0) {
      this.djTimer = 45 + Math.random() * 30;
      const lines = ['dj_intro', 'dj_2', 'dj_3', 'dj_4'];
      this.a.speakLine(lines[Math.floor(Math.random() * lines.length)]);
    }
  }

  _note(freq, t, dur, type, vol, opts = {}) {
    const ctx = this.a.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (opts.detune) o.detune.value = opts.detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (opts.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (opts.cutoff) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.cutoff; f.Q.value = opts.q || 1; node.connect(f); node = f; }
    if (opts.dist) { const w = ctx.createWaveShaper(); w.curve = this.a.heavyCurve; node.connect(w); node = w; }
    node.connect(g).connect(this.out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  _drum(kind, t, vol = 1) {
    const a = this.a, ctx = a.ctx;
    if (kind === 'kick') {
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.6 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.32);
    } else {
      const s = a._noiseSrc(false);
      const f = ctx.createBiquadFilter(); f.type = kind === 'hat' ? 'highpass' : kind === 'crash' ? 'highpass' : 'bandpass';
      f.frequency.value = kind === 'hat' ? 7500 : kind === 'crash' ? 5000 : 1800;
      const g = ctx.createGain(); const dur = kind === 'hat' ? 0.04 : kind === 'crash' ? 1.2 : 0.18;
      g.gain.setValueAtTime((kind === 'hat' ? 0.08 : kind === 'crash' ? 0.12 : 0.3) * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f).connect(g).connect(this.out); s.start(t); s.stop(t + dur + 0.05);
      if (kind === 'snare') this._note(190, t, 0.1, 'triangle', 0.15 * vol);
    }
  }

  _synth(step, t, sd) {
    const bar = Math.floor(step / 16) % 4, s = step % 16;
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
    const roots = [33, 29, 36, 31];
    const ch = chords[bar];
    if (s === 0) ch.forEach((m, i) => this._note(mtof(m), t, sd * 16, 'sawtooth', 0.035, { attack: 0.25, cutoff: 1400, detune: i * 6 - 6 }));
    if (s % 2 === 0) this._note(mtof(roots[bar] + (s % 4 === 2 ? 12 : 0)), t, sd * 1.8, 'sawtooth', 0.09, { cutoff: 600, q: 4 });
    if (Math.floor(step / 64) % 2 === 1) this._note(mtof(ch[s % 3] + 24), t, sd * 0.9, 'square', 0.025, { cutoff: 3000 });
    if (s % 4 === 0) this._drum('kick', t);
    if (s === 4 || s === 12) this._drum('snare', t);
    if (s % 2 === 1) this._drum('hat', t);
    const mel = [69, 0, 72, 0, 76, 0, 74, 72, 0, 0, 71, 0, 69, 0, 67, 0];
    if (Math.floor(step / 32) % 4 === 3 && mel[s]) this._note(mtof(mel[s] + 12), t, sd * 1.9, 'triangle', 0.05, { attack: 0.02 });
  }

  _rock(step, t, sd) {
    const bar = Math.floor(step / 16) % 4, s = step % 16;
    const roots = [40, 43, 45, 48];
    const r = roots[bar];
    const riff = [1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1];
    if (riff[s]) [r, r + 7, r + 12].forEach((m) => this._note(mtof(m), t, sd * (s % 4 === 0 ? 1.6 : 0.8), 'sawtooth', 0.04, { cutoff: 2600, dist: true }));
    if (s % 8 === 0 || s === 6 || s === 10) this._drum('kick', t);
    if (s === 4 || s === 12) this._drum('snare', t);
    if (s % 2 === 0) this._drum('hat', t);
    if (s === 0 && bar === 0) this._drum('crash', t);
    const organ = [76, 74, 76, 0, 74, 72, 71, 72, 0, 69, 0, 0, 0, 0, 0, 0];
    if (Math.floor(step / 64) % 2 === 1 && organ[s]) this._note(mtof(organ[s]), t, sd * 1.8, 'square', 0.03, { cutoff: 2400, detune: 8 });
  }
}
