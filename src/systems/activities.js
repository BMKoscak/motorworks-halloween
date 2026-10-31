import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CarVisual } from '../vehicle/carVisual.js';
import { civilianConfig, groundPose } from './traffic.js';
import { G } from '../core/physics.js';
import { LAYOUT, ENGINES, PLANT, pl } from '../config.js';
import { STREETS } from '../world/streetGeom.js';
import { bakeProp } from '../world/buildings.js';
import { makePerson, randomAdult, randomKid } from '../data/demographics.js';
import { terrainHeight } from '../world/terrain.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const MPH = 2.23694;
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };

/** Engine output for the dyno and the drag-race rival (stock V6 ~180 hp ... twin-turbo ~330 hp, blower/exhaust mods, damage). */
export function enginePower(v) {
  const cfg = v.visual.cfg;
  const eng = ENGINES.find((e) => e.id === cfg.engine) || ENGINES[0];
  let hp = eng.force * 0.055;
  if (cfg.hood === 'Hood_Blower' || cfg.hood === 'Hood_Franken') hp *= 1.06;
  if (cfg.exhaust && cfg.exhaust !== 'Exhaust_Stock') hp *= 1.04;
  hp *= Math.sqrt(Math.max(0.2, (v.engineHealth ?? 100) / 100));
  return { hp: Math.round(hp), eng, torque: Math.round(hp * 5252 / (eng.redline * 0.78)) };
}

// ===================================================================================== DYNO
class Dyno {
  constructor(sys) {
    this.sys = sys;
    this.activityName = 'Dyno'; // stable name for QA hooks (class names are minified in production builds)
    const g = sys.game, f = g.factory;
    this.nodes = f.dyno || {};
    this.spot = f.building.spots.Dyno;
    this.desk = f.building.spots.DynoDesk;
    this.board = load('mw_dyno', []);
    this.canvas = document.createElement('canvas'); this.canvas.width = 512; this.canvas.height = 256;
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    if (this.nodes.Dyno_Screen) this.nodes.Dyno_Screen.material = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    this.curve = [];
    this.run = null;
    this.spin = 0;
    this.stats = { pulls: 0, best: this.board[0] ? this.board[0].hp : 0 };
    this.tech = g.npcs.addStatic('dynotech', 'demo', this.desk.clone(), Math.PI, ['dyno_1', 'dyno_meh'], { ageGroup: 'adult_female', role: 'dynotech', voiceKey: 'dynotech', anim: 'idle',
      name: 'Gina (Dyno Tech)', variant: { shirt: '#1f4fd1', pants: '#253552', hair: '#a0522d', skin: '#f1c7a5', acc: ['Hair_Ponytail', 'Hat_Cap'] } });
    this._draw();
  }

  candidate(v) {
    if (!this.spot || this.run) return null;
    const d = Math.hypot(v.position.x - this.spot.x, v.position.z - this.spot.z);
    if (d < 7 && !this.greeted) { this.greeted = true; this.sys.game.npcs.speak(this.tech, 'dyno_1'); }
    if (d > 2.8 || v.speedAbs > 2.5) return null;
    return { text: '[E] Strap down & start a dyno pull', act: () => this.start(v) };
  }

  start(v) {
    const g = this.sys.game;
    this.run = { v, t: 0, p: enginePower(v) };
    this.curve = [];
    g.activity = this;
    v.teleport(new THREE.Vector3(this.spot.x, this.spot.y, this.spot.z), -Math.PI / 2);
    g.audio.hydraulic();
    g.hud.toast('🔧 Strapped down. Hold on — automatic pull to redline.', '', 3000);
    this.stats.pulls++;
  }

  /** activity hook: the pull owns the controls for ~8 s */
  update(dt) {
    const r = this.run, g = this.sys.game, v = r.v;
    r.t += dt;
    const eng = r.p.eng;
    const k = THREE.MathUtils.clamp((r.t - 1.2) / 5.5, 0, 1);
    const rpm = r.t < 1.2 ? eng.idle + 300 : r.t < 6.7 ? THREE.MathUtils.lerp(eng.idle + 800, eng.redline, k) : THREE.MathUtils.lerp(eng.redline, eng.idle, Math.min(1, (r.t - 6.7) / 1.2));
    v.teleport(new THREE.Vector3(this.spot.x, this.spot.y, this.spot.z), -Math.PI / 2);
    v.setControls({ throttle: r.t > 1.2 && r.t < 6.7 ? 1 : 0, steer: 0, handbrake: false });
    v.rpm = rpm;
    v.controls.throttle = r.t > 1.2 && r.t < 6.7 ? 1 : 0;
    if (r.t > 1.2 && r.t < 6.7) {
      const x = (rpm - eng.idle) / (eng.redline - eng.idle);
      const torque = r.p.torque * (1 - Math.pow(x - 0.62, 2) * 0.9);
      const hp = torque * rpm / 5252;
      this.curve.push({ rpm, hp, torque });
      if (Math.random() < dt * 6) g.effects.sparks(v.visual.root.position.clone().add(new THREE.Vector3(2.4, 0.4, 0)), 3, '#ff8a2a', 1.5);
    }
    if (r.t > 7.9) this.finish();
  }

