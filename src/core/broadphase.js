import * as CANNON from 'cannon-es';

/**
 * Broadphase tuned for a world of thousands of static colliders (per-wall interior colliders, furniture, curbs) and a
 * handful of movers. cannon's SAP sweeps static-vs-static pairs every sub-step (O(n²) here); this keeps the statics in a
 * uniform spatial hash and only tests movers (dynamic/kinematic bodies and statics that are moved by hand, e.g. hinged
 * doors) against nearby statics + each other. aabbQuery (used by every raycast) also goes through the hash.
 */
export class StaticGridBroadphase extends CANNON.Broadphase {
  constructor(world, cell = 12) {
    super(world);
    this.cell = cell;
    this.grid = new Map();
    this.stamp = 0;
    this.useBoundingBoxes = true;
    this.stats = { statics: 0, movers: 0, pairsTested: 0 };
  }

  _key(i, k) { return i * 73856093 ^ k * 19349663; }

  _cellsOf(aabb) {
    const c = this.cell;
    return [Math.floor(aabb.lowerBound.x / c), Math.floor(aabb.upperBound.x / c), Math.floor(aabb.lowerBound.z / c), Math.floor(aabb.upperBound.z / c)];
  }

  _insert(b) {
    if (b.aabbNeedsUpdate) b.updateAABB();
    const [x0, x1, z0, z1] = this._cellsOf(b.aabb);
    // terrain heightfield, floor slabs: too big (or unbounded) to hash - always candidates
    if (!Number.isFinite(x0 + x1 + z0 + z1) || (x1 - x0 + 1) * (z1 - z0 + 1) > 400) {
      (this.big ||= []).push(b);
      b._cells = [];
      b._big = true;
      b._inGrid = true;
      return;
    }
    b._cells = [];
    for (let i = x0; i <= x1; i++) for (let k = z0; k <= z1; k++) {
      const key = this._key(i, k);
      let arr = this.grid.get(key);
      if (!arr) this.grid.set(key, (arr = []));
      arr.push(b);
      b._cells.push(key);
    }
    b._inGrid = true;
  }

  _remove(b) {
    if (b._big) { this.big.splice(this.big.indexOf(b), 1); b._big = false; }
    for (const key of b._cells || []) {
      const arr = this.grid.get(key);
      if (!arr) continue;
      const i = arr.indexOf(b);
      if (i >= 0) arr.splice(i, 1);
    }
    b._cells = null;
    b._inGrid = false;
  }

  /** Classify bodies: statics live in the grid, everything else (and hand-moved statics) is a mover. */
  _sync(world) {
    if (this._syncedStep === world.stepnumber && this._syncedLen === world.bodies.length && this._movers) return this._movers;
    this._syncedStep = world.stepnumber;
    this._syncedLen = world.bodies.length;
    const movers = (this._movers ||= []);
    movers.length = 0;
    let statics = 0;
    for (const b of world.bodies) {
      const isStatic = b.type === CANNON.Body.STATIC && !(b.userData && b.userData.moves);
      if (isStatic) {
        statics++;
        if (!b._inGrid) this._insert(b);
      } else {
        if (b._inGrid) this._remove(b);
        movers.push(b);
      }
    }
    // static bodies removed from the world drop out of the hash
    if (this._lastCount !== undefined && world.bodies.length < this._lastCount) {
      for (const arr of [...this.grid.values(), this.big || []]) for (let i = arr.length - 1; i >= 0; i--) if (arr[i].world !== world) { arr[i]._inGrid = false; arr.splice(i, 1); }
    }
    this._lastCount = world.bodies.length;
    this.stats.statics = statics;
    this.stats.movers = movers.length;
    return movers;
  }

  _query(aabb, fn) {
    const stamp = ++this.stamp;
    for (const b of this.big || []) { b._stamp = stamp; fn(b); }
    const [x0, x1, z0, z1] = this._cellsOf(aabb);
    for (let i = x0; i <= x1; i++) for (let k = z0; k <= z1; k++) {
      const arr = this.grid.get(this._key(i, k));
      if (!arr) continue;
      for (const b of arr) { if (b._stamp === stamp) continue; b._stamp = stamp; fn(b); }
    }
  }

  collisionPairs(world, p1, p2) {
    const movers = this._sync(world);
    let tested = 0;
    for (let i = 0; i < movers.length; i++) {
      const a = movers[i];
      if (a.aabbNeedsUpdate) a.updateAABB();
      // mover vs statics
      this._query(a.aabb, (s) => {
        if (!this.needBroadphaseCollision(a, s)) return;
        if (s.aabbNeedsUpdate) s.updateAABB();
        tested++;
        this.intersectionTest(a, s, p1, p2);
      });
      // mover vs mover
      for (let j = i + 1; j < movers.length; j++) {
        const b = movers[j];
        if (!this.needBroadphaseCollision(a, b)) continue;
        if (b.aabbNeedsUpdate) b.updateAABB();
        tested++;
        this.intersectionTest(a, b, p1, p2);
      }
    }
    this.stats.pairsTested = tested;
  }

  aabbQuery(world, aabb, result = []) {
    this._sync(world);
    this._query(aabb, (b) => { if (b.aabbNeedsUpdate) b.updateAABB(); if (b.aabb.overlaps(aabb)) result.push(b); });
    for (const b of this._movers) { if (b.aabbNeedsUpdate) b.updateAABB(); if (b.aabb.overlaps(aabb)) result.push(b); }
    return result;
  }
}
