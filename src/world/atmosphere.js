import * as THREE from 'three';

const TAU = Math.PI * 2;
const C = (h) => new THREE.Color(h);
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);

/**
 * Sky palette keyed by sun height (sin of the sun's elevation). Halloween: a harvest-moon dusk, a deep violet
 * night, an orange-pink dawn and a pale overcast autumn day. Values between keys are interpolated.
 */
const SKY_KEYS = [
  { s: -0.4, top: C('#030209'), mid: C('#0b081c'), hor: C('#1c1532'), sun: C('#000000'), sunI: 0, hemiSky: C('#5a63a8'), hemiGround: C('#1e1712'), hemiI: 0.78, fog: C('#272b48'), fogD: 0.0065, exp: 1.42, stars: 1, lamps: 1, env: 0.22 },
  { s: -0.1, top: C('#060412'), mid: C('#1d0f33'), hor: C('#6e2838'), sun: C('#ff6a3a'), sunI: 0.15, hemiSky: C('#6656a0'), hemiGround: C('#26180f'), hemiI: 0.75, fog: C('#2e2340'), fogD: 0.0072, exp: 1.28, stars: 0.9, lamps: 1, env: 0.24 },
  { s: 0.09, top: C('#0b0618'), mid: C('#3a1a48'), hor: C('#ff7a2a'), sun: C('#ffb27a'), sunI: 1.5, hemiSky: C('#7d6aa8'), hemiGround: C('#3a2414'), hemiI: 0.9, fog: C('#3d2a40'), fogD: 0.0075, exp: 1.14, stars: 0.85, lamps: 1, env: 0.3 },
  { s: 0.32, top: C('#2b3f72'), mid: C('#7a6f9a'), hor: C('#f0a070'), sun: C('#ffd2a6'), sunI: 2.1, hemiSky: C('#a7a5c8'), hemiGround: C('#4a3420'), hemiI: 1.0, fog: C('#857a92'), fogD: 0.0056, exp: 1.0, stars: 0, lamps: 0.25, env: 0.6 },
  { s: 0.8, top: C('#36609f'), mid: C('#8aaed6'), hor: C('#e6d4be'), sun: C('#fff2df'), sunI: 2.7, hemiSky: C('#b6c6e6'), hemiGround: C('#5a4630'), hemiI: 1.15, fog: C('#a5afbd'), fogD: 0.0042, exp: 0.95, stars: 0, lamps: 0, env: 0.95 },
];

function samplePalette(s, out) {
  let i = 0;
  while (i < SKY_KEYS.length - 2 && s > SKY_KEYS[i + 1].s) i++;
  const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
  const k = THREE.MathUtils.clamp((s - a.s) / (b.s - a.s), 0, 1);
  for (const key of Object.keys(a)) {
    if (key === 's') continue;
    if (a[key].isColor) (out[key] ||= new THREE.Color()).copy(a[key]).lerp(b[key], k);
    else out[key] = a[key] + (b[key] - a[key]) * k;
  }
  return out;
}

const SKY_VERT = 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }';
const SKY_FRAG = `uniform vec3 uTop,uMid,uHorizon,uSunDir; uniform float uDay; varying vec3 vDir;
  void main(){ float h = vDir.y; float s = max(dot(vDir, uSunDir), 0.0);
    vec3 c = mix(uMid, uTop, smoothstep(0.05, 0.6, h));
    c = mix(c, uHorizon, pow(1.0 - clamp(h,0.0,1.0), 6.0) * (0.35 + 0.65 * pow(s, 3.0)));
    c += uHorizon * pow(s, 24.0) * 0.6;
    c += vec3(1.0, 0.92, 0.8) * pow(s, 900.0) * 6.0 * uDay;   // sun disc in daylight
    c = mix(c, vec3(0.05,0.03,0.06) * (1.0 + uDay * 4.0), smoothstep(0.0,-0.2,h));
    gl_FragColor = vec4(c, 1.0); }`;

/**
 * Halloween sky, day/night cycle, lights, fog, falling leaves and drifting ground fog.
 *   - A game clock (default 1 game hour per real minute, starting at 18:00 dusk) drives the sun and moon arcs, the
 *     sky palette, fog, exposure, star field and the street-lamp pool (Phase 4).
 *   - The sky is baked into a PMREM environment map that car paint, chrome and glass reflect; it is re-baked as the
 *     sky changes (every ~12 game minutes, a few ms each).
 *   - The shadow-casting key light is the sun by day and the moon by night; its shadow camera is snapped to whole
 *     shadow-map texels in light space so shadow edges don't crawl as the camera moves.
 */
