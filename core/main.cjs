'use strict';
/**
 * SlimManager-Kern (läuft als eigener Prozess neben der Tauri-Oberfläche).
 * Hier steckt alles, was SlimManager kann: Messwerte, Prozesse, Boost, Handy-Server, Einstellungen.
 *
 * Verbindungen:
 *  - Oberfläche & Mini-Anzeige → WebSocket auf 127.0.0.1 (nur dieser PC) mit geheimem Token ("RPC")
 *  - Tauri-Hülle ↔ Kern → Textzeilen (JSON) über stdout/stdin: Taskleiste, Tastenkürzel, Mitteilungen, Mini-Anzeige
 *  - Handys/Tablets → der bekannte Handy-Server (server.cjs) im WLAN
 *
 * Umgebung: SM_USERDATA (Ordner für Einstellungen), SM_DIST (Ordner mit der Handy-Seite), SM_PORT (Handy-Port, Test)
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
// Feste Pfade (damit alles in EIN Programm gepackt werden kann)
const { SettingsStore } = require('../electron/core/settings.cjs');
const { Pairing } = require('../electron/core/auth.cjs');
const { RemoteServer } = require('../electron/core/server.cjs');
const { listAddresses, pickAddress } = require('../electron/core/network.cjs');
const { Monitor } = require('../electron/core/monitor.cjs');
const { normalize, group, isProtected, setPriority, killPids, LEVELS } = require('../electron/core/procs.cjs');
const { Boost, detectGame } = require('../electron/core/boost.cjs');
const { Tweaks } = require('../electron/core/tweaks.cjs');
const { cleanLayout, cleanLook } = require('../electron/core/layout.cjs');
const { appIcon } = require('./icons.cjs');

// Wächter-Modus: dieselbe Datei/Programm, nur mit anderer Aufgabe (siehe tweaks.cjs)
if (process.argv.includes('--watchdog')) {
  require('../electron/core/watchdog.cjs');
  return;
}

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const isTest = !!process.env.SLIMMANAGER_TEST;
const VERSION = require('../package.json').version;
const USERDATA = process.env.SM_USERDATA || (isWin ? path.join(process.env.APPDATA || os.homedir(), 'SlimManager') : isMac ? path.join(os.homedir(), 'Library', 'Application Support', 'SlimManager') : path.join(os.homedir(), '.config', 'SlimManager'));
const DIST = process.env.SM_DIST || path.join(__dirname, '..', 'dist');
fs.mkdirSync(USERDATA, { recursive: true });
const BG_FILE = path.join(USERDATA, 'background.jpg');

// Einfaches Fehlerprotokoll (bleibt lokal) – hilft bei der Fehlersuche.
function log(...args) {
  try {
    const line = `[${new Date().toISOString()}] ${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
    fs.appendFileSync(path.join(USERDATA, 'core.log'), line);
  } catch {
    /* ignorieren */
  }
}
process.on('uncaughtException', (e) => log('uncaughtException', e));
process.on('unhandledRejection', (e) => log('unhandledRejection', e));

const settings = new SettingsStore(path.join(USERDATA, 'settings.json'));
const pairing = new Pairing({
  devices: settings.data.devices,
  onChange: (devices) => {
    settings.data.devices = devices;
    settings.save();
    pushInfo();
  },
});
const monitor = new Monitor();
const tweaks = new Tweaks({ dir: USERDATA, log: (...a) => log('tweaks', ...a) });
const boost = new Boost({ tweaks });

let server = null;
let addresses = [];
let procCache = { flat: [], groups: [], at: 0 };
const pendingApprovals = new Map();
const alertAt = {};

// ------------------------------------------------------------------ Kanal zur Tauri-Hülle (stdout/stdin)
/** Nachricht an die Hülle (eine JSON-Zeile auf stdout) */
function shell(msg) {
  try {
    process.stdout.write(JSON.stringify(msg) + '\n');
  } catch {
    /* Hülle weg */
  }
}
let inBuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  inBuf += d;
  let i;
  while ((i = inBuf.indexOf('\n')) >= 0) {
    const line = inBuf.slice(0, i).trim();
    inBuf = inBuf.slice(i + 1);
    if (!line) continue;
    try {
      onShell(JSON.parse(line));
    } catch (e) {
      log('shell', e);
    }
  }
});
// Hülle beendet (oder abgestürzt) → aufräumen und beenden
process.stdin.on('end', () => quit());

