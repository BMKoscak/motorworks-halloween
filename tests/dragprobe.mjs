// Drag-strip launch probe: stages a car at the Proving Ground, samples chassis height / tilt every 100 ms through the
// countdown and the run, and reports the peak height above the strip and the worst tilt. Usage: node tests/dragprobe.mjs [label]
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const URL = process.env.MW_URL || 'http://localhost:3000/';
const label = process.argv[2] || 'probe';
const OUT = path.join(process.cwd(), 'public', 'docs', 'screenshots', 'phase4');
mkdirSync(OUT, { recursive: true });
const launchOpts = { headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launchOpts).catch(() => chromium.launch({ ...launchOpts, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const MW = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto(URL);
await page.waitForFunction(() => window.__MW && window.__MW.ready(), null, { timeout: 180000 });
await MW(() => window.__MW.start());
await sleep(1500);
await MW(() => { window.__MW.spawnTestCar({ engine: 'tt', trans: 'short' }, -147, -123.4, Math.PI / 2); window.__MW.teleport(-147, -121.2); window.__MW.game.state.money = 5000; });
await sleep(400);
await MW(() => window.__MW.enterOwnedCar());
await sleep(1800);
await MW(() => window.__MW.interact());

const samples = [];
const sample = async (phase) => samples.push(await MW((ph) => {
  const v = window.__MW.game.player.vehicle, b = v.body, q = b.quaternion;
  const upY = 1 - 2 * (q.x * q.x + q.z * q.z); // world-up component of the chassis up axis
  const d = window.__MW.game.activities.drag.race;
  return { ph, race: d ? d.phase : null, x: +b.position.x.toFixed(1), y: +b.position.y.toFixed(2), upY: +upY.toFixed(3), vy: +b.velocity.y.toFixed(2) };
}, phase));
for (let i = 0; i < 36; i++) { await sample('stage'); if (i === 30) await page.screenshot({ path: path.join(OUT, `39_drag_${label}_staging.png`) }); await sleep(100); }
await page.keyboard.down('KeyW');
for (let i = 0; i < 60; i++) { await sample('run'); if (i === 12) await page.screenshot({ path: path.join(OUT, `39_drag_${label}_launch.png`) }); await sleep(100); }
await page.keyboard.up('KeyW');
const res = await MW(() => { const d = window.__MW.game.activities.drag.race; return d ? { phase: d.phase, result: d.result, et: d.playerT } : null; });
const rest = 0.5 + 0.34; // chassis centre above the strip when sitting on its springs (cy + rest length, approx)
const peak = Math.max(...samples.map((s) => s.y));
const minUp = Math.min(...samples.map((s) => s.upY));
const report = { label, peakY: peak, peakAboveRest: +(peak - rest).toFixed(2), minUpY: minUp, flipped: minUp < 0.3, result: res, samples };
writeFileSync(path.join(process.cwd(), 'tests', `dragprobe-${label}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ label, peakY: peak, minUpY: minUp, flipped: report.flipped, result: res }));
await browser.close();
