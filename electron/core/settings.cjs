'use strict';
/** Einstellungen als JSON-Datei im Benutzerordner. Schreibt sicher (erst Temp-Datei, dann umbenennen). */
const fs = require('node:fs');
const path = require('node:path');
const { cleanLayout, cleanLook, cleanOverlay } = require('./layout.cjs');

const DEFAULTS = {
  version: 1,
  onboarded: false,
  prefs: { lang: '', theme: 'system', mode: 'simple' },
  // Aussehen des Dashboards (Skin, Hintergrund, Farben …)
  look: { skin: 'neon', accent: '', bg: 'aurora', bgImage: false, dim: 0.45, blur: 0, cardAlpha: 0.72, radius: 16, font: 'system', rgb: false, anim: true, decimals: 0 },
  // null = Standard-Layout des Skins
  layout: { pc: null, phone: null },
  remote: { allowControl: true, approveNew: true, phoneLook: 'same' },
  network: { address: 'auto', port: 8650 },
  boost: { auto: false, lowerOthers: true, raiseGame: true, closeList: [], games: [], hotkey: true },
  overlay: { enabled: false, corner: 'tr', metrics: ['cpu', 'gpu', 'ram', 'netDown'], opacity: 0.85, scale: 1, hotkey: true },
  alerts: { enabled: false, cpuTemp: 90, gpuTemp: 85, ram: 92 },
  // gpu: false = SlimManager benutzt die Grafikkarte nicht (die gehört dem Spiel)
  // rate: Aktualisierung in ms, solange man hinschaut · liveInGame: auch beim Zocken flüssig (kostet etwas Leistung)
  app: { closeToTray: false, gpu: false, rate: 1000, liveInGame: false },
  devices: [],
  window: {},
};

function isObj(x) {
  return x && typeof x === 'object' && !Array.isArray(x);
}
/** Gespeicherte Werte über die Standardwerte legen (fehlende Felder bleiben Standard). */
function merge(base, over) {
  if (!isObj(over)) return structuredClone(base);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) {
    if (isObj(base[k]) && isObj(v)) out[k] = merge(base[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Werte aus Oberfläche/Datei prüfen – kaputte Teile fallen auf Standard zurück. */
function sanitize(d) {
  d.look = cleanLook(d.look, DEFAULTS.look);
  d.overlay = cleanOverlay(d.overlay, DEFAULTS.overlay);
  d.layout = { pc: d.layout?.pc ? cleanLayout(d.layout.pc) : null, phone: d.layout?.phone ? cleanLayout(d.layout.phone) : null };
  const names = (a) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === 'string' && x.length < 120))].slice(0, 100) : []);
  d.boost.closeList = names(d.boost.closeList);
  d.boost.games = names(d.boost.games);
  for (const k of ['cpuTemp', 'gpuTemp', 'ram']) {
    const n = Number(d.alerts[k]);
    d.alerts[k] = Number.isFinite(n) ? Math.min(110, Math.max(30, Math.round(n))) : DEFAULTS.alerts[k];
  }
  d.app.rate = [250, 500, 1000].includes(Number(d.app.rate)) ? Number(d.app.rate) : 1000;
  d.app.liveInGame = !!d.app.liveInGame;
  d.app.gpu = !!d.app.gpu;
  const port = Number(d.network.port);
  d.network.port = Number.isInteger(port) && port >= 0 && port <= 65535 ? port : DEFAULTS.network.port;
  return d;
}

class SettingsStore {
  constructor(file) {
    this.file = file;
    this.data = sanitize(merge(DEFAULTS, readJson(file)));
  }
  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch {
      /* nächster Versuch beim nächsten Speichern */
    }
  }
  /** Teil-Update aus der Oberfläche. Geräte-Schlüssel können von dort nicht verändert werden. */
  update(partial) {
    const { devices, ...rest } = partial || {};
    void devices;
    this.data = sanitize(merge(this.data, rest));
    this.save();
    return this.data;
  }
  /** Version für die Oberfläche – ohne geheime Geräte-Schlüssel. */
  public() {
    const { devices, ...rest } = this.data;
    return { ...rest, devices: devices.map(({ key, ...d }) => (void key, d)) };
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = { SettingsStore, DEFAULTS, merge, sanitize };
