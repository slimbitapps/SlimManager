'use strict';
/**
 * Boost – zwei Modi:
 *  🎮 Gaming: Das Spiel bekommt alles. Spiel hoch, Rest runter, Hintergrund einfrieren, Kerne freihalten,
 *            Energieplan Höchstleistung, RAM der Hintergrund-Programme freigeben, Apps von der Liste schließen.
 *  💼 Fokus:  Arbeiten ohne Ballast. Hintergrund einfrieren/bremsen, Turbo aus (kühler, leiser Lüfter),
 *            Windows-Update & Co. pausieren, ablenkende Apps schließen.
 * Nie angefasst: System, SlimManager, Anti-Cheat, Spiele-Launcher und alles auf der Ausnahmen-Liste
 * (z. B. Kopfhörer-Software, Discord, OBS). Beim Beenden wird alles zurückgesetzt – siehe tweaks.cjs.
 */
const { EventEmitter } = require('node:events');
const { isProtected, setPriority, setBackground, killPids } = require('./procs.cjs');

/** Anti-Cheat: niemals anfassen (sonst fliegt man aus dem Spiel) */
const ANTI_CHEAT = /^(easyanticheat.*|eac.*launcher|beservice.*|battleye.*|bedaisy|vgc|vgtray|vanguard.*|faceit.*|esportal.*|gameguard.*|xigncode.*|npggsvc|ricochet.*|anticheat.*|eaanticheat.*|mhyprot.*|zakynthos.*)$/i;
/** Spiele-Launcher: bremsen ja, einfrieren/schließen nein (sonst brechen Overlay, Erfolge, Kopierschutz) */
const LAUNCHER = /^(steam|steamwebhelper|steamservice|gameoverlayui.*|epicgameslauncher|epicwebhelper|epiconlineservices.*|riotclient.*|battle\.net.*|agent|blizzard.*|eadesktop|eabackgroundservice|ealauncher.*|origin.*|upc|ubisoftconnect|uplaywebcore|ubisoftgamelauncher.*|galaxyclient.*|gog.*galaxy.*|xboxpcapp|xboxappservices|gamingservices.*|gamebar.*|robloxplayerlauncher|minecraftlauncher)(\.exe)?$/i;

/**
 * Bekannter Hintergrund-Ballast, der automatisch eingefroren werden darf: Updater, Cloud-Sync, Absturz-Melder,
 * Telemetrie, Hersteller-Helfer. Alles andere ohne Fenster (z. B. Kommandozeilen-Programme, Downloads,
 * Entwickler-Werkzeuge) wird höchstens gebremst – einfrieren nur, wenn man es selbst auf die Liste setzt.
 */
const BALLAST = /(updat|crashpad|crashhandler|crashreport|telemetry|onedrive|dropbox|googledrivefs|google ?drive|icloud|adobe ?ipc|adobe ?desktop ?service|armsvc|acrotray|creative ?cloud|ccxprocess|cclibrary|coresync|cortana|widgets|phoneexperiencehost|yourphone|phonelink|skypebridge|keystone|jusched|jucheck|ituneshelper|lenovo ?vantage|supportassist|armoury ?crate|nvtelemetry|ms-teams.*update|teams.*background)/i;

/** Standard-Ausnahmen: Programme, die man beim Zocken/Arbeiten typischerweise nebenbei braucht */
const DEFAULT_EXCEPTIONS = [
  'Discord', 'Spotify', 'OBS', 'Streamlabs', 'TeamSpeak', 'Mumble', 'NVIDIA Broadcast', 'Logitech G HUB', 'Razer', 'SteelSeries',
  'Corsair iCUE', 'HyperX NGENUITY', 'Voicemeeter', 'Elgato', 'MSI Afterburner', 'RTSS', 'Wallpaper Engine',
];
/** Weitere Schreibweisen (Programm-Datei heißt oft anders als das Produkt) */
const ALIASES = {
  logitechghub: ['lghub', 'logitechg'],
  corsairicue: ['icue'],
  hyperxngenuity: ['ngenuity'],
  elgato: ['wavelink', 'streamdeck', 'camerahub', 'elgato'],
  msiafterburner: ['afterburner'],
  rtss: ['rtss', 'rivatuner', 'encoderserver'],
  nvidiabroadcast: ['nvidiabroadcast', 'nvbroadcast'],
  obs: ['obs64', 'obs32', 'obs'],
  steelseries: ['steelseries', 'sonar'],
  razer: ['razer', 'rzsdk', 'rzchroma'],
  wallpaperengine: ['wallpaper32', 'wallpaper64', 'wallpaperengine'],
};

