'use strict';
/**
 * Prozesse aufbereiten: zu Apps gruppieren, einordnen (System / App / Hintergrund / Spiel),
 * beenden und Priorität ändern – mit Schutz für wichtige Systemprozesse.
 */
const os = require('node:os');
const path = require('node:path');

// ------------------------------------------------------------------ Einordnung
/** Windows-Prozesse, ohne die das System nicht läuft (niemals beenden oder bremsen). */
const WIN_SYSTEM = new Set(
  [
    'system', 'system idle process', 'idle', 'registry', 'memory compression', 'secure system', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe',
    'services.exe', 'lsass.exe', 'lsaiso.exe', 'svchost.exe', 'dwm.exe', 'explorer.exe', 'fontdrvhost.exe', 'sihost.exe', 'ctfmon.exe', 'audiodg.exe',
    'msmpeng.exe', 'nissrv.exe', 'securityhealthservice.exe', 'spoolsv.exe', 'taskhostw.exe', 'runtimebroker.exe', 'searchhost.exe', 'startmenuexperiencehost.exe',
    'shellexperiencehost.exe', 'textinputhost.exe', 'conhost.exe', 'dllhost.exe', 'wudfhost.exe', 'smartscreen.exe', 'applicationframehost.exe',
    'systemsettings.exe', 'lockapp.exe', 'taskmgr.exe', 'wmiprvse.exe', 'searchindexer.exe', 'mpdefendercoreservice.exe',
  ],
);
/** Mac-Prozesse, die zum System gehören. */
const MAC_SYSTEM = new Set(['kernel_task', 'launchd', 'windowserver', 'loginwindow', 'dock', 'finder', 'systemuiserver', 'controlcenter', 'notificationcenter', 'coreaudiod', 'spotlight', 'mds', 'mds_stores', 'mdworker', 'mdworker_shared', 'airportd', 'bluetoothd', 'cfprefsd', 'distnoted', 'trustd', 'securityd', 'opendirectoryd', 'powerd', 'hidd', 'universalaccessd']);

/** Ordner, in denen Spiele liegen (Steam, Epic, Riot, GOG, EA, Ubisoft, Xbox, Battle.net …). */
const GAME_DIRS = /([\\/]steamapps[\\/]common[\\/]|[\\/]Epic Games[\\/]|[\\/]Riot Games[\\/]|[\\/]GOG Games[\\/]|[\\/]GOG Galaxy[\\/]Games[\\/]|[\\/]EA Games[\\/]|[\\/]Electronic Arts[\\/]|[\\/]Ubisoft Game Launcher[\\/]games[\\/]|[\\/]XboxGames[\\/]|[\\/]Rockstar Games[\\/](?!Launcher)|[\\/]Battle\.net[\\/](?!.*Battle\.net)|[\\/]Minecraft[\\/]|[\\/]Roblox[\\/]Versions[\\/])/i;
/** Bekannte Spiele/Launcher-Prozesse, die keine Spiele sind (sonst würde der Launcher "geboostet"). */
const NOT_GAMES = /^(steam|steamwebhelper|steamservice|epicgameslauncher|epicwebhelper|riotclientservices|riotclientux|riotclientcrashhandler|galaxyclient|eadesktop|origin|upc|ubisoftconnect|battle\.net|agent|crashpad_handler|unitycrashhandler64|crashreportclient|easyanticheat|beservice|vgc|vgtray|xboxpcapp|gamingservices|robloxplayerlauncher)(\.exe)?$/i;
/** Typische Hintergrund-Programme (Updater, Helfer, Cloud-Sync …). */
const BACKGROUND = /(update|updater|helper|crashpad|crashhandler|telemetry|onedrive|dropbox|googledrivefs|icloud|adobe ?ipc|adobe desktop service|creative cloud|ccxprocess|cortana|widgets|phoneexperiencehost|yourphone|teams.*background|msedgewebview2|webview|agent|daemon|service|tray)/i;

