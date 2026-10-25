'use strict';
/**
 * Game Boost: ein Spiel bekommt Vorrang.
 *  1. Spiel → Priorität "hoch" (am Mac ohne Admin nicht möglich – dann nur Schritt 2)
 *  2. Andere Apps & Hintergrundprogramme → "niedriger als normal"
 *  3. Optional: Apps von der eigenen "Beim Boost schließen"-Liste beenden
 * Beim Beenden des Boosts wird jede geänderte Priorität zurückgesetzt.
 * Mac: Bremsen über den Hintergrund-Modus von macOS – "nice" ließe sich ohne Admin nicht zurückdrehen.
 */
const { EventEmitter } = require('node:events');
const { isProtected, setPriority, setBackground, killPids } = require('./procs.cjs');

/**
 * Plan berechnen (ohne etwas zu verändern – gut testbar).
 * @param {ReturnType<import('./procs.cjs').normalize>} procs
 * @param {{targetApp: string, lowerOthers?: boolean, raiseGame?: boolean, closeList?: string[]}} opts
 */
function planBoost(procs, { targetApp, lowerOthers = true, raiseGame = true, closeList = [], anyPrio = false }) {
  const target = String(targetApp || '').toLowerCase();
  const close = new Set(closeList.map((n) => n.toLowerCase()));
  const raise = [];
  const lower = [];
  const kill = [];
  for (const p of procs) {
    const app = p.app.toLowerCase();
    if (app === target) {
      if (raiseGame && !isProtected(p)) raise.push(p.pid);
      continue;
    }
    if (isProtected(p)) continue;
    if (close.has(app) || close.has(p.name.toLowerCase())) {
      kill.push(p.pid);
      continue;
    }
    // Andere Spiele nicht bremsen (könnte z. B. ein Launcher-Spiel im Menü sein) – nur Apps & Hintergrund
    // anyPrio: Mac-Hintergrund-Modus wirkt unabhängig vom nice-Wert
    if (lowerOthers && (p.kind === 'app' || p.kind === 'background') && (anyPrio || p.prio === 'normal')) lower.push(p.pid);
  }
  return { raise, lower, kill };
}

class Boost extends EventEmitter {
  /** @param {{setter?: Function, killer?: Function, background?: Function|null}} [deps] im Test austauschbar */
  constructor({ setter, killer, background = process.platform === 'darwin' ? setBackground : null } = {}) {
    super();
    this.setter = setter;
    this.killer = killer;
    this.background = background; // Mac: (pid, on) => {ok}
    this.session = null; // { app, startedAt, changed: Map<pid, level>, auto, stats }
  }

  get active() {
    return !!this.session;
  }

  /** Boost starten (vorherigen vorher sauber beenden). */
  start(procs, opts) {
    if (this.session) this.stop();
    const plan = planBoost(procs, { ...opts, anyPrio: !!this.background });
    const changed = new Map();
    const result = { raised: 0, lowered: 0, closed: 0, raiseError: null };
    const set = (pid, level, before) => {
      const r = setPriority(pid, level, this.setter);
      if (r.ok) changed.set(pid, before);
      return r;
    };
    const byPid = new Map(procs.map((p) => [p.pid, p]));
    for (const pid of plan.raise) {
      const r = set(pid, 'high', byPid.get(pid)?.prio || 'normal');
      if (r.ok) result.raised++;
      else result.raiseError = r.error;
    }
    for (const pid of plan.lower) {
      if (this.background) {
        if (this.background(pid, true).ok) {
          changed.set(pid, 'bg');
          result.lowered++;
        }
      } else if (set(pid, 'below', byPid.get(pid)?.prio || 'normal').ok) result.lowered++;
    }
    if (plan.kill.length) result.closed = killPids(plan.kill, this.killer).ok;
    this.session = {
      app: opts.targetApp,
      startedAt: Date.now(),
      changed,
      auto: !!opts.auto,
      result,
      stats: { n: 0, cpu: 0, gpu: 0, gpuN: 0, maxCpuTemp: null, maxGpuTemp: null },
    };
    this.emit('change', this.state());
    return this.state();
  }

  /** Neue Prozesse des Spiels (z. B. nach dem Laden) ebenfalls hochstufen. */
  follow(procs) {
    if (!this.session) return;
    const app = this.session.app.toLowerCase();
    for (const p of procs) {
      if (p.app.toLowerCase() !== app || this.session.changed.has(p.pid) || isProtected(p) || p.prio !== 'normal') continue;
      if (setPriority(p.pid, 'high', this.setter).ok) this.session.changed.set(p.pid, 'normal');
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

  /** Boost beenden und alle Prioritäten zurücksetzen. Gibt die Zusammenfassung zurück. */
  stop() {
    const s = this.session;
    if (!s) return null;
    // beendete Prozesse: egal
    for (const [pid, level] of s.changed) {
      if (level === 'bg') this.background?.(pid, false);
      else setPriority(pid, level, this.setter);
    }
    this.session = null;
    const summary = {
      app: s.app,
      durationMs: Date.now() - s.startedAt,
      avgCpu: s.stats.n ? Math.round(s.stats.cpu / s.stats.n) : null,
      avgGpu: s.stats.gpuN ? Math.round(s.stats.gpu / s.stats.gpuN) : null,
      maxCpuTemp: s.stats.maxCpuTemp,
      maxGpuTemp: s.stats.maxGpuTemp,
      auto: s.auto,
    };
    this.emit('change', this.state());
    this.emit('summary', summary);
    return summary;
  }

  state() {
    const s = this.session;
    return s ? { active: true, app: s.app, startedAt: s.startedAt, auto: s.auto, ...s.result, changed: s.changed.size } : { active: false };
  }
}

/** Läuft ein Spiel? Gibt den App-Namen des "größten" laufenden Spiels zurück (oder null). */
function detectGame(groups) {
  const games = groups.filter((g) => g.kind === 'game').sort((a, b) => b.mem - a.mem);
  return games[0] ? games[0].name : null;
}

module.exports = { Boost, planBoost, detectGame };
