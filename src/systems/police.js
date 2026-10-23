import * as THREE from 'three';
import { CarVisual } from '../vehicle/carVisual.js';
import { Vehicle } from '../vehicle/vehicle.js';
import { DEFAULT_CONFIG, LAYOUT } from '../config.js';
import { G } from '../core/physics.js';

const POLICE_CFG = { ...DEFAULT_CONFIG, body: 'sedan', color: '#0e0e12', color2: '#f2f2f2', finish: 'gloss', livery: 'police', rim: 'MultiSpoke', lettering: 'none',
  ride: 0, camber: 0, front: 'Front_PushBumper', hood: 'none', roof: 'none', spoiler: 'none', exhaust: 'Exhaust_Stock', underglow: 'off', engine: 'v8sc', trans: 'balanced', tires: 'grip' };

/** AI driver for a police cruiser (pure-pursuit steering, intercept prediction, ramming, unstick). */
class Cruiser {
  constructor(game, pos, heading, mode = 'patrol') {
    this.game = game;
    const vis = new CarVisual(game.assets, POLICE_CFG, { police: true, lite: true });
    this.vehicle = new Vehicle(game, vis, { kind: 'police', position: pos, heading });
    this.vehicle.body.userData.police = true;
    this.mode = mode;
    this.stuck = 0;
    this.reverse = 0;
    this.patrolS = 0;
    this.seen = false;
    this.id = this.vehicle.id;
  }
  get position() { return this.vehicle.body.position; }

  drive(dt, targetPt, desiredSpeed, aggressive) {
    const v = this.vehicle;
    const q = new THREE.Quaternion(v.body.quaternion.x, v.body.quaternion.y, v.body.quaternion.z, v.body.quaternion.w);
    const local = targetPt.clone().sub(new THREE.Vector3(v.body.position.x, v.body.position.y, v.body.position.z)).applyQuaternion(q.clone().invert());
    let ang = Math.atan2(local.x, local.z);
    // whisker raycasts against buildings
    const p = new THREE.Vector3(v.body.position.x, v.body.position.y + 0.2, v.body.position.z);
    const f = v.forward.setY(0).normalize();
    const look = 7 + Math.abs(v.speed) * 0.5;
    const left = f.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.45), right = f.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.45);
    const hitF = this.game.physics.rayStatic(p, p.clone().addScaledVector(f, look));
    const hitL = this.game.physics.rayStatic(p, p.clone().addScaledVector(left, look * 0.8));
    const hitR = this.game.physics.rayStatic(p, p.clone().addScaledVector(right, look * 0.8));
    if (hitL && !hitR) ang -= 0.6;
    if (hitR && !hitL) ang += 0.6;
    if (hitF && local.length() > 10) ang += (hitL ? -1 : 1) * 0.8;
    let throttle = Math.abs(ang) > 1.3 ? 0.35 : 1;
    const speed = v.speed;
    if (speed > desiredSpeed) throttle = speed > desiredSpeed + 3 ? -0.5 : 0;
    if (Math.abs(ang) > 0.9 && speed > 18) throttle = -0.6;
    // unstick
    if (Math.abs(speed) < 1.2 && throttle > 0.3) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt);
    if (this.stuck > 2.2) { this.reverse = 1.6; this.stuck = 0; }
    let steer = THREE.MathUtils.clamp(ang * 1.8, -1, 1);
    if (this.reverse > 0) { this.reverse -= dt; throttle = -1; steer = -steer; }
    v.setControls({ throttle, steer, handbrake: aggressive && Math.abs(ang) > 1.1 && speed > 12 });
  }
}

/** Wanted level (1-5 skulls), crimes, dispatch radio, cruiser spawning, evasion and busting. */
export class Police {
  constructor(game) {
    this.game = game;
    this.cars = [];
    this.level = 0;
    this.lostT = 0;
    this.bustT = 0;
    this.cooldowns = {};
    this.propCount = [];
    this.flash = 0;
    this.stats = { crimes: [], maxLevel: 0, busts: 0, escapes: 0 };
  }

