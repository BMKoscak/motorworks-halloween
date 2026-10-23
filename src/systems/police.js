import * as THREE from 'three';
import { CarVisual } from '../vehicle/carVisual.js';
import { Vehicle } from '../vehicle/vehicle.js';
import { Character } from '../actors/character.js';
import { FootAgent } from '../actors/agent.js';
import { DEFAULT_CONFIG, LAYOUT } from '../config.js';
import { seatDriver } from './traffic.js';
import { makeProfile } from '../data/demographics.js';

const POLICE_CFG = { ...DEFAULT_CONFIG, body: 'sedan', color: '#0e0e12', color2: '#f2f2f2', finish: 'gloss', livery: 'police', rim: 'MultiSpoke', lettering: 'none',
  ride: 0, camber: 0, front: 'Front_PushBumper', hood: 'none', roof: 'none', spoiler: 'none', exhaust: 'Exhaust_Stock', underglow: 'off', engine: 'v8sc', trans: 'balanced', tires: 'grip' };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const ARREST_RANGE = 1.4, ARREST_TIME = 1.8;

/** A police officer: seated in a cruiser, walking a beat, or chasing the player on foot. */
class Officer {
  constructor(police, opts = {}) {
    this.police = police;
    const g = police.game;
    this.char = new Character(g.assets, 'police', { profile: makeProfile('adult_male', 'police', 'cop') });
    this.char.profile = this.char.profile || makeProfile('adult_male', 'police', 'cop');
    this.agent = new FootAgent(g, this.char, { speed: 6.3 });
    this.state = opts.state || 'beat';
    this.cruiser = opts.cruiser || null;
    this.health = 100;
    this.shootCd = 1 + Math.random();
    this.shoutCd = 0;
    this.downT = 0;
    this.beat = opts.beat || null;
    this.beatI = 0;
    this.armed = false;
    this.id = ++Officer.n;
  }
  get seated() { return this.state === 'seated'; }
  get pos() { return this.char.root.position; }

  draw(on) {
    if (on === this.armed) return;
    this.armed = on;
    if (on) {
      const gun = this.police.game.assets.part('props', 'Weapon_Pistol');
      gun.rotation.set(Math.PI / 2, 0, 0);
      gun.position.set(0, -0.05, 0.02);
      this.gun = gun;
      this.muzzle = gun.getObjectByName('Muzzle_Pistol');
      this.char.hold(gun, 'R');
    } else { this.char.hold(null); this.gun = null; this.muzzle = null; }
  }
}
Officer.n = 0;

/** AI driver for a police cruiser (pure-pursuit steering, intercept prediction, whiskers, unstick) with a seated officer. */
class Cruiser {
  constructor(game, pos, heading, mode = 'patrol') {
    this.game = game;
    const vis = new CarVisual(game.assets, POLICE_CFG, { police: true, lite: true });
    this.vehicle = new Vehicle(game, vis, { kind: 'police', position: pos, heading });
    this.vehicle.body.userData.police = true;
    this.mode = mode;
    this.stuck = 0;
    this.blockedT = 0;
    this.reverse = 0;
    this.seen = false;
    this.id = this.vehicle.id;
    this.seg = null;
    this.s = 0;
  }
  get position() { return this.vehicle.body.position; }

