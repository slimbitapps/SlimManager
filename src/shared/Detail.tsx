/**
 * Detail-Ansicht beim Antippen einer Kachel: großes Diagramm, Minimum/Schnitt/Spitze
 * und "Wer verbraucht am meisten" – Apps sortiert nach genau diesem Wert.
 * Wird im PC-Fenster (als Fenster über dem Dashboard) und auf Handy/iPad (als Vollbild-Blatt) benutzt.
 */
import { useEffect } from 'react';
import type { MetricId, ProcGroup, Widget } from './types';
import { METRIC } from './widgets';
import { Spark, useTween, type WidgetData } from './WidgetView';
import { bytes, bits, split } from './format';
import { t, getLocale, type TKey } from '../i18n';

export type DetailKind = MetricId | 'disks';

/** Welche Detail-Ansicht gehört zu einer Kachel? (null = keine, z. B. Uhr) */
export function detailFor(w: Widget): DetailKind | 'boost' | null {
  switch (w.type) {
    case 'metric':
      return w.metric || 'cpu';
    case 'cores':
    case 'procs':
    case 'system':
      return 'cpu';
    case 'net':
      return 'netDown';
    case 'disks':
      return 'disks';
    case 'battery':
      return 'battery';
    case 'boost':
      return 'boost';
    default:
      return null;
  }
}

/** Nach welchem Wert die Apps sortiert werden */
function rankBy(kind: DetailKind): 'cpu' | 'mem' | 'gpu' | null {
  if (kind === 'cpu' || kind === 'cpuSpeed' || kind === 'procCount' || kind === 'cpuTemp') return 'cpu';
  if (kind === 'ram' || kind === 'swap') return 'mem';
  if (kind === 'gpu' || kind === 'gpuMem' || kind === 'gpuTemp') return 'gpu';
  return null;
}

