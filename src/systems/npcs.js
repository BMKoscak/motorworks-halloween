import * as THREE from 'three';
import { Character } from '../actors/character.js';
import { LAYOUT, pl } from '../config.js';
import { terrainHeight } from '../world/terrain.js';
import dialogue from '../data/dialogue.json';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);

/** Talkable characters (factory crew, diner, cemetery, police) and wandering trick-or-treaters. */
export class NPCs {
  constructor(game) {
    this.game = game;
    this.statics = [];
    this.pedestrians = [];
    this.fleeing = [];
  }

  all() { return [...this.statics, ...this.pedestrians, ...this.fleeing]; }

  addStatic(id, variant, pos, rot, lines, opts = {}) {
    const c = new Character(this.game.assets, variant, opts);
    c.root.position.copy(pos);
    c.root.rotation.y = rot;
    if (opts.acc) c.setAccessories(opts.acc);
    this.game.scene.add(c.root);
    const npc = { id, char: c, pos: pos.clone(), rot, lines, idx: 0, anim: opts.anim || 'idle', name: opts.name || dialogue.voices[dialogue.lines[lines[0]][0]].name, talkT: 0 };
    this.statics.push(npc);
    return npc;
  }

  build(town, cem) {
    const lz = LAYOUT.lineZ, SX = LAYOUT.stationsX;
    const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    this.foreman = this.addStatic('foreman', 'foreman', v3(pl(-50, 18, 0.09)), 2.4, ['foreman_greet', 'foreman_2', 'foreman_3'], { anim: 'idle' });
    this.addStatic('stamper', 'worker', new THREE.Vector3(SX[0] + 3.5, 0.06, lz + 4.6), Math.PI, ['worker_1', 'pa_2'], { acc: ['Hat_Hard', 'Mask_Hockey'], anim: 'operate', name: 'Stamping Crew (Hockey Mask)' });
    this.skeleton = this.addStatic('skeleton', 'skeleton', new THREE.Vector3(SX[1] + 0.6, 0.06, lz + 4.4), Math.PI, ['skeleton_1', 'skeleton_2', 'skeleton_3', 'skeleton_4', 'skeleton_5'], { anim: 'operate' });
    this.addStatic('painter', 'worker', new THREE.Vector3(SX[2] + 4.2, 0.06, lz + 6.4), Math.PI, ['worker_2', 'worker_5'], { acc: ['Mask_Pumpkin'], anim: 'operate', override: { shirt: '#f2f2f2', pants: '#d0d0d0' }, name: 'Paint Booth Tech (Pumpkin Mask)' });
    this.addStatic('powertrain', 'worker', new THREE.Vector3(SX[3] + 3.5, 0.06, lz + 4.8), Math.PI, ['worker_3'], { acc: ['Hat_Witch'], anim: 'operate', override: { shirt: '#5b1a8c' }, name: 'Powertrain Witch' });
    this.addStatic('qc', 'worker', new THREE.Vector3(SX[4] + 3.5, 0.06, lz + 4.8), Math.PI, ['worker_4'], { acc: ['Hat_Hard', 'Hold_Clipboard'], anim: 'talk', name: 'QC Inspector' });
    this.addStatic('bay', 'worker', new THREE.Vector3(36, 0.1, -66), Math.PI * 0.8, ['bay_1'], { acc: ['Hat_Hard', 'Mask_Welder'], anim: 'idle', name: 'Custom Bay Painter' });
    this.addStatic('waitress', 'waitress', town.spots.dinerDoor.clone(), Math.PI, ['waitress_1', 'waitress_2', 'waitress_3'], { anim: 'wave' });
    this.addStatic('cop', 'police', town.spots.policeDoor.clone(), Math.PI, ['cop_1'], { anim: 'idle' });
    this.groundskeeper = this.addStatic('groundskeeper', 'groundskeeper', cem.groundskeeperSpot.clone(), Math.PI, ['groundskeeper_1', 'groundskeeper_2', 'groundskeeper_3', 'groundskeeper_4']);
    const porchTalkers = town.houses.filter((_, i) => i % 4 === 1).slice(0, 4);
    porchTalkers.forEach((h, i) => {
      const p = h.porch.clone().setY(0.68);
      this.addStatic('porch' + i, 'civilian', p, h.rot, ['civilian_' + ((i % 4) + 1)], { acc: [pick(['Hat_Witch', 'Mask_Pumpkin', 'Hat_Fedora', 'Mask_Hockey'])],
        override: { shirt: pick(['#6b2a52', '#2d4f7a', '#3c6e47', '#7a1f1f']) }, anim: i % 2 ? 'wave' : 'idle', name: 'Neighbor' });
    });
    // forklift driver
    const fd = new Character(this.game.assets, 'worker', { scale: 0.9 });
    fd.anim = 'sit';
    this.game.scene.add(fd.root);
    this.game.factory.forkDriver = fd;
    this.forkDriver = fd;
    // trick-or-treaters & townsfolk walking the sidewalks
    const costumes = [['Mask_Pumpkin'], ['Hat_Witch'], ['Mask_Hockey'], [], ['Hat_Fedora'], ['Hat_Witch'], ['Mask_Pumpkin']];
    town.pedestrianPaths.forEach((path, i) => {
      for (let k = 0; k < 2; k++) {
        const kid = Math.random() < 0.45;
        const c = new Character(this.game.assets, 'civilian', { scale: kid ? 0.68 : 1, override: { shirt: pick(['#ff7a1a', '#5b1a8c', '#1f8f3a', '#111', '#b3111a', '#3fa9f5']), pants: pick(['#222', '#3a3a44', '#4b3621']) } });
        c.setAccessories(pick(costumes));
        this.game.scene.add(c.root);
        const a = new THREE.Vector3(path[0][0], 0, path[0][1]), b = new THREE.Vector3(path[1][0], 0, path[1][1]);
        this.pedestrians.push({ char: c, a, b, t: Math.random(), dir: Math.random() < 0.5 ? 1 : -1, speed: kid ? 1.5 : 1.25, dodge: 0, offset: rnd(-0.6, 0.6),
          name: kid ? 'Trick-or-Treater' : 'Townsperson', lines: ['civilian_' + ((i + k) % 4 + 1)], idx: 0 });
      }
    });
  }