const norm = (s) => String(s || '').toLowerCase().replace(/\.exe$/, '').replace(/[^a-z0-9]/g, '');

/** Passt ein Listen-Eintrag (z. B. "Logitech G HUB") zu einem Prozess (App-Name oder Datei)? */
function matches(entry, p) {
  const e = norm(entry);
  if (e.length < 2) return false;
  const keys = [e, ...(ALIASES[e] || [])];
  const targets = [norm(p.app), norm(p.name)];
  return keys.some((k) => targets.some((t) => t === k || (k.length >= 3 && t.includes(k))));
}
const inList = (list, p) => (list || []).some((e) => matches(e, p));

/**
 * Plan berechnen (ohne etwas zu verändern – gut testbar).
 * @param {ReturnType<import('./procs.cjs').normalize>} procs
 * @param {{mode?: 'game'|'focus', targetApp?: string, cfg?: any, exceptions?: string[], anyPrio?: boolean}} opts
 */
function planBoost(procs, { mode = 'game', targetApp = '', cfg = {}, exceptions = [], anyPrio = false } = {}) {
  const target = String(targetApp || '').toLowerCase();
  const plan = { raise: [], lower: [], freeze: [], kill: [], cores: [], trim: [], kept: [] };
  // Art einer ganzen App: "Hintergrund" nur, wenn ALLE ihre Prozesse Hintergrund sind (sonst würde z. B. ein Browser-Helfer eingefroren)
  const RANK = { game: 3, app: 2, background: 1 };
  const appKind = new Map();
  for (const p of procs) {
    if (!RANK[p.kind]) continue;
    const k = appKind.get(p.app);
    if (!k || RANK[p.kind] > RANK[k]) appKind.set(p.app, p.kind);
  }
  for (const p of procs) {
    const isTarget = target && p.app.toLowerCase() === target;
    if (isTarget) {
      if (mode === 'game' && cfg.raiseGame !== false && !isProtected(p)) plan.raise.push(p.pid);
      continue;
    }
    if (isProtected(p) || ANTI_CHEAT.test(p.name)) continue;
    if (inList(exceptions, p)) {
      plan.kept.push(p.pid);
      continue;
    }
    const launcher = LAUNCHER.test(p.name);
    if (!launcher && inList(cfg.closeList, p)) {
      plan.kill.push(p.pid);
      continue;
    }
    // Andere Spiele nur bremsen, nie einfrieren (könnte das Spiel selbst sein, z. B. ein zweiter Prozess)
    const other = p.kind === 'app' || p.kind === 'background';
    if (!other) continue;
    // Automatisch nur bekannter Ballast, und nur wenn die ganze App im Hintergrund läuft (kein Browser-Helfer o. Ä.)
    const ballast = cfg.freezeBg && appKind.get(p.app) === 'background' && BALLAST.test(`${p.name} ${p.app}`);
    const freeze = !launcher && (inList(cfg.freezeList, p) || ballast);
    if (freeze) plan.freeze.push(p.pid);
    if (cfg.lowerOthers !== false && (anyPrio || p.prio === 'normal') && !freeze) plan.lower.push(p.pid);
    if (mode === 'game' && cfg.cores && !freeze) plan.cores.push(p.pid);
    if (mode === 'game' && cfg.trimRam) plan.trim.push(p.pid);
  }
  return plan;
}

