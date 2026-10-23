import * as THREE from 'three';
import { LAYOUT, BODIES, ENGINES } from '../config.js';
import { CarVisual } from '../vehicle/carVisual.js';
import { Vehicle } from '../vehicle/vehicle.js';
import { STATION_NAMES } from '../world/factory.js';

const STAGE_TIME = 16;
const smooth = (a, b, t) => THREE.MathUtils.smoothstep(t, a, b);

/** Order -> 5 stations -> roll-out. Drives the car's build stage, hinges and the station machinery timing. */
export class AssemblyLine {
  constructor(game, factory) {
    this.game = game;
    this.f = factory;
    this.running = false;
    this.stage = -1;
    this.stageT = 0;
    this.camMode = null; // null | 'station' | 'follow'
    this.camStation = 0;
    this.log = [];
    this.orders = 0;
  }

  get total() { return this.running ? Math.min(1, (this.stage + this.stageT) / 5) : 0; }

  start(cfg) {
    if (this.visual) { this.visual.dispose(); this.visual = null; }
    this.cfg = { ...cfg };
    this.orders++;
    this.number = `MW-1031-${String(Math.floor(1000 + Math.random() * 8999))}`;
    this.visual = new CarVisual(this.game.assets, cfg, { withLights: true });
    this.visual.root.rotation.y = Math.PI / 2;
    this.game.scene.add(this.visual.root);
    this.visual.setBuildStage(0);
    this.visual.setAllHinges(1);
    for (const k in this.visual.hinges) this.visual.hinges[k].t = 1;
    this.running = true;
    this.stage = 0;
    this.stageT = 0;
    this.done = {};
    this.rollout = 0;
    this.f.panelStack.children.forEach((p) => (p.visible = false));
    this.log = [{ t: performance.now(), ev: 'order', number: this.number }];
    this.game.events.emit('orderStarted', { number: this.number, cfg });
  }

  _once(key, fn) { if (!this.done[key]) { this.done[key] = true; fn(); this.log.push({ t: performance.now(), ev: key }); } }

  hudState() {
    if (!this.running) return null;
    const body = BODIES.find((b) => b.id === this.cfg.body);
    return { number: this.number, label: body ? body.name : '', stations: STATION_NAMES, stage: Math.min(this.stage, 5), stageT: this.stageT, total: this.total };
  }

