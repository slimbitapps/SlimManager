'use strict';
const {
  app, BrowserWindow, ipcMain, shell, nativeTheme, nativeImage, screen, clipboard, Menu, Tray, dialog, globalShortcut, Notification,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const QRCode = require('qrcode');
const { SettingsStore } = require('./core/settings.cjs');
const { Pairing } = require('./core/auth.cjs');
const { RemoteServer } = require('./core/server.cjs');
const { listAddresses, pickAddress } = require('./core/network.cjs');
const { Monitor } = require('./core/monitor.cjs');
const { normalize, group, isProtected, setPriority, killPids, LEVELS } = require('./core/procs.cjs');
const { Boost, detectGame } = require('./core/boost.cjs');
const { cleanLayout, cleanLook } = require('./core/layout.cjs');

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const isTest = !!process.env.SLIMMANAGER_TEST;
const isMac = process.platform === 'darwin';
if (process.env.SLIMMANAGER_USERDATA) app.setPath('userData', process.env.SLIMMANAGER_USERDATA);

const DIST = path.join(__dirname, '..', 'dist');
const HEADER_H = 52;
const THEMES = {
  dark: { bg: '#0d0e12', header: '#0d0e12', symbols: '#e9eaee' },
  light: { bg: '#f5f5f7', header: '#f5f5f7', symbols: '#1c1c1e' },
};
const BG_FILE = () => path.join(app.getPath('userData'), 'background.jpg');

// Einfaches Fehlerprotokoll (bleibt lokal) – hilft bei der Fehlersuche.
function log(...args) {
  try {
    const line = `[${new Date().toISOString()}] ${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
    fs.appendFileSync(path.join(app.getPath('userData'), 'app.log'), line);
  } catch {
    /* ignorieren */
  }
}
process.on('uncaughtException', (e) => log('uncaughtException', e));
process.on('unhandledRejection', (e) => log('unhandledRejection', e));

// Nur eine SlimManager-Instanz (sonst streiten sich zwei Server um den Port)
if (!isTest && !app.requestSingleInstanceLock()) app.quit();

const settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
const pairing = new Pairing({
  devices: settings.data.devices,
  onChange: (devices) => {
    settings.data.devices = devices;
    settings.save();
    pushInfo();
  },
});
const monitor = new Monitor();
const boost = new Boost();

let win = null;
let overlay = null;
let tray = null;
let server = null;
let addresses = [];
let quitting = false;
let procCache = { flat: [], groups: [], at: 0 };
let rendererWantsProcs = false;
const pendingApprovals = new Map();
const alertAt = {};

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
function isDark(theme) {
  return theme === 'dark' || (theme !== 'light' && nativeTheme.shouldUseDarkColors);
}

// Wenige Texte im Hauptprozess (Taskleisten-Menü, Mitteilungen)
const TXT = {
  de: {
    open: 'SlimManager öffnen', boostOn: 'Game Boost starten', boostOff: 'Game Boost beenden', overlay: 'Mini-Anzeige', quit: 'Beenden',
    noGame: 'Kein Spiel erkannt', noGameText: 'Starte zuerst ein Spiel oder wähle es in SlimManager unter „Game Boost“ aus.',
    boostStarted: 'Game Boost aktiv', boostStopped: 'Game Boost beendet', hot: 'Achtung: {what} ist hoch ({v})',
    cpuTemp: 'CPU-Temperatur', gpuTemp: 'GPU-Temperatur', ram: 'Arbeitsspeicher', exportTitle: 'Layout speichern', importTitle: 'Layout laden', image: 'Bild',
  },
  en: {
    open: 'Open SlimManager', boostOn: 'Start Game Boost', boostOff: 'Stop Game Boost', overlay: 'Mini overlay', quit: 'Quit',
    noGame: 'No game detected', noGameText: 'Start a game first or pick it in SlimManager under “Game Boost”.',
    boostStarted: 'Game Boost active', boostStopped: 'Game Boost stopped', hot: 'Warning: {what} is high ({v})',
    cpuTemp: 'CPU temperature', gpuTemp: 'GPU temperature', ram: 'Memory', exportTitle: 'Save layout', importTitle: 'Load layout', image: 'Image',
  },
};
const tx = (k, p = {}) => {
  const d = TXT[settings.data.prefs.lang === 'de' ? 'de' : settings.data.prefs.lang ? 'en' : app.getLocale().startsWith('de') ? 'de' : 'en'];
  return Object.entries(p).reduce((s, [a, b]) => s.split(`{${a}}`).join(String(b)), d[k] || k);
};

// ------------------------------------------------------------------ Hauptfenster
function createWindow() {
  const saved = settings.data.window || {};
  const { workAreaSize } = screen.getPrimaryDisplay();
  const colors = THEMES[isDark(settings.data.prefs.theme) ? 'dark' : 'light'];
  win = new BrowserWindow({
    width: Math.min(saved.width || 1280, workAreaSize.width),
    height: Math.min(saved.height || 820, workAreaSize.height),
    x: saved.x,
    y: saved.y,
    minWidth: 940,
    minHeight: 620,
    backgroundColor: colors.bg,
    title: 'SlimManager',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 18, y: 18 } }
      : { titleBarOverlay: { color: colors.header, symbolColor: colors.symbols, height: HEADER_H } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  const remember = () => {
    if (!win || win.isDestroyed() || win.isMaximized() || win.isMinimized()) return;
    settings.data.window = win.getBounds();
    settings.save();
  };
  win.on('resized', remember);
  win.on('moved', remember);
  win.on('close', (e) => {
    // "Im Hintergrund weiterlaufen": Fenster nur verstecken, Taskleisten-Symbol bleibt
    if (!quitting && settings.data.app.closeToTray && tray && !isTest) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    win = null;
    rendererWantsProcs = false;
    if ((!isMac && !settings.data.app.closeToTray) || isTest) app.quit();
  });
  // Links (z. B. zur Website) im normalen Browser öffnen, nie im App-Fenster
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  load(win, 'index.html');
}

function showWindow() {
  if (!win) createWindow();
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

function load(w, page, query) {
  if (isDev) {
    const u = new URL(page, process.env.VITE_DEV_SERVER_URL);
    for (const [k, v] of Object.entries(query || {})) u.searchParams.set(k, v);
    w.loadURL(u.toString());
  } else w.loadFile(path.join(DIST, page), { query });
}

// ------------------------------------------------------------------ Server & QR-Code
function remoteUrl() {
  const a = pickAddress(addresses, settings.data.network.address);
  const host = a ? a.address : '127.0.0.1';
  const base = `http://${host}:${server ? server.port : 0}`;
  return { url: `${base}/#p=${pairing.code}`, base, address: a };
}

async function info() {
  const { url, base, address } = remoteUrl();
  const qr = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
  return {
    url,
    base,
    qr,
    pin: pairing.freshPin(),
    address,
    addresses,
    port: server ? server.port : 0,
    clients: server ? server.clients() : [],
    devices: settings.public().devices,
    lastHit: server ? server.lastHit : 0,
  };
}

let pushPending = false;
function pushInfo() {
  if (pushPending) return;
  pushPending = true;
  setTimeout(async () => {
    pushPending = false;
    try {
      send('remote:update', await info());
    } catch (e) {
      log(e);
    }
  }, 30);
}

/** Was ein Handy zum Anzeigen braucht: Aussehen, Layout, Rechte, PC-Daten. */
function phoneConfig() {
  return {
    t: 'config',
    look: settings.data.look,
    layout: settings.data.layout.phone || settings.data.layout.pc,
    phoneLayout: !!settings.data.layout.phone,
    control: settings.data.remote.allowControl,
    overlay: settings.data.overlay.enabled,
    lang: settings.data.prefs.lang || 'en',
    sys: monitor.static,
  };
}
function broadcastConfig() {
  server?.broadcast(phoneConfig());
}

async function startServer() {
  server = new RemoteServer({
    root: DIST,
    pairing,
    port: Number(process.env.SLIMMANAGER_PORT ?? settings.data.network.port) || 0,
    allowAnyIp: false,
    needsApproval: () => settings.data.remote.approveNew,
  });
  server.on('code', pushInfo);
  server.on('clients', pushInfo);
  server.on('subs', updateProcWanted);
  server.on('joined', (deviceId) => {
    server.sendTo(deviceId, phoneConfig());
    server.sendTo(deviceId, { t: 'history', h: monitor.historyOf(120) });
    if (monitor.snap) server.sendTo(deviceId, { t: 'stats', s: monitor.snap });
    server.sendTo(deviceId, { t: 'boost', b: boostState() });
    const bg = readBackground();
    if (bg && settings.data.look.bg === 'image') server.sendTo(deviceId, { t: 'bg', img: bg });
  });
  server.on('approval', (req) => {
    pendingApprovals.set(req.id, req);
    send('approval', req);
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.flashFrame(true);
    }
  });
  server.on('approval-done', (id) => {
    pendingApprovals.delete(id);
    send('approval-done', id);
  });
  server.on('command', onPhoneCommand);
  await server.start();
  log('server on port', server.port);
}

function refreshAddresses() {
  const next = listAddresses();
  if (JSON.stringify(next) !== JSON.stringify(addresses)) {
    addresses = next;
    pushInfo();
  }
}

// ------------------------------------------------------------------ Befehle vom Handy
function onPhoneCommand({ c, a, name, reply }) {
  if (c === 'history') return reply({ t: 'history', h: monitor.historyOf(120) });
  // Alles Weitere verändert den PC → nur, wenn "Handy darf steuern" an ist
  if (!settings.data.remote.allowControl) return reply({ t: 'result', ok: false, error: 'no-control' });
  const arg = a && typeof a === 'object' ? a : {};
  let res = { ok: false, error: 'bad' };
  if (c === 'kill') res = killGroup(String(arg.id || ''));
  else if (c === 'prio') res = prioGroup(String(arg.id || ''), String(arg.level || ''));
  else if (c === 'boost') res = startBoost(String(arg.app || ''), false);
  else if (c === 'unboost') res = stopBoost();
  else if (c === 'overlay') {
    setOverlay(!!arg.on);
    res = { ok: true };
  }
  log('phone', name, c, JSON.stringify(a), JSON.stringify(res));
  send('phone-action', { name, c, a, ok: res.ok, at: Date.now() });
  reply({ t: 'result', c, ok: !!res.ok, error: res.error || null });
}

// ------------------------------------------------------------------ Prozesse
function selfPids() {
  try {
    return [process.pid, ...app.getAppMetrics().map((m) => m.pid)];
  } catch {
    return [process.pid];
  }
}

function onProcs(list) {
  const flat = normalize(list, { cores: monitor.static?.cores || os.cpus().length, selfPids: selfPids(), games: settings.data.boost.games });
  const groups = group(flat).sort((x, y) => y.cpu - x.cpu || y.mem - x.mem);
  procCache = { flat, groups, at: Date.now() };
  if (rendererWantsProcs) send('procs', procCache);
  if (server && server.subscribers('procs')) server.broadcast({ t: 'procs', p: phoneGroups(groups) }, 'procs');
  boost.follow(flat);
  autoBoost(groups);
  send('game', detectGame(groups));
}

/** Für das Handy: nur das Nötigste – alle Apps/Spiele/Hintergrund, vom System nur die 30 aktivsten. */
function phoneGroups(groups) {
  const sys = groups.filter((g) => g.kind === 'system' || g.kind === 'self').slice(0, 30);
  const rest = groups.filter((g) => g.kind !== 'system' && g.kind !== 'self').slice(0, 150);
  return [...rest, ...sys].map((g) => ({ id: g.id, name: g.name, cpu: g.cpu, mem: g.mem, count: g.count, kind: g.kind, prio: g.prio }));
}

function updateProcWanted() {
  const want = rendererWantsProcs || (server ? server.subscribers('procs') : 0) > 0 || settings.data.boost.auto || boost.active;
  monitor.setWanted(want);
}

function findGroup(id) {
  return procCache.groups.find((g) => g.id === id) || null;
}

/** Eine App (alle ihre Prozesse) beenden – geschützte Prozesse bleiben unangetastet. */
function killGroup(id) {
  const g = findGroup(id);
  if (!g) return { ok: false, error: 'gone' };
  const pids = procCache.flat.filter((p) => g.pids.includes(p.pid) && !isProtected(p)).map((p) => p.pid);
  if (!pids.length) return { ok: false, error: 'protected' };
  const r = killPids(pids);
  setTimeout(() => monitor.procTick(true), 400);
  return { ok: r.ok > 0, error: r.ok ? undefined : r.error || 'failed' };
}

function killPid(pid) {
  const p = procCache.flat.find((x) => x.pid === pid);
  if (!p) return { ok: false, error: 'gone' };
  if (isProtected(p)) return { ok: false, error: 'protected' };
  const r = killPids([pid]);
  setTimeout(() => monitor.procTick(true), 400);
  return { ok: r.ok > 0, error: r.error };
}

function prioPids(pids, level) {
  if (!LEVELS.includes(level)) return { ok: false, error: 'bad-level' };
  let ok = 0;
  let error;
  for (const pid of pids) {
    const p = procCache.flat.find((x) => x.pid === pid);
    if (!p || isProtected(p)) continue;
    const r = setPriority(pid, level);
    if (r.ok) ok++;
    else error = r.error;
  }
  setTimeout(() => monitor.procTick(true), 300);
  return { ok: ok > 0, error: ok ? undefined : error || 'protected' };
}
function prioGroup(id, level) {
  const g = findGroup(id);
  return g ? prioPids(g.pids, level) : { ok: false, error: 'gone' };
}

// ------------------------------------------------------------------ Game Boost
function boostState() {
  return boost.state();
}
function startBoost(appName, auto) {
  if (!appName) return { ok: false, error: 'no-game' };
  const st = boost.start(procCache.flat, {
    targetApp: appName,
    lowerOthers: settings.data.boost.lowerOthers,
    raiseGame: settings.data.boost.raiseGame,
    closeList: settings.data.boost.closeList,
    auto,
  });
  updateProcWanted();
  setTimeout(() => monitor.procTick(true), 500);
  return { ok: true, state: st };
}
function stopBoost() {
  const s = boost.stop();
  updateProcWanted();
  setTimeout(() => monitor.procTick(true), 500);
  return { ok: !!s, summary: s };
}
function toggleBoost() {
  if (boost.active) return stopBoost();
  const game = detectGame(procCache.groups);
  if (!game) {
    notify(tx('noGame'), tx('noGameText'));
    showWindow();
    send('navigate', 'boost');
    return { ok: false, error: 'no-game' };
  }
  return startBoost(game, false);
}

/** Automatischer Boost: Spiel startet → Boost an, Spiel beendet → Boost aus. */
function autoBoost(groups) {
  const running = detectGame(groups);
  if (autoBoost.lastStopped && !groups.some((g) => g.name === autoBoost.lastStopped)) autoBoost.lastStopped = null;
  if (boost.active) {
    const still = groups.some((g) => g.name.toLowerCase() === boost.session.app.toLowerCase());
    if (!still) stopBoost();
    return;
  }
  if (settings.data.boost.auto && running && autoBoost.lastStopped !== running) startBoost(running, true);
}

boost.on('change', (st) => {
  send('boost', st);
  server?.broadcast({ t: 'boost', b: st });
  buildTrayMenu();
  if (st.active) notify(tx('boostStarted'), st.app);
});
boost.on('summary', (sum) => {
  // Nach manuellem Beenden nicht sofort wieder automatisch starten
  if (!sum.auto) autoBoost.lastStopped = sum.app;
  send('boost-summary', sum);
  server?.broadcast({ t: 'boost-summary', s: sum });
});

// ------------------------------------------------------------------ Mini-Anzeige (immer im Vordergrund)
function overlayBounds(w = 220, h = 40) {
  const d = screen.getPrimaryDisplay().workArea;
  const m = 12;
  const c = settings.data.overlay.corner;
  return {
    x: Math.round(c.endsWith('l') ? d.x + m : d.x + d.width - w - m),
    y: Math.round(c.startsWith('t') ? d.y + m : d.y + d.height - h - m),
    width: Math.round(w),
    height: Math.round(h),
  };
}
function setOverlay(on) {
  settings.update({ overlay: { enabled: on } });
  send('settings', settings.public());
  broadcastConfig();
  if (!on) {
    if (overlay && !overlay.isDestroyed()) overlay.close();
    overlay = null;
  } else if (!overlay || overlay.isDestroyed()) {
    overlay = new BrowserWindow({
      ...overlayBounds(),
      transparent: true,
      frame: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      fullscreenable: false,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
    });
    overlay.setIgnoreMouseEvents(true);
    overlay.setAlwaysOnTop(true, 'screen-saver');
    if (isMac) overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.on('closed', () => (overlay = null));
    overlay.once('ready-to-show', () => overlay?.showInactive());
    load(overlay, 'overlay.html');
  }
  buildTrayMenu();
}

// ------------------------------------------------------------------ Taskleisten-Symbol
function trayIcon() {
  const img = nativeImage.createFromPath(path.join(DIST, 'icon.png'));
  return img.isEmpty() ? img : img.resize({ width: isMac ? 18 : 16, height: isMac ? 18 : 16, quality: 'best' });
}
function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: tx('open'), click: showWindow },
      { type: 'separator' },
      { label: boost.active ? tx('boostOff') : tx('boostOn'), click: toggleBoost },
      { label: tx('overlay'), type: 'checkbox', checked: settings.data.overlay.enabled, click: (i) => setOverlay(i.checked) },
      { type: 'separator' },
      { label: tx('quit'), click: () => ((quitting = true), app.quit()) },
    ]),
  );
}
function createTray() {
  if (isTest) return;
  try {
    tray = new Tray(trayIcon());
    tray.setToolTip('SlimManager');
    tray.on('click', () => (isMac ? tray.popUpContextMenu() : showWindow()));
    buildTrayMenu();
  } catch (e) {
    log('tray', e);
  }
}

