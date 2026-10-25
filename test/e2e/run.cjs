'use strict';
/**
 * End-to-End-Test: startet den echten Kern + die echte Oberfläche (in einem Electron-Testfenster, wie die Tauri-App) und spielt alles durch –
 * Einführung, Dashboard + Editor + Skins, Mini-Anzeige, Prozesse (Priorität, Beenden),
 * Boost (Gaming: Einfrieren + Ausnahmen + Wirkung, Fokus-Modus), Vollbild, Handy koppeln (QR + PIN + falsche PIN + Zustimmung), Steuern vom Handy, Einstellungen.
 * Die Handy-Seite läuft dabei in handygroßen Fenstern. Für die Prozesse werden harmlose
 * Test-Programme gestartet (eine Kopie von "sleep").
 *
 *   npm run test:e2e [screenshot-ordner]
 *   E2E_LANG=en npm run test:e2e   (englische Screenshots)
 *   SLIMMANAGER_CORE=src-tauri/binaries/slimmanager-core-aarch64-apple-darwin node test/e2e/run.cjs   (fertigen Kern testen)
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = process.argv[2] || path.join(os.tmpdir(), 'slimmanager-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await sleep(100);
  }
  throw new Error('Zeitüberschreitung: ' + label);
}

const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

/** Harmloses Test-Programm mit eigenem Namen starten (Kopie von sleep / timeout) */
const dummyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slimmanager-dummy-'));
const dummies = [];
function dummy(name) {
  if (process.platform === 'win32') {
    const exe = path.join(dummyDir, name + '.exe');
    fs.copyFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'PING.EXE'), exe);
    const p = spawn(exe, ['-n', '600', '127.0.0.1'], { stdio: 'ignore', windowsHide: true });
    dummies.push(p);
    return p;
  }
  // macOS beendet kopierte System-Programme sofort → winziges eigenes Programm übersetzen
  const exe = path.join(dummyDir, name);
  const src = path.join(dummyDir, 'dummy.c');
  if (!fs.existsSync(src)) fs.writeFileSync(src, '#include <unistd.h>\nint main(void){sleep(600);return 0;}\n');
  require('node:child_process').execFileSync('cc', ['-O0', '-o', exe, src]);
  const p = spawn(exe, ['600'], { stdio: 'ignore' });
  dummies.push(p);
  return p;
}
const alive = (p) => p.exitCode === null && p.signalCode === null;
const prioOf = (p) => os.getPriority(p.pid);
const isMac = process.platform === 'darwin';
/** Mac: Planungs-Priorität laut ps (Hintergrund-Modus ≈ 4, normal ≈ 31) */
/** Prozess angehalten (eingefroren)? */
const stopped = (p) => process.platform !== 'win32' && /T/.test(require('node:child_process').execFileSync('ps', ['-o', 'stat=', '-p', String(p.pid)]).toString());
const macPri = (p) => Number(require('node:child_process').execFileSync('ps', ['-o', 'pri=', '-p', String(p.pid)]).toString().trim());

// Notbremse: hängt der Test, nach 8 Minuten abbrechen statt ewig zu warten
setTimeout(() => {
  console.error('✗ E2E-Test hängt – Abbruch');
  for (const p of dummies) if (alive(p)) p.kill();
  process.exit(2);
}, 8 * 60_000).unref();

/** Den echten Kern starten (wie die Tauri-Hülle es tut) und seine Meldungen an die Hülle mitlesen */
function startCore(userData, lang) {
  const { spawn: sp } = require('node:child_process');
  const exe = process.env.SLIMMANAGER_CORE; // fertiges Kern-Programm testen (sonst node core/main.cjs)
  const p = sp(exe || process.execPath, exe ? [] : [path.join(ROOT, 'core', 'main.cjs')], {
    env: { ...process.env, SLIMMANAGER_TEST: '1', SM_USERDATA: userData, SM_PORT: '0', SM_DIST: path.join(ROOT, 'dist'), LANG: lang === 'de' ? 'de_DE.UTF-8' : 'en_US.UTF-8' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const msgs = [];
  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      try {
        msgs.push(JSON.parse(buf.slice(0, i)));
      } catch {
        /* keine JSON-Zeile */
      }
      buf = buf.slice(i + 1);
    }
  });
  return { p, msgs };
}

