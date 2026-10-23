// Tiny helper shared by the build scripts: deep-merges a patch into TELEMETRY.json
// and mirrors it to public/TELEMETRY.json so the in-game badge can fetch it.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'TELEMETRY.json');

function merge(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) merge(a[k], v);
    else a[k] = v;
  }
  return a;
}

export function readTelemetry() {
  return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
}

export function updateTelemetry(patch) {
  const t = merge(readTelemetry(), patch);
  const txt = JSON.stringify(t, null, 2);
  writeFileSync(FILE, txt);
  writeFileSync(path.join(ROOT, 'public', 'TELEMETRY.json'), txt);
  return t;
}
