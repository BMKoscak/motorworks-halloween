import * as THREE from 'three';
import { G } from '../core/physics.js';

/** Weapon table. Slots map to number keys 1-5. */
export const WEAPONS = [
  { id: 'unarmed', slot: 1, name: 'Fists', melee: true, damage: 12, range: 1.5, rate: 0.45 },
  { id: 'crowbar', slot: 2, name: 'Crowbar', melee: true, damage: 35, range: 1.9, rate: 0.55, model: 'Weapon_Crowbar' },
  { id: 'pistol', slot: 3, name: '9mm Pistol', mag: 12, damage: 34, spread: 0.012, rate: 0.22, range: 120, model: 'Weapon_Pistol', pellets: 1, ammoBox: 24 },
  { id: 'shotgun', slot: 4, name: 'Pump Shotgun', mag: 6, damage: 14, spread: 0.07, rate: 0.85, range: 45, model: 'Weapon_Shotgun', pellets: 8, ammoBox: 8 },
  { id: 'launcher', slot: 5, name: "Jack-o'-Lantern Launcher", mag: 1, damage: 120, spread: 0.005, rate: 1.1, range: 90, model: 'Weapon_Launcher', projectile: true, ammoBox: 4 },
];
export const weaponById = (id) => WEAPONS.find((w) => w.id === id);

const _v = new THREE.Vector3();

/**
 * Third-person/first-person aiming & shooting (RMB aim, LMB fire, R reload on foot, 1-5 select).
 * Hitscan bullets resolve the closest of: static geometry, vehicles (tires / engine / body), characters
 * (capsule test), window panes, street/porch lights and breaker boxes. The pumpkin launcher fires a
 * ballistic projectile that explodes. Firing near witnesses or hitting people escalates the wanted level.
 */
