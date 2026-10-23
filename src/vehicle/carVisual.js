import * as THREE from 'three';
import { bakeInto, ownedMeshes } from '../core/bake.js';
import { drawLivery, tireLetteringTexture } from './livery.js';
import { UNDERGLOW, ENGINES } from '../config.js';

const EMPTY = new THREE.BufferGeometry();
const HINGE_NAMES = ['Door_L', 'Door_R', 'DoorRear_L', 'DoorRear_R', 'Hood', 'Trunk'];
const WHEELS = ['FL', 'FR', 'RL', 'RR'];

const shared = {
  glassMat: null,
  ringGeo: new THREE.RingGeometry(0.255, 0.345, 48, 1),
  letteringTex: {},
};

function finishParams(finish) {
  switch (finish) {
    case 'matte': return { metalness: 0.05, roughness: 0.82, clearcoat: 0, clearcoatRoughness: 1, iridescence: 0, sheen: 0, rust: 0 };
    case 'metallic': return { metalness: 0.85, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.15, iridescence: 0, sheen: 0, rust: 0 };
    case 'pearl': return { metalness: 0.55, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 1, sheen: 1, rust: 0 };
    case 'rust': return { metalness: 0.3, roughness: 0.7, clearcoat: 0, clearcoatRoughness: 1, iridescence: 0, sheen: 0, rust: 1 };
    default: return { metalness: 0.12, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.06, iridescence: 0, sheen: 0, rust: 0 };
  }
}

/** Paint shader: physical car paint + projected livery + procedural rust + assembly-line raw-steel reveal. */
class PaintSystem {
  constructor(info) {
    this.side = document.createElement('canvas');
    this.side.width = 1024; this.side.height = 256;
    this.top = document.createElement('canvas');
    this.top.width = 1024; this.top.height = 512;
    this.sideTex = new THREE.CanvasTexture(this.side);
    this.topTex = new THREE.CanvasTexture(this.top);
    for (const t of [this.sideTex, this.topTex]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; }
    this.info = info;
    this.u = {
      uSide: { value: this.sideTex }, uTop: { value: this.topTex },
      uBox: { value: new THREE.Vector4(info.minZ, info.maxZ, info.halfW, info.maxY) },
      uRust: { value: 0 }, uReveal: { value: 1 }, uRaw: { value: new THREE.Color('#8b8f96') },
      uGlow: { value: 0 }, uLivery: { value: 0 },
    };
    this.mats = [];
  }

