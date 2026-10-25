/**
 * Ein Widget zeichnen (Ring, Balken, Diagramm, Zahl, Prozessliste, Uhr …).
 * Wird im PC-Fenster UND auf der Handy-Seite benutzt – deshalb keine Abhängigkeit zum Electron-Fenster.
 */
import { memo, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { BoostState, History, ProcGroup, Stats, SysInfo, Widget } from './types';
import { METRIC } from './widgets';
import { bits, bytes, duration, pct, split } from './format';
import { t, getLang, getLocale, type TKey } from '../i18n';

export interface WidgetData {
  stats: Stats | null;
  history: History;
  sys: SysInfo | null;
  procs: ProcGroup[] | null;
  boost: BoostState;
  game: string | null;
  /** Boost starten/stoppen – fehlt, wenn Steuern nicht erlaubt ist */
  onBoost?: (on: boolean) => void;
  /** flüssige Anzeige: Werte gleiten (aus beim Zocken → keine Last) */
  lively?: boolean;
  /** Nachkommastellen für % und °C */
  decimals?: number;
  /** wie oft neue Werte kommen (ms) – bestimmt die Dauer der Animation */
  rate?: number;
}

/**
 * Zahl weich zum neuen Wert gleiten lassen (nur im "lebendigen" Modus, sonst sofort).
 * Läuft nur kurz nach jeder neuen Messung – danach zeichnet nichts mehr.
 */
export function useTween(target: number | null, ms: number, on: boolean): number | null {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    if (!on || target === null || cur.current === null || ms <= 0 || Math.abs(target - cur.current) < 1e-6) {
      cur.current = target;
      setV(target);
      return;
    }
    const from = cur.current;
    const start = performance.now();
    let raf = 0;
    let last = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      // höchstens ~30 Bilder pro Sekunde – sieht flüssig aus und kostet die Hälfte
      if (k < 1 && now - last < 30) {
        raf = requestAnimationFrame(step);
        return;
      }
      last = now;
      const x = from + (target - from) * (1 - Math.pow(1 - k, 3));
      cur.current = x;
      setV(x);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, on, ms]);
  return v;
}

export const WidgetView = memo(function WidgetView({ w, d }: { w: Widget; d: WidgetData }) {
  const style = w.color ? ({ '--w-color': w.color } as React.CSSProperties) : undefined;
  return (
    <div className={`wbody wt-${w.type} ws-${w.style || 'x'} wz-${w.size}`} style={style}>
      <Inner w={w} d={d} />
    </div>
  );
});

function Inner({ w, d }: { w: Widget; d: WidgetData }) {
  switch (w.type) {
    case 'metric':
      return <MetricW w={w} d={d} />;
    case 'cores':
      return <CoresW w={w} d={d} />;
    case 'procs':
      return <ProcsW w={w} d={d} />;
    case 'clock':
      return <ClockW w={w} />;
    case 'net':
      return <NetW w={w} d={d} />;
    case 'disks':
      return <DisksW w={w} d={d} />;
    case 'boost':
      return <BoostW w={w} d={d} />;
    case 'system':
      return <SystemW w={w} d={d} />;
    case 'battery':
      return <BatteryW w={w} d={d} />;
    case 'text':
      return <div className="w-text">{w.text || w.title || ''}</div>;
  }
}

function Title({ w, fallback, right }: { w: Widget; fallback: string; right?: ReactNode }) {
  return (
    <div className="w-title">
      <span>{w.title || fallback}</span>
      {right}
    </div>
  );
}

/** Farbstufe für Warnwerte */
function level(v: number | null, warn?: [number, number]) {
  if (v === null || !warn) return '';
  return v >= warn[1] ? 'hot' : v >= warn[0] ? 'warm' : '';
}

