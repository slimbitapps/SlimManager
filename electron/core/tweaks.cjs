'use strict';
/**
 * Eingriffe ins System für Boost & Fokus – alle umkehrbar und absturzsicher:
 *  - Einfrieren (Prozess pausieren): Windows über NtSuspendProcess, Mac/Linux über SIGSTOP
 *  - CPU-Kerne für Hintergrund-Programme beschränken, Arbeitsspeicher freigeben (Windows)
 *  - Energieplan "Höchstleistung" bzw. "leise" (Turbo aus) (Windows, ohne Admin-Rechte)
 *  - Windows-Update & Co. pausieren (Windows, fragt einmal nach Admin-Rechten)
 *
 * Sicherheitsnetz (dreifach):
 *  1. Normales Ende: Boost.stop() macht alles rückgängig.
 *  2. SlimManager stürzt ab: Ein Wächter-Prozess merkt das (seine Eingabe schließt sich) und taut alles auf,
 *     setzt Kerne und Energieplan zurück. Der Admin-Helfer startet die Dienste neu, sobald SlimManager weg ist.
 *  3. Alles wird zusätzlich in undo.json notiert und beim nächsten Start nachgeholt (z. B. nach einem Neustart).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

const HIGH_PERF = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
const ULTIMATE = 'e9a42b02-d5df-448d-aa00-03f14749eb61';
const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Dienste, die während Boost/Fokus pausieren (nur mit Admin-Bestätigung) */
const SERVICES = ['wuauserv', 'UsoSvc', 'BITS', 'DoSvc', 'WSearch'];

// ------------------------------------------------------------------ Windows-Helfer (PowerShell + C#)
/**
 * Dauerhaft laufende PowerShell, die Befehle über stdin bekommt:
 *   "<id> S <pid>" einfrieren · "<id> R <pid>" auftauen · "<id> T <pid>" RAM freigeben
 *   "<id> A <pid> <maske>" Kerne setzen · "<id> AR <pid>" Kerne zurück · "<id> U <befehl>" Rückgängig-Befehl merken
 *   "<id> RA" alles zurück
 * Antwort: "<id> 1" (geklappt) oder "<id> 0". Schließt sich stdin (SlimManager weg), wird alles zurückgesetzt.
 */