  cameraPose() {
    const s = this.spot;
    return { pos: new THREE.Vector3(s.x + 2.5, 2.4, s.z + 6.2), look: new THREE.Vector3(s.x, 0.9, s.z) };
  }

  finish() {
    const g = this.sys.game, r = this.run;
    const peak = this.curve.reduce((a, c) => (c.hp > a.hp ? c : a), { hp: 0, rpm: 0 });
    const peakT = this.curve.reduce((a, c) => Math.max(a, c.torque), 0);
    const hp = Math.round(peak.hp);
    const record = !this.board.length || hp > this.board[0].hp;
    this.board.push({ hp, tq: Math.round(peakT), car: r.v.visual.cfg.body, at: Date.now() });
    this.board.sort((a, b) => b.hp - a.hp);
    this.board = this.board.slice(0, 5);
    store('mw_dyno', this.board);
    this.result = { hp, tq: Math.round(peakT), rpm: Math.round(peak.rpm) };
    this.stats.best = this.board[0].hp;
    g.npcs.speak(this.tech, record ? 'dyno_record' : hp > 240 ? 'dyno_good' : 'dyno_meh');
    if (record) { g.state.money += 250; g.audio.cash(); }
    g.hud.toast(`📈 ${hp} hp @ ${Math.round(peak.rpm)} rpm · ${Math.round(peakT)} lb-ft${record ? ' · NEW RECORD +$250' : ''}`, 'good', 6000);
    g.events.emit('dyno', { hp, record });
    this.run = null;
    g.activity = null;
    this._draw();
  }

  tick(dt) {
    const g = this.sys.game;
    const spinning = this.run && this.run.t > 1.0 && this.run.t < 7.4;
    const sp = spinning ? (this.run.v.rpm / 900) : 0;
    this.spin += sp * dt * 6;
    if (this.nodes.Dyno_Roller_F) this.nodes.Dyno_Roller_F.rotation.z = -this.spin;
    if (this.nodes.Dyno_Roller_R) this.nodes.Dyno_Roller_R.rotation.z = -this.spin;
    if (this.nodes.Dyno_Fan) this.nodes.Dyno_Fan.rotation.x += dt * (this.run ? 22 : 2);
    if (this.run) {
      this.run.v.visual.wheelNodes.forEach((w, i) => this.run.v.visual.setWheel(i, 0, 0, this.spin * 2.6));
      if ((this._acc = (this._acc || 0) + dt) > 0.1) { this._acc = 0; this._draw(); }
    }
  }

  _draw() {
    const c = this.canvas, g = c.getContext('2d'), W = c.width, H = c.height;
    g.fillStyle = '#060a12'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#1d2a40'; g.lineWidth = 1;
    for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(40 + i * 54, 20); g.lineTo(40 + i * 54, 220); g.stroke(); }
    for (let i = 0; i <= 5; i++) { g.beginPath(); g.moveTo(40, 20 + i * 40); g.lineTo(472, 20 + i * 40); g.stroke(); }
    g.fillStyle = '#7fb0ff'; g.font = 'bold 14px monospace'; g.fillText('MOTORWORKS DYNO', 44, 16);
    const maxRpm = 8500, maxV = 420;
    const plot = (key, col) => { g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); this.curve.forEach((p, i) => { const x = 40 + (p.rpm / maxRpm) * 432, y = 220 - (p[key] / maxV) * 200; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); };
    plot('hp', '#ff7a1a'); plot('torque', '#39d0ff');
    g.font = 'bold 16px monospace';
    const last = this.curve.at(-1);
    g.fillStyle = '#ff7a1a'; g.fillText(`HP ${last ? Math.round(last.hp) : (this.result ? this.result.hp : '---')}`, 330, 44);
    g.fillStyle = '#39d0ff'; g.fillText(`TQ ${last ? Math.round(last.torque) : (this.result ? this.result.tq : '---')}`, 330, 64);
    g.fillStyle = '#c8d2e0'; g.font = '12px monospace'; g.fillText('TOP PULLS', 330, 92);
    this.board.slice(0, 3).forEach((b, i) => g.fillText(`${i + 1}. ${b.hp} hp  ${b.car}`, 330, 110 + i * 16));
    this.tex.needsUpdate = true;
  }
}

