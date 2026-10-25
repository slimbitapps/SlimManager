'use strict';
/** Netzwerk-Adressen finden und die beste für den QR-Code auswählen. */
const os = require('node:os');

function ipv4ToInt(ip) {
  const p = String(ip).split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
function inRange(ip, base, bits) {
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  if (a === null || b === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

/** Nur Geräte aus dem eigenen (privaten) Netz dürfen sich verbinden. */
function isPrivateIp(ip) {
  let s = String(ip || '');
  if (s.startsWith('::ffff:')) s = s.slice(7);
  if (s === '::1') return true;
  if (s.includes(':')) {
    const l = s.toLowerCase();
    return l.startsWith('fe80:') || l.startsWith('fc') || l.startsWith('fd');
  }
  return (
    inRange(s, '10.0.0.0', 8) ||
    inRange(s, '172.16.0.0', 12) ||
    inRange(s, '192.168.0.0', 16) ||
    inRange(s, '169.254.0.0', 16) ||
    inRange(s, '127.0.0.0', 8) ||
    inRange(s, '100.64.0.0', 10) // Mobilfunk-Hotspots (CGNAT)
  );
}

const VIRTUAL = /(vEthernet|VirtualBox|VMware|vmnet|docker|br-|veth|utun|awdl|llw|bridge|Hyper-V|WSL|Loopback|tailscale|ZeroTier|vboxnet|anpi|ap1)/i;
const WIFI = /^(en0|wlan|wlp|wl|Wi-?Fi|WLAN|Drahtlos|Wireless)/i;
const ETHERNET = /^(en\d|eth|enp|eno|Ethernet|LAN)/i;

/** Art des Netzes erraten – für freundliche Hinweise in der App. */
function guessKind(name, address) {
  if (inRange(address, '172.20.10.0', 28)) return 'iphone-hotspot';
  if (inRange(address, '192.168.43.0', 24) || inRange(address, '192.168.137.0', 24)) return 'hotspot';
  if (WIFI.test(name)) return 'wifi';
  if (ETHERNET.test(name)) return 'ethernet';
  return 'other';
}

/**
 * Alle brauchbaren IPv4-Adressen, beste zuerst.
 * @param {ReturnType<typeof os.networkInterfaces>} [ifaces]
 */
function listAddresses(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces || {})) {
    for (const a of list || []) {
      const fam = a.family === 4 ? 'IPv4' : a.family;
      if (fam !== 'IPv4' || a.internal) continue;
      if (!isPrivateIp(a.address)) continue;
      const kind = guessKind(name, a.address);
      let score = 50;
      if (VIRTUAL.test(name)) score -= 40;
      if (kind === 'wifi' || kind === 'iphone-hotspot' || kind === 'hotspot') score += 30;
      if (kind === 'ethernet') score += 20;
      if (inRange(a.address, '169.254.0.0', 16)) score -= 45; // keine echte Verbindung
      if (inRange(a.address, '192.168.0.0', 16)) score += 5;
      out.push({ name, address: a.address, kind, score });
    }
  }
  return out.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
}

/** Gewünschte Adresse ("auto" oder eine feste) auflösen. */
function pickAddress(list, wanted = 'auto') {
  if (wanted && wanted !== 'auto') {
    const hit = list.find((a) => a.address === wanted || a.name === wanted);
    if (hit) return hit;
  }
  return list[0] || null;
}

module.exports = { isPrivateIp, listAddresses, pickAddress, guessKind, inRange };
