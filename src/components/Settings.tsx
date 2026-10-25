import { useEffect, useState, type ReactNode } from 'react';
import { t, LANGS, type TKey } from '../i18n';
import { useStore, updateSettings, updatePrefs, closeDialog, showIntroAgain, setView } from '../store';
import type { AppInfo, Lang, Prefs, MetricId, OverlayCfg } from '../types';
import { Group, Logo, Row, Seg, Switch } from './ui';
import { LookPanel } from './DashboardView';
import { METRICS } from '../shared/widgets';
import { IconClose, IconSettings, IconPalette, IconPip, IconBell, IconNet, IconHelp, IconInfo, IconLock, IconPhone } from '../icons';
import slimbitMark from '../assets/slimbit-mark.png';

const WEBSITE_URL = 'https://slimbitapps.github.io/';
const APP_URL = 'https://slimbitapps.github.io/SlimManager/';
const EMAIL = 'SlimBitApps@gmail.com';
type Tab = 'general' | 'look' | 'overlay' | 'alerts' | 'network' | 'help' | 'about';

export function SettingsDialog({ tab: initial }: { tab?: string }) {
  const p = useStore((s) => s.settings.prefs);
  const expert = p.mode === 'expert';
  const [tab, setTab] = useState<Tab>((initial as Tab) || 'general');
  const all: [Tab, string, ReactNode, boolean][] = [
    ['general', t('settings.general'), <IconSettings size={17} key="g" />, true],
    ['look', t('settings.look'), <IconPalette size={17} key="l" />, true],
    ['overlay', t('settings.overlay'), <IconPip size={17} key="o" />, true],
    ['alerts', t('settings.alerts'), <IconBell size={17} key="a" />, true],
    ['network', t('settings.network'), <IconNet size={17} key="n" />, expert],
    ['help', t('settings.help'), <IconHelp size={17} key="h" />, true],
    ['about', t('settings.about'), <IconInfo size={17} key="i" />, true],
  ];
  const nav = all.filter((x) => x[3]);
  useEffect(() => {
    if (!nav.some((x) => x[0] === tab)) setTab('general');
  });
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && closeDialog();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <div className="dialog xwide" role="dialog" aria-label={t('common.settings')} data-testid="settings">
        <div className="settings">
          <nav className="settings-nav">
            <h2>{t('common.settings')}</h2>
            {nav.map(([id, label, icon]) => (
              <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)} data-testid={`settings-${id}`}>
                {icon}
                {label}
              </button>
            ))}
            <button onClick={() => (closeDialog(), setView('phone'))}>
              <IconPhone size={17} />
              {t('nav.phone')}
            </button>
          </nav>
          <div className="settings-main">
            <button className="btn icon ghost sm close-x" onClick={closeDialog} aria-label={t('common.close')}>
              <IconClose size={16} />
            </button>
            {tab === 'general' && <GeneralTab />}
            {tab === 'look' && (
              <>
                <Head title="settings.look" sub="settings.look.sub" />
                <LookPanel />
              </>
            )}
            {tab === 'overlay' && <OverlayTab />}
            {tab === 'alerts' && <AlertsTab />}
            {tab === 'network' && <NetworkTab />}
            {tab === 'help' && <HelpTab />}
            {tab === 'about' && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Head({ title, sub }: { title: TKey; sub: TKey }) {
  return (
    <>
      <h3>{t(title)}</h3>
      <p className="sub">{t(sub)}</p>
    </>
  );
}

function GeneralTab() {
  const p = useStore((s) => s.settings.prefs);
  const tray = useStore((s) => s.settings.app.closeToTray);
  return (
    <>
      <Head title="settings.general" sub="settings.general.sub" />
      <Group>
        <Row label={t('settings.lang')}>
          <select className="select" value={p.lang} onChange={(e) => updatePrefs({ lang: e.target.value as Lang })} data-testid="lang-select">
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('settings.theme')}>
          <Seg<Prefs['theme']>
            value={p.theme}
            onChange={(theme) => updatePrefs({ theme })}
            options={[
              ['light', t('theme.light')],
              ['dark', t('theme.dark')],
              ['system', t('theme.system')],
            ]}
          />
        </Row>
        <Row label={t('settings.mode')} desc={t('settings.mode.desc')}>
          <Seg<Prefs['mode']>
            value={p.mode}
            onChange={(mode) => updatePrefs({ mode })}
            options={[
              ['simple', t('mode.simple')],
              ['expert', t('mode.expert')],
            ]}
          />
        </Row>
        <Row label={t('set.tray')} desc={t('set.tray.desc')}>
          <Switch on={tray} onChange={(closeToTray) => updateSettings({ app: { closeToTray } })} />
        </Row>
      </Group>
      <button className="btn ghost sm" onClick={showIntroAgain}>
        {t('settings.intro')}
      </button>
    </>
  );
}

