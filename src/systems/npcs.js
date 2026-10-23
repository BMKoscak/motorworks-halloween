import * as THREE from 'three';
import { Character } from '../actors/character.js';
import { FootAgent, groundAt } from '../actors/agent.js';
import { LAYOUT, pl } from '../config.js';
import { terrainHeight } from '../world/terrain.js';
import dialogue from '../data/dialogue.json';
import { makePerson, makeProfile, randomAdult, randomKid, POOLS, ADULT_ONLY, demoOf } from '../data/demographics.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);

/**
 * Talkable characters (factory crew, diner, cemetery, police, shops), trick-or-treaters and townsfolk on the sidewalks.
 * Every person carries a demographic profile ({ageGroup, role, voiceKey, voiceId}); lines are only ever drawn from
 * that profile's pool, kids get the 0.68 scale + costumes + candy bags and are never placed behind a wheel.
 */
export class NPCs {
  constructor(game) {
    this.game = game;
    this.statics = [];
    this.pedestrians = [];
    this.fleeing = [];
    this.ejecting = [];
    this.homeowners = [];
    this.stats = { hits: 0, scares: 0, ejections: 0 };
  }

  all() { return [...this.statics, ...this.pedestrians, ...this.fleeing, ...this.homeowners]; }
  /** Everyone who can be shot / witness a crime. */
  allPeople() { return this.all().filter((n) => n.char.root.parent && n.char.root.visible !== false); }
  /** Moving people traffic must brake for. */
  walkers() { return [...this.pedestrians, ...this.fleeing, ...this.homeowners]; }

  addStatic(id, variant, pos, rot, lines, opts = {}) {
    const ageGroup = opts.ageGroup || 'adult_male';
    const c = typeof variant === 'string' && variant !== 'demo' ? new Character(this.game.assets, variant, opts) : makePerson(this.game.assets, ageGroup, opts.role || id, opts);
    c.profile = c.profile || makeProfile(ageGroup, opts.role || id, dialogue.lines[lines[0]][0]);
    c.profile.lines = lines.slice();
    c.root.position.copy(pos);
    c.root.rotation.y = rot;
    if (opts.acc) c.setAccessories(opts.acc);
    this.game.scene.add(c.root);
    const npc = { id, char: c, pos: pos.clone(), rot, lines, idx: 0, anim: opts.anim || 'idle', name: opts.name || dialogue.voices[dialogue.lines[lines[0]][0]].name, talkT: 0, profile: c.profile, kind: 'static', health: 100 };
    this.statics.push(npc);
    return npc;
  }

