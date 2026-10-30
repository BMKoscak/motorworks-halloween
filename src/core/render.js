import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

/**
 * Phase 4 render pipeline.
 *   RenderPass (MSAA, half-float HDR target) -> GTAO ambient occlusion (ultra) -> bloom -> grade (vignette, split-tone,
 *   film grain) -> OutputPass (ACES + sRGB).
 * The old composer rendered into plain 8-bit targets with no multisampling, so `antialias: true` on the canvas never
 * reached the screen; MSAA now lives on the composer's own targets.
 */

/** GTAO that only hides the handful of point/line/sprite objects for its G-buffer, instead of walking all 17k nodes twice a frame. */
class LeanGTAOPass extends GTAOPass {
  overrideVisibility() {
    const now = performance.now();
    if (!this._hide || now - this._hideAt > 3000) {
      this._hide = [];
      this._movers = [];
      this.scene.traverse((o) => {
        if (o.isPoints || o.isLine || o.isSprite || o.userData.noAO) this._hide.push(o);
        else if (o.userData.cullTree) this._movers.push(o);
      });
      this._hideAt = now;
    }
    // cars and people further than 40 m add dozens of parts each for contact shadows nobody can see
    const cam = this.viewCamera.position, r2 = 40 * 40;
    this._list = this._hide.concat(this._movers.filter((o) => o.visible && o.position.distanceToSquared(cam) > r2 && o.parent === this.scene));
    this._was = this._list.map((o) => o.visible);
    for (const o of this._list) o.visible = false;
  }

  restoreVisibility() { this._list.forEach((o, i) => (o.visible = this._was[i])); }

  /** The G-buffer is drawn with a short-range copy of the view camera (AO is invisible past ~100 m in this fog),
   * so its frustum culling drops the far town instead of re-submitting all of it. */
  render(renderer, writeBuffer, readBuffer, dt, mask) {
    const src = this.viewCamera, c = this.camera;
    c.position.copy(src.position); c.quaternion.copy(src.quaternion);
    c.fov = src.fov; c.aspect = src.aspect; c.near = src.near; c.far = this.range;
    c.updateProjectionMatrix(); c.updateMatrixWorld();
    super.render(renderer, writeBuffer, readBuffer, dt, mask);
  }

  /** AO at half resolution: the Poisson denoise hides it and it halves the cost of the most expensive pass. */
  setSize(w, h) { super.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2))); }
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.32 }, uGrain: { value: 0.035 },
    uShadowTint: { value: new THREE.Color('#2a1f48') }, uHighTint: { value: new THREE.Color('#ffb070') }, uSplit: { value: 0.07 },
    uContrast: { value: 1.06 }, uSaturation: { value: 1.08 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uSplit, uContrast, uSaturation;
    uniform vec3 uShadowTint, uHighTint; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      // split-tone: cool violet shadows, warm pumpkin highlights (applied in linear HDR, before tone mapping)
      float hl = smoothstep(0.05, 1.2, l);
      c.rgb = mix(c.rgb, c.rgb * mix(uShadowTint * 2.2, uHighTint * 1.25, hl), uSplit);
      c.rgb = mix(vec3(l), c.rgb, uSaturation);
      c.rgb = max(vec3(0.0), (c.rgb - 0.18) * uContrast + 0.18);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - uVignette * smoothstep(0.2, 0.85, dot(d, d) * 2.2);
      c.rgb += (h(vUv * 931.7 + fract(uTime * 7.13)) - 0.5) * uGrain * (0.35 + l);
      gl_FragColor = c;
    }`,
};

export class RenderPipeline {
  constructor(game, canvas, q) {
    this.game = game;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false }));
    r.setPixelRatio(q.pixelRatio);
    r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.info.autoReset = false;
    this.maxAniso = r.capabilities.getMaxAnisotropy();
    this.gpu = RenderPipeline.gpuName(r.getContext());
  }

  /** Compose passes once the scene and camera exist. */
  build(scene, camera, q) {
    this.scene = scene;
    this.camera = camera;
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa || 0 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass((this.renderPass = new RenderPass(scene, camera)));
    this.gtao = new LeanGTAOPass(scene, new THREE.PerspectiveCamera(), size.x, size.y);
    this.gtao.viewCamera = camera;
    this.gtao.range = 65;
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.6, thickness: 1.2, scale: 1.1, samples: 12, distanceFallOff: 1 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.6, 0.5, 0.9);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.apply(q);
  }

  apply(q) {
    const r = this.renderer;
    r.setPixelRatio(q.pixelRatio);
    this.bloom.enabled = q.bloom;
    this.gtao.enabled = !!q.ao;
    this.grade.enabled = !!q.grade;
    const samples = q.msaa || 0;
    for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (t.samples !== samples) { t.samples = samples; t.dispose(); }
    }
    this.resize();
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(innerWidth, innerHeight);
  }

  render(dt) {
    this.grade.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }

  static gpuName(gl) {
    try { const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''; } catch (e) { return ''; }
  }

  /** Default preset for a first visit: ultra on discrete RTX / RX 6000+ / Arc / Apple Pro-Max GPUs, medium elsewhere. */
  static defaultQuality(gpu) {
    if (/RTX|RX ?[67]\d{3}|RX ?[89]\d{3}|Radeon Pro W|Arc\(TM\) A7|Apple M\d (Pro|Max|Ultra)/i.test(gpu)) return 'ultra';
    if (/GTX 1[06-9]|GTX 16|RX ?5[5-7]\d{2}|Apple M\d/i.test(gpu)) return 'high';
    return 'medium';
  }
}
