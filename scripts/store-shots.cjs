'use strict';
/**
 * Beschriftete Screenshots für Store, Download-Portale und Social Media (1920×1080).
 * Nimmt die echten Screenshots aus dem E2E-Test (marketing/raw/<sprache>/) und setzt
 * Überschrift, Laptop- und Handy-Rahmen dazu.
 *
 *   for l in de en; do E2E_LANG=$l node test/e2e/run.cjs marketing/raw/$l; done
 *   npx electron scripts/store-shots.cjs
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'marketing', 'screenshots');

// [Dateiname, Laptop-Bild, Handy-Bild, Überschrift DE, Unterzeile DE, Überschrift EN, Unterzeile EN]
const SLIDES = [
  ['1-hero', '10-home-qr', '20-phone-remote', 'Dein Handy als Präsentations-Fernbedienung', 'QR-Code scannen und los – keine App auf dem Handy nötig.', 'Your phone as a presentation remote', 'Scan the QR code and go – no app on your phone.'],
  ['2-remote', '11-home-connected', '20-phone-remote', 'Großer Weiter-Knopf und Live-Vorschau', 'Du siehst am Handy, was das Publikum sieht.', 'Big Next button and live preview', 'See on your phone what the audience sees.'],
  ['3-laser', null, '22-phone-laser', 'Laserpointer ohne Laserpointer', 'Auf die Vorschau tippen – der rote Punkt erscheint auf dem Beamer.', 'A laser pointer without a laser pointer', 'Touch the preview – the red dot appears on the projector.'],
  ['4-spotlight', null, '23-phone-spotlight', 'Spotlight lenkt den Blick', 'Eine Stelle bleibt hell, der Rest wird dunkel.', 'Spotlight guides every eye', 'One spot stays bright, the rest goes dark.'],
  ['5-timer', '12-home-timer', '24-phone-timer', 'Timer, den nur du siehst', 'Der Bildschirm blinkt kurz vor dem Ende – unauffällig.', 'A timer only you can see', 'The screen flashes before time runs out – quietly.'],
  ['6-hotspot', '17-hotspot-guide', null, 'Klappt auch im Schul-WLAN', 'Mit dem Handy-Hotspot – die App erklärt jeden Schritt.', 'Works on school Wi-Fi, too', 'With your phone’s hotspot – the app explains every step.'],
  ['7-secure', '13-approval', '27-phone-wait-approval', 'Sicher: Nur dein Handy steuert', 'Einmal-Code im QR, signierte Befehle, weitere Geräte nur mit Zustimmung.', 'Secure: only your phone is in control', 'One-time code, signed commands, extra devices only with your OK.'],
  ['8-any-app', '18-home-light', '26-phone-landscape', 'PowerPoint, Keynote, Google Slides, PDF', 'Hell oder dunkel, hoch oder quer – kostenlos für Windows & Mac.', 'PowerPoint, Keynote, Google Slides, PDF', 'Light or dark, portrait or landscape – free for Windows & Mac.'],
];

function html(lang, [, laptop, phone, hDe, sDe, hEn, sEn]) {
  const raw = (n) => 'file://' + path.join(ROOT, 'marketing', 'raw', lang, n + '.png');
  const h = lang === 'de' ? hDe : hEn;
  const s = lang === 'de' ? sDe : sEn;
  const landscape = phone && phone.includes('landscape');
  const phoneOnly = phone && !laptop;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; font-family: -apple-system, 'SF Pro Display', 'Segoe UI', Helvetica, Arial, sans-serif;
    background: radial-gradient(1100px 700px at 85% -10%, rgba(255,77,109,.45), transparent 60%), radial-gradient(900px 600px at -10% 110%, rgba(255,122,89,.35), transparent 60%), #111216; color: #fff; }
  .head { position: absolute; left: 110px; top: 90px; width: ${phoneOnly ? 760 : 1700}px; }
  .brand { display: flex; align-items: center; gap: 14px; font-weight: 700; font-size: 28px; color: rgba(255,255,255,.85); margin-bottom: 30px; }
  .brand img { width: 52px; height: 52px; }
  h1 { font-size: ${phoneOnly ? 76 : 68}px; line-height: 1.05; letter-spacing: -0.03em; margin: 0 0 22px; }
  p { font-size: 32px; line-height: 1.35; color: rgba(255,255,255,.72); margin: 0; max-width: ${phoneOnly ? 720 : 1400}px; }
  .laptop { position: absolute; left: 110px; top: ${phoneOnly ? 0 : 380}px; width: ${phone ? 1250 : 1460}px; border-radius: 22px; overflow: hidden;
    box-shadow: 0 40px 120px rgba(0,0,0,.55), 0 0 0 2px rgba(255,255,255,.08); }
  .laptop img { display: block; width: 100%; }
  .phone { position: absolute; border-radius: 54px; padding: 14px; background: #050506; box-shadow: 0 40px 120px rgba(0,0,0,.6), 0 0 0 3px #2a2b31; }
  .phone img { display: block; border-radius: 42px; width: 100%; }
  .phone.p { right: ${phoneOnly ? 260 : 120}px; top: ${phoneOnly ? 90 : 300}px; width: ${phoneOnly ? 470 : 380}px; }
  .phone.l { right: 90px; top: 520px; width: 760px; border-radius: 44px; }
  .phone.l img { border-radius: 32px; }
  .phone.p.crop { height: ${phoneOnly ? 900 : 760}px; overflow: hidden; }
  </style></head><body>
  <div class="head"><div class="brand"><img src="file://${path.join(ROOT, 'brand', 'slimclick.png')}">SlimClick</div><h1>${h}</h1><p>${s}</p></div>
  ${laptop ? `<div class="laptop"><img src="${raw(laptop)}"></div>` : ''}
  ${phone ? `<div class="phone ${landscape ? 'l' : 'p crop'}"><img src="${raw(phone)}"></div>` : ''}
  </body></html>`;
}

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1920, height: 1080, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  for (const lang of ['de', 'en']) {
    for (const slide of SLIDES) {
      const tmp = path.join(os.tmpdir(), `slimclick-shot-${lang}-${slide[0]}.html`);
      fs.writeFileSync(tmp, html(lang, slide));
      await win.loadFile(tmp);
      await new Promise((r) => setTimeout(r, 400));
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1920, height: 1080 });
      const out = path.join(OUT, `${lang}-${slide[0]}.png`);
      fs.writeFileSync(out, img.resize({ width: 1920, height: 1080, quality: 'best' }).toPNG());
      console.log('✓', path.relative(ROOT, out));
    }
  }
  app.quit();
});
