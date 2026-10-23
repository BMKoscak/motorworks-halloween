// Driving probe: spawn a car in the parking lot, enter it, then W / W+A / W+D and report speed + heading deltas.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://localhost:3000/');
await page.waitForFunction(() => window.__MW && window.__MW.ready(), null, { timeout: 120000 });
console.log('GPU', await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; }));
await page.evaluate(() => window.__MW.start());
await page.evaluate((body) => { window.__MW.spawnTestCar({ body }, -30, -57, 0); }, process.env.BODY || 'muscle');
await page.waitForTimeout(800);
await page.evaluate(() => window.__MW.teleport(-28.5, -57));
await page.waitForTimeout(300);
await page.evaluate(() => window.__MW.enterOwnedCar());
await page.waitForTimeout(1200);
const st = () => page.evaluate(() => window.__MW.state());
const s0 = await st();
console.log('inCar', s0.inCar, 'heading', s0.heading);
const hold = async (keys, ms) => { for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(ms); for (const k of keys) await page.keyboard.up(k); };
await hold(['KeyW'], 1800);
const s1 = await st();
await hold(['KeyW', 'KeyA'], 1200);
const s2 = await st();
await hold(['KeyW', 'KeyD'], 1200);
const s3 = await st();
await hold(['KeyS'], 1500);
const s4 = await st();
const d = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
console.log(JSON.stringify({ afterW: { speed: s1.speed, pos: s1.pos }, leftTurn: { speed: s2.speed, dHeading: +d(s1.heading, s2.heading).toFixed(3) },
  rightTurn: { speed: s3.speed, dHeading: +d(s2.heading, s3.heading).toFixed(3) }, brake: { speed: s4.speed }, frames: s4.frames, errors: s4.errors }));
await page.screenshot({ path: 'docs/drive.png' });
console.log('errors', errors.slice(0, 5));
await browser.close();
