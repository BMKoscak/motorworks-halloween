import * as THREE from 'three';
import { STATION_NAMES } from './factory.js';
import { BODIES } from '../config.js';

const CHECKLIST = ['Stamping', 'Chassis Weld', 'Paint Coat', 'Engine Marriage', 'Dyno & Laser QC'];

/**
 * Giant four-sided LED production screen hung from the plant trusses.
 * A sweeping camera aimed at the active station renders into a WebGLRenderTarget at ~16 Hz; a shader composites
 * that live feed (picture-in-picture) with a 1024x576 canvas overlay: order number, customer spec, current
 * station, step-by-step checklist and a progress bar.
 */
export class Jumbotron {
  constructor(game, factory, pos) {
    this.game = game;
    this.factory = factory;
    const { assets, scene } = game;
    this.root = assets.clone('jumbotron');
    this.root.position.copy(pos);
    scene.add(this.root);
    this.rt = new THREE.WebGLRenderTarget(512, 288, { colorSpace: THREE.SRGBColorSpace, samples: 0 });
    this.cam = new THREE.PerspectiveCamera(48, 16 / 9, 0.3, 90);
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024; this.canvas.height = 576;
    this.ctx = this.canvas.getContext('2d');
    this.overlay = new THREE.CanvasTexture(this.canvas);
    this.overlay.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uFeed: { value: this.rt.texture }, uOverlay: { value: this.overlay }, uRect: { value: new THREE.Vector4(0.035, 0.2, 0.62, 0.62) }, uTime: { value: 0 }, uBright: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D uFeed; uniform sampler2D uOverlay; uniform vec4 uRect; uniform float uTime; uniform float uBright; varying vec2 vUv;
        void main(){
          vec3 col = vec3(0.02, 0.015, 0.03);
          vec2 f = (vUv - uRect.xy) / uRect.zw;
          if (f.x > 0.0 && f.x < 1.0 && f.y > 0.0 && f.y < 1.0) col = texture2D(uFeed, f).rgb;
          vec4 o = texture2D(uOverlay, vUv);
          col = mix(col, o.rgb, o.a);
          // LED pixel grid + scanline shimmer
          vec2 px = fract(vUv * vec2(320.0, 180.0));
          float grid = smoothstep(0.0, 0.18, px.x) * smoothstep(0.0, 0.18, px.y) * 0.25 + 0.75;
          col *= grid * (0.96 + 0.04 * sin(vUv.y * 600.0 - uTime * 8.0));
          gl_FragColor = vec4(col * 1.35 * uBright, 1.0);
        }`,
      toneMapped: false,
    });
    this.faces = [];
    this.root.updateMatrixWorld(true);
    this.root.traverse((o) => {
      if (!/^JumboFace_/.test(o.name)) return;
      const w = o.userData.w || 6, h = o.userData.h || 3.375;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.mat);
      m.position.copy(o.getWorldPosition(new THREE.Vector3()));
      m.rotation.y = o.userData.yaw || 0;
      m.name = o.name;
      scene.add(m);
      this.faces.push(m);
    });
    this.acc = 0;
    this.frames = 0;
    this.overlayFrames = 0;
    this.sweep = 0;
  }

  /** The camera sweeps around whichever station is active (or the line start when idle). */
  _aim(dt) {
    const a = this.game.assembly, f = this.factory;
    this.sweep += dt * 0.35;
    let look;
    if (a.running && a.visual) look = a.visual.root.position.clone().add(new THREE.Vector3(0, 0.9, 0));
    else look = f.carrier.position.clone().add(new THREE.Vector3(0, 0.8, 0));
    const r = 7.5;
    this.cam.position.set(look.x + Math.sin(this.sweep) * r, look.y + 3.2 + Math.sin(this.sweep * 0.7) * 0.8, look.z + Math.cos(this.sweep) * r * 0.85 + 2);
    this.cam.lookAt(look);
  }

  _drawOverlay(force = false) {
    const g = this.game, a = g.assembly, c = this.ctx;
    const st = a.running ? Math.min(a.stage, 5) : -1;
    const key = `${a.number}|${st}|${Math.round((a.stageT || 0) * 50)}|${Math.floor(performance.now() / 500)}`;
    if (!force && key === this._key) return;
    this._key = key;
    this.overlayFrames++;
    c.clearRect(0, 0, 1024, 576);
    // header bar
    c.fillStyle = 'rgba(10,6,16,0.92)'; c.fillRect(0, 0, 1024, 96);
    c.fillStyle = '#ff7a1a'; c.font = 'bold 44px Impact, Arial Black, sans-serif'; c.textAlign = 'left';
    c.fillText('MOTORWORKS · LIVE PRODUCTION', 24, 60);
    c.fillStyle = Math.floor(performance.now() / 500) % 2 ? '#ff2a3a' : '#7a1018';
    c.beginPath(); c.arc(960, 46, 14, 0, 7); c.fill();
    c.fillStyle = '#fff'; c.font = 'bold 26px Arial'; c.textAlign = 'right'; c.fillText('LIVE', 936, 56);
    // feed frame
    c.strokeStyle = '#ff7a1a'; c.lineWidth = 4; c.strokeRect(36, 118, 636, 357);
    // right panel
    c.fillStyle = 'rgba(14,8,22,0.9)'; c.fillRect(690, 110, 320, 380);
    c.textAlign = 'left';
    if (a.running) {
      const body = BODIES.find((b) => b.id === a.cfg.body);
      c.fillStyle = '#ffd23f'; c.font = 'bold 30px Arial'; c.fillText(`ORDER ${a.number}`, 706, 150);
      c.fillStyle = '#e8dff0'; c.font = '20px Arial';
      c.fillText(body ? body.name : a.cfg.body, 706, 182);
      c.fillText(`${a.cfg.finish} · ${a.cfg.livery} · ${a.cfg.rim} rims`, 706, 208);
      c.fillText(`${a.cfg.engine.toUpperCase()} · ${a.cfg.trans} · ${a.cfg.tires}`, 706, 234);
      c.fillStyle = a.cfg.color; c.fillRect(950, 160, 40, 40); c.strokeStyle = '#fff'; c.lineWidth = 2; c.strokeRect(950, 160, 40, 40);
      CHECKLIST.forEach((name, i) => {
        const y = 278 + i * 40;
        const done = i < st, act = i === st;
        c.fillStyle = done ? '#39ff14' : act ? '#ffb000' : '#5a4e66';
        c.font = 'bold 22px Arial';
        c.fillText(`${done ? '✔' : act ? '▶' : '○'}  ${i + 1}. ${name}`, 706, y);
        if (act) { c.font = '18px Arial'; c.textAlign = 'right'; c.fillText(`${Math.round(a.stageT * 100)}%`, 996, y); c.textAlign = 'left'; }
      });
    } else {
      c.fillStyle = '#e8dff0'; c.font = 'bold 30px Arial'; c.fillText('LINE READY', 706, 160);
      c.font = '20px Arial'; c.fillText('Place an order at the', 706, 200); c.fillText('lobby configurator kiosk', 706, 226);
      CHECKLIST.forEach((name, i) => { c.fillStyle = '#5a4e66'; c.font = 'bold 22px Arial'; c.fillText(`○  ${i + 1}. ${name}`, 706, 278 + i * 40); });
    }
    // station caption + progress bar
    c.fillStyle = 'rgba(10,6,16,0.92)'; c.fillRect(0, 492, 1024, 84);
    c.fillStyle = '#fff'; c.font = 'bold 28px Arial'; c.textAlign = 'left';
    const caption = a.running ? (st < 5 ? `STATION ${st + 1} · ${STATION_NAMES[st].toUpperCase()}` : 'ROLL-OUT · CUSTOMER DELIVERY') : 'STAND BY';
    c.fillText(caption, 24, 530);
    c.fillStyle = '#2a1e33'; c.fillRect(24, 546, 976, 18);
    c.fillStyle = '#ff7a1a'; c.fillRect(24, 546, 976 * (a.running ? a.total : 0), 18);
    this.overlay.needsUpdate = true;
  }

  update(dt) {
    const g = this.game;
    this.mat.uniforms.uTime.value += dt;
    // only spend a render-target pass when someone can see the screen (inside / near the plant)
    const near = g.focusPos.distanceTo(this.root.position) < 75;
    if (!near || !g.assembly) return;
    this.acc += dt;
    if (this.acc >= 1 / 16) {
      this.acc = 0;
      this._aim(1 / 16);
      const r = g.renderer;
      const prevTarget = r.getRenderTarget();
      this.faces.forEach((f) => (f.visible = false));
      r.setRenderTarget(this.rt);
      r.render(g.scene, this.cam);
      r.setRenderTarget(prevTarget);
      this.faces.forEach((f) => (f.visible = true));
      this.frames++;
      this._drawOverlay();
    }
  }
}
