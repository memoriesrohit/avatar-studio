// The people, outfits, outfit colours and facial expressions you can pick in the editor.
// The characters themselves are rigged GLB files in models/, built in Blender by tools/build.py.

export const OUTFITS = { formal: 'Office formal', casual: 'Casual', smart: 'Smart casual' };

export const PEOPLE = [
  { id: 'arjun', name: 'Arjun', about: '28, athletic', outfits: ['formal', 'smart', 'casual'] },
  { id: 'vikram', name: 'Vikram', about: '40, business owner', outfits: ['formal', 'smart', 'casual'] },
  { id: 'daniel', name: 'Daniel', about: '31, designer', outfits: ['formal', 'smart', 'casual'] },
  { id: 'marcus', name: 'Marcus', about: '26, fitness coach', outfits: ['formal', 'smart', 'casual'] },
  { id: 'meera', name: 'Meera', about: '27, engineer', outfits: ['formal', 'smart', 'casual'] },
  { id: 'sarah', name: 'Sarah', about: '34, manager', outfits: ['formal', 'smart', 'casual'] },
];

// Outfit colours multiply the fabric texture; null keeps the original colours.
export const TINTS = [
  [null, 'Original'], ['#2b3a55', 'Navy'], ['#3a3a3a', 'Charcoal'], ['#6b5a46', 'Brown'], ['#b8b2a6', 'Stone'],
  ['#7a1f2b', 'Burgundy'], ['#2f5d50', 'Forest'], ['#4a6fa5', 'Blue'], ['#d9d4c7', 'Cream'],
];

// Facial expressions as mixes of MakeHuman face units (morph targets on the face, brows, lashes and teeth).
export const EXPRESSIONS = {
  Neutral: {},
  Smile: {
    'mouth-corner-puller': 0.8, 'mouth-upward-retraction': 0.2, 'eye-left-slit': 0.15, 'eye-right-slit': 0.15,
    'nose-left-elevation': 0.15, 'nose-right-elevation': 0.15,
  },
  'Big laugh': {
    'mouth-corner-puller': 1, 'mouth-open': 0.55, 'mouth-upward-retraction': 0.35, 'eye-left-slit': 0.35, 'eye-right-slit': 0.35,
    'eyebrows-left-up': 0.3, 'eyebrows-right-up': 0.3, 'nose-left-elevation': 0.3, 'nose-right-elevation': 0.3,
  },
  Excited: {
    'mouth-corner-puller': 0.9, 'mouth-open': 0.7, 'eyebrows-left-up': 0.8, 'eyebrows-right-up': 0.8,
    'eye-left-opened-up': 0.5, 'eye-right-opened-up': 0.5,
  },
  Confident: {
    'mouth-corner-puller': 0.35, 'mouth-compression': 0.25, 'eyebrows-right-up': 0.45, 'eye-left-slit': 0.25, 'eye-right-slit': 0.25,
  },
  Serious: {
    'eyebrows-left-down': 0.55, 'eyebrows-right-down': 0.55, 'mouth-compression': 0.5, 'eye-left-slit': 0.2, 'eye-right-slit': 0.2,
  },
  Surprised: {
    'eyebrows-left-up': 1, 'eyebrows-right-up': 1, 'eye-left-opened-up': 0.9, 'eye-right-opened-up': 0.9, 'mouth-open': 0.55,
  },
  Angry: {
    'eyebrows-left-down': 1, 'eyebrows-right-down': 1, 'eye-left-slit': 0.4, 'eye-right-slit': 0.4,
    'mouth-compression': 0.6, 'nose-left-dilatation': 0.6, 'nose-right-dilatation': 0.6, 'mouth-depression': 0.3,
  },
  Sad: {
    'eyebrows-left-inner-up': 1, 'eyebrows-right-inner-up': 1, 'mouth-depression': 0.7, 'eye-left-slit': 0.2, 'eye-right-slit': 0.2,
  },
  Wink: { 'eye-left-closure': 1, 'mouth-corner-puller': 0.6, 'eyebrows-left-down': 0.3 },
};

export const DEFAULT = { person: 'arjun', outfit: 'formal', tint: null, expression: 'Smile', move: 'Idle' };

export const modelUrl = (person, outfit) => `models/${person}_${outfit}.glb`;
export const thumbUrl = (person) => `models/thumbs/${person}.jpg`;

/** Accept only known values (configs can come from share links). */
export function sanitize(input) {
  const c = { ...DEFAULT };
  if (!input || typeof input !== 'object') return c;
  const person = PEOPLE.find((p) => p.id === input.person);
  if (person) c.person = person.id;
  const outfits = PEOPLE.find((p) => p.id === c.person).outfits;
  c.outfit = outfits.includes(input.outfit) ? input.outfit : outfits[0];
  if (TINTS.some(([hex]) => hex === input.tint)) c.tint = input.tint;
  if (input.expression in EXPRESSIONS) c.expression = input.expression;
  if (typeof input.move === 'string' && /^[\w ]{1,30}$/.test(input.move)) c.move = input.move;
  return c;
}
