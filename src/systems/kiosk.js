import * as THREE from 'three';
import { BODIES, SWATCHES, FINISHES, LIVERIES, RIMS, TIRE_LETTERING, CALIPERS, FRONT_KITS, HOODS, ROOFS, SPOILERS, EXHAUSTS,
  UNDERGLOW, ENGINES, TRANSMISSIONS, TIRES, DEFAULT_CONFIG, configPrice, LAYOUT } from '../config.js';
import { CarVisual } from '../vehicle/carVisual.js';

const $ = (id) => document.getElementById(id);
const money = (v) => '$' + Math.round(v).toLocaleString();

/**
 * 3D turntable configurator. mode 'order' builds a new car in the lobby; mode 'bay' restyles the
 * vehicle parked in the Custom Bay (repaint + parts + clears stolen/heat status).
 */
export class Kiosk {
  constructor(game, factory) {
    this.game = game;
    this.f = factory;
    this.cfg = { ...DEFAULT_CONFIG };
    this.tab = 'Body';
    this.isOpen = false;
    this.yaw = 0.8; this.pitch = 0.25; this.dist = 8.5;
    $('k-cancel').onclick = () => this.close();
    $('k-order').onclick = () => this.confirm();
    $('k-random').onclick = () => this.randomize();
    this.changes = 0;
  }

  get unlocked() { return this.game.state.monsterMash; }

  open(mode = 'order', vehicle = null) {
    this.mode = mode;
    this.vehicle = vehicle;
    this.isOpen = true;
    this.game.input.unlock();
    this.game.input.clearAll('kiosk');
    if (mode === 'order') {
      this.center = new THREE.Vector3(...LAYOUT.kioskTurntable);
      this._rebuildPreview();
      $('k-title').textContent = 'MOTORWORKS CONFIGURATOR';
      $('k-order').textContent = 'Place Order';
      this.game.say('kiosk_welcome');
    } else {
      this.original = { ...vehicle.visual.cfg };
      this.cfg = { ...vehicle.visual.cfg };
      this.center = vehicle.visual.root.position.clone();
      $('k-title').textContent = 'CUSTOM BAY · PAINT SHOP';
      $('k-order').textContent = 'Respray & Apply';
      this.game.say('kiosk_bay');
      if (this.tab === 'Body' || this.tab === 'Performance') this.tab = 'Paint';
    }
    $('kiosk').classList.remove('hidden');
    this.render();
  }

  close(applied = false) {
    if (!this.isOpen) return;
    this.isOpen = false;
    $('kiosk').classList.add('hidden');
    if (this.preview) { this.preview.dispose(); this.preview = null; }
    if (this.mode === 'bay' && !applied && this.vehicle) this.vehicle.visual.applyConfig(this.original);
    this.game.onKioskClosed(this.mode, applied);
  }

  _rebuildPreview() {
    if (this.preview) this.preview.dispose();
    this.preview = new CarVisual(this.game.assets, this.cfg, { withLights: true });
    this.game.scene.add(this.preview.root);
    this.preview.root.position.copy(this.center).add(new THREE.Vector3(0, 0.35, 0));
    this.previewBody = this.cfg.body;
  }

  set(key, value) {
    this.cfg[key] = value;
    this.changes++;
    if (this.mode === 'order') {
      if (key === 'body' && value !== this.previewBody) this._rebuildPreview();
      else this.preview.applyConfig(this.cfg);
      if (['hood', 'engine'].includes(key)) this.showHoodTimer = 2.5;
      if (key === 'body') this.showDoorsTimer = 2;
    } else {
      this.vehicle.visual.applyConfig(this.cfg);
    }
    this.game.audio.blip(900, 0.03);
    this.render();
  }

  randomize() {
    const r = (a) => a[Math.floor(Math.random() * a.length)];
    const ok = (list) => list.filter((x) => !x.locked || this.unlocked);
    const c = {
      body: this.mode === 'order' ? r(BODIES).id : this.cfg.body, color: r(SWATCHES), color2: r(SWATCHES), finish: r(FINISHES).id, livery: r(ok(LIVERIES)).id,
      rim: r(ok(RIMS)).id, lettering: r(TIRE_LETTERING).id, caliper: r(CALIPERS), ride: r([-1, -0.5, 0, 0.5, 1]), camber: r([0, 0, 3, 6]),
      front: r(FRONT_KITS).id, hood: r(ok(HOODS)).id, roof: r(ROOFS).id, spoiler: r(SPOILERS).id, exhaust: r(ok(EXHAUSTS)).id,
      underglow: r(UNDERGLOW).id, engine: this.mode === 'order' ? r(ENGINES).id : this.cfg.engine, trans: r(TRANSMISSIONS).id, tires: r(TIRES).id,
    };
    for (const k of Object.keys(c)) this.cfg[k] = c[k];
    if (this.mode === 'order') { this.preview.dispose(); this.preview = null; this._rebuildPreview(); } else this.vehicle.visual.applyConfig(this.cfg);
    this.render();
  }

