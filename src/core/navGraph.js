import * as THREE from 'three';
import { terrainHeight } from '../world/terrain.js';

/**
 * Pedestrian navigation graph (foot police, homeowners, burglary NPCs).
 * Nodes: a coarse outdoor grid plus every building's door/room anchors (Spot_* from the Blender interior kit).
 * Edges: line-of-sight checks against the static colliders at hip height, plus explicit doorway edges
 * (Outside <-> Inside, BackOut <-> BackIn) that only open when the hinged door is open or unlocked.
 */
export class NavGraph {
  constructor(game) {
    this.game = game;
    this.nodes = [];
    this.stats = { nodes: 0, edges: 0, rays: 0, buildMs: 0 };
  }

  _add(p, meta = {}) {
    const n = { id: this.nodes.length, p: p.clone(), adj: [], ...meta };
    this.nodes.push(n);
    return n;
  }

  _link(a, b, door = null) {
    if (a.adj.some((e) => e.n === b)) return;
    const c = a.p.distanceTo(b.p);
    a.adj.push({ n: b, c, door });
    b.adj.push({ n: a, c, door });
    this.stats.edges++;
  }

  _clear(a, b) {
    this.stats.rays++;
    const from = a.clone(), to = b.clone();
    from.y += 0.9; to.y += 0.9;
    const hit = this.game.physics.rayStatic(from, to);
    return !hit || (hit.body.userData.node && /^COL_Door/.test(hit.body.userData.node.name));
  }

  build(town, buildings) {
    const t0 = performance.now();
    const blocked = (x, z) => buildings.list.some((b) => x > b.box.min.x - 0.6 && x < b.box.max.x + 0.6 && z > b.box.min.z - 0.6 && z < b.box.max.z + 0.6) ||
      town.buildings.some((b) => x > b.x0 - 0.5 && x < b.x1 + 0.5 && z > b.z0 - 0.5 && z < b.z1 + 0.5);
    // outdoor grid (11 m)
    const S = 11, grid = new Map();
    for (let x = -187; x <= 187; x += S) {
      for (let z = -140; z <= 330; z += S) {
        if (blocked(x, z)) continue;
        if (z > 214 && Math.abs(x) > 60) continue;
        grid.set(`${x},${z}`, this._add(new THREE.Vector3(x, terrainHeight(x, z), z), { kind: 'grid' }));
      }
    }
    // building anchors
    for (const b of buildings.list) {
      b.nav = {};
      for (const [k, p] of Object.entries(b.spots)) b.nav[k] = this._add(p, { kind: 'room', building: b, spot: k });
      const pairs = [['Outside', 'Inside', 'Door_Front'], ['BackOut', 'BackIn', 'Door_Back']];
      for (const [o, i, dn] of pairs) if (b.nav[o] && b.nav[i]) this._link(b.nav[o], b.nav[i], b.doors[dn] || null);
      // rooms inside the same building see each other through interior doorways
      const rooms = Object.values(b.nav).filter((n) => !/Out/.test(n.spot) && n.spot !== 'Breaker' && n.spot !== 'Fence');
      for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) if (this._clear(rooms[i].p, rooms[j].p)) this._link(rooms[i], rooms[j]);
    }
    // connect grid neighbours and building exterior anchors by line of sight
    const outdoor = this.nodes.filter((n) => n.kind === 'grid' || /Out|Breaker|Fence|Outside/.test(n.spot || ''));
    for (let i = 0; i < outdoor.length; i++) {
      const a = outdoor[i];
      for (let j = i + 1; j < outdoor.length; j++) {
        const b = outdoor[j];
        const d = Math.hypot(a.p.x - b.p.x, a.p.z - b.p.z);
        if (d > S * 1.5 || Math.abs(a.p.y - b.p.y) > 2.5) continue;
        if (this._clear(a.p, b.p)) this._link(a, b);
      }
    }
    this.stats.nodes = this.nodes.length;
    this.stats.buildMs = Math.round(performance.now() - t0);
  }

  /** Closest node that can actually be seen from p (falls back to the closest node). */
  nearest(p) {
    const c = [];
    for (const n of this.nodes) {
      const d = n.p.distanceToSquared(p);
      if (c.length < 8 || d < c[c.length - 1][0]) { c.push([d, n]); c.sort((a, b) => a[0] - b[0]); if (c.length > 8) c.pop(); }
    }
    for (const [, n] of c) if (this._clear(p, n.p)) return n;
    return c.length ? c[0][1] : null;
  }

  /** A* from a to b; doors that are locked count as walls (officers kick, burglars break windows). */
  path(a, b) {
    if (!a || !b) return null;
    const open = new Map([[a.id, { n: a, g: 0, f: a.p.distanceTo(b.p), prev: null }]]);
    const closed = new Map();
    let guard = 0;
    while (open.size && guard++ < 4000) {
      let cur = null;
      for (const r of open.values()) if (!cur || r.f < cur.f) cur = r;
      open.delete(cur.n.id);
      closed.set(cur.n.id, cur);
      if (cur.n === b) {
        const out = [];
        for (let r = cur; r; r = r.prev) out.unshift(r.n);
        return out;
      }
      for (const e of cur.n.adj) {
        if (closed.has(e.n.id) || (e.door && e.door.locked)) continue;
        const g = cur.g + e.c;
        const o = open.get(e.n.id);
        if (!o || g < o.g) open.set(e.n.id, { n: e.n, g, f: g + e.n.p.distanceTo(b.p), prev: cur });
      }
    }
    return null;
  }
}
