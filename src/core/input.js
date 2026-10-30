// Keyboard / mouse state with pointer lock, plus gamepad and touch (Phase 4).
// CRITICAL: whenever pointer lock is released (Escape), the window blurs or the tab hides,
// every held key is cleared so the player can never get stuck auto-walking/driving.
//
// Gamepads and the touch overlay (ui/touch.js) feed the same API the game already reads: virtual key codes for
// buttons (down/pressed), analog movement for axis('KeyS','KeyW') / axis('KeyD','KeyA'), and mouseDX/DY for looking.
// Standard-mapping pad: left stick move/steer · right stick look · RT/LT throttle & brake in a car, fire & aim on foot
// A interact (E) · B exit car (Shift+E) · X jump/handbrake · Y camera (C) · LB radio/reload (R) · RB horn (H)
// D-pad: up lights (L) · down station cam (V) · left drop (G) · right follow cam (F) · L3 sprint · R3 fast-forward (T)
// Back: waypoint guide (N) · Start: pause.
const PAD_MAP = [[0, ['KeyE']], [1, ['ShiftLeft', 'KeyE']], [2, ['Space']], [3, ['KeyC']], [4, ['KeyR']], [5, ['KeyH']], [8, ['KeyN']],
  [10, ['ShiftLeft']], [11, ['KeyT']], [12, ['KeyL']], [13, ['KeyV']], [14, ['KeyG']], [15, ['KeyF']]];
const dead = (v, z = 0.18) => (Math.abs(v) < z ? 0 : (v - Math.sign(v) * z) / (1 - z));

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.virtual = new Set();     // buttons held on a gamepad / the touch overlay
    this._virtualPrev = new Set();
    this.touchKeys = new Set();   // written by ui/touch.js
    this.touchMove = { x: 0, y: 0 }; // touch joystick: x = left, y = forward, -1..1
    this.touchPedal = 0;          // touch gas (+1) / brake (-1)
    this.move = { x: 0, y: 0 };   // combined analog movement this frame
    this.triggers = 0;            // pad RT - LT
    this.context = 'foot';        // 'foot' | 'car', set by the game each frame (triggers mean different things)
    this.pad = { connected: false, id: '' };
    this.onPause = null;
    this.keys = new Set();
    this.justPressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.mouseDown = false;
    this.locked = false;
    this.enabled = true;
    this.onUnlock = null;
    this.onLock = null;
    this.clearCount = 0;

    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab', 'Backspace'].includes(e.code)) e.preventDefault();
      if (!this.enabled) return;
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    addEventListener('blur', () => this.clearAll('blur'));
    document.addEventListener('visibilitychange', () => document.hidden && this.clearAll('hidden'));
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (was && !this.locked) {
        this.clearAll('unlock');
        this.onUnlock && this.onUnlock();
      }
      if (!was && this.locked) this.onLock && this.onLock();
    });
    addEventListener('mousemove', (e) => {
      if (this.locked || this.mouseDown) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      }
    });
    // mouse buttons: 0 = left (fire), 2 = right (aim)
    this.buttons = new Set();
    canvas.addEventListener('mousedown', (e) => { this.mouseDown = true; this.buttons.add(e.button); });
    addEventListener('mouseup', (e) => { this.mouseDown = false; this.buttons.delete(e.button); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
  }

  /** Drop every held key and pending mouse delta (the "stuck walking" fix). */
  clearAll(reason = 'manual') {
    this.keys.clear();
    this.justPressed.clear();
    // a button still physically held after the clear must not re-fire as a fresh press next frame
    this._virtualPrev = new Set(this.virtual);
    this.mouseDX = this.mouseDY = 0;
    this.mouseDown = false;
    if (this.buttons) this.buttons.clear();
    this.clearCount++;
    this.lastClearReason = reason;
  }

  lock() {
    // the touch overlay needs the pointer: with pointer lock every event would go to the canvas instead
    if (this.noLock) return;
    if (!this.locked && this.canvas.requestPointerLock) {
      try {
        const p = this.canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* headless */ }
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Once per frame before the game reads input: gamepad + touch -> virtual keys, analog movement, look deltas. */
  poll(dt) {
    const held = new Set(this.touchKeys);
    let mx = this.touchMove.x, my = this.touchMove.y;
    this.triggers = 0;
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find((p) => p && p.connected);
    this.pad.connected = !!gp;
    if (gp) {
      this.pad.id = gp.id;
      const btn = (i) => !!gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5);
      const val = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
      mx += -dead(gp.axes[0] || 0);
      my += -dead(gp.axes[1] || 0);
      // right stick looks around (scaled to feel like a mouse at ~60 fps)
      this.mouseDX += dead(gp.axes[2] || 0) * 900 * dt;
      this.mouseDY += dead(gp.axes[3] || 0) * 650 * dt;
      const rt = val(7), lt = val(6);
      if (this.context === 'car') this.triggers = rt - lt;
      else { if (rt > 0.5) held.add('Mouse0'); if (lt > 0.5) held.add('Mouse2'); }
      for (const [i, codes] of PAD_MAP) if (btn(i)) codes.forEach((c) => held.add(c));
      if (btn(9) && !this._startWas && this.onPause) this.onPause();
      this._startWas = btn(9);
      // strong stick deflections also read as arrow keys for menus/mini-games that poll keys (the arcade cabinet)
      if (mx > 0.6) held.add('ArrowLeft'); if (mx < -0.6) held.add('ArrowRight');
    }
    this.move.x = Math.max(-1, Math.min(1, mx));
    this.move.y = Math.max(-1, Math.min(1, my));
    for (const c of held) if (!this._virtualPrev.has(c) && this.enabled) this.justPressed.add(c);
    this._virtualPrev = held;
    this.virtual = held;
  }

  down(code) { return this.keys.has(code) || this.virtual.has(code); }
  mouseDown1() { return (this.buttons.has(0) && this.locked) || this.virtual.has('Mouse0'); }
  mouseDown2() { return this.buttons.has(2) || this.keys.has('KeyQ') || this.virtual.has('Mouse2'); }
  pressed(code) { return this.justPressed.has(code); }
  /** Digital keys win; otherwise movement pairs read the analog sticks / touch joystick (and triggers / pedals in a car). */
  axis(neg, pos) {
    const digital = (this.down(pos) ? 1 : 0) - (this.down(neg) ? 1 : 0);
    if (digital) return digital;
    if (neg === 'KeyS' && pos === 'KeyW') return Math.max(-1, Math.min(1, this.move.y + (this.context === 'car' ? this.triggers + this.touchPedal : 0)));
    if (neg === 'KeyD' && pos === 'KeyA') return this.move.x;
    return 0;
  }

  endFrame() {
    this.justPressed.clear();
    this.mouseDX = this.mouseDY = 0;
    this.wheel = 0;
  }
}
