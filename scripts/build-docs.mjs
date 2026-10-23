// Finalises TELEMETRY.json, fills the auto-generated sections of DOCUMENTATION.md
// (telemetry table, QA checklist, asset table) and renders public/docs.html.
// Usage: node scripts/build-docs.mjs
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT, readTelemetry, updateTelemetry } from './telemetry.mjs';

const START = new Date('2026-10-23T08:41:18+02:00');
const mtime = (p) => (existsSync(path.join(ROOT, p)) ? statSync(path.join(ROOT, p)).mtime : null);
const fmt = (d) => (d ? d.toISOString().replace('.000', '') : '—');
const dur = (ms) => `${Math.floor(ms / 3600000)}h ${Math.round((ms % 3600000) / 60000)}m`;

const qa = existsSync(path.join(ROOT, 'tests/qa-results.json')) ? JSON.parse(readFileSync(path.join(ROOT, 'tests/qa-results.json'), 'utf8')) : null;
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'blender/asset_manifest.json'), 'utf8'));
const now = new Date();
const phases = [
  ['Environment survey & scaffold', START, mtime('package.json')],
  ['Blender asset pipeline (27 GLBs)', mtime('blender/mwlib.py'), mtime('blender/asset_manifest.json')],
  ['Dialogue synthesis (54 lines)', mtime('src/data/dialogue.json'), mtime('public/audio/dialogue/manifest.json')],
  ['Engine, world & gameplay code', mtime('src/config.js'), mtime('src/main.js')],
  ['Automated QA loop', mtime('tests/qa.mjs'), mtime('tests/qa-results.json')],
  ['Documentation', mtime('scripts/build-docs.mjs'), now],
];
const prevT = readTelemetry();
const tel = updateTelemetry({
  summary: {
    buildTime: dur(now - START), startedAt: fmt(START), finishedAt: fmt(now),
    llmCalls: prevT.llm ? prevT.llm.apiCalls : '—', inputTokens: prevT.llm ? prevT.llm.inputTokensDisplay : '—', outputTokens: prevT.llm ? prevT.llm.outputTokensDisplay : '—',
    estimatedCost: prevT.llm ? prevT.llm.estimatedCostDisplay : '—', glbAssets: manifest.assets.length,
    qaPasses: qa ? `${qa.passed}/${qa.total}` : '—',
  },
  phases: phases.map(([name, a, b]) => ({ name, start: fmt(a), end: fmt(b), minutes: a && b ? Math.max(1, Math.round((b - a) / 60000)) : null })),
  assets: { glbFiles: manifest.assets.length, totalTriangles: manifest.assets.reduce((s, a) => s + a.tris, 0), totalBytes: manifest.assets.reduce((s, a) => s + a.bytes, 0),
    blenderRuns: manifest.runs },
});

