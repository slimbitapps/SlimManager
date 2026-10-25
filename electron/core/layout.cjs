'use strict';
/**
 * Prüft Dashboard-Layouts und Aussehen, die aus der Oberfläche oder aus einer
 * importierten Datei kommen. Alles Unbekannte wird verworfen.
 * Die gleichen Listen stehen in src/shared/widgets.ts (ein Test prüft, dass sie übereinstimmen).
 */

const WIDGET_TYPES = ['metric', 'cores', 'procs', 'clock', 'net', 'disks', 'boost', 'system', 'battery', 'text'];
const METRICS = ['cpu', 'ram', 'gpu', 'gpuMem', 'cpuTemp', 'gpuTemp', 'netDown', 'netUp', 'diskRead', 'diskWrite', 'swap', 'cpuSpeed', 'battery', 'procCount'];
const STYLES = ['ring', 'bar', 'chart', 'number'];
const SIZES = ['s', 'w', 't', 'm', 'l', 'xl'];
const SKINS = ['neon', 'glass', 'clean', 'classic', 'terminal', 'sunset'];
const BGS = ['none', 'aurora', 'grid', 'carbon', 'waves', 'nebula', 'image'];
const FONTS = ['system', 'rounded', 'mono', 'retro'];
const CORNERS = ['tl', 'tr', 'bl', 'br'];
const MAX_WIDGETS = 40;

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,24}$/;

const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
const num = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const text = (v, max = 40) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').slice(0, max) : '');

/** Ein Widget säubern – gibt null zurück, wenn es unbrauchbar ist. */
function cleanWidget(w, i) {
  if (!w || typeof w !== 'object') return null;
  const type = pick(w.type, WIDGET_TYPES, null);
  if (!type) return null;
  const out = {
    id: ID_RE.test(String(w.id)) ? String(w.id) : `w${i}`,
    type,
    size: pick(w.size, SIZES, 's'),
  };
  if (type === 'metric') {
    out.metric = pick(w.metric, METRICS, 'cpu');
    out.style = pick(w.style, STYLES, 'ring');
  }
  if (type === 'procs') out.count = Math.round(num(w.count, 3, 15, 5));
  if (w.title) out.title = text(w.title);
  if (type === 'text') out.text = text(w.text, 120);
  if (COLOR_RE.test(String(w.color))) out.color = String(w.color);
  return out;
}

function cleanLayout(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = [];
  list.slice(0, MAX_WIDGETS).forEach((w, i) => {
    const c = cleanWidget(w, i);
    if (!c) return;
    while (seen.has(c.id)) c.id = c.id.slice(0, 20) + Math.floor(Math.random() * 1000);
    seen.add(c.id);
    out.push(c);
  });
  return out;
}

function cleanLook(l, d) {
  l = l && typeof l === 'object' ? l : {};
  return {
    skin: pick(l.skin, SKINS, d.skin),
    accent: COLOR_RE.test(String(l.accent)) ? String(l.accent) : '',
    bg: pick(l.bg, BGS, d.bg),
    bgImage: !!l.bgImage,
    dim: num(l.dim, 0, 0.9, d.dim),
    blur: num(l.blur, 0, 30, d.blur),
    cardAlpha: num(l.cardAlpha, 0.2, 1, d.cardAlpha),
    radius: Math.round(num(l.radius, 0, 28, d.radius)),
    font: pick(l.font, FONTS, d.font),
    rgb: !!l.rgb,
    anim: l.anim === undefined ? d.anim : !!l.anim,
  };
}

function cleanOverlay(o, d) {
  o = o && typeof o === 'object' ? o : {};
  const metrics = Array.isArray(o.metrics) ? [...new Set(o.metrics.filter((m) => METRICS.includes(m)))].slice(0, 8) : d.metrics;
  return {
    enabled: !!o.enabled,
    corner: pick(o.corner, CORNERS, d.corner),
    metrics,
    opacity: num(o.opacity, 0.3, 1, d.opacity),
    scale: num(o.scale, 0.7, 1.6, d.scale),
    hotkey: o.hotkey === undefined ? d.hotkey : !!o.hotkey,
  };
}

module.exports = { cleanLayout, cleanWidget, cleanLook, cleanOverlay, WIDGET_TYPES, METRICS, STYLES, SIZES, SKINS, BGS, FONTS, CORNERS, MAX_WIDGETS };