/** Freundliche Namen für bekannte Programme. */
const FRIENDLY = {
  'chrome': 'Google Chrome', 'msedge': 'Microsoft Edge', 'firefox': 'Firefox', 'discord': 'Discord', 'spotify': 'Spotify', 'steam': 'Steam',
  'steamwebhelper': 'Steam', 'obs64': 'OBS Studio', 'code': 'Visual Studio Code', 'explorer': 'Explorer', 'teams': 'Microsoft Teams', 'ms-teams': 'Microsoft Teams',
  'onedrive': 'OneDrive', 'opera': 'Opera', 'brave': 'Brave', 'epicgameslauncher': 'Epic Games', 'riotclientservices': 'Riot Client', 'msmpeng': 'Microsoft Defender',
  'svchost': 'Windows-Dienste', 'whatsapp': 'WhatsApp', 'winword': 'Word', 'excel': 'Excel', 'powerpnt': 'PowerPoint', 'javaw': 'Java', 'slimmanager': 'SlimManager',
};

/** Name der App, zu der ein Prozess gehört – z. B. alle Chrome-Helfer → "Google Chrome". */
function appName(p, platform = process.platform) {
  const full = String(p.path || '') + (platform === 'win32' ? '' : '/' + String(p.name || ''));
  if (platform === 'darwin') {
    // Äußerstes .app-Paket gewinnt: /Applications/Google Chrome.app/…/Google Chrome Helper.app → Google Chrome
    const m = /\/([^/]+)\.app(\/|$)/.exec(full);
    if (m) return m[1];
  }
  const raw = String(p.name || '').replace(/\.exe$/i, '');
  const key = raw.toLowerCase();
  return FRIENDLY[key] || raw;
}

/**
 * Art eines Prozesses: 'self' | 'system' | 'game' | 'app' | 'background'
 * @param {{pid:number, name:string, path?:string, user?:string, command?:string}} p
 */
