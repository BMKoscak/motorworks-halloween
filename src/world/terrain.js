import * as THREE from 'three';
import { LAYOUT } from '../config.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const BOUNDS = { x0: -220, x1: 220, z0: -160, z1: 360 };

/** Single source of truth for ground height (physics heightfield + visual mesh + roads). */
export function terrainHeight(x, z) {
  let h = LAYOUT.cemetery.h * smooth((z - 148) / (214 - 148));
  const dx = Math.max(0, Math.abs(x) - 192);
  const dz = Math.max(0, -140 - z) + Math.max(0, z - 338);
  const e = dx + dz;
  if (e > 0) h += Math.pow(e, 1.25) * 0.9 + Math.sin(x * 0.07) * Math.cos(z * 0.05) * Math.min(e, 6);
  return h;
}

function noiseTex(size, base, vari, extra) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * vari;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  extra && extra(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildTerrain(scene, physics) {
  const { x0, x1, z0, z1 } = BOUNDS;
  const es = 4;
  physics.addHeightfield(terrainHeight, x0, x1, z0, z1, es);
  // cannon-es heightfield raycasts occasionally miss on certain cells, which drops wheel contact;
  // the town and the cemetery plateau are perfectly flat, so back them with exact static slabs.
  physics.addStaticBox(new THREE.Vector3(0, -0.5, -10), { x: 190, y: 0.5, z: 140 }, null, { tag: 'floor' });
  physics.addStaticBox(new THREE.Vector3(0, LAYOUT.cemetery.h - 0.5, 276), { x: 75, y: 0.5, z: 62 }, null, { tag: 'floor' });
  const nx = (x1 - x0) / es, nz = (z1 - z0) / es;
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz);
  geo.rotateX(-Math.PI / 2);
  geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
    const n = Math.sin(x * 0.13) * Math.cos(z * 0.11) * 0.5 + Math.sin(x * 0.031 + z * 0.047) * 0.5;
    if (z > 200) c.setRGB(0.16 + n * 0.03, 0.18 + n * 0.03, 0.14);
    else c.setRGB(0.33 + n * 0.06, 0.29 + n * 0.05, 0.14 + n * 0.02);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const grass = noiseTex(256, '#c8c0a8', 60);
  grass.repeat.set(110, 130);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: grass, roughness: 1, metalness: 0 }));
  mesh.receiveShadow = true;
  mesh.name = 'Terrain';
  scene.add(mesh);
  return mesh;
}

// ------------------------------------------------------------------------- roads
const asphaltTex = () => noiseTex(256, '#2b2a2e', 26, (g, s) => {
  g.fillStyle = '#d8a520';
  for (let y = 0; y < s; y += 64) g.fillRect(s / 2 - 3, y, 6, 36);
  g.fillStyle = 'rgba(230,230,220,0.85)';
  g.fillRect(6, 0, 4, s);
  g.fillRect(s - 10, 0, 4, s);
});
const gravelTex = () => noiseTex(128, '#5d554c', 50);

export function catmull(points, step = 2) {
  const pts = points.map((p) => new THREE.Vector3(p[0], 0, p[1]));
  if (pts.length < 3) {
    const out = [];
    const L = pts[0].distanceTo(pts[1]);
    for (let d = 0; d <= L; d += step) out.push(pts[0].clone().lerp(pts[1], d / L));
    out.push(pts[1].clone());
    return out;
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
  const n = Math.ceil(curve.getLength() / step);
  return curve.getSpacedPoints(n);
}

/** Ribbon road following terrain. Returns its centreline (for AI + minimap). */
export function addRoad(scene, points, width, kind = 'asphalt', priority = 1, lift = 0.05) {
  const line = catmull(points);
  const verts = [], uvs = [], idx = [];
  let dist = 0;
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const t = b.clone().sub(a).setY(0).normalize();
    const nrm = new THREE.Vector3(-t.z, 0, t.x);
    if (i > 0) dist += p.distanceTo(line[i - 1]);
    for (const s of [-1, 1]) {
      const q = p.clone().addScaledVector(nrm, (s * width) / 2);
      q.y = terrainHeight(q.x, q.z) + lift;
      verts.push(q.x, q.y, q.z);
      uvs.push(s < 0 ? 0 : 1, dist / (kind === 'asphalt' ? 8 : 4));
    }
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const map = kind === 'asphalt' ? (addRoad.tex ||= asphaltTex()) : (addRoad.gtex ||= gravelTex());
  const mat = new THREE.MeshStandardMaterial({ map, roughness: kind === 'asphalt' ? 0.85 : 1, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -priority, polygonOffsetUnits: -priority * 2 });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  m.name = 'Road';
  scene.add(m);
  return line;
}

/** Flat textured rectangle on the ground (parking lot, plaza). */
export function addPad(scene, x0, x1, z0, z1, color = '#2f2e33', priority = 3, lines = false) {
  const tex = noiseTex(256, color, 22, lines ? (g, s) => {
    g.fillStyle = 'rgba(235,235,225,0.8)';
    g.fillRect(0, 0, 5, s * 0.55);
    g.fillRect(0, s * 0.55, s, 4);
  } : null);
  tex.repeat.set((x1 - x0) / (lines ? 3 : 8), (z1 - z0) / (lines ? 11 : 8));
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -priority, polygonOffsetUnits: -priority * 2 }));
  m.position.set((x0 + x1) / 2, terrainHeight((x0 + x1) / 2, (z0 + z1) / 2) + 0.05, (z0 + z1) / 2);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

/** Raised sidewalk/curb strip with a physics box (car suspension bumps over it). */
export function addSidewalk(scene, physics, x0, x1, z0, z1, h = 0.16) {
  if (!addSidewalk.mat) {
    const t = noiseTex(128, '#8d8a85', 30, (g, s) => { g.fillStyle = 'rgba(40,40,40,0.5)'; g.fillRect(0, 0, s, 2); g.fillRect(0, 0, 2, s); });
    t.repeat.set(1, 1);
    addSidewalk.mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
  }
  const w = x1 - x0, d = z1 - z0;
  const geo = new THREE.BoxGeometry(w, h + 0.1, d);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 2, uv.getY(i) * d / 2);
  const m = new THREE.Mesh(geo, addSidewalk.mat);
  m.position.set((x0 + x1) / 2, h / 2 - 0.05, (z0 + z1) / 2);
  m.receiveShadow = true;
  scene.add(m);
  physics.addStaticBox(m.position, { x: w / 2, y: (h + 0.1) / 2, z: d / 2 }, null, { tag: 'curb' });
  return m;
}
