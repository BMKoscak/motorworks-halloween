// Dev probe: boots the game headless and captures a list of camera views.
// Usage: node tests/views.mjs views.json   (JSON: [{ "name": "x", "pre": "js run before the shot", "cam": [x,y,z,lx,ly,lz], "wait": 800 }])
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const views = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const outDir = process.argv[3] || 'docs/views';
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:3000/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__MW && window.__MW.ready(), null, { timeout: 120000 });
await page.evaluate(() => { window.__MW.setQuality('medium'); window.__MW.start(); });
await page.waitForTimeout(800);
for (const v of views) {
  if (v.pre) console.log(v.name, 'pre:', JSON.stringify(await page.evaluate(v.pre)).slice(0, 1500));
  if (v.cam) await page.evaluate((c) => window.__MW.shot(...c), v.cam);
  await page.waitForTimeout(v.wait || 900);
  if (v.post) console.log(v.name, 'post:', JSON.stringify(await page.evaluate(v.post)).slice(0, 1500));
  await page.screenshot({ path: `${outDir}/${v.name}.png` });
  if (v.cam) await page.evaluate(() => window.__MW.resume());
}
const st = await page.evaluate(() => window.__MW.state());
console.log('fps-ish frames', st.frames, 'errors', JSON.stringify(st.errors).slice(0, 800));
console.log('console errors:', errors.slice(0, 10));
await browser.close();