  price() {
    if (this.mode === 'order') return configPrice(this.cfg);
    // bay: paint + parts delta only
    return Math.max(450, Math.round((configPrice(this.cfg) - configPrice({ ...this.original, ...{ finish: 'gloss', livery: 'none' } })) * 0.35 + 450));
  }

  confirm() {
    const cost = this.price();
    if (this.game.state.money < cost) { this.game.hud.toast(`Not enough cash (${money(cost)})`, 'bad'); this.game.audio.sting(true); return; }
    this.game.state.money -= cost;
    if (this.mode === 'order') {
      this.game.say('kiosk_order');
      const cfg = { ...this.cfg };
      this.close(true);
      this.game.startOrder(cfg);
    } else {
      const v = this.vehicle;
      this.close(true);
      this.game.finishRespray(v, { ...this.cfg });
    }
  }

  // ------------------------------------------------------------------ UI
  _opts(key, list, render = (o) => `${o.name}<small>${o.price ? '+' + money(o.price) : 'included'}</small>`) {
    return `<div class="opts">${list.map((o) => {
      const locked = o.locked && !this.unlocked;
      return `<button class="opt ${this.cfg[key] === o.id ? 'on' : ''} ${locked ? 'locked' : ''}" data-k="${key}" data-v="${o.id}" ${locked ? 'disabled' : ''}>${locked ? '🔒 ' : ''}${render(o)}${locked ? '<small>Find all 5 golden pumpkins</small>' : ''}</button>`;
    }).join('')}</div>`;
  }

  _swatches(key, list) {
    return `<div class="swatches">${list.map((c) => `<span class="sw ${this.cfg[key] === c ? 'on' : ''}" style="background:${c}" data-k="${key}" data-v="${c}"></span>`).join('')}
      <input type="color" value="${this.cfg[key]}" data-k="${key}" data-input="1" /></div>`;
  }

  _group(title, html) { return `<div class="k-group"><h4>${title}</h4>${html}</div>`; }

