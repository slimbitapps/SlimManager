import { useEffect, useMemo, useRef, useState } from 'react';
import NoSleep from 'nosleep.js';
import { create } from 'zustand';
import { Conn, store, type Status } from './conn';
import { Dashboard } from '../shared/Dashboard';
import type { WidgetData } from '../shared/WidgetView';
import { defaultLayout } from '../shared/widgets';
import { bytes } from '../shared/format';
import type { BoostState, History, Look, ProcGroup, Stats, SysInfo, Widget, Level } from '../shared/types';
import { t, setLang, getLocale, type TKey } from '../i18n';

// ------------------------------------------------------------------ Zustand der Seite
const HISTORY_KEYS = ['cpu', 'ram', 'gpu', 'gpuMem', 'cpuTemp', 'gpuTemp', 'netDown', 'netUp', 'diskRead', 'diskWrite', 'swap'] as const;
const DEFAULT_LOOK: Look = { skin: 'neon', accent: '', bg: 'aurora', bgImage: false, dim: 0.45, blur: 0, cardAlpha: 0.72, radius: 16, font: 'system', rgb: false, anim: true };

interface S {
  status: Status;
  code?: string;
  online: boolean;
  look: Look;
  layout: Widget[] | null;
  control: boolean;
  overlay: boolean;
  sys: SysInfo | null;
  stats: Stats | null;
  history: History;
  procs: ProcGroup[] | null;
  boost: BoostState;
  bg: string | null;
  toast: string | null;
}
const useR = create<S>(() => ({
  status: 'connecting',
  online: false,
  look: DEFAULT_LOOK,
  layout: null,
  control: false,
  overlay: false,
  sys: null,
  stats: null,
  history: {},
  procs: null,
  boost: { active: false },
  bg: null,
  toast: null,
}));
const set = useR.setState;

let toastTimer = 0;
function toast(text: string) {
  set({ toast: text });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => set({ toast: null }), 2600);
}

const conn = new Conn({
  status: (status, code) => set({ status, code }),
  online: (online) => set({ online }),
  message: (m) => {
    switch (m.t) {
      case 'config':
        if (m.lang === 'de' || m.lang === 'en') setLang(m.lang);
        set({ look: { ...DEFAULT_LOOK, ...m.look }, layout: m.layout, control: !!m.control, overlay: !!m.overlay, sys: m.sys || null });
        break;
      case 'stats': {
        const s: Stats = m.s;
        const h = useR.getState().history;
        const next: History = {};
        for (const k of HISTORY_KEYS) next[k] = (h[k] || []).concat([s[k] ?? null]).slice(-120);
        set({ stats: s, history: next });
        break;
      }
      case 'history':
        set({ history: m.h || {} });
        break;
      case 'procs':
        set({ procs: m.p });
        break;
      case 'boost':
        set({ boost: m.b });
        break;
      case 'bg':
        set({ bg: typeof m.img === 'string' && m.img.startsWith('data:image/') ? m.img : null });
        break;
      case 'result':
        toast(m.ok ? t('r.done') : t(`err.${['admin', 'protected', 'gone', 'no-game', 'no-control'].includes(m.error) ? m.error : 'failed'}` as TKey));
        break;
    }
  },
});
conn.connect();

// ------------------------------------------------------------------ Oberfläche
type Tab = 'dash' | 'procs' | 'boost';