function onShell(m) {
  if (m.t === 'hotkey' && m.k === 'boost') toggleBoost();
  else if (m.t === 'hotkey' && m.k === 'overlay') setOverlay(!settings.data.overlay.enabled);
  else if (m.t === 'tray' && m.k === 'boost') toggleBoost();
  else if (m.t === 'tray' && m.k === 'overlay') setOverlay(!settings.data.overlay.enabled);
  else if (m.t === 'quit') quit();
  else if (m.t === 'notify-click' && m.action === 'process') send('show-process', m.arg);
}

// ------------------------------------------------------------------ Oberfläche (RPC über WebSocket, nur 127.0.0.1)
const TOKEN = process.env.SM_TOKEN || crypto.randomBytes(24).toString('base64url');
/** Verbundene Oberflächen: role = 'main' (Hauptfenster) oder 'overlay' (Mini-Anzeige) */
const uis = new Set();
/** Zustand des Hauptfensters (meldet die Oberfläche selbst) */
let ui = { visible: false, focused: false, fullscreen: false };
/** Wer die Prozessliste braucht: fast = Prozesse/Boost/Detail-Ansicht, medium = nur Top-Prozesse-Kachel */
const rendererWatch = { fast: 0, medium: 0 };
const rendererWants = () => rendererWatch.fast > 0 || rendererWatch.medium > 0;

function send(channel, payload, role = 'main') {
  const s = JSON.stringify({ ev: channel, p: payload });
  for (const c of uis) if (c.role === role && c.ws.readyState === c.ws.OPEN) c.ws.send(s);
}
const mainOpen = () => [...uis].some((c) => c.role === 'main');
const overlayOpen = () => [...uis].some((c) => c.role === 'overlay') || settings.data.overlay.enabled;
/** Ist das Hauptfenster gerade zu sehen? Sonst bekommt es keine Live-Daten (nichts wird umsonst gezeichnet). */
const winVisible = () => mainOpen() && ui.visible;

function startRpc() {
  return new Promise((resolve) => {
    const httpServer = http.createServer((_req, res) => res.writeHead(404).end());
    const wss = new WebSocketServer({ server: httpServer, maxPayload: 8 * 1024 * 1024 });
    wss.on('connection', (ws, req) => {
      const url = new URL(req.url || '/', 'http://x');
      // Nur mit Token und nur von diesem PC
      const ip = String(req.socket.remoteAddress || '');
      if (url.searchParams.get('token') !== TOKEN || !/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ip)) return ws.close(4003);
      const c = { ws, role: url.searchParams.get('role') === 'overlay' ? 'overlay' : 'main', watch: { fast: 0, medium: 0 } };
      uis.add(c);
      ws.on('message', async (d) => {
        let m;
        try {
          m = JSON.parse(String(d));
        } catch {
          return;
        }
        const fn = RPC[m.m];
        let res;
        let err = null;
        try {
          if (!fn) throw new Error('unknown ' + m.m);
          res = await fn(...(Array.isArray(m.a) ? m.a : []), c);
        } catch (e) {
          err = String(e && e.message ? e.message : e);
          log('rpc', m.m, e);
        }
        if (m.id !== undefined && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ id: m.id, r: res === undefined ? null : res, e: err }));
      });
      ws.on('close', () => {
        uis.delete(c);
        rendererWatch.fast -= c.watch.fast;
        rendererWatch.medium -= c.watch.medium;
        if (c.role === 'main' && !mainOpen()) ui = { visible: false, focused: false, fullscreen: false };
        updateLive();
        updateProcWanted();
      });
      if (c.role === 'main') syncWindow();
    });
    httpServer.listen(Number(process.env.SM_RPC_PORT) || 0, '127.0.0.1', () => resolve(httpServer.address().port));
  });
}

/** Fenster wieder sichtbar → Verlauf und aktuelle Werte einmal nachliefern */
function syncWindow() {
  updateLive();
  updateProcWanted();
  if (!winVisible()) return;
  send('sync', { snap: monitor.snap, history: monitor.historyOf(300) });
  if (rendererWants() && procCache.at) send('procs', procCache);
}

