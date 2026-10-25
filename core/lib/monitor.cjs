'use strict';
/**
 * Sammelt die Messwerte des Computers (CPU, RAM, GPU, Netzwerk, Festplatte, Akku, Prozesse).
 *  - Sparsam: Schnelle Werte jede Sekunde nur, solange jemand zuschaut (Fenster offen, Handy, Mini-Anzeige),
 *    sonst alle 5 Sekunden. Langsame Werte alle 15 s. GPU- und Prozess-Abfragen nur bei Bedarf.
 *  - Verlauf der letzten 5 Minuten für die Diagramme.
 *  - Jeder Messwert darf fehlen (null) – z. B. Temperaturen ohne Admin-Rechte.
 */
const { EventEmitter } = require('node:events');
const { execFile } = require('node:child_process');
const os = require('node:os');
const { WinSampler } = require('./winsampler.cjs');
const { MacSampler } = require('./macsampler.cjs');

const HISTORY = 300; // 5 Minuten bei 1 Messung pro Sekunde
const HISTORY_KEYS = ['cpu', 'ram', 'gpu', 'gpuMem', 'cpuTemp', 'gpuTemp', 'netDown', 'netUp', 'diskRead', 'diskWrite', 'swap'];

/** Fester Ringpuffer – alte Werte fallen hinten raus. */
class Ring {
  constructor(size = HISTORY) {
    this.size = size;
    this.buf = [];
  }
  push(v) {
    this.buf.push(v ?? null);
    if (this.buf.length > this.size) this.buf.splice(0, this.buf.length - this.size);
  }
  last(n = this.size) {
    return this.buf.slice(-n);
  }
}

const round = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10 ** d) / 10 ** d);
const clampPct = (v) => (v === null ? null : Math.min(100, Math.max(0, v)));

/** Aus zwei Zählerständen eine Rate pro Sekunde berechnen. */
function rate(prev, cur, dtMs) {
  if (prev === null || prev === undefined || cur === null || cur === undefined || dtMs <= 0 || cur < prev) return null;
  return ((cur - prev) * 1000) / dtMs;
}

class Monitor extends EventEmitter {
  /**
   * @param {{si?: any, platform?: string, interval?: number}} [opts]
   *   si = systeminformation (im Test durch eine Attrappe ersetzbar)
   */
  constructor({ si = require('systeminformation'), platform = process.platform, interval = 1000, winSampler, macSampler } = {}) {
    super();
    this.si = si;
    this.platform = platform;
    // Windows: eigener, sparsamer Mess-Helfer statt vieler WMI-Abfragen
    this.ws = platform === 'win32' ? winSampler || new WinSampler() : null;
    // Mac: eigener Helfer – systeminformation würde für fast jeden Wert ein Programm starten
    this.mac = platform === 'darwin' ? macSampler || new MacSampler() : null;
    this.gpuPerPid = new Map();
    this.gpuPerPidAt = 0;
    this.slowAt = { fs: 0, bat: 0, temp: 0, tempMiss: 0 };
    this.interval = interval;
    this.history = Object.fromEntries(HISTORY_KEYS.map((k) => [k, new Ring()]));
    this.snap = null;
    this.static = null;
    this.procs = [];
    this.procsAt = 0;
    this.procLevel = 'off'; // 'fast' = alle 2 s, 'slow' = alle 10 s (Spiel-Erkennung), 'off' = gar nicht
    this.live = true; // schaut gerade jemand zu?
    this.slow = { disks: [], battery: null, cpuTemp: null, procCount: null };
    this.gpu = { util: null, temp: null, memUsed: null, memTotal: null };
    this.prevNet = null;
    this.prevDisk = null;
    this.timers = [];
    this.running = false;
    this.busy = false;
  }

  // ------------------------------------------------------------------ Start/Stopp
  async start() {
    if (this.running) return;
    this.running = true;
    if (this.platform === 'win32') {
      try {
        this.si.powerShellStart?.(); // eine dauerhafte PowerShell statt einer pro Messung
      } catch {
        /* egal */
      }
    }
    this.static = await this.readStatic();
    await this.tick();
    this.slowTick();
    this.procTick();
    this.loop();
    this.timers.push(setInterval(() => this.slowTick(), 15_000));
    this.timers.push(setInterval(() => this.procTick(), 2_000));
    this.startGpu();
  }

