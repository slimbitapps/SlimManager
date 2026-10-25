'use strict';
// Der eigenständige Kern (Tauri-Version): startet, meldet sich bei der Hülle, beantwortet die Oberfläche – nur mit Token.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

function startCore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-core-'));
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'core', 'main.cjs')], {
    env: { ...process.env, SM_USERDATA: dir, SM_PORT: '0', SLIMMANAGER_TEST: '1' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const lines = [];
  let buf = '';
  const waiters = [];
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
      waiters.splice(0).forEach((w) => w());
    }
  });
  const next = async (t, ms = 8000) => {
    const t0 = Date.now();
    for (;;) {
      const m = lines.find((l) => l.t === t);
      if (m) return m;
      if (Date.now() - t0 > ms) throw new Error('timeout ' + t);
      await new Promise((r) => (waiters.push(r), setTimeout(r, 100)));
    }
  };
  return { p, dir, next, lines };
}

function rpc(port, token, role = 'main') {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}&role=${role}`);
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
  const open = new Promise((r, j) => (ws.on('open', r), ws.on('error', j)));
  const closed = new Promise((r) => ws.on('close', (c) => r(c)));
  return { ws, call, open, closed, events };
}

test('Kern meldet sich, beantwortet die Oberfläche und schickt Live-Werte', async () => {
  const core = startCore();
  try {
    const ready = await core.next('ready');
    assert.ok(ready.port > 0 && ready.token.length > 20);
    await core.next('tray');
    const ui = rpc(ready.port, ready.token);
    await ui.open;
    const s = await ui.call('settings:get');
    assert.equal(s.look.skin, 'neon');
    assert.ok(!JSON.stringify(s).includes('"key"'), 'keine Geräte-Schlüssel');
    await ui.call('ui:state', { visible: true, focused: true, fullscreen: false });
    // Live-Werte kommen als Ereignis
    const t0 = Date.now();
    while (!ui.events.some((e) => e.ev === 'stats') && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 100));
    assert.ok(ui.events.some((e) => e.ev === 'stats'), 'stats-Ereignis');
    const info = await ui.call('remote:info');
    assert.match(info.qr, /<svg/);
    // Mini-Anzeige einschalten → Hülle bekommt den Auftrag
    await ui.call('overlay:set', true);
    const ov = await core.next('overlay');
    assert.equal(ov.on, true);
    // Unbekannte Befehle → Fehler, kein Absturz
    await assert.rejects(ui.call('gibts:nicht'));
    ui.ws.close();
  } finally {
    core.p.stdin.end(); // Hülle weg → Kern räumt auf und beendet sich
    await new Promise((r) => core.p.on('exit', r));
  }
});

test('Ohne richtigen Token keine Verbindung', async () => {
  const core = startCore();
  try {
    const ready = await core.next('ready');
    const bad = rpc(ready.port, 'falsch');
    assert.equal(await bad.closed, 4003);
  } finally {
    core.p.kill();
  }
});

test('Tastenkürzel von der Hülle schaltet die Mini-Anzeige', async () => {
  const core = startCore();
  try {
    await core.next('ready');
    core.p.stdin.write(JSON.stringify({ t: 'hotkey', k: 'overlay' }) + '\n');
    const ov = await core.next('overlay');
    assert.equal(ov.on, true);
    assert.ok(JSON.parse(fs.readFileSync(path.join(core.dir, 'settings.json'), 'utf8')).overlay.enabled);
  } finally {
    core.p.kill();
  }
});
