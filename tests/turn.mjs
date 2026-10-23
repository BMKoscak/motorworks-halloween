// High-speed steering probe: samples yaw rate while holding W+D at speed.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://localhost:3000/');
await page.waitForFunction(() => window.__MW && window.__MW.ready(), null, { timeout: 120000 });
await page.evaluate(() => window.__MW.start());
await page.evaluate((tires) => window.__MW.spawnTestCar({ tires }, -55, -46, Math.PI / 2), process.env.TIRES || 'grip');
await page.waitForTimeout(600);
await page.evaluate(() => window.__MW.teleport(-55, -48));
await page.waitForTimeout(300);
await page.evaluate(() => window.__MW.enterOwnedCar());
await page.waitForTimeout(1300);
await page.keyboard.down('KeyW');
await page.waitForTimeout(2600);
await page.keyboard.down('KeyD');
const samples = [];
for (let i = 0; i < 10; i++) {
  samples.push(await page.evaluate(() => { const v = window.__MW.game.player.vehicle; return { sp: +v.speed.toFixed(1), h: +v.heading.toFixed(3), steer: +v.steer.toFixed(3), lat: +v.lateral.toFixed(2), yaw: +v.body.angularVelocity.y.toFixed(2), skid: v.raycast.wheelInfos.map((w) => +w.skidInfo.toFixed(2)) }; }));
  await page.waitForTimeout(100);
}
await page.keyboard.up('KeyD');
await page.keyboard.up('KeyW');
console.log(samples.map((s) => JSON.stringify(s)).join('\n'));
await browser.close();
