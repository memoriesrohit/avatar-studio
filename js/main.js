// Editor UI: pick a person, outfit, outfit colour, expression and move; share and export.

import { PEOPLE, OUTFITS, TOPS, TROUSERS, TINTS, EXPRESSIONS, MOVE_EXPRESSION, modelUrl, thumbUrl, sanitize, DEFAULT } from './catalog.js';
import { Stage } from './scene.js';
import { FORMATS, exportAvatar } from './export.js';

const STORAGE_KEY = 'avatar-studio:v2';
const $ = (sel) => document.querySelector(sel);

const stage = new Stage($('#scene'));
let config = loadInitial();

function loadInitial() {
  const hash = new URLSearchParams(location.hash.slice(1)).get('a');
  if (hash) {
    try {
      return sanitize(JSON.parse(atob(hash)));
    } catch { /* bad link: fall through */ }
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return sanitize(JSON.parse(saved));
  } catch { /* storage blocked */ }
  return { ...DEFAULT };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch { /* fine: just not remembered */ }
}

// ---------- loading ----------

let loadToken = 0;
async function showCharacter() {
  const token = ++loadToken;
  const overlay = $('#loading');
  overlay.hidden = false;
  $('#loading-text').textContent = `Loading ${PEOPLE.find((p) => p.id === config.person).name}…`;
  try {
    await stage.load(modelUrl(config.person, config.outfit), (f) => {
      if (token === loadToken) $('#loading-bar').style.width = `${Math.round(f * 100)}%`;
    });
    if (token !== loadToken) return;
    stage.setOutfit(config);
    stage.expression = config.expression;
    stage.playMove(config.move, 0);
    renderMoves();
    render(); // the outfit options depend on what this model carries
  } catch (e) {
    console.error(e);
    toast(`Couldn't load this character: ${e.message}`);
  } finally {
    if (token === loadToken) overlay.hidden = true;
  }
}

function update(changes) {
  const before = config;
  config = sanitize({ ...config, ...changes });
  save();
  render();
  if (config.person !== before.person || config.outfit !== before.outfit) showCharacter();
  else {
    stage.setOutfit(config);
    stage.expression = config.expression;
    if (config.move !== stage.move) stage.playMove(config.move);
  }
}

// ---------- panel ----------

function chip(label, active, onClick) {
  const b = document.createElement('button');
  b.className = 'chip' + (active ? ' active' : '');
  b.textContent = label;
  b.setAttribute('aria-pressed', active);
  b.onclick = onClick;
  return b;
}

function section(title, ...children) {
  const box = document.createElement('section');
  box.className = 'option';
  const h = document.createElement('h3');
  h.textContent = title;
  box.append(h, ...children);
  return box;
}

function row(className, items) {
  const r = document.createElement('div');
  r.className = className;
  r.append(...items);
  return r;
}

function render() {
  document.querySelectorAll('.preset').forEach((b) => b.classList.toggle('active', b.dataset.id === config.person));

  const person = PEOPLE.find((p) => p.id === config.person);
  const modular = stage.hasModularOutfit();
  const colourTitle = { formal: 'Suit colour', original: 'Outfit colour', shirt: 'Shirt colour', tee: 'T-shirt colour' }[config.top];
  // office formal first; the person's own outfit is offered too when it isn't already a suit
  const ownIsFormal = person.outfits.includes('formal');
  const tops = row('chips', Object.entries(TOPS)
    .filter(([id]) => (id === 'formal') || (id === 'original' ? !ownIsFormal : modular))
    .map(([id, label]) => chip(id === 'original' ? `${label} (${OUTFITS[config.outfit]})` : label, config.top === id, () => update({ top: id }))));
  const trousers = row('chips', Object.entries(TROUSERS).map(([id, [label]]) => chip(label, config.trousers === id, () => update({ trousers: id }))));

  const tints = row('swatches', TINTS.map(([hex, label]) => {
    const b = document.createElement('button');
    b.className = 'swatch' + (config.tint === hex ? ' active' : '') + (hex ? '' : ' original');
    if (hex) b.style.background = hex;
    b.title = label;
    b.setAttribute('aria-label', `${colourTitle}: ${label}`);
    b.onclick = () => update({ tint: hex });
    return b;
  }));

  const faces = row('chips', Object.keys(EXPRESSIONS).map((e) => chip(e, config.expression === e, () => update({ expression: e }))));

  $('#options').replaceChildren(
    section('Outfit', tops),
    ...(config.top !== 'original' ? [section('Trousers', trousers)] : []),
    section(colourTitle, tints),
    section('Expression', faces),
  );
}

