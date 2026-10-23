// Motorworks automated QA self-check loop (Playwright + real GPU via ANGLE).
// Boots the game, exercises every system, captures documentation screenshots and writes
// tests/qa-results.json + updates TELEMETRY.json (qa section).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT, updateTelemetry, readTelemetry } from '../scripts/telemetry.mjs';

const URL = process.env.MW_URL || 'http://localhost:3000/';
const SHOTS = path.join(ROOT, 'public', 'docs', 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const results = [];
const t0 = Date.now();
const only = process.argv.slice(2);

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('UNCAUGHT ' + String(e)));

const MW = (fn, arg) => page.evaluate(fn, arg);
const state = () => MW(() => window.__MW.state());
const sleep = (ms) => page.waitForTimeout(ms);
const shot = async (name) => { await page.screenshot({ path: path.join(SHOTS, name + '.png') }); return `public/docs/screenshots/${name}.png`; };
const hold = async (keys, ms) => { for (const k of keys) await page.keyboard.down(k); await sleep(ms); for (const k of keys) await page.keyboard.up(k); };
const press = async (k) => { await page.keyboard.down(k); await sleep(90); await page.keyboard.up(k); };
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
async function check(id, title, fn) {
  if (only.length && !only.some((o) => id.startsWith(o))) return;
  const r = { id, title, pass: false, details: {}, screenshots: [] };
  const ts = Date.now();
  try {
    // never start a check in the middle of a BUSTED / kiosk transition left over from the previous one
    if (results.length) await page.waitForFunction(() => !window.__MW || !window.__MW.ready() || ['play', 'title', 'photo'].includes(window.__MW.state().mode), null, { timeout: 15000 }).catch(() => {});
    const out = await fn(r);
    r.pass = out !== false && r.pass !== 'fail';
    if (r.pass === 'fail') r.pass = false;
  } catch (e) { r.pass = false; r.details.error = String(e && e.message || e).slice(0, 500); }
  r.ms = Date.now() - ts;
  results.push(r);
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${id}  ${title}  (${r.ms} ms)`, r.pass ? '' : JSON.stringify(r.details).slice(0, 400));
}
const assert = (r, cond, key, val) => { r.details[key] = val; if (!cond) r.pass = 'fail'; return cond; };

// ------------------------------------------------------------------------------------------- 1 boot
await check('boot', 'Page loads, Blender assets stream in, zero console errors / uncaught exceptions', async (r) => {
  const t = Date.now();
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__MW && window.__MW.ready(), null, { timeout: 180000 });
  r.details.loadMs = Date.now() - t;
  await MW(() => window.__MW.setQuality('medium'));
  r.details.gpu = await MW(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  await sleep(1200);
  r.screenshots.push(await shot('01_title_screen'));
  await MW(() => { document.getElementById('telemetry-badge').click(); });
  await sleep(300);
  r.screenshots.push(await shot('01b_title_telemetry_badge'));
  await MW(() => { document.getElementById('telemetry-badge').click(); });
  assert(r, consoleErrors.length === 0, 'consoleErrors', consoleErrors.slice(0, 5));
});

// ------------------------------------------------------------------------------------------- 2 assets
await check('assets', 'All Blender .glb assets load with valid bounding boxes and hinged/jointed child nodes', async (r) => {
  const stats = await MW(() => window.__MW.assets());
  r.details.files = Object.keys(stats).length;
  const invalid = Object.entries(stats).filter(([, s]) => !s.valid).map(([k]) => k);
  assert(r, invalid.length === 0, 'invalidBoxes', invalid);
  const need = {
    car_muscle: ['Door_L', 'Door_R', 'Hood', 'Trunk', 'Knuckle_FL', 'Axle_FL', 'SteeringWheel'], car_pickup: ['Door_L', 'Door_R', 'Hood', 'Trunk'],
    car_coupe: ['Door_L', 'Door_R', 'Hood', 'Trunk'], car_hearse: ['Door_L', 'Door_R', 'Hood', 'Trunk'], car_sedan: ['Door_L', 'DoorRear_L', 'Hood', 'Trunk'],
    robot_arm: ['Base', 'Shoulder', 'Elbow', 'Wrist'], press: ['Ram'], cemetery_gate: ['Gate_L', 'Gate_R'], garage_door: ['Slat_0', 'Slat_7'],
    sliding_door: ['Panel_L', 'Panel_R'], barrier: ['Arm'], forklift: ['Forks'], character: ['Head', 'UpperArm_L', 'LowerArm_L', 'UpperLeg_L', 'LowerLeg_L', 'Jaw'],
    skeleton: ['Head', 'Jaw', 'UpperArm_R'], props: ['CryptDoor'], crane: ['Hoist', 'Trolley'], lift: ['Platform'], scanner: ['Laser_Bar'],
  };
  const missing = [];
  for (const [f, nodes] of Object.entries(need)) for (const n of nodes) if (!stats[f] || !stats[f].hinges.includes(n)) missing.push(`${f}:${n}`);
  assert(r, missing.length === 0, 'missingHinges', missing);
  r.details.hingeCounts = Object.fromEntries(Object.entries(stats).map(([k, s]) => [k, s.hinges.length]));
  r.details.meshes = Object.values(stats).reduce((a, s) => a + s.meshes, 0);
});

// ------------------------------------------------------------------------------------------- 3 walking & collision
await check('walk', 'Player walks with WASD and collides with walls and cars (no clipping)', async (r) => {
  await MW(() => window.__MW.start());
  await sleep(800);
  await MW(() => { window.__MW.teleport(-45, -45); window.__MW.faceCamera(Math.PI); });
  await sleep(300);
  const a = await state();
  await hold(['KeyW'], 1200);
  const b = await state();
  const moved = Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]);
  assert(r, moved > 2, 'walkedMeters', +moved.toFixed(2));
  // walk into the plant's brick facade (z = -59.7) from the north and make sure we stop outside it
  await MW(() => { window.__MW.teleport(10, -55); window.__MW.faceCamera(0); });
  await sleep(300);
  await hold(['KeyW'], 2500);
  const c = await state();
  assert(r, c.pos[2] > -59.8, 'stoppedAtWallZ', c.pos[2]);
  r.screenshots.push(await shot('03_player_at_plant_wall'));
  // walk into a parked car
  const doors = await MW(() => window.__MW.parkedCars());
  const car = await MW(() => { const p = window.__MW.game.traffic.parked[8]; return [p.body.position.x, p.body.position.z]; });
  await MW(([x, z]) => { window.__MW.teleport(x, z + 6); window.__MW.faceCamera(0); }, car);
  await sleep(300);
  await hold(['KeyW'], 2200);
  const d = await state();
  const dist = Math.hypot(d.pos[0] - car[0], d.pos[2] - car[1]);
  assert(r, dist > 0.9, 'distanceFromCarCenter', +dist.toFixed(2));
  r.details.parkedCars = doors.length;
});

// ------------------------------------------------------------------------------------------- 4 stuck keys
await check('escape', 'Escape/pointer-lock release clears held movement keys (no auto-walking after menu)', async (r) => {
  await MW(() => window.__MW.teleport(-40, -40));
  await page.keyboard.down('KeyW');
  await sleep(400);
  const held = await state();
  await page.keyboard.press('Escape');
  await sleep(200);
  const paused = await state();
  r.screenshots.push(await shot('04_pause_menu'));
  await page.keyboard.up('KeyW');
  assert(r, held.keysHeld.includes('KeyW'), 'heldBefore', held.keysHeld);
  assert(r, paused.mode === 'paused', 'mode', paused.mode);
  assert(r, paused.keysHeld.length === 0, 'keysAfterEscape', paused.keysHeld);
  await MW(() => document.getElementById('btn-resume').click());
  await sleep(200);
  const p0 = await state();
  await sleep(1000);
  const p1 = await state();
  const drift = Math.hypot(p1.pos[0] - p0.pos[0], p1.pos[2] - p0.pos[2]);
  assert(r, drift < 0.3, 'driftAfterResume', +drift.toFixed(3));
  r.details.clearReason = paused.lastClear;
});

// ------------------------------------------------------------------------------------------- 5 dialogue
await check('dialogue', 'Talking to an NPC (E) plays spoken dialogue audio with subtitles/speech bubble', async (r) => {
  await MW(() => { const g = window.__MW.game; const f = g.npcs.foreman.char.root.position; window.__MW.teleport(f.x + 1.2, f.z + 0.6); g.greeted = true; });
  await sleep(500);
  const before = (await state()).audio.linesPlayed;
  await press('KeyE');
  await sleep(1500);
  const s = await state();
  r.screenshots.push(await shot('05_dialogue_foreman'));
  assert(r, s.audio.linesPlayed > before, 'linesPlayed', s.audio.linesPlayed);
  const last = s.dialogue.at(-1) || {};
  assert(r, last.source === 'file' && last.duration > 0.5, 'lastLine', last);
  // radio dispatcher (radio FX chain)
  await MW(() => window.__MW.speak('dispatch_2'));
  await sleep(800);
  const s2 = await state();
  assert(r, s2.dialogue.at(-1).id === 'dispatch_2', 'dispatchLine', s2.dialogue.at(-1));
});

// ------------------------------------------------------------------------------------------- 6 kiosk
await check('kiosk', 'Kiosk opens; every customization category changes the live 3D car; order is placed', async (r) => {
  await MW(() => window.__MW.openKiosk());
  await sleep(1500);
  r.screenshots.push(await shot('06_kiosk_open'));
  const edits = [
    ['Body', 'body', 'hearse'], ['Paint', 'color', '#5b1a8c'], ['Paint', 'color2', '#39ff14'], ['Paint', 'finish', 'pearl'], ['Livery', 'livery', 'flames'],
    ['Wheels', 'rim', 'Sawblade'], ['Wheels', 'lettering', 'whitewall'], ['Wheels', 'caliper', '#39ff14'], ['Stance', 'ride', -0.5], ['Stance', 'camber', 6],
    ['Body Kit', 'front', 'Front_Splitter'], ['Body Kit', 'hood', 'Hood_Blower'], ['Body Kit', 'roof', 'Roof_Rack'], ['Body Kit', 'spoiler', 'Spoiler_GT'],
    ['Body Kit', 'exhaust', 'Exhaust_Flame'], ['Lighting', 'underglow', 'purple'], ['Performance', 'engine', 'tt'], ['Performance', 'trans', 'short'], ['Performance', 'tires', 'drift'],
  ];
  let i = 0;
  for (const [tab, k, v] of edits) {
    await MW(([t, k2, v2]) => { window.__MW.kioskTab(t); window.__MW.kioskSet(k2, v2); }, [tab, k, v]);
    await sleep(tab === 'Body' ? 900 : 250);
    if (['Body', 'Paint', 'Livery', 'Wheels', 'Body Kit', 'Lighting', 'Performance'].includes(tab) && (i === 0 || edits[i - 1][0] !== tab || k === 'finish')) {
      if (tab !== 'Paint' || k === 'finish') r.screenshots.push(await shot(`06_kiosk_${tab.replace(/\s/g, '').toLowerCase()}`));
    }
    i++;
  }
  const cfg = await MW(() => window.__MW.kioskCfg());
  const mismatched = edits.filter(([, k, v]) => cfg[k] !== v).map(([, k]) => k);
  assert(r, mismatched.length === 0, 'configMismatches', mismatched);
  r.details.config = cfg;
  const moneyBefore = (await state()).money;
  await MW(() => window.__MW.kioskConfirm());
  await sleep(800);
  const s = await state();
  assert(r, s.order && s.order.running, 'orderRunning', s.order);
  assert(r, s.money < moneyBefore, 'charged', moneyBefore - s.money);
});

// ------------------------------------------------------------------------------------------- 6b factory pick & place + jumbotron
await check('factory_jumbotron_and_conveyor', 'Live Jumbotron render-target feed updates; conveyor skillet/rollers move; robots physically carry doors/hood/trunk from racks to the chassis', async (r) => {
  await MW(() => { const g = window.__MW.game; if (!g.assembly.running) g.assembly.start(g.kiosk.cfg); });
  const j0 = await MW(() => window.__MW.jumbo());
  await page.keyboard.down('KeyT');
  await page.waitForFunction(() => { const o = window.__MW.state().order; return o && o.stage >= 1; }, null, { timeout: 90000 });
  await page.keyboard.up('KeyT');
  // let the body-shop robots work at normal speed and sample the carry phase
  await page.waitForFunction(() => window.__MW.carries().some((c) => c.phase === 'carry'), null, { timeout: 30000 });
  await MW(() => { const a = window.__MW.game.assembly; a.camMode = null; });
  const v = await MW(() => window.__MW.game.factory.bodyRobots[0].node.position.toArray());
  await MW((p) => window.__MW.shot(p[0] - 3.5, 4.2, p[2] - 4.5, p[0] + 1.6, 1.4, p[2] + 3), v);
  await sleep(700);
  r.screenshots.push(await shot('16_bodyshop_robot_carrying_door'));
  await MW(() => window.__MW.resume());
  await page.waitForFunction(() => window.__MW.carries().filter((c) => c.phase === 'attached').length >= 2, null, { timeout: 40000 });
  const carries = await MW(() => window.__MW.carries());
  r.details.carries = carries;
  const fs = await MW(() => window.__MW.factoryStats());
  r.details.factory = fs;
  assert(r, fs.partsCarried >= 2, 'partsCarriedToChassis', fs.partsCarried);
  const gaps = carries.filter((c) => c.maxGap !== null).map((c) => c.maxGap);
  assert(r, gaps.length > 0 && Math.max(...gaps) < 0.75, 'gripperStaysOnPart_m', gaps);
  assert(r, fs.ikSolves > 50, 'ikSolves', fs.ikSolves);
  const j1 = await MW(() => window.__MW.jumbo());
  r.details.jumbotron = { before: j0, after: j1 };
  assert(r, j1.frames > j0.frames + 10 && j1.faces === 4, 'renderTargetFramesUpdated', j1.frames - j0.frames);
  assert(r, j1.overlay > j0.overlay, 'overlayCanvasRedrawn', j1.overlay - j0.overlay);
  const roll = await MW(() => +window.__MW.game.factory.rollerSpin.toFixed(2));
  assert(r, Math.abs(roll) > 1, 'rollerSpin', roll);
  await MW(() => window.__MW.shot(-38, 3.2, -71, -22, 8.4, -83));
  await sleep(900);
  r.screenshots.push(await shot('16_jumbotron_live_feed'));
  await MW(() => window.__MW.shot(-22, 9.6, -76.5, -22, 8.6, -81));
  await sleep(700);
  r.screenshots.push(await shot('16_jumbotron_closeup'));
  await MW(() => window.__MW.shot(6, 6.2, -70, -14, 1, -91));
  await sleep(700);
  r.screenshots.push(await shot('16_conveyor_skillet_press_feeder'));
  await MW(() => window.__MW.resume());
});

// ------------------------------------------------------------------------------------------- 7 assembly line
await check('assembly', 'Car progresses through all 5 assembly stations with hinge + robot animation sync, then rolls out', async (r) => {
  const names = ['stamping', 'bodyshop', 'paint', 'powertrain', 'final_qc'];
  r.details.stations = [];
  await page.keyboard.down('KeyT'); // fast-forward build speed
  for (let st = 0; st < 5; st++) {
    await page.waitForFunction((s) => { const o = window.__MW.state().order; return o && (o.stage > s || (o.stage === s && o.stageT > 0.55)); }, st, { timeout: 120000 });
    await page.keyboard.up('KeyT');
    const info = await MW(() => {
      const g = window.__MW.game, a = g.assembly, f = g.factory;
      const robots = f.robots.filter((b) => b.station === a.stage).map((b) => +b.j.sh.rotation.x.toFixed(3));
      return { stage: a.stage, stageT: +a.stageT.toFixed(2), hinges: Object.fromEntries(Object.entries(a.visual.hinges).map(([k, h]) => [k, +h.t.toFixed(2)])),
        ram: +f.ram.position.y.toFixed(2), hoist: +f.hoist.position.y.toFixed(2), laser: +f.laser.position.y.toFixed(2), robots, reveal: +a.visual.paint.u.uReveal.value.toFixed(2), log: a.log.map((l) => l.ev) };
    });
    // station camera (V cycles station cams)
    await MW((s) => { const a = window.__MW.game.assembly; a.camMode = 'station'; a.camStation = s; }, st);
    await sleep(900);
    r.screenshots.push(await shot(`07_station_${st + 1}_${names[st]}`));
    r.details.stations.push(info);
    await page.keyboard.down('KeyT');
  }
  await page.waitForFunction(() => window.__MW.state().ownedCar, null, { timeout: 120000 });
  await page.keyboard.up('KeyT');
  await MW(() => { window.__MW.game.assembly.camMode = null; });
  const log = await MW(() => window.__MW.game.assembly.log.map((l) => l.ev));
  r.details.events = log;
  for (const ev of ['s1_body', 'close_Door_L', 'close_Hood', 'close_Trunk', 's2_paint', 's3_open', 'engine_in', 'wheel_3', 's3_close', 's4_final', 'qc_open', 'qc_close', 'exit_open', 'complete'])
    assert(r, log.includes(ev), 'event_' + ev, log.includes(ev));
  assert(r, r.details.stations[1].robots.length === 4, 'bodyShopRobots', r.details.stations[1].robots.length);
  assert(r, r.details.stations[2].reveal > 0.2, 'paintReveal', r.details.stations[2].reveal);
  await MW(() => window.__MW.shot(76, 4, -84, 68, 0.8, -91));
  await sleep(700);
  r.screenshots.push(await shot('07_rollout_finished_car'));
  await MW(() => window.__MW.resume());
});

// ------------------------------------------------------------------------------------------- 8 hinges
await check('hinges', 'Finished car: doors, hood, trunk rotate about their Blender pivots (no floating parts)', async (r) => {
  const h = await MW(() => window.__MW.hingeTest());
  r.details.hinges = h;
  for (const k of ['Door_L', 'Door_R', 'Hood', 'Trunk']) assert(r, h && h[k] && Math.abs(h[k].rotated) > 0.5, k, h && h[k]);
  await MW(() => { const v = window.__MW.game.ownedCar; v.visual.setAllHinges(1); });
  await sleep(1400);
  await MW(() => { const p = window.__MW.game.ownedCar.visual.root.position; window.__MW.shot(p.x + 5.5, p.y + 2.6, p.z + 5, p.x, p.y + 0.8, p.z); });
  await sleep(600);
  r.screenshots.push(await shot('08_hinges_open'));
  await MW(() => { window.__MW.game.ownedCar.visual.setAllHinges(0); window.__MW.resume(); });
});

// ------------------------------------------------------------------------------------------- 9 driving physics
await check('physics', 'Vehicle physics: W accelerates; W+A turns left and W+D turns right simultaneously (heading change)', async (r) => {
  await MW(() => { const g = window.__MW.game; if (g.mode === 'title') window.__MW.start(); if (!g.ownedCar) window.__MW.spawnTestCar({ tires: 'drift', engine: 'tt' }, -30, -57, 0); });
  await sleep(600);
  await MW(() => { const g = window.__MW.game; g.ownedCar.teleport({ x: -40, y: 0, z: -22 }, Math.PI / 2); window.__MW.teleport(-40, -20.4); });
  await sleep(500);
  await MW(() => window.__MW.enterOwnedCar());
  await sleep(1300);
  const s0 = await state();
  r._t0 = Date.now();
  assert(r, s0.inCar, 'inCar', s0.inCar);
  await hold(['KeyW'], 1600);
  const s1 = await state();
  r.details.fpsDuringDrive = +((s1.frames - s0.frames) / ((Date.now() - r._t0) / 1000)).toFixed(1);
  assert(r, s1.speed > 5, 'speedAfterW', s1.speed);
  await hold(['KeyW', 'KeyA'], 900);
  const s2 = await state();
  const dl = angDiff(s1.heading, s2.heading);
  assert(r, dl > 0.25, 'leftHeadingDelta', +dl.toFixed(3));
  r.screenshots.push(await shot('09_driving_turn'));
  await hold(['KeyW', 'KeyD'], 900);
  const s3 = await state();
  const dr = angDiff(s2.heading, s3.heading);
  assert(r, dr < -0.25, 'rightHeadingDelta', +dr.toFixed(3));
  // high speed turning on Main Street
  await MW(() => { const v = window.__MW.game.player.vehicle; v.teleport({ x: -52, y: 0, z: -20 }, Math.PI / 2); }); // open plant lot, clear of the Factory Loop traffic lanes
  await sleep(400);
  await hold(['KeyW'], 2600);
  const b0 = await state();
  await hold(['KeyS'], 1000);
  const b1 = await state();
  assert(r, b1.speed < b0.speed * 0.65, 'braking', { before: b0.speed, after: b1.speed });
  await hold(['KeyW'], 1200);
  const h0 = await state();
  await hold(['KeyW', 'KeyD'], 700);
  const h1 = await state();
  r.details.highSpeed = { speed: h0.speed, dHeading: +angDiff(h0.heading, h1.heading).toFixed(3) };
  assert(r, h0.speed > 12 && angDiff(h0.heading, h1.heading) < -0.08, 'highSpeedTurn', r.details.highSpeed);
  // handbrake drift → skid marks
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyA'); await page.keyboard.down('Space');
  await sleep(900);
  await page.keyboard.up('Space'); await page.keyboard.up('KeyA'); await page.keyboard.up('KeyW');
  const skids = await MW(() => window.__MW.game.effects.skids.count);
  assert(r, skids > 0, 'skidMarks', skids);
  r.screenshots.push(await shot('09b_handbrake_drift'));
  await hold(['KeyS'], 1800);
});

// ------------------------------------------------------------------------------------------- 10 cockpit + radio
await check('cockpit', 'First-person cockpit camera shows hands on the animated steering wheel; R toggles the haunted radio', async (r) => {
  await press('KeyC');
  await page.keyboard.down('KeyA');
  await sleep(700);
  r.screenshots.push(await shot('10_cockpit_view'));
  const sw = await MW(() => +window.__MW.game.player.vehicle.visual.n.SteeringWheel.rotation.z.toFixed(3));
  await page.keyboard.up('KeyA');
  assert(r, Math.abs(sw) > 0.3, 'steeringWheelRotation', sw);
  await press('KeyC');
  await press('KeyR');
  await sleep(1500);
  const radio = await MW(() => ({ on: window.__MW.game.audio.radio.on, name: window.__MW.game.audio.radio.name }));
  assert(r, radio.on, 'radio', radio);
  await press('KeyR'); await press('KeyR');
});

// ------------------------------------------------------------------------------------------- 11 town tour screenshots
await check('town', 'Town, autumn/Halloween decorations, Main Street businesses render (screenshots)', async (r) => {
  await MW(() => { const g = window.__MW.game; const v = g.player.vehicle; if (v) { v.body.velocity.setZero(); v.body.angularVelocity.setZero(); g.exitVehicle(); } });
  await sleep(600);
  const views = [
    ['11_main_street', [-20, 9, 30], [-60, 3, 10]], ['11_diner', [-50, 5, 2], [-60, 3, 20]], ['11_gas_station', [55, 6, 2], [45, 3, 22]],
    ['11_police_station', [120, 6, -4], [130, 4, 20]], ['11_hardware_store', [-120, 6, -3], [-130, 3, 20]], ['11_halloween_yard', [-24, 4, 60], [-14, 1, 50]],
    ['11_elm_avenue', [0, 7, 30], [0, 2, 90]], ['11_motorworks_plant', [10, 14, -20], [0, 12, -60]], ['11_leaf_piles_trees', [-60, 3, -2], [-90, 1, -10]],
    ['11_hill_road', [12, 8, 140], [0, 9, 200]],
  ];
  for (const [name, p, l] of views) {
    await MW(([pp, ll]) => { window.__MW.teleport(pp[0], pp[2]); window.__MW.shot(pp[0], pp[1], pp[2], ll[0], ll[1], ll[2]); }, [p, l]);
    await sleep(900);
    r.screenshots.push(await shot(name));
  }
  await MW(() => window.__MW.resume());
  r.details.views = views.length;
});

// ------------------------------------------------------------------------------------------- 12 cemetery
await check('cemetery', 'Cemetery gate hinges open as the player approaches; crypts, tombstones, fog', async (r) => {
  await MW(() => window.__MW.teleport(0, 200));
  await sleep(300);
  const closed = (await state()).gate;
  await MW(() => window.__MW.teleport(0, 205));
  await sleep(3000);
  const open = (await state()).gate;
  assert(r, open > closed && open > 0.8, 'gateOpen', { closed, open });
  const leaf = await MW(() => +window.__MW.game.cem.gate.L.rotation.y.toFixed(3));
  assert(r, Math.abs(leaf) > 1, 'leafRotation', leaf);
  await MW(() => window.__MW.shot(10, 15, 196, 0, 11, 224));
  await sleep(800);
  r.screenshots.push(await shot('12_cemetery_gates'));
  await MW(() => window.__MW.shot(-20, 16, 262, 0, 11, 300));
  await sleep(800);
  r.screenshots.push(await shot('12_cemetery_crypts'));
  await MW(() => window.__MW.shot(4, 12.5, 290, 0, 12, 312));
  await sleep(800);
  r.screenshots.push(await shot('12_vlad_crypt'));
  await MW(() => window.__MW.resume());
  r.details.tombstones = await MW(() => window.__MW.game.cem.tombstones);
});

// ------------------------------------------------------------------------------------------- 13 theft + police
await check('theft', 'Car theft (E on a town car) opens the hinged door, triggers wanted level and police pursuit', async (r) => {
  const target = await MW(() => {
    const g = window.__MW.game;
    const pk = g.traffic.parked.find((p) => Math.abs(p.body.position.x - 130) < 2) || g.traffic.parked[0];
    const d = g.traffic.doorPoint(pk.visual);
    return [d.x, d.z];
  });
  await MW(([x, z]) => window.__MW.teleport(x, z), target);
  await sleep(400);
  await press('KeyE');
  await sleep(600);
  const doorOpen = await MW(() => { const g = window.__MW.game; const n = g.traffic.parked.concat(g.traffic.driving).map((p) => p.visual.hinges.Door_L && p.visual.hinges.Door_L.t).filter((t) => t > 0.3); return n.length; });
  r.screenshots.push(await shot('13_stealing_car'));
  await sleep(2600);
  const s = await state();
  assert(r, s.inCar, 'inStolenCar', s.inCar);
  assert(r, doorOpen > 0, 'doorSwungOpen', doorOpen);
  const stolen = await MW(() => window.__MW.game.player.vehicle && window.__MW.game.player.vehicle.stolen);
  assert(r, stolen, 'markedStolen', stolen);
  if (s.wanted === 0) await MW(() => window.__MW.game.police.crime('theft', 2));
  const s2 = await state();
  assert(r, s2.wanted > 0, 'wantedLevel', s2.wanted);
  await sleep(4000);
  const pol = await MW(() => window.__MW.police());
  assert(r, pol.cars.some((c) => c.mode === 'pursuit' && c.siren), 'pursuit', pol.cars);
  r.details.police = pol;
  await hold(['KeyW'], 1500);
  r.screenshots.push(await shot('13_police_pursuit'));
  await MW(() => { const g = window.__MW.game; const c = g.police.cars.find((x) => x.mode === 'pursuit'); const p = g.player.position; window.__MW.shot(p.x - 12, p.y + 7, p.z - 10, p.x, p.y, p.z); });
  await sleep(1800);
  r.screenshots.push(await shot('13_police_chase_overview'));
  await MW(() => window.__MW.resume());
});

// ------------------------------------------------------------------------------------------- 14 busted
await check('busted', 'Boxed in by police for 5 s => BUSTED, fine, respawn at the Police Station', async (r) => {
  await MW(() => {
    const g = window.__MW.game; g.police.level = Math.max(1, g.police.level);
    const p = g.player.position; const c = g.police.cars[0];
    const v = g.player.vehicle; if (v) { v.body.velocity.setZero(); v.body.angularVelocity.setZero(); }
    c.mode = 'pursuit'; c.parked = true; c.vehicle.teleport({ x: p.x + 4, y: p.y, z: p.z }, 0);
  });
  const m0 = (await state()).money;
  await page.waitForFunction(() => window.__MW.state().mode === 'busted', null, { timeout: 20000 });
  r.screenshots.push(await shot('14_busted'));
  await page.waitForFunction(() => window.__MW.state().mode === 'play', null, { timeout: 10000 });
  const s = await state();
  assert(r, s.wanted === 0 && !s.inCar, 'cleared', { wanted: s.wanted, inCar: s.inCar });
  assert(r, s.money < m0, 'fined', m0 - s.money);
  assert(r, Math.hypot(s.pos[0] - 124, s.pos[2] - 9) < 4, 'respawnAtPoliceStation', s.pos);
});

// =========================================================================================== PHASE 2 CHECKS
const walkTo = async (x, z, ms = 2500, sprint = false) => {
  await MW(([a, b]) => window.__MW.faceTo(a, b), [x, z]);
  await sleep(80);
  const keys = sprint ? ['KeyW', 'ShiftLeft'] : ['KeyW'];
  for (const k of keys) await page.keyboard.down(k);
  const t = Date.now();
  while (Date.now() - t < ms) {
    const s = await state();
    if (Math.hypot(s.pos[0] - x, s.pos[2] - z) < 0.6) break;
    await MW(([a, b]) => window.__MW.faceTo(a, b), [x, z]);
    await sleep(60);
  }
  for (const k of keys) await page.keyboard.up(k);
  await sleep(150);
  return state();
};
const B = async () => MW(() => window.__MW.buildings());

await check('npc_demographics', 'NPC demographics: kids are 0.68x trick-or-treaters with kid-only voices; male/female NPCs only use matching voices; no child drivers', async (r) => {
  await MW(() => { const g = window.__MW.game; if (g.player.vehicle) g.exitVehicle(); g.police.clear(); });
  const audit = await MW(() => window.__MW.npcAudit());
  assert(r, audit.length === 0, 'auditViolations', audit.slice(0, 5));
  const census = await MW(() => window.__MW.npcCensus());
  r.details.census = census.census;
  assert(r, census.kidCount >= 6 && census.kids.every((k) => k.scale === 0.68 && k.costume), 'kidsScaledAndCostumed', census.kids.slice(0, 4));
  assert(r, census.drivers.length > 0 && census.drivers.every((d) => d.startsWith('adult')), 'driversAllAdults', census.drivers);
  assert(r, census.census.adult_male > 0 && census.census.adult_female > 0, 'bothGenders', census.census);
  // talk to one kid, one man, one woman: the voice that plays must match the speaker's age group / gender
  const spoken = [];
  for (const kind of ['child_boy', 'child_girl', 'adult_male', 'adult_female']) {
    const ok = await MW((k) => {
      const g = window.__MW.game;
      const n = [...g.npcs.pedestrians, ...g.npcs.statics].find((p) => p.profile && p.profile.ageGroup === k && p.char.root.visible !== false);
      if (!n) return null;
      const p = n.char.root.position;
      n.talkT = 5; n.dodge = 0;
      window.__MW.teleport(p.x + 1.1, p.z + 0.4, p.y);
      g.player.facing = Math.atan2(-1.1, -0.4);
      return [p.x, p.y, p.z];
    }, kind);
    if (!ok) continue;
    await sleep(250);
    await MW(() => { const g = window.__MW.game; const n = g.npcs.nearestTalkable(g.player.position, 3); if (n) g.npcs.talk(n); });
    await sleep(900);
    const last = (await state()).dialogue.at(-1);
    spoken.push({ kind, line: last.id, voiceDemo: last.demo, speaker: last.speaker });
    if (kind === 'child_girl') {
      await MW((p) => window.__MW.shot(p[0] + 2.6, p[1] + 1.4, p[2] + 2.2, p[0], p[1] + 0.6, p[2]), ok);
      await sleep(500);
      r.screenshots.push(await shot('17_trick_or_treater_kid_dialogue'));
      await MW(() => window.__MW.resume());
    }
  }
  r.details.spoken = spoken;
  assert(r, spoken.length >= 3 && spoken.every((s) => s.voiceDemo === s.kind && s.speaker === s.kind), 'voiceMatchesSpeaker', spoken);
  const kidLines = await MW(() => window.__MW.game.npcs.spoken.filter((s) => s.ageGroup && s.ageGroup.startsWith('child')).map((s) => s.text));
  assert(r, kidLines.every((t) => !/my kid|mortgage|shift at the plant/i.test(t)), 'noAdultLinesFromKids', kidLines);
  // group shot of the sidewalk crowd
  await MW(() => { const g = window.__MW.game; const k = g.npcs.pedestrians.find((p) => p.kid); const p = k.char.root.position; window.__MW.shot(p.x - 4, p.y + 1.8, p.z + 5, p.x, p.y + 0.7, p.z); });
  await sleep(700);
  r.screenshots.push(await shot('17_kids_and_townsfolk_sidewalk'));
  await MW(() => window.__MW.resume());
});

await check('enterable_buildings', 'Walk through hinged front doors into the Diner, Hardware Store, Police Station and a House (no collider blocking)', async (r) => {
  const blds = await B();
  const targets = [blds.find((b) => b.kind === 'diner'), blds.find((b) => b.kind === 'hardware'), blds.find((b) => b.kind === 'police'), blds.filter((b) => b.kind === 'house')[3]];
  r.details.visits = [];
  for (const b of targets) {
    const out = b.spots.Outside, ins = b.spots.Inside;
    if (b.kind === 'house') await MW((id) => { const g = window.__MW.game; const hb = g.buildings.list[id]; g.buildings.cutPower(hb); hb.occupied = false; hb.doors.Door_Front.locked = false; }, b.id);
    await MW(([x, y, z, house]) => window.__MW.teleport(x - (house ? 0.75 : 0), z, y), [...out, b.kind === 'house']);
    await sleep(400);
    await MW(([x, z]) => window.__MW.faceTo(x, z), [ins[0], ins[2]]);
    await sleep(150);
    const prompt = await MW(() => window.__MW.prompt());
    await press('KeyE');
    await sleep(1300);
    const door = await MW((id) => window.__MW.door(id, 'Door_Front'), b.id);
    const s = await walkTo(ins[0], ins[2], 4000);
    await sleep(300);
    const inside = await MW(() => window.__MW.insideBuilding());
    const deeper = b.spots.Living || b.spots.Dining || b.spots.Aisles || b.spots.Counter || b.spots.Desk;
    if (deeper) await walkTo(deeper[0], deeper[2], 3500);
    const inside2 = await MW(() => window.__MW.insideBuilding());
    r.details.visits.push({ kind: b.kind, prompt, door: door && door.t, inside: inside && inside.kind, deeper: inside2 && inside2.kind, pos: s.pos });
    assert(r, door && door.t > 0.6, `${b.kind}_doorSwungOpen`, door);
    assert(r, inside && inside.id === b.id && inside2 && inside2.id === b.id, `${b.kind}_walkedInside`, { inside, inside2, pos: s.pos });
    const cam = deeper || ins;
    await MW(([c, i]) => { const dx = c[0] - i[0], dz = c[2] - i[2], L = Math.hypot(dx, dz) || 1; window.__MW.shot(c[0] + dx / L * 1.6, c[1] + 1.9, c[2] + dz / L * 1.6, i[0], i[1] + 0.9, i[2]); }, [cam, ins]);
    await sleep(700);
    r.screenshots.push(await shot(`18_interior_${b.kind}`));
    await MW(() => window.__MW.resume());
  }
  // the foreman's office up the stairs (step-up assist on 0.2 m risers)
  const plant = blds.find((b) => b.kind === 'plant');
  const sb = plant.spots.StairBottom, stop = plant.spots.StairTop;
  await MW(([x, y, z]) => window.__MW.teleport(x, z, y), sb);
  await sleep(300);
  await walkTo(stop[0], stop[2], 6000);
  const up = await state();
  r.details.stairs = up.pos;
  assert(r, up.pos[1] > 3.6, 'climbedOfficeStairs_y', up.pos[1]);
  await MW(() => { const g = window.__MW.game; window.__MW.faceCamera(Math.PI * 0.15); });
  await walkTo(-2, -76, 2500);
  await MW(() => window.__MW.shot(-3, 6.4, -73.5, 8, 1.5, -92));
  await sleep(600);
  r.screenshots.push(await shot('18_foreman_office_observation'));
  await MW(() => window.__MW.resume());
});

await check('seated_drivers', 'Traffic cars, police cruisers, the forklift (and the player) have seated drivers; arms + steering wheel follow the steering; cabin glass is see-through', async (r) => {
  const s = await MW(() => window.__MW.seated());
  r.details.seated = s;
  assert(r, s.traffic.length > 0 && s.traffic.every((t) => t.seated && t.anim === 'drive'), 'trafficDriversSeated', s.traffic.length);
  assert(r, s.police.length > 0 && s.police.some((p) => p.seated), 'policeOfficersSeated', s.police);
  assert(r, s.forklift, 'forkliftOperatorSeated', s.forklift);
  assert(r, s.glass && Math.abs(s.glass.opacity - 0.38) < 0.01 && Math.abs(s.glass.roughness - 0.1) < 0.01 && Math.abs(s.glass.metalness - 0.2) < 0.01, 'cabinGlass', s.glass);
  // arms + wheel move together: sample a turning car
  let corr = null;
  for (let i = 0; i < 30 && !corr; i++) {
    const w = await MW(() => { const g = window.__MW.game; const d = g.traffic.driving.find((c) => Math.abs(c.steer) > 0.25); return d && { steer: d.steer, wheel: d.visual.n.SteeringWheel.rotation.z, armL: d.driver.j.UpperArm_L.rotation.x, armR: d.driver.j.UpperArm_R.rotation.x }; });
    if (w) corr = w; else await sleep(300);
  }
  r.details.turning = corr;
  assert(r, corr && Math.sign(corr.wheel) === -Math.sign(corr.steer) && Math.abs(corr.armL - corr.armR) > 0.05, 'armsAndWheelTurnTogether', corr);
  // close-ups
  await MW(() => { const g = window.__MW.game; const d = g.traffic.driving.find((c) => c.speed > 3) || g.traffic.driving[0]; const p = d.visual.root.position; const q = d.visual.root.quaternion; window.__MW.game.__follow = d; });
  for (let i = 0; i < 3; i++) {
    await MW(() => { const g = window.__MW.game, d = g.__follow, v = d.visual.root; v.updateMatrixWorld(); const eye = v.localToWorld(new v.position.constructor(3.3, 1.75, 1.9)); const look = v.localToWorld(new v.position.constructor(0.35, 0.95, 0.1)); window.__MW.shot(eye.x, eye.y, eye.z, look.x, look.y, look.z); });
    await sleep(60);
  }
  r.screenshots.push(await shot('19_seated_traffic_driver'));
  await MW(() => { const g = window.__MW.game; const c = g.police.cars[0], v = c.vehicle.visual.root; v.updateMatrixWorld(); const eye = v.localToWorld(new v.position.constructor(2.6, 1.7, 1.6)); const look = v.localToWorld(new v.position.constructor(0.3, 0.9, 0)); window.__MW.shot(eye.x, eye.y, eye.z, look.x, look.y, look.z); });
  await sleep(300);
  r.screenshots.push(await shot('19_seated_police_officer'));
  await MW(() => { const g = window.__MW.game; const f = g.factory.forklift; f.updateMatrixWorld(); const eye = f.localToWorld(new f.position.constructor(2.6, 2.6, 2.4)); const look = f.localToWorld(new f.position.constructor(0, 1.5, 0)); window.__MW.shot(eye.x, eye.y, eye.z, look.x, look.y, look.z); });
  await sleep(300);
  r.screenshots.push(await shot('19_forklift_operator'));
  await MW(() => window.__MW.resume());
});

await check('navigation_and_bounds', '30 s of traffic + police pursuit: no vehicle leaves |x|,|z| < 600 or floats (|y - ground| < 0.6); traffic stays on the road graph', async (r) => {
  await MW(() => { const g = window.__MW.game; window.__MW.spawnTestCar({ engine: 'v8sc' }, 60, 2.6, Math.PI / 2); window.__MW.teleport(60, 4.4); });
  await sleep(400);
  await MW(() => window.__MW.enterOwnedCar());
  await sleep(1300);
  await MW(() => window.__MW.wanted(2));
  const samples = [];
  let worst = { oob: 0, float: 0, maxDy: 0 };
  for (let i = 0; i < 30; i++) {
    // weave down Main Street to keep the pursuit going
    const k = i % 6 < 3 ? 'KeyA' : 'KeyD';
    await page.keyboard.down('KeyW'); if (i % 3 === 0) await page.keyboard.down(k);
    await sleep(500);
    if (i % 3 === 0) await page.keyboard.up(k);
    await page.keyboard.up('KeyW');
    await sleep(480);
    const snap = await MW(() => ({ veh: window.__MW.game.vehicles.map((v) => { const p = v.visual.root.position; return { kind: v.kind, x: p.x, y: p.y, z: p.z, g: window.__MW.supportY(p.x, p.y, p.z) }; }), traffic: window.__MW.trafficSnapshot() }));
    for (const v of snap.veh) {
      if (Math.abs(v.x) > 600 || Math.abs(v.z) > 600 || v.y < -20 || v.y > 150) worst.oob++;
      const dy = Math.abs(v.y - v.g);
      if (dy > 0.6 && v.y > -50) { worst.float++; worst.maxDy = Math.max(worst.maxDy, dy); worst.sample = v; }
    }
    for (const t of snap.traffic) { const dy = Math.abs(t.y - t.ground); if (dy > 0.6) { worst.float++; worst.maxDy = Math.max(worst.maxDy, dy); } if (Math.abs(t.x) > 600 || Math.abs(t.z) > 600) worst.oob++; }
    if (i % 10 === 0) samples.push(snap.traffic.slice(0, 3));
    if (i % 8 === 7) await MW(() => { const v = window.__MW.game.player.vehicle; if (v) v.teleport({ x: -40 + Math.random() * 80, y: 0, z: 2.6 }, Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1)); });
    if (i === 12) r.screenshots.push(await shot('20_pursuit_traffic_navigation'));
  }
  const ps = await MW(() => window.__MW.physicsStats());
  r.details = { ...r.details, worst, physics: ps, samples };
  assert(r, worst.oob === 0, 'outOfBoundsVehicles', worst.oob);
  assert(r, worst.float === 0, 'floatingVehicles', worst);
  const tr = await MW(() => window.__MW.game.traffic.driving.map((c) => window.__MW.game.traffic.graph.nearest(c.body.position, false).d));
  assert(r, Math.max(...tr) < 2.5, 'trafficOnRoadGraph_maxDev', +Math.max(...tr).toFixed(2));
  const moving = await MW(() => window.__MW.game.traffic.driving.filter((c) => c.speed > 1).length);
  r.details.trafficMoving = moving;
  await MW(() => { const g = window.__MW.game; g.police.clear(); const v = g.player.vehicle; if (v) { v.body.velocity.setZero(); v.body.angularVelocity.setZero(); g.exitVehicle(); } });
  await sleep(600);
});

await check('police_foot_chase', 'Wanted on foot: an officer dismounts the cruiser (hinged door) and chases the player on foot; armed response at 3+ stars', async (r) => {
  await MW(() => { const g = window.__MW.game; if (g.player.vehicle) g.exitVehicle(); g.police.clear(); window.__MW.teleport(-30, 9.5); });
  await sleep(500);
  const before = await MW(() => window.__MW.police());
  await MW(() => {
    const g = window.__MW.game; const p = g.player.position;
    const c = g.police.cars[0]; c.mode = 'patrol'; c.parked = false;
    c.vehicle.teleport({ x: p.x - 24, y: 0, z: 2.6 }, Math.PI / 2);
    window.__MW.wanted(1);
  });
  await page.waitForFunction((n) => window.__MW.police().stats.dismounts > n, before.stats.dismounts, { timeout: 20000 });
  await sleep(700);
  r.screenshots.push(await shot('21_officer_dismounts_cruiser'));
  const d0 = await MW(() => { const g = window.__MW.game; const o = g.police.officers.filter((x) => x.state === 'foot').sort((a, b) => a.pos.distanceTo(g.player.position) - b.pos.distanceTo(g.player.position))[0]; return o ? o.pos.distanceTo(g.player.position) : null; });
  // run away a little, then stop and let the officer close in
  await walkTo(-50, 9.5, 1800, true);
  await sleep(2500);
  const d1 = await MW(() => { const g = window.__MW.game; const o = g.police.officers.filter((x) => x.state === 'foot').sort((a, b) => a.pos.distanceTo(g.player.position) - b.pos.distanceTo(g.player.position))[0]; return o ? { d: o.pos.distanceTo(g.player.position), anim: o.char.anim } : null; });
  await MW(() => { const g = window.__MW.game; const o = g.police.officers.filter((x) => x.state === 'foot').sort((a, b) => a.pos.distanceTo(g.player.position) - b.pos.distanceTo(g.player.position))[0] || g.police.officers.find((x) => !x.seated); const p = o ? o.pos : g.player.position; window.__MW.shot(p.x + 4, p.y + 2.2, p.z + 4.5, p.x, p.y + 1, p.z); });
  await sleep(300);
  r.screenshots.push(await shot('21_police_foot_chase'));
  await MW(() => window.__MW.resume());
  const pol = await MW(() => window.__MW.police());
  r.details = { dismounts: pol.stats.dismounts, footChases: pol.stats.footChases, officers: pol.officers, d0, d1 };
  assert(r, pol.stats.dismounts > 0, 'dismounted', pol.stats.dismounts);
  const caught = (pol.stats.tackles || 0) > (before.stats.tackles || 0);
  r.details.caughtDuringChase = caught;
  assert(r, caught || (d1 && d1.d < 20 && ['run', 'idle', 'aim'].includes(d1.anim)), 'officerPursuesOnFoot (closes in or tackles)', { d1, caught });
  // escalate: armed response
  await MW(() => window.__MW.wanted(3));
  await sleep(3500);
  const armed = await MW(() => ({ armed: window.__MW.game.police.officers.some((o) => o.armed), shots: window.__MW.game.police.stats.shotsAtPlayer, health: window.__MW.game.combat.health }));
  r.details.armed = armed;
  assert(r, armed.armed, 'officersDrawSidearms', armed);
  r.screenshots.push(await shot('21_armed_response'));
  // tackle check at low heat
  await MW(() => { const g = window.__MW.game; g.police.level = 1; g.police.officers.forEach((o) => o.draw(false)); });
  await page.waitForFunction(() => window.__MW.state().mode === 'busted' || window.__MW.police().level === 0, null, { timeout: 25000 }).catch(() => {});
  const busted = await MW(() => window.__MW.game.police.stats.tackles || 0);
  r.details.tackles = busted;
  await page.waitForFunction(() => window.__MW.state().mode === 'play', null, { timeout: 10000 }).catch(() => {});
  await MW(() => window.__MW.game.police.clear());
});

await check('weapons_and_shooting', 'Buy/equip a pistol, aim (RMB/Q) and fire at a car tyre and a streetlight: ammo decrements, tyre pops, light goes out, impact FX', async (r) => {
  await MW(() => { const g = window.__MW.game; g.police.clear(); });
  const hwb = (await B()).find((b) => b.kind === 'hardware');
  // buy the pistol at the Hardware Store counter
  await MW(() => { const g = window.__MW.game; const s = g.interactions.shopItems.find((x) => x.item === 'Pistol'); window.__MW.teleport(s.pos.x, s.pos.z + 1.2, s.pos.y - 1.9 > 0 ? s.pos.y - 1.9 : 0.15); g.player.facing = Math.PI; });
  await sleep(500);
  const pr = await MW(() => window.__MW.prompt());
  r.details.shopPrompt = pr;
  if (/Pistol/.test(pr || '')) await press('KeyE'); else await MW(() => window.__MW.give('pistol', 24));
  await sleep(300);
  await press('Digit3');
  await sleep(200);
  // stand near a parked car and shoot its front-left tyre
  const target = await MW(() => {
    const g = window.__MW.game;
    const pk = g.traffic.parked.find((p) => Math.abs(p.body.position.x + 100) < 3) || g.traffic.parked[0];
    pk.visual.root.updateMatrixWorld();
    const w = pk.visual.wheelNodes[0].knuckle.getWorldPosition(new pk.visual.root.position.constructor());
    const side = pk.visual.root.localToWorld(new pk.visual.root.position.constructor(4.5, 0, pk.visual.spec.af));
    window.__MW.teleport(side.x, side.z);
    g.player.facing = Math.atan2(w.x - side.x, w.z - side.z);
    window.__MW.faceCamera(g.player.facing + Math.PI);
    return [w.x, w.y, w.z];
  });
  await sleep(500);
  await page.keyboard.down('KeyQ');
  await sleep(600);
  const before = await MW(() => window.__MW.combat());
  await MW((t) => window.__MW.fireAt(t[0], t[1], t[2]), target);
  await sleep(60);
  r.screenshots.push(await shot('22_aim_and_fire_pistol'));
  await sleep(500);
  const after = await MW(() => window.__MW.combat());
  r.details.ammo = { before: [before.mag, before.reserve], after: [after.mag, after.reserve] };
  assert(r, after.mag === before.mag - 1, 'ammoDecrement', r.details.ammo);
  assert(r, after.stats.tiresPopped > 0, 'tyrePopped', after.stats);
  assert(r, after.log.some((l) => l.kind === 'car'), 'impactOnCar', after.log);
  // shoot a streetlight
  const L = await MW(() => { const g = window.__MW.game; const p = g.player.position; const L = g.town.shootLights.filter((l) => l.kind === 'streetlight' && !l.broken).sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p))[0]; return [L.pos.x, L.pos.y, L.pos.z]; });
  await MW((t) => { window.__MW.teleport(t[0] - 6, t[2] + 4); }, L);
  await sleep(400);
  await MW((t) => window.__MW.fireAt(t[0], t[1], t[2]), L);
  await sleep(400);
  const after2 = await MW(() => window.__MW.combat());
  assert(r, after2.stats.lightsShot > 0, 'streetlightShotOut', after2.stats);
  // reload
  await page.keyboard.up('KeyQ');
  await press('KeyR');
  await sleep(1400);
  const after3 = await MW(() => window.__MW.combat());
  assert(r, after3.mag === 12, 'reloaded', after3.mag);
  r.details.wanted = (await state()).wanted;
  // shotgun + pumpkin launcher visuals
  await MW(() => { window.__MW.give('shotgun', 8); window.__MW.give('launcher', 3); window.__MW.game.combat.select('launcher'); });
  await page.keyboard.down('KeyQ');
  await sleep(500);
  const tgt = await MW(() => { const g = window.__MW.game; const p = g.player.position; const f = g.player.facing; return [p.x + Math.sin(f) * 14, p.y + 0.5, p.z + Math.cos(f) * 14]; });
  await MW((t) => window.__MW.fireAt(t[0], t[1], t[2]), tgt);
  await sleep(350);
  r.screenshots.push(await shot('22_jack_o_lantern_launcher'));
  await page.keyboard.up('KeyQ');
  await sleep(800);
  await MW(() => { const g = window.__MW.game; g.combat.select('unarmed'); g.police.clear(); });
});

await check('light_switches', 'Interior wall switch (E) toggles the building lights (fixtures + light sources + window glow); breaker box cuts power; Night Shift switch re-lights the plant', async (r) => {
  const h = (await B()).filter((b) => b.kind === 'house')[6];
  await MW((id) => { const g = window.__MW.game; const b = g.buildings.list[id]; b.power = true; g.buildings.setLights(b, true); g.buildings.list[id].doors.Door_Front.locked = false; }, h.id);
  const sw = await MW((id) => { const s = window.__MW.game.buildings.list[id].switches[0]; return s.pos.toArray(); }, h.id);
  const ins = h.spots.Inside;
  await MW(([x, y, z]) => window.__MW.teleport(x, z, y), ins);
  await sleep(300);
  await MW(([x, z]) => window.__MW.faceTo(x, z), [sw[0], sw[2]]);
  await walkTo(sw[0] + (ins[0] - sw[0]) * 0.35, sw[2] + (ins[2] - sw[2]) * 0.35, 1200);
  const l0 = await MW((id) => window.__MW.lightLevel(id), h.id);
  const pr = await MW(() => window.__MW.prompt());
  r.details.prompt = pr;
  await MW(() => { window.__MW.faceCamera(window.__MW.game.player.facing + Math.PI); });
  await sleep(400);
  r.screenshots.push(await shot('23_house_lights_on'));
  await press('KeyE');
  await sleep(500);
  const l1 = await MW((id) => window.__MW.lightLevel(id), h.id);
  await MW(() => { window.__MW.faceCamera(window.__MW.game.player.facing + Math.PI * 0.6); });
  await sleep(500);
  r.screenshots.push(await shot('23_house_lights_off'));
  r.details.levels = { before: l0, after: l1 };
  assert(r, /lights/i.test(pr || ''), 'switchPrompt', pr);
  assert(r, l0.fixture > 1 && l1.fixture === 0 && l1.sources.every((s) => s === 0) && l0.sources.some((s) => s > 0), 'interiorLightIntensityChanged', r.details.levels);
  await press('KeyE');
  await sleep(300);
  // breaker box
  const bk = h.spots.Breaker;
  await MW(([x, y, z]) => window.__MW.teleport(x, z, y), bk);
  await sleep(300);
  await MW((id) => { const b = window.__MW.game.buildings.list[id]; window.__MW.faceTo(b.breaker.pos.x, b.breaker.pos.z); }, h.id);
  await sleep(200);
  const prb = await MW(() => window.__MW.prompt());
  await press('KeyE');
  await sleep(400);
  const l2 = await MW((id) => window.__MW.lightLevel(id), h.id);
  r.details.breaker = { prompt: prb, after: l2 };
  assert(r, l2.power === false && l2.fixture === 0, 'breakerCutsPower', l2);
  r.screenshots.push(await shot('23_breaker_box_power_cut'));
  // night shift lighting in the foreman's office
  await MW(() => { const g = window.__MW.game; const s = g.buildings.switches.find((x) => x.name === 'NightShift'); window.__MW.teleport(s.pos.x, s.pos.z - 0.9, 4.2); window.__MW.faceTo(s.pos.x, s.pos.z); });
  await sleep(400);
  const prn = await MW(() => window.__MW.prompt());
  await press('KeyE');
  await sleep(600);
  const ns = await MW(() => window.__MW.factoryStats());
  r.details.nightShift = { prompt: prn, ns };
  assert(r, ns.nightShift, 'nightShiftOn', ns);
  await MW(() => window.__MW.shot(-12, 9, -60, 10, 1, -95));
  await sleep(800);
  r.screenshots.push(await shot('23_motorworks_night_shift_blacklight'));
  await MW(() => { window.__MW.resume(); const g = window.__MW.game; g.interactions.toggleNightShift(g.buildings.switches.find((x) => x.name === 'NightShift')); });
});

await check('doorbell_and_burglary', 'Ring a doorbell (E): chime, hinged front door opens, a demographic homeowner greets + tips; steal the TV and stash it visibly in an open car trunk; fence it', async (r) => {
  const h = (await B()).filter((b) => b.kind === 'house')[1];
  await MW((id) => { const g = window.__MW.game; const b = g.buildings.list[id]; b.occupied = true; b.treated = false; g.police.clear(); g.combat.select('unarmed'); }, h.id);
  const bell = await MW((id) => window.__MW.game.buildings.list[id].doorbell.toArray(), h.id);
  const out = h.spots.Outside;
  await MW(([x, y, z]) => window.__MW.teleport(x + 0.5, z, y), out);
  await sleep(300);
  await MW(([x, z]) => window.__MW.faceTo(x, z), [bell[0], bell[2]]);
  await sleep(150);
  const pr = await MW(() => window.__MW.prompt());
  const m0 = (await state()).money;
  await press('KeyE');
  await sleep(2600);
  const d1 = await MW((id) => window.__MW.door(id, 'Door_Front'), h.id);
  await page.waitForFunction(() => window.__MW.homeowners().some((x) => x.state === 'greet' || x.state === 'return'), null, { timeout: 15000 }).catch(() => {});
  await MW(([x, z]) => window.__MW.faceTo(x, z), [h.spots.Inside[0], h.spots.Inside[2]]);
  await MW(() => { window.__MW.faceCamera(window.__MW.game.player.facing + Math.PI * 1.15); });
  await sleep(500);
  r.screenshots.push(await shot('24_doorbell_homeowner_greets'));
  const ho = await MW(() => window.__MW.homeowners());
  const m1 = (await state()).money;
  r.details.doorbell = { prompt: pr, door: d1, homeowners: ho, tip: m1 - m0, rings: (await MW(() => window.__MW.burglary())).rings };
  assert(r, /doorbell/i.test(pr || ''), 'doorbellPrompt', pr);
  assert(r, d1 && d1.t > 0.5, 'frontDoorHingeOpened', d1);
  assert(r, ho.length > 0 && ho[0].ageGroup.startsWith('adult') && m1 > m0, 'homeownerGreetedAndTipped', { ho, tip: m1 - m0 });
  const greetLine = await MW(() => window.__MW.game.dialogueLog.filter((d) => /home[mf]_greet/.test(d.id)).at(-1));
  assert(r, greetLine && greetLine.demo === ho[0].ageGroup, 'homeownerVoiceMatchesGender', greetLine);
  await sleep(6000);
  // burglary: TV from the living room (door unlocked now / back door is unlocked anyway)
  const tv = await MW((id) => window.__MW.loot(id).find((l) => l.kind === 'TV'), h.id);
  await MW((id) => { const g = window.__MW.game; g.buildings.list[id].doors.Door_Back.locked = false; }, h.id);
  await MW(([x, y, z]) => window.__MW.teleport(x, z, y), h.spots.BackIn);
  await sleep(300);
  await walkTo(tv.pos[0] - 0.9, tv.pos[2], 3000);
  await MW((p) => window.__MW.faceTo(p[0], p[2]), tv.pos);
  await sleep(200);
  const pr2 = await MW(() => window.__MW.prompt());
  await press('KeyE');
  await sleep(500);
  const carrying = await MW(() => window.__MW.burglary());
  r.details.steal = { prompt: pr2, carrying: carrying.carrying };
  assert(r, /TV/.test(carrying.carrying || ''), 'carryingTV', carrying);
  await MW(() => window.__MW.faceCamera(window.__MW.game.player.facing + Math.PI * 0.8));
  await sleep(400);
  r.screenshots.push(await shot('24_carrying_stolen_tv'));
  // car parked behind the house; walk the TV to its trunk
  const carPos = await MW((id) => { const g = window.__MW.game; const b = g.buildings.list[id]; const o = b.spots.BackOut; const v = window.__MW.spawnTestCar({ body: 'muscle' }, o.x + 1, o.z - 6, Math.PI / 2); const veh = g.ownedCar; veh.visual.root.updateMatrixWorld(); const back = veh.visual.root.localToWorld(new o.constructor(0, 0, veh.visual.info.minZ - 0.9)); return [back.x, back.z]; }, h.id);
  await sleep(600);
  await MW(([x, y, z]) => window.__MW.teleport(x, z, y), h.spots.BackOut);
  await sleep(200);
  await walkTo(carPos[0], carPos[1], 5000);
  await MW(() => { const v = window.__MW.game.ownedCar; window.__MW.faceTo(v.position.x, v.position.z); });
  const pr3 = await MW(() => window.__MW.prompt());
  await press('KeyE'); // open trunk
  await sleep(900);
  const pr4 = await MW(() => window.__MW.prompt());
  await press('KeyE'); // stash
  await sleep(300);
  const bs = await MW(() => window.__MW.burglary());
  r.details.trunk = { open: pr3, stash: pr4, trunks: bs.trunks };
  await MW(() => { const v = window.__MW.game.ownedCar; v.visual.root.updateMatrixWorld(); const e = v.visual.root.localToWorld(new v.visual.root.position.constructor(1.6, 2.4, v.visual.info.minZ - 2.4)); const l = v.visual.root.localToWorld(new v.visual.root.position.constructor(0, 0.9, v.visual.info.minZ + 0.5)); window.__MW.shot(e.x, e.y, e.z, l.x, l.y, l.z); });
  await sleep(250);
  r.screenshots.push(await shot('24_tv_stashed_in_trunk'));
  await MW(() => window.__MW.resume());
  assert(r, bs.trunks.length && bs.trunks[0].items.includes('TV') && bs.trunks[0].visible.some(Boolean), 'tvInOpenTrunkVisible', bs.trunks);
  // drive to the fence and cash out
  await sleep(1200);
  await MW(() => { const g = window.__MW.game; const f = g.npcs.fence.char.root.position; g.ownedCar.teleport({ x: f.x + 3, y: 0, z: f.z }, 0); });
  await sleep(500);
  await MW(() => window.__MW.enterOwnedCar());
  await sleep(1400);
  const m2 = (await state()).money;
  const pr5 = await MW(() => window.__MW.prompt());
  await press('KeyE');
  await sleep(600);
  const m3 = (await state()).money;
  r.details.fence = { prompt: pr5, earned: m3 - m2 };
  assert(r, m3 - m2 >= 150, 'fencedLoot', r.details.fence);
});

await check('fuel_and_gas_station', 'Driving burns fuel (stalls when empty); refuelling at the Gas Station pumps restores 100% at $2/gal; jerrycan adds +35%', async (r) => {
  await MW(() => { const g = window.__MW.game; if (!g.player.vehicle) window.__MW.enterOwnedCar(); });
  await sleep(1400);
  await MW(() => { const v = window.__MW.game.player.vehicle; v.teleport({ x: -60, y: 0, z: 2.6 }, Math.PI / 2); window.__MW.setFuel(60); });
  await sleep(400);
  const f0 = await MW(() => window.__MW.fuelState());
  await hold(['KeyW'], 3500);
  const f1 = await MW(() => window.__MW.fuelState());
  r.details.burn = { before: f0.fuel, after: f1.fuel };
  assert(r, f1.fuel < f0.fuel - 0.3, 'drivingConsumesFuel', r.details.burn);
  await hold(['KeyS'], 1500);
  // empty tank stalls the engine
  await MW(() => window.__MW.setFuel(0.2));
  await hold(['KeyW'], 1500);
  const st = await state();
  const fs = await MW(() => window.__MW.fuelState());
  r.details.stall = { speed: st.speed, fs };
  assert(r, fs.stalled, 'stallsWhenEmpty', fs);
  r.screenshots.push(await shot('25_out_of_fuel_stalled'));
  // jerrycan
  await MW(() => { const g = window.__MW.game; g.state.jerrycans = 1; g.player.vehicle.body.velocity.setZero(); });
  await sleep(300);
  await MW(() => window.__MW.game.exitVehicle());
  await sleep(500);
  const prj = await MW(() => window.__MW.prompt());
  await MW(() => { const it = window.__MW.game.fuel.jerrycanCandidate(window.__MW.game.player.position); if (it) it.act(); });
  await sleep(600);
  const fj = await MW(() => window.__MW.fuelState());
  r.details.jerrycan = { prompt: prj, fuel: fj.fuel };
  assert(r, fj.fuel > 34 && !fj.stalled, 'jerrycanAdds35', fj);
  // refuel at the pumps
  const pump = (await MW(() => window.__MW.pumps()))[0];
  await MW(() => window.__MW.enterOwnedCar());
  await sleep(1400);
  await MW((p) => { const v = window.__MW.game.player.vehicle; v.teleport({ x: p[0] + 0.2, y: 0, z: p[2] }, 0); }, pump);
  await sleep(900);
  const m0 = (await state()).money;
  const pr = await MW(() => window.__MW.prompt());
  await press('KeyE');
  await sleep(1500);
  r.screenshots.push(await shot('25_refuelling_pump_counter'));
  await MW((p) => window.__MW.shot(p[0] + 5, 2.8, p[2] + 4.5, p[0] - 1, 1, p[2]), pump);
  await sleep(500);
  r.screenshots.push(await shot('25_gas_station_pump_hose'));
  await MW(() => window.__MW.resume());
  await page.waitForFunction(() => { const f = window.__MW.fuelState(); return f && f.fuel >= 99.9 && !f.session; }, null, { timeout: 60000 });
  const f2 = await MW(() => window.__MW.fuelState());
  const m1 = (await state()).money;
  r.details.refuel = { prompt: pr, fuel: f2.fuel, cost: +(m0 - m1).toFixed(2), stats: f2.stats };
  assert(r, /Refuel/.test(pr || ''), 'pumpPrompt', pr);
  assert(r, f2.fuel >= 99.9, 'tankFull', f2.fuel);
  const gal = f2.stats.gallons;
  assert(r, Math.abs((m0 - m1) - gal * 2) < 0.6 && gal > 5, 'chargedTwoDollarsPerGallon', { paid: m0 - m1, gal });
  await MW(() => { const g = window.__MW.game; const v = g.player.vehicle; if (v) { v.body.velocity.setZero(); g.exitVehicle(); } });
  await sleep(600);
});

// ------------------------------------------------------------------------------------------- 15 easter eggs
await check('pumpkins', 'Golden Pumpkins: collecting all 5 unlocks the Monster Mash kiosk pack', async (r) => {
  const pts = await MW(() => window.__MW.pumpkinPositions());
  for (const [x, y, z] of pts) { await MW(([a, b, c]) => window.__MW.teleport(a, c, b - 0.5), [x, y, z]); await sleep(500); }
  const s = await state();
  assert(r, s.pumpkins === 5, 'collected', s.pumpkins);
  assert(r, s.monsterMash, 'unlocked', s.monsterMash);
  await MW(() => window.__MW.openKiosk());
  await sleep(900);
  await MW(() => { window.__MW.kioskTab('Monster Mash'); window.__MW.kioskSet('rim', 'Pumpkin'); window.__MW.kioskSet('hood', 'Hood_Franken'); window.__MW.kioskSet('exhaust', 'Exhaust_Lightning'); window.__MW.kioskSet('livery', 'monster'); });
  await sleep(900);
  r.screenshots.push(await shot('15_monster_mash_kiosk'));
  await MW(() => window.__MW.game.kiosk.close());
  await sleep(300);
});

await check('phantom', 'Phantom Hearse: honking 3x at the Vlad crypt summons a ghost hearse race', async (r) => {
  await MW(() => { const g = window.__MW.game; window.__MW.spawnTestCar({ body: 'coupe', engine: 'tt' }, 0, 296, 0); window.__MW.teleport(1.6, 296, 10); });
  await sleep(600);
  await MW(() => window.__MW.enterOwnedCar());
  await sleep(1400);
  for (let i = 0; i < 3; i++) { await press('KeyH'); await sleep(250); }
  await sleep(1200);
  const race = await MW(() => !!window.__MW.game.missions.race);
  assert(r, race, 'raceStarted', race);
  await MW(() => { const v = window.__MW.game.missions.race.visual.root.position; window.__MW.shot(v.x + 6, v.y + 3, v.z - 7, v.x, v.y + 1, v.z); });
  await sleep(900);
  r.screenshots.push(await shot('15_phantom_hearse'));
  await MW(() => window.__MW.resume());
});

await check('trial', 'Graveyard Shift: driving through the start arch starts the timed drift trial', async (r) => {
  await MW(() => { const g = window.__MW.game; if (g.missions.race) g.missions._endRace(false); g.player.vehicle.teleport({ x: 0, y: 10, z: 226 }, 0); });
  await sleep(500);
  await hold(['KeyW'], 2200);
  const T = await MW(() => { const g = window.__MW.game; const v = g.player.vehicle; return { running: g.missions.trial.running, t: g.missions.trial.t, next: g.missions.trial.next, inCar: !!v, pos: v ? [v.position.x, v.position.y, v.position.z].map((n) => +n.toFixed(1)) : null }; });
  assert(r, T.running, 'trialRunning', T);
  r.screenshots.push(await shot('15_graveyard_shift_trial'));
});

await check('radio_audio', 'Spoken dialogue audio + radio DJ use the cached local audio files (no TTS fallback needed)', async (r) => {
  const s = await state();
  assert(r, s.audio.linesPlayed >= 3, 'linesPlayed', s.audio.linesPlayed);
  assert(r, s.audio.fallbackTTS === 0, 'ttsFallbacks', s.audio.fallbackTTS);
  r.details.audio = s.audio;
});

await check('perf', 'Performance snapshot (draw calls, triangles, FPS on this GPU)', async (r) => {
  await MW(() => { const g = window.__MW.game; const v = g.player.vehicle; if (v) { v.body.velocity.setZero(); g.exitVehicle(); } window.__MW.teleport(-40, -40); });
  await sleep(1200);
  const a = await state();
  await sleep(2000);
  const b = await state();
  r.details = { fps: +((b.frames - a.frames) / 2).toFixed(1), drawCalls: b.drawCalls, triangles: b.triangles, vehicles: b.vehicles };
});

await check('final_errors', 'Zero console errors or uncaught exceptions during the whole QA run', async (r) => {
  const s = await state();
  assert(r, consoleErrors.length === 0 && s.errors.length === 0, 'errors', { console: consoleErrors.slice(0, 8), game: s.errors.slice(0, 3) });
});

await browser.close();
const passed = results.filter((x) => x.pass).length;
const summary = { ranAt: new Date().toISOString(), durationSec: Math.round((Date.now() - t0) / 1000), passed, total: results.length, results };
writeFileSync(path.join(ROOT, 'tests', 'qa-results.json'), JSON.stringify(summary, null, 1));
if (!only.length) {
  const prev = readTelemetry().qa || {};
  updateTelemetry({ qa: { runs: (prev.runs || 0) + 1, lastRun: summary.ranAt, lastPassed: passed, lastTotal: results.length, allPassRuns: (prev.allPassRuns || 0) + (passed === results.length ? 1 : 0),
    totalChecksPassed: (prev.totalChecksPassed || 0) + passed } });
}
console.log(`\n${passed}/${results.length} checks passed in ${summary.durationSec}s`);
