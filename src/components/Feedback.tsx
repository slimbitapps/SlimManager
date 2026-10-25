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
          <b>{s.app}</b>
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
      </div>
    </Dialog>
  );
}
