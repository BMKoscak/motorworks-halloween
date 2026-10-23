import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CarVisual } from '../vehicle/carVisual.js';
import { Vehicle } from '../vehicle/vehicle.js';
import { CIVILIAN_COLORS, DEFAULT_CONFIG } from '../config.js';
import { terrainHeight } from '../world/terrain.js';
import { G } from '../core/physics.js';
import { RoadGraph } from './roadGraph.js';
import { makePerson, randomAdult } from '../data/demographics.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const WHISKER = THREE.MathUtils.degToRad(18);
const _up = new THREE.Vector3(0, 1, 0);

export function civilianConfig(body) {
  return { ...DEFAULT_CONFIG, body: body || pick(['sedan', 'sedan', 'muscle', 'pickup', 'coupe']), color: pick(CIVILIAN_COLORS), color2: pick(['#1a1a1a', '#d9d9d9', '#5a5a5a']),
    finish: pick(['gloss', 'gloss', 'metallic', 'matte']), livery: 'none', rim: pick(['Cragar', 'MultiSpoke', 'DeepDish']), lettering: 'none', ride: 0, camber: 0,
    front: 'none', hood: 'none', roof: Math.random() < 0.1 ? 'Roof_Taxi' : 'none', spoiler: 'none', exhaust: 'Exhaust_Stock', underglow: 'off', engine: 'v6', trans: 'balanced', tires: 'grip' };
}

/** Ground pose for a vehicle footprint: terrain height under the car plus pitch/roll from the surface normal. */
export function groundPose(x, z, heading, halfL = 2, halfW = 0.9, out = new THREE.Quaternion()) {
  const f = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
  const r = new THREE.Vector3(f.z, 0, -f.x);
  const hF = terrainHeight(x + f.x * halfL, z + f.z * halfL), hB = terrainHeight(x - f.x * halfL, z - f.z * halfL);
  const hR = terrainHeight(x + r.x * halfW, z + r.z * halfW), hL = terrainHeight(x - r.x * halfW, z - r.z * halfW);
  const fwd = f.clone().multiplyScalar(2 * halfL).setY(hF - hB).normalize();
  const right = r.clone().multiplyScalar(2 * halfW).setY(hR - hL).normalize();
  const up = new THREE.Vector3().crossVectors(fwd, right).normalize();
  if (up.y < 0) up.negate();
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(up, fwd).normalize(), up, fwd);
  out.setFromRotationMatrix(m);
  return { y: (hF + hB + hR + hL) / 4, q: out };
}

/** Seat a character on a car's Seat_Driver (lite or full visual) in the driving pose. */
export function seatDriver(vis, char) {
  vis.root.add(char.root);
  const seat = vis.n.Seat_Driver.position;
  char.root.position.set(seat.x, seat.y - 0.66, seat.z + 0.05);
  char.root.rotation.set(0, 0, 0);
  char.root.scale.setScalar(0.76);
  char.anim = 'drive';
  char.seated = vis;
}