/**
 * Wie lebendig soll die Anzeige sein?
 *  - "lebendig" (gewählte Rate, Zähl-Animation): Fenster vorne – oder Vollbild/Handy, solange kein Spiel läuft
 *  - Sparmodus (1 s, keine Animation): Spiel läuft oder Boost aktiv und SlimManager nicht im Vordergrund
 *  - Ruhe (5 s): niemand schaut zu
 */
let lastGame = null;
let lively = null;
function updateLive() {
  const visible = winVisible();
  const phones = server ? server.clients().length : 0;
  const gaming = boost.active || !!lastGame;
  const focused = visible && ui.focused;
  const watching = (visible && ui.fullscreen) || phones > 0;
  const on = focused || (watching && !gaming) || ((visible || phones > 0) && settings.data.app.liveInGame);
  const live = visible || phones > 0 || overlayOpen();
  monitor.setLive(live, on ? settings.data.app.rate : 1000);
  if (on !== lively) {
    lively = on;
    send('lively', on);
    server?.broadcast({ t: 'lively', on });
  }
}

// Wenige Texte im Kern (Taskleisten-Menü, Mitteilungen)
const TXT = {
  de: {
    open: 'SlimManager öffnen', boostOn: 'Game Boost starten', boostOff: 'Boost beenden', overlay: 'Mini-Anzeige', quit: 'Beenden',
    noGame: 'Kein Spiel erkannt', noGameText: 'Starte zuerst ein Spiel oder wähle es in SlimManager unter „Boost“ aus.',
    focusStarted: 'Fokus-Modus aktiv', boostStarted: 'Game Boost aktiv', hot: 'Achtung: {what} ist hoch ({v})',
    cpuTemp: 'CPU-Temperatur', gpuTemp: 'GPU-Temperatur', ram: 'Arbeitsspeicher',
    hogTitle: 'Eine App braucht viel Leistung', hogText: '„{name}“ braucht seit {m} Min. {v} % der CPU.',
  },
  en: {
    open: 'Open SlimManager', boostOn: 'Start Game Boost', boostOff: 'Stop boost', overlay: 'Mini overlay', quit: 'Quit',
    noGame: 'No game detected', noGameText: 'Start a game first or pick it in SlimManager under “Boost”.',
    focusStarted: 'Focus mode active', boostStarted: 'Game Boost active', hot: 'Warning: {what} is high ({v})',
    cpuTemp: 'CPU temperature', gpuTemp: 'GPU temperature', ram: 'Memory',
    hogTitle: 'An app is using a lot of power', hogText: '“{name}” has been using {v}% CPU for {m} min.',
  },
};
const sysLang = () => (Intl.DateTimeFormat().resolvedOptions().locale || 'en').slice(0, 2);
const tx = (k, p = {}) => {
  const l = settings.data.prefs.lang || (sysLang() === 'de' ? 'de' : 'en');
  return Object.entries(p).reduce((s, [a, b]) => s.split(`{${a}}`).join(String(b)), TXT[l === 'de' ? 'de' : 'en'][k] || k);
};

/** Taskleisten-Menü (Texte + Häkchen) an die Hülle melden */
function updateTray() {
  shell({ t: 'tray', labels: { open: tx('open'), boost: boost.active ? tx('boostOff') : tx('boostOn'), overlay: tx('overlay'), quit: tx('quit') }, overlay: settings.data.overlay.enabled, closeToTray: !!settings.data.app.closeToTray });
}
function notify(title, body, action, arg) {
  if (isTest) return;
  shell({ t: 'notify', title, body, action, arg });
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
  return { url, base, qr, pin: pairing.freshPin(), address, addresses, port: server ? server.port : 0, clients: server ? server.clients() : [], devices: settings.public().devices, lastHit: server ? server.lastHit : 0 };
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
  return { t: 'config', look: settings.data.look, layout: settings.data.layout.phone, control: settings.data.remote.allowControl, overlay: settings.data.overlay.enabled, lang: settings.data.prefs.lang || 'en', sys: monitor.static };
}
function broadcastConfig() {
  server?.broadcast(phoneConfig());
}