// ===================================================================================== DRAG STRIP
class DragRace {
  constructor(sys) {
    this.sys = sys;
    const ds = STREETS.dragStrip;
    this.start = new THREE.Vector3(ds.start[0], 0, ds.start[1]);
    this.finishX = ds.finish[0];
    this.laneZ = this.start.z + 2.6;        // eastbound lane
    this.rivalZ = this.start.z - 2.6;       // the other lane, closed for the race
    this.race = null;
    this.best = load('mw_drag', null);
    this.stats = { races: 0, wins: 0, fouls: 0 };
    this.spectators = [];
  }

  candidate(v) {
    if (this.race) return null;
    const d = Math.hypot(v.position.x - (this.start.x - 2), v.position.z - this.laneZ);
    if (d > 9 || v.speedAbs > 3) return null;
    return { text: '[E] Challenge Vic Vapor: eighth-mile drag race ($200 stake)', act: () => this.begin(v) };
  }

  begin(v) {
    const g = this.sys.game;
    if (g.state.money < 200) { g.hud.toast('You need $200 for the stake', 'bad'); return; }
    if (g.police.level > 0) { g.hud.toast('Not with the cops on your tail!', 'bad'); return; }
    this.stats.races++;
    const p = enginePower(v);
    // rival tuned around your car: beatable with a clean launch, quicker against stock builds
    const a = THREE.MathUtils.clamp(4.2 + p.hp / 95, 5.6, 8.4) * rnd(0.93, 1.03);
    const vis = new CarVisual(g.assets, { ...civilianConfig('coupe'), color: '#39ff14', livery: 'flames', rim: 'MultiSpoke', underglow: 'green', spoiler: 'Spoiler_GT', hood: 'Hood_TwinScoop' }, { lite: true });
    g.scene.add(vis.root);
    const b = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, collisionFilterGroup: G.CAR, collisionFilterMask: G.CAR | G.PLAYER | G.PROP });
    b.addShape(new CANNON.Box(new CANNON.Vec3(vis.spec.W / 2 - 0.05, (vis.info.belt - 0.05) / 2, vis.info.length / 2 - 0.1)), new CANNON.Vec3(0, (vis.info.belt + 0.05) / 2, (vis.info.minZ + vis.info.maxZ) / 2));
    b.userData = { kind: 'car', civilian: true };
    g.physics.world.addBody(b);
    this.race = { v, phase: 'stage', t: 0, rival: { vis, body: b, x: this.start.x - 0.5, speed: 0, a, react: rnd(0.12, 0.32), done: null, spin: 0 }, playerT: null, trap: 0, foul: false };
    g.traffic.closeRoads(['south_w', 'south_e']);
    v.teleport(new THREE.Vector3(this.start.x - 0.5, terrainHeight(this.start.x, this.laneZ), this.laneZ), Math.PI / 2);
    g.npcs.speak({ profile: { ageGroup: 'adult_male' }, char: null }, 'marshal_1');
    setTimeout(() => this.race && g.say('rival_1'), 4200);
    g.activity = null;
    this._place(this.race.rival);
    g.events.emit('dragStart', { a: +a.toFixed(2) });
  }

  _place(r) {
    const { y, q } = groundPose(r.x, this.rivalZ, Math.PI / 2, 2, 0.9);
    r.vis.root.position.set(r.x, y, this.rivalZ);
    r.vis.root.quaternion.copy(q);
    r.body.position.set(r.x, y, this.rivalZ);
    r.body.quaternion.set(q.x, q.y, q.z, q.w);
    r.body.velocity.set(r.speed, 0, 0);
  }

  tick(dt) {
    const R = this.race;
    if (!R) return;
    const g = this.sys.game, S = g.signals, v = R.v;
    R.t += dt;
    const tree = ['Stage', 'Y1', 'Y2', 'Y3', 'G', 'R'];
    if (R.phase === 'stage') {
      // hold both cars on the line; the tree counts down Y-Y-Y-GREEN (pro tree, 0.5 s steps)
      S.setDrag('Stage', true);
      const steps = [[2.4, 'Y1'], [2.9, 'Y2'], [3.4, 'Y3']];
      for (const [at, n] of steps) S.setDrag(n, R.t >= at && R.t < 3.9);
      if (R.t >= 0.6 && R.t < 3.9 && v.controls.throttle > 0.3 && g.player.vehicle === v) { R.foul = true; this._end('foul'); return; }
      // hold on the line without re-teleporting: teleport() lifts by cy + 0.3 from the y it is given, so feeding it the
      // chassis height every frame stacked ~0.8 m per frame and the car fell from the sky (and flipped) on green
      if (R.t < 3.9) { v.hold(this.start.x - 0.5, this.laneZ, Math.PI / 2); return; }
      R.phase = 'run'; R.greenAt = R.t;
      S.setDrag('G', true);
      g.audio.tone(880, 0.5, 'square', 0.12);
    }
    if (R.phase === 'run' || R.phase === 'finish') {
      if (R.t - R.greenAt > 1.2) S.setDrag('G', false);
      const r = R.rival;
      if (R.t - R.greenAt > r.react && !r.done) r.speed = Math.min(52, r.speed + r.a * (1 - r.speed / 60) * dt * 1.25);
      else if (r.done) r.speed = Math.max(0, r.speed - 9 * dt);
      r.x += r.speed * dt;
      r.spin += r.speed * dt / r.vis.spec.r;
      r.vis.wheelNodes.forEach((w, i) => r.vis.setWheel(i, 0, 0, r.spin));
      r.vis.update(dt, { headlights: true, brake: !!r.done });
      this._place(r);
      if (!r.done && r.x >= this.finishX) r.done = R.t - R.greenAt;
      // straight-line assist (like most drag games): while you're not steering, hold the car in its lane
      if (!R.playerT && g.player.vehicle === v && Math.abs(v.controls.steer) < 0.1 && v.speedAbs > 2) {
        const err = Math.atan2(Math.sin(v.heading - Math.PI / 2), Math.cos(v.heading - Math.PI / 2));
        const want = -err * 3 + (v.position.z - this.laneZ) * 0.15;
        v.body.angularVelocity.y += (want - v.body.angularVelocity.y) * Math.min(1, dt * 8);
      }
      if (!R.playerT && v.position.x >= this.finishX) { R.playerT = R.t - R.greenAt; R.trap = v.speedAbs; }
      if (R.phase === 'run' && R.playerT && r.done) { R.phase = 'finish'; this._end(R.playerT < r.done ? 'win' : 'lose'); }
      if (R.phase === 'run' && R.t - R.greenAt > 25) this._end('lose');
      if (!g.player.vehicle || g.player.vehicle !== v) { if (R.phase === 'run') this._end('abort'); }
    }
    if (R.phase === 'done' && R.t > R.doneAt + 6) this._cleanup();
    // bleacher crowd cheers during the run
    for (const s of this.spectators) s.cheer = R.phase === 'run' || (R.phase === 'done' && R.t < R.doneAt + 3);
  }

  _end(result) {
    const g = this.sys.game, R = this.race;
    if (R.phase === 'done') return;
    R.phase = 'done'; R.doneAt = R.t; R.result = result;
    for (const n of ['Stage', 'Y1', 'Y2', 'Y3', 'G']) g.signals.setDrag(n, false);
    const say = (id) => g.npcs.speak({ profile: { ageGroup: 'adult_male' }, char: null }, id);
    if (result === 'foul') { g.signals.setDrag('R', true); setTimeout(() => g.signals.setDrag('R', false), 3000); this.stats.fouls++; g.state.money -= 200; say('marshal_foul'); }
    else if (result === 'win') {
      this.stats.wins++; g.state.money += 200; g.audio.cash(); say('marshal_win'); setTimeout(() => g.say('rival_lose'), 3500);
      const et = R.playerT.toFixed(3);
      if (!this.best || R.playerT < this.best.et) { this.best = { et: R.playerT, trap: R.trap * MPH }; store('mw_drag', this.best); }
      g.hud.toast(`🏁 WIN! ET ${et}s @ ${Math.round(R.trap * MPH)} mph · rival ${R.rival.done.toFixed(3)}s · +$200`, 'good', 7000);
    } else if (result === 'lose') { g.state.money -= 200; say('marshal_lose'); g.hud.toast(`🏁 Vic Vapor wins (${R.rival.done ? R.rival.done.toFixed(3) : '—'}s)${R.playerT ? ` · you: ${R.playerT.toFixed(3)}s` : ''} · -$200`, 'bad', 6000); }
    else g.hud.toast('Race abandoned', 'bad');
    g.events.emit('dragEnd', { result, et: R.playerT, rival: R.rival.done });
  }

  _cleanup() {
    const g = this.sys.game, R = this.race;
    g.scene.remove(R.rival.vis.root);
    R.rival.vis.dispose && R.rival.vis.dispose();
    g.physics.world.removeBody(R.rival.body);
    g.traffic.openRoads();
    this.race = null;
  }

  hud() {
    const R = this.race;
    if (!R) return null;
    const v = R.v;
    const t = R.phase === 'stage' ? 0 : (R.playerT ?? (R.t - R.greenAt));
    const d = Math.max(0, Math.min(201, v.position.x - this.start.x));
    return `<div class="ph">EIGHTH-MILE DRAG</div>${R.phase === 'stage' ? 'Watch the tree… launch on <b>GREEN</b>' : `Time <b>${t.toFixed(2)}s</b> · ${Math.round(d)} m · ${Math.round(v.speedAbs * MPH)} mph`}` +
      (this.best ? `<br/><span class="hint">Best ${this.best.et.toFixed(3)}s @ ${Math.round(this.best.trap)} mph</span>` : '');
  }
}

