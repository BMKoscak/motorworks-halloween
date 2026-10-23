// Dev probe: boots the game headless, runs an optional JS snippet, prints state + errors, saves a screenshot.
// Usage: node tests/probe.mjs [outfile.png] ["js to eval after start"] [waitMs]
import { chromium } from 'playwright';

const out = process.argv[2] || 'docs/probe.png';
const js = process.argv[3] || '';
const waitMs = +(process.argv[4] || 1500);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const t0 = Date.now();
await page.goto('http://localhost:3000/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__MW && window.__MW.ready(), null, { timeout: 120000 });
const loadMs = Date.now() - t0;
await page.evaluate(() => window.__MW.start());
await page.waitForTimeout(500);
if (js) console.log('RET', JSON.stringify(await page.evaluate(js)).slice(0, 4000));
await page.waitForTimeout(waitMs);
const f0 = await page.evaluate(() => window.__MW.state().frames);
await page.waitForTimeout(1000);
const st = await page.evaluate(() => window.__MW.state());
console.log(JSON.stringify({ loadMs, fps: st.frames - f0, ...st }, null, 1).slice(0, 3000));
await page.screenshot({ path: out });
console.log('errors:', errors.slice(0, 10));
await browser.close();
