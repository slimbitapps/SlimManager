'use strict';
// Sicherheitstests: Nur ein gekoppeltes Handy darf steuern – alles andere wird abgewiesen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const WebSocket = require('ws');
const { RemoteServer } = require('../electron/core/server.cjs');
const { Pairing, hmac, pairMsg, keyMsg, authMsg, cmdMsg } = require('../electron/core/auth.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slimclick-srv-'));
fs.writeFileSync(path.join(root, 'remote.html'), '<!doctype html><title>remote</title>');
fs.mkdirSync(path.join(root, 'assets'));
fs.writeFileSync(path.join(root, 'assets', 'a.js'), 'console.log(1)');
fs.writeFileSync(path.join(root, 'geheim.txt'), 'nein');

async function setup(opts = {}) {
  const pairing = new Pairing();
  const srv = new RemoteServer({ root, pairing, port: 0, host: '127.0.0.1', ...opts });
  const port = await srv.start();
  return { srv, pairing, port };
}

/** Kleiner Test-Client, der sich wie die Handy-Seite verhält. */
function client(port, { origin } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: origin ?? `http://127.0.0.1:${port}` } });
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    inbox.push(m);
    waiters.splice(0).forEach((w) => w());
  });
  const closed = new Promise((r) => ws.on('close', (code) => r(code)));
  ws.on('error', () => {});
  async function next(type, ms = 2000) {
    const t0 = Date.now();
    for (;;) {
      const i = inbox.findIndex((m) => !type || m.t === type);
      if (i >= 0) return inbox.splice(i, 1)[0];
      if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + type);
      await new Promise((r) => {
        waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }
  const sendJ = (m) => ws.send(JSON.stringify(m));
  return { ws, next, send: sendJ, closed, inbox };
}

async function pair(port, code, id = 'phone-abcdef12') {
  const c = client(port);
  const hello = await c.next('hello');
  c.send({ t: 'pair', id, name: 'Test-Handy', mac: hmac(code, pairMsg(hello.nonce, id)) });
  const key = hmac(code, keyMsg(hello.nonce, id));
  return { c, hello, key, id };
}

function cmd(c, key, nonce, seq, name, a = null) {
  c.send({ t: 'cmd', s: seq, c: name, a, m: hmac(key, cmdMsg(nonce, seq, name, a)) });
}

test('Koppeln mit richtigem Code, Befehle kommen an, Code wird danach gewechselt', async () => {
  const { srv, pairing, port } = await setup();
  const code = pairing.code;
  const got = [];
  srv.on('command', (x) => got.push(x));
  const { c, hello, key } = await pair(port, code);
  await c.next('paired');
  await c.next('ok');
  assert.notEqual(pairing.code, code, 'Kopplungs-Code muss sich nach dem Koppeln ändern');
  cmd(c, key, hello.nonce, 1, 'unboost');
  cmd(c, key, hello.nonce, 2, 'prio', { id: 'chrome', level: 'below' });
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(got.map((g) => g.c), ['unboost', 'prio']);
  assert.deepEqual(got[1].a, { id: 'chrome', level: 'below' });
  assert.equal(srv.clients().length, 1);
  c.ws.close();
  await srv.stop();
});

test('Falscher Code wird abgewiesen', async () => {
  const { srv, port } = await setup();
  const { c } = await pair(port, 'falscher-code');
  const err = await c.next('error');
  assert.equal(err.code, 'bad-code');
  assert.equal(await c.closed, 4001);
  await srv.stop();
});

test('Alter (abfotografierter) QR-Code funktioniert nach dem Koppeln nicht mehr', async () => {
  const { srv, pairing, port } = await setup({ needsApproval: () => false });
  const oldCode = pairing.code;
  const a = await pair(port, oldCode, 'phone-aaaaaaaa');
  await a.c.next('ok');
  const b = await pair(port, oldCode, 'phone-bbbbbbbb');
  assert.equal((await b.c.next('error')).code, 'bad-code');
  a.c.ws.close();
  await srv.stop();
});

test('Wiederholte, veränderte oder unsignierte Befehle werden ignoriert', async () => {
  const { srv, pairing, port } = await setup();
  const got = [];
  srv.on('command', (x) => got.push(x.c));
  const { c, hello, key } = await pair(port, pairing.code);
  await c.next('ok');
  cmd(c, key, hello.nonce, 5, 'unboost');
  cmd(c, key, hello.nonce, 5, 'unboost'); // Wiederholung
  cmd(c, key, hello.nonce, 4, 'boost', { app: 'x' }); // alte Nummer
  c.send({ t: 'cmd', s: 6, c: 'unboost', a: null, m: '00'.repeat(32) }); // falsche Signatur
  c.send({ t: 'cmd', s: 7, c: 'kill', a: { id: 'explorer' }, m: hmac(key, cmdMsg(hello.nonce, 7, 'kill', { id: 'game' })) }); // verändert
  cmd(c, key, hello.nonce, 8, 'rm -rf'); // unbekannter Befehl
  cmd(c, 'falscher-schluessel', hello.nonce, 9, 'unboost');
  cmd(c, key, hello.nonce, 10, 'kill', { id: 'game' });
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(got, ['unboost', 'kill']);
  c.ws.close();
  await srv.stop();
});

test('Wiederverbinden mit gespeichertem Schlüssel – aber nicht mit falschem', async () => {
  const { srv, pairing, port } = await setup();
  const { c, key, id } = await pair(port, pairing.code);
  await c.next('ok');
  c.ws.close();
  await c.closed;

  const c2 = client(port);
  const h2 = await c2.next('hello');
  c2.send({ t: 'auth', id, mac: hmac(key, authMsg(h2.nonce)) });
  await c2.next('ok');
  c2.ws.close();

  const c3 = client(port);
  const h3 = await c3.next('hello');
  c3.send({ t: 'auth', id, mac: hmac('geraten', authMsg(h3.nonce)) });
  assert.equal((await c3.next('error')).code, 'bad-auth');

  const c4 = client(port);
  const h4 = await c4.next('hello');
  c4.send({ t: 'auth', id: 'unbekannt-1234', mac: hmac(key, authMsg(h4.nonce)) });
  assert.equal((await c4.next('error')).code, 'unknown-device');
  await srv.stop();
});

test('Mitschnitt einer alten Anmeldung hilft nicht (neue Zufallszahl pro Verbindung)', async () => {
  const { srv, pairing, port } = await setup();
  const { c, hello, key, id } = await pair(port, pairing.code);
  await c.next('ok');
  const sniffedMac = hmac(key, authMsg(hello.nonce));
  c.ws.close();
  const c2 = client(port);
  const h2 = await c2.next('hello');
  assert.notEqual(h2.nonce, hello.nonce);
  c2.send({ t: 'auth', id, mac: sniffedMac });
  assert.equal((await c2.next('error')).code, 'bad-auth');
  await srv.stop();
});

test('Zweites Handy braucht Zustimmung am Laptop', async () => {
  const { srv, pairing, port } = await setup();
  const a = await pair(port, pairing.code, 'phone-aaaaaaaa');
  await a.c.next('ok');
  srv.once('approval', (req) => {
    assert.equal(req.name, 'Test-Handy');
    srv.answerApproval(req.id, false);
  });
  const b = await pair(port, pairing.code, 'phone-bbbbbbbb');
  await b.c.next('pending');
  assert.equal((await b.c.next('error')).code, 'denied');

  srv.once('approval', (req) => srv.answerApproval(req.id, true));
  const d = await pair(port, pairing.code, 'phone-dddddddd');
  await d.c.next('pending');
  await d.c.next('ok');
  assert.equal(srv.clients().length, 2);
  a.c.ws.close();
  d.c.ws.close();
  await srv.stop();
});

test('Nach 5 Fehlversuchen wird die Adresse kurz gesperrt', async () => {
  const { srv, port } = await setup();
  let last;
  for (let i = 0; i < 5; i++) {
    const { c } = await pair(port, 'falsch' + i);
    last = await c.next('error');
  }
  assert.equal(last.code, 'blocked');
  // Auch die Webseite ist jetzt gesperrt
  const status = await new Promise((r) => http.get({ host: '127.0.0.1', port, path: '/' }, (res) => r(res.statusCode)));
  assert.equal(status, 403);
  await srv.stop();
});

test('Fremde Webseiten (anderer Origin) dürfen nicht verbinden', async () => {
  const { srv, port } = await setup();
  const c = client(port, { origin: 'http://evil.example' });
  const code = await Promise.race([c.closed, new Promise((r) => c.ws.on('unexpected-response', (_q, res) => r(res.statusCode)))]);
  assert.ok(code === 403 || code === 1006, 'Verbindung muss abgelehnt werden: ' + code);
  await srv.stop();
});

function get(port, p, host) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: p, headers: host ? { Host: host } : {} }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
  });
}