// ===================================================================================== PARTS RUNNER SHIFT
class PartsRunner {
  constructor(sys) {
    this.sys = sys;
    const f = sys.game.factory;
    this.pickup = f.building.spots.CratePickup;
    this.job = null;
    this.stats = { shifts: 0, delivered: 0, late: 0 };
    this.drops = LAYOUT.stationsX.map((x, i) => ({ i, pos: new THREE.Vector3(x + 1.5, 0.1, PLANT.z + 3.2) }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 32), new THREE.MeshBasicMaterial({ color: '#39ff14', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.visible = false; ring.renderOrder = 4;
    sys.game.scene.add(ring);
    this.ring = ring;
    // a stack of crates on the receiving pallet
    for (let i = 0; i < 3; i++) {
      const c = sys.game.assets.part('props', 'PartsCrate');
      c.position.copy(this.pickup).add(new THREE.Vector3(-0.4 + (i % 2) * 0.75, 0.15 + Math.floor(i / 2) * 0.56, -0.9));
      sys.game.scene.add(c);
      bakeProp(c);
    }
  }

  candidates(pos) {
    const g = this.sys.game, out = [], p = g.player;
    const clock = this.sys.timeClock;
    if (clock && pos.distanceTo(clock) < 1.8) out.push(this.job ? { d: 0.4, text: '[E] Punch out (end shift)', act: () => this.end('quit') } : { d: 0.4, text: '[E] Punch in: Parts Runner shift (5 deliveries, $120 each + bonus)', act: () => this.begin() });
    if (!this.job) return out;
    if (!p.carrying && pos.distanceTo(this.pickup) < 2.2) out.push({ d: 0.3, text: '[E] Grab a parts crate', act: () => this.grab() });
    if (p.carrying && p.carrying.kind === 'crate' && Math.hypot(pos.x - this.job.drop.pos.x, pos.z - this.job.drop.pos.z) < 2.0) out.push({ d: 0.2, text: `[E] Deliver the crate to station ${this.job.drop.i + 1}`, act: () => this.deliver() });
    return out;
  }

  begin() {
    const g = this.sys.game;
    this.job = { n: 0, drop: null, t: 0, earned: 0 };
    this.stats.shifts++;
    g.say('shift_start', g.npcs.foreman.char);
    g.audio.tone(1500, 0.08, 'square', 0.1); g.audio.tone(900, 0.2, 'square', 0.1, 0.1);
    this._next();
    g.events.emit('shiftStart', {});
  }

  _next() {
    const j = this.job;
    j.drop = this.drops[Math.floor(Math.random() * this.drops.length)];
    j.t = 50;
    this.ring.position.copy(j.drop.pos);
    this.ring.visible = true;
  }

  grab() {
    const g = this.sys.game, p = g.player;
    const mesh = g.assets.part('props', 'PartsCrate');
    bakeProp(mesh);
    mesh.position.set(0, 0.62, 0.42);
    p.char.root.add(mesh);
    p.carrying = { mesh, kind: 'crate', name: 'Parts Crate', value: 0, heavy: true, job: true };
    g.audio.clunk();
  }

  deliver() {
    const g = this.sys.game, p = g.player, j = this.job;
    p.char.root.remove(p.carrying.mesh);
    p.carrying = null;
    const pay = 120 + Math.round(Math.max(0, j.t) * 1.5);
    g.state.money += pay;
    j.earned += pay;
    j.n++;
    this.stats.delivered++;
    g.audio.cash();
    g.effects.sparks(j.drop.pos.clone().setY(0.5), 16, '#39ff14', 3);
    g.hud.toast(`📦 Delivered to station ${j.drop.i + 1} · +$${pay}`, 'good');
    g.events.emit('crateDelivered', { n: j.n, pay });
    if (j.n >= 5) this.end('done'); else this._next();
  }

  end(why) {
    const g = this.sys.game, j = this.job;
    if (!j) return;
    if (g.player.carrying && g.player.carrying.kind === 'crate') { g.player.char.root.remove(g.player.carrying.mesh); g.player.carrying = null; }
    this.ring.visible = false;
    if (why === 'done') { g.state.money += 250; g.say('shift_done', g.npcs.foreman.char); g.hud.toast(`✅ Shift complete! $${j.earned} + $250 bonus`, 'good', 6000); }
    else if (why === 'late') { this.stats.late++; g.say('shift_late', g.npcs.foreman.char); g.hud.toast(`⏱️ Too slow — shift over. Earned $${j.earned}`, 'bad', 5000); }
    else g.hud.toast(`Punched out. Earned $${j.earned}`, '', 4000);
    g.events.emit('shiftEnd', { why, earned: j.earned });
    this.job = null;
  }

  tick(dt) {
    const j = this.job;
    if (!j) return;
    j.t -= dt;
    this.ring.material.opacity = 0.55 + Math.sin(this.sys.game.time * 6) * 0.3;
    if (j.t <= 0) this.end('late');
  }

  hud() {
    const j = this.job;
    if (!j) return null;
    const carrying = this.sys.game.player.carrying && this.sys.game.player.carrying.kind === 'crate';
    return `<div class="ph">PARTS RUNNER</div>${carrying ? `Run it to <b>station ${j.drop.i + 1}</b>` : 'Grab a crate at <b>RECEIVING</b>'} · <b>${Math.max(0, j.t).toFixed(0)}s</b><br/>Delivered ${j.n}/5 · earned $${j.earned}`;
  }

  target() {
    const j = this.job;
    if (!j) return null;
    return this.sys.game.player.carrying ? j.drop.pos : this.pickup;
  }
}

// ===================================================================================== PUMPKIN PANIC (arcade)
class Arcade {
  constructor(sys) {
    this.sys = sys;
    this.activityName = 'Arcade';
    this.hi = load('mw_arcade_hi', 0);
    this.stats = { plays: 0, best: this.hi };
    this.screenCanvas = document.createElement('canvas'); this.screenCanvas.width = 128; this.screenCanvas.height = 104;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas); this.screenTex.colorSpace = THREE.SRGBColorSpace;
    this.overlay = null;
  }

  attachScreen(mesh) { if (mesh) mesh.material = new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }); }

