'use strict';
/**
 * Rauchtest für das FERTIGE Kern-Programm – läuft in GitHub Actions auf echtem Windows und Mac.
 * Prüft, was die normalen Tests nicht können: echte Messwerte, echte Prozessliste, Symbole,
 * und unter Windows Einfrieren/Auftauen eines Prozesses und das Lesen des Energieplans.
 *
 *   node test/smoke.cjs src-tauri/binaries/slimmanager-core-<plattform>[.exe]
 *   node test/smoke.cjs            (ohne Pfad: node core/main.cjs)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const WebSocket = require('ws');

const exe = process.argv[2] ? path.resolve(process.argv[2]) : null;
const WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, ms, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('Zeitüberschreitung: ' + what);
    await sleep(150);
  }
}

/** Kern starten und Meldungen an die Hülle mitlesen */
function startCore(dir) {
  const p = spawn(exe || process.execPath, exe ? [] : [path.join(__dirname, '..', 'core', 'main.cjs')], {
    env: { ...process.env, SM_USERDATA: dir, SM_PORT: '0', SLIMMANAGER_TEST: '1' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const lines = [];
  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      try {
        lines.push(JSON.parse(buf.slice(0, i)));
      } catch {
        /* keine JSON-Zeile */
      }
      buf = buf.slice(i + 1);
    }
  });
  return { p, lines };
}

function client(port, token) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}&role=main`);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.id !== undefined) pending.get(m.id)?.(m);
    else events.push(m);
  });
  const call = (m, ...a) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, (r) => (r.e ? reject(new Error(r.e)) : resolve(r.r)));
      ws.send(JSON.stringify({ id: i, m, a }));
    });
  return { ws, call, events, open: new Promise((r, j) => (ws.on('open', r), ws.on('error', j))) };
}

/** Windows: Ist der Prozess angehalten? (alle Threads "Suspended") */
function winSuspended(pid) {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).Threads | ForEach-Object { $_.WaitReason }`], { encoding: 'utf8' });
  const r = out.split(/\r?\n/).filter(Boolean);
  return r.length > 0 && r.every((x) => x.trim() === 'Suspended');
}

async function coreChecks() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-smoke-'));
  const core = startCore(dir);
  const t0 = Date.now();
  const ready = await until(() => core.lines.find((l) => l.t === 'ready'), 20000, 'Kern bereit');
  console.log(`✓ Kern gestartet in ${Date.now() - t0} ms (${exe ? path.basename(exe) : 'node'})`);
  const ui = client(ready.port, ready.token);
  await ui.open;
  await ui.call('ui:state', { visible: true, focused: true, fullscreen: false });

  const info = await ui.call('app:info');
  assert.equal(info.platform, process.platform);
  const st = await until(() => ui.call('sys:static'), 15000, 'Systemdaten');
  assert.ok(st.cores > 0, 'sys:static.cores');
  console.log(`✓ System: ${st.cpuBrand || st.cpu || '?'} · ${st.cores} Kerne`);

  // Echte Messwerte
  const snap = await until(async () => {
    const s = (await ui.call('stats:get')).snap;
    return s && typeof s.cpu === 'number' && typeof s.ram === 'number' ? s : null;
  }, 15000, 'Messwerte');
  console.log(`✓ Messwerte: CPU ${snap.cpu} %, RAM ${snap.ram} %, GPU ${snap.gpu ?? '–'}`);

  // Echte Prozessliste
  await ui.call('procs:watch', true, 'fast');
  const procs = await until(async () => {
    const c = await ui.call('procs:watch', false, 'fast');
    await ui.call('procs:watch', true, 'fast');
    return c && c.flat && c.flat.length > 5 ? c : null;
  }, 20000, 'Prozessliste');
  const withPath = procs.flat.filter((p) => p.path);
  console.log(`✓ Prozesse: ${procs.flat.length} (mit Pfad: ${withPath.length}, Gruppen: ${procs.groups.length})`);
  assert.ok(withPath.length > 0, 'Prozesse mit Programmpfad');

  // Symbol eines Programms
  // Mac: nur Apps mit lesbarer Symbol-Datei (manche haben nur eine binäre Info.plist → bewusst kein Symbol)
  const { iconFileOf } = require('../core/icons.cjs');
  const apps = [...new Set(withPath.map((p) => /^(.*?\.app)(\/|$)/.exec(p.path)?.[1]).filter(Boolean))];
  const iconTarget = WIN ? process.execPath : apps.find((a) => iconFileOf(a));
  if (iconTarget) {
    const icon = await ui.call('icon:get', iconTarget);
    assert.match(String(icon), /^data:image\/png;base64,/, 'Symbol für ' + iconTarget);
    console.log('✓ Programm-Symbol gelesen');
  }

  const self = await ui.call('self:usage');
  console.log(`✓ Eigenverbrauch: ${JSON.stringify(self)}`);

  // Sauber beenden: Hülle weg → Kern räumt auf
  ui.ws.close();
  core.p.stdin.end();
  const code = await Promise.race([new Promise((r) => core.p.on('exit', r)), sleep(10000).then(() => 'hängt')]);
  assert.equal(code, 0, 'Kern beendet sich sauber');
  console.log('✓ Kern sauber beendet');
}

async function windowsChecks() {
  const { Tweaks } = require('../core/lib/tweaks.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-tweaks-'));
  const tw = new Tweaks({ dir });
  // Harmloses Testprogramm: ping zählt einfach vor sich hin
  const victim = spawn('ping', ['-n', '120', '127.0.0.1'], { stdio: 'ignore', windowsHide: true });
  await sleep(800);
  try {
    const done = await tw.freeze([victim.pid]);
    assert.deepEqual(done, [victim.pid], 'Einfrieren gemeldet');
    await until(() => winSuspended(victim.pid), 5000, 'Prozess angehalten');
    console.log('✓ Windows: Prozess eingefroren');
    await tw.unfreeze([victim.pid]);
    await until(() => !winSuspended(victim.pid), 5000, 'Prozess läuft wieder');
    console.log('✓ Windows: Prozess aufgetaut');
    const scheme = await tw.run(['/getactivescheme']);
    assert.match(String(scheme), /[0-9a-f]{8}-[0-9a-f]{4}-/i, 'Energieplan lesbar');
    console.log('✓ Windows: Energieplan lesbar');
    assert.ok((await tw.trim([victim.pid])) === 1, 'Arbeitsspeicher freigeben');
    console.log('✓ Windows: Arbeitsspeicher freigegeben');
  } finally {
    await tw.restoreAll();
    tw.close();
    victim.kill();
  }
}

(async () => {
  await coreChecks();
  if (WIN) await windowsChecks();
  console.log('✓ Rauchtest bestanden');
  process.exit(0);
})().catch((e) => {
  console.error('✗ Rauchtest fehlgeschlagen:', e);
  process.exit(1);
});
