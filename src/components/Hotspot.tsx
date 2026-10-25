import { useState } from 'react';
import { t, type TKey } from '../i18n';
import { useStore, closeDialog } from '../store';
import { Dialog } from './ui';
import { IconHotspot, IconCheck, IconInfo, IconShield } from '../icons';

/** Schritt-für-Schritt-Anleitung, wenn das Schul-WLAN Geräte voneinander trennt. */
export function HotspotGuide() {
  const [phone, setPhone] = useState<'iphone' | 'android'>('iphone');
  const a = useStore((s) => s.info?.address);
  const isMac = window.api.platform === 'darwin';
  const onHotspot = a && (a.kind === 'hotspot' || a.kind === 'iphone-hotspot');
  return (
    <Dialog title={t('hs.title')} onClose={closeDialog} wide testId="hotspot">
      <p className="muted" style={{ marginTop: 0 }}>
        {t('hs.why')}
      </p>
      {a && (
        <div className={`hs-now ${onHotspot ? 'ok' : ''}`}>
          {onHotspot ? <IconCheck size={16} strokeWidth={2.6} /> : <IconInfo size={16} />}
          {t('hs.now', { kind: t(`net.${a.kind}` as TKey), ip: a.address })}
        </div>
      )}

      <div className="hs-step">
        <h3>{t('hs.step1')}</h3>
        <div className="seg" style={{ maxWidth: 260 }}>
          <button className={phone === 'iphone' ? 'on' : ''} onClick={() => setPhone('iphone')}>
            {t('hs.iphone')}
          </button>
          <button className={phone === 'android' ? 'on' : ''} onClick={() => setPhone('android')}>
            {t('hs.android')}
          </button>
        </div>
        <ol className="hs-list">
          {[1, 2, 3].map((n) => (
            <li key={n}>{t(`hs.${phone}.${n}` as TKey)}</li>
          ))}
        </ol>
      </div>

      <div className="hs-step">
        <h3>{t('hs.step2')}</h3>
        <p className="hs-p">{isMac ? t('hs.mac') : t('hs.win')}</p>
      </div>

      <div className="hs-step">
        <h3>{t('hs.step3')}</h3>
        <p className="hs-p">{t('hs.final')}</p>
      </div>

      <div className="hs-note">
        <IconShield size={16} />
        <div>
          {t('hs.data')} <span className="faint">{t('hs.dataWarn')}</span>
        </div>
      </div>

      {!isMac && (
        <>
          <div className="section-label" style={{ marginTop: 18 }}>
            {t('hs.alt.title')}
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            <IconHotspot size={13} /> {t('hs.alt.text')}
          </p>
          <div className="section-label" style={{ marginTop: 18 }}>
            {t('hs.fw.title')}
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            {t('hs.fw.text')}
          </p>
        </>
      )}
    </Dialog>
  );
}

/** Abfrage, wenn ein weiteres Gerät steuern möchte */
export function ApprovalPrompt() {
  const approvals = useStore((s) => s.approvals);
  const req = approvals[0];
  if (!req) return null;
  return (
    <div className="backdrop top">
      <div className="dialog" role="alertdialog" data-testid="approval">
        <div className="d-head">
          <h2>{t('approval.title')}</h2>
        </div>
        <div className="d-body">
          <p style={{ margin: 0 }}>{t('approval.text', { name: req.name })}</p>
        </div>
        <div className="d-foot">
          <button className="btn" onClick={() => window.api.answerApproval(req.id, false)} data-testid="approval-deny">
            {t('common.deny')}
          </button>
          <button className="btn primary" onClick={() => window.api.answerApproval(req.id, true)} data-testid="approval-allow">
            {t('common.allow')}
          </button>
        </div>
      </div>
    </div>
  );
}
