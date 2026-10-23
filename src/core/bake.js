import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Shared vertex-coloured materials: one draw call per rigid part instead of one per Blender material.
export const BAKED = {
  opaque: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25, name: 'BakedOpaque' }),
  emissive: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.4, 2.4, 2.4), name: 'BakedEmissive' }),
};

const _c = new THREE.Color();

export function isEmissive(m) {
  return !!(m.emissive && m.emissiveIntensity > 0.4 && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.15);
}

function visibleChain(o, stop) {
  for (let n = o; n && n !== stop; n = n.parent) if (!n.visible) return false;
  return true;
}

/**
 * Bake every visible mesh in `meshes` into `space` (an Object3D whose local frame receives the geometry).
 * Originals are demoted to plain transform nodes (isMesh=false) so children (hinges, anchors) keep working.
 * Returns the created meshes.
 */
export function bakeInto(space, meshes, colorOf, opts = {}) {
  space.updateMatrixWorld(true);
  const inv = space.matrixWorld.clone().invert();
  const groups = { opaque: [], emissive: [], transparent: new Map() };
  for (const o of meshes) {
    if (!o.isMesh || !visibleChain(o, opts.stop)) continue;
    const m = o.material;
    const g = o.geometry.clone().applyMatrix4(inv.clone().multiply(o.matrixWorld));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
    const ng = g.index ? g.toNonIndexed() : g;
    if (m.transparent) {
      if (!groups.transparent.has(m)) groups.transparent.set(m, []);
      groups.transparent.get(m).push(ng);
    } else {
      const emit = isEmissive(m);
      const col = emit ? _c.copy(m.emissive).lerp(m.color || m.emissive, 0.3) : colorOf ? colorOf(o, m) : (m.color || _c.set('#888'));
      const n = ng.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
      ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      (emit ? groups.emissive : groups.opaque).push(ng);
    }
    o.isMesh = false;
    o.type = 'Object3D';
  }
  const out = [];
  const add = (geos, mat, shadow) => {
    if (!geos.length) return;
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = shadow;
    mesh.receiveShadow = !!opts.receive;
    mesh.name = 'Baked_' + (mat.name || 'mat');
    space.add(mesh);
    out.push(mesh);
  };
  add(groups.opaque, opts.opaqueMat || BAKED.opaque, opts.shadow !== false);
  add(groups.emissive, opts.emissiveMat || BAKED.emissive, false);
  for (const [m, geos] of groups.transparent) add(geos, m, false);
  return out;
}

/** Collect meshes under `root` whose nearest "owner" (per isOwner) is `owner`. */
export function ownedMeshes(root, owner, isOwner) {
  const out = [];
  const walk = (n) => {
    if (n !== owner && isOwner(n)) return;
    if (n.isMesh) out.push(n);
    n.children.forEach(walk);
  };
  walk(owner);
  return out;
}