  /** Nächste Messung planen: 1 s, wenn jemand zuschaut, sonst 5 s */
  loop() {
    clearTimeout(this.loopTimer);
    if (!this.running) return;
    this.loopTimer = setTimeout(async () => {
      await this.tick();
      this.loop();
    }, this.live ? this.interval : 5000);
  }

  /**
   * Schaut jemand zu? Ohne Zuschauer misst SlimManager alle 5 s und fragt die GPU gar nicht ab.
   * interval = gewünschte Aktualisierung, solange jemand hinschaut (250 / 500 / 1000 ms).
   */
  setLive(on, interval = this.interval) {
    on = !!on;
    const faster = on && (!this.live || interval < this.interval);
    const changed = on !== this.live;
    this.interval = interval;
    this.live = on;
    if (faster && this.running) this.loop(); // sofort im neuen Takt
  }

  stop() {
    this.running = false;
    this.timers.forEach(clearInterval);
    this.timers = [];
    clearTimeout(this.loopTimer);
    this.ws?.stop();
    if (this.platform === 'win32') {
      try {
        this.si.powerShellRelease?.();
      } catch {
        /* egal */
      }
    }
  }

  /**
   * Wie oft die Prozessliste gebraucht wird: 'fast' (Liste offen, Handy, Boost – alle 2 s), 'medium' (nur die
   * Top-Prozesse-Kachel – alle 5 s), 'slow' (nur automatische Spiel-Erkennung – alle 10 s) oder 'off'. Die Liste ist die teuerste Messung – deshalb so selten wie möglich.
   */
  setWanted(level) {
    level = ['fast', 'medium', 'slow'].includes(level) ? level : level === true ? 'fast' : 'off';
    const was = this.procLevel;
    this.procLevel = level;
    if (level === 'fast' && was !== 'fast' && this.running && Date.now() - this.procsAt > 1500) this.procTick(true);
  }

  // ------------------------------------------------------------------ Feste Daten
  async readStatic() {
    const safe = (p, d) => Promise.resolve().then(() => p()).catch(() => d);
    const [cpu, osInfo, graphics, mem] = await Promise.all([
      safe(() => this.si.cpu(), {}),
      safe(() => this.si.osInfo(), {}),
      safe(() => this.si.graphics(), { controllers: [] }),
      safe(() => this.si.mem(), {}),
    ]);
    const gpus = (graphics.controllers || []).filter((c) => c && c.model);
    // Die "größte" Grafikkarte ist meist die fürs Spielen
    const main = [...gpus].sort((a, b) => (b.vram || 0) - (a.vram || 0))[0] || null;
    if (main && main.vram) this.gpu.memTotal = main.vram * 1024 * 1024;
    return {
      cpu: [cpu.manufacturer, cpu.brand].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || os.cpus()[0]?.model || '',
      cores: cpu.cores || os.cpus().length,
      physicalCores: cpu.physicalCores || null,
      gpu: main ? main.model : '',
      gpus: gpus.map((g) => g.model),
      os: [osInfo.distro, osInfo.release].filter(Boolean).join(' '),
      host: os.hostname().split('.')[0], // ohne ".fritz.box" o. Ä.
      ramTotal: mem.total || os.totalmem(),
    };
  }