export class Traffic {
  constructor(game) {
    this.game = game;
    this.parked = [];
    this.driving = [];
    this.graph = new RoadGraph();
    this.stats = { whiskerBrakes: 0, junctionWaits: 0, resets: 0 };
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
      b.allowSleep = true;
      b.sleepSpeedLimit = 0.15;
      b.sleepTimeLimit = 0.6;
      this.game.physics.world.addBody(b);
      const entry = { visual: vis, body: b, kind: 'parked', alarm: Math.random() < 0.55, fuel: 25 + Math.random() * 60, damage: null };
      b.userData.entry = entry;
      this.parked.push(entry);
    }
  }

  spawnDriving(n = 9) {
    for (const { seg, s } of this.graph.spawnPoints(n)) this._spawnCar(seg, s);
  }

  _spawnCar(seg, s) {
    const vis = new CarVisual(this.game.assets, civilianConfig(), { lite: true });
    this.game.scene.add(vis.root);
    const b = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, collisionFilterGroup: G.CAR, collisionFilterMask: G.CAR | G.PLAYER | G.PROP });
    const info = vis.info;
    b.addShape(new CANNON.Box(new CANNON.Vec3(vis.spec.W / 2 - 0.05, (info.belt - 0.05) / 2, info.length / 2 - 0.1)), new CANNON.Vec3(0, (info.belt + 0.05) / 2, (info.minZ + info.maxZ) / 2));
    b.userData = { kind: 'car', civilian: true };
    b.allowSleep = false;
    this.game.physics.world.addBody(b);
    // drivers are always adults (never a trick-or-treater) and carry their demographic profile for the panic line
    const driver = makePerson(this.game.assets, randomAdult(), 'driver');
    seatDriver(vis, driver);
    const car = { visual: vis, body: b, seg, s, speed: 0, target: 9 + Math.random() * 3.5, driver, kind: 'driving', stopT: 0, spin: 0, cooldown: 0, steer: 0,
      heading: 0, wait: 0, fuel: 25 + Math.random() * 60, id: Math.random().toString(36).slice(2, 7) };
    b.userData.entry = car;
    this.driving.push(car);
    this._place(car, 0);
    return car;
  }

  /** Something blocks the lane ahead: dynamic obstacles (cars, peds, player) + 3 whisker rays vs static colliders. */
  _blocked(car, p, dir) {
    const g = this.game;
    const check = (q, r = 2.2, reach = 12) => {
      const dx = q.x - p.x, dz = q.z - p.z;
      const along = dx * dir.x + dz * dir.z;
      const lat = Math.abs(dx * dir.z - dz * dir.x);
      return along > 0.5 && along < reach && lat < r;
    };
    const reach = 7 + car.speed * 0.6;
    if (!g.player.vehicle && check(g.player.position, 1.6, reach)) return 'player';
    if (g.player.vehicle && check(g.player.vehicle.position, 2.2, reach)) return 'car';
    for (const o of this.driving) if (o !== car && check(o.body.position, 1.9, reach)) return 'car';
    for (const c of g.police.cars) if (check(c.position, 2.2, reach)) return 'police';
    for (const pk of this.parked) if (check(pk.body.position, 1.7, reach)) return 'parked';
    for (const ped of g.npcs.walkers()) if (check(ped.char.root.position, 1.4, reach)) return 'ped';
    // whiskers: centre and ±18° rays up to 12 m against buildings/walls (static colliders)
    if ((car._wt = (car._wt || 0) + 1) % 4 === 0) {
      const o = new THREE.Vector3(p.x, p.y + 0.7, p.z).addScaledVector(dir, 2.4);
      car.whisker = false;
      for (const a of [0, WHISKER, -WHISKER]) {
        const d = dir.clone().applyAxisAngle(_up, a);
        const hit = g.physics.rayStatic(o, o.clone().addScaledVector(d, Math.min(12, reach)));
        const ud = hit && hit.body && hit.body.userData;
        if (ud && ud.tag !== 'curb' && ud.tag !== 'floor' && ud.kind !== 'ground') { car.whisker = true; this.stats.whiskerBrakes++; break; }
      }
    }
    return car.whisker ? 'wall' : null;
  }

  _place(car, dt) {
    const { p, dir } = car.seg.at(car.s);
    const heading = Math.atan2(dir.x, dir.z);
    let dh = heading - car.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    car.steer = THREE.MathUtils.clamp(dt ? dh / Math.max(dt, 1e-3) * 0.35 : 0, -1, 1);
    car.heading = heading;
    const { y, q } = groundPose(p.x, p.z, heading, car.visual.info.length * 0.4, car.visual.spec.W * 0.45);
    const b = car.body;
    if (dt) b.velocity.set((p.x - b.position.x) / Math.max(dt, 1e-3), 0, (p.z - b.position.z) / Math.max(dt, 1e-3));
    b.position.set(p.x, y, p.z);
    b.quaternion.set(q.x, q.y, q.z, q.w);
    car.visual.root.position.set(p.x, y, p.z);
    car.visual.root.quaternion.copy(q);
    car.ground = y;
  }

  _advance(car, dist) {
    car.s += dist;
    while (car.s > car.seg.length) {
      car.s -= car.seg.length;
      const prev = car.seg;
      if (prev.kind !== 'lane' && this.graph.nodes[prev.node].busy === car) this.graph.nodes[prev.node].busy = null;
      car.seg = car.nextSeg || pick(prev.next);
      car.nextSeg = null;
      if (car.seg.kind !== 'lane') this.graph.nodes[car.seg.node].busy = car;
    }
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
      const { p, dir } = c.seg.at(c.s);
      let target = c.target;
      if (c.cooldown > 0) { c.cooldown -= dt; target = 0; }
      if (c.disabled) target = 0;
      // slow for bends and junction connectors
      const bend = c.seg.bend(c.s, 10);
      if (c.seg.kind !== 'lane') target = Math.min(target, c.seg.kind === 'uturn' ? 4.5 : 6.5);
      else if (c.seg.length - c.s < 14) target = Math.min(target, 7);
      target = Math.min(target, Math.max(4, 12 - bend * 9));
      c.blocked = this._blocked(c, p, dir);
      if (c.blocked) target = 0;
      // junction reservation: wait at the stop line until the junction is clear
      if (c.seg.kind === 'lane' && c.seg.length - c.s < 1.2) {
        c.nextSeg ||= pick(c.seg.next);
        const node = this.graph.nodes[c.nextSeg.node];
        if (node.busy && node.busy !== c && this.driving.includes(node.busy) && (c.wait += dt) < 5) { target = 0; this.stats.junctionWaits += dt > 0 ? 0 : 0; }
        else if (c.stopT <= 0 && !c.stopped && c.seg.next.length > 1) { c.stopT = 0.9; c.stopped = true; }
      } else { c.wait = 0; if (c.seg.kind === 'lane' && c.s < 3) c.stopped = false; }
      if (c.stopT > 0) { c.stopT -= dt; target = 0; }
      c.speed += THREE.MathUtils.clamp(target - c.speed, -dt * 9, dt * 3);
      if (c.speed < 0.02 && target === 0) c.speed = 0;
      // never pass the stop line while waiting
      const room = c.seg.kind === 'lane' && target === 0 ? Math.max(0, c.seg.length - 1.0 - c.s) : Infinity;
      this._advance(c, Math.min(c.speed * dt, room));
      this._place(c, dt);
      c.spin += (c.speed * dt) / c.visual.spec.r;
      c.visual.wheelNodes.forEach((w, i) => c.visual.setWheel(i, 0, i < 2 ? c.steer * 0.5 : 0, c.spin));
      c.visual.update(dt, { brake: target < c.speed - 0.5, headlights: true, steer: c.steer * 0.5 });
      c.driver.steer = c.steer;
      if (c.driver.root.parent) c.driver.update(dt, 'drive');
    }
  }

  /** Walkers/peds use this to avoid stepping in front of traffic. */
  carsNear(p, r) { return this.driving.filter((c) => c.body.position.distanceTo(p) < r); }

  /** Watchdog: put a stray traffic car back onto the nearest lane. */
  resetToRoad(car) {
    const n = this.graph.nearest(car.body.position);
    car.seg = n.seg; car.s = n.s; car.speed = 0;
    this._place(car, 0);
    this.stats.resets++;
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
    this.game.physics.world.removeBody(entry.body);
    if (entry.kind === 'parked') this.parked.splice(this.parked.indexOf(entry), 1);
    else {
      this.driving.splice(this.driving.indexOf(entry), 1);
      for (const n of Object.values(this.graph.nodes)) if (n.busy === entry) n.busy = null;
      driver = entry.driver;
    }
    // swap the baked "lite" body for a fully articulated, repaintable one now that the player owns it
    const full = new CarVisual(this.game.assets, vis.cfg);
    full.hinges.Door_L && (full.hinges.Door_L.t = vis.hinges.Door_L ? vis.hinges.Door_L.t : 0, full.hinges.Door_L.target = 1);
    vis.dispose();
    const veh = new Vehicle(this.game, full, { kind: 'player', position: pos, heading, stolen: true });
    veh.fuel = entry.fuel ?? 25 + Math.random() * 60; // stolen cars start with 25-85 % fuel
    veh.civilianEntry = entry;
    return { vehicle: veh, driver };
  }

  /** A civilian car got rammed or shot at: stop for a moment. */
  bump(body, secs = 3 + Math.random() * 2) {
    const c = this.driving.find((d) => d.body === body);
    if (c) { c.cooldown = secs; c.speed = 0; }
    return c;
  }
}