  build(town, cem) {
    const lz = LAYOUT.lineZ, SX = LAYOUT.stationsX;
    const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    const B = this.game.buildings;
    const spotOf = (kind, spot, fallback) => { const b = B.list.find((x) => x.kind === kind); return b && b.spots[spot] ? b.spots[spot].clone() : fallback; };
    this.foreman = this.addStatic('foreman', 'foreman', v3(pl(-50, 18, 0.09)), 2.4, ['foreman_greet', 'foreman_2', 'foreman_3'], { anim: 'idle', ageGroup: 'adult_male' });
    this.addStatic('stamper', 'worker', new THREE.Vector3(SX[0] + 3.5, 0.06, lz + 4.6), Math.PI, ['worker_1', 'worker_5'], { acc: ['Hat_Hard', 'Mask_Hockey'], anim: 'operate', name: 'Stamping Crew (Hockey Mask)', ageGroup: 'adult_male' });
    this.skeleton = this.addStatic('skeleton', 'skeleton', new THREE.Vector3(SX[1] + 0.6, 0.06, lz + 5.2), Math.PI, ['skeleton_1', 'skeleton_2', 'skeleton_3', 'skeleton_4', 'skeleton_5'], { anim: 'operate', ageGroup: 'skeleton' });
    this.addStatic('painter', 'worker', new THREE.Vector3(SX[2] + 4.2, 0.06, lz + 6.4), Math.PI, ['worker_2'], { acc: ['Mask_Pumpkin', 'Hair_Long'], anim: 'operate', override: { shirt: '#f2f2f2', pants: '#d0d0d0' }, name: 'Paint Booth Tech (Pumpkin Mask)', ageGroup: 'adult_female' });
    this.addStatic('powertrain', 'worker', new THREE.Vector3(SX[3] + 3.5, 0.06, lz + 4.8), Math.PI, ['worker_3'], { acc: ['Hat_Witch', 'Beard'], anim: 'operate', override: { shirt: '#5b1a8c' }, name: 'Powertrain Wizard', ageGroup: 'adult_male' });
    this.addStatic('qc', 'worker', new THREE.Vector3(SX[4] + 3.5, 0.06, lz + 4.8), Math.PI, ['worker_4'], { acc: ['Hat_Hard', 'Hold_Clipboard', 'Hair_Ponytail'], anim: 'talk', name: 'QC Inspector', ageGroup: 'adult_female' });
    this.addStatic('bay', 'worker', new THREE.Vector3(36, 0.1, -66), Math.PI * 0.8, ['bay_1'], { acc: ['Hat_Hard', 'Mask_Welder', 'Hair_Long'], anim: 'idle', name: 'Custom Bay Painter', ageGroup: 'adult_female' });
    this.addStatic('waitress', 'waitress', spotOf('diner', 'Counter', town.spots.dinerDoor.clone()), 0, ['waitress_1', 'waitress_2', 'waitress_3'], { anim: 'wave', acc: ['Hair_Ponytail', 'Skirt'], override: { skirt: '#ff7fb0' }, ageGroup: 'adult_female' });
    this.addStatic('cop', 'police', town.spots.policeDoor.clone().add(new THREE.Vector3(-5.5, 0, 0)), Math.PI, ['cop_1'], { anim: 'idle', ageGroup: 'adult_male' });
    this.groundskeeper = this.addStatic('groundskeeper', 'groundskeeper', cem.groundskeeperSpot.clone(), Math.PI, ['groundskeeper_1', 'groundskeeper_2', 'groundskeeper_3', 'groundskeeper_4'], { ageGroup: 'adult_male', acc: ['Hat_Fedora', 'Hold_Lantern', 'Beard'] });
    const hw = B.list.find((b) => b.kind === 'hardware');
    if (hw) this.clerk = this.addStatic('clerk', 'demo', hw.spots.Clerk || hw.spots.Inside, hw.obj.rotation.y + Math.PI, ['clerk_1'], { ageGroup: 'adult_male', role: 'clerk', voiceKey: 'clerk', anim: 'idle', name: 'Hank (Hardware)' });
    if (hw && hw.spots.Fence) this.fence = this.addStatic('fence', 'demo', hw.spots.Fence, hw.obj.rotation.y, ['fence_1', 'fence_2'], { ageGroup: 'adult_male', role: 'fence', voiceKey: 'fence', anim: 'idle', name: 'Vinnie the Fence',
      variant: { shirt: '#2a2a2a', pants: '#1a1a1a', hair: '#111', skin: '#c68e6a', acc: ['Hat_Fedora', 'Moustache'] } });
    // porch neighbours: demographic adults, lines matched to their gender
    const porchTalkers = town.houses.filter((_, i) => i % 4 === 1).slice(0, 4);
    porchTalkers.forEach((h, i) => {
      const age = i % 2 ? 'adult_female' : 'adult_male';
      const pool = POOLS[age].chatter;
      const n = this.addStatic('porch' + i, 'demo', h.porch.clone(), h.rot, [pool[i % pool.length], pool[(i + 1) % pool.length]], { ageGroup: age, role: 'neighbor', anim: i % 2 ? 'wave' : 'idle', name: 'Neighbor' });
      n.char.root.position.y = h.porch.y;
    });
    // forklift driver: seated, hands on the levers
    const fd = makePerson(this.game.assets, 'adult_male', 'forklift', { variant: { shirt: '#e8701a', pants: '#253552', hair: '#3a2614', acc: ['Hat_Hard'] } });
    fd.anim = 'drive';
    this.game.scene.add(fd.root);
    this.game.factory.forkDriver = fd;
    this.forkDriver = fd;
    // trick-or-treaters & townsfolk walking the sidewalks (roughly half kids)
    town.pedestrianPaths.forEach((path, i) => {
      for (let k = 0; k < 3; k++) {
        const kid = (i + k) % 3 !== 0;
        const age = kid ? randomKid() : randomAdult();
        const c = makePerson(this.game.assets, age, kid ? 'trick-or-treater' : 'townsperson');
        this.game.scene.add(c.root);
        const a = new THREE.Vector3(path[0][0], 0, path[0][1]), b = new THREE.Vector3(path[1][0], 0, path[1][1]);
        this.pedestrians.push({ char: c, a, b, t: Math.random(), dir: Math.random() < 0.5 ? 1 : -1, speed: kid ? 1.5 : 1.25, dodge: 0, offset: rnd(-0.6, 0.6),
          name: kid ? 'Trick-or-Treater' : 'Townsperson', lines: c.profile.lines, idx: Math.floor(Math.random() * 3), profile: c.profile, kind: 'ped', health: 100, kid });
      }
    });
  }