  // ------------------------------------------------------------------ Schnelle Werte (jede Sekunde)
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const safe = (p) => Promise.resolve().then(p).catch(() => null);
      const win = this.platform === 'win32';
      // Windows: Netzwerk/Speicher kosten dort je eine WMI-Abfrage → Netzwerk nur jede 2. Messung,
      // RAM direkt vom System (Auslagerung kommt mit den langsamen Werten)
      // Netzwerk höchstens 1× pro Sekunde (Windows: höchstens alle 2 s) – auch wenn die Anzeige schneller läuft
      const mac = this.mac;
      const netNow = !this.prevNet || Date.now() - this.prevNet.t >= (win || mac ? 1900 : 950);
      // Festplatte am Mac/Linux höchstens alle 5 s (startet jedes Mal ein Programm), unter Windows gar nicht
      const diskNow = !win && (!this.prevDisk || Date.now() - this.prevDisk.t >= (mac ? 4900 : 950));
      const mc = mac ? mac.cpu() : null;
      const [load, mem, net, disk, speed] = await Promise.all([
        mc ? Promise.resolve({ currentLoad: mc.total, cpus: mc.cores.map((l) => ({ load: l })) }) : safe(() => this.si.currentLoad()),
        win
          ? Promise.resolve({ total: os.totalmem(), active: os.totalmem() - os.freemem(), swaptotal: this.slow.swapTotal, swapused: this.slow.swapUsed })
          : mac
            ? safe(() => mac.memory())
            : safe(() => this.si.mem()),
        !netNow
          ? Promise.resolve(null)
          : win || mac
            ? safe(() => (win ? this.ws : mac).net().then((n) => (n ? [{ rx_bytes: n.rx, tx_bytes: n.tx }] : null)))
            : safe(() => this.si.networkStats('*')),
        diskNow ? safe(() => this.si.disksIO()) : Promise.resolve(null),
        mc ? Promise.resolve({ avg: mc.speed }) : safe(() => this.si.cpuCurrentSpeed()),
      ]);
      const now = Date.now();

      // Netzwerk: alle echten Adapter zusammenzählen
      let netDown = netNow ? null : this.snap?.netDown ?? null;
      let netUp = netNow ? null : this.snap?.netUp ?? null;
      if (Array.isArray(net) && net.length) {
        const rx = net.reduce((s, n) => s + (Number(n.rx_bytes) || 0), 0);
        const tx = net.reduce((s, n) => s + (Number(n.tx_bytes) || 0), 0);
        if (this.prevNet) {
          netDown = rate(this.prevNet.rx, rx, now - this.prevNet.t);
          netUp = rate(this.prevNet.tx, tx, now - this.prevNet.t);
        }
        this.prevNet = { rx, tx, t: now };
      }
      // Festplatte: gelesene/geschriebene Bytes (wenn das System sie liefert), sonst Vorgänge
      let diskRead = disk ? null : this.snap?.diskRead ?? null;
      let diskWrite = disk ? null : this.snap?.diskWrite ?? null;
      if (disk) {
        const r = disk.rIO ?? null;
        const w = disk.wIO ?? null;
        if (this.prevDisk && r !== null) {
          diskRead = rate(this.prevDisk.r, r, now - this.prevDisk.t);
          diskWrite = rate(this.prevDisk.w, w, now - this.prevDisk.t);
        }
        this.prevDisk = { r, w, t: now };
      }

