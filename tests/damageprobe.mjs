// Damage model + garage probe (Phase 4): a real crash into the Motorworks front wall, synthetic side hits, bay repair,
// and saving / loading a build in the kiosk garage. Usage: node tests/damageprobe.mjs
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
const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
await page.goto(process.env.MW_URL || 'http://localhost:3000/');
await page.waitForFunction(() => window.__MW && window.__MW.ready(), null, { timeout: 180000 });
await MW(() => { window.__MW.setQuality('high'); window.__MW.start(); window.__MW.setHour(12.5); });
await page.evaluate(() => localStorage.removeItem('mw_garage'));
await page.waitForFunction(() => window.__MW.state().mode === 'play', null, { timeout: 20000 }); // Start is async (audio init), then sets mode = 'play'
await sleep(1500);
const report = {};

// 1) a real crash: 19 m/s nose-first into the plant's front wall
await MW(() => { window.__MW.spawnTestCar({ color: '#1f8f3a', finish: 'metallic', livery: 'none' }, 10, -36, Math.PI); window.__MW.teleport(13, -36); });
await sleep(400);
await MW(() => window.__MW.enterOwnedCar());
await sleep(1600);
const camFront = () => MW(() => { const v = window.__MW.game.player.vehicle.visual.root; v.updateMatrixWorld(); const e = v.localToWorld(new v.position.constructor(2.4, 1.6, 5.2)), l = v.localToWorld(new v.position.constructor(0, 0.7, 1.2)); window.__MW.shot(e.x, e.y, e.z, l.x, l.y, l.z); });
await MW(() => { const v = window.__MW.game.player.vehicle.visual.root; v.updateMatrixWorld(); const e = v.localToWorld(new v.position.constructor(3.4, 2.3, 1.0)), l = v.localToWorld(new v.position.constructor(0.2, 0.6, 1.9)); window.__MW.shot(e.x, e.y, e.z, l.x, l.y, l.z); });
await sleep(500); await shot('41_damage_before_crash'); await MW(() => window.__MW.resume());
await MW(() => { const b = window.__MW.game.player.vehicle.body; b.velocity.set(0, 0, -19); });
await sleep(1800);
report.crash = await MW(() => window.__MW.damage());
// the nose is against the wall now: look at it from a front quarter, above
await MW(() => { const v = window.__MW.game.player.vehicle.visual.root; v.updateMatrixWorld(); const e = v.localToWorld(new v.position.constructor(3.4, 2.3, 1.0)), l = v.localToWorld(new v.position.constructor(0.2, 0.6, 1.9)); window.__MW.shot(e.x, e.y, e.z, l.x, l.y, l.z); });
await sleep(500); await shot('41_damage_after_wall_crash'); await MW(() => window.__MW.resume());

// 2) side swipes on both flanks (synthetic, same code path as a collision) -> alignment pull
report.left = await MW(() => window.__MW.hitCar('left', 14));
report.right = await MW(() => window.__MW.hitCar('left', 11));
report.after = await MW(() => window.__MW.damage());
await MW(() => { const v = window.__MW.game.player.vehicle.visual.root; v.updateMatrixWorld(); const e = v.localToWorld(new v.position.constructor(4.2, 1.5, 0.6)), l = v.localToWorld(new v.position.constructor(0, 0.7, 0.2)); window.__MW.shot(e.x, e.y, e.z, l.x, l.y, l.z); });
await sleep(500); await shot('41_damage_side_swipe'); await MW(() => window.__MW.resume());
report.hud = await MW(() => document.getElementById('hud-fuel') ? document.getElementById('hud-fuel').innerText : null);

// 3) repair (what the Custom Bay respray calls)
await MW(() => window.__MW.repairCar());
report.repaired = await MW(() => window.__MW.damage());

// 4) garage: save two builds from the kiosk, reload the first, check the preview follows
await MW(() => window.__MW.game.exitVehicle());
await sleep(1200);
await MW(() => window.__MW.openKiosk());
await sleep(800);
await MW(() => { window.__MW.kioskSet('body', 'hearse'); window.__MW.kioskSet('color', '#5b1a8c'); window.__MW.kioskSet('livery', 'ribcage'); });
report.save1 = await MW(() => window.__MW.saveBuild('Midnight Hearse'));
await MW(() => { window.__MW.kioskSet('body', 'coupe'); window.__MW.kioskSet('color', '#ffb000'); });
report.save2 = await MW(() => window.__MW.saveBuild('Pumpkin Spice Coupe'));
await MW(() => window.__MW.kioskTab('Garage'));
await sleep(600);
await shot('42_kiosk_garage_saved_builds');
report.garage = await MW(() => window.__MW.garage());
report.load = await MW(() => window.__MW.loadBuild(1)); // list is newest-first: 1 = Midnight Hearse
await sleep(700);
report.loadedCfg = await MW(() => { const c = window.__MW.kioskCfg(); return { body: c.body, color: c.color, livery: c.livery }; });
await shot('42_kiosk_garage_loaded_build');
report.errors = await MW(() => window.__MW.state().errors);
writeFileSync(path.join(process.cwd(), 'tests', 'damageprobe.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
await browser.close();
