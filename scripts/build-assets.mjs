// Runs the whole Blender asset pipeline headless and records timings in TELEMETRY.json.
// Usage: npm run assets   (BLENDER env var overrides the executable path)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const blender = process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const scripts = ['build_vehicles.py', 'build_world.py', 'build_chars.py'];
const runs = [];
for (const s of scripts) {
  const t0 = Date.now();
  const r = spawnSync(blender, ['-b', '--factory-startup', '-P', path.join(root, 'blender', s)], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const ok = /_DONE/.test(r.stdout || '');
  runs.push({ script: s, ok, seconds: +((Date.now() - t0) / 1000).toFixed(1) });
  console.log(`${ok ? 'OK ' : 'ERR'} ${s} (${runs.at(-1).seconds}s)`);
  if (!ok) console.log((r.stdout || '').slice(-3000), r.stderr);
}
const reports = ['vehicles', 'world', 'chars'].flatMap((n) => {
  const f = path.join(root, 'blender', `report_${n}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
});
writeFileSync(path.join(root, 'blender', 'asset_manifest.json'), JSON.stringify({ generated: new Date().toISOString(), runs, assets: reports }, null, 1));
console.log(`${reports.length} GLB files described in blender/asset_manifest.json`);