  update(dt, fast) {
    if (!this.running) return;
    const v = this.visual, f = this.f, audio = this.game.audio;
    const SX = LAYOUT.stationsX, lz = LAYOUT.lineZ;
    const vs = { rpm: 900 };
    if (this.stage < 5) {
      this.stageT += (dt / STAGE_TIME) * (fast ? 5 : 1);
      const fromX = this.stage === 0 ? LAYOUT.lineStartX : SX[this.stage - 1];
      f.carrier.position.x = THREE.MathUtils.lerp(fromX, SX[this.stage], smooth(0, 0.14, this.stageT));
      f.frameRails.visible = this.stage === 0;
      v.root.position.set(f.carrier.position.x, f.carrier.position.y + 0.18, lz);
      const st = this.stageT;
      switch (this.stage) {
        case 0:
          break;
        case 1:
          this._once('s1_body', () => { v.setBuildStage(1); v.setAllHinges(1); audio.hydraulic(); });
          [['Door_L', 0.5], ['Door_R', 0.58], ['DoorRear_L', 0.62], ['DoorRear_R', 0.66], ['Hood', 0.72], ['Trunk', 0.8]].forEach(([h, at]) => {
            if (st > at && v.hinges[h]) this._once('close_' + h, () => { v.setHinge(h, 0); setTimeout(() => audio.doorShut(), 350); });
          });
          break;
        case 2:
          this._once('s2_paint', () => v.setBuildStage(1));
          v.setReveal(smooth(0.15, 0.85, st));
          break;
        case 3: {
          this._once('s3_open', () => { v.setBuildStage(2); v.setHinge('Hood', 1); this._engineProp(); });
          if (this.engineProp) this.engineProp.visible = st < 0.55;
          if (st > 0.55) this._once('engine_in', () => { audio.clunk(); this.game.effects.sparks(v.root.position.clone().add(new THREE.Vector3(1.4, 1.0, 0)), 16, '#9fd8ff', 3); });
          vs.showEngine = st > 0.55 && st < 0.92;
          // wheels slide onto their axles one by one
          v.wheelNodes.forEach((w, i) => {
            const t0 = 0.58 + i * 0.06;
            if (!w.rim) return;
            const k = smooth(t0, t0 + 0.08, st);
            w.rim.visible = w.caliper.visible = st > t0 - 0.02;
            const side = w.name[1] === 'L' ? 1 : -1;
            w.rim.position.x = side * 1.6 * (1 - k);
            if (k >= 1) this._once('wheel_' + i, () => audio.clunk());
          });
          if (st > 0.9) this._once('s3_close', () => v.setHinge('Hood', 0));
          break;
        }
        case 4: {
          this._once('s4_final', () => { v.setBuildStage(4); v.wheelNodes.forEach((w) => w.rim && (w.rim.position.x = 0)); });
          const flick = st > 0.5 && st < 0.65 ? (Math.random() > 0.5 ? 1 : 0) : 1;
          Object.assign(vs, { headlights: flick, glowFlicker: st > 0.5 && st < 0.65 ? Math.random() : 0.9, brake: st > 0.55 && st < 0.62 });
          if (st > 0.65) this._once('qc_open', () => { v.setAllHinges(1); audio.doorOpen(); });
          if (st > 0.8) this._once('qc_close', () => { v.setAllHinges(0); setTimeout(() => audio.doorShut(), 400); });
          if (st > 0.86) this._once('exit_open', () => (f.exitDoor.target = 1));
          break;
        }
      }
      if (this.stageT >= 1) {
        this.stageT = 0;
        this.stage++;
        audio.ding();
        this.game.events.emit('stationDone', { stage: this.stage });
      }
    } else {
      // roll-out through the exit door to the apron, then hand over a real physics vehicle
      this.rollout += dt / 4.5;
      const k = Math.min(1, this.rollout);
      const x0 = SX[4], x1 = LAYOUT.exitApron[0];
      const x = THREE.MathUtils.lerp(x0, x1, smooth(0, 1, k));
      const y = x < 56 ? f.carrier.position.y + 0.18 : THREE.MathUtils.lerp(0.63, 0, Math.min(1, (x - 56) / 3));
      v.root.position.set(x, y, lz);
      v.wheelNodes.forEach((w) => (w.axle.rotation.x += dt * 6));
      if (k >= 1) this._finish();
    }
    if (this.visual) v.update(dt, vs);
  }

  _engineProp() {
    const eng = ENGINES.find((e) => e.id === this.cfg.engine) || ENGINES[0];
    const p = this.game.assets.part('parts', eng.part);
    p.scale.setScalar(0.9);
    const hook = this.f.crane.getObjectByName('HookPoint');
    p.position.set(0, -0.4, 0);
    hook.add(p);
    this.engineProp = p;
  }

  _finish() {
    this.running = false;
    if (this.engineProp) { this.engineProp.parent.remove(this.engineProp); this.engineProp = null; }
    this.f.exitDoor.target = 0;
    const v = this.visual;
    this.visual = null;
    v.setAllHinges(0);
    const veh = new Vehicle(this.game, v, { kind: 'player', position: new THREE.Vector3(...LAYOUT.exitApron), heading: Math.PI / 2 });
    veh.owned = true;
    this.log.push({ t: performance.now(), ev: 'complete' });
    this.game.events.emit('orderComplete', { vehicle: veh, number: this.number });
    this.camMode = null;
  }

  // ------------------------------------------------------------------ cameras
  cycleStationCam() {
    if (this.camMode !== 'station') { this.camMode = 'station'; this.camStation = Math.max(0, Math.min(4, this.stage)); }
    else if (++this.camStation > 4) this.camMode = null;
    return this.camMode ? this.f.stationCams[this.camStation].name : null;
  }

  toggleFollow() { this.camMode = this.camMode === 'follow' ? null : 'follow'; }

  cameraPose() {
    if (!this.camMode) return null;
    if (this.camMode === 'station') {
      const c = this.f.stationCams[this.camStation];
      return { pos: c.pos, look: c.look };
    }
    const target = this.visual ? this.visual.root.position : this.f.carrier.position;
    const t = performance.now() / 1000;
    return { pos: target.clone().add(new THREE.Vector3(Math.sin(t * 0.25) * 6, 3.4, 6.5)), look: target.clone().add(new THREE.Vector3(0, 0.8, 0)) };
  }
}