      const ramTotal = mem?.total || this.static?.ramTotal || null;
      // "active" entspricht dem, was der Task-Manager als belegt zeigt
      const ramUsed = mem ? mem.active ?? mem.used : null;
      const snap = {
        t: now,
        cpu: clampPct(round(load?.currentLoad)),
        cores: Array.isArray(load?.cpus) ? load.cpus.map((c) => clampPct(round(c.load, 0))) : [],
        cpuSpeed: round(speed?.avg, 2),
        cpuTemp: this.slow.cpuTemp,
        ram: ramTotal && ramUsed !== null ? clampPct(round((ramUsed / ramTotal) * 100)) : null,
        ramUsed,
        ramTotal,
        swap: mem && mem.swaptotal ? clampPct(round((mem.swapused / mem.swaptotal) * 100)) : null,
        swapUsed: mem ? mem.swapused ?? null : null,
        gpu: this.gpu.util,
        gpuTemp: this.gpu.temp,
        gpuMemUsed: this.gpu.memUsed,
        gpuMemTotal: this.gpu.memTotal,
        gpuMem: this.gpu.memUsed !== null && this.gpu.memTotal ? clampPct(round((this.gpu.memUsed / this.gpu.memTotal) * 100)) : null,
        netDown: round(netDown, 0),
        netUp: round(netUp, 0),
        diskRead: round(diskRead, 0),
        diskWrite: round(diskWrite, 0),
        disks: this.slow.disks,
        battery: this.slow.battery,
        procCount: this.slow.procCount,
        uptime: Math.round(os.uptime()),
      };
      // Verlauf immer im Sekundentakt (auch bei schnellerer Anzeige), damit Diagramme 5 Minuten zeigen
      if (!this.histAt || now - this.histAt >= 950) {
        this.histAt = now;
        for (const k of HISTORY_KEYS) this.history[k].push(snap[k]);
      }
      this.snap = snap;
      this.emit('stats', snap);
    } finally {
      this.busy = false;
    }
  }

  // ------------------------------------------------------------------ Langsame Werte (alle 15 s)
  async slowTick() {
    const safe = (p) => Promise.resolve().then(p).catch(() => null);
    const win = this.platform === 'win32';
    const now = Date.now();
    // Windows/Mac: Laufwerke/Akku starten Programme bzw. kosten WMI → nur jede Minute. Temperatur: fehlt sie 3×, nur noch alle 10 Minuten probieren
    const due = (k, ms) => (!win && !this.mac) || now - this.slowAt[k] >= ms;
    const wantTemp = this.slowAt.tempMiss < 3 || now - this.slowAt.temp >= 600_000;
    const [fs, bat, temp, mem] = await Promise.all([
      due('fs', 60_000) ? safe(() => this.si.fsSize()) : Promise.resolve(undefined),
      due('bat', 60_000) ? safe(() => this.si.battery()) : Promise.resolve(undefined),
      wantTemp ? safe(() => this.si.cpuTemperature()) : Promise.resolve(undefined),
      win ? safe(() => this.si.mem()) : Promise.resolve(null),
    ]);
    if (fs !== undefined) this.slowAt.fs = now;
    if (bat !== undefined) this.slowAt.bat = now;
    if (mem) {
      this.slow.swapTotal = mem.swaptotal || 0;
      this.slow.swapUsed = mem.swapused || 0;
    }
    if (Array.isArray(fs)) this.slow.disks = cleanDisks(fs, this.platform);
    if (bat !== undefined) this.slow.battery = bat && bat.hasBattery ? { pct: round(bat.percent, 0), charging: !!bat.isCharging, plugged: !!bat.acConnected } : null;
    if (temp !== undefined) {
      this.slowAt.temp = now;
      const tc = temp && (temp.main || temp.max);
      this.slow.cpuTemp = tc && tc > 0 && tc < 130 ? round(tc, 0) : null;
      this.slowAt.tempMiss = this.slow.cpuTemp === null ? this.slowAt.tempMiss + 1 : 0;
    }
  }

  // ------------------------------------------------------------------ Prozesse
  async procTick(force = false) {
    if (!force) {
      if (this.procLevel === 'off') return;
      if (this.procLevel === 'slow' && Date.now() - this.procsAt < 9_500) return;
    }
    // Nur die Top-Prozesse-Kachel offen → alle 5 s reicht
    if (!force && this.procLevel === 'medium' && Date.now() - this.procsAt < 4_500) return;
    if (this.procBusy) return;
    this.procBusy = true;
    try {
      let list = this.ws ? await this.ws.processes(this.static?.cores || os.cpus().length) : this.mac ? await this.mac.processes() : null;
      if (!list) {
        const p = await this.si.processes();
        list = Array.isArray(p?.list) ? p.list : [];
      }
      // GPU pro Prozess (Windows), wenn frisch gemessen
      if (this.gpuPerPid.size && Date.now() - this.gpuPerPidAt < 8000) for (const x of list) x.gpu = this.gpuPerPid.get(x.pid) ?? 0;
      this.procsAt = Date.now();
      this.procs = list;
      this.slow.procCount = list.length;
      this.emit('procs', this.procs);
    } catch {
      /* nächstes Mal */
    } finally {
      this.procBusy = false;
    }
  }

  // ------------------------------------------------------------------ Grafikkarte
  startGpu() {
    if (this.platform === 'darwin') {
      const read = () =>
        this.live &&
        execFile('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], { timeout: 4000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
          if (err) return;
          const g = parseIoreg(String(out));
          if (g.util !== null) this.gpu.util = g.util;
          if (g.memUsed !== null) this.gpu.memUsed = g.memUsed;
        });
      read();
      this.timers.push(setInterval(read, 3000));
    } else if (this.ws) {
      // Windows ohne NVIDIA: Leistungsindikatoren alle 3 s (nur wenn jemand zuschaut) – liefern GPU pro Prozess gratis mit
      // Mit NVIDIA: nvidia-smi für die Gesamtwerte, GPU pro Prozess nur, wenn die Prozessliste offen ist
      const read = async () => {
        if (!this.live || this.gpuBusy) return;
        this.gpuBusy = true;
        try {
          if (this.hasSmi) {
            if (this.procLevel !== 'fast') return;
            const per = await this.ws.pmon();
            if (per) {
              this.gpuPerPid = per;
              this.gpuPerPidAt = Date.now();
            }
            return;
          }
          if (this.noSmi === undefined) return; // erst abwarten, ob NVIDIA da ist
          const g = await this.ws.gpu();
          if (!g) return;
          this.gpu.util = g.util;
          if (g.memUsed) this.gpu.memUsed = g.memUsed;
          this.gpuPerPid = g.perPid;
          this.gpuPerPidAt = Date.now();
        } finally {
          this.gpuBusy = false;
        }
      };
      this.timers.push(setInterval(read, 3000));
    }
    // NVIDIA-Karten liefern über nvidia-smi auch Temperatur und Speicher (Windows & Linux)
    if (this.platform !== 'darwin') {
      const smi = () =>
        execFile('nvidia-smi', ['--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'], { timeout: 4000, windowsHide: true }, (err, out) => {
          if (err) {
            this.noSmi = (this.noSmi || 0) + 1;
            return;
          }
          const g = parseSmi(String(out));
          if (!g) return;
          Object.assign(this.gpu, g);
          this.hasSmi = true;
        });
      smi();
      this.timers.push(
        setInterval(() => {
          if (!this.live) return;
          if (!this.hasSmi && this.noSmi > 0) return; // kein NVIDIA → nicht ständig probieren
          smi();
        }, 2000),
      );
    }
  }

  /** Eigene Hilfsprozesse (für die Anzeige "SlimManager braucht selbst …") */
  childPids() {
    return this.ws ? this.ws.pids() : [];
  }

  // ------------------------------------------------------------------ Verlauf
  historyOf(n = 120) {
    return Object.fromEntries(HISTORY_KEYS.map((k) => [k, this.history[k].last(n)]));
  }
}

