import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const MODEL_FILES = [
  'car_muscle', 'car_pickup', 'car_coupe', 'car_hearse', 'car_sedan', 'parts', 'wheels',
  'robot_arm', 'press', 'crane', 'garage_door', 'sliding_door', 'barrier', 'cemetery_gate', 'forklift', 'lift', 'scanner',
  'plant', 'diner', 'gas_station', 'hardware', 'police_station', 'house_a', 'house_b', 'props',
  'character', 'skeleton',
];

/** Loads every Blender GLB once; hands out deep clones. */
export class Assets {
  constructor() {
    this.loader = new GLTFLoader();
    this.models = {};
    this.stats = {};
  }

  async loadAll(onProgress) {
    let done = 0;
    await Promise.all(MODEL_FILES.map(async (name) => {
      const gltf = await this.loader.loadAsync(`models/${name}.glb`);
      const scene = gltf.scene;
      scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.name.startsWith('COL_')) o.visible = false;
          const m = o.material;
          if (m && m.name === 'Glass') {
            m.transparent = true;
            m.opacity = 0.32;
            m.depthWrite = false;
            m.side = THREE.DoubleSide;
            m.roughness = 0.05;
            m.metalness = 0.2;
            o.castShadow = false;
          }
          if (m && m.emissive && m.emissiveIntensity !== undefined && m.emissive.getHex() !== 0) {
            o.castShadow = false;
          }
        }
      });
      this.models[name] = scene;
      const box = new THREE.Box3().setFromObject(scene);
      let nodes = 0, meshes = 0, hinges = [];
      scene.traverse((o) => {
        nodes++;
        if (o.isMesh) meshes++;
        if (o.userData && (o.userData.hinge || o.userData.joint)) hinges.push(o.name);
      });
      this.stats[name] = { nodes, meshes, hinges, box: { min: box.min.toArray().map((v) => +v.toFixed(2)), max: box.max.toArray().map((v) => +v.toFixed(2)) }, valid: !box.isEmpty() };
      done++;
      onProgress && onProgress(done / MODEL_FILES.length, name);
    }));
  }

  /** Deep clone of a whole model (materials shared). */
  clone(name) {
    return this.models[name].clone(true);
  }

  /** Clone a named child group (e.g. a prop or part) and reset its position to the origin. */
  part(file, nodeName) {
    const src = this.models[file].getObjectByName(nodeName);
    if (!src) throw new Error(`missing node ${file}/${nodeName}`);
    const c = src.clone(true);
    c.position.set(0, 0, 0);
    return c;
  }
}

export function findAll(root, pred) {
  const out = [];
  root.traverse((o) => pred(o) && out.push(o));
  return out;
}

/** Replace materials by name across a subtree (materials are cloned per call). */
export function remapMaterials(root, map) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = map[o.material.name];
    if (m) o.material = typeof m === 'function' ? m(o) : m;
  });
}
