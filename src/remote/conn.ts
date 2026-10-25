/**
 * Verbindung Handy ↔ PC über WebSocket.
 * Kopplung per QR-Code (Einmal-Code im "#"-Teil) oder per 6-stelliger PIN.
 * Danach meldet sich das Handy mit seinem Geräte-Schlüssel an; jeder Befehl ist signiert.
 */
import { hmacHex, pairMsg, keyMsg, authMsg, cmdMsg } from '../shared/hmac';

// ------------------------------------------------------------------ Speicher
export const store = {
  get(k: string) {
    try {
      return localStorage.getItem('slimmanager.' + k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem('slimmanager.' + k);
      else localStorage.setItem('slimmanager.' + k, v);
    } catch {
      /* privater Modus: dann eben ohne Speichern */
    }
  },
};

function randomId() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return 'p' + Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android' : 'Android-Tablet') : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Phone';
  const br = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}

export type Status = 'connecting' | 'pin' | 'approval' | 'ok' | 'error' | 'scan';
export interface ConnEvents {
  status: (s: Status, code?: string) => void;
  message: (m: any) => void;
  online: (on: boolean) => void;
}

export class Conn {
  private ws: WebSocket | null = null;
  private nonce = '';
  private seq = 0;
  private authed = false;
  private fatal = false;
  private retryMs = 400;
  private retryTimer = 0;
  private everConnected = false;
  private failedTries = 0;
  private pendingKey: string | null = null;
  private deviceId = store.get('id') || randomId();
  private deviceKey = store.get('key');
  private pairSecret: { via: 'code' | 'pin'; secret: string } | null = null;

  constructor(private ev: ConnEvents) {
    store.set('id', this.deviceId);
    // Kopplungs-Code aus dem "#"-Teil holen und sofort aus der Adresszeile entfernen
    const code = new URLSearchParams(location.hash.slice(1)).get('p');
    if (location.hash) history.replaceState(null, '', location.pathname);
    if (code) this.pairSecret = { via: 'code', secret: code };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.fatal) this.connect();
    });
    setInterval(() => this.authed && this.send('ping'), 20_000);
  }

  get canConnect() {
    return !!(this.pairSecret || this.deviceKey);
  }

  /** PIN eingegeben → koppeln */
  usePin(pin: string) {
    this.pairSecret = { via: 'pin', secret: pin.replace(/\D/g, '') };
    this.fatal = false;
    this.failedTries = 0;
    this.close();
    this.connect();
  }

  retry() {
    this.fatal = false;
    this.failedTries = 0;
    this.retryMs = 400;
    this.connect();
  }

  forget() {
    this.deviceKey = null;
    store.set('key', null);
    this.fatal = true;
    this.close();
    this.ev.status('pin');
  }

  private close() {
    const s = this.ws;
    this.ws = null;
    try {
      s?.close();
    } catch {
      /* egal */
    }
  }

  connect() {
    clearTimeout(this.retryTimer);
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (!this.canConnect) {
      this.ev.status('pin');
      return;
    }
    if (!this.everConnected) this.ev.status('connecting');
    const sock = new WebSocket(`ws://${location.host}/ws`);
    this.ws = sock;
    this.authed = false;
    sock.onmessage = (e) => {
      let m: any;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      this.onMessage(m);
    };
    sock.onclose = () => {
      if (this.ws !== sock) return;
      this.authed = false;
      this.ev.online(false);
      if (this.fatal) return;
      this.failedTries++;
      if (!this.everConnected && this.failedTries > 3) this.ev.status('error', 'unreachable');
      this.retryTimer = window.setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 1.6, 4000);
    };
  }

  private onMessage(m: any) {
    switch (m.t) {
      case 'hello':
        this.nonce = m.nonce;
        this.seq = 0;
        if (this.pairSecret) {
          const { via, secret } = this.pairSecret;
          this.ws?.send(JSON.stringify({ t: 'pair', via, id: this.deviceId, name: deviceName(), mac: hmacHex(secret, pairMsg(this.nonce, this.deviceId)) }));
          // Den Schlüssel leiten beide Seiten gleich ab – er wird nie gesendet.
          this.pendingKey = hmacHex(secret, keyMsg(this.nonce, this.deviceId));
        } else if (this.deviceKey) {
          this.ws?.send(JSON.stringify({ t: 'auth', id: this.deviceId, mac: hmacHex(this.deviceKey, authMsg(this.nonce)) }));
        }
        return;
      case 'pending':
        this.ev.status('approval');
        return;
      case 'paired':
        this.deviceKey = this.pendingKey;
        store.set('key', this.deviceKey);
        this.pairSecret = null;
        return;
      case 'ok':
        this.authed = true;
        this.everConnected = true;
        this.fatal = false;
        this.failedTries = 0;
        this.retryMs = 400;
        this.ev.status('ok');
        this.ev.online(true);
        return;
      case 'error':
        this.onError(String(m.code));
        return;
    }
    this.ev.message(m);
  }

  private onError(code: string) {
    if (code === 'bad-code' && this.deviceKey) {
      // Alter QR-Code, aber wir sind schon gekoppelt → normal anmelden
      this.pairSecret = null;
      return;
    }
    if (['bad-code', 'bad-pin', 'unknown-device', 'bad-auth', 'removed', 'denied'].includes(code)) {
      if (code !== 'bad-pin' && code !== 'denied') {
        this.deviceKey = null;
        store.set('key', null);
      }
      this.pairSecret = null;
      this.fatal = true;
      this.ev.status('pin', code);
    } else if (code === 'blocked') {
      this.fatal = true;
      this.ev.status('error', 'blocked');
    }
  }

  /** Befehl signiert an den PC senden */
  send(c: string, a: unknown = null) {
    if (!this.ws || !this.authed || this.ws.readyState !== WebSocket.OPEN) return false;
    this.seq += 1;
    this.ws.send(JSON.stringify({ t: 'cmd', s: this.seq, c, a, m: hmacHex(this.deviceKey!, cmdMsg(this.nonce, this.seq, c, a)) }));
    return true;
  }
}
