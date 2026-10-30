// CPU hotspot probe: records a 3 s Chrome CPU profile of the running game and prints the top self-time functions.
// Usage: node tests/cpuprofile.mjs [quality] [x,y,z,lx,ly,lz]
import { chromium } from 'playwright';

const quality = process.argv[2] || 'high';
const cam = (process.argv[3] || '-40,3.2,14,-22,1,4').split(',').map(Number);
const launchOpts = { headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launchOpts).catch(() => chromium.launch({ ...launchOpts, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(process.env.MW_URL || 'http://localhost:3000/');
await page.waitForFunction(() => window.__MW && window.__MW.ready(), null, { timeout: 180000 });
await page.evaluate((q) => { window.__MW.setQuality(q); window.__MW.start(); }, quality);
await page.waitForTimeout(1500);
await page.evaluate((c) => window.__MW.shot(...c), cam);
await page.waitForTimeout(800);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
await page.waitForTimeout(3000);
const { profile } = await cdp.send('Profiler.stop');
const self = new Map();
const dt = profile.timeDeltas;
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const total = dt.reduce((a, b) => a + b, 0);
profile.samples.forEach((id, i) => {
  const n = byId.get(id), f = n.callFrame;
  const key = `${f.functionName || '(anon)'} ${(f.url || '').split('/').pop().split('?')[0]}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) || 0) + (dt[i] || 0));
});
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
for (const [k, v] of top) console.log(`${(v / total * 100).toFixed(1).padStart(5)}%  ${k}`);
await browser.close();
