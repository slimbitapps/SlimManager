'use strict';
/**
 * Sammelt die Messwerte des Computers (CPU, RAM, GPU, Netzwerk, Festplatte, Akku, Prozesse).
 *  - Sparsam: Schnelle Werte jede Sekunde nur, solange jemand zuschaut (Fenster offen, Handy, Mini-Anzeige),
 *    sonst alle 5 Sekunden. Langsame Werte alle 15 s. GPU- und Prozess-Abfragen nur bei Bedarf.
 *  - Verlauf der letzten 5 Minuten für die Diagramme.
 *  - Jeder Messwert darf fehlen (null) – z. B. Temperaturen ohne Admin-Rechte.
 */
const { EventEmitter } = require('node:events');
const { execFile, spawn } = require('node:child_process');
const os = require('node:os');

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
  constructor({ si = require('systeminformation'), platform = process.platform, interval = 1000 } = {}) {
    super();
    this.si = si;
    this.platform = platform;
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
    if (changed && this.platform === 'win32') on ? this.startWinGpu() : this.stopWinGpu();
    if (faster && this.running) this.loop(); // sofort im neuen Takt
  }

  stop() {
    this.running = false;
    this.timers.forEach(clearInterval);
    this.timers = [];
    clearTimeout(this.loopTimer);
    this.stopWinGpu();
    if (this.platform === 'win32') {
      try {
        this.si.powerShellRelease?.();
      } catch {
        /* egal */
      }
    }
  }

  /**
   * Wie oft die Prozessliste gebraucht wird: 'fast' (Liste offen, Handy, Boost), 'slow' (nur automatische
   * Spiel-Erkennung) oder 'off'. Die Liste ist die teuerste Messung – deshalb so selten wie möglich.
   */
  setWanted(level) {
    level = level === true ? 'fast' : level === 'slow' ? 'slow' : level ? 'fast' : 'off';
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
      const netNow = !this.prevNet || Date.now() - this.prevNet.t >= (win ? 1900 : 950);
      const [load, mem, net, disk, speed] = await Promise.all([
        safe(() => this.si.currentLoad()),
        win ? Promise.resolve({ total: os.totalmem(), active: os.totalmem() - os.freemem(), swaptotal: this.slow.swapTotal, swapused: this.slow.swapUsed }) : safe(() => this.si.mem()),
        netNow ? safe(() => this.si.networkStats('*')) : Promise.resolve(null),
        win || (this.prevDisk && Date.now() - this.prevDisk.t < 950) ? Promise.resolve(null) : safe(() => this.si.disksIO()),
        safe(() => this.si.cpuCurrentSpeed()),
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
    const [fs, bat, temp, mem] = await Promise.all([
      safe(() => this.si.fsSize()),
      safe(() => this.si.battery()),
      safe(() => this.si.cpuTemperature()),
      win ? safe(() => this.si.mem()) : Promise.resolve(null),
    ]);
    if (mem) {
      this.slow.swapTotal = mem.swaptotal || 0;
      this.slow.swapUsed = mem.swapused || 0;
    }
    if (Array.isArray(fs)) this.slow.disks = cleanDisks(fs, this.platform);
    this.slow.battery = bat && bat.hasBattery ? { pct: round(bat.percent, 0), charging: !!bat.isCharging, plugged: !!bat.acConnected } : null;
    const tc = temp && (temp.main || temp.max);
    this.slow.cpuTemp = tc && tc > 0 && tc < 130 ? round(tc, 0) : null;
  }

  // ------------------------------------------------------------------ Prozesse
  async procTick(force = false) {
    if (!force) {
      if (this.procLevel === 'off') return;
      if (this.procLevel === 'slow' && Date.now() - this.procsAt < 9_500) return;
    }
    if (this.procBusy) return;
    this.procBusy = true;
    try {
      const p = await this.si.processes();
      this.procsAt = Date.now();
      this.procs = Array.isArray(p?.list) ? p.list : [];
      this.slow.procCount = p?.all ?? this.procs.length;
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
      this.timers.push(setInterval(read, 2000));
    } else if (this.platform === 'win32' && this.live) {
      this.startWinGpu();
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

  /**
   * Windows: GPU-Auslastung wie im Task-Manager – über Leistungsindikatoren, die bei allen Herstellern
   * funktionieren. Die WMI-Klassennamen sind (anders als Get-Counter) in jeder Windows-Sprache gleich.
   */
  startWinGpu() {
    if (this.gpuProc) return;
    const script = [
      '$ErrorActionPreference="SilentlyContinue"',
      'while($true){',
      ' $e=Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Where-Object { $_.Name -like "*engtype_3D*" }',
      ' $u=($e | Measure-Object -Property UtilizationPercentage -Sum).Sum',
      ' $m=(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory | Measure-Object -Property DedicatedUsage -Maximum).Maximum',
      ' [Console]::Out.WriteLine("GPU " + [int]$u + " " + [int64]$m)',
      ' Start-Sleep -Milliseconds 2000',
      '}',
    ].join('\n');
    try {
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      this.gpuProc = p;
      let buf = '';
      p.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          const m = /^GPU (\d+) (\d+)$/.exec(line);
          if (!m) continue;
          if (!this.hasSmi) this.gpu.util = Math.min(100, Number(m[1]));
          if (!this.hasSmi && Number(m[2]) > 0) this.gpu.memUsed = Number(m[2]);
        }
      });
      p.on('error', () => {});
      p.on('exit', () => this.gpuProc === p && (this.gpuProc = null));
    } catch {
      /* ohne GPU-Werte weiter */
    }
  }

  stopWinGpu() {
    const p = this.gpuProc;
    this.gpuProc = null;
    try {
      p?.kill();
    } catch {
      /* egal */
    }
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