  begin() {
    const g = this.sys.game;
    if (g.state.money < 1) { g.hud.toast('$1 to play', 'bad'); return; }
    g.state.money -= 1;
    this.stats.plays++;
    g.audio.cash();
    const el = document.createElement('div');
    el.id = 'arcade';
    el.innerHTML = '<canvas width="480" height="390"></canvas><div class="arc-hint">A/D or ←/→ move · catch pumpkins, dodge skulls · [E] quit</div>';
    document.body.appendChild(el);
    this.overlay = el;
    this.cv = el.querySelector('canvas');
    this.s = { x: 240, score: 0, lives: 3, drops: [], spawn: 0, t: 0, over: 0 };
    g.activity = this;
    g.events.emit('arcade', {});
  }

  update(dt, input) {
    const s = this.s, g = this.sys.game;
    if (input.pressed('KeyE') || input.pressed('KeyQ')) { this.close(); return; }
    s.t += dt;
    if (s.over > 0) { s.over -= dt; if (s.over <= 0) this.close(); this._render(); return; }
    const dir = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
    s.x = THREE.MathUtils.clamp(s.x + dir * 330 * dt, 30, 450);
    if ((s.spawn -= dt) < 0) { s.spawn = Math.max(0.28, 0.9 - s.t * 0.012); s.drops.push({ x: rnd(20, 460), y: -20, v: rnd(110, 170) + s.t * 3, skull: Math.random() < 0.28 }); }
    for (const d of s.drops) {
      d.y += d.v * dt;
      if (d.y > 330 && d.y < 360 && Math.abs(d.x - s.x) < 40 && !d.hit) {
        d.hit = true;
        if (d.skull) { s.lives--; g.audio.tone(140, 0.25, 'sawtooth', 0.15); } else { s.score += 10; g.audio.tone(880 + (s.score % 50) * 6, 0.06, 'square', 0.08); }
      }
    }
    s.drops = s.drops.filter((d) => d.y < 400 && !d.hit);
    if (s.lives <= 0) {
      s.over = 2.5;
      if (s.score > this.hi) { this.hi = s.score; this.stats.best = s.score; store('mw_arcade_hi', s.score); g.say('arcade_hi'); }
    }
    this._render();
  }

