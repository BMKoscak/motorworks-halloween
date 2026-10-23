import * as THREE from 'three';
import { terrainHeight } from '../world/terrain.js';

/** Floor height under a walker: ray down against static colliders (floors, porches, stairs, sidewalks), terrain as fallback. */
export function groundAt(game, x, z, yHint = null) {
  const top = (yHint ?? terrainHeight(x, z)) + 1.2;
  const hit = game.physics.rayStatic(new THREE.Vector3(x, top, z), new THREE.Vector3(x, top - 4, z));
  return hit ? Math.max(hit.point.y, terrainHeight(x, z) - 0.05) : terrainHeight(x, z);
}

/**
 * A character walking/running on the pedestrian nav graph: straight at the goal when it is in sight,
 * otherwise along an A* path (re-planned twice a second), opening unlocked doors on the way and
 * staying glued to the floor under its feet.
 */
export class FootAgent {
  constructor(game, char, opts = {}) {
    this.game = game;
    this.char = char;
    this.speed = opts.speed || 6.2;
    this.path = null;
    this.goal = null;
    this.replan = 0;
    this.moving = false;
    this.stuck = 0;
  }

  get pos() { return this.char.root.position; }

  sees(p) {
    const a = this.pos.clone(); a.y += 1.0;
    const b = p.clone(); b.y += 1.0;
    if (Math.abs(a.y - b.y) > 2.2) return false;
    const hit = this.game.physics.rayStatic(a, b);
    return !hit;
  }

  /** Move toward goal. Returns remaining distance. */
  update(dt, goal, speed = this.speed, stopAt = 0.8) {
    const g = this.game, pos = this.pos;
    let target = goal;
    const direct = this.sees(goal);
    if (!direct && g.nav) {
      if ((this.replan -= dt) <= 0 || !this.path) {
        this.replan = 0.6;
        this.path = g.nav.path(g.nav.nearest(pos), g.nav.nearest(goal));
        if (this.path && this.path.length > 1 && pos.distanceTo(this.path[0].p) < 1.5) this.path.shift();
      }
      while (this.path && this.path.length && Math.hypot(this.path[0].p.x - pos.x, this.path[0].p.z - pos.z) < 0.7) this.path.shift();
      if (this.path && this.path.length) target = this.path[0].p;
    } else this.path = null;
    const dx = target.x - pos.x, dz = target.z - pos.z;
    const d = Math.hypot(dx, dz);
    const remaining = goal.distanceTo(pos);
    this.moving = remaining > stopAt && d > 0.05;
    if (this.moving) {
      const step = Math.min(d, speed * dt);
      const before = pos.clone();
      pos.x += (dx / d) * step;
      pos.z += (dz / d) * step;
      // never walk through walls: if the step crosses static geometry, slide back
      const a = before.clone(); a.y += 0.9;
      const b = pos.clone(); b.y += 0.9;
      const hit = g.physics.rayStatic(a, b.clone().addScaledVector(b.clone().sub(a).normalize(), 0.3));
      if (hit && !(hit.body.userData.node && /^COL_Door/.test(hit.body.userData.node.name) && this._openDoor(hit.point))) { pos.copy(before); this.stuck += dt; this.path = null; this.replan = 0; } else this.stuck = 0;
      this.char.root.rotation.y = Math.atan2(dx, dz);
    }
    g.buildings.autoOpen(pos);
    pos.y = groundAt(g, pos.x, pos.z, pos.y);
    return remaining;
  }

  _openDoor(p) {
    const d = this.game.buildings.nearestDoor(p, 2.2);
    if (!d || d.locked) return false;
    if (d.target < 1) this.game.buildings.toggleDoor(d, true);
    d.auto = 4;
    return d.t > 0.7;
  }
}
