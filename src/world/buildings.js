import * as THREE from 'three';
import { bakeInto, ownedMeshes } from '../core/bake.js';

/** Collapse a small articulated prop (door, switch, breaker, hose) into a couple of vertex-coloured meshes; `keep` nodes stay separate. */
export function bakeProp(root, keep = []) {
  root.updateMatrixWorld(true);
  const ks = new Set(keep.filter(Boolean));
  bakeInto(root, ownedMeshes(root, root, (n) => ks.has(n)), null, { shadow: false });
  for (const k of ks) bakeInto(k, ownedMeshes(k, k, () => false), null, { shadow: false });
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const PANE_LIT = new THREE.Color(0.62, 0.42, 0.2);
const PANE_DARK = new THREE.Color(0.012, 0.016, 0.024);

/** Wanted-poster canvas for the police lobby. */
function posterTexture(i) {
  const c = document.createElement('canvas');
  c.width = 192; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e9dcb8'; g.fillRect(0, 0, 192, 256);
  g.fillStyle = '#2a1a10'; g.font = 'bold 34px Georgia'; g.textAlign = 'center';
  g.fillText('WANTED', 96, 42);
  g.fillStyle = '#c9b48c'; g.fillRect(36, 58, 120, 120);
  g.fillStyle = '#3a2a1c';
  g.beginPath(); g.arc(96, 104, 30, 0, 7); g.fill();
  g.fillRect(56, 136, 80, 42);
  g.font = 'bold 15px Georgia';
  const names = ['THE HEADLESS DRIVER', 'PUMPKIN JACK', 'GRAVE ROBBER GUS', 'DRAG QUEEN DRACULA', 'THE MIDNIGHT MECHANIC'];
  g.fillText(names[i % names.length], 96, 204);
  g.font = '13px Georgia';
  g.fillText(`REWARD $${(i + 1) * 500}`, 96, 230);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Runtime side of the enterable Blender buildings (blender/build_world.py "interior kit").
 * Pulls hinged doors, switches, breakers and hoses out of the static batch so they stay animated, gives each
 * building its own interior-light material + light sources, and gathers every window pane into one instanced,
 * shootable glass mesh whose glow follows the building's lights and power.
 */
export class Buildings {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.doors = [];
    this.switches = [];
    this.hinges = [];
    this.panes = [];
    this.paneMat = new THREE.MeshStandardMaterial({ color: '#9fb6c4', transparent: true, opacity: 0.32, roughness: 0.06, metalness: 0.35, depthWrite: false, name: 'PaneGlass' });
    this.paneMat.onBeforeCompile = (sh) => {
      // instance colour drives the emissive "lit room behind the glass" glow instead of tinting the glass
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', '')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance = vColor.rgb;\n#endif');
    };
  }

  /** Called by town/factory placement with the building root already in world space (before static batching). */
  process(obj, kind, opts = {}) {
    const g = this.game;
    obj.updateMatrixWorld(true);
    const b = { kind, name: opts.name || kind, obj, lightsOn: opts.lightsOn ?? true, power: true, alarm: kind === 'house', sources: [], panes: [], spots: {},
      doors: {}, switches: [], loot: [], shop: [], fixtureMat: null, house: kind === 'house', id: this.list.length, visited: false };
    const detach = [];
    const removePanes = [];
    obj.traverse((o) => {
      const n = o.name;
      if (/^(Door_|Cell_Door)/.test(n) && o.userData.hinge && !/_(Panel|Frame|Glass|Knob|Insets)$/.test(n)) detach.push(['door', o]);
      else if (/^Switch_/.test(n)) detach.push(['switch', o]);
      else if (/^(Hose_|Nozzle_)/.test(n) && o.userData.hinge && /^Hose_\d+_\d+$/.test(n)) detach.push(['hinge', o]);
      else if (n === 'Breaker_Box') detach.push(['breaker', o]);
      else if (o.isMesh && /^Pane_/.test(n)) removePanes.push(o);
      else if (o.isMesh && /^Fixture_/.test(n)) {
        b.fixtureMat ||= Object.assign(o.material.clone(), { name: 'Lamp_Interior_' + b.id });
        o.material = b.fixtureMat;
      } else if (/^LightIn_/.test(n)) {
        const p = o.getWorldPosition(new THREE.Vector3());
        const s = g.lights.add(p, o.userData.color || '#ffc98a', opts.lightI || 9, false, opts.lightRange || 9);
        b.sources.push(s);
      } else if (/^Loot_/.test(n)) b.loot.push({ kind: n.split('_')[1], pos: o.getWorldPosition(new THREE.Vector3()), yaw: obj.rotation.y + (o.userData.yaw || 0) });
      else if (/^Shop_/.test(n)) b.shop.push({ item: n.slice(5), pos: o.getWorldPosition(new THREE.Vector3()), yaw: obj.rotation.y + (o.userData.yaw || 0), price: o.userData.price || 0 });
      else if (/^Spot_/.test(n)) b.spots[n.slice(5)] = o.getWorldPosition(new THREE.Vector3());
      else if (/^Pump_Spot_/.test(n)) (b.pumps ||= []).push({ pos: o.getWorldPosition(new THREE.Vector3()), id: o.userData.pump ?? (b.pumps ? b.pumps.length : 0) });
      else if (n === 'Doorbell') b.doorbell = o.getWorldPosition(new THREE.Vector3());
      else if (n === 'Phone') b.phone = o.getWorldPosition(new THREE.Vector3());
      else if (o.isMesh && /^Poster_/.test(n)) o.material = new THREE.MeshStandardMaterial({ map: posterTexture(+n.split('_')[1] || 0), roughness: 0.9 });
    });
    // window panes -> instanced glass (removed from the batch)
    for (const p of removePanes) {
      p.geometry.computeBoundingBox();
      const bb = p.geometry.boundingBox;
      p.matrixWorld.decompose(_v, _q, _s);
      const size = bb.getSize(new THREE.Vector3()).multiply(_s);
      const center = bb.getCenter(new THREE.Vector3()).applyMatrix4(p.matrixWorld);
      const pane = { building: b, center, quat: _q.clone(), size, broken: false, index: this.panes.length };
      this.panes.push(pane);
      b.panes.push(pane);
      p.parent.remove(p);
    }
    // live (animated) nodes leave the batch, each collapsed to a couple of draw calls
    for (const [type, o] of detach) {
      g.scene.attach(o);
      const center = new THREE.Vector3();
      o.traverse((c) => { if (c.isMesh && /_(Panel|Glass)$/.test(c.name)) new THREE.Box3().setFromObject(c).getCenter(center); });
      if (type === 'door' || type === 'hinge') bakeProp(o, type === 'hinge' ? o.children.filter((c) => /^Nozzle_/.test(c.name)) : []);
      else if (type === 'switch') bakeProp(o, o.children.filter((c) => /^SwitchLever_/.test(c.name)));
      else if (type === 'breaker') bakeProp(o, [o.getObjectByName('BreakerLever')]);
      if (type === 'door') {
        const d = { node: o, building: b, axis: 'y', open: o.userData.open || 1.4, base: o.rotation.y, t: 0, target: 0, cols: [], name: o.name,
          locked: b.house && o.name === 'Door_Front' || o.name === 'Door_Evidence', auto: 0 };
        d.center = center;
        if (d.center.lengthSq() === 0) o.getWorldPosition(d.center);
        b.doors[o.name] = d;
        this.doors.push(d);
      } else if (type === 'switch') {
        const lever = o.children.find((c) => /^SwitchLever_/.test(c.name));
        const sw = { node: o, lever, building: b, pos: o.getWorldPosition(new THREE.Vector3()), name: o.name.slice(7), base: lever ? lever.rotation[lever.userData.hinge || 'x'] : 0 };
        b.switches.push(sw);
        this.switches.push(sw);
      } else if (type === 'breaker') {
        b.breaker = { node: o, lever: o.getObjectByName('BreakerLever'), pos: o.getWorldPosition(new THREE.Vector3()), t: 0 };
      } else this.hinges.push({ node: o, building: b, base: o.rotation[o.userData.hinge], t: 0, target: 0 });
    }
    // colliders of doors follow their hinge
    for (const body of opts.colliders || []) {
      const n = body.userData.node;
      for (const d of Object.values(b.doors)) if (n.name === 'COL_' + d.name || n.parent === d.node) { d.cols.push(body); body.userData.moves = true; }
    }
    // interior footprint (inside test): the wall shell's bounding box, shrunk a little
    const box = new THREE.Box3();
    obj.traverse((o) => { if (o.isMesh && /^(Wall_|Diner_Front|Diner_Back|Diner_Side|Mart_(Front|Back|West|East))/.test(o.name) && !/Skin|Trim/.test(o.name)) box.expandByObject(o); });
    if (box.isEmpty()) box.setFromObject(obj);
    box.expandByVector(new THREE.Vector3(-0.25, 0, -0.25));
    b.box = box;
    // furniture & interior finishes don't need to cast shadows (the moon can't reach them anyway)
    const c = new THREE.Vector3(), inner = box.clone().expandByVector(new THREE.Vector3(-0.3, 0, -0.3));
    obj.traverse((o) => { if (o.isMesh && !/^Fixture_/.test(o.name)) { new THREE.Box3().setFromObject(o).getCenter(c); if (inner.containsPoint(c) && c.y < box.max.y - 0.6) o.castShadow = false; } });
    b.floorY = (b.spots.Inside || box.min).y;
    this.list.push(b);
    this.apply(b);
    return b;
  }

  /** Build the instanced glass once every building has been processed. */
  finalize() {
    const n = this.panes.length;
    if (!n) return;
    const mesh = (this.paneMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.paneMat, n));
    mesh.name = 'WindowPanes';
    mesh.renderOrder = 3;
    this.panes.forEach((p, i) => { mesh.setMatrixAt(i, _m.compose(p.center, p.quat, p.size)); mesh.setColorAt(i, this._paneColor(p)); });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.game.scene.add(mesh);
  }

  _paneColor(p) { const b = p.building; return b.lightsOn && b.power ? PANE_LIT : PANE_DARK; }

  /** Push a building's light state to its fixtures, light sources and window glow. */
  apply(b) {
    const on = b.lightsOn && b.power;
    if (b.fixtureMat) b.fixtureMat.emissiveIntensity = on ? 3 : 0;
    if (b.fixtureMat) b.fixtureMat.color.set(on ? '#fff3dc' : '#555048');
    b.sources.forEach((s) => this.game.lights.setOn(s, on));
    if (this.paneMesh) {
      for (const p of b.panes) this.paneMesh.setColorAt(p.index, this._paneColor(p));
      this.paneMesh.instanceColor.needsUpdate = true;
    }
    for (const sw of b.switches) if (sw.lever) sw.lever.rotation[sw.lever.userData.hinge || 'x'] = sw.base + (b.lightsOn ? 0 : sw.lever.userData.open || 0.7);
  }

  setLights(b, on) { b.lightsOn = on; this.apply(b); this.game.events.emit('lights', { building: b.name, on: b.lightsOn && b.power }); }

  cutPower(b) {
    if (!b.power) return false;
    b.power = false;
    b.alarm = false;
    if (b.breaker) b.breaker.t = 1;
    this.apply(b);
    this.game.audio.noiseBurst(0.25, 2400, 3, 0.25, 'bandpass');
    this.game.audio.tone(80, 0.6, 'sawtooth', 0.12, 0, this.game.audio.sfx, 40);
    this.game.events.emit('power', { building: b.name, power: false });
    return true;
  }

  /** Which building is this point inside (interior footprint)? */
  inside(p) {
    for (const b of this.list) if (p.x > b.box.min.x && p.x < b.box.max.x && p.z > b.box.min.z && p.z < b.box.max.z && p.y < b.box.max.y) return b;
    return null;
  }

  nearestDoor(p, maxD = 1.7) {
    let best = null, bd = maxD;
    for (const d of this.doors) { const dd = Math.hypot(d.center.x - p.x, d.center.z - p.z); if (dd < bd && Math.abs(d.center.y - p.y) < 2.5) { bd = dd; best = d; } }
    return best;
  }

  nearestSwitch(p, maxD = 1.4) {
    let best = null, bd = maxD;
    for (const s of this.switches) { const d = s.pos.distanceTo(_v.set(p.x, p.y + 1.2, p.z)); if (d < bd) { bd = d; best = s; } }
    return best;
  }

  toggleDoor(d, open = d.target < 0.5) {
    d.target = open ? 1 : 0;
    if (open) this.game.audio.doorOpen(); else setTimeout(() => this.game.audio.doorShut(), 450);
    this.game.events.emit('door', { name: d.name, building: d.building.name, open });
  }

  /** NPCs and officers push doors open as they walk through them. */
  autoOpen(p) {
    for (const d of this.doors) {
      if (d.locked) continue;
      if (Math.hypot(d.center.x - p.x, d.center.z - p.z) < 2.0) { if (d.target < 1) this.toggleDoor(d, true); d.auto = 4; }
    }
  }

  breakPane(p) {
    if (p.broken) return;
    p.broken = true;
    this.paneMesh.setMatrixAt(p.index, _m.makeScale(0, 0, 0));
    this.paneMesh.instanceMatrix.needsUpdate = true;
    this.game.effects.sparks(p.center, 24, '#cfe8ff', 4);
    this.game.audio.glass();
    this.game.events.emit('glass', { building: p.building.name });
    if (p.building.alarm && p.building.house && p.building.power) this.game.burglary && this.game.burglary.alarm(p.building);
  }

  /** Ray (origin, unit dir) vs every intact pane; returns { pane, t } of the closest hit. */
  rayPanes(o, d, maxT) {
    let best = null, bt = maxT;
    const inv = new THREE.Matrix4(), m3 = new THREE.Matrix3(), lo = new THREE.Vector3(), ld = new THREE.Vector3();
    for (const p of this.panes) {
      if (p.broken || p.center.distanceToSquared(o) > (bt + 3) * (bt + 3)) continue;
      inv.compose(p.center, p.quat, p.size).invert();
      lo.copy(o).applyMatrix4(inv);
      ld.copy(d).applyMatrix3(m3.setFromMatrix4(inv)); // affine: local t == world t
      const t = rayUnitBox(lo, ld);
      if (t !== null && t < bt) { bt = t; best = p; }
    }
    return best ? { pane: best, t: bt } : null;
  }

  update(dt) {
    const g = this.game;
    for (const d of this.doors) {
      if (d.auto > 0) { d.auto -= dt; if (d.auto <= 0 && d.target > 0 && !d.held) this.toggleDoor(d, false); }
      const prev = d.t;
      d.t += THREE.MathUtils.clamp(d.target - d.t, -dt * 2.2, dt * 2.2);
      if (d.t !== prev) {
        d.node.rotation.y = d.base + d.open * d.t;
        d.node.updateMatrixWorld(true);
        for (const c of d.cols) g.physics.syncCollider(c);
      }
    }
    for (const h of this.hinges) {
      h.t += THREE.MathUtils.clamp(h.target - h.t, -dt * 2, dt * 2);
      h.node.rotation[h.node.userData.hinge] = h.base + (h.node.userData.open || 0) * h.t;
    }
    for (const b of this.list) if (b.breaker && b.breaker.lever) b.breaker.lever.rotation.z = (b.breaker.lever.userData.open || -2) * (b.power ? 0 : 1);
  }
}

/** Slab test of a ray (in box-local space where the box is the unit cube [-0.5, 0.5]^3); d is NOT normalised. */
function rayUnitBox(o, d) {
  let t0 = -Infinity, t1 = Infinity;
  for (const k of ['x', 'y', 'z']) {
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < -0.5 || o[k] > 0.5) return null; continue; }
    let a = (-0.5 - o[k]) / d[k], b = (0.5 - o[k]) / d[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0 >= 0 ? t0 : t1 >= 0 ? 0 : null;
}
