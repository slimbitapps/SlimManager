'use strict';
/**
 * Mac: sparsame Messungen. systeminformation startet am Mac für fast jeden Wert ein eigenes Programm
 * (oft über eine Shell) – mehrmals pro Sekunde kostet das spürbar CPU. Hier stattdessen:
 *  - CPU & Kerne: direkt aus os.cpus() (kein Programm)
 *  - Arbeitsspeicher: vm_stat + sysctl alle 5 s
 *  - Netzwerk: ein netstat-Aufruf alle 2 s
 *  - Prozessliste: ein ps-Aufruf (statt mehrerer)
 * Alle Programme werden direkt gestartet (execFile), nie über eine Shell.
 */
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

/** CPU-Last aus zwei os.cpus()-Ständen: gesamt und pro Kern in % */
function cpuLoad(prev, cur) {
  const cores = cur.map((c, i) => {
    const p = prev?.[i];
    if (!p) return null;
    const t = (o) => o.times.user + o.times.nice + o.times.sys + o.times.irq + o.times.idle;
    const total = t(c) - t(p);
    const idle = c.times.idle - p.times.idle;
    return total > 0 ? Math.max(0, Math.min(100, ((total - idle) / total) * 100)) : 0;
  });
  const known = cores.filter((x) => x !== null);
  return { total: known.length ? known.reduce((a, b) => a + b, 0) / known.length : null, cores };
}

/** vm_stat → belegter Speicher wie in der Aktivitätsanzeige (App-Speicher + fest + komprimiert) */
function parseVmStat(out) {
  const page = Number(/page size of (\d+) bytes/.exec(out)?.[1]) || 4096;
  const get = (label) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(out)?.[1]) || 0;
  const active = get('Pages active');
  const wired = get('Pages wired down');
  const compressed = get('Pages occupied by compressor');
  const purgeable = get('Pages purgeable');
  if (!active && !wired) return null;
  return (active - purgeable + wired + compressed) * page;
}

/** "total = 1024.00M  used = 71.75M  free = 952.25M" → Bytes */
function parseSwap(out) {
  const unit = (v, u) => Number(v) * { K: 1024, M: 1048576, G: 1073741824 }[u || 'M'];
  const t = /total = ([\d.]+)([KMG])/.exec(out);
  const u = /used = ([\d.]+)([KMG])/.exec(out);
  return t && u ? { total: unit(t[1], t[2]), used: unit(u[1], u[2]) } : null;
}

/** netstat -ibn → Summe der empfangenen/gesendeten Bytes aller echten Adapter (ohne lo0) */
function parseNetstatMac(out) {
  const lines = String(out).trim().split('\n');
  const head = lines.shift()?.trim().split(/\s+/) || [];
  const iIn = head.indexOf('Ibytes');
  const iOut = head.indexOf('Obytes');
  if (iIn < 0 || iOut < 0) return null;
  const seen = new Set();
  let rx = 0;
  let tx = 0;
  for (const l of lines) {
    const f = l.trim().split(/\s+/);
    // Nur die "Link"-Zeile pro Adapter zählen (sonst doppelt)
    if (!f[2]?.startsWith('<Link') || f[0].startsWith('lo') || seen.has(f[0])) continue;
    seen.add(f[0]);
    // Ohne MAC-Adresse fehlt eine Spalte → von hinten rechnen
    const off = f.length - head.length;
    rx += Number(f[iIn + off]) || 0;
    tx += Number(f[iOut + off]) || 0;
  }
  return { rx, tx };
}

/** ps -axo pid,ppid,pcpu,rss,pri,nice,user,comm → Liste im Format von systeminformation */
function parsePs(out) {
  const list = [];
  for (const l of String(out).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(\S+)\s+(.+)$/.exec(l);
    if (!m) continue;
    const full = m[8].trim();
    list.push({
      pid: Number(m[1]),
      parentPid: Number(m[2]),
      cpu: Number(m[3]),
      memRss: Number(m[4]),
      priority: Number(m[5]),
      nice: Number(m[6]),
      user: m[7],
      name: path.posix.basename(full),
      path: full.includes('/') ? path.posix.dirname(full) : '',
      command: full,
    });
  }
  return list;
}

class MacSampler {
  constructor({ exec = execFile, cpus = os.cpus } = {}) {
    this.exec = exec;
    this.cpus = cpus;
    this.prevCpu = cpus();
    this.mem = null;
    this.memAt = 0;
  }

  run(cmd, args, maxBuffer = 2 * 1024 * 1024) {
    // LC_ALL=C: sonst schreibt z. B. ps bei deutscher Sprache "1,5" statt "1.5"
    return new Promise((resolve) => this.exec(cmd, args, { timeout: 5000, maxBuffer, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } }, (err, out) => resolve(err ? null : String(out))));
  }

  /** CPU gesamt + pro Kern seit dem letzten Aufruf – kostet praktisch nichts */
  cpu() {
    const cur = this.cpus();
    const r = cpuLoad(this.prevCpu, cur);
    this.prevCpu = cur;
    return { ...r, speed: cur[0]?.speed ? cur[0].speed / 1000 : null };
  }

  /** Arbeitsspeicher, höchstens alle 5 s neu gemessen */
  async memory() {
    if (this.mem && Date.now() - this.memAt < 4800) return this.mem;
    const [vm, sw] = await Promise.all([this.run('/usr/bin/vm_stat', []), this.run('/usr/sbin/sysctl', ['-n', 'vm.swapusage'])]);
    const used = vm ? parseVmStat(vm) : null;
    const swap = sw ? parseSwap(sw) : null;
    this.memAt = Date.now();
    // macOS legt die Auslagerung erst bei Bedarf an: "total = 0" heißt 0 % belegt (nicht "unbekannt")
    this.mem = { total: os.totalmem(), active: used ?? os.totalmem() - os.freemem(), swaptotal: swap ? Math.max(swap.total, 1) : 0, swapused: swap?.used || 0 };
    return this.mem;
  }

  async net() {
    const out = await this.run('/usr/sbin/netstat', ['-ibn']);
    return out ? parseNetstatMac(out) : null;
  }

  async processes() {
    const out = await this.run('/bin/ps', ['-axo', 'pid=,ppid=,pcpu=,rss=,pri=,nice=,user=,comm='], 8 * 1024 * 1024);
    return out ? parsePs(out) : null;
  }
}

module.exports = { MacSampler, cpuLoad, parseVmStat, parseSwap, parseNetstatMac, parsePs };
