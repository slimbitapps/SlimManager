'use strict';
/**
 * Echter Verbrauch wie in der Aktivitätsanzeige/dem Task-Manager: ALLE Prozesse von SlimManager
 * (Haupt-, Fenster-, GPU-Prozess UND alle gestarteten Helfer wie ioreg/ps/PowerShell), über "ps" gemessen.
 *
 *   node test/realusage.cjs [sekunden] [szenario]
 *   szenario: dashboard (Standard) | minimized | processes | phone
 *   SLIMMANAGER_EXE=/Volumes/…/SlimManager.app/Contents/MacOS/SlimManager node test/realusage.cjs 60
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const secs = Number(process.argv[2] || 40);
const scenario = process.argv[3] || 'dashboard';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Alle Prozesse unterhalb von root (inkl. kurzlebiger Helfer), mit CPU-Zeit und Speicher */
function tree(root) {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,time=,args=']).toString();
  const rows = out
    .trim()
    .split('\n')
    .map((l) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d:.-]+)\s+(.*)$/.exec(l);
      if (!m) return null;
      // Electron-Helfer nach Art unterscheiden (Fenster, GPU, Netzwerk …)
      const type = /--type=([\w-]+)/.exec(m[5])?.[1];
      const sub = /--utility-sub-type=([\w.]+)/.exec(m[5])?.[1];
      const comm = path.basename(m[5].split(' --')[0]) + (type ? ` [${type}${sub ? ':' + sub.split('.').pop() : ''}]` : '');
      return { pid: +m[1], ppid: +m[2], rss: +m[3] * 1024, time: cpuSec(m[4]), comm };
    })
    .filter(Boolean);
  const kids = new Map();
  for (const r of rows) (kids.get(r.ppid) || kids.set(r.ppid, []).get(r.ppid)).push(r);
  const res = [];
  const walk = (pid) => {
    for (const k of kids.get(pid) || []) {
      res.push(k);
      walk(k.pid);
    }
  };
  const me = rows.find((r) => r.pid === root);
  if (me) res.push(me);
  walk(root);
  return res;
}
/** "1:02.34" oder "0:00.12" → Sekunden */
function cpuSec(t) {
  const p = t.split(/[:-]/).map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0];
}

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'slimmanager-real-'));
  // SM_SETTINGS='{"look":{"anim":false}}' → einzelne Einstellungen zum Vergleichen
  const extra = process.env.SM_SETTINGS ? JSON.parse(process.env.SM_SETTINGS) : {};
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ onboarded: true, prefs: { lang: 'de', theme: 'dark', mode: 'simple' }, ...extra }));
  const app = await electron.launch({
    executablePath: process.env.SLIMMANAGER_EXE || require('electron'),
    args: process.env.SLIMMANAGER_EXE ? [] : [ROOT],
    env: { ...process.env, SLIMMANAGER_USERDATA: userData, SLIMMANAGER_PORT: '0', SLIMMANAGER_TEST: '1' },
  });
  const win = await app.firstWindow();
  await win.waitForSelector('[data-testid="dashboard"]');
  if (scenario === 'minimized') await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  if (scenario === 'processes') await win.click('[data-testid="nav-processes"]');
  const root = app.process().pid;
  await sleep(8000); // Start abwarten

  // CPU-Zeit aller Prozesse vorher/nachher – kurzlebige Helfer zählen über ihre Eltern (ps zählt beendete Kinder nicht mit),
  // deshalb zusätzlich jede Sekunde abtasten
  const seen = new Map(); // pid → letzte gesehene CPU-Zeit
  const start = new Map();
  for (const p of tree(root)) start.set(p.pid, p.time);
  let maxRss = 0;
  const t0 = Date.now();
  const byName = new Map();
  while (Date.now() - t0 < secs * 1000) {
    const now = tree(root);
    maxRss = Math.max(maxRss, now.reduce((s, p) => s + p.rss, 0));
    for (const p of now) {
      seen.set(p.pid, { time: p.time, comm: p.comm, rss: p.rss });
    }
    await sleep(500);
  }
  const elapsed = (Date.now() - t0) / 1000;
  let total = 0;
  for (const [pid, s] of seen) {
    const used = s.time - (start.get(pid) ?? 0);
    total += used;
    const k = s.comm.replace(/ Helper[^[]*/, ' Helper ').slice(0, 52);
    const e = byName.get(k) || { cpu: 0, rss: 0, n: 0 };
    e.cpu += used;
    e.rss = Math.max(e.rss, s.rss);
    e.n++;
    byName.set(k, e);
  }
  const rssNow = tree(root).reduce((s, p) => s + p.rss, 0);
  console.log(`Szenario: ${scenario} · ${elapsed.toFixed(0)} s`);
  console.log(`CPU wie Aktivitätsanzeige (100 % = 1 Kern): ${((total / elapsed) * 100).toFixed(1)} %  ·  wie Task-Manager (Anteil ganze CPU): ${((total / elapsed / os.cpus().length) * 100).toFixed(2)} %`);
  console.log(`Arbeitsspeicher jetzt: ${(rssNow / 1048576).toFixed(0)} MB (Spitze ${(maxRss / 1048576).toFixed(0)} MB)`);
  for (const [k, e] of [...byName].sort((a, b) => b[1].cpu - a[1].cpu).slice(0, 12)) {
    console.log(`  ${k.padEnd(52)} CPU ${((e.cpu / elapsed) * 100).toFixed(1).padStart(5)} %  RAM ${(e.rss / 1048576).toFixed(0).padStart(5)} MB  (${e.n}×)`);
  }
  await app.close();
})();
