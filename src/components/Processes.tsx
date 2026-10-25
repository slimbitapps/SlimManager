import { memo, useEffect, useMemo, useState } from 'react';
import { t, getLocale, type TKey } from '../i18n';
import { useStore, toast, errorText, updateSettings } from '../store';
import { bytes } from '../shared/format';
import type { Kind, Level, ProcData } from '../types';
import { Dialog, Seg } from './ui';
import { IconSearch, IconStop, IconFolder, IconBroom, IconGamepad, IconBolt, IconUp, IconDown, IconShield } from '../icons';

type Filter = 'all' | 'app' | 'game' | 'background' | 'system';
type SortKey = 'name' | 'cpu' | 'mem' | 'kind';
type Row = { id: string; name: string; cpu: number; mem: number; count: number; kind: Kind; prio: Level; path: string; pids: number[]; exe: string; pid?: number };

export const LEVELS: Level[] = ['low', 'below', 'normal', 'above', 'high'];
const isLocked = (k: Kind) => k === 'system' || k === 'self';

/** Prozessliste beobachten, solange die Ansicht offen ist */
function useProcs(): ProcData | null {
  const procs = useStore((s) => s.procs);
  useEffect(() => {
    window.api.watchProcs(true).then((p) => useStore.setState({ procs: p }));
    return () => void window.api.watchProcs(false);
  }, []);
  return procs;
}

export function Processes() {
  const procs = useProcs();
  const expert = useStore((s) => s.settings.prefs.mode === 'expert');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [grouped, setGrouped] = useState(true);
  const [sort, setSort] = useState<[SortKey, 1 | -1]>(['cpu', -1]);
  const [sel, setSel] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Row | null>(null);
  const [cleanup, setCleanup] = useState(false);
  const locale = getLocale();

  const rows: Row[] = useMemo(() => {
    if (!procs) return [];
    const base: Row[] =
      grouped || !expert
        ? procs.groups.map((g) => ({ ...g }))
        : procs.flat.map((p) => ({ id: 'pid:' + p.pid, name: p.name, cpu: p.cpu, mem: p.mem, count: 1, kind: p.kind, prio: p.prio, path: p.path, pids: [p.pid], exe: p.name, pid: p.pid }));
    const needle = q.trim().toLowerCase();
    return base
      .filter((r) => (filter === 'all' ? true : filter === 'system' ? isLocked(r.kind) : r.kind === filter))
      .filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.exe.toLowerCase().includes(needle) || String(r.pid || '').includes(needle))
      .sort((a, b) => {
        const [k, dir] = sort;
        const va = a[k];
        const vb = b[k];
        return (typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number)) * dir || b.cpu - a.cpu;
      });
  }, [procs, grouped, expert, q, filter, sort]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, app: 0, game: 0, background: 0, system: 0 };
    for (const g of procs?.groups || []) {
      c.all++;
      if (isLocked(g.kind)) c.system++;
      else c[g.kind as Filter]++;
    }
    return c;
  }, [procs]);

  const selected = rows.find((r) => r.id === sel) || null;
  const sortBy = (k: SortKey) => setSort(([sk, dir]) => [k, sk === k ? ((-dir) as 1 | -1) : k === 'name' || k === 'kind' ? 1 : -1]);
  const head = (k: SortKey, label: string, cls = '') => (
    <button className={`th ${cls} ${sort[0] === k ? 'on' : ''}`} onClick={() => sortBy(k)}>
      {label}
      {sort[0] === k && (sort[1] === -1 ? <IconDown size={12} /> : <IconUp size={12} />)}
    </button>
  );

  const kill = async (r: Row) => {
    const res = r.pid ? await window.api.killPid(r.pid) : await window.api.killGroup(r.id);
    if (res.ok) toast(t('procs.killed', { name: r.name }), 'ok');
    else toast(errorText(res.error), 'error');
    setConfirm(null);
  };
  const prio = async (r: Row, level: Level) => {
    const res = r.pid ? await window.api.prioPid(r.pid, level) : await window.api.prioGroup(r.id, level);
    if (res.ok) toast(t('procs.prioSet', { name: r.name, level: t(`prio.${level}` as TKey) }), 'ok');
    else toast(errorText(res.error), 'error');
  };

  return (
    <div className="view procs-view" data-testid="processes">
      <header className="view-head">
        <h1>{t('nav.processes')}</h1>
        <div className="search">
          <IconSearch size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('procs.search')} data-testid="procs-search" />
        </div>
        <div className="spacer" />
        {expert && (
          <Seg<'g' | 'f'>
            value={grouped ? 'g' : 'f'}
            onChange={(v) => setGrouped(v === 'g')}
            options={[
              ['g', t('procs.grouped')],
              ['f', t('procs.flat')],
            ]}
          />
        )}
        <button className="btn sm" onClick={() => setCleanup(true)} data-testid="cleanup-open">
          <IconBroom size={16} />
          {t('procs.cleanup')}
        </button>
      </header>
      <div className="filter-tabs">
        {(['all', 'app', 'game', 'background', 'system'] as Filter[]).map((f) => (
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)} data-testid={`filter-${f}`}>
            {f !== 'all' && <span className={`kind-dot k-${f}`} />}
            {t(`filter.${f}` as TKey)}
            <span className="cnt">{counts[f]}</span>
          </button>
        ))}
      </div>
      <div className="table" role="table">
        <div className={`tr thead ${expert ? 'expert' : ''}`}>
          {head('name', t('procs.col.name'), 'name')}
          {head('kind', t('procs.col.kind'))}
          {head('cpu', 'CPU', 'num')}
          {head('mem', t('procs.col.mem'), 'num')}
          {expert && <span className="th">{t('procs.col.prio')}</span>}
          <span className="th" />
        </div>
        <div className="tbody">
          {!procs && <div className="empty">{t('common.loading')}</div>}
          {procs && rows.length === 0 && <div className="empty">{t('procs.none')}</div>}
          {rows.slice(0, 400).map((r) => (
            <ProcRow key={r.id} r={r} expert={expert} on={sel === r.id} locale={locale} onSelect={() => setSel(r.id === sel ? null : r.id)} onKill={() => setConfirm(r)} />
          ))}
        </div>
      </div>
      {selected && <ActionBar r={selected} onKill={() => setConfirm(selected)} onPrio={(l) => prio(selected, l)} />}
      {confirm && (
        <Dialog
          title={t('procs.confirm.title', { name: confirm.name })}
          onClose={() => setConfirm(null)}
          testId="kill-confirm"
          foot={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn primary danger-bg" onClick={() => kill(confirm)} data-testid="kill-yes">
                {t('procs.kill')}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>{confirm.count > 1 ? t('procs.confirm.many', { n: confirm.count }) : t('procs.confirm.one')}</p>
          <p className="muted small">{t('procs.confirm.warn')}</p>
        </Dialog>
      )}
      {cleanup && procs && <CleanupDialog procs={procs} onClose={() => setCleanup(false)} />}
    </div>
  );
}

