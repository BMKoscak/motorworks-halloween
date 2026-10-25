import * as THREE from 'three';
import { groundAt } from '../actors/agent.js';
import { crossings } from '../world/streetGeom.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const V = (x, z) => new THREE.Vector3(x, 0, z);

/**
 * Sidewalk network for townsfolk: Main Street / Elm Avenue sidewalks as chains of nodes, the painted crosswalks as
 * "crossing" edges (signalised ones wait for the WALK phase, mid-block ones wait for a gap in traffic), yard paths to
 * porches, and points of interest (benches, bus stops, shop/cinema/diner doors, the Motorworks lobby).
 */
export class SidewalkNet {
  constructor(game) {
    this.game = game;
    this.nodes = [];
    this.pois = [];
  }

  node(p, meta = {}) {
    for (const n of this.nodes) if (Math.hypot(n.p.x - p.x, n.p.z - p.z) < 0.6) { Object.assign(n, meta); return n; }
    const n = { id: this.nodes.length, p: p.clone(), adj: [], ...meta };
    this.nodes.push(n);
    return n;
  }

  link(a, b, meta = {}) {
    if (a === b || a.adj.some((e) => e.n === b)) return;
    const c = a.p.distanceTo(b.p) * (meta.crossing ? 1.6 : 1);
    a.adj.push({ n: b, c, ...meta });
    b.adj.push({ n: a, c, ...meta });
  }

  /** A sidewalk strip: a straight chain; extra points get spliced in at their projection. */
  strip(a, b, extra) {
    const dir = b.clone().sub(a);
    const L = dir.length(); dir.normalize();
    const pts = [a, b, ...extra.filter((p) => { const t = p.clone().sub(a).dot(dir); const off = p.clone().sub(a).addScaledVector(dir, -t).length(); return t > -0.5 && t < L + 0.5 && off < 2.5; })
      .map((p) => a.clone().addScaledVector(dir, THREE.MathUtils.clamp(p.clone().sub(a).dot(dir), 0, L)))];
    for (let s = 20; s < L - 5; s += 20) pts.push(a.clone().addScaledVector(dir, s));
    pts.sort((p, q) => p.clone().sub(a).dot(dir) - q.clone().sub(a).dot(dir));
    let prev = null;
    for (const p of pts) { const n = this.node(p); if (prev) this.link(prev, n); prev = n; }
  }

  nearest(p) {
    let best = null, bd = Infinity;
    for (const n of this.nodes) { const d = Math.hypot(n.p.x - p.x, n.p.z - p.z); if (d < bd) { bd = d; best = n; } }
    return best;
  }