export class Atmosphere {
  constructor(scene, quality, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.time = 0;
    this.hour = 18.0;
    this.rate = 1 / 60; // game hours per real second
    this.frozen = false;
    this.pal = {};
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.keyDir = new THREE.Vector3();
    const skyGeo = new THREE.SphereGeometry(1400, 48, 24);
    this.skyUniforms = { uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(-0.75, 0.12, 0.62).normalize() }, uDay: { value: 0 } };
    this.skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG });
    this.sky = new THREE.Mesh(skyGeo, this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.sky.userData.noAO = true;
    scene.add(this.sky);

    // harvest moon
    const mc = document.createElement('canvas');
    mc.width = mc.height = 256;
    const g = mc.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 20, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,214,150,1)');
    grd.addColorStop(0.42, 'rgba(255,190,110,1)');
    grd.addColorStop(0.46, 'rgba(255,150,60,0.45)');
    grd.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(190,130,80,0.35)';
    for (const [x, y, r] of [[105, 110, 14], [150, 140, 20], [120, 160, 9], [160, 100, 8]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(mc), fog: false, depthWrite: false, transparent: true }));
    moon.scale.set(260, 260, 1);
    moon.renderOrder = -9;
    this.moon = moon;
    scene.add(moon);

    // stars
    const sp = [];
    for (let i = 0; i < 2400; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < 0.12) v.y = Math.abs(v.y) + 0.12;
      v.normalize().multiplyScalar(1300);
      sp.push(v.x, v.y, v.z);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xfff4e0, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
    this.stars.renderOrder = -9;
    scene.add(this.stars);

    // lights: hemisphere fill, the shadow-casting key light (sun by day, moon by night) and a soft unshadowed moon fill
    this.hemi = new THREE.HemisphereLight('#7d6aa8', '#3a2414', 0.9);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffb27a', 1.5);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.035;
    this._shadowExtent(quality.shadowExtent || 60);
    scene.add(this.sun, this.sun.target);
    this.moonLight = new THREE.DirectionalLight('#8fa0ff', 0.35);
    scene.add(this.moonLight);

    this.fogTown = new THREE.Color('#3d2a40');
    this.fogCem = new THREE.Color('#4a4a58');
    scene.fog = new THREE.FogExp2(this.fogTown.clone(), 0.0075);
    scene.background = new THREE.Color('#1a0f22');

    // environment map: a small copy of the sky (same uniforms) plus a bright moon disc, baked through PMREM
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: this.skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG })));
    this.envMoon = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd7a0').multiplyScalar(5) }));
    this.envScene.add(this.envMoon);
    this.pmrem = renderer ? new THREE.PMREMGenerator(renderer) : null;
    this.envHour = -99;

    this._buildLeaves(quality.leaves);
    this._buildGroundFog(quality.fog);
    this._applyTime(true);
  }

  // ------------------------------------------------------------------ time of day
  /** 24 h clock: e.g. 18.5 = 6:30 pm. */
  setHour(h) { this.hour = ((h % 24) + 24) % 24; this._applyTime(true); }
  clockText() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }
  get isNight() { return this.pal.lamps > 0.5; }

  _applyTime(force) {
    // t = 0 at sunrise (6:24), PI at sunset (18:24); the moon trails the sun by half a day minus ~2 h
    const t = ((this.hour - 6.4) / 24) * TAU;
    const E = new THREE.Vector3(0.77, 0, -0.64), S = new THREE.Vector3(0.64, 0, 0.77);
    const arc = (tt, tilt, out) => {
      const e = Math.asin(THREE.MathUtils.clamp(tilt * Math.sin(tt), -1, 1));
      const hx = E.x * Math.cos(tt) + S.x * Math.sin(tt), hz = E.z * Math.cos(tt) + S.z * Math.sin(tt);
      const n = Math.hypot(hx, hz) || 1;
      return out.set((hx / n) * Math.cos(e), Math.sin(e), (hz / n) * Math.cos(e));
    };
    arc(t, 0.85, this.sunDir);
    arc(t + Math.PI - 0.5, 0.8, this.moonDir);
    const s = this.sunDir.y;
    const p = samplePalette(s, this.pal);
    const U = this.skyUniforms;
    U.uTop.value.copy(p.top); U.uMid.value.copy(p.mid); U.uHorizon.value.copy(p.hor);
    U.uSunDir.value.copy(s > -0.12 ? this.sunDir : this.moonDir);
    U.uDay.value = smooth(0.0, 0.25, s);
    this.hemi.color.copy(p.hemiSky); this.hemi.groundColor.copy(p.hemiGround);
    const env = this.quality.env;
    this.hemi.intensity = p.hemiI * (env ? 0.8 : 1);
    this.fogTown.copy(p.fog);
    this.fogBase = p.fogD;
    this.stars.material.opacity = 0.85 * p.stars;
    this.stars.visible = p.stars > 0.01;
    const moonUp = smooth(-0.05, 0.15, this.moonDir.y);
    this.moon.material.opacity = moonUp * (1 - 0.7 * smooth(0.1, 0.5, s));
    this.moon.visible = this.moon.material.opacity > 0.01;
    // key light: the sun while it is up, the moon at night (cross-fades through the dark minutes around the horizon)
    if (s > -0.04) {
      this.keyDir.copy(this.sunDir);
      this.sun.color.copy(p.sun);
      this.sun.intensity = p.sunI * smooth(-0.04, 0.03, s);
    } else {
      this.keyDir.copy(this.moonDir);
      this.sun.color.set('#9aa6ff');
      this.sun.intensity = 1.15 * moonUp * smooth(-0.04, -0.14, s);
    }
    // the light itself never drops below ~26°: a true 5° dusk sun throws every street into one long shadow
    // (the sky disc keeps its real position, so the glow still sits on the horizon)
    const minY = Math.sin(0.46);
    if (this.keyDir.y < minY) {
      const h = Math.hypot(this.keyDir.x, this.keyDir.z) || 1;
      this.keyDir.set((this.keyDir.x / h) * Math.cos(0.46), minY, (this.keyDir.z / h) * Math.cos(0.46));
    }
    this.moonLight.position.copy(this.moonDir).multiplyScalar(100);
    this.moonLight.intensity = 0.3 * moonUp * (1 - smooth(0.0, 0.3, s));
    this.lampFactor = p.lamps;
    if (this.renderer) this.renderer.toneMappingExposure = p.exp;
    this.envIntensity = p.env;
    if (force || Math.abs(this.hour - this.envHour) > 0.2) this._bakeEnv();
  }

  _bakeEnv() {
    this.envHour = this.hour;
    if (!this.pmrem || !this.quality.env) { this.scene.environment = null; return; }
    this.envMoon.position.copy(this.moonDir).multiplyScalar(40);
    this.envMoon.visible = this.moonDir.y > -0.05;
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = this.envIntensity;
  }

  _shadowExtent(ext) {
    const sc = this.sun.shadow.camera;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 340;
    sc.updateProjectionMatrix();
    this.extent = ext;
  }

  _leafTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(32, 2); g.quadraticCurveTo(62, 26, 32, 62); g.quadraticCurveTo(2, 26, 32, 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(32, 6); g.lineTo(32, 60); g.stroke();
    return new THREE.CanvasTexture(c);
  }

  _buildLeaves(n) {
    this.leafCount = Math.max(n, 900);
    const geo = new THREE.PlaneGeometry(0.22, 0.22);
    const mat = new THREE.MeshLambertMaterial({ map: this._leafTexture(), alphaTest: 0.4, side: THREE.DoubleSide });
    this.leafMesh = new THREE.InstancedMesh(geo, mat, this.leafCount);
    this.leafMesh.count = n;
    this.leafMesh.frustumCulled = false;
    this.leafMesh.userData.noAO = true;
    this.leaves = [];
    const palette = ['#e2671c', '#c43a12', '#f0a020', '#a8481a', '#d98c1a', '#8e2a10'].map((h) => new THREE.Color(h));
    for (let i = 0; i < this.leafCount; i++) {
      this.leaves.push({ p: new THREE.Vector3((Math.random() - 0.5) * 70, Math.random() * 18, (Math.random() - 0.5) * 70), ph: Math.random() * 6.28,
        spd: 0.6 + Math.random() * 0.9, spin: new THREE.Vector3(Math.random() * 3, Math.random() * 3, Math.random() * 3) });
      this.leafMesh.setColorAt(i, palette[i % palette.length]);
    }
    this.scene.add(this.leafMesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
  }

  _buildGroundFog(n) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    this.fogSprites = [];
    const mat = new THREE.SpriteMaterial({ map: tex, color: '#b8b0c8', transparent: true, opacity: 0.22, depthWrite: false, fog: true });
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(mat);
      const cem = i < n * 0.7;
      const x = cem ? (Math.random() - 0.5) * 120 : (Math.random() - 0.5) * 300;
      const z = cem ? 160 + Math.random() * 170 : -100 + Math.random() * 250;
      s.userData = { base: new THREE.Vector3(x, 0, z), ph: Math.random() * 6.28 };
      const sz = 14 + Math.random() * 16;
      s.scale.set(sz, sz * 0.35, 1);
      this.fogSprites.push(s);
      this.scene.add(s);
    }
  }

  setQuality(q) {
    this.quality = q;
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this._shadowExtent(q.shadowExtent || 60);
    this.leafMesh.count = Math.min(this.leafCount, q.leaves);
    this._applyTime(true);
  }

  update(dt, focus, heightAt) {
    this.time += dt;
    if (!this.frozen) {
      this.hour = (this.hour + dt * this.rate) % 24;
      if ((this._tAcc = (this._tAcc || 0) + dt) > 0.25) { this._tAcc = 0; this._applyTime(false); }
    }
    // shadow camera follows the focus, snapped to whole shadow texels in light space (no crawling shadow edges)
    const d = this.keyDir;
    const lx = (this._lx ||= new THREE.Vector3()), ly = (this._ly ||= new THREE.Vector3());
    lx.crossVectors(THREE.Object3D.DEFAULT_UP, d).normalize();
    ly.crossVectors(d, lx);
    const texel = (2 * this.extent) / this.sun.shadow.mapSize.x;
    const fx = focus.dot(lx), fy = focus.dot(ly);
    const c = (this._sc ||= new THREE.Vector3()).copy(focus)
      .addScaledVector(lx, Math.round(fx / texel) * texel - fx).addScaledVector(ly, Math.round(fy / texel) * texel - fy);
    this.sun.position.copy(c).addScaledVector(d, 160);
    this.sun.target.position.copy(c);
    this.sky.position.copy(focus);
    this.moon.position.copy(this.moonDir).multiplyScalar(1200).add(focus);
    this.stars.position.copy(focus);
    // cemetery fog thickens
    const t = THREE.MathUtils.smoothstep(focus.z, 150, 230);
    this.scene.fog.density = THREE.MathUtils.lerp(this.fogBase, Math.max(0.03, this.fogBase * 3), t);
    this.scene.fog.color.copy(this.fogTown).lerp(this.fogCem, t * (0.6 + 0.4 * this.lampFactor));
    // falling leaves wrap around the focus point
    const n = this.leafMesh.count;
    for (let i = 0; i < n; i++) {
      const L = this.leaves[i];
      L.p.y -= L.spd * dt;
      L.p.x += Math.sin(this.time * 1.3 + L.ph) * dt * 0.8 + dt * 0.6;
      L.p.z += Math.cos(this.time * 0.9 + L.ph) * dt * 0.5;
      let wx = focus.x + ((((L.p.x - focus.x) % 70) + 105) % 70) - 35;
      let wz = focus.z + ((((L.p.z - focus.z) % 70) + 105) % 70) - 35;
      L.p.x = wx; L.p.z = wz;
      const ground = heightAt(wx, wz);
      if (L.p.y < ground) L.p.y = ground + 14 + Math.random() * 6;
      this._e.set(this.time * L.spin.x, this.time * L.spin.y, this.time * L.spin.z);
      this._q.setFromEuler(this._e);
      this._m.compose(L.p, this._q, new THREE.Vector3(1, 1, 1));
      this.leafMesh.setMatrixAt(i, this._m);
    }
    this.leafMesh.instanceMatrix.needsUpdate = true;
    for (const s of this.fogSprites) {
      const b = s.userData.base;
      s.position.set(b.x + Math.sin(this.time * 0.05 + s.userData.ph) * 6, heightAt(b.x, b.z) + 1.2, b.z + Math.cos(this.time * 0.04 + s.userData.ph) * 6);
    }
  }
}

/** Procedural cobweb texture for corner decals. */
export function cobwebTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(235,235,245,0.8)';
  g.lineWidth = 1.6;
  const spokes = 9;
  for (let i = 0; i <= spokes; i++) {
    const a = (i / spokes) * Math.PI / 2;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 256, Math.sin(a) * 256); g.stroke();
  }
  for (let r = 24; r < 256; r += 26) {
    g.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const a = (i / spokes) * Math.PI / 2;
      const rr = r * (0.92 + 0.08 * Math.sin(i * 3));
      i ? g.quadraticCurveTo(Math.cos(a - 0.08) * rr * 0.9, Math.sin(a - 0.08) * rr * 0.9, Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Canvas text banner texture. */
export function bannerTexture(text, bg = '#ff7a10', fg = '#1a0a1e') {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 320;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 320);
  g.fillStyle = fg;
  for (let x = 0; x < 1024; x += 64) { g.beginPath(); g.moveTo(x, 320); g.lineTo(x + 32, 280); g.lineTo(x + 64, 320); g.fill(); }
  g.font = 'bold 120px Georgia, serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 512, 150);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