// ------------------------------------------------------------------ Messwert
function MetricW({ w, d }: { w: Widget; d: WidgetData }) {
  const id = w.metric || 'cpu';
  const info = METRIC[id];
  const locale = getLocale();
  const raw = d.stats ? info.value(d.stats) : null;
  const ms = Math.min(450, (d.rate ?? 1000) * 0.85);
  const v = useTween(raw, ms, !!d.lively);
  const hist = d.history[id] || [];
  const known = hist.filter((x): x is number => x !== null);
  const max = info.max ?? Math.max(1, ...known) * 1.15;
  // Spitzenwert der letzten Minute (kleine Markierung)
  const peak = known.length > 3 ? Math.max(...known.slice(-60)) : null;
  const text = info.fmt(v, locale, d.decimals ?? 0);
  const [num, unit] = split(text);
  const sub = d.stats && info.sub ? info.sub(d.stats, d.sys, locale) : '';
  const label = t(`metric.${id}` as TKey);
  const lv = level(raw, info.warn);
  const color = w.color || info.color;
  const unavailable = raw === null && d.stats !== null;
  const subLine = (
    <>
      {sub && <div className="w-sub ellipsis">{sub}</div>}
      {unavailable && <NA id={id} />}
    </>
  );

  if (w.style === 'ring' || w.style === 'speedo') {
    const Gauge = w.style === 'ring' ? Ring : Speedo;
    return (
      <>
        <Title w={w} fallback={label} right={peak !== null && w.size !== 's' ? <span className="w-peak">▲ {info.fmt(peak, locale, 0)}</span> : undefined} />
        <div className={`ring-wrap g-${w.style}`}>
          <Gauge value={v} max={max} color={color} className={lv} peak={peak} label={num} unit={unit} />
          {w.style === 'ring' && (
            <div className={`ring-val ${lv}`}>
              <b>{num}</b>
              <small>{unit}</small>
            </div>
          )}
        </div>
        {subLine}
      </>
    );
  }
  if (w.style === 'bar') {
    return (
      <>
        <Title w={w} fallback={label} right={<b className={`w-val ${lv}`}>{text}</b>} />
        <div className="hbar">
          <i className={lv} style={{ width: `${v === null ? 0 : Math.min(100, (v / max) * 100)}%`, background: color }} />
          {peak !== null && <em className="hbar-peak" style={{ left: `${Math.min(100, (peak / max) * 100)}%` }} />}
        </div>
        {subLine}
      </>
    );
  }
  if (w.style === 'chart') {
    return (
      <>
        <Title w={w} fallback={label} right={<b className={`w-val ${lv}`}>{text}</b>} />
        <Spark data={hist} max={max} color={color} />
        {subLine}
      </>
    );
  }
  return (
    <>
      <Title w={w} fallback={label} />
      <div className={`big-num ${lv}`}>
        <b>{num}</b>
        <small>{unit}</small>
      </div>
      {subLine}
    </>
  );
}

/** Hinweis, warum ein Wert fehlt (Temperaturen brauchen oft Admin-Rechte / Sensor-Treiber) */
function NA({ id }: { id: string }) {
  const k = id === 'cpuTemp' || id === 'gpuTemp' ? 'na.temp' : id.startsWith('gpu') ? 'na.gpu' : 'na.generic';
  return <div className="w-na">{t(k as TKey)}</div>;
}

interface GaugeProps {
  value: number | null;
  max?: number;
  color: string;
  className?: string;
  peak?: number | null;
  /** nur Tacho: Wert und Einheit unter dem Zeiger */
  label?: string;
  unit?: string;
}

/** Skala: 21 Striche nur entlang des Bogens (135° … 405°) – einmal berechnet, nie neu */
const RING_TICKS = Array.from({ length: 21 }, (_, i) => {
  const a = ((135 + (270 * i) / 20) * Math.PI) / 180;
  const long = i % 5 === 0;
  return <line key={i} x1={50 + 47 * Math.cos(a)} y1={50 + 47 * Math.sin(a)} x2={50 + (long ? 50 : 49.2) * Math.cos(a)} y2={50 + (long ? 50 : 49.2) * Math.sin(a)} className={long ? 'long' : ''} />;
});

