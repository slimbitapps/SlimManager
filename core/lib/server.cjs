'use strict';
/**
 * Kleiner Webserver im lokalen Netz:
 *  - liefert die Handy-Seite aus (keine App-Installation nötig)
 *  - schickt Live-Werte an gekoppelte Handys/Tablets und nimmt deren Befehle entgegen
 *
 * Schutz: nur private IP-Adressen, nur IP-Adressen als Host (gegen DNS-Rebinding),
 * Origin-Prüfung, Größenlimits, Sperre nach mehreren Fehlversuchen.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { WebSocketServer } = require('ws');
const { hmac, safeEqual, newSecret, cmdMsg, cleanName } = require('./auth.cjs');
const { isPrivateIp } = require('./network.cjs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};
const HOST_RE = /^(\d{1,3}(\.\d{1,3}){3}|localhost|\[[0-9a-fA-F:]+\])(:\d{1,5})?$/;
const MAX_FAILS = 5;
const BLOCK_MS = 60_000;
const APPROVAL_MS = 60_000;

/** Befehle, die das Handy schicken darf. */
const COMMANDS = new Set(['ping', 'sub', 'unsub', 'kill', 'prio', 'boost', 'unboost', 'overlay', 'history', 'layout']);
/** Themen, die ein Handy abonnieren kann (z. B. Prozessliste nur, wenn sie offen ist). */
const TOPICS = new Set(['procs']);

class RemoteServer extends EventEmitter {
  /**
   * @param {{root: string, pairing: import('./auth.cjs').Pairing, port?: number, host?: string,
   *          allowAnyIp?: boolean, needsApproval?: () => boolean}} opts
   */
  constructor({ root, pairing, port = 8642, host = '0.0.0.0', allowAnyIp = false, needsApproval = () => true }) {
    super();
    this.root = root;
    this.pairing = pairing;
    this.wantedPort = port;
    this.host = host;
    this.allowAnyIp = allowAnyIp;
    this.needsApproval = needsApproval;
    this.port = 0;
    this.fails = new Map(); // ip → { n, until }
    this.conns = new Set();
    this.server = null;
    this.wss = null;
    this.lastHit = 0; // letzter Seitenaufruf (für "Handy findet den Laptop nicht?")
  }

  // ------------------------------------------------------------------ Start/Stopp
  async start() {
    this.server = http.createServer((req, res) => this.onHttp(req, res));
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
    this.server.on('upgrade', (req, sock, head) => this.onUpgrade(req, sock, head));
    this.port = await listen(this.server, this.wantedPort, this.host).catch(() => listen(this.server, 0, this.host));
    this.heartbeat = setInterval(() => this.beat(), 10_000);
    return this.port;
  }

  async stop() {
    clearInterval(this.heartbeat);
    for (const c of this.conns) c.ws.terminate();
    this.conns.clear();
    await new Promise((r) => (this.server ? this.server.close(() => r()) : r()));
    this.server = null;
  }