const WIN_HELPER = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class SlimTweak {
  [DllImport("ntdll.dll")] static extern int NtSuspendProcess(IntPtr h);
  [DllImport("ntdll.dll")] static extern int NtResumeProcess(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("psapi.dll")] static extern bool EmptyWorkingSet(IntPtr h);
  static bool Call(int pid, uint access, int what) {
    IntPtr h = OpenProcess(access, false, pid);
    if (h == IntPtr.Zero) return false;
    bool ok;
    if (what == 0) ok = NtSuspendProcess(h) == 0;
    else if (what == 1) ok = NtResumeProcess(h) == 0;
    else ok = EmptyWorkingSet(h);
    CloseHandle(h);
    return ok;
  }
  public static bool Suspend(int pid) { return Call(pid, 0x0800, 0); }
  public static bool Resume(int pid) { return Call(pid, 0x0800, 1); }
  public static bool Trim(int pid) { return Call(pid, 0x0100 | 0x0400, 2); }
}
"@
$frozen = @{}
$aff = @{}
$undo = New-Object System.Collections.ArrayList
function Restore-All {
  foreach ($p in @($frozen.Keys)) { [void][SlimTweak]::Resume([int]$p) }
  $frozen.Clear()
  foreach ($p in @($aff.Keys)) { try { (Get-Process -Id ([int]$p)).ProcessorAffinity = [IntPtr]([int64]$aff[$p]) } catch {} }
  $aff.Clear()
  foreach ($c in @($undo)) { cmd.exe /d /c $c | Out-Null }
  $undo.Clear()
}
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { Restore-All; exit }
  $parts = $line.Split(' ', 3)
  $id = $parts[0]; $cmd = $parts[1]; $arg = if ($parts.Length -gt 2) { $parts[2] } else { '' }
  $ok = $false
  try {
    switch ($cmd) {
      'S' { $p = [int]$arg; if ($frozen.ContainsKey($arg)) { $ok = $true } elseif ([SlimTweak]::Suspend($p)) { $frozen[$arg] = 1; $ok = $true } }
      'R' { $p = [int]$arg; if ($frozen.ContainsKey($arg)) { $ok = [SlimTweak]::Resume($p); $frozen.Remove($arg) } else { $ok = $true } }
      'T' { $ok = [SlimTweak]::Trim([int]$arg) }
      'A' {
        $a = $arg.Split(' ')
        $proc = Get-Process -Id ([int]$a[0])
        if (-not $aff.ContainsKey($a[0])) { $aff[$a[0]] = [int64]$proc.ProcessorAffinity }
        $proc.ProcessorAffinity = [IntPtr]([int64]$a[1]); $ok = $true
      }
      'AR' { if ($aff.ContainsKey($arg)) { (Get-Process -Id ([int]$arg)).ProcessorAffinity = [IntPtr]([int64]$aff[$arg]); $aff.Remove($arg) }; $ok = $true }
      'U' { [void]$undo.Add($arg); $ok = $true }
      'UC' { $undo.Clear(); $ok = $true }
      'RA' { Restore-All; $ok = $true }
      'PING' { $ok = $true }
    }
  } catch { $ok = $false }
  [Console]::Out.WriteLine("$id " + ([int]$ok))
}
`;

/** Admin-Helfer: Dienste anhalten, warten bis SlimManager fertig ist (oder weg), Dienste wieder starten. */
function servicesScript(parentPid, flag) {
  const names = SERVICES.map((n) => `'${n}'`).join(',');
  const f = flag.replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$parent = ${Number(parentPid)}; $flag = '${f}'`,
    `$stopped = @()`,
    `foreach ($n in @(${names})) { $s = Get-Service -Name $n; if ($s -and $s.Status -eq 'Running') { Stop-Service -Name $n -Force; Start-Sleep -Milliseconds 300; if ((Get-Service -Name $n).Status -ne 'Running') { $stopped += $n } } }`,
    `Set-Content -Path ($flag + '.ok') -Value ($stopped -join ',')`,
    `while ((Get-Process -Id $parent -ErrorAction SilentlyContinue) -and -not (Test-Path $flag)) { Start-Sleep -Seconds 2 }`,
    `foreach ($n in $stopped) { Start-Service -Name $n }`,
    `Remove-Item -Path $flag, ($flag + '.ok') -ErrorAction SilentlyContinue`,
  ].join('\n');
}

/** Aktuelle Netz-/Akku-Werte aus "powercfg /q …" (die letzten beiden Hex-Zahlen – in jeder Windows-Sprache gleich) */
function parsePowerQuery(out) {
  const hex = [...String(out).matchAll(/0x([0-9a-f]{8})/gi)].map((m) => parseInt(m[1], 16));
  return hex.length >= 2 ? { ac: hex[hex.length - 2], dc: hex[hex.length - 1] } : null;
}

/** Kerne für Hintergrund-Programme: die letzten (Anzahl/4, mindestens 1) – als Dezimal-Maske */
function backgroundMask(cores = os.cpus().length) {
  const n = Math.max(1, Math.min(64, cores));
  const k = Math.max(1, Math.floor(n / 4));
  let mask = 0n;
  for (let i = n - k; i < n; i++) mask |= 1n << BigInt(i);
  return mask.toString();
}

// ------------------------------------------------------------------ Tweaks
class Tweaks {
  /**
   * @param {{platform?: string, dir?: string, log?: Function, exec?: Function, spawner?: Function}} [o]
   *   dir = Ordner für undo.json · exec/spawner im Test austauschbar
   */
  constructor({ platform = process.platform, dir = os.tmpdir(), log = () => {}, exec = execFile, spawner = spawn } = {}) {
    this.platform = platform;
    this.file = path.join(dir, 'undo.json');
    this.log = log;
    this.exec = exec;
    this.spawner = spawner;
    this.helper = null;
    this.wait = new Map();
    this.seq = 0;
    this.journal = this.read();
    this.watchdog = null;
  }

