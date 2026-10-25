'use strict';
/**
 * Kopplung & Anmeldung der Handys – ohne dass ein Geheimnis je im Klartext übers WLAN geht.
 *
 * Ablauf:
 *  1. Der QR-Code enthält einen Kopplungs-Code im "#"-Teil der Adresse
 *     (http://192.168.1.5:8642/#p=CODE). Der Teil nach "#" wird vom Browser NIE gesendet.
 *  2. Der Laptop schickt eine Zufallszahl (nonce). Das Handy beweist mit
 *     HMAC(CODE, "pair|nonce|id"), dass es den Code kennt.
 *  3. Beide Seiten leiten daraus denselben Geräte-Schlüssel ab – er wird nie übertragen.
 *     Danach wird der Kopplungs-Code sofort gewechselt (ein abfotografierter QR-Code ist wertlos).
 *  4. Jeder Befehl trägt eine fortlaufende Nummer + HMAC → nicht fälschbar, nicht wiederholbar.
 *
 * Alternativ (ohne Kamera): Adresse abtippen und die 6-stellige PIN eingeben, die am PC steht.
 * Die PIN gilt nur kurz, wechselt nach jeder Kopplung und nach Fehlversuchen sperrt der Server.
 */
const crypto = require('node:crypto');

/** HMAC-SHA256 als Hex-Text (Schlüssel und Nachricht als UTF-8). */
function hmac(key, msg) {
  return crypto.createHmac('sha256', String(key)).update(String(msg)).digest('hex');
}

/** Vergleich in konstanter Zeit (verrät nichts über richtige Anfangszeichen). */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Zufälliger, URL-tauglicher Code (128 Bit). */
function newSecret(bytes = 16) {
  return crypto.randomBytes(bytes).toString('base64url');
}

const pairMsg = (nonce, id) => `pair|${nonce}|${id}`;
const keyMsg = (nonce, id) => `key|${nonce}|${id}`;
const authMsg = (nonce) => `auth|${nonce}`;
const cmdMsg = (nonce, seq, c, a) => `${nonce}|${seq}|${c}|${JSON.stringify(a ?? null)}`;

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const PIN_MS = 5 * 60_000;

/** 6-stellige Zufalls-PIN (ohne führende Null, damit sie nicht abgeschnitten wird). */
function newPin() {
  return String(crypto.randomInt(100000, 1000000));
}

class Pairing {
  /**
   * @param {{devices?: {id:string,name:string,key:string,added:number,lastSeen?:number}[], onChange?: (devices:any[]) => void}} opts
   */
  constructor({ devices = [], onChange = () => {} } = {}) {
    this.devices = devices.filter((d) => d && ID_RE.test(d.id) && typeof d.key === 'string');
    this.onChange = onChange;
    this.code = newSecret();
    this.pin = newPin();
    this.pinAt = Date.now();
  }

  rotate() {
    this.code = newSecret();
    this.rotatePin();
    return this.code;
  }

  rotatePin() {
    this.pin = newPin();
    this.pinAt = Date.now();
    return this.pin;
  }

  /** PIN läuft nach 5 Minuten ab → neue PIN */
  freshPin(now = Date.now()) {
    if (now - this.pinAt > PIN_MS) this.rotatePin();
    return this.pin;
  }

  isValidId(id) {
    return typeof id === 'string' && ID_RE.test(id);
  }

  /** Prüft den Kopplungs-Beweis. Gibt den abgeleiteten Geräte-Schlüssel zurück oder null. */
  checkPair(nonce, id, mac, via = 'code') {
    if (!this.isValidId(id)) return null;
    const secret = via === 'pin' ? this.freshPin() : this.code;
    if (!safeEqual(hmac(secret, pairMsg(nonce, id)), String(mac))) return null;
    return hmac(secret, keyMsg(nonce, id));
  }

  addDevice(id, name, key) {
    this.devices = this.devices.filter((d) => d.id !== id);
    this.devices.push({ id, name: cleanName(name), key, added: Date.now(), lastSeen: Date.now() });
    this.rotate();
    this.onChange(this.devices);
  }

  find(id) {
    return this.devices.find((d) => d.id === id) || null;
  }

  touch(id) {
    const d = this.find(id);
    if (d) {
      d.lastSeen = Date.now();
      this.onChange(this.devices);
    }
  }

  remove(id) {
    this.devices = this.devices.filter((d) => d.id !== id);
    this.onChange(this.devices);
  }

  removeAll() {
    this.devices = [];
    this.rotate();
    this.onChange(this.devices);
  }

  checkAuth(id, nonce, mac) {
    const d = this.find(id);
    return !!d && safeEqual(hmac(d.key, authMsg(nonce)), String(mac));
  }
}

/** Gerätenamen säubern (kommt vom Handy, also nicht vertrauenswürdig). */
function cleanName(name) {
  return String(name || 'Phone')
    .replace(/[^\p{L}\p{N} ._·()+-]/gu, '')
    .trim()
    .slice(0, 40) || 'Phone';
}

module.exports = { hmac, safeEqual, newSecret, newPin, Pairing, cleanName, pairMsg, keyMsg, authMsg, cmdMsg };
