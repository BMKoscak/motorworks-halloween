// Dev probe: boots the game headless and captures a list of camera views, plus an fps sample per view.
// Usage: node tests/views.mjs views.json [outDir] [quality]
//   JSON: [{ "name": "x", "pre": "js run before the shot", "cam": [x,y,z,lx,ly,lz] | "camExpr": "js returning that array", "wait": 800 }]
//   quality: low | medium | high | ultra (default medium). MW_URL overrides the server URL.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const views = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const outDir = process.argv[3] || 'docs/views';
const quality = process.argv[4] || 'medium';
mkdirSync(outDir, { recursive: true });
const launchOpts = { headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] };
const browser = await chromium.launch(launchOpts).catch(() => chromium.launch({ ...launchOpts, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(process.env.MW_URL || 'http://localhost:3000/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__MW && window.__MW.ready(), null, { timeout: 180000 });
// MW_HOUR picks the time of day (24 h clock, frozen) on builds with the day/night cycle; default 18:00 dusk
await page.evaluate(([q, h]) => { window.__MW.setQuality(q); window.__MW.start(); if (window.__MW.setHour) window.__MW.setHour(h); }, [quality, +(process.env.MW_HOUR || 18)]);
await page.waitForFunction(() => window.__MW.state().mode === 'play', null, { timeout: 20000 }); // Start is async (audio init)
await page.waitForTimeout(800);
const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
const report = { quality, gpu, views: [] };
for (const v of views) {
  if (v.pre) console.log(v.name, 'pre:', JSON.stringify(await page.evaluate(v.pre)).slice(0, 300));
  const cam = v.camExpr ? await page.evaluate(v.camExpr) : v.cam;
  if (cam) await page.evaluate((c) => window.__MW.shot(...c), cam);
  await page.waitForTimeout(v.wait || 900);
  // fps over one second of real rendering at this view
  const perf = await page.evaluate(() => new Promise((res) => {
    const f0 = window.__MW.game.frames, t0 = performance.now();
    setTimeout(() => { const s = window.__MW.state(); res({ fps: +((window.__MW.game.frames - f0) / ((performance.now() - t0) / 1000)).toFixed(1), drawCalls: s.drawCalls, triangles: s.triangles }); }, 1000);
  }));
  if (v.post) console.log(v.name, 'post:', JSON.stringify(await page.evaluate(v.post)).slice(0, 300));
  await page.screenshot({ path: `${outDir}/${v.name}.png` });
  report.views.push({ name: v.name, ...perf });
  console.log(`${v.name}: ${perf.fps} fps, ${perf.drawCalls} calls, ${perf.triangles} tris`);
  if (cam) await page.evaluate(() => window.__MW.resume());
}
const st = await page.evaluate(() => window.__MW.state());
report.errors = st.errors.concat(errors).slice(0, 10);
writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 1));
console.log('gpu', gpu, '| errors', JSON.stringify(report.errors).slice(0, 800));
await browser.close();