export class Combat {
  constructor(game) {
    this.game = game;
    this.owned = { unarmed: true };
    this.ammo = {}; // id -> { mag, reserve }
    this.current = 'unarmed';
    this.cool = 0;
    this.reloadT = 0;
    this.aiming = false;
    this.health = 100;
    this.hurtT = 0;
    this.shots = 0;
    this.projectiles = [];
    this.tracers = [];
    this.log = [];
    this.stats = { shotsFired: 0, hits: {}, tiresPopped: 0, panesBroken: 0, lightsShot: 0 };
    this.flash = new THREE.PointLight('#ffcc66', 0, 9, 2);
    game.scene.add(this.flash);
    this.tracerMat = new THREE.LineBasicMaterial({ color: '#ffe0a0', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.pumpkinMat = new THREE.MeshStandardMaterial({ color: '#ff7a1a', emissive: '#ff5a00', emissiveIntensity: 1.4, roughness: 0.5 });
    this.pumpkinGeo = new THREE.SphereGeometry(0.16, 10, 8);
    this.pumpkinGeo.scale(1, 0.85, 1);
  }

  get weapon() { return weaponById(this.current); }

  give(id, ammo = 0) {
    const w = weaponById(id);
    if (!w) return;
    const first = !this.owned[id];
    this.owned[id] = true;
    if (w.mag) {
      const a = (this.ammo[id] ||= { mag: 0, reserve: 0 });
      if (first) a.mag = w.mag;
      a.reserve += ammo;
    }
    if (first) this.select(id);
    this.game.events.emit('weaponAcquired', { id });
  }

  addAmmo(n = 1) {
    for (const w of WEAPONS) if (w.mag && this.owned[w.id] && w.id !== 'launcher') this.ammo[w.id].reserve += w.ammoBox * n;
  }

  select(id) {
    if (!this.owned[id]) return false;
    this.current = id;
    this.reloadT = 0;
    const w = this.weapon;
    const ch = this.game.player.char;
    if (this.held) { this.held.parent && this.held.parent.remove(this.held); this.held = null; }
    if (w.model) {
      const m = this.game.assets.part('props', w.model);
      m.rotation.set(Math.PI / 2, 0, 0);
      m.position.set(0, -0.05, 0.02);
      this.held = m;
      this.muzzle = m.getObjectByName('Muzzle_' + w.model.split('_')[1]);
      m.userData.noBake = true;
      ch.j.Hand_R.add(m);
    } else this.muzzle = null;
    this.game.audio.blip(700, 0.04);
    this.game.events.emit('weapon', { id });
    return true;
  }

  reload() {
    const w = this.weapon, a = this.ammo[w.id];
    if (!w.mag || !a || a.mag >= w.mag || a.reserve <= 0 || this.reloadT > 0) return false;
    this.reloadT = w.id === 'shotgun' ? 1.6 : 1.1;
    this.game.audio.reload(w.id);
    return true;
  }

  // ------------------------------------------------------------------ frame (on foot)
  update(dt, input) {
    const g = this.game;
    this.cool = Math.max(0, this.cool - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (this.health < 100 && this.hurtT <= 0) this.health = Math.min(100, this.health + dt * 4);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { const w = this.weapon, a = this.ammo[w.id]; const n = Math.min(w.mag - a.mag, a.reserve); a.mag += n; a.reserve -= n; }
    }
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 220);
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.08) * 0.85;
      if (t.life <= 0) { g.scene.remove(t.line); t.line.geometry.dispose(); this.tracers.splice(i, 1); }
    }
    this._updateProjectiles(dt);
    const onFoot = !g.player.vehicle && g.mode === 'play' && !g.busy;
    this.aiming = onFoot && input.mouseDown2();
    if (!onFoot) return;
    for (const w of WEAPONS) if (input.pressed('Digit' + w.slot)) { if (!this.select(w.id)) g.hud.toast(`${w.name} not owned — buy one at the Hardware Store`); }
    if (input.pressed('KeyR')) this.reload();
    if (input.mouseDown1() && this.cool <= 0 && this.reloadT <= 0 && !g.player.carrying) this.fire();
  }

  /** Camera ray through the crosshair. */
  aimRay() {
    const cam = this.game.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    return { o: cam.position.clone(), d: dir };
  }

  fire(aimPoint = null) {
    const g = this.game, w = this.weapon;
    const p = g.player;
    if (w.mag) {
      const a = this.ammo[w.id];
      if (a.mag <= 0) { g.audio.dryFire(); this.cool = 0.3; if (a.reserve > 0) this.reload(); return false; }
      a.mag--;
    }
    this.cool = w.rate;
    this.stats.shotsFired++;
    // face the shot and lift the weapon arm toward the aim point
    const ray = this.aimRay();
    if (aimPoint) { ray.o = g.camera.position.clone(); ray.d = aimPoint.clone().sub(ray.o).normalize(); }
    const flat = ray.d.clone().setY(0).normalize();
    p.facing = Math.atan2(flat.x, flat.z);
    p.char.aimPitch = Math.asin(THREE.MathUtils.clamp(ray.d.y, -0.9, 0.9));
    p.shootT = 0.35;
    if (w.melee) return this._melee(w, flat);
    p.char.root.updateMatrixWorld(true);
    const muzzle = this.muzzle ? this.muzzle.getWorldPosition(new THREE.Vector3()) : p.position.clone().add(new THREE.Vector3(0, 1.4, 0));
    // where the crosshair points
    const aimHit = this.trace(ray.o, ray.d, w.range, true);
    const target = aimHit ? aimHit.point : ray.o.clone().addScaledVector(ray.d, w.range);
    this._muzzleFx(muzzle, flat, w);
    if (w.projectile) this._launch(muzzle, target.clone().sub(muzzle).normalize());
    else {
      for (let k = 0; k < (w.pellets || 1); k++) {
        const d = target.clone().sub(muzzle).normalize();
        d.x += (Math.random() - 0.5) * w.spread * 2; d.y += (Math.random() - 0.5) * w.spread * 2; d.z += (Math.random() - 0.5) * w.spread * 2;
        d.normalize();
        const hit = this.trace(muzzle, d, w.range, false);
        const end = hit ? hit.point : muzzle.clone().addScaledVector(d, w.range);
        this._tracer(muzzle, end);
        if (hit) this._impact(hit, w, d);
      }
    }
    this._witness(muzzle);
    g.events.emit('shot', { weapon: w.id });
    return true;
  }

  _melee(w, dir) {
    const g = this.game, p = g.player.position;
    g.audio.swing();
    const o = p.clone().add(new THREE.Vector3(0, 1.1, 0));
    const hit = this.trace(o, dir, w.range, false);
    if (hit) { this._impact(hit, w, dir); g.audio.clunk(); }
    return true;
  }

  // ------------------------------------------------------------------ hit resolution
  /** Closest hit along a ray among every shootable thing. */
  trace(o, d, range, fromCamera) {
    const g = this.game;
    let best = null;
    const consider = (h) => { if (h && h.t > 0.05 && (!best || h.t < best.t)) best = h; };
    const end = o.clone().addScaledVector(d, range);
    const sh = g.physics.rayAny(o, end, G.STATIC | G.CAR | G.PROP);
    if (sh) {
      const ud = sh.body.userData || {};
      const t = sh.distance;
      if (ud.kind === 'car') consider({ t, point: sh.point, type: 'car', body: sh.body });
      else if (ud.kind === 'prop') consider({ t, point: sh.point, type: 'prop', body: sh.body });
      else consider({ t, point: sh.point, type: 'static', body: sh.body });
    }
    const pane = g.buildings.rayPanes(o, d, best ? best.t : range);
    if (pane) consider({ t: pane.t, point: o.clone().addScaledVector(d, pane.t), type: 'pane', pane: pane.pane, through: true });
    for (const c of this._characters()) {
      if (fromCamera && c.isPlayer) continue;
      const t = rayCapsule(o, d, c.base, c.r, c.h);
      if (t !== null && t < (best ? best.t : range)) consider({ t, point: o.clone().addScaledVector(d, t), type: 'char', who: c });
    }
    for (const L of this._lights()) {
      const t = raySphere(o, d, L.pos, L.r);
      if (t !== null && t < (best ? best.t : range)) consider({ t, point: o.clone().addScaledVector(d, t), type: 'light', light: L });
    }
    for (const b of g.buildings.list) {
      if (!b.breaker || !b.power) continue;
      const t = raySphere(o, d, b.breaker.pos, 0.38);
      if (t !== null && t < (best ? best.t : range)) consider({ t, point: o.clone().addScaledVector(d, t), type: 'breaker', building: b });
    }
    return best;
  }

  _characters() {
    const g = this.game, out = [];
    const add = (char, kind, ref) => {
      if (!char || !char.root.visible || !char.root.parent) return;
      const base = char.root.getWorldPosition(new THREE.Vector3());
      const s = char.root.getWorldScale(_v).y;
      out.push({ char, kind, ref, base, r: 0.32 * s, h: 1.8 * s });
    };
    for (const n of g.npcs.allPeople()) add(n.char, n.kind || 'npc', n);
    for (const o of g.police.officers) if (!o.seated) add(o.char, 'police', o);
    if (!g.player.vehicle) out.push({ char: g.player.char, kind: 'player', isPlayer: true, base: g.player.position.clone(), r: 0.32, h: 1.8 });
    return out;
  }

  _lights() {
    const g = this.game;
    return (g.town.shootLights || []).filter((L) => !L.broken);
  }

  _impact(hit, w, dir) {
    const g = this.game, fx = g.effects;
    const kind = hit.type;
    this.stats.hits[kind] = (this.stats.hits[kind] || 0) + 1;
    this.log.push({ kind, weapon: w.id, t: Math.round(performance.now()) });
    if (this.log.length > 40) this.log.shift();
    if (kind === 'static' || kind === 'prop') {
      fx.sparks(hit.point, 8, '#ffd08a', 3);
      fx.dust(hit.point, 3, '#9a8f84');
      if (hit.body && hit.body.userData.item) g.breakables.shoot(hit.body.userData.item, dir);
    } else if (kind === 'pane') {
      g.buildings.breakPane(hit.pane);
      this.stats.panesBroken++;
      this._witnessCrime('property', 1, hit.point);
    } else if (kind === 'light') {
      this._breakLight(hit.light, hit.point);
    } else if (kind === 'breaker') {
      g.buildings.cutPower(hit.building);
      fx.sparks(hit.point, 30, '#9fd8ff', 5);
    } else if (kind === 'car') {
      this._hitVehicle(hit, w, dir);
    } else if (kind === 'char') {
      fx.sparks(hit.point, 6, '#ff4040', 2);
      const c = hit.who;
      if (c.kind === 'player') return this.hurtPlayer(w.damage * 0.4, 'friendly');
      if (c.kind === 'police') { g.police.hitOfficer(c.ref, w.damage); g.police.crime('assault_officer', 2); }
      else { g.npcs.hit(c.ref, w.damage, dir); g.police.crime('assault', 2); }
    }
  }

  _hitVehicle(hit, w, dir) {
    const g = this.game, fx = g.effects;
    const body = hit.body, ud = body.userData;
    const veh = ud.vehicle || null;
    const entry = ud.entry || null;
    const vis = veh ? veh.visual : entry ? entry.visual : null;
    fx.sparks(hit.point, 10, '#ffe0a0', 3.5);
    g.audio.ricochet();
    if (!vis) return;
    vis.root.updateMatrixWorld(true);
    const local = vis.root.worldToLocal(hit.point.clone());
    // tyre? closest wheel centre within 0.55 m
    let wi = -1, wd = 0.55;
    vis.wheelNodes.forEach((wn, i) => { const c = wn.knuckle.getWorldPosition(new THREE.Vector3()); const d = c.distanceTo(hit.point); if (d < wd) { wd = d; wi = i; } });
    const dmg = w.damage * (w.pellets ? 1 : 1);
    if (wi >= 0) {
      if (veh) veh.popTire(wi); else this._popLite(entry, wi);
      this.stats.tiresPopped++;
    } else if (local.z > vis.info.cowlZ - 0.4) {
      if (veh) veh.damageEngine(dmg * 0.9); else (entry.engine = (entry.engine ?? 100) - dmg);
    } else if (veh) veh.damageEngine(dmg * 0.15);
    if (entry && entry.kind === 'driving') { g.traffic.bump(body, 999); entry.disabled = true; g.npcs.ejectDriver(entry); }
    if (entry && entry.kind === 'parked' && entry.alarm && !entry.alarmed) { entry.alarmed = true; entry.hazard = 6; g.audio.alarm(6); }
    if (veh && veh.kind === 'police') g.police.crime('assault_officer', 2);
    else this._witnessCrime('property', 1, hit.point);
    g.events.emit('vehicleHit', { tire: wi, police: !!(veh && veh.kind === 'police') });
  }

  _popLite(entry, i) {
    entry.flats = entry.flats || [false, false, false, false];
    if (entry.flats[i]) return;
    entry.flats[i] = true;
    this.game.audio.tirePop();
    const w = entry.visual.wheelNodes[i];
    w.knuckle.position.y -= 0.12;
    this.game.effects.dust(w.knuckle.getWorldPosition(new THREE.Vector3()), 8, '#555');
  }

  _breakLight(L, point) {
    const g = this.game;
    L.broken = true;
    this.stats.lightsShot++;
    g.lights.setOn(L.source, false);
    g.effects.sparks(point, 26, L.kind === 'lantern' ? '#ffa040' : '#fff2c0', 4.5);
    g.audio.glass();
    if (L.onBreak) L.onBreak();
    this._witnessCrime('property', 1, point);
    g.events.emit('lightShot', { kind: L.kind });
  }

  hurtPlayer(dmg, src = 'police') {
    const g = this.game;
    if (g.mode !== 'play') return;
    this.health = Math.max(0, this.health - dmg);
    this.hurtT = 4;
    g.hud.flash('#ff1a1a', 0.35);
    g.effects.shake = Math.min(1, g.effects.shake + 0.3);
    if (this.health <= 0) { this.health = 100; g.busted('down'); }
    g.events.emit('playerHurt', { dmg, src });
  }

  // ------------------------------------------------------------------ fx
  _muzzleFx(p, dir, w) {
    const g = this.game, fx = g.effects;
    this.flash.position.copy(p).addScaledVector(dir, 0.2);
    this.flash.intensity = w.id === 'shotgun' ? 90 : w.projectile ? 50 : 60;
    for (let i = 0; i < 6; i++) fx.emit(p.clone().addScaledVector(dir, 0.05 + Math.random() * 0.2), dir.clone().multiplyScalar(4 + Math.random() * 3), '#ffc060', 0.18, 0.06, { additive: true });
    fx.emit(p.clone(), dir.clone().multiplyScalar(1.2).add(new THREE.Vector3(0, 0.5, 0)), '#bdb6ad', 0.3, 0.9, { grow: 2, alpha: 0.35, drag: 1.5 });
    if (!w.projectile) {
      // brass shell ejected to the right of the gun
      const right = new THREE.Vector3(dir.z, 0, -dir.x);
      fx.emit(p.clone().addScaledVector(dir, -0.1), right.multiplyScalar(-2.2).add(new THREE.Vector3(0, 2.4, 0)), w.id === 'shotgun' ? '#c0281c' : '#d6b04a', 0.05, 0.9, { gravity: 9.8, additive: false });
    }
    g.audio.gunshot(w.id, p, g.listener);
  }

  _tracer(a, b) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, this.tracerMat.clone());
    this.game.scene.add(line);
    this.tracers.push({ line, life: 0.08 });
  }

  _launch(p, d) {
    const m = new THREE.Mesh(this.pumpkinGeo, this.pumpkinMat);
    m.position.copy(p);
    this.game.scene.add(m);
    this.projectiles.push({ mesh: m, v: d.clone().multiplyScalar(32).add(new THREE.Vector3(0, 2.5, 0)), life: 4 });
  }

  _updateProjectiles(dt) {
    const g = this.game;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const P = this.projectiles[i];
      P.life -= dt;
      P.v.y -= 9.8 * dt;
      const step = P.v.clone().multiplyScalar(dt);
      const hit = this.trace(P.mesh.position, step.clone().normalize(), step.length() + 0.2, false);
      P.mesh.rotation.x += dt * 8;
      if (hit && hit.type !== 'pane') { this._explode(hit.point); g.scene.remove(P.mesh); this.projectiles.splice(i, 1); continue; }
      if (hit && hit.type === 'pane') g.buildings.breakPane(hit.pane);
      P.mesh.position.add(step);
      if (Math.random() < 0.6) g.effects.emit(P.mesh.position.clone(), new THREE.Vector3(0, 0.3, 0), '#ff9a2a', 0.25, 0.4, { additive: true });
      if (P.life <= 0 || P.mesh.position.y < g.heightAt(P.mesh.position.x, P.mesh.position.z)) { this._explode(P.mesh.position.clone()); g.scene.remove(P.mesh); this.projectiles.splice(i, 1); }
    }
  }

  _explode(p) {
    const g = this.game, fx = g.effects;
    fx.sparks(p, 60, '#ff8a1a', 9);
    for (let i = 0; i < 14; i++) fx.emit(p.clone(), new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6), i % 2 ? '#ff6a00' : '#3a2a1a', 0.6, 1.2, { grow: 2.5, alpha: 0.6, drag: 1.2 });
    this.flash.position.copy(p).y += 1;
    this.flash.intensity = 160;
    g.audio.explosion();
    g.effects.shake = Math.min(1.2, g.effects.shake + 0.9);
    for (const v of g.vehicles) {
      const d = Math.hypot(v.position.x - p.x, v.position.z - p.z);
      if (d < 6) { v.damageEngine(60 * (1 - d / 6)); v.body.applyImpulse(new THREE.Vector3(v.position.x - p.x, 3, v.position.z - p.z).normalize().multiplyScalar(4000 * (1 - d / 6))); }
    }
    for (const c of this._characters()) if (c.base.distanceTo(p) < 5 && c.kind !== 'player') { if (c.kind === 'police') g.police.hitOfficer(c.ref, 80); else g.npcs.hit(c.ref, 80, c.base.clone().sub(p).normalize()); }
    for (const pane of g.buildings.panes) if (!pane.broken && pane.center.distanceTo(p) < 4) g.buildings.breakPane(pane);
    for (const L of this._lights()) if (L.pos.distanceTo(p) < 4) this._breakLight(L, L.pos);
    this._witnessCrime('explosion', 2, p);
    g.events.emit('explosion', {});
  }

  /** Gunfire in public: witnesses / cops nearby escalate the wanted level; bystanders flee. */
  _witness(p) {
    const g = this.game;
    const w = g.police.witnesses(p);
    g.npcs.scare(p, 30);
    if (w.civ > 0 || w.cop) { g.police.crime('shots', w.cop ? 2 : 1); if (!this._saidShots || performance.now() - this._saidShots > 20000) { this._saidShots = performance.now(); g.say('dispatch_8'); } }
  }

  _witnessCrime(kind, n, p) {
    const g = this.game, w = g.police.witnesses(p);
    if (w.civ > 0 || w.cop) g.police.crime(kind, n);
  }

  hudState() {
    const w = this.weapon, a = this.ammo[w.id];
    return { name: w.name, slot: w.slot, mag: a ? a.mag : null, reserve: a ? a.reserve : null, reloading: this.reloadT > 0, health: Math.round(this.health), aiming: this.aiming, owned: WEAPONS.filter((x) => this.owned[x.id]).map((x) => x.slot) };
  }
}

// ---------------------------------------------------------------------- ray helpers
export function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

/** Vertical capsule-ish cylinder test (base point, radius, height). */
export function rayCapsule(o, d, base, r, h) {
  const ox = o.x - base.x, oz = o.z - base.z;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-8) return null;
  const b = ox * d.x + oz * d.z;
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0) return null;
  const y = o.y + d.y * t - base.y;
  return y >= 0 && y <= h ? t : null;
}
