// Editor UI: avatar picker, option chips, colour swatches, undo, share, save.

import { SECTIONS, TABS, PRESETS, DEFAULT, randomConfig, sanitize } from './catalog.js';
import { Stage, renderThumbnails } from './scene.js';

const STORAGE_KEY = 'avatar-studio:v1';
const $ = (sel) => document.querySelector(sel);

const stage = new Stage($('#scene'));
let config = loadInitial();
let tab = 'look';
const undoStack = [];

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

function update(next, { record = true } = {}) {
  if (record) {
    undoStack.push(config);
    if (undoStack.length > 50) undoStack.shift();
  }
  config = sanitize(next);
  stage.setAvatar(config);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch { /* storage blocked: still works, just not remembered */ }
  render();
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

function swatches(section) {
  const row = document.createElement('div');
  row.className = 'swatches';
  const current = config[section.colorKey];
  for (const color of section.palette) {
    const b = document.createElement('button');
    b.className = 'swatch' + (color.toLowerCase() === current.toLowerCase() ? ' active' : '');
    b.style.background = color;
    b.title = color;
    b.setAttribute('aria-label', `${section.title} colour ${color}`);
    b.onclick = () => update({ ...config, [section.colorKey]: color });
    row.append(b);
  }
  const custom = document.createElement('label');
  custom.className = 'swatch custom' + (section.palette.includes(current) ? '' : ' active');
  custom.title = 'Custom colour';
  const input = document.createElement('input');
  input.type = 'color';
  input.value = current;
  input.setAttribute('aria-label', `Custom ${section.title} colour`);
  input.onchange = () => update({ ...config, [section.colorKey]: input.value });
  custom.append(input);
  row.append(custom);
  return row;
}

function render() {
  const tabs = $('#tabs');
  tabs.replaceChildren(...TABS.map(([id, label]) => {
    const b = chip(label, id === tab, () => { tab = id; render(); });
    b.className = 'tab' + (id === tab ? ' active' : '');
    b.setAttribute('role', 'tab');
    return b;
  }));

  const body = $('#options');
  body.replaceChildren();
  for (const s of SECTIONS.filter((x) => x.tab === tab)) {
    const box = document.createElement('section');
    box.className = 'option';
    const h = document.createElement('h3');
    h.textContent = s.title;
    box.append(h);
    if (s.key) {
      const row = document.createElement('div');
      row.className = 'chips';
      for (const [id, label] of s.options) row.append(chip(label, config[s.key] === id, () => update({ ...config, [s.key]: id })));
      box.append(row);
    }
    const hideColour = s.key && ['none', 'bald', 'barefoot'].includes(config[s.key]);
    if (s.colorKey && !hideColour) box.append(swatches(s));
    body.append(box);
  }
  $('#undo').disabled = undoStack.length === 0;
}

function renderPresets() {
  const grid = $('#presets');
  let thumbs = [];
  try {
    thumbs = renderThumbnails(PRESETS.map((p) => p.config));
  } catch (e) {
    console.warn('Thumbnails unavailable', e);
  }
  PRESETS.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'preset';
    b.title = `Start from ${p.name}`;
    if (thumbs[i]) {
      const img = document.createElement('img');
      img.src = thumbs[i];
      img.alt = '';
      b.append(img);
    }
    const name = document.createElement('span');
    name.textContent = p.name;
    b.append(name);
    b.onclick = () => update({ ...p.config });
    grid.append(b);
  });
}

// ---------- toolbar ----------

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

$('#random').onclick = () => update(randomConfig());
$('#undo').onclick = () => undoStack.length && update(undoStack.pop(), { record: false });
$('#share').onclick = async () => {
  const url = `${location.origin}${location.pathname}#a=${btoa(JSON.stringify(config))}`;
  window.history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied: anyone who opens it sees this avatar');
  } catch {
    toast('Link is in the address bar: copy it from there');
  }
};
$('#png').onclick = () => {
  const a = document.createElement('a');
  a.href = stage.snapshot();
  a.download = 'my-avatar.png';
  a.click();
};

document.querySelectorAll('[data-pose]').forEach((b) => {
  b.onclick = () => {
    stage.pose = b.dataset.pose;
    document.querySelectorAll('[data-pose]').forEach((x) => x.classList.toggle('active', x === b));
  };
});
$('#spin').onclick = () => {
  stage.controls.autoRotate = !stage.controls.autoRotate;
  $('#spin').classList.toggle('active', stage.controls.autoRotate);
};
$('#recenter').onclick = () => stage.resetCamera();

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && undoStack.length) {
    e.preventDefault();
    update(undoStack.pop(), { record: false });
  }
});

stage.setAvatar(config);
render();
renderPresets();
