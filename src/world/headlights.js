import * as THREE from 'three';

/**
 * Real headlight beams for the car the player is driving (Phase 4). Two SpotLights hang off the front of the car's
 * visual and pool light on the road ahead; on Ultra the right-hand beam also casts shadows (one shadow map is plenty,
 * both beams start ~1.4 m apart). Everyone else's headlights stay emissive-only for performance.
 */
export class Headlights {
  constructor(game) {
    this.game = game;
    this.rig = new THREE.Group();
    this.rig.name = 'PlayerHeadlights';
    this.beams = [-1, 1].map((side) => {
      const s = new THREE.SpotLight('#fff1d6', 0, 48, 0.46, 0.55, 1.4);
      s.position.set(side * 0.62, 0.72, 0);
      s.target.position.set(side * 0.9, -0.6, 14);
      s.shadow.mapSize.set(1024, 1024);
      s.shadow.camera.near = 0.4;
      s.shadow.camera.far = 50;
      s.shadow.bias = -0.0008;
      s.shadow.normalBias = 0.02;
      this.rig.add(s, s.target);
      return s;
    });
    this.on = false;
    this.setQuality(game.quality);
    this._detach();
  }

  setQuality(q) {
    this.enabled = !!q.headlights;
    this.beams[1].castShadow = !!q.headShadows;
    if (!this.enabled) this._detach();
  }

  _detach() {
    // parked on the scene root at zero intensity rather than removed: a changing light count recompiles every material
    if (this.rig.parent !== this.game.scene) this.game.scene.add(this.rig);
    this.rig.position.set(0, -50, 0);
    this.attached = null;
    for (const b of this.beams) b.intensity = 0;
  }

  update() {
    const v = this.game.player && this.game.player.vehicle;
    const on = this.enabled && v && v.visual.lights.head;
    if (!on) { if (this.attached) this._detach(); return; }
    if (this.attached !== v) {
      this._detach();
      v.visual.root.add(this.rig);
      this.rig.position.set(0, 0, v.visual.info.maxZ - 0.15);
      this.attached = v;
    }
    // brighter at night; in daylight they barely register (like real low beams)
    const night = this.game.atmo.lampFactor;
    // front-end damage dims the beams, with a loose-wire flicker once the lamps are smashed
    const hd = v.headDamage || 0;
    const broken = hd > 0.6 ? (Math.random() < 0.08 ? 0.05 : 1 - (hd - 0.5) * 1.1) : 1;
    const k = (0.25 + 0.75 * night) * broken;
    for (const b of this.beams) b.intensity = 95 * k;
  }
}
