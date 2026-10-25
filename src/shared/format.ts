/** Zahlen hübsch anzeigen – gemeinsam für PC-Fenster, Handy und Mini-Anzeige. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Bytes → "1,4 GB" (Tausender wie im Task-Manager: 1024) */
export function bytes(v: number | null | undefined, locale = 'en', digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  let i = 0;
  let n = Math.abs(v);
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024;
    i++;
  }
  const d = i === 0 ? 0 : n >= 100 ? 0 : digits;
  return `${n.toLocaleString(locale, { maximumFractionDigits: d, minimumFractionDigits: d })} ${UNITS[i]}`;
}

/** Bytes pro Sekunde → "12,3 MB/s" */
export function rate(v: number | null | undefined, locale = 'en'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return bytes(v, locale) + '/s';
}

/** Netzwerk lieber in Bit (wie Internet-Tarife): "54 Mbit/s" */
export function bits(v: number | null | undefined, locale = 'en'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const b = v * 8;
  const units = ['bit/s', 'kbit/s', 'Mbit/s', 'Gbit/s'];
  let i = 0;
  let n = b;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n.toLocaleString(locale, { maximumFractionDigits: n >= 100 || i === 0 ? 0 : 1 })} ${units[i]}`;
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '–' : `${Math.round(v)} %`;
}

export function temp(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '–' : `${Math.round(v)} °C`;
}

/** Sekunden → "3 T 4 Std" / "1:05 Std" / "12 Min" */
export function duration(sec: number | null | undefined, lang = 'en'): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '–';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const de = lang === 'de';
  if (d > 0) return de ? `${d} T ${h} Std` : `${d}d ${h}h`;
  if (h > 0) return de ? `${h}:${String(m).padStart(2, '0')} Std` : `${h}h ${m}m`;
  return de ? `${m} Min` : `${m}m`;
}

/** Zahl für große Anzeigen ohne Einheit aufteilen: "12.3 MB/s" → ["12.3", "MB/s"] */
export function split(s: string): [string, string] {
  const i = s.indexOf(' ');
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
}
