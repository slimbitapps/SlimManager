'use strict';
/**
 * Windows: sparsame Messungen über EINE dauerhaft laufende PowerShell (statt vieler teurer WMI-Abfragen).
 *  "P" → Prozessliste über .NET (Process.GetProcesses – so billig wie der Task-Manager), Pfade werden zwischengespeichert
 *  "G" → GPU-Auslastung gesamt + pro Prozess (Leistungsindikatoren, in jeder Windows-Sprache gleich)
 * Netzwerk kommt aus "netstat -e" (kleines Programm, kein WMI).
 */
const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$T = [char]9; $N = [char]10
# Mit minimalen Rechten (PROCESS_QUERY_LIMITED_INFORMATION) – klappt auch bei Admin-/Anti-Cheat-Prozessen
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SlimProc {
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder name, ref int size);
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr h, out long create, out long exit, out long kernel, out long user);
  public static string Path(int pid) {
    IntPtr h = OpenProcess(0x1000, false, pid);
    if (h == IntPtr.Zero) return "";
    StringBuilder sb = new StringBuilder(1024); int size = sb.Capacity;
    string r = QueryFullProcessImageName(h, 0, sb, ref size) ? sb.ToString() : "";
    CloseHandle(h);
    return r;
  }
  public static long Cpu(int pid) {
    IntPtr h = OpenProcess(0x1000, false, pid);
    if (h == IntPtr.Zero) return 0;
    long c, e, k, u; long r = GetProcessTimes(h, out c, out e, out k, out u) ? (k + u) / 10000 : 0;
    CloseHandle(h);
    return r;
  }
}
"@
$paths = @{}
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { exit }
  if ($line -eq 'P') {
    $sb = New-Object System.Text.StringBuilder
    $seen = @{}
    foreach ($p in [System.Diagnostics.Process]::GetProcesses()) {
      $id = $p.Id; $seen[$id] = 1
      $cpu = [SlimProc]::Cpu($id)
      $file = $paths[$id]
      if ($null -eq $file) { $file = [SlimProc]::Path($id); $paths[$id] = $file }
      $prio = 8; try { $prio = $p.BasePriority } catch {}
      $ws = 0; try { $ws = $p.WorkingSet64 } catch {}
      [void]$sb.Append($id).Append($T).Append($p.ProcessName).Append($T).Append($cpu).Append($T).Append($ws).Append($T).Append($prio).Append($T).Append($file).Append($N)
    }
    foreach ($k in @($paths.Keys)) { if (-not $seen.ContainsKey($k)) { $paths.Remove($k) } }
    [Console]::Out.Write($sb.ToString())
    [Console]::Out.WriteLine('END')
  } elseif ($line.StartsWith('I ')) {
    # Programm-Symbol als PNG (Base64)
    $b64 = ''
    try {
      Add-Type -AssemblyName System.Drawing
      $ic = [System.Drawing.Icon]::ExtractAssociatedIcon($line.Substring(2))
      $ms = New-Object System.IO.MemoryStream
      $ic.ToBitmap().Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
      $b64 = [Convert]::ToBase64String($ms.ToArray())
    } catch {}
    [Console]::Out.WriteLine('ICON ' + $b64)
  } elseif ($line -eq 'G') {
    $per = @{}; $tot = 0
    foreach ($e in Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine) {
      if ($e.Name -like '*engtype_3D*') {
        $u = [int]$e.UtilizationPercentage; $tot += $u
        if ($u -gt 0 -and $e.Name -match 'pid_(\d+)_') { $per[$Matches[1]] = [int]$per[$Matches[1]] + $u }
      }
    }
    $mem = (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory | Measure-Object -Property DedicatedUsage -Maximum).Maximum
    $parts = @($per.Keys | ForEach-Object { "$_=$($per[$_])" })
    [Console]::Out.WriteLine('GPU ' + [int]$tot + ' ' + [int64]$mem + ' ' + ($parts -join ','))
  }
}
`;

/** Prozesse ohne Datei-Pfad, die trotzdem System sind (Namen ohne .exe) */
const PSEUDO = new Set(['Idle', 'System', 'Registry', 'Memory Compression', 'Secure System', 'vmmem', 'vmmem.exe']);

/**
 * Ausgabe von "P" → Liste im Format von systeminformation (damit procs.cjs gleich bleibt).
 * CPU in % der GESAMTEN CPU aus der Differenz der Rechenzeit seit der letzten Messung.
 * @param {string} text  Zeilen "pid \t name \t cpu-ms \t workingset \t basis-priorität \t datei"
 * @param {Map<number, number>} prev  pid → cpu-ms der letzten Messung (wird aktualisiert)
 */
function parseWinProcs(text, prev, dtMs, cores) {
  const list = [];
  const next = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const f = line.split('\t');
    if (f.length < 6) continue;
    const pid = Number(f[0]);
    if (!Number.isInteger(pid)) continue;
    const cpuMs = Number(f[2]) || 0;
    next.set(pid, cpuMs);
    const before = prev.get(pid);
    const cpu = before !== undefined && dtMs > 0 ? Math.max(0, ((cpuMs - before) / (dtMs * Math.max(1, cores))) * 100) : 0;
    const file = f.slice(5).join('\t').trim();
    const name = file ? path.win32.basename(file) : PSEUDO.has(f[1]) ? f[1] : `${f[1]}.exe`;
    list.push({
      pid,
      parentPid: 0,
      name,
      cpu: Math.round(cpu * 10) / 10,
      memRss: (Number(f[3]) || 0) / 1024,
      priority: Number(f[4]) || 8,
      path: file ? path.win32.dirname(file) : '',
      command: file,
      user: '',
    });
  }
  prev.clear();
  for (const [k, v] of next) prev.set(k, v);
  return list;
}

/** "GPU 37 1073741824 1234=20,5678=3" → { util, memUsed, perPid } */
function parseWinGpu(line) {
  const m = /^GPU (\d+) (\d+)\s*(.*)$/.exec(String(line).trim());
  if (!m) return null;
  const perPid = new Map();
  for (const part of m[3].split(',')) {
    const [pid, u] = part.split('=').map(Number);
    if (Number.isInteger(pid) && Number.isFinite(u)) perPid.set(pid, Math.min(100, u));
  }
  return { util: Math.min(100, Number(m[1])), memUsed: Number(m[2]) || null, perPid };
}

/** "netstat -e": Zeile "Bytes  <empfangen>  <gesendet>" – in allen Windows-Sprachen gleich */
function parseNetstat(out) {
  const line = String(out).split(/\r?\n/).find((l) => /^\s*Bytes\s+\d/.test(l));
  if (!line) return null;
  const n = line.trim().split(/\s+/).slice(1).map(Number);
  return n.length >= 2 && n.every(Number.isFinite) ? { rx: n[0], tx: n[1] } : null;
}

/** "nvidia-smi pmon -c 1 -s u": Spalte "sm" (Auslastung in %) pro Prozess */
function parsePmon(out) {
  const perPid = new Map();
  for (const line of String(out).split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const f = line.trim().split(/\s+/);
    const pid = Number(f[1]);
    const sm = Number(f[3]);
    if (Number.isInteger(pid) && Number.isFinite(sm)) perPid.set(pid, (perPid.get(pid) || 0) + sm);
  }
  return perPid;
}

class WinSampler {
  constructor({ spawner = spawn, exec = execFile } = {}) {
    this.spawner = spawner;
    this.exec = exec;
    this.proc = null;
    this.queue = []; // wartende Anfragen: { kind, resolve }
    this.buf = '';
    this.prevCpu = new Map();
    this.prevAt = 0;
  }

  ensure() {
    if (this.proc && this.proc.exitCode === null) return this.proc;
    // Als Skript-Datei starten; die Schleife liest danach die Befehle von stdin
    const file = path.join(os.tmpdir(), 'slimmanager-sampler.ps1');
    try {
      fs.writeFileSync(file, '\ufeff' + SCRIPT.replace(/\r?\n/g, '\r\n'));
    } catch {
      /* egal – dann schlägt der Start fehl und es geht ohne */
    }
    const p = this.spawner('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    this.proc = p;
    this.buf = '';
    p.stdout.setEncoding?.('utf8');
    p.stdout.on('data', (d) => this.onData(String(d)));
    p.on('error', () => {});
    p.on('exit', () => {
      if (this.proc === p) this.proc = null;
      for (const q of this.queue.splice(0)) q.resolve(null);
    });
    return p;
  }

  onData(d) {
    this.buf += d;
    for (;;) {
      const q = this.queue[0];
      if (!q) {
        this.buf = '';
        return;
      }
      if (q.kind === 'P') {
        const i = this.buf.indexOf('END');
        if (i < 0) return;
        const text = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 3).replace(/^\r?\n/, '');
        this.queue.shift();
        q.resolve(text);
      } else {
        const i = this.buf.indexOf('\n');
        if (i < 0) return;
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        if (!line.startsWith(q.kind === 'I' ? 'ICON' : 'GPU')) continue; // Begrüßungstext o. Ä. überspringen
        this.queue.shift();
        q.resolve(line);
      }
    }
  }

  /** Programm-Symbol einer .exe als data:-URL */
  async icon(file) {
    if (!/^[a-z]:\\[^\r\n]+\.exe$/i.test(String(file))) return null;
    const line = await this.askLine('I', 'I ' + file);
    const b64 = line ? line.trim().slice(5) : '';
    return b64 ? 'data:image/png;base64,' + b64 : null;
  }

  askLine(kind, command) {
    return this.ask(kind, 10000, command);
  }

  ask(kind, timeout = 10000, command = kind) {
    const p = this.ensure();
    return new Promise((resolve) => {
      const entry = { kind, resolve: () => {} };
      const t = setTimeout(() => {
        const i = this.queue.indexOf(entry);
        if (i >= 0) this.queue.splice(i, 1);
        resolve(null);
      }, timeout);
      entry.resolve = (v) => {
        clearTimeout(t);
        resolve(v);
      };
      this.queue.push(entry);
      try {
        p.stdin.write(command + '\r\n');
      } catch {
        entry.resolve(null);
      }
    });
  }

  async processes(cores) {
    const text = await this.ask('P');
    if (text === null) return null;
    const now = Date.now();
    const list = parseWinProcs(text, this.prevCpu, this.prevAt ? now - this.prevAt : 0, cores);
    this.prevAt = now;
    return list;
  }

  async gpu() {
    const line = await this.ask('G');
    return line === null ? null : parseWinGpu(line);
  }

  net() {
    return new Promise((resolve) => this.exec('netstat', ['-e'], { windowsHide: true, timeout: 4000 }, (err, out) => resolve(err ? null : parseNetstat(out))));
  }

  pmon() {
    return new Promise((resolve) =>
      this.exec('nvidia-smi', ['pmon', '-c', '1', '-s', 'u'], { windowsHide: true, timeout: 5000 }, (err, out) => resolve(err ? null : parsePmon(out))),
    );
  }

  /** Eigene Kind-Prozesse (für "SlimManager braucht selbst …") */
  pids() {
    return this.proc && this.proc.exitCode === null ? [this.proc.pid] : [];
  }

  stop() {
    try {
      this.proc?.stdin.end();
    } catch {
      /* egal */
    }
    this.proc = null;
  }
}

module.exports = { WinSampler, parseWinProcs, parseWinGpu, parseNetstat, parsePmon, SCRIPT };