function classify(p, { platform = process.platform, selfPids = [], games = [] } = {}) {
  const pid = Number(p.pid);
  const name = String(p.name || '');
  const lname = name.toLowerCase();
  const dir = String(p.path || '');
  const full = platform === 'win32' ? dir : path.posix.join(dir, name);
  if (selfPids.includes(pid)) return 'self';
  if (pid <= 4) return 'system';
  const app = appName(p, platform);
  if (games.some((g) => g && (g.toLowerCase() === lname || g.toLowerCase() === app.toLowerCase()))) return 'game';
  if (platform === 'win32') {
    if (WIN_SYSTEM.has(lname) || /^[a-z]:\\windows\\/i.test(dir)) return 'system';
    if (!dir && !p.command) return 'system'; // ohne Pfad: geschützter Systemprozess
  } else if (platform === 'darwin') {
    if (MAC_SYSTEM.has(lname) || /^\/(System|usr|sbin|bin|Library\/Apple)\//.test(full) || String(p.user || '').startsWith('_') || p.user === 'root') return 'system';
  } else {
    if (p.user === 'root' || /^\/(usr\/lib|usr\/libexec|sbin|lib)\//.test(full)) return 'system';
  }
  if (GAME_DIRS.test(full + (platform === 'win32' ? '\\' : '/')) && !NOT_GAMES.test(name) && !BACKGROUND.test(name)) return 'game';
  if (BACKGROUND.test(name)) return 'background';
  if (platform === 'darwin') return /\.app\/Contents\/MacOS(\/|$)/.test(full) && !/\.app\/Contents\/(Frameworks|Library|Helpers|XPCServices)/.test(full) ? 'app' : 'background';
  return 'app';
}

const KIND_RANK = { game: 5, app: 4, background: 3, self: 2, system: 1 };

/**
 * Rohe Prozessliste (systeminformation) → aufbereitete Liste.
 * CPU in % der GESAMTEN CPU (wie im Task-Manager), Speicher in Bytes.
 */
function normalize(list, { platform = process.platform, cores = os.cpus().length, selfPids = [], games = [] } = {}) {
  const perCore = platform !== 'win32'; // ps zählt pro Kern (bis 100 % × Kerne)
  return (list || [])
    .filter((p) => p && Number.isInteger(Number(p.pid)))
    .map((p) => {
      const cpu = Number(p.cpu) || 0;
      return {
        pid: Number(p.pid),
        ppid: Number(p.parentPid) || 0,
        name: String(p.name || '?'),
        app: appName(p, platform),
        cpu: Math.round((perCore ? cpu / Math.max(1, cores) : cpu) * 10) / 10,
        mem: (Number(p.memRss) || 0) * 1024,
        // GPU in % (nur Windows: Leistungsindikatoren bzw. nvidia-smi) – sonst null
        gpu: Number.isFinite(p.gpu) ? p.gpu : null,
        path: exePath(p, platform),
        user: String(p.user || ''),
        // Mac/Linux: "nice" ist das, was man selbst verstellen kann (Kernel-Priorität schwankt ständig)
        prio: platform === 'win32' ? priorityLevel(Number(p.priority), platform) : niceLevel(Number(p.nice)),
        kind: classify(p, { platform, selfPids, games }),
      };
    });
}

/**
 * Datei, aus der das Programm-Symbol kommt: Mac = das .app-Paket (sonst keins),
 * Windows = die .exe (systeminformation liefert teils nur den Ordner).
 */
function exePath(p, platform = process.platform) {
  const dir = String(p.path || '');
  const name = String(p.name || '');
  if (!dir) return '';
  if (platform === 'darwin') {
    const m = /^(.*?\.app)(\/|$)/.exec(dir + '/' + name);
    return m ? m[1] : '';
  }
  if (platform === 'win32') return /\.exe$/i.test(dir) ? dir : dir.replace(/[\\/]+$/, '') + '\\' + name;
  return path.posix.join(dir, name);
}

/** Nach App zusammenfassen (wie "Apps" im Task-Manager). */
function group(procs) {
  const map = new Map();
  for (const p of procs) {
    const key = p.kind === 'system' ? 'sys:' + p.name.toLowerCase() : p.app.toLowerCase();
    let g = map.get(key);
    if (!g) {
      g = { id: key, name: p.kind === 'system' ? p.name.replace(/\.exe$/i, '') : p.app, cpu: 0, mem: 0, gpu: null, pids: [], count: 0, kind: p.kind, prio: p.prio, path: p.path, exe: p.name };
      map.set(key, g);
    }
    g.cpu += p.cpu;
    g.mem += p.mem;
    if (p.gpu !== null) g.gpu = Math.min(100, (g.gpu || 0) + p.gpu);
    g.pids.push(p.pid);
    g.count += 1;
    if (KIND_RANK[p.kind] > KIND_RANK[g.kind]) g.kind = p.kind;
    // Hauptprozess = der mit dem kürzesten Namen (z. B. "chrome.exe" statt "chrome_crashpad.exe")
    if (p.name.length < g.exe.length) {
      g.exe = p.name;
      g.path = p.path;
      g.prio = p.prio;
    }
  }
  return [...map.values()].map((g) => ({ ...g, cpu: Math.round(g.cpu * 10) / 10 }));
}

/** Darf dieser Prozess beendet / gebremst werden? */
function isProtected(p) {
  return p.kind === 'system' || p.kind === 'self' || p.pid <= 4;
}

// ------------------------------------------------------------------ Priorität
/** Stufen von niedrig nach hoch. "Echtzeit" gibt es bewusst nicht (kann den PC einfrieren). */
const LEVELS = ['low', 'below', 'normal', 'above', 'high'];
const P = os.constants.priority;
const LEVEL_VALUE = { low: P.PRIORITY_LOW, below: P.PRIORITY_BELOW_NORMAL, normal: P.PRIORITY_NORMAL, above: P.PRIORITY_ABOVE_NORMAL, high: P.PRIORITY_HIGH };

/**
 * Prioritäts-Zahl aus der Prozessliste → Stufe.
 * Windows liefert Basis-Prioritäten (4/6/8/10/13/24), Mac/Linux "nice" (-20 … 19).
 */
function priorityLevel(v, platform = process.platform) {
  if (!Number.isFinite(v)) return 'normal';
  if (platform === 'win32') {
    if (v <= 4) return 'low';
    if (v <= 6) return 'below';
    if (v <= 8) return 'normal';
    if (v <= 10) return 'above';
    return 'high';
  }
  return niceLevel(v);
}

/** "nice"-Wert (Mac/Linux, -20 … 19) → Stufe */
function niceLevel(v) {
  if (!Number.isFinite(v)) return 'normal';
  if (v >= 15) return 'low';
  if (v >= 5) return 'below';
  if (v > -5) return 'normal';
  if (v > -12) return 'above';
  return 'high';
}

/** Aktuelle Stufe direkt vom System lesen (genauer als die Liste). */
function getPriority(pid) {
  try {
    const v = os.getPriority(pid);
    let best = 'normal';
    let diff = Infinity;
    for (const l of LEVELS) {
      const d = Math.abs(LEVEL_VALUE[l] - v);
      if (d < diff) {
        diff = d;
        best = l;
      }
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * Priorität setzen. Ergebnis: { ok, error? } – error 'admin', wenn das System Admin-Rechte verlangt
 * (am Mac darf man ohne Admin nur bremsen, nicht beschleunigen).
 */
function setPriority(pid, level, setter = os.setPriority) {
  if (!LEVELS.includes(level)) return { ok: false, error: 'bad-level' };
  try {
    setter(pid, LEVEL_VALUE[level]);
    return { ok: true };
  } catch (e) {
    const code = e && (e.code || e.errno);
    return { ok: false, error: code === 'EACCES' || code === 'EPERM' || /permission|denied|EACCES|EPERM/i.test(String(e && e.message)) ? 'admin' : code === 'ESRCH' ? 'gone' : 'failed' };
  }
}

/**
 * Mac: Programm in den "Hintergrund-Modus" schicken (wie macOS es selbst mit Hintergrund-Aufgaben macht:
 * weniger CPU, gedrosselte Festplatte). Anders als "nice" lässt sich das ohne Admin-Rechte wieder aufheben.
 */
function setBackground(pid, on, runner = require('node:child_process').execFileSync) {
  if (!Number.isInteger(pid) || pid <= 4) return { ok: false, error: 'bad' };
  try {
    runner('/usr/sbin/taskpolicy', [on ? '-b' : '-B', '-p', String(pid)], { timeout: 3000, stdio: 'ignore' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: /EPERM|not permitted/i.test(String(e && (e.stderr || e.message))) ? 'admin' : 'failed' };
  }
}

// ------------------------------------------------------------------ Beenden
/**
 * Prozesse beenden. Erst freundlich (SIGTERM – Programme können noch speichern), Windows beendet sofort.
 * @returns {{ok:number, failed:number, error?:string}}
 */
function killPids(pids, killer = process.kill.bind(process)) {
  let ok = 0;
  let failed = 0;
  let error;
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid <= 4 || pid === process.pid) {
      failed++;
      continue;
    }
    try {
      killer(pid, 'SIGTERM');
      ok++;
    } catch (e) {
      if (e && e.code === 'ESRCH') ok++; // schon weg = Ziel erreicht
      else {
        failed++;
        error = e && (e.code === 'EPERM' || e.code === 'EACCES') ? 'admin' : 'failed';
      }
    }
  }
  return { ok, failed, error };
}

module.exports = { appName, classify, normalize, group, isProtected, priorityLevel, niceLevel, exePath, getPriority, setPriority, setBackground, killPids, LEVELS, LEVEL_VALUE, GAME_DIRS, NOT_GAMES };
