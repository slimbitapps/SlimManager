'use strict';
/**
 * Leistungs-Test: Wie viel CPU/GPU braucht SlimManager SELBST, während das Dashboard offen ist?
 * Misst über Electrons eigene Prozess-Statistik (Hauptprozess, GPU-Prozess, Fenster) mehrere Sekunden lang.
 *
 *   node test/perf.cjs [skin] [bg] [sekunden]       z. B. node test/perf.cjs glass nebula 20
 *   PERF_MAX=5 node test/perf.cjs                   → schlägt fehl, wenn GPU+Fenster im Schnitt über 5 % liegen
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const [skin = 'neon', bg = 'aurora', secs = '15'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mac: gesamte GPU-Auslastung laut System (alle Programme) */
function gpuNow() {
  if (process.platform !== 'darwin') return null;
  const out = require('node:child_process').execFileSync('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator']).toString();
  const v = [...out.matchAll(/"Device Utilization %"=(\d+)/g)].map((m) => Number(m[1]));
  return v.length ? Math.max(...v) : null;
}
async function gpuAvg(secs) {
  let s = 0;
  for (let i = 0; i < secs * 2; i++) {
    s += gpuNow() ?? 0;
    await sleep(500);
  }
  return Math.round(s / (secs * 2));
}

(async () => {
  const baseline = process.platform === 'darwin' ? await gpuAvg(Number(secs)) : null;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'slimmanager-perf-'));
  // Einführung überspringen, gewünschten Skin setzen
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ onboarded: true, prefs: { lang: 'de', theme: 'dark', mode: 'simple' }, look: { skin, bg, rgb: process.env.PERF_RGB === '1', anim: process.env.PERF_ANIM !== '0', decimals: Number(process.env.PERF_DEC || 0) }, app: { rate: Number(process.env.PERF_RATE || 1000) } }));
  const app = await electron.launch({
    executablePath: process.env.SLIMMANAGER_EXE || require('electron'),
    args: process.env.SLIMMANAGER_EXE ? [] : [ROOT],
    env: { ...process.env, SLIMMANAGER_TEST: '1', SLIMMANAGER_USERDATA: userData, SLIMMANAGER_PORT: '0' },
  });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
  await win.waitForSelector('[data-testid="dashboard"]');
  await sleep(4000); // Start abwarten
  if (process.env.PERF_MIN === '1') await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  const metrics = () => app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ type: m.type, cpu: m.cpu.percentCPUUsage })));
  await metrics(); // erster Wert ist ungenau
  const sum = {};
  const n = Number(secs);
  let gpuSum = 0;
  for (let i = 0; i < n; i++) {
    await sleep(500);
    gpuSum += gpuNow() ?? 0;
    await sleep(500);
    gpuSum += gpuNow() ?? 0;
    for (const m of await metrics()) sum[m.type] = (sum[m.type] || 0) + m.cpu;
  }
  if (baseline !== null) console.log(`GPU-Auslastung Mac gesamt: ohne SlimManager ${baseline} % → mit SlimManager ${Math.round(gpuSum / (n * 2))} %`);
  const avg = Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, Math.round((v / n) * 10) / 10]));
  const gpuRender = (avg.GPU || 0) + (avg.Tab || 0);
  const total = Object.values(avg).reduce((a, b) => a + b, 0) / os.cpus().length;
  const gpuOn = await app.evaluate(({ app }) => app.getGPUFeatureStatus().gpu_compositing);
  console.log(`${process.env.PERF_MIN === '1' ? '[minimiert] ' : ''}Rate ${process.env.PERF_RATE || 1000} ms · Skin ${skin}/${bg} · GPU-Beschleunigung: ${gpuOn} · Durchschnitt (% eines Kerns):`, avg, `→ Grafik+Fenster: ${gpuRender.toFixed(1)} % · gesamt wie im Task-Manager: ${total.toFixed(2)} % der CPU`);
  await app.close();
  if (process.env.PERF_MAX && gpuRender > Number(process.env.PERF_MAX)) {
    console.error(`✗ zu hoch (Grenze ${process.env.PERF_MAX} %)`);
    process.exitCode = 1;
  }
})();
