import * as THREE from 'three';
import { bakeInto, ownedMeshes } from '../core/bake.js';

const ACCESSORIES = ['Hat_Hard', 'Hat_Cap', 'Hat_Witch', 'Hat_Fedora', 'Mask_Pumpkin', 'Mask_Hockey', 'Mask_Welder',
  'Hold_Lantern', 'Hold_Clipboard', 'Hold_Torch', 'Hold_Flashlight'];

export const VARIANTS = {
  player: { shirt: '#9c1f1f', pants: '#22324f', shoes: '#141414', hair: '#2a1a10', skin: '#d8a283', acc: [] },
  worker: { shirt: '#e8701a', pants: '#253552', hair: '#3a2614', acc: ['Hat_Hard'] },
  foreman: { shirt: '#d9e1ea', pants: '#7a6a4f', hair: '#8a8a8a', acc: ['Hat_Hard', 'Hold_Clipboard'] },
  police: { shirt: '#1d2f6b', pants: '#121a33', hair: '#1a1a1a', acc: ['Hat_Cap', 'Hold_Flashlight.R'] },
  waitress: { shirt: '#ff7fb0', pants: '#f0f0f0', hair: '#b5651d', acc: [] },
  groundskeeper: { shirt: '#3b2d22', pants: '#4a4a4a', hair: '#cfcfcf', skin: '#c9a48a', acc: ['Hat_Fedora', 'Hold_Lantern'] },
  civilian: { shirt: '#3c6e47', pants: '#3a3a44', hair: '#4b2e16', acc: [] },
  skeleton: { acc: ['Hat_Hard', 'Hold_Torch.R'] },
};

const matCache = new Map();
function variantMat(base, color) {
  const key = base.uuid + color;
  if (!matCache.has(key)) {
    const m = base.clone();
    m.color.set(color);
    matCache.set(key, m);
  }
  return matCache.get(key);
}

/** Articulated Blender character (no skinning): animates joint nodes for walk/run/wave/operate/talk/sit. */
export class Character {
  constructor(assets, variant = 'civilian', opts = {}) {
    const v = typeof variant === 'string' ? { ...VARIANTS[variant] } : variant;
    if (opts.override) Object.assign(v, opts.override);
    this.isSkeleton = variant === 'skeleton';
    this.root = new THREE.Group();
    this.model = assets.clone(this.isSkeleton ? 'skeleton' : 'character');
    this.root.add(this.model);
    this.j = {};
    this.model.traverse((o) => (this.j[o.name] = o));
    this.rest = {};
    for (const k of Object.keys(this.j)) this.rest[k] = this.j[k].rotation.clone();
    if (!this.isSkeleton) {
      const colors = { C_Shirt: v.shirt, C_Pants: v.pants, C_Shoes: v.shoes || '#16120e', C_Hair: v.hair, C_Skin: v.skin || '#d8a283' };
      this.model.traverse((m) => {
        if (m.isMesh && colors[m.material.name]) m.material = variantMat(m.material, colors[m.material.name]);
      });
    }
    this.setAccessories(v.acc || []);
    if (opts.scale) this.root.scale.setScalar(opts.scale);
    this.t = Math.random() * 10;
    this.anim = 'idle';
    this.blend = {};
    this.talking = 0;
    this.speed = 0;
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  }

  /** Accessories live on both hands in the GLB ("Hold_Torch" = left, "Hold_Torch.001" = right); list right-hand ones as "Name.R". */
  setAccessories(list) {
    for (const [name, node] of Object.entries(this.j)) {
      const base = name.replace(/\.?\d{3}$/, ''); // GLTFLoader sanitises Blender's ".001" suffix to "001"
      if (!ACCESSORIES.includes(base)) continue;
      const right = name !== base;
      node.visible = right ? list.includes(base + '.R') : list.includes(base);
    }
    this.acc = list;
  }

  _rot(name, x = 0, y = 0, z = 0) {
    const n = this.j[name];
    if (!n) return;
    const r = this.rest[name];
    n.rotation.set(r.x + x, r.y + y, r.z + z);
  }

  /** Bake each rigid limb (plus its hats, masks, props) into one vertex-coloured mesh: ~12 draw calls per character. */
  optimize() {
    this.optimized = true;
    const joints = ['Hips', 'Torso', 'Head', 'Jaw', 'UpperArm_L', 'UpperArm_R', 'LowerArm_L', 'LowerArm_R', 'UpperLeg_L', 'UpperLeg_R', 'LowerLeg_L', 'LowerLeg_R']
      .map((n) => this.j[n]).filter(Boolean);
    const set = new Set(joints);
    for (const J of joints) bakeInto(J, ownedMeshes(J, J, (n) => set.has(n)), null, { stop: this.root });
  }