// ------------------------------------------------------------------ Warnungen & Mitteilungen
function notify(title, body) {
  if (isTest || !Notification.isSupported()) return;
  try {
    new Notification({ title, body, silent: true }).show();
  } catch {
    /* egal */
  }
}
function checkAlerts(s) {
  const a = settings.data.alerts;
  if (!a.enabled) return;
  const check = (key, value, limit, unit) => {
    if (value === null || value < limit) return;
    if (Date.now() - (alertAt[key] || 0) < 5 * 60_000) return; // höchstens alle 5 Minuten
    alertAt[key] = Date.now();
    notify('SlimManager', tx('hot', { what: tx(key), v: Math.round(value) + unit }));
  };
  check('cpuTemp', s.cpuTemp, a.cpuTemp, ' °C');
  check('gpuTemp', s.gpuTemp, a.gpuTemp, ' °C');
  check('ram', s.ram, a.ram, ' %');
}

// ------------------------------------------------------------------ Hintergrundbild
function readBackground() {
  try {
    return 'data:image/jpeg;base64,' + fs.readFileSync(BG_FILE()).toString('base64');
  } catch {
    return null;
  }
}
async function pickBackground() {
  const r = await dialog.showOpenDialog(win, { title: tx('image'), properties: ['openFile'], filters: [{ name: tx('image'), extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  let img = nativeImage.createFromPath(r.filePaths[0]);
  if (img.isEmpty()) return null;
  // Auf höchstens 2560 px verkleinern – spart Speicher und lädt schnell aufs Handy
  const { width } = img.getSize();
  if (width > 2560) img = img.resize({ width: 2560, quality: 'best' });
  fs.writeFileSync(BG_FILE(), img.toJPEG(84));
  settings.update({ look: { bg: 'image', bgImage: true } });
  const data = readBackground();
  server?.broadcast({ t: 'bg', img: data });
  broadcastConfig();
  return { settings: settings.public(), img: data };
}

// ------------------------------------------------------------------ IPC
const handle = (ch, fn) =>
  ipcMain.handle(ch, async (_e, ...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      log('ipc', ch, e);
      throw e;
    }
  });

handle('settings:get', () => settings.public());
handle('settings:set', async (partial) => {
  const before = JSON.stringify(settings.data.network);
  const lookBefore = JSON.stringify([settings.data.look, settings.data.layout, settings.data.remote.allowControl, settings.data.prefs.lang]);
  settings.update(partial);
  if (JSON.stringify([settings.data.look, settings.data.layout, settings.data.remote.allowControl, settings.data.prefs.lang]) !== lookBefore) broadcastConfig();
  if (partial && partial.overlay) {
    if (partial.overlay.enabled !== undefined) setOverlay(settings.data.overlay.enabled);
    else if (overlay && !overlay.isDestroyed()) overlay.webContents.send('overlay:config', settings.data.overlay);
    registerHotkeys();
  }
  if (partial && partial.boost) {
    registerHotkeys();
    updateProcWanted();
  }
  if (partial && partial.prefs) buildTrayMenu();
  if (JSON.stringify(settings.data.network) !== before) {
    if (partial.network && partial.network.port !== undefined && server) {
      await server.stop();
      await startServer();
    }
    pushInfo();
  }
  return settings.public();
});
handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  platform: process.platform,
  locale: app.getLocale(),
}));
handle('sys:static', () => monitor.static);
handle('stats:get', () => ({ snap: monitor.snap, history: monitor.historyOf(300) }));
handle('procs:watch', (on) => {
  rendererWantsProcs = !!on;
  updateProcWanted();
  return procCache;
});
handle('procs:kill', (id) => killGroup(String(id)));
handle('procs:killPid', (pid) => killPid(Number(pid)));
handle('procs:prio', (id, level) => prioGroup(String(id), String(level)));
handle('procs:prioPid', (pid, level) => prioPids([Number(pid)], String(level)));
handle('procs:reveal', (p) => {
  if (typeof p === 'string' && p && fs.existsSync(p)) shell.showItemInFolder(p);
});
const iconCache = new Map();
handle('icon:get', async (p) => {
  if (typeof p !== 'string' || !p) return null;
  // Mac: Symbol des .app-Pakets, Windows: Symbol der .exe (Pfad kommt schon passend aus procs.cjs)
  const target = p;
  if (iconCache.has(target)) return iconCache.get(target);
  let url = null;
  try {
    if (fs.existsSync(target)) url = (await app.getFileIcon(target, { size: 'normal' })).toDataURL();
  } catch {
    /* kein Symbol */
  }
  if (iconCache.size > 400) iconCache.clear();
  iconCache.set(target, url);
  return url;
});
handle('boost:get', () => boostState());
handle('boost:start', (appName) => startBoost(String(appName || ''), false));
handle('boost:stop', () => stopBoost());
handle('game:get', () => detectGame(procCache.groups));
handle('overlay:set', (on) => setOverlay(!!on));
handle('overlay:size', (w, h) => {
  if (overlay && !overlay.isDestroyed()) overlay.setBounds(overlayBounds(Math.min(900, Number(w) || 220), Math.min(300, Number(h) || 40)));
});
handle('overlay:config', () => settings.data.overlay);
handle('look:pickImage', () => pickBackground());
handle('look:getImage', () => readBackground());
handle('look:removeImage', () => {
  try {
    fs.rmSync(BG_FILE(), { force: true });
  } catch {
    /* egal */
  }
  settings.update({ look: { bgImage: false, bg: settings.data.look.bg === 'image' ? 'aurora' : settings.data.look.bg } });
  broadcastConfig();
  return settings.public();
});
handle('layout:export', async () => {
  const r = await dialog.showSaveDialog(win, { title: tx('exportTitle'), defaultPath: 'SlimManager-Layout.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return false;
  const data = { app: 'SlimManager', version: 1, look: { ...settings.data.look, bgImage: false, bg: settings.data.look.bg === 'image' ? 'aurora' : settings.data.look.bg }, layout: settings.data.layout };
  fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2));
  return true;
});
handle('layout:import', async () => {
  const r = await dialog.showOpenDialog(win, { title: tx('importTitle'), properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
  } catch {
    return { error: 'bad-file' };
  }
  if (!data || data.app !== 'SlimManager') return { error: 'bad-file' };
  const look = cleanLook({ ...data.look, bgImage: settings.data.look.bgImage }, settings.data.look);
  if (look.bg === 'image' && !settings.data.look.bgImage) look.bg = 'aurora';
  settings.update({ look, layout: { pc: cleanLayout(data.layout?.pc), phone: cleanLayout(data.layout?.phone) } });
  broadcastConfig();
  return { settings: settings.public() };
});
handle('remote:info', () => info());
handle('remote:newCode', () => {
  pairing.rotate();
  pushInfo();
});
handle('remote:disconnect', (id) => server?.disconnect(String(id)));
handle('devices:remove', (id) => {
  server?.disconnect(String(id));
  pairing.remove(String(id));
});
handle('devices:removeAll', () => {
  for (const d of pairing.devices) server?.disconnect(d.id);
  pairing.removeAll();
});
handle('approval:answer', (id, ok) => server?.answerApproval(String(id), !!ok));
handle('approval:pending', () => [...pendingApprovals.values()]);
handle('shell:openExternal', (url) => {
  if (typeof url === 'string' && /^https:\/\/|^mailto:/.test(url)) shell.openExternal(url);
});
handle('clipboard:write', (text) => clipboard.writeText(String(text)));
handle('win:theme', (theme) => {
  if (!win || win.isDestroyed() || isMac) return;
  const c = THEMES[isDark(theme) ? 'dark' : 'light'];
  win.setBackgroundColor(c.bg);
  try {
    win.setTitleBarOverlay({ color: c.header, symbolColor: c.symbols, height: HEADER_H });
  } catch {
    /* ältere Systeme */
  }
});
handle('app:log', (...a) => log('renderer', ...a));

// ------------------------------------------------------------------ Tastenkürzel (auch im Spiel)
function registerHotkeys() {
  if (isTest) return;
  globalShortcut.unregisterAll();
  try {
    if (settings.data.boost.hotkey) globalShortcut.register('CommandOrControl+Shift+B', toggleBoost);
    if (settings.data.overlay.hotkey) globalShortcut.register('CommandOrControl+Shift+O', () => setOverlay(!settings.data.overlay.enabled));
  } catch (e) {
    log('hotkeys', e);
  }
}

// Test-Zugriff für den End-to-End-Test
if (isTest) {
  global.__slimmanager = {
    url: () => remoteUrl().url.replace(/\/\/[^/:]+:/, '//127.0.0.1:'),
    base: () => remoteUrl().base.replace(/\/\/[^/:]+:/, '//127.0.0.1:'),
    code: () => pairing.code,
    pin: () => pairing.freshPin(),
    clients: () => (server ? server.clients() : []),
    boost: () => boost.state(),
    groups: () => procCache.groups.map((g) => ({ id: g.id, name: g.name, kind: g.kind, pids: g.pids, prio: g.prio })),
    overlay: () => !!(overlay && !overlay.isDestroyed()),
  };
}

// ------------------------------------------------------------------ Start
app.whenReady().then(async () => {
  if (isMac && !isTest) Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  else Menu.setApplicationMenu(null);
  addresses = listAddresses();
  monitor.on('stats', (s) => {
    send('stats', s);
    if (server && server.clients().length) server.broadcast({ t: 'stats', s });
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send('stats', s);
    boost.record(s);
    checkAlerts(s);
    if (tray && s.t % 5000 < 1000) tray.setToolTip(`SlimManager · CPU ${s.cpu ?? '–'} % · RAM ${s.ram ?? '–'} %`);
  });
  monitor.on('procs', onProcs);
  try {
    await startServer();
  } catch (e) {
    log('server start failed', e);
  }
  createWindow();
  monitor.start().catch((e) => log('monitor', e));
  createTray();
  registerHotkeys();
  if (settings.data.overlay.enabled) setOverlay(true);
  updateProcWanted();
  setInterval(refreshAddresses, 4000); // WLAN gewechselt / Hotspot an → QR-Code passt sich an
  setInterval(() => {
    // PIN läuft ab → neue PIN anzeigen
    const before = pairing.pin;
    if (pairing.freshPin() !== before) pushInfo();
  }, 10_000);
});

app.on('second-instance', showWindow);
app.on('activate', showWindow);
app.on('window-all-closed', () => {
  if ((!isMac && !settings.data.app.closeToTray) || isTest) app.quit();
});
app.on('before-quit', () => {
  quitting = true;
  // Prioritäten zurücksetzen, bevor die App endet
  if (boost.active) boost.stop();
  globalShortcut.unregisterAll();
  monitor.stop();
  server?.stop();
});
