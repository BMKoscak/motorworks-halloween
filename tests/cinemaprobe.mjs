// Palace Screen 2 + second film probe (Phase 4). Usage: node tests/cinemaprobe.mjs
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'public', 'docs', 'screenshots', 'phase4');
mkdirSync(OUT, { recursive: true });
const launchOpts = { headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] };
const browser = await chromium.launch(launchOpts).catch(() => chromium.launch({ ...launchOpts, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const MW = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
await page.goto(process.env.MW_URL || 'http://localhost:3000/');
await page.waitForFunction(() => window.__MW && window.__MW.ready(), null, { timeout: 180000 });
await MW(() => { window.__MW.setQuality('high'); window.__MW.start(); window.__MW.setHour(20); });
await page.waitForFunction(() => window.__MW.state().mode === 'play', null, { timeout: 20000 }); // Start is async (audio init), then sets mode = 'play'
await sleep(1500);
const r = {};
r.setup = await MW(() => { const c = window.__MW.game.cinema; return { seats1: c.seats.filter((s) => s.screen === 1).length, seats2: c.seats.filter((s) => s.screen === 2).length, screen2: !!c.screen2,
  screen2Center: c.screen2Center && c.screen2Center.toArray().map((n) => +n.toFixed(1)), door2: c.b.spots.Screen2Door && c.b.spots.Screen2Door.toArray().map((n) => +n.toFixed(1)), films: Object.keys(c.films) }; });

// exterior: the annex with its SCREEN 2 neon beside the marquee
await MW(() => { const c = window.__MW.game.cinema; const p = c.local(-6, 0, 30); window.__MW.shot(p.x, 6, p.z, c.local(-10, 4, 8).x, 4, c.local(-10, 4, 8).z); });
await sleep(900); await shot('43_palace_exterior_screen2_annex'); await MW(() => window.__MW.resume());

// lobby doorway (no ticket -> the usher bounces you), then buy a ticket and walk in
await MW(() => { const c = window.__MW.game.cinema, s = c.b.spots; window.__MW.game.player.teleport(s.BoxOffice.clone(), c.rot + Math.PI); });
await sleep(400);
r.prompt = await MW(() => window.__MW.prompt());
await MW(() => window.__MW.interact());
await sleep(500);
r.ticket = await MW(() => window.__MW.game.cinema.ticket > 0);
await MW(() => { const c = window.__MW.game.cinema; const d = c.local(-8.0, 1.8, 11.9), l = c.local(-13, 1.6, 11.9); window.__MW.shot(d.x, d.y, d.z, l.x, l.y, l.z); });
await sleep(800); await shot('43_palace_lobby_screen2_doorway'); await MW(() => window.__MW.resume());

// inside Screen 2, take a seat (row C) and watch: jump the clock to a few scenes of the new film
const seat = await MW(() => { const c = window.__MW.game.cinema; const s = c.seats.find((x) => x.screen === 2 && x.row === 2 && x.col === 7); window.__MW.game.player.teleport(s.pos.clone().setY(s.pos.y - 0.4), s.yaw); return s.pos.toArray(); });
await sleep(500);
r.inAnnex = await MW(() => window.__MW.game.cinema.inAnnex(window.__MW.game.player.position));
r.seatPrompt = await MW(() => window.__MW.prompt());
await MW(() => window.__MW.interact());
await sleep(800);
r.seated = await MW(() => { const c = window.__MW.game.cinema; return { seated: !!c.seat, screen: c.seat && c.seat.screen, film: c.seatFilm && c.seatFilm.id, watching: c.watching() }; });
const scenes = [['ptitle', 14], ['patch', 26], ['growth', 41], ['rampage', 52], ['showdown', 67], ['splat', 75]];
r.frames = {};
for (const [name, t] of scenes) {
  await MW((tt) => { const g = window.__MW.game, f = g.cinema.films.pumpkin; g.time = Math.floor(g.time / f.length) * f.length + tt; }, t);
  await sleep(700);
  r.frames[name] = await MW(() => { const c = window.__MW.game.cinema, f = c.films.pumpkin; return { scene: f.scene(c.filmTime(f)), frames: f.frames }; });
  await shot('44_screen2_' + name);
}
// a cue line plays and subtitles while seated
await MW(() => { const g = window.__MW.game, f = g.cinema.films.pumpkin; g.time = Math.floor(g.time / f.length) * f.length + 23.8; });
await sleep(1500);
r.cue = await MW(() => ({ played: window.__MW.game.cinema.stats.cuesPlayed, dialog: window.__MW.state().dialogue.slice(-2).map((d) => d.id) }));
await MW(() => window.__MW.game.cinema.stand());
await sleep(400);

// side view of Screen 2 from the front corner (screen, rows, projector beam)
await MW(() => { const c = window.__MW.game.cinema; const e = c.local(-11.2, 3.4, -9.5), l = c.local(-17, 1.6, 4); window.__MW.shot(e.x, e.y, e.z, l.x, l.y, l.z); });
await sleep(800); await shot('43_screen2_auditorium'); await MW(() => window.__MW.resume());

// drive-in: the midnight movie is the Pumpkin
await MW(() => window.__MW.setHour(0.5));
await sleep(300);
await MW(() => { const c = window.__MW.game.cinema; const d = c.driveCenter; window.__MW.shot(d.x, d.y - 2, d.z - 30, d.x, d.y, d.z); });
await sleep(1200);
r.drive = await MW(() => { const c = window.__MW.game.cinema; return { film: c.driveFilm().id, mapOk: c.driveMat.map === c.driveFilm().tex }; });
await shot('44_drivein_midnight_pumpkin'); await MW(() => window.__MW.resume());
r.errors = await MW(() => window.__MW.state().errors);
writeFileSync(path.join(process.cwd(), 'tests', 'cinemaprobe.json'), JSON.stringify(r, null, 1));
console.log(JSON.stringify(r));
await browser.close();
