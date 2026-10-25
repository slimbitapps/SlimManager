/**
 * Ein Widget zeichnen (Ring, Balken, Diagramm, Zahl, Prozessliste, Uhr …).
 * Wird im PC-Fenster UND auf der Handy-Seite benutzt – deshalb keine Abhängigkeit zum Electron-Fenster.
 */
import { memo, useEffect, useState, type ReactNode } from 'react';
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
  const v = d.stats ? info.value(d.stats) : null;
  const hist = d.history[id] || [];
  const max = info.max ?? Math.max(1, ...hist.filter((x): x is number => x !== null)) * 1.15;
  const text = info.fmt(v, locale);
  const [num, unit] = split(text);
  const sub = d.stats && info.sub ? info.sub(d.stats, d.sys, locale) : '';
  const label = t(`metric.${id}` as TKey);
  const lv = level(v, info.warn);
  const color = w.color || info.color;
  const unavailable = v === null && d.stats !== null;

  if (w.style === 'ring') {
    return (
      <>
        <Title w={w} fallback={label} />
        <div className="ring-wrap">
          <Ring value={v} max={max} color={color} className={lv} />
          <div className={`ring-val ${lv}`}>
            <b>{num}</b>
            <small>{unit}</small>
          </div>
        </div>
        {sub && <div className="w-sub ellipsis">{sub}</div>}
        {unavailable && <NA id={id} />}
      </>
    );
  }
  if (w.style === 'bar') {
    return (
      <>
        <Title w={w} fallback={label} right={<b className={`w-val ${lv}`}>{text}</b>} />
        <div className="hbar">
          <i className={lv} style={{ width: `${v === null ? 0 : Math.min(100, (v / max) * 100)}%`, background: color }} />
        </div>
        {sub && <div className="w-sub ellipsis">{sub}</div>}
        {unavailable && <NA id={id} />}
      </>
    );
  }
  if (w.style === 'chart') {
    return (
      <>
        <Title w={w} fallback={label} right={<b className={`w-val ${lv}`}>{text}</b>} />
        <Spark data={hist} max={max} color={color} />
        {sub && <div className="w-sub ellipsis">{sub}</div>}
        {unavailable && <NA id={id} />}
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
      {sub && <div className="w-sub ellipsis">{sub}</div>}
      {unavailable && <NA id={id} />}
    </>
  );
}

/** Hinweis, warum ein Wert fehlt (Temperaturen brauchen oft Admin-Rechte / Sensor-Treiber) */
function NA({ id }: { id: string }) {
  const k = id === 'cpuTemp' || id === 'gpuTemp' ? 'na.temp' : id.startsWith('gpu') ? 'na.gpu' : 'na.generic';
  return <div className="w-na">{t(k as TKey)}</div>;
}

export function Ring({ value, max = 100, color, className = '' }: { value: number | null; max?: number; color: string; className?: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const frac = value === null ? 0 : Math.max(0, Math.min(1, value / max));
  // Dreiviertel-Kreis (wie ein Tacho)
  const arc = c * 0.75;
  return (
    <svg className={`ring ${className}`} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r={r} className="ring-track" strokeDasharray={`${arc} ${c}`} transform="rotate(135 50 50)" />
      <circle cx="50" cy="50" r={r} className="ring-fill" stroke={color} strokeDasharray={`${arc * frac} ${c}`} transform="rotate(135 50 50)" />
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