  _render() {
    const s = this.s, g = this.cv.getContext('2d');
    g.fillStyle = '#0a0414'; g.fillRect(0, 0, 480, 390);
    g.fillStyle = '#1a0d2e'; for (let i = 0; i < 40; i++) g.fillRect((i * 97) % 480, (i * 53 + s.t * 20) % 390, 2, 2);
    for (const d of s.drops) {
      if (d.skull) { g.fillStyle = '#e8e8f0'; g.beginPath(); g.arc(d.x, d.y, 12, 0, 7); g.fill(); g.fillStyle = '#000'; g.fillRect(d.x - 6, d.y - 3, 4, 4); g.fillRect(d.x + 2, d.y - 3, 4, 4); }
      else { g.fillStyle = '#ff7a1a'; g.beginPath(); g.ellipse(d.x, d.y, 13, 11, 0, 0, 7); g.fill(); g.fillStyle = '#3a6a1a'; g.fillRect(d.x - 2, d.y - 15, 4, 6); }
    }
    g.fillStyle = '#7b2cbf'; g.fillRect(s.x - 36, 346, 72, 14); g.fillStyle = '#39ff14'; g.fillRect(s.x - 30, 340, 60, 6);
    g.fillStyle = '#ffd23f'; g.font = 'bold 18px monospace'; g.fillText(`SCORE ${s.score}`, 14, 26); g.fillText(`HI ${Math.max(this.hi, s.score)}`, 200, 26); g.fillText('🎃'.repeat(Math.max(0, s.lives)), 380, 26);
    if (s.over > 0) { g.fillStyle = '#ff2a3a'; g.font = 'bold 40px monospace'; g.textAlign = 'center'; g.fillText('GAME OVER', 240, 200); g.textAlign = 'left'; }
  }