export function Detail({ kind, d, onClose, onApp, onAll }: { kind: DetailKind; d: WidgetData; onClose: () => void; onApp?: (g: ProcGroup) => void; onAll?: () => void }) {
  const locale = getLocale();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);

  const isDisks = kind === 'disks';
  const info = isDisks ? null : METRIC[kind];
  const raw = d.stats && info ? info.value(d.stats) : null;
  const v = useTween(raw, Math.min(450, (d.rate ?? 1000) * 0.85), !!d.lively);
  const hist = isDisks ? [] : d.history[kind] || [];
  const known = hist.filter((x): x is number => x !== null);
  const max = info?.max ?? Math.max(1, ...known) * 1.15;
  const fmt = (x: number | null) => (info ? info.fmt(x, locale, d.decimals ?? 0) : '–');
  const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
  const [num, unit] = split(fmt(v));
  const label = isDisks ? t('w.disks') : t(`metric.${kind}` as TKey);
  const sub = d.stats && info?.sub ? info.sub(d.stats, d.sys, locale) : '';
  const by = rankBy(kind);
  const gpuMissing = by === 'gpu' && !(d.procs || []).some((g) => g.gpu !== null && g.gpu !== undefined);
  const list = by && !gpuMissing ? (d.procs || []).filter((g) => g.kind !== 'self' && !/idle/i.test(g.name)).sort((a, b) => (b[by] ?? 0) - (a[by] ?? 0)).slice(0, 12) : [];
  const top = Math.max(1e-9, ...list.map((g) => (by ? g[by] ?? 0 : 0)));
  const minutes = Math.round(hist.length / 60);
  // Netzwerk: Download und Upload zusammen zeigen
  const isNet = kind === 'netDown' || kind === 'netUp';

  return (
    <div className="detail-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-testid="detail">
      <div className="detail" role="dialog" aria-label={label}>
        <div className="detail-head">
          <i className="detail-dot" style={{ background: info?.color || 'var(--c-disk)' }} />
          <h2>{label}</h2>
          <div className="grow" />
          <button className="detail-x" onClick={onClose} aria-label={t('common.close')} data-testid="detail-close">
            ✕
          </button>
        </div>

        {!isDisks && (
          <>
            <div className="detail-now">
              <b>{num}</b>
              <small>{unit}</small>
              {sub && <span className="detail-sub">{sub}</span>}
            </div>
            <div className="detail-chart">
              <Spark data={isNet ? d.history.netDown || [] : hist} data2={isNet ? d.history.netUp || [] : undefined} max={isNet ? Math.max(1024, ...(d.history.netDown || []).filter((x): x is number => x !== null), ...(d.history.netUp || []).filter((x): x is number => x !== null)) * 1.15 : max} color={info?.color || ''} color2="var(--c-net2)" />
              <span className="axis top">{info?.max ? fmt(info.max) : fmt(max / 1.15)}</span>
              <span className="axis bottom">{t('detail.ago', { m: Math.max(1, minutes) })}</span>
            </div>
            <div className="detail-stats">
              <div>
                <span>{t('detail.min')}</span>
                <b>{known.length ? fmt(Math.min(...known)) : '–'}</b>
              </div>
              <div>
                <span>{t('detail.avg')}</span>
                <b>{fmt(avg)}</b>
              </div>
              <div>
                <span>{t('detail.max')}</span>
                <b>{known.length ? fmt(Math.max(...known)) : '–'}</b>
              </div>
              {isNet && (
                <div>
                  <span>{t('metric.netUp')}</span>
                  <b>{bits(d.stats?.netUp ?? null, locale)}</b>
                </div>
              )}
            </div>
          </>
        )}

        {/* Zusatzinfos je nach Wert */}
        {kind === 'cpu' && d.stats?.cores?.length ? (
          <div className="detail-cores">
            {d.stats.cores.map((c, i) => (
              <div key={i} title={`#${i + 1}`}>
                <i style={{ height: `${c ?? 0}%` }} />
              </div>
            ))}
          </div>
        ) : null}
        {isDisks && (
          <div className="detail-disks">
            {(d.stats?.disks || []).map((x) => (
              <div key={x.mount} className="detail-disk">
                <div className="row-between">
                  <b>{x.label}</b>
                  <span>
                    {bytes(x.used, locale, 0)} / {bytes(x.size, locale, 0)} · {t('detail.free', { v: bytes(x.size - x.used, locale, 0) })}
                  </span>
                </div>
                <div className="hbar">
                  <i style={{ width: `${x.pct ?? 0}%`, background: 'var(--c-disk)' }} className={(x.pct ?? 0) > 92 ? 'hot' : ''} />
                </div>
              </div>
            ))}
          </div>
        )}

        {by && (
          <div className="detail-list">
            <div className="detail-list-h">
              <span>{t('detail.who')}</span>
              {onAll && (
                <button className="detail-link" onClick={onAll}>
                  {t('detail.all')} →
                </button>
              )}
            </div>
            {gpuMissing ? (
              <p className="detail-hint">{t('detail.noGpu')}</p>
            ) : !d.procs ? (
              <p className="detail-hint">{t('common.loading')}</p>
            ) : (
              list.map((g) => {
                const val = by ? g[by] ?? 0 : 0;
                return (
                  <button key={g.id} className="detail-row" onClick={onApp ? () => onApp(g) : undefined} data-testid="detail-row">
                    <span className={`kind-dot k-${g.kind}`} />
                    <span className="ellipsis grow">
                      {g.name}
                      {g.count > 1 && <small> · {g.count}</small>}
                    </span>
                    <span className="detail-bar">
                      <i style={{ width: `${(val / top) * 100}%`, background: info?.color }} />
                    </span>
                    <span className="detail-val">{by === 'mem' ? bytes(val, locale) : `${val.toLocaleString(locale, { maximumFractionDigits: 1 })} %`}</span>
                  </button>
                );
              })
            )}
            {kind === 'cpuTemp' && <p className="detail-hint">{t('detail.tempHint')}</p>}
          </div>
        )}
        {!by && !isDisks && <p className="detail-hint">{t(isNet ? 'detail.netHint' : 'detail.noApps')}</p>}
      </div>
    </div>
  );
}