// ---------------------------------------------------------------- auto sections
const L = tel.llm || {}, E = tel.elevenlabs || {}, D = tel.dialogue || {}, Q = tel.qa || {};
const telemetryMd = [
  '| Metric | Value |', '|---|---|',
  `| Build started → finished | ${tel.summary.startedAt} → ${tel.summary.finishedAt} (**${tel.summary.buildTime}**) |`,
  `| LLM API calls (agent turns) | ${L.apiCalls ?? '—'} ${L.callsNote ? '— ' + L.callsNote : ''} |`,
  `| LLM input tokens | ${L.inputTokensDisplay ?? '—'} |`, `| LLM output tokens | ${L.outputTokensDisplay ?? '—'} |`,
  `| Estimated LLM cost | ${L.estimatedCostDisplay ?? '—'} |`, `| Context window at finish | ${L.contextAtFinish ?? '—'} |`,
  `| ElevenLabs API key present | ${E.apiKeyPresent ? 'yes' : 'no'} |`, `| ElevenLabs API calls / characters | ${E.apiCalls ?? 0} calls / ${E.charactersSynthesized ?? 0} chars |`,
  `| ElevenLabs voice IDs (planned per character) | ${Object.entries(E.plannedVoiceIds || {}).map(([k, v]) => `${k}: \`${v}\``).join(', ')} |`,
  `| Dialogue lines synthesised / characters | ${D.lines ?? '—'} lines / ${D.totalCharacters ?? '—'} chars (${Object.entries(D.engines || {}).map(([k, v]) => `${k}: ${v}`).join(', ')}) |`,
  `| Audio caching | ${E.cacheStatus ?? '—'} |`,
  `| Blender GLB assets | ${tel.assets.glbFiles} files, ${tel.assets.totalTriangles.toLocaleString()} triangles, ${(tel.assets.totalBytes / 1048576).toFixed(1)} MB |`,
  `| QA self-check runs / last result | ${Q.runs ?? 0} full runs · last ${Q.lastPassed ?? '—'}/${Q.lastTotal ?? '—'} · ${Q.totalChecksPassed ?? 0} individual check passes in total |`,
  '', '**Per-phase timestamps** (from artifact modification times)', '', '| Phase | Start | End | Minutes |', '|---|---|---|---|',
  ...tel.phases.map((p) => `| ${p.name} | ${p.start} | ${p.end} | ${p.minutes ?? '—'} |`),
].join('\n');

const qaMd = qa ? [
  `Last run: ${qa.ranAt} — **${qa.passed}/${qa.total} checks passed** in ${qa.durationSec}s (Playwright, Chromium + ANGLE/D3D11 on the local GPU).`, '',
  ...qa.results.map((r) => `- [${r.pass ? 'x' : ' '}] **${r.id}** — ${r.title}${r.pass ? '' : ' ⚠️ ' + JSON.stringify(r.details).slice(0, 220)}`),
  '', '<details><summary>Key measurements</summary>', '', '```json',
  JSON.stringify(Object.fromEntries(qa.results.filter((r) => ['boot', 'physics', 'perf', 'assembly', 'theft', 'escape'].includes(r.id)).map((r) => [r.id, r.id === 'assembly' ? { events: r.details.events } : r.details])), null, 1).slice(0, 3500),
  '```', '</details>',
].join('\n') : '_QA has not been run yet._';

const assetsMd = ['| GLB | Objects | Meshes | Triangles | Hinged / jointed nodes | Size |', '|---|---|---|---|---|---|',
  ...manifest.assets.map((a) => `| \`${a.file}\` | ${a.objects} | ${a.meshes} | ${a.tris.toLocaleString()} | ${a.hinges.length ? a.hinges.slice(0, 9).join(', ') + (a.hinges.length > 9 ? ` … (+${a.hinges.length - 9})` : '') : '—'} | ${(a.bytes / 1024).toFixed(0)} KB |`)].join('\n');

let md = readFileSync(path.join(ROOT, 'DOCUMENTATION.md'), 'utf8');
const fill = (key, body) => { md = md.replace(new RegExp(`<!-- AUTO:${key} -->[\\s\\S]*?<!-- /AUTO:${key} -->`), `<!-- AUTO:${key} -->\n${body}\n<!-- /AUTO:${key} -->`); };
fill('TELEMETRY', telemetryMd);
fill('QA', qaMd);
fill('ASSETS', assetsMd);
const shots = readdirSync(path.join(ROOT, 'public/docs/screenshots')).filter((f) => f.endsWith('.png')).sort();
fill('GALLERY', shots.map((f) => `![${f.replace('.png', '')}](public/docs/screenshots/${f})`).join('\n'));
writeFileSync(path.join(ROOT, 'DOCUMENTATION.md'), md);