/** Kleiner RPC-Client, um den Zustand des Kerns abzufragen (nur im Testmodus erlaubt) */
function coreClient(port, token) {
  const WebSocket = require('ws');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}&role=test`);
  let id = 0;
  const pending = new Map();
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.id !== undefined) pending.get(m.id)?.(m.r);
  });
  const open = new Promise((r) => ws.on('open', r));
  return {
    open,
    ws,
    call: (m, ...a) =>
      new Promise((r) => {
        const i = ++id;
        pending.set(i, r);
        ws.send(JSON.stringify({ id: i, m, a }));
      }),
  };
}

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'slimmanager-e2e-'));
  const lang = process.env.E2E_LANG || 'de';
  const core = startCore(userData, lang);
  await waitFor(() => core.msgs.some((m) => m.t === 'ready'), 15000, 'Kern bereit');
  const ready = core.msgs.find((m) => m.t === 'ready');
  const cc = coreClient(ready.port, ready.token);
  await cc.open;
  const st = () => cc.call('test:state');
  const page = (file, extra = '') => `file://${path.join(ROOT, 'dist', file)}?port=${ready.port}&token=${encodeURIComponent(ready.token)}${extra}`;
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(__dirname, 'harness.cjs'), '--no-sandbox', `--lang=${lang}`],
    env: { ...process.env, SM_E2E_URL: page('index.html') },
  });
  const win = await app.firstWindow();
  const errors = [];
  const watch = (p, name) => {
    p.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    p.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  };
  watch(win, 'app');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 860));
  const shot = async (page, name, ms = 400) => {
    await sleep(ms);
    await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  };

  try {
    // ---------------------------------------------------------------- Einführung
    await win.waitForSelector('[data-testid="onboarding"]');
    await win.click(`[data-testid="lang-${lang}"]`);
    await shot(win, '01-onb-language');
    await win.click('[data-testid="onb-next"]');
    await win.click('[data-testid="theme-dark"]');
    await win.click('[data-testid="onb-next"]');
    await win.click('[data-testid="onb-skin-neon"]');
    await shot(win, '02-onb-skin');
    await win.click('[data-testid="onb-next"]');
    await win.click('[data-testid="mode-expert"]');
    await win.click('[data-testid="onb-next"]');
    await shot(win, '03-onb-tour');
    await win.click('[data-testid="onb-next"]');

    // ---------------------------------------------------------------- Dashboard mit Live-Werten
    await win.waitForSelector('[data-testid="dashboard"]');
    await win.waitForFunction(() => /\d/.test(document.querySelector('[data-testid="widget-cpu"] .ring-val b')?.textContent || ''), null, { timeout: 15000 });
    await win.waitForFunction(() => document.querySelectorAll('[data-testid="widget-procs"] .tp-row').length > 0, null, { timeout: 15000 });
    await sleep(2500); // ein paar Messpunkte für die Diagramme
    assert.ok(JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).onboarded, 'Einführung gespeichert');
    await shot(win, '10-dashboard-neon');

    // ---------------------------------------------------------------- Kachel anklicken → Detail-Ansicht
    await win.click('[data-testid="widget-cpu"]');
    await win.waitForSelector('[data-testid="detail"]');
    await win.waitForSelector('[data-testid="detail-row"]', { timeout: 10000 });
    await shot(win, '27-detail-cpu', 800);
    await win.click('[data-testid="detail-close"]');
    await win.click('[data-testid="widget-ram"]');
    await win.waitForSelector('[data-testid="detail-row"]', { timeout: 10000 });
    await shot(win, '28-detail-ram', 600);
    // App in der Liste anklicken → Prozess-Ansicht, gleich gefiltert
    const appName = await win.locator('[data-testid="detail-row"] .ellipsis').first().evaluate((el) => el.firstChild.textContent.trim());
    await win.locator('[data-testid="detail-row"]').first().click();
    await win.waitForSelector('[data-testid="processes"]');
    assert.equal(await win.inputValue('[data-testid="procs-search"]'), appName, 'Prozess-Ansicht nach App gefiltert');
    await win.click('[data-testid="nav-dashboard"]');

    // ---------------------------------------------------------------- Editor: Widget hinzufügen und einstellen
    await win.click('[data-testid="edit-layout"]');
    await win.waitForSelector('[data-testid="edit-panel"]');
    const before = await win.locator('.grid > .card-w').count();
    await win.click('[data-testid="add-metric-netDown"]');
    await win.waitForSelector('[data-testid="widget-panel"]');
    assert.equal(await win.locator('.grid > .card-w').count(), before + 1, 'Widget hinzugefügt');
    await win.click('[data-testid="w-style-chart"]');
    await win.click('[data-testid="w-size-w"]');
    await win.fill('[data-testid="w-title"]', 'Internet');
    const lastWidget = () => {
      const l = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).layout.pc;
      return l[l.length - 1];
    };
    await waitFor(() => lastWidget().title === 'Internet' && lastWidget().size === 'w', 5000, 'Widget gespeichert');
    const added = lastWidget();
    assert.equal(added.metric, 'netDown');
    assert.equal(added.style, 'chart');
    assert.equal(added.size, 'w');
    assert.equal(added.title, 'Internet');
    await shot(win, '11-editor');

    // Drag & Drop: letztes Widget an den Anfang ziehen
    // (HTML5-Drag&Drop wird hier direkt als Ereignisse ausgelöst – so wie der Browser es bei der Maus tut)
    await win.evaluate(() => {
      const cards = [...document.querySelectorAll('.grid > .card-w')];
      const dt = new DataTransfer();
      const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      fire(cards[cards.length - 1], 'dragstart');
      fire(cards[0], 'dragover');
      fire(cards[0], 'drop');
      fire(cards[cards.length - 1], 'dragend');
    });
    await sleep(300);
    const afterDrag = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).layout.pc;
    assert.equal(afterDrag[0].title, 'Internet', 'Widget per Drag & Drop verschoben');

    // Handy-Layout im Editor
    await win.click('.view-head .seg button:nth-child(2)');
    await win.waitForSelector('.phone-frame');
    await shot(win, '12-editor-phone');
    await win.click('.view-head .seg button:nth-child(1)');

    // ---------------------------------------------------------------- Skins
    await win.click('[data-testid="panel-look"]');
    await win.waitForSelector('[data-testid="look-panel"]');
    await shot(win, '13-look-panel');
    for (const [skin, bg, name] of [
      ['classic', null, '14-skin-retro'],
      ['terminal', null, '15-skin-terminal'],
      ['glass', 'nebula', '16-skin-glass'],
      ['sunset', 'grid', '17-skin-sunset'],
      ['clean', 'none', '18-skin-clean'],
    ]) {
      await win.click(`[data-testid="skin-${skin}"]`);
      if (bg) await win.click(`[data-testid="bg-${bg}"]`);
      await win.click('[data-testid="edit-done"]');
      await win.waitForFunction((s) => document.querySelector('[data-testid="dashboard"]')?.getAttribute('data-skin') === s, skin);
      await shot(win, name, 700);
      await win.click('[data-testid="open-look"]');
    }
    await win.click('[data-testid="skin-neon"]');
    await win.click('[data-testid="bg-aurora"]');
    await win.click('[data-testid="rgb-switch"]');
    await win.click('[data-testid="edit-done"]');
    await shot(win, '19-skin-neon-rgb', 900);
    await win.click('[data-testid="open-look"]');
    await win.click('[data-testid="rgb-switch"]');
    await win.click('[data-testid="edit-done"]');

    // ---------------------------------------------------------------- Mini-Anzeige
    await win.click('[data-testid="overlay-toggle"]');
    await waitFor(async () => (await st()).overlay, 4000, 'Mini-Anzeige an');
    // Die Hülle bekommt den Auftrag, das Fenster zu öffnen – hier öffnen wir die Seite selbst
    assert.ok(core.msgs.some((m) => m.t === 'overlay' && m.on), 'Hülle soll Mini-Anzeige öffnen');
    await app.evaluate(({ BrowserWindow }, url) => {
      const b = new BrowserWindow({ width: 420, height: 60, title: 'overlay', show: true, transparent: true, frame: false });
      b.loadURL(url);
    }, page('overlay.html', '&corner=tr'));
    const ov = await app.waitForEvent('window', (p) => p.url().includes('overlay.html'));
    await ov.waitForFunction(() => document.querySelectorAll('#ov span').length >= 3, null, { timeout: 8000 });
    await ov.screenshot({ path: path.join(SHOTS, '25-overlay.png') });
    await ov.close();
    await win.click('[data-testid="overlay-toggle"]');
    await waitFor(async () => !(await st()).overlay, 4000, 'Mini-Anzeige aus');

    // ---------------------------------------------------------------- Prozesse
    const d1 = dummy('SlimTestDummy');
    const d2 = dummy('SlimTestGame');
    const d3 = dummy('SlimTestHelper');
    const d4 = dummy('SlimTestKeep');
    await win.click('[data-testid="nav-processes"]');
    await win.waitForSelector('[data-testid="proc-row"]');
    await sleep(2500);
    await shot(win, '20-processes');
    await win.fill('[data-testid="procs-search"]', 'SlimTestDummy');
    await win.waitForSelector('[data-testid="proc-row"][data-name="SlimTestDummy"]', { timeout: 10000 });
    await win.click('[data-testid="proc-row"][data-name="SlimTestDummy"]');
    await win.waitForSelector('[data-testid="action-bar"]');
    await win.selectOption('[data-testid="prio-select"]', 'below');
    await waitFor(() => prioOf(d1) >= 10, 4000, 'Priorität gesenkt');
    await shot(win, '21-process-actions');
    await win.click('[data-testid="bar-kill"]');
    await win.waitForSelector('[data-testid="kill-confirm"]');
    await shot(win, '22-kill-confirm');
    await win.click('[data-testid="kill-yes"]');
    await waitFor(() => !alive(d1), 4000, 'Prozess beendet');
    // Test-Spiel als Spiel markieren (eigene Spiele-Liste)
    await win.fill('[data-testid="procs-search"]', 'SlimTestGame');
    await win.click('[data-testid="proc-row"][data-name="SlimTestGame"]');
    await win.click('[data-testid="mark-game"]');
    await win.waitForSelector('[data-testid="proc-row"][data-name="SlimTestGame"] .kind-badge.k-game', { timeout: 6000 });
    await win.fill('[data-testid="procs-search"]', '');

    // Systemprozesse sind geschützt
    await win.click('[data-testid="filter-system"]');
    await sleep(300);
    assert.equal(await win.locator('[data-testid="proc-row"] [data-testid="kill-btn"]').count(), 0, 'Systemprozesse ohne Beenden-Knopf');
    await win.click('[data-testid="filter-all"]');

    // Aufräumen-Dialog
    await win.click('[data-testid="cleanup-open"]');
    await win.waitForSelector('[data-testid="cleanup-row"]');
    await shot(win, '23-cleanup');
    await win.keyboard.press('Escape');

    // ---------------------------------------------------------------- Boost: Gaming
    await win.click('[data-testid="nav-boost"]');
    await win.waitForSelector('[data-testid="boost-pick"] option[value="SlimTestGame"]', { state: 'attached', timeout: 10000 });
    // Ausnahme eintippen: SlimTestKeep darf nie angefasst werden
    await win.fill('[data-testid="exceptions"] input', 'SlimTestKeep');
    await win.press('[data-testid="exceptions"] input', 'Enter');
    await win.waitForSelector('[data-testid="exceptions"] .name-chip:has-text("SlimTestKeep")');
    // SlimTestHelper soll eingefroren werden (eigene Liste – automatisch friert SlimManager nur bekannten Ballast ein)
    await win.fill('[data-testid="freezelist"] input', 'SlimTestHelper');
    await win.press('[data-testid="freezelist"] input', 'Enter');
    await win.waitForSelector('[data-testid="freezelist"] .name-chip:has-text("SlimTestHelper")');
    await win.selectOption('[data-testid="boost-pick"]', 'SlimTestGame');
    await shot(win, '30-boost');
    await win.click('[data-testid="boost-start"]');
    await win.waitForSelector('[data-testid="boost-status"]');
    // Hintergrund-Programm (SlimTestHelper) wird eingefroren, die Ausnahme läuft weiter
    if (process.platform !== 'win32') {
      await waitFor(() => stopped(d3), 5000, 'Helfer eingefroren');
      assert.ok(!stopped(d4), 'Ausnahme darf nicht eingefroren werden');
      assert.ok(macPri(d4) > 20, 'Ausnahme darf nicht gebremst werden');
    }
    if (process.platform === 'win32') await waitFor(() => prioOf(d2) < 0, 5000, 'Spiel hochgestuft');
    await win.waitForSelector('[data-testid="effect-measure"]', { timeout: 15000 });
    await shot(win, '31-boost-active');
    await win.click('[data-testid="boost-stop"]');
    if (process.platform !== 'win32') await waitFor(() => !stopped(d3), 5000, 'Helfer aufgetaut');
    assert.equal(((await st()).boost).active, false);

    // ---------------------------------------------------------------- Fokus-Modus
    await win.click('[data-testid="mode-focus"]');
    await win.fill('[data-testid="freezelist"] input', 'SlimTestHelper');
    await win.press('[data-testid="freezelist"] input', 'Enter');
    await shot(win, '32-focus');
    await win.click('[data-testid="boost-start"]');
    await win.waitForSelector('[data-testid="boost-status"]');
    assert.equal(((await st()).boost).mode, 'focus');
    if (process.platform !== 'win32') await waitFor(() => stopped(d3), 5000, 'Fokus: Helfer eingefroren');
    await sleep(1500);
    await shot(win, '33-focus-active');
    await win.click('[data-testid="boost-stop"]');
    if (process.platform !== 'win32') await waitFor(() => !stopped(d3), 5000, 'Fokus: aufgetaut');
    await win.click('[data-testid="mode-game"]');

    // ---------------------------------------------------------------- Vollbild
    await win.click('[data-testid="nav-dashboard"]');
    await win.click('[data-testid="fs-btn"]');
    // Mehrere Bildschirme → Auswahl erscheint: den aktuellen nehmen
    if (await win.locator('.pop-menu').count()) await win.locator('.pop-menu button').filter({ hasText: /\(hier\)|\(here\)/ }).first().click();
    await win.waitForSelector('.shell.fs', { timeout: 8000 });
    assert.equal(await win.locator('.sidebar').count(), 0, 'im Vollbild keine Seitenleiste');
    await sleep(1500);
    await shot(win, '26-fullscreen', 600);
    await win.keyboard.press('Escape');
    await win.waitForSelector('.sidebar', { timeout: 6000 });
    await sleep(1200);

    // ---------------------------------------------------------------- Handy koppeln (QR-Code)
    await win.click('[data-testid="nav-phone"]');
    await win.waitForSelector('[data-testid="qr"] svg');
    await shot(win, '40-phone-connect');
    async function openPhone(url, w = 390, h = 844) {
      await app.evaluate(
        ({ BrowserWindow }, { url, w, h, ua }) => {
          const b = new BrowserWindow({ x: 0, y: 0, width: w, height: h, show: true, title: 'phone', webPreferences: { partition: 'phone-' + Math.random() } }); // eigenes Handy = eigener Speicher
          b.webContents.setUserAgent(ua);
          b.loadURL(url);
        },
        { url, w, h, ua: PHONE_UA },
      );
      const p = await app.waitForEvent('window', (x) => x.url().startsWith('http://127.0.0.1'));
      watch(p, 'phone');
      p.on('dialog', (d) => d.accept());
      return p;
    }
    const url1 = (await st()).url;
    assert.match(url1, /^http:\/\/127\.0\.0\.1:\d+\/#p=[\w-]{20,}$/);
    const phone = await openPhone(url1);
    await phone.waitForSelector('[data-testid="r-dashboard"]', { timeout: 10000 });
    assert.equal(await phone.evaluate(() => location.hash), '', 'Code muss aus der Adresszeile verschwinden');
    assert.ok(await phone.evaluate(() => !!localStorage.getItem('slimmanager.key')), 'Schlüssel gespeichert');
    await win.waitForSelector('[data-testid="client"]');
    await phone.waitForFunction(() => /\d/.test(document.querySelector('.ring-val b')?.textContent || ''), null, { timeout: 8000 });
    await sleep(1500);
    await shot(phone, '50-phone-dashboard');
    await shot(win, '41-phone-connected');

    // Handy: Kachel antippen → Details
    await phone.click('[data-testid="widget-cpu"]');
    await phone.waitForSelector('[data-testid="detail-row"]', { timeout: 10000 });
    await shot(phone, '56-phone-detail', 600);
    await phone.click('[data-testid="detail-close"]');

    // Handy: Dashboard bearbeiten (Größe ändern, Kachel hinzufügen) – wird am PC gespeichert
    const phoneLayout = () => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).layout.phone;
    await phone.click('[data-testid="r-menu"]');
    await phone.click('[data-testid="r-edit"]');
    await phone.waitForSelector('[data-testid="r-editbar"]');
    await phone.click('[data-testid="widget-cpu"]');
    await phone.waitForSelector('[data-testid="r-tilebar"]');
    await phone.click('[data-testid="r-size"]');
    await waitFor(() => phoneLayout()?.find((w) => w.id === 'cpu')?.size === 'w', 4000, 'Größe am PC gespeichert');
    await phone.click('[data-testid="r-add"]');
    await phone.click('[data-testid="r-add-gpuTemp"]');
    await waitFor(() => phoneLayout()?.some((w) => w.metric === 'gpuTemp' && w.id !== 'gt'), 4000, 'Kachel hinzugefügt');
    await phone.click('[data-testid="widget-cpu"]');
    await shot(phone, '57-phone-edit', 500);
    await phone.click('[data-testid="r-edit-done"]');
    await phone.waitForSelector('[data-testid="r-editbar"]', { state: 'detached' });

    // Handy: Prozesse + Steuern
    await phone.click('[data-testid="r-tab-procs"]');
    await phone.waitForSelector('[data-testid="r-proc"]', { timeout: 8000 });
    await shot(phone, '51-phone-processes');
    await phone.fill('.r-search', 'SlimTestHelper');
    await phone.click('[data-testid="r-proc"][data-name="SlimTestHelper"]');
    await shot(phone, '52-phone-process-sheet');
    await phone.click('[data-testid="r-kill"]');
    await waitFor(() => !alive(d3), 5000, 'Handy hat Prozess beendet');

    // Handy: Boost starten und beenden
    await phone.click('[data-testid="r-tab-boost"]');
    await phone.waitForSelector('[data-testid="r-boost"]');
    await phone.selectOption('.r-select', 'SlimTestGame');
    await phone.click('[data-testid="r-boost-start"]');
    await waitFor(async () => ((await st()).boost).active, 6000, 'Boost vom Handy');
    await phone.waitForSelector('[data-testid="r-boost-stop"]');
    await shot(phone, '53-phone-boost');
    await phone.click('[data-testid="r-boost-stop"]');
    await waitFor(async () => !((await st()).boost).active, 6000, 'Boost vom Handy beendet');

    // Tablet quer (Zweitbildschirm)
    await phone.click('[data-testid="r-tab-dash"]');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((b) => b.getTitle() === 'SlimManager' && b.webContents.getURL().startsWith('http'))?.setSize(1180, 820));
    await sleep(1200);
    await shot(phone, '54-tablet-dashboard');

    // ---------------------------------------------------------------- Zweites Gerät per PIN (mit Zustimmung am PC)
    const base = (await st()).base;
    const phone2 = await openPhone(base + '/');
    await phone2.waitForSelector('[data-testid="r-pin"]');
    await phone2.fill('[data-testid="r-pin"]', '000000');
    await phone2.click('[data-testid="r-pin-go"]');
    await phone2.waitForSelector('.r-err', { timeout: 6000 }); // falsche PIN
    const pin = (await st()).pin;
    await shot(phone2, '55-phone-pin');
    await phone2.fill('[data-testid="r-pin"]', pin);
    await phone2.click('[data-testid="r-pin-go"]');
    await win.waitForSelector('[data-testid="approval"]', { timeout: 6000 });
    await shot(win, '42-approval');
    await win.click('[data-testid="approval-allow"]');
    await phone2.waitForSelector('[data-testid="r-dashboard"]', { timeout: 8000 });
    await waitFor(async () => ((await st()).clients).length === 2, 4000, 'zwei Geräte');

    // Steuern ausschalten → Handy darf nur noch ansehen
    await win.click('[data-testid="allow-control"]');
    await phone2.click('[data-testid="r-tab-procs"]');
    await phone2.waitForSelector('.r-note', { timeout: 5000 });
    await win.click('[data-testid="allow-control"]');

    // ---------------------------------------------------------------- Einstellungen
    await win.click('[data-testid="open-settings"]');
    await win.waitForSelector('[data-testid="settings"]');
    await shot(win, '60-settings');
    await win.click('[data-testid="settings-overlay"]');
    await shot(win, '61-settings-overlay');
    await win.click('[data-testid="settings-about"]');
    await win.waitForSelector('[data-testid="website-link"]');
    await shot(win, '62-settings-about');
    await win.keyboard.press('Escape');

    assert.deepEqual(errors, [], 'Keine Fehler in der Konsole');
    console.log('✓ E2E-Test bestanden – Screenshots in', SHOTS);
  } catch (e) {
    await win.screenshot({ path: path.join(SHOTS, 'zz-fehler.png') }).catch(() => {});
    console.error('✗ E2E-Test fehlgeschlagen:', e);
    if (errors.length) console.error('Konsole:', errors);
    process.exitCode = 1;
  } finally {
    for (const p of dummies) if (alive(p)) p.kill();
    await app.close().catch(() => {});
    cc.ws.close();
    core.p.stdin.end(); // Hülle weg → Kern räumt auf und beendet sich
    await new Promise((r) => (core.p.exitCode !== null ? r() : core.p.on('exit', r)));
    fs.rmSync(dummyDir, { recursive: true, force: true });
  }
})();