  spawnPatrols() {
    const main = this.game.traffic.lanes.main;
    for (const f of [0.08, 0.6]) {
      const { p, dir } = main.at(f * main.length);
      const c = new Cruiser(this.game, p, Math.atan2(dir.x, dir.z), 'patrol');
      c.patrolS = f * main.length;
      c.lane = main;
      this.cars.push(c);
    }
  }

  get cruisers() { return this.cars.map((c) => c.vehicle); }

  crime(kind, amount = 1) {
    const now = performance.now();
    if (this.cooldowns[kind] && now - this.cooldowns[kind] < (kind === 'theft' ? 0 : 6000)) return;
    this.cooldowns[kind] = now;
    const before = this.level;
    this.level = Math.min(5, this.level + amount);
    this.lostT = 0;
    this.flash = 3;
    this.stats.crimes.push({ kind, at: Math.round(now), level: this.level });
    this.stats.maxLevel = Math.max(this.stats.maxLevel, this.level);
    if (this.level > before) {
      this.game.hud.toast(`WANTED ${'💀'.repeat(this.level)}  (${kind})`, 'bad');
      this.game.audio.sting(true);
      const line = { theft: 'dispatch_1', speeding: 'dispatch_2', property: 'dispatch_6', rammed: 'dispatch_7' }[kind] || 'dispatch_2';
      this.game.say(this.level >= 3 && kind !== 'rammed' ? 'dispatch_3' : line);
    }
  }

  /** Can any cruiser see the player? */
  _sees(c, target) {
    const p = c.position;
    const d = Math.hypot(p.x - target.x, p.z - target.z);
    const fog = target.z > 200 ? 26 : 62;
    if (d > fog) return false;
    const hit = this.game.physics.rayStatic(new THREE.Vector3(p.x, p.y + 0.8, p.z), new THREE.Vector3(target.x, target.y + 1.0, target.z));
    return !hit;
  }

  witnesses(pos) {
    let civ = 0, cop = false;
    for (const ped of this.game.npcs.all()) if (ped.char.root.position.distanceTo(pos) < 26) civ++;
    for (const d of this.game.traffic.driving) if (d.body.position.distanceTo(pos) < 26) civ++;
    for (const c of this.cars) if (Math.hypot(c.position.x - pos.x, c.position.z - pos.z) < 45 && this._sees(c, pos)) cop = true;
    return { civ, cop };
  }

  _spawnPoint(target) {
    const g = this.game, cam = g.camera;
    const camDir = new THREE.Vector3(); cam.getWorldDirection(camDir);
    const lines = [g.town.mainLine, g.town.elmLine, g.town.exitLine, g.town.hillLine];
    let best = null, bs = -1e9;
    for (const line of lines) {
      for (let i = 0; i < line.length; i += 3) {
        const p = line[i];
        const d = Math.hypot(p.x - target.x, p.z - target.z);
        if (d < 70 || d > 150) continue;
        const toP = new THREE.Vector3(p.x - cam.position.x, 0, p.z - cam.position.z).normalize();
        const score = -toP.dot(camDir) * 40 - Math.abs(d - 95) + Math.random() * 15;
        if (score > bs) { bs = score; best = { p, next: line[Math.min(line.length - 1, i + 1)] }; }
      }
    }
    return best;
  }

