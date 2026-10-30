// Composes labelled screenshots into one comparison image (docs before/after and day/night grids).
// Usage: node tests/grid.mjs out.png cols "path|label" "path|label" ...
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const [out, cols, ...cells] = process.argv.slice(2);
const launchOpts = { headless: true };
const browser = await chromium.launch(launchOpts).catch(() => chromium.launch({ ...launchOpts, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: Math.round(1280 * Math.min(2, +cols) / 1.5), height: 100 } });
const tiles = cells.map((c) => {
  const [file, label] = c.split('|');
  const src = 'data:image/png;base64,' + readFileSync(file).toString('base64');
  return `<div style="position:relative"><img style="width:100%;display:block" src="${src}"><span style="position:absolute;left:8px;bottom:8px;background:#000b;padding:3px 9px;border-radius:5px">${label || ''}</span></div>`;
}).join('');
await page.setContent(`<body style="margin:0;background:#0d0a12;display:grid;grid-template-columns:repeat(${cols},1fr);gap:4px;font:600 15px system-ui,sans-serif;color:#fff">${tiles}</body>`);
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote', out);