async function startServer() {
  server = new RemoteServer({
    root: DIST,
    pairing,
    port: Number(process.env.SM_PORT ?? process.env.SLIMMANAGER_PORT ?? settings.data.network.port) || 0,
    allowAnyIp: false,
    needsApproval: () => settings.data.remote.approveNew,
  });
  server.on('code', pushInfo);
  server.on('clients', () => (pushInfo(), updateLive()));
  server.on('subs', updateProcWanted);
  server.on('joined', (deviceId) => {
    server.sendTo(deviceId, phoneConfig());
    server.sendTo(deviceId, { t: 'history', h: monitor.historyOf(120) });
    if (monitor.snap) server.sendTo(deviceId, { t: 'stats', s: monitor.snap });
    server.sendTo(deviceId, { t: 'boost', b: boost.state() });
    server.sendTo(deviceId, { t: 'lively', on: !!lively });
    const bg = readBackground();
    if (bg && settings.data.look.bg === 'image') server.sendTo(deviceId, { t: 'bg', img: bg });
  });
  server.on('approval', (req) => {
    pendingApprovals.set(req.id, req);
    send('approval', req);
    shell({ t: 'show' }); // Fenster nach vorne – dort wird zugestimmt
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
  else if (c === 'boost') return startBoost(String(arg.app || ''), false, arg.mode === 'focus' ? 'focus' : 'game').then((r) => finish(r));
  else if (c === 'unboost') return stopBoost().then((r) => finish(r));
  else if (c === 'layout') {
    const list = arg.list === null ? null : cleanLayout(arg.list);
    if (arg.list !== null && !list) res = { ok: false, error: 'bad' };
    else {
      settings.update({ layout: { phone: list } });
      send('settings', settings.public());
      broadcastConfig();
      return reply({ t: 'result', c, ok: true, quiet: true });
    }
  } else if (c === 'overlay') {
    setOverlay(!!arg.on);
    res = { ok: true };
  }
  finish(res);
  function finish(r) {
    log('phone', name, c, JSON.stringify(a), JSON.stringify({ ok: r.ok, error: r.error }));
    send('phone-action', { name, c, a, ok: r.ok, at: Date.now() });
    reply({ t: 'result', c, ok: !!r.ok, error: r.error || null });
  }
}

// ------------------------------------------------------------------ Prozesse
/** Eigene Prozesse: Kern, Hülle (Eltern-Prozess) und Helfer – nie anfassen */
function selfPids() {
  return [process.pid, process.ppid, ...monitor.childPids(), tweaks.helper?.pid, tweaks.watchdog?.pid].filter(Boolean);
}

function onProcs(list) {
  const flat = normalize(list, { cores: monitor.static?.cores || os.cpus().length, selfPids: selfPids(), games: settings.data.boost.games });
  const groups = group(flat).sort((x, y) => y.cpu - x.cpu || y.mem - x.mem);
  procCache = { flat, groups, at: Date.now() };
  if (rendererWants() && winVisible()) send('procs', procCache);
  if (server && server.subscribers('procs')) server.broadcast({ t: 'procs', p: phoneGroups(groups) }, 'procs');
  boost.follow(flat);
  autoBoost(groups);
  checkHogs(groups);
  const game = detectGame(groups);
  if (game !== lastGame) {
    lastGame = game;
    updateLive();
  }
  send('game', game);
}

/** Für das Handy: nur das Nötigste – alle Apps/Spiele/Hintergrund, vom System nur die 30 aktivsten. */
function phoneGroups(groups) {
  const sys = groups.filter((g) => g.kind === 'system' || g.kind === 'self').slice(0, 30);
  const rest = groups.filter((g) => g.kind !== 'system' && g.kind !== 'self').slice(0, 150);
  return [...rest, ...sys].map((g) => ({ id: g.id, name: g.name, cpu: g.cpu, mem: g.mem, gpu: g.gpu, count: g.count, kind: g.kind, prio: g.prio }));
}

function updateProcWanted() {
  const vis = winVisible();
  const fast = (rendererWatch.fast > 0 && vis) || (server ? server.subscribers('procs') : 0) > 0;
  const medium = (rendererWatch.medium > 0 && vis) || boost.active || (settings.data.alerts.enabled && settings.data.alerts.hogs);
  monitor.setWanted(fast ? 'fast' : medium ? 'medium' : settings.data.boost.auto ? 'slow' : 'off');
}

const findGroup = (id) => procCache.groups.find((g) => g.id === id) || null;

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

// ------------------------------------------------------------------ Boost (Gaming & Fokus)
function backgroundLoad(exceptApp = '') {
  const skip = String(exceptApp).toLowerCase();
  const bg = procCache.groups.filter((g) => (g.kind === 'app' || g.kind === 'background') && g.name.toLowerCase() !== skip);
  return { cpu: Math.round(bg.reduce((s, g) => s + g.cpu, 0) * 10) / 10, ram: monitor.snap?.ramUsed ?? null };
}
async function startBoost(appName, auto, mode = settings.data.boost.mode) {
  mode = mode === 'focus' ? 'focus' : 'game';
  if (mode === 'game' && !appName) return { ok: false, error: 'no-game' };
  await monitor.procTick(true);
  const before = backgroundLoad(appName);
  const b = settings.data.boost;
  const st = await boost.start(procCache.flat, { mode, targetApp: mode === 'game' ? appName : '', cfg: b[mode], exceptions: b.exceptions, auto });
  updateProcWanted();
  const startedAt = st.startedAt;
  setTimeout(async () => {
    if (!boost.active || boost.session.startedAt !== startedAt) return;
    await monitor.procTick(true);
    const after = backgroundLoad(appName);
    boost.setEffect({ cpuBefore: before.cpu, cpuAfter: after.cpu, ramFreed: before.ram !== null && after.ram !== null ? Math.max(0, before.ram - after.ram) : null });
  }, 6000);
  return { ok: true, state: st };
}
async function stopBoost() {
  const s = await boost.stop();
  updateProcWanted();
  setTimeout(() => monitor.procTick(true), 500);
  return { ok: !!s, summary: s };
}
function toggleBoost() {
  if (boost.active) return stopBoost();
  if (settings.data.boost.mode === 'focus') return startBoost('', false, 'focus');
  const game = detectGame(procCache.groups);
  if (!game) {
    notify(tx('noGame'), tx('noGameText'));
    shell({ t: 'show' });
    send('navigate', 'boost');
    return { ok: false, error: 'no-game' };
  }
  return startBoost(game, false, 'game');
}
function autoBoost(groups) {
  const running = detectGame(groups);
  if (autoBoost.lastStopped && !groups.some((g) => g.name === autoBoost.lastStopped)) autoBoost.lastStopped = null;
  if (boost.active) {
    const s = boost.session;
    if (s.mode === 'game' && s.app && !groups.some((g) => g.name.toLowerCase() === s.app.toLowerCase())) stopBoost();
    return;
  }
  if (settings.data.boost.auto && running && autoBoost.lastStopped !== running) startBoost(running, true, 'game');
}
let wasActive = false;
boost.on('change', (st) => {
  ownPriority(st.active);
  setTimeout(updateLive, 0);
  send('boost', st);
  server?.broadcast({ t: 'boost', b: st });
  if (st.active !== wasActive) {
    wasActive = st.active;
    updateTray();
    if (st.active) notify(tx(st.mode === 'focus' ? 'focusStarted' : 'boostStarted'), st.app || '');
  }
});
boost.on('summary', (sum) => {
  if (!sum.auto && sum.app) autoBoost.lastStopped = sum.app;
  send('boost-summary', sum);
  server?.broadcast({ t: 'boost-summary', s: sum });
});
/** Während des Boosts tritt SlimManager selbst zurück (nur Windows – am Mac nicht umkehrbar) */
let ownLowered = false;
function ownPriority(low) {
  if (!isWin || low === ownLowered) return;
  ownLowered = low;
  for (const pid of selfPids()) setPriority(pid, low ? 'below' : 'normal');
}

// ------------------------------------------------------------------ Mini-Anzeige (die Hülle öffnet das Fenster)
function setOverlay(on) {
  settings.update({ overlay: { enabled: on } });
  send('settings', settings.public());
  broadcastConfig();
  shell({ t: 'overlay', on, corner: settings.data.overlay.corner });
  updateTray();
  updateLive();
}

// ------------------------------------------------------------------ Warnungen
const hogSince = new Map();
const hogTold = new Map();
function checkHogs(groups) {
  const a = settings.data.alerts;
  if (!a.enabled || !a.hogs) return hogSince.clear();
  const now = Date.now();
  const seen = new Set();
  for (const g of groups) {
    if ((g.kind !== 'app' && g.kind !== 'background') || g.cpu < 25 || (boost.active && g.name === boost.session?.app)) continue;
    seen.add(g.id);
    if (!hogSince.has(g.id)) hogSince.set(g.id, now);
    const since = hogSince.get(g.id);
    if (now - since >= 90_000 && now - (hogTold.get(g.id) || 0) > 10 * 60_000) {
      hogTold.set(g.id, now);
      notify(tx('hogTitle'), tx('hogText', { name: g.name, v: Math.round(g.cpu), m: Math.round((now - since) / 60_000) || 1 }), 'process', g.name);
    }
  }
  for (const id of [...hogSince.keys()]) if (!seen.has(id)) hogSince.delete(id);
}
function checkAlerts(s) {
  const a = settings.data.alerts;
  if (!a.enabled) return;
  const check = (key, value, limit, unit) => {
    if (value === null || value < limit) return;
    if (Date.now() - (alertAt[key] || 0) < 5 * 60_000) return;
    alertAt[key] = Date.now();
    notify('SlimManager', tx('hot', { what: tx(key), v: Math.round(value) + unit }));
  };
  check('cpuTemp', s.cpuTemp, a.cpuTemp, ' °C');
  check('gpuTemp', s.gpuTemp, a.gpuTemp, ' °C');
  check('ram', s.ram, a.ram, ' %');
}

// ------------------------------------------------------------------ Hintergrundbild (die Oberfläche verkleinert es vorher)
function readBackground() {
  try {
    return 'data:image/jpeg;base64,' + fs.readFileSync(BG_FILE).toString('base64');
  } catch {
    return null;
  }
}

/** Datei im Finder/Explorer zeigen bzw. Link im Browser öffnen – ohne Shell */
function reveal(p) {
  if (typeof p !== 'string' || !p || !fs.existsSync(p)) return;
  if (isMac) execFile('/usr/bin/open', ['-R', p], () => {});
  else if (isWin) execFile('explorer.exe', [`/select,${p}`], () => {});
  else execFile('xdg-open', [path.dirname(p)], () => {});
}
function openExternal(url) {
  if (typeof url !== 'string' || !/^(https:\/\/|mailto:|ms-settings:)/.test(url)) return;
  if (isMac) execFile('/usr/bin/open', [url], () => {});
  else if (isWin) execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], () => {});
  else execFile('xdg-open', [url], () => {});
}

