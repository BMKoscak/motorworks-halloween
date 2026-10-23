import * as THREE from 'three';
import { GOLDEN_PUMPKINS, LAYOUT } from '../config.js';
import { catmull, terrainHeight } from '../world/terrain.js';
import { CarVisual } from '../vehicle/carVisual.js';

/**
 * Objectives & waypoints, Golden Pumpkins (Monster Mash unlock), the Graveyard Shift drift trial,
 * and the Phantom Hearse midnight race.
 */
export class Missions {
  constructor(game, cem) {
    this.game = game;
    this.cem = cem;
    this.guide = true;
    this.step = 'kiosk';
    // waypoint beacon
    const bg = new THREE.CylinderGeometry(1.2, 1.2, 120, 16, 1, true);
    this.beacon = new THREE.Mesh(bg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color('#39ff14') } },
      vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform float uT; uniform vec3 uC; varying float vY; void main(){ float a = (1.0 - smoothstep(0.0, 60.0, vY+60.0)) * 0.55 + 0.1*sin(vY*0.5-uT*4.0); gl_FragColor = vec4(uC, max(0.0,a)*0.7); }',
    }));
    this.beacon.position.y = 60;
    this.beacon.renderOrder = 5;
    game.scene.add(this.beacon);
    this._buildPumpkins();
    this._buildTrial();
    this.honks = [];
    this.race = null;
    this.ghostRoute = catmull([[0, 304], [0, 298], [-8, 290], [-26, 306], [-42, 288], [-40, 266], [-22, 250], [0, 238], [0, 222],
      ...LAYOUT.hillRoad.slice().reverse().map(([x, z]) => [x, z]).slice(1), [0, 120], [0, 40], [0, 10], [10, 2.6], [30, 2.6], [45, 12]], 2);
  }

  // ------------------------------------------------------------------ objectives
  target() {
    const g = this.game;
    switch (this.step) {
      case 'kiosk': return new THREE.Vector3(...LAYOUT.kioskTerminal);
      case 'building': return g.assembly.visual ? g.assembly.visual.root.position : null;
      case 'getin': return g.ownedCar ? g.ownedCar.position : null;
      case 'drive': return this.cem.trialStart;
      default: return this.race ? new THREE.Vector3(45, 0, 12) : null;
    }
  }

  objectiveText() {
    const g = this.game;
    if (this.race) return this.race.phase === 'count' ? 'The Phantom Hearse awaits…' : 'Beat the Phantom Hearse to the town gas station!';
    if (this.trial && this.trial.running) return `Graveyard Shift: checkpoint ${this.trial.next + 1}/${this.cem.checkpoints.length}`;
    switch (this.step) {
      case 'kiosk': return 'Enter the Motorworks lobby and order a car at the kiosk [E]';
      case 'building': return `Order ${g.assembly.number}: follow your car down the assembly line`;
      case 'getin': return 'Your car is ready — get in [E]';
      case 'drive': return 'Test drive: head up the hill to the Old Town Cemetery';
      default: return g.police.level ? 'Lose the cops! Break line of sight, hide in the fog, or respray at the Custom Bay' : 'Free roam · Graveyard Shift trial at the cemetery gates · find the golden pumpkins';
    }
  }

  advance(step) {
    this.step = step;
    this.game.events.emit('objective', { step });
  }

  // ------------------------------------------------------------------ golden pumpkins
  _buildPumpkins() {
    const gold = new THREE.MeshStandardMaterial({ color: '#ffcf40', metalness: 0.9, roughness: 0.25, emissive: '#ffae00', emissiveIntensity: 1.1 });
    this.pumpkins = GOLDEN_PUMPKINS.map((p, i) => {
      const m = this.game.assets.part('props', 'Pumpkin_Lantern');
      m.traverse((o) => o.isMesh && o.material.name === 'Pumpkin' && (o.material = gold));
      m.scale.setScalar(1.6);
      m.position.set(p[0], p[1], p[2]);
      this.game.scene.add(m);
      const found = this.game.state.pumpkins.includes(i);
      m.visible = !found;
      return { mesh: m, i, found, base: p[1] };
    });
  }

  // ------------------------------------------------------------------ trial
  _buildTrial() {
    const mk = (color) => new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.18, 8, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.rings = this.cem.checkpoints.map((p, i) => {
      const r = mk(i === this.cem.checkpoints.length - 1 ? '#ffb000' : '#39ff14');
      const next = this.cem.checkpoints[(i + 1) % this.cem.checkpoints.length];
      r.position.set(p.x, p.y + 2.6, p.z);
      r.rotation.y = Math.atan2(next.x - p.x, next.z - p.z);
      r.visible = false;
      this.game.scene.add(r);
      return r;
    });
    this.startRing = mk('#ffb000');
    this.startRing.position.copy(this.cem.trialStart).add(new THREE.Vector3(0, 2.6, 0));
    this.game.scene.add(this.startRing);
    this.trial = { running: false, next: 0, t: 0, drift: 0, best: parseFloat(localStorage.getItem('mw_best') || '0') || null };
  }

  _updateTrial(dt, veh) {
    const T = this.trial;
    const ring = this.startRing;
    ring.visible = !T.running;
    ring.rotation.z += dt;
    if (!veh) return;
    const p = veh.position;
    const lastZ = T.lastZ ?? p.z;
    T.lastZ = p.z;
    if (!T.running) {
      // start when crossing the arch line heading into the cemetery (robust at low frame rates)
      const crossed = lastZ < this.cem.trialStart.z && p.z >= this.cem.trialStart.z && Math.abs(p.x - this.cem.trialStart.x) < 7;
      if (veh.speedAbs > 3 && veh.forward.z > 0.2 && (crossed || Math.hypot(p.x - this.cem.trialStart.x, p.z - this.cem.trialStart.z) < 5)) {
        T.running = true; T.next = 0; T.t = 0; T.drift = 0;
        this.rings.forEach((r, i) => (r.visible = i === 0));
        this.game.say('gy_start');
        this.game.audio.ding();
        this.game.events.emit('trialStart', {});
      }
      return;
    }
    T.t += dt;
    if (veh.sliding && veh.speedAbs > 8) T.drift += dt * veh.speedAbs * 12;
    const cp = this.cem.checkpoints[T.next];
    if (Math.hypot(p.x - cp.x, p.z - cp.z) < 6.5) {
      this.rings[T.next].visible = false;
      T.next++;
      this.game.audio.ding();
      if (T.next >= this.cem.checkpoints.length) {
        T.running = false;
        const total = T.t;
        const isBest = !T.best || total < T.best;
        if (isBest) { T.best = total; try { localStorage.setItem('mw_best', String(total)); } catch (e) { /* private mode */ } }
        this.game.hud.toast(`Graveyard Shift: ${total.toFixed(2)}s · drift ${Math.round(T.drift)} pts${isBest ? ' · NEW BEST!' : ''}`, 'good', 5000);
        this.game.state.money += 1500 + Math.round(T.drift);
        this.game.say('gy_finish');
        this.game.events.emit('trialFinish', { time: total, drift: T.drift });
      } else this.rings[T.next].visible = true;
    }
    if (veh.position.z < 200) { T.running = false; this.rings.forEach((r) => (r.visible = false)); this.game.hud.toast('Graveyard Shift abandoned', 'bad'); }
  }

  // ------------------------------------------------------------------ phantom hearse
  honk() {
    const g = this.game, v = g.player.vehicle;
    if (!v || this.race) return;
    const c = LAYOUT.vladCrypt;
    if (Math.hypot(v.position.x - c[0], v.position.z - c[2]) > 24) return;
    const now = performance.now();
    this.honks = this.honks.filter((t) => now - t < 5000);
    this.honks.push(now);
    if (this.honks.length >= 3) { this.honks = []; this._summon(); }
  }

  _summon() {
    const g = this.game;
    const vis = new CarVisual(g.assets, { ...g.player.vehicle.visual.cfg, body: 'hearse', hood: 'Hood_Blower', exhaust: 'Exhaust_Flame', rim: 'Sawblade', underglow: 'green', roof: 'none' }, { ghost: true });
    g.scene.add(vis.root);
    this.race = { visual: vis, s: 0, phase: 'count', t: 0, speed: 0 };
    this.cem.vladDoor.userData.target = 1;
    g.audio.stamp();
    g.hud.flash('#7dffb0', 0.5);
    g.say('phantom_1');
    g.events.emit('phantom', {});
    this._placeGhost(0);
  }

  _routeAt(s) {
    const r = this.ghostRoute;
    let acc = 0;
    for (let i = 1; i < r.length; i++) {
      const L = r[i].distanceTo(r[i - 1]);
      if (acc + L >= s) { const k = (s - acc) / L; return { p: r[i - 1].clone().lerp(r[i], k), dir: r[i].clone().sub(r[i - 1]).normalize(), end: false }; }
      acc += L;
    }
    return { p: r.at(-1).clone(), dir: new THREE.Vector3(1, 0, 0), end: true };
  }

  _placeGhost(s) {
    const { p, dir, end } = this._routeAt(s);
    const v = this.race.visual;
    v.root.position.set(p.x, terrainHeight(p.x, p.z) + 0.25 + Math.sin(performance.now() / 300) * 0.08, p.z);
    v.root.rotation.y = Math.atan2(dir.x, dir.z);
    return end;
  }

  _updateRace(dt) {
    const R = this.race, g = this.game;
    R.t += dt;
    const v = g.player.vehicle;
    if (R.phase === 'count') {
      const n = 3 - Math.floor(R.t);
      if (n !== R.lastN && n > 0) { R.lastN = n; g.hud.toast(String(n), '', 900); g.audio.blip(600, 0.15); }
      if (R.t > 3.2) { R.phase = 'race'; R.t = 0; g.hud.toast('GO!', 'good', 1200); g.audio.blip(1200, 0.3); }
      this._placeGhost(0);
      return;
    }
    if (R.phase === 'race') {
      R.speed = Math.min(30, R.speed + dt * 7);
      R.s += R.speed * dt;
      const ended = this._placeGhost(R.s);
      R.visual.update(dt, { rpm: 6000, backfire: true, throttle: 1 });
      R.visual.wheelNodes.forEach((w, i) => R.visual.setWheel(i, 0, 0, R.s / 0.38));
      if (Math.random() < dt * 30) g.effects.emit(R.visual.root.position.clone().add(new THREE.Vector3(0, 0.6, 0)), new THREE.Vector3(0, 1, 0), '#7dffb0', 0.6, 0.8, { additive: true, grow: 1.5, alpha: 0.6 });
      const fin = new THREE.Vector3(45, 0, 12);
      const playerDone = v && Math.hypot(v.position.x - fin.x, v.position.z - fin.z) < 10;
      if (playerDone || ended) this._endRace(playerDone && !ended);
    }
  }

  _endRace(won) {
    const g = this.game;
    g.say(won ? 'phantom_win' : 'phantom_lose');
    g.hud.toast(won ? 'You beat the Phantom Hearse! +$6,666' : 'The Phantom wins… this time.', won ? 'good' : 'bad', 5000);
    if (won) { g.state.money += 6666; this.unlockLauncher('beating the Phantom Hearse'); }
    g.events.emit('phantomResult', { won });
    const vis = this.race.visual;
    setTimeout(() => vis.dispose(), 1500);
    this.cem.vladDoor.userData.target = 0;
    this.race = null;
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    const g = this.game, t = performance.now() / 1000;
    const pos = g.player.position;
    const veh = g.player.vehicle;
    // pumpkins
    for (const P of this.pumpkins) {
      if (P.found) continue;
      P.mesh.rotation.y += dt * 1.5;
      P.mesh.position.y = P.base + Math.sin(t * 2 + P.i) * 0.15;
      if (Math.random() < dt * 4) g.effects.emit(P.mesh.position.clone().add(new THREE.Vector3((Math.random() - 0.5), Math.random(), (Math.random() - 0.5))), new THREE.Vector3(0, 0.6, 0), '#ffd23f', 0.12, 0.9, { additive: true });
      if (Math.hypot(pos.x - P.mesh.position.x, pos.z - P.mesh.position.z) < (veh ? 3.2 : 2) && Math.abs(pos.y - P.base) < 3.5) this.collect(P);
    }
    // vlad crypt door
    const d = this.cem.vladDoor;
    d.userData.cur = (d.userData.cur || 0) + THREE.MathUtils.clamp((d.userData.target || 0) - (d.userData.cur || 0), -dt, dt);
    d.rotation.y = (d.userData.open || -1.4) * d.userData.cur;
    this._updateTrial(dt, veh);
    if (this.race) this._updateRace(dt);
    // beacon
    const tg = this.guide ? this.target() : null;
    const far = tg && Math.hypot(tg.x - pos.x, tg.z - pos.z) > 28;
    this.beacon.visible = !!tg && far && (!g.player.vehicle || this.step === 'drive' || !!this.race);
    if (tg) this.beacon.position.set(tg.x, (tg.y || 0) + 60, tg.z);
    this.beacon.material.uniforms.uT.value = t;
    // auto-advance objectives
    if (this.step === 'drive' && veh && pos.z > 205) this.advance('free');
  }

  collect(P) {
    const g = this.game;
    P.found = true;
    P.mesh.visible = false;
    g.state.pumpkins.push(P.i);
    g.audio.chime();
    g.effects.sparks(P.mesh.position, 40, '#ffd23f', 5);
    g.hud.toast(`Golden Pumpkin ${g.state.pumpkins.length}/5 found!`, 'good');
    g.events.emit('pumpkin', { count: g.state.pumpkins.length });
    if (g.state.pumpkins.length >= 5 && !g.state.monsterMash) {
      g.state.monsterMash = true;
      g.say('kiosk_unlock');
      g.hud.toast('🧟 MONSTER MASH PACK UNLOCKED at the kiosk & custom bay!', 'good', 6000);
      this.unlockLauncher('finding every Golden Pumpkin');
    }
    g.save();
  }

  /** Halloween easter-egg reward: the Jack-o'-Lantern Launcher (weapon slot 5). */
  unlockLauncher(why) {
    const g = this.game;
    if (!g.combat || g.combat.owned.launcher) return;
    g.combat.give('launcher', 6);
    g.state.launcher = true;
    g.save();
    g.hud.toast(`🎃 Jack-o'-Lantern Launcher unlocked for ${why}! (key 5)`, 'good', 5000);
  }
}
