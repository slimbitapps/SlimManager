'use strict';
// Logik-Tests: Einstellungen, Layouts, Prozesse, Prioritäten, Game Boost, Messwerte.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SettingsStore, DEFAULTS } = require('../electron/core/settings.cjs');
const { cleanLayout, cleanLook, cleanOverlay } = require('../electron/core/layout.cjs');
const procs = require('../electron/core/procs.cjs');
const { Boost, planBoost, detectGame } = require('../electron/core/boost.cjs');
const { Ring, rate, parseIoreg, parseSmi, cleanDisks, Monitor } = require('../electron/core/monitor.cjs');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'slimmanager-')), 'settings.json');

// ------------------------------------------------------------------ Einstellungen
test('Einstellungen: Standardwerte, Speichern, kaputte Datei', () => {
  const f = tmp();
  const s = new SettingsStore(f);
  assert.equal(s.data.look.skin, 'neon');
  s.update({ look: { skin: 'classic' }, boost: { auto: true } });
  const again = new SettingsStore(f);
  assert.equal(again.data.look.skin, 'classic');
  assert.equal(again.data.boost.auto, true);
  assert.equal(again.data.boost.lowerOthers, true, 'fehlende Werte bleiben Standard');
  fs.writeFileSync(f, '{kaputt');
  assert.equal(new SettingsStore(f).data.look.skin, DEFAULTS.look.skin);
});

test('Einstellungen: Geräte-Schlüssel nie an die Oberfläche, nicht von dort änderbar', () => {
  const s = new SettingsStore(tmp());
  s.data.devices = [{ id: 'phone-12345678', name: 'A', key: 'GEHEIM', added: 1 }];
  assert.ok(!JSON.stringify(s.public()).includes('GEHEIM'));
  s.update({ devices: [] });
  assert.equal(s.data.devices.length, 1);
});

test('Einstellungen: unsinnige Werte werden korrigiert', () => {
  const s = new SettingsStore(tmp());
  s.update({ look: { skin: 'hacker', dim: 5, radius: -3, accent: 'red' }, alerts: { cpuTemp: 999 }, network: { port: 99999 }, boost: { closeList: ['a', 'a', 3, 'b'] } });
  assert.equal(s.data.look.skin, 'neon');
  assert.equal(s.data.look.dim, 0.9);
  assert.equal(s.data.look.radius, 0);
  assert.equal(s.data.look.accent, '');
  assert.equal(s.data.alerts.cpuTemp, 110);
  assert.equal(s.data.network.port, DEFAULTS.network.port);
  assert.deepEqual(s.data.boost.closeList, ['a', 'b']);
});

// ------------------------------------------------------------------ Layout
test('Layout: Unbekanntes fliegt raus, IDs eindeutig, Texte gesäubert', () => {
  const l = cleanLayout([
    { id: 'a', type: 'metric', metric: 'cpu', style: 'ring', size: 'm' },
    { id: 'a', type: 'metric', metric: 'quatsch', style: 'xx', size: 'zz' },
    { id: 'b', type: 'virus' },
    null,
    { id: 'c', type: 'text', text: '<script>alert(1)</script>Hallo', color: '#ff00ff' },
    { id: 'd', type: 'procs', count: 999 },
  ]);
  assert.equal(l.length, 4);
  assert.equal(new Set(l.map((w) => w.id)).size, 4);
  assert.deepEqual([l[1].metric, l[1].style, l[1].size], ['cpu', 'ring', 's']);
  assert.ok(!l[2].text.includes('<'));
  assert.equal(l[2].color, '#ff00ff');
  assert.equal(l[3].count, 15);
  assert.equal(cleanLayout('nein'), null);
  assert.equal(cleanLayout(Array(100).fill({ type: 'clock' })).length, 40);
});

test('Aussehen & Mini-Anzeige werden geprüft', () => {
  const l = cleanLook({ skin: 'terminal', bg: 'image', cardAlpha: 0, font: 'comic' }, DEFAULTS.look);
  assert.equal(l.skin, 'terminal');
  assert.equal(l.cardAlpha, 0.2);
  assert.equal(l.font, 'system');
  const o = cleanOverlay({ metrics: ['cpu', 'cpu', 'hack', 'gpu'], corner: 'mitte' }, DEFAULTS.overlay);
  assert.deepEqual(o.metrics, ['cpu', 'gpu']);
  assert.equal(o.corner, 'tr');
});

// ------------------------------------------------------------------ Prozesse
const win = (pid, name, p, extra = {}) => ({ pid, name, path: p, command: name, cpu: 1, memRss: 1024, priority: 8, ...extra });
const mac = (pid, name, p, user = 'max', extra = {}) => ({ pid, name, path: p, user, cpu: 1, memRss: 1024, nice: 0, ...extra });

