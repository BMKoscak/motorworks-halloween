import * as THREE from 'three';

export const PRICE_PER_GALLON = 2;
const RATE = 1.2; // gallons per second through the nozzle

/**
 * Main Street Gas Station refuelling + emergency jerrycans.
 * Pull alongside a pump (Pump_Spot_* from the Blender model) and press E: the hose swings out, the counter
 * ticks gallons and dollars, the pump glugs until the tank is full (or you run out of cash / drive off).
 */
export class Fuel {
  constructor(game) {
    this.game = game;
    this.session = null;
    this.stats = { refuels: 0, gallons: 0, spent: 0, jerrycans: 0 };
  }

  build() {
    const gas = this.game.buildings.list.find((b) => b.kind === 'gas');
    this.station = gas;
    this.pumps = gas && gas.pumps ? gas.pumps : [];
    this.hoses = this.game.buildings.hinges.filter((h) => h.building === gas);
  }

  pumpNear(p, r = 3.4) {
    let best = null, bd = r;
    for (const pu of this.pumps) { const d = Math.hypot(pu.pos.x - p.x, pu.pos.z - p.z); if (d < bd) { bd = d; best = pu; } }
    return best;
  }

  /** Interaction offered while sitting in a car (or standing next to one) at the pumps. */
  candidate(veh, onFootPos = null) {
    if (!veh || this.session) return this.session ? { text: '[E] Stop pumping', act: () => this.stop('manual') } : null;
    const p = onFootPos || veh.position;
    const pump = this.pumpNear(veh.position) || (onFootPos && this.pumpNear(onFootPos, 3));
    if (!pump || veh.speedAbs > 1) return null;
    if (veh.fuel >= 99.5) return { text: 'Tank is full', act: () => {} };
    void p;
    return { text: `[E] Refuel — $${PRICE_PER_GALLON}/gal (${Math.round(veh.fuel)}% now)`, act: () => this.start(veh, pump) };
  }

  start(veh, pump) {
    const g = this.game;
    if (g.state.money < PRICE_PER_GALLON) { g.hud.toast('Not enough cash for gas', 'bad'); return; }
    this.session = { veh, pump, gallons: 0, cost: 0, startFuel: veh.fuel, t: 0 };
    this.snd = g.audio.pump();
    const hose = this.hoses[pump.id] || this.hoses[0];
    if (hose) hose.target = 1;
    this.session.hose = hose;
    if (!this._greeted || performance.now() - this._greeted > 60000) { this._greeted = performance.now(); g.say('gas_1'); }
    g.events.emit('refuelStart', { fuel: veh.fuel });
  }

  stop(reason = 'full') {
    const g = this.game, s = this.session;
    if (!s) return;
    if (this.snd) this.snd.stop();
    if (s.hose) s.hose.target = 0;
    this.stats.refuels++;
    this.stats.gallons += s.gallons;
    this.stats.spent += s.cost;
    g.hud.toast(`⛽ ${s.gallons.toFixed(1)} gal · $${s.cost.toFixed(2)} · tank ${Math.round(s.veh.fuel)}%`, 'good', 3000);
    g.events.emit('refuel', { gallons: +s.gallons.toFixed(2), cost: +s.cost.toFixed(2), fuel: s.veh.fuel, reason });
    this.session = null;
    g.hud.pump(null);
  }

  update(dt) {
    const g = this.game, s = this.session;
    if (!s) return;
    const v = s.veh;
    if (v.speedAbs > 1.5 || !v.alive) return this.stop('drove off');
    const tank = v.tankGallons || 16;
    let gal = RATE * dt;
    gal = Math.min(gal, ((100 - v.fuel) / 100) * tank, Math.max(0, (g.state.money - s.cost) / PRICE_PER_GALLON));
    v.refuel((gal / tank) * 100);
    s.gallons += gal;
    s.cost += gal * PRICE_PER_GALLON;
    g.state.money -= gal * PRICE_PER_GALLON;
    s.t += dt;
    g.hud.pump({ gallons: s.gallons, cost: s.cost, fuel: v.fuel });
    if (v.fuel >= 99.9) this.stop('full');
    else if (gal <= 1e-6 && s.t > 0.3) this.stop('no cash');
  }

  // ------------------------------------------------------------------ jerrycans
  jerrycanCandidate(pos) {
    const g = this.game;
    if (!(g.state.jerrycans > 0) || g.player.vehicle) return null;
    let best = null, bd = 3;
    for (const v of g.vehicles) {
      if (v.kind !== 'player') continue;
      const d = Math.hypot(v.position.x - pos.x, v.position.z - pos.z);
      if (d < bd) { bd = d; best = v; }
    }
    if (!best || best.fuel > 97) return null;
    return { d: bd, text: `[E] Pour jerrycan into the tank (+35%, ${g.state.jerrycans} left)${best.stalled ? ' — car is stalled' : ''}`, act: () => this.pour(best) };
  }

  pour(v) {
    const g = this.game;
    g.state.jerrycans--;
    v.refuel(35);
    this.stats.jerrycans++;
    g.player.anim = 'reach'; g.player.busy = 1.2;
    const s = g.audio.pump();
    setTimeout(() => s.stop(), 1100);
    g.hud.toast(`⛽ Jerrycan poured: tank ${Math.round(v.fuel)}%`, 'good');
    g.events.emit('jerrycan', { fuel: v.fuel });
  }
}