test('Webseite: nur erlaubte Dateien, sichere Header, kein DNS-Rebinding', async () => {
  const { srv, port } = await setup();
  const home = await get(port, '/');
  assert.equal(home.status, 200);
  assert.match(home.headers['content-security-policy'], /connect-src ws:\/\/127\.0\.0\.1:\d+/);
  assert.equal(home.headers['referrer-policy'], 'no-referrer');
  assert.equal((await get(port, '/assets/a.js')).status, 200);
  assert.equal((await get(port, '/geheim.txt')).status, 404);
  assert.equal((await get(port, '/assets/../geheim.txt')).status, 404);
  assert.equal((await get(port, '/assets/%2e%2e%2fgeheim.txt')).status, 404);
  assert.equal((await get(port, '/', 'evil.example.com')).status, 403);
  await srv.stop();
});

test('Besetzter Port → anderer freier Port', async () => {
  const blocker = http.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => blocker.once('listening', r));
  const busy = blocker.address().port;
  const { srv, port } = await setup({ port: busy });
  assert.notEqual(port, busy);
  await srv.stop();
  blocker.close();
});

test('Koppeln per PIN – falsche PIN wechselt die PIN sofort', async () => {
  const { srv, pairing, port } = await setup();
  const oldPin = pairing.pin;
  const bad = client(port);
  const h1 = await bad.next('hello');
  bad.send({ t: 'pair', via: 'pin', id: 'phone-pinbad01', name: 'X', mac: hmac('123456', pairMsg(h1.nonce, 'phone-pinbad01')) });
  assert.equal((await bad.next('error')).code, 'bad-pin');
  assert.notEqual(pairing.pin, oldPin, 'PIN muss nach Fehlversuch wechseln');

  const pin = pairing.pin;
  const c = client(port);
  const h = await c.next('hello');
  c.send({ t: 'pair', via: 'pin', id: 'phone-pinok001', name: 'Tablet', mac: hmac(pin, pairMsg(h.nonce, 'phone-pinok001')) });
  await c.next('paired');
  await c.next('ok');
  assert.ok(pairing.find('phone-pinok001'), 'Gerät gespeichert');
  assert.notEqual(pairing.pin, pin, 'PIN nach Kopplung gewechselt');
  // Der Schlüssel wird aus der PIN abgeleitet – damit klappt die nächste Anmeldung
  const key = hmac(pin, keyMsg(h.nonce, 'phone-pinok001'));
  c.ws.close();
  const c2 = client(port);
  const h2 = await c2.next('hello');
  c2.send({ t: 'auth', id: 'phone-pinok001', mac: hmac(key, authMsg(h2.nonce)) });
  await c2.next('ok');
  c2.ws.close();
  await srv.stop();
});