  build(town, cinema) {
    const cw = crossings();
    // crossing endpoints snapped onto the sidewalk centre lines (z = +/-9 on Main, x = +/-7.8 on Elm)
    const snap = (p) => {
      if (Math.abs(p.z) < 12 && Math.abs(p.x) > 9) return V(p.x, Math.sign(p.z) * 9);
      if (p.z > 9 && Math.abs(p.x) < 10) return V(Math.sign(p.x) * 7.8, p.z);
      return p.clone().setY(0);
    };
    const ends = [];
    for (const c of cw) ends.push({ c, a: snap(c.a), b: snap(c.b) });
    const extraPts = ends.flatMap((e) => [e.a, e.b]);
    // POIs along the sidewalks
    const poi = (name, p, kind, extra = {}) => { const q = snap(p); extraPts.push(q); this.pois.push({ name, p: q, at: p.clone().setY(0), kind, ...extra }); };
    poi('Moonlite Diner', town.spots.dinerDoor, 'door');
    for (const b of this.game.buildings.list) {
      if (!b.spots.Outside || b.house) continue;
      if (b.kind === 'plant' || b.kind === 'cinema') continue;
      poi(b.name, b.spots.Outside, 'door');
    }
    if (cinema && cinema.b) poi('Palace Cinema', cinema.b.spots.BoxOffice, 'cinema');
    for (const bs of town.busStops || []) poi('Bus stop', bs.seat, 'bus', { seat: bs.seat, yaw: bs.yaw });
    for (const bn of town.benchSpots || []) poi('Bench', bn.p, 'bench', { seat: bn.p, yaw: bn.yaw });
    // the sidewalks themselves
    this.strip(V(-186, 9), V(-6.5, 9), extraPts);
    this.strip(V(6.5, 9), V(186, 9), extraPts);
    this.strip(V(-186, -9), V(-62, -9), extraPts);
    this.strip(V(62, -9), V(71, -9), extraPts);
    this.strip(V(81, -9), V(186, -9), extraPts);
    this.strip(V(-7.8, 11), V(-7.8, 144), extraPts);
    this.strip(V(7.8, 11), V(7.8, 144), extraPts);
    this.link(this.node(V(-6.5, 9)), this.node(V(-7.8, 11)));
    this.link(this.node(V(6.5, 9)), this.node(V(7.8, 11)));
    // crossings (both ends must exist as nodes; open lot frontage ends get their own node)
    for (const e of ends) {
      const a = this.node(e.a), b = this.node(e.b);
      this.link(a, b, { crossing: true, signal: e.c.signal, node: e.c.node, group: e.c.group, road: e.c.road, mid: e.c.a.clone().add(e.c.b).multiplyScalar(0.5) });
    }
    // Motorworks lobby across the parking lot from the lot-side crosswalk ends
    const lobby = this.node(V(-45, -57.5), { poi: true });
    this.pois.push({ name: 'Motorworks lobby', p: lobby.p, at: lobby.p.clone(), kind: 'door' });
    for (const n of this.nodes) if (n.p.z < -8 && n.p.z > -10 && n.p.x > -60 && n.p.x < 60) this.link(n, lobby, { yard: true });
    // porches (trick-or-treat): a straight yard path from the nearest sidewalk node
    for (const h of town.houses) {
      if (Math.abs(h.porch.z) > 150) continue;
      const near = this.nearest(h.porch);
      if (!near || near.p.distanceTo(h.porch) > 30) continue;
      const n = this.node(h.porch.clone().setY(0), { porch: h });
      this.link(near, n, { yard: true });
      this.pois.push({ name: 'Porch', p: n.p, at: n.p.clone(), kind: 'porch', house: h });
    }
    for (const p of this.pois) p.node = this.nearest(p.p);
    this.stats = { nodes: this.nodes.length, edges: this.nodes.reduce((a, n) => a + n.adj.length, 0) / 2, crossings: ends.length, pois: this.pois.length };
  }

  path(a, b) {
    if (!a || !b) return null;
    const open = new Map([[a.id, { n: a, g: 0, f: a.p.distanceTo(b.p), prev: null, e: null }]]), closed = new Set();
    while (open.size) {
      let cur = null;
      for (const r of open.values()) if (!cur || r.f < cur.f) cur = r;
      open.delete(cur.n.id); closed.add(cur.n.id);
      if (cur.n === b) { const out = []; for (let r = cur; r; r = r.prev) out.unshift({ n: r.n, e: r.e }); return out; }
      for (const e of cur.n.adj) {
        if (closed.has(e.n.id)) continue;
        const g = cur.g + e.c;
        const o = open.get(e.n.id);
        if (!o || g < o.g) open.set(e.n.id, { n: e.n, g, f: g + e.n.p.distanceTo(b.p), prev: cur, e });
      }
    }
    return null;
  }
}

/**
 * Townsfolk brain for each sidewalk pedestrian: pick a destination (doors, cinema, benches, bus stops, porches for the
 * trick-or-treaters), walk the sidewalk network, wait at the kerb for WALK / a traffic gap, do something there (sit,
 * wait for the bus, go inside, ring the doorbell), stop to chat with passers-by, and jump back + shout when honked at.
 */
export class Townsfolk {
  constructor(game, net) {
    this.game = game;
    this.net = net;
    this.chatCooldown = 0;
    this.stats = { trips: 0, crossings: 0, signalWaits: 0, gapWaits: 0, chats: 0, honkReactions: 0, trickOrTreats: 0, visits: 0 };
  }

  init(p) {
    p.brain = { state: 'plan', path: null, i: 0, wait: rnd(0, 3), dest: null, act: 0 };
    const n = pick(this.net.nodes.filter((x) => !x.porch));
    p.char.root.position.copy(n.p);
  }

