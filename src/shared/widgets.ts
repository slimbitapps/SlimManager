/**
 * Alle Widgets des Dashboards: welche es gibt, welche Messwerte, Standard-Layouts.
 * Die ID-Listen müssen mit core/lib/layout.cjs übereinstimmen (wird getestet).
 */
import type { MetricId, Skin, Stats, Widget, WidgetType, WSize, WStyle, SysInfo } from './types';
import { bits, bytes, pct, rate, temp } from './format';

export const WIDGET_TYPES: WidgetType[] = ['metric', 'cores', 'procs', 'clock', 'net', 'disks', 'boost', 'system', 'battery', 'text'];
export const METRICS: MetricId[] = ['cpu', 'ram', 'gpu', 'gpuMem', 'cpuTemp', 'gpuTemp', 'netDown', 'netUp', 'diskRead', 'diskWrite', 'swap', 'cpuSpeed', 'battery', 'procCount'];
export const STYLES: WStyle[] = ['ring', 'speedo', 'bar', 'chart', 'number'];
export const SIZES: WSize[] = ['s', 'w', 't', 'm', 'l', 'xl'];
export const SKINS: Skin[] = ['neon', 'glass', 'clean', 'classic', 'terminal', 'sunset'];

/** Breite × Höhe in Rasterfeldern */
export const SPAN: Record<WSize, [number, number]> = { s: [1, 1], w: [2, 1], t: [1, 2], m: [2, 2], l: [3, 2], xl: [4, 2] };

export interface MetricInfo {
  /** feste Obergrenze (z. B. 100 %) – ohne: aus dem Verlauf */
  max?: number;
  /** Farbe im Diagramm (CSS-Variable des Skins) */
  color: string;
  /** Wert aus dem Messpaket */
  value: (s: Stats) => number | null;
  /** Wert als Text (dec = Nachkommastellen, wo sinnvoll) */
  fmt: (v: number | null, locale: string, dec?: number) => string;
  /** kleiner Zusatztext unter dem Wert */
  sub?: (s: Stats, sys: SysInfo | null, locale: string) => string;
  /** ab wann der Wert "warm" / "heiß" eingefärbt wird */
  warn?: [number, number];
}

const gb = (v: number | null, l: string) => bytes(v, l);

export const METRIC: Record<MetricId, MetricInfo> = {
  cpu: { max: 100, color: 'var(--c-cpu)', value: (s) => s.cpu, fmt: (v, l, d) => pct(v, d, l), sub: (s, sys) => [sys?.cpu?.replace(/\(R\)|\(TM\)|™|®|CPU|Processor/gi, '').replace(/\s+/g, ' ').trim(), s.cpuSpeed ? `${s.cpuSpeed} GHz` : ''].filter(Boolean).join(' · '), warn: [80, 95] },
  ram: { max: 100, color: 'var(--c-ram)', value: (s) => s.ram, fmt: (v, l, d) => pct(v, d, l), sub: (s, _sys, l) => `${gb(s.ramUsed, l)} / ${gb(s.ramTotal, l)}`, warn: [80, 92] },
  gpu: { max: 100, color: 'var(--c-gpu)', value: (s) => s.gpu, fmt: (v, l, d) => pct(v, d, l), sub: (_s, sys) => (sys?.gpu || '').replace(/NVIDIA |AMD |Intel\(R\) |\(R\)|\(TM\)/g, ''), warn: [90, 99] },
  gpuMem: { max: 100, color: 'var(--c-gpu)', value: (s) => s.gpuMem, fmt: (v, l, d) => pct(v, d, l), sub: (s, _sys, l) => (s.gpuMemTotal ? `${gb(s.gpuMemUsed, l)} / ${gb(s.gpuMemTotal, l)}` : ''), warn: [85, 95] },
  cpuTemp: { max: 100, color: 'var(--c-temp)', value: (s) => s.cpuTemp, fmt: (v, l, d) => temp(v, d, l), warn: [80, 90] },
  gpuTemp: { max: 100, color: 'var(--c-temp)', value: (s) => s.gpuTemp, fmt: (v, l, d) => temp(v, d, l), warn: [78, 87] },
  netDown: { color: 'var(--c-net)', value: (s) => s.netDown, fmt: bits },
  netUp: { color: 'var(--c-net2)', value: (s) => s.netUp, fmt: bits },
  diskRead: { color: 'var(--c-disk)', value: (s) => s.diskRead, fmt: rate },
  diskWrite: { color: 'var(--c-disk2)', value: (s) => s.diskWrite, fmt: rate },
  swap: { max: 100, color: 'var(--c-ram)', value: (s) => s.swap, fmt: (v, l, d) => pct(v, d, l), sub: (s, _sys, l) => gb(s.swapUsed, l) },
  cpuSpeed: { max: 6, color: 'var(--c-cpu)', value: (s) => s.cpuSpeed, fmt: (v, l) => (v === null ? '–' : `${v.toLocaleString(l, { maximumFractionDigits: 2 })} GHz`) },
  battery: { max: 100, color: 'var(--c-net)', value: (s) => s.battery?.pct ?? null, fmt: (v, l) => pct(v, 0, l) },
  procCount: { color: 'var(--c-cpu)', value: (s) => s.procCount, fmt: (v, l) => (v === null ? '–' : Math.round(v).toLocaleString(l)) },
};

