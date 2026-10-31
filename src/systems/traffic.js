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
const _left = new THREE.Vector3();
const _pos = new THREE.Vector3();

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
    this.stats = { whiskerBrakes: 0, junctionWaits: 0, resets: 0, redStops: 0, redRuns: 0, stopSigns: 0, honks: 0, rage: 0, relocated: 0 };
    this.closed = null;
  }

  /** Close roads (drag race): cars on them are moved elsewhere and junction choices avoid them until openRoads(). */
  closeRoads(ids) {
    this.closed = new Set(ids);
    for (const c of this.driving) if (this._isClosed(c.seg)) this._relocate(c);
  }

  openRoads() { this.closed = null; }

  _isClosed(seg) {
    if (!this.closed || !seg) return false;
    return this.closed.has(seg.road) || (seg.kind !== 'lane' && seg.next[0] && this.closed.has(seg.next[0].road));
  }

  _pickNext(seg) {
    const opts = seg.next.filter((s) => !this._isClosed(s));
    return opts.length ? pick(opts) : null;
  }

  _relocate(c) {
    const open = this.graph.lanes.filter((l) => !this._isClosed(l));
    const far = open.filter((l) => l.pts[0].distanceTo(this.game.player.position) > 60);
    const l = pick(far.length ? far : open);
    c.seg = l; c.s = Math.min(l.length - 2, 4); c.speed = 0; c.nextSeg = null; c.lat = 0; c.latV = 0; c.ot = null;
    for (const n of Object.values(this.graph.nodes)) if (n.busy === c) n.busy = null;
    this._place(c, 0);
    this.stats.relocated++;
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

  spawnDriving(n = 12) {
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
      heading: 0, wait: 0, blockedT: 0, fuel: 25 + Math.random() * 60, id: Math.random().toString(36).slice(2, 7) };
    b.userData.entry = car;
    this.driving.push(car);
    this._place(car, 0);
    return car;
  }

  /** Something blocks the lane ahead: dynamic obstacles (cars, peds, player) along the car's path. */
  _blocked(car, p, dir) {
    const g = this.game;
    const lookDir = car.seg.at(Math.min(car.seg.length, car.s + 3.5)).dir;
    const fwd = dir.clone().lerp(lookDir, 0.45).normalize();
    // what blocked us (position + its speed) is kept for the overtake decision
    const check = (q, r = 2.0, reach = 11, speed = 0) => {
      const dx = q.x - p.x, dz = q.z - p.z;
      const along = dx * fwd.x + dz * fwd.z;
      const lat = Math.abs(dx * fwd.z - dz * fwd.x);
      const hit = along > 1.2 && along < reach && lat < r;
      if (hit) { car.blockPos = q; car.blockSpeed = speed; }
      return hit;
    };
    const reach = 6.5 + car.speed * 0.55;
    // something standing still in the lane needs the braking distance on top (v^2 / 2a at ~7 m/s^2): with the
    // following-distance reach alone a car at 12 m/s saw an abandoned car too late and shunted it down the street
    const stopReach = reach + (car.speed * car.speed) / 14;
    if (!g.player.vehicle && check(g.player.position, 1.5, reach, 1)) return 'player';
    if (g.player.vehicle && check(g.player.vehicle.position, 2.0, reach, g.player.vehicle.speedAbs)) return 'car';
    for (const o of this.driving) {
      if (o === car) continue;
      // Cars already clearing a junction connector have right-of-way over cars waiting on lanes
      if (car.seg.kind !== 'lane' && o.seg.kind === 'lane' && o.speed < 0.5) continue;
      // Ignore oncoming cars in opposite lanes so curves/turns never cause mutual deadlocks
      const oDir = o.seg.at(o.s).dir;
      if (oDir.dot(dir) < -0.25) continue;
      // a stalled / rammed car (cooldown, disabled) counts as a stationary obstacle that can be overtaken
      if (check(o.body.position, 1.75, reach, o.cooldown > 0 || o.disabled ? 0 : Math.max(o.speed, o.redHold || o.wait > 0 ? 1 : 0))) { car.blockCar = o; return 'car'; }
    }
    // a cruiser parked in the lane (a dismounted officer, a stop) is passed like any stationary car; one on the move is followed
    for (const c of g.police.cars) if (check(c.position, 2.0, c.vehicle.speedAbs < 0.5 ? stopReach : reach, c.vehicle.speedAbs)) return 'police';
    for (const pk of this.parked) if (check(pk.body.position, 1.55, Math.min(8, reach), 0)) return 'parked';
    // cars the player has parked, abandoned or stolen-and-dumped are Vehicles outside the lists above: traffic used to
    // drive straight into them (Phase 4 fix); they are obstacles like any parked car, and can be overtaken
    for (const v of g.vehicles) if (v.kind === 'player' && v !== g.player.vehicle && check(v.body.position, 1.75, v.speedAbs < 0.5 ? stopReach : reach, v.speedAbs)) return 'parked';
    for (const ped of g.npcs.walkers()) if (check(ped.char.root.position, 1.3, Math.min(8, reach), 1)) return 'ped';
    car.whisker = false;
    return null;
  }

  /** Is the oncoming lane free of traffic over the next `ahead` metres? (overtaking) */
  _oncomingClear(c, p, dir, ahead) {
    const W = (c.seg.w || 2.6) * 2;
    const g = this.game;
    const free = (q) => {
      const dx = q.x - p.x, dz = q.z - p.z;
      const along = dx * dir.x + dz * dir.z, lat = dx * dir.z - dz * dir.x; // lat > 0: towards the car's left
      return !(along > -8 && along < ahead && lat > W * 0.4 && lat < W * 1.7);
    };
    for (const o of this.driving) if (o !== c && !free(o.body.position)) return false;
    for (const pc of g.police.cars) if (!free(pc.position)) return false;
    if (g.player.vehicle && !free(g.player.vehicle.position)) return false;
    return true;
  }

  /**
   * Lane changes (Phase 4). Streets are one lane each way, so a lane change is an overtake: stuck >1.6 s behind
   * something stationary (a parked or abandoned car, a stalled or rammed car), with 45 m of oncoming lane clear and
   * the junction far enough away, the car signals left, swings out, passes, signals right and merges back.
   * It aborts back into its lane if oncoming traffic shows up or the junction comes too close.
   */
  _laneChange(c, dt, p, dir, toEnd) {
    const W = (c.seg.w || 2.6) * 2;
    const O = c.ot;
    if (!O) {
      if (c.seg.kind !== 'lane' || c.redHold || c.s < 4 || c.blockedT < 1.6) return;
      if (!['parked', 'car', 'player', 'police'].includes(c.blocked) || (c.blockSpeed || 0) > 0.5 || !c.blockPos) return;
      // enough lane left to get past the obstacle (and 7 m beyond it) and back in before the junction
      const alongObs = (c.blockPos.x - p.x) * dir.x + (c.blockPos.z - p.z) * dir.z;
      if (toEnd < alongObs + 11) return;
      if (!this._oncomingClear(c, p, dir, 45)) return;
      c.ot = { phase: 'out', obs: c.blockPos.clone(), road: c.seg.road, lane: c.seg };
      this.stats.overtakes = (this.stats.overtakes || 0) + 1;
      return;
    }
    if (c.seg !== O.lane && O.phase !== 'back') { O.phase = 'back'; }
    if (O.phase === 'out') {
      c.latV = 1.7;
      if (c.lat >= W - 0.05) O.phase = 'pass';
    } else if (O.phase === 'pass') {
      c.latV = 0;
      const along = (O.obs.x - p.x) * dir.x + (O.obs.z - p.z) * dir.z;
      if (along < -7) O.phase = 'back';
    } else c.latV = -1.5;
    const abort = O.phase === 'out' ? !this._oncomingClear(c, p, dir, 24) : O.phase === 'pass' && (!this._oncomingClear(c, p, dir, 10) || toEnd < 3);
    if (abort) { O.phase = 'back'; this.stats.overtakeAborts = (this.stats.overtakeAborts || 0) + 1; }
    c.lat = THREE.MathUtils.clamp(c.lat + c.latV * dt, 0, W);
    if (O.phase === 'back' && c.lat <= 0) { c.ot = null; c.latV = 0; this.stats.overtakesDone = (this.stats.overtakesDone || 0) + 1; }
  }

  /** 'L' / 'R' / null: indicate ~30 m before a turn and through it; left out and right back in while overtaking. */
  _signal(c, toEnd) {
    if (c.ot) return c.ot.phase === 'back' ? 'R' : 'L';
    if (c.seg.kind !== 'lane') return c.seg.turnSide();
    if (toEnd < 30) {
      c.nextSeg ||= this._pickNext(c.seg);
      return c.nextSeg ? c.nextSeg.turnSide() : null;
    }
    return null;
  }

  _place(car, dt) {
    const at = car.seg.at(car.s), dir = at.dir;
    // lateral offset while overtaking: lat metres towards the car's left (the oncoming lane)
    const p = car.lat ? at.p.addScaledVector(_left.set(dir.z, 0, -dir.x), car.lat) : at.p;
    let heading = Math.atan2(dir.x, dir.z);
    if (car.latV) heading += Math.atan2(car.latV, Math.max(2, car.speed));
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
      // QA instrumentation: a car leaving a signalised lane must have had green/yellow (or been committed on yellow)
      if (prev.kind === 'lane' && prev.control && prev.control.control === 'signal' && !car.committed && this.game.signals.forApproach(prev.to, prev.road) === 'red' && this.game.signals.forApproach(prev.to, prev.road, 1.2) === 'red') this.stats.redRuns++;
      if (prev.kind !== 'lane' && this.graph.nodes[prev.node].busy === car) this.graph.nodes[prev.node].busy = null;
      car.seg = car.nextSeg || this._pickNext(prev) || pick(prev.next);
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
      // obstacle checks from where the car really is (it may be out in the oncoming lane, overtaking)
      const here = c.lat ? _pos.copy(p).addScaledVector(_left.set(dir.z, 0, -dir.x), c.lat) : p;
      c.blocked = this._blocked(c, here, dir);
      // in a queue behind something standing in the lane (used by the deadlock rule below)
      c.queued = ['parked', 'police'].includes(c.blocked) || (c.blocked === 'car' && !!c.blockCar && !!c.blockCar.queued);
      c.honkCd = Math.max(0, (c.honkCd || 0) - dt);
      if ((c.blocked === 'player' || (c.blocked === 'car' && this.game.player.vehicle && this.game.player.vehicle.position.distanceTo(c.body.position) < 14)) && c.blockedT > 2.2 && c.honkCd <= 0) {
        c.honkCd = 5 + Math.random() * 4;
        this.stats.honks++;
        this.game.audio.honkAt(c.body.position, this.game.listener);
      }
      if (c.blocked) {
        c.blockedT = (c.blockedT || 0) + dt;
        // swinging out around the obstacle: creep forward while the gap opens
        if (c.ot && c.ot.phase === 'out') target = 1.2;
        // Break any car-vs-car deadlock after 2.5s so traffic always flows
        // (not inside a queue waiting behind an obstacle: creeping there just stacked the queue into one spot)
        else if (c.blocked === 'car' && c.blockedT > 2.5 && !(c.blockCar && c.blockCar.queued)) target = 3.5;
        // a car or cruiser left standing where it can't be overtaken used to hold its queue forever: nudge it along
        else if (['police', 'parked'].includes(c.blocked) && c.blockedT > 8 && (c.blockSpeed || 0) < 0.5) target = 2;
        else target = 0;
      } else {
        c.blockedT = 0;
      }
      // junction control at the end of each lane: traffic lights (stop on red, and on yellow when there is room to
      // brake), stop signs (full stop), then the junction reservation so only one car crosses a node at a time
      const ctrl = c.seg.kind === 'lane' ? c.seg.control : null;
      const toEnd = c.seg.length - c.s;
      if (ctrl && ctrl.control === 'signal' && toEnd < 32) {
        const light = this.game.signals.forApproach(c.seg.to, c.seg.road);
        if (!c.committed && (light === 'red' || (light === 'yellow' && toEnd - 1 > (c.speed * c.speed) / 12))) {
          target = Math.min(target, toEnd < 2.4 ? 0 : Math.max(0, (toEnd - 1.4) * 0.8));
          if (!c.redHold) this.stats.redStops++;
          c.redHold = true;
        } else { c.redHold = false; if (light === 'green' || light === 'yellow') c.committed = toEnd < 3 && c.speed > 3; }
        if (c.committed && c.speed < 1) c.committed = false; // held at the line (junction busy): no longer committed
      } else c.committed = false;
      if (c.seg.kind === 'lane' && toEnd < 1.2) {
        c.nextSeg ||= this._pickNext(c.seg);
        if (!c.nextSeg) { this._relocate(c); continue; }
        const node = this.graph.nodes[c.nextSeg.node];
        if (node.busy && (!this.driving.includes(node.busy) || node.busy.seg.node !== node.id)) node.busy = null;
        if (c.redHold) target = 0;
        else if (node.busy && node.busy !== c && (c.wait += dt) < 3.5) { target = 0; this.stats.junctionWaits++; }
        else if (c.stopT <= 0 && !c.stopped && ctrl && ctrl.control === 'stop') { c.stopT = 1.1; c.stopped = true; this.stats.stopSigns = (this.stats.stopSigns || 0) + 1; }
      } else { c.wait = 0; if (c.seg.kind === 'lane' && c.s < 3) c.stopped = false; }
      if (c.stopT > 0) { c.stopT -= dt; target = 0; }
      c.speed += THREE.MathUtils.clamp(target - c.speed, -dt * 9, dt * 3);
      if (c.speed < 0.02 && target === 0) c.speed = 0;
      this._laneChange(c, dt, p, dir, toEnd);
      c.signal = this._signal(c, toEnd);
      if (c.signal) this.stats.signalling = (this.stats.signalling || 0) + dt;
      // never pass the stop line while waiting
      const room = c.seg.kind === 'lane' && target === 0 ? Math.max(0, c.seg.length - 1.0 - c.s) : Infinity;
      this._advance(c, Math.min(c.speed * dt, room));
      this._place(c, dt);
      c.spin += (c.speed * dt) / c.visual.spec.r;
      c.visual.wheelNodes.forEach((w, i) => c.visual.setWheel(i, 0, i < 2 ? c.steer * 0.5 : 0, c.spin));
      c.visual.update(dt, { brake: target < c.speed - 0.5, headlights: true, steer: c.steer * 0.5, signal: c.signal });
      c.driver.steer = c.steer;
      if (c.driver.root.parent) c.driver.update(dt, 'drive');
    }
  }

  /** Walkers/peds use this to avoid stepping in front of traffic. */
  carsNear(p, r) { return this.driving.filter((c) => c.body.position.distanceTo(p) < r); }

  /** Watchdog: put a stray traffic car back onto the nearest lane. */
  resetToRoad(car) {
    const n = this.graph.nearest(car.body.position);
    car.seg = n.seg; car.s = n.s; car.speed = 0; car.lat = 0; car.latV = 0; car.ot = null;
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
  bump(body, secs = 3 + Math.random() * 2, impact = 0) {
    const c = this.driving.find((d) => d.body === body);
    if (!c) return null;
    c.cooldown = secs; c.speed = 0;
    // road rage: a real hit gets a long honk and a shouted line from the driver (their own voice/gender)
    if (impact > 5 && !(c.rageCd > this.game.time)) {
      c.rageCd = this.game.time + 12;
      this.stats.rage++;
      const g = this.game, drv = c.driver;
      setTimeout(() => {
        if (!this.driving.includes(c)) return;
        g.audio.honkAt(c.body.position, g.listener, 1.2);
        if (c.body.position.distanceTo(g.player.position) < 25) g.npcs.speak({ profile: drv.profile, char: drv }, drv.profile.ageGroup === 'adult_female' ? 'rage_f' : 'rage_m');
      }, 700);
    }
    return c;
  }
}
