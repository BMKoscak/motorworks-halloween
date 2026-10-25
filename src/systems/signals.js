import { STREETS } from '../world/streetGeom.js';

/**
 * Traffic-signal controller for the signalised junctions in streets.json.
 * Two phases per junction (A = through street, B = side street) with yellow and all-red clearance; pedestrians may
 * cross a road while its traffic is held on red and the other phase is green. Drives the emissive lamps pulled out of
 * roads.glb (SigLamp_* / PedLamp_*) and the drag-strip christmas tree (DragLamp_*), which the drag race sets directly.
 */
export class Signals {
  constructor(game, lamps) {
    this.game = game;
    this.t = 0;
    this.T = STREETS.signalTiming;
    this.cycle = this.T.greenA + this.T.yellow + this.T.allRed + this.T.greenB + this.T.yellow + this.T.allRed;
    this.heads = [];
    this.peds = [];
    this.drag = {};
    this.stats = { redStops: 0, redRuns: 0 };
    for (const o of lamps) {
      const m = /^SigLamp_.*_([RYG])$/.exec(o.name);
      const p = /^PedLamp_.*_([WD])$/.exec(o.name);
      const d = /^DragLamp_(.*)$/.exec(o.name);
      if (m) this.heads.push({ mesh: o, color: m[1], node: o.userData.node, group: o.userData.group });
      else if (p) this.peds.push({ mesh: o, kind: p[1], node: o.userData.node, group: o.userData.group });
      else if (d) this.drag[d[1]] = o;
    }
    this._acc = 1;
  }

  /** 'green' | 'yellow' | 'red' for a phase group ('A'/'B') at a signalised node. */
  state(node, group, ago = 0) {
    const sig = STREETS.signals[node];
    if (!sig) return 'green';
    const T = this.T;
    const t = (((this.t - ago + (sig.offset || 0)) % this.cycle) + this.cycle) % this.cycle;
    const aEnd = T.greenA, aY = aEnd + T.yellow, bStart = aY + T.allRed, bEnd = bStart + T.greenB, bY = bEnd + T.yellow;
    if (group === 'A') return t < aEnd ? 'green' : t < aY ? 'yellow' : 'red';
    return t >= bStart && t < bEnd ? 'green' : t >= bEnd && t < bY ? 'yellow' : 'red';
  }

  /** Seconds until this group's light changes (traffic uses it to decide whether a yellow can still be cleared). */
  remaining(node, group) {
    const sig = STREETS.signals[node];
    if (!sig) return Infinity;
    const T = this.T;
    const t = (this.t + (sig.offset || 0)) % this.cycle;
    const marks = [T.greenA, T.greenA + T.yellow, T.greenA + T.yellow + T.allRed, T.greenA + T.yellow + T.allRed + T.greenB,
      T.greenA + 2 * T.yellow + T.allRed + T.greenB, this.cycle];
    for (const m of marks) if (t < m) return m - t;
    return 0;
  }

  /** Walk signal for a crosswalk that crosses a road of `group` at `node`: on while that road's traffic is held. */
  walk(node, group) {
    const other = group === 'A' ? 'B' : 'A';
    return this.state(node, group) === 'red' && this.state(node, other) === 'green' && this.remaining(node, other) > 3;
  }

  /** The light a vehicle arriving along `road` at `node` sees (null if the approach is not signalised). */
  forApproach(node, road, ago = 0) {
    const sig = STREETS.signals[node];
    if (!sig) return null;
    return this.state(node, sig.A.includes(road) ? 'A' : 'B', ago);
  }

  setDrag(name, on) {
    const o = this.drag[name];
    if (o) o.material.emissiveIntensity = on ? 5 : 0.06;
  }

  update(dt) {
    this.t += dt;
    if ((this._acc += dt) < 0.1) return;
    this._acc = 0;
    // lamps are individual meshes: only draw them near the camera
    const cam = this.game.camera.position;
    if ((this._cull = (this._cull || 0) + 1) % 5 === 0) for (const l of [...this.heads, ...this.peds]) l.mesh.visible = l.mesh.position.distanceTo(cam) < 140 || !this._cullReady;
    this._cullReady = true;
    for (const h of this.heads) {
      const s = this.state(h.node, h.group);
      const on = (s === 'red' && h.color === 'R') || (s === 'yellow' && h.color === 'Y') || (s === 'green' && h.color === 'G');
      h.mesh.material.emissiveIntensity = on ? 6 : 0.05;
    }
    for (const p of this.peds) {
      const w = this.walk(p.node, p.group);
      // last seconds before the cross traffic gets its green: flashing hand
      const flash = !w && this.state(p.node, p.group) === 'red' && Math.floor(this.t * 2) % 2 === 0;
      p.mesh.material.emissiveIntensity = p.kind === 'W' ? (w ? 4 : 0.05) : (w ? 0.05 : flash ? 0.6 : 3.5);
    }
  }
}
