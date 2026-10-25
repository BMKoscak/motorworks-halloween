import * as THREE from 'three';
import { makePerson } from '../data/demographics.js';
import { terrainHeight } from '../world/terrain.js';
import { bakeProp } from '../world/buildings.js';

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };

export const SECRETS = {
  time88: { name: 'Eighty-Eight', hint: 'Some say a car can outrun time on the Proving Ground.' },
  konami: { name: 'Big Heads', hint: 'An old cheat still works on the pause-less night.' },
  clock13: { name: 'Thirteen Bells', hint: 'The town-square clock has one strike too many.' },
  intermission: { name: 'Intermission', hint: 'Impatient drive-in patrons honk… a lot.' },
  projectionist: { name: 'The Projectionist', hint: 'Someone still runs the Palace projector.' },
  stinger: { name: 'Post-Credits', hint: 'Always stay until after the credits.' },
  bigfoot: { name: 'Sasquatch Sighting', hint: 'Something big lives in the woods by the water tower.' },
  ufo: { name: 'Close Encounter', hint: 'The HOLLOW water tower makes a great target.' },
  payphone: { name: 'Wrong Number', hint: 'The payphone at the gas station rings for you.' },
  devroom: { name: 'Developers\' Room', hint: 'A loose brick wall in a Motorworks tool crib.' },
};

/**
 * Easter eggs: an 88-mph flux event, the Konami code (big-head mode), thirteen bells from the clocktower, the drive-in
 * intermission and the cinema ghost (counted by the Cinema), a Bigfoot sighting, a UFO you summon by shooting the water
 * tower, the haunted payphone and the developers' room behind the loose brick wall. Found secrets persist in localStorage.
 */
export class Secrets {
  constructor(game) {
    this.game = game;
    this.found = new Set(load('mw_secrets', []));
    this.konamiSeq = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
    this.keyBuf = [];
    this.towerHits = 0;
    this.bigHeads = false;
    this.stats = { events: 0 };
    addEventListener('keydown', (e) => this._key(e.code));
  }

  count() { return this.found.size; }
  total() { return Object.keys(SECRETS).length; }

  find(id) {
    if (this.found.has(id) || !SECRETS[id]) return false;
    this.found.add(id);
    store('mw_secrets', [...this.found]);
    const g = this.game;
    g.audio.chime && g.audio.chime();
    g.hud.toast(`🥚 SECRET FOUND: ${SECRETS[id].name} (${this.found.size}/${this.total()})`, 'good', 5000);
    g.events.emit('secret', { id, n: this.found.size });
    this._renderList();
    return true;
  }

  build() {
    const g = this.game, town = g.town;
    // haunted payphone beside the gas mart
    const gas = g.buildings.list.find((b) => b.kind === 'gas');
    const pp = gas ? gas.obj.position.clone().add(new THREE.Vector3(-10.5, 0, -8.5)) : new THREE.Vector3(34, 0, 16);
    const phone = g.assets.part('props', 'Payphone');
    phone.position.set(pp.x, terrainHeight(pp.x, pp.z), pp.z);
    phone.rotation.y = Math.PI;
    g.scene.add(phone);
    phone.updateMatrixWorld(true);
    g.physics.collidersFrom(phone);
    bakeProp(phone);
    this.phone = { pos: phone.position.clone(), ringT: 8, ringing: false, idx: 0 };
    // clocktower plaque (town square)
    this.clock = new THREE.Vector3(-22, 0, 23);
    // water tower tank (shootable sphere) + the saucer
    this.tower = { center: new THREE.Vector3(-155, 9.6, -92), r: 2.4 };
    const ufo = g.assets.part('props', 'UFO');
    ufo.visible = false;
    ufo.traverse((o) => { if (o.isMesh && o.material && /FX_UFOBeam/.test(o.material.name)) { o.material = new THREE.MeshBasicMaterial({ color: '#7dff8a', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }); this.ufoBeam = o; } });
    g.scene.add(ufo);
    this.ufo = { obj: ufo, t: -1 };
    // bigfoot: a tall shaggy figure in the woods south-west of the water tower
    const bf = makePerson(g.assets, 'adult_male', 'bigfoot', { variant: { shirt: '#3b2416', pants: '#3b2416', hair: '#2a180c', skin: '#3b2416', acc: ['Beard'] }, noBake: true });
    bf.root.scale.setScalar(1.45);
    this.bigfoot = { char: bf, home: new THREE.Vector3(-178, 0, -118), state: 'idle', t: 0 };
    bf.root.position.set(-178, terrainHeight(-178, -118), -118);
    g.scene.add(bf.root);
    // developers' room door inside tool crib 0
    this.devDoor = g.factory.building.doors.Door_Secret || null;
    this.devSpot = g.factory.building.spots.Secret || null;
    this._renderList();
  }

