import * as THREE from 'three';

/**
 * Scene-graph savings for a 17k-node scene (Phase 4 perf pass).
 *
 * 1. Roots flagged userData.cullTree (car visuals, characters) skip recursing into their children's matrices while
 *    hidden. three.js otherwise recomputes every hidden joint/wheel/door matrix each frame. The root keeps its own
 *    world matrix current (door points, distance checks), and its children are force-updated the frame it reappears.
 *    getWorldPosition() on a hidden child still works: it walks the parent chain itself.
 * 2. DistanceCull: parked and traffic car visuals beyond the fog horizon are hidden (they are kinematic or
 *    asleep there, so nothing is lost visually or physically).
 * 3. DistanceCull also turns off shadow casting for cars beyond 60 m and people beyond 32 m. The sun's shadow frustum
 *    spans 140-170 m, so without this every parked car's ~60 parts and every pedestrian's ~20 limbs were re-drawn into
 *    the shadow map each frame (~850 of ~1,900 draw calls on Main Street) for shadows a few pixels wide.
 */
const base = THREE.Object3D.prototype.updateMatrixWorld;
THREE.Object3D.prototype.updateMatrixWorld = function (force) {
  if (this.visible === false && this.userData.cullTree) {
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.matrixWorldNeedsUpdate || force) {
      if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      else this.matrixWorld.copy(this.matrix);
      this.matrixWorldNeedsUpdate = false;
    }
    this._staleKids = true;
    return;
  }
  if (this._staleKids) { this._staleKids = false; force = true; }
  base.call(this, force);
};

export class DistanceCull {
  constructor(game, range = 185) {
    this.game = game;
    this.range = range;
    this.t = 0;
    this.stats = { hiddenCars: 0 };
  }

  update(dt) {
    if ((this.t += dt) < 0.25) return;
    this.t = 0;
    const g = this.game, cam = g.camera.position, r2 = this.range * this.range;
    let hidden = 0;
    const cull = (vis) => {
      const p = vis.root.position;
      const far = (p.x - cam.x) ** 2 + (p.z - cam.z) ** 2 > r2;
      vis.root.visible = !far;
      if (far) hidden++;
    };
    for (const pk of g.traffic.parked) cull(pk.visual);
    for (const c of g.traffic.driving) cull(c.visual);
    this.stats.hiddenCars = hidden;
    this._shadows(cam);
  }

  _shadows(cam) {
    const g = this.game;
    // re-collect the car / character roots every ~2 s (people get spawned, cars get stolen and rebuilt)
    if (!this.roots || (this._rootAge = (this._rootAge || 0) + 1) > 8) {
      this._rootAge = 0;
      this.roots = [];
      g.scene.traverse((o) => { if (o.userData.cullTree) this.roots.push(o); });
    }
    const own = g.player && g.player.vehicle ? g.player.vehicle.visual.root : null;
    let off = 0;
    const wp = (this._wp ||= new THREE.Vector3());
    for (const r of this.roots) {
      if (!r.parent) continue;
      r.getWorldPosition(wp);
      const isCar = r.name === 'CarVisual';
      const want = r === own || wp.distanceToSquared(cam) < (isCar ? 60 * 60 : 32 * 32);
      if (r.userData.shadowOn !== want) {
        r.userData.shadowOn = want;
        // nested roots (drivers inside cars) are handled on their own pass of the list
        r.traverse((m) => { if (m.isMesh && m.userData.castDefault === undefined) m.userData.castDefault = m.castShadow; if (m.isMesh) m.castShadow = want && m.userData.castDefault; });
      }
      if (!want) off++;
    }
    this.stats.shadowOff = off;
  }
}
