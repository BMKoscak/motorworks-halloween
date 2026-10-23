import * as THREE from 'three';
import { LAYOUT, PLANT, pl } from '../config.js';
import { cobwebTexture } from './atmosphere.js';

const STATION_NAMES = ['Stamping', 'Body Shop', 'Paint & Livery', 'Powertrain Marriage', 'Final Assembly & QC'];
export { STATION_NAMES };

/** Motorworks plant: shell, lobby, kiosk turntable, assembly-line machinery, doors and custom bay. */
export class Factory {
  constructor(game) {
    this.game = game;
    const { scene, assets, physics } = game;
    this.t = 0;
    // ---------------------------------------------------------------- shell
    const plant = assets.clone('plant');
    plant.position.set(PLANT.x, 0, PLANT.z);
    scene.add(plant);
    plant.updateMatrixWorld(true);
    physics.collidersFrom(plant, { tag: 'plant' });
    this.spider = plant.getObjectByName('GiantSpider');
    scene.attach(this.spider);
    this.spiderBase = this.spider.position.y;
    plant.traverse((o) => {
      if (o.isMesh && o.material.name === 'Lamp_Ceiling') {
        const p = new THREE.Vector3(); o.getWorldPosition(p);
        game.lights.add(p.setY(9.5), '#fff1dc', 30, false, 34);
      }
    });
    game.batcher.add(plant);
    scene.remove(plant);
    this.neonMat = assets.models.plant.getObjectByName('Sign_Neon').material;
    // ---------------------------------------------------------------- doors
    this.lobbyDoors = assets.clone('sliding_door');
    this.lobbyDoors.position.set(...LAYOUT.lobbyDoor);
    this.lobbyDoors.position.z += 0.05;
    scene.add(this.lobbyDoors);
    this.lobbyPanels = ['Panel_L', 'Panel_R'].map((n) => this.lobbyDoors.getObjectByName(n));
    this.lobbyCol = physics.addStaticBox(new THREE.Vector3(LAYOUT.lobbyDoor[0], 1.7, LAYOUT.lobbyDoor[2]), { x: 3, y: 1.7, z: 0.15 });
    this.lobbyOpen = 0;
    this.exitDoor = this._garage(new THREE.Vector3(...LAYOUT.exitDoor), Math.PI / 2);
    this.bayDoor = this._garage(new THREE.Vector3(...LAYOUT.bayDoor).add(new THREE.Vector3(0, 0, 0.2)), 0);
    // ---------------------------------------------------------------- lobby
    const turn = assets.part('props', 'Turntable');
    turn.position.set(...LAYOUT.kioskTurntable);
    scene.add(turn);
    this.turntableTop = turn.getObjectByName('Turntable_Top');
    this.turntable = turn;
    // showroom key light over the configurator turntable
    const spot = new THREE.SpotLight('#fff0dc', 90, 20, 0.62, 0.55, 1.2);
    spot.position.set(turn.position.x + 2, 8, turn.position.z + 3);
    spot.target.position.copy(turn.position);
    scene.add(spot, spot.target);
    const kiosk = assets.part('props', 'Kiosk');
    kiosk.position.set(...LAYOUT.kioskTerminal);
    kiosk.rotation.y = -0.5;
    scene.add(kiosk);
    physics.collidersFrom(kiosk);
    this.kioskPos = kiosk.position.clone();
    for (const [x, z, r] of [[-56, 22, 0.3], [-36, 22, -0.4], [-58, 10.5, 2.5]]) {
      const p = assets.part('props', 'Pumpkin_Lantern');
      p.position.set(...pl(x, z)); p.rotation.y = r; scene.add(p);
    }
    const web = new THREE.MeshBasicMaterial({ map: cobwebTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide });
    for (const [x, y, z, ry] of [[-59.6, 3.6, 24.6, Math.PI / 2], [-32.4, 3.6, 24.6, -Math.PI / 2], [59.6, 10, -24.6, -Math.PI / 2], [-59.6, 10, -24.6, Math.PI / 2], [27.6, 6, 24.6, -Math.PI / 2]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), web);
      m.position.set(...pl(x, z, y)); m.rotation.y = ry; scene.add(m);
    }
    // ---------------------------------------------------------------- conveyor
    const lz = LAYOUT.lineZ;
    const c = document.createElement('canvas'); c.width = 64; c.height = 16;
    const g = c.getContext('2d'); g.fillStyle = '#26262b'; g.fillRect(0, 0, 64, 16); g.fillStyle = '#4a4a52';
    for (let i = 0; i < 64; i += 8) g.fillRect(i, 0, 4, 16);
    this.beltTex = new THREE.CanvasTexture(c);
    this.beltTex.wrapS = THREE.RepeatWrapping; this.beltTex.repeat.set(90, 1);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(90, 0.45, 3.4), [
      new THREE.MeshStandardMaterial({ color: '#333' }), new THREE.MeshStandardMaterial({ color: '#333' }),
      new THREE.MeshStandardMaterial({ map: this.beltTex, metalness: 0.6, roughness: 0.5 }), new THREE.MeshStandardMaterial({ color: '#333' }),
      new THREE.MeshStandardMaterial({ color: '#f2b705' }), new THREE.MeshStandardMaterial({ color: '#f2b705' })]);
    belt.position.set(12, 0.225, lz);
    belt.receiveShadow = true;
    scene.add(belt);
    physics.addStaticBox(belt.position, { x: 45, y: 0.225, z: 1.7 });
    this.carrier = new THREE.Group();
    const skid = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.18, 2.6), new THREE.MeshStandardMaterial({ color: '#e0a000', metalness: 0.5, roughness: 0.5 }));
    skid.position.y = 0.09;
    this.carrier.add(skid);
    this.frameRails = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.12, 1.3), new THREE.MeshStandardMaterial({ color: '#5a5f66', metalness: 0.8, roughness: 0.4 }));
    this.frameRails.position.y = 0.36;
    this.carrier.add(this.frameRails);
    this.carrier.position.set(LAYOUT.lineStartX, 0.45, lz);
    scene.add(this.carrier);
    // ---------------------------------------------------------------- stations
    const SX = LAYOUT.stationsX;
    this.press = assets.clone('press');
    this.press.position.set(SX[0], 0, lz - 7.8);
    scene.add(this.press);
    physics.collidersFrom(this.press);
    this.ram = this.press.getObjectByName('Ram');
    this.ramBase = this.ram.position.y;
    this.sheet = this.press.getObjectByName('Sheet');
    this.sheet.material = this.sheet.material.clone();
    this.panelStack = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 1.3), new THREE.MeshStandardMaterial({ color: '#9aa0a8', metalness: 0.8, roughness: 0.35, emissive: '#ff5a10', emissiveIntensity: 0 }));
      p.position.y = 0.2 + i * 0.07;
      p.visible = false;
      this.panelStack.add(p);
    }
    this.panelStack.position.set(SX[0] + 5, 0, lz - 4.6);
    scene.add(this.panelStack);
    this.robots = [];
    const robot = (x, z, tool, station) => {
      const r = assets.clone('robot_arm');
      r.position.set(x, 0.0, z);
      r.rotation.y = z > lz ? Math.PI : 0;
      for (const tn of ['Tool_Welder', 'Tool_Spray', 'Tool_Gripper']) r.getObjectByName(tn).visible = tn === tool;
      scene.add(r);
      const j = { base: r.getObjectByName('Base'), sh: r.getObjectByName('Shoulder'), el: r.getObjectByName('Elbow'), wr: r.getObjectByName('Wrist'),
        tip: r.getObjectByName(tool.replace('Tool_', 'Tip_')) };
      const rb = { node: r, j, tool, station, ph: Math.random() * 6, x, z };
      this.robots.push(rb);
      game.physics.addStaticBox(new THREE.Vector3(x, 0.6, z), { x: 0.55, y: 0.6, z: 0.55 });
      return rb;
    };
    for (const dx of [-2.6, 2.6]) for (const dz of [-4.3, 4.3]) robot(SX[1] + dx, lz + dz, 'Tool_Welder', 1);
    for (const dx of [-1.8, 1.8]) for (const dz of [-4.3, 4.3]) robot(SX[2] + dx, lz + dz, 'Tool_Spray', 2);
    robot(SX[3] - 3.2, lz - 4.3, 'Tool_Gripper', 3);
    // paint booth enclosure
    const booth = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: '#d8dde2', metalness: 0.4, roughness: 0.4 });
    for (const dx of [-5, 5]) for (const dz of [-5.6, 5.6]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 0.3), steel); p.position.set(dx, 3, dz); booth.add(p); }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.3, 11.5), steel); roof.position.y = 6; booth.add(roof);
    const lights = new THREE.Mesh(new THREE.BoxGeometry(9, 0.1, 1), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#e8f0ff', emissiveIntensity: 3 }));
    lights.position.y = 5.8; booth.add(lights);
    const curtain = new THREE.MeshStandardMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
    for (const dz of [-5.6, 5.6]) { const cu = new THREE.Mesh(new THREE.PlaneGeometry(10, 5.6), curtain); cu.position.set(0, 2.9, dz); booth.add(cu); }
    booth.position.set(SX[2], 0, lz);
    scene.add(booth);
    game.lights.add(new THREE.Vector3(SX[2], 5, lz), '#e8f0ff', 26, false, 16);
    this.crane = assets.clone('crane');
    this.crane.position.set(SX[3], 0, lz);
    scene.add(this.crane);
    this.hoist = this.crane.getObjectByName('Hoist');
    this.hoistBase = this.hoist.position.y;
    this.trolley = this.crane.getObjectByName('Trolley');
    this.lift = assets.clone('lift');
    this.lift.position.set(SX[3], 0.0, lz);
    this.lift.rotation.y = Math.PI / 2;
    scene.add(this.lift);
    this.liftPlat = this.lift.getObjectByName('Platform');
    this.liftBase = this.liftPlat.position.y;
    this.scanner = assets.clone('scanner');
    this.scanner.position.set(SX[4], 0, lz);
    this.scanner.rotation.y = Math.PI / 2;
    scene.add(this.scanner);
    physics.addStaticBox(new THREE.Vector3(SX[4], 2.1, lz + 2.6), { x: 0.25, y: 2.1, z: 0.25 });
    physics.addStaticBox(new THREE.Vector3(SX[4], 2.1, lz - 2.6), { x: 0.25, y: 2.1, z: 0.25 });
    this.laser = this.scanner.getObjectByName('Laser_Bar');
    this.laserBase = this.laser.position.y;
    this.laserPlane = new THREE.Mesh(new THREE.PlaneGeometry(5, 5.5), new THREE.MeshBasicMaterial({ color: '#ff2020', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    this.laserPlane.rotation.x = -Math.PI / 2;
    this.laserPlane.visible = false;
    scene.add(this.laserPlane);
    // info panels along the walkway
    this.infoPanels = SX.map((x, i) => {
      const p = assets.part('props', 'InfoPanel');
      p.position.set(x - 3, 0, lz + 6.2);
      scene.add(p);
      return { pos: p.position.clone(), station: i };
    });
    // forklift loop on the south aisle
    this.forklift = assets.clone('forklift');
    this.forklift.position.set(-20, 0, lz - 12);
    scene.add(this.forklift);
    this.forks = this.forklift.getObjectByName('Forks');
    this.forkBody = physics.addStaticBox(this.forklift.position, { x: 0.65, y: 1.15, z: 1.5 }, null, { kinematic: true });
    this.forkPath = [[-26, lz - 12], [52, lz - 12], [52, lz - 15.5], [-26, lz - 15.5]].map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.forkT = 0;
    // overhead decorative crane girders
    this.stationCams = SX.map((x, i) => ({ pos: new THREE.Vector3(x + 7, 6.5, lz + 9), look: new THREE.Vector3(x, 1.2, lz), name: STATION_NAMES[i] }));
    // custom bay paint robot
    this.bayRobot = robot(46, -70.5, 'Tool_Spray', 9);
    this.bayRobot.node.rotation.y = Math.PI;
    this.active = -1;
  }

  _garage(pos, rot) {
    const d = this.game.assets.clone('garage_door');
    d.position.copy(pos);
    d.rotation.y = rot;
    this.game.scene.add(d);
    const cols = this.game.physics.collidersFrom(d);
    const slats = [];
    d.traverse((o) => { if (o.userData.joint === 'roll') slats.push(o); });
    slats.forEach((s) => (s.userData.baseY = s.position.y));
    return { node: d, slats, cols, t: 0, target: 0, rattle: 0 };
  }

  _animGarage(g, dt) {
    const prev = g.t;
    g.t += THREE.MathUtils.clamp(g.target - g.t, -dt * 0.45, dt * 0.45);
    if (Math.abs(g.t - prev) > 1e-4 && performance.now() - g.rattle > 2500) { g.rattle = performance.now(); this.game.audio.rattle(2.2); }
    const lift = g.t * 6.4;
    for (const s of g.slats) {
      s.position.y = s.userData.baseY + lift;
      s.visible = s.position.y < 6.1;
      s.rotation.x = s.position.y > 5.4 ? -(s.position.y - 5.4) * 1.5 : 0;
    }
    for (const c of g.cols) c.collisionResponse = g.t < 0.75;
  }

  /** a: assembly line state ({stage, stageT, running}) */
  update(dt, a) {
    this.t += dt;
    const t = this.t, fx = this.game.effects, audio = this.game.audio;
    this.beltTex.offset.x -= dt * (a && a.running ? 0.6 : 0.1);
    this.spider.position.y = this.spiderBase + Math.sin(t * 0.6) * 1.2 - 0.6;
    const flick = Math.sin(t * 17) * Math.sin(t * 3.1) > 0.93;
    this.neonMat.emissiveIntensity = flick ? 1.5 : 7 + Math.sin(t * 40) * 0.4;
    // lobby sliding doors open for anyone nearby
    const pp = this.game.focusPos;
    const near = Math.hypot(pp.x - LAYOUT.lobbyDoor[0], pp.z - LAYOUT.lobbyDoor[2]) < 6;
    this.lobbyOpen += THREE.MathUtils.clamp((near ? 1 : 0) - this.lobbyOpen, -dt * 2, dt * 2);
    this.lobbyPanels.forEach((p) => (p.position.x = p.userData.travel * this.lobbyOpen));
    this.lobbyCol.collisionResponse = this.lobbyOpen < 0.7;
    // bay door opens for an approaching car
    const car = this.game.player.vehicle;
    const bayNear = car && Math.hypot(car.position.x - LAYOUT.bayDoor[0], car.position.z - LAYOUT.bayDoor[2]) < 16;
    const inBay = this.game.inBayZone(pp);
    this.bayDoor.target = bayNear || inBay ? 1 : 0;
    this._animGarage(this.bayDoor, dt);
    this._animGarage(this.exitDoor, dt);
    this.turntableTop.rotation.y += dt * 0.35;
    const stage = a && a.running ? a.stage : -1, st = a ? a.stageT : 0;
    // S1 press
    const pressActive = stage === 0 && st > 0.15 && st < 0.9;
    const cyc = pressActive ? (t * 0.9) % 1 : (t * 0.18) % 1;
    const down = cyc < 0.15 ? cyc / 0.15 : cyc < 0.3 ? 1 : cyc < 0.7 ? 1 - (cyc - 0.3) / 0.4 : 0;
    this.ram.position.y = this.ramBase + this.ram.userData.travel * down * (pressActive ? 1 : 0.4);
    if (pressActive) {
      this.sheet.visible = cyc > 0.7 || cyc < 0.15;
      this.sheet.material.emissiveIntensity = 3 + Math.sin(t * 20) * 0.5;
      if (this._lastCyc !== undefined && this._lastCyc < 0.15 && cyc >= 0.15) {
        const p = new THREE.Vector3(); this.sheet.getWorldPosition(p);
        fx.sparks(p.add(new THREE.Vector3(0, 0.3, 0)), 40, '#ffb347', 7);
        audio.stamp();
        if (this.game.distToFocus(p) < 30) fx.shake = Math.max(fx.shake, 0.7);
        const n = this.panelStack.children.filter((c) => c.visible).length;
        if (n < 6) { const pn = this.panelStack.children[n]; pn.visible = true; pn.material.emissiveIntensity = 2; }
      }
    } else this.sheet.visible = false;
    this.panelStack.children.forEach((p) => (p.material.emissiveIntensity = Math.max(0, p.material.emissiveIntensity - dt * 0.4)));
    if (stage === 1 && st < 0.05) this.panelStack.children.forEach((p) => (p.visible = false));
    this._lastCyc = cyc;
    // robots
    for (const r of this.robots) {
      const active = (r.station === stage && st > 0.15 && st < 0.92) || (r.station === 9 && this.game.bayBusy);
      const k = active ? 1 : 0.25;
      const ph = t * (active ? 1.6 : 0.4) + r.ph;
      r.j.base.rotation.y = Math.sin(ph * 0.5) * 0.45 * k;
      r.j.sh.rotation.x = -0.35 - (active ? 0.25 : 0) + Math.sin(ph) * 0.18 * k;
      r.j.el.rotation.x = 0.55 + Math.sin(ph * 1.3 + 1) * 0.3 * k;
      r.j.wr.rotation.x = 0.5 + Math.sin(ph * 2) * 0.4 * k;
      if (active && r.j.tip) {
        const p = new THREE.Vector3(); r.j.tip.getWorldPosition(p);
        if (r.tool === 'Tool_Welder' && Math.random() < dt * 14) { fx.sparks(p, 8, Math.random() < 0.5 ? '#9fd8ff' : '#ffd27a', 3); if (Math.random() < 0.3) audio.weld(); }
        if (r.tool === 'Tool_Spray' && Math.random() < dt * 30) {
          const dir = new THREE.Vector3(0, -0.3, 1).applyQuaternion(r.j.tip.getWorldQuaternion(new THREE.Quaternion())).normalize();
          fx.mist(p, dir, r.station === 9 ? (this.game.bayColor || '#ff6a00') : (a.cfg ? a.cfg.color : '#ff6a00'), 2);
          if (Math.random() < 0.1) audio.spray(0.3);
        }
      }
    }
    // S4 crane + lift
    const s4 = stage === 3 ? st : stage > 3 ? 1 : 0;
    const lower = s4 < 0.15 ? 0 : s4 < 0.55 ? (s4 - 0.15) / 0.4 : s4 < 0.7 ? 1 : Math.max(0, 1 - (s4 - 0.7) / 0.2);
    this.hoist.position.y = this.hoistBase - 6.1 * Math.min(1, lower);
    this.liftPlat.position.y = this.liftBase + this.liftPlat.userData.travel * (stage === 3 && st > 0.1 && st < 0.9 ? 1 : 0);
    // S5 scanner sweep
    const scanning = stage === 4 && st > 0.12 && st < 0.5;
    this.laser.position.y = this.laserBase + (scanning ? Math.sin(t * 2.4) * 1.6 : 0);
    this.laserPlane.visible = scanning;
    if (scanning) { const p = new THREE.Vector3(); this.laser.getWorldPosition(p); this.laserPlane.position.copy(p); }
    // forklift shuttles along its loop
    this.forkT = (this.forkT + dt * 3.2) % this._loopLen();
    const { p, dir } = this._loopAt(this.forkT);
    this.forklift.position.copy(p);
    this.forklift.rotation.y = Math.atan2(dir.x, dir.z);
    this.forkBody.position.set(p.x, 1.15, p.z);
    this.forkBody.quaternion.setFromEuler(0, this.forklift.rotation.y, 0);
    this.forks.position.y = 0.25 + (Math.sin(t * 0.5) > 0.6 ? 0.8 : 0);
    if (this.forkDriver) { this.forkDriver.root.position.copy(p).add(new THREE.Vector3(0, 0.95, 0).add(new THREE.Vector3(-0.1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.forklift.rotation.y))); this.forkDriver.root.rotation.y = this.forklift.rotation.y; }
  }

  _loopLen() { if (!this._len) { this._len = 0; for (let i = 0; i < 4; i++) this._len += this.forkPath[i].distanceTo(this.forkPath[(i + 1) % 4]); } return this._len; }
  _loopAt(d) {
    for (let i = 0; i < 4; i++) {
      const a = this.forkPath[i], b = this.forkPath[(i + 1) % 4], L = a.distanceTo(b);
      if (d <= L) return { p: a.clone().lerp(b, d / L), dir: b.clone().sub(a).normalize() };
      d -= L;
    }
    return { p: this.forkPath[0].clone(), dir: new THREE.Vector3(1, 0, 0) };
  }
}
