// Spoken-dialogue build step.
//  1. If ELEVENLABS_API_KEY is set, every line is synthesised with ElevenLabs (per-character voice ids)
//     and cached as public/audio/dialogue/<id>.mp3.
//  2. Without a key (or when the quota is hit) lines fall back to local Windows SAPI synthesis
//     (System.Speech, three installed voices with per-character rate), cached as <id>.wav.
// A content hash per line means re-running never re-synthesises (no wasted credits).
// Usage stats land in TELEMETRY.json -> "elevenlabs" / "dialogue".
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, updateTelemetry, readTelemetry } from './telemetry.mjs';

const OUT = path.join(ROOT, 'public', 'audio', 'dialogue');
mkdirSync(OUT, { recursive: true });
const data = JSON.parse(readFileSync(path.join(ROOT, 'src', 'data', 'dialogue.json'), 'utf8'));
const manifestFile = path.join(OUT, 'manifest.json');
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};
const KEY = process.env.ELEVENLABS_API_KEY;
const stats = { apiCalls: 0, characters: 0, cachedHits: 0, failures: 0, voiceIds: new Set() };
let quotaHit = false;
const sapiJobs = [];

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

for (const [id, [voice, text]] of Object.entries(data.lines)) {
  const v = data.voices[voice];
  const h = hash(`${voice}|${v.sapi}|${v.rate}|${v.eleven}|${text}`);
  const prev = manifest[id];
  // never replace an ElevenLabs take (imported via the connector) unless --force is passed
  if (prev && prev.engine === 'elevenlabs' && existsSync(path.join(OUT, prev.file)) && !process.argv.includes('--force')) { stats.cachedHits++; continue; }
  if (prev && prev.hash === h && existsSync(path.join(OUT, prev.file)) && (prev.engine === 'elevenlabs' || !KEY)) {
    stats.cachedHits++;
    continue;
  }
  if (KEY && !quotaHit) {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${v.eleven}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35 } }),
      });
      stats.apiCalls++;
      if (res.status === 401 || res.status === 429 || res.status === 402) quotaHit = true;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(path.join(OUT, `${id}.mp3`), buf);
      stats.characters += text.length;
      stats.voiceIds.add(v.eleven);
      manifest[id] = { file: `${id}.mp3`, hash: h, engine: 'elevenlabs', voice, voiceId: v.eleven, chars: text.length, text };
      continue;
    } catch (e) {
      stats.failures++;
      console.warn(`ElevenLabs failed for ${id}: ${e.message} -> local fallback`);
    }
  }
  sapiJobs.push({ id, text, v, h, voice });
}

if (sapiJobs.length) {
  const esc = (s) => s.replace(/'/g, "''");
  const ps = [
    'Add-Type -AssemblyName System.Speech',
    '$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
    ...sapiJobs.map((j) => [
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      `$s.SelectVoice('${esc(j.v.sapi)}')`,
      `$s.Rate = ${j.v.rate}`,
      `$s.SetOutputToWaveFile('${esc(path.join(OUT, j.id + '.wav'))}', $fmt)`,
      `$s.Speak('${esc(j.text)}')`,
      '$s.Dispose()',
    ].join('; ')),
  ].join('\n');
  const psFile = path.join(ROOT, 'scripts', '.sapi_job.ps1');
  writeFileSync(psFile, ps);
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile], { encoding: 'utf8' });
  if (r.status !== 0) console.error(r.stderr);
  for (const j of sapiJobs) {
    const f = path.join(OUT, j.id + '.wav');
    if (existsSync(f)) manifest[j.id] = { file: `${j.id}.wav`, hash: j.h, engine: 'sapi-local', voice: j.voice, sapiVoice: j.v.sapi, chars: j.text.length, text: j.text, bytes: statSync(f).size };
  }
}
writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));

const all = Object.values(manifest);
const prevEl = readTelemetry().elevenlabs || {};
updateTelemetry({
  elevenlabs: {
    apiKeyPresent: !!KEY,
    apiCalls: (prevEl.apiCalls || 0) + stats.apiCalls,
    charactersSynthesized: (prevEl.charactersSynthesized || 0) + stats.characters,
    voiceIdsUsed: [...new Set([...(prevEl.voiceIdsUsed || []), ...stats.voiceIds])],
    plannedVoiceIds: Object.fromEntries(Object.entries(data.voices).map(([k, v]) => [k, v.eleven])),
    quotaHit,
    cacheStatus: `${all.length} lines cached in public/audio/dialogue (re-runs skip unchanged lines; ${stats.cachedHits} cache hits this run)`,
    note: all.every((m) => m.engine === 'elevenlabs') ? 'All lines are cached ElevenLabs takes; nothing re-synthesised'
      : KEY ? 'ElevenLabs used where available' : 'No ELEVENLABS_API_KEY in environment; local SAPI fallback synthesised the missing lines',
  },
  dialogue: {
    lines: all.length,
    totalCharacters: all.reduce((a, m) => a + m.chars, 0),
    engines: all.reduce((a, m) => ((a[m.engine] = (a[m.engine] || 0) + 1), a), {}),
    localVoices: [...new Set(all.filter((m) => m.sapiVoice).map((m) => m.sapiVoice))],
    totalBytes: all.reduce((a, m) => a + (m.bytes || 0), 0),
  },
});
console.log(`dialogue: ${all.length} lines (${sapiJobs.length} synthesised locally, ${stats.apiCalls} ElevenLabs calls, ${stats.cachedHits} cached)`);
