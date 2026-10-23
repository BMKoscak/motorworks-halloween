import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { G } from '../core/physics.js';
import { ENGINES, TRANSMISSIONS, TIRES } from '../config.js';

const UP = new THREE.Vector3(0, 1, 0);
let VEH_ID = 0;

/**
 * Raycast-vehicle physics (cannon-es) wrapped around a CarVisual.
 * Rear-wheel drive, speed-sensitive steering, weight transfer via soft suspension,
 * handbrake drift (rear grip drop), skid marks + tire smoke, downforce and self-righting.
 */
export class Vehicle {
  constructor(game, visual, opts = {}) {
    this.id = ++VEH_ID;
    this.game = game;
    this.visual = visual;
    this.kind = opts.kind || 'player';
    this.cfg = visual.cfg;
    this.stolen = !!opts.stolen;
    this.controls = { throttle: 0, steer: 0, brake: 0, handbrake: false };
    this.steer = 0;
    this.rpm = 800;
    this.gear = 1;
    this.alive = true;
    this.flipTimer = 0;
    this.backfire = 0;
    this.lastImpact = 0;
    // fuel tank (0-100 %), damage model
    this.fuel = opts.fuel ?? 100;
    this.tankGallons = 16;
    this.stalled = false;
    this.flats = [false, false, false, false];
    this.engineHealth = 100;
    this.onFire = 0;
    this.stats = { fuelUsed: 0 };
    visual.opts.physics = true;
    visual.model.position.y = 0;
    this._build(opts.position || new THREE.Vector3(), opts.heading || 0);
    game.scene.add(visual.root);
    game.vehicles.push(this);
    this.sync();
  }

  _tuning() {
    const c = this.visual.cfg;
    const eng = ENGINES.find((e) => e.id === c.engine) || ENGINES[0];
    const tr = TRANSMISSIONS.find((t) => t.id === c.trans) || TRANSMISSIONS[1];
    const ti = TIRES.find((t) => t.id === c.tires) || TIRES[0];
    const police = this.kind === 'police';
    return {
      eng, tr, ti,
      force: eng.force * tr.accel * (police ? 1.08 : 1),
      top: eng.top * tr.top * (police ? 1.02 : 1),
      friction: ti.friction, rearFriction: ti.rearFriction,
    };
  }

  _build(pos, heading) {
    const v = this.visual, s = v.spec, info = v.info;
    this.tune = this._tuning();
    this.cy = 0.5;
    const ride = v.rideOffset || 0;
    this.restLen = 0.34 + ride;
    const bottom = s.yb + 0.04, top = info.belt;
    const half = new CANNON.Vec3(s.W / 2 - 0.06, (top - bottom) / 2, info.length / 2 - 0.12);
    const body = (this.body = new CANNON.Body({ mass: this.kind === 'police' ? 1450 : 1300, material: this.game.physics.mat.car,
      collisionFilterGroup: G.CAR, collisionFilterMask: G.STATIC | G.CAR | G.PLAYER | G.PROP }));
    body.addShape(new CANNON.Box(half), new CANNON.Vec3(0, (top + bottom) / 2 - this.cy, (info.minZ + info.maxZ) / 2));
    // low cabin box so roofs collide too
    body.addShape(new CANNON.Box(new CANNON.Vec3(s.W / 2 - 0.2, 0.2, info.length / 4)), new CANNON.Vec3(0, top + 0.2 - this.cy, (info.minZ + info.maxZ) / 2 - 0.2));
    body.angularDamping = 0.35;
    body.linearDamping = 0.02;
    body.allowSleep = false; // raycast-vehicle chassis must never doze off mid-drive
    body.position.set(pos.x, pos.y + this.cy + 0.05, pos.z);
    body.quaternion.setFromEuler(0, heading, 0);
    body.userData = { kind: 'car', vehicle: this };
    const veh = (this.raycast = new CANNON.RaycastVehicle({ chassisBody: body, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 }));
    const base = {
      radius: s.r, directionLocal: new CANNON.Vec3(0, -1, 0), axleLocal: new CANNON.Vec3(-1, 0, 0),
      suspensionStiffness: 32, suspensionRestLength: this.restLen, dampingRelaxation: 2.4, dampingCompression: 4.2,
      maxSuspensionForce: 120000, maxSuspensionTravel: 0.32, rollInfluence: 0.06, frictionSlip: this.tune.friction,
      customSlidingRotationalSpeed: -30, useCustomSlidingRotationalSpeed: true,
    };
    this.connY = s.r + this.restLen - this.cy;
    for (const [x, z] of [[s.wx, s.af], [-s.wx, s.af], [s.wx, s.ar], [-s.wx, s.ar]]) {
      veh.addWheel({ ...base, chassisConnectionPointLocal: new CANNON.Vec3(x, this.connY, z), frictionSlip: z < 0 ? this.tune.rearFriction : this.tune.friction });
    }
    veh.addToWorld(this.game.physics.world);
    body.addEventListener('collide', (e) => this._onCollide(e));
  }

