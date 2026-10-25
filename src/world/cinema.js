import * as THREE from 'three';
import { makePerson, randomAdult, randomKid } from '../data/demographics.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const LZ = 4.0;                 // lobby / auditorium partition (cinema-local z)
const FILM_LEN = 102;           // seconds per showing (the reel loops)
const W = 640, H = 288;

// line cues (film time -> dialogue id); the HUD subtitle shows them while you watch
const CUES = [[13, 'movie_narr_1'], [22, 'movie_hero_1'], [38, 'movie_villain_1'], [51, 'movie_hero_2'], [75, 'movie_narr_2'], [94, 'movie_villain_2']];
const SCENES = [[0, 'leader'], [6, 'studio'], [12, 'titlecard'], [18, 'road'], [34, 'chase'], [48, 'factory'], [62, 'jump'], [74, 'trailer'], [84, 'credits'], [92, 'stinger']];
export const FILM = { length: FILM_LEN, cues: CUES, scenes: SCENES };

/**
 * "NIGHT OF THE V8" - a 100-second B-movie drawn procedurally into a canvas (countdown leader, studio logo, title,
 * Hollow Hill Road drive, ghost-car chase, the haunted factory, the cemetery-gate jump, trailer card, credits and a
 * post-credits stinger), with grain, scratches and gate flicker. One shared CanvasTexture feeds both the Palace
 * screen and the Starlight drive-in screen; it only redraws (15 fps) while a screen is near the camera.
 */