class Boost extends EventEmitter {
  /**
   * @param {{setter?: Function, killer?: Function, background?: Function|null, tweaks?: any}} [deps] im Test austauschbar
   *   tweaks = Einfrieren/Kerne/Energieplan/Dienste (tweaks.cjs)
   */
  constructor({ setter, killer, background = process.platform === 'darwin' ? setBackground : null, tweaks = null } = {}) {
    super();
    this.setter = setter;
    this.killer = killer;
    this.background = background; // Mac: (pid, on) => {ok}
    this.tweaks = tweaks;
    this.session = null;
    this.busy = Promise.resolve();
  }

  get active() {
    return !!this.session;
  }

  /** Nacheinander ausführen (Start/Stopp dürfen sich nicht überholen) */
  queue(fn) {
    const run = this.busy.then(fn, fn);
    this.busy = run.catch(() => {});
    return run;
  }

  /**
   * Boost starten (vorherigen vorher sauber beenden).
   * @param {any[]} procs normalisierte Prozessliste
   * @param {{mode?: 'game'|'focus', targetApp?: string, cfg?: any, exceptions?: string[], auto?: boolean}} opts
   */
  start(procs, opts) {
    return this.queue(async () => {
      if (this.session) await this.doStop(false);
      const mode = opts.mode === 'focus' ? 'focus' : 'game';
      const cfg = opts.cfg || {};
      const plan = planBoost(procs, { ...opts, mode, cfg, anyPrio: !!this.background });
      const changed = new Map();
      const result = { raised: 0, lowered: 0, closed: 0, frozen: 0, cores: 0, trimmed: 0, kept: plan.kept.length, power: null, services: null, raiseError: null };
      const byPid = new Map(procs.map((p) => [p.pid, p]));
      const session = { mode, app: opts.targetApp || '', startedAt: Date.now(), changed, frozen: [], cores: [], auto: !!opts.auto, result, cfg, exceptions: opts.exceptions || [], seen: new Set(procs.map((p) => p.pid)), stats: { n: 0, cpu: 0, gpu: 0, gpuN: 0, maxCpuTemp: null, maxGpuTemp: null } };
      this.session = session;

      // 1. Prioritäten
      for (const pid of plan.raise) {
        const r = setPriority(pid, 'high', this.setter);
        if (r.ok) {
          changed.set(pid, byPid.get(pid)?.prio || 'normal');
          result.raised++;
        } else result.raiseError = r.error;
      }
      for (const pid of plan.lower) if (this.lowerOne(pid, byPid.get(pid)?.prio)) result.lowered++;
      // 2. Schließen
      if (plan.kill.length) result.closed = killPids(plan.kill, this.killer).ok;
      // 3. Einfrieren, Kerne, RAM
      if (this.tweaks) {
        session.frozen = await this.tweaks.freeze(plan.freeze);
        result.frozen = session.frozen.length;
        if (plan.cores.length) {
          session.cores = await this.tweaks.limitCores(plan.cores);
          result.cores = session.cores.length;
        }
        if (plan.trim.length) result.trimmed = await this.tweaks.trim(plan.trim);
        // 4. Energieplan
        if (mode === 'game' && cfg.power) result.power = await this.tweaks.power('high');
        if (mode === 'focus' && cfg.quiet) result.power = await this.tweaks.power('quiet');
      }
      this.emit('change', this.state());
      // 5. Dienste (fragt nach Admin-Rechten – nicht auf die Antwort warten)
      if (this.tweaks && cfg.services) {
        result.services = 'asking';
        this.tweaks.pauseServices().then((r) => {
          if (this.session !== session) return this.tweaks.resumeServices();
          result.services = r.ok ? r.stopped ?? 'ok' : r.error;
          this.emit('change', this.state());
        });
      }
      return this.state();
    });
  }

  lowerOne(pid, prio = 'normal') {
    const s = this.session;
    if (this.background) {
      if (this.background(pid, true).ok) {
        s.changed.set(pid, 'bg');
        this.tweaks?.noteBackground?.(pid, true);
        return true;
      }
      return false;
    }
    if (setPriority(pid, 'below', this.setter).ok) {
      s.changed.set(pid, prio || 'normal');
      return true;
    }
    return false;
  }

