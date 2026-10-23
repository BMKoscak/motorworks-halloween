import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Input } from './core/input.js';
import { Assets } from './core/assets.js';
import { Physics } from './core/physics.js';
import { StaticBatcher } from './core/batcher.js';
import { CameraRig } from './core/cameraRig.js';
import { NavGraph } from './core/navGraph.js';
import { buildTerrain, terrainHeight } from './world/terrain.js';
import { Atmosphere } from './world/atmosphere.js';
import { buildTown, LightPool, Breakables, LeafPiles } from './world/town.js';
import { buildCemetery, updateCemetery } from './world/cemetery.js';
import { Factory, STATION_NAMES } from './world/factory.js';
import { Buildings } from './world/buildings.js';
import { Jumbotron } from './world/jumbotron.js';
import { Effects } from './vehicle/effects.js';
import { Vehicle } from './vehicle/vehicle.js';
import { CarVisual } from './vehicle/carVisual.js';
import { Player } from './actors/player.js';
import { AudioSystem } from './systems/audio.js';
import { AssemblyLine } from './systems/assembly.js';
import { Kiosk } from './systems/kiosk.js';
import { Traffic } from './systems/traffic.js';
import { Police } from './systems/police.js';
import { NPCs } from './systems/npcs.js';
import { Missions } from './systems/missions.js';
import { Combat } from './systems/combat.js';
import { Burglary } from './systems/burglary.js';
import { Interactions } from './systems/interactions.js';
import { Fuel } from './systems/fuel.js';
import { HUD } from './ui/hud.js';
import { LAYOUT, QUALITY, DEFAULT_CONFIG, ENGINES, pl } from './config.js';
import dialogue from './data/dialogue.json';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class Events {
  constructor() { this.h = {}; this.log = []; }
  on(k, f) { (this.h[k] ||= []).push(f); }
  emit(k, d) { this.log.push({ k, t: Math.round(performance.now()), d }); if (this.log.length > 400) this.log.shift(); (this.h[k] || []).forEach((f) => f(d)); }
}

const STATION_INFO = [
  'STATION 1 · STAMPING — Flat steel blanks are fed from the pallet into the 30-ton hydraulic press, stamped into curved door and hood skins, then pushed onto the output rack.',
  'STATION 2 · BODY SHOP — Robots grip each door, the hood and the trunk lid off the feeder racks, carry them to their hinge mounts, attach, spot-weld and swing them shut.',
  'STATION 3 · PAINT & LIVERY — Spray robots sweep the shell inside the booth, laying down your finish and decals.',
  'STATION 4 · POWERTRAIN MARRIAGE — The crane trolley fetches the engine from the staging bay on chains and lowers it into the open bay while the lift raises the axles; loader arms push each wheel onto its hub.',
  'STATION 5 · FINAL ASSEMBLY & QC — Laser scanners inspect the car, lights and underglow are tested, every hinge is cycled, then the roll-up door opens.',
];

class Game {
  constructor() {
    this.events = new Events();
    this.vehicles = [];
    this.mode = 'loading';
    this.clock = new THREE.Clock();
    this.focusPos = new THREE.Vector3(...LAYOUT.playerStart);
    this.dialogueLog = [];
    this.errors = [];
    this.frames = 0;
    this.qualityName = localStorage.getItem('mw_quality') || 'medium';
    this.listener = { pos: new THREE.Vector3(), right: new THREE.Vector3(1, 0, 0) };
    const saved = JSON.parse(localStorage.getItem('mw_save') || '{}');
    this.state = { money: saved.money ?? 250000, pumpkins: saved.pumpkins || [], monsterMash: !!saved.monsterMash, talked: new Set(), jerrycans: 0, launcher: !!saved.launcher };
  }

  save() {
    try { localStorage.setItem('mw_save', JSON.stringify({ pumpkins: this.state.pumpkins, monsterMash: this.state.monsterMash, money: Math.round(this.state.money), launcher: !!this.state.launcher })); } catch (e) { /* ignore */ }
  }

  heightAt(x, z) { return terrainHeight(x, z); }
  inBayZone(p) { const b = LAYOUT.bayZone; return p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1; }
  distToFocus(p) { return p.distanceTo(this.focusPos); }

  async init() {
    const canvas = $('game');
    const q = (this.quality = QUALITY[this.qualityName]);
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(q.pixelRatio);
    r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.info.autoReset = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1800);
    this.camera.position.set(-20, 18, 40);
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.6, 0.5, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.bloom.enabled = q.bloom;
    addEventListener('resize', () => this.resize());