export class Film {
  constructor() {
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

  scene(t) { let s = SCENES[0][1]; for (const [at, name] of SCENES) if (t >= at) s = name; return s; }

  draw(t) {
    const g = this.g;
    this.frames++;
    g.save();
    if (this.intermission > 0) this._intermission(g, t);
    else {
      const s = this.scene(t);
      const st = SCENES.find((x) => x[1] === s)[0];
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
    this.film = new Film();
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.film.tex, toneMapped: false, color: new THREE.Color(0.92, 0.92, 0.92) });
    this.ticket = 0;
    this.stats = { tickets: 0, popcorn: 0, filmFrames: 0, watched: 0, usherStops: 0, seatedSecs: 0, cuesPlayed: 0, intermissions: 0 };
    this.seats = [];
    this.lastCue = -1;
    this.honks = [];
    this.audience = [];
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
      if (/^Seat_\d+_\d+$/.test(o.name)) { const [, r, c] = o.name.split('_').map(Number); this.seats.push({ row: r, col: c, pos: o.getWorldPosition(new THREE.Vector3()), taken: false }); }
      if (!o.isMesh) return;
      if (o.name === 'Cinema_Screen') { fitScreenUV(o, '-x'); o.material = this.screenMat; this.screen = o; }
      else if (/^MoviePoster_\d+$/.test(o.name)) { fitScreenUV(o, ['x', 'x', '-z', 'z'][+o.name.split('_')[1]]); o.material = new THREE.MeshStandardMaterial({ map: posterTexture(+o.name.split('_')[1]), roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0.15, emissiveMap: null }); }
      else if (o.material && o.material.name === 'FX_LightShaft') { o.material = this.beamMat = new THREE.MeshBasicMaterial({ color: '#cfd8ff', transparent: true, opacity: 0.018, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }); o.renderOrder = 3; }
      else if (o.material && o.material.name === 'Lamp_Marquee') o.material = this.marqueeMat ||= o.material.clone();
    });
    this.screenCenter = this.screen ? new THREE.Box3().setFromObject(this.screen).getCenter(new THREE.Vector3()) : this.local(0, 4.9, LZ - 0.25);
    g.batcher.add(obj);
    g.scene.remove(obj);
  }

  /** The drive-in screen prop: film on the canvas, the painted title hidden. */
  setupDriveIn(obj) {
    obj.traverse((o) => {
      if (!o.isMesh) return;
      if (o.name === 'DriveIn_Canvas') { fitScreenUV(o, 'x'); o.material = this.screenMat; this.driveScreen = o; }
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
    const free = this.seats.filter((x) => x.row >= 1 && x.row <= 6 && x.col % 2 === 0);
    for (let i = 0; i < 12 && free.length; i++) {
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
    char.root.position.copy(seat.pos).add(new THREE.Vector3(0, -0.84 * char.root.scale.y + 0.08, 0)).addScaledVector(new THREE.Vector3(Math.sin(this.rot), 0, Math.cos(this.rot)), -0.08);
    char.root.rotation.y = this.rot;
    char.anim = 'sit';
  }

  filmTime() { return this.game.time % FILM_LEN; }

  /** Interaction candidates for the unified [E] prompt. */
  candidates(pos) {
    const g = this.game, out = [], s = this.b.spots;
    const money = g.state.money;
    if (s.BoxOffice && pos.distanceTo(s.BoxOffice) < 1.8) {
      out.push(this.ticket > 0 ? { d: 0.3, text: '🎟️ You have a ticket — the auditorium is through the lobby', act: () => {} }
        : { d: 0.3, text: '[E] Buy a ticket for NIGHT OF THE V8 — $8', act: () => this.buyTicket() });
    }
    if (s.Concession && pos.distanceTo(s.Concession) < 1.7) out.push({ d: 0.35, text: '[E] Buy popcorn — $5', act: () => this.buyPopcorn() });
    if (this.ghost && this.ghost.a > 0.4 && pos.distanceTo(this.ghost.char.root.position) < 2.6) out.push({ d: 0.4, text: '[E] Talk to the… projectionist?', act: () => this.talkGhost() });
    if (this.inAuditorium(pos)) {
      let best = null, bd = 1.1;
      for (const st of this.seats) { if (st.taken) continue; const d = Math.hypot(st.pos.x - pos.x, st.pos.z - pos.z); if (d < bd && Math.abs(st.pos.y - pos.y) < 1.2) { bd = d; best = st; } }
      if (best) out.push({ d: bd, text: `[E] Sit down (row ${String.fromCharCode(65 + best.row)}) and watch the movie`, act: () => this.sit(best) });
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

  // ---------------------------------------------------------------- seated viewing (an "activity" that owns input + camera)
  sit(seat) {
    const g = this.game;
    if (g.player.carrying) { g.hud.toast('Put that down first', 'bad'); return; }
    this.seat = seat;
    seat.taken = true;
    g.activity = this;
    this.seatT = 0;
    this.startedAt = this.filmTime();
    this.sawCredits = false;
    g.hud.toast('🎬 Now showing: NIGHT OF THE V8 — [E] or [W] to get up', '', 4000);
    g.events.emit('seated', { row: seat.row });
  }

  stand() {
    const g = this.game;
    if (!this.seat) return;
    this.seat.taken = false;
    g.player.char.root.visible = true;
    const p = this.seat.pos.clone().addScaledVector(new THREE.Vector3(Math.cos(this.rot), 0, -Math.sin(this.rot)), 0.7);
    g.player.teleport(new THREE.Vector3(p.x, this.seat.pos.y - 0.42, p.z), this.rot);
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
    p.teleport(new THREE.Vector3(this.seat.pos.x, this.seat.pos.y - 0.42, this.seat.pos.z), this.rot);
    p.char.root.position.copy(this.seat.pos).add(new THREE.Vector3(0, -0.76, 0)).addScaledVector(new THREE.Vector3(Math.sin(this.rot), 0, Math.cos(this.rot)), -0.08);
    p.char.root.rotation.y = this.rot;
    p.char.root.visible = false;
    p.char.update(dt, 'sit');
    const ft = this.filmTime();
    if (ft >= 84 && ft < 92) this.sawCredits = true;
    if (this.sawCredits && ft >= 96 && !this._stingerCounted) { this._stingerCounted = true; this.stats.watched++; g.hud.toast('🎬 You stayed for the post-credits stinger!', 'good', 4000); g.secrets && g.secrets.find('stinger'); }
  }

  cameraPose() {
    if (!this.seat) return null;
    // first-person from the seat: eye height, the player's own model is hidden while seated
    const pos = this.seat.pos.clone().add(new THREE.Vector3(0, 1.12, 0)).addScaledVector(new THREE.Vector3(Math.sin(this.rot), 0, Math.cos(this.rot)), 0.05);
    return { pos, look: this.screenCenter };
  }

  /** honk counter at the drive-in: three quick honks swap the reel for the intermission cartoon */
  honk() {
    const g = this.game, v = g.player.vehicle;
    if (!v || !this.driveCenter || v.position.distanceTo(this.driveCenter) > 45) return;
    const now = g.time;
    this.honks = this.honks.filter((t) => now - t < 3).concat(now);
    if (this.honks.length >= 3 && this.film.intermission <= 0) {
      this.film.intermission = 14;
      this.honks = [];
      this.stats.intermissions++;
      g.hud.toast('🌭 INTERMISSION! The projectionist heard you.', 'good', 4000);
      g.secrets && g.secrets.find('intermission');
    }
  }

  watching() {
    const g = this.game;
    if (this.seat) return 'palace';
    const v = g.player.vehicle;
    if (v && this.driveCenter && v.position.distanceTo(this.driveCenter) < 48 && v.speedAbs < 3) return 'drivein';
    return null;
  }

  tick(dt) {
    const g = this.game;
    if (this.ticket > 0) this.ticket -= dt;
    if (this.film.intermission > 0) this.film.intermission -= dt;
    // usher: no ticket, no movie
    const p = g.player;
    if (!p.vehicle && !this.seat && this.inAuditorium(p.position)) {
      if (this.ticket <= 0) {
        if (!this._bounceT || g.time > this._bounceT) {
          this._bounceT = g.time + 4;
          this.stats.usherStops++;
          g.npcs.speak(this.usher, 'usher_stop');
        }
        const back = this.local(-8.6, 0.15, LZ + 1.6);
        p.teleport(back, this.rot);
      } else if (!this._ushered) { this._ushered = true; g.npcs.speak(this.usher, 'usher_1'); }
    }
    // projector: redraw only while a screen is near the camera
    const cam = g.camera.position;
    const near = (this.screenCenter && cam.distanceTo(this.screenCenter) < 40) || (this.driveCenter && cam.distanceTo(this.driveCenter) < 110);
    if (near && (this._acc = (this._acc || 0) + dt) > 1 / 15) {
      this._acc = 0;
      this.film.draw(this.filmTime());
      this.stats.filmFrames++;
      if (this.beamMat) this.beamMat.opacity = 0.014 + Math.random() * 0.01;
    }
    if (this.marqueeMat) this.marqueeMat.emissiveIntensity = 2.5 + 2 * Math.max(0, Math.sin(g.time * 6));
    // film audio cues for whoever is watching (Palace seat or a parked car at the drive-in)
    const w = this.watching();
    const ft = this.filmTime();
    const cue = CUES.findIndex(([t]) => ft >= t && ft < t + 0.5);
    if (w && cue >= 0 && cue !== this.lastCue && this.film.intermission <= 0) { this.lastCue = cue; this.stats.cuesPlayed++; g.say(CUES[cue][1]); }
    if (cue < 0 && ft > 0.5 && this.lastCue >= 0 && ft < CUES[0][0]) this.lastCue = -1;
    if (w && !this._watchingWas) g.hud.toast(w === 'drivein' ? '📻 Drive-in audio on — the film sound plays through your car radio' : '🎬 Enjoy the show', '', 3500);
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
    const audVis = !!this.center && (this.inAuditorium(cam) || cam.distanceTo(this.center) < 12);
    for (const a of this.audience) a.char.root.visible = audVis;
    if (audVis) {
      for (const a of this.audience) {
        a.char.update(dt, 'sit');
        if ((a.laughT -= dt) < 0) { a.laughT = rnd(6, 18); a.char.talking = 0.8; }
      }
    }
  }
}
