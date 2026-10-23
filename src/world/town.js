import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { LAYOUT, PLANT } from '../config.js';
import { terrainHeight, addRoad, addPad, addSidewalk } from './terrain.js';
import { cobwebTexture, bannerTexture } from './atmosphere.js';
import { G } from '../core/physics.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Pool of real PointLights re-assigned every few frames to the nearest emissive light sources. */
export class LightPool {
  constructor(scene, n = 10) {
    this.sources = [];
    this.lights = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight('#ffb36b', 0, 22, 1.6);
      scene.add(l);
      this.lights.push(l);
    }
    this.t = 0;
  }
  add(pos, color = '#ffb36b', intensity = 18, flicker = false, range = 22) {
    this.sources.push({ pos: pos.clone(), color: new THREE.Color(color), intensity, flicker, range, ph: Math.random() * 100 });
  }
  update(dt, focus) {
    this.t += dt;
    if ((this._acc = (this._acc || 0) + dt) > 0.3) {
      this._acc = 0;
      this.sources.sort((a, b) => a.pos.distanceToSquared(focus) - b.pos.distanceToSquared(focus));
    }
    this.lights.forEach((l, i) => {
      const s = this.sources[i];
      if (!s) { l.intensity = 0; return; }
      l.position.copy(s.pos);
      l.color.copy(s.color);
      l.distance = s.range;
      let k = 1;
      if (s.flicker) { const f = Math.sin(this.t * 13 + s.ph) * Math.sin(this.t * 7.3 + s.ph * 2); k = f > 0.6 ? 0.15 : 0.85 + 0.15 * Math.sin(this.t * 30 + s.ph); }
      l.intensity = s.intensity * k;
    });
  }
}

/** Props that are static until a car smashes them (then they become dynamic rigid bodies). */
export class Breakables {
  constructor(game) {
    this.game = game;
    this.items = [];
  }
  add(obj, half, kind) {
    const b = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, collisionResponse: false, collisionFilterGroup: G.PROP, collisionFilterMask: G.CAR | G.STATIC,
      material: this.game.physics.mat.prop });
    b.addShape(new CANNON.Box(new CANNON.Vec3(half.x, half.y, half.z)), new CANNON.Vec3(0, half.y, 0));
    b.position.set(obj.position.x, obj.position.y, obj.position.z);
    b.quaternion.setFromEuler(0, obj.rotation.y, 0);
    const item = { obj, body: b, kind, broken: false };
    b.userData = { kind: 'prop', item };
    b.addEventListener('collide', (e) => this._hit(item, e));
    this.game.physics.world.addBody(b);
    this.items.push(item);
  }
  _hit(item, e) {
    if (item.broken) return;
    const other = e.body;
    if (!other.userData || other.userData.kind !== 'car') return;
    const v = other.velocity;
    if (v.length() < 3) return;
    item.broken = true;
    const b = item.body;
    b.type = CANNON.Body.DYNAMIC;
    b.mass = item.kind === 'HayBale' ? 40 : 25;
    b.updateMassProperties();
    b.collisionResponse = true;
    b.velocity.set(v.x * 1.1 + rnd(-1, 1), 3 + v.length() * 0.2, v.z * 1.1 + rnd(-1, 1));
    b.angularVelocity.set(rnd(-6, 6), rnd(-6, 6), rnd(-6, 6));
    b.linearDamping = 0.2;
    item.t = 0;
    this.game.audio.crash(6);
    this.game.effects.sparks(new THREE.Vector3(b.position.x, b.position.y + 0.5, b.position.z), 10, '#ffd28a');
    if (item.kind === 'HayBale') this.game.effects.dust(new THREE.Vector3(b.position.x, b.position.y + 0.5, b.position.z), 14, '#d9b860');
    this.game.events.emit('propSmashed', { item, vehicle: other.userData.vehicle });
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.broken) continue;
      it.t += dt;
      const b = it.body;
      it.obj.position.set(b.position.x, b.position.y, b.position.z);
      it.obj.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      if (it.t > 25) { // respawn quietly
        it.broken = false;
        b.type = CANNON.Body.STATIC; b.mass = 0; b.updateMassProperties(); b.collisionResponse = false;
        b.velocity.setZero(); b.angularVelocity.setZero();
        b.position.set(it.home.x, it.home.y, it.home.z);
        b.quaternion.setFromEuler(0, it.homeRot, 0);
        it.obj.position.copy(it.home);
        it.obj.rotation.set(0, it.homeRot, 0);
      }
    }
  }
}

