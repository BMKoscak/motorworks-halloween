import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CarVisual } from '../vehicle/carVisual.js';
import { Vehicle } from '../vehicle/vehicle.js';
import { Character } from '../actors/character.js';
import { CIVILIAN_COLORS, DEFAULT_CONFIG } from '../config.js';
import { catmull, terrainHeight } from '../world/terrain.js';
import { G } from '../core/physics.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function civilianConfig(body) {
  return { ...DEFAULT_CONFIG, body: body || pick(['sedan', 'sedan', 'muscle', 'pickup', 'coupe']), color: pick(CIVILIAN_COLORS), color2: pick(['#1a1a1a', '#d9d9d9', '#5a5a5a']),
    finish: pick(['gloss', 'gloss', 'metallic', 'matte']), livery: 'none', rim: pick(['Cragar', 'MultiSpoke', 'DeepDish']), lettering: 'none', ride: 0, camber: 0,
    front: 'none', hood: 'none', roof: Math.random() < 0.1 ? 'Roof_Taxi' : 'none', spoiler: 'none', exhaust: 'Exhaust_Stock', underglow: 'off', engine: 'v6', trans: 'balanced', tires: 'grip' };
}

/** Closed lane loop with distance parametrisation. */
class Lane {
  constructor(pts) {
    this.pts = catmull(pts, 2);
    this.pts.push(this.pts[0].clone());
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + this.pts[i].distanceTo(this.pts[i - 1]));
    this.length = this.cum.at(-1);
  }
  at(s) {
    s = ((s % this.length) + this.length) % this.length;
    let i = this.cum.findIndex((c) => c > s);
    if (i <= 0) i = 1;
    const a = this.pts[i - 1], b = this.pts[i];
    const k = (s - this.cum[i - 1]) / (this.cum[i] - this.cum[i - 1] || 1);
    return { p: a.clone().lerp(b, k), dir: b.clone().sub(a).normalize() };
  }
}

export class Traffic {
  constructor(game) {
    this.game = game;
    this.parked = [];
    this.driving = [];
    this.lanes = {
      main: new Lane([[-186, 2.6], [186, 2.6], [192, 0], [186, -2.6], [-186, -2.6], [-192, 0]]),
      elm: new Lane([[-2.6, 13], [-2.6, 142], [0, 146], [2.6, 142], [2.6, 13], [0, 9]]),
    };
    this.stopPoints = [new THREE.Vector3(-12, 0, 2.6), new THREE.Vector3(12, 0, -2.6), new THREE.Vector3(-2.6, 0, 18), new THREE.Vector3(2.6, 0, 120)];
  }

  spawnParked(spots) {
    for (const [x, z, rot] of spots) {
      const vis = new CarVisual(this.game.assets, civilianConfig(), { lite: true });
      const y = terrainHeight(x, z);
      vis.root.position.set(x, y, z);
      vis.root.rotation.y = rot;
      this.game.scene.add(vis.root);
      const b = new CANNON.Body({ mass: 1100, material: this.game.physics.mat.car, collisionFilterGroup: G.CAR, collisionFilterMask: G.STATIC | G.CAR | G.PLAYER | G.PROP,
        linearDamping: 0.5, angularDamping: 0.6 });
      const info = vis.info;
      b.addShape(new CANNON.Box(new CANNON.Vec3(vis.spec.W / 2 - 0.05, (info.belt - 0.05) / 2, info.length / 2 - 0.1)), new CANNON.Vec3(0, (info.belt + 0.05) / 2, (info.minZ + info.maxZ) / 2));
      b.position.set(x, y + 0.02, z);
      b.quaternion.setFromEuler(0, rot, 0);
      b.userData = { kind: 'car', parked: true };
      this.game.physics.world.addBody(b);
      this.parked.push({ visual: vis, body: b, kind: 'parked', alarm: Math.random() < 0.55 });
    }
  }