  get win() {
    return this.platform === 'win32';
  }
  /** Was dieses System kann (für die Oberfläche) */
  caps() {
    return { freeze: true, cores: this.win, trim: this.win, power: this.win, services: this.win };
  }

  // ------------------------------------------------------------ Notizbuch (undo.json)
  read() {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { frozen: j.frozen || [], affinity: j.affinity || [], power: j.power || [], bg: j.bg || [], services: j.services || null };
    } catch {
      return { frozen: [], affinity: [], power: [], bg: [], services: null };
    }
  }
  save() {
    try {
      const empty = !this.journal.frozen.length && !this.journal.affinity.length && !this.journal.power.length && !this.journal.bg.length && !this.journal.services;
      if (empty) fs.rmSync(this.file, { force: true });
      else fs.writeFileSync(this.file, JSON.stringify(this.journal));
    } catch {
      /* egal */
    }
  }

  // ------------------------------------------------------------ Windows-Helfer
  ensureHelper() {
    if (!this.win) return null;
    if (this.helper && !this.helper.killed && this.helper.exitCode === null) return this.helper;
    // Als Skript-Datei starten (statt verschlüsselter Befehlszeile) – Virenscanner mögen das lieber
    const file = this.scriptFile('slimmanager-helper.ps1', WIN_HELPER);
    const p = this.spawner('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    this.helper = p;
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const [id, ok] = buf.slice(0, i).trim().split(' ');
        buf = buf.slice(i + 1);
        const w = this.wait.get(id);
        if (w) {
          this.wait.delete(id);
          w(ok === '1');
        }
      }
    });
    p.on('error', (e) => this.log('helper', e));
    p.on('exit', () => {
      if (this.helper === p) this.helper = null;
      for (const w of this.wait.values()) w(false);
      this.wait.clear();
    });
    return p;
  }
  /** Skript neben undo.json ablegen (UTF-8 mit BOM, damit Windows PowerShell Umlaute richtig liest) */
  scriptFile(name, content) {
    const file = path.join(path.dirname(this.file), name);
    try {
      fs.writeFileSync(file, '\ufeff' + content.replace(/\r?\n/g, '\r\n'));
    } catch {
      /* egal – dann schlägt der Start fehl und der Boost läuft ohne diese Extras */
    }
    return file;
  }
  cmd(line, timeout = 8000) {
    const p = this.ensureHelper();
    if (!p) return Promise.resolve(false);
    const id = String(++this.seq);
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.wait.delete(id);
        resolve(false);
      }, timeout);
      this.wait.set(id, (ok) => {
        clearTimeout(t);
        resolve(ok);
      });
      try {
        p.stdin.write(`${id} ${line}\n`);
      } catch {
        clearTimeout(t);
        resolve(false);
      }
    });
  }

  // ------------------------------------------------------------ Mac/Linux-Wächter
  /** Kleiner Node-Prozess: taut auf und hebt den Hintergrund-Modus auf, falls SlimManager abstürzt */
  ensureWatchdog() {
    if (this.win) return null;
    if (this.watchdog && this.watchdog.exitCode === null) return this.watchdog;
    try {
      // Als eigenständiges Programm (Tauri-Version) startet sich der Kern selbst im Wächter-Modus,
      // sonst (Node/Electron) wird die Wächter-Datei direkt ausgeführt
      let sea = false;
      try {
        sea = require('node:sea').isSea();
      } catch {
        /* ältere Node-Version */
      }
      const p = this.spawner(process.execPath, sea ? ['--watchdog'] : [path.join(__dirname, 'watchdog.cjs')], {
        stdio: ['pipe', 'ignore', 'ignore'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
      p.on('error', () => {});
      this.watchdog = p;
      return p;
    } catch {
      return null;
    }
  }
  tell(line) {
    const p = this.ensureWatchdog();
    try {
      p?.stdin.write(line + '\n');
    } catch {
      /* egal */
    }
  }

  // ------------------------------------------------------------ Einfrieren
  async freeze(pids) {
    const done = [];
    for (const pid of pids) {
      if (!Number.isInteger(pid) || pid <= 4 || pid === process.pid) continue;
      let ok = false;
      if (this.win) ok = await this.cmd(`S ${pid}`);
      else {
        try {
          process.kill(pid, 'SIGSTOP');
          ok = true;
          this.tell(`S ${pid}`);
        } catch {
          ok = false;
        }
      }
      if (ok) done.push(pid);
    }
    if (done.length) {
      this.journal.frozen.push(...done);
      this.save();
    }
    return done;
  }
  async unfreeze(pids) {
    for (const pid of pids) {
      if (this.win) await this.cmd(`R ${pid}`);
      else {
        try {
          process.kill(pid, 'SIGCONT');
        } catch {
          /* schon weg */
        }
        this.tell(`R ${pid}`);
      }
    }
    const set = new Set(pids);
    this.journal.frozen = this.journal.frozen.filter((p) => !set.has(p));
    this.save();
  }

  // ------------------------------------------------------------ Mac: Hintergrund-Modus merken (für den Wächter)
  noteBackground(pid, on) {
    if (this.win) return;
    this.tell(`${on ? 'B' : 'X'} ${pid}`);
    this.journal.bg = on ? [...new Set([...this.journal.bg, pid])] : this.journal.bg.filter((p) => p !== pid);
    this.save();
  }

  // ------------------------------------------------------------ Kerne & RAM (Windows)
  async limitCores(pids, mask = backgroundMask()) {
    if (!this.win) return [];
    const done = [];
    for (const pid of pids) if (await this.cmd(`A ${pid} ${mask}`)) done.push(pid);
    if (done.length) {
      this.journal.affinity.push(...done);
      this.save();
    }
    return done;
  }
  async restoreCores(pids) {
    if (!this.win) return;
    for (const pid of pids) await this.cmd(`AR ${pid}`);
    const set = new Set(pids);
    this.journal.affinity = this.journal.affinity.filter((p) => !set.has(p));
    this.save();
  }
  async trim(pids) {
    if (!this.win) return 0;
    let n = 0;
    for (const pid of pids) if (await this.cmd(`T ${pid}`)) n++;
    return n;
  }

  // ------------------------------------------------------------ Energieplan (Windows, ohne Admin)
  run(args) {
    return new Promise((resolve) => this.exec('powercfg', args, { windowsHide: true, timeout: 8000 }, (err, out) => resolve(err ? null : String(out))));
  }
  /**
   * 'high' = Höchstleistung (Ultimative/Höchstleistung, sonst Mindest-CPU-Takt 100 %)
   * 'quiet' = Turbo aus (max. 99 %) → deutlich kühler und leiser
   * @returns {Promise<string|null>} was eingestellt wurde, oder null
   */
  async power(mode) {
    if (!this.win) return null;
    const active = await this.run(['/getactivescheme']);
    const current = active && GUID_RE.exec(active)?.[0];
    if (!current) return null;
    const undo = [];
    let what = null;
    if (mode === 'high') {
      const list = (await this.run(['/list'])) || '';
      const target = list.toLowerCase().includes(ULTIMATE) ? ULTIMATE : list.toLowerCase().includes(HIGH_PERF) ? HIGH_PERF : null;
      if (target && target !== current.toLowerCase()) {
        if ((await this.run(['/setactive', target])) !== null) {
          undo.push(`powercfg /setactive ${current}`);
          what = 'high';
        }
      } else if (!target) {
        what = (await this.setProc(current, 'PROCTHROTTLEMIN', 100, undo)) ? 'high' : null;
      } else what = 'high'; // läuft schon
    } else if (mode === 'quiet') {
      what = (await this.setProc(current, 'PROCTHROTTLEMAX', 99, undo)) ? 'quiet' : null;
    }
    if (undo.length) {
      this.journal.power.push(...undo);
      this.save();
      for (const u of undo) await this.cmd(`U ${u}`); // auch der Wächter (Helfer) kennt den Rückweg
    }
    return what;
  }
  async setProc(scheme, setting, value, undo) {
    const q = await this.run(['/q', scheme, 'SUB_PROCESSOR', setting]);
    const old = q && parsePowerQuery(q);
    if (!old) return false;
    const a = await this.run(['/setacvalueindex', scheme, 'SUB_PROCESSOR', setting, String(value)]);
    const b = await this.run(['/setdcvalueindex', scheme, 'SUB_PROCESSOR', setting, String(value)]);
    if (a === null && b === null) return false;
    await this.run(['/setactive', scheme]);
    undo.push(`powercfg /setacvalueindex ${scheme} SUB_PROCESSOR ${setting} ${old.ac}`, `powercfg /setdcvalueindex ${scheme} SUB_PROCESSOR ${setting} ${old.dc}`, `powercfg /setactive ${scheme}`);
    return true;
  }
  async restorePower() {
    const cmds = this.journal.power.splice(0);
    for (const c of cmds) {
      const parts = c.split(' ').slice(1);
      await this.run(parts);
    }
    if (cmds.length && this.win) await this.cmd('UC');
    this.save();
  }

  // ------------------------------------------------------------ Dienste (Windows, Admin)
  /** Startet den Admin-Helfer (Windows fragt einmal nach). Ergebnis: Anzahl angehaltener Dienste oder Fehler. */
  async pauseServices() {
    if (!this.win) return { ok: false, error: 'unsupported' };
    const flag = path.join(os.tmpdir(), `slimmanager-svc-${process.pid}-${Date.now()}`);
    const file = this.scriptFile('slimmanager-services.ps1', servicesScript(process.pid, flag)).replace(/'/g, "''");
    const outer = `Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','"${file}"'`;
    const started = await new Promise((resolve) =>
      this.exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', outer], { windowsHide: true, timeout: 60000 }, (err) => resolve(!err)),
    );
    if (!started) return { ok: false, error: 'admin-denied' };
    this.journal.services = flag;
    this.save();
    // Warten, bis der Helfer gemeldet hat, welche Dienste er angehalten hat
    for (let i = 0; i < 40; i++) {
      try {
        const names = fs.readFileSync(flag + '.ok', 'utf8').trim();
        return { ok: true, stopped: names ? names.split(',').length : 0 };
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    return { ok: true, stopped: null };
  }
  resumeServices() {
    const flag = this.journal.services;
    if (!flag) return;
    try {
      fs.writeFileSync(flag, 'stop'); // Signal an den Admin-Helfer: Dienste wieder starten
    } catch {
      /* egal */
    }
    this.journal.services = null;
    this.save();
  }

  // ------------------------------------------------------------ Alles zurück
  async restoreAll() {
    const j = this.journal;
    await this.unfreeze([...j.frozen]);
    await this.restoreCores([...j.affinity]);
    for (const pid of [...j.bg]) {
      execFile('/usr/sbin/taskpolicy', ['-B', '-p', String(pid)], () => {});
      this.noteBackground(pid, false);
    }
    await this.restorePower();
    this.resumeServices();
    if (this.win) await this.cmd('RA');
  }

  /** Beim Start: Reste eines abgestürzten Laufs aufräumen (z. B. nach Neustart des PCs) */
  async recover() {
    const j = this.journal;
    if (!j.frozen.length && !j.affinity.length && !j.power.length && !j.bg.length && !j.services) return false;
    this.log('recover', JSON.stringify(j));
    await this.restoreAll();
    return true;
  }

  /** Nichts mehr eingefroren/verändert → Helfer beenden (spart Arbeitsspeicher) */
  idle() {
    const j = this.journal;
    if (j.frozen.length || j.affinity.length || j.power.length || j.bg.length || j.services) return;
    this.close();
    this.helper = null;
    this.watchdog = null;
  }

  close() {
    try {
      this.helper?.stdin.end();
    } catch {
      /* egal */
    }
    try {
      this.watchdog?.stdin.end();
    } catch {
      /* egal */
    }
  }
}

module.exports = { Tweaks, WIN_HELPER, servicesScript, parsePowerQuery, backgroundMask, SERVICES, HIGH_PERF, ULTIMATE };
