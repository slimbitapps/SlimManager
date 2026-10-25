import { useEffect, useRef, useState } from 'react';
import { t, getLocale, type TKey } from '../i18n';
import { useStore, openDialog, updateSettings, editPhoneLayout } from '../store';
import { Group, Row, Switch } from './ui';
import { IconCheck, IconHotspot, IconRefresh, IconCopy, IconAlert, IconPhone, IconWifi, IconLock, IconEdit, IconTrash } from '../icons';

/** Handy/Tablet verbinden: QR-Code scannen ODER Adresse eintippen + PIN. */
export function PhoneView() {
  const info = useStore((s) => s.info);
  const remote = useStore((s) => s.settings.remote);
  const [copied, setCopied] = useState(false);
  const shownAt = useRef(Date.now());
  const [stuck, setStuck] = useState(false);
  const clients = info?.clients ?? [];
  const online = new Set(clients.map((c) => c.id));
  const locale = getLocale();

  // Kommt nach 40 s niemand auf die Seite, ist das WLAN vermutlich der Grund → Hilfe anbieten
  useEffect(() => {
    shownAt.current = Date.now();
    const id = setInterval(() => {
      const hit = useStore.getState().info?.lastHit ?? 0;
      setStuck(!useStore.getState().info?.clients.length && Date.now() - shownAt.current > 40_000 && hit < shownAt.current);
    }, 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="view phone-view" data-testid="phone">
      <header className="view-head" data-tauri-drag-region>
        <h1>{t('nav.phone')}</h1>
        <div className="spacer" />
        <button className="btn ghost sm" onClick={() => openDialog({ kind: 'hotspot' })} data-testid="open-hotspot">
          <IconHotspot size={16} />
          {t('phone.trouble')}
        </button>
      </header>
      <div className="phone-scroll">
        <div className="phone-grid">
          <section className="card connect-card" data-testid="connect">
            {!info?.address ? (
              <div className="center">
                <div className="big-ic warn">
                  <IconWifi size={30} />
                </div>
                <h2>{t('phone.noNetwork.title')}</h2>
                <p className="muted">{t('phone.noNetwork.text')}</p>
              </div>
            ) : (
              <>
                <h2>{t('phone.title')}</h2>
                <p className="muted small" style={{ marginTop: -6 }}>
                  {t('phone.sub')}
                </p>
                <div className="connect-two">
                  <div>
                    <div className="qr-wrap">
                      <div className="qr" data-testid="qr" dangerouslySetInnerHTML={{ __html: info.qr }} />
                    </div>
                    <div className="qr-meta">
                      <IconLock size={13} />
                      {t('phone.oneTime')}
                    </div>
                  </div>
                  <div className="or-col">
                    <div className="step-h">{t('phone.orType')}</div>
                    <div className="addr mono" data-testid="addr">
                      {info.base.replace(/^http:\/\//, '')}
                    </div>
                    <div className="step-h">{t('phone.pin')}</div>
                    <div className="pin mono" data-testid="pin">
                      {info.pin.slice(0, 3)} {info.pin.slice(3)}
                    </div>
                    <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                      <button className="btn sm ghost" onClick={() => window.api.newCode()} data-testid="new-code">
                        <IconRefresh size={15} />
                        {t('phone.newCode')}
                      </button>
                      <button
                        className="btn sm ghost"
                        onClick={() => {
                          window.api.copy(info.base);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        }}
                      >
                        <IconCopy size={15} />
                        {copied ? t('common.copied') : t('common.copy')}
                      </button>
                    </div>
                  </div>
                </div>
                <ol className="steps">
                  {[1, 2, 3].map((n) => (
                    <li key={n}>
                      <span className="num">{n}</span>
                      {t(`phone.step${n}` as TKey)}
                    </li>
                  ))}
                </ol>
                {stuck ? (
                  <div className="stuck" data-testid="stuck">
                    <IconAlert size={18} />
                    <div className="grow">{t('phone.stuck')}</div>
                    <button className="btn primary sm" onClick={() => openDialog({ kind: 'hotspot' })}>
                      {t('phone.trouble')}
                    </button>
                  </div>
                ) : (
                  <div className="trouble">{t('phone.sameWifi')}</div>
                )}
              </>
            )}
          </section>

          <div className="side">
            <section className="card pad" data-testid="clients">
              <div className="card-title">{t('phone.connected')}</div>
              {clients.length === 0 && <p className="faint small" style={{ margin: 0 }}>{t('phone.none')}</p>}
              {clients.map((c) => (
                <div className="client" key={c.id} data-testid="client">
                  <i className="dot on" />
                  <IconPhone size={18} />
                  <span className="grow ellipsis">{c.name}</span>
                  <button className="btn sm ghost" onClick={() => window.api.disconnect(c.id)}>
                    {t('phone.disconnect')}
                  </button>
                </div>
              ))}
            </section>
            <Group label={t('phone.rights')}>
              <Row label={t('phone.allowControl')} desc={t('phone.allowControl.desc')}>
                <Switch on={remote.allowControl} onChange={(allowControl) => updateSettings({ remote: { allowControl } })} testId="allow-control" />
              </Row>
              <Row label={t('phone.approve')} desc={t('phone.approve.desc')}>
                <Switch on={remote.approveNew} onChange={(approveNew) => updateSettings({ remote: { approveNew } })} />
              </Row>
            </Group>
            <section className="card pad">
              <div className="card-title">{t('phone.layout')}</div>
              <p className="small muted" style={{ marginTop: 0 }}>
                {t('phone.layout.desc')}
              </p>
              <button className="btn sm" onClick={editPhoneLayout} data-testid="edit-phone-layout">
                <IconEdit size={15} />
                {t('phone.layout.edit')}
              </button>
            </section>
            <Group label={t('phone.devices')}>
              {(info?.devices || []).length === 0 && <div className="setting-row faint small">{t('phone.devices.none')}</div>}
              {(info?.devices || []).map((d) => (
                <div className="setting-row" key={d.id} data-testid="device-row">
                  <IconPhone size={17} className="faint" />
                  <div className="lbl">
                    <div className="t">
                      {d.name} {online.has(d.id) && <span className="badge success">{t('phone.online')}</span>}
                    </div>
                    <div className="d">{t('phone.seen', { date: d.lastSeen ? new Date(d.lastSeen).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '–' })}</div>
                  </div>
                  <button className="btn icon sm ghost" onClick={() => window.api.removeDevice(d.id)} aria-label={t('common.remove')}>
                    <IconTrash size={15} />
                  </button>
                </div>
              ))}
            </Group>
            <ul className="how-list">
              {(['phone.safe.1', 'phone.safe.2', 'phone.safe.3'] as const).map((k) => (
                <li key={k}>
                  <IconCheck size={15} strokeWidth={2.6} />
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
