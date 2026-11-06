// The people, outfits, outfit colours and facial expressions you can pick in the editor.
// The characters are rigged GLB files in models/, converted in Blender by tools/rb_build.py from
// the Microsoft Rocketbox avatar library (MIT licence). Each person comes dressed in one outfit.

export const OUTFITS = { formal: 'Office formal', smart: 'Smart casual', casual: 'Casual' };

// Tops you can put on anyone (fitted from other Rocketbox characters), or their own outfit.
export const TOPS = { original: 'Original outfit', shirt: 'White shirt', tee: 'White T-shirt' };
// Formal trousers worn with the shirt or T-shirt (they multiply a neutral fabric texture).
export const TROUSERS = { black: ['Black', '#3a3b40'], blue: ['Blue', '#2c3e6b'] };

export const PEOPLE = [
  { id: 'sophia', name: 'Sophia', about: '32, lawyer', outfits: ['formal'] },
  { id: 'mia', name: 'Mia', about: '27, architect', outfits: ['smart'] },
  { id: 'priya', name: 'Priya', about: '25, student', outfits: ['casual'] },
  { id: 'emma', name: 'Emma', about: '29, photographer', outfits: ['casual'] },
  { id: 'aisha', name: 'Aisha', about: '30, doctor', outfits: ['formal'] },
  { id: 'olivia', name: 'Olivia', about: '33, marketing lead', outfits: ['smart'] },
  { id: 'mei', name: 'Mei', about: '26, designer', outfits: ['casual'] },
  { id: 'hannah', name: 'Hannah', about: '24, nurse', outfits: ['casual'] },
  { id: 'daniel', name: 'Daniel', about: '35, banker', outfits: ['formal'] },
  { id: 'marcus', name: 'Marcus', about: '31, consultant', outfits: ['formal'] },
  { id: 'arjun', name: 'Arjun', about: '28, engineer', outfits: ['smart'] },
  { id: 'ryan', name: 'Ryan', about: '30, designer', outfits: ['smart'] },
  { id: 'james', name: 'James', about: '34, lawyer', outfits: ['formal'] },
  { id: 'kenji', name: 'Kenji', about: '29, analyst', outfits: ['formal'] },
  { id: 'leo', name: 'Leo', about: '36, architect', outfits: ['smart'] },
  { id: 'ethan', name: 'Ethan', about: '27, photographer', outfits: ['casual'] },
  { id: 'noah', name: 'Noah', about: '31, teacher', outfits: ['smart'] },
  { id: 'luca', name: 'Luca', about: '28, chef', outfits: ['smart'] },
  { id: 'carlos', name: 'Carlos', about: '25, musician', outfits: ['casual'] },
  { id: 'andre', name: 'Andre', about: '30, producer', outfits: ['casual'] },
];

// Outfit colours multiply the fabric texture; null keeps the original colours.
export const TINTS = [
  [null, 'Original'], ['#2b3a55', 'Navy'], ['#3a3a3a', 'Charcoal'], ['#6b5a46', 'Brown'], ['#b8b2a6', 'Stone'],
  ['#7a1f2b', 'Burgundy'], ['#2f5d50', 'Forest'], ['#4a6fa5', 'Blue'], ['#d9d4c7', 'Cream'],
];

// Facial expressions as mixes of MakeHuman face units (for MakeHuman-built characters).
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

// The same expressions for characters with Apple ARKit face shapes (the Rocketbox characters).
const both = (l, r, v) => ({ [l]: v, [r]: v });
export const ARKIT_EXPRESSIONS = {
  Neutral: {},
  Smile: { ...both('mouthSmileLeft', 'mouthSmileRight', 0.65), ...both('cheekSquintLeft', 'cheekSquintRight', 0.3), ...both('eyeSquintLeft', 'eyeSquintRight', 0.15) },
  'Big laugh': {
    ...both('mouthSmileLeft', 'mouthSmileRight', 0.9), jawOpen: 0.4, ...both('cheekSquintLeft', 'cheekSquintRight', 0.55),
    ...both('eyeSquintLeft', 'eyeSquintRight', 0.4), browInnerUp: 0.2, ...both('mouthUpperUpLeft', 'mouthUpperUpRight', 0.25),
  },
  Excited: {
    ...both('mouthSmileLeft', 'mouthSmileRight', 0.8), jawOpen: 0.35, browInnerUp: 0.5,
    ...both('browOuterUpLeft', 'browOuterUpRight', 0.6), ...both('eyeWideLeft', 'eyeWideRight', 0.4),
  },
  Confident: { ...both('mouthSmileLeft', 'mouthSmileRight', 0.25), browOuterUpRight: 0.35, ...both('eyeSquintLeft', 'eyeSquintRight', 0.2), ...both('mouthPressLeft', 'mouthPressRight', 0.2) },
  Serious: { ...both('browDownLeft', 'browDownRight', 0.45), ...both('mouthPressLeft', 'mouthPressRight', 0.4), ...both('eyeSquintLeft', 'eyeSquintRight', 0.2) },
  Surprised: { browInnerUp: 0.9, ...both('browOuterUpLeft', 'browOuterUpRight', 0.9), ...both('eyeWideLeft', 'eyeWideRight', 0.8), jawOpen: 0.35 },
  Angry: {
    ...both('browDownLeft', 'browDownRight', 0.9), ...both('eyeSquintLeft', 'eyeSquintRight', 0.4), ...both('noseSneerLeft', 'noseSneerRight', 0.45),
    ...both('mouthPressLeft', 'mouthPressRight', 0.5), ...both('mouthFrownLeft', 'mouthFrownRight', 0.3),
  },
  Sad: { browInnerUp: 0.8, ...both('mouthFrownLeft', 'mouthFrownRight', 0.6), ...both('eyeSquintLeft', 'eyeSquintRight', 0.15), mouthShrugLower: 0.3 },
  Wink: { eyeBlinkLeft: 1, ...both('mouthSmileLeft', 'mouthSmileRight', 0.45), cheekSquintLeft: 0.4 },
};

// The face each move starts with (you can still pick another expression afterwards).
export const MOVE_EXPRESSION = {
  Idle: 'Neutral', Walk: 'Confident', Wave: 'Smile', Talk: 'Smile', Argue: 'Angry', Happy: 'Excited',
  Laugh: 'Big laugh', Drink: 'Neutral', Boxing: 'Serious',
  Confident: 'Confident', Cheer: 'Excited', Clap: 'Smile', Think: 'Serious', Shrug: 'Neutral', Phone: 'Smile',
};

export const DEFAULT ={ person: 'sophia', outfit: 'formal', top: 'original', trousers: 'black', tint: null, expression: 'Neutral', move: 'Idle' };

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
  if (input.top in TOPS) c.top = input.top;
  if (input.trousers in TROUSERS) c.trousers = input.trousers;
  if (TINTS.some(([hex]) => hex === input.tint)) c.tint = input.tint;
  if (input.expression in EXPRESSIONS) c.expression = input.expression;
  if (typeof input.move === 'string' && /^[\w ]{1,30}$/.test(input.move)) c.move = input.move;
  return c;
}