  make(rest) {
    const m = new THREE.MeshPhysicalMaterial({ color: '#ff6a00', name: 'PaintLive' });
    const u = this.u;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u, { uRest: { value: rest } });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 uRest; varying vec3 vCarPos; varying vec3 vCarNrm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCarPos = (uRest * vec4(transformed,1.0)).xyz; vCarNrm = normalize(mat3(uRest) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D uSide; uniform sampler2D uTop; uniform vec4 uBox; uniform float uRust; uniform float uReveal; uniform vec3 uRaw; uniform float uGlow; uniform float uLivery;
varying vec3 vCarPos; varying vec3 vCarNrm;
float mwh3(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float mwn3(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(mwh3(i),mwh3(i+vec3(1,0,0)),f.x),mix(mwh3(i+vec3(0,1,0)),mwh3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(mwh3(i+vec3(0,0,1)),mwh3(i+vec3(1,0,1)),f.x),mix(mwh3(i+vec3(0,1,1)),mwh3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float mwfbm(vec3 p){ return 0.5*mwn3(p)+0.25*mwn3(p*2.03)+0.125*mwn3(p*4.1)+0.0625*mwn3(p*8.3); }
vec4 mwLivery(){ vec3 n = normalize(vCarNrm); float sw = smoothstep(0.35,0.65,abs(n.x)); float tw = smoothstep(0.3,0.6,n.y)*(1.0-sw);
  float u = (vCarPos.z - uBox.x)/(uBox.y-uBox.x);
  vec4 s = texture2D(uSide, vec2(u, vCarPos.y/uBox.w)); vec4 t = texture2D(uTop, vec2(u, (vCarPos.x+uBox.z)/(2.0*uBox.z)));
  return s*sw + t*tw; }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
vec4 mwL = uLivery > 0.5 ? mwLivery() : vec4(0.0);
diffuseColor.rgb = mix(diffuseColor.rgb, mwL.rgb, mwL.a);
float mwRm = 0.0;
if (uRust > 0.5) { mwRm = smoothstep(0.42, 0.64, mwfbm(vCarPos*1.7+3.0) + (0.6 - vCarPos.y/uBox.w)*0.35);
  vec3 rc = mix(vec3(0.30,0.10,0.035), vec3(0.62,0.29,0.09), mwfbm(vCarPos*7.0));
  diffuseColor.rgb = mix(diffuseColor.rgb*0.72, rc, mwRm*0.92); }
diffuseColor.rgb = mix(uRaw, diffuseColor.rgb, uReveal);`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.97, mwRm);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += mwL.rgb * mwL.a * uGlow * uReveal;');
    };
    m.customProgramCacheKey = () => 'mw-paint';
    this.mats.push(m);
    return m;
  }

  apply(cfg) {
    const f = finishParams(cfg.finish);
    for (const m of this.mats) {
      m.color.set(cfg.color);
      m.metalness = f.metalness; m.roughness = f.roughness;
      m.clearcoat = f.clearcoat; m.clearcoatRoughness = f.clearcoatRoughness;
      m.iridescence = f.iridescence; m.iridescenceIOR = 1.45; m.iridescenceThicknessRange = [180, 520];
      m.sheen = f.sheen; m.sheenColor = new THREE.Color('#6a3cff'); m.sheenRoughness = 0.4;
      if (cfg.finish === 'pearl') m.color.lerp(new THREE.Color('#05030b'), 0.45);
    }
    this.u.uRust.value = f.rust;
    drawLivery(this.side, this.top, cfg.livery, this.info, cfg.color2);
    this.u.uLivery.value = cfg.livery && cfg.livery !== 'none' ? 1 : 0;
    this.u.uGlow.value = cfg.livery === 'monster' ? 1.6 : 0;
    this.sideTex.needsUpdate = this.topTex.needsUpdate = true;
  }
}

/**
 * A fully assembled car: Blender GLB body with hinged doors/hood/trunk, steerable knuckles,
 * spinning axles, steering wheel, bolt-on parts, paint/livery, lights and underglow.
 */
export class CarVisual {
  constructor(assets, cfg, opts = {}) {
    this.assets = assets;
    this.opts = opts;
    this.cfg = { ...cfg };
    this.root = new THREE.Group();
    this.root.name = 'CarVisual';
    this.model = assets.clone('car_' + cfg.body);
    this.root.add(this.model);
    const ud = (this.model.getObjectByName('Car_' + cfg.body) || this.model).userData;
    this.spec = { W: ud.W, r: ud.wheel_radius, wx: ud.wheel_x, af: ud.axle_f, ar: ud.axle_r, yb: ud.yb };
    this.n = {};
    this.model.traverse((o) => (this.n[o.name] = o));
    this.model.updateMatrixWorld(true);
    this._measure();
    this.paint = new PaintSystem(this.info);
    this.hinges = {};
    for (const h of HINGE_NAMES) {
      const node = this.n[h];
      if (node) this.hinges[h] = { node, axis: node.userData.hinge || 'y', open: node.userData.open || 1, t: 0, target: 0, base: node.rotation[node.userData.hinge || 'y'] };
    }
    this._materials();
    this.wheelNodes = WHEELS.map((w) => ({ name: w, knuckle: this.n['Knuckle_' + w], axle: this.n['Axle_' + w], rest: this.n['Knuckle_' + w].position.clone() }));
    this.partNodes = {};
    this.steer = 0;
    this.blowerSpin = 0;
    this.flash = 0;
    this.lights = { head: true, brake: 0 };
    this.applyConfig(cfg, true);
    if (opts.lite) this._mergeStatic();
    if (opts.ghost) this._ghostify();
    this.setFirstPerson(false);
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = !o.material.transparent; } });
  }

  _measure() {
    const body = this.n.Body;
    const bb = new THREE.Box3().setFromObject(body);
    const roof = this.n.Roof ? new THREE.Box3().setFromObject(this.n.Roof) : bb;
    const door = this.n.Door_L ? new THREE.Box3().setFromObject(this.n.Door_L) : bb;
    this.info = {
      minZ: bb.min.z, maxZ: bb.max.z, halfW: this.spec.W / 2, maxY: Math.max(bb.max.y, roof.max.y) + 0.02, yb: this.spec.yb,
      belt: door.max.y, doorZ: (door.min.z + door.max.z) / 2, cowlZ: this.n.Hood ? this.n.Hood.position.z : 0.8,
      roofZ0: roof.min.z, roofZ1: roof.max.z, length: bb.max.z - bb.min.z,
    };
  }

  _materials() {
    const o = this.opts;
    this.headMat = new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: '#ffe2a8', emissiveIntensity: 2.2, roughness: 0.2 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: '#7a0505', emissive: '#ff1a0a', emissiveIntensity: 1.2, roughness: 0.3 });
    this.paint2 = new THREE.MeshPhysicalMaterial({ color: '#111', roughness: 0.3, metalness: 0.3, clearcoat: 0.8 });
    this.model.traverse((m) => {
      if (!m.isMesh) return;
      const name = m.material.name;
      if (name === 'Paint') m.material = this.paint.make(m.matrixWorld.clone());
      else if (name === 'Paint2') m.material = this.paint2;
      else if (name === 'Lamp_Head') m.material = this.headMat;
      else if (name === 'Lamp_Tail') m.material = this.tailMat;
    });
    this.fpNodes = ['FP_Hand_L', 'FP_Hand_R', 'FP_Arm_L', 'FP_Arm_R'].map((n) => this.n[n]).filter(Boolean);
  }

  setFirstPerson(on) {
    this.fpNodes.forEach((n) => (n.visible = on));
  }

  // ------------------------------------------------------------------ configuration
  applyConfig(cfg, initial = false) {
    const prev = this.cfg;
    this.cfg = { ...cfg };
    this.paint.apply(cfg);
    const f = finishParams(cfg.finish);
    this.paint2.color.set(cfg.color2);
    this.paint2.metalness = Math.min(0.6, f.metalness);
    this.paint2.roughness = f.roughness;
    if (initial || prev.rim !== cfg.rim || prev.lettering !== cfg.lettering || prev.caliper !== cfg.caliper) this._wheels();
    this._parts();
    this._underglow();
    this._stance();
  }

  _wheels() {
    const scale = this.spec.r / 0.36;
    if (!this.caliperMat) this.caliperMat = new THREE.MeshStandardMaterial({ color: '#c81d11', roughness: 0.4, metalness: 0.3 });
    this.caliperMat.color.set(this.cfg.caliper || '#c81d11');
    let letterMat = null;
    if (this.cfg.lettering && this.cfg.lettering !== 'none') {
      let tex = shared.letteringTex[this.cfg.lettering];
      if (!tex) {
        tex = new THREE.CanvasTexture(tireLetteringTexture(this.cfg.lettering));
        tex.colorSpace = THREE.SRGBColorSpace;
        shared.letteringTex[this.cfg.lettering] = tex;
      }
      letterMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
    }
    this.rims = [];
    for (const w of this.wheelNodes) {
      if (w.rim) w.axle.remove(w.rim);
      if (w.caliper) w.knuckle.remove(w.caliper);
      const right = w.name[1] === 'R';
      const rim = this.assets.part('wheels', 'Rim_' + this.cfg.rim);
      rim.scale.setScalar(scale);
      if (right) rim.rotation.y = Math.PI;
      if (letterMat) {
        const ring = new THREE.Mesh(shared.ringGeo, letterMat);
        ring.rotation.y = Math.PI / 2;
        ring.position.x = 0.1325;
        rim.add(ring);
      }
      const rotor = this.assets.part('wheels', 'Brake_Rotor');
      rotor.position.x = -0.03;
      rim.add(rotor);
      w.axle.add(rim);
      w.rim = rim;
      const cal = this.assets.part('wheels', 'Brake_Caliper');
      cal.traverse((m) => m.isMesh && (m.material = this.caliperMat));
      cal.scale.setScalar(scale);
      cal.position.x = right ? 0.01 : -0.01;
      if (right) cal.rotation.y = Math.PI;
      w.knuckle.add(cal);
      w.caliper = cal;
      this.rims.push(rim);
      if (this.cfg.rim === 'Pumpkin') rim.traverse((m) => m.isMesh && m.material.name === 'Lamp_Pumpkin' && (m.material = m.material.clone(), m.material.emissiveIntensity = 3));
    }
  }

  _attach(slot, anchorName, partId, opts = {}) {
    const old = this.partNodes[slot];
    if (old) { old.parent && old.parent.remove(old); delete this.partNodes[slot]; }
    if (!partId || partId === 'none') return null;
    let file = 'parts', id = partId;
    if (partId === 'Hood_Franken') id = 'Hood_Blower';
    if (partId === 'Exhaust_Lightning') id = 'Exhaust_Flame';
    const anchor = this.n[anchorName];
    if (!anchor) return null;
    const p = this.assets.part(file, id);
    p.name = 'Part_' + partId;
    if (opts.scaleX) p.scale.x = opts.scaleX;
    if (partId === 'Hood_Franken') {
      const glow = new THREE.MeshStandardMaterial({ color: '#2d6b2d', emissive: '#39ff14', emissiveIntensity: 1.6, metalness: 0.6, roughness: 0.3 });
      p.traverse((m) => m.isMesh && /Case|Ribs|Hat/.test(m.name) && (m.material = glow));
    }
    if (id === 'Exhaust_Flame') {
      p.traverse((m) => {
        if (m.isMesh && m.userData.fx === 'flame') {
          m.material = new THREE.MeshBasicMaterial({ color: partId === 'Exhaust_Lightning' ? '#7dff4a' : '#ff8a1a', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
          m.visible = false;
          (this.flames ||= []).push(m);
        }
      });
    }
    anchor.add(p);
    this.partNodes[slot] = p;
    return p;
  }

  _parts() {
    const c = this.cfg, wf = this.spec.W / 1.9;
    this.flames = [];
    this._attach('hood', 'Anchor_Hood', c.hood);
    this.blower = this.partNodes.hood && this.partNodes.hood.getObjectByName('Blower_Pulley');
    this._attach('roof', 'Anchor_Roof', this.opts.police ? 'Roof_PoliceBar' : c.roof);
    this._attach('spoiler', 'Anchor_Rear', c.spoiler, { scaleX: wf });
    this._attach('front', 'Anchor_Front', this.opts.police ? 'Front_PushBumper' : c.front, { scaleX: wf });
    const ex = this._attach('exhaust', 'Anchor_Exhaust', c.exhaust || 'Exhaust_Stock', { scaleX: c.exhaust === 'Exhaust_Side' ? (this.spec.W / 2 + 0.04) / 1.02 : wf });
    this.lightningExhaust = c.exhaust === 'Exhaust_Lightning';
    const eng = ENGINES.find((e) => e.id === c.engine) || ENGINES[0];
    const e = this._attach('engine', 'EngineBay', eng.part);
    if (e) { e.scale.setScalar(0.8); e.position.y = 0.32; e.visible = false; }
    this.engineNode = e;
    // police lightbar materials flash independently per car
    const pb = this.partNodes.roof;
    this.policeLamps = [];
    if (pb && this.opts.police) {
      pb.traverse((m) => {
        if (m.isMesh && /PoliceBar_(Red|Blue)/.test(m.name)) {
          m.material = m.material.clone();
          this.policeLamps.push(m);
        }
      });
    }
  }

  _underglow() {
    if (this.glow) { this.model.remove(this.glow); this.glow = null; }
    if (this.glowLight) { this.model.remove(this.glowLight); this.glowLight = null; }
    const u = UNDERGLOW.find((x) => x.id === this.cfg.underglow);
    if (!u || !u.color) return;
    const geo = new THREE.PlaneGeometry(this.spec.W + 0.6, this.info.length + 0.4);
    geo.rotateX(-Math.PI / 2);
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    this.glow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: u.color, map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 }));
    this.glow.position.set(0, 0.04, (this.info.minZ + this.info.maxZ) / 2);
    this.glow.renderOrder = 2;
    this.model.add(this.glow);
    if (this.opts.withLights) {
      this.glowLight = new THREE.PointLight(u.color, 2.2, 5, 1.8);
      this.glowLight.position.set(0, 0.25, 0);
      this.model.add(this.glowLight);
    }
  }

  _stance() {
    // ride height moves the body relative to the wheels; camber tilts the knuckles
    const ride = this.cfg.ride || 0;
    this.rideOffset = ride < 0 ? ride * 0.12 : ride * 0.2;
    const camber = THREE.MathUtils.degToRad(-(this.cfg.camber || 0));
    for (const w of this.wheelNodes) {
      const left = w.name[1] === 'L';
      w.knuckle.rotation.z = camber * (left ? 1 : -1) * -1;
    }
    if (!this.opts.physics) this.setStaticPose();
  }

  /** Pose for kiosk / assembly line / parked: wheels at rest, body lifted by ride height. */
  setStaticPose() {
    this.model.position.y = this.rideOffset || 0;
    for (const w of this.wheelNodes) w.knuckle.position.y = w.rest.y - (this.rideOffset || 0);
  }

  // --------------------------------------------------------------------- animation
  setHinge(name, t) {
    const h = this.hinges[name];
    if (h) h.target = t;
  }

  setAllHinges(t) {
    for (const k in this.hinges) this.hinges[k].target = t;
  }

  /** Physics-driven wheel pose: suspension offset (m, + = up), steering angle, spin angle. */
  setWheel(i, susp, steer, spin) {
    const w = this.wheelNodes[i];
    w.knuckle.position.y = w.rest.y + susp;
    w.knuckle.rotation.y = steer;
    w.axle.rotation.x = spin;
  }

  update(dt, state = {}) {
    for (const k in this.hinges) {
      const h = this.hinges[k];
      const sp = k === 'Hood' || k === 'Trunk' ? 1.6 : 2.6;
      h.t += THREE.MathUtils.clamp(h.target - h.t, -dt * sp, dt * sp);
      h.node.rotation[h.axis] = h.base + h.open * h.t;
    }
    if (this.n.SteeringWheel) this.n.SteeringWheel.rotation.z = -(state.steer || 0) * 5.5;
    if (this.engineNode) this.engineNode.visible = (this.hinges.Hood && this.hinges.Hood.t > 0.3) || !!state.showEngine;
    if (this.blower) {
      this.blowerSpin += dt * (8 + (state.rpm || 800) / 60);
      this.blower.rotation.z = this.blowerSpin;
    }
    // lights
    const head = state.headlights !== undefined ? state.headlights : this.lights.head;
    this.headMat.emissiveIntensity = head ? 2.4 : 0.05;
    this.tailMat.emissiveIntensity = state.brake ? 4 : head ? 1.2 : 0.2;
    if (state.hazard) {
      const on = Math.floor(performance.now() / 400) % 2 === 0;
      this.tailMat.emissiveIntensity = on ? 5 : 0.1;
      this.headMat.emissiveIntensity = on ? 3 : 0.4;
    }
    if (this.glow) this.glow.material.opacity = state.glowFlicker !== undefined ? state.glowFlicker * 0.55 : 0.5;
    if (this.policeLamps.length) {
      const t = performance.now() / 1000;
      const on = !!state.siren;
      for (const m of this.policeLamps) {
        const red = /Red/.test(m.name);
        const phase = Math.floor(t * 6) % 2 === (red ? 0 : 1);
        m.material.emissiveIntensity = on ? (phase ? 9 : 0.3) : 0.6;
      }
    }
    if (this.flames) {
      const fire = state.backfire || (this.lightningExhaust && state.throttle > 0.5);
      for (const f of this.flames) {
        f.visible = !!fire;
        if (fire) f.scale.set(1, 1, 0.6 + Math.random() * 0.8);
      }
    }
  }

  // ------------------------------------------------------------------- assembly helpers
  /** Show only what exists at a given build stage. stage: 0 frame, 1 body, 2 painted, 3 powertrain, 4 complete */
  setBuildStage(stage) {
    const bodyNames = /^(Body|Cabin_Glass|Roof|Pillars|Quarters|Coach|Bed_|Grille|Bumper|Plate|Headlight|Taillight|Dashboard|Seat|Steering|Floor|Splitter_Stock|Diffuser|Tail_Fins|Landau|Coffin|Liftgate)/;
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      if (o.name === 'Underbody' || o.name.startsWith('WheelWell')) { o.visible = true; return; }
      if (bodyNames.test(o.name) || /^(Door|Hood|Trunk)/.test(o.name) || o.name.startsWith('Door')) o.visible = stage >= 1;
    });
    for (const k in this.partNodes) this.partNodes[k].visible = stage >= (k === 'engine' ? 3 : 4);
    for (const w of this.wheelNodes) { if (w.rim) w.rim.visible = stage >= 3; if (w.caliper) w.caliper.visible = stage >= 3; }
    if (this.glow) this.glow.visible = stage >= 4;
    this.paint.u.uReveal.value = stage >= 2 ? 1 : 0;
    this.paint2.color.set(stage >= 2 ? this.cfg.color2 : '#8b8f96');
  }

  setReveal(v) {
    this.paint.u.uReveal.value = v;
    this.paint2.color.set(this.cfg.color2).lerp(new THREE.Color('#8b8f96'), 1 - v);
  }

  // ------------------------------------------------------------------- optimisation / fx
  /** Lite mode (civilian/police): bake the body, driver door, rims and calipers into vertex-coloured meshes. */
  _mergeStatic() {
    // the driver door, the steering wheel (turns with the seated driver's hands) and the wheels stay articulated
    const keepRoots = new Set([this.n.Door_L, this.n.SteeringWheel, ...this.wheelNodes.map((w) => w.knuckle)].filter(Boolean));
    if (this.opts.police && this.partNodes.roof) keepRoots.add(this.partNodes.roof);
    const paint = new THREE.Color(this.cfg.color);
    const colorOf = (o, m) => (m.name === 'PaintLive' ? paint : m.color || paint);
    bakeInto(this.model, ownedMeshes(this.model, this.model, (n) => keepRoots.has(n)), colorOf);
    if (this.n.Door_L) bakeInto(this.n.Door_L, ownedMeshes(this.n.Door_L, this.n.Door_L, () => false), colorOf);
    if (this.n.SteeringWheel) bakeInto(this.n.SteeringWheel, ownedMeshes(this.n.SteeringWheel, this.n.SteeringWheel, (n) => /^FP_/.test(n.name)), colorOf, { shadow: false });
    for (const w of this.wheelNodes) {
      if (w.rim) bakeInto(w.rim, ownedMeshes(w.rim, w.rim, () => false), colorOf);
      if (w.caliper) bakeInto(w.caliper, ownedMeshes(w.caliper, w.caliper, () => false), colorOf, { shadow: false });
    }
    this.baked = true;
  }
  _ghostify() {
    const gm = new THREE.MeshBasicMaterial({ color: '#7dffb0', transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.root.traverse((o) => { if (o.isMesh) { o.material = gm; o.castShadow = false; } });
    this.headMat = this.tailMat = new THREE.MeshBasicMaterial({ color: '#b0ffd0' });
    this.ghostMat = gm;
  }

  dispose() {
    this.root.parent && this.root.parent.remove(this.root);
  }
}
