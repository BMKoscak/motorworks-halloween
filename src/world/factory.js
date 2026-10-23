import * as THREE from 'three';
import { LAYOUT, PLANT, pl, DEFAULT_CONFIG } from '../config.js';
import { cobwebTexture } from './atmosphere.js';
import { CarVisual } from '../vehicle/carVisual.js';
import { seatDriver } from '../systems/traffic.js';

const STATION_NAMES = ['Stamping', 'Body Shop', 'Paint & Livery', 'Powertrain Marriage', 'Final Assembly & QC'];
export { STATION_NAMES };

// robot arm geometry (blender/build_world.py build_robot_arm): shoulder pivot height, upper arm, forearm-to-gripper-tip
const SH_Y = 0.95, L1 = 1.5, L2 = 1.85;

/** Bent steel panel (door / hood skin) produced by the press. */
function stampedGeometry(curve) {
  const g = new THREE.BoxGeometry(2.0, 0.05, 1.2, 12, 1, 6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, p.getY(i) - curve * (x * x * 0.12 + z * z * 0.25)); }
  g.computeVertexNormals();
  return g;
}

/** Motorworks plant: shell, lobby, kiosk turntable, assembly-line machinery, doors, custom bay, office/catwalk, showroom. */
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
    const cols = physics.collidersFrom(plant, { tag: 'plant' });
    this.spider = plant.getObjectByName('GiantSpider');
    scene.attach(this.spider);
    this.spiderBase = this.spider.position.y;
    this.floods = [];
    plant.traverse((o) => {
      if (o.isMesh && o.material.name === 'Lamp_Ceiling') {
        this.ceilMat = o.material;
        const p = new THREE.Vector3(); o.getWorldPosition(p);
        this.floods.push(game.lights.add(p.setY(9.5), '#fff1dc', 30, false, 34));
      }
      if (o.isMesh && o.material.name === 'FX_LightShaft') o.material = this._shaftMaterial();
    });
    // office, catwalk, showroom: switches, glass, fixtures handled by the building kit
    this.building = game.buildings.process(plant, 'plant', { name: 'Motorworks', colliders: cols, lightI: 12, lightRange: 12 });
    this.showroomSpot = this.building.spots.Showroom;
    game.batcher.add(plant);
    scene.remove(plant);
    this.neonMat = assets.models.plant.getObjectByName('Sign_Neon').material;
    // emergency beacons for Night Shift mode (off by default)
    this.emergency = [[-40, -20], [0, -20], [40, -20], [-40, 20], [20, 20]].map(([x, z]) => {
      const s = game.lights.add(new THREE.Vector3(...pl(x, z, 9)), '#ff1a1a', 0, false, 30);
      game.lights.setOn(s, false);
      return s;
    });
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
    this._conveyor();
    this._stations();
    // info panels along the walkway
    const lz = LAYOUT.lineZ, SX = LAYOUT.stationsX;
    this.infoPanels = SX.map((x, i) => {
      const p = assets.part('props', 'InfoPanel');
      p.position.set(x - 3, 0, lz + 6.2);
      scene.add(p);
      return { pos: p.position.clone(), station: i };
    });
    // forklift loop on the south aisle (clear of the delivery showroom)
    this.forklift = assets.clone('forklift');
    this.forklift.position.set(-20, 0, lz - 12);
    scene.add(this.forklift);
    this.forks = this.forklift.getObjectByName('Forks');
    this.forkSeat = this.forklift.getObjectByName('Seat_Driver');
    this.forkBody = physics.addStaticBox(this.forklift.position, { x: 0.65, y: 1.15, z: 1.5 }, null, { kinematic: true });
    this.forkPath = [[-26, lz - 12], [38, lz - 12], [38, lz - 15.5], [-26, lz - 15.5]].map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.forkT = 0;
    this.stationCams = SX.map((x, i) => ({ pos: new THREE.Vector3(x + 7, 6.5, lz + 9), look: new THREE.Vector3(x, 1.2, lz), name: STATION_NAMES[i] }));
    // custom bay paint robot
    this.bayRobot = this._robot(46, -70.5, 'Tool_Spray', 9);
    this.bayRobot.node.rotation.y = Math.PI;
    // customer delivery showroom display car on the podium
    if (this.showroomSpot) this.setShowroomCar(DEFAULT_CONFIG);
    this.active = -1;
    this.stats = { ikSolves: 0, pressCycles: 0, partsCarried: 0 };
  }

  _shaftMaterial() {
    return (this.shaftMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uK: { value: 1 } },
      vertexShader: 'varying float vY; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: 'uniform float uK; varying float vY; void main(){ float a = smoothstep(0.0, 11.0, vY) * 0.055 * uK; gl_FragColor = vec4(0.85, 0.9, 1.0, a); }',
    }));
  }

  // ---------------------------------------------------------------- conveyor: floor track, chain rollers, articulated skillet
  _conveyor() {
    const { scene, physics } = this.game;
    const lz = LAYOUT.lineZ;
    const x0 = -38, x1 = 58;
    const steel = new THREE.MeshStandardMaterial({ color: '#4a4e55', metalness: 0.8, roughness: 0.4 });
    const pit = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.06, 3.0), new THREE.MeshStandardMaterial({ color: '#1c1c20', roughness: 0.9 }));
    pit.position.set((x0 + x1) / 2, 0.06, lz);
    pit.receiveShadow = true;
    scene.add(pit);
    for (const dz of [-1.15, 1.15]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.28, 0.22), steel);
      rail.position.set((x0 + x1) / 2, 0.2, lz + dz);
      rail.castShadow = rail.receiveShadow = true;
      scene.add(rail);
    }
    // chain strips with a scrolling link texture
    const c = document.createElement('canvas'); c.width = 64; c.height = 16;
    const g = c.getContext('2d'); g.fillStyle = '#202024'; g.fillRect(0, 0, 64, 16); g.fillStyle = '#6a6a72';
    for (let i = 0; i < 64; i += 8) { g.fillRect(i, 3, 6, 10); g.fillStyle = '#3a3a40'; g.fillRect(i + 6, 6, 2, 4); g.fillStyle = '#6a6a72'; }
    this.beltTex = new THREE.CanvasTexture(c);
    this.beltTex.wrapS = THREE.RepeatWrapping; this.beltTex.repeat.set(160, 1);
    for (const dz of [-0.75, 0.75]) {
      const chain = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 0.22), new THREE.MeshStandardMaterial({ map: this.beltTex, metalness: 0.7, roughness: 0.45 }));
      chain.rotation.x = -Math.PI / 2;
      chain.position.set((x0 + x1) / 2, 0.255, lz + dz);
      scene.add(chain);
    }
    // instanced chain rollers between the rails
    const n = Math.floor((x1 - x0) / 0.6);
    this.rollers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 2.1, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#9aa0a8', metalness: 0.9, roughness: 0.25 }), n);
    this.rollerPos = [];
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) { const p = new THREE.Vector3(x0 + 0.3 + i * 0.6, 0.18, lz); this.rollerPos.push(p); m.makeTranslation(p.x, p.y, p.z); this.rollers.setMatrixAt(i, m); }
    this.rollers.castShadow = true;
    scene.add(this.rollers);
    this.rollerSpin = 0;
    physics.addStaticBox(new THREE.Vector3((x0 + x1) / 2, 0.17, lz), { x: (x1 - x0) / 2, y: 0.17, z: 1.35 });
    // skillet carrier: deck, four lift posts with saddles under the sills, guide wheels riding the rails
    this.carrier = new THREE.Group();
    const yellow = new THREE.MeshStandardMaterial({ color: '#e0a000', metalness: 0.5, roughness: 0.5 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.16, 2.6), yellow);
    deck.position.y = 0.06;
    deck.castShadow = deck.receiveShadow = true;
    this.carrier.add(deck);
    const stripes = new THREE.Mesh(new THREE.BoxGeometry(5.82, 0.05, 0.25), new THREE.MeshStandardMaterial({ color: '#111' }));
    stripes.position.set(0, 0.1, 1.2); this.carrier.add(stripes);
    const s2 = stripes.clone(); s2.position.z = -1.2; this.carrier.add(s2);
    this.carrierPosts = [];
    for (const px of [-1.7, 1.7]) for (const pz of [-0.75, 0.75]) {
      const post = new THREE.Group();
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.14), steel); leg.position.y = 0.15; post.add(leg);
      const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 0.22), new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.9 })); saddle.position.y = 0.31; post.add(saddle);
      post.position.set(px, 0.14, pz);
      this.carrier.add(post);
      this.carrierPosts.push(post);
    }
    this.carrierWheels = [];
    for (const px of [-2.6, 2.6]) for (const pz of [-1.15, 1.15]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 12).rotateX(Math.PI / 2), steel);
      w.position.set(px, -0.05, pz);
      this.carrier.add(w);
      this.carrierWheels.push(w);
    }
    this.frameRails = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.12, 1.3), new THREE.MeshStandardMaterial({ color: '#5a5f66', metalness: 0.8, roughness: 0.4 }));
    this.frameRails.position.y = 0.36;
    this.carrier.add(this.frameRails);
    this.carrier.position.set(LAYOUT.lineStartX, 0.45, lz);
    scene.add(this.carrier);
    this._lastCarrierX = this.carrier.position.x;
  }

  _robot(x, z, tool, station, face = null) {
    const { assets, scene, physics } = this.game;
    const lz = LAYOUT.lineZ;
    const r = assets.clone('robot_arm');
    r.position.set(x, 0.0, z);
    r.rotation.y = face ?? (z > lz ? Math.PI : 0);
    const tools = {};
    for (const tn of ['Tool_Welder', 'Tool_Spray', 'Tool_Gripper']) { tools[tn] = r.getObjectByName(tn); tools[tn].visible = tn === tool; }
    scene.add(r);
    const j = { base: r.getObjectByName('Base'), sh: r.getObjectByName('Shoulder'), el: r.getObjectByName('Elbow'), wr: r.getObjectByName('Wrist'),
      tip: r.getObjectByName(tool.replace('Tool_', 'Tip_')), grip: r.getObjectByName('Tip_Gripper') };
    const rb = { node: r, j, tool, tools, station, ph: Math.random() * 6, x, z, target: null, blend: 0 };
    (this.robots ||= []).push(rb);
    physics.addStaticBox(new THREE.Vector3(x, 0.6, z), { x: 0.55, y: 0.6, z: 0.55 });
    return rb;
  }

  setTool(rb, tool) {
    for (const [k, n] of Object.entries(rb.tools)) n.visible = k === tool;
    rb.tool = tool;
    rb.j.tip = rb.node.getObjectByName(tool.replace('Tool_', 'Tip_'));
  }

  /**
   * Analytic IK for the 4-joint arm: base yaw + planar 2-link (shoulder, elbow) so the gripper tip reaches `target`.
   * Returns false if the target is out of reach (the arm then stretches toward it).
   */
  solveIK(rb, target) {
    const local = rb.node.worldToLocal(target.clone());
    const yaw = Math.atan2(local.x, local.z);
    const f = Math.hypot(local.x, local.z), u = local.y - SH_Y;
    let D = Math.hypot(f, u);
    const reach = D <= L1 + L2 - 0.01;
    D = THREE.MathUtils.clamp(D, Math.abs(L1 - L2) + 0.05, L1 + L2 - 0.01);
    const gamma = Math.atan2(f, u);
    const alpha = Math.acos(THREE.MathUtils.clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
    const a = gamma - alpha;
    const ef = L1 * Math.sin(a), eu = L1 * Math.cos(a);
    const tf = f / Math.hypot(f, u) * D, tu = u / Math.hypot(f, u) * D;
    const phi = Math.atan2(tf - ef, tu - eu);
    const b = phi - Math.PI / 2 - a;
    rb.ik = { yaw, a, b };
    this.stats.ikSolves++;
    return reach;
  }

  /** Blend a robot toward its IK pose (called by the assembly choreography every frame it controls the arm). */
  drive(rb, target, k = 1) { rb.target = target; rb.blend = k; }

  tipWorld(rb) { return (rb.j.grip || rb.j.tip).getWorldPosition(new THREE.Vector3()); }

  // ---------------------------------------------------------------- stations
  _stations() {
    const { scene, assets, physics } = this.game;
    const lz = LAYOUT.lineZ, SX = LAYOUT.stationsX;
    // S1: press + blank feeder + output rack of stamped panels
    this.press = assets.clone('press');
    this.press.position.set(SX[0], 0, lz - 7.8);
    scene.add(this.press);
    physics.collidersFrom(this.press);
    this.ram = this.press.getObjectByName('Ram');
    this.ramBase = this.ram.position.y;
    this.sheet = this.press.getObjectByName('Sheet');
    this.sheet.visible = false;
    const steelM = new THREE.MeshStandardMaterial({ color: '#9aa0a8', metalness: 0.8, roughness: 0.35, emissive: '#ff5a10', emissiveIntensity: 0 });
    this.flatGeo = stampedGeometry(0);
    this.curvedGeo = stampedGeometry(1);
    // blank stack (flat sheets) on a pallet at the press infeed, roller table into the press
    const feeder = new THREE.Group();
    const pallet = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 1.6), new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 0.9 }));
    pallet.position.y = 0.08; feeder.add(pallet);
    this.blanks = [];
    for (let i = 0; i < 8; i++) { const b = new THREE.Mesh(this.flatGeo, new THREE.MeshStandardMaterial({ color: '#8b8f96', metalness: 0.85, roughness: 0.35 })); b.position.y = 0.2 + i * 0.055; feeder.add(b); this.blanks.push(b); }
    feeder.position.set(SX[0] - 5.2, 0, lz - 7.8);
    scene.add(feeder);
    this.feeder = feeder;
    const table = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 1.4), new THREE.MeshStandardMaterial({ color: '#3a3d42', metalness: 0.6, roughness: 0.5 }));
    table.position.set(SX[0] - 3.0, 0.45, lz - 7.8); scene.add(table);
    physics.addStaticBox(table.position, { x: 1.6, y: 0.45, z: 0.7 });
    this.workSheet = new THREE.Mesh(this.flatGeo, steelM);
    this.workSheet.visible = false;
    scene.add(this.workSheet);
    this.panelStack = new THREE.Group();
    const rack = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 1.5), new THREE.MeshStandardMaterial({ color: '#2d5c8a', metalness: 0.4, roughness: 0.6 }));
    rack.position.y = 0.08; this.panelStack.add(rack);
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(this.curvedGeo, new THREE.MeshStandardMaterial({ color: '#9aa0a8', metalness: 0.8, roughness: 0.35, emissive: '#ff5a10', emissiveIntensity: 0 }));
      p.position.y = 0.3 + i * 0.09;
      p.visible = false;
      this.panelStack.add(p);
    }
    this.panelStack.position.set(SX[0] + 5, 0, lz - 4.6);
    scene.add(this.panelStack);
    this.pressCycle = { n: 0, phase: 0 };
    // S2 body-shop robots (closer to the line so every hinge mount is in reach) + part feeder racks behind them
    for (const dx of [-1.6, 1.6]) for (const dz of [-2.9, 2.9]) this._robot(SX[1] + dx, lz + dz, 'Tool_Welder', 1);
    this.bodyRobots = this.robots.filter((r) => r.station === 1);
    this.partRacks = this.bodyRobots.map((rb) => {
      const side = Math.sign(rb.z - lz);
      const rack = new THREE.Group();
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 1.1), new THREE.MeshStandardMaterial({ color: '#2d5c8a', metalness: 0.4, roughness: 0.6 }));
      top.position.y = 0.95; rack.add(top);
      for (const ox of [-0.6, 0.6]) for (const oz of [-0.45, 0.45]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.95, 0.08), new THREE.MeshStandardMaterial({ color: '#333' })); l.position.set(ox, 0.47, oz); rack.add(l); }
      rack.position.set(rb.x + Math.sign(rb.x - SX[1]) * 0.3, 0, rb.z + side * 1.7);
      scene.add(rack);
      physics.addStaticBox(new THREE.Vector3(rack.position.x, 0.5, rack.position.z), { x: 0.7, y: 0.5, z: 0.55 });
      return { group: rack, top: new THREE.Vector3(rack.position.x, 1.0, rack.position.z), robot: rb };
    });
    for (const dx of [-1.8, 1.8]) for (const dz of [-4.3, 4.3]) this._robot(SX[2] + dx, lz + dz, 'Tool_Spray', 2);
    this.wheelBot = this._robot(SX[3] - 3.2, lz - 4.3, 'Tool_Gripper', 3);
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
    this.boothLight = this.game.lights.add(new THREE.Vector3(SX[2], 5, lz), '#e8f0ff', 26, false, 16);
    // S4: overhead crane with an engine staging bay, chains, under-lift and lateral wheel loaders
    this.crane = assets.clone('crane');
    this.crane.position.set(SX[3], 0, lz);
    scene.add(this.crane);
    this.bridge = this.crane.getObjectByName('Bridge');
    this.bridgeBase = this.bridge.position.z;
    this.hoist = this.crane.getObjectByName('Hoist');
    this.hoistBase = this.hoist.position.y;
    this.trolley = this.crane.getObjectByName('Trolley');
    this.hookPoint = this.crane.getObjectByName('HookPoint');
    const cable = this.crane.getObjectByName('Cable');
    if (cable) cable.visible = false;
    this.chainMat = new THREE.LineBasicMaterial({ color: '#c8c8c8' });
    this.chains = [0, 1].map(() => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), this.chainMat); scene.add(l); return l; });
    this.stagePos = new THREE.Vector3(SX[3], 0, lz - 6.0);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1.4), new THREE.MeshStandardMaterial({ color: '#7a1f1f', metalness: 0.4, roughness: 0.6 }));
    stand.position.copy(this.stagePos).setY(0.45);
    scene.add(stand);
    physics.addStaticBox(stand.position, { x: 0.8, y: 0.45, z: 0.7 });
    this.stageTop = this.stagePos.clone().setY(0.9);
    this.lift = assets.clone('lift');
    this.lift.position.set(SX[3], 0.0, lz);
    this.lift.rotation.y = Math.PI / 2;
    scene.add(this.lift);
    this.liftPlat = this.lift.getObjectByName('Platform');
    this.liftBase = this.liftPlat.position.y;
    // wheel loaders: arm on a floor rail each side + tyre racks
    this.loaders = [];
    const loaderMat = new THREE.MeshStandardMaterial({ color: '#2a6bd1', metalness: 0.4, roughness: 0.5 });
    for (const side of [-1, 1]) {
      const rack = new THREE.Group();
      for (let i = 0; i < 4; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.12, 8, 16), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.9 })); t.rotation.x = Math.PI / 2; t.position.y = 0.15 + i * 0.25; rack.add(t); }
      rack.position.set(SX[3] - 2.6, 0, lz + side * 4.4);
      scene.add(rack);
      for (const ax of [-1, 1]) {
        const arm = new THREE.Group();
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), loaderMat); base.position.y = 0.25; arm.add(base);
        const boom = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.2), loaderMat); boom.position.set(0, 0.6, -side * 0.5); arm.add(boom);
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.06), new THREE.MeshStandardMaterial({ color: '#222' })); plate.position.set(0, 0.6, -side * 1.1); arm.add(plate);
        arm.position.set(SX[3] + ax * 1.5, 0, lz + side * 3.2);
        scene.add(arm);
        this.loaders.push({ arm, side, ax, home: arm.position.clone(), boom, plate });
      }
    }
    // S5 scanner
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
  }

  /** Delivery showroom: a slowly turning display car of the latest build. */
  setShowroomCar(cfg) {
    if (this.showCar) this.showCar.dispose();
    const vis = new CarVisual(this.game.assets, cfg, { lite: true });
    vis.root.position.copy(this.showroomSpot).setY(this.showroomSpot.y + 0.05);
    this.game.scene.add(vis.root);
    this.showCar = vis;
  }

  /** Night Shift lighting: floodlights <-> purple blacklight + red emergency beacons. */
  setNightShift(on) {
    const L = this.game.lights;
    this.nightShift = on;
    if (this.ceilMat) { this.ceilMat.emissive.set(on ? '#5a1aff' : '#fff2d8'); this.ceilMat.emissiveIntensity = on ? 1.6 : 3; }
    this.floods.forEach((s, i) => L.setOn(s, true, on ? (i % 3 === 0 ? '#ff2020' : '#6a2aff') : '#fff1dc', on ? 9 : 30));
    this.emergency.forEach((s) => L.setOn(s, on, '#ff1a1a', 18));
    L.setOn(this.boothLight, true, on ? '#7a3cff' : '#e8f0ff', on ? 12 : 26);
    if (this.shaftMat) this.shaftMat.uniforms.uK.value = on ? 0 : 1;
    this.neonBoost = on ? 1.4 : 1;
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

  /** S1 press: blank lifted off the stack -> slid onto the bed -> stamped (flat -> curved, sparks) -> pushed onto the output rack. */
  _pressCycle(dt, active, st) {
    const fx = this.game.effects, audio = this.game.audio;
    const pc = this.pressCycle;
    const ws = this.workSheet;
    const lz = LAYOUT.lineZ, SX = LAYOUT.stationsX;
    if (!active) {
      ws.visible = false;
      const cyc = (this.t * 0.18) % 1;
      const down = cyc < 0.15 ? cyc / 0.15 : cyc < 0.3 ? 1 : cyc < 0.7 ? 1 - (cyc - 0.3) / 0.4 : 0;
      this.ram.position.y = this.ramBase + this.ram.userData.travel * down * 0.4;
      return;
    }
    pc.phase += dt * 0.75;
    if (pc.phase >= 1) { pc.phase -= 1; pc.n++; this.stats.pressCycles++; }
    const k = pc.phase;
    const blankTop = this.feeder.position.clone().setY(0.2 + Math.max(0, 7 - pc.n) * 0.055);
    const bed = new THREE.Vector3(SX[0], 1.2, lz - 7.8);
    const out = this.panelStack.position.clone().add(new THREE.Vector3(0, 0.3 + Math.min(5, pc.n) * 0.09, 0));
    ws.visible = true;
    let down = 0;
    if (k < 0.3) {
      ws.geometry = this.flatGeo;
      ws.material.emissiveIntensity = 0;
      const u = k / 0.3;
      ws.position.lerpVectors(blankTop, bed, THREE.MathUtils.smoothstep(u, 0, 1));
      ws.position.y += Math.sin(u * Math.PI) * 0.6;
      this.blanks.forEach((b, i) => (b.visible = i < 7 - (pc.n % 8)));
    } else if (k < 0.55) {
      ws.position.copy(bed);
      const u = (k - 0.3) / 0.25;
      down = u < 0.5 ? u * 2 : 2 - u * 2;
      if (u >= 0.5 && ws.geometry !== this.curvedGeo) {
        ws.geometry = this.curvedGeo;
        ws.material.emissiveIntensity = 2.4;
        fx.sparks(bed.clone().add(new THREE.Vector3(0, 0.3, 0)), 40, '#ffb347', 7);
        audio.stamp();
        if (this.game.distToFocus(bed) < 30) fx.shake = Math.max(fx.shake, 0.7);
      }
    } else {
      const u = (k - 0.55) / 0.45;
      ws.position.lerpVectors(bed, out, THREE.MathUtils.smoothstep(u, 0, 1));
      ws.position.y += Math.sin(u * Math.PI) * 0.4;
      ws.material.emissiveIntensity = Math.max(0, 2.4 - u * 2.4);
      if (u > 0.97) { const pn = this.panelStack.children[1 + Math.min(5, pc.n)]; if (pn) { pn.visible = true; pn.material.emissiveIntensity = 1.2; } }
    }
    this.ram.position.y = this.ramBase + this.ram.userData.travel * down;
  }

  /** a: assembly line state ({stage, stageT, running}) */
  update(dt, a) {
    this.t += dt;
    const t = this.t, fx = this.game.effects, audio = this.game.audio;
    const running = a && a.running;
    this.beltTex.offset.x -= dt * (running ? 0.6 : 0.1);
    // rollers spin with the carrier
    const cv = (this.carrier.position.x - this._lastCarrierX) / Math.max(dt, 1e-3);
    this._lastCarrierX = this.carrier.position.x;
    this.rollerSpin += dt * (Math.abs(cv) > 0.05 ? cv / 0.07 : running ? 2 : 0.3);
    if (this.game.distToFocus(this.carrier.position) < 70) {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -this.rollerSpin);
      this.rollerPos.forEach((p, i) => { m.compose(p, q, new THREE.Vector3(1, 1, 1)); this.rollers.setMatrixAt(i, m); });
      this.rollers.instanceMatrix.needsUpdate = true;
      this.carrierWheels.forEach((w) => (w.rotation.z = -this.rollerSpin * 0.45));
    }
    this.spider.position.y = this.spiderBase + Math.sin(t * 0.6) * 1.2 - 0.6;
    const flick = Math.sin(t * 17) * Math.sin(t * 3.1) > 0.93;
    this.neonMat.emissiveIntensity = (flick ? 1.5 : 7 + Math.sin(t * 40) * 0.4) * (this.neonBoost || 1);
    if (this.nightShift) this.emergency.forEach((s, i) => (s.intensity = 10 + 10 * Math.max(0, Math.sin(t * 5 + i * 1.3))));
    // lobby sliding doors open for anyone nearby
    const pp = this.game.focusPos;
    const near = Math.hypot(pp.x - LAYOUT.lobbyDoor[0], pp.z - LAYOUT.lobbyDoor[2]) < 6;
    this.lobbyOpen += THREE.MathUtils.clamp((near ? 1 : 0) - this.lobbyOpen, -dt * 2, dt * 2);
    this.lobbyPanels.forEach((p) => (p.position.x = p.userData.travel * this.lobbyOpen));
    this.lobbyCol.collisionResponse = this.lobbyOpen < 0.7;
    const car = this.game.player.vehicle;
    const bayNear = car && Math.hypot(car.position.x - LAYOUT.bayDoor[0], car.position.z - LAYOUT.bayDoor[2]) < 16;
    this.bayDoor.target = bayNear || this.game.inBayZone(pp) ? 1 : 0;
    this._animGarage(this.bayDoor, dt);
    this._animGarage(this.exitDoor, dt);
    this.turntableTop.rotation.y += dt * 0.35;
    if (this.showCar) this.showCar.root.rotation.y += dt * 0.25;
    const stage = running ? a.stage : -1, st = a ? a.stageT : 0;
    // S1 press
    this._pressCycle(dt, stage === 0 && st > 0.12 && st < 0.95, st);
    this.panelStack.children.forEach((p, i) => { if (i && p.material) p.material.emissiveIntensity = Math.max(0, p.material.emissiveIntensity - dt * 0.4); });
    if (stage === 1 && st < 0.05) { this.panelStack.children.forEach((p, i) => i && (p.visible = false)); this.pressCycle.n = 0; }
    // robots: IK-driven when the choreography controls them, idle sway otherwise
    for (const r of this.robots) {
      const active = (r.station === stage && st > 0.15 && st < 0.92) || (r.station === 9 && this.game.bayBusy);
      if (r.target && r.blend > 0) {
        this.solveIK(r, r.target);
        const k = Math.min(1, dt * 12);
        r.j.base.rotation.y += (r.ik.yaw - r.j.base.rotation.y) * k;
        r.j.sh.rotation.x += (r.ik.a - r.j.sh.rotation.x) * k;
        r.j.el.rotation.x += (r.ik.b - r.j.el.rotation.x) * k;
        r.j.wr.rotation.x += (0 - r.j.wr.rotation.x) * k;
        r.target = null;
      } else {
        const kk = active ? 1 : 0.25;
        const ph = t * (active ? 1.6 : 0.4) + r.ph;
        const tb = Math.sin(ph * 0.5) * 0.45 * kk, ts = -0.35 - (active ? 0.25 : 0) + Math.sin(ph) * 0.18 * kk, te = 0.55 + Math.sin(ph * 1.3 + 1) * 0.3 * kk, tw = 0.5 + Math.sin(ph * 2) * 0.4 * kk;
        const k = Math.min(1, dt * 3);
        r.j.base.rotation.y += (tb - r.j.base.rotation.y) * k;
        r.j.sh.rotation.x += (ts - r.j.sh.rotation.x) * k;
        r.j.el.rotation.x += (te - r.j.el.rotation.x) * k;
        r.j.wr.rotation.x += (tw - r.j.wr.rotation.x) * k;
      }
      if (active && r.j.tip && r.station !== 1) {
        const p = new THREE.Vector3(); r.j.tip.getWorldPosition(p);
        if (r.tool === 'Tool_Spray' && Math.random() < dt * 30) {
          const dir = new THREE.Vector3(0, -0.3, 1).applyQuaternion(r.j.tip.getWorldQuaternion(new THREE.Quaternion())).normalize();
          fx.mist(p, dir, r.station === 9 ? (this.game.bayColor || '#ff6a00') : (a.cfg ? a.cfg.color : '#ff6a00'), 2);
          if (Math.random() < 0.1) audio.spray(0.3);
        }
      }
    }
    // S4 crane: staging bay pick-up -> traverse -> lower into the engine bay; lift raises the axles
    const s4 = stage === 3 ? st : stage > 3 ? 1 : 0;
    const smooth = (x0, x1, x) => THREE.MathUtils.smoothstep(x, x0, x1);
    const toCar = smooth(0.25, 0.4, s4) - smooth(0.72, 0.85, s4);
    this.bridge.position.z = this.bridgeBase + (this.stagePos.z - LAYOUT.lineZ) * (1 - toCar);
    // hook drops 2.3 m to the staging stand to pick the engine up, 2.05 m into the open engine bay
    let lower = 0;
    if (s4 > 0.1 && s4 < 0.25) lower = Math.sin(((s4 - 0.1) / 0.15) * Math.PI) * 2.3;
    else if (s4 >= 0.4 && s4 < 0.72) lower = (s4 < 0.6 ? smooth(0.4, 0.55, s4) : 1 - smooth(0.6, 0.72, s4)) * 2.05;
    this.hoist.position.y = this.hoistBase - lower;
    this.craneLower = lower;
    this.liftPlat.position.y = this.liftBase + this.liftPlat.userData.travel * (stage === 3 ? smooth(0.3, 0.45, st) - smooth(0.88, 0.95, st) : 0);
    this.crane.updateMatrixWorld(true);
    const tp = this.trolley.getWorldPosition(new THREE.Vector3()), hp = this.hookPoint.getWorldPosition(new THREE.Vector3());
    this.chains.forEach((c, i) => { const off = new THREE.Vector3(i ? 0.18 : -0.18, 0, 0); c.geometry.setFromPoints([tp.clone().add(off), hp.clone().add(off.multiplyScalar(1.6)).add(new THREE.Vector3(0, 0.25, 0))]); });
    // S5 scanner sweep
    const scanning = stage === 4 && st > 0.12 && st < 0.5;
    this.laser.position.y = this.laserBase + (scanning ? Math.sin(t * 2.4) * 1.6 : 0);
    this.laserPlane.visible = scanning;
    if (scanning) { const p = new THREE.Vector3(); this.laser.getWorldPosition(p); this.laserPlane.position.copy(p); }
    // forklift shuttles along its loop with its seated driver
    this.forkT = (this.forkT + dt * 3.2) % this._loopLen();
    const { p, dir } = this._loopAt(this.forkT);
    this.forklift.position.copy(p);
    this.forklift.rotation.y = Math.atan2(dir.x, dir.z);
    this.forkBody.position.set(p.x, 1.15, p.z);
    this.forkBody.quaternion.setFromEuler(0, this.forklift.rotation.y, 0);
    this.forks.position.y = 0.25 + (Math.sin(t * 0.5) > 0.6 ? 0.8 : 0);
    if (this.forkDriver) {
      if (!this.forkDriver.seated) { this._seatForkDriver(); }
      this.forkDriver.steer = Math.sin(t * 0.8) * 0.3;
      if (this.game.distToFocus(p) < 60) this.forkDriver.update(dt, 'drive');
    }
  }

  _seatForkDriver() {
    const d = this.forkDriver;
    this.forklift.add(d.root);
    const s = this.forkSeat.position;
    d.root.scale.setScalar(0.9);
    d.root.position.set(s.x, s.y - 0.95 * 0.9 + 0.05, s.z);
    d.root.rotation.set(0, 0, 0);
    d.seated = this.forklift;
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

export { seatDriver };
