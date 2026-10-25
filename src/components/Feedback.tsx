import { useEffect, useRef, useState } from 'react';
import { t, getLang } from '../i18n';
import { useStore, clearSummary } from '../store';
import { duration, pct, temp } from '../shared/format';
import { Dialog } from './ui';
import { IconBolt } from '../icons';

/** Kurze Meldungen unten rechts */
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`toast ${x.kind || ''}`} data-testid="toast">
          {x.text}
        </div>
      ))}
    </div>
  );
}

/** Kurzer "Boost!"-Moment beim Start – einmalig 1,4 s, danach steht nichts mehr */
export function BoostFlash() {
  const boost = useStore((s) => s.boost);
  const [show, setShow] = useState<string | null>(null);
  const last = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (boost.active && boost.startedAt !== last.current && document.visibilityState === 'visible') {
      last.current = boost.startedAt;
      setShow(boost.mode === 'focus' ? 'focus' : 'game');
      const id = setTimeout(() => setShow(null), 1400);
      return () => clearTimeout(id);
    }
    if (!boost.active) last.current = undefined;
  }, [boost.active, boost.startedAt, boost.mode]);
  if (!show) return null;
  return (
    <div className={`boost-flash ${show}`} aria-hidden="true">
      <div className="bf-ring" />
      <div className="bf-text">
        {show === 'game' ? <IconBolt size={54} /> : <span style={{ fontSize: 48 }}>💼</span>}
        <b>{show === 'game' ? t('flash.game') : t('flash.focus')}</b>
      </div>
    </div>
  );
}

/** Zusammenfassung nach einer Boost-Runde */
export function BoostSummaryDialog() {
  const s = useStore((x) => x.summary);
  if (!s || s.durationMs < 60_000) return null; // sehr kurze Runden nicht melden
  return (
    <Dialog title={t('summary.title')} onClose={clearSummary} testId="boost-summary">
      <div className="summary">
        <div className="bolt small">
          <IconBolt size={26} />
        </div>
        <div>
          <b>{s.mode === 'focus' ? t('focus.title') : s.app}</b>
          <div className="muted small">{t('summary.played', { time: duration(Math.round(s.durationMs / 1000), getLang()) })}</div>
        </div>
      </div>
      <div className="summary-grid">
        <div>
          <span>{t('summary.avgCpu')}</span>
          <b>{pct(s.avgCpu)}</b>
        </div>
        <div>
          <span>{t('summary.avgGpu')}</span>
          <b>{pct(s.avgGpu)}</b>
        </div>
        <div>
          <span>{t('summary.maxCpuTemp')}</span>
          <b>{temp(s.maxCpuTemp)}</b>
        </div>
        <div>
          <span>{t('summary.maxGpuTemp')}</span>
          <b>{temp(s.maxGpuTemp)}</b>
        </div>
        {!!s.frozen && (
          <div>
            <span>{t('summary.frozen')}</span>
            <b>{s.frozen}</b>
          </div>
        )}
        {s.effect && s.effect.cpuBefore >= 2 && s.effect.cpuAfter < s.effect.cpuBefore && (
          <div>
            <span>{t('fx.bgCpu')}</span>
            <b>
              {Math.round(s.effect.cpuBefore)} % → {Math.round(s.effect.cpuAfter)} %
            </b>
          </div>
        )}
      </div>
    </Dialog>
  );
}
