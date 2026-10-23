import * as THREE from 'three';

function softTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Pooled particle + decal effects shared by every vehicle and the factory. */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tex = softTex();
    // skid marks: ring buffer of ground quads
    this.skidMax = 1600;
    const sg = new THREE.PlaneGeometry(1, 1);
    sg.rotateX(-Math.PI / 2);
    this.skids = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: '#0a0a0a', transparent: true, opacity: 0.55, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }), this.skidMax);
    this.skids.frustumCulled = false;
    this.skids.count = 0;
    this.skidIdx = 0;
    scene.add(this.skids);
    this.lastSkid = new Map();
    // generic billboard particles (smoke, sparks, mist, dust)
    this.max = 900;
    const pg = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.max * 3);
    this.col = new Float32Array(this.max * 3);
    this.size = new Float32Array(this.max);
    this.alpha = new Float32Array(this.max);
    pg.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    pg.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    pg.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const mk = (blending) => new THREE.ShaderMaterial({
      uniforms: { map: { value: this.tex }, scale: { value: 600 } }, transparent: true, depthWrite: false, blending,
      vertexShader: 'attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float scale; void main(){ vC=color; vA=alpha; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = size*scale/max(1.0,-mv.z); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a*vA); if(gl_FragColor.a<0.01) discard; }',
    });
    this.points = new THREE.Points(pg, mk(THREE.NormalBlending));
    this.points.frustumCulled = false;
    scene.add(this.points);
    // additive layer for sparks / glows
    const ag = pg.clone();
    this.apos = ag.attributes.position.array; this.acol = ag.attributes.color.array; this.asize = ag.attributes.size.array; this.aalpha = ag.attributes.alpha.array;
    this.addPoints = new THREE.Points(ag, mk(THREE.AdditiveBlending));
    this.addPoints.frustumCulled = false;
    scene.add(this.addPoints);
    this.parts = [];
    this.aparts = [];
    this._m = new THREE.Matrix4();
    this.shake = 0;
  }

  skid(key, p, dir, width = 0.25) {
    const last = this.lastSkid.get(key);
    this.lastSkid.set(key, { p: p.clone(), t: performance.now() });
    if (!last || performance.now() - last.t > 150) return;
    const d = p.distanceTo(last.p);
    if (d < 0.05 || d > 3) return;
    const mid = p.clone().add(last.p).multiplyScalar(0.5);
    mid.y += 0.03;
    const ang = Math.atan2(p.x - last.p.x, p.z - last.p.z);
    this._m.compose(mid, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang), new THREE.Vector3(width, 1, d + 0.04));
    this.skids.setMatrixAt(this.skidIdx, this._m);
    this.skidIdx = (this.skidIdx + 1) % this.skidMax;
    this.skids.count = Math.min(this.skidMax, this.skids.count + 1);
    this.skids.instanceMatrix.needsUpdate = true;
  }

  emit(p, v, color, size, life, opts = {}) {
    const list = opts.additive ? this.aparts : this.parts;
    if (list.length >= this.max) list.shift();
    list.push({ p: p.clone(), v: v.clone(), c: new THREE.Color(color), s: size, grow: opts.grow || 0, life, t: 0, g: opts.gravity || 0, a: opts.alpha || 1, drag: opts.drag || 0 });
  }

  smoke(p, n = 1) {
    for (let i = 0; i < n; i++) this.emit(p, new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2), '#cfc8c0', 0.6, 1.6, { grow: 1.8, alpha: 0.45, drag: 0.8 });
  }

  sparks(p, n = 12, color = '#ffb347', speed = 4) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.9 + 0.1, (Math.random() - 0.5)).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      this.emit(p, v, color, 0.07 + Math.random() * 0.06, 0.35 + Math.random() * 0.5, { additive: true, gravity: 9, drag: 0.3 });
    }
  }

  mist(p, dir, color, n = 4) {
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(2 + Math.random() * 2).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.2));
      this.emit(p, v, color, 0.25, 1.2, { grow: 1.4, alpha: 0.5, drag: 1.6 });
    }
  }

  dust(p, n = 6, color = '#b59a74') {
    for (let i = 0; i < n; i++) this.emit(p, new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3), color, 0.4, 1.0, { grow: 1.2, alpha: 0.5, drag: 1.2 });
  }

  _flush(list, pos, col, size, alpha, geo, dt) {
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const q = list[i];
      q.t += dt;
      if (q.t >= q.life) { list.splice(i, 1); continue; }
      q.v.y -= q.g * dt;
      q.v.multiplyScalar(Math.max(0, 1 - q.drag * dt));
      q.p.addScaledVector(q.v, dt);
    }
    for (const q of list) {
      if (n >= this.max) break;
      const k = q.t / q.life;
      pos[n * 3] = q.p.x; pos[n * 3 + 1] = q.p.y; pos[n * 3 + 2] = q.p.z;
      col[n * 3] = q.c.r; col[n * 3 + 1] = q.c.g; col[n * 3 + 2] = q.c.b;
      size[n] = q.s * (1 + q.grow * k);
      alpha[n] = q.a * (1 - k);
      n++;
    }
    geo.setDrawRange(0, n);
    for (const k of ['position', 'color', 'size', 'alpha']) geo.attributes[k].needsUpdate = true;
  }

  update(dt) {
    this._flush(this.parts, this.pos, this.col, this.size, this.alpha, this.points.geometry, dt);
    this._flush(this.aparts, this.apos, this.acol, this.asize, this.aalpha, this.addPoints.geometry, dt);
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }
}
