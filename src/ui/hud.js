import * as THREE from 'three';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = $('hud');
    this.mini = $('minimap').getContext('2d');
    this.bubbles = [];
    this.units = 'mph';
    $('wanted').innerHTML = Array.from({ length: 5 }, () => '<span class="skull">💀</span>').join('');
    this.skulls = [...document.querySelectorAll('#wanted .skull')];
    this.subTimer = 0;
    this._v = new THREE.Vector3();
    this.radio(null);
  }

  show(on) { this.el.classList.toggle('hidden', !on); }

  money(v) { $('hud-money').textContent = '$' + Math.round(v).toLocaleString(); }
  pumpkins(n) { $('hud-pumpkins').textContent = `${n}/5`; }
  radio(name) { $('hud-radio').textContent = name ? '📻 ' + name : ''; $('hud-radio').classList.toggle('hidden', !name); }

  prompt(text) {
    const p = $('prompt');
    if (!text) { p.classList.add('hidden'); return; }
    p.innerHTML = text.replace(/\[(\w+)\]/g, '<kbd>$1</kbd>');
    p.classList.remove('hidden');
  }

  toast(text, kind = '', ms = 2600) {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = text;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  objective(text) {
    $('hud-objective').classList.toggle('hidden', !text);
    $('obj-text').textContent = text || '';
  }

  waypoint(target, camera, playerPos) {
    const arrow = $('obj-arrow'), dist = $('obj-dist');
    if (!target) { arrow.style.visibility = 'hidden'; dist.textContent = ''; return; }
    arrow.style.visibility = 'visible';
    const d = Math.hypot(target.x - playerPos.x, target.z - playerPos.z);
    dist.textContent = `${Math.round(d)} m`;
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const camYaw = Math.atan2(dir.x, dir.z);
    const tYaw = Math.atan2(target.x - playerPos.x, target.z - playerPos.z);
    const rel = camYaw - tYaw;
    arrow.style.transform = `rotate(${-Math.PI / 2 + rel}rad)`;
  }

  wanted(level, flash) {
    this.skulls.forEach((s, i) => s.classList.toggle('on', i < level));
    $('wanted').classList.toggle('flash', !!flash && level > 0);
  }

  speedo(on, speed = 0, gear = 1, rpmFrac = 0) {
    $('speedo').classList.toggle('hidden', !on);
    if (!on) return;
    const v = Math.abs(speed) * (this.units === 'mph' ? 2.237 : 3.6);
    $('spd-val').textContent = Math.round(v);
    document.querySelector('#speedo .unit').textContent = this.units === 'mph' ? 'MPH' : 'KM/H';
    $('spd-gear').textContent = gear <= 0 ? (speed < -0.5 ? 'R' : 'N') : gear;
    $('spd-rpm').style.width = Math.round(Math.min(1, rpmFrac) * 100) + '%';
  }

  order(o) {
    const p = $('order-panel');
    if (!o) { p.classList.add('hidden'); return; }
    p.classList.remove('hidden');
    $('order-no').textContent = '#' + o.number;
    $('order-car').textContent = o.label;
    $('order-stations').innerHTML = o.stations.map((s, i) => `<div class="${i < o.stage ? 'done' : i === o.stage ? 'active' : ''}"><span>${i + 1}. ${s}</span><span>${i < o.stage ? '✔' : i === o.stage ? Math.round(o.stageT * 100) + '%' : ''}</span></div>`).join('');
    $('order-bar').style.width = Math.round(o.total * 100) + '%';
  }

  trial(html) {
    const p = $('trial-panel');
    p.classList.toggle('hidden', !html);
    if (html) p.innerHTML = html;
  }

  bust(frac) {
    $('bust-meter').classList.toggle('hidden', !(frac > 0));
    $('bust-fill').style.width = Math.round(frac * 100) + '%';
  }

  subtitle(name, text, dur) {
    $('sub-name').textContent = name + ':';
    $('sub-text').textContent = text;
    $('subtitle').classList.remove('hidden');
    this.subTimer = dur + 0.6;
  }

  bubble(actor, name, text, dur) {
    this.bubbles.forEach((b) => b.el.remove());
    const el = document.createElement('div');
    el.className = 'bubble';
    el.innerHTML = `<b>${name}</b>${text}`;
    $('bubbles').appendChild(el);
    this.bubbles = [{ el, actor, t: dur + 0.6 }];
  }

  flash(color = '#fff', a = 0.6) {
    const f = $('flash');
    f.style.background = color;
    f.style.transition = 'none';
    f.style.opacity = a;
    requestAnimationFrame(() => { f.style.transition = 'opacity .5s'; f.style.opacity = 0; });
  }

  update(dt, camera) {
    if (this.subTimer > 0) {
      this.subTimer -= dt;
      if (this.subTimer <= 0) $('subtitle').classList.add('hidden');
    }
    const w = innerWidth, h = innerHeight;
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.t -= dt;
      if (b.t <= 0 || !b.actor) { b.el.remove(); this.bubbles.splice(i, 1); continue; }
      const p = b.actor.headPos ? b.actor.headPos(this._v) : this._v.copy(b.actor.position || b.actor);
      p.project(camera);
      const vis = p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2;
      b.el.style.display = vis ? 'block' : 'none';
      b.el.style.left = ((p.x + 1) / 2) * w + 'px';
      b.el.style.top = ((1 - p.y) / 2) * h + 'px';
    }
  }

  /** Rotating minimap centred on the player. */
  minimap(center, yaw, layers) {
    const g = this.mini, S = 220, scale = 0.62;
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, 7); g.clip();
    g.fillStyle = '#1a0f1c'; g.fillRect(0, 0, S, S);
    g.translate(S / 2, S / 2);
    g.rotate(yaw + Math.PI);
    g.scale(scale, scale);
    g.translate(-center.x, -center.z);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const r of layers.roads) {
      g.strokeStyle = r.kind === 'gravel' ? '#5a4e44' : '#4b4652';
      g.lineWidth = r.width;
      g.beginPath();
      r.line.forEach((p, i) => (i ? g.lineTo(p.x, p.z) : g.moveTo(p.x, p.z)));
      g.stroke();
    }
    g.fillStyle = '#6a3a2a';
    for (const b of layers.buildings) g.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
    g.fillStyle = '#2a3b2a';
    const c = layers.cemetery;
    g.strokeStyle = '#6b8b6b'; g.lineWidth = 2; g.strokeRect(c.x0, c.z0, c.x1 - c.x0, c.z1 - c.z0);
    for (const m of layers.markers) {
      g.fillStyle = m.color;
      g.beginPath(); g.arc(m.x, m.z, m.r || 4, 0, 7); g.fill();
    }
    g.restore();
    // player arrow (always up)
    g.fillStyle = '#ffb000';
    g.beginPath(); g.moveTo(S / 2, S / 2 - 9); g.lineTo(S / 2 + 6, S / 2 + 6); g.lineTo(S / 2, S / 2 + 2); g.lineTo(S / 2 - 6, S / 2 + 6); g.fill();
    if (layers.target) {
      const dx = layers.target.x - center.x, dz = layers.target.z - center.z;
      const a = Math.atan2(dz, dx) + yaw + Math.PI;
      const d = Math.min(Math.hypot(dx, dz) * scale, S / 2 - 8);
      g.fillStyle = '#39ff14';
      g.beginPath(); g.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 5, 0, 7); g.fill();
    }
  }
}