  drive(dt, targetPt, desiredSpeed, aggressive) {
    const v = this.vehicle;
    const q = new THREE.Quaternion(v.body.quaternion.x, v.body.quaternion.y, v.body.quaternion.z, v.body.quaternion.w);
    const local = targetPt.clone().sub(new THREE.Vector3(v.body.position.x, v.body.position.y, v.body.position.z)).applyQuaternion(q.clone().invert());
    let ang = Math.atan2(local.x, local.z);
    // whisker raycasts against buildings (centre, ±18°, ±26°)
    const p = new THREE.Vector3(v.body.position.x, v.body.position.y + 0.2, v.body.position.z);
    const f = v.forward.setY(0).normalize();
    const look = Math.min(12, 7 + Math.abs(v.speed) * 0.5);
    const up = new THREE.Vector3(0, 1, 0);
    const rs = this.game.physics;
    const hitF = rs.rayStatic(p, p.clone().addScaledVector(f, look));
    const hitL = rs.rayStatic(p, p.clone().addScaledVector(f.clone().applyAxisAngle(up, 0.45), look * 0.8)) || rs.rayStatic(p, p.clone().addScaledVector(f.clone().applyAxisAngle(up, 0.31), look));
    const hitR = rs.rayStatic(p, p.clone().addScaledVector(f.clone().applyAxisAngle(up, -0.45), look * 0.8)) || rs.rayStatic(p, p.clone().addScaledVector(f.clone().applyAxisAngle(up, -0.31), look));
    const wall = (h) => h && h.body.userData.tag !== 'curb' && h.body.userData.tag !== 'floor' && h.body.userData.kind !== 'ground';
    if (wall(hitL) && !wall(hitR)) ang -= 0.6;
    if (wall(hitR) && !wall(hitL)) ang += 0.6;
    if (wall(hitF) && local.length() > 10) ang += (wall(hitL) ? -1 : 1) * 0.8;
    let throttle = Math.abs(ang) > 1.3 ? 0.35 : 1;
    const speed = v.speed;
    if (speed > desiredSpeed) throttle = speed > desiredSpeed + 3 ? -0.5 : 0;
    if (Math.abs(ang) > 0.9 && speed > 18) throttle = -0.6;
    if (wall(hitF) && hitF.distance < 4 && speed > 4) throttle = -0.8;
    // unstick
    if (Math.abs(speed) < 1.2 && throttle > 0.3) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt);
    if (this.stuck > 2.2) { this.reverse = 1.6; this.stuck = 0; this.blockedT += 2.2; }
    let steer = THREE.MathUtils.clamp(ang * 1.8, -1, 1);
    if (this.reverse > 0) { this.reverse -= dt; throttle = -1; steer = -steer; }
    v.setControls({ throttle, steer, handbrake: aggressive && Math.abs(ang) > 1.1 && speed > 12 });
  }

  /** Follow the road graph's right-hand lanes. */
  patrol(dt, graph) {
    const v = this.vehicle;
    const pos = new THREE.Vector3(v.body.position.x, 0, v.body.position.z);
    if (!this.seg || this.seg.at(this.s).p.distanceTo(pos) > 14) { const n = graph.nearest(pos); this.seg = n.seg; this.s = n.s; }
    while (this.seg.at(this.s).p.distanceTo(pos) < 9) {
      this.s += 2;
      if (this.s > this.seg.length) { this.s -= this.seg.length; this.seg = pick(this.seg.next); }
    }
    this.drive(dt, this.seg.at(this.s).p, this.seg.kind === 'lane' ? 12 : 6, false);
  }
}

/** Wanted level (1-5 skulls), crimes, dispatch radio, cruisers + foot officers, evasion and busting. */
export class Police {
  constructor(game) {
    this.game = game;
    this.cars = [];
    this.officers = [];
    this.level = 0;
    this.lostT = 0;
    this.bustT = 0;
    this.cooldowns = {};
    this.propCount = [];
    this.flash = 0;
    this.stats = { crimes: [], maxLevel: 0, busts: 0, escapes: 0, dismounts: 0, footChases: 0, shotsAtPlayer: 0, resets: 0 };
  }

  spawnPatrols() {
    const graph = this.game.traffic.graph;
    for (const f of [0.08, 0.6]) {
      const lane = graph.lane(f < 0.5 ? 'main_lw' : 'main_e1', f < 0.5 ? 'LOT_W' : 'LOT_E');
      const { p, dir } = lane.at(lane.length * 0.4);
      const c = this._newCruiser(p, Math.atan2(dir.x, dir.z), 'patrol');
      c.seg = lane; c.s = lane.length * 0.4;
    }
    // beat cops walking Main Street and the station forecourt
    const ps = LAYOUT.policeStation;
    const beats = [
      [[100, 9], [160, 9], [160, 13], [118, 13], [ps[0], 13.5]].map(([x, z]) => new THREE.Vector3(x, 0, z)),
      [[-20, 9], [-90, 9], [-90, -9], [-30, -9]].map(([x, z]) => new THREE.Vector3(x, 0, z)),
      [[20, 9], [70, 9], [70, -9.5], [20, -9.5]].map(([x, z]) => new THREE.Vector3(x, 0, z)),
    ];
    for (const b of beats) {
      const o = new Officer(this, { state: 'beat', beat: b });
      o.char.root.position.copy(b[0]);
      this.game.scene.add(o.char.root);
      this.officers.push(o);
    }
  }

