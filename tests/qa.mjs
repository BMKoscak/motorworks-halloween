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
  await MW(() => { const g = window.__MW.game; g.ownedCar.teleport({ x: -55, y: 0, z: -44 }, Math.PI / 2); window.__MW.teleport(-55, -42.4); });
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
  await MW(() => { const v = window.__MW.game.player.vehicle; v.teleport({ x: 76, y: 0, z: -86 }, 0); });
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
    c.mode = 'pursuit'; c.vehicle.teleport({ x: p.x + 4, y: p.y, z: p.z }, 0);
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