  _key(code) {
    if (this.game.mode !== 'play' && this.game.mode !== 'title') return;
    this.keyBuf.push(code);
    if (this.keyBuf.length > this.konamiSeq.length) this.keyBuf.shift();
    if (this.keyBuf.join() === this.konamiSeq.join()) { this.keyBuf = []; this.toggleBigHeads(); }
  }

  toggleBigHeads() {
    const g = this.game;
    this.bigHeads = !this.bigHeads;
    const s = this.bigHeads ? 1.9 : 1;
    const heads = [];
    g.scene.traverse((o) => { if (o.name === 'Head' && o.parent && /Neck|Torso|Spine/.test(o.parent.name || '')) heads.push(o); });
    for (const h of heads) h.scale.setScalar(s);
    this.headCount = heads.length;
    if (this.bigHeads) { g.say('konami'); this.find('konami'); }
    g.hud.toast(this.bigHeads ? '🗿 BIG HEAD MODE' : 'Heads back to normal', 'good');
    g.events.emit('bigHeads', { on: this.bigHeads, heads: heads.length });
  }

  candidates(pos) {
    const out = [];
    if (this.phone && this.phone.ringing && pos.distanceTo(this.phone.pos) < 2.2) out.push({ d: 0.2, text: '[E] Answer the ringing payphone', act: () => this.answer() });
    if (this.clock && Math.hypot(pos.x - this.clock.x, pos.z - (this.clock.z + 2.4)) < 2.4 && !(this.bells > 0)) out.push({ d: 0.5, text: '[E] Pull the old bell rope', act: () => this.ringBells() });
    if (this.devDoor && this.devDoor.target < 0.5 && Math.hypot(pos.x - this.devDoor.center.x, pos.z - this.devDoor.center.z) < 1.9) out.push({ d: 0.1, text: '[E] Push the loose brick wall…', act: () => this.game.buildings.toggleDoor(this.devDoor, true) });
    return out;
  }

  answer() {
    const g = this.game, p = this.phone;
    p.ringing = false; p.ringT = 40;
    g.audio.click();
    g.say(p.idx++ % 2 ? 'payphone_2' : 'payphone_1');
    this.find('payphone');
  }

  ringBells() {
    const g = this.game;
    this.bells = 13; this.bellT = 0;
    g.hud.toast('🔔 The bell starts to toll…', '', 3000);
  }

  /** combat hook: bullets that hit the water tower tank */
  shot(o, d) {
    const c = this.tower.center, r = this.tower.r;
    const oc = o.clone().sub(c);
    const b = oc.dot(d), cc = oc.lengthSq() - r * r, disc = b * b - cc;
    if (disc < 0) return false;
    const t = -b - Math.sqrt(disc);
    if (t < 0 || t > 120) return false;
    this.towerHits++;
    this.game.audio.ricochet();
    this.game.effects.sparks(o.clone().addScaledVector(d, t), 8, '#cfe8ff', 2);
    if (this.towerHits >= 5 && this.ufo.t < 0) this.summonUFO();
    return true;
  }

  summonUFO() {
    const g = this.game, u = this.ufo;
    u.t = 0; u.obj.visible = true;
    g.audio.tone(120, 3, 'sine', 0.2, 0, g.audio.sfx, 900);
    g.audio.tone(900, 3, 'sine', 0.08, 0.2, g.audio.sfx, 220);
    g.hud.toast('🛸 Something heard that…', 'good', 4000);
    this.find('ufo');
  }

