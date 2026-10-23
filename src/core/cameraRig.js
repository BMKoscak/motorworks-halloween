import * as THREE from 'three';

/** Third-person orbit (on foot), chase cam + cockpit cam (driving), scripted poses (stations, title). */
export class CameraRig {
  constructor(game, camera) {
    this.game = game;
    this.cam = camera;
    this.yaw = Math.PI;
    this.pitch = 0.25;
    this.dist = 4.6;
    this.carYawOff = 0;
    this.carPitch = 0.18;
    this.idleOrbit = 0;
    this.cockpit = false;
    this.pos = camera.position.clone();
    this.look = new THREE.Vector3();
    this._shake = new THREE.Vector3();
  }

  _collide(target, desired) {
    const hit = this.game.physics.rayStatic(target, desired);
    if (hit && hit.distance < target.distanceTo(desired)) {
      const dir = desired.clone().sub(target).normalize();
      return hit.point.clone().addScaledVector(dir, -0.35);
    }
    return desired;
  }

  _applyShake() {
    const s = this.game.effects.shake;
    if (s > 0) {
      this._shake.set((Math.random() - 0.5) * s * 0.35, (Math.random() - 0.5) * s * 0.35, (Math.random() - 0.5) * s * 0.35);
      this.cam.position.add(this._shake);
    }
  }

  foot(dt, input, player) {
    this.yaw -= input.mouseDX * 0.0028;
    this.pitch = THREE.MathUtils.clamp(this.pitch + input.mouseDY * 0.0022, -0.35, 1.1);
    this.dist = THREE.MathUtils.clamp(this.dist + input.wheel * 0.5, 2.2, 9);
    // aiming: tight over-the-right-shoulder framing so the crosshair (screen centre) is the bullet's aim point
    const aim = this.game.combat && this.game.combat.aiming;
    this.aimK = THREE.MathUtils.lerp(this.aimK || 0, aim ? 1 : 0, Math.min(1, dt * 10));
    const k = this.aimK;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const target = player.position.clone().add(new THREE.Vector3(0, 1.55 + 0.05 * k, 0)).addScaledVector(right, 0.55 * k);
    // indoors: tighter framing so rooms and doorways stay readable
    const inside = this.game.buildings && this.game.buildings.inside(player.position);
    this.indoorK = THREE.MathUtils.lerp(this.indoorK || 0, inside ? 1 : 0, Math.min(1, dt * 4));
    const dist = THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.dist, Math.min(this.dist, 2.9), this.indoorK), 1.9, k);
    const off = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(dist);
    const desired = this._collide(target, target.clone().add(off));
    this.cam.position.lerp(desired, Math.min(1, dt * (aim ? 20 : 14)));
    this.cam.lookAt(target);
    this._setFov(THREE.MathUtils.lerp(60, 48, k), dt * (1 + k * 3));
    this._applyShake();
  }

  car(dt, input, veh) {
    const v = veh.visual;
    if (this.cockpit) {
      this.carYawOff = THREE.MathUtils.clamp(this.carYawOff - input.mouseDX * 0.003, -1.9, 1.9);
      this.carPitch = THREE.MathUtils.clamp(this.carPitch + input.mouseDY * 0.002, -0.5, 0.6);
      if (!input.mouseDX) this.carYawOff *= Math.max(0, 1 - dt * 0.8);
      const eye = v.n.FP_Eye.getWorldPosition(new THREE.Vector3());
      const q = v.root.quaternion;
      const dir = new THREE.Vector3(Math.sin(this.carYawOff), -Math.sin(this.carPitch * 0.5) - 0.06, Math.cos(this.carYawOff)).applyQuaternion(q);
      this.cam.position.copy(eye);
      this.cam.lookAt(eye.clone().add(dir));
      this.cam.near = 0.05;
      this._setFov(74, dt);
      this._applyShake();
      return;
    }
    this.cam.near = 0.1;
    if (input.mouseDX || input.mouseDY) {
      this.carYawOff -= input.mouseDX * 0.004;
      this.carPitch = THREE.MathUtils.clamp(this.carPitch + input.mouseDY * 0.003, -0.05, 0.9);
      this.idleOrbit = 1.6;
    } else {
      this.idleOrbit -= dt;
      if (this.idleOrbit < 0) { this.carYawOff *= Math.max(0, 1 - dt * 2.2); this.carPitch += (0.18 - this.carPitch) * Math.min(1, dt * 1.5); }
    }
    const speed = veh.speed;
    const vel = veh.body.velocity;
    // look along velocity when moving forward fast (feels like a real chase cam), along the hood otherwise
    let h = veh.heading;
    if (speed > 6) h = Math.atan2(vel.x, vel.z) * 0.35 + h * 0.65;
    if (speed < -2) h += Math.PI * Math.min(1, (-speed - 2) / 4);
    const yaw = h + Math.PI + this.carYawOff;
    const dist = 6.6 + Math.min(Math.abs(speed), 45) * 0.05 + (v.info.length - 4.8) * 0.6;
    const target = new THREE.Vector3(veh.body.position.x, veh.body.position.y + 0.9, veh.body.position.z);
    const desired = target.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(this.carPitch), Math.sin(this.carPitch), Math.cos(yaw) * Math.cos(this.carPitch)).multiplyScalar(dist));
    desired.y += 1.0;
    const safe = this._collide(target, desired);
    this.cam.position.lerp(safe, Math.min(1, dt * 7));
    const ground = this.game.heightAt(this.cam.position.x, this.cam.position.z) + 0.4;
    if (this.cam.position.y < ground) this.cam.position.y = ground;
    this.look.lerp(target.clone().add(veh.forward.multiplyScalar(2.5)), Math.min(1, dt * 10));
    this.cam.lookAt(this.look);
    this._setFov(62 + Math.min(Math.abs(speed), 50) * 0.28, dt);
    this._applyShake();
  }

  pose(dt, pos, look, rate = 3) {
    this.cam.position.lerp(pos, Math.min(1, dt * rate));
    this.look.lerp(look, Math.min(1, dt * rate));
    this.cam.lookAt(this.look);
    this._setFov(55, dt);
  }

  _setFov(f, dt) {
    if (Math.abs(this.cam.fov - f) > 0.05) {
      this.cam.fov += (f - this.cam.fov) * Math.min(1, dt * 3);
      this.cam.updateProjectionMatrix();
    }
  }
}
