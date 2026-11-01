// Everything you can pick in the editor: options, colour palettes and starter avatars.

export const SKIN = ['#ffdfc4', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#5c3a21'];
export const HAIR = ['#1b1b1b', '#3b2314', '#6a4e23', '#b5651d', '#e6c27a', '#d64545', '#8e44ad', '#2e86de', '#d9d9d9'];
export const EYES = ['#3b2a1a', '#6b4f2a', '#2e7d32', '#1e88e5', '#607d8b', '#8e24aa'];
export const CLOTH = [
  '#f5f5f5', '#bfdbfe', '#6b7280', '#1f2937', '#111111', '#1e3a5f', '#3b82f6', '#6366f1',
  '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#7f1d1d', '#ec4899', '#a855f7',
  '#c8a97e', '#7c4a2d',
];

// Each section is one row in the editor. `key` is the option, `colorKey` the colour picked under it.
export const SECTIONS = [
  { tab: 'look', title: 'Body', key: 'body', options: [['slim', 'Slim'], ['regular', 'Regular'], ['athletic', 'Athletic'], ['sturdy', 'Sturdy']] },
  { tab: 'look', title: 'Face shape', key: 'jaw', options: [['soft', 'Soft'], ['strong', 'Strong jaw']] },
  { tab: 'look', title: 'Skin tone', colorKey: 'skin', palette: SKIN },
  { tab: 'look', title: 'Expression', key: 'expression', options: [['smile', 'Smile'], ['grin', 'Grin'], ['excited', 'Excited'], ['confident', 'Confident'], ['neutral', 'Calm'], ['surprised', 'Wow']] },
  { tab: 'look', title: 'Eye colour', colorKey: 'eyes', palette: EYES },
  {
    tab: 'look', title: 'Hair', key: 'hair', colorKey: 'hairColor', palette: HAIR,
    options: [['bald', 'None'], ['buzz', 'Buzz'], ['short', 'Short'], ['quiff', 'Quiff'], ['sidepart', 'Side part'], ['spiky', 'Spiky'], ['long', 'Long'], ['bun', 'Bun'], ['ponytail', 'Ponytail'], ['curly', 'Curly']],
  },
  { tab: 'look', title: 'Facial hair', key: 'facialHair', options: [['none', 'None'], ['moustache', 'Moustache'], ['beard', 'Beard']] },

  {
    tab: 'clothes', title: 'Top', key: 'top', colorKey: 'topColor', palette: CLOTH,
    groups: [
      ['Formal', [['shirt', 'Dress shirt'], ['blazer', 'Blazer']]],
      ['Casual', [['tshirt', 'T-shirt'], ['polo', 'Polo'], ['flannel', 'Flannel'], ['hoodie', 'Hoodie'], ['sweater', 'Sweater'], ['jacket', 'Jacket'], ['kurta', 'Kurta'], ['tank', 'Tank top']]],
    ],
  },
  {
    tab: 'clothes', title: 'Tie', key: 'tie', colorKey: 'tieColor', palette: CLOTH,
    options: [['none', 'None'], ['tie', 'Necktie'], ['bow', 'Bow tie']],
    when: (c) => c.top === 'shirt' || c.top === 'blazer',
  },
  {
    tab: 'clothes', title: 'Bottom', key: 'bottom', colorKey: 'bottomColor', palette: CLOTH,
    groups: [
      ['Formal', [['trousers', 'Trousers'], ['pencil', 'Pencil skirt']]],
      ['Casual', [['jeans', 'Jeans'], ['chinos', 'Chinos'], ['cargo', 'Cargo'], ['joggers', 'Joggers'], ['shorts', 'Shorts'], ['skirt', 'Skirt']]],
    ],
  },
  {
    tab: 'clothes', title: 'Shoes', key: 'shoes', colorKey: 'shoesColor', palette: CLOTH,
    groups: [
      ['Formal', [['oxfords', 'Oxfords'], ['loafers', 'Loafers']]],
      ['Casual', [['sneakers', 'Sneakers'], ['boots', 'Boots'], ['sandals', 'Sandals'], ['barefoot', 'Barefoot']]],
    ],
  },

  {
    tab: 'extras', title: 'Headwear', key: 'hat', colorKey: 'hatColor', palette: CLOTH,
    options: [['none', 'None'], ['cap', 'Cap'], ['beanie', 'Beanie'], ['sunhat', 'Sun hat'], ['tophat', 'Top hat'], ['headphones', 'Headphones']],
  },
  {
    tab: 'extras', title: 'Glasses', key: 'glasses', colorKey: 'glassesColor', palette: ['#111111', '#7c4a2d', '#d4af37', '#ef4444', '#3b82f6', '#f5f5f5'],
    options: [['none', 'None'], ['round', 'Round'], ['square', 'Square'], ['shades', 'Shades']],
  },
];

for (const s of SECTIONS) if (s.groups) s.options = s.groups.flatMap(([, opts]) => opts);

export const TABS = [['look', 'Look'], ['clothes', 'Clothes'], ['extras', 'Extras']];

// One-click outfits: they change only the clothes, never the face or hair.
export const OUTFITS = [
  { name: 'Office formal', set: { top: 'blazer', topColor: '#1e3a5f', tie: 'tie', tieColor: '#7f1d1d', bottom: 'trousers', bottomColor: '#1e3a5f', shoes: 'oxfords', shoesColor: '#111111' } },
  { name: 'Office skirt suit', set: { top: 'blazer', topColor: '#1f2937', tie: 'none', tieColor: '#ec4899', bottom: 'pencil', bottomColor: '#1f2937', shoes: 'loafers', shoesColor: '#111111' } },
  { name: 'Business casual', set: { top: 'shirt', topColor: '#bfdbfe', tie: 'none', bottom: 'chinos', bottomColor: '#c8a97e', shoes: 'loafers', shoesColor: '#7c4a2d' } },
  { name: 'Black tie', set: { top: 'shirt', topColor: '#f5f5f5', tie: 'bow', tieColor: '#111111', bottom: 'trousers', bottomColor: '#111111', shoes: 'oxfords', shoesColor: '#111111' } },
  { name: 'Weekend casual', set: { top: 'polo', topColor: '#22c55e', bottom: 'jeans', bottomColor: '#1e3a5f', shoes: 'sneakers', shoesColor: '#f5f5f5' } },
  { name: 'Flannel & denim', set: { top: 'flannel', topColor: '#ef4444', bottom: 'jeans', bottomColor: '#1e3a5f', shoes: 'boots', shoesColor: '#7c4a2d' } },
  { name: 'Streetwear', set: { top: 'hoodie', topColor: '#111111', bottom: 'cargo', bottomColor: '#6b7280', shoes: 'sneakers', shoesColor: '#f5f5f5' } },
];

export const PRESETS = [
  {
    name: 'Arjun', config: {
      body: 'athletic', jaw: 'strong', skin: '#c68642', expression: 'confident', eyes: '#3b2a1a', hair: 'quiff', hairColor: '#1b1b1b', facialHair: 'none',
      top: 'hoodie', topColor: '#3b82f6', bottom: 'joggers', bottomColor: '#1f2937', shoes: 'sneakers', shoesColor: '#f5f5f5',
      hat: 'headphones', hatColor: '#1f2937', glasses: 'none', glassesColor: '#111111',
    },
  },
  {
    name: 'Meera', config: {
      body: 'slim', skin: '#e0ac69', expression: 'grin', eyes: '#3b2a1a', hair: 'long', hairColor: '#1b1b1b', facialHair: 'none',
      top: 'kurta', topColor: '#ec4899', bottom: 'jeans', bottomColor: '#f5f5f5', shoes: 'sandals', shoesColor: '#d4af37',
      hat: 'none', hatColor: '#ef4444', glasses: 'round', glassesColor: '#7c4a2d',
    },
  },
  {
    name: 'Kai', config: {
      body: 'athletic', jaw: 'strong', skin: '#f1c27d', expression: 'neutral', eyes: '#1e88e5', hair: 'spiky', hairColor: '#2e86de', facialHair: 'none',
      top: 'jacket', topColor: '#1f2937', bottom: 'jeans', bottomColor: '#1e3a5f', shoes: 'boots', shoesColor: '#7c4a2d',
      hat: 'none', hatColor: '#ef4444', glasses: 'shades', glassesColor: '#111111',
    },
  },
  {
    name: 'Zoe', config: {
      body: 'slim', skin: '#8d5524', expression: 'smile', eyes: '#6b4f2a', hair: 'ponytail', hairColor: '#3b2314', facialHair: 'none',
      top: 'tank', topColor: '#eab308', bottom: 'shorts', bottomColor: '#14b8a6', shoes: 'sneakers', shoesColor: '#ef4444',
      hat: 'cap', hatColor: '#ef4444', glasses: 'none', glassesColor: '#111111',
    },
  },
  {
    name: 'Sam', config: {
      body: 'sturdy', jaw: 'strong', skin: '#ffdfc4', expression: 'smile', eyes: '#2e7d32', hair: 'curly', hairColor: '#b5651d', facialHair: 'beard',
      top: 'sweater', topColor: '#22c55e', bottom: 'jeans', bottomColor: '#1e3a5f', shoes: 'boots', shoesColor: '#1f2937',
      hat: 'beanie', hatColor: '#f97316', glasses: 'none', glassesColor: '#111111',
    },
  },
  {
    name: 'Ivy', config: {
      body: 'regular', skin: '#5c3a21', expression: 'surprised', eyes: '#3b2a1a', hair: 'bun', hairColor: '#8e44ad', facialHair: 'none',
      top: 'tshirt', topColor: '#f5f5f5', bottom: 'skirt', bottomColor: '#a855f7', shoes: 'sneakers', shoesColor: '#1f2937',
      hat: 'none', hatColor: '#ef4444', glasses: 'square', glassesColor: '#d4af37',
    },
  },
  {
    name: 'Vikram', config: {
      body: 'athletic', jaw: 'strong', skin: '#c68642', expression: 'excited', eyes: '#3b2a1a', hair: 'sidepart', hairColor: '#1b1b1b', facialHair: 'moustache',
      top: 'blazer', topColor: '#1e3a5f', tie: 'tie', tieColor: '#7f1d1d', bottom: 'trousers', bottomColor: '#1e3a5f', shoes: 'oxfords', shoesColor: '#111111',
      hat: 'none', hatColor: '#ef4444', glasses: 'square', glassesColor: '#111111',
    },
  },
  {
    name: 'Neha', config: {
      body: 'slim', skin: '#e0ac69', expression: 'smile', eyes: '#3b2a1a', hair: 'bun', hairColor: '#3b2314', facialHair: 'none',
      top: 'blazer', topColor: '#1f2937', tie: 'none', tieColor: '#ec4899', bottom: 'pencil', bottomColor: '#1f2937', shoes: 'loafers', shoesColor: '#111111',
      hat: 'none', hatColor: '#ef4444', glasses: 'none', glassesColor: '#111111',
    },
  },
];

export const DEFAULT = { tie: 'none', tieColor: '#ef4444', jaw: 'soft', ...PRESETS[0].config };

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function randomConfig() {
  const c = {};
  for (const s of SECTIONS) {
    if (s.key) c[s.key] = pick(s.options)[0];
    if (s.colorKey) c[s.colorKey] = pick(s.palette);
  }
  // Keep random avatars looking good: facial hair and odd extras only sometimes.
  if (Math.random() < 0.6) c.facialHair = 'none';
  if (Math.random() < 0.5) c.hat = 'none';
  if (Math.random() < 0.5) c.glasses = 'none';
  return c;
}

/** Accept only known option ids and #rrggbb colours (configs can come from share links). */
export function sanitize(input) {
  const c = { ...DEFAULT };
  if (!input || typeof input !== 'object') return c;
  for (const s of SECTIONS) {
    if (s.key && s.options.some(([id]) => id === input[s.key])) c[s.key] = input[s.key];
    if (s.colorKey && /^#[0-9a-f]{6}$/i.test(input[s.colorKey] ?? '')) c[s.colorKey] = input[s.colorKey];
  }
  return c;
}
