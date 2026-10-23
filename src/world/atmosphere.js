import * as THREE from 'three';

/** Harvest-moon dusk sky, lights, fog, falling leaves and drifting ground fog. */
export class Atmosphere {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    this.time = 0;
    const skyGeo = new THREE.SphereGeometry(1400, 32, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color('#0b0618') }, uMid: { value: new THREE.Color('#3a1a48') },
        uHorizon: { value: new THREE.Color('#ff7a2a') }, uSunDir: { value: new THREE.Vector3(-0.75, 0.12, 0.62).normalize() } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
      fragmentShader: `uniform vec3 uTop,uMid,uHorizon,uSunDir; varying vec3 vDir;
        void main(){ float h = vDir.y; float s = max(dot(vDir, uSunDir), 0.0);
          vec3 c = mix(uMid, uTop, smoothstep(0.05, 0.6, h));
          c = mix(c, uHorizon, pow(1.0 - clamp(h,0.0,1.0), 6.0) * (0.35 + 0.65 * pow(s, 3.0)));
          c += uHorizon * pow(s, 24.0) * 0.6;
          c = mix(c, vec3(0.05,0.03,0.06), smoothstep(0.0,-0.2,h));
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.sky = new THREE.Mesh(skyGeo, this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
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
    this.moonDir = new THREE.Vector3(0.45, 0.32, 0.83).normalize();
    moon.position.copy(this.moonDir).multiplyScalar(1200);
    moon.renderOrder = -9;
    this.moon = moon;
    scene.add(moon);

    // stars
    const sp = [];
    for (let i = 0; i < 1400; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < 0.12) v.y = Math.abs(v.y) + 0.12;
      v.normalize().multiplyScalar(1300);
      sp.push(v.x, v.y, v.z);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xfff4e0, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
    this.stars.renderOrder = -9;
    scene.add(this.stars);

    // lights
    this.hemi = new THREE.HemisphereLight('#7d6aa8', '#3a2414', 0.9);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffb27a', 1.5);
    this.sun.position.set(-60, 45, 50);
    this.sun.castShadow = quality.shadows;
    const sc = this.sun.shadow.camera;
    sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 260;
    this.sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
    this.moonLight = new THREE.DirectionalLight('#8fa0ff', 0.35);
    this.moonLight.position.copy(this.moonDir).multiplyScalar(100);
    scene.add(this.moonLight);

    this.fogTown = new THREE.Color('#3d2a40');
    this.fogCem = new THREE.Color('#4a4a58');
    scene.fog = new THREE.FogExp2(this.fogTown.clone(), 0.0075);
    scene.background = new THREE.Color('#1a0f22');

    this._buildLeaves(quality.leaves);
    this._buildGroundFog(quality.fog);
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
    this.leafCount = n;
    const geo = new THREE.PlaneGeometry(0.22, 0.22);
    const mat = new THREE.MeshLambertMaterial({ map: this._leafTexture(), alphaTest: 0.4, side: THREE.DoubleSide });
    this.leafMesh = new THREE.InstancedMesh(geo, mat, n);
    this.leafMesh.frustumCulled = false;
    this.leaves = [];
    const palette = ['#e2671c', '#c43a12', '#f0a020', '#a8481a', '#d98c1a', '#8e2a10'].map((h) => new THREE.Color(h));
    for (let i = 0; i < n; i++) {
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
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.leafMesh.count = Math.min(this.leafCount, q.leaves);
  }

  update(dt, focus, heightAt) {
    this.time += dt;
    // shadow camera follows the player
    this.sun.position.set(focus.x - 60, focus.y + 45, focus.z + 50);
    this.sun.target.position.copy(focus);
    this.sky.position.copy(focus);
    this.moon.position.copy(this.moonDir).multiplyScalar(1200).add(focus);
    this.stars.position.copy(focus);
    // cemetery fog thickens
    const t = THREE.MathUtils.smoothstep(focus.z, 150, 230);
    this.scene.fog.density = THREE.MathUtils.lerp(0.0075, 0.03, t);
    this.scene.fog.color.copy(this.fogTown).lerp(this.fogCem, t);
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