// ---------------------------------------------------------------- markdown -> html
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s)
  .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => `<a href="${src.replace(/^public\//, '')}" target="_blank"><img alt="${alt}" src="${src.replace(/^public\//, '')}" loading="lazy"/></a>`)
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, h) => `<a href="${h.replace(/^public\//, '')}">${t}</a>`)
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/(^|[\s(])_([^_]+)_(?=[\s).,]|$)/g, '$1<i>$2</i>');
function toHtml(src) {
  const lines = src.split(/\r?\n/);
  const out = [];
  let i = 0, list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { closeList(); const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(esc(lines[i++])); out.push(`<pre><code>${buf.join('\n')}</code></pre>`); i++; continue; }
    if (/^<!--/.test(l) || /^<\/?details|^<summary/.test(l)) { closeList(); if (!/^<!--/.test(l)) out.push(l); i++; continue; }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { closeList(); const id = h[2].toLowerCase().replace(/[^a-z0-9]+/g, '-'); out.push(`<h${h[1].length} id="${id}">${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\|/.test(l)) {
      closeList();
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      out.push('<table><thead><tr>' + cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.slice(2).map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    const li = l.match(/^(\s*)[-*]\s+(.*)/) || l.match(/^(\s*)\d+\.\s+(.*)/);
    if (li) {
      const type = /^\s*\d+\./.test(l) ? 'ol' : 'ul';
      if (list !== type) { closeList(); out.push(`<${type}>`); list = type; }
      let t = li[2];
      const cb = t.match(/^\[( |x)\]\s+(.*)/);
      if (cb) t = `<span class="cb ${cb[1] === 'x' ? 'ok' : 'no'}">${cb[1] === 'x' ? '✔' : '✘'}</span> ${inline(cb[2])}`; else t = inline(t);
      out.push(`<li>${t}</li>`);
      i++; continue;
    }
    if (/^---+$/.test(l)) { closeList(); out.push('<hr/>'); i++; continue; }
    if (!l.trim()) { closeList(); i++; continue; }
    closeList();
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||```|[-*]\s|\d+\.\s|<)/.test(lines[i])) buf.push(lines[i++]);
    if (buf.length) out.push(`<p>${inline(buf.join(' '))}</p>`); else i++;
  }
  closeList();
  return out.join('\n');
}
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Motorworks Docs</title><style>
:root{--o:#ff7a1a;--bg:#120814;--card:#1d0f22;--ink:#f3ece4;--dim:#b8a7bf}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 Inter,system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 18px 80px}
h1{font-size:40px;color:var(--o);letter-spacing:2px;margin:.2em 0}h2{color:var(--o);border-bottom:1px solid #3a2240;padding-bottom:6px;margin-top:2em}h3{color:#ffb000}
a{color:#ffb36b}code{background:#2a1530;padding:1px 6px;border-radius:5px;font-size:13px}pre{background:#1a0c1f;padding:14px;border-radius:10px;overflow:auto;font-size:12px}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:13px;display:block;overflow-x:auto}th,td{border:1px solid #3a2240;padding:6px 8px;text-align:left;vertical-align:top}th{background:#2a1530}
img{max-width:100%;border-radius:10px;border:1px solid #3a2240;margin:6px 0}p img{width:100%}
li img{max-width:48%;margin:4px}.cb{display:inline-block;width:20px;font-weight:800}.cb.ok{color:#39ff14}.cb.no{color:#ff2a3a}
.top{position:sticky;top:0;background:rgba(18,8,20,.92);padding:8px 18px;border-bottom:1px solid #3a2240;z-index:2}.top a{margin-right:14px}
.gallery img{width:32%;margin:.5%}@media(max-width:700px){.gallery img{width:100%}}
</style></head><body><div class="top"><a href="./">▶ Play Motorworks</a><a href="#telemetry">Telemetry</a><a href="#automated-qa-self-test-loop">QA</a><a href="#screenshot-gallery">Gallery</a></div>
<main>${toHtml(md).replace(/<h2 id="screenshot-gallery">([\s\S]*?)<\/h2>\s*<p>/, '<h2 id="screenshot-gallery">$1</h2><p class="gallery">')}</main></body></html>`;
writeFileSync(path.join(ROOT, 'public', 'docs.html'), html);
console.log(`DOCUMENTATION.md + public/docs.html written (${shots.length} screenshots, QA ${tel.summary.qaPasses})`);
