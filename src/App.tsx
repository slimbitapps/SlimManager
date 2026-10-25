import { useStore, setView, openDialog, type View } from './store';
import { t } from './i18n';
import { Onboarding } from './components/Onboarding';
import { DashboardView } from './components/DashboardView';
import { Processes } from './components/Processes';
import { BoostView } from './components/Boost';
import { PhoneView } from './components/Phone';
import { SettingsDialog } from './components/Settings';
import { ApprovalPrompt, HotspotGuide } from './components/Hotspot';
import { Toasts, BoostSummaryDialog } from './components/Feedback';
import { Logo } from './components/ui';
import { IconGrid, IconList, IconBolt, IconPhone, IconSettings, IconHelp } from './icons';
import type { ReactNode } from 'react';

export function App() {
  const ready = useStore((s) => s.ready);
  const onboarded = useStore((s) => s.settings?.onboarded);
  const showIntro = useStore((s) => s.showIntro);
  const dialog = useStore((s) => s.dialog);
  const view = useStore((s) => s.view);
  const fullscreen = useStore((s) => s.fullscreen);
  // Sprache/Theme-Wechsel sollen alles neu zeichnen
  useStore((s) => s.settings?.prefs);
  if (!ready) return null;
  return (
    <>
      {!onboarded || showIntro ? (
        <Onboarding />
      ) : (
        <div className={`shell ${fullscreen ? 'fs' : ''}`}>
          {!fullscreen && <Sidebar />}
          <main className="main">
            {view === 'dashboard' && <DashboardView />}
            {view === 'processes' && <Processes />}
            {view === 'boost' && <BoostView />}
            {view === 'phone' && <PhoneView />}
          </main>
        </div>
      )}
      {dialog?.kind === 'settings' && <SettingsDialog tab={dialog.tab} />}
      {dialog?.kind === 'hotspot' && <HotspotGuide />}
      <BoostSummaryDialog />
      <ApprovalPrompt />
      <Toasts />
    </>
  );
}

function Sidebar() {
  const view = useStore((s) => s.view);
  const boost = useStore((s) => s.boost);
  const phones = useStore((s) => s.info?.clients.length ?? 0);
  const stats = useStore((s) => s.stats);
  const items: [View, string, ReactNode, ReactNode?][] = [
    ['dashboard', t('nav.dashboard'), <IconGrid size={19} key="d" />],
    ['processes', t('nav.processes'), <IconList size={19} key="p" />, stats?.procCount ? <span className="nav-count">{stats.procCount}</span> : null],
    ['boost', t('nav.boost'), <IconBolt size={19} key="b" />, boost.active ? <span className="nav-live" title={t('boost.active')} /> : null],
    ['phone', t('nav.phone'), <IconPhone size={19} key="h" />, phones ? <span className="nav-count on">{phones}</span> : null],
  ];
  return (
    <nav className="sidebar">
      <div className="side-brand">
        <Logo size={26} />
        <span>SlimManager</span>
      </div>
      <div className="side-items">
        {items.map(([id, label, icon, extra]) => (
          <button key={id} className={view === id ? 'on' : ''} onClick={() => setView(id)} data-testid={`nav-${id}`}>
            {icon}
            <span className="grow">{label}</span>
            {extra}
          </button>
        ))}
      </div>
      <div className="side-mini">
        <MiniStat label="CPU" v={stats?.cpu} />
        <MiniStat label="GPU" v={stats?.gpu} />
        <MiniStat label="RAM" v={stats?.ram} />
      </div>
      <div className="side-foot">
        <button onClick={() => openDialog({ kind: 'settings', tab: 'help' })} aria-label={t('common.help')} title={t('common.help')}>
          <IconHelp size={18} />
        </button>
        <button onClick={() => openDialog({ kind: 'settings' })} data-testid="open-settings" aria-label={t('common.settings')} title={t('common.settings')}>
          <IconSettings size={18} />
          <span>{t('common.settings')}</span>
        </button>
      </div>
    </nav>
  );
}

function MiniStat({ label, v }: { label: string; v: number | null | undefined }) {
  return (
    <div className="mini-stat">
      <span>{label}</span>
      <div className="mini-bar">
        <i style={{ width: `${v ?? 0}%` }} className={v != null && v > 90 ? 'hot' : ''} />
      </div>
      <b>{v == null ? '–' : `${Math.round(v)}%`}</b>
    </div>
  );
}