function renderPresets() {
  $('#presets').replaceChildren(...PEOPLE.map((p) => {
    const b = document.createElement('button');
    b.className = 'preset';
    b.dataset.id = p.id;
    b.title = `${p.name}, ${p.about}`;
    const img = document.createElement('img');
    img.src = thumbUrl(p.id);
    img.alt = '';
    const name = document.createElement('span');
    name.textContent = p.name;
    b.append(img, name);
    b.onclick = () => update({ person: p.id, outfit: p.outfits.includes(config.outfit) ? config.outfit : p.outfits[0] });
    return b;
  }));
}

function renderMoves() {
  $('#poses').replaceChildren(...stage.moves.map((m) => {
    const b = document.createElement('button');
    b.textContent = m;
    b.dataset.pose = m;
    b.classList.toggle('active', m === stage.move);
    b.onclick = () => {
      update({ move: m, expression: MOVE_EXPRESSION[m] ?? config.expression });
      document.querySelectorAll('[data-pose]').forEach((x) => x.classList.toggle('active', x === b));
    };
    return b;
  }));
}

// ---------- toolbar ----------

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

$('#random').onclick = () => {
  const p = PEOPLE[Math.floor(Math.random() * PEOPLE.length)];
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  update({
    person: p.id, outfit: pick(p.outfits), tint: pick(TINTS)[0], top: pick(Object.keys(TOPS)), trousers: pick(Object.keys(TROUSERS)),
    expression: pick(Object.keys(EXPRESSIONS)), move: pick(stage.moves.length ? stage.moves : ['Idle']),
  });
};
$('#share').onclick = async () => {
  const url = `${location.origin}${location.pathname}#a=${btoa(JSON.stringify(config))}`;
  window.history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied: anyone who opens it sees this character');
  } catch {
    toast('Link is in the address bar: copy it from there');
  }
};

const menu = $('#export-menu');
const exportBtn = $('#export');
function toggleMenu(open = menu.hidden) {
  menu.hidden = !open;
  exportBtn.setAttribute('aria-expanded', open);
}
for (const [id, label, about] of FORMATS) {
  const item = document.createElement('button');
  item.setAttribute('role', 'menuitem');
  item.className = 'menu-item';
  const strong = document.createElement('strong');
  strong.textContent = label;
  const span = document.createElement('span');
  span.textContent = about;
  item.append(strong, span);
  item.onclick = async () => {
    toggleMenu(false);
    toast(`Preparing ${label}…`);
    try {
      await exportAvatar(stage, id, `${config.person}-${config.outfit}`);
      toast(`${label} downloaded`);
    } catch (e) {
      console.error(e);
      toast(`Couldn't export ${label}: ${e.message}`);
    }
  };
  menu.insertBefore(item, menu.querySelector('.menu-note'));
}
exportBtn.onclick = (e) => {
  e.stopPropagation();
  toggleMenu();
};
document.addEventListener('click', (e) => !menu.contains(e.target) && toggleMenu(false));
document.addEventListener('keydown', (e) => e.key === 'Escape' && toggleMenu(false));

$('#spin').onclick = () => {
  stage.controls.autoRotate = !stage.controls.autoRotate;
  $('#spin').classList.toggle('active', stage.controls.autoRotate);
};
$('#recenter').onclick = () => stage.resetCamera();
$('#closeup').onclick = () => stage.closeUp();

renderPresets();
render();
showCharacter();