  close() {
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    const g = this.sys.game;
    g.activity = null;
    g.input.clearAll('arcade');
  }

  tick(dt) {
    // attract mode on the cabinet's own screen (cheap: 6 fps, only when near)
    const g = this.sys.game;
    if (!this.cabPos || g.camera.position.distanceTo(this.cabPos) > 18) return;
    if ((this._acc = (this._acc || 0) + dt) < 0.16) return;
    this._acc = 0;
    const c = this.screenCanvas.getContext('2d'), t = g.time;
    c.fillStyle = '#0a0414'; c.fillRect(0, 0, 128, 104);
    c.fillStyle = '#ff7a1a'; for (let i = 0; i < 5; i++) { c.beginPath(); c.arc((i * 29 + 10) % 128, (t * 40 + i * 37) % 104, 6, 0, 7); c.fill(); }
    c.fillStyle = Math.floor(t * 2) % 2 ? '#39ff14' : '#ffd23f'; c.font = 'bold 13px monospace'; c.fillText('PUMPKIN', 32, 44); c.fillText('PANIC', 42, 60);
    c.fillStyle = '#fff'; c.font = '9px monospace'; c.fillText(`HI ${this.hi}`, 46, 92);
    this.screenTex.needsUpdate = true;
  }
}

// ===================================================================================== STUNT JUMPS
class StuntJumps {
  constructor(sys) {
    this.sys = sys;
    const g = sys.game;
    this.ramps = [];
    this.air = 0;
    this.stats = { jumps: 0, best: 0 };
    const mat = new THREE.MeshStandardMaterial({ color: '#c9a23a', roughness: 0.7, metalness: 0.2 });
    const stripe = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.8 });
    for (const [x, z, yaw] of g.town.ramps) {
      const len = 7, w = 4, h = 1.6, ang = Math.atan2(h, len);
      const grp = new THREE.Group();
      const deck = new THREE.Mesh(new THREE.BoxGeometry(w, 0.25, Math.hypot(len, h)), mat);
      deck.rotation.x = -ang; deck.position.set(0, h / 2, 0);
      grp.add(deck);
      for (const sx of [-1, 1]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.27, Math.hypot(len, h)), stripe); s.rotation.x = -ang; s.position.set(sx * (w / 2 - 0.12), h / 2 + 0.01, 0); grp.add(s); }
      const sup = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.4), stripe); sup.position.set(0, h / 2, len / 2 - 0.2); grp.add(sup);
      grp.position.set(x, terrainHeight(x, z), z);
      grp.rotation.y = yaw;
      grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.scene.add(grp);
      grp.updateMatrixWorld(true);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-ang, yaw, 0, 'YXZ'));
      g.physics.addStaticBox(deck.getWorldPosition(new THREE.Vector3()), { x: w / 2, y: 0.125, z: Math.hypot(len, h) / 2 }, q, { tag: 'ramp' });
      this.ramps.push({ pos: new THREE.Vector3(x, 0, z), cooldown: 0 });
    }
  }

  tick(dt) {
    const g = this.sys.game, v = g.player.vehicle;
    for (const r of this.ramps) r.cooldown = Math.max(0, r.cooldown - dt);
    if (!v) { this.air = 0; return; }
    const airborne = v.raycast.wheelInfos.every((w) => !w.raycastResult.hasHit);
    if (airborne && v.speedAbs > 12) {
      if (this.air === 0) this.from = this.ramps.find((r) => r.cooldown <= 0 && Math.hypot(r.pos.x - v.position.x, r.pos.z - v.position.z) < 14);
      this.air += dt;
    } else if (this.air > 0) {
      if (this.from && this.air > 0.7) {
        const pay = Math.round(40 + this.air * 60);
        this.from.cooldown = 20;
        this.stats.jumps++;
        this.stats.best = Math.max(this.stats.best, this.air);
        g.state.money += pay;
        g.audio.cash();
        g.hud.toast(`🛫 STUNT JUMP! ${this.air.toFixed(1)}s airtime · +$${pay}`, 'good', 3500);
        g.events.emit('stuntJump', { air: this.air });
      }
      this.air = 0; this.from = null;
    }
  }
}

