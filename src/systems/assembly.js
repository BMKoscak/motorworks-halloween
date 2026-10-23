import * as THREE from 'three';
import { LAYOUT, BODIES, ENGINES } from '../config.js';
import { CarVisual } from '../vehicle/carVisual.js';
import { Vehicle } from '../vehicle/vehicle.js';
import { STATION_NAMES } from '../world/factory.js';

const STAGE_TIME = 16;
const smooth = (a, b, t) => THREE.MathUtils.smoothstep(t, a, b);
const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

/**
 * Order -> 5 stations -> roll-out. Drives the car's build stage and the physical part-transfer choreography:
 * stamped blanks at S1, robots that grip each door/hood/trunk off a feeder rack, carry it to its hinge mount, attach,
 * weld and swing it shut at S2, the crane trolley that fetches the engine from the staging bay at S4 while loader
 * arms push the wheels from the tyre racks onto the hubs.
 */
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
    this.carries = [];
  }

  get total() { return this.running ? Math.min(1, (this.stage + this.stageT) / 5) : 0; }

  start(cfg) {
    if (this.visual) { this.visual.dispose(); this.visual = null; }
    this._clearJobs();
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
    this.f.panelStack.children.forEach((p, i) => i && (p.visible = false));
    this.log = [{ t: performance.now(), ev: 'order', number: this.number }];
    this.game.events.emit('orderStarted', { number: this.number, cfg });
  }

  _once(key, fn) { if (!this.done[key]) { this.done[key] = true; fn(); this.log.push({ t: performance.now(), ev: key }); } }

  hudState() {
    if (!this.running) return null;
    const body = BODIES.find((b) => b.id === this.cfg.body);
    return { number: this.number, label: body ? body.name : '', stations: STATION_NAMES, stage: Math.min(this.stage, 5), stageT: this.stageT, total: this.total };
  }

  // ------------------------------------------------------------------ S2 body shop: pick & place jobs
  _planBodyShop() {
    const v = this.visual, f = this.f;
    const R = f.bodyRobots; // [(-x,-z), (-x,+z), (+x,-z), (+x,+z)]
    const has = (n) => !!v.hinges[n];
    const plan = [
      { robot: R[0], parts: ['Door_L', 'DoorRear_L'].filter(has) },
      { robot: R[1], parts: ['Door_R', 'DoorRear_R', 'Trunk'].filter(has) },
      { robot: R[2], parts: ['Hood'].filter(has) },
      { robot: R[3], parts: [] },
    ];
    this.carries = [];
    v.root.updateMatrixWorld(true);
    for (const { robot, parts } of plan) {
      const rack = f.partRacks.find((r) => r.robot === robot);
      parts.forEach((name, i) => {
        const n = parts.length;
        const w0 = 0.16 + (i / n) * 0.7, w1 = 0.16 + ((i + 1) / n) * 0.7;
        const node = v.hinges[name].node;
        node.updateMatrixWorld(true);
        // clone the actual hinge part (with handles/mirrors) as the carried piece
        const clone = node.clone(true);
        clone.position.set(0, 0, 0); clone.quaternion.identity(); clone.scale.set(1, 1, 1);
        clone.updateMatrixWorld(true);
        const center = new THREE.Box3().setFromObject(clone).getCenter(new THREE.Vector3());
        const mountQ = node.getWorldQuaternion(new THREE.Quaternion());
        const mountP = node.getWorldPosition(new THREE.Vector3());
        clone.visible = false;
        this.game.scene.add(clone);
        node.visible = false;
        this.carries.push({ name, robot, rack, node, clone, center, mountQ, mountP, w0, w1, phase: 'wait' });
      });
      robot.seam = parts.length === 0;
    }
  }

  _clearJobs() {
    for (const c of this.carries) { c.clone.parent && c.clone.parent.remove(c.clone); c.node.visible = true; }
    this.carries = [];
  }

  /** Pose of the carried part so that its centre sits at `pc` with rotation `q`. */
  _placeClone(c, pc, q) {
    const off = c.center.clone().applyQuaternion(q);
    c.clone.position.copy(pc).sub(off);
    c.clone.quaternion.copy(q);
  }

  _bodyShop(st) {
    const f = this.f, fx = this.game.effects, audio = this.game.audio;
    for (const c of this.carries) {
      const u = (st - c.w0) / (c.w1 - c.w0);
      if (u < 0 || u > 1.05) continue;
      const rackP = c.rack.top.clone().add(new THREE.Vector3(0, 0.45, 0));
      const mountC = c.center.clone().applyQuaternion(c.mountQ).add(c.mountP);
      const rb = c.robot;
      const toward = (p) => p.clone().add(new THREE.Vector3(rb.x, p.y, rb.z).sub(p).setY(0).normalize().multiplyScalar(0.18));
      if (u < 0.22) {
        if (c.phase === 'wait') { c.phase = 'reach'; f.setTool(rb, 'Tool_Gripper'); this._once('pick_' + c.name, () => {}); }
        c.clone.visible = true;
        this._placeClone(c, rackP, c.mountQ);
        f.drive(rb, toward(rackP));
      } else if (u < 0.28) {
        if (c.phase !== 'grip') { c.phase = 'grip'; audio.clunk(); }
        this._placeClone(c, rackP, c.mountQ);
        f.drive(rb, toward(rackP));
      } else if (u < 0.68) {
        if (c.phase !== 'carry') { c.phase = 'carry'; audio.hydraulic(); }
        const k = smooth(0.28, 0.68, u);
        const p = rackP.clone().lerp(mountC, k);
        p.y += Math.sin(k * Math.PI) * 0.7;
        this._placeClone(c, p, c.mountQ);
        f.drive(rb, toward(p));
        if (k > 0.25) c.maxGap = Math.max(c.maxGap || 0, f.tipWorld(rb).distanceTo(toward(p))); // after the arm has caught the part
      } else {
        if (c.phase !== 'attached') {
          c.phase = 'attached';
          c.clone.visible = false;
          c.node.visible = true;
          f.stats.partsCarried++;
          this._once('attach_' + c.name, () => audio.clunk());
          f.setTool(rb, 'Tool_Welder');
        }
        if (u < 0.86) {
          const weld = c.mountP.clone().add(new THREE.Vector3(0, 0.1, 0));
          f.drive(rb, toward(weld));
          if (Math.random() < 0.25) { fx.sparks(f.tipWorld(rb), 8, Math.random() < 0.5 ? '#9fd8ff' : '#ffd27a', 3); if (Math.random() < 0.3) audio.weld(); }
        }
        if (u >= 0.86) this._once('close_' + c.name, () => { this.visual.setHinge(c.name, 0); setTimeout(() => audio.doorShut(), 350); });
      }
    }
    // the fourth robot seam-welds the roof line the whole time
    for (const rb of f.bodyRobots) {
      if (!rb.seam || st < 0.18 || st > 0.9) continue;
      const v = this.visual.root.position;
      const p = new THREE.Vector3(v.x + Math.sin(st * 30) * 1.4, v.y + 1.35, v.z);
      f.drive(rb, p);
      if (Math.random() < 0.3) fx.sparks(f.tipWorld(rb), 6, '#9fd8ff', 3);
    }
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
      const st = Math.min(1, this.stageT);
      switch (this.stage) {
        case 0:
          break;
        case 1:
          this._once('s1_body', () => { v.setBuildStage(1); v.setAllHinges(1); for (const k in v.hinges) v.hinges[k].t = 1; audio.hydraulic(); });
          if (st > 0.15) this._once('s1_plan', () => this._planBodyShop());
          this._bodyShop(st);
          break;
        case 2:
          this._once('s2_paint', () => { this._clearJobs(); v.setBuildStage(1); for (const k in v.hinges) if (v.hinges[k].t > 0.5) v.setHinge(k, 0); });
          v.setReveal(smooth(0.15, 0.85, st));
          break;
        case 3: {
          this._once('s3_open', () => { v.setBuildStage(2); v.setHinge('Hood', 1); this._engineProp(); });
          // engine waits on the staging stand, is picked up by the hook, travels and drops into the bay
          if (this.engineProp) {
            const onStand = st < 0.18;
            if (onStand) { this.engineProp.parent !== this.game.scene && this.game.scene.attach(this.engineProp); this.engineProp.position.copy(f.stageTop).add(new THREE.Vector3(0, 0.05, 0)); }
            else if (this.engineProp.parent === this.game.scene) { f.hookPoint.attach(this.engineProp); this.engineProp.position.set(0, -0.55, 0); this.engineProp.rotation.set(0, Math.PI / 2, 0); this._once('engine_pick', () => audio.clunk()); }
            this.engineProp.visible = st < 0.55;
          }
          if (st > 0.55) this._once('engine_in', () => { audio.clunk(); this.game.effects.sparks(v.root.position.clone().add(new THREE.Vector3(1.4, 1.0, 0)), 16, '#9fd8ff', 3); });
          vs.showEngine = st > 0.55 && st < 0.92;
          // loader arms push each wheel from its tyre rack onto the hub
          v.root.updateMatrixWorld(true);
          v.wheelNodes.forEach((w, i) => {
            const t0 = 0.58 + i * 0.06;
            if (!w.rim) return;
            const k = smooth(t0, t0 + 0.08, st);
            w.rim.visible = w.caliper.visible = st > t0 - 0.04;
            const side = w.name[1] === 'L' ? 1 : -1;
            w.rim.position.x = side * 2.6 * (1 - k);
            const hub = w.knuckle.getWorldPosition(new THREE.Vector3());
            const out = new THREE.Vector3(side, 0, 0).transformDirection(v.root.matrixWorld);
            const L = f.loaders.find((l) => l.side === Math.sign(hub.z - lz) && l.ax === Math.sign(hub.x - SX[3]));
            if (L && st > t0 - 0.04 && st < t0 + 0.14) {
              const wheelAt = hub.clone().addScaledVector(out, 2.6 * (1 - k) + 0.45);
              L.arm.position.lerp(new THREE.Vector3(wheelAt.x, 0, wheelAt.z + L.side * 0.65), 0.35);
            } else if (L) L.arm.position.lerp(L.home, 0.08);
            if (k >= 1) this._once('wheel_' + i, () => audio.clunk());
          });
          if (st > 0.9) this._once('s3_close', () => v.setHinge('Hood', 0));
          break;
        }
        case 4: {
          this._once('s4_final', () => { v.setBuildStage(4); v.wheelNodes.forEach((w) => w.rim && (w.rim.position.x = 0)); f.loaders.forEach((l) => l.arm.position.copy(l.home)); });
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
    p.position.copy(this.f.stageTop);
    this.game.scene.add(p);
    this.engineProp = p;
  }

  _finish() {
    this.running = false;
    this._clearJobs();
    if (this.engineProp) { this.engineProp.parent && this.engineProp.parent.remove(this.engineProp); this.engineProp = null; }
    this.f.exitDoor.target = 0;
    const v = this.visual;
    this.visual = null;
    v.setAllHinges(0);
    const veh = new Vehicle(this.game, v, { kind: 'player', position: new THREE.Vector3(...LAYOUT.exitApron), heading: Math.PI / 2 });
    veh.owned = true;
    this.log.push({ t: performance.now(), ev: 'complete' });
    if (this.f.showroomSpot) this.f.setShowroomCar(this.cfg);
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
