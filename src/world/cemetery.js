import * as THREE from 'three';
import { LAYOUT } from '../config.js';
import { terrainHeight, addRoad } from './terrain.js';
import { bannerTexture } from './atmosphere.js';

const rnd = (a, b) => a + Math.random() * (b - a);

/** The Old Town Cemetery: wrought-iron gates, crypts, crooked stones, dead trees, lanterns, the Graveyard Shift course. */
export function buildCemetery(game, town) {
  const { scene, assets, physics } = game;
  const C = LAYOUT.cemetery, H = C.h;
  const out = { lanterns: [], ghosts: [] };
  // gravel drift loop through the stones
  const loop = [[0, 222], [0, 238], [22, 250], [40, 268], [42, 290], [26, 308], [0, 300], [-26, 308], [-42, 290], [-40, 268], [-22, 250], [0, 238]];
  out.loopLine = addRoad(scene, loop, 8, 'gravel', 1, 0.06);
  town.roads.push({ line: out.loopLine, width: 8, kind: 'gravel' });
  const spur = addRoad(scene, [[0, 300], [0, 306]], 7, 'gravel', 1, 0.06);
  town.roads.push({ line: spur, width: 7, kind: 'gravel' });
  const nearPath = (x, z, r) => out.loopLine.some((p) => Math.hypot(p.x - x, p.z - z) < r) || (Math.abs(x) < 6 && z < 240) || (Math.abs(x) < 7 && z > 296 && z < 318);

  // gate (hinged leaves with moving colliders)
  const gate = assets.clone('cemetery_gate');
  gate.position.set(0, H, LAYOUT.gateZ);
  scene.add(gate);
  gate.updateMatrixWorld(true);
  out.gateCols = physics.collidersFrom(gate, { kinematic: true });
  out.gate = { node: gate, L: gate.getObjectByName('Gate_L'), R: gate.getObjectByName('Gate_R'), t: 0, target: 0 };
  // perimeter fence (iron segments) + side stone walls
  const fence = (x, z, rot) => town.place(assets.part('props', 'Fence_Iron'), x, z, rot, { y: H });
  for (let x = -60; x <= 60; x += 4) fence(x, 332, 0);
  for (let z = 220; z <= 330; z += 4) { fence(-62, z, Math.PI / 2); fence(62, z, Math.PI / 2); }
  for (let x = 32; x <= 60; x += 4) { fence(x, LAYOUT.gateZ, 0); fence(-x, LAYOUT.gateZ, 0); }

  // crypts (Vlad's grand crypt is kept live for its hinged door)
  for (const [x, z, rot] of [[-48, 236, Math.PI / 2], [48, 240, -Math.PI / 2], [-50, 316, Math.PI / 2], [50, 318, -Math.PI / 2], [22, 326, Math.PI], [-22, 326, Math.PI]]) {
    town.place(assets.part('props', 'Crypt'), x, z, rot, { y: H });
  }
  const vlad = assets.part('props', 'Crypt');
  vlad.scale.setScalar(1.55);
  vlad.position.set(LAYOUT.vladCrypt[0], H, LAYOUT.vladCrypt[2]);
  vlad.rotation.y = Math.PI;
  scene.add(vlad);
  physics.collidersFrom(vlad);
  out.vlad = vlad;
  out.vladDoor = vlad.getObjectByName('CryptDoor');
  game.lights.add(new THREE.Vector3(0, H + 2.5, LAYOUT.vladCrypt[2] - 6), '#7dffb0', 14, true, 18);

  // tombstones: crooked rows, each with a small collider so the drift course has teeth
  const kinds = ['Tombstone_Round', 'Tombstone_Cross', 'Tombstone_Obelisk', 'Tombstone_Slab', 'Tombstone_Round'];
  const sizes = { Tombstone_Round: [0.55, 0.65, 0.2], Tombstone_Cross: [0.3, 0.8, 0.25], Tombstone_Obelisk: [0.42, 1.3, 0.42], Tombstone_Slab: [0.55, 0.45, 1.0] };
  let count = 0;
  for (let z = 226; z < 328; z += 5.2) {
    for (let x = -56; x <= 56; x += 4.6) {
      const jx = x + rnd(-1, 1), jz = z + rnd(-1, 1);
      if (nearPath(jx, jz, 6.2) || Math.random() < 0.18) continue;
      if (Math.abs(jx) > 44 && (Math.abs(jz - 238) < 6 || Math.abs(jz - 317) < 6)) continue;
      const k = kinds[Math.floor(Math.random() * kinds.length)];
      const t = assets.part('props', k);
      t.rotation.set(rnd(-0.12, 0.12), Math.PI + rnd(-0.25, 0.25), rnd(-0.15, 0.15));
      t.position.set(jx, H, jz);
      scene.add(t);
      t.updateMatrixWorld(true);
      game.batcher.add(t);
      scene.remove(t);
      const s = sizes[k];
      physics.addStaticBox(new THREE.Vector3(jx, H + s[1], jz), { x: s[0], y: s[1], z: s[2] }, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, t.rotation.y, 0)), { tag: 'tomb' });
      count++;
    }
  }
  out.tombstones = count;
  // dead trees + lanterns along the loop
  for (let i = 0; i < 26; i++) {
    const x = rnd(-58, 58), z = rnd(222, 330);
    if (nearPath(x, z, 7)) continue;
    const t = assets.part('props', 'Tree_Dead');
    t.scale.setScalar(rnd(1.1, 1.8));
    town.place(t, x, z, rnd(0, 6.28), { y: H });
  }
  for (let i = 0; i < out.loopLine.length; i += 9) {
    const p = out.loopLine[i];
    const a = out.loopLine[Math.min(out.loopLine.length - 1, i + 1)];
    const nx = -(a.z - p.z), nz = a.x - p.x, l = Math.hypot(nx, nz) || 1;
    town.place(assets.part('props', 'Lantern_Post'), p.x + (nx / l) * 5, p.z + (nz / l) * 5, 0, { y: H, lightColor: '#9dffb8', lightI: 9 });
  }
  // floating ghosts and sitting skeletons
  for (const [x, z] of [[-18, 262], [20, 280], [-8, 318], [34, 300], [-34, 300]]) {
    const g = assets.part('props', 'Ghost');
    g.position.set(x, H + 0.5, z);
    scene.add(g);
    out.ghosts.push(g);
  }
  for (const [x, z, r] of [[-12, 230, 0.4], [14, 258, -0.5], [-30, 284, 1.2]]) town.place(assets.part('props', 'Skeleton_Prop'), x, z, r, { y: H });
  for (let i = 0; i < 12; i++) {
    const x = rnd(-55, 55), z = rnd(224, 328);
    if (!nearPath(x, z, 5)) town.place(assets.part('props', i % 3 ? 'Pumpkin' : 'Pumpkin_Lantern'), x, z, rnd(0, 6), { y: H });
  }
  // Graveyard Shift start/finish arch
  const arch = assets.part('props', 'Banner');
  arch.scale.set(2.6, 1.0, 1);
  arch.position.set(0, H, 236);
  const cloth = arch.getObjectByName('Banner_Cloth');
  cloth.geometry = new THREE.BoxGeometry(3.8, 1.2, 0.03).translate(0, 4.6, 0);
  cloth.material = new THREE.MeshStandardMaterial({ map: bannerTexture('GRAVEYARD SHIFT', '#1d3b1d', '#c9ffcf'), side: THREE.DoubleSide, emissive: '#2a6a2a', emissiveIntensity: 0.4 });
  scene.add(arch);
  physics.collidersFrom(arch);
  out.trialStart = new THREE.Vector3(0, H, 236);
  out.checkpoints = [[22, 250], [41, 272], [37, 296], [14, 306], [-14, 306], [-37, 296], [-41, 272], [-22, 250], [0, 236]].map(([x, z]) => new THREE.Vector3(x, H, z));
  out.groundskeeperSpot = new THREE.Vector3(8, H, 228);
  return out;
}

export function updateCemetery(cem, dt, t, physics) {
  const g = cem.gate;
  g.t += THREE.MathUtils.clamp(g.target - g.t, -dt * 0.6, dt * 0.6);
  g.L.rotation.y = g.L.userData.open * g.t;
  g.R.rotation.y = g.R.userData.open * g.t;
  g.node.updateMatrixWorld(true);
  for (const b of cem.gateCols) if (b.userData.node.name.startsWith('COL_Gate_')) physics.syncCollider(b);
  cem.ghosts.forEach((gh, i) => {
    gh.position.y = (gh.userData.baseY ??= gh.position.y) + Math.sin(t * 1.3 + i) * 0.35;
    gh.rotation.y = t * 0.4 + i;
  });
}