    this.input = new Input(canvas);
    this.physics = new Physics();
    this.physics.onOutOfBounds = (b) => this._outOfBounds(b);
    this.assets = new Assets();
    this.audio = new AudioSystem();
    this.hud = new HUD(this);
    await this.assets.loadAll((f, name) => { $('loadbar').style.width = Math.round(f * 80) + '%'; $('loadtext').textContent = `Loaded ${name}.glb`; });
    $('loadtext').textContent = 'Building the town…';
    await wait(30);
    this.effects = new Effects(this.scene);
    this.lights = new LightPool(this.scene, 12);
    this.breakables = new Breakables(this);
    this.leafPiles = new LeafPiles(this.scene);
    this.batcher = new StaticBatcher(this.scene);
    this.buildings = new Buildings(this);
    this.terrain = buildTerrain(this.scene, this.physics);
    this.atmo = new Atmosphere(this.scene, q);
    this.town = buildTown(this);
    this.cem = buildCemetery(this, this.town);
    this.factory = new Factory(this);
    this.jumbotron = new Jumbotron(this, this.factory, new THREE.Vector3(...pl(-22, 2, 8.6)));
    this.buildings.finalize();
    this.batched = this.batcher.build();
    $('loadbar').style.width = '88%';
    $('loadtext').textContent = 'Mapping sidewalks, yards and doorways…';
    await wait(30);
    this.nav = new NavGraph(this);
    this.nav.build(this.town, this.buildings);
    $('loadbar').style.width = '93%';
    $('loadtext').textContent = 'Starting the night shift…';
    await wait(30);
    this.traffic = new Traffic(this);
    this.police = new Police(this);
    this.npcs = new NPCs(this);
    this.traffic.spawnParked(this.town.parking);
    this.traffic.spawnDriving(9);
    this.police.spawnPatrols();
    this.npcs.build(this.town, this.cem);
    this.player = new Player(this, new THREE.Vector3(...LAYOUT.playerStart));
    this.player.facing = Math.PI;
    this.combat = new Combat(this);
    if (this.state.launcher) this.combat.give('launcher', 6), this.combat.select('unarmed');
    this.burglary = new Burglary(this);
    this.burglary.build();
    this.interactions = new Interactions(this);
    this.interactions.build();
    this.fuel = new Fuel(this);
    this.fuel.build();
    this.assembly = new AssemblyLine(this, this.factory);
    this.kiosk = new Kiosk(this, this.factory);
    this.missions = new Missions(this, this.cem);
    this.rig = new CameraRig(this, this.camera);
    this.rig.yaw = 0;
    this._wire();
    this._ui();
    this.hud.money(this.state.money);
    this.hud.pumpkins(this.state.pumpkins.length);
    $('loadbar').style.width = '100%';
    $('loading').classList.add('hidden');
    $('title').classList.remove('hidden');
    this.mode = 'title';
    this.ready = true;
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
  }

  setQuality(name) {
    this.qualityName = name;
    const q = (this.quality = QUALITY[name]);
    this.renderer.setPixelRatio(q.pixelRatio);
    this.resize();
    this.bloom.enabled = q.bloom;
    this.atmo.setQuality(q);
    try { localStorage.setItem('mw_quality', name); } catch (e) { /* ignore */ }
  }

  /** Physics watchdog: any vehicle body that leaves |x|,|z| < 600 / -20 < y < 150 (or goes NaN) is put back on the road graph. */
  _outOfBounds(body) {
    const v = body.userData.vehicle;
    if (!v) return;
    if (v.kind === 'police') this.police.resetCar(v);
    else {
      const n = this.traffic.graph.nearest(Number.isFinite(body.position.x) ? body.position : new THREE.Vector3());
      const dir = n.seg.at(n.s).dir;
      v.teleport(new THREE.Vector3(n.p.x, terrainHeight(n.p.x, n.p.z), n.p.z), Math.atan2(dir.x, dir.z));
    }
    this.events.emit('watchdogReset', { kind: v.kind });
  }

  // ---------------------------------------------------------------------- wiring
  _wire() {
    const ev = this.events;
    ev.on('impact', (e) => {
      const near = e.point.distanceTo(this.camera.position) < 60;
      if (near) this.audio.crash(e.speed);
      this.effects.sparks(e.point, Math.min(40, e.speed * 3), '#ffcf8a', e.speed * 0.5);
      if (e.vehicle === this.player.vehicle) this.effects.shake = Math.min(1.2, this.effects.shake + e.speed * 0.06);
      if (e.speed > 12) e.vehicle.damageEngine((e.speed - 12) * 2);
      if (e.other && e.other.userData && e.other.userData.civilian) this.traffic.bump(e.other);
      this.police.onImpact(e);
    });
    ev.on('propSmashed', (e) => this.police.onPropSmashed(e));
    ev.on('orderComplete', (e) => {
      this.ownedCar = e.vehicle;
      this.missions.advance('getin');
      this.say('foreman_done', this.npcs.foreman.char);
      this.hud.toast(`Order ${e.number} complete! Your car is waiting outside the exit door.`, 'good', 5000);
    });
    ev.on('stationDone', (e) => e.stage < 5 && this.hud.toast(`✔ ${STATION_NAMES[e.stage - 1]} complete`, '', 2000));
    this.input.onUnlock = () => { if (this.mode === 'play') this.pause(true); };
  }

  _ui() {
    $('btn-start').onclick = async () => {
      await this.audio.init();
      this.audio.applyVolumes();
      $('title').classList.add('hidden');
      this.mode = 'play';
      this.hud.show(true);
      this.input.clearAll('start');
      this.input.lock();
      this.hud.toast('Welcome to Motorworks! Click the game to capture the mouse.', '', 4000);
    };
    $('btn-controls').onclick = () => $('controls-card').classList.toggle('hidden');
    $('btn-resume').onclick = () => this.pause(false);
    $('btn-title').onclick = () => { this.pause(false); this.input.unlock(); this.mode = 'title'; this.hud.show(false); $('title').classList.remove('hidden'); };
    const vol = (id, key) => { const el = $(id); el.value = this.audio.vol[key]; el.oninput = () => { this.audio.vol[key] = parseFloat(el.value); this.audio.applyVolumes(); }; };
    vol('vol-master', 'master'); vol('vol-voice', 'voice'); vol('vol-sfx', 'sfx'); vol('vol-music', 'music');
    $('quality').value = this.qualityName;
    $('quality').onchange = (e) => { this.manualQuality = true; this.setQuality(e.target.value); };
    $('units').onchange = (e) => (this.hud.units = e.target.value);
    $('game').addEventListener('click', () => { if (this.mode === 'play' && !this.input.locked) this.input.lock(); });
    addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      if (this.mode === 'play') this.pause(true);
      else if (this.mode === 'paused') this.pause(false);
      else if (this.mode === 'kiosk') this.kiosk.close();
    });
    $('lan-url').textContent = `Serving at ${location.origin} · open docs.html for the build report`;
    const badge = $('telemetry-badge');
    badge.onclick = () => { badge.classList.toggle('collapsed'); $('tb-toggle').textContent = badge.classList.contains('collapsed') ? '▸' : '▾'; };
    fetch('TELEMETRY.json').then((r) => r.json()).then((t) => {
      const s = t.summary || {};
      const rows = [
        ['Build time', s.buildTime || '—'], ['LLM API calls', s.llmCalls ?? '—'], ['Input tokens', s.inputTokens ?? '—'], ['Output tokens', s.outputTokens ?? '—'],
        ['Est. cost', s.estimatedCost || '—'], ['ElevenLabs chars', t.elevenlabs ? t.elevenlabs.charactersSynthesized : 0], ['Voice lines', t.dialogue ? t.dialogue.lines : '—'],
        ['Blender GLBs', s.glbAssets ?? '—'], ['QA self-check passes', s.qaPasses ?? '—'],
      ];
      $('tb-body').innerHTML = rows.map(([k, v]) => `<span>${k}</span><b>${typeof v === 'number' ? v.toLocaleString() : v}</b>`).join('');
    }).catch(() => ($('tb-body').innerHTML = '<span>Telemetry unavailable</span><b>—</b>'));
  }

  pause(on) {
    if (on && this.mode !== 'play') return;
    this.input.clearAll(on ? 'pause-open' : 'pause-close');
    this.audio.horn(false);
    if (on) {
      this.mode = 'paused';
      $('pause').classList.remove('hidden');
      this.input.unlock();
    } else if (this.mode === 'paused') {
      this.mode = 'play';
      $('pause').classList.add('hidden');
      this.input.lock();
    }
  }

  // ---------------------------------------------------------------------- dialogue
  async say(id, actor = null) {
    const line = dialogue.lines[id];
    if (!line) return;
    const voice = dialogue.voices[line[0]];
    const res = await this.audio.speakLine(id);
    const dur = res.duration || line[1].length * 0.06;
    this.hud.subtitle(voice.name, line[1], dur);
    if (actor) { this.hud.bubble(actor, voice.name, line[1], dur); actor.talking = dur; }
    this.dialogueLog.push({ id, voice: line[0], demo: voice.demo, speaker: actor && actor.profile ? actor.profile.ageGroup : null, duration: +dur.toFixed(2), source: res.source || 'none', at: Math.round(performance.now()) });
  }

  // ---------------------------------------------------------------------- orders / respray
  startOrder(cfg) {
    this.assembly.start(cfg);
    this.missions.advance('building');
    this.mode = 'play';
    this.player.teleport(new THREE.Vector3(...pl(-28, 13, 0.1)), Math.PI);
    this.rig.yaw = 0.3;
    this.say('foreman_order', this.npcs.foreman.char);
    this.hud.toast(`Order ${this.assembly.number} placed!`, 'good', 3500);
  }

  onKioskClosed(mode, applied) {
    this.mode = 'play';
    this.input.clearAll('kiosk-close');
    this.input.lock();
  }

  finishRespray(v, cfg) {
    this.bayBusy = true;
    this.bayColor = cfg.color;
    this.audio.spray(2.5);
    this.hud.toast('Respraying…', '', 2500);
    setTimeout(() => {
      v.visual.applyConfig(cfg);
      v.retune();
      v.stolen = false;
      v.owned = true;
      this.ownedCar = v;
      this.police.clear();
      this.bayBusy = false;
      this.say('bay_1');
      this.hud.toast('Fresh paint, new plates — heat cleared!', 'good', 4000);
      this.events.emit('respray', {});
    }, 2600);
  }

  // ---------------------------------------------------------------------- cars
  async enterVehicle(veh, opts = {}) {
    if (this.player.carrying) { this.hud.toast('Put that down first — stash it in a trunk', 'bad'); return; }
    this.busy = true;
    const p = this.player;
    const door = this.traffic.doorPoint(veh.visual);
    p.teleport(new THREE.Vector3(door.x, this.heightAt(door.x, door.z), door.z), Math.atan2(veh.position.x - door.x, veh.position.z - door.z));
    p.anim = 'reach';
    p.busy = 1.0;
    veh.visual.setHinge('Door_L', 1);
    this.audio.doorOpen();
    await wait(650);
    p.setInCar(veh);
    veh.setControls({ throttle: 0, steer: 0, handbrake: false });
    this.engineSnd = this.audio.ctx ? this.audio.engine() : null;
    this.rig.carYawOff = 0;
    setTimeout(() => { veh.visual.setHinge('Door_L', 0); this.audio.doorShut(); }, 700);
    if (veh === this.ownedCar && this.missions.step === 'getin') this.missions.advance('drive');
    this.busy = false;
    this.events.emit('enterCar', { stolen: veh.stolen, fuel: veh.fuel });
  }

  exitVehicle() {
    const veh = this.player.vehicle;
    if (!veh || veh.speedAbs > 4) { if (veh) this.hud.toast('Slow down to get out'); return; }
    if (this.fuel.session) this.fuel.stop('exit');
    veh.setControls({ throttle: 0, steer: 0, handbrake: true });
    veh.visual.setHinge('Door_L', 1);
    this.audio.doorOpen();
    setTimeout(() => { veh.visual.setHinge('Door_L', 0); this.audio.doorShut(); }, 900);
    let door = this.traffic.doorPoint(veh.visual);
    const blocked = this.physics.rayStatic(new THREE.Vector3(veh.position.x, veh.position.y + 0.5, veh.position.z), new THREE.Vector3(door.x, veh.position.y + 0.5, door.z));
    if (blocked) door = new THREE.Vector3(veh.position.x, veh.position.y + 1.8, veh.position.z);
    this.player.setInCar(null);
    this.player.teleport(new THREE.Vector3(door.x, Math.max(door.y, this.heightAt(door.x, door.z)) + 0.05, door.z), veh.heading + Math.PI / 2);
    this.rig.yaw = veh.heading + Math.PI;
    if (this.engineSnd) { this.engineSnd.stop(); this.engineSnd = null; }
    this.audio.horn(false);
    if (this.audio.radio) this.audio.radio.off();
    this.hud.radio(null);
    this.events.emit('exitCar', {});
  }

  async stealCar(entry) {
    if (this.player.carrying) { this.hud.toast('Hands full — stash the loot first', 'bad'); return; }
    this.busy = true;
    const p = this.player;
    const vis = entry.visual;
    const door = this.traffic.doorPoint(vis);
    p.teleport(new THREE.Vector3(door.x, this.heightAt(door.x, door.z), door.z), Math.atan2(vis.root.position.x - door.x, vis.root.position.z - door.z));
    p.anim = 'reach';
    p.busy = 2.4;
    vis.setHinge('Door_L', 1);
    this.audio.doorOpen();
    const witnesses = this.police.witnesses(vis.root.position);
    let driver = null;
    if (entry.kind === 'parked') {
      this.hud.prompt('Hotwiring…');
      this.audio.hotwire();
      await wait(1300);
      if (entry.alarm) { this.audio.alarm(6); entry.alarmed = true; this.hud.toast('Car alarm!', 'bad'); }
    } else {
      // yank the seated driver out through the open door before jumping in
      driver = entry.driver;
      await wait(300);
      this.npcs.ejectDriver(entry, door.clone().add(new THREE.Vector3(Math.sin(p.facing + Math.PI / 2) * 1.2, 0, Math.cos(p.facing + Math.PI / 2) * 1.2)));
      await wait(950);
    }
    const res = this.traffic.steal(entry);
    const vehicle = res.vehicle;
    if (entry.alarmed) { vehicle.hazard = true; setTimeout(() => (vehicle.hazard = false), 6000); }
    this.busy = false;
    await this.enterVehicle(vehicle);
    this.state.carsStolen = (this.state.carsStolen || 0) + 1;
    if (witnesses.civ > 0 || witnesses.cop || entry.alarmed || driver) this.police.crime('theft', witnesses.cop ? 2 : 1);
    this.events.emit('theft', { witnesses, fuel: vehicle.fuel });
  }

  busted(reason = 'boxed') {
    if (this.mode !== 'play') return;
    this.mode = 'busted';
    this.input.clearAll('busted');
    const fine = Math.min(this.state.money, 500 + this.police.level * 750);
    this.state.money -= fine;
    const lost = this.burglary.bag.length + (this.player.carrying ? 1 : 0);
    if (this.player.carrying) { this.player.char.root.remove(this.player.carrying.mesh); this.player.carrying = null; }
    this.burglary.bag.length = 0;
    $('busted').querySelector('.busted-text').textContent = reason === 'down' ? 'TAKEN DOWN' : 'BUSTED';
    $('busted-sub').textContent = `Fine: $${fine.toLocaleString()} · ${this.player.vehicle ? 'vehicle impounded' : reason === 'tackled' ? 'tackled & cuffed' : 'patched up at the station'}${lost ? ` · ${lost} stolen item(s) confiscated` : ''}`;
    $('busted').classList.remove('hidden');
    if (!this.player.vehicle) this.player.anim = 'cuffed';
    this.audio.sting(true);
    this.say('cop_busted');
    this.police.stats.busts++;
    this.events.emit('busted', { fine, reason });
    setTimeout(() => {
      const veh = this.player.vehicle;
      if (veh) {
        this.player.setInCar(null);
        if (this.engineSnd) { this.engineSnd.stop(); this.engineSnd = null; }
        if (this.audio.radio) this.audio.radio.off();
        if (veh === this.ownedCar) veh.teleport(new THREE.Vector3(140, 0, 11), Math.PI / 2);
        else veh.remove();
      }
      this.player.teleport(new THREE.Vector3(...LAYOUT.respawnBusted), 0);
      this.rig.yaw = Math.PI;
      this.police.clear();
      this.combat.health = 100;
      this.say('dispatch_5');
      $('busted').classList.add('hidden');
      this.mode = 'play';
    }, 3600);
  }

  // ---------------------------------------------------------------------- interaction
  _interaction() {
    const p = this.player, pos = p.position;
    if (this.busy) return null;
    if (p.vehicle) {
      const v = p.vehicle;
      const fuel = this.fuel.candidate(v);
      if (fuel) return { ...fuel, alt: () => this.exitVehicle() };
      const sell = this.burglary.carCandidate(v);
      if (sell && !sell.alt) return { ...sell, alt: () => this.exitVehicle() };
      if (this.inBayZone(v.position) && v.speedAbs < 1.5) return { text: `[E] Custom Bay: respray & modify  ·  [Shift+E] ${sell ? sell.text.replace('[Shift+E] ', '') : 'exit car'}`, act: () => this._bay(v), alt: sell ? sell.act : () => this.exitVehicle() };
      return { text: v.speedAbs < 4 ? (v.stalled ? `[E] Exit car — ${v.fuel <= 0.5 ? 'out of fuel' : 'engine dead'}` : '[E] Exit car') : '', act: () => this.exitVehicle() };
    }
    const cands = [];
    if (this.kioskNear()) cands.push({ d: 0.2, text: this.assembly.running ? 'Order in progress — watch it on the line' : '[E] Use the Motorworks configurator kiosk', act: () => !this.assembly.running && this.openKiosk() });
    const info = this.factory.infoPanels.find((i) => i.pos.distanceTo(pos) < 2.4);
    if (info) cands.push({ d: 1.5, text: `[E] Read station ${info.station + 1} info panel`, act: () => { this.hud.subtitle('Info Panel', STATION_INFO[info.station], 7); this.audio.blip(); this.events.emit('infoPanel', { station: info.station }); } });
    const npc = this.npcs.nearestTalkable(pos);
    if (npc) cands.push({ d: npc.char.root.position.distanceTo(pos) + 0.3, text: `[E] Talk to ${npc.name}`, act: () => this.npcs.talk(npc) });
    cands.push(...this.interactions.candidates(pos), ...this.burglary.candidates(pos));
    const jc = this.fuel.jerrycanCandidate(pos);
    if (jc) cands.push(jc);
    // refuel standing at the pump next to a car
    const near = this.vehicles.find((v) => v.kind === 'player' && Math.hypot(v.position.x - pos.x, v.position.z - pos.z) < 3.2);
    if (near && this.fuel.pumpNear(pos, 2.6)) { const f = this.fuel.candidate(near, pos); if (f) cands.push({ d: 0.6, ...f }); }
    if (!p.carrying) {
      for (const v of this.vehicles) {
        if (v.kind === 'police' || v === p.vehicle) continue;
        const door = this.traffic.doorPoint(v.visual);
        const d = Math.hypot(door.x - pos.x, door.z - pos.z);
        if (d < 3.2) cands.push({ d: d + 0.2, text: `[E] Get in ${v.stolen ? '(stolen car)' : 'your car'}${v.fuel < 15 ? ` — ${Math.round(v.fuel)}% fuel` : ''}`, act: () => this.enterVehicle(v) });
      }
      const civ = this.traffic.nearestCar(pos);
      if (civ) cands.push({ d: 1.4, text: `[E] Steal this car${civ.kind === 'driving' ? ' (pull the driver out!)' : ''}`, act: () => this.stealCar(civ) });
    }
    if (!cands.length) return p.carrying ? { text: `Carrying ${p.carrying.name} · [G] drop it`, act: () => {} } : null;
    cands.sort((a, b) => a.d - b.d);
    return cands[0];
  }

  kioskNear() { return this.player.position.distanceTo(this.factory.kioskPos) < 2.6 && !this.player.vehicle; }

  openKiosk() {
    this.mode = 'kiosk';
    this.kiosk.open('order');
    this.events.emit('kioskOpen', {});
  }

  _bay(v) {
    const hot = this.police.cars.some((c) => c.mode === 'pursuit' && Math.hypot(c.position.x - v.position.x, c.position.z - v.position.z) < 30);
    if (hot) { this.hud.toast('Too hot! Lose the cops before the respray.', 'bad'); return; }
    v.setControls({ throttle: 0, steer: 0, handbrake: true });
    this.mode = 'kiosk';
    this.kiosk.open('bay', v);
  }

  // ---------------------------------------------------------------------- frame
  frame() {
    const dt = Math.min(0.2, this.clock.getDelta());
    this.frames++;
    this._autoQuality(dt);
    try { this.update(dt); } catch (e) { this.errors.push(String(e && e.stack || e)); console.error(e); }
    this.renderer.info.reset();
    this.composer.render();
    this.input.endFrame();
  }

  /** Low-end GPUs: step quality down automatically if the frame rate stays low (manual choice wins). */
  _autoQuality(dt) {
    if (this.mode !== 'play' || this.manualQuality || this.qualityName === 'low') { this._fq = null; return; }
    const f = (this._fq ||= { t: 0, n: 0 });
    f.t += dt; f.n++;
    if (f.t > 6) {
      const fps = f.n / f.t;
      this._fq = null;
      if (fps < 26) {
        const next = this.qualityName === 'high' ? 'medium' : 'low';
        this.setQuality(next);
        $('quality').value = next;
        this.hud.toast(`Graphics auto-adjusted to ${next.toUpperCase()} (${Math.round(fps)} fps)`);
        this.events.emit('autoQuality', { fps, next });
      }
    }
  }

  update(dt) {
    const input = this.input, mode = this.mode;
    const playing = mode === 'play';
    const simulate = mode !== 'paused';
    const p = this.player;
    const veh = p.vehicle;
    this.time = (this.time || 0) + dt;
    // ------------------------------------------------ controls
    if (playing) {
      const it = this._interaction();
      this.hud.prompt(this.busy ? null : it && it.text);
      if (input.pressed('KeyE') && it) (input.down('ShiftLeft') && it.alt ? it.alt : it.act)();
      if (veh) {
        const throttle = input.axis('KeyS', 'KeyW');
        const steer = input.axis('KeyD', 'KeyA');
        veh.setControls({ throttle, steer, handbrake: input.down('Space') });
        if (input.pressed('KeyC')) { this.rig.cockpit = !this.rig.cockpit; veh.visual.setFirstPerson(this.rig.cockpit); }
        if (input.pressed('KeyH')) { this.audio.horn(true); this.missions.honk(); this.events.emit('horn', {}); }
        if (!input.down('KeyH')) this.audio.horn(false);
        if (input.pressed('KeyR') && this.audio.radio) { const n = this.audio.radio.cycle(); this.hud.radio(this.audio.radio.on ? n : null); this.hud.toast('📻 ' + n); this.events.emit('radio', { name: n }); }
        if (input.pressed('Backspace')) veh.reset();
        if (input.pressed('KeyL')) { veh.visual.lights.head = !veh.visual.lights.head; this.audio.click(); this.hud.toast(veh.visual.lights.head ? '💡 Lights on' : 'Lights off'); this.events.emit('carLights', { on: veh.visual.lights.head }); }
        this.leafPiles.disturb(veh.position, veh.speedAbs) && this.audio.noiseBurst(0.6, 2500, 0.6, 0.15, 'highpass');
      } else {
        p.update(dt, input, this.rig.yaw);
        if (input.pressed('KeyG') && p.carrying) this.burglary.dropCarried();
        if (input.pressed('KeyV') && this.assembly.running) { const n = this.assembly.cycleStationCam(); this.hud.toast(n ? `📷 ${n}` : 'Camera: player'); }
        if (input.pressed('KeyF') && this.assembly.running) { this.assembly.toggleFollow(); this.hud.toast(this.assembly.camMode ? '📷 Following your car' : 'Camera: player'); }
      }
      this.combat.update(dt, input);
      if (input.pressed('KeyN')) { this.missions.guide = !this.missions.guide; this.hud.toast(this.missions.guide ? 'Waypoint guide ON' : 'Waypoint guide OFF'); }
      // first visit to the lobby: Sal greets you
      if (!this.greeted && p.position.distanceTo(this.npcs.foreman.char.root.position) < 9) { this.greeted = true; this.say('foreman_greet', this.npcs.foreman.char); }
      if (!this.paTimer || (this.paTimer -= dt) < 0) { this.paTimer = 50; if (this.zone === 'factory') this.say(Math.random() < 0.5 ? 'pa_1' : 'pa_2'); }
    } else if (mode === 'kiosk') {
      this.kiosk.update(dt, input, this.camera);
    } else if (veh) veh.setControls({ throttle: 0, steer: 0, handbrake: true });
    if (veh || !playing) p.sync(dt);
    // ------------------------------------------------ simulation
    if (simulate) {
      for (const v of this.vehicles) if (v !== veh && v.kind === 'player') v.setControls({ throttle: 0, steer: 0, handbrake: true });
      for (const v of this.vehicles) v.update(dt);
      this.physics.step(dt);
      for (const v of this.vehicles) v.sync(dt);
      this.traffic.update(dt);
      this.police.update(dt);
      this.npcs.update(dt);
      this.assembly.update(dt, input.down('KeyT'));
      this.factory.update(dt, this.assembly);
      this.jumbotron.update(dt);
      this.buildings.update(dt);
      this.burglary.update(dt);
      this.fuel.update(dt);
      const gateNear = Math.hypot(p.position.x, p.position.z - LAYOUT.gateZ) < 30;
      if (gateNear !== this._gateWasNear) { this.cem.gate.target = gateNear ? 1 : 0; this._gateWasNear = gateNear; if (this.audio.ctx) this.audio.tone(140, 1.4, 'sawtooth', 0.05, 0, this.audio.sfx, 95); }
      updateCemetery(this.cem, dt, this.time, this.physics);
      this.missions.update(dt);
      this.breakables.update(dt);
      this.leafPiles.update(dt);
      this.effects.update(dt);
      (this.town.ghosts || []).forEach((g, i) => { g.position.y = (g.userData.by ??= g.position.y) + Math.sin(this.time * 1.5 + i) * 0.25; g.rotation.y += dt * 0.3; });
    }
    // ------------------------------------------------ camera
    const pos = p.position;
    this.focusPos.copy(mode === 'kiosk' && this.kiosk.center ? this.kiosk.center : pos);
    if (mode === 'title') {
      const t = this.time * 0.05;
      this.rig.pose(dt, new THREE.Vector3(Math.sin(t) * 55, 22 + Math.sin(t * 2) * 4, -20 + Math.cos(t) * 40), new THREE.Vector3(0, 10, -60), 1.5);
    } else if (mode !== 'kiosk' && mode !== 'photo') {
      const pose = !veh && this.assembly.cameraPose();
      if (pose) this.rig.pose(dt, pose.pos, pose.look, 2.5);
      else if (veh) this.rig.car(dt, input, veh);
      else this.rig.foot(dt, input, p);
    }
    this.camera.updateMatrixWorld();
    this.listener.pos.copy(this.camera.position);
    this.listener.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    // ------------------------------------------------ world fx / audio / HUD
    this.atmo.update(dt, this.focusPos, terrainHeight);
    this.lights.update(dt, this.focusPos);
    this.zone = this.focusPos.z > 205 ? 'cemetery' : (this.focusPos.z < -60 && this.focusPos.z > -110 && Math.abs(this.focusPos.x) < 60 ? 'factory' : 'town');
    this.audio.updateAmbience(this.zone, dt);
    if (this.engineSnd && veh) {
      const eng = ENGINES.find((e) => e.id === veh.visual.cfg.engine) || ENGINES[0];
      this.engineSnd.update(veh.stalled ? 0 : veh.rpm, veh.stalled ? 0 : Math.max(0, veh.controls.throttle), eng.cyl, { blower: veh.visual.cfg.hood === 'Hood_Blower' || veh.visual.cfg.hood === 'Hood_Franken', turbo: eng.turbo, slip: veh.sliding && veh.speedAbs > 3 });
    }
    this.hud.money(this.state.money);
    this.hud.pumpkins(this.state.pumpkins.length);
    this.hud.objective(this.missions.objectiveText());
    this.hud.waypoint(this.missions.guide ? this.missions.target() : null, this.camera, pos);
    if (veh) {
      const eng = veh.tune.eng;
      this.hud.speedo(true, veh.speed, veh.gear, (veh.rpm - eng.idle) / (eng.redline - eng.idle));
      const flats = veh.flats.filter(Boolean).length;
      this.hud.fuel(veh.fuel, veh.stalled, [flats ? `🛞 ${flats} flat tire${flats > 1 ? 's' : ''}` : '', veh.engineHealth < 60 ? `🔧 engine ${Math.round(veh.engineHealth)}%` : ''].filter(Boolean).join(' · '));
    } else this.hud.speedo(false);
    const ws = this.combat.hudState();
    ws.bag = this.burglary.bag.length || p.carrying ? `💰 Loot: ${p.carrying ? p.carrying.name + ' (carried)' : ''}${this.burglary.bag.length ? ` ${this.burglary.bag.length} in bag` : ''} · $${this.burglary.carriedValue()}` : (this.state.jerrycans ? `⛽ Jerrycans: ${this.state.jerrycans}` : '');
    this.hud.weapon(ws, playing && !veh);
    this.hud.order(this.assembly.hudState());
    const T = this.missions.trial;
    this.hud.trial(T.running ? `<div class="ph">GRAVEYARD SHIFT</div>Time <b>${T.t.toFixed(1)}s</b> · Drift <b>${Math.round(T.drift)}</b><br/>Checkpoint ${T.next + 1}/${this.cem.checkpoints.length}${T.best ? `<br/><span class="hint">Best ${T.best.toFixed(2)}s</span>` : ''}` : null);
    this.hud.update(dt, this.camera);
    if (this.frames % 3 === 0) {
      const camDir = new THREE.Vector3(); this.camera.getWorldDirection(camDir);
      const markers = this.police.cars.map((c) => ({ x: c.position.x, z: c.position.z, color: c.mode === 'pursuit' && Math.floor(this.time * 4) % 2 ? '#ff2a3a' : '#3f8cff', r: 5 }));
      for (const o of this.police.officers) if (!o.seated) markers.push({ x: o.pos.x, z: o.pos.z, color: '#7fb0ff', r: 2.5 });
      if (this.ownedCar && this.ownedCar !== veh) markers.push({ x: this.ownedCar.position.x, z: this.ownedCar.position.z, color: '#ff7a1a', r: 5 });
      markers.push({ x: this.factory.kioskPos.x, z: this.factory.kioskPos.z, color: '#ffd23f', r: 3 });
      if (this.fuel.station && this.fuel.pumps.length) markers.push({ x: this.fuel.pumps[0].pos.x, z: this.fuel.pumps[0].pos.z, color: '#39ff14', r: 3 });
      if (this.npcs.fence) markers.push({ x: this.npcs.fence.char.root.position.x, z: this.npcs.fence.char.root.position.z, color: '#c060ff', r: 3 });
      this.hud.minimap(pos, Math.atan2(camDir.x, camDir.z), { roads: this.town.roads, buildings: this.town.buildings, cemetery: LAYOUT.cemetery, markers, target: this.missions.guide ? this.missions.target() : null });
    }
  }
}

