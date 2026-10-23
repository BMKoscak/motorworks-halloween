// Game-wide constants: town layout, customization catalogue and tuning tables.

export const PLANT = { x: 0, z: -85 }; // plant.glb local origin in world space
export const pl = (x, z, y = 0) => [PLANT.x + x, y, PLANT.z + z]; // plant-local -> world

export const LAYOUT = {
  mainStreet: { z: 0, x0: -200, x1: 200, width: 14 },
  elm: { x: 0, z0: 7, z1: 150, width: 12 },
  hillRoad: [[0, 145], [0, 152], [14, 166], [16, 176], [-10, 188], [-14, 197], [6, 207], [0, 214], [0, 222]],
  exitRoad: [[60, -91], [74, -91], [76, -89], [76, -10], [76, -6]],
  cemetery: { x0: -62, x1: 62, z0: 214, z1: 332, h: 10 },
  kioskTurntable: pl(-46, 16),
  kioskTerminal: pl(-40.5, 13),
  lobbyDoor: pl(-45, 25),
  bayDoor: pl(40, 25),
  bayZone: { x0: 29, x1: 59, z0: -77, z1: -61 },
  lineZ: PLANT.z - 6,
  lineStartX: -32,
  stationsX: [-20, -4, 12, 28, 44],
  exitDoor: pl(60, -6),
  exitApron: [70, 0, -91],
  policeStation: [130, 0, 22],
  respawnBusted: [124, 0, 9],
  diner: [-60, 0, 22],
  gas: [45, 0, 24],
  hardware: [-130, 0, 22],
  vladCrypt: [0, 10, 312],
  playerStart: [-45, 0, -40],
  gateZ: 216,
};

export const GOLDEN_PUMPKINS = [
  [-67, 0.5, 40],
  [-32, 0.5, 121],
  [14, 10.5, 326],
  [-10, 1.75, -112.6],
  [-150, 0.5, -40],
];

// ------------------------------------------------------------------ customization
export const BODIES = [
  { id: 'muscle', name: 'Classic American Muscle', price: 38000 },
  { id: 'pickup', name: 'Retro V8 Pickup Truck', price: 34000 },
  { id: 'coupe', name: 'Modern Street Coupe', price: 42000 },
  { id: 'hearse', name: 'Halloween Special: Hot-Rod Hearse', price: 66600 },
];

export const SWATCHES = ['#0b0b0e', '#f2f2f0', '#b3111a', '#ff6a00', '#ffb000', '#1f8f3a', '#39ff14', '#0f3d91', '#3fa9f5',
  '#5b1a8c', '#c0c4c8', '#6b4a2b', '#7a0f2e', '#14363a', '#d4af37', '#ff2e88'];

export const FINISHES = [
  { id: 'gloss', name: 'Gloss', price: 0 },
  { id: 'matte', name: 'Matte', price: 900 },
  { id: 'metallic', name: 'Metallic', price: 1400 },
  { id: 'pearl', name: 'Midnight Pearlescent', price: 3200 },
  { id: 'rust', name: 'Haunted Rust Patina', price: 1300 },
];

export const LIVERIES = [
  { id: 'none', name: 'Clean', price: 0 },
  { id: 'stripes', name: 'Twin Racing Stripes', price: 800 },
  { id: 'flames', name: 'Classic Hot-Rod Flames', price: 1600 },
  { id: 'ribcage', name: 'Skeletal Ribcage Wrap', price: 1900 },
  { id: 'pumpkin', name: "Jack-o'-Lantern Rally Livery", price: 2100 },
  { id: 'monster', name: 'Monster Mash Lightning', price: 0, locked: true },
];

export const RIMS = [
  { id: 'Cragar', name: 'Classic Chrome Cragar', price: 1200 },
  { id: 'DeepDish', name: 'Deep Dish', price: 1500 },
  { id: 'Beadlock', name: 'Off-Road Beadlock', price: 1300 },
  { id: 'MultiSpoke', name: 'Racing Multi-Spoke', price: 1800 },
  { id: 'Sawblade', name: 'Sawblade', price: 1700 },
  { id: 'Pumpkin', name: "Glowing Jack-o'-Lantern", price: 0, locked: true },
];

export const TIRE_LETTERING = [
  { id: 'none', name: 'Blackwall', price: 0 },
  { id: 'letters', name: 'Raised White Letters', price: 300 },
  { id: 'redline', name: 'Redline', price: 250 },
  { id: 'whitewall', name: 'Whitewall', price: 350 },
];

export const CALIPERS = ['#c81d11', '#ffcc00', '#39ff14', '#8a2be2', '#111111', '#ff6a00'];