test('Windows: Systemprozesse, Spiele, Apps, Hintergrund richtig erkannt', () => {
  const c = (p) => procs.classify(p, { platform: 'win32', selfPids: [999] });
  assert.equal(c(win(4, 'System', '')), 'system');
  assert.equal(c(win(800, 'svchost.exe', 'C:\\Windows\\System32')), 'system');
  assert.equal(c(win(801, 'explorer.exe', 'C:\\Windows')), 'system');
  assert.equal(c(win(900, 'cs2.exe', 'D:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64')), 'game');
  assert.equal(c(win(901, 'FortniteClient-Win64-Shipping.exe', 'C:\\Program Files\\Epic Games\\Fortnite\\FortniteGame\\Binaries\\Win64')), 'game');
  assert.equal(c(win(902, 'steamwebhelper.exe', 'C:\\Program Files (x86)\\Steam\\bin\\cef')), 'background');
  assert.equal(c(win(903, 'EasyAntiCheat.exe', 'C:\\Program Files (x86)\\EasyAntiCheat')), 'app');
  assert.equal(c(win(904, 'chrome.exe', 'C:\\Program Files\\Google\\Chrome\\Application')), 'app');
  assert.equal(c(win(905, 'OneDrive.exe', 'C:\\Users\\max\\AppData\\Local\\Microsoft\\OneDrive')), 'background');
  assert.equal(c(win(999, 'SlimManager.exe', 'C:\\x')), 'self');
  assert.equal(procs.classify(win(906, 'MeinSpiel.exe', 'C:\\Spiele'), { platform: 'win32', games: ['MeinSpiel.exe'] }), 'game', 'eigene Spiele-Liste');
});

test('Mac: System, Apps und Helfer', () => {
  const c = (p) => procs.classify(p, { platform: 'darwin' });
  assert.equal(c(mac(100, 'WindowServer', '/System/Library/PrivateFrameworks/SkyLight.framework/Resources', '_windowserver')), 'system');
  assert.equal(c(mac(101, 'Finder', '/System/Library/CoreServices/Finder.app/Contents/MacOS')), 'system');
  assert.equal(c(mac(102, 'Google Chrome', '/Applications/Google Chrome.app/Contents/MacOS')), 'app');
  assert.equal(c(mac(103, 'Google Chrome Helper (Renderer)', '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS')), 'background');
  assert.equal(c(mac(104, 'Minecraft', '/Users/max/Library/Application Support/Steam/steamapps/common/Game/Game.app/Contents/MacOS')), 'game');
});

test('Gruppieren: Helfer landen bei ihrer App, CPU wird zusammengezählt', () => {
  const flat = procs.normalize(
    [
      mac(501, 'Google Chrome', '/Applications/Google Chrome.app/Contents/MacOS', 'max', { cpu: 40 }),
      mac(502, 'Google Chrome Helper', '/Applications/Google Chrome.app/Contents/Frameworks/Helpers/Google Chrome Helper.app/Contents/MacOS', 'max', { cpu: 40 }),
      mac(503, 'Spotify', '/Applications/Spotify.app/Contents/MacOS', 'max', { cpu: 8 }),
    ],
    { platform: 'darwin', cores: 8 },
  );
  assert.equal(flat[0].cpu, 5, 'Mac zählt pro Kern → auf Gesamt-CPU umgerechnet');
  assert.equal(flat[0].path, '/Applications/Google Chrome.app', 'Symbol vom .app-Paket');
  const g = procs.group(flat);
  const chrome = g.find((x) => x.name === 'Google Chrome');
  assert.equal(chrome.count, 2);
  assert.equal(chrome.cpu, 10);
  assert.equal(chrome.kind, 'app');
  assert.deepEqual(chrome.pids.sort(), [501, 502]);
});