  nearestTalkable(pos, maxD = 2.8) {
    let best = null, bd = maxD;
    for (const n of [...this.statics, ...this.pedestrians, ...this.homeowners]) {
      if (n.down > 0 || n.fleeing) continue;
      const d = n.char.root.position.distanceTo(pos);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  talk(npc) {
    const id = npc.lines[npc.idx % npc.lines.length];
    npc.idx++;
    npc.talkT = 4;
    const p = this.game.player.position;
    npc.char.root.rotation.y = Math.atan2(p.x - npc.char.root.position.x, p.z - npc.char.root.position.z);
    this.speak(npc, id);
    this.game.state.talked.add(npc.id || npc.name);
    return id;
  }

  /** Every NPC utterance goes through here so the QA audit can prove voice/age/gender always match. */
  speak(npc, id) {
    const prof = npc.profile || (npc.char && npc.char.profile);
    (this.spoken ||= []).push({ id, ageGroup: prof ? prof.ageGroup : null, demo: demoOf(id), text: dialogue.lines[id] ? dialogue.lines[id][1] : '' });
    this.game.say(id, npc.char);
  }

  /** Driver thrown out of a stolen car (already standing outside): runs away screaming with their own gender's panic line. */
  flee(char, from) {
    this.game.scene.add(char.root);
    char.root.scale.setScalar(1);
    char.root.rotation.set(0, 0, 0);
    char.root.position.copy(from);
    const away = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    const f = { char, dir: away, t: 0, name: 'Car Owner', profile: char.profile, kind: 'flee', health: 100, fleeing: true };
    this.fleeing.push(f);
    const pool = POOLS[(char.profile && char.profile.ageGroup) || 'adult_female'];
    this.speak(f, pick(pool.panic));
  }

  /** Seated driver gets pulled out through the open driver door, then flees on foot. */
  ejectDriver(entry, doorPoint = null) {
    const ch = entry.driver;
    if (!ch || !ch.seated || entry.ejected) return;
    entry.ejected = true;
    const vis = ch.seated;
    vis.setHinge && vis.setHinge('Door_L', 1);
    const from = ch.root.getWorldPosition(new THREE.Vector3());
    const q = ch.root.getWorldQuaternion(new THREE.Quaternion());
    vis.root.remove(ch.root);
    this.game.scene.add(ch.root);
    ch.root.position.copy(from);
    ch.root.quaternion.copy(q);
    ch.seated = null;
    const to = doorPoint || this.game.traffic.doorPoint(vis);
    to.y = this.game.heightAt(to.x, to.z);
    this.ejecting.push({ char: ch, from, to, t: 0, yaw: new THREE.Euler().setFromQuaternion(q, 'YXZ').y, vis });
    this.stats.ejections++;
    this.game.events.emit('driverEjected', { ageGroup: ch.profile && ch.profile.ageGroup });
  }

  /** Gunfire / explosions: bystanders panic and run, kids scream their own (kid-appropriate) line. */
  scare(p, r) {
    let said = false;
    for (const n of this.pedestrians) {
      if (n.char.root.position.distanceTo(p) > r || n.down > 0) continue;
      n.dodge = 3.5;
      n.dodgeDir = n.char.root.position.clone().sub(p).setY(0).normalize();
      if (!said && Math.random() < 0.5) { said = true; this.speak(n, pick(n.profile.panic.length ? n.profile.panic : n.profile.lines)); }
      this.stats.scares++;
    }
  }

  hit(n, dmg, dir) {
    if (!n) return;
    n.health = (n.health ?? 100) - dmg;
    n.down = 6;
    this.stats.hits++;
    this.game.events.emit('npcHit', { ageGroup: n.profile && n.profile.ageGroup });
  }

  update(dt) {
    const g = this.game;
    const pv = g.player.vehicle;
    for (const n of this.statics) {
      n.talkT = Math.max(0, n.talkT - dt);
      if (n.talkT <= 0 && !(n.down > 0)) n.char.root.rotation.y += (n.rot - n.char.root.rotation.y) * Math.min(1, dt * 2);
      const dist = n.char.root.position.distanceTo(g.focusPos);
      n.char.root.visible = dist < 90;
      if (dist > 90) continue;
      if (n.down > 0) { n.down -= dt; n.char.update(dt, 'down'); continue; }
      n.char.update(dt, n.talkT > 0 ? 'talk' : n.anim);
    }
    for (const p of this.pedestrians) {
      const len = p.a.distanceTo(p.b);
      const pos = p.char.root.position;
      p.char.root.visible = pos.distanceTo(g.focusPos) < 110;
      if (p.down > 0) { p.down -= dt; if (p.char.root.visible) p.char.update(dt, 'down'); if (p.down <= 0) { p.dodge = 4; p.dodgeDir ||= new THREE.Vector3(1, 0, 0); } continue; }
      // dodge fast cars
      let dodge = false;
      const cars = [pv, ...g.police.cruisers].filter(Boolean);
      for (const c of cars) {
        const d = Math.hypot(c.position.x - pos.x, c.position.z - pos.z);
        if (d < 9 && c.speedAbs > 5) { dodge = true; p.dodgeDir = new THREE.Vector3(pos.x - c.position.x, 0, pos.z - c.position.z).normalize(); }
      }
      if (dodge || p.dodge > 0) {
        if (dodge) p.dodge = Math.max(p.dodge, 1.2);
        p.dodge -= dt;
        pos.addScaledVector(p.dodgeDir, dt * 5);
        pos.y = groundAt(g, pos.x, pos.z, pos.y);
        p.char.root.rotation.y = Math.atan2(p.dodgeDir.x, p.dodgeDir.z);
        if (p.char.root.visible) p.char.update(dt, 'panic');
        if (p.dodge <= 0) p.t = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(pos, p.a).dot(p.b.clone().sub(p.a).normalize()) / len, 0, 1);
        continue;
      }
      const talking = (p.talkT = Math.max(0, (p.talkT || 0) - dt)) > 0;
      if (!talking) {
        p.t += (p.dir * p.speed * dt) / len;
        if (p.t > 1 || p.t < 0) { p.dir *= -1; p.t = THREE.MathUtils.clamp(p.t, 0, 1); }
      }
      const tgt = p.a.clone().lerp(p.b, p.t);
      const side = new THREE.Vector3(-(p.b.z - p.a.z), 0, p.b.x - p.a.x).normalize().multiplyScalar(p.offset);
      tgt.add(side);
      pos.lerp(tgt, Math.min(1, dt * 4));
      // ground clamp every frame onto the sidewalk slab (static collider) or terrain
      if (p.char.root.visible || (g.frames + p.offset * 10) % 6 < 1) pos.y = groundAt(g, pos.x, pos.z, pos.y);
      if (!talking) p.char.root.rotation.y = Math.atan2((p.b.x - p.a.x) * p.dir, (p.b.z - p.a.z) * p.dir);
      if (p.char.root.visible) p.char.update(dt, talking ? 'talk' : 'walk');
    }
    for (let i = this.ejecting.length - 1; i >= 0; i--) {
      const e = this.ejecting[i];
      e.t += dt / 0.9;
      const k = Math.min(1, e.t);
      e.char.root.position.lerpVectors(e.from, e.to, THREE.MathUtils.smootherstep(k, 0, 1));
      e.char.root.position.y = THREE.MathUtils.lerp(e.from.y, e.to.y, k) + Math.sin(k * Math.PI) * 0.25;
      e.char.root.scale.setScalar(THREE.MathUtils.lerp(0.76, 1, k));
      e.char.root.rotation.set(0, e.yaw + Math.PI / 2 * k, 0);
      e.char.update(dt, k < 0.45 ? 'drive' : 'panic');
      if (k >= 1) { this.ejecting.splice(i, 1); this.flee(e.char, e.to.clone()); setTimeout(() => e.vis.setHinge && e.vis.setHinge('Door_L', 0), 900); }
    }
    for (let i = this.fleeing.length - 1; i >= 0; i--) {
      const f = this.fleeing[i];
      f.t += dt;
      const pos = f.char.root.position;
      pos.addScaledVector(f.dir, dt * 5.5);
      pos.y = groundAt(g, pos.x, pos.z, pos.y);
      f.char.root.rotation.y = Math.atan2(f.dir.x, f.dir.z);
      f.char.update(dt, 'panic');
      if (f.t > 9) { g.scene.remove(f.char.root); this.fleeing.splice(i, 1); }
    }
    for (const h of this.homeowners) h.update(dt);
  }

  /**
   * Demographic audit (QA): every NPC's line pool matches its age group/gender, kids never carry adult-only lines,
   * and no child sits behind a wheel. Returns a list of violations (empty = pass).
   */
  audit() {
    const bad = [];
    const people = [...this.all(), ...this.game.traffic.driving.map((d) => ({ char: d.driver, profile: d.driver.profile, lines: d.driver.profile.lines, driver: true, name: 'driver' }))];
    for (const n of people) {
      const prof = n.profile || (n.char && n.char.profile);
      if (!prof) { bad.push({ who: n.name, issue: 'no profile' }); continue; }
      const kid = prof.ageGroup.startsWith('child');
      if (n.driver && kid) bad.push({ who: n.name, issue: 'child driver' });
      for (const id of [...(n.lines || prof.lines || []), ...(prof.panic || [])]) {
        const demo = demoOf(id);
        if (demo !== prof.ageGroup) bad.push({ who: n.name, line: id, voiceDemo: demo, ageGroup: prof.ageGroup });
        if (kid && ADULT_ONLY.test(dialogue.lines[id][1])) bad.push({ who: n.name, line: id, issue: 'adult line on child' });
      }
      if (kid && n.char.root.scale.x > 0.7) bad.push({ who: n.name, issue: 'child scale ' + n.char.root.scale.x });
    }
    for (const s of this.spoken || []) if (s.ageGroup && s.demo !== s.ageGroup) bad.push({ spoken: s.id, voiceDemo: s.demo, ageGroup: s.ageGroup });
    return bad;
  }
}
