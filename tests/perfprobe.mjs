// Frame-time split probe: wraps Game.update and the composer render to see whether a view is CPU (simulation /
// draw-call submission) or GPU bound. Usage: node tests/perfprobe.mjs [quality]
import { chromium } from 'playwright';

const quality = process.argv[2] || 'high';
const launchOpts = { headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launchOpts).catch(() => chromium.launch({ ...launchOpts, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(process.env.MW_URL || 'http://localhost:3000/');
await page.waitForFunction(() => window.__MW && window.__MW.ready(), null, { timeout: 180000 });
await page.evaluate((q) => { window.__MW.setQuality(q); window.__MW.start(); if (window.__MW.setHour) window.__MW.setHour(18); }, quality);
await page.waitForTimeout(1500);
const views = [['main_street', [-40, 3.2, 14, -22, 1, 4]], ['town_overview', [-90, 60, 90, 20, 0, -20]], ['cemetery', [4, 12.5, 290, 0, 12, 312]]];
for (const [name, cam] of views) {
  await page.evaluate((c) => window.__MW.shot(...c), cam);
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => new Promise((res) => {
    const g = window.__MW.game, gl = g.renderer.getContext();
    const acc = { upd: 0, rnd: 0, n: 0 };
    const comp = g.pipeline ? g.pipeline.composer : g.composer;
    const u0 = g.update.bind(g), r0 = comp.render.bind(comp);
    g.update = (dt) => { const t = performance.now(); u0(dt); acc.upd += performance.now() - t; };
    // gl.finish() forces the GPU to complete so the render span covers submission + GPU work
    comp.render = (d) => { const t = performance.now(); r0(d); gl.finish(); acc.rnd += performance.now() - t; acc.n++; };
    const t0 = performance.now();
    setTimeout(() => { g.update = u0; comp.render = r0; const s = (performance.now() - t0) / 1000;
      res({ fps: +(acc.n / s).toFixed(1), updateMs: +(acc.upd / acc.n).toFixed(2), renderMs: +(acc.rnd / acc.n).toFixed(2), calls: g.renderer.info.render.calls }); }, 2000);
  }));
  console.log(name, JSON.stringify(r));
  await page.evaluate(() => window.__MW.resume());
}
await browser.close();
