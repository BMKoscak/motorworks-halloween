import * as THREE from 'three';
import { bakeProp } from '../world/buildings.js';

const SHOP_ITEMS = {
  Crowbar: { name: 'Crowbar', model: 'Weapon_Crowbar', give: (g) => g.combat.give('crowbar') },
  Pistol: { name: '9mm Pistol (+24 rounds)', model: 'Weapon_Pistol', give: (g) => g.combat.give('pistol', 24) },
  Shotgun: { name: 'Pump Shotgun (+8 shells)', model: 'Weapon_Shotgun', give: (g) => g.combat.give('shotgun', 8) },
  Ammo: { name: 'Ammo box', model: 'Item_Ammo', give: (g) => g.combat.addAmmo(1), repeat: true },
  Jerrycan: { name: 'Jerrycan (+35% fuel)', model: 'Item_Jerrycan', give: (g) => { g.state.jerrycans = (g.state.jerrycans || 0) + 1; }, repeat: true },
  Mask: { name: "Jack-o'-Lantern mask", model: 'Item_Mask', give: (g) => { g.state.ownsMask = true; g.player.setMask(true); } },
  EvidencePistol: { name: 'Confiscated pistol', model: 'Weapon_Pistol', give: (g) => g.combat.give('pistol', 12), steal: true },
  EvidenceShotgun: { name: 'Confiscated shotgun', model: 'Weapon_Shotgun', give: (g) => g.combat.give('shotgun', 6), steal: true },
  ArmoryAmmo: { name: 'Police ammo crate', model: 'Item_Ammo', give: (g) => g.combat.addAmmo(2), steal: true, repeat: true },
};

/**
 * Interactive light switches (every enterable building), exterior breaker boxes, hinged doors (open / kick in),
 * shop counters (Hardware Store, Gas Station, Police evidence room & armory) and the Motorworks Night Shift
 * lighting switch in the foreman's office.
 */
export class Interactions {
  constructor(game) {
    this.game = game;
    this.shopItems = [];
    this.nightShift = false;
    this.stats = { switches: 0, breakers: 0, doors: 0, purchases: 0, nightShift: 0 };
  }

  build() {
    const g = this.game;
    for (const b of g.buildings.list) {
      for (const s of b.shop) {
        const def = SHOP_ITEMS[s.item];
        if (!def) continue;
        let mesh = null;
        try { mesh = g.assets.part('props', def.model); } catch (e) { /* missing model */ }
        if (mesh) {
          mesh.position.copy(s.pos);
          mesh.rotation.y = s.yaw;
          if (/^Weapon_/.test(def.model)) { mesh.rotation.set(0, s.yaw + Math.PI / 2, 0); mesh.position.y += 0.05; }
          g.scene.add(mesh);
          bakeProp(mesh);
        }
        this.shopItems.push({ ...s, def, mesh, building: b, sold: false });
      }
    }
  }

  candidates(pos) {
    const g = this.game, out = [];
    const B = g.buildings;
    const eye = new THREE.Vector3(pos.x, pos.y + 1.2, pos.z);
    // light switches
    for (const sw of B.switches) {
      const d = sw.pos.distanceTo(eye);
      if (d > 1.5) continue;
      if (sw.name === 'NightShift') out.push({ d, text: `[E] Night Shift lighting: ${this.nightShift ? 'back to floodlights' : 'switch to blacklight / emergency'}`, act: () => this.toggleNightShift(sw) });
      else out.push({ d, text: sw.building.power ? `[E] Toggle lights (${sw.building.lightsOn ? 'on' : 'off'})` : '[E] Toggle lights — no power!', act: () => this.toggleSwitch(sw) });
    }
    // breaker boxes
    for (const b of B.list) {
      if (!b.breaker) continue;
      const d = b.breaker.pos.distanceTo(eye);
      if (d < 1.6) out.push({ d, text: b.power ? '[E] Flip the breaker — cut power, lights & alarm' : '[E] Breaker (power is cut)', act: () => { if (B.cutPower(b)) { this.stats.breakers++; g.hud.toast('⚡ Power cut: lights out, alarm & phone dead', 'good'); } } });
    }
    // doors
    const d = B.nearestDoor(pos, 2.1);
    if (d && (!g.player.carrying || d.target < 0.5)) {
      const kick = d.locked;
      out.push({ d: Math.hypot(d.center.x - pos.x, d.center.z - pos.z) + 0.25, text: kick ? `[E] Kick the ${d.building.house ? 'front door' : 'door'} in${d.building.house && d.building.alarm && d.building.power ? ' (alarm armed!)' : ''}` : `[E] ${d.target > 0.5 ? 'Close' : 'Open'} door`,
        act: () => { this.stats.doors++; if (kick) g.burglary.kickDoor(d); else { d.held = d.target < 0.5; B.toggleDoor(d); } } });
    }
    // shop counters
    for (const s of this.shopItems) {
      if (s.sold && !s.def.repeat) continue;
      const dd = s.pos.distanceTo(new THREE.Vector3(pos.x, s.pos.y, pos.z));
      if (dd > 1.8 || Math.abs(s.pos.y - pos.y) > 2.2) continue;
      const price = s.def.steal ? 0 : s.price;
      out.push({ d: dd, text: s.def.steal ? `[E] Steal ${s.def.name}` : `[E] Buy ${s.def.name} — $${price}`, act: () => this.buy(s) });
    }
    return out;
  }

  toggleSwitch(sw) {
    const g = this.game, b = sw.building;
    g.audio.click();
    this.stats.switches++;
    if (!b.power) { g.hud.toast('Click… nothing. The power is cut.'); return; }
    g.buildings.setLights(b, !b.lightsOn);
  }

  /** Plant lighting: bright industrial floodlights <-> eerie Halloween blacklight / red emergency lighting. */
  toggleNightShift(sw) {
    const g = this.game, f = g.factory;
    g.audio.click();
    g.audio.hydraulic();
    this.nightShift = !this.nightShift;
    this.stats.nightShift++;
    f.setNightShift(this.nightShift);
    if (sw.lever) sw.lever.rotation[sw.lever.userData.hinge || 'x'] = sw.base + (this.nightShift ? sw.lever.userData.open || 0.7 : 0);
    g.hud.toast(this.nightShift ? '🟣 Night Shift: blacklight & emergency lighting' : '💡 Floodlights back on', 'good');
    g.events.emit('nightShift', { on: this.nightShift });
  }

  buy(s) {
    const g = this.game, def = s.def;
    const price = def.steal ? 0 : s.price;
    if (g.state.money < price) { g.hud.toast(`Need $${price}`, 'bad'); return; }
    g.state.money -= price;
    def.give(g);
    s.sold = true;
    if (s.mesh && !def.repeat) s.mesh.visible = false;
    this.stats.purchases++;
    g.audio.cash();
    g.hud.toast(def.steal ? `Stole: ${def.name}` : `Bought: ${def.name}`, 'good');
    if (def.steal) {
      const w = g.police.witnesses(s.pos);
      if (w.cop) g.police.crime('theft', 2);
    }
    g.events.emit('purchase', { item: s.item, price, stolen: !!def.steal });
  }
}
