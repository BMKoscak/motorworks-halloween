import * as THREE from 'three';
import { STREETS, approach } from '../world/streetGeom.js';

/**
 * Closed-loop road graph for AI traffic and police patrols.
 * Two-way roads (centrelines between named nodes) become two right-hand lanes offset 2.6 m from the centre,
 * trimmed at junctions and joined by smooth Bezier connectors; dead ends get U-turn loops, so every lane has a successor
 * and cars circulate Main Street, Elm Avenue, the Factory Loop, the outer avenues and the Hill Road forever without leaving the asphalt.
 * The network itself lives in src/data/streets.json (shared with blender/build_roads.py, which models the asphalt from it).
 */
const NODES = STREETS.nodes;
const ROADS = STREETS.roads.filter((r) => r.graph !== false);
const DEAD_ENDS = new Set(STREETS.deadEnds);
const TRIM = 7;

function polyline(pts, step = 1.5) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], L = a.distanceTo(b), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) out.push(a.clone().lerp(b, k / n));
  }
  out.push(pts.at(-1).clone());
  return out;
}

function smoothPath(pts) {
  if (pts.length < 3) return polyline(pts);
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
  return curve.getSpacedPoints(Math.ceil(curve.getLength() / 1.5));
}

function offsetLine(line, d) {
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const t = b.clone().sub(a).setY(0).normalize();
    return p.clone().add(new THREE.Vector3(-t.z, 0, t.x).multiplyScalar(d)); // right-hand side, matches the town's lane convention
  });
}

function trimLine(line, fromStart, fromEnd) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + line[i].distanceTo(line[i - 1]));
  const L = cum.at(-1);
  const at = (s) => { let i = cum.findIndex((c) => c >= s); if (i <= 0) return line[0].clone(); const k = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1); return line[i - 1].clone().lerp(line[i], k); };
  const out = [at(fromStart)];
  for (let i = 0; i < line.length; i++) if (cum[i] > fromStart && cum[i] < L - fromEnd) out.push(line[i].clone());
  out.push(at(L - fromEnd));
  return out;
}

function bezier(a, c, b, n = 10) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push(new THREE.Vector3(u * u * a.x + 2 * u * t * c.x + t * t * b.x, 0, u * u * a.z + 2 * u * t * c.z + t * t * b.z));
  }
  return out;
}

export class Segment {
  constructor(pts, kind, meta = {}) {
    this.pts = pts;
    this.kind = kind; // 'lane' | 'turn' | 'uturn'
    Object.assign(this, meta);
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    this.length = this.cum.at(-1);
    this.next = [];
  }
  at(s) {
    s = THREE.MathUtils.clamp(s, 0, this.length);
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < s) i++;
    const a = this.pts[i - 1], b = this.pts[i];
    const k = (s - this.cum[i - 1]) / (this.cum[i] - this.cum[i - 1] || 1);
    return { p: a.clone().lerp(b, k), dir: b.clone().sub(a).setY(0).normalize() };
  }
  /** Curvature hint: heading change over the next `ahead` metres (radians). */
  bend(s, ahead = 8) {
    const a = this.at(s).dir, b = this.at(Math.min(this.length, s + ahead)).dir;
    return Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
  }
}

export class RoadGraph {
  constructor() {
    this.nodes = Object.fromEntries(Object.entries(NODES).map(([k, [x, z]]) => [k, { id: k, p: new THREE.Vector3(x, 0, z), in: [], out: [], dead: DEAD_ENDS.has(k), busy: null }]));
    this.lanes = [];
    this.connectors = [];
    for (const r of ROADS) {
      const A = this.nodes[r.a], B = this.nodes[r.b];
      const pts = [A.p, ...(r.via || []).map(([x, z]) => new THREE.Vector3(x, 0, z)), B.p];
      const center = r.via ? smoothPath(pts) : polyline(pts);
      for (const dir of [1, -1]) {
        const c = dir > 0 ? center : center.slice().reverse();
        const from = dir > 0 ? A : B, to = dir > 0 ? B : A;
        // lanes end at the painted stop bar of signalised / stop-controlled approaches, else TRIM before the node
        const trimAt = (n) => { const ap = approach(n.id, r.id); return ap.stopDist ? ap.stopDist + 1.4 : n.dead ? 4 : TRIM; };
        const lane = trimLine(offsetLine(c, r.w), trimAt(from), trimAt(to));
        const seg = new Segment(lane, 'lane', { road: r.id, from: from.id, to: to.id, control: approach(to.id, r.id) });
        this.lanes.push(seg);
        from.out.push(seg);
        to.in.push(seg);
      }
    }
    // junction connectors (no U-turns at junctions) and dead-end U-turn loops
    for (const n of Object.values(this.nodes)) {
      for (const inc of n.in) {
        for (const out of n.out) {
          const uturn = out.road === inc.road;
          if (uturn && !n.dead) continue;
          if (!uturn && n.dead) continue;
          const a = inc.pts.at(-1), b = out.pts[0];
          let ctrl;
          if (uturn) {
            const fwd = inc.at(inc.length).dir;
            ctrl = a.clone().add(b).multiplyScalar(0.5).addScaledVector(fwd, 5.5);
          } else {
            // control point = where the two lane lines meet (straight-through keeps to its lane)
            const di = inc.at(inc.length).dir, dq = out.at(0).dir;
            const cross = di.x * dq.z - di.z * dq.x;
            if (Math.abs(cross) < 0.25) ctrl = a.clone().add(b).multiplyScalar(0.5);
            else {
              const t = THREE.MathUtils.clamp(((b.x - a.x) * dq.z - (b.z - a.z) * dq.x) / cross, -12, 12);
              ctrl = a.clone().addScaledVector(di, t);
            }
          }
          const pts = uturn ? bezier(a, ctrl, b, 18) : bezier(a, ctrl, b, 16);
          const seg = new Segment(pts, uturn ? 'uturn' : 'turn', { node: n.id, from: inc.road, to: out.road });
          seg.next = [out];
          inc.next.push(seg);
          this.connectors.push(seg);
        }
      }
    }
    this.segments = [...this.lanes, ...this.connectors];
  }

  lane(road, from) { return this.lanes.find((l) => l.road === road && l.from === from); }

  /** Closest point on any lane: { seg, s, p, d } (used for spawning and the out-of-bounds watchdog). */
  nearest(p, lanesOnly = true) {
    let best = null;
    for (const seg of lanesOnly ? this.lanes : this.segments) {
      for (let i = 0; i < seg.pts.length; i++) {
        const q = seg.pts[i];
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (!best || d < best.d) best = { seg, s: seg.cum[i], p: q.clone(), d };
      }
    }
    return best;
  }

  /** Random lane positions spread across the network. */
  spawnPoints(n) {
    const total = this.lanes.reduce((a, l) => a + l.length, 0);
    const out = [];
    for (let i = 0; i < n; i++) {
      let s = ((i + 0.37) / n) * total;
      for (const l of this.lanes) { if (s < l.length) { out.push({ seg: l, s: Math.max(2, Math.min(l.length - 2, s)) }); break; } s -= l.length; }
    }
    return out;
  }
}