test('PIN läuft nach 5 Minuten ab', () => {
  const pairing = new Pairing();
  const pin = pairing.pin;
  assert.match(pin, /^[1-9]\d{5}$/);
  assert.equal(pairing.freshPin(Date.now() + 60_000), pin);
  assert.notEqual(pairing.freshPin(Date.now() + 6 * 60_000), pin);
});

test('Prozessliste nur an Handys, die sie abonniert haben', async () => {
  const { srv, pairing, port } = await setup({ needsApproval: () => false });
  const subs = [];
  srv.on('subs', (n) => subs.push(n));
  const a = await pair(port, pairing.code, 'phone-aaaaaaaa');
  await a.c.next('ok');
  const b = await pair(port, pairing.code, 'phone-bbbbbbbb');
  await b.c.next('ok');
  cmd(a.c, a.key, a.hello.nonce, 1, 'sub', 'procs');
  cmd(a.c, a.key, a.hello.nonce, 2, 'sub', 'geheim'); // unbekanntes Thema
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(srv.subscribers('procs'), 1);
  srv.broadcast({ t: 'procs', p: [] }, 'procs');
  srv.broadcast({ t: 'stats', s: {} });
  await a.c.next('procs');
  await b.c.next('stats');
  assert.ok(!b.c.inbox.some((m) => m.t === 'procs'), 'B hat nicht abonniert');
  a.c.ws.close();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(srv.subscribers('procs'), 0);
  assert.deepEqual(subs, [1, 0]);
  b.c.ws.close();
  await srv.stop();
});

test('Fremde IP-Adressen (Internet) werden abgewiesen', () => {
  const { isPrivateIp } = require('../electron/core/network.cjs');
  for (const ip of ['192.168.1.20', '10.0.0.5', '172.20.10.3', '172.31.255.1', '::ffff:192.168.0.2', '127.0.0.1', 'fe80::1']) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '193.99.144.80', '2a00:1450::1', '']) assert.ok(!isPrivateIp(ip), ip);
});
