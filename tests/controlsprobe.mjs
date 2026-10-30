// Gamepad + touch controls probe (Phase 4).
//  - Gamepad: a virtual standard-mapping pad is injected (navigator.getGamepads) and driven from the test:
//    left stick walks, A gets into a car, RT accelerates, Start pauses.
//  - Touch: the overlay (?touch=1) is driven with real pointer events: joystick walks, GAS pedal drives.
// Usage: node tests/controlsprobe.mjs
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'public', 'docs', 'screenshots', 'phase4');
mkdirSync(OUT, { recursive: true });
const URL = process.env.MW_URL || 'http://localhost:3000/';
const launchOpts = { headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] };
const browser = await chromium.launch(launchOpts).catch(() => chromium.launch({ ...launchOpts, channel: 'chrome' }));
const r = {};
const boot = async (page, q = '') => {
  await page.goto(URL + q);
  await page.waitForFunction(() => window.__MW && window.__MW.ready(), null, { timeout: 180000 });
  await page.evaluate(() => { window.__MW.setQuality('high'); window.__MW.start(); window.__MW.setHour(13); });
  await page.waitForFunction(() => window.__MW.state().mode === 'play', null, { timeout: 20000 });
  await page.waitForTimeout(1200);
};

// ------------------------------------------------------------------ gamepad
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => {
    const pad = { id: 'Virtual Xbox Controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    window.__pad = pad;
    window.__padSet = (o) => { if (o.axes) pad.axes = o.axes.slice(); if (o.buttons) for (const [i, v] of Object.entries(o.buttons)) pad.buttons[i] = { pressed: v > 0.5, touched: v > 0, value: v }; pad.timestamp++; };
    navigator.getGamepads = () => [pad, null, null, null];
  });
  await boot(page);
  const MW = (fn, a) => page.evaluate(fn, a);
  const p0 = await MW(() => window.__MW.state().pos);
  await MW(() => window.__padSet({ axes: [0, -1, 0, 0] })); // left stick fully up
  await page.waitForTimeout(1500);
  await MW(() => window.__padSet({ axes: [0, 0, 0, 0] }));
  const p1 = await MW(() => window.__MW.state().pos);
  r.padWalk = { moved: +Math.hypot(p1[0] - p0[0], p1[2] - p0[2]).toFixed(2), connected: await MW(() => window.__MW.game.input.pad.connected) };
  // A at a car door gets in
  await MW(() => window.__MW.spawnTestCar({ color: '#3fa9f5' }, -30, -20, 0));
  await page.waitForTimeout(300); // let the new car's matrices update before reading its door point
  await MW(() => { const v = window.__MW.game.ownedCar.visual; v.root.updateMatrixWorld(true); const d = window.__MW.game.traffic.doorPoint(v); window.__MW.teleport(d.x, d.z); });
  await page.waitForTimeout(600);
  r.padPrompt = await MW(() => window.__MW.prompt());
  await MW(() => window.__padSet({ buttons: { 0: 1 } })); await page.waitForTimeout(200); await MW(() => window.__padSet({ buttons: { 0: 0 } }));
  await page.waitForTimeout(1600);
  r.padInCar = await MW(() => window.__MW.state().inCar);
  // RT throttle
  await MW(() => window.__padSet({ buttons: { 7: 1 } }));
  await page.waitForTimeout(2000);
  r.padSpeed = await MW(() => window.__MW.state().speed);
  await page.screenshot({ path: path.join(OUT, '45_gamepad_driving.png') });
  await MW(() => window.__padSet({ buttons: { 7: 0, 6: 1 } })); await page.waitForTimeout(1500); await MW(() => window.__padSet({ buttons: { 6: 0 } }));
  // Start pauses
  await MW(() => window.__padSet({ buttons: { 9: 1 } })); await page.waitForTimeout(150); await MW(() => window.__padSet({ buttons: { 9: 0 } }));
  await page.waitForTimeout(300);
  r.padPause = await MW(() => window.__MW.state().mode);
  r.padErrors = await MW(() => window.__MW.state().errors);
  await page.close();
}

// ------------------------------------------------------------------ touch
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await boot(page, '?touch=1');
  const MW = (fn, a) => page.evaluate(fn, a);
  r.touchUI = await MW(() => !!document.getElementById('touch') && !document.getElementById('touch').classList.contains('hidden'));
  await page.screenshot({ path: path.join(OUT, '45_touch_controls_on_foot.png') });
  const p0 = await MW(() => window.__MW.state().pos);
  // drag the joystick up from inside the left zone
  await page.mouse.move(200, 560); await page.mouse.down(); await page.mouse.move(200, 470, { steps: 5 });
  await page.waitForTimeout(1500);
  await page.mouse.up();
  const p1 = await MW(() => window.__MW.state().pos);
  r.touchWalk = +Math.hypot(p1[0] - p0[0], p1[2] - p0[2]).toFixed(2);
  // into a car: the in-car layout, then hold GAS
  await MW(() => { window.__MW.spawnTestCar({ color: '#ff2e88' }, -30, -20, 0); window.__MW.enterOwnedCar(); });
  await page.waitForTimeout(1800);
  const gas = await MW(() => { const b = document.querySelector('#touch [data-id="gas"]').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
  await page.mouse.move(gas[0], gas[1]); await page.mouse.down();
  await page.waitForTimeout(2000);
  r.touchSpeed = await MW(() => window.__MW.state().speed);
  await page.screenshot({ path: path.join(OUT, '45_touch_controls_driving.png') });
  await page.mouse.up();
  r.touchCarLayout = await MW(() => document.getElementById('touch').classList.contains('in-car'));
  r.touchErrors = await MW(() => window.__MW.state().errors);
  await page.close();
}
writeFileSync(path.join(process.cwd(), 'tests', 'controlsprobe.json'), JSON.stringify(r, null, 1));
console.log(JSON.stringify(r));
await browser.close();