/** Dreiviertel-Ring mit Skala, Leuchten (ohne teure Filter) und Spitzenwert-Punkt */
export function Ring({ value, max = 100, color, className = '', peak = null }: GaugeProps) {
  const gid = useId().replace(/:/g, '');
  const r = 42;
  const c = 2 * Math.PI * r;
  const arc = c * 0.75;
  const frac = value === null ? 0 : Math.max(0, Math.min(1, value / max));
  const pk = peak === null ? null : Math.max(0, Math.min(1, peak / max));
  // Position des Spitzenwert-Punkts auf dem Bogen (Start bei 135°)
  const pa = pk === null ? 0 : ((135 + 270 * pk) * Math.PI) / 180;
  return (
    <svg className={`ring ${className}`} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id={`g${gid}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: color, stopOpacity: 0.45 }} />
          <stop offset="1" style={{ stopColor: color, stopOpacity: 1 }} />
        </linearGradient>
      </defs>
      <g className="ring-ticks">{RING_TICKS}</g>
      <circle cx="50" cy="50" r={r} className="ring-track" strokeDasharray={`${arc} ${c}`} transform="rotate(135 50 50)" />
      <circle cx="50" cy="50" r={r} className="ring-glow" stroke={color} strokeDasharray={`${arc * frac} ${c}`} transform="rotate(135 50 50)" />
      <circle cx="50" cy="50" r={r} className="ring-fill" stroke={`url(#g${gid})`} strokeDasharray={`${arc * frac} ${c}`} transform="rotate(135 50 50)" />
      {pk !== null && <circle className="ring-peak" cx={50 + r * Math.cos(pa)} cy={50 + r * Math.sin(pa)} r="2.2" />}
    </svg>
  );
}

/** Tacho mit Zeiger – wie im Auto */
export function Speedo({ value, max = 100, color, className = '', peak = null, label = '', unit = '' }: GaugeProps) {
  const frac = value === null ? 0 : Math.max(0, Math.min(1, value / max));
  const r = 40;
  const c = Math.PI * r; // Halbkreis
  const ang = -90 + 180 * frac; // Zeiger: -90° (links) … +90° (rechts)
  const pk = peak === null ? null : Math.max(0, Math.min(1, peak / max));
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const a = Math.PI + (Math.PI * i) / 10;
    const long = i % 5 === 0;
    return <line key={i} x1={50 + 44 * Math.cos(a)} y1={56 + 44 * Math.sin(a)} x2={50 + (long ? 36 : 39) * Math.cos(a)} y2={56 + (long ? 36 : 39) * Math.sin(a)} className={long ? 'tick long' : 'tick'} />;
  });
  return (
    <svg className={`speedo ${className}`} viewBox="0 0 100 82" aria-hidden="true">
      <path d="M10 56 A40 40 0 0 1 90 56" className="ring-track" />
      <path d="M10 56 A40 40 0 0 1 90 56" className="ring-glow" stroke={color} strokeDasharray={`${c * frac} ${c}`} />
      <path d="M10 56 A40 40 0 0 1 90 56" className="ring-fill" stroke={color} strokeDasharray={`${c * frac} ${c}`} />
      {/* Warnbereich rechts */}
      <path d="M86.4 29.55 A45 45 0 0 1 95 56" className="speedo-red" />
      {ticks}
      {pk !== null && <circle className="ring-peak" cx={50 + 40 * Math.cos(Math.PI + Math.PI * pk)} cy={56 + 40 * Math.sin(Math.PI + Math.PI * pk)} r="2" />}
      <g transform={`rotate(${ang} 50 56)`}>
        <path d="M50 56 L48.6 54 L50 20 L51.4 54 Z" className="needle" />
      </g>
      <circle cx="50" cy="56" r="4" className="needle-hub" />
      <text x="50" y="76" className="speedo-val" textAnchor="middle">
        {label}
        <tspan className="speedo-unit" dx="1.5">
          {unit}
        </tspan>
      </text>
    </svg>
  );
}

/** Kleines Liniendiagramm mit Fläche */
export function Spark({ data, max, color, data2, color2 }: { data: (number | null)[]; max: number; color: string; data2?: (number | null)[]; color2?: string }) {
  const W = 300;
  const H = 100;
  const n = Math.max(60, data.length);
  const path = (arr: (number | null)[]) => {
    const pts = arr.map((v, i) => [((i + (n - arr.length)) / (n - 1)) * W, H - (Math.min(max, v ?? 0) / max) * (H - 4) - 2]);
    if (!pts.length) return { line: '', area: '' };
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    return { line, area: `${line}L${pts[pts.length - 1][0].toFixed(1)},${H}L${pts[0][0].toFixed(1)},${H}Z` };
  };
  const a = path(data);
  const b = data2 ? path(data2) : null;
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <g className="spark-grid">
        {[0.25, 0.5, 0.75].map((y) => (
          <line key={y} x1="0" x2={W} y1={H * y} y2={H * y} />
        ))}
      </g>
      <path d={a.area} fill={color} className="spark-area" />
      <path d={a.line} stroke={color} className="spark-line" />
      {b && (
        <>
          <path d={b.area} fill={color2} className="spark-area" />
          <path d={b.line} stroke={color2} className="spark-line" />
        </>
      )}
    </svg>
  );
}