function OverlayTab() {
  const o = useStore((x) => x.settings.overlay);
  const isMac = window.api.platform === 'darwin';
  const set = (overlay: Partial<OverlayCfg>) => updateSettings({ overlay });
  const toggle = (m: MetricId) => set({ metrics: o.metrics.includes(m) ? o.metrics.filter((x) => x !== m) : [...o.metrics, m] });
  return (
    <>
      <Head title="settings.overlay" sub="settings.overlay.sub" />
      <Group>
        <Row label={t('overlay.on')} desc={t('overlay.hotkey', { key: isMac ? '⌘ ⇧ O' : 'Strg + Shift + O' })}>
          <Switch on={o.enabled} onChange={(enabled) => set({ enabled })} testId="overlay-switch" />
        </Row>
        <Row label={t('overlay.corner')}>
          <Seg
            value={o.corner}
            onChange={(corner) => set({ corner })}
            options={[
              ['tl', '↖'],
              ['tr', '↗'],
              ['bl', '↙'],
              ['br', '↘'],
            ]}
          />
        </Row>
        <Row label={t('overlay.opacity')}>
          <input type="range" min={0.3} max={1} step={0.05} defaultValue={o.opacity} onPointerUp={(e) => set({ opacity: Number((e.target as HTMLInputElement).value) })} />
        </Row>
        <Row label={t('overlay.scale')}>
          <input type="range" min={0.7} max={1.6} step={0.05} defaultValue={o.scale} onPointerUp={(e) => set({ scale: Number((e.target as HTMLInputElement).value) })} />
        </Row>
        <Row label={t('overlay.hotkeyOn')}>
          <Switch on={o.hotkey} onChange={(hotkey) => set({ hotkey })} />
        </Row>
      </Group>
      <div className="section-label">{t('overlay.metrics')}</div>
      <div className="chips">
        {METRICS.filter((m) => m !== 'procCount').map((m) => (
          <button key={m} className={o.metrics.includes(m) ? 'on' : ''} onClick={() => toggle(m)}>
            {t(`metric.${m}` as TKey)}
          </button>
        ))}
      </div>
      <p className="faint small">{t('overlay.note')}</p>
    </>
  );
}

function AlertsTab() {
  const a = useStore((x) => x.settings.alerts);
  const set = (alerts: Partial<typeof a>) => updateSettings({ alerts });
  const num = (k: 'cpuTemp' | 'gpuTemp' | 'ram', unit: string) => (
    <div className="row" style={{ gap: 6 }}>
      <input className="input" style={{ width: 70 }} type="number" min={30} max={110} defaultValue={a[k]} onBlur={(e) => set({ [k]: Number(e.target.value) })} />
      <span className="muted small">{unit}</span>
    </div>
  );
  return (
    <>
      <Head title="settings.alerts" sub="settings.alerts.sub" />
      <Group>
        <Row label={t('alerts.on')} desc={t('alerts.on.desc')}>
          <Switch on={a.enabled} onChange={(enabled) => set({ enabled })} />
        </Row>
        <Row label={t('metric.cpuTemp')}>{num('cpuTemp', '°C')}</Row>
        <Row label={t('metric.gpuTemp')}>{num('gpuTemp', '°C')}</Row>
        <Row label={t('metric.ram')}>{num('ram', '%')}</Row>
      </Group>
      <p className="faint small">{t('alerts.note')}</p>
    </>
  );
}