export function Remote() {
  const status = useR((s) => s.status);
  const online = useR((s) => s.online);
  const [tab, setTab] = useState<Tab>('dash');
  const [menu, setMenu] = useState(false);
  const toastText = useR((s) => s.toast);

  // Prozessliste nur abonnieren, wenn sie gebraucht wird
  const layout = useR((s) => s.layout);
  const wantProcs = online && (tab !== 'dash' || (layout || []).some((w) => w.type === 'procs'));
  useEffect(() => {
    if (!wantProcs) return;
    conn.send('sub', 'procs');
    return () => void conn.send('unsub', 'procs');
  }, [wantProcs]);

  if (status !== 'ok') return <StatusScreen />;

  return (
    <div className="r-app">
      <header className="r-top">
        <i className={`r-dot ${online ? 'on' : ''}`} />
        <b className="grow ellipsis">{useR.getState().sys?.host || 'SlimManager'}</b>
        <button className="r-icon" onClick={() => setMenu(true)} aria-label="Menu" data-testid="r-menu">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <circle cx="5" cy="12" r="2" fill="currentColor" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
            <circle cx="19" cy="12" r="2" fill="currentColor" />
          </svg>
        </button>
      </header>
      {!online && <div className="r-banner">{t('r.reconnecting')}</div>}
      <main className="r-main">
        {tab === 'dash' && <DashTab />}
        {tab === 'procs' && <ProcsTab />}
        {tab === 'boost' && <BoostTab />}
      </main>
      <nav className="r-tabs">
        {(['dash', 'procs', 'boost'] as Tab[]).map((x) => (
          <button key={x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)} data-testid={`r-tab-${x}`}>
            <TabIcon tab={x} />
            <span>{t(`r.tab.${x}` as TKey)}</span>
          </button>
        ))}
      </nav>
      {menu && <Menu onClose={() => setMenu(false)} />}
      {toastText && <div className="r-toast">{toastText}</div>}
    </div>
  );
}

function TabIcon({ tab }: { tab: Tab }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {tab === 'dash' && (
        <>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
        </>
      )}
      {tab === 'procs' && <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />}
      {tab === 'boost' && <path d="M13 2 4 14h7l-1 8 9-12h-7z" />}
    </svg>
  );
}

function useData(): WidgetData {
  const stats = useR((s) => s.stats);
  const history = useR((s) => s.history);
  const sys = useR((s) => s.sys);
  const procs = useR((s) => s.procs);
  const boost = useR((s) => s.boost);
  const control = useR((s) => s.control);
  const game = useMemo(() => (procs || []).find((p) => p.kind === 'game')?.name || null, [procs]);
  return useMemo(
    () => ({
      stats,
      history,
      sys,
      procs,
      boost,
      game,
      onBoost: control ? (on: boolean) => (on ? game && conn.send('boost', { app: game }) : conn.send('unboost')) : undefined,
    }),
    [stats, history, sys, procs, boost, game, control],
  );
}

function DashTab() {
  const look = useR((s) => s.look);
  const layout = useR((s) => s.layout);
  const bg = useR((s) => s.bg);
  const data = useData();
  const missing = useR((s) => (s.stats ? [s.stats.cpuTemp === null, s.stats.gpuTemp === null, s.stats.gpuMem === null].join() : ''));
  const list = useMemo(() => layout || defaultLayout(look.skin, 'phone', useR.getState().stats), [layout, look.skin, missing]);
  return <Dashboard look={look} image={bg} layout={list} data={data} maxCols={6} minCol={165} testId="r-dashboard" />;
}

// ------------------------------------------------------------------ Prozesse
const LEVELS: Level[] = ['low', 'below', 'normal', 'above', 'high'];