  /** Rebuild tuning after the kiosk/custom bay changes the config. */
  retune() {
    this.tune = this._tuning();
    this.raycast.wheelInfos.forEach((w, i) => (w.frictionSlip = i < 2 ? this.tune.friction : this.tune.rearFriction));
  }

  _onCollide(e) {
    const imp = Math.abs(e.contact.getImpactVelocityAlongNormal());
    const other = e.body === this.body ? e.target : e.body;
    if (imp > 3 && performance.now() - this.lastImpact > 250) {
      this.lastImpact = performance.now();
      const ri = e.contact.bi === this.body ? e.contact.ri : e.contact.rj;
      const p = new THREE.Vector3(this.body.position.x + ri.x, this.body.position.y + ri.y, this.body.position.z + ri.z);
      this.game.events.emit('impact', { vehicle: this, other, speed: imp, point: p });
    }
  }

  get position() { return this.body.position; }
  get forward() { return new THREE.Vector3(0, 0, 1).applyQuaternion(this.body.quaternion); }
  get speed() {
    const f = this.forward, v = this.body.velocity;
    return f.x * v.x + f.y * v.y + f.z * v.z;
  }
  get speedAbs() { return this.body.velocity.length(); }
  get heading() { const f = this.forward; return Math.atan2(f.x, f.z); }

  setControls(c) { Object.assign(this.controls, c); }

  teleport(pos, heading) {
    const b = this.body;
    b.position.set(pos.x, pos.y + this.cy + 0.3, pos.z);
    b.quaternion.setFromEuler(0, heading, 0);
    b.velocity.setZero();
    b.angularVelocity.setZero();
    this.sync();
  }

  /** Fuel burn per second at full throttle & redline, by engine (V8 blower and twin-turbo drink more). */
  get burnRate() { return { v6: 0.32, v8sc: 0.46, tt: 0.56 }[this.tune.eng.id] || 0.35; }

  popTire(i) {
    if (this.flats[i]) return;
    this.flats[i] = true;
    const w = this.raycast.wheelInfos[i];
    w.frictionSlip *= 0.45;
    w.radius = this.visual.spec.r * 0.82;
    this.game.audio.tirePop();
    this.game.effects.dust(this.visual.wheelNodes[i].knuckle.getWorldPosition(new THREE.Vector3()), 10, '#444');
  }

  damageEngine(n) {
    this.engineHealth = Math.max(0, this.engineHealth - n);
    if (this.engineHealth <= 0 && !this.onFire) { this.onFire = 12; this.game.audio.sputter(); }
  }

  refuel(pct) { this.fuel = Math.min(100, this.fuel + pct); if (this.fuel > 0.5 && this.stalled && this.engineHealth > 0) this.stalled = false; }

