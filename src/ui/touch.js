/**
 * Mobile / tablet touch controls (Phase 4). A floating joystick on the left (walk / steer), drag anywhere on the right
 * half to look around, and context buttons that swap between on-foot and in-car layouts. Everything feeds the shared
 * Input object (virtual key codes, touchMove, touchPedal, mouseDX/DY), so no gameplay code knows touch exists.
 * Shown automatically on touch-first devices (coarse pointer), or anywhere with ?touch=1 in the URL.
 */
const FOOT = [
  { id: 'use', label: 'E', keys: ['KeyE'], cls: 'big' },
  { id: 'jump', label: 'JUMP', keys: ['Space'] },
  { id: 'sprint', label: 'RUN', keys: ['ShiftLeft'] },
  { id: 'fire', label: '🔥', keys: ['Mouse0'] },
  { id: 'aim', label: 'AIM', keys: ['Mouse2'] },
  { id: 'reload', label: 'R', keys: ['KeyR'] },
];
const CAR = [
  { id: 'gas', label: 'GAS', pedal: 1, cls: 'pedal gas' },
  { id: 'brake', label: 'BRAKE', pedal: -1, cls: 'pedal brake' },
  { id: 'hand', label: 'DRIFT', keys: ['Space'] },
  { id: 'horn', label: '📯', keys: ['KeyH'] },
  { id: 'exit', label: 'EXIT', keys: ['ShiftLeft', 'KeyE'] },
  { id: 'use', label: 'E', keys: ['KeyE'], cls: 'big' },
  { id: 'cam', label: '🎥', keys: ['KeyC'] },
  { id: 'lights', label: '💡', keys: ['KeyL'] },
  { id: 'radio', label: '📻', keys: ['KeyR'] },
];

export class TouchControls {
  static wanted() {
    try {
      if (/[?&]touch=1\b/.test(location.search)) return true;
      return matchMedia('(pointer: coarse)').matches && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
    } catch (e) { return false; }
  }

  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.input.noLock = true;
    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    root.innerHTML = `<div class="t-look" id="t-look"></div>
      <div class="t-stick-zone" id="t-zone"><div class="t-stick" id="t-stick"><div class="t-knob" id="t-knob"></div></div></div>
      <button class="t-btn t-pause" id="t-pause" aria-label="Pause">❚❚</button>
      <div class="t-pad t-foot" id="t-foot">${FOOT.map(this._btn).join('')}</div>
      <div class="t-pad t-car" id="t-car">${CAR.map(this._btn).join('')}</div>`;
    document.body.appendChild(root);
    document.body.classList.add('touch-ui');
    this._stick();
    this._look();
    for (const def of [...FOOT, ...CAR]) {
      for (const el of root.querySelectorAll(`[data-id="${def.id}"]`)) this._bind(el, def);
    }
    root.querySelector('#t-pause').addEventListener('pointerdown', (e) => { e.preventDefault(); this.input.onPause && this.input.onPause(); });
  }

  _btn(d) { return `<button class="t-btn ${d.cls || ''}" data-id="${d.id}">${d.label}</button>`; }

  _bind(el, def) {
    const on = (e) => {
      e.preventDefault();
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      el.classList.add('on');
      if (def.pedal) this.input.touchPedal = def.pedal;
      else def.keys.forEach((k) => this.input.touchKeys.add(k));
    };
    const off = () => {
      el.classList.remove('on');
      if (def.pedal) { if (this.input.touchPedal === def.pedal) this.input.touchPedal = 0; }
      else def.keys.forEach((k) => this.input.touchKeys.delete(k));
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('lostpointercapture', off);
  }

  /** Floating joystick: it re-centres wherever the thumb lands inside the left zone. */
  _stick() {
    const zone = this.root.querySelector('#t-zone'), stick = this.root.querySelector('#t-stick'), knob = this.root.querySelector('#t-knob');
    const R = 56;
    let id = null, cx = 0, cy = 0;
    const set = (dx, dy) => {
      const d = Math.hypot(dx, dy), k = d > R ? R / d : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      // x is "left" positive in the game's axis convention; y forward = thumb up
      this.input.touchMove.x = -(dx * k) / R;
      this.input.touchMove.y = -(dy * k) / R;
    };
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId; zone.setPointerCapture(id);
      const r = zone.getBoundingClientRect();
      cx = e.clientX; cy = e.clientY;
      stick.style.left = `${cx - r.left - 70}px`; stick.style.top = `${cy - r.top - 70}px`;
      stick.classList.add('on');
      set(0, 0);
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e.clientX - cx, e.clientY - cy); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; stick.classList.remove('on'); set(0, 0); stick.style.left = ''; stick.style.top = ''; };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  /** Drag on the right half to orbit the camera (mouse-look). */
  _look() {
    const el = this.root.querySelector('#t-look');
    let id = null, lx = 0, ly = 0;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; el.setPointerCapture(id); lx = e.clientX; ly = e.clientY; });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      this.input.mouseDX += (e.clientX - lx) * 1.6;
      this.input.mouseDY += (e.clientY - ly) * 1.2;
      lx = e.clientX; ly = e.clientY;
    });
    const end = (e) => { if (e.pointerId === id) id = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  update() {
    const g = this.game;
    const car = !!(g.player && g.player.vehicle);
    this.root.classList.toggle('in-car', car);
    this.root.classList.toggle('hidden', g.mode !== 'play');
    // nothing stays held across a mode change (pause, kiosk, cut-scene)
    if (g.mode !== 'play' && (this.input.touchKeys.size || this.input.touchPedal || this.input.touchMove.x || this.input.touchMove.y)) {
      this.input.touchKeys.clear(); this.input.touchPedal = 0; this.input.touchMove.x = this.input.touchMove.y = 0;
      this.root.querySelectorAll('.on').forEach((b) => b.classList.remove('on'));
    }
  }
}
