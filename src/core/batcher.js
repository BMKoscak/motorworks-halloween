import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Untextured, opaque, non-animated materials are folded into shared vertex-coloured materials,
// so a whole 64 m cell of houses, shops and furniture costs a handful of draw calls instead of one per material.
const VC = {
  matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05, name: 'BatchVC_Matte' }),
  metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.78, name: 'BatchVC_Metal' }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, name: 'BatchVC_Glow' }),
};
// materials that are animated or switched at runtime keep their own buckets
const KEEP = /^(Lamp_Interior|Lamp_Neon$|Lamp_Ceiling|FX_|Poster|PaneGlass|Window_Lit)/;

function vcKind(m) {
  if (!m || m.map || m.transparent || !m.isMeshStandardMaterial || KEEP.test(m.name || '') || m.vertexColors) return null;
  const emissive = m.emissive && m.emissiveIntensity > 0.4 && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.15;
  if (emissive) return 'glow';
  return m.metalness > 0.5 ? 'metal' : 'matte';
}

/**
 * Static batcher: bakes static scenery meshes into one merged mesh per (material, 64 m cell).
 * Thousands of Blender props become a few hundred draw calls while frustum culling still works per cell.
 */
export class StaticBatcher {
  constructor(scene, cell = 64) {
    this.scene = scene;
    this.cell = cell;
    this.buckets = new Map();
    this.count = 0;
    this._c = new THREE.Color();
  }

  add(root) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || !o.visible || o.name.startsWith('COL_')) return;
      let hidden = false;
      for (let p = o.parent; p && p !== root; p = p.parent) if (!p.visible) hidden = true;
      if (hidden) return;
      const m = o.material;
      const kind = vcKind(m);
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      const keep = kind ? ['position', 'normal'] : ['position', 'normal', 'uv'];
      for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
      if (!kind && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      const ng = g.index ? g.toNonIndexed() : g;
      if (ng !== g) g.dispose();
      if (kind) {
        const c = kind === 'glow' ? this._c.copy(m.emissive).multiplyScalar(Math.min(4, m.emissiveIntensity) * 0.6).lerp(m.color, 0.15) : m.color;
        const n = ng.attributes.position.count, arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
        ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        this._push(o, VC[kind], ng, kind === 'glow' ? false : o.castShadow);
      } else this._push(o, m, ng, o.castShadow);
      this.count++;
    });
  }

  _push(o, m, g, cast) {
    g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new THREE.Vector3());
    const key = `${m.uuid}|${cast ? 1 : 0}|${Math.floor(c.x / this.cell)}|${Math.floor(c.z / this.cell)}`;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { material: m, geos: [], cast }));
    b.geos.push(g);
  }

  build() {
    const meshes = [];
    for (const b of this.buckets.values()) {
      const merged = mergeGeometries(b.geos, false);
      b.geos.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, b.material);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = 'Batch_' + b.material.name;
      this.scene.add(mesh);
      meshes.push(mesh);
    }
    this.buckets.clear();
    this.meshes = meshes;
    return meshes;
  }
}
