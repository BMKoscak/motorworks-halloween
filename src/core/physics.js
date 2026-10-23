import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { StaticGridBroadphase } from './broadphase.js';

export const G = { STATIC: 1, CAR: 2, PLAYER: 4, PROP: 8, NPC: 16 };
export const MAX_SPEED = 45; // m/s linear velocity cap for every vehicle body
export const MAX_SPIN = 12; // rad/s angular velocity cap
export const BOUNDS = 600; // |x|, |z| beyond this => watchdog reset onto the road network

export class Physics {
  constructor() {
    const w = (this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) }));
    w.broadphase = new StaticGridBroadphase(w);
    // sparse pair bookkeeping: the default dense matrix resets an N²/2 array every sub-step (~4.5 M entries here)
    w.collisionMatrix = new CANNON.ObjectCollisionMatrix();
    w.collisionMatrixPrevious = new CANNON.ObjectCollisionMatrix();
    w.solver.iterations = 10;
    // resting bodies (parked cars, knocked-over props) sleep until something hits them; driven vehicles opt out
    w.allowSleep = true;
    w.defaultContactMaterial.friction = 0.3;
    this.mat = {
      ground: new CANNON.Material('ground'),
      car: new CANNON.Material('car'),
      player: new CANNON.Material('player'),
      prop: new CANNON.Material('prop'),
    };
    const cm = (a, b, friction, restitution) => w.addContactMaterial(new CANNON.ContactMaterial(a, b, { friction, restitution }));
    cm(this.mat.ground, this.mat.car, 0.05, 0.05);
    cm(this.mat.car, this.mat.car, 0.15, 0.25);
    cm(this.mat.player, this.mat.ground, 0.0, 0.0);
    cm(this.mat.player, this.mat.car, 0.0, 0.0);
    cm(this.mat.prop, this.mat.ground, 0.6, 0.2);
    cm(this.mat.prop, this.mat.car, 0.3, 0.3);
    this.statics = [];
    this._v = new CANNON.Vec3();
    this.stats = { velocityClamps: 0, spinClamps: 0, outOfBounds: 0 };
    this.onOutOfBounds = null;
    // safety clamps on every internal sub-step: no vehicle may exceed 45 m/s or spin faster than 12 rad/s
    w.addEventListener('postStep', () => this._clamp());
  }

  _clamp() {
    for (const b of this.world.bodies) {
      const ud = b.userData;
      if (!ud || ud.kind !== 'car' || b.type !== CANNON.Body.DYNAMIC) continue;
      const v = b.velocity, w = b.angularVelocity;
      const l = v.length();
      if (l > MAX_SPEED) { v.scale(MAX_SPEED / l, v); this.stats.velocityClamps++; }
      const a = w.length();
      if (a > MAX_SPIN) { w.scale(MAX_SPIN / a, w); this.stats.spinClamps++; }
      const p = b.position;
      if (!Number.isFinite(p.x + p.y + p.z + l + a) || Math.abs(p.x) > BOUNDS || Math.abs(p.z) > BOUNDS || p.y < -20 || p.y > 150) {
        this.stats.outOfBounds++;
        if (!Number.isFinite(l + a)) { v.setZero(); w.setZero(); }
        if (this.onOutOfBounds) this.onOutOfBounds(b);
      }
    }
  }

  addStaticBox(center, half, quat, opts = {}) {
    const b = new CANNON.Body({ mass: 0, type: opts.kinematic ? CANNON.Body.KINEMATIC : CANNON.Body.STATIC, material: this.mat.ground,
      collisionFilterGroup: G.STATIC, collisionFilterMask: G.CAR | G.PLAYER | G.PROP | G.NPC });
    b.addShape(new CANNON.Box(new CANNON.Vec3(Math.max(0.02, half.x), Math.max(0.02, half.y), Math.max(0.02, half.z))));
    b.position.set(center.x, center.y, center.z);
    if (quat) b.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    b.userData = { kind: 'static', tag: opts.tag };
    this.world.addBody(b);
    this.statics.push(b);
    return b;
  }

  /** Turn every COL_* mesh under root into a static box collider. Returns created bodies. */
  collidersFrom(root, opts = {}) {
    root.updateMatrixWorld(true);
    const out = [];
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    root.traverse((o) => {
      if (!o.isMesh || !o.name.startsWith('COL_')) return;
      o.visible = false;
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      const c = bb.getCenter(new THREE.Vector3()).applyMatrix4(o.matrixWorld);
      o.matrixWorld.decompose(p, q, s);
      const size = bb.getSize(new THREE.Vector3()).multiply(s).multiplyScalar(0.5);
      const body = this.addStaticBox(c, size, q, opts);
      body.userData.node = o;
      body.userData.localCenter = bb.getCenter(new THREE.Vector3());
      out.push(body);
    });
    return out;
  }

  /** Re-sync colliders whose nodes move (gates, doors). */
  syncCollider(body) {
    const o = body.userData.node;
    const c = body.userData.localCenter.clone().applyMatrix4(o.matrixWorld);
    const q = new THREE.Quaternion();
    o.matrixWorld.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    body.position.set(c.x, c.y, c.z);
    body.quaternion.set(q.x, q.y, q.z, q.w);
    body.aabbNeedsUpdate = true;
  }

  addHeightfield(heightFn, x0, x1, z0, z1, es) {
    const nx = Math.round((x1 - x0) / es) + 1;
    const nz = Math.round((z1 - z0) / es) + 1;
    const data = [];
    for (let i = 0; i < nx; i++) {
      const row = [];
      for (let j = 0; j < nz; j++) row.push(heightFn(x0 + i * es, z1 - j * es));
      data.push(row);
    }
    const shape = new CANNON.Heightfield(data, { elementSize: es });
    const b = new CANNON.Body({ mass: 0, material: this.mat.ground, collisionFilterGroup: G.STATIC, collisionFilterMask: -1 });
    b.addShape(shape);
    b.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    b.position.set(x0, 0, z1);
    b.userData = { kind: 'ground' };
    this.world.addBody(b);
    this.ground = b;
    return b;
  }

  /** Closest hit against static geometry only (camera collision, line of sight). */
  rayStatic(from, to) {
    const r = new CANNON.RaycastResult();
    this.world.raycastClosest(new CANNON.Vec3(from.x, from.y, from.z), new CANNON.Vec3(to.x, to.y, to.z),
      { collisionFilterMask: G.STATIC, skipBackfaces: true }, r);
    return r.hasHit ? { point: new THREE.Vector3(r.hitPointWorld.x, r.hitPointWorld.y, r.hitPointWorld.z), distance: r.distance, body: r.body } : null;
  }

  rayAny(from, to, mask = -1) {
    const r = new CANNON.RaycastResult();
    this.world.raycastClosest(new CANNON.Vec3(from.x, from.y, from.z), new CANNON.Vec3(to.x, to.y, to.z),
      { collisionFilterMask: mask, skipBackfaces: true }, r);
    return r.hasHit ? { point: new THREE.Vector3(r.hitPointWorld.x, r.hitPointWorld.y, r.hitPointWorld.z), distance: r.distance, body: r.body } : null;
  }

  step(dt) {
    this.world.step(1 / 60, dt, 8); // capped sub-steps: a slow frame never snowballs into a slower one
  }
}

export const v3 = (v) => new THREE.Vector3(v.x, v.y, v.z);