  _plan(p) {
    const B = p.brain, net = this.net;
    let choices = net.pois.filter((x) => x.kind !== 'porch');
    if (p.kid) choices = net.pois.filter((x) => x.kind === 'porch' || x.kind === 'cinema' || x.kind === 'bench');
    const dest = pick(choices);
    const from = net.nearest(p.char.root.position);
    const path = net.path(from, dest.node || net.nearest(dest.p));
    if (!path) { B.wait = 2; return; }
    B.dest = dest; B.path = path; B.i = 0; B.state = 'walk';
    this.stats.trips++;
  }

  honk(pos, dir) {
    const g = this.game;
    let shouted = false;
    for (const p of g.npcs.pedestrians) {
      const q = p.char.root.position;
      const rel = q.clone().sub(pos);
      const ahead = rel.dot(dir);
      if (ahead < -2 || ahead > 16 || rel.length() > 16 || p.down > 0) continue;
      p.dodge = 0.9;
      p.dodgeDir = rel.setY(0).normalize();
      this.stats.honkReactions++;
      if (!shouted && rel.length() < 12) {
        shouted = true;
        const ag = p.profile.ageGroup;
        const id = ag === 'child_boy' ? 'kidb_honk' : ag === 'child_girl' ? 'kidg_honk' : ag === 'adult_female' ? pick(['honkf_1', 'honkf_2']) : pick(['honkm_1', 'honkm_2']);
        g.npcs.speak(p, id);
        p.talkT = 1.5;
      }
    }
  }

  update(p, dt, visible) {
    const g = this.game, B = p.brain, pos = p.char.root.position;
    if (B.state === 'plan') { if ((B.wait -= dt) < 0) this._plan(p); if (visible) p.char.update(dt, 'idle'); return; }
    if (B.state === 'inside') { if ((B.act -= dt) < 0) { B.state = 'plan'; B.wait = 0.5; p.char.root.visible = true; p.hidden = false; } return; }
    // being talked to (player or QA): stand still and talk until the line is done
    if (p.talkT > 0 && B.state !== 'do' && B.state !== 'inside') { if (visible) p.char.update(dt, 'talk'); return; }
    if (B.state === 'approach') {
      // last few metres off the network: straight to the door / bench / bus seat
      const t = B.target, dx = t.x - pos.x, dz = t.z - pos.z, d = Math.hypot(dx, dz);
      if (d < 0.35) { this._act(p); return; }
      const sp = Math.min(d, (p.kid ? 1.5 : 1.25) * dt);
      pos.x += (dx / d) * sp; pos.z += (dz / d) * sp;
      pos.y = groundAt(g, pos.x, pos.z, pos.y);
      p.char.root.rotation.y = Math.atan2(dx, dz);
      if (visible) p.char.update(dt, 'walk');
      return;
    }
    if (B.state === 'do') {
      B.act -= dt;
      const d = B.dest;
      if (d.kind === 'bench' || (d.kind === 'bus' && B.sit)) { pos.copy(d.seat).setY(d.seat.y - 0.85 * p.char.root.scale.y); p.char.root.rotation.y = d.yaw; if (visible) p.char.update(dt, 'sit'); }
      else if (visible) p.char.update(dt, p.talkT > 0 ? 'talk' : 'idle');
      if (B.act < 0) { B.state = 'plan'; B.wait = rnd(0.5, 3); if (d.kind === 'bench' || d.kind === 'bus') { pos.copy(d.seat).setY(groundAt(g, d.seat.x, d.seat.z)); } }
      return;
    }
    if (B.state === 'chat') {
      B.act -= dt;
      p.char.root.rotation.y = Math.atan2(B.with.char.root.position.x - pos.x, B.with.char.root.position.z - pos.z);
      if (visible) p.char.update(dt, 'talk');
      if (B.act < 0) { B.state = 'walk'; }
      return;
    }
    // walking the path
    const step = B.path[B.i];
    if (!step) { this._arrive(p); return; }
    const target = step.n.p;
    // about to step onto a crossing edge: wait at the kerb for WALK (signal) or a gap in traffic (mid-block)
    const e = step.e;
    if (e && e.crossing && !B.crossing) {
      const toT = Math.hypot(target.x - pos.x, target.z - pos.z);
      const prev = B.path[B.i - 1];
      const atKerb = prev && Math.hypot(prev.n.p.x - pos.x, prev.n.p.z - pos.z) < 0.9;
      if (atKerb || toT > (e.c / 1.6) - 0.5) {
        let ok = true;
        if (e.signal) { ok = g.signals.walk(e.node, e.group); if (!ok) this.stats.signalWaits++; }
        else {
          const cars = [...g.traffic.driving.map((c) => c.body.position), ...(g.player.vehicle ? [g.player.vehicle.position] : []), ...g.police.cars.map((c) => c.position)];
          ok = !cars.some((c) => Math.hypot(c.x - e.mid.x, c.z - e.mid.z) < 22);
          if (!ok) this.stats.gapWaits++;
        }
        if (!ok) { p.char.root.rotation.y = Math.atan2(target.x - pos.x, target.z - pos.z); if (visible) p.char.update(dt, 'idle'); return; }
        B.crossing = true;
        this.stats.crossings++;
      }
    }
    const dx = target.x - pos.x, dz = target.z - pos.z, d = Math.hypot(dx, dz);
    const spd = (p.kid ? 1.5 : 1.25) * (B.crossing ? 1.35 : 1);
    if (d < 0.35) { B.i++; B.crossing = false; return; }
    pos.x += (dx / d) * spd * dt; pos.z += (dz / d) * spd * dt;
    // side-by-side offset so oncoming walkers don't merge
    p.char.root.rotation.y = Math.atan2(dx, dz);
    if (visible || (g.frames + p.offset * 10) % 6 < 1) pos.y = groundAt(g, pos.x, pos.z, pos.y);
    if (visible) p.char.update(dt, 'walk');
    // passers-by sometimes stop for a chat
    if (!B.crossing && !p.kid && this.chatCooldown <= 0 && Math.random() < dt * 0.4) {
      const other = g.npcs.pedestrians.find((o) => o !== p && !o.kid && o.brain && o.brain.state === 'walk' && !o.brain.crossing && o.char.root.position.distanceTo(pos) < 2.2);
      if (other) {
        const t = rnd(3, 6);
        B.state = 'chat'; B.with = other; B.act = t;
        other.brain.state = 'chat'; other.brain.with = p; other.brain.act = t;
        this.chatCooldown = 6;
        this.stats.chats++;
        const recent = g.dialogueLog.length && performance.now() - g.dialogueLog.at(-1).at < 9000;
        if (!recent && pos.distanceTo(g.player.position) < 10) { const ag = p.profile.ageGroup; g.npcs.speak(p, ag === 'adult_female' ? pick(['civilian_5', ...p.profile.lines]) : pick(['civm_5', ...p.profile.lines])); }
      }
    }
  }