// ------------------------------------------------------------------ CPU-Kerne
function CoresW({ w, d }: { w: Widget; d: WidgetData }) {
  const cores = d.stats?.cores || [];
  return (
    <>
      <Title w={w} fallback={t('w.cores')} right={<span className="w-sub">{cores.length}</span>} />
      <div className="cores" style={{ gridTemplateColumns: `repeat(${Math.min(16, Math.max(4, Math.ceil(cores.length / 2)))}, 1fr)` }}>
        {cores.map((c, i) => (
          <div key={i} className="core" title={`#${i + 1}: ${pct(c)}`}>
            <i style={{ height: `${c ?? 0}%` }} className={level(c, [85, 97])} />
          </div>
        ))}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Top-Prozesse
function ProcsW({ w, d }: { w: Widget; d: WidgetData }) {
  const locale = getLocale();
  const list = (d.procs || []).filter((p) => p.kind !== 'self' && !/idle/i.test(p.name)).slice(0, w.count || 5);
  const top = Math.max(1, ...list.map((p) => p.cpu));
  return (
    <>
      <Title w={w} fallback={t('w.procs')} />
      <div className="top-procs">
        {!d.procs && <div className="w-sub">{t('common.loading')}</div>}
        {list.map((p) => (
          <div className="tp-row" key={p.id}>
            <span className={`kind-dot k-${p.kind}`} />
            <span className="tp-name ellipsis">{p.name}</span>
            <span className="tp-bar">
              <i style={{ width: `${(p.cpu / top) * 100}%` }} />
            </span>
            <span className="tp-cpu">{p.cpu.toLocaleString(locale, { maximumFractionDigits: 1 })} %</span>
            <span className="tp-mem">{bytes(p.mem, locale, 0)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Uhr
function ClockW({ w }: { w: Widget }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const locale = getLocale();
  return (
    <div className="clock">
      {w.title && <div className="w-title">{w.title}</div>}
      <b>{now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</b>
      <small>{now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</small>
    </div>
  );
}

// ------------------------------------------------------------------ Netzwerk
function NetW({ w, d }: { w: Widget; d: WidgetData }) {
  const locale = getLocale();
  const down = d.history.netDown || [];
  const up = d.history.netUp || [];
  const max = Math.max(1024, ...down.filter((x): x is number => x !== null), ...up.filter((x): x is number => x !== null)) * 1.15;
  return (
    <>
      <Title
        w={w}
        fallback={t('w.net')}
        right={
          <span className="net-vals">
            <span className="nd">↓ {bits(d.stats?.netDown ?? null, locale)}</span>
            <span className="nu">↑ {bits(d.stats?.netUp ?? null, locale)}</span>
          </span>
        }
      />
      <Spark data={down} data2={up} max={max} color={w.color || 'var(--c-net)'} color2="var(--c-net2)" />
    </>
  );
}

// ------------------------------------------------------------------ Laufwerke
function DisksW({ w, d }: { w: Widget; d: WidgetData }) {
  const locale = getLocale();
  const disks = d.stats?.disks || [];
  return (
    <>
      <Title w={w} fallback={t('w.disks')} />
      <div className="disks">
        {disks.map((x) => (
          <div key={x.mount} className="disk">
            <div className="row-between">
              <span className="ellipsis">{x.label}</span>
              <span className="w-sub">
                {bytes(x.size - x.used, locale, 0)} {t('w.disks.free')}
              </span>
            </div>
            <div className="hbar thin">
              <i className={level(x.pct, [85, 95])} style={{ width: `${x.pct ?? 0}%`, background: w.color || 'var(--c-disk)' }} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Game Boost
function BoostW({ w, d }: { w: Widget; d: WidgetData }) {
  const on = d.boost.active;
  const target = on ? d.boost.app : d.game;
  return (
    <div className={`boost-w ${on ? 'on' : ''}`}>
      <Title w={w} fallback={t('w.boost')} />
      <div className="boost-w-main">
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
          <path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" />
        </svg>
        <div className="grow ellipsis">
          <b>{on ? t('boost.active') : t('boost.off')}</b>
          <small className="ellipsis">{target || t('boost.noGame')}</small>
        </div>
      </div>
      {d.onBoost && (on || target) && (
        <button className="w-btn" onClick={() => d.onBoost?.(!on)} data-testid="boost-widget-btn">
          {on ? t('boost.stop') : t('boost.start')}
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ PC-Info
function SystemW({ w, d }: { w: Widget; d: WidgetData }) {
  const s = d.sys;
  const locale = getLocale();
  return (
    <>
      <Title w={w} fallback={s?.host || t('w.system')} />
      <dl className="sysinfo">
        <dt>CPU</dt>
        <dd className="ellipsis">{s?.cpu || '–'}</dd>
        <dt>GPU</dt>
        <dd className="ellipsis">{s?.gpu || '–'}</dd>
        <dt>RAM</dt>
        <dd>{bytes(s?.ramTotal ?? null, locale, 0)}</dd>
        <dt>OS</dt>
        <dd className="ellipsis">{s?.os || '–'}</dd>
        <dt>{t('w.uptime')}</dt>
        <dd>{duration(d.stats?.uptime ?? null, getLang())}</dd>
      </dl>
    </>
  );
}

// ------------------------------------------------------------------ Akku
function BatteryW({ w, d }: { w: Widget; d: WidgetData }) {
  const b = d.stats?.battery;
  return (
    <>
      <Title w={w} fallback={t('metric.battery')} />
      {b ? (
        <div className="battery">
          <div className="batt-shell">
            <i style={{ width: `${b.pct ?? 0}%` }} className={(b.pct ?? 100) < 15 ? 'hot' : ''} />
          </div>
          <b>{pct(b.pct)}</b>
          <small>{b.charging ? t('w.battery.charging') : b.plugged ? t('w.battery.plugged') : t('w.battery.battery')}</small>
        </div>
      ) : (
        <div className="w-sub">{t('w.battery.none')}</div>
      )}
    </>
  );
}
