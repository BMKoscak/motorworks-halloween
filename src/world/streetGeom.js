import * as THREE from 'three';
import STREETS from '../data/streets.json';

/**
 * Junction geometry derived from streets.json, mirrored 1:1 in blender/build_roads.py so the painted stop bars and
 * crosswalks in roads.glb sit exactly where the AI stops and where pedestrians cross.
 *   padRadius(node)        rounded asphalt pad at junctions/corners (0 = straight-through or dead end)
 *   approach(node, road)   { stopDist, crosswalk: [near, far] | null, control: 'signal' | 'stop' | null, group }
 * Distances are measured from the node centre back along the arriving road.
 */
export { STREETS };

const roadById = Object.fromEntries(STREETS.roads.map((r) => [r.id, r]));
const drawn = STREETS.roads.filter((r) => (r.surface || 'asphalt') !== 'lot');

/** Centreline control points [THREE.Vector3] (x, 0, z) for a road. */
export function roadPoints(r) {
  const N = STREETS.nodes;
  return [N[r.a], ...(r.via || []), N[r.b]].map(([x, z]) => new THREE.Vector3(x, 0, z));
}

/** Dense centreline (same Catmull-Rom as the AI lanes and the Blender asphalt). */
export function roadLine(r, step = 2) {
  const pts = roadPoints(r);
  if (pts.length < 3) {
    const out = [], L = pts[0].distanceTo(pts[1]), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k <= n; k++) out.push(pts[0].clone().lerp(pts[1], k / n));
    return out;
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
  return curve.getSpacedPoints(Math.ceil(curve.getLength() / step));
}

/** Roads meeting at a node with their unit direction leaving the node. */
export function nodeRoads(nid, drawnOnly = true) {
  const out = [];
  for (const r of drawnOnly ? drawn : STREETS.roads) {
    if (r.a !== nid && r.b !== nid) continue;
    const pts = roadPoints(r);
    const [p0, p1] = r.a === nid ? [pts[0], pts[1]] : [pts.at(-1), pts.at(-2)];
    out.push({ road: r, dir: p1.clone().sub(p0).normalize() });
  }
  return out;
}

const _pad = {};
export function padRadius(nid) {
  if (nid in _pad) return _pad[nid];
  const rs = nodeRoads(nid);
  let R = 0;
  if (rs.length >= 2 && !(rs.length === 2 && rs[0].dir.dot(rs[1].dir) < -0.95)) R = Math.max(...rs.map((x) => x.road.width / 2)) + 1.5;
  return (_pad[nid] = R);
}

export function approach(nid, roadId) {
  const R = padRadius(nid);
  const sig = STREETS.signals[nid];
  if (sig) {
    const near = R + 0.4;
    return { stopDist: near + 3.9, crosswalk: [near, near + 3.0], control: 'signal', group: sig.A.includes(roadId) ? 'A' : 'B' };
  }
  if ((STREETS.stops[nid] || []).includes(roadId)) {
    if (R) return { stopDist: R + 0.7, crosswalk: null, control: 'stop' };
    const others = nodeRoads(nid).filter((x) => x.road.id !== roadId).map((x) => x.road.width / 2);
    return { stopDist: others.length ? Math.max(...others) + 1.2 : 5, crosswalk: null, control: 'stop' };
  }
  return { stopDist: null, crosswalk: null, control: null };
}

/**
 * Every pedestrian crossing as a segment between its two kerbs: junction crosswalks (signalised, with a walk phase)
 * and the painted mid-block ones (cars yield). { a, b, node?, road, group?, signal }
 */
export function crossings() {
  const out = [];
  for (const nid of Object.keys(STREETS.signals)) {
    const node = new THREE.Vector3(STREETS.nodes[nid][0], 0, STREETS.nodes[nid][1]);
    for (const { road, dir } of nodeRoads(nid)) {
      const ap = approach(nid, road.id);
      const mid = node.clone().addScaledVector(dir, (ap.crosswalk[0] + ap.crosswalk[1]) / 2);
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(road.width / 2 + 0.9);
      out.push({ a: mid.clone().add(side), b: mid.clone().sub(side), node: nid, road: road.id, group: ap.group, signal: true });
    }
  }
  for (const c of STREETS.crosswalks) {
    const r = roadById[c.road];
    const side = c.axis === 'x' ? new THREE.Vector3(0, 0, r.width / 2 + 0.9) : new THREE.Vector3(r.width / 2 + 0.9, 0, 0);
    const mid = new THREE.Vector3(c.x, 0, c.z);
    out.push({ a: mid.clone().add(side), b: mid.clone().sub(side), road: c.road, id: c.id, signal: false });
  }
  return out;
}