/** Leaf piles that explode when driven through, then slowly settle back. */
export class LeafPiles {
  constructor(scene) {
    this.piles = [];
    this.n = 70;
    const max = 40 * this.n;
    const geo = new THREE.PlaneGeometry(0.26, 0.26);
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(16, 1); g.quadraticCurveTo(31, 13, 16, 31); g.quadraticCurveTo(1, 13, 16, 1); g.fill();
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c), alphaTest: 0.4, side: THREE.DoubleSide }), max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.leaves = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(1, 1, 1);
    this.pal = ['#d4561a', '#b33a12', '#e89a1f', '#8e3b14', '#c97a19'].map((h) => new THREE.Color(h));
  }
  add(x, z, y = null) {
    const base = y ?? terrainHeight(x, z);
    const pile = { x, z, y: base, r: 1.4, scattered: false, t: 0, start: this.leaves.length };
    for (let i = 0; i < this.n; i++) {
      const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * pile.r;
      const h = (1 - r / pile.r) * 0.55 * Math.random();
      const home = new THREE.Vector3(x + Math.cos(a) * r, base + 0.05 + h, z + Math.sin(a) * r);
      this.leaves.push({ home, p: home.clone(), v: new THREE.Vector3(), rot: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), spin: 0 });
      this.mesh.setColorAt(this.leaves.length - 1, pick(this.pal));
    }
    this.piles.push(pile);
    this.mesh.count = this.leaves.length;
  }
  disturb(pos, speed) {
    for (const p of this.piles) {
      if (p.scattered) continue;
      const d = Math.hypot(pos.x - p.x, pos.z - p.z);
      if (d < p.r + 1.6 && speed > 3) {
        p.scattered = true; p.t = 0;
        for (let i = p.start; i < p.start + this.n; i++) {
          const L = this.leaves[i];
          L.v.set(rnd(-1, 1) * speed * 0.35, rnd(2, 5) + speed * 0.15, rnd(-1, 1) * speed * 0.35);
          L.spin = rnd(4, 12);
        }
        this.lastScatter = performance.now();
        return true;
      }
    }
    return false;
  }
  update(dt) {
    for (const p of this.piles) {
      if (!p.scattered) continue;
      p.t += dt;
      for (let i = p.start; i < p.start + this.n; i++) {
        const L = this.leaves[i];
        if (p.t < 6) {
          L.v.y -= 3.2 * dt; L.v.multiplyScalar(1 - dt * 0.9);
          L.p.addScaledVector(L.v, dt);
          const gy = terrainHeight(L.p.x, L.p.z) + 0.04;
          if (L.p.y < gy) { L.p.y = gy; L.v.set(0, 0, 0); L.spin = 0; }
          L.rot.x += L.spin * dt; L.rot.z += L.spin * 0.7 * dt;
        } else if (p.t > 20) L.p.lerp(L.home, Math.min(1, dt * 0.8));
      }
      if (p.t > 26) { p.scattered = false; for (let i = p.start; i < p.start + this.n; i++) this.leaves[i].p.copy(this.leaves[i].home); }
    }
    for (let i = 0; i < this.leaves.length; i++) {
      const L = this.leaves[i];
      this._e.set(L.rot.x, L.rot.y, L.rot.z);
      this._m.compose(L.p, this._q.setFromEuler(this._e), this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Builds Main Street, Elm Avenue, the suburbs, decorations and returns gameplay anchors. */
export function buildTown(game) {
  const { scene, assets, physics, batcher } = game;
  const out = { roads: [], buildings: [], spots: {}, parking: [], pedestrianPaths: [], lightPoints: [] };
  const road = (pts, w, kind = 'asphalt', pr = 1) => {
    const line = addRoad(scene, pts, w, kind, pr);
    out.roads.push({ line, width: w, kind });
    return line;
  };
  // ---------------------------------------------------------------- roads & ground
  const M = LAYOUT.mainStreet;
  out.mainLine = road([[M.x0, 0], [M.x1, 0]], M.width, 'asphalt', 2);
  out.elmLine = road([[0, 7], [0, 146]], LAYOUT.elm.width, 'asphalt', 1);
  out.hillLine = road(LAYOUT.hillRoad, 10, 'asphalt', 1);
  out.exitLine = road(LAYOUT.exitRoad, 9, 'asphalt', 1);
  addPad(scene, -60, 60, -59.6, -7.2, '#29282c', 3, true); // plant parking lot
  addPad(scene, 28, 62, 12, 34, '#2c2b30', 3); // gas forecourt
  addPad(scene, -76, -44, 8, 15, '#2c2b30', 3); // diner lot
  addPad(scene, 110, 150, 8, 13.5, '#2c2b30', 3); // police lot
  out.buildings.push({ x0: -60, x1: 60, z0: -110, z1: -60 });
  // sidewalks with curbs (cars bump over them)
  const sw = (x0, x1, z0, z1) => addSidewalk(scene, physics, x0, x1, z0, z1);
  sw(M.x0, -6.5, 7, 11); sw(6.5, M.x1, 7, 11);
  sw(M.x0, -62, -11, -7); sw(62, 71, -11, -7); sw(81, M.x1, -11, -7);
  sw(-9.5, -6, 11, 146); sw(6, 9.5, 11, 146);
  out.pedestrianPaths.push([[-180, 9], [-20, 9]], [[20, 9], [180, 9]], [[-7.8, 14], [-7.8, 140]], [[7.8, 14], [7.8, 140]], [[-190, -9], [-64, -9]], [[84, -9], [190, -9]]);

  // ---------------------------------------------------------------- buildings
  const place = (file, x, z, rot, opts = {}) => {
    const o = file.isObject3D ? file : assets.clone(file);
    o.position.set(x, opts.y ?? terrainHeight(x, z), z);
    o.rotation.y = rot;
    if (opts.scale) o.scale.setScalar(opts.scale);
    scene.add(o);
    o.updateMatrixWorld(true);
    physics.collidersFrom(o, { tag: opts.tag });
    o.traverse((n) => {
      if (n.name === 'LightPoint') { const p = n.getWorldPosition(new THREE.Vector3()); out.lightPoints.push(p); game.lights.add(p, opts.lightColor || '#ffb36b', opts.lightI || 16, Math.random() < 0.25); }
    });
    if (opts.keep) return o;
    batcher.add(o);
    scene.remove(o);
    return o;
  };
  out.place = place;
  const prop = (name, x, z, rot = 0, opts = {}) => place(assets.part('props', name), x, z, rot, opts);
  out.prop = prop;
  const bbox = (o) => { const b = new THREE.Box3().setFromObject(o); out.buildings.push({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z }); };

  const diner = place('diner', ...[LAYOUT.diner[0], LAYOUT.diner[2]], Math.PI); bbox(diner);
  const gas = place('gas_station', LAYOUT.gas[0], LAYOUT.gas[2], Math.PI); bbox(gas);
  const hw = place('hardware', LAYOUT.hardware[0], LAYOUT.hardware[2], Math.PI); bbox(hw);
  const ps = place('police_station', LAYOUT.policeStation[0], LAYOUT.policeStation[2], Math.PI); bbox(ps);
  out.spots.dinerDoor = new THREE.Vector3(-58.5, 0, 15.2);
  out.spots.policeDoor = new THREE.Vector3(130, 0, 11.5);

  const houses = [];
  const addHouse = (file, x, z, rot) => {
    const h = assets.clone(file);
    const sid = new THREE.Color().setHSL(Math.random(), rnd(0.15, 0.35), rnd(0.35, 0.55));
    h.traverse((m) => { if (m.isMesh && m.material.name === 'Siding') m.material = (addHouse.mats ||= {})[sid.getHexString()] ||= Object.assign(m.material.clone(), { color: sid }); });
    place(h, x, z, rot, { keep: true });
    bbox(h);
    const porch = h.getObjectByName('Porch_Spot');
    houses.push({ obj: h, x, z, rot, porch: porch ? porch.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(x, 0, z) });
    batcher.add(h);
    scene.remove(h);
  };
  for (const [f, x] of [['house_a', -175], ['house_b', -150], ['house_a', -120], ['house_b', -92], ['house_b', 100], ['house_a', 128], ['house_b', 155], ['house_a', 182]]) addHouse(f, x, -30, 0);
  for (const [f, x] of [['house_b', -175], ['house_a', -100], ['house_a', 85], ['house_b', 175]]) addHouse(f, x, 32, Math.PI);
  for (const z of [42, 66, 90, 114, 136]) {
    addHouse(z % 48 ? 'house_a' : 'house_b', -24, z, Math.PI / 2);
    addHouse(z % 36 ? 'house_b' : 'house_a', 24, z, -Math.PI / 2);
  }
  out.houses = houses;

  // ---------------------------------------------------------------- Halloween yards
  const fwd = (rot) => new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
  const side = (rot) => new THREE.Vector3(Math.cos(rot), 0, -Math.sin(rot));
  houses.forEach((h, i) => {
    const f = fwd(h.rot), s = side(h.rot);
    const p = h.porch;
    for (let k = 0; k < 3; k++) {
      const q = p.clone().addScaledVector(s, -1.2 + k * 1.1).addScaledVector(f, 0.6 + (k % 2) * 0.3);
      prop(k === 1 ? 'Pumpkin' : 'Pumpkin_Lantern', q.x, q.z, h.rot + rnd(-0.4, 0.4), { y: 0.68 });
    }
    game.lights.add(p.clone().setY(1.2), '#ff8a2a', 6, true, 9);
    const yard = new THREE.Vector3(h.x, 0, h.z).addScaledVector(f, 9.5);
    const deco = i % 5;
    if (deco === 0) { prop('Tombstone_Round', yard.x + s.x * 3, yard.z + s.z * 3, h.rot + 0.2); prop('Tombstone_Cross', yard.x - s.x * 2, yard.z - s.z * 2, h.rot - 0.15); }
    if (deco === 1) { const g = assets.part('props', 'Ghost'); g.position.set(yard.x + s.x * 3, terrainHeight(yard.x, yard.z) + 0.2, yard.z + s.z * 3); scene.add(g); (out.ghosts ||= []).push(g); }
    if (deco === 2) { prop('Scarecrow', yard.x - s.x * 3, yard.z - s.z * 3, h.rot); prop('HayBale', yard.x + s.x * 2, yard.z + s.z * 2, h.rot + 0.3); }
    if (deco === 3) { prop('Skeleton_Prop', yard.x + s.x * 2.5, yard.z + s.z * 2.5, h.rot); prop('Tombstone_Slab', yard.x - s.x * 2, yard.z - s.z * 2, h.rot); }
    if (deco === 4) { prop('Pumpkin', yard.x, yard.z, rnd(0, 6)); prop('Pumpkin', yard.x + 0.7, yard.z + 0.3, rnd(0, 6)); prop('Pumpkin_Lantern', yard.x - 0.6, yard.z + 0.5, h.rot); }
    // mailbox (breakable) at the curb
    const mb = yard.clone().addScaledVector(f, 2.5).addScaledVector(s, 3.5);
    out.breakSpots = out.breakSpots || [];
    out.breakSpots.push(['Mailbox', mb.x, mb.z, h.rot]);
    // cobweb on the porch roof corner
    const web = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), (buildTown.webMat ||= new THREE.MeshBasicMaterial({ map: cobwebTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.85 })));
    const wp = p.clone().addScaledVector(f, 1.4).addScaledVector(s, 2.2);
    web.position.set(wp.x, 2.7, wp.z);
    web.rotation.y = h.rot;
    scene.add(web);
  });

  // ---------------------------------------------------------------- street furniture
  for (let x = -185; x <= 185; x += 32) {
    if (Math.abs(x) > 8) prop('Streetlight', x, 12, Math.PI);
    if (!(x > -62 && x < 62) && Math.abs(x - 76) > 6) prop('Streetlight', x + 16, -12, 0);
  }
  for (let z = 22; z <= 140; z += 30) { prop('Streetlight', -10.8, z, Math.PI / 2); prop('Streetlight', 10.8, z + 15, -Math.PI / 2); }
  for (let i = 1; i < out.hillLine.length - 1; i += 10) {
    const p = out.hillLine[i];
    prop('Lantern_Post', p.x + 6.2, p.z, 0, { lightColor: '#ffa040', lightI: 10 });
  }
  for (let x = -40; x <= 40; x += 20) prop('Streetlight', x, -35, Math.PI / 2, { lightColor: '#ffe0b0' });
  for (const [x, z] of [[-30, 9], [52, 9], [-140, 9], [120, -9]]) prop('Bench', x, z + (z > 0 ? 1.2 : -1.2), z > 0 ? Math.PI : 0);
  // breakables: hydrants, barrels, hay bales along the streets
  const brk = [];
  for (let x = -170; x <= 170; x += 45) brk.push(['Hydrant', x + 5, 10.2, 0]);
  brk.push(['Barrel', 34, 30, 0], ['Barrel', 35, 31.2, 0], ['HayBale', -48, 13, 0.3], ['HayBale', -46.5, 13.4, -0.2], ['Barrel', -10, 150, 0], ['HayBale', 8, 150, 1]);
  out.breakSpots = [...(out.breakSpots || []), ...brk];
  for (const [name, x, z, rot] of out.breakSpots) {
    const o = assets.part('props', name);
    o.position.set(x, terrainHeight(x, z), z);
    o.rotation.y = rot;
    scene.add(o);
    const half = { Hydrant: [0.2, 0.42, 0.2], Mailbox: [0.15, 0.65, 0.3], Barrel: [0.33, 0.45, 0.33], HayBale: [0.6, 0.3, 0.35] }[name];
    game.breakables.add(o, { x: half[0], y: half[1], z: half[2] }, name);
    const it = game.breakables.items.at(-1);
    it.home = o.position.clone(); it.homeRot = rot;
  }
  // banners over the streets
  const banner = (x, z, rot, text, bg) => {
    const b = assets.part('props', 'Banner');
    b.scale.set(4.6, 1.15, 1);
    b.position.set(x, terrainHeight(x, z), z);
    b.rotation.y = rot;
    const cloth = b.getObjectByName('Banner_Cloth');
    cloth.geometry = new THREE.BoxGeometry(3.8, 1.2, 0.03).translate(0, 4.6, 0); // per-face UVs: text reads correctly from both sides
    cloth.material = new THREE.MeshStandardMaterial({ map: bannerTexture(text, bg), side: THREE.DoubleSide, roughness: 0.9 });
    scene.add(b);
    physics.collidersFrom(b);
    return b;
  };
  out.banners = [banner(-34, 0, Math.PI / 2, 'HAPPY HALLOWEEN', '#ff7a10'), banner(96, 0, Math.PI / 2, 'TRUNK-OR-TREAT TONIGHT', '#7b2cbf'),
    banner(0, 60, 0, 'SPOOKTACULAR', '#ff7a10'), banner(0, 156, 0, 'CEMETERY ▲ FOG AHEAD', '#3a5a3a')];

  // ---------------------------------------------------------------- trees (batched, 4 foliage tints)
  const tints = ['#e2671c', '#c43a12', '#f0a020', '#a8481a', '#d98c1a'];
  const treeMats = tints.map((t) => null);
  const tree = (x, z, s = 1) => {
    const t = assets.part('props', Math.random() < 0.12 ? 'Tree_Dead' : 'Tree_Autumn');
    const k = Math.floor(Math.random() * tints.length);
    t.traverse((m) => { if (m.isMesh && m.material.name === 'Foliage') m.material = treeMats[k] ||= Object.assign(m.material.clone(), { color: new THREE.Color(tints[k]) }); });
    t.scale.setScalar(s * rnd(0.8, 1.25));
    place(t, x, z, rnd(0, 6.28));
  };
  const clearOf = (x, z, r) => !out.buildings.some((b) => x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r);
  for (let x = -190; x <= 190; x += 17) {
    for (const z of [14.5, -14.5]) if (clearOf(x, z, 1.5) && Math.abs(x) > 12 && !(z < 0 && x > -64 && x < 82)) tree(x + rnd(-3, 3), z + Math.sign(z) * rnd(0, 2));
  }
  for (let z = 18; z <= 140; z += 14) for (const x of [-13, 13]) if (clearOf(x, z, 1)) tree(x + rnd(-1, 1), z + rnd(-3, 3));
  let placed = 0;
  for (let i = 0; i < 900 && placed < 190; i++) {
    const x = rnd(-205, 205), z = rnd(-150, 212);
    const nearRoad = Math.abs(z) < 16 || (Math.abs(x) < 16 && z > 0 && z < 150) || (z > 140 && z < 225 && Math.abs(x) < 26) ||
      (x > -66 && x < 82 && z < -6 && z > -118) || (x > 68 && x < 84 && z < 0 && z > -100);
    if (nearRoad || !clearOf(x, z, 4)) continue;
    tree(x, z, z > 150 ? 1.1 : 1);
    placed++;
  }
  // ---------------------------------------------------------------- leaf piles
  for (let i = 0; i < 18; i++) {
    const x = rnd(-180, 180);
    if (Math.abs(x) < 64) continue;
    game.leafPiles.add(x, rnd(-10, -8) * (i % 2 ? -1 : 1));
  }
  for (let z = 30; z < 140; z += 22) game.leafPiles.add(rnd(-8.5, -7), z);
  for (const [x, z] of [[-3, 40], [3, 95], [-2, 160], [4, 190], [-40, -40], [30, -20], [70, -40], [-120, 3], [140, -3], [10, 3]]) game.leafPiles.add(x, z);

  // ---------------------------------------------------------------- parking spots for civilian cars
  out.parking = [
    [-100, -5.6, -Math.PI / 2], [-150, -5.6, -Math.PI / 2], [130, 5.6, Math.PI / 2], [160, -5.6, -Math.PI / 2], [-60, 13, Math.PI / 2],
    [-66, 13, Math.PI / 2], [40, 18, 0], [118, 12.6, Math.PI / 2], [-30, -30, 0], [-24, -30, 0], [30, -30, Math.PI], [-4.6, 60, 0],
    [4.6, 100, Math.PI], [-120, -18, 0], [150, 18, Math.PI], [-175, 18, Math.PI],
  ];
  return out;
}
