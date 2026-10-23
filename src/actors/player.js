import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Character } from './character.js';
import { G } from '../core/physics.js';
import { seatDriver } from '../systems/traffic.js';

/** On-foot player: capsule-ish rigid body (three spheres), camera-relative movement, jump, step-up assist and the articulated rig. */
export class Player {
  constructor(game, pos) {
    this.game = game;
    // baked like everyone else; masks re-bake via setAccessories, held weapons stay separate (userData.noBake)
    this.char = new Character(game.assets, 'player');
    game.scene.add(this.char.root);
    const b = (this.body = new CANNON.Body({ mass: 70, fixedRotation: true, material: game.physics.mat.player, linearDamping: 0.0,
      collisionFilterGroup: G.PLAYER, collisionFilterMask: G.STATIC | G.CAR }));
    b.addShape(new CANNON.Sphere(0.32), new CANNON.Vec3(0, -0.58, 0));
    b.addShape(new CANNON.Sphere(0.3), new CANNON.Vec3(0, 0.0, 0));
    b.addShape(new CANNON.Sphere(0.28), new CANNON.Vec3(0, 0.5, 0));
    b.position.set(pos.x, pos.y + 0.95, pos.z);
    b.userData = { kind: 'player' };
    b.allowSleep = false;
    game.physics.world.addBody(b);
    this.facing = 0;
    this.vehicle = null;
    this.grounded = false;
    this.anim = 'idle';
    this.busy = 0;
    this.stepT = 0;
    this.distanceWalked = 0;
    this.shootT = 0;
    this.carrying = null;
    this.masked = false;
    this.steps = 0;
  }

  get position() {
    return this.vehicle ? this.vehicle.visual.root.position : new THREE.Vector3(this.body.position.x, this.body.position.y - 0.9, this.body.position.z);
  }

  teleport(p, facing = this.facing) {
    this.body.position.set(p.x, p.y + 0.95, p.z);
    this.body.velocity.setZero();
    this.facing = facing;
  }

  setMask(on) {
    this.masked = on;
    this.char.setAccessories(on ? ['Mask_Pumpkin'] : []);
  }

  /** Step-up assist: a low obstacle (porch step, stair riser, curb) in front of the feet but nothing at knee height. */
  _stepUp(dir) {
    const b = this.body, ph = this.game.physics;
    const feet = new THREE.Vector3(b.position.x, b.position.y - 0.8, b.position.z);
    const lowHit = ph.rayStatic(feet, feet.clone().addScaledVector(dir, 0.55));
    if (!lowHit) return;
    const knee = feet.clone(); knee.y += 0.36;
    if (ph.rayStatic(knee, knee.clone().addScaledVector(dir, 0.6))) return;
    // find the top of the step and lift onto it
    const probe = knee.clone().addScaledVector(dir, 0.45);
    const top = ph.rayStatic(probe, probe.clone().add(new THREE.Vector3(0, -0.5, 0)));
    if (top && top.point.y > feet.y - 0.05) {
      b.position.y = top.point.y + 0.95 - 0.04 + 0.02;
      b.velocity.y = Math.max(b.velocity.y, 0.5);
      this.steps++;
    }
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
    const aiming = this.game.combat && this.game.combat.aiming;
    const len = Math.hypot(mx, mz);
    const sprint = (input.down('ShiftLeft') || input.down('ShiftRight')) && !this.carrying && !aiming;
    const speed = len > 0 ? (sprint ? 7.6 : aiming ? 2.6 : this.carrying ? 3.0 : 4.3) : 0;
    // camera-relative: forward is the direction the camera looks (yaw + PI)
    const fwdYaw = camYaw + Math.PI;
    if (len > 0) {
      const ang = Math.atan2(mx, mz) + fwdYaw;
      const vx = Math.sin(ang) * speed, vz = Math.cos(ang) * speed;
      b.velocity.x += (vx - b.velocity.x) * Math.min(1, dt * 12);
      b.velocity.z += (vz - b.velocity.z) * Math.min(1, dt * 12);
      if (!aiming) {
        let d = ang - this.facing;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.facing += d * Math.min(1, dt * 10);
      }
      this._stepUp(new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)));
    } else {
      b.velocity.x *= Math.max(0, 1 - dt * 14);
      b.velocity.z *= Math.max(0, 1 - dt * 14);
    }
    if (aiming) this.facing = fwdYaw; // strafe while aiming: body follows the crosshair
    if (this.grounded && input.pressed('Space') && this.busy <= 0 && !this.carrying) { b.velocity.y = 5.2; this.game.audio.footstep(); }
    if (b.position.y < -20) this.teleport(new THREE.Vector3(0, 2, -40));
    const hs = Math.hypot(b.velocity.x, b.velocity.z);
    this.distanceWalked += hs * dt;
    this.shootT = Math.max(0, this.shootT - dt);
    const w = this.game.combat && this.game.combat.weapon;
    let anim = hs > 5.5 ? 'run' : hs > 0.6 ? 'walk' : 'idle';
    if (this.carrying) anim = 'carry';
    else if (w && w.melee && this.shootT > 0) anim = 'swing';
    else if (w && !w.melee && (aiming || this.shootT > 0)) anim = 'aim';
    if (aiming) {
      const dir = new THREE.Vector3(); this.game.camera.getWorldDirection(dir);
      this.char.aimPitch = Math.asin(THREE.MathUtils.clamp(dir.y, -0.9, 0.9));
    }
    this.anim = this.busy > 0 ? this.anim : anim;
    this.animSpeed = hs / 4.3;
    if (hs > 0.6 && this.grounded) { this.stepT -= dt * hs; if (this.stepT < 0) { this.stepT = 1.6; this.game.audio.footstep(); } }
    this.sync(dt);
  }

  sync(dt) {
    if (this.vehicle) {
      // seated in the driver's seat (visible from the chase cam, hidden in cockpit view where the FP hands take over)
      this.char.root.visible = !this.game.rig.cockpit;
      this.char.steer = THREE.MathUtils.clamp(this.vehicle.steer * 2.2, -1, 1);
      this.char.update(dt, 'drive');
      return;
    }
    const p = this.position;
    this.char.root.position.copy(p);
    this.char.root.rotation.y = this.facing;
    this.char.update(dt, this.anim, this.animSpeed || 0);
  }

  setInCar(veh) {
    const prev = this.vehicle;
    this.vehicle = veh;
    if (veh) {
      this.game.physics.world.removeBody(this.body);
      seatDriver(veh.visual, this.char);
      if (this.game.combat && this.game.combat.held) this.game.combat.held.visible = false;
    } else {
      if (prev) prev.visual.root.remove(this.char.root);
      this.game.scene.add(this.char.root);
      this.char.root.scale.setScalar(1);
      this.char.root.rotation.set(0, this.facing, 0);
      this.char.root.visible = true;
      this.game.physics.world.addBody(this.body);
      if (this.game.combat && this.game.combat.held) this.game.combat.held.visible = true;
    }
  }
}
