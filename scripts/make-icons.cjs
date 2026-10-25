'use strict';
/**
 * Erzeugt alle Logo-/Symbol-Dateien aus einer Vorlage (SVG) – mit Electron gerendert.
 *   npm run icons
 *
 * Logo-Schema wie alle SlimBit-Apps: abgerundetes Quadrat mit Farbverlauf,
 * dahinter ein halbdurchsichtiges Element, davor ein weißes Motiv.
 * SlimClick: Handy (hinten) + Folie mit Laserpunkt (vorne), Koralle → Pink.
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
        <stop offset="0" stop-color="#ff8a5c"/><stop offset="1" stop-color="#ff3d77"/>
      </linearGradient>
      <linearGradient id="ink" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffb199"/><stop offset="1" stop-color="#ff7fa3"/>
      </linearGradient>
      <filter id="sh" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#9b1239" flood-opacity="0.32"/>
      </filter>
      <radialGradient id="glow"><stop offset="0" stop-color="#ff2d55" stop-opacity="0.45"/><stop offset="1" stop-color="#ff2d55" stop-opacity="0"/></radialGradient>
    </defs>
    <rect x="0" y="0" width="1024" height="1024" rx="230" fill="url(#bg)"/>
    <rect x="165" y="215" width="250" height="470" rx="54" fill="#fff" opacity="0.36" transform="rotate(-12 290 450)"/>
    <rect x="236" y="262" width="108" height="16" rx="8" fill="#ff7a8f" opacity="0.5" transform="rotate(-12 290 450)"/>
    <g filter="url(#sh)">
      <rect x="300" y="345" width="540" height="370" rx="66" fill="#fff"/>
    </g>
    <rect x="370" y="430" width="230" height="38" rx="19" fill="url(#ink)"/>
    <rect x="370" y="498" width="160" height="28" rx="14" fill="url(#ink)" opacity="0.55"/>
    <circle cx="690" cy="600" r="110" fill="url(#glow)"/>
    <circle cx="690" cy="600" r="46" fill="#ff2d55"/>
    <circle cx="676" cy="586" r="15" fill="#fff" opacity="0.85"/>`;
  return padded
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><g transform="translate(64 64) scale(0.875)">${inner}</g></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${inner}</svg>`;
}

function dmgBackground(scale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${660 * scale}" height="${420 * scale}" viewBox="0 0 660 420">
    <rect width="660" height="420" fill="#f7f7f9"/>
    <text x="330" y="54" text-anchor="middle" font-family="-apple-system, Helvetica, Arial" font-weight="700" font-size="22" fill="#1c1c1f">SlimClick installieren · Install SlimClick</text>
    <text x="330" y="84" text-anchor="middle" font-family="-apple-system, Helvetica, Arial" font-size="14" fill="#5f636b">Ziehe das Symbol auf „Programme“ · Drag the icon onto Applications</text>
    <path d="M262 215h120" stroke="#ff4d6d" stroke-width="6" stroke-linecap="round"/>
    <path d="M372 199l20 16-20 16" fill="none" stroke="#ff4d6d" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="330" y="372" text-anchor="middle" font-family="-apple-system, Helvetica, Arial" font-size="12" fill="#8d9098">Danach SlimClick aus „Programme“ starten · Then open it from Applications</text>
  </svg>`;
}

async function render(svg, w, h, out) {
  const win = new BrowserWindow({ width: w, height: h, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg ', `<svg width="${w}" height="${h}" `)}</body></html>`;
  const tmp = path.join(require('node:os').tmpdir(), `slimclick-icon-${w}x${h}.html`);
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
  await render(logoSvg(), 1024, 1024, path.join(ROOT, 'build', 'icon.png'));
  await render(logoSvg(), 256, 256, path.join(ROOT, 'website', 'icon.png'));
  await render(logoSvg(), 256, 256, path.join(ROOT, 'brand', 'slimclick.png')); // für die Startseite
  await render(logoSvg(), 192, 192, path.join(ROOT, 'public', 'icon.png')); // Handy-Seite
  await render(logoSvg({ padded: false }), 512, 512, path.join(ROOT, 'brand', 'logo-square.png'));
  await render(dmgBackground(1), 660, 420, path.join(ROOT, 'build', 'background.png'));
  await render(dmgBackground(2), 1320, 840, path.join(ROOT, 'build', 'background@2x.png'));
  app.quit();
});
