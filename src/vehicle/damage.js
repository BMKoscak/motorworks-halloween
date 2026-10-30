import * as THREE from 'three';

const ZONES = ['front', 'rear', 'left', 'right'];
const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _d = new THREE.Vector3(), _inv = new THREE.Matrix4();

/**
 * Visible damage model for the player's cars (Phase 4).
 *   - Dents: an impact pushes the body panels' vertices inward around the contact point, scaled by impact speed.
 *     Panels share geometry with every car of that body in the town, so a panel's geometry is cloned the first time
 *     it is dented, and the original is kept for the repair.
 *   - Four zones (front / rear / left / right, 0..1) accumulate damage and drive the knock-on effects: the hood or
 *     trunk springs ajar, headlights flicker and dim, paint scuffs through to bare metal, and side hits bend the
 *     alignment so the car pulls to one side.
 *   - repair() (the Custom Bay) restores the original geometry and clears everything.
 * Engine damage (smoke, fire, stalls) is the existing Vehicle.engineHealth model; heavy front hits now feed it too.
 */
export class CarDamage {
  constructor(vehicle) {
    this.v = vehicle;
    this.zones = { front: 0, rear: 0, left: 0, right: 0 };
    this.dented = new Set();
    this.hits = 0;
    this.baseRust = vehicle.visual.paint.u.uRust.value;
  }

  get total() { return (this.zones.front + this.zones.rear + this.zones.left + this.zones.right) / 2.2; }
  get percent() { return Math.round(Math.min(1, this.total) * 100); }

  /** Body-panel meshes: paint, trim colour, chrome bumpers/grille, lamps, plates. Wheels and the cabin interior are left alone. */
  _panels() {
    const vis = this.v.visual;
    if (this._list && this._listCfg === vis.cfg) return this._list;
    const skip = new Set();
    for (const w of vis.wheelNodes) w.knuckle && w.knuckle.traverse((o) => skip.add(o));
    const out = [];
    vis.root.traverse((m) => {
      if (!m.isMesh || skip.has(m) || !m.visible) return;
      const mat = m.material;
      if (!mat || mat.transparent || /^(FP_|Seat|Steering|Dash|Interior|Glow|Underglow)/.test(m.name)) return;
      if (vis.paint.mats.includes(mat) || mat === vis.paint2 || mat === vis.headMat || mat === vis.tailMat || /Chrome|Grille|Plate|Bumper/.test(mat.name || '')) out.push(m);
    });
    this._listCfg = vis.cfg;
    return (this._list = out);
  }

  /** An impact at world point `pw` with closing speed `speed` (m/s). */
  hit(pw, speed) {
    if (speed < 4) return null;
    const vis = this.v.visual, info = vis.info;
    vis.root.updateMatrixWorld(true);
    const local = vis.root.worldToLocal(_p.copy(pw));
    const cz = (info.minZ + info.maxZ) / 2;
    const zn = (local.z - cz) / (info.length / 2), xn = local.x / info.halfW;
    const zone = Math.abs(zn) > Math.abs(xn) * 0.9 ? (zn > 0 ? 'front' : 'rear') : (xn > 0 ? 'left' : 'right');
    const k = THREE.MathUtils.clamp((speed - 4) / 18, 0, 1);
    this.zones[zone] = Math.min(1, this.zones[zone] + 0.12 + k * 0.45);
    this.hits++;
    // dent: radius and depth grow with the hit; pushed toward the car's centre line, mostly horizontally
    const radius = 0.5 + k * 0.8, depth = 0.05 + k * 0.3;
    const inward = new THREE.Vector3(-local.x * 0.6, -0.15, cz - local.z).normalize().transformDirection(vis.root.matrixWorld);
    // clamp the contact onto the body shell so a hit registered on the collider box still lands on a panel
    local.x = THREE.MathUtils.clamp(local.x, -info.halfW, info.halfW);
    local.z = THREE.MathUtils.clamp(local.z, info.minZ, info.maxZ);
    local.y = THREE.MathUtils.clamp(local.y, info.yb + 0.15, info.belt);
    const center = vis.root.localToWorld(local.clone());
    let moved = 0;
    for (const m of this._panels()) {
      m.geometry.boundingSphere || m.geometry.computeBoundingSphere();
      const bs = m.geometry.boundingSphere;
      _q.copy(bs.center).applyMatrix4(m.matrixWorld);
      if (_q.distanceTo(center) > bs.radius + radius) continue;
      if (!m.userData.dentOrig) { m.userData.dentOrig = m.geometry; m.geometry = m.geometry.clone(); this.dented.add(m); }
      _inv.copy(m.matrixWorld).invert();
      const c = _q.copy(center).applyMatrix4(_inv);
      const dir = _d.copy(inward).transformDirection(_inv);
      const pos = m.geometry.attributes.position;
      let any = false;
      for (let i = 0; i < pos.count; i++) {
        const dx = pos.getX(i) - c.x, dy = pos.getY(i) - c.y, dz = pos.getZ(i) - c.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > radius) continue;
        // smooth falloff plus a little crumple noise so dents don't look like perfect spheres
        const n = 0.75 + 0.5 * Math.abs(Math.sin(i * 12.9898 + this.hits * 3.1));
        const f = (1 - d / radius) ** 2 * depth * n;
        pos.setXYZ(i, pos.getX(i) + dir.x * f, pos.getY(i) + dir.y * f, pos.getZ(i) + dir.z * f);
        any = true;
        moved++;
      }
      if (any) { pos.needsUpdate = true; m.geometry.computeVertexNormals(); m.geometry.computeBoundingSphere(); }
    }
    this._effects();
    return { zone, k: +k.toFixed(2), moved, damage: this.percent };
  }

  _effects() {
    const v = this.v, vis = v.visual, z = this.zones;
    if (z.front > 0.55 && vis.hinges.Hood) vis.hinges.Hood.target = Math.min(0.16, (z.front - 0.5) * 0.35); // sprung hood
    if (z.rear > 0.55 && vis.hinges.Trunk) vis.hinges.Trunk.target = Math.min(0.14, (z.rear - 0.5) * 0.3);
    vis.paint.u.uRust.value = Math.max(this.baseRust, Math.min(0.55, this.total * 0.55)); // scuffed to bare metal
    v.pull = (z.left - z.right) * 0.09; // bent tie-rods pull toward the damaged side
    v.headDamage = z.front;
  }

  repair() {
    for (const m of this.dented) { m.geometry.dispose(); m.geometry = m.userData.dentOrig; delete m.userData.dentOrig; }
    this.dented.clear();
    for (const k of ZONES) this.zones[k] = 0;
    this.hits = 0;
    const vis = this.v.visual;
    if (vis.hinges.Hood) vis.hinges.Hood.target = 0;
    if (vis.hinges.Trunk) vis.hinges.Trunk.target = 0;
    this.baseRust = vis.paint.u.uRust.value = vis.cfg.finish === 'rust' ? 1 : 0;
    this.v.pull = 0;
    this.v.headDamage = 0;
    this._list = null;
  }

  /** Bay price for bodywork. */
  get repairCost() { return Math.round(this.total * 1800 / 50) * 50; }
}