test('Windows: CPU bleibt wie geliefert, Symbol aus der .exe, Prioritäts-Stufen', () => {
  const [p] = procs.normalize([win(10, 'chrome.exe', 'C:\\Program Files\\Google\\Chrome\\Application', { cpu: 12.34, priority: 13 })], { platform: 'win32', cores: 8 });
  assert.equal(p.cpu, 12.3);
  assert.equal(p.app, 'Google Chrome');
  assert.equal(p.prio, 'high');
  assert.equal(p.path, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  assert.deepEqual([4, 6, 8, 10, 13].map((v) => procs.priorityLevel(v, 'win32')), ['low', 'below', 'normal', 'above', 'high']);
  assert.deepEqual([19, 10, 0, -7, -14].map((v) => procs.niceLevel(v)), ['low', 'below', 'normal', 'above', 'high']);
});

test('Geschützt: System, eigene App und PID ≤ 4', () => {
  assert.ok(procs.isProtected({ pid: 500, kind: 'system' }));
  assert.ok(procs.isProtected({ pid: 500, kind: 'self' }));
  assert.ok(procs.isProtected({ pid: 4, kind: 'app' }));
  assert.ok(!procs.isProtected({ pid: 500, kind: 'app' }));
});

test('Beenden: niemals PID ≤ 4 oder sich selbst; "schon weg" zählt als erledigt', () => {
  const killed = [];
  const killer = (pid) => {
    if (pid === 77) throw Object.assign(new Error('x'), { code: 'ESRCH' });
    if (pid === 88) throw Object.assign(new Error('x'), { code: 'EPERM' });
    killed.push(pid);
  };
  const r = procs.killPids([0, 4, process.pid, 50, 77, 88], killer);
  assert.deepEqual(killed, [50]);
  assert.equal(r.ok, 2);
  assert.equal(r.failed, 4);
  assert.equal(r.error, 'admin');
});

test('Priorität setzen: Fehler werden verständlich', () => {
  assert.deepEqual(procs.setPriority(1, 'turbo'), { ok: false, error: 'bad-level' });
  const deny = () => {
    throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
  };
  assert.equal(procs.setPriority(123, 'high', deny).error, 'admin');
  const calls = [];
  assert.ok(procs.setPriority(123, 'below', (pid, v) => calls.push([pid, v])).ok);
  assert.deepEqual(calls, [[123, os.constants.priority.PRIORITY_BELOW_NORMAL]]);
});

test('Echte Priorität eines eigenen Kindprozesses senken', async () => {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},5000)'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(procs.setPriority(child.pid, 'below').ok);
  assert.equal(procs.getPriority(child.pid), 'below');
  child.kill();
});

// ------------------------------------------------------------------ Game Boost
const P = (n, app, kind, prio = 'normal') => ({ pid: 100 + n, app, name: app + '.exe', kind, prio, cpu: 0, mem: 0 });
const LIST = [P(1, 'Game', 'game'), P(2, 'Game', 'game'), P(3, 'Chrome', 'app'), P(4, 'Updater', 'background'), P(5, 'svchost', 'system'), P(6, 'Discord', 'app'), P(7, 'Other', 'game'), P(8, 'Low', 'app', 'low'), P(9, 'SlimManager', 'self')];

test('Boost-Plan: Spiel hoch, Apps/Hintergrund runter, System & andere Spiele unberührt', () => {
  const plan = planBoost(LIST, { targetApp: 'game', closeList: ['Discord'] });
  assert.deepEqual(plan.raise, [101, 102]);
  assert.deepEqual(plan.lower, [103, 104]);
  assert.deepEqual(plan.kill, [106]);
  const soft = planBoost(LIST, { targetApp: 'Game', lowerOthers: false, raiseGame: false });
  assert.deepEqual([soft.raise, soft.lower, soft.kill], [[], [], []]);
});

test('Boost: alles wird beim Beenden zurückgesetzt, Zusammenfassung stimmt', () => {
  const calls = [];
  const setter = (pid, v) => {
    if (pid === 102) throw Object.assign(new Error('x'), { code: 'EACCES' }); // z. B. Anti-Cheat
    calls.push([pid, v]);
  };
  const killed = [];
  const b = new Boost({ setter, killer: (pid) => killed.push(pid), background: null });
  const st = b.start(LIST, { targetApp: 'Game', closeList: ['Discord'] });
  assert.equal(st.active, true);
  assert.equal(st.raised, 1);
  assert.equal(st.raiseError, 'admin');
  assert.equal(st.lowered, 2);
  assert.equal(st.closed, 1);
  assert.deepEqual(killed, [106]);
  b.record({ cpu: 50, gpu: 90, cpuTemp: 70, gpuTemp: 80 });
  b.record({ cpu: 70, gpu: null, cpuTemp: 75, gpuTemp: null });
  calls.length = 0;
  const sum = b.stop();
  // 1 (Spiel), 3, 4 zurück auf "normal"
  assert.deepEqual(calls.map((c) => c[0]).sort(), [101, 103, 104]);
  assert.ok(calls.every((c) => c[1] === os.constants.priority.PRIORITY_NORMAL));
  assert.equal(sum.avgCpu, 60);
  assert.equal(sum.avgGpu, 90);
  assert.equal(sum.maxCpuTemp, 75);
  assert.equal(b.active, false);
  assert.equal(b.stop(), null, 'zweimal beenden ist harmlos');
});