  /** anim: idle | walk | run | wave | operate | talk | sit | panic | reach | dance */
  update(dt, anim = this.anim, speed = 0) {
    if (!this.optimized) this.optimize();
    this.t += dt;
    this.anim = anim;
    const t = this.t;
    const j = this.j;
    let legA = 0, knee = 0, armA = 0, bob = 0, torsoX = 0, headY = 0;
    let armLz = 0, armRz = 0, foreL = 0, foreR = 0, armLx = null, armRx = null, foreRz = 0, headX = 0;
    let hipsX = 0, legLx = null, legRx = null, kneeL = null, kneeR = null;
    switch (anim) {
      case 'walk': case 'run': case 'panic': {
        const run = anim !== 'walk';
        const f = run ? 9.5 : 6.2;
        const s = Math.sin(t * f);
        legA = s * (run ? 0.75 : 0.5);
        knee = Math.max(0, -Math.cos(t * f)) * (run ? 1.1 : 0.6);
        armA = -s * (run ? 0.8 : 0.45);
        bob = Math.abs(Math.sin(t * f)) * (run ? 0.06 : 0.03);
        torsoX = run ? 0.18 : 0.04;
        foreL = foreR = run ? -1.0 : -0.3;
        if (anim === 'panic') { armLz = 2.4 + Math.sin(t * 14) * 0.4; armRz = -2.4 - Math.sin(t * 13) * 0.4; armA = 0; headY = Math.sin(t * 7) * 0.4; }
        break;
      }
      case 'wave':
        armRz = -2.5; foreRz = Math.sin(t * 8) * 0.5; headY = Math.sin(t * 0.7) * 0.15;
        armA = 0; legA = 0;
        break;
      case 'operate':
        armLx = -1.1 + Math.sin(t * 3) * 0.25; armRx = -1.2 + Math.cos(t * 3.4) * 0.3;
        foreL = -0.6 + Math.sin(t * 5) * 0.2; foreR = -0.5 + Math.cos(t * 4.6) * 0.25;
        torsoX = 0.12; headX = 0.25;
        break;
      case 'talk':
        armRx = -0.5 + Math.sin(t * 2.2) * 0.3; foreR = -0.9 + Math.sin(t * 3.1) * 0.3;
        armLx = -0.2 + Math.sin(t * 1.7) * 0.15; headY = Math.sin(t * 1.3) * 0.2;
        break;
      case 'reach':
        armLx = -1.45; foreL = -0.15; torsoX = 0.1;
        break;
      case 'sit':
        legLx = legRx = -1.45; kneeL = kneeR = 1.45; armLx = armRx = -0.9; foreL = foreR = -0.5; hipsX = 0;
        break;
      case 'dance':
        armLz = 2.6 + Math.sin(t * 6) * 0.3; armRz = -2.6 - Math.sin(t * 6) * 0.3; bob = Math.abs(Math.sin(t * 6)) * 0.08;
        legA = Math.sin(t * 6) * 0.3; headY = Math.sin(t * 3) * 0.3;
        break;
      default: {
        const br = Math.sin(t * 1.6);
        armA = br * 0.03; torsoX = br * 0.01; headY = Math.sin(t * 0.37) * 0.25;
        foreL = foreR = -0.12;
      }
    }
    this._rot('UpperLeg_L', legLx !== null ? legLx : -legA);
    this._rot('UpperLeg_R', legRx !== null ? legRx : legA);
    this._rot('LowerLeg_L', kneeL !== null ? kneeL : (legA < 0 ? knee : knee * 0.3));
    this._rot('LowerLeg_R', kneeR !== null ? kneeR : (legA > 0 ? knee : knee * 0.3));
    this._rot('UpperArm_L', armLx !== null ? armLx : armA, 0, armLz + 0.06);
    this._rot('UpperArm_R', armRx !== null ? armRx : -armA, 0, armRz - 0.06);
    this._rot('LowerArm_L', foreL);
    this._rot('LowerArm_R', foreR, 0, foreRz);
    this._rot('Torso', torsoX);
    this._rot('Hips', hipsX);
    this._rot('Head', headX, headY);
    if (j.Jaw) this._rot('Jaw', this.talking > 0 ? Math.abs(Math.sin(t * 17)) * (this.isSkeleton ? 0.45 : 0.18) : 0);
    this.talking = Math.max(0, this.talking - dt);
    this.model.position.y = bob;
  }

  /** world-space position of the head (speech bubbles) */
  headPos(out = new THREE.Vector3()) {
    return (this.j.Head || this.root).getWorldPosition(out).add(new THREE.Vector3(0, 0.45, 0));
  }
}