// ======================================================================== boot + QA hooks
const game = new Game();
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
window.__MW = {
  game,
  ready: () => !!game.ready,
  state: () => {
    const p = game.player;
    const v = p && p.vehicle;
    return {
      mode: game.mode, frames: game.frames, pos: p ? p.position.toArray().map((n) => +n.toFixed(2)) : null, inCar: !!v,
      speed: v ? +v.speed.toFixed(2) : 0, heading: v ? +v.heading.toFixed(4) : null, wanted: game.police ? game.police.level : 0,
      order: game.assembly ? { running: game.assembly.running, stage: game.assembly.stage, stageT: +game.assembly.stageT.toFixed(3), number: game.assembly.number } : null,
      ownedCar: !!game.ownedCar, money: game.state.money, pumpkins: game.state.pumpkins.length, monsterMash: game.state.monsterMash,
      keysHeld: [...game.input.keys], inputClears: game.input.clearCount, lastClear: game.input.lastClearReason, errors: game.errors.slice(0, 5),
      drawCalls: game.renderer.info.render.calls, triangles: game.renderer.info.render.triangles, vehicles: game.vehicles.length,
      dialogue: game.dialogueLog.slice(-5), audio: game.audio.stats, kioskOpen: game.kiosk ? game.kiosk.isOpen : false, zone: game.zone,
      gate: game.cem ? +game.cem.gate.t.toFixed(2) : 0, objective: game.missions ? game.missions.step : null,
      fuel: v ? +v.fuel.toFixed(2) : null, health: game.combat ? Math.round(game.combat.health) : null, weapon: game.combat ? game.combat.current : null,
    };
  },
  assets: () => game.assets.stats,
  teleport: (x, z, y) => { const h = y ?? terrainHeight(x, z); if (game.player.vehicle) game.player.vehicle.teleport(new THREE.Vector3(x, h, z), game.player.vehicle.heading); else game.player.teleport(new THREE.Vector3(x, h + 0.1, z)); },
  faceCamera: (yaw) => (game.rig.yaw = yaw),
  start: () => $('btn-start').click(),
  openKiosk: () => { game.player.teleport(game.factory.kioskPos.clone().add(new THREE.Vector3(0, 0.1, 1.6))); game.openKiosk(); },
  kioskSet: (k, v) => game.kiosk.set(k, v),
  kioskTab: (t) => { game.kiosk.tab = t; game.kiosk.render(); },
  kioskConfirm: () => game.kiosk.confirm(),
  kioskCfg: () => ({ ...game.kiosk.cfg }),
  finishOrderNow: () => { const a = game.assembly; if (!a.running) return false; a.stage = 5; a.stageT = 0; a.rollout = 0.999; return true; },
  enterOwnedCar: () => game.ownedCar && game.enterVehicle(game.ownedCar),
  spawnTestCar: (cfg = {}, x = 76, z = -40, heading = 0) => {
    const vis = new CarVisual(game.assets, { ...DEFAULT_CONFIG, ...cfg });
    const v = new Vehicle(game, vis, { kind: 'player', position: new THREE.Vector3(x, terrainHeight(x, z), z), heading });
    v.owned = true; game.ownedCar = v;
    return v.id;
  },
  hingeTest: () => {
    const v = game.ownedCar || (game.assembly.visual && { visual: game.assembly.visual });
    if (!v) return null;
    const res = {};
    for (const [k, h] of Object.entries(v.visual.hinges)) {
      const before = h.node.rotation[h.axis];
      h.t = 1; h.node.rotation[h.axis] = h.base + h.open;
      const wp = new THREE.Vector3(); h.node.getWorldPosition(wp);
      res[k] = { axis: h.axis, open: h.open, rotated: +(h.node.rotation[h.axis] - before).toFixed(3), parent: h.node.parent.name, pivotWorld: wp.toArray().map((n) => +n.toFixed(2)) };
      h.t = 0; h.target = 0; h.node.rotation[h.axis] = h.base;
    }
    return res;
  },
  stealNearest: () => { const c = game.traffic.nearestCar(game.player.position, 6); if (!c) return false; game.stealCar(c); return true; },
  parkedCars: () => game.traffic.parked.map((p) => game.traffic.doorPoint(p.visual).toArray()),
  speak: (id) => game.say(id),
  pumpkinPositions: () => game.missions.pumpkins.map((p) => p.mesh.position.toArray()),
  setQuality: (q) => { game.manualQuality = true; game.setQuality(q); },
  shot: (x, y, z, lx, ly, lz) => { game.mode = 'photo'; game.camera.position.set(x, y, z); game.camera.lookAt(lx, ly, lz); game.rig.look.set(lx, ly, lz); },
  resume: () => { game.mode = 'play'; },
  police: () => ({ level: game.police.level, cars: game.police.cars.map((c) => ({ mode: c.mode, pos: [c.position.x, c.position.z].map((n) => +n.toFixed(1)), siren: !!c.vehicle.siren, parked: !!c.parked })),
    officers: game.police.officers.map((o) => ({ state: o.state, pos: [o.pos.x, o.pos.y, o.pos.z].map((n) => +n.toFixed(1)), armed: o.armed })), stats: game.police.stats }),
  events: () => game.events.log.slice(-60).map((e) => ({ k: e.k, t: e.t })),
  eventCount: (k) => game.events.log.filter((e) => e.k === k).length,
  // ---- phase 2 QA hooks
  npcAudit: () => game.npcs.audit(),
  npcCensus: () => {
    const c = {};
    for (const n of game.npcs.all()) { const a = (n.profile || n.char.profile || {}).ageGroup || 'none'; c[a] = (c[a] || 0) + 1; }
    const drivers = game.traffic.driving.map((d) => d.driver.profile.ageGroup);
    const kids = game.npcs.pedestrians.filter((p) => p.kid).map((p) => ({ scale: +p.char.root.scale.x.toFixed(2), costume: p.profile.costume, acc: p.char.acc }));
    return { census: c, drivers, kids: kids.slice(0, 6), kidCount: kids.length };
  },
  buildings: () => game.buildings.list.map((b) => ({ id: b.id, kind: b.kind, name: b.name, doors: Object.keys(b.doors), switches: b.switches.length, loot: b.loot.length, shop: b.shop.length, panes: b.panes.length,
    lightsOn: b.lightsOn, power: b.power, spots: Object.fromEntries(Object.entries(b.spots).map(([k, p]) => [k, p.toArray().map((n) => +n.toFixed(2))])),
    box: [b.box.min.x, b.box.min.z, b.box.max.x, b.box.max.z].map((n) => +n.toFixed(1)) })),
  door: (bid, name) => { const d = game.buildings.list[bid].doors[name]; return d && { t: +d.t.toFixed(2), target: d.target, locked: d.locked, center: d.center.toArray().map((n) => +n.toFixed(2)) }; },
  insideBuilding: () => { const b = game.buildings.inside(game.player.position); return b ? { id: b.id, kind: b.kind } : null; },
  lightLevel: (bid) => { const b = game.buildings.list[bid]; return { lightsOn: b.lightsOn, power: b.power, fixture: b.fixtureMat ? b.fixtureMat.emissiveIntensity : null, sources: b.sources.map((s) => (s.on ? s.intensity : 0)) }; },
  faceTo: (x, z) => { const p = game.player.position; game.player.facing = Math.atan2(x - p.x, z - p.z); game.rig.yaw = game.player.facing + Math.PI; },
  jumbo: () => ({ frames: game.jumbotron.frames, overlay: game.jumbotron.overlayFrames, faces: game.jumbotron.faces.length }),
  carries: () => game.assembly.carries.map((c) => ({ name: c.name, phase: c.phase, maxGap: c.maxGap ? +c.maxGap.toFixed(2) : null, visible: c.clone.visible })),
  factoryStats: () => ({ ...game.factory.stats, nightShift: !!game.factory.nightShift }),
  seated: () => ({
    traffic: game.traffic.driving.map((d) => ({ seated: !!d.driver.seated && d.driver.root.parent === d.visual.root, anim: d.driver.anim, scale: d.driver.root.scale.x })),
    police: game.police.cars.map((c) => ({ seated: !!(c.officer && c.officer.state === 'seated' && c.officer.char.root.parent === c.vehicle.visual.root) })),
    forklift: !!(game.npcs.forkDriver && game.npcs.forkDriver.seated && game.npcs.forkDriver.root.parent === game.factory.forklift),
    glass: (() => { let o = null; game.assets.models.car_sedan.traverse((m) => { if (m.isMesh && m.material.name === 'Glass') o = { opacity: m.material.opacity, roughness: m.material.roughness, metalness: m.material.metalness }; }); return o; })(),
  }),
  wheelSteer: () => { const d = game.traffic.driving[0]; return d && { steer: +d.steer.toFixed(3), wheel: +d.visual.n.SteeringWheel.rotation.z.toFixed(3), armL: +d.driver.j.UpperArm_L.rotation.x.toFixed(3) }; },
  trafficSnapshot: () => game.traffic.driving.map((c) => { const p = c.body.position; return { x: +p.x.toFixed(1), y: +p.y.toFixed(2), z: +p.z.toFixed(1), ground: +terrainHeight(p.x, p.z).toFixed(2), seg: c.seg.kind, speed: +c.speed.toFixed(1) }; }),
  /** Height of whatever a vehicle rests on: ray straight down from just above its wheel-contact level (statics + other cars). */
  supportY: (x, y, z) => { const hit = game.physics.rayAny(new THREE.Vector3(x, y + 0.05, z), new THREE.Vector3(x, y - 6, z), 1 | 2); return hit ? Math.max(hit.point.y, terrainHeight(x, z)) : terrainHeight(x, z); },
  vehicleSnapshot: () => game.vehicles.map((v) => { const p = v.body.position; return { kind: v.kind, x: +p.x.toFixed(1), y: +p.y.toFixed(2), z: +p.z.toFixed(1), ground: +terrainHeight(p.x, p.z).toFixed(2), v: +v.body.velocity.length().toFixed(1), w: +v.body.angularVelocity.length().toFixed(1) }; }),
  physicsStats: () => ({ ...game.physics.stats, traffic: game.traffic.stats, nav: game.nav.stats, policeResets: game.police.stats.resets }),
  wanted: (n) => { game.police.level = 0; game.police.crime('qa_test', n); },
  give: (id, ammo = 30) => game.combat.give(id, ammo),
  fireAt: (x, y, z) => game.combat.fire(new THREE.Vector3(x, y, z)),
  combat: () => ({ ...game.combat.hudState(), stats: game.combat.stats, log: game.combat.log.slice(-6) }),
  interact: () => { const it = game._interaction(); if (it) it.act(); return it ? it.text : null; },
  prompt: () => { const it = game._interaction(); return it ? it.text : null; },
  burglary: () => ({ ...game.burglary.stats, bag: game.burglary.bag.length, carrying: game.player.carrying ? game.player.carrying.name : null,
    trunks: game.vehicles.filter((v) => v.trunk && v.trunk.length).map((v) => ({ id: v.id, items: v.trunk.map((i) => i.kind), visible: v.trunk.map((i) => i.mesh.visible) })) }),
  homeowners: () => game.npcs.homeowners.map((h) => ({ state: h.state, ageGroup: h.profile.ageGroup, pos: h.char.root.position.toArray().map((n) => +n.toFixed(2)) })),
  loot: (bid) => game.burglary.items.filter((i) => i.building && (bid === undefined || i.building.id === bid)).map((i) => ({ kind: i.kind, value: i.value, heavy: i.heavy, taken: i.taken, pos: i.mesh.position.toArray().map((n) => +n.toFixed(2)) })),
  pumps: () => game.fuel.pumps.map((p) => p.pos.toArray().map((n) => +n.toFixed(2))),
  fuelState: () => { const v = game.player.vehicle || game.ownedCar; return v && { fuel: +v.fuel.toFixed(2), stalled: v.stalled, session: !!game.fuel.session, stats: game.fuel.stats }; },
  setFuel: (n) => { const v = game.player.vehicle || game.ownedCar; if (v) { v.fuel = n; v.stalled = n <= 0; } },
  nav: (x, z) => { const a = game.nav.nearest(game.player.position), b = game.nav.nearest(new THREE.Vector3(x, terrainHeight(x, z), z)); const path = game.nav.path(a, b); return path ? path.map((n) => [n.p.x, n.p.z].map((k) => +k.toFixed(1))) : null; },
};
game.init().catch((e) => { console.error(e); $('loadtext').textContent = 'Error: ' + e.message; game.errors.push(String(e.stack || e)); });
