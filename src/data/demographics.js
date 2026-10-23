// NPC demographic schema: every spawned person carries { ageGroup, role, voiceId, voiceKey } and draws its
// lines ONLY from the pool for its age group/gender, so a voice never contradicts the mesh that speaks it.
import { Character } from '../actors/character.js';
import dialogue from './dialogue.json';

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export const AGE_GROUPS = ['adult_male', 'adult_female', 'child_boy', 'child_girl', 'skeleton'];

/** Line pools per age group. Kids never get adult small-talk (kids, mortgages, shifts at the plant). */
export const POOLS = {
  adult_male: { voice: 'civ_m', chatter: ['civm_1', 'civm_2', 'civm_3', 'civm_4'], panic: ['panicm_1', 'panicm_2', 'panicm_3'],
    homeGreet: 'homem_greet', homePanic: 'homem_panic', homeVoice: 'homeowner_m' },
  adult_female: { voice: 'civilian', chatter: ['civilian_1', 'civilian_2', 'civilian_3', 'civilian_4'], panic: ['panic_1', 'panic_2', 'panic_3'],
    homeGreet: 'homef_greet', homePanic: 'homef_panic', homeVoice: 'homeowner_f' },
  child_boy: { voice: 'kid_b', chatter: ['kidb_1', 'kidb_2', 'kidb_3'], panic: ['kidb_4'] },
  child_girl: { voice: 'kid_g', chatter: ['kidg_1', 'kidg_2', 'kidg_3'], panic: ['kidg_4'] },
  skeleton: { voice: 'skeleton', chatter: ['skeleton_1'], panic: [] },
};

/** Phrases that must never come out of a child NPC (checked by the QA suite). */
export const ADULT_ONLY = /\b(my kid|mortgage|shift at the plant|my wife|my car|my truck|my house|payment)\b/i;

export const voiceOf = (lineId) => (dialogue.lines[lineId] ? dialogue.lines[lineId][0] : null);
export const demoOf = (lineId) => { const v = voiceOf(lineId); return v ? dialogue.voices[v].demo : null; };

const SHIRTS = ['#3c6e47', '#6b2a52', '#2d4f7a', '#a65d1e', '#444', '#7a1f1f', '#5b1a8c', '#1d3b5a'];
const PANTS = ['#222', '#3a3a44', '#4b3621', '#2a3550', '#555'];
const HAIR = ['#2a1a10', '#4b2e16', '#8a6a3a', '#1a1a1a', '#a0522d', '#d8c08a', '#777'];
const SKIN = ['#d8a283', '#c68e6a', '#8d5a3b', '#f1c7a5', '#a8714f', '#5c3a26'];
const KID_COSTUMES = {
  witch: { acc: ['Hat_Witch'], shirt: '#2a0f3a', pants: '#2a0f3a' },
  ghost: { acc: ['Costume_Ghost'], shirt: '#eee', pants: '#eee' },
  pumpkin: { acc: ['Mask_Pumpkin'], shirt: '#ff7a1a', pants: '#1a1a1a' },
  superhero: { acc: ['Costume_Cape', 'Mask_Super'], shirt: '#1f4fd1', pants: '#1f4fd1' },
};

/** Build a profile (role-specific overrides allowed) and the matching Character mesh. */
export function makeProfile(ageGroup, role = 'townsperson', voiceKey = null) {
  const pool = POOLS[ageGroup];
  const vk = voiceKey || pool.voice;
  return { ageGroup, role, voiceKey: vk, voiceId: dialogue.voices[vk].eleven, lines: pool.chatter.slice(), panic: pool.panic.slice() };
}

export function randomAdult() { return Math.random() < 0.5 ? 'adult_male' : 'adult_female'; }
export function randomKid() { return Math.random() < 0.5 ? 'child_boy' : 'child_girl'; }

/** Variant (colours + accessories) whose silhouette matches the age group: long hair/skirts on women, beards on some men, costumes on kids. */
export function variantFor(ageGroup, opts = {}) {
  const v = { shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIR), skin: pick(SKIN), acc: [] };
  if (ageGroup === 'adult_male') {
    if (Math.random() < 0.35) v.acc.push(Math.random() < 0.5 ? 'Beard' : 'Moustache');
    if (Math.random() < 0.3) v.acc.push(pick(['Hat_Fedora', 'Hat_Cap', 'Mask_Hockey', 'Mask_Pumpkin']));
  } else if (ageGroup === 'adult_female') {
    v.acc.push(Math.random() < 0.6 ? 'Hair_Long' : 'Hair_Ponytail');
    if (Math.random() < 0.55) { v.acc.push('Skirt'); v.skirt = pick(['#7a1f4f', '#2d4f7a', '#1a1a1a', '#5b1a8c', '#a65d1e']); }
    if (Math.random() < 0.25) v.acc.push('Hat_Witch');
  } else if (ageGroup === 'child_boy' || ageGroup === 'child_girl') {
    const c = KID_COSTUMES[opts.costume || pick(Object.keys(KID_COSTUMES))];
    Object.assign(v, { shirt: c.shirt, pants: c.pants });
    v.acc.push(...c.acc, 'Hold_CandyBag');
    if (ageGroup === 'child_girl' && !c.acc.includes('Costume_Ghost')) v.acc.push('Hair_Ponytail');
    v.costume = Object.keys(KID_COSTUMES).find((k) => KID_COSTUMES[k] === c);
  }
  if (opts.acc) v.acc.push(...opts.acc);
  if (opts.override) Object.assign(v, opts.override);
  return v;
}

export const CHILD_SCALE = 0.68;

/** One-stop: profile + correctly dressed, correctly scaled Character. */
export function makePerson(assets, ageGroup, role, opts = {}) {
  const profile = makeProfile(ageGroup, role, opts.voiceKey);
  if (opts.lines) profile.lines = opts.lines.slice();
  const kid = ageGroup === 'child_boy' || ageGroup === 'child_girl';
  const variant = opts.variant || variantFor(ageGroup, opts);
  const c = new Character(assets, variant, { scale: (opts.scale || 1) * (kid ? CHILD_SCALE : 1), profile, noBake: opts.noBake });
  c.profile = profile;
  profile.costume = variant.costume || null;
  return c;
}
