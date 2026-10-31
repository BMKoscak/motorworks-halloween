import * as THREE from 'three';
import { makePerson, randomAdult, randomKid } from '../data/demographics.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const LZ = 4.0;                 // lobby / auditorium partition (cinema-local z)
const W = 640, H = 288;

// "NIGHT OF THE V8": line cues (film time -> dialogue id; the HUD subtitle shows them while you watch) and scene cuts
const V8 = {
  id: 'v8', title: 'NIGHT OF THE V8', length: 102,
  cues: [[13, 'movie_narr_1'], [22, 'movie_hero_1'], [38, 'movie_villain_1'], [51, 'movie_hero_2'], [75, 'movie_narr_2'], [94, 'movie_villain_2']],
  scenes: [[0, 'leader'], [6, 'studio'], [12, 'titlecard'], [18, 'road'], [34, 'chase'], [48, 'factory'], [62, 'jump'], [74, 'trailer'], [84, 'credits'], [92, 'stinger']],
  credits: [84, 92], stinger: 96,
};
export const FILM = V8;

/**
 * A film reel drawn procedurally into a canvas, with grain, scratches and gate flicker. The base class is
 * "NIGHT OF THE V8" - a 100-second B-movie (countdown leader, studio logo, title, Hollow Hill Road drive, ghost-car
 * chase, the haunted factory, the cemetery-gate jump, trailer card, credits and a post-credits stinger); other reels
 * (PumpkinFilm) subclass it with their own spec and scene methods and reuse the drawing helpers. Each reel owns a
 * CanvasTexture; the cinema maps it onto whichever screens are showing it and only redraws (15 fps) while one of
 * those screens is near the camera.
 */
export class Film {
  constructor(spec = V8) {
    this.spec = spec;
    this.id = spec.id;
    this.title = spec.title;
    this.length = spec.length;
    this.cues = spec.cues;
    this.scenes = spec.scenes;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.frames = 0;
    this.intermission = 0;
    this.scratches = [];
    this.draw(0);
  }

  scene(t) { let s = this.scenes[0][1]; for (const [at, name] of this.scenes) if (t >= at) s = name; return s; }