// ===================================================================================== the hub
/** Motorworks + town side activities: dyno cell, drag strip, Parts Runner shifts, break-room arcade & vending, stunt ramps. */
export class Activities {
  constructor(game) {
    this.game = game;
  }

  build() {
    const g = this.game, town = g.town;
    // break-room furniture from props.glb (plant-local coordinates)
    const place = (name, lx, lz, yaw) => {
      const o = g.assets.part('props', name);
      const p = new THREE.Vector3(...pl(lx, lz, 0.08));
      o.position.copy(p); o.rotation.y = yaw;
      g.scene.add(o);
      o.updateMatrixWorld(true);
      g.physics.collidersFrom(o, { tag: 'prop' });
      return o;
    };
    const arcade = place('ArcadeCabinet', -31.0, 21.2, Math.PI / 2);
    const vend = place('VendingMachine', -31.0, 19.4, Math.PI / 2);
    const clock = place('TimeClock', -31.55, 23.6, Math.PI / 2);
    this.arcade = new Arcade(this);
    this.arcade.attachScreen(arcade.getObjectByName('Arcade_Screen'));
    this.arcade.cabPos = arcade.position.clone();
    bakeProp(arcade, [arcade.getObjectByName('Arcade_Screen')]);
    bakeProp(vend); bakeProp(clock);
    this.arcadePos = arcade.position.clone().add(new THREE.Vector3(0.9, 0, 0));
    this.vendPos = vend.position.clone().add(new THREE.Vector3(0.9, 0, 0));
    this.timeClock = clock.position.clone().add(new THREE.Vector3(0.7, 0, 0));
    this.dyno = new Dyno(this);
    this.drag = new DragRace(this);
    this.runner = new PartsRunner(this);
    this.stunts = new StuntJumps(this);
    // bleacher crowd by the drag strip
    const sp = town.streets.spots;
    for (let k = 0; k < 5; k++) {
      const s = sp['Bleacher_' + k];
      if (!s) continue;
      for (let i = 0; i < 3; i++) {
        const kid = Math.random() < 0.3;
        const c = makePerson(g.assets, kid ? randomKid() : randomAdult(), 'spectator');
        c.root.position.set(s.x - 14 + i * 9 + rnd(-2, 2) + k * 1.3, s.y - 0.5, s.z);
        c.root.rotation.y = Math.PI;
        g.scene.add(c.root);
        this.drag.spectators.push({ char: c, cheer: false, ph: Math.random() * 6 });
      }
    }
  }

  /** In-car prompt (dyno / drag strip) or null. */
  carCandidate(v) {
    return (this.dyno && this.dyno.candidate(v)) || (this.drag && this.drag.candidate(v)) || null;
  }

  candidates(pos) {
    const g = this.game, out = [];
    if (this.arcadePos && pos.distanceTo(this.arcadePos) < 1.4) out.push({ d: 0.3, text: `[E] Play PUMPKIN PANIC — $1 (hi ${this.arcade.hi})`, act: () => this.arcade.begin() });
    if (this.vendPos && pos.distanceTo(this.vendPos) < 1.4) out.push({ d: 0.35, text: '[E] Buy a Ghoul-Cola — $2 (+25 health)', act: () => this.vend() });
    if (this.runner) out.push(...this.runner.candidates(pos));
    return out;
  }

  vend() {
    const g = this.game;
    if (g.state.money < 2) { g.hud.toast('$2 please', 'bad'); return; }
    g.state.money -= 2;
    g.combat.health = Math.min(100, g.combat.health + 25);
    g.audio.clunk(); g.audio.noiseBurst(0.4, 6000, 0.7, 0.08, 'highpass', 0.3);
    g.hud.toast('🥤 Ghoul-Cola: +25 health', 'good');
    g.events.emit('vend', {});
  }

  objective() { return null; }
  target() { return (this.runner && this.runner.target()) || null; }
  hud() { return (this.drag && this.drag.hud()) || (this.runner && this.runner.hud()) || null; }

  tick(dt) {
    this.dyno.tick(dt);
    this.drag.tick(dt);
    this.runner.tick(dt);
    this.arcade.tick(dt);
    this.stunts.tick(dt);
    // the bleacher crowd only exists for the camera when it is near the strip (saves ~60 draw calls elsewhere)
    const near = this.game.camera.position.distanceTo(this.drag.start) < 110 || this.game.camera.position.distanceTo(new THREE.Vector3(-42, 0, -140)) < 90;
    for (const s of this.drag.spectators) { s.char.root.visible = near; if (near) s.char.update(dt, s.cheer ? 'dance' : 'sit'); }
  }

  stats() {
    return { dyno: this.dyno.stats, drag: this.drag.stats, runner: this.runner.stats, arcade: this.arcade.stats, stunts: this.stunts.stats };
  }
}