  render() {
    const tabs = ['Body', 'Paint', 'Livery', 'Wheels', 'Stance', 'Body Kit', 'Lighting', 'Performance', 'Monster Mash'];
    $('k-tabs').innerHTML = tabs.map((t) => {
      const dis = this.mode === 'bay' && (t === 'Body' || t === 'Performance');
      return `<button class="${this.tab === t ? 'on' : ''}" data-tab="${t}" ${dis ? 'disabled style="opacity:.35"' : ''}>${t}</button>`;
    }).join('');
    let html = '';
    const c = this.cfg;
    switch (this.tab) {
      case 'Body': html = this._group('Chassis / Body Archetype', this._opts('body', BODIES, (o) => `${o.name}<small>${money(o.price)}</small>`)); break;
      case 'Paint':
        html = this._group('Primary Color', this._swatches('color', SWATCHES)) + this._group('Secondary / Livery Color', this._swatches('color2', SWATCHES)) +
          this._group('Finish', this._opts('finish', FINISHES));
        break;
      case 'Livery': html = this._group('Decals & Liveries', this._opts('livery', LIVERIES)); break;
      case 'Wheels':
        html = this._group('Rims', this._opts('rim', RIMS)) + this._group('Tire Wall Lettering', this._opts('lettering', TIRE_LETTERING)) +
          this._group('Brake Calipers', this._swatches('caliper', CALIPERS));
        break;
      case 'Stance':
        html = this._group('Ride Height', `<div class="slider-row"><input type="range" min="-1" max="1" step="0.25" value="${c.ride}" data-k="ride" data-num="1" /><span>${c.ride < 0 ? 'Slammed' : c.ride > 0 ? 'Lifted' : 'Stock'} (${c.ride > 0 ? '+' : ''}${Math.round(c.ride * (c.ride < 0 ? 12 : 20))} cm)</span></div>`) +
          this._group('Wheel Camber', `<div class="slider-row"><input type="range" min="0" max="10" step="1" value="${c.camber}" data-k="camber" data-num="1" /><span>-${c.camber}°</span></div>`);
        break;
      case 'Body Kit':
        html = this._group('Front', this._opts('front', FRONT_KITS)) + this._group('Hood', this._opts('hood', HOODS)) + this._group('Roof', this._opts('roof', ROOFS)) +
          this._group('Rear Spoiler', this._opts('spoiler', SPOILERS)) + this._group('Exhaust', this._opts('exhaust', EXHAUSTS));
        break;
      case 'Lighting': html = this._group('Underglow Neon', this._opts('underglow', UNDERGLOW, (o) => `<span style="color:${o.color || '#888'}">●</span> ${o.name}<small>${o.price ? '+' + money(o.price) : ''}</small>`)); break;
      case 'Performance': {
        const e = ENGINES.find((x) => x.id === c.engine), tr = TRANSMISSIONS.find((x) => x.id === c.trans), ti = TIRES.find((x) => x.id === c.tires);
        const bar = (label, v) => { const n = Math.round(Math.max(0, Math.min(1, v)) * 10); return `<div class="slider-row"><span>${label}</span><span>${'█'.repeat(n)}${'░'.repeat(10 - n)}</span></div>`; };
        html = this._group('Engine Stage', this._opts('engine', ENGINES)) + this._group('Transmission Gearing', this._opts('trans', TRANSMISSIONS)) +
          this._group('Tire Compound', this._opts('tires', TIRES)) +
          this._group('Projected Performance', bar('Power', e.force * tr.accel / 5000) + bar('Top speed', e.top * tr.top / 74) + bar('Grip', ti.rearFriction / 3.4) + bar('Drift', 1 - ti.rearFriction / 3.4 + 0.3));
        break;
      }
      case 'Monster Mash':
        html = this.unlocked
          ? this._group('🧟 Monster Mash Pack — UNLOCKED', '<p class="hint">Glowing jack-o\'-lantern rims, Frankenstein blower, green lightning exhaust and livery are now in their tabs.</p>' +
            this._opts('rim', RIMS.filter((r) => r.locked)) + this._opts('hood', HOODS.filter((r) => r.locked)) + this._opts('exhaust', EXHAUSTS.filter((r) => r.locked)) + this._opts('livery', LIVERIES.filter((r) => r.locked)))
          : this._group('🔒 Monster Mash Pack', `<p>Find all <b>5 hidden Golden Pumpkins</b> around town to unlock glowing jack-o'-lantern rims, the Frankenstein blower and green lightning exhaust.</p><p class="hint">Found: ${this.game.state.pumpkins.length}/5</p>`);
        break;
    }
    $('k-body').innerHTML = html;
    $('k-total').textContent = money(this.price());
    $('k-sub').textContent = this.mode === 'order' ? `Budget ${money(this.game.state.money)} · drag to orbit · scroll to zoom` : `Respray clears stolen status & police heat · ${money(this.game.state.money)}`;
    $('k-tabs').querySelectorAll('button').forEach((b) => (b.onclick = () => { this.tab = b.dataset.tab; this.render(); }));
    $('k-body').querySelectorAll('[data-k]').forEach((el) => {
      const k = el.dataset.k;
      if (el.dataset.input) el.oninput = () => this.set(k, el.value);
      else if (el.dataset.num) el.oninput = () => this.set(k, parseFloat(el.value));
      else el.onclick = () => !el.disabled && this.set(k, el.dataset.v);
    });
  }

  // ------------------------------------------------------------------ camera
  update(dt, input, camera) {
    if (!this.isOpen) return;
    if (input.mouseDown) { this.yaw -= input.mouseDX * 0.006; this.pitch = THREE.MathUtils.clamp(this.pitch + input.mouseDY * 0.004, 0.02, 1.1); }
    else this.yaw += dt * 0.12;
    this.dist = THREE.MathUtils.clamp(this.dist + input.wheel * 0.6, 4.5, 14);
    const c = this.center.clone().add(new THREE.Vector3(0, 0.9, 0));
    const desired = new THREE.Vector3(c.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist, c.y + Math.sin(this.pitch) * this.dist, c.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist);
    camera.position.copy(this.game.rig._collide(c, desired)); // never orbit through the lobby walls
    camera.lookAt(c);
    if (this.preview) {
      this.preview.root.rotation.y = this.f.turntableTop.rotation.y;
      this.showHoodTimer = Math.max(0, (this.showHoodTimer || 0) - dt);
      this.showDoorsTimer = Math.max(0, (this.showDoorsTimer || 0) - dt);
      this.preview.setHinge('Hood', this.showHoodTimer > 0 ? 1 : 0);
      ['Door_L', 'Door_R'].forEach((h) => this.preview.setHinge(h, this.showDoorsTimer > 0 ? 1 : 0));
      this.preview.update(dt, { rpm: 1200 + Math.sin(performance.now() / 300) * 400, showEngine: this.showHoodTimer > 0 });
    } else if (this.vehicle) {
      this.vehicle.visual.update(dt, { rpm: 900 });
    }
  }
}