/** Welche Darstellungen passen zu welchem Messwert */
export function stylesFor(m: MetricId): WStyle[] {
  return m === 'procCount' ? ['number', 'chart'] : METRIC[m].max ? STYLES : ['chart', 'number', 'bar', 'ring', 'speedo'];
}

let seq = 0;
export function newId() {
  seq = (seq + 1) % 1000;
  return 'w' + Date.now().toString(36).slice(-5) + seq;
}

const m = (id: string, metric: MetricId, style: WStyle, size: WSize, extra: Partial<Widget> = {}): Widget => ({ id, type: 'metric', metric, style, size, ...extra });
const w = (id: string, type: WidgetType, size: WSize, extra: Partial<Widget> = {}): Widget => ({ id, type, size, ...extra });

/** Fertige Layouts zum Starten */
export const PRESETS: Record<'gamer' | 'classic' | 'minimal' | 'streamer' | 'phone', Widget[]> = {
  gamer: [
    m('cpu', 'cpu', 'ring', 'm'),
    m('gpu', 'gpu', 'speedo', 'm'),
    m('ct', 'cpuTemp', 'number', 's'),
    m('gt', 'gpuTemp', 'number', 's'),
    w('clock', 'clock', 's'),
    w('boost', 'boost', 's'),
    m('ram', 'ram', 'bar', 'w'),
    m('vram', 'gpuMem', 'bar', 'w'),
    w('net', 'net', 'w'),
    w('procs', 'procs', 'm', { count: 5 }),
    w('cores', 'cores', 'w'),
  ],
  classic: [
    m('cpu', 'cpu', 'chart', 'l'),
    m('ram', 'ram', 'chart', 's'),
    m('gpu', 'gpu', 'chart', 's'),
    m('dr', 'diskRead', 'chart', 'w'),
    w('net', 'net', 'w'),
    w('procs', 'procs', 'm', { count: 6 }),
    w('disks', 'disks', 'w'),
    w('sys', 'system', 'w'),
  ],
  minimal: [m('cpu', 'cpu', 'number', 's'), m('gpu', 'gpu', 'number', 's'), m('ram', 'ram', 'number', 's'), m('nd', 'netDown', 'number', 's'), w('clock', 'clock', 'w'), m('ct', 'cpuTemp', 'number', 's'), m('gt', 'gpuTemp', 'number', 's')],
  streamer: [
    m('cpu', 'cpu', 'chart', 'w'),
    m('gpu', 'gpu', 'chart', 'w'),
    m('nu', 'netUp', 'chart', 'w'),
    m('ram', 'ram', 'ring', 's'),
    m('gt', 'gpuTemp', 'number', 's'),
    w('clock', 'clock', 'w'),
    w('procs', 'procs', 'w', { count: 4 }),
  ],
  phone: [
    m('cpu', 'cpu', 'ring', 's'),
    m('gpu', 'gpu', 'ring', 's'),
    m('ct', 'cpuTemp', 'number', 's'),
    m('gt', 'gpuTemp', 'number', 's'),
    m('ram', 'ram', 'bar', 'w'),
    w('net', 'net', 'w'),
    w('boost', 'boost', 'w'),
    w('procs', 'procs', 'm', { count: 5 }),
  ],
};

/** Standard-Layout je Skin, solange man nichts selbst angepasst hat */
export const SKIN_PRESET: Record<Skin, keyof typeof PRESETS> = { neon: 'gamer', glass: 'gamer', sunset: 'gamer', clean: 'classic', classic: 'classic', terminal: 'minimal' };

/**
 * Standard-Layout. Liefert der PC keine Temperaturen / keinen Grafikspeicher (z. B. am Mac),
 * werden diese Kacheln gegen Werte getauscht, die es wirklich gibt – sonst stünde dort nur "–".
 */
export function defaultLayout(skin: Skin, target: 'pc' | 'phone', stats?: Stats | null): Widget[] {
  const list: Widget[] = structuredClone(target === 'phone' ? PRESETS.phone : PRESETS[SKIN_PRESET[skin]]);
  if (!stats) return list;
  const swap: Partial<Record<MetricId, MetricId>> = {};
  if (stats.cpuTemp === null) swap.cpuTemp = 'cpuSpeed';
  if (stats.gpuTemp === null) swap.gpuTemp = 'procCount';
  if (stats.gpuMem === null) swap.gpuMem = 'swap';
  return list.map((w) => (w.metric && swap[w.metric] ? { ...w, metric: swap[w.metric] } : w));
}

/** Braucht dieses Layout die Prozessliste? (sonst wird sie nicht dauernd gemessen) */
export function needsProcs(layout: Widget[]) {
  return layout.some((x) => x.type === 'procs');
}

/** Neues Widget mit sinnvollen Standardwerten */
export function makeWidget(type: WidgetType, metric?: MetricId): Widget {
  const id = newId();
  switch (type) {
    case 'metric':
      return { id, type, metric: metric || 'cpu', style: metric && !METRIC[metric].max ? 'chart' : 'ring', size: 's' };
    case 'procs':
      return { id, type, size: 'm', count: 5 };
    case 'cores':
    case 'net':
    case 'disks':
    case 'system':
      return { id, type, size: 'w' };
    case 'text':
      return { id, type, size: 'w', text: 'SlimManager' };
    default:
      return { id, type, size: 's' };
  }
}