  update(dt) {
    const g = this.game;
    const target = g.player.position.clone();
    const pv = g.player.vehicle;
    this.flash = Math.max(0, this.flash - dt);
    // escalate cruisers to match the wanted level
    if (this.level > 0) {
      const want = Math.min(5, this.level + (this.level >= 3 ? 1 : 0));
      const active = this.cars.filter((c) => c.mode === 'pursuit').length;
      for (const c of this.cars) if (c.mode !== 'pursuit' && active < want) c.mode = 'pursuit';
      if (this.cars.length < want && (this._spawnCd = (this._spawnCd || 0) - dt) <= 0) {
        const sp = this._spawnPoint(target);
        if (sp) {
          const c = new Cruiser(g, new THREE.Vector3(sp.p.x, g.heightAt(sp.p.x, sp.p.z), sp.p.z), Math.atan2(target.x - sp.p.x, target.z - sp.p.z), 'pursuit');
          this.cars.push(c);
          this._spawnCd = 3;
        }
      }
    }
    let anySees = false;
    for (const c of this.cars) {
      const v = c.vehicle;
      if (c.mode === 'pursuit' && this.level > 0) {
        const tv = pv ? pv.body.velocity : { x: 0, z: 0 };
        const d = Math.hypot(c.position.x - target.x, c.position.z - target.z);
        const lead = Math.min(1.8, d / 30);
        const aim = target.clone().add(new THREE.Vector3(tv.x * lead, 0, tv.z * lead));
        c.drive(dt, aim, d < 15 ? 22 : 44, true);
        v.siren = true;
        c.seen = this._sees(c, target);
        if (c.seen) anySees = true;
      } else {
        // patrol the main street loop (or head back to it)
        c.mode = 'patrol';
        v.siren = false;
        const lane = g.traffic.lanes.main;
        if (c.patrolS === undefined || c.lost) c.patrolS = 0;
        const here = lane.at(c.patrolS);
        if (here.p.distanceTo(new THREE.Vector3(c.position.x, here.p.y, c.position.z)) < 14) c.patrolS += Math.max(4, v.speed) * dt;
        const ahead = lane.at(c.patrolS + 12).p;
        c.drive(dt, ahead, 12, false);
        // speeding past a patrol car
        if (pv && this.level === 0 && pv.speedAbs > 24 && Math.hypot(c.position.x - target.x, c.position.z - target.z) < 25 && this._sees(c, target)) this.crime('speeding');
      }
      g.audio.siren(c.id, c.position, g.listener, !!v.siren);
    }
    // despawn surplus cruisers when the heat is gone and they are far away
    if (this.level === 0) {
      for (let i = this.cars.length - 1; i >= 2; i--) {
        const c = this.cars[i];
        if (Math.hypot(c.position.x - target.x, c.position.z - target.z) > 110) { g.audio.siren(c.id, c.position, g.listener, false); c.vehicle.remove(); this.cars.splice(i, 1); }
      }
    }
    // evasion
    if (this.level > 0) {
      if (anySees) this.lostT = 0;
      else {
        this.lostT += dt * (target.z > 200 ? 1.8 : 1);
        if (this.lostT > 7 + this.level * 1.5) {
          this.level--;
          this.lostT = 0;
          g.hud.toast(this.level ? `Heat dropping… ${'💀'.repeat(this.level)}` : 'You lost the cops!', 'good');
          if (!this.level) { g.say('dispatch_4'); this.stats.escapes++; this.cars.forEach((c) => (c.mode = 'patrol')); }
        }
      }
      // busted: boxed in / stopped next to a cruiser for 5 s
      const near = this.cars.some((c) => Math.hypot(c.position.x - target.x, c.position.z - target.z) < (pv ? 8.5 : 4.5));
      const stopped = pv ? pv.speedAbs < 1.6 : true;
      if (near && stopped) this.bustT += dt * (pv ? 1 : 1.5);
      else this.bustT = Math.max(0, this.bustT - dt * 1.5);
      if (this.bustT >= 5) { this.bustT = 0; g.busted(); }
    } else this.bustT = 0;
    g.hud.wanted(this.level, this.flash > 0 || this.level > 0 && anySees);
    g.hud.bust(this.level > 0 ? this.bustT / 5 : 0);
  }

  clear() {
    this.level = 0;
    this.lostT = 0;
    this.bustT = 0;
    this.cars.forEach((c) => { c.mode = 'patrol'; c.vehicle.siren = false; });
  }

  onImpact(e) {
    const other = e.other;
    if (e.vehicle === this.game.player.vehicle && other && other.userData && other.userData.police) this.crime('rammed');
  }

  onPropSmashed(e) {
    if (e.vehicle !== this.game.player.vehicle) return;
    const now = performance.now();
    this.propCount = this.propCount.filter((t) => now - t < 30000);
    this.propCount.push(now);
    if (this.propCount.length >= 3) { this.propCount = []; this.crime('property'); }
  }
}