const ProcRow = memo(function ProcRow({ r, expert, on, locale, onSelect, onKill }: { r: Row; expert: boolean; on: boolean; locale: string; onSelect: () => void; onKill: () => void }) {
  const heavy = r.cpu >= 25 ? 'hot' : r.cpu >= 8 ? 'warm' : '';
  return (
    <div className={`tr ${expert ? 'expert' : ''} ${on ? 'on' : ''}`} onClick={onSelect} data-testid="proc-row" data-name={r.name}>
      <span className="td name">
        <AppIcon path={r.path} kind={r.kind} />
        <span className="ellipsis">{r.name}</span>
        {r.count > 1 && <span className="cnt">{r.count}</span>}
        {r.pid !== undefined && <span className="faint small mono">{r.pid}</span>}
      </span>
      <span className="td">
        <span className={`kind-badge k-${r.kind}`}>{t(`kind.${r.kind}` as TKey)}</span>
      </span>
      <span className={`td num cpu-cell ${heavy}`}>
        <i style={{ width: `${Math.min(100, r.cpu)}%` }} />
        <b>{r.cpu.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %</b>
      </span>
      <span className="td num">{bytes(r.mem, locale)}</span>
      {expert && <span className="td small muted">{t(`prio.${r.prio}` as TKey)}</span>}
      <span className="td act">
        {isLocked(r.kind) ? (
          <span className="lock" title={t('procs.protected')}>
            <IconShield size={15} />
          </span>
        ) : (
          <button
            className="btn icon ghost sm kill-btn"
            title={t('procs.kill')}
            aria-label={t('procs.kill')}
            onClick={(e) => {
              e.stopPropagation();
              onKill();
            }}
            data-testid="kill-btn"
          >
            <IconStop size={16} />
          </button>
        )}
      </span>
    </div>
  );
});

/** Programm-Symbol (vom System), sonst ein farbiger Punkt */
const iconCache = new Map<string, string | null>();
function AppIcon({ path, kind }: { path: string; kind: Kind }) {
  const [src, setSrc] = useState<string | null>(() => iconCache.get(path) ?? null);
  useEffect(() => {
    if (!path || iconCache.has(path)) return;
    let live = true;
    window.api.icon(path).then((u) => {
      iconCache.set(path, u);
      if (live) setSrc(u);
    });
    return () => {
      live = false;
    };
  }, [path]);
  return src ? <img className="app-ic" src={src} alt="" /> : <span className={`app-ic dot k-${kind}`} />;
}

function ActionBar({ r, onKill, onPrio }: { r: Row; onKill: () => void; onPrio: (l: Level) => void }) {
  const boost = useStore((s) => s.settings.boost);
  const locked = isLocked(r.kind);
  const isGame = boost.games.includes(r.name);
  // Wie soll der Boost (aktueller Modus) mit dieser App umgehen?
  const m = boost[boost.mode];
  const has = (l: string[]) => l.some((x) => x.toLowerCase() === r.name.toLowerCase());
  const role = has(boost.exceptions) ? 'keep' : has(m.closeList) ? 'close' : has(m.freezeList) ? 'freeze' : 'auto';
  const setRole = (v: string) => {
    const drop = (l: string[]) => l.filter((x) => x.toLowerCase() !== r.name.toLowerCase());
    const add = (l: string[], on: boolean) => (on ? [...drop(l), r.name] : drop(l));
    updateSettings({
      boost: {
        exceptions: add(boost.exceptions, v === 'keep'),
        [boost.mode]: { closeList: add(m.closeList, v === 'close'), freezeList: add(m.freezeList, v === 'freeze') },
      },
    });
  };
  return (
    <div className="action-bar" data-testid="action-bar">
      <AppIcon path={r.path} kind={r.kind} />
      <div className="grow ellipsis">
        <b>{r.name}</b>
        <span className="faint small"> · {r.exe}</span>
      </div>
      {locked ? (
        <span className="muted small">
          <IconShield size={14} /> {t('procs.protected')}
        </span>
      ) : (
        <>
          <label className="prio-pick">
            <span className="small muted">{t('procs.col.prio')}</span>
            <select className="select sm" value={r.prio} onChange={(e) => onPrio(e.target.value as Level)} data-testid="prio-select">
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(`prio.${l}` as TKey)}
                </option>
              ))}
            </select>
          </label>
          <button className="btn sm" onClick={() => window.api.startBoost(r.name, 'game').then(() => toast(t('boost.startedFor', { name: r.name }), 'ok'))} title={t('procs.boostThis')}>
            <IconBolt size={15} />
            {t('procs.boostThis')}
          </button>
          <button
            className={`btn sm ${isGame ? 'active' : ''}`}
            onClick={() => updateSettings({ boost: { games: isGame ? boost.games.filter((g) => g !== r.name) : [...boost.games, r.name] } })}
            title={t('procs.markGame.tip')}
            data-testid="mark-game"
          >
            <IconGamepad size={15} />
            {isGame ? t('procs.isGame') : t('procs.markGame')}
          </button>
          <label className="prio-pick" title={t('procs.role.tip')}>
            <span className="small muted">{t(boost.mode === 'focus' ? 'procs.role.focus' : 'procs.role.game')}</span>
            <select className="select sm" value={role} onChange={(e) => setRole(e.target.value)} data-testid="role-select">
              {['auto', 'keep', 'freeze', 'close'].map((x) => (
                <option key={x} value={x}>
                  {t(`procs.role.${x}` as TKey)}
                </option>
              ))}
            </select>
          </label>
          {r.path && (
            <button className="btn icon sm ghost" onClick={() => window.api.reveal(r.path)} title={t('procs.reveal')} aria-label={t('procs.reveal')}>
              <IconFolder size={16} />
            </button>
          )}
          <button className="btn sm danger" onClick={onKill} data-testid="bar-kill">
            <IconStop size={15} />
            {t('procs.kill')}
          </button>
        </>
      )}
    </div>
  );
}