/** Eigener Verbrauch: Kern + Hülle + alle ihre Kind-Prozesse (inkl. Fenster-Prozesse unter Windows) */
async function selfUsage() {
  const root = process.ppid;
  if (isWin) {
    // Unter Windows liefert der Mess-Helfer keine Eltern-Prozesse → eigene Prozesse über den Namen finden
    const mine = procCache.flat.filter((p) => p.kind === 'self' || /^slimmanager/i.test(p.name) || (/msedgewebview2/i.test(p.name) && p.path.toLowerCase().includes('slimmanager')));
    return { cpu: Math.round(mine.reduce((s, p) => s + p.cpu, 0) * 10) / 10, mem: mine.reduce((s, p) => s + p.mem, 0), gpu: true };
  }
  return new Promise((resolve) =>
    execFile('/bin/ps', ['-A', '-o', 'pid=,ppid=,pcpu=,rss=,comm='], { env: { ...process.env, LC_ALL: 'C' } }, (err, out) => {
      if (err) return resolve({ cpu: 0, mem: 0, gpu: true });
      const rows = String(out).trim().split('\n').map((l) => l.trim().split(/\s+/));
      const kids = new Map();
      for (const r of rows) (kids.get(+r[1]) || kids.set(+r[1], []).get(+r[1])).push(r);
      let cpu = 0;
      let mem = 0;
      const walk = (pid) => {
        for (const k of kids.get(pid) || []) {
          cpu += +k[2];
          mem += +k[3] * 1024;
          walk(+k[0]);
        }
      };
      const me = rows.find((r) => +r[0] === root);
      if (me) {
        cpu += +me[2];
        mem += +me[3] * 1024;
      }
      walk(root);
      resolve({ cpu: Math.round((cpu / os.cpus().length) * 10) / 10, mem, gpu: true });
    }),
  );
}

