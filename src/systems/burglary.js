import * as THREE from 'three';
import { FootAgent } from '../actors/agent.js';
import { makePerson, randomAdult, POOLS } from '../data/demographics.js';
import { bakeProp } from '../world/buildings.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const LOOT_NAMES = { TV: 'Vintage CRT TV', Register: 'Cash Register', Jewelry: 'Jewelry Box', Toolkit: 'Power Tool Kit', Evidence: 'Evidence Bag', CandyBowl: 'Giant Candy Bowl', Radio: 'Retro Radio', Cash: 'Cash Stash' };

/** Homeowner who answers the doorbell (or catches a burglar): greets + tips, or panics and runs for the phone. */
class Homeowner {
  constructor(sys, house, mood) {
    this.sys = sys;
    const g = sys.game;
    this.house = house;
    const age = house.ownerAge || (house.ownerAge = randomAdult());
    this.char = makePerson(g.assets, age, 'homeowner');
    const pool = POOLS[age];
    this.profile = this.char.profile;
    this.profile.lines = [pool.homeGreet];
    this.profile.panic = [pool.homePanic];
    this.lines = this.profile.lines;
    this.name = 'Homeowner';
    this.kind = 'homeowner';
    this.health = 100;
    this.agent = new FootAgent(g, this.char, { speed: 1.6 });
    const start = house.spots.Inside || house.spots.Living;
    this.char.root.position.copy(start);
    g.scene.add(this.char.root);
    const out = house.spots.Outside, ins = house.spots.Inside;
    this.threshold = ins.clone().lerp(out, 0.38);
    this.state = mood === 'panic' ? 'panic' : 'answer';
    this.t = 0;
    if (this.state === 'panic') this._panic();
  }

  _panic() {
    const g = this.sys.game;
    this.state = 'phone';
    this.t = 0;
    this.agent.speed = 4.5;
    g.npcs.speak(this, this.profile.panic[0]);
    g.events.emit('homeownerPanic', { ageGroup: this.profile.ageGroup });
  }

  update(dt) {
    const g = this.sys.game, h = this.house;
    this.t += dt;
    const p = g.player.position;
    if (this.down > 0) { this.down -= dt; this.char.update(dt, 'down'); if (this.down <= 0 && this.state !== 'gone') this._panic(); return; }
    if (this.state === 'answer') {
      const d = this.agent.update(dt, this.threshold, 1.6, 0.25);
      this.char.update(dt, this.agent.moving ? 'walk' : 'idle');
      if (d < 0.4) {
        this.char.root.rotation.y = Math.atan2(p.x - this.char.root.position.x, p.z - this.char.root.position.z);
        const hostile = (g.combat.aiming && g.combat.weapon.id !== 'unarmed') || g.police.level >= 2;
        if (hostile) return this._panic();
        this.state = 'greet';
        this.t = 0;
        g.npcs.speak(this, this.profile.lines[0]);
        const tip = Math.round(rnd(15, 50));
        g.state.money += tip;
        h.treated = true;
        this.sys.stats.treats++;
        g.hud.toast(`🍬 Candy + $${tip}${g.player.masked ? ' — love the mask!' : ''}`, 'good');
        g.audio.cash();
        g.events.emit('treat', { tip, ageGroup: this.profile.ageGroup });
      }
    } else if (this.state === 'greet') {
      this.char.update(dt, this.t < 3 ? 'talk' : 'wave');
      if ((g.combat.aiming && g.combat.weapon.id !== 'unarmed')) return this._panic();
      if (this.t > 5) { this.state = 'return'; }
    } else if (this.state === 'return') {
      const d = this.agent.update(dt, h.spots.Living || h.spots.Inside, 1.4, 0.5);
      this.char.update(dt, this.agent.moving ? 'walk' : 'idle');
      if (d < 0.8 || this.t > 14) {
        const door = h.doors.Door_Front;
        if (door) { g.buildings.toggleDoor(door, false); door.locked = true; door.held = false; }
        this.remove();
      }
    } else if (this.state === 'phone') {
      const phone = h.spots.Phone || h.spots.Kitchen || h.spots.Living;
      const d = this.agent.update(dt, phone, 4.5, 0.4);
      this.char.update(dt, this.agent.moving ? 'panic' : 'talk');
      if (d < 0.6 && !this.called) {
        this.callT = (this.callT || 0) + dt;
        if (this.callT > 2) {
          this.called = true;
          if (h.power) { g.police.crime('burglary', 2); g.say('dispatch_9'); this.sys.stats.policeCalls++; }
          else { g.hud.toast('📵 The phone line is dead — you cut the power!', 'good'); this.sys.stats.deadPhones++; }
          g.events.emit('phoneCall', { connected: h.power });
        }
      }
      if (this.called && this.t > 12) this.state = 'hide';
    } else if (this.state === 'hide') this.char.update(dt, 'panic');
  }