export const FRONT_KITS = [
  { id: 'none', name: 'Stock Bumper', price: 0 },
  { id: 'Front_Splitter', name: 'Front Splitter', price: 900 },
  { id: 'Front_Bullbar', name: 'Bullbar', price: 700 },
  { id: 'Front_PushBumper', name: 'Push Bumper', price: 650 },
];
export const HOODS = [
  { id: 'none', name: 'Stock', price: 0 },
  { id: 'Hood_Cowl', name: 'Cowl Induction', price: 1100 },
  { id: 'Hood_TwinScoop', name: 'Twin Scoop', price: 1300 },
  { id: 'Hood_Blower', name: 'Exposed Supercharger Blower', price: 4500 },
  { id: 'Hood_Franken', name: 'Frankenstein Blower', price: 0, locked: true },
];
export const ROOFS = [
  { id: 'none', name: 'Clean Roof', price: 0 },
  { id: 'Roof_Rack', name: 'Rack w/ Luggage & Pumpkins', price: 600 },
  { id: 'Roof_LightBar', name: 'Light Bar', price: 800 },
  { id: 'Roof_Siren', name: 'Siren Topper', price: 500 },
  { id: 'Roof_Taxi', name: 'Taxi Topper', price: 400 },
];
export const SPOILERS = [
  { id: 'none', name: 'None', price: 0 },
  { id: 'Spoiler_Lip', name: 'Lip', price: 500 },
  { id: 'Spoiler_GT', name: 'GT Wing', price: 1800 },
  { id: 'Spoiler_Ducktail', name: 'Ducktail', price: 900 },
];
export const EXHAUSTS = [
  { id: 'Exhaust_Stock', name: 'Stock Tip', price: 0 },
  { id: 'Exhaust_Side', name: 'Side Pipes', price: 1400 },
  { id: 'Exhaust_Quad', name: 'Quad Tips', price: 900 },
  { id: 'Exhaust_Flame', name: 'Flame-Throwing Exhaust', price: 2600 },
  { id: 'Exhaust_Lightning', name: 'Green Lightning Exhaust', price: 0, locked: true },
];
export const UNDERGLOW = [
  { id: 'off', name: 'Off', color: null, price: 0 },
  { id: 'orange', name: 'Pumpkin Orange', color: '#ff6a00', price: 700 },
  { id: 'green', name: 'Toxic Green', color: '#39ff14', price: 700 },
  { id: 'red', name: 'Blood Red', color: '#ff0a1a', price: 700 },
  { id: 'purple', name: 'Phantom Purple', color: '#9b30ff', price: 700 },
];
export const ENGINES = [
  { id: 'v6', name: 'Stock V6', part: 'Engine_V6', force: 3300, top: 44, price: 0, cyl: 6, idle: 750, redline: 6500 },
  { id: 'v8sc', name: 'Supercharged V8', part: 'Engine_V8', force: 4700, top: 56, price: 9000, cyl: 8, idle: 700, redline: 7000, blower: true },
  { id: 'tt', name: 'Twin-Turbo Track Spec', part: 'Engine_TwinTurbo', force: 5800, top: 64, price: 16000, cyl: 8, idle: 900, redline: 8200, turbo: true },
];
export const TRANSMISSIONS = [
  { id: 'short', name: 'Short (Drag)', accel: 1.18, top: 0.88, price: 1200 },
  { id: 'balanced', name: 'Balanced', accel: 1.0, top: 1.0, price: 0 },
  { id: 'long', name: 'Long (Top Speed)', accel: 0.88, top: 1.15, price: 1200 },
];
export const TIRES = [
  { id: 'grip', name: 'Grip Compound', friction: 3.4, rearFriction: 3.4, price: 0 },
  { id: 'drift', name: 'Drift Compound', friction: 3.0, rearFriction: 2.45, price: 900 },
];

export const DEFAULT_CONFIG = {
  body: 'muscle', color: '#ff6a00', color2: '#0b0b0e', finish: 'gloss', livery: 'stripes',
  rim: 'Cragar', lettering: 'letters', caliper: '#c81d11', ride: 0, camber: 0,
  front: 'none', hood: 'Hood_Blower', roof: 'none', spoiler: 'Spoiler_Ducktail', exhaust: 'Exhaust_Side',
  underglow: 'orange', engine: 'v8sc', trans: 'balanced', tires: 'grip',
};

export function configPrice(c) {
  const f = (list, id) => (list.find((x) => x.id === id) || { price: 0 }).price;
  return f(BODIES, c.body) + f(FINISHES, c.finish) + f(LIVERIES, c.livery) + f(RIMS, c.rim) + f(TIRE_LETTERING, c.lettering) +
    f(FRONT_KITS, c.front) + f(HOODS, c.hood) + f(ROOFS, c.roof) + f(SPOILERS, c.spoiler) + f(EXHAUSTS, c.exhaust) +
    f(UNDERGLOW, c.underglow) + f(ENGINES, c.engine) + f(TRANSMISSIONS, c.trans) + f(TIRES, c.tires) +
    (c.ride !== 0 ? 600 : 0) + (c.camber !== 0 ? 400 : 0);
}

export const CIVILIAN_COLORS = ['#7a1f1f', '#1d3b5a', '#e8e4d8', '#2f4f2f', '#5a5a5a', '#8c6d3a', '#2a2a2a', '#9aa3ad', '#6b2a52', '#b05d1e'];

export const QUALITY = {
  low: { pixelRatio: 0.75, shadows: false, bloom: false, leaves: 150, fog: 10, shadowSize: 512 },
  medium: { pixelRatio: 1, shadows: true, bloom: true, leaves: 350, fog: 24, shadowSize: 1024 },
  high: { pixelRatio: Math.min(window.devicePixelRatio || 1, 2), shadows: true, bloom: true, leaves: 600, fog: 40, shadowSize: 2048 },
};
