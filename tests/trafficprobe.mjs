// Traffic AI probe (Phase 4): turn signals before junctions and overtaking a car abandoned in the lane.
// Usage: node tests/trafficprobe.mjs   (writes tests/trafficprobe.json + screenshots in public/docs/screenshots/phase4)
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'public', 'docs', 'screenshots', 'phase4');
mkdirSync(OUT, { recursive: true });
const launchOpts = { headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launchOpts).catch(() => chromium.launch({ ...launchOpts, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const MW = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);
await page.goto(process.env.MW_URL || 'http://localhost:3000/');
await page.waitForFunction(() => window.__MW && window.__MW.ready(), null, { timeout: 180000 });
await MW(() => { window.__MW.setQuality('high'); window.__MW.start(); window.__MW.setHour(19.5); });
await page.waitForFunction(() => window.__MW.state().mode === 'play', null, { timeout: 20000 }); // Start is async (audio init), then sets mode = 'play'
await sleep(1500);

// 1) an abandoned car in the eastbound Main Street lane, and a traffic car 30 m behind it
const setup = await MW(() => {
  const g = window.__MW.game, T = g.traffic;
  const n = T.graph.nearest({ x: -150, y: 0, z: 2.6 });
  const c = T.driving[0];
  for (const n2 of Object.values(T.graph.nodes)) if (n2.busy === c) n2.busy = null;
  c.seg = n.seg; c.s = n.s; c.speed = 9; c.nextSeg = null; c.ot = null; c.lat = 0; c.cooldown = 0;
    T._place(c, 0); c.body.velocity.set(0, 0, 0); // snap the kinematic body (a dt-based place would fling it through the obstacle)
  // keep the oncoming lane clear for the test: everyone else waits elsewhere for a moment
  for (const o of T.driving) if (o !== c && Math.abs(o.body.position.z) < 8 && o.body.position.x > -200 && o.body.position.x < -40) T._relocate(o);
  // spawn the obstacle only now: a traffic car sitting on that spot would shove it down the street
  window.__MW.spawnTestCar({ color: '#c0c4c8' }, -120, 2.6, Math.PI / 2);
  g.ownedCar.setControls({ throttle: 0, steer: 0, handbrake: true });
  window.__probeCar = c;
  return { road: n.seg.road, lane: n.seg.from + '->' + n.seg.to, w: n.seg.w, s: +n.s.toFixed(1) };
});
const track = [];
let shotTaken = false;
for (let i = 0; i < 90; i++) {
  const s = await MW(() => { const c = window.__probeCar, p = c.body.position; return { x: +p.x.toFixed(1), z: +p.z.toFixed(2), lat: +(c.lat || 0).toFixed(2), phase: c.ot ? c.ot.phase : null, signal: c.signal, speed: +c.speed.toFixed(1), blocked: c.blocked }; });
  track.push(s);
  if (!shotTaken && s.phase === 'pass' && s.x > -126) {
    await MW(() => { const p = window.__probeCar.body.position; window.__MW.shot(p.x - 9, 4.2, p.z - 9, p.x + 2, 0.8, p.z); });
    await sleep(250);
    await page.screenshot({ path: path.join(OUT, '40_traffic_overtaking_abandoned_car.png') });
    await MW(() => window.__MW.resume());
    shotTaken = true;
  }
  if (s.x > -95 && !s.phase) break;
  await sleep(200);
}
const stats = await MW(() => ({ overtakes: window.__MW.game.traffic.stats.overtakes || 0, done: window.__MW.game.traffic.stats.overtakesDone || 0, aborts: window.__MW.game.traffic.stats.overtakeAborts || 0 }));

// 2) turn signals: wait for any car that is signalling on approach to a junction and photograph it
let blink = null;
for (let i = 0; i < 60 && !blink; i++) {
  blink = await MW(() => {
    const T = window.__MW.game.traffic;
    const c = T.driving.find((d) => d.signal && !d.ot && d.seg.kind === 'lane' && d.seg.length - d.s < 22 && d.speed > 2);
    if (!c) return null;
    const v = c.visual.root; v.updateMatrixWorld();
    const side = c.signal === 'L' ? 1 : -1;
    const eye = v.localToWorld(new v.position.constructor(side * 3.2, 2.0, -5.5)), look = v.localToWorld(new v.position.constructor(0, 0.8, 0.5));
    window.__MW.shot(eye.x, eye.y, eye.z, look.x, look.y, look.z);
    window.__blinkCar = c;
    return { signal: c.signal, turn: c.nextSeg ? c.nextSeg.kind + ':' + c.nextSeg.turnSide() : null };
  });
  if (!blink) await sleep(250);
}
if (blink) {
  // catch the lamp in its "on" phase
  for (let k = 0; k < 8; k++) { const on = await MW(() => { const b = window.__blinkCar.visual.blink; return !!b && (b.L.visible || b.R.visible); }); if (on) break; await sleep(60); }
  await page.screenshot({ path: path.join(OUT, '40_traffic_turn_signal.png') });
  await MW(() => window.__MW.resume());
}
const sig = await MW(() => ({ signallingSeconds: +(window.__MW.game.traffic.stats.signalling || 0).toFixed(1), errors: window.__MW.state().errors }));
const report = { setup, stats, track, blink, sig };
writeFileSync(path.join(process.cwd(), 'tests', 'trafficprobe.json'), JSON.stringify(report, null, 1));
const phases = [...new Set(track.map((t) => t.phase).filter(Boolean))];
console.log(JSON.stringify({ setup, stats, phases, maxLat: Math.max(...track.map((t) => t.lat)), signals: [...new Set(track.map((t) => t.signal))], blink, sig }));
await browser.close();
