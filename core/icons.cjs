'use strict';
/**
 * Programm-Symbole für die Prozessliste (ohne Electron):
 *  - Mac: Symbol-Datei (.icns) aus dem App-Paket mit dem System-Werkzeug "sips" in ein kleines PNG umwandeln
 *  - Windows: über den Mess-Helfer (System.Drawing)
 * Ergebnisse werden zwischengespeichert (im Speicher und – am Mac – als Datei).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const cache = new Map();

/** Info.plist lesen (XML) → Name der Symbol-Datei */
function iconFileOf(appPath) {
  try {
    const plist = fs.readFileSync(path.join(appPath, 'Contents', 'Info.plist'), 'utf8');
    const m = /<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);
    if (!m) return null;
    const name = m[1].endsWith('.icns') ? m[1] : m[1] + '.icns';
    const file = path.join(appPath, 'Contents', 'Resources', name);
    return fs.existsSync(file) ? file : null;
  } catch {
    return null; // binäre plist oder kein Zugriff → kein Symbol
  }
}

function macIcon(appPath, dir) {
  const src = iconFileOf(appPath);
  if (!src) return Promise.resolve(null);
  const out = path.join(dir, 'icons', crypto.createHash('sha1').update(appPath).digest('hex').slice(0, 16) + '.png');
  if (fs.existsSync(out)) return Promise.resolve('data:image/png;base64,' + fs.readFileSync(out).toString('base64'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  return new Promise((resolve) =>
    execFile('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '40', src, '--out', out], { timeout: 5000 }, (err) => {
      if (err || !fs.existsSync(out)) return resolve(null);
      resolve('data:image/png;base64,' + fs.readFileSync(out).toString('base64'));
    }),
  );
}

async function appIcon(p, { dir, winSampler } = {}) {
  if (typeof p !== 'string' || !p) return null;
  if (cache.has(p)) return cache.get(p);
  let url = null;
  try {
    if (process.platform === 'darwin' && p.endsWith('.app')) url = await macIcon(p, dir);
    else if (process.platform === 'win32' && winSampler) url = await winSampler.icon(p);
  } catch {
    url = null;
  }
  if (cache.size > 400) cache.clear();
  cache.set(p, url);
  return url;
}

module.exports = { appIcon, iconFileOf };