function ProcsTab() {
  const procs = useR((s) => s.procs);
  const control = useR((s) => s.control);
  const [sort, setSort] = useState<'cpu' | 'mem'>('cpu');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<ProcGroup | null>(null);
  const locale = getLocale();
  const list = (procs || [])
    .filter((p) => p.kind !== 'self' && (!q || p.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b[sort] - a[sort]);
  return (
    <div className="r-procs" data-testid="r-procs">
      <div className="r-procs-head">
        <input className="r-search" placeholder="🔍" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="r-seg">
          <button className={sort === 'cpu' ? 'on' : ''} onClick={() => setSort('cpu')}>
            {t('r.sortCpu')}
          </button>
          <button className={sort === 'mem' ? 'on' : ''} onClick={() => setSort('mem')}>
            {t('r.sortMem')}
          </button>
        </div>
      </div>
      {!control && <div className="r-note">{t('r.viewOnly')}</div>}
      {!procs && <div className="r-note">{t('common.loading')}</div>}
      <div className="r-list">
        {list.map((p) => (
          <button key={p.id} className="r-row" onClick={() => setSel(p)} data-testid="r-proc" data-name={p.name}>
            <span className={`kind-dot k-${p.kind}`} />
            <span className="grow ellipsis">
              {p.name}
              {p.count > 1 && <small> · {p.count}</small>}
            </span>
            <span className="r-num">{p.cpu.toLocaleString(locale, { maximumFractionDigits: 1 })} %</span>
            <span className="r-num mem">{bytes(p.mem, locale, 0)}</span>
          </button>
        ))}
      </div>
      {sel && <ProcSheet p={(procs || []).find((x) => x.id === sel.id) || sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function ProcSheet({ p, onClose }: { p: ProcGroup; onClose: () => void }) {
  const control = useR((s) => s.control);
  const locale = getLocale();
  const locked = p.kind === 'system' || p.kind === 'self';
  return (
    <Sheet title={p.name} onClose={onClose}>
      <div className="r-kv">
        <span>{t(`kind.${p.kind}` as TKey)}</span>
        <span>CPU {p.cpu.toLocaleString(locale, { maximumFractionDigits: 1 })} %</span>
        <span>{bytes(p.mem, locale)}</span>
      </div>
      {locked ? (
        <div className="r-note">{t('procs.protected')}</div>
      ) : control ? (
        <>
          <div className="r-label">{t('procs.col.prio')}</div>
          <div className="r-prio">
            {LEVELS.map((l) => (
              <button key={l} className={p.prio === l ? 'on' : ''} onClick={() => conn.send('prio', { id: p.id, level: l })} data-testid={`r-prio-${l}`}>
                {t(`prio.${l}` as TKey)}
              </button>
            ))}
          </div>
          <button className="r-btn" onClick={() => (conn.send('boost', { app: p.name }), onClose())}>
            ⚡ {t('procs.boostThis')}
          </button>
          <button
            className="r-btn danger"
            onClick={() => {
              if (!confirm(t('r.killConfirm', { name: p.name }))) return;
              conn.send('kill', { id: p.id });
              onClose();
            }}
            data-testid="r-kill"
          >
            {t('procs.kill')}
          </button>
        </>
      ) : (
        <div className="r-note">{t('r.viewOnly')}</div>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------ Boost
function BoostTab() {
  const boost = useR((s) => s.boost);
  const procs = useR((s) => s.procs);
  const control = useR((s) => s.control);
  const stats = useR((s) => s.stats);
  const candidates = (procs || []).filter((p) => p.kind === 'game' || p.kind === 'app').sort((a, b) => (a.kind === 'game' ? -1 : 0) - (b.kind === 'game' ? -1 : 0) || b.mem - a.mem);
  const game = candidates.find((p) => p.kind === 'game')?.name || '';
  const [pick, setPick] = useState('');
  const target = pick || game;
  return (
    <div className="r-boost" data-testid="r-boost">
      <div className={`r-bolt ${boost.active ? 'on' : ''}`}>
        <svg viewBox="0 0 24 24" width="64" height="64" aria-hidden="true">
          <path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" />
        </svg>
      </div>
      <h2>{boost.active ? t('boost.activeFor', { name: boost.app || '' }) : game ? t('boost.detected', { name: game }) : t('boost.title')}</h2>
      {boost.active && (
        <p className="r-sub">
          CPU {stats?.cpu != null ? Math.round(stats.cpu) : '–'} % · GPU {stats?.gpu != null ? Math.round(stats.gpu) : '–'} % · RAM {stats?.ram != null ? Math.round(stats.ram) : '–'} %
        </p>
      )}
      {!control && <div className="r-note">{t('r.viewOnly')}</div>}
      {control && !boost.active && (
        <>
          <select className="r-select" value={target} onChange={(e) => setPick(e.target.value)}>
            <option value="">{t('boost.choose')}</option>
            {candidates.map((g) => (
              <option key={g.id} value={g.name}>
                {g.kind === 'game' ? '🎮 ' : ''}
                {g.name}
              </option>
            ))}
          </select>
          <button className="r-btn big" disabled={!target} onClick={() => conn.send('boost', { app: target })} data-testid="r-boost-start">
            ⚡ {t('boost.start')}
          </button>
        </>
      )}
      {control && boost.active && (
        <button className="r-btn big ghost" onClick={() => conn.send('unboost')} data-testid="r-boost-stop">
          {t('boost.stop')}
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Menü
const noSleep = new NoSleep();

function Menu({ onClose }: { onClose: () => void }) {
  const control = useR((s) => s.control);
  const overlay = useR((s) => s.overlay);
  const [awake, setAwake] = useState(store.get('awake') === '1');
  return (
    <Sheet title="SlimManager" onClose={onClose}>
      <button
        className="r-btn"
        onClick={() => {
          const d = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
          if (document.fullscreenElement) document.exitFullscreen?.();
          else (d.requestFullscreen?.bind(d) || d.webkitRequestFullscreen?.bind(d))?.();
          onClose();
        }}
      >
        ⛶ {t('r.fullscreen')}
      </button>
      <label className="r-switch">
        <span>{t('r.keepAwake')}</span>
        <input
          type="checkbox"
          checked={awake}
          onChange={(e) => {
            const on = e.target.checked;
            setAwake(on);
            store.set('awake', on ? '1' : '0');
            if (on) noSleep.enable().catch(() => {});
            else noSleep.disable();
          }}
        />
      </label>
      {control && (
        <label className="r-switch">
          <span>{t('r.overlay')}</span>
          <input type="checkbox" checked={overlay} onChange={(e) => conn.send('overlay', { on: e.target.checked })} />
        </label>
      )}
      <button className="r-btn ghost" onClick={() => (conn.forget(), onClose())}>
        {t('r.disconnect')}
      </button>
    </Sheet>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="r-scrim" onClick={onClose} />
      <div className="r-sheet" role="dialog">
        <div className="r-sheet-head">
          <h3 className="ellipsis">{title}</h3>
          <button className="r-icon" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Verbinden / Fehler
function StatusScreen() {
  const status = useR((s) => s.status);
  const code = useR((s) => s.code);
  const [pin, setPin] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (status === 'pin') input.current?.focus();
  }, [status]);
  const msg: Record<string, TKey> = { 'bad-pin': 'r.badPin', 'bad-code': 'r.badCode', denied: 'r.denied', removed: 'r.removed', blocked: 'r.blocked', unreachable: 'r.unreachable' };
  return (
    <div className="r-status" data-testid="r-status">
      <div className="r-card">
        <Logo />
        {(status === 'connecting' || status === 'approval') && (
          <>
            <div className="r-spin" />
            <p>{status === 'approval' ? t('r.waitApproval') : t('r.connecting')}</p>
          </>
        )}
        {status === 'pin' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (pin.length === 6) conn.usePin(pin);
            }}
          >
            <h1>{t('r.pinTitle')}</h1>
            {code && msg[code] && <p className="r-err">{t(msg[code])}</p>}
            <p>{t('r.pinText')}</p>
            <input
              ref={input}
              className="r-pin"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              data-testid="r-pin"
            />
            <button className="r-btn big" disabled={pin.length !== 6} data-testid="r-pin-go">
              {t('r.pinGo')}
            </button>
          </form>
        )}
        {status === 'error' && (
          <>
            <p className="r-err">{t(msg[code || 'unreachable'] || 'r.unreachable')}</p>
            <button className="r-btn" onClick={() => conn.retry()}>
              {t('r.retry')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 64 64" width="60" height="60" aria-hidden="true">
      <defs>
        <linearGradient id="rl-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
        <linearGradient id="rl-ink" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14.4" fill="url(#rl-bg)" />
      <rect x="10.3" y="13.4" width="15.6" height="29.4" rx="3.4" fill="#fff" opacity="0.36" transform="rotate(-12 18.1 28.1)" />
      <rect x="18.75" y="20" width="34" height="26" rx="4.1" fill="#fff" />
      <path d="M26.5 38.5a9.3 9.3 0 0 1 18.6 0" fill="none" stroke="url(#rl-ink)" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M35.8 38.5l5-6.2" stroke="#1e1b4b" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="35.8" cy="38.5" r="2" fill="#1e1b4b" />
    </svg>
  );
}