  tick(dt) {
    const g = this.game, p = g.player, pos = p.position;
    const v = p.vehicle;
    // 88 mph
    if (v && v.speedAbs * 2.23694 >= 88 && !this._flux) {
      this._flux = 4;
      g.hud.flash('#bfe4ff', 0.9);
      g.audio.explosion();
      g.say('time88');
      for (let i = 0; i < 3; i++) g.effects.sparks(v.visual.root.position.clone().add(new THREE.Vector3(0, 1, 0)), 30, '#9fd8ff', 6);
      this.find('time88');
      g.events.emit('flux', {});
    }
    if (this._flux > 0) {
      this._flux -= dt;
      if (v && Math.random() < dt * 30) g.effects.sparks(v.visual.root.position.clone().add(new THREE.Vector3(0, 0.3, 0)), 4, '#ff7a1a', 2);
      if (this._flux <= 0 && (!v || v.speedAbs * 2.23694 < 70)) this._flux = 0; else if (this._flux <= 0) this._flux = 0.01;
    } else if (v && v.speedAbs * 2.23694 < 60) this._flux = 0;
    // payphone rings every ~45 s while you're nearby
    const ph = this.phone;
    if (ph) {
      const near = pos.distanceTo(ph.pos) < 28;
      if (!ph.ringing && near && (ph.ringT -= dt) < 0) ph.ringing = true;
      if (ph.ringing) {
        if ((this._ring = (this._ring || 0) - dt) < 0) { this._ring = 2.2; g.audio.tone(950, 0.4, 'square', near ? 0.05 : 0.01); g.audio.tone(1150, 0.4, 'square', near ? 0.05 : 0.01, 0.05); }
        if (!near) ph.ringing = false;
      }
    }
    // thirteen bells
    if (this.bells > 0 && (this.bellT -= dt) < 0) {
      this.bellT = 1.1;
      this.bells--;
      g.audio.tone(196, 2.5, 'sine', 0.35); g.audio.tone(392, 1.8, 'sine', 0.12); g.audio.tone(587, 1.2, 'sine', 0.05);
      g.effects.sparks(new THREE.Vector3(-22, 10.4, 23), 6, '#ffe4a0', 1.5);
      if (this.bells === 0) {
        g.say('clock13', g.npcs.groundskeeper ? null : null);
        g.hud.flash('#2a0040', 0.5);
        this._ghosts = (g.town.ghosts || []).slice(0, 6);
        this._ghostT = 10;
        this.find('clock13');
      }
    }
    if (this._ghostT > 0) { this._ghostT -= dt; for (const gh of this._ghosts) gh.position.y += dt * (this._ghostT > 5 ? 1.2 : -1.2); }
    // UFO fly-over: hovers over the tower, sweeps the beam over Main Street, zips away
    const u = this.ufo;
    if (u.t >= 0) {
      u.t += dt;
      const t = u.t;
      const p0 = new THREE.Vector3(-155, 40, -92);
      let at;
      if (t < 4) at = p0.clone().add(new THREE.Vector3(0, (4 - t) * 30, 0));
      else if (t < 14) at = new THREE.Vector3(-155 + (t - 4) * 18, 26, -92 + Math.sin((t - 4) * 0.6) * 40);
      else at = new THREE.Vector3(25 + (t - 14) * 140, 26 + (t - 14) * 60, -92);
      u.obj.position.copy(at);
      u.obj.rotation.y += dt * 2.5;
      if (this.ufoBeam) this.ufoBeam.visible = t > 4 && t < 14;
      if (t > 4 && t < 14) { for (const ped of g.npcs.pedestrians) { const d = Math.hypot(ped.char.root.position.x - at.x, ped.char.root.position.z - at.z); if (d < 4) { ped.dodge = 2; ped.dodgeDir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(); } } }
      if (t > 18) { u.t = -1; u.obj.visible = false; this.towerHits = 0; }
    }
    // bigfoot: stands among the trees, roars and lopes off into the hills when you get close
    const bf = this.bigfoot;
    if (bf) {
      const c = bf.char, d = c.root.position.distanceTo(pos);
      c.root.visible = d < 120;
      if (bf.state === 'idle' && d < 16) {
        bf.state = 'run'; bf.t = 0;
        g.audio.tone(70, 1.4, 'sawtooth', 0.25, 0, g.audio.sfx, 45); g.audio.noiseBurst(1.2, 300, 0.8, 0.3, 'lowpass');
        this.find('bigfoot');
      }
      if (bf.state === 'run') {
        bf.t += dt;
        const away = new THREE.Vector3(-1, 0, -0.6).normalize();
        c.root.position.addScaledVector(away, dt * 7.5);
        c.root.position.y = terrainHeight(c.root.position.x, c.root.position.z);
        c.root.rotation.y = Math.atan2(away.x, away.z);
        if (c.root.visible) c.update(dt, 'run');
        if (bf.t > 7) { bf.state = 'gone'; c.root.visible = false; setTimeout(() => { bf.state = 'idle'; c.root.position.copy(bf.home).setY(terrainHeight(bf.home.x, bf.home.z)); }, 120000); }
      } else if (bf.state === 'idle' && c.root.visible) { c.root.rotation.y = Math.atan2(pos.x - c.root.position.x, pos.z - c.root.position.z); c.update(dt, 'idle'); }
      if (bf.state === 'gone') c.root.visible = false;
    }
    // developers' room: walk in once for the bonus
    if (this.devSpot && !this._devPaid && pos.distanceTo(this.devSpot) < 2.4) {
      this._devPaid = true;
      if (!this.found.has('devroom')) { g.state.money += 10000; g.audio.cash(); g.hud.toast('💰 +$10,000 developer slush fund', 'good', 5000); }
      g.say('secret_room');
      this.find('devroom');
    }
  }

  _renderList() {
    const el = document.getElementById('secrets-list');
    if (!el) return;
    el.innerHTML = `<b>Secrets ${this.found.size}/${this.total()}</b> · ` + Object.entries(SECRETS).map(([k, s]) => (this.found.has(k) ? `✅ ${s.name}` : `<span title="${s.hint}">❔</span>`)).join(' ');
  }
}