/** ioreg-Ausgabe (Mac) → GPU-Auslastung. Bei zwei Grafikchips zählt der höhere Wert. */
function parseIoreg(out) {
  const utils = [...out.matchAll(/"Device Utilization %"=(\d+)/g)].map((m) => Number(m[1]));
  const mem = [...out.matchAll(/"In use system memory"=(\d+)/g)].map((m) => Number(m[1]));
  return {
    util: utils.length ? Math.min(100, Math.max(...utils)) : null,
    memUsed: mem.length ? Math.max(...mem) : null,
  };
}

/** nvidia-smi-Zeile "37, 54, 1024, 8192" → Werte (Speicher in Bytes). */
function parseSmi(out) {
  const line = out.split(/\r?\n/).find((l) => l.trim());
  if (!line) return null;
  const [util, temp, used, total] = line.split(',').map((s) => Number(s.trim()));
  if (![util, temp].every(Number.isFinite)) return null;
  return { util: Math.min(100, util), temp, memUsed: Number.isFinite(used) ? used * 1048576 : null, memTotal: Number.isFinite(total) ? total * 1048576 : null };
}

/** Laufwerke für die Anzeige: keine System-Hilfsvolumes, keine Doppelten. */
function cleanDisks(list, platform) {
  const out = [];
  for (const d of list) {
    if (!d || !d.size) continue;
    const mount = String(d.mount || d.fs || '');
    if (platform === 'darwin' && (/^\/System\/Volumes\/(?!Data$)/.test(mount) || mount.startsWith('/private/') || mount.startsWith('/Library/Developer'))) continue;
    if (platform === 'linux' && /^\/(snap|boot|run|dev|sys|proc)/.test(mount)) continue;
    if (d.size < 1e9) continue; // kleiner als 1 GB: meist Hilfs-Partitionen
    out.push({ mount, label: platform === 'darwin' && mount === '/System/Volumes/Data' ? 'Macintosh HD' : mount, size: d.size, used: d.used, pct: round(d.use, 0) });
  }
  // Mac: "/" und "Data" zeigen dieselbe Platte → nur Data behalten
  if (platform === 'darwin' && out.some((d) => d.mount === '/System/Volumes/Data')) return out.filter((d) => d.mount !== '/').slice(0, 8);
  return out.slice(0, 8);
}

module.exports = { Monitor, Ring, rate, parseIoreg, parseSmi, cleanDisks, HISTORY_KEYS };