  nearestTalkable(pos, maxD = 2.8) {
    let best = null, bd = maxD;
    for (const n of [...this.statics, ...this.pedestrians]) {
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
    this.game.say(id, npc.char);
    this.game.state.talked.add(npc.id || npc.name);
    return id;
  }

  /** Driver thrown out of a stolen car: runs away screaming. */
  flee(char, from) {
    this.game.scene.add(char.root);
    char.root.scale.setScalar(1);
    char.root.position.copy(from);
    const away = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    this.fleeing.push({ char, dir: away, t: 0, name: 'Car Owner' });
    this.game.say(pick(['panic_1', 'panic_2', 'panic_3']), char);
  }

  update(dt) {
    const g = this.game;
    const pv = g.player.vehicle;
    for (const n of this.statics) {
      n.talkT = Math.max(0, n.talkT - dt);
      if (n.talkT <= 0) n.char.root.rotation.y += (n.rot - n.char.root.rotation.y) * Math.min(1, dt * 2);
      const dist = n.char.root.position.distanceTo(g.focusPos);
      n.char.root.visible = dist < 90;
      if (dist > 90) continue;
      n.char.update(dt, n.talkT > 0 ? 'talk' : n.anim);
    }
    for (const p of this.pedestrians) {
      const len = p.a.distanceTo(p.b);
      // dodge fast cars
      let dodge = false;
      const pos = p.char.root.position;
      const cars = [pv, ...g.police.cruisers].filter(Boolean);
      for (const c of cars) {
        const d = Math.hypot(c.position.x - pos.x, c.position.z - pos.z);
        if (d < 9 && c.speedAbs > 5) { dodge = true; p.dodgeDir = new THREE.Vector3(pos.x - c.position.x, 0, pos.z - c.position.z).normalize(); }
      }
      if (dodge || p.dodge > 0) {
        if (dodge) p.dodge = 1.2;
        p.dodge -= dt;
        pos.addScaledVector(p.dodgeDir, dt * 5);
        pos.y = terrainHeight(pos.x, pos.z);
        p.char.root.rotation.y = Math.atan2(p.dodgeDir.x, p.dodgeDir.z);
        p.char.update(dt, 'panic');
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
      pos.y = terrainHeight(pos.x, pos.z) + 0.16;
      if (!talking) p.char.root.rotation.y = Math.atan2((p.b.x - p.a.x) * p.dir, (p.b.z - p.a.z) * p.dir);
      p.char.root.visible = pos.distanceTo(g.focusPos) < 110;
      if (p.char.root.visible) p.char.update(dt, talking ? 'talk' : 'walk');
    }
    for (let i = this.fleeing.length - 1; i >= 0; i--) {
      const f = this.fleeing[i];
      f.t += dt;
      f.char.root.position.addScaledVector(f.dir, dt * 5.5);
      f.char.root.position.y = terrainHeight(f.char.root.position.x, f.char.root.position.z);
      f.char.root.rotation.y = Math.atan2(f.dir.x, f.dir.z);
      f.char.update(dt, 'panic');
      if (f.t > 9) { g.scene.remove(f.char.root); this.fleeing.splice(i, 1); }
    }
  }
}