  /** Neue Prozesse: Teile des Spiels hochstufen, neu gestartete Hintergrund-Programme (z. B. Updater) gleich mitbehandeln */
  follow(procs) {
    const s = this.session;
    if (!s) return;
    const fresh = procs.filter((p) => !s.seen.has(p.pid));
    if (!fresh.length) return;
    fresh.forEach((p) => s.seen.add(p.pid));
    const plan = planBoost(fresh, { mode: s.mode, targetApp: s.app, cfg: { ...s.cfg, closeList: [] }, exceptions: s.exceptions, anyPrio: !!this.background });
    for (const pid of plan.raise) if (setPriority(pid, 'high', this.setter).ok) s.changed.set(pid, 'normal');
    for (const pid of plan.lower) this.lowerOne(pid, 'normal');
    if (this.tweaks && plan.freeze.length) {
      this.queue(async () => {
        if (this.session !== s) return;
        const f = await this.tweaks.freeze(plan.freeze);
        s.frozen.push(...f);
        s.result.frozen += f.length;
      });
    }
  }

  /** Messwerte während des Boosts mitschreiben (für die Zusammenfassung). */
  record(snap) {
    const s = this.session?.stats;
    if (!s || !snap) return;
    if (snap.cpu !== null) {
      s.n++;
      s.cpu += snap.cpu;
    }
    if (snap.gpu !== null) {
      s.gpuN++;
      s.gpu += snap.gpu;
    }
    if (snap.cpuTemp !== null) s.maxCpuTemp = Math.max(s.maxCpuTemp ?? 0, snap.cpuTemp);
    if (snap.gpuTemp !== null) s.maxGpuTemp = Math.max(s.maxGpuTemp ?? 0, snap.gpuTemp);
  }

  /** Wirkung festhalten (vorher/nachher, von main.cjs gemessen) */
  setEffect(effect) {
    if (!this.session) return;
    this.session.result.effect = effect;
    this.emit('change', this.state());
  }

  /** Boost beenden und alles zurücksetzen. Gibt die Zusammenfassung zurück. */
  stop() {
    return this.queue(() => this.doStop(true));
  }

  async doStop(emitSummary) {
    const s = this.session;
    if (!s) return null;
    this.session = null;
    if (this.tweaks) {
      this.tweaks.resumeServices();
      await this.tweaks.restorePower();
      await this.tweaks.restoreCores(s.cores);
      await this.tweaks.unfreeze(s.frozen);
    }
    // beendete Prozesse: egal
    for (const [pid, level] of s.changed) {
      if (level === 'bg') {
        this.background?.(pid, false);
        this.tweaks?.noteBackground?.(pid, false);
      } else setPriority(pid, level, this.setter);
    }
    const summary = {
      mode: s.mode,
      app: s.app,
      durationMs: Date.now() - s.startedAt,
      avgCpu: s.stats.n ? Math.round(s.stats.cpu / s.stats.n) : null,
      avgGpu: s.stats.gpuN ? Math.round(s.stats.gpu / s.stats.gpuN) : null,
      maxCpuTemp: s.stats.maxCpuTemp,
      maxGpuTemp: s.stats.maxGpuTemp,
      frozen: s.result.frozen,
      closed: s.result.closed,
      effect: s.result.effect || null,
      auto: s.auto,
    };
    this.emit('change', this.state());
    if (emitSummary) this.emit('summary', summary);
    return summary;
  }

  state() {
    const s = this.session;
    return s ? { active: true, mode: s.mode, app: s.app, startedAt: s.startedAt, auto: s.auto, ...s.result, changed: s.changed.size } : { active: false };
  }
}

/** Läuft ein Spiel? Gibt den App-Namen des "größten" laufenden Spiels zurück (oder null). */
function detectGame(groups) {
  const games = groups.filter((g) => g.kind === 'game').sort((a, b) => b.mem - a.mem);
  return games[0] ? games[0].name : null;
}

module.exports = { Boost, planBoost, detectGame, matches, DEFAULT_EXCEPTIONS, ANTI_CHEAT, LAUNCHER, BALLAST };
