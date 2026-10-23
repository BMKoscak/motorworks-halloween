import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
  }

  add(root) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || !o.visible || o.name.startsWith('COL_')) return;
      const m = o.material;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (g.index) {
        const ng = g.toNonIndexed();
        g.dispose();
        this._push(o, m, ng);
      } else this._push(o, m, g);
      this.count++;
    });
  }

  _push(o, m, g) {
    g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new THREE.Vector3());
    const key = `${m.uuid}|${Math.floor(c.x / this.cell)}|${Math.floor(c.z / this.cell)}`;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { material: m, geos: [], cast: o.castShadow }));
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