  beat() {
    for (const c of this.conns) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      try {
        c.ws.ping();
      } catch {
        /* egal */
      }
    }
  }

  // ------------------------------------------------------------------ Zugriffsschutz
  ipOf(req) {
    return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  }
  allowed(req) {
    const ip = this.ipOf(req);
    if (!this.allowAnyIp && !isPrivateIp(ip)) return false;
    if (!HOST_RE.test(String(req.headers.host || ''))) return false;
    const f = this.fails.get(ip);
    return !(f && f.until > Date.now());
  }
  fail(ip) {
    const f = this.fails.get(ip) || { n: 0, until: 0 };
    f.n += 1;
    if (f.n >= MAX_FAILS) {
      f.until = Date.now() + BLOCK_MS;
      f.n = 0;
    }
    this.fails.set(ip, f);
    return f.until > Date.now();
  }

  // ------------------------------------------------------------------ Webseite
  onHttp(req, res) {
    if (!this.allowed(req)) {
      res.writeHead(403).end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    const url = new URL(req.url || '/', 'http://x');
    let rel;
    if (url.pathname === '/' || url.pathname === '/index.html') rel = 'remote.html';
    else if (/^\/assets\/[\w.-]+$/.test(url.pathname)) rel = url.pathname.slice(1);
    else if (url.pathname === '/icon.png') rel = 'icon.png';
    else {
      res.writeHead(404).end();
      return;
    }
    const file = path.join(this.root, rel);
    if (!file.startsWith(path.resolve(this.root) + path.sep)) {
      res.writeHead(404).end();
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404).end();
        return;
      }
      const host = String(req.headers.host);
      const ext = path.extname(file);
      if (ext === '.html') this.lastHit = Date.now();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy':
          `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; ` +
          `media-src 'self' data: blob:; connect-src ws://${host}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
  }

  // ------------------------------------------------------------------ WebSocket
  onUpgrade(req, sock, head) {
    const url = new URL(req.url || '/', 'http://x');
    const origin = String(req.headers.origin || '');
    const sameOrigin = origin === `http://${req.headers.host}`;
    if (url.pathname !== '/ws' || !this.allowed(req) || !sameOrigin) {
      sock.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      sock.destroy();
      return;
    }
    this.wss.handleUpgrade(req, sock, head, (ws) => this.onConnection(ws, req));
  }

  onConnection(ws, req) {
    const c = { ws, ip: this.ipOf(req), nonce: newSecret(), authed: false, device: null, lastSeq: 0, alive: true, pending: false, budget: 120, budgetAt: Date.now(), subs: new Set() };
    this.conns.add(c);
    ws.on('pong', () => (c.alive = true));
    ws.on('close', () => {
      this.conns.delete(c);
      if (c.subs.size) this.emit('subs', this.subscribers('procs'));
      if (c.authed) this.emit('clients', this.clients());
    });
    ws.on('error', () => {});
    ws.on('message', (data, isBinary) => {
      if (isBinary) return ws.close(1003);
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return ws.close(1007);
      }
      if (!msg || typeof msg !== 'object') return ws.close(1007);
      this.onMessage(c, msg);
    });
    send(ws, { t: 'hello', v: 1, app: 'SlimManager', nonce: c.nonce });
  }

  reject(c, code) {
    const blocked = this.fail(c.ip);
    send(c.ws, { t: 'error', code: blocked ? 'blocked' : code });
    c.ws.close(4001);
  }

  async onMessage(c, msg) {
    // Einfache Bremse gegen Überflutung (Zeiger schickt bis zu ~60 Nachrichten/s)
    const now = Date.now();
    c.budget = Math.min(240, c.budget + ((now - c.budgetAt) / 1000) * 120);
    c.budgetAt = now;
    if ((c.budget -= 1) < 0) return;

    if (!c.authed) {
      if (c.pending) return;
      if (msg.t === 'auth') {
        if (!this.pairing.checkAuth(msg.id, c.nonce, msg.mac)) return this.reject(c, this.pairing.find(msg.id) ? 'bad-auth' : 'unknown-device');
        return this.accept(c, this.pairing.find(msg.id));
      }
      if (msg.t === 'pair') {
        const via = msg.via === 'pin' ? 'pin' : 'code';
        const key = this.pairing.checkPair(c.nonce, msg.id, msg.mac, via);
        if (!key) {
          // Falsche PIN → sofort neue PIN (Raten wird so aussichtslos)
          if (via === 'pin') {
            this.pairing.rotatePin();
            this.emit('code', this.pairing.code);
          }
          return this.reject(c, via === 'pin' ? 'bad-pin' : 'bad-code');
        }
        const name = cleanName(msg.name);
        // Ist schon ein anderes Handy verbunden, muss der Laptop zustimmen.
        if (this.needsApproval() && this.clients().length > 0) {
          c.pending = true;
          send(c.ws, { t: 'pending' });
          const ok = await this.askApproval(name);
          c.pending = false;
          if (!ok || c.ws.readyState !== c.ws.OPEN) return this.reject(c, 'denied');
        }
        this.pairing.addDevice(msg.id, name, key);
        this.emit('code', this.pairing.code);
        send(c.ws, { t: 'paired' });
        return this.accept(c, this.pairing.find(msg.id));
      }
      return this.reject(c, 'bad-auth');
    }

    if (msg.t !== 'cmd') return;
    const seq = Number(msg.s);
    const cmd = String(msg.c);
    if (!Number.isSafeInteger(seq) || seq <= c.lastSeq || !COMMANDS.has(cmd)) return;
    if (!safeEqual(hmac(c.device.key, cmdMsg(c.nonce, seq, cmd, msg.a)), String(msg.m))) return;
    c.lastSeq = seq;
    if (cmd === 'ping') return send(c.ws, { t: 'pong', s: seq });
    if (cmd === 'sub' || cmd === 'unsub') {
      const topic = String(msg.a);
      if (!TOPICS.has(topic)) return;
      const had = c.subs.has(topic);
      if (cmd === 'sub') c.subs.add(topic);
      else c.subs.delete(topic);
      if (had !== c.subs.has(topic)) this.emit('subs', this.subscribers(topic));
      return;
    }
    this.emit('command', { device: c.device.id, name: c.device.name, c: cmd, a: msg.a ?? null, reply: (m) => send(c.ws, m) });
  }

  accept(c, device) {
    c.authed = true;
    c.device = device;
    this.fails.delete(c.ip);
    this.pairing.touch(device.id);
    send(c.ws, { t: 'ok', name: device.name });
    this.emit('clients', this.clients());
    this.emit('joined', device.id);
  }

  askApproval(name) {
    return new Promise((resolve) => {
      const id = newSecret(6);
      const timer = setTimeout(() => done(false), APPROVAL_MS);
      const done = (ok) => {
        clearTimeout(timer);
        this.removeAllListeners('approval-answer:' + id);
        this.emit('approval-done', id);
        resolve(!!ok);
      };
      this.once('approval-answer:' + id, done);
      this.emit('approval', { id, name });
    });
  }
  answerApproval(id, ok) {
    this.emit('approval-answer:' + id, ok);
  }

  // ------------------------------------------------------------------ Senden
  clients() {
    const seen = new Map();
    for (const c of this.conns) if (c.authed) seen.set(c.device.id, { id: c.device.id, name: c.device.name, ip: c.ip });
    return [...seen.values()];
  }
  broadcast(msg, topic) {
    const s = JSON.stringify(msg);
    for (const c of this.conns) if (c.authed && c.ws.readyState === c.ws.OPEN && (!topic || c.subs.has(topic))) c.ws.send(s);
  }
  /** Wie viele Verbindungen ein Thema abonniert haben */
  subscribers(topic) {
    let n = 0;
    for (const c of this.conns) if (c.authed && c.subs.has(topic)) n++;
    return n;
  }
  sendTo(deviceId, msg) {
    for (const c of this.conns) if (c.authed && c.device.id === deviceId) send(c.ws, msg);
  }
  disconnect(deviceId) {
    for (const c of this.conns) {
      if (c.device && c.device.id === deviceId) {
        send(c.ws, { t: 'error', code: 'removed' });
        c.ws.close(4002);
      }
    }
  }
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onErr = (e) => {
      server.off('listening', onOk);
      reject(e);
    };
    const onOk = () => {
      server.off('error', onErr);
      resolve(server.address().port);
    };
    server.once('error', onErr);
    server.once('listening', onOk);
    server.listen(port, host);
  });
}

module.exports = { RemoteServer, COMMANDS, TOPICS };