  update(dt) {
    const c = this.controls, veh = this.raycast, t = this.tune;
    const speed = this.speed, abs = Math.abs(speed);
    // fuel: drains with throttle and rpm; empty tank (or a dead engine) stalls the car with a sputter
    if (this.kind === 'player' && !this.parkedByPlayer) {
      const rpmK = (this.rpm - t.eng.idle) / (t.eng.redline - t.eng.idle);
      const burn = (0.012 + Math.abs(c.throttle) * (0.35 + 0.65 * Math.max(0, rpmK))) * this.burnRate * dt;
      if (this.game.player.vehicle === this) { this.fuel = Math.max(0, this.fuel - burn); this.stats.fuelUsed += burn; }
      if (this.fuel <= 0 && !this.stalled) { this.stalled = true; this.game.audio.sputter(); this.backfire = 0.6; this.game.events.emit('stall', { reason: 'fuel' }); }
      if (this.fuel > 0 && this.fuel < 4 && c.throttle > 0.3 && Math.random() < dt * 1.5) { this.backfire = 0.25; this.game.audio.sputter(); }
    }
    if (this.engineHealth <= 0) this.stalled = true;
    const dead = this.stalled;
    // speed-sensitive steering with smoothing
    const maxSteer = THREE.MathUtils.lerp(0.62, 0.17, THREE.MathUtils.clamp(abs / 38, 0, 1));
    const target = THREE.MathUtils.clamp(c.steer, -1, 1) * maxSteer;
    const rate = Math.sign(target) !== Math.sign(this.steer) || Math.abs(target) < Math.abs(this.steer) ? 5.5 : 3.2;
    this.steer += THREE.MathUtils.clamp(target - this.steer, -rate * dt, rate * dt);
    veh.setSteeringValue(this.steer, 0);
    veh.setSteeringValue(this.steer, 1);
    // throttle / brake / reverse
    let engine = 0, brake = 0;
    const flats = this.flats.filter(Boolean).length;
    const top = t.top * Math.pow(0.72, flats) * (this.engineHealth < 30 ? 0.6 : 1);
    if (c.throttle > 0) {
      if (speed < -1) brake = 40 * c.throttle;
      else engine = abs < top ? t.force * c.throttle * (1 - Math.pow(Math.max(0, speed) / top, 3) * 0.6) : 0;
    } else if (c.throttle < 0) {
      if (speed > 1) brake = 75 * -c.throttle;
      else engine = speed > -12 ? -t.force * 0.55 * -c.throttle : 0;
    } else brake = 2.2;
    if (dead) engine = 0;
    if (c.brake) brake = Math.max(brake, 50 * c.brake);
    // cannon-es drives along -forwardWS for a +Z-forward / -X-axle chassis, hence the sign flip
    veh.applyEngineForce(-engine, 2);
    veh.applyEngineForce(-engine, 3);
    for (let i = 0; i < 4; i++) veh.setBrake(i < 2 ? brake : brake, i);
    const hb = c.handbrake;
    veh.wheelInfos[2].frictionSlip = veh.wheelInfos[3].frictionSlip = hb ? (t.rearFriction < 3 ? 0.9 : 1.2) : t.rearFriction;
    // stability assist: damp runaway yaw when the driver isn't deliberately drifting
    this.body.angularDamping = hb ? 0.25 : abs > 8 ? 0.55 : 0.35;
    if (hb) { veh.setBrake(Math.max(brake, 28), 2); veh.setBrake(Math.max(brake, 28), 3); }
    // downforce keeps it planted at speed
    const df = 0.9 * speed * speed;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.body.quaternion);
    this.body.applyForce(new CANNON.Vec3(-up.x * df, -up.y * df, -up.z * df)); // applied at the centre of mass
    // self-righting
    if (up.y < 0.3 && abs < 2) {
      this.flipTimer += dt;
      if (this.flipTimer > 2.5) this.reset();
    } else this.flipTimer = 0;
    // engine simulation (gears & rpm for audio and blower)
    const tops = [0.24, 0.42, 0.6, 0.8, 1.0].map((k) => k * t.top);
    let g = tops.findIndex((x) => abs < x * 0.97);
    if (g < 0) g = 4;
    if (speed < -0.5) g = -1;
    const lo = g > 0 ? tops[g - 1] : 0, hi = g >= 0 ? tops[g] : 12;
    const frac = THREE.MathUtils.clamp((abs - lo * 0.7) / (hi - lo * 0.7), 0, 1);
    let targetRpm = t.eng.idle + (t.eng.redline - t.eng.idle) * Math.max(frac, Math.abs(c.throttle) * (abs < 1 ? 0.45 : 0.1));
    if (dead) targetRpm = abs * 40;
    // damage: smoke from the engine bay (white -> black), fire when dead; sparks from flat rims
    const fx = this.game.effects;
    if (fx && (this.engineHealth < 60 || this.onFire)) {
      const bay = this.visual.n.EngineBay;
      if (bay && Math.random() < dt * (this.engineHealth < 30 ? 14 : 7)) {
        const p = bay.getWorldPosition(new THREE.Vector3()); p.y += 0.4;
        if (this.engineHealth < 30) fx.emit(p, new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.4, (Math.random() - 0.5) * 0.6), '#1c1a19', 0.7, 2.2, { grow: 2.2, alpha: 0.6, drag: 0.6 });
        else fx.smoke(p);
        if (this.onFire) fx.emit(p, new THREE.Vector3((Math.random() - 0.5), 2.2, (Math.random() - 0.5)), Math.random() < 0.5 ? '#ff7a1a' : '#ffcf40', 0.45, 0.6, { additive: true, grow: 0.8 });
      }
    }
    if (this.onFire) this.onFire = Math.max(0.0001, this.onFire - dt);
    if (fx && flats && abs > 3) this.flats.forEach((f, i) => { if (f && Math.random() < dt * 25) fx.sparks(this.raycast.wheelInfos[i].raycastResult.hitPointWorld ? new THREE.Vector3().copy(this.raycast.wheelInfos[i].raycastResult.hitPointWorld) : this.visual.wheelNodes[i].knuckle.getWorldPosition(new THREE.Vector3()), 3, '#ffd08a', 2); });
    if (this.gear !== g + 1 && c.throttle > 0.5 && this.gear > 0 && g + 1 > this.gear && this.rpm > t.eng.redline * 0.8) this.backfire = 0.25;
    this.gear = g + 1;
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 6);
    if (this.lastThrottle > 0.6 && c.throttle < 0.1 && this.rpm > t.eng.redline * 0.6) this.backfire = 0.35;
    this.lastThrottle = c.throttle;
    this.backfire = Math.max(0, this.backfire - dt);
    this.sliding = false;
  }

  reset() {
    const h = this.heading;
    this.teleport(new THREE.Vector3(this.body.position.x, this.game.heightAt(this.body.position.x, this.body.position.z) + 0.5, this.body.position.z), h);
  }

  sync(dt = 0) {
    const b = this.body, v = this.visual;
    const q = new THREE.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    const off = new THREE.Vector3(0, -this.cy, 0).applyQuaternion(q);
    v.root.position.set(b.position.x + off.x, b.position.y + off.y, b.position.z + off.z);
    v.root.quaternion.copy(q);
    const fx = this.game.effects;
    const lateral = new THREE.Vector3(1, 0, 0).applyQuaternion(q).dot(new THREE.Vector3(b.velocity.x, b.velocity.y, b.velocity.z));
    this.lateral = lateral;
    for (let i = 0; i < 4; i++) {
      const w = this.raycast.wheelInfos[i];
      const susp = w.raycastResult.hasHit ? this.restLen - w.suspensionLength : -0.12;
      v.setWheel(i, susp, w.steering, w.rotation);
      if (!dt || !w.raycastResult.hasHit) continue;
      const slip = w.skidInfo < 0.55 || (i >= 2 && this.controls.handbrake && Math.abs(this.speed) > 4) || (Math.abs(lateral) > 4.5 && Math.abs(this.speed) > 5);
      if (slip && fx) {
        this.sliding = true;
        const hp = w.raycastResult.hitPointWorld;
        const p = new THREE.Vector3(hp.x, hp.y, hp.z);
        fx.skid(this.id * 10 + i, p, null, 0.24 * (v.spec.r / 0.36));
        if (Math.random() < dt * 22) fx.smoke(p.setY(p.y + 0.2));
      }
    }
    v.update(dt, { steer: this.steer, rpm: this.rpm, brake: this.controls.throttle < 0 && this.speed > 1, backfire: this.backfire > 0,
      throttle: this.controls.throttle, siren: this.siren, hazard: this.hazard, headlights: this.kind === 'player' ? v.lights.head : true,
      glowFlicker: this.kind === 'player' && !v.lights.head ? 0 : undefined });
    for (const w of this.flats.map((f, i) => (f ? i : -1)).filter((i) => i >= 0)) v.wheelNodes[w].knuckle.position.y -= 0.1;
    if (this.driver) { this.driver.steer = THREE.MathUtils.clamp(this.steer * 2.2, -1, 1); this.driver.update(dt, 'drive'); }
  }

  remove() {
    this.alive = false;
    const i = this.game.vehicles.indexOf(this);
    if (i >= 0) this.game.vehicles.splice(i, 1);
    this.raycast.removeFromWorld(this.game.physics.world);
    this.visual.dispose();
  }
}