// ------------------------------------------------------------------ RPC-Befehle der Oberfläche
const RPC = {
  'settings:get': () => settings.public(),
  'settings:set': async (partial) => {
    const before = JSON.stringify(settings.data.network);
    const lookBefore = JSON.stringify([settings.data.look, settings.data.layout, settings.data.remote.allowControl, settings.data.prefs.lang]);
    settings.update(partial);
    if (JSON.stringify([settings.data.look, settings.data.layout, settings.data.remote.allowControl, settings.data.prefs.lang]) !== lookBefore) broadcastConfig();
    if (partial && partial.overlay) {
      if (partial.overlay.enabled !== undefined) setOverlay(settings.data.overlay.enabled);
      else {
        send('overlay:config', settings.data.overlay, 'overlay');
        shell({ t: 'overlay', on: settings.data.overlay.enabled, corner: settings.data.overlay.corner });
      }
      shell({ t: 'hotkeys', boost: settings.data.boost.hotkey, overlay: settings.data.overlay.hotkey });
    }
    if (partial && partial.boost) {
      shell({ t: 'hotkeys', boost: settings.data.boost.hotkey, overlay: settings.data.overlay.hotkey });
      updateProcWanted();
    }
    if (partial && partial.prefs) updateTray();
    if (partial && partial.app) {
      updateLive();
      updateTray();
      if (partial.app.autostart !== undefined) shell({ t: 'autostart', on: settings.data.app.autostart });
    }
    if (partial && partial.alerts) updateProcWanted();
    if (JSON.stringify(settings.data.network) !== before) {
      if (partial.network && partial.network.port !== undefined && server) {
        await server.stop();
        await startServer();
      }
      pushInfo();
    }
    return settings.public();
  },
  'app:info': () => ({ version: VERSION, electron: '', shell: 'tauri', platform: process.platform, locale: Intl.DateTimeFormat().resolvedOptions().locale }),
  'sys:static': () => monitor.static,
  'stats:get': () => ({ snap: monitor.snap, history: monitor.historyOf(300), lively: !!lively }),
  /** Die Oberfläche meldet, ob ihr Fenster sichtbar/vorne/Vollbild ist */
  'ui:state': (s) => {
    ui = { visible: !!s.visible, focused: !!s.focused, fullscreen: !!s.fullscreen };
    syncWindow();
  },
  'procs:watch': (on, level, c) => {
    const lvl = level === 'medium' ? 'medium' : 'fast';
    const d = on ? 1 : -1;
    if (c) c.watch[lvl] = Math.max(0, c.watch[lvl] + d);
    rendererWatch[lvl] = Math.max(0, rendererWatch[lvl] + d);
    updateProcWanted();
    return procCache;
  },
  'procs:kill': (id) => killGroup(String(id)),
  'procs:killPid': (pid) => killPid(Number(pid)),
  'procs:prio': (id, level) => prioGroup(String(id), String(level)),
  'procs:prioPid': (pid, level) => prioPids([Number(pid)], String(level)),
  'procs:reveal': (p) => reveal(p),
  'icon:get': (p) => appIcon(p, { dir: USERDATA, winSampler: monitor.ws }),
  'boost:get': () => boost.state(),
  'boost:start': (appName, mode) => startBoost(String(appName || ''), false, mode),
  'boost:caps': () => tweaks.caps(),
  'boost:stop': () => stopBoost(),
  'game:get': () => detectGame(procCache.groups),
  'overlay:set': (on) => setOverlay(!!on),
  'overlay:config': () => settings.data.overlay,
  'look:setImage': (dataUrl) => {
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
    if (!m) return null;
    fs.writeFileSync(BG_FILE, Buffer.from(m[1], 'base64'));
    settings.update({ look: { bg: 'image', bgImage: true } });
    const data = readBackground();
    server?.broadcast({ t: 'bg', img: data });
    broadcastConfig();
    return { settings: settings.public(), img: data };
  },
  'look:getImage': () => readBackground(),
  'look:removeImage': () => {
    fs.rmSync(BG_FILE, { force: true });
    settings.update({ look: { bgImage: false, bg: settings.data.look.bg === 'image' ? 'aurora' : settings.data.look.bg } });
    broadcastConfig();
    return settings.public();
  },
  'layout:exportData': () => JSON.stringify({ app: 'SlimManager', version: 1, look: { ...settings.data.look, bgImage: false, bg: settings.data.look.bg === 'image' ? 'aurora' : settings.data.look.bg }, layout: settings.data.layout }, null, 2),
  'layout:importData': (text) => {
    let data;
    try {
      data = JSON.parse(String(text));
    } catch {
      return { error: 'bad-file' };
    }
    if (!data || data.app !== 'SlimManager') return { error: 'bad-file' };
    const look = cleanLook({ ...data.look, bgImage: settings.data.look.bgImage }, settings.data.look);
    if (look.bg === 'image' && !settings.data.look.bgImage) look.bg = 'aurora';
    settings.update({ look, layout: { pc: cleanLayout(data.layout?.pc), phone: cleanLayout(data.layout?.phone) } });
    broadcastConfig();
    return { settings: settings.public() };
  },
  'remote:info': () => info(),
  'remote:newCode': () => {
    pairing.rotate();
    pushInfo();
  },
  'remote:disconnect': (id) => server?.disconnect(String(id)),
  'devices:remove': (id) => {
    server?.disconnect(String(id));
    pairing.remove(String(id));
  },
  'devices:removeAll': () => {
    for (const d of pairing.devices) server?.disconnect(d.id);
    pairing.removeAll();
  },
  'approval:answer': (id, ok) => server?.answerApproval(String(id), !!ok),
  'approval:pending': () => [...pendingApprovals.values()],
  'shell:openExternal': (url) => openExternal(url),
  'app:log': (...a) => log('ui', ...a.slice(0, -1)),
  'self:usage': () => selfUsage(),
  // Test-Zugriff (nur im Testmodus)
  'test:state': () =>
    isTest
      ? {
          url: remoteUrl().url.replace(/\/\/[^/:]+:/, '//127.0.0.1:'),
          base: remoteUrl().base.replace(/\/\/[^/:]+:/, '//127.0.0.1:'),
          code: pairing.code,
          pin: pairing.freshPin(),
          clients: server ? server.clients() : [],
          boost: boost.state(),
          overlay: settings.data.overlay.enabled,
          userData: USERDATA,
        }
      : null,
};

