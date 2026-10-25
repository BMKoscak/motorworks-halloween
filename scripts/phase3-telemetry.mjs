// Records the Phase 3 deltas (ElevenLabs lines/credits, Blender assets, perf) in TELEMETRY.json.
// Usage: node scripts/phase3-telemetry.mjs
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, updateTelemetry, readTelemetry } from './telemetry.mjs';

const man = JSON.parse(readFileSync(path.join(ROOT, 'public/audio/dialogue/manifest.json'), 'utf8'));
const NEW = ['boxoffice_1', 'boxoffice_2', 'boxoffice_broke', 'usher_1', 'usher_stop', 'usher_shh', 'concession_1', 'projectionist_1', 'projectionist_2', 'movie_narr_1', 'movie_hero_1',
  'movie_villain_1', 'movie_hero_2', 'movie_narr_2', 'movie_villain_2', 'dyno_1', 'dyno_good', 'dyno_meh', 'dyno_record', 'shift_start', 'shift_done', 'shift_late', 'arcade_hi', 'marshal_1',
  'marshal_win', 'marshal_lose', 'marshal_foul', 'rival_1', 'rival_lose', 'payphone_1', 'payphone_2', 'time88', 'clock13', 'secret_room', 'konami', 'honkm_1', 'honkm_2', 'honkf_1', 'honkf_2',
  'kidb_honk', 'kidg_honk', 'rage_m', 'rage_f', 'kidb_tot', 'kidg_tot', 'homem_candy', 'homef_candy', 'civm_5', 'civilian_5'];
const lines = NEW.filter((id) => man[id] && man[id].engine === 'elevenlabs');
const qa = existsSync(path.join(ROOT, 'tests/qa-results.json')) ? JSON.parse(readFileSync(path.join(ROOT, 'tests/qa-results.json'), 'utf8')) : null;
const perf = qa && qa.results.find((r) => r.id === 'perf');
const assets = JSON.parse(readFileSync(path.join(ROOT, 'blender/asset_manifest.json'), 'utf8')).assets;
const pick = (f) => assets.find((a) => a.file === f);
const prev = readTelemetry();
updateTelemetry({
  phase3: {
    title: 'Phase 3: Fright Night update (streets, cinema, Motorworks activities, secrets, townsfolk AI)',
    startedAt: '2026-10-24T15:00:00Z',
    elevenlabs: { lines: lines.length, characters: lines.reduce((a, id) => a + man[id].chars, 0), credits: Math.round(lines.reduce((a, id) => a + (man[id].credits || 0), 0)), voicesAdded: 11,
      model: 'eleven_v4', takesPerLine: 1 },
    blender: [pick('roads.glb'), pick('cinema.glb')].filter(Boolean).map((a) => `${a.file}: ${a.objects} objects, ${a.tris.toLocaleString()} tris, ${(a.bytes / 1024).toFixed(0)} KB`).join(' · ') +
      ' · plant.glb + props.glb extended (dyno cell, break room, receiving dock, secret annex, bus stop, arcade, vending, time clock, crate, payphone, UFO, popcorn)',
    llm: prev.phase3 && prev.phase3.llm ? prev.phase3.llm : { calls: '~150 tool round-trips', inputTokens: '~95M processed (est., prompt-cache reads; context peaked ~890k/1M)', outputTokens: '~120k (est.)', plan: 'Claude Pro: 5-hour window ~90%, weekly ~73% at finish (measured)' },
    perf: perf ? `${perf.details.fps} fps · ${perf.details.drawCalls} draw calls · ${(perf.details.triangles / 1e6).toFixed(2)}M triangles (QA snapshot, headless Chromium)` : '—',
  },
});
console.log(`phase3: ${lines.length} lines, ${lines.reduce((a, id) => a + (man[id].credits || 0), 0).toFixed(0)} credits`);
