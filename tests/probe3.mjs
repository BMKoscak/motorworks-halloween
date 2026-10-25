// Dev probe: run an arbitrary async scenario (file exporting `steps(page, MW, sleep)`) against the live game.
// Usage: node tests/probe3.mjs scenario.mjs
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const mod = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:3000/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__MW && window.__MW.ready(), null, { timeout: 120000 });
await page.evaluate(() => { window.__MW.setQuality('medium'); window.__MW.start(); });
await page.waitForTimeout(800);
const MW = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);
try { await mod.steps(page, MW, sleep); } catch (e) { console.log('STEP ERROR', e.message); }
console.log('errors:', errors.slice(0, 8));
await browser.close();