  _newCruiser(p, heading, mode) {
    const g = this.game;
    const c = new Cruiser(g, new THREE.Vector3(p.x, g.heightAt(p.x, p.z), p.z), heading, mode);
    const o = new Officer(this, { state: 'seated', cruiser: c });
    seatDriver(c.vehicle.visual, o.char);
    c.vehicle.driver = o.char;
    c.officer = o;
    this.officers.push(o);
    this.cars.push(c);
    return c;
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
      this.game.hud.toast(`WANTED ${'💀'.repeat(this.level)}  (${kind.replace('_', ' ')})`, 'bad');
      this.game.audio.sting(true);
      const line = { theft: 'dispatch_1', speeding: 'dispatch_2', property: 'dispatch_6', rammed: 'dispatch_7', burglary: 'dispatch_9', shots: 'dispatch_8' }[kind] || 'dispatch_2';
      if (kind !== 'shots') this.game.say(this.level >= 3 && kind !== 'rammed' ? 'dispatch_3' : line);
    }
    // nearby beat cops respond immediately
    for (const o of this.officers) if (o.state === 'beat' && o.pos.distanceTo(this.game.player.position) < 60) this._footChase(o);
  }

  /** Can this cruiser / officer see the player? */
  _sees(from, target, eye = 0.8) {
    const d = Math.hypot(from.x - target.x, from.z - target.z);
    const fog = target.z > 200 ? 26 : 62;
    if (d > fog) return false;
    const hit = this.game.physics.rayStatic(new THREE.Vector3(from.x, from.y + eye, from.z), new THREE.Vector3(target.x, target.y + 1.0, target.z));
    return !hit;
  }

  witnesses(pos) {
    let civ = 0, cop = false;
    for (const ped of this.game.npcs.allPeople()) if (ped.char.root.position.distanceTo(pos) < 26) civ++;
    for (const d of this.game.traffic.driving) if (d.body.position.distanceTo(pos) < 26) civ++;
    for (const c of this.cars) if (Math.hypot(c.position.x - pos.x, c.position.z - pos.z) < 45 && this._sees(c.position, pos)) cop = true;
    for (const o of this.officers) if (!o.seated && o.state !== 'down' && o.pos.distanceTo(pos) < 40 && this._sees(o.pos, pos, 1.6)) cop = true;
    return { civ, cop };
  }

  _spawnPoint(target) {
    const g = this.game, cam = g.camera;
    const camDir = new THREE.Vector3(); cam.getWorldDirection(camDir);
    let best = null, bs = -1e9;
    for (const seg of g.traffic.graph.lanes) {
      for (let i = 0; i < seg.pts.length; i += 3) {
        const p = seg.pts[i];
        const d = Math.hypot(p.x - target.x, p.z - target.z);
        if (d < 70 || d > 150) continue;
        const toP = new THREE.Vector3(p.x - cam.position.x, 0, p.z - cam.position.z).normalize();
        const score = -toP.dot(camDir) * 40 - Math.abs(d - 95) + Math.random() * 15;
        if (score > bs) { bs = score; best = { p, dir: seg.at(seg.cum[i]).dir }; }
      }
    }
    return best;
  }

  /** Player is somewhere a cruiser can't follow: inside a building, a back yard, the cemetery paths. */
  _offRoad(target) {
    const g = this.game;
    if (g.buildings.inside(target)) return true;
    const n = g.traffic.graph.nearest(target);
    return n && n.d > 11;
  }

  _dismount(c) {
    const o = c.officer;
    if (!o || o.state !== 'seated') return;
    const g = this.game, v = c.vehicle;
    v.setControls({ throttle: 0, steer: 0, handbrake: true });
    v.visual.setHinge('Door_L', 1);
    g.audio.doorOpen();
    const door = g.traffic.doorPoint(v.visual);
    v.visual.root.remove(o.char.root);
    o.char.root.scale.setScalar(1);
    o.char.root.rotation.set(0, 0, 0);
    o.char.root.position.copy(door);
    o.char.root.position.y = g.heightAt(door.x, door.z);
    g.scene.add(o.char.root);
    v.driver = null;
    c.parked = true;
    o.state = 'foot';
    o.exitT = 0.6;
    this.stats.dismounts++;
    this.stats.footChases++;
    setTimeout(() => { v.visual.setHinge('Door_L', 0); g.audio.doorShut(); }, 1100);
    g.events.emit('dismount', { officer: o.id });
  }

  _remount(o) {
    const c = o.cruiser;
    if (!c || !this.cars.includes(c)) { o.state = 'beat'; return; }
    this.game.scene.remove(o.char.root);
    seatDriver(c.vehicle.visual, o.char);
    c.vehicle.driver = o.char;
    c.parked = false;
    o.state = 'seated';
    o.draw(false);
  }

  _footChase(o) {
    if (o.state === 'foot' || o.state === 'down') return;
    o.state = 'foot';
    this.stats.footChases++;
  }

  hitOfficer(o, dmg) {
    if (!o || o.seated) return;
    o.health -= dmg;
    if (o.health <= 0 && o.state !== 'down') { o.state = 'down'; o.downT = 12; o.draw(false); this.game.events.emit('officerDown', {}); }
  }

  _shootAt(o, target, inCar) {
    const g = this.game, cb = g.combat;
    o.char.root.updateMatrixWorld(true);
    const muzzle = o.muzzle ? o.muzzle.getWorldPosition(new THREE.Vector3()) : o.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
    const aim = target.clone().add(new THREE.Vector3(0, inCar ? 0.6 : 1.2, 0));
    const d = muzzle.distanceTo(aim);
    const pv = g.player.vehicle;
    const pSpeed = pv ? pv.speedAbs : Math.hypot(g.player.body.velocity.x, g.player.body.velocity.z);
    const chance = THREE.MathUtils.clamp(0.75 - d / 45 - pSpeed * 0.025, 0.12, 0.7);
    const hit = Math.random() < chance;
    const miss = new THREE.Vector3((Math.random() - 0.5) * 2.5, (Math.random() - 0.3) * 1.5, (Math.random() - 0.5) * 2.5);
    const end = hit ? aim : aim.clone().add(miss);
    cb._tracer(muzzle, end);
    cb.flash.position.copy(muzzle); cb.flash.intensity = 50;
    g.audio.gunshot('pistol', muzzle, g.listener);
    g.effects.sparks(end, 5, '#ffd08a', 2);
    this.stats.shotsAtPlayer++;
    if (!hit) return;
    if (pv) {
      if (Math.random() < 0.3) pv.popTire(Math.floor(Math.random() * 4)); else pv.damageEngine(6);
      g.audio.ricochet();
    } else cb.hurtPlayer(9, 'police');
  }

  _updateOfficer(o, dt, target, inCar) {
    const g = this.game;
    if (o.state === 'seated') return;
    if (o.exitT > 0) { o.exitT -= dt; o.char.update(dt, 'idle'); return; }
    if (o.state === 'down') {
      o.char.update(dt, 'down');
      if ((o.downT -= dt) <= 0) { o.state = 'foot'; o.health = 60; }
      return;
    }
    const dist = o.pos.distanceTo(target);
    if (o.state === 'beat' || (o.state === 'foot' && this.level === 0)) {
      if (o.state === 'foot' && this.level === 0) {
        if (o.cruiser && o.cruiser.vehicle.alive) {
          const door = g.traffic.doorPoint(o.cruiser.vehicle.visual);
          if (o.agent.update(dt, door, 3.2, 1.0) < 1.2) this._remount(o);
          o.char.update(dt, o.agent.moving ? 'walk' : 'idle');
          return;
        }
        o.state = 'beat';
      }
      if (!o.beat) { o.char.update(dt, 'idle'); return; }
      const wp = o.beat[o.beatI % o.beat.length];
      if (o.agent.update(dt, wp, 1.5, 0.6) < 0.8) o.beatI++;
      o.char.update(dt, o.agent.moving ? 'walk' : 'idle');
      return;
    }
    // ---- foot chase
    const armed = this.level >= 3;
    o.draw(armed);
    const sees = this._sees(o.pos, target, 1.6);
    if (armed && sees && dist < 28) {
      // brief firing stance
      o.char.root.rotation.y = Math.atan2(target.x - o.pos.x, target.z - o.pos.z);
      o.char.aimPitch = Math.atan2(target.y + 1 - (o.pos.y + 1.4), dist) * 0.8;
      o.shootCd -= dt;
      if (o.shootCd <= 0) { o.shootCd = 1.2 + Math.random() * 0.6; this._shootAt(o, target, inCar); }
      if (dist > 9) o.agent.update(dt, target, 2.2, 6); // advance slowly while shooting
      o.char.update(dt, 'aim');
    } else {
      o.agent.update(dt, target, inCar ? 5.5 : 6.3, inCar ? 3 : 0.9);
      o.char.update(dt, o.agent.moving ? 'run' : 'idle');
    }
    if ((o.shoutCd -= dt) <= 0 && dist < 25) {
      o.shoutCd = 7 + Math.random() * 4;
      g.say(armed && !o.saidArmed ? 'cop_shoot' : pick(['cop_stop_1', 'cop_stop_2']), o.char);
      if (armed) o.saidArmed = true;
    }
    // tackle / cuff an on-foot player
    if (!inCar && dist < ARREST_RANGE && !armed) { this.arrestT = (this.arrestT || 0) + dt; o.grabbing = true; }
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
        if (sp) { this._newCruiser(sp.p, Math.atan2(target.x - sp.p.x, target.z - sp.p.z), 'pursuit'); this._spawnCd = 3; }
      }
    }
    let anySees = false;
    const offRoad = this.level > 0 && !pv && this._offRoad(target);
    for (const c of this.cars) {
      const v = c.vehicle;
      const d = Math.hypot(c.position.x - target.x, c.position.z - target.z);
      if (c.mode === 'pursuit' && this.level > 0) {
        if (c.parked) { v.setControls({ throttle: 0, steer: 0, handbrake: true }); v.siren = true; }
        else {
          const tv = pv ? pv.body.velocity : { x: 0, z: 0 };
          const lead = Math.min(1.8, d / 30);
          const aim = target.clone().add(new THREE.Vector3(tv.x * lead, 0, tv.z * lead));
          c.drive(dt, aim, d < 15 ? 22 : 44, true);
          v.siren = true;
          // dismount: close to an on-foot player, blocked for a while, or the player is where cars can't go
          if (!pv && (d < 14 || (offRoad && d < 45) || c.blockedT > 4)) this._dismount(c);
        }
        c.seen = this._sees(c.position, target);
        if (c.seen) anySees = true;
      } else {
        c.mode = 'patrol';
        v.siren = false;
        c.blockedT = Math.max(0, c.blockedT - dt);
        if (c.parked) { v.setControls({ throttle: 0, steer: 0, handbrake: true }); }
        else c.patrol(dt, g.traffic.graph);
        if (pv && this.level === 0 && pv.speedAbs > 24 && d < 25 && this._sees(c.position, target)) this.crime('speeding');
      }
      g.audio.siren(c.id, c.position, g.listener, !!v.siren);
    }
    this.arrestT = this.arrestT || 0;
    let grabbing = false;
    for (const o of this.officers) {
      o.grabbing = false;
      this._updateOfficer(o, dt, target, !!pv);
      if (o.grabbing) grabbing = true;
      if (!o.seated && o.state === 'foot' && this.level > 0 && this._sees(o.pos, target, 1.6) && o.pos.distanceTo(target) < 40) anySees = true;
    }
    if (!grabbing) this.arrestT = Math.max(0, this.arrestT - dt * 2);
    // despawn surplus cruisers when the heat is gone and they are far away
    if (this.level === 0) {
      for (let i = this.cars.length - 1; i >= 2; i--) {
        const c = this.cars[i];
        if (c.officer && c.officer.state !== 'seated') continue;
        if (Math.hypot(c.position.x - target.x, c.position.z - target.z) > 110) {
          g.audio.siren(c.id, c.position, g.listener, false);
          if (c.officer) { this.officers.splice(this.officers.indexOf(c.officer), 1); }
          c.vehicle.remove(); this.cars.splice(i, 1);
        }
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
      // busted in a car: boxed in / stopped next to a cruiser for 5 s;  on foot: an officer holds you for 1.8 s
      if (pv) {
        const near = this.cars.some((c) => Math.hypot(c.position.x - target.x, c.position.z - target.z) < 8.5);
        if (near && pv.speedAbs < 1.6) this.bustT += dt; else this.bustT = Math.max(0, this.bustT - dt * 1.5);
        if (this.bustT >= 5) { this.bustT = 0; g.busted(); }
      } else {
        this.bustT = (this.arrestT / ARREST_TIME) * 5;
        if (this.arrestT >= ARREST_TIME) { this.arrestT = 0; this.bustT = 0; this.stats.tackles = (this.stats.tackles || 0) + 1; g.busted('tackled'); }
      }
    } else { this.bustT = 0; this.arrestT = 0; }
    g.hud.wanted(this.level, this.flash > 0 || this.level > 0 && anySees);
    g.hud.bust(this.level > 0 ? this.bustT / 5 : 0);
  }

  /** Watchdog hook: a cruiser left the world (or went NaN) - put it back on the nearest lane. */
  resetCar(vehicle) {
    const g = this.game;
    const n = g.traffic.graph.nearest(vehicle.body.position.x !== undefined && Number.isFinite(vehicle.body.position.x) ? vehicle.body.position : new THREE.Vector3());
    const dir = n.seg.at(n.s).dir;
    vehicle.teleport(new THREE.Vector3(n.p.x, g.heightAt(n.p.x, n.p.z), n.p.z), Math.atan2(dir.x, dir.z));
    this.stats.resets++;
  }

  clear() {
    this.level = 0;
    this.lostT = 0;
    this.bustT = 0;
    this.arrestT = 0;
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
