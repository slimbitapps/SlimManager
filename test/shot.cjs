'use strict';
/**
 * Schneller Screenshot des Dashboards mit bestimmtem Aussehen (für Design-Kontrolle und Werbebilder).
 *   node test/shot.cjs <datei.png> [skin] [hintergrund] [layout-vorlage] [sprache]
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const [out = path.join(os.tmpdir(), 'slimmanager-shot.png'), skin = 'neon', bg = 'aurora', preset = '', lang = 'de'] = process.argv.slice(2);

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'slimmanager-shot-'));
  let layout = null;
  if (preset) {
    const { PRESETS } = await import(path.join(ROOT, 'src/shared/widgets.ts'));
    layout = PRESETS[preset];
  }
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ onboarded: true, prefs: { lang, theme: 'dark', mode: 'simple' }, look: { skin, bg }, layout: { pc: layout } }));
  const app = await electron.launch({ executablePath: require('electron'), args: [ROOT], env: { ...process.env, SLIMMANAGER_TEST: '1', SLIMMANAGER_USERDATA: userData, SLIMMANAGER_PORT: '0' } });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 860));
  await win.waitForSelector('[data-testid="dashboard"]');
  await new Promise((r) => setTimeout(r, 6000));
  await win.screenshot({ path: out });
  await app.close();
  console.log('✓', out);
})();
