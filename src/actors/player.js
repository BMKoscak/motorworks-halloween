import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Character } from './character.js';
import { G } from '../core/physics.js';

/** On-foot player: capsule-ish rigid body (two spheres), camera-relative movement, jump, and the articulated rig. */
export class Player {
  constructor(game, pos) {
    this.game = game;
    this.char = new Character(game.assets, 'player');
    game.scene.add(this.char.root);
    const b = (this.body = new CANNON.Body({ mass: 70, fixedRotation: true, material: game.physics.mat.player, linearDamping: 0.0,
      collisionFilterGroup: G.PLAYER, collisionFilterMask: G.STATIC | G.CAR }));
    b.addShape(new CANNON.Sphere(0.32), new CANNON.Vec3(0, -0.58, 0));
    b.addShape(new CANNON.Sphere(0.3), new CANNON.Vec3(0, 0.0, 0));
    b.addShape(new CANNON.Sphere(0.28), new CANNON.Vec3(0, 0.5, 0));
    b.position.set(pos.x, pos.y + 0.95, pos.z);
    b.userData = { kind: 'player' };
    game.physics.world.addBody(b);
    this.facing = 0;
    this.vehicle = null;
    this.grounded = false;
    this.anim = 'idle';
    this.busy = 0;
    this.stepT = 0;
    this.distanceWalked = 0;
  }

  get position() {
    return this.vehicle ? this.vehicle.visual.root.position : new THREE.Vector3(this.body.position.x, this.body.position.y - 0.9, this.body.position.z);
  }

  teleport(p, facing = this.facing) {
    this.body.position.set(p.x, p.y + 0.95, p.z);
    this.body.velocity.setZero();
    this.facing = facing;
  }

  update(dt, input, camYaw) {
    if (this.vehicle) return;
    const b = this.body;
    const from = new CANNON.Vec3(b.position.x, b.position.y - 0.5, b.position.z);
    const to = new CANNON.Vec3(b.position.x, b.position.y - 1.12, b.position.z);
    const r = new CANNON.RaycastResult();
    this.game.physics.world.raycastClosest(from, to, { collisionFilterMask: G.STATIC | G.CAR, skipBackfaces: true }, r);
    this.grounded = r.hasHit;
    let mx = 0, mz = 0;
    if (this.busy <= 0) {
      mz = input.axis('KeyS', 'KeyW');
      mx = input.axis('KeyD', 'KeyA');
    } else this.busy -= dt;
    const len = Math.hypot(mx, mz);
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const speed = len > 0 ? (sprint ? 7.6 : 4.3) : 0;
    // camera-relative: forward is the direction the camera looks (yaw + PI)
    const fwdYaw = camYaw + Math.PI;
    if (len > 0) {
      const ang = Math.atan2(mx, mz) + fwdYaw;
      const vx = Math.sin(ang) * speed, vz = Math.cos(ang) * speed;
      b.velocity.x += (vx - b.velocity.x) * Math.min(1, dt * 12);
      b.velocity.z += (vz - b.velocity.z) * Math.min(1, dt * 12);
      let d = ang - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, dt * 10);
    } else {
      b.velocity.x *= Math.max(0, 1 - dt * 14);
      b.velocity.z *= Math.max(0, 1 - dt * 14);
    }
    if (this.grounded && input.pressed('Space') && this.busy <= 0) { b.velocity.y = 5.2; this.game.audio.footstep(); }
    if (b.position.y < -20) this.teleport(new THREE.Vector3(0, 2, -40));
    const hs = Math.hypot(b.velocity.x, b.velocity.z);
    this.distanceWalked += hs * dt;
    this.anim = this.busy > 0 ? this.anim : hs > 5.5 ? 'run' : hs > 0.6 ? 'walk' : 'idle';
    if (hs > 0.6 && this.grounded) { this.stepT -= dt * hs; if (this.stepT < 0) { this.stepT = 1.6; this.game.audio.footstep(); } }
    this.sync(dt);
  }

  sync(dt) {
    const p = this.position;
    this.char.root.position.copy(p);
    this.char.root.rotation.y = this.facing;
    this.char.update(dt, this.anim);
  }

  setInCar(veh) {
    this.vehicle = veh;
    this.char.root.visible = !veh;
    if (veh) this.game.physics.world.removeBody(this.body);
    else this.game.physics.world.addBody(this.body);
  }
}