  spawnDriving(n = 6) {
    const lanes = [['main', 0], ['main', 0.17], ['main', 0.36], ['main', 0.55], ['main', 0.78], ['elm', 0.1], ['elm', 0.6]];
    for (let i = 0; i < Math.min(n, lanes.length); i++) {
      const [ln, f] = lanes[i];
      const lane = this.lanes[ln];
      const vis = new CarVisual(this.game.assets, civilianConfig(), { lite: true });
      this.game.scene.add(vis.root);
      const b = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, collisionFilterGroup: G.CAR, collisionFilterMask: G.CAR | G.PLAYER | G.PROP });
      const info = vis.info;
      b.addShape(new CANNON.Box(new CANNON.Vec3(vis.spec.W / 2 - 0.05, (info.belt - 0.05) / 2, info.length / 2 - 0.1)), new CANNON.Vec3(0, (info.belt + 0.05) / 2, (info.minZ + info.maxZ) / 2));
      b.userData = { kind: 'car', civilian: true };
      this.game.physics.world.addBody(b);
      const driver = new Character(this.game.assets, 'civilian', { scale: 0.76, override: { shirt: pick(['#3c6e47', '#6b2a52', '#2d4f7a', '#a65d1e', '#444']) } });
      driver.anim = 'sit';
      vis.root.add(driver.root);
      const seat = vis.n.Seat_Driver.position;
      driver.root.position.set(seat.x, seat.y - 0.66, seat.z + 0.05);
      this.driving.push({ visual: vis, body: b, lane, s: f * lane.length, speed: 0, target: 9 + Math.random() * 3, driver, kind: 'driving', stopT: 0, spin: 0, cooldown: 0 });
    }
  }

  _obstacleAhead(car, p, dir) {
    const g = this.game;
    const check = (q, r = 2.2) => {
      const dx = q.x - p.x, dz = q.z - p.z;
      const along = dx * dir.x + dz * dir.z;
      const lat = Math.abs(dx * dir.z - dz * dir.x);
      return along > 0 && along < 11 && lat < r;
    };
    if (!g.player.vehicle && check(g.player.position, 1.8)) return true;
    if (g.player.vehicle && check(g.player.vehicle.position)) return true;
    for (const o of this.driving) if (o !== car && check(o.body.position)) return true;
    for (const c of g.police.cars) if (check(c.position)) return true;
    for (const pk of this.parked) if (check(pk.body.position, 1.6)) return true;
    for (const ped of g.npcs.pedestrians) if (check(ped.char.root.position, 1.5)) return true;
    return false;
  }

  update(dt) {
    for (const pk of this.parked) {
      const b = pk.body;
      pk.visual.root.position.set(b.position.x, b.position.y, b.position.z);
      pk.visual.root.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      pk.visual.update(dt, { headlights: false, hazard: pk.hazard > 0 });
      if (pk.hazard > 0) pk.hazard -= dt;
    }
    for (const c of this.driving) {
      const { p, dir } = c.lane.at(c.s);
      let target = c.target;
      if (c.cooldown > 0) { c.cooldown -= dt; target = 0; }
      if (this._obstacleAhead(c, p, dir)) target = 0;
      for (const sp of this.stopPoints) {
        if (Math.hypot(sp.x - p.x, sp.z - p.z) < 1.2 && c.stopT <= 0 && c.lastStop !== sp) { c.stopT = 1.8; c.lastStop = sp; }
      }
      if (c.stopT > 0) { c.stopT -= dt; target = 0; }
      c.speed += THREE.MathUtils.clamp(target - c.speed, -dt * 9, dt * 3);
      c.s += c.speed * dt;
      const q = c.lane.at(c.s);
      const y = terrainHeight(q.p.x, q.p.z);
      const heading = Math.atan2(q.dir.x, q.dir.z);
      const b = c.body;
      b.velocity.set((q.p.x - b.position.x) / Math.max(dt, 1e-3), 0, (q.p.z - b.position.z) / Math.max(dt, 1e-3));
      b.position.set(q.p.x, y, q.p.z);
      b.quaternion.setFromEuler(0, heading, 0);
      c.visual.root.position.set(q.p.x, y, q.p.z);
      c.visual.root.rotation.set(0, heading, 0);
      c.spin += (c.speed * dt) / c.visual.spec.r;
      c.visual.wheelNodes.forEach((w, i) => c.visual.setWheel(i, 0, 0, c.spin));
      c.visual.update(dt, { brake: target < c.speed - 0.5, headlights: true });
      c.driver.update(dt, 'sit');
    }
  }

  /** Nearest stealable car within reach of the player's position (driver door side). */
  nearestCar(pos, maxD = 3.4) {
    let best = null, bd = maxD;
    const consider = (entry, visual) => {
      const door = this.doorPoint(visual);
      const d = Math.hypot(door.x - pos.x, door.z - pos.z);
      if (d < bd) { bd = d; best = entry; }
    };
    for (const pk of this.parked) consider(pk, pk.visual);
    for (const c of this.driving) if (c.speed < 0.6) consider(c, c.visual);
    return best;
  }

  doorPoint(visual) {
    const door = visual.n.Door_L;
    const p = new THREE.Vector3(visual.spec.W / 2 + 0.55, 0, door ? door.position.z - 0.5 : 0.3);
    return p.applyMatrix4(visual.root.matrixWorld);
  }

  /** Convert a parked/stopped civilian car into a drivable stolen Vehicle. Returns { vehicle, driver }. */
  steal(entry) {
    const vis = entry.visual;
    const pos = vis.root.position.clone();
    const heading = new THREE.Euler().setFromQuaternion(vis.root.quaternion, 'YXZ').y;
    let driver = null;
    if (entry.kind === 'parked') {
      this.game.physics.world.removeBody(entry.body);
      this.parked.splice(this.parked.indexOf(entry), 1);
    } else {
      this.game.physics.world.removeBody(entry.body);
      this.driving.splice(this.driving.indexOf(entry), 1);
      driver = entry.driver;
      vis.root.remove(driver.root);
    }
    // swap the baked "lite" body for a fully articulated, repaintable one now that the player owns it
    const full = new CarVisual(this.game.assets, vis.cfg);
    full.hinges.Door_L && (full.hinges.Door_L.t = vis.hinges.Door_L ? vis.hinges.Door_L.t : 0, full.hinges.Door_L.target = 1);
    vis.dispose();
    const veh = new Vehicle(this.game, full, { kind: 'player', position: pos, heading, stolen: true });
    veh.civilianEntry = entry;
    return { vehicle: veh, driver };
  }

  /** A civilian car got rammed: stop for a moment. */
  bump(body) {
    const c = this.driving.find((d) => d.body === body);
    if (c) { c.cooldown = 3 + Math.random() * 2; c.speed = 0; }
  }
}