/** "Aufräumen": Apps und Hintergrundprogramme auswählen und gemeinsam beenden */
function CleanupDialog({ procs, onClose }: { procs: ProcData; onClose: () => void }) {
  const closeList = useStore((s) => s.settings.boost.game.closeList);
  const locale = getLocale();
  const candidates = procs.groups.filter((g) => g.kind === 'app' || g.kind === 'background').sort((a, b) => b.mem - a.mem);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(candidates.filter((g) => closeList.includes(g.name)).map((g) => g.id)));
  const total = candidates.filter((g) => picked.has(g.id)).reduce((s, g) => s + g.mem, 0);
  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const run = async () => {
    let ok = 0;
    for (const id of picked) if ((await window.api.killGroup(id)).ok) ok++;
    toast(t('cleanup.done', { n: ok }), 'ok');
    onClose();
  };
  return (
    <Dialog
      title={t('cleanup.title')}
      onClose={onClose}
      wide
      testId="cleanup"
      foot={
        <>
          <span className="muted small grow">{picked.size ? t('cleanup.frees', { mem: bytes(total, locale) }) : ''}</span>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!picked.size} onClick={run} data-testid="cleanup-run">
            {t('cleanup.run', { n: picked.size })}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {t('cleanup.text')}
      </p>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <button className="btn sm ghost" onClick={() => setPicked(new Set(candidates.filter((g) => g.kind === 'background').map((g) => g.id)))}>
          {t('cleanup.pickBg')}
        </button>
        <button className="btn sm ghost" onClick={() => setPicked(new Set())}>
          {t('cleanup.none')}
        </button>
      </div>
      <div className="check-list">
        {candidates.map((g) => (
          <label key={g.id} className={`check-row ${picked.has(g.id) ? 'on' : ''}`} data-testid="cleanup-row">
            <input type="checkbox" checked={picked.has(g.id)} onChange={() => toggle(g.id)} />
            <AppIcon path={g.path} kind={g.kind} />
            <span className="grow ellipsis">{g.name}</span>
            <span className={`kind-badge k-${g.kind}`}>{t(`kind.${g.kind}` as TKey)}</span>
            <span className="num small muted">{bytes(g.mem, locale)}</span>
          </label>
        ))}
      </div>
    </Dialog>
  );
}

export { AppIcon };