  draw(t) {
    const g = this.g;
    this.frames++;
    g.save();
    if (this.intermission > 0) this._intermission(g, t);
    else {
      const s = this.scene(t);
      const st = this.scenes.find((x) => x[1] === s)[0];
      this['_' + s](g, t - st, t);
    }
    g.restore();
    this._filmLook(g, t);
    this.tex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- shared drawing helpers
  _sky(g, top, bottom) { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, top); gr.addColorStop(1, bottom); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
  _moon(g, x, y, r, c = '#f4ecd0') { g.fillStyle = c; g.shadowColor = c; g.shadowBlur = 30; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.shadowBlur = 0; g.fillStyle = 'rgba(0,0,0,0.12)'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.2, r * 0.22, 0, 7); g.arc(x + r * 0.35, y + r * 0.25, r * 0.15, 0, 7); g.fill(); }
  _hills(g, off, y, amp, col, freq) { g.fillStyle = col; g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += 8) g.lineTo(x, y - amp * (Math.sin((x + off) * freq) * 0.6 + Math.sin((x + off) * freq * 2.3) * 0.4)); g.lineTo(W, H); g.fill(); }
  _tree(g, x, base, h, col) { g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.moveTo(x, base); g.lineTo(x, base - h); for (let k = 0; k < 4; k++) { const yy = base - h * (0.45 + k * 0.15); g.moveTo(x, yy); g.lineTo(x + (k % 2 ? 1 : -1) * h * 0.3, yy - h * 0.18); } g.stroke(); }
  _car(g, x, y, s, body, beam = true, ghost = false) {
    g.save(); g.translate(x, y); g.scale(s, s);
    if (beam) { const gr = g.createLinearGradient(40, -10, 220, 0); gr.addColorStop(0, ghost ? 'rgba(120,255,140,0.55)' : 'rgba(255,240,170,0.55)'); gr.addColorStop(1, 'rgba(255,240,170,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(42, -14); g.lineTo(230, -42); g.lineTo(230, 18); g.closePath(); g.fill(); }
    g.fillStyle = body; if (ghost) { g.shadowColor = '#5f5'; g.shadowBlur = 18; }
    g.beginPath(); g.moveTo(-46, 0); g.lineTo(-44, -14); g.lineTo(-22, -16); g.lineTo(-10, -30); g.lineTo(16, -30); g.lineTo(28, -16); g.lineTo(44, -13); g.lineTo(46, 0); g.closePath(); g.fill();
    g.shadowBlur = 0; g.fillStyle = '#111';
    for (const wx of [-28, 28]) { g.beginPath(); g.arc(wx, 0, 9, 0, 7); g.fill(); }
    g.fillStyle = ghost ? '#bfffb0' : '#fff6c0'; g.fillRect(40, -12, 6, 4);
    g.restore();
  }
  _bat(g, x, y, s, t) { const f = Math.sin(t * 18) * 0.6; g.fillStyle = '#0b0610'; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x - 8 * s, y - 6 * s * f, x - 14 * s, y + 2 * s); g.quadraticCurveTo(x - 7 * s, y, x, y + 3 * s); g.quadraticCurveTo(x + 7 * s, y, x + 14 * s, y + 2 * s); g.quadraticCurveTo(x + 8 * s, y - 6 * s * f, x, y); g.fill(); }
  _bigTitle(g, text, y, size, col = '#d0101a') {
    g.font = `900 ${size}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#000'; g.fillText(text, W / 2 + 3, y + 3);
    g.fillStyle = col; g.fillText(text, W / 2, y);
    const w = g.measureText(text).width;
    for (let i = 0; i < 9; i++) { const dx = W / 2 - w / 2 + ((i * 97) % w); const len = 6 + ((i * 53) % 22); g.fillRect(dx, y + size * 0.32, 3, len); g.beginPath(); g.arc(dx + 1.5, y + size * 0.32 + len, 3, 0, 7); g.fill(); }
  }
  _caption(g, text, y, size = 18, col = '#f2e6c8') { g.font = `700 ${size}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = col; g.fillText(text, W / 2, y); }

  // ---------------------------------------------------------------- scenes
  _leader(g, u) {
    g.fillStyle = '#c8c0b0'; g.fillRect(0, 0, W, H);
    const n = 5 - Math.floor(u);
    const a = (u % 1) * Math.PI * 2;
    g.fillStyle = '#8a8478'; g.beginPath(); g.moveTo(W / 2, H / 2); g.arc(W / 2, H / 2, 200, -Math.PI / 2, -Math.PI / 2 + a); g.fill();
    g.strokeStyle = '#222'; g.lineWidth = 3; g.beginPath(); g.arc(W / 2, H / 2, 110, 0, 7); g.stroke(); g.beginPath(); g.arc(W / 2, H / 2, 95, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
    g.fillStyle = '#111'; g.font = '900 120px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (n > 0) g.fillText(String(n), W / 2, H / 2 + 6);
  }
  _studio(g, u) {
    g.fillStyle = '#05040a'; g.fillRect(0, 0, W, H);
    const k = Math.min(1, u / 1.5) * Math.min(1, (6 - u) / 1);
    g.globalAlpha = Math.max(0, k);
    g.save(); g.translate(W / 2, H / 2 - 30); g.rotate(u * 0.8); g.fillStyle = '#ff7a1a';
    for (let i = 0; i < 10; i++) { g.rotate(Math.PI / 5); g.fillRect(-7, -52, 14, 18); }
    g.beginPath(); g.arc(0, 0, 40, 0, 7); g.fill(); g.fillStyle = '#05040a'; g.beginPath(); g.arc(0, 0, 18, 0, 7); g.fill(); g.restore();
    this._caption(g, 'MOTORWORKS PICTURES', H / 2 + 50, 30, '#ffb066');
    this._caption(g, 'presents', H / 2 + 82, 16, '#c8b8a0');
    g.globalAlpha = 1;
  }
  _titlecard(g, u, t) {
    this._sky(g, '#120418', '#3a0f1a');
    this._moon(g, W / 2, 110 - u * 4, 70);
    for (let i = 0; i < 6; i++) this._bat(g, (u * 60 + i * 110) % (W + 40) - 20, 50 + Math.sin(u * 2 + i) * 20 + i * 8, 1.2, t + i);
    this._hills(g, 0, H - 30, 20, '#08030a', 0.01);
    g.globalAlpha = Math.min(1, u / 1.2);
    this._bigTitle(g, 'NIGHT OF THE V8', H / 2 + 10, 64);
    g.globalAlpha = 1;
  }
  _road(g, u, t) {
    this._sky(g, '#0d0620', '#2b1630');
    this._moon(g, 520, 70, 36);
    this._hills(g, u * 25, 190, 40, '#1a0e22', 0.008);
    this._hills(g, u * 70, 225, 25, '#0e0714', 0.014);
    for (let i = 0; i < 8; i++) this._tree(g, ((i * 120 - u * 140) % (W + 120) + W + 120) % (W + 120) - 60, 245, 60 + (i % 3) * 18, '#06030a');
    g.fillStyle = '#141018'; g.fillRect(0, 245, W, H - 245);
    g.fillStyle = '#c9a23a'; for (let i = 0; i < 12; i++) g.fillRect(((i * 70 - u * 260) % (W + 70) + W + 70) % (W + 70) - 35, 262, 34, 4);
    this._car(g, 230 + Math.sin(u * 1.3) * 12, 252, 1.3, '#e8661a');
    if (u < 4) this._caption(g, 'HOLLOW HILL ROAD  ·  OCTOBER 31st', 30, 16);
  }
  _chase(g, u, t) {
    const flash = (Math.sin(t * 2.7) > 0.97 || (u > 6 && u < 6.2)) ? 1 : 0;
    this._sky(g, flash ? '#8f86b0' : '#0a0618', flash ? '#5b4a70' : '#22102a');
    this._hills(g, u * 80, 200, 35, '#0b0612', 0.01);
    for (let i = 0; i < 8; i++) this._tree(g, ((i * 100 - u * 180) % (W + 100) + W + 100) % (W + 100) - 50, 245, 70, '#05020a');
    g.fillStyle = '#100c14'; g.fillRect(0, 245, W, H - 245);
    g.fillStyle = '#c9a23a'; for (let i = 0; i < 12; i++) g.fillRect(((i * 70 - u * 320) % (W + 70) + W + 70) % (W + 70) - 35, 262, 34, 4);
    const gap = 150 - Math.min(110, u * 9) + Math.sin(u * 3) * 10;
    this._car(g, 380 + Math.sin(u * 2) * 10, 252, 1.25, '#e8661a');
    g.globalAlpha = 0.75 + Math.sin(t * 9) * 0.15;
    this._car(g, 380 - gap - 60, 250, 1.35, '#2a8a38', true, true);
    g.globalAlpha = 1;
    g.fillStyle = '#ff2020'; g.beginPath(); g.arc(380 - gap - 60 + 44 * 1.35, 236, 3, 0, 7); g.fill();
  }
  _factory(g, u, t) {
    this._sky(g, '#140a1c', '#3a1a10');
    g.fillStyle = '#0a070c'; g.fillRect(120, 120, 400, 140);
    for (const cx of [170, 220]) { g.fillRect(cx, 60, 22, 70); for (let k = 0; k < 4; k++) { g.fillStyle = `rgba(90,80,100,${0.35 - k * 0.07})`; g.beginPath(); g.arc(cx + 11 + Math.sin(t + k) * 8 + k * 10, 50 - k * 18 - (u * 6) % 18, 14 + k * 5, 0, 7); g.fill(); } g.fillStyle = '#0a070c'; }
    g.fillStyle = '#ff7a1a'; g.font = '900 34px Georgia, serif'; g.textAlign = 'center'; g.fillText('MOTORWORKS', 320, 112);
    for (let i = 0; i < 6; i++) { g.fillStyle = Math.sin(t * 3 + i) > 0 ? '#ffcc66' : '#5a3a20'; g.fillRect(150 + i * 60, 160, 30, 20); }
    // robot arm silhouette welding the hero car
    const a1 = -0.9 + Math.sin(t * 2) * 0.4, a2 = 1.2 + Math.sin(t * 2.6) * 0.5;
    g.strokeStyle = '#ff7a1a'; g.lineWidth = 8; g.lineCap = 'round';
    const bx = 260, by = 255, x1 = bx + Math.cos(a1) * 60, y1 = by + Math.sin(a1) * 60, x2 = x1 + Math.cos(a1 + a2) * 50, y2 = y1 + Math.sin(a1 + a2) * 50;
    g.beginPath(); g.moveTo(bx, by); g.lineTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    for (let k = 0; k < 6; k++) { g.fillStyle = '#ffe090'; g.fillRect(x2 + rnd(-10, 10), y2 + rnd(-10, 10), 2, 2); }
    this._car(g, 380, 255, 1.2, '#e8661a', false);
    g.fillStyle = '#0d0a0f'; g.fillRect(0, 262, W, H - 262);
  }
  _jump(g, u, t) {
    this._sky(g, '#0a0516', '#1e0d24');
    this._moon(g, W / 2, 120, 95);
    g.fillStyle = '#07040a'; g.fillRect(0, 240, W, H - 240);
    // cemetery gate
    g.fillRect(250, 150, 12, 95); g.fillRect(380, 150, 12, 95);
    for (let i = 0; i < 9; i++) { g.fillRect(266 + i * 13, 165 + Math.abs(4 - i) * 4, 4, 80 - Math.abs(4 - i) * 4); }
    g.beginPath(); g.moveTo(250, 150); g.quadraticCurveTo(321, 110, 392, 150); g.lineWidth = 6; g.strokeStyle = '#07040a'; g.stroke();
    for (const [tx, h] of [[90, 30], [130, 40], [500, 34], [560, 26]]) { g.fillRect(tx, 240 - h, 22, h); g.beginPath(); g.arc(tx + 11, 240 - h, 11, Math.PI, 0); g.fill(); }
    const k = Math.min(1, u / 9);
    const x = -80 + k * 820, y = 230 - Math.sin(k * Math.PI) * 170;
    g.save(); g.translate(x, y); g.rotate(-0.25 + k * 0.5); this._car(g, 0, 0, 1.4, '#e8661a', false); g.restore();
    for (let i = 0; i < 10; i++) this._bat(g, (i * 67 + u * 40) % W, 40 + (i * 23) % 60, 0.9, t + i * 0.3);
  }
  _trailer(g, u, t) {
    g.fillStyle = '#050307'; g.fillRect(0, 0, W, H);
    this._moon(g, W / 2, H / 2, 120, '#3a1010');
    this._bigTitle(g, 'NIGHT OF THE V8', 100, 58, '#ff2a1a');
    if (u > 2) this._caption(g, 'THIS HALLOWEEN... THE RACE IS ON', 165, 20, '#ffd9a0');
    if (u > 4.5) this._caption(g, 'RATED R  —  FOR REVVING', 205, 18, '#ffb066');
    if (u > 6.5) this._caption(g, 'NOW SHOWING AT THE PALACE & THE STARLIGHT DRIVE-IN', 245, 14, '#c8b8a0');
  }
  _credits(g, u) {
    g.fillStyle = '#040306'; g.fillRect(0, 0, W, H);
    const lines = ['THE END ?', '', 'ROXY STEEL ........ herself', 'COUNT CARBURETOR ........ himself', 'DIRECTED BY ........ BIG SAL', 'WELDING ........ BONES McGEE',
      'PAINT ........ THE PUMPKIN-MASK TECH', 'CATERING ........ THE MOONLITE DINER', 'NO ROBOTS WERE HARMED', 'ALL CARS BUILT AT MOTORWORKS', '', 'STAY FOR THE STINGER...'];
    lines.forEach((l, i) => { const y = H + 20 + i * 30 - u * 62; if (y > -20 && y < H + 20) this._caption(g, l, y, i === 0 ? 40 : 16, i === 0 ? '#ff2a1a' : '#e6dcc8'); });
  }
  _stinger(g, u, t) {
    g.fillStyle = '#060208'; g.fillRect(0, 0, W, H);
    const k = Math.min(1, u / 1.5);
    const cx = W / 2, cy = H + 120 - k * 220;
    g.fillStyle = '#d9d2e0'; g.beginPath(); g.ellipse(cx, cy, 90, 120, 0, 0, 7); g.fill();
    g.fillStyle = '#0a0410'; g.beginPath(); g.moveTo(cx - 95, cy - 40); g.lineTo(cx - 70, cy - 125); g.lineTo(cx, cy - 70); g.lineTo(cx + 70, cy - 125); g.lineTo(cx + 95, cy - 40); g.lineTo(cx + 92, cy - 90); g.lineTo(cx, cy - 135); g.lineTo(cx - 92, cy - 90); g.fill();
    const blink = Math.sin(t * 3) > 0.95 ? 0.2 : 1;
    for (const ex of [-34, 34]) { g.fillStyle = '#fff6b0'; g.shadowColor = '#ffd23f'; g.shadowBlur = 25; g.beginPath(); g.ellipse(cx + ex, cy - 10, 18, 11 * blink, 0, 0, 7); g.fill(); }
    g.shadowBlur = 0; g.fillStyle = '#5a0a14'; g.beginPath(); g.ellipse(cx, cy + 55, 40, 14 + Math.max(0, Math.sin(t * 9)) * 8, 0, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(cx - 20, cy + 48); g.lineTo(cx - 14, cy + 70); g.lineTo(cx - 8, cy + 48); g.moveTo(cx + 8, cy + 48); g.lineTo(cx + 14, cy + 70); g.lineTo(cx + 20, cy + 48); g.fill();
    if (u > 6) this._caption(g, 'COUNT CARBURETOR WILL RETURN', 30, 16, '#ff2a1a');
  }
  _intermission(g, t) {
    g.fillStyle = '#1a0d2e'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 30; i++) { g.fillStyle = `hsl(${(i * 37 + t * 60) % 360},80%,60%)`; g.fillRect((i * 53 + t * 30) % W, (i * 29) % H, 4, 4); }
    const b = Math.abs(Math.sin(t * 5)) * 18;
    const cx = W / 2, cy = 160 - b;
    g.fillStyle = '#e8b060'; g.beginPath(); g.ellipse(cx, cy, 90, 34, 0, 0, 7); g.fill();
    g.fillStyle = '#b8322a'; g.beginPath(); g.ellipse(cx, cy - 14, 100, 18, 0, 0, 7); g.fill();
    g.fillStyle = '#ffd23f'; for (let i = 0; i < 5; i++) g.fillRect(cx - 80 + i * 36, cy - 22 + Math.sin(i + t * 8) * 3, 22, 5);
    g.strokeStyle = '#fff'; g.lineWidth = 5; g.beginPath(); g.arc(cx - 30, cy - 8, 6, 0, 7); g.arc(cx + 30, cy - 8, 6, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(cx - 40, cy + 30); g.lineTo(cx - 50 + Math.sin(t * 10) * 12, cy + 75 + b); g.moveTo(cx + 40, cy + 30); g.lineTo(cx + 50 - Math.sin(t * 10) * 12, cy + 75 + b); g.stroke();
    this._caption(g, 'INTERMISSION', 40, 34, '#ffd23f');
    this._caption(g, 'visit the concession stand!', 255, 18, '#ffffff');
  }

  /** gate weave, flicker, dust, scratches, vignette */
  _filmLook(g, t) {
    g.save();
    g.globalAlpha = 0.06 + Math.random() * 0.06;
    g.fillStyle = Math.random() < 0.5 ? '#000' : '#fff';
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
    for (let i = 0; i < 40; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.4)'; g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 1 + Math.random() * 2); }
    if (Math.random() < 0.15) this.scratches.push({ x: Math.random() * W, life: 0.2 + Math.random() * 0.6 });
    this.scratches = this.scratches.filter((s) => (s.life -= 1 / 15) > 0);
    g.strokeStyle = 'rgba(240,235,220,0.5)'; g.lineWidth = 1;
    for (const s of this.scratches) { g.beginPath(); g.moveTo(s.x, 0); g.lineTo(s.x + Math.sin(t * 7) * 3, H); g.stroke(); }
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.65)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    g.restore();
  }
}

// "ATTACK OF THE 50 FT PUMPKIN" (Phase 4, Screen 2): a seed in Old Man Hollis's patch, fed moonlight and motor oil,
// grows past the barn, rolls down Main Street and is finally carved by Sheriff Mabel Gourd's hot rod.
const PUMPKIN = {
  id: 'pumpkin', title: 'ATTACK OF THE 50 FT PUMPKIN', length: 98,
  cues: [[14, 'p_narr_1'], [24, 'p_farmer_1'], [37, 'p_pumpkin_1'], [50, 'p_sheriff_1'], [64, 'p_sheriff_2'], [75, 'p_narr_2'], [92, 'p_pumpkin_2']],
  scenes: [[0, 'leader'], [6, 'studio'], [12, 'ptitle'], [18, 'patch'], [32, 'growth'], [46, 'rampage'], [60, 'showdown'], [72, 'splat'], [80, 'pcredits'], [89, 'sprout']],
  credits: [80, 89], stinger: 93,
};

export class PumpkinFilm extends Film {
  constructor() { super(PUMPKIN); }

  /** A ribbed jack-o'-lantern: scale s, glowing face when lit, mouth open 0..1. */
  _pumpkin(g, x, y, s, lit = true, mouth = 0, t = 0) {
    g.save(); g.translate(x, y); g.scale(s, s);
    for (let k = -2; k <= 2; k++) { g.fillStyle = k % 2 ? '#d9620f' : '#ef7a14'; g.beginPath(); g.ellipse(k * 16, 0, 30 - Math.abs(k) * 4, 44, 0, 0, 7); g.fill(); }
    g.fillStyle = '#3d5a14'; g.fillRect(-5, -54, 10, 14);
    if (lit) {
      const fl = 0.8 + Math.sin(t * 13) * 0.2;
      g.fillStyle = `rgba(255,${200 + fl * 40},90,1)`; g.shadowColor = '#ffcf40'; g.shadowBlur = 20 * fl;
      for (const ex of [-18, 18]) { g.beginPath(); g.moveTo(ex - 10, -6); g.lineTo(ex, -22); g.lineTo(ex + 10, -6); g.fill(); }
      g.beginPath(); g.moveTo(-24, 12); for (let i = 0; i <= 8; i++) g.lineTo(-24 + i * 6, 12 + (i % 2 ? 6 : 0) + mouth * 14); g.lineTo(24, 12 + mouth * 22); g.lineTo(-24, 12 + mouth * 22); g.fill();
      g.shadowBlur = 0;
    }
    g.restore();
  }
  _barn(g, x, y, s, crush = 0) {
    g.save(); g.translate(x, y); g.scale(s, s * (1 - crush * 0.7));
    g.fillStyle = '#5a1410'; g.fillRect(-50, -60, 100, 60);
    g.beginPath(); g.moveTo(-58, -60); g.lineTo(0, -95); g.lineTo(58, -60); g.fill();
    g.strokeStyle = '#e8dcc0'; g.lineWidth = 3; g.strokeRect(-18, -40, 36, 40); g.beginPath(); g.moveTo(-18, -40); g.lineTo(18, 0); g.moveTo(18, -40); g.lineTo(-18, 0); g.stroke();
    g.restore();
  }
  _town(g, off, base, lit) {
    const tops = [70, 52, 90, 64, 110, 58, 76, 96, 60, 84];
    for (let i = 0; i < 14; i++) {
      const x = ((i * 64 - off) % (W + 128) + W + 128) % (W + 128) - 64, h = tops[i % tops.length];
      g.fillStyle = '#0c0812'; g.fillRect(x, base - h, 56, h);
      for (let wy = base - h + 10; wy < base - 10; wy += 16) for (let wx = x + 8; wx < x + 50; wx += 14) { g.fillStyle = lit && ((wx * 7 + wy * 3) % 5 > 1) ? '#ffcf70' : '#1c1420'; g.fillRect(wx, wy, 6, 8); }
    }
  }

  _ptitle(g, u, t) {
    this._sky(g, '#1a0a02', '#4a1a06');
    this._moon(g, 500, 70, 44, '#ffd9a0');
    this._hills(g, 0, H - 40, 18, '#120702', 0.012);
    for (let i = 0; i < 7; i++) this._pumpkin(g, 40 + i * 92, H - 34 + (i % 2) * 6, 0.35 + (i % 3) * 0.06, i % 2 === 0, 0, t + i);
    g.globalAlpha = Math.min(1, u / 1.2);
    this._bigTitle(g, 'ATTACK OF THE', 70, 34, '#ff8a1a');
    this._bigTitle(g, '50 FT PUMPKIN', 140, 70, '#ff6a00');
    g.globalAlpha = 1;
  }
  _patch(g, u, t) {
    this._sky(g, '#0b0a1e', '#24203a');
    this._moon(g, 120, 60, 38);
    this._hills(g, u * 6, 200, 28, '#14101e', 0.01);
    this._barn(g, 470, 220, 0.9);
    g.fillStyle = '#120c08'; g.fillRect(0, 220, W, H - 220);
    for (let i = 0; i < 9; i++) this._pumpkin(g, 30 + i * 70, 236 + (i % 2) * 10, 0.22, false);
    // the seed swells, pulsing, as the farmer pours in something that is definitely not water
    const grow = Math.min(1, u / 13), pulse = 1 + Math.sin(t * 4) * 0.04 * grow;
    this._pumpkin(g, 300, 236 - grow * 30, (0.18 + grow * 0.55) * pulse, grow > 0.5, 0, t);
    g.fillStyle = '#2a2018'; g.fillRect(208, 182, 14, 40); g.fillStyle = '#7a5a30'; g.fillRect(203, 172, 24, 10); // the farmer, hat on
    g.save(); g.translate(228, 196); g.rotate(0.6 + Math.sin(t * 2) * 0.1); g.fillStyle = '#5a5a60'; g.fillRect(0, -6, 26, 12); g.restore();
    for (let k = 0; k < 4; k++) { g.fillStyle = 'rgba(40,30,20,0.9)'; g.fillRect(252 + k * 4, 204 + ((t * 60 + k * 9) % 26), 3, 6); }
    if (u < 4) this._caption(g, "HOLLIS FARM  ·  HALLOWEEN EVE", 30, 16);
  }
  _growth(g, u, t) {
    const flash = Math.sin(t * 2.3) > 0.96 ? 1 : 0;
    this._sky(g, flash ? '#a89ac8' : '#0d0820', flash ? '#6a5a80' : '#2a1430');
    g.fillStyle = '#100a08'; g.fillRect(0, 230, W, H - 230);
    const k = Math.min(1, u / 12);
    this._barn(g, 480, 230, 0.9, Math.max(0, (k - 0.55) * 2));
    // it grows past the barn; the camera shakes
    const sx = Math.sin(t * 40) * k * 3;
    this._pumpkin(g, 300 + sx, 230 - 40 - k * 70, 1 + k * 2.1, true, k > 0.6 ? 0.4 : 0, t);
    if (flash) { g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(560, 0); g.lineTo(530, 60); g.lineTo(552, 70); g.lineTo(520, 140); g.stroke(); }
  }
  _rampage(g, u, t) {
    this._sky(g, '#120614', '#3a1420');
    this._moon(g, 540, 60, 30, '#ffb070');
    this._town(g, u * 40, 230, true);
    g.fillStyle = '#0e0a10'; g.fillRect(0, 230, W, H - 230);
    g.fillStyle = '#c9a23a'; for (let i = 0; i < 12; i++) g.fillRect(((i * 70 - u * 200) % (W + 70) + W + 70) % (W + 70) - 35, 255, 34, 4);
    // townsfolk cars flee to the right, the pumpkin bounds after them
    for (let i = 0; i < 3; i++) this._car(g, 420 + i * 70 + Math.sin(u * 3 + i) * 6, 252, 0.8, ['#7a1f1f', '#1d3b5a', '#e8e4d8'][i]);
    const bounce = Math.abs(Math.sin(u * 2.4)) * 40;
    g.save(); g.translate(170, 150 - bounce); g.rotate(u * 1.2); this._pumpkin(g, 0, 0, 1.6, true, 0.6 + Math.sin(t * 6) * 0.3, t); g.restore();
    if (u < 4) this._caption(g, 'MAIN STREET  ·  9:41 PM', 30, 16);
  }
  _showdown(g, u, t) {
    this._sky(g, '#0a0516', '#22102a');
    this._town(g, 0, 225, false);
    g.fillStyle = '#100c14'; g.fillRect(0, 225, W, H - 225);
    // the sheriff's hot rod launches off a ramp with a carving blade on the hood
    const k = Math.min(1, u / 10);
    this._pumpkin(g, 470, 140, 2.0, true, 0.8 + Math.sin(t * 8) * 0.2, t);
    g.fillStyle = '#c9a23a'; g.beginPath(); g.moveTo(140, 225); g.lineTo(230, 225); g.lineTo(230, 195); g.fill();
    const x = 60 + k * 420, y = 220 - Math.max(0, Math.sin(Math.max(0, k - 0.18) / 0.82 * Math.PI)) * 120;
    g.save(); g.translate(x, y); g.rotate(-0.3 + k * 0.4); this._car(g, 0, 0, 1.3, '#b8b8c0'); g.fillStyle = '#e8e8f0'; g.beginPath(); g.moveTo(60, -10); g.lineTo(96, -4); g.lineTo(60, 2); g.fill(); g.restore();
    g.fillStyle = '#e8d070'; g.beginPath(); g.arc(x - 30, y - 50, 3, 0, 7); g.fill(); // the star on the roof
  }
  _splat(g, u, t) {
    g.fillStyle = '#0a0408'; g.fillRect(0, 0, W, H);
    const k = Math.min(1, u / 1.2);
    for (let i = 0; i < 40; i++) {
      const a = i * 2.39, r = k * (60 + (i * 37) % 220);
      g.fillStyle = i % 3 ? '#ef7a14' : '#ffcf40';
      g.beginPath(); g.ellipse(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r * 0.6 + u * u * 8, 10 + (i % 4) * 5, 6 + (i % 3) * 4, a, 0, 7); g.fill();
    }
    if (u > 2) this._bigTitle(g, 'SQUASHED.', H / 2, 54, '#ff6a00');
    if (u > 4.5) this._caption(g, 'THIS HALLOWEEN, NOBODY IS SAFE FROM THE PATCH', H - 40, 16, '#ffd9a0');
  }
  _pcredits(g, u) {
    g.fillStyle = '#060304'; g.fillRect(0, 0, W, H);
    const lines = ['THE END ?', '', 'SHERIFF MABEL GOURD ........ herself', 'OLD MAN HOLLIS ........ himself', 'THE PUMPKIN ........ a pumpkin', 'DIRECTED BY ........ BIG SAL',
      'PUMPKIN WRANGLING ........ OLD MORTIMER', 'PIE ........ THE MOONLITE DINER', 'NO GOURDS WERE HARMED (MOST)', 'SCREEN 2 AT THE PALACE', '', 'STAY FOR THE STINGER...'];
    lines.forEach((l, i) => { const y = H + 20 + i * 30 - u * 64; if (y > -20 && y < H + 20) this._caption(g, l, y, i === 0 ? 40 : 16, i === 0 ? '#ff6a00' : '#e6dcc8'); });
  }
  _sprout(g, u, t) {
    this._sky(g, '#05040c', '#120c1a');
    this._moon(g, W / 2, 80, 46);
    g.fillStyle = '#0c0806'; g.fillRect(0, 220, W, H - 220);
    // one orange seed left in the mud... sprouts... and opens an eye
    const k = Math.min(1, u / 4);
    g.strokeStyle = '#3d7a1a'; g.lineWidth = 4; g.beginPath(); g.moveTo(W / 2, 224); g.quadraticCurveTo(W / 2 - 14, 224 - k * 30, W / 2 + 4, 224 - k * 56); g.stroke();
    this._pumpkin(g, W / 2 + 4, 224 - k * 56 - 8, 0.14 + k * 0.08, u > 5, 0, t);
    if (u > 6) this._caption(g, 'THE PATCH WILL RETURN', 30, 16, '#ff6a00');
  }
}

/** Blender box-projects UVs in metres; screens/posters need 0..1 across the face the audience sees.
 * uAxis = model-space direction in which u grows (the viewer's right): 'x', '-x', 'z' or '-z'. */
function fitScreenUV(mesh, uAxis) {
  const g = mesh.geometry, pos = g.attributes.position;
  g.computeBoundingBox();
  const bb = g.boundingBox, h = bb.max.y - bb.min.y || 1;
  const ax = uAxis.replace('-', ''), neg = uAxis[0] === '-';
  const lo = bb.min[ax], span = bb.max[ax] - bb.min[ax] || 1;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const u = ((ax === 'x' ? pos.getX(i) : pos.getZ(i)) - lo) / span;
    uv[i * 2] = neg ? 1 - u : u;
    uv[i * 2 + 1] = (pos.getY(i) - bb.min.y) / h;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Procedural movie-poster canvases for the poster cases. */
function posterTexture(i) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 384;
  const g = c.getContext('2d');
  const P = [
    ['NIGHT OF THE V8', '#2b0a14', '#ff2a1a', 'ROXY STEEL vs COUNT CARBURETOR'],
    ['ATTACK OF THE 50 FT PUMPKIN', '#1a0d00', '#ff8a1a', 'IT CAME FROM THE PATCH'],
    ['THE FOG LIGHTS', '#0a1420', '#bfe4ff', 'THEY SEE YOU COMING'],
    ['GHOST RIDERS IN THE CAR WASH', '#0a1a10', '#7dff8a', 'SOME STAINS NEVER COME OUT'],
  ][i % 4];
  const gr = g.createLinearGradient(0, 0, 0, 384); gr.addColorStop(0, P[1]); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, 256, 384);
  g.fillStyle = P[2]; g.globalAlpha = 0.25; g.beginPath(); g.arc(128, 150, 90, 0, 7); g.fill(); g.globalAlpha = 1;
  g.fillStyle = P[2]; g.textAlign = 'center';
  const words = P[0].split(' ');
  let y = 250;
  g.font = '900 30px Georgia, serif';
  for (let k = 0; k < words.length; k += 2) { g.fillText(words.slice(k, k + 2).join(' '), 128, y); y += 34; }
  g.font = '700 12px Georgia, serif'; g.fillStyle = '#e6dcc8'; g.fillText(P[3], 128, 40);
  g.font = '700 11px Georgia, serif'; g.fillText('MOTORWORKS PICTURES', 128, 370);
  g.strokeStyle = P[2]; g.lineWidth = 4; g.strokeRect(6, 6, 244, 372);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/**
 * The Palace Cinema + Starlight Drive-In: projects the Film onto both screens, sells tickets and popcorn, enforces the
 * usher, seats the player (seated camera, dimmed house, voiced film audio), fills seats with an audience, hides a ghost
 * projectionist in the booth and counts honks at the drive-in (3 -> INTERMISSION reel, a secret).
 */
export class Cinema {
  constructor(game) {
    this.game = game;
    // Screen 1: NIGHT OF THE V8 · Screen 2 (the annex): ATTACK OF THE 50 FT PUMPKIN · the drive-in runs the V8 early show
    // and the Pumpkin as the midnight movie (00:00-12:00 on the day/night clock)
    this.films = { v8: new Film(), pumpkin: new PumpkinFilm() };
    this.film = this.films.v8;
    const screen = (f) => new THREE.MeshBasicMaterial({ map: f.tex, toneMapped: false, color: new THREE.Color(0.92, 0.92, 0.92) });
    this.screenMat = screen(this.films.v8);
    this.screen2Mat = screen(this.films.pumpkin);
    this.driveMat = screen(this.films.v8);
    this.lastCues = {};
    this.ticket = 0;
    this.stats = { tickets: 0, popcorn: 0, filmFrames: 0, watched: 0, usherStops: 0, seatedSecs: 0, cuesPlayed: 0, intermissions: 0 };
    this.seats = [];
    this.lastCue = -1;
    this.honks = [];
    this.audience = [];
    this.activityName = 'Cinema';
    this.ownsChar = true; // while seated, the cinema poses the player character itself
  }

  /** Called by the town builder with the placed (not yet batched) cinema root. */
  setupCinema(obj, building) {
    const g = this.game;
    this.obj = obj;
    this.b = building;
    this.rot = obj.rotation.y;
    this.center = obj.position.clone();
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (/^Seat_\d+_\d+$/.test(o.name)) { const [, r, c] = o.name.split('_').map(Number); this.seats.push({ row: r, col: c, pos: o.getWorldPosition(new THREE.Vector3()), taken: false, screen: 1, yaw: this.rot }); }
      // Screen 2 seats face the other way (its screen is on the annex's back wall)
      if (/^Seat2_\d+_\d+$/.test(o.name)) { const [, r, c] = o.name.split('_').map(Number); this.seats.push({ row: r, col: c, pos: o.getWorldPosition(new THREE.Vector3()), taken: false, screen: 2, yaw: this.rot + Math.PI }); }
      if (!o.isMesh) return;
      if (o.name === 'Cinema_Screen') { fitScreenUV(o, '-x'); o.material = this.screenMat; this.screen = o; }
      else if (o.name === 'Cinema_Screen2') { fitScreenUV(o, 'x'); o.material = this.screen2Mat; this.screen2 = o; }
      else if (/^MoviePoster_\d+$/.test(o.name)) { fitScreenUV(o, ['x', 'x', '-z', 'z'][+o.name.split('_')[1]]); o.material = new THREE.MeshStandardMaterial({ map: posterTexture(+o.name.split('_')[1]), roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0.15, emissiveMap: null }); }
      else if (o.material && o.material.name === 'FX_LightShaft') { o.material = this.beamMat = new THREE.MeshBasicMaterial({ color: '#cfd8ff', transparent: true, opacity: 0.018, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }); o.renderOrder = 3; }
      else if (o.material && o.material.name === 'Lamp_Marquee') o.material = this.marqueeMat ||= o.material.clone();
    });
    this.screenCenter = this.screen ? new THREE.Box3().setFromObject(this.screen).getCenter(new THREE.Vector3()) : this.local(0, 4.9, LZ - 0.25);
    this.screen2Center = this.screen2 ? new THREE.Box3().setFromObject(this.screen2).getCenter(new THREE.Vector3()) : null;
    g.batcher.add(obj);
    g.scene.remove(obj);
  }

  /** The drive-in screen prop: film on the canvas, the painted title hidden. */
  setupDriveIn(obj) {
    obj.traverse((o) => {
      if (!o.isMesh) return;
      if (o.name === 'DriveIn_Canvas') { fitScreenUV(o, 'x'); o.material = this.driveMat; this.driveScreen = o; }
      if (o.name === 'DriveIn_Title' || o.name === 'DriveIn_Sub') o.visible = false;
    });
    obj.updateMatrixWorld(true);
    this.driveCenter = this.driveScreen ? new THREE.Box3().setFromObject(this.driveScreen).getCenter(new THREE.Vector3()) : obj.position.clone();
    this.driveIn = obj;
    this.game.batcher.add(obj);
    this.game.scene.remove(obj);
  }

  /** cinema-local (x, y, z) -> world */
  local(x, y, z) { return new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rot).add(this.center); }
  toLocal(p) { return p.clone().sub(this.center).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.rot); }

  /** staff + audience + the booth ghost (after NPCs exist) */
  populate() {
    const g = this.game, N = g.npcs, s = this.b.spots;
    const yaw = this.rot;
    this.clerk = N.addStatic('boxoffice', 'demo', s.Clerk, yaw + Math.PI, ['boxoffice_2'], { ageGroup: 'adult_female', role: 'boxoffice', voiceKey: 'boxoffice', anim: 'idle', name: 'Dusty (Box Office)' });
    this.usher = N.addStatic('usher', 'demo', s.Usher, yaw, ['usher_1', 'usher_shh'], { ageGroup: 'adult_male', role: 'usher', voiceKey: 'usher', anim: 'idle', name: 'Theo (Usher)',
      variant: { shirt: '#7a0f1a', pants: '#111', hair: '#2a1a10', skin: '#c68e6a', acc: ['Hat_Cap'] } });
    this.vendor = N.addStatic('vendor', 'demo', s.Vendor, yaw, ['concession_1'], { ageGroup: 'adult_female', role: 'vendor', voiceKey: 'vendor', anim: 'idle', name: 'Concession Stand',
      variant: { shirt: '#c81d11', pants: '#222', hair: '#4b2e16', skin: '#d8a283', acc: ['Hair_Ponytail'] } });
    // audience: townsfolk in rows 1-6 facing the screen
    const free = this.seats.filter((x) => x.screen === 1 && x.row >= 1 && x.row <= 6 && x.col % 2 === 0);
    const free2 = this.seats.filter((x) => x.screen === 2 && x.col % 2 === 1);
    for (let i = 0; i < 6 && free2.length; i++) free.push(free2.splice(Math.floor(Math.random() * free2.length), 1)[0]);
    for (let i = 0; i < 18 && free.length; i++) {
      const seat = free.splice(Math.floor(Math.random() * free.length), 1)[0];
      seat.taken = true;
      const kid = Math.random() < 0.3;
      const c = makePerson(g.assets, kid ? randomKid() : randomAdult(), 'audience');
      this._sit(c, seat);
      g.scene.add(c.root);
      this.audience.push({ char: c, seat, laughT: rnd(2, 12) });
    }
    // the projectionist who never clocked out: a pale see-through figure in the booth
    const ghost = makePerson(g.assets, 'adult_male', 'projectionist', { variant: { shirt: '#c9d6e4', pants: '#9fb0c4', hair: '#e8eef4', skin: '#dfe8f0', acc: ['Hat_Fedora', 'Moustache'] }, noBake: true });
    ghost.root.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); Object.assign(o.material, { transparent: true, opacity: 0.0, depthWrite: false }); o.material.emissive = new THREE.Color('#9fd8ff'); o.material.emissiveIntensity = 0.6; o.castShadow = false; } });
    ghost.root.position.copy(s.Projectionist);
    ghost.root.rotation.y = yaw + Math.PI;
    g.scene.add(ghost.root);
    this.ghost = { char: ghost, a: 0, idx: 0 };
  }

  _sit(char, seat) {
    char.root.position.copy(seat.pos).add(new THREE.Vector3(0, -0.84 * char.root.scale.y + 0.08, 0)).addScaledVector(new THREE.Vector3(Math.sin(seat.yaw), 0, Math.cos(seat.yaw)), -0.08);
    char.root.rotation.y = seat.yaw;
    char.anim = 'sit';
  }

  /** Each reel loops on the game clock; filmTime() with no argument is Screen 1. */
  filmTime(film = this.films.v8) { return this.game.time % film.length; }

  /** The drive-in's programme: the V8 early show until midnight, the Pumpkin as the midnight movie until noon. */
  driveFilm() { const h = this.game.atmo ? this.game.atmo.hour : 20; return h < 12 ? this.films.pumpkin : this.films.v8; }

  /** Film for a viewing place: 'palace' (Screen 1), 'palace2' (Screen 2) or 'drivein'. */
  filmFor(where) { return where === 'palace2' ? this.films.pumpkin : where === 'drivein' ? this.driveFilm() : this.films.v8; }

  /** Interaction candidates for the unified [E] prompt. */
  candidates(pos) {
    const g = this.game, out = [], s = this.b.spots;
    const money = g.state.money;
    if (s.BoxOffice && pos.distanceTo(s.BoxOffice) < 1.8) {
      out.push(this.ticket > 0 ? { d: 0.3, text: '🎟️ You have a ticket: Screen 1 is through the lobby, Screen 2 through the west door', act: () => {} }
        : { d: 0.3, text: '[E] Buy a ticket ($8): Screen 1 NIGHT OF THE V8 · Screen 2 ATTACK OF THE 50 FT PUMPKIN', act: () => this.buyTicket() });
    }
    if (s.Concession && pos.distanceTo(s.Concession) < 1.7) out.push({ d: 0.35, text: '[E] Buy popcorn — $5', act: () => this.buyPopcorn() });
    if (this.ghost && this.ghost.a > 0.4 && pos.distanceTo(this.ghost.char.root.position) < 2.6) out.push({ d: 0.4, text: '[E] Talk to the… projectionist?', act: () => this.talkGhost() });
    const scr = this.inAuditorium(pos) ? 1 : this.inAnnex(pos) ? 2 : 0;
    if (scr) {
      let best = null, bd = 1.1;
      for (const st of this.seats) { if (st.taken || st.screen !== scr) continue; const d = Math.hypot(st.pos.x - pos.x, st.pos.z - pos.z); if (d < bd && Math.abs(st.pos.y - pos.y) < 1.2) { bd = d; best = st; } }
      if (best) out.push({ d: bd, text: `[E] Sit down (Screen ${scr}, row ${String.fromCharCode(65 + best.row)}) and watch ${this.filmFor(scr === 2 ? 'palace2' : 'palace').title}`, act: () => this.sit(best) });
    }
    return out;
  }

  buyTicket() {
    const g = this.game;
    if (g.state.money < 8) { g.npcs.speak(this.clerk, 'boxoffice_broke'); return; }
    g.state.money -= 8;
    this.ticket = 600;
    this.stats.tickets++;
    g.audio.cash();
    g.npcs.speak(this.clerk, 'boxoffice_1');
    g.hud.toast('🎟️ Ticket bought — enjoy the show!', 'good');
    g.events.emit('ticket', {});
  }

  buyPopcorn() {
    const g = this.game;
    if (g.state.money < 5) { g.hud.toast('Not enough cash for popcorn', 'bad'); return; }
    g.state.money -= 5;
    this.stats.popcorn++;
    g.audio.cash();
    g.npcs.speak(this.vendor, 'concession_1');
    if (g.combat) g.combat.health = Math.min(100, g.combat.health + 15);
    try {
      const pc = g.assets.part('props', 'Popcorn');
      pc.position.set(0, -0.05, 0.08);
      g.player.char.hold(pc, 'L');
      this.popcorn = pc;
      clearTimeout(this._popT);
      this._popT = setTimeout(() => { if (this.popcorn && this.popcorn.parent) this.popcorn.parent.remove(this.popcorn); this.popcorn = null; }, 90000);
    } catch (e) { /* prop missing */ }
    g.hud.toast('🍿 Popcorn! +15 health', 'good');
  }

  talkGhost() {
    const gh = this.ghost;
    const id = gh.idx++ % 2 ? 'projectionist_2' : 'projectionist_1';
    this.game.say(id, gh.char);
    gh.char.talking = 4;
    this.game.secrets && this.game.secrets.find('projectionist');
  }

  inAuditorium(p) {
    if (!this.center) return false;
    const l = this.toLocal(p);
    return Math.abs(l.x) < 9.8 && l.z < LZ - 0.25 && l.z > -14.8 && l.y < 9;
  }

  /** Screen 2: the annex auditorium west of the main hall (cinema-local x -21..-10). */
  inAnnex(p) {
    if (!this.center || !this.screen2) return false;
    const l = this.toLocal(p);
    return l.x < -10.2 && l.x > -21 && l.z > -12 && l.z < 13.5 && l.y < 7;
  }

  // ---------------------------------------------------------------- seated viewing (an "activity" that owns input + camera)
  sit(seat) {
    const g = this.game;
    if (g.player.carrying) { g.hud.toast('Put that down first', 'bad'); return; }
    this.seat = seat;
    seat.taken = true;
    g.activity = this;
    this.seatT = 0;
    this.seatFilm = this.filmFor(seat.screen === 2 ? 'palace2' : 'palace');
    this.startedAt = this.filmTime(this.seatFilm);
    this.sawCredits = false;
    this._stingerCounted = false;
    g.hud.toast(`🎬 Screen ${seat.screen}: ${this.seatFilm.title}. Press [E] or [W] to get up`, '', 4000);
    g.events.emit('seated', { row: seat.row, screen: seat.screen, film: this.seatFilm.id });
  }

  stand() {
    const g = this.game;
    if (!this.seat) return;
    this.seat.taken = false;
    g.player.char.root.visible = true;
    const yaw = this.seat.yaw;
    const p = this.seat.pos.clone().addScaledVector(new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), 0.7);
    g.player.teleport(new THREE.Vector3(p.x, this.seat.pos.y - 0.42, p.z), yaw);
    this.seat = null;
    g.activity = null;
    g.input.clearAll('stand');
  }

  /** activity hook (game.activity): called instead of the on-foot controls while seated; the world tick is tick() */
  update(dt, input) {
    const g = this.game, p = g.player;
    if (input.pressed('KeyE') || input.pressed('KeyW')) { this.stand(); return; }
    this.seatT += dt;
    this.stats.seatedSecs += dt;
    const yaw = this.seat.yaw;
    p.teleport(new THREE.Vector3(this.seat.pos.x, this.seat.pos.y - 0.42, this.seat.pos.z), yaw);
    p.char.root.position.copy(this.seat.pos).add(new THREE.Vector3(0, -0.76, 0)).addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), -0.08);
    p.char.root.rotation.y = yaw;
    p.char.root.visible = false;
    p.char.update(dt, 'sit');
    const f = this.seatFilm, ft = this.filmTime(f);
    if (ft >= f.spec.credits[0] && ft < f.spec.credits[1]) this.sawCredits = true;
    if (this.sawCredits && ft >= f.spec.stinger && !this._stingerCounted) {
      this._stingerCounted = true; this.stats.watched++;
      (this.stats.watchedBy ||= {})[f.id] = (this.stats.watchedBy[f.id] || 0) + 1;
      g.hud.toast('🎬 You stayed for the post-credits stinger!', 'good', 4000); g.secrets && g.secrets.find('stinger');
    }
  }

  cameraPose() {
    if (!this.seat) return null;
    // first-person from the seat: eye height, the player's own model is hidden while seated
    const yaw = this.seat.yaw;
    const pos = this.seat.pos.clone().add(new THREE.Vector3(0, 1.12, 0)).addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), 0.05);
    return { pos, look: this.seat.screen === 2 ? this.screen2Center : this.screenCenter };
  }

  /** honk counter at the drive-in: three quick honks swap the reel for the intermission cartoon */
  honk() {
    const g = this.game, v = g.player.vehicle;
    if (!v || !this.driveCenter || v.position.distanceTo(this.driveCenter) > 45) return;
    const now = g.time;
    this.honks = this.honks.filter((t) => now - t < 3).concat(now);
    const df = this.driveFilm();
    if (this.honks.length >= 3 && df.intermission <= 0) {
      df.intermission = 14;
      this.honks = [];
      this.stats.intermissions++;
      g.hud.toast('🌭 INTERMISSION! The projectionist heard you.', 'good', 4000);
      g.secrets && g.secrets.find('intermission');
    }
  }

  watching() {
    const g = this.game;
    if (this.seat) return this.seat.screen === 2 ? 'palace2' : 'palace';
    const v = g.player.vehicle;
    if (v && this.driveCenter && v.position.distanceTo(this.driveCenter) < 48 && v.speedAbs < 3) return 'drivein';
    return null;
  }

  tick(dt) {
    const g = this.game;
    if (this.ticket > 0) this.ticket -= dt;
    for (const f of Object.values(this.films)) if (f.intermission > 0) f.intermission -= dt;
    // usher: no ticket, no movie (the one ticket admits you to either screen)
    const p = g.player;
    const inside = !p.vehicle && !this.seat && (this.inAuditorium(p.position) ? 1 : this.inAnnex(p.position) ? 2 : 0);
    if (inside) {
      if (this.ticket <= 0) {
        if (!this._bounceT || g.time > this._bounceT) {
          this._bounceT = g.time + 4;
          this.stats.usherStops++;
          g.npcs.speak(this.usher, 'usher_stop');
        }
        const back = inside === 2 ? this.local(-8.4, 0.15, 11.9) : this.local(-8.6, 0.15, LZ + 1.6);
        p.teleport(back, this.rot);
      } else if (!this._ushered) { this._ushered = true; g.npcs.speak(this.usher, 'usher_1'); }
    }
    // the drive-in swaps reels at midnight and noon
    const df = this.driveFilm();
    if (this.driveMat.map !== df.tex) { this.driveMat.map = df.tex; this.driveMat.needsUpdate = true; }
    // projectors: each reel redraws (15 fps) only while one of its screens is near the camera
    const cam = g.camera.position;
    const nearDrive = this.driveCenter && cam.distanceTo(this.driveCenter) < 110;
    const show = {
      v8: (this.screenCenter && cam.distanceTo(this.screenCenter) < 40) || (nearDrive && df === this.films.v8),
      pumpkin: (this.screen2Center && cam.distanceTo(this.screen2Center) < 32) || (nearDrive && df === this.films.pumpkin),
    };
    if ((this._acc = (this._acc || 0) + dt) > 1 / 15) {
      this._acc = 0;
      for (const [id, f] of Object.entries(this.films)) if (show[id]) { f.draw(this.filmTime(f)); this.stats.filmFrames++; (this.stats.framesBy ||= {})[id] = (this.stats.framesBy[id] || 0) + 1; }
      if (show.v8 && this.beamMat) this.beamMat.opacity = 0.014 + Math.random() * 0.01;
    }
    if (this.marqueeMat) this.marqueeMat.emissiveIntensity = 2.5 + 2 * Math.max(0, Math.sin(g.time * 6));
    // film audio cues for whoever is watching (a Palace seat on either screen, or a parked car at the drive-in)
    const w = this.watching();
    if (w) {
      const f = this.filmFor(w), ft = this.filmTime(f), C = f.cues;
      const cue = C.findIndex(([t]) => ft >= t && ft < t + 0.5);
      const last = this.lastCues[f.id] ?? -1;
      if (cue >= 0 && cue !== last && f.intermission <= 0) { this.lastCues[f.id] = cue; this.stats.cuesPlayed++; g.say(C[cue][1]); }
      if (cue < 0 && ft > 0.5 && last >= 0 && ft < C[0][0]) this.lastCues[f.id] = -1;
      this.lastCue = this.lastCues[f.id] ?? -1;
    }
    if (w && w !== this._watchingWas) g.hud.toast(w === 'drivein' ? `📻 Drive-in audio on (${this.driveFilm().title}): the film sound plays through your car radio` : '🎬 Enjoy the show', '', 3500);
    this._watchingWas = w;
    // booth ghost fades in when you climb up to the projection booth
    if (this.ghost) {
      const d = this.ghost.char.root.position.distanceTo(p.position);
      const target = d < 7 ? 0.55 : 0;
      this.ghost.a += (target - this.ghost.a) * Math.min(1, dt * 1.5);
      this.ghost.char.root.visible = this.ghost.a > 0.02;
      if (this.ghost.char.root.visible) {
        this.ghost.char.root.traverse((o) => { if (o.isMesh) o.material.opacity = this.ghost.a * (0.8 + Math.sin(g.time * 3) * 0.2); });
        this.ghost.char.update(dt, this.ghost.char.talking > 0 ? 'talk' : 'operate');
        this.ghost.char.root.position.y = this.b.spots.Projectionist.y + Math.sin(g.time * 1.4) * 0.06;
      }
    }
    // audience: only animate when someone can see them
    const audVis = !!this.center && (this.inAuditorium(cam) || this.inAnnex(cam) || cam.distanceTo(this.center) < 12);
    for (const a of this.audience) a.char.root.visible = audVis;
    if (audVis) {
      for (const a of this.audience) {
        a.char.update(dt, 'sit');
        if ((a.laughT -= dt) < 0) { a.laughT = rnd(6, 18); a.char.talking = 0.8; }
      }
    }
  }
}
