// Keyboard / mouse state with pointer lock.
// CRITICAL: whenever pointer lock is released (Escape), the window blurs or the tab hides,
// every held key is cleared so the player can never get stuck auto-walking/driving.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
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
    canvas.addEventListener('mousedown', () => (this.mouseDown = true));
    addEventListener('mouseup', () => (this.mouseDown = false));
    addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
  }

  /** Drop every held key and pending mouse delta (the "stuck walking" fix). */
  clearAll(reason = 'manual') {
    this.keys.clear();
    this.justPressed.clear();
    this.mouseDX = this.mouseDY = 0;
    this.mouseDown = false;
    this.clearCount++;
    this.lastClearReason = reason;
  }

  lock() {
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

  down(code) { return this.keys.has(code); }
  pressed(code) { return this.justPressed.has(code); }
  axis(neg, pos) { return (this.down(pos) ? 1 : 0) - (this.down(neg) ? 1 : 0); }

  endFrame() {
    this.justPressed.clear();
    this.mouseDX = this.mouseDY = 0;
    this.wheel = 0;
  }
}
