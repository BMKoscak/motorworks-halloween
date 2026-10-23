// Imports ElevenLabs takes generated through the ElevenLabs connector (Flows) into the game's
// dialogue cache. Input: a JSON file { "<lineId>": { "url": "<signed mp3 url>", "voiceId": "...", "generationId": "..." } }.
// Downloads each MP3 to public/audio/dialogue/<lineId>.mp3, updates manifest.json (engine: elevenlabs)
// and the ElevenLabs section of TELEMETRY.json. Already-imported generations are skipped (cache).
// Usage: node scripts/import-elevenlabs.mjs takes.json
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, updateTelemetry, readTelemetry } from './telemetry.mjs';

const OUT = path.join(ROOT, 'public', 'audio', 'dialogue');
// accepts JSON, or text lines "lineId|voiceId|credits|generationId|url" (one or more files)
const takes = {};
for (const f of process.argv.slice(2)) {
  const txt = readFileSync(f, 'utf8');
  if (f.endsWith('.json')) Object.assign(takes, JSON.parse(txt));
  else for (const l of txt.split(/\r?\n/).filter(Boolean)) {
    const [id, voiceId, credits, generationId, url] = l.split('|');
    takes[id] = { voiceId, credits: +credits, generationId, url };
  }
}
const data = JSON.parse(readFileSync(path.join(ROOT, 'src', 'data', 'dialogue.json'), 'utf8'));
const manifestFile = path.join(OUT, 'manifest.json');
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};
let downloaded = 0, skipped = 0, failed = 0, chars = 0;
for (const [id, t] of Object.entries(takes)) {
  const line = data.lines[id];
  if (!line) { console.warn('unknown line', id); continue; }
  const prev = manifest[id];
  if (prev && prev.engine === 'elevenlabs' && prev.generationId === t.generationId && existsSync(path.join(OUT, prev.file))) { skipped++; continue; }
  try {
    const res = await fetch(t.url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    const file = `${id}.mp3`;
    writeFileSync(path.join(OUT, file), buf);
    manifest[id] = { file, engine: 'elevenlabs', model: 'eleven_v4', voice: line[0], voiceId: t.voiceId, generationId: t.generationId, credits: t.credits,
      chars: line[1].length, text: line[1], bytes: statSync(path.join(OUT, file)).size, hash: createHash('sha1').update(line[1]).digest('hex').slice(0, 12) };
    downloaded++;
    chars += line[1].length;
  } catch (e) { failed++; console.warn(`failed ${id}: ${e.message}`); }
}
writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
const all = Object.values(manifest);
const el = all.filter((m) => m.engine === 'elevenlabs');
updateTelemetry({ dialogue: null }); // replace (not merge) the per-engine counts
updateTelemetry({
  elevenlabs: {
    apiKeyPresent: false, connector: 'ElevenLabs MCP connector (Flows, eleven_v4)', apiCalls: el.length, charactersSynthesized: el.reduce((a, m) => a + m.chars, 0),
    creditsSpent: Math.round(el.reduce((a, m) => a + (m.credits || 0), 0)), voiceIdsUsed: [...new Set(el.map((m) => m.voiceId))],
    plannedVoiceIds: Object.fromEntries(Object.entries(data.voices).map(([k, v]) => [k, v.eleven])),
    cacheStatus: `${el.length} ElevenLabs MP3s cached in public/audio/dialogue (re-imports skip known generations; ${skipped} cache hits this run)`,
    note: 'Generated through the ElevenLabs connector (Flows, eleven_v4); the local SAPI pipeline stays as the fallback for new or changed lines',
  },
  dialogue: { lines: all.length, totalCharacters: all.reduce((a, m) => a + m.chars, 0), engines: all.reduce((a, m) => ((a[m.engine] = (a[m.engine] || 0) + 1), a), {}),
    totalBytes: all.reduce((a, m) => a + (m.bytes || 0), 0) },
});
console.log(`imported ${downloaded}, cached ${skipped}, failed ${failed} (${chars} chars)`);