  remove() {
    const g = this.sys.game;
    this.state = 'gone';
    g.scene.remove(this.char.root);
    const i = g.npcs.homeowners.indexOf(this);
    if (i >= 0) g.npcs.homeowners.splice(i, 1);
    this.house.owner = null;
  }
}

/**
 * Doorbells, homeowners, stealable loot (carried two-handed or in the loot bag), trunk stashing and the
 * back-alley fence. Houses keep power/alarm state (see Buildings) - cut the breaker first and the alarm is dead
 * and the homeowner can't phone the police.
 */
export class Burglary {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.bag = [];
    this.stats = { rings: 0, treats: 0, kicks: 0, stolen: 0, stashed: 0, fenced: 0, fencedValue: 0, policeCalls: 0, deadPhones: 0, alarms: 0 };
  }

  build() {
    const g = this.game;
    for (const b of g.buildings.list) {
      if (b.house) { b.occupied = Math.random() < 0.6; b.ownerAge = randomAdult(); }
      for (const L of b.loot) {
        if (b.house && L.kind !== 'TV' && Math.random() < 0.35) continue; // not every house has everything
        this.spawnItem(L.kind, L.pos, L.yaw, b);
      }
    }
  }

  spawnItem(kind, pos, yaw, building = null) {
    const g = this.game;
    let mesh;
    try { mesh = g.assets.part('props', 'Loot_' + kind); } catch (e) { return null; }
    const ud = mesh.userData;
    mesh.position.copy(pos);
    mesh.rotation.y = yaw;
    g.scene.add(mesh);
    bakeProp(mesh);
    const item = { mesh, kind, name: LOOT_NAMES[kind] || kind, value: ud.value || Math.round(rnd(60, 200)), heavy: !!ud.heavy, building, home: pos.clone(), taken: false };
    if (kind === 'Cash') item.value = Math.round(rnd(60, 200));
    this.items.push(item);
    return item;
  }

  // ------------------------------------------------------------------ interactions (called from Game._interaction)
  candidates(pos) {
    const g = this.game, out = [];
    const p = g.player;
    // pick up loot
    if (!p.carrying) {
      for (const it of this.items) {
        if (it.taken || it.stashed) continue;
        const d = it.mesh.position.distanceTo(new THREE.Vector3(pos.x, it.mesh.position.y, pos.z));
        if (d < 1.5 && Math.abs(it.mesh.position.y - pos.y) < 2) out.push({ d, text: `[E] Steal ${it.name} ($${it.value})${it.heavy ? ' — two hands' : ''}`, act: () => this.take(it) });
      }
    }
    // doorbells and front doors of houses
    const indoors = g.buildings.inside(pos);
    for (const b of g.buildings.list) {
      if (!b.house || !b.doorbell || indoors) continue;
      const d = Math.hypot(b.doorbell.x - pos.x, b.doorbell.z - pos.z);
      const door = b.doors.Door_Front;
      if (d < 1.6 && door && door.t < 0.2 && !b.owner) out.push({ d: d - 0.8, text: b.treated ? '[E] Ring doorbell (they already gave you candy)' : '[E] Ring doorbell', act: () => this.ring(b) });
    }
    // trunks of the player's (owned/stolen) cars
    const car = this.nearTrunk(pos);
    if (car) {
      const vis = car.visual, trunk = vis.hinges.Trunk;
      const open = trunk && trunk.target > 0.5;
      const load = p.carrying || this.bag.length;
      if (!open) out.push({ d: 0.9, text: `[E] Open trunk${car.trunk && car.trunk.length ? ` (${car.trunk.length} stashed)` : ''}`, act: () => this.trunkToggle(car, true) });
      else if (load) out.push({ d: 0.5, text: `[E] Stash ${p.carrying ? p.carrying.name : `loot bag (${this.bag.length})`} in the trunk`, act: () => this.stash(car) });
      else out.push({ d: 0.9, text: '[E] Close trunk', act: () => this.trunkToggle(car, false) });
    }
    // the fence
    const fence = g.npcs.fence;
    if (fence && fence.char.root.position.distanceTo(pos) < 3 && (p.carrying || this.bag.length)) {
      const v = this.carriedValue();
      out.push({ d: 0.4, text: `[E] Sell loot to Vinnie ($${v})`, act: () => this.sell('foot') });
    }
    return out;
  }

  /** In-car interaction near the fence or custom bay: sell what's in the trunk. */
  carCandidate(v) {
    const g = this.game, fence = g.npcs.fence;
    if (!v.trunk || !v.trunk.length) return null;
    const val = v.trunk.reduce((a, i) => a + i.value, 0);
    if (fence && fence.char.root.position.distanceTo(v.visual.root.position) < 9 && v.speedAbs < 1.5) return { text: `[E] Sell trunk loot to Vinnie ($${val})`, act: () => this.sell('trunk', v) };
    if (g.inBayZone(v.position) && v.speedAbs < 1.5) return { text: `[Shift+E] Cash out trunk loot at the bay ($${val})`, alt: true, act: () => this.sell('trunk', v) };
    return null;
  }

  carriedValue() { return (this.game.player.carrying ? this.game.player.carrying.value : 0) + this.bag.reduce((a, i) => a + i.value, 0); }

  nearTrunk(pos) {
    const g = this.game;
    for (const v of g.vehicles) {
      if (v.kind !== 'player' || v === g.player.vehicle || !v.visual.hinges.Trunk) continue;
      const vis = v.visual;
      const back = new THREE.Vector3(0, 0, vis.info.minZ - 0.7).applyMatrix4(vis.root.matrixWorld);
      if (Math.hypot(back.x - pos.x, back.z - pos.z) < 1.5) return v;
    }
    return null;
  }

  take(it) {
    const g = this.game, p = g.player;
    it.taken = true;
    this.stats.stolen++;
    if (it.heavy) {
      p.carrying = it;
      g.scene.remove(it.mesh);
      it.mesh.position.set(0, 0.95, 0.42);
      it.mesh.rotation.set(0, 0, 0);
      p.char.root.add(it.mesh);
    } else {
      this.bag.push(it);
      it.mesh.visible = false;
    }
    g.audio.chimeShort();
    g.hud.toast(`${it.heavy ? '📦' : '💰'} ${it.name} ($${it.value})${it.heavy ? ' — carry it to a trunk' : ' — in your loot bag'}`, 'good');
    // witnesses: occupied homes, shop staff, cops
    const b = it.building;
    if (b && b.owner && b.owner.state !== 'gone') b.owner._panic && b.owner.state !== 'phone' && b.owner._panic();
    if (b && !b.house) { const w = g.police.witnesses(it.home); if (w.cop || (b.kind !== 'police' && w.civ > 0)) g.police.crime(b.kind === 'police' ? 'theft' : 'property', b.kind === 'police' ? 2 : 1); }
    g.events.emit('lootTaken', { kind: it.kind, building: b && b.name, value: it.value });
  }

  dropCarried() {
    const p = this.game.player, it = p.carrying;
    if (!it) return;
    p.char.root.remove(it.mesh);
    it.mesh.position.copy(p.position).add(new THREE.Vector3(Math.sin(p.facing) * 0.8, 0, Math.cos(p.facing) * 0.8));
    it.mesh.rotation.set(0, p.facing, 0);
    this.game.scene.add(it.mesh);
    it.taken = false;
    p.carrying = null;
  }

  trunkToggle(car, open) {
    car.visual.setHinge('Trunk', open ? 1 : 0);
    this.game.audio[open ? 'doorOpen' : 'doorShut']();
    this.game.events.emit('trunk', { open });
  }

  /** Put the carried item (or the whole loot bag) into the open trunk, visibly in the trunk bed. */
  stash(car) {
    const g = this.game, p = g.player;
    const vis = car.visual;
    car.trunk ||= [];
    const items = p.carrying ? [p.carrying] : this.bag.splice(0);
    if (p.carrying) { p.char.root.remove(p.carrying.mesh); p.carrying = null; }
    const trunkNode = vis.n.Trunk;
    const zc = trunkNode ? (trunkNode.position.z + vis.info.minZ) / 2 : vis.info.minZ + 0.6;
    const bedY = vis.n.Bed_Liner ? vis.n.Bed_Liner.position.y + 0.02 : vis.info.belt - 0.12;
    for (const it of items) {
      const k = car.trunk.length;
      it.stashed = true;
      it.mesh.visible = true;
      it.mesh.scale.setScalar(it.heavy ? 0.75 : 0.9);
      it.mesh.position.set(-0.35 + (k % 3) * 0.35, bedY, zc + Math.floor(k / 3) * 0.3);
      it.mesh.rotation.set(0, Math.PI + (k % 2) * 0.3, 0);
      vis.root.add(it.mesh);
      car.trunk.push(it);
      this.stats.stashed++;
    }
    g.audio.clunk();
    g.hud.toast(`Stashed ${items.length} item${items.length > 1 ? 's' : ''} in the trunk — fence it behind the Hardware Store`, 'good');
    g.events.emit('stash', { count: car.trunk.length });
    setTimeout(() => this.trunkToggle(car, false), 900);
  }

  /** Stashed items show only while the lid is open (pickup beds are open-top); room loot is culled beyond 45 m. */
  update(dt) {
    if ((this._cull = (this._cull || 0) - dt) <= 0) {
      this._cull = 0.4;
      const f = this.game.focusPos;
      for (const it of this.items) if (!it.taken && !it.stashed && !it.sold) it.mesh.visible = it.mesh.position.distanceToSquared(f) < 2025;
    }
    for (const v of this.game.vehicles) {
      if (!v.trunk || !v.trunk.length) continue;
      const t = v.visual.hinges.Trunk ? v.visual.hinges.Trunk.t : 1;
      const open = v.visual.cfg.body === 'pickup' || t > 0.25;
      for (const it of v.trunk) it.mesh.visible = open;
    }
  }

  sell(where, car = null) {
    const g = this.game, p = g.player;
    let items = [];
    if (where === 'trunk') { items = car.trunk.splice(0); }
    else { if (p.carrying) { items.push(p.carrying); p.char.root.remove(p.carrying.mesh); p.carrying = null; } items.push(...this.bag.splice(0)); }
    const total = items.reduce((a, i) => a + i.value, 0);
    for (const it of items) { it.mesh.parent && it.mesh.parent.remove(it.mesh); it.sold = true; }
    g.state.money += total;
    this.stats.fenced += items.length;
    this.stats.fencedValue += total;
    g.audio.cash();
    if (g.npcs.fence) g.npcs.speak(g.npcs.fence, 'fence_1');
    g.hud.toast(`💵 Fenced ${items.length} item${items.length === 1 ? '' : 's'} for $${total}`, 'good', 3500);
    g.events.emit('fenced', { count: items.length, total });
  }

  // ------------------------------------------------------------------ doorbells / forced entry
  ring(b) {
    const g = this.game;
    this.stats.rings++;
    g.audio.doorbell();
    g.events.emit('doorbell', { house: b.id });
    if (!b.occupied && b.treated) { setTimeout(() => g.hud.toast('Nobody answers…'), 2200); return; }
    b.occupied = true;
    setTimeout(() => {
      const door = b.doors.Door_Front;
      if (!door || b.owner) return;
      door.locked = false;
      door.held = true;
      g.buildings.toggleDoor(door, true);
      const h = new Homeowner(this, b, 'answer');
      b.owner = h;
      g.npcs.homeowners.push(h);
    }, 2000);
  }

  kickDoor(d) {
    const g = this.game, b = d.building;
    this.stats.kicks++;
    g.audio.kick();
    g.effects.shake = Math.min(1, g.effects.shake + 0.4);
    d.locked = false;
    g.buildings.toggleDoor(d, true);
    g.player.anim = 'reach'; g.player.busy = 0.4;
    g.events.emit('forcedEntry', { building: b.name });
    if (b.house) {
      if (b.alarm && b.power) this.alarm(b);
      if (b.occupied && !b.owner) { const h = new Homeowner(this, b, 'panic'); b.owner = h; g.npcs.homeowners.push(h); }
    } else {
      const w = g.police.witnesses(d.center);
      if (w.cop || w.civ) g.police.crime('property', b.kind === 'police' ? 2 : 1);
    }
  }

  alarm(b) {
    const g = this.game;
    if (b.alarmT && performance.now() - b.alarmT < 15000) return;
    b.alarmT = performance.now();
    this.stats.alarms++;
    g.audio.alarm(8);
    g.hud.toast('🚨 Burglar alarm! (cut the breaker box first next time)', 'bad');
    g.police.crime('burglary', 1);
    g.events.emit('alarm', { building: b.name });
  }
}