// ------------------------------------------------------------------ Start & Ende
let quitting = false;
async function quit() {
  if (quitting) return;
  quitting = true;
  monitor.stop();
  server?.stop();
  // Erst alles zurücksetzen (auftauen, Prioritäten, Energieplan, Dienste), dann wirklich beenden
  await Promise.race([(boost.active ? boost.stop() : Promise.resolve()).then(() => tweaks.restoreAll()), new Promise((r) => setTimeout(r, 6000))]).catch(() => {});
  tweaks.close();
  process.exit(0);
}
process.on('SIGTERM', quit);
process.on('SIGINT', quit);

(async () => {
  tweaks.recover().catch((e) => log('recover', e));
  addresses = listAddresses();
  monitor.on('stats', (s) => {
    if (winVisible()) send('stats', s);
    send('stats', s, 'overlay');
    if (server && server.clients().length) server.broadcast({ t: 'stats', s });
    boost.record(s);
    checkAlerts(s);
  });
  monitor.on('procs', onProcs);
  try {
    await startServer();
  } catch (e) {
    log('server start failed', e);
  }
  const rpcPort = await startRpc();
  monitor.start().catch((e) => log('monitor', e));
  // Der Hülle sagen, wo sich die Oberfläche verbinden soll – und was sie einrichten soll
  shell({ t: 'ready', port: rpcPort, token: TOKEN });
  updateTray();
  shell({ t: 'hotkeys', boost: settings.data.boost.hotkey, overlay: settings.data.overlay.hotkey });
  if (settings.data.overlay.enabled) shell({ t: 'overlay', on: true, corner: settings.data.overlay.corner });
  updateProcWanted();
  updateLive();
  setInterval(() => (updateLive(), updateProcWanted()), 3000);
  setInterval(refreshAddresses, 4000);
  setInterval(() => {
    const before = pairing.pin;
    if (pairing.freshPin() !== before) pushInfo();
  }, 10_000);
})();
