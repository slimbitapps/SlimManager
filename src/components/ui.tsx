import { useEffect, type ReactNode } from 'react';
import { t } from '../i18n';
import { IconClose } from '../icons';

/**
 * App-Logo im SlimBit-Schema: abgerundetes Quadrat mit Farbverlauf, halbdurchsichtiges Element dahinter, weißes Motiv davor.
 * SlimManager: Handy (hinten, für die Handy-Anzeige) + Fenster mit Tacho und Balken (vorne), Violett → Türkis.
 */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lm-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
        <linearGradient id="lm-ink" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14.4" fill="url(#lm-bg)" />
      <rect x="10.3" y="13.4" width="15.6" height="29.4" rx="3.4" fill="#fff" opacity="0.36" transform="rotate(-12 18.1 28.1)" />
      <rect x="18.75" y="20" width="34" height="26" rx="4.1" fill="#fff" />
      <path d="M26.5 38.5a9.3 9.3 0 0 1 18.6 0" fill="none" stroke="url(#lm-ink)" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M35.8 38.5l5-6.2" stroke="#1e1b4b" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="35.8" cy="38.5" r="2" fill="#1e1b4b" />
    </svg>
  );
}

export function Switch({ on, onChange, label, testId }: { on: boolean; onChange: (v: boolean) => void; label?: string; testId?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} data-testid={testId} />;
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Row({ label, desc, children }: { label: ReactNode; desc?: ReactNode; children?: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="lbl">
        <div className="t">{label}</div>
        {desc && <div className="d">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

export function Group({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="settings-group">
      {label && <div className="section-label">{label}</div>}
      <div className="card">{children}</div>
    </div>
  );
}

/** Einfacher Dialog mit Kopf, schließt mit Esc oder Klick daneben */
export function Dialog({ title, onClose, children, wide, foot, testId }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; foot?: ReactNode; testId?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" data-testid={testId}>
        <div className="d-head">
          <h2>{title}</h2>
          <button className="btn icon ghost sm" onClick={onClose} aria-label={t('common.close')}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="d-body">{children}</div>
        {foot && <div className="d-foot">{foot}</div>}
      </div>
    </div>
  );
}