function NetworkTab() {
  const s = useStore((x) => x.settings);
  const info = useStore((x) => x.info);
  const [port, setPort] = useState(String(s.network.port));
  return (
    <>
      <Head title="settings.network" sub="settings.network.sub" />
      <Group>
        <Row label={t('set.address')} desc={t('set.address.desc')}>
          <select className="select" value={s.network.address} onChange={(e) => updateSettings({ network: { address: e.target.value } })}>
            <option value="auto">{t('set.address.auto')}</option>
            {info?.addresses.map((a) => (
              <option key={a.address} value={a.address}>
                {a.address} · {a.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('set.port')} desc={t('set.port.desc')}>
          <div className="row">
            <input className="input" style={{ width: 90 }} value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))} />
            <button
              className="btn sm"
              disabled={Number(port) === s.network.port || Number(port) > 65535}
              onClick={() => updateSettings({ network: { port: Number(port) } })}
            >
              {t('set.port.apply')}
            </button>
          </div>
        </Row>
      </Group>
      <p className="mono faint">{info?.base}</p>
    </>
  );
}

function HelpTab() {
  const [open, setOpen] = useState<number | null>(1);
  const n = 10;
  return (
    <>
      <Head title="settings.help" sub="settings.help.sub" />
      <div className="faq">
        {Array.from({ length: n }, (_, i) => i + 1).map((n) => (
          <div key={n} className={`faq-item ${open === n ? 'open' : ''}`}>
            <button onClick={() => setOpen(open === n ? null : n)}>{t(`faq.${n}.q` as TKey)}</button>
            {open === n && <p>{t(`faq.${n}.a` as TKey)}</p>}
          </div>
        ))}
      </div>
    </>
  );
}

function AboutTab() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    window.api.appInfo().then(setInfo);
  }, []);
  return (
    <>
      <div className="row" style={{ gap: 16, marginBottom: 20 }}>
        <Logo size={64} />
        <div>
          <h3 style={{ marginBottom: 0 }}>{t('app.name')}</h3>
          <div className="muted">{t('about.version', { v: info?.version || '…' })}</div>
          <div className="faint small">{t('app.tagline')}</div>
        </div>
      </div>
      <Group>
        <Row label={t('about.privacy.title')} desc={t('about.privacy')}>
          <IconLock size={18} className="faint" />
        </Row>
      </Group>

      <div className="section-label">{t('about.more')}</div>
      <button className="app-card link" style={{ marginBottom: 14 }} onClick={() => window.api.openExternal(WEBSITE_URL)} data-testid="website-link">
        <div className="row" style={{ gap: 12 }}>
          <img src={slimbitMark} alt="" width={36} height={36} />
          <div className="grow">
            <div style={{ fontWeight: 620 }}>{t('about.website')}</div>
            <div className="small faint">{t('about.website.desc')}</div>
          </div>
          <span className="small" style={{ color: 'var(--accent)', fontWeight: 600 }}>
            {WEBSITE_URL.replace(/^https:\/\//, '').replace(/\/$/, '')} ↗
          </span>
        </div>
      </button>
      <button className="app-card link" style={{ marginBottom: 14 }} onClick={() => window.api.openExternal(APP_URL)}>
        <div className="row" style={{ gap: 12 }}>
          <Logo size={36} />
          <div className="grow">
            <div style={{ fontWeight: 620 }}>{t('about.appPage')}</div>
            <div className="small faint">{t('about.appPage.desc')}</div>
          </div>
          <span className="small" style={{ color: 'var(--accent)', fontWeight: 600 }}>↗</span>
        </div>
      </button>
      <p className="small muted">
        {t('about.contact', { mail: '' })}
        <button className="link" onClick={() => window.api.openExternal('mailto:' + EMAIL)}>
          {EMAIL}
        </button>
      </p>
      <div className="row small faint" style={{ justifyContent: 'space-between' }}>
        <span>{t('about.copyright', { year: new Date().getFullYear() })}</span>
        <span>
          Electron {info?.electron} · {info?.platform}
        </span>
      </div>
    </>
  );
}