  _arrive(p) {
    const B = p.brain, d = B.dest;
    B.path = null;
    B.state = 'approach';
    B.target = (d.seat || d.at).clone();
    // stop in front of the seat, not inside the bench
    if (d.seat) B.target.add(new THREE.Vector3(Math.sin(d.yaw), 0, Math.cos(d.yaw)).multiplyScalar(0.55));
  }

  _act(p) {
    const g = this.game, B = p.brain, d = B.dest;
    B.state = 'do';
    this.stats.visits++;
    if (d.kind === 'door' || d.kind === 'cinema') {
      // walk up to the door and go inside for a while
      p.char.root.position.copy(d.at).setY(groundAt(g, d.at.x, d.at.z));
      B.state = 'inside'; B.act = d.kind === 'cinema' ? rnd(40, 90) : rnd(15, 45);
      p.char.root.visible = false; p.hidden = true;
      return;
    }
    if (d.kind === 'porch') {
      B.act = rnd(4, 7);
      const near = p.char.root.position.distanceTo(g.player.position) < 18;
      if (near) {
        g.audio.doorbell();
        g.npcs.speak(p, p.profile.ageGroup === 'child_girl' ? 'kidg_tot' : 'kidb_tot');
        const homeowner = Math.random() < 0.5 ? 'adult_male' : 'adult_female';
        setTimeout(() => g.npcs.speak({ profile: { ageGroup: homeowner }, char: null }, homeowner === 'adult_male' ? 'homem_candy' : 'homef_candy'), 2400);
      }
      this.stats.trickOrTreats++;
      return;
    }
    if (d.kind === 'bench') { B.act = rnd(8, 20); return; }
    if (d.kind === 'bus') { B.act = rnd(8, 18); B.sit = Math.random() < 0.6; return; }
    B.act = rnd(2, 5);
  }

  tick(dt) { this.chatCooldown -= dt; }
}