test('Boost am Mac: Bremsen über Hintergrund-Modus, wird wieder aufgehoben', () => {
  const bg = [];
  const b = new Boost({ setter: () => {}, killer: () => {}, background: (pid, on) => (bg.push([pid, on]), { ok: true }) });
  const st = b.start(LIST, { targetApp: 'Game' });
  assert.equal(st.lowered, 4); // Chrome, Updater, Discord, Low – auch schon gebremste
  b.stop();
  assert.deepEqual(bg, [[103, true], [104, true], [106, true], [108, true], [103, false], [104, false], [106, false], [108, false]]);
});

test('Boost: neue Prozesse des Spiels werden nachgezogen', () => {
  const calls = [];
  const b = new Boost({ setter: (pid) => calls.push(pid), killer: () => {}, background: null });
  b.start([P(1, 'Game', 'game')], { targetApp: 'Game' });
  b.follow([P(1, 'Game', 'game', 'high'), P(10, 'Game', 'game'), P(11, 'Chrome', 'app')]);
  assert.deepEqual(calls, [101, 110]);
  b.stop();
});

test('Spiel-Erkennung nimmt das größte laufende Spiel', () => {
  assert.equal(detectGame([{ name: 'A', kind: 'game', mem: 10 }, { name: 'B', kind: 'game', mem: 99 }, { name: 'C', kind: 'app', mem: 999 }]), 'B');
  assert.equal(detectGame([{ name: 'C', kind: 'app', mem: 1 }]), null);
});

// ------------------------------------------------------------------ Messwerte
test('Ringpuffer und Raten', () => {
  const r = new Ring(3);
  [1, 2, 3, 4].forEach((v) => r.push(v));
  assert.deepEqual(r.last(), [2, 3, 4]);
  assert.equal(rate(1000, 3000, 2000), 1000);
  assert.equal(rate(5000, 1000, 1000), null, 'Zähler übergelaufen → kein Unsinn');
  assert.equal(rate(null, 5, 1000), null);
});

test('GPU-Werte aus ioreg (Mac) und nvidia-smi', () => {
  assert.deepEqual(parseIoreg('"Device Utilization %"=12 ... "Device Utilization %"=57,"In use system memory"=1048576'), { util: 57, memUsed: 1048576 });
  assert.deepEqual(parseIoreg('nichts'), { util: null, memUsed: null });
  assert.deepEqual(parseSmi('37, 61, 2048, 8192\n'), { util: 37, temp: 61, memUsed: 2048 * 1048576, memTotal: 8192 * 1048576 });
  assert.equal(parseSmi(''), null);
});

test('Laufwerke: Mac-Hilfsvolumes ausblenden', () => {
  const d = cleanDisks(
    [
      { mount: '/', size: 500e9, used: 10e9, use: 2 },
      { mount: '/System/Volumes/Data', size: 500e9, used: 400e9, use: 80 },
      { mount: '/System/Volumes/VM', size: 500e9, used: 2e9, use: 1 },
      { mount: '/Volumes/USB', size: 64e9, used: 1e9, use: 2 },
      { mount: '/tiny', size: 1e8, used: 1, use: 1 },
    ],
    'darwin',
  );
  assert.deepEqual(d.map((x) => x.label), ['Macintosh HD', '/Volumes/USB']);
});

test('Monitor mit Attrappe: Werte, Verlauf, fehlende Sensoren = null', async () => {
  let rx = 1000;
  const si = {
    cpu: async () => ({ manufacturer: 'Intel', brand: 'Core i7', cores: 8 }),
    osInfo: async () => ({ distro: 'TestOS', release: '1' }),
    graphics: async () => ({ controllers: [{ model: 'Klein', vram: 512 }, { model: 'Groß', vram: 8192 }] }),
    mem: async () => ({ total: 16e9, active: 8e9, swaptotal: 0 }),
    currentLoad: async () => ({ currentLoad: 42.42, cpus: [{ load: 40 }, { load: 44 }] }),
    networkStats: async () => [{ rx_bytes: (rx += 5000), tx_bytes: 10 }],
    disksIO: async () => null,
    cpuCurrentSpeed: async () => ({ avg: 3.2 }),
    fsSize: async () => [],
    battery: async () => ({ hasBattery: false }),
    cpuTemperature: async () => ({ main: null }),
    processes: async () => ({ all: 2, list: [] }),
  };
  const m = new Monitor({ si, platform: 'linux', interval: 50 });
  m.static = await m.readStatic();
  assert.equal(m.static.gpu, 'Groß');
  await m.tick();
  await new Promise((r) => setTimeout(r, 30));
  await m.tick();
  assert.equal(m.snap.cpu, 42.4);
  assert.equal(m.snap.ram, 50);
  assert.equal(m.snap.cpuTemp, null);
  assert.equal(m.snap.swap, null);
  assert.ok(m.snap.netDown > 0);
  assert.equal(m.historyOf(10).cpu.length, 2);
});
