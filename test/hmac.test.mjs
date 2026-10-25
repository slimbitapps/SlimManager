// Prüft: Die HMAC-Version der Handy-Seite rechnet exakt wie Node (der Laptop).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { hmacHex, sha256, cmdMsg } from '../src/shared/hmac.ts';
import auth from '../electron/core/auth.cjs';

test('SHA-256 bekannte Werte', () => {
  const hex = (b) => Buffer.from(b).toString('hex');
  assert.equal(hex(sha256(new Uint8Array())), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hex(sha256(new TextEncoder().encode('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('HMAC identisch zu Node für viele zufällige Eingaben', () => {
  for (let i = 0; i < 400; i++) {
    const key = crypto.randomBytes(i % 90).toString('base64url');
    const msg = crypto.randomBytes(i * 3).toString('base64') + (i % 7 === 0 ? ' äöü 🎤' : '');
    assert.equal(hmacHex(key, msg), crypto.createHmac('sha256', key).update(msg).digest('hex'), `Fall ${i}`);
  }
});

test('Befehls-Format auf Handy und Laptop gleich', () => {
  const a = { x: 0.123456789, y: 1, down: true };
  assert.equal(cmdMsg('n', 3, 'pointer', a), auth.cmdMsg('n', 3, 'pointer', JSON.parse(JSON.stringify(a))));
  assert.equal(cmdMsg('n', 1, 'next', undefined), auth.cmdMsg('n', 1, 'next', null));
});
