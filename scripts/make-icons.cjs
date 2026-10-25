'use strict';
/**
 * Erzeugt alle Logo-/Symbol-Dateien aus einer Vorlage (SVG) – mit Electron gerendert.
 *   npm run icons
 *
 * Logo-Schema wie alle SlimBit-Apps: abgerundetes Quadrat mit Farbverlauf,
 * dahinter ein halbdurchsichtiges Element, davor ein weißes Motiv.
 * SlimManager: Handy (hinten) + Fenster mit Tacho (vorne), Violett → Türkis.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Das Logo auf 1024×1024. padded = mit Rand (App-Symbol für Mac/Windows). */
function logoSvg({ padded = true } = {}) {
  const inner = `
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#06b6d4"/>
      </linearGradient>
      <linearGradient id="ink" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#06b6d4"/>
      </linearGradient>
      <filter id="sh" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#312e81" flood-opacity="0.35"/>
      </filter>
    </defs>
    <rect x="0" y="0" width="1024" height="1024" rx="230" fill="url(#bg)"/>
    <rect x="165" y="215" width="250" height="470" rx="54" fill="#fff" opacity="0.36" transform="rotate(-12 290 450)"/>
    <rect x="236" y="262" width="108" height="16" rx="8" fill="#c4b5fd" opacity="0.6" transform="rotate(-12 290 450)"/>
    <g filter="url(#sh)">
      <rect x="300" y="320" width="544" height="416" rx="66" fill="#fff"/>
    </g>
    <path d="M424 616a148 148 0 0 1 296 0" fill="none" stroke="url(#ink)" stroke-width="52" stroke-linecap="round"/>
    <path d="M572 616l80 -99" stroke="#1e1b4b" stroke-width="38" stroke-linecap="round"/>
    <circle cx="572" cy="616" r="32" fill="#1e1b4b"/>`;
  return padded
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><g transform="translate(64 64) scale(0.875)">${inner}</g></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${inner}</svg>`;
}

async function render(svg, w, h, out) {
  const win = new BrowserWindow({ width: w, height: h, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg ', `<svg width="${w}" height="${h}" `)}</body></html>`;
  const tmp = path.join(require('node:os').tmpdir(), `slimmanager-icon-${w}x${h}.html`);
  fs.writeFileSync(tmp, html);
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 250));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.resize({ width: w, height: h, quality: 'best' }).toPNG());
  win.destroy();
  console.log('✓', path.relative(ROOT, out));
}

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {}); // zwischen den Bildern nicht beenden
app.whenReady().then(async () => {
  fs.mkdirSync(path.join(ROOT, 'brand'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'brand', 'logo.svg'), logoSvg({ padded: false }));
  fs.writeFileSync(path.join(ROOT, 'brand', 'icon.svg'), logoSvg({ padded: true }));
  await render(logoSvg(), 1024, 1024, path.join(ROOT, 'brand', 'icon-1024.png')); // Quelle für die App-Symbole (tauri icon)
  await render(logoSvg(), 256, 256, path.join(ROOT, 'website', 'icon.png'));
  await render(logoSvg(), 256, 256, path.join(ROOT, 'brand', 'slimmanager.png')); // für die Startseite
  await render(logoSvg(), 192, 192, path.join(ROOT, 'public', 'icon.png')); // Handy-Seite
  await render(logoSvg({ padded: false }), 512, 512, path.join(ROOT, 'brand', 'logo-square.png'));
  app.quit();
});
