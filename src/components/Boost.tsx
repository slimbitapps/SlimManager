import { useEffect, useState, type ReactNode } from 'react';
import { t, getLang, getLocale, type TKey } from '../i18n';
import { useStore, updateSettings, toast, errorText } from '../store';
import { bytes, duration } from '../shared/format';
import type { BoostMode, Settings } from '../types';
import { Group, Row, Switch } from './ui';
import { AppIcon } from './Processes';
import { IconBolt, IconInfo, IconKeyboard, IconClose, IconPlus, IconShield } from '../icons';

type Caps = Awaited<ReturnType<typeof window.api.boostCaps>>;

export function BoostView() {
  const boost = useStore((s) => s.boost);
  const game = useStore((s) => s.game);
  const b = useStore((s) => s.settings.boost);
  const procs = useStore((s) => s.procs);
  const stats = useStore((s) => s.stats);
  const [caps, setCaps] = useState<Caps>({ freeze: true, cores: false, trim: false, power: false, services: false });
  const [pick, setPick] = useState('');
  const [starting, setStarting] = useState(false);
  const [, tick] = useState(0);
  const locale = getLocale();
  const isMac = window.api.platform === 'darwin';
  const mode: BoostMode = boost.active ? boost.mode || 'game' : b.mode;

  useEffect(() => {
    window.api.boostCaps().then(setCaps);
    window.api.watchProcs(true).then((p) => useStore.setState({ procs: p }));
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => {
      clearInterval(id);
      void window.api.watchProcs(false);
    };
  }, []);

  const groups = procs?.groups || [];
  const candidates = groups.filter((g) => g.kind === 'game' || g.kind === 'app').sort((a, c) => (a.kind === 'game' ? -1 : 0) - (c.kind === 'game' ? -1 : 0) || c.mem - a.mem);
  const target = pick || game || '';
  const setMode = (m: BoostMode) => updateSettings({ boost: { mode: m } });
  const setCfg = (p: Partial<Settings['boost']['game']> | Partial<Settings['boost']['focus']>) => updateSettings({ boost: { [mode]: p } });
  const cfg = b[mode] as Settings['boost']['game'] & Settings['boost']['focus'];

  const start = async () => {
    setStarting(true);
    const r = await window.api.startBoost(mode === 'game' ? target : '', mode);
    setStarting(false);
    if (!r.ok) toast(errorText(r.error), 'error');
  };

  return (
    <div className="view boost-view" data-testid="boost">
      <header className="view-head" data-tauri-drag-region>
        <h1>{t('nav.boost')}</h1>
      </header>
      <div className="boost-scroll">
        {/* Modus */}
        <div className="mode-cards">
          {(['game', 'focus'] as BoostMode[]).map((m) => (
            <button key={m} className={`mode-card m-${m} ${mode === m ? 'on' : ''}`} disabled={boost.active} onClick={() => setMode(m)} data-testid={`mode-${m}`}>
              <span className="mode-ic">{m === 'game' ? '🎮' : '💼'}</span>
              <span className="grow">
                <b>{t(`boost.mode.${m}` as TKey)}</b>
                <small>{t(`boost.mode.${m}.desc` as TKey)}</small>
              </span>
            </button>
          ))}
        </div>

        <section className={`boost-hero m-${mode} ${boost.active ? 'on' : ''}`}>
          <div className="bolt">{mode === 'focus' ? <span className="bolt-emoji">💼</span> : <IconBolt size={44} />}</div>
          <div className="grow">
            {boost.active ? (
              <>
                <h2 data-testid="boost-status">{mode === 'focus' ? t('focus.active') : t('boost.activeFor', { name: boost.app || '' })}</h2>
                <p className="muted">{t('boost.since', { time: duration(Math.round((Date.now() - (boost.startedAt || Date.now())) / 1000), getLang()) })}</p>
                <div className="hero-stats">
                  <span>CPU {stats?.cpu != null ? Math.round(stats.cpu) + ' %' : '–'}</span>
                  <span>GPU {stats?.gpu != null ? Math.round(stats.gpu) + ' %' : '–'}</span>
                  <span>RAM {stats?.ram != null ? Math.round(stats.ram) + ' %' : '–'}</span>
                </div>
              </>
            ) : (
              <>
                <h2>{mode === 'focus' ? t('focus.title') : game ? t('boost.detected', { name: game }) : t('boost.title')}</h2>
                <p className="muted">{t(mode === 'focus' ? 'focus.what' : 'boost.what')}</p>
                {mode === 'game' && (
                  <select className="select" style={{ marginTop: 12 }} value={target} onChange={(e) => setPick(e.target.value)} data-testid="boost-pick">
                    <option value="">{t('boost.choose')}</option>
                    {candidates.map((g) => (
                      <option key={g.id} value={g.name}>
                        {g.kind === 'game' ? '🎮 ' : ''}
                        {g.name} · {bytes(g.mem, locale, 0)}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}
          </div>
          {boost.active ? (
            <button className="btn lg" onClick={() => window.api.stopBoost()} data-testid="boost-stop">
              {t(mode === 'focus' ? 'focus.stop' : 'boost.stop')}
            </button>
          ) : (
            <button className="btn primary lg boost-go" disabled={(mode === 'game' && !target) || starting} onClick={start} data-testid="boost-start">
              {mode === 'game' && <IconBolt size={18} />}
              {starting ? t('common.loading') : t(mode === 'focus' ? 'focus.start' : 'boost.start')}
            </button>
          )}
        </section>

        {boost.active && <EffectPanel />}

        <div className="boost-cols">
          <div>
            <Group label={t(mode === 'focus' ? 'focus.options' : 'boost.options')}>
              {mode === 'game' && (
                <>
                  <Row label={t('boost.auto')} desc={t('boost.auto.desc')}>
                    <Switch on={b.auto} onChange={(auto) => updateSettings({ boost: { auto } })} testId="boost-auto" />
                  </Row>
                  <Row label={t('boost.raise')} desc={isMac ? t('boost.raise.descMac') : t('boost.raise.desc')}>
                    <Switch on={cfg.raiseGame} onChange={(raiseGame) => setCfg({ raiseGame })} />
                  </Row>
                </>
              )}
              <Row label={t('boost.freeze')} desc={t('boost.freeze.desc')}>
                <Switch on={cfg.freezeBg} onChange={(freezeBg) => setCfg({ freezeBg })} testId="opt-freeze" />
              </Row>
              <Row label={t('boost.lower')} desc={t('boost.lower.desc')}>
                <Switch on={cfg.lowerOthers} onChange={(lowerOthers) => setCfg({ lowerOthers })} />
              </Row>
              {mode === 'game' && caps.cores && (
                <Row label={t('boost.cores')} desc={t('boost.cores.desc')}>
                  <Switch on={cfg.cores} onChange={(cores) => setCfg({ cores })} />
                </Row>
              )}
              {mode === 'game' && caps.power && (
                <Row label={t('boost.power')} desc={t('boost.power.desc')}>
                  <Switch on={cfg.power} onChange={(power) => setCfg({ power })} />
                </Row>
              )}
              {mode === 'game' && caps.trim && (
                <Row label={t('boost.trim')} desc={t('boost.trim.desc')}>
                  <Switch on={cfg.trimRam} onChange={(trimRam) => setCfg({ trimRam })} />
                </Row>
              )}
              {mode === 'focus' && caps.power && (
                <Row label={t('focus.quiet')} desc={t('focus.quiet.desc')}>
                  <Switch on={cfg.quiet} onChange={(quiet) => setCfg({ quiet })} />
                </Row>
              )}
              {caps.services && (
                <Row label={t('boost.services')} desc={t('boost.services.desc')}>
                  <Switch on={cfg.services} onChange={(services) => setCfg({ services })} />
                </Row>
              )}
              <Row
                label={
                  <>
                    <IconKeyboard size={15} /> {t('boost.hotkey')}
                  </>
                }
                desc={t('boost.hotkey.desc', { key: isMac ? '⌘ ⇧ B' : 'Strg + Shift + B' })}
              >
                <Switch on={b.hotkey} onChange={(hotkey) => updateSettings({ boost: { hotkey } })} />
              </Row>
            </Group>
            {!caps.power && (
              <div className="note small muted">
                <IconInfo size={14} /> {t('boost.macNote')}
              </div>
            )}
            {mode === 'focus' && caps.services && (
              <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => window.api.openExternal('ms-settings:windowsupdate-options')}>
                {t('focus.updateSettings')}
              </button>
            )}
          </div>
          <div>
            <NameList
              label={t('boost.exceptions')}
              hint={t('boost.exceptions.desc')}
              icon={<IconShield size={14} />}
              items={b.exceptions}
              onChange={(exceptions) => updateSettings({ boost: { exceptions } })}
              candidates={groups.filter((g) => g.kind === 'app' || g.kind === 'background').map((g) => g.name)}
              testId="exceptions"
            />
            <NameList
              label={t('boost.freezeList')}
              hint={t('boost.freezeList.desc')}
              items={cfg.freezeList}
              onChange={(freezeList) => setCfg({ freezeList })}
              candidates={groups.filter((g) => g.kind === 'app' || g.kind === 'background').map((g) => g.name)}
              testId="freezelist"
            />
            <NameList
              label={t('boost.closeList')}
              hint={t('boost.closeList.empty')}
              items={cfg.closeList}
              onChange={(closeList) => setCfg({ closeList })}
              candidates={groups.filter((g) => g.kind === 'app' || g.kind === 'background').map((g) => g.name)}
              testId="closelist"
            />
            {mode === 'game' && (
              <NameList
                label={t('boost.games')}
                hint={t('boost.games.empty')}
                items={b.games}
                onChange={(games) => updateSettings({ boost: { games } })}
                candidates={groups.filter((g) => g.kind === 'app').map((g) => g.name)}
                testId="games"
              />
            )}
            <div className="running-games">
              {groups
                .filter((g) => g.kind === 'game')
                .map((g) => (
                  <span key={g.id} className="game-chip">
                    <AppIcon path={g.path} kind={g.kind} />
                    {g.name}
                  </span>
                ))}
            </div>
          </div>
        </div>
        <div className="note small muted" style={{ maxWidth: 1100 }}>
          <IconShield size={14} /> {t('boost.safety')}
        </div>
      </div>
    </div>
  );
}

/** Was der Boost gerade tut – und was es gebracht hat */
function EffectPanel() {
  const b = useStore((s) => s.boost);
  const locale = getLocale();
  const items: [string, ReactNode, boolean][] = [
    ['⚡', t('fx.raised', { n: b.raised ?? 0 }), (b.raised ?? 0) > 0],
    ['❄️', t('fx.frozen', { n: b.frozen ?? 0 }), (b.frozen ?? 0) > 0],
    ['🐢', t('fx.lowered', { n: b.lowered ?? 0 }), (b.lowered ?? 0) > 0],
    ['✖️', t('fx.closed', { n: b.closed ?? 0 }), (b.closed ?? 0) > 0],
    ['🧠', t('fx.cores', { n: b.cores ?? 0 }), (b.cores ?? 0) > 0],
    ['🧹', t('fx.trimmed', { n: b.trimmed ?? 0 }), (b.trimmed ?? 0) > 0],
    ['🔋', b.power === 'quiet' ? t('fx.quiet') : t('fx.power'), !!b.power],
    ['🛡️', t('fx.kept', { n: b.kept ?? 0 }), (b.kept ?? 0) > 0],
    [
      '⏸️',
      b.services === 'asking' ? t('fx.services.asking') : typeof b.services === 'number' ? t('fx.services', { n: b.services }) : b.services === 'admin-denied' ? t('fx.services.denied') : t('fx.services.ok'),
      b.services !== null && b.services !== undefined,
    ],
  ];
  const e = b.effect;
  return (
    <section className="effect" data-testid="effect">
      <div className="fx-chips">
        {items
          .filter((x) => x[2])
          .map(([ic, text], i) => (
            <span key={i} className="fx-chip">
              <span>{ic}</span>
              {text}
            </span>
          ))}
      </div>
      {b.raiseError === 'admin' && (
        <p className="note warn small">
          <IconInfo size={14} /> {window.api.platform === 'darwin' ? t('boost.macAdmin') : t('boost.winAdmin')}
        </p>
      )}
      {e ? (
        <div className="fx-measure" data-testid="effect-measure">
          {/* Ehrlich: Nur eine echte Verbesserung wird grün gezeigt */}
          {e.cpuBefore >= 2 && e.cpuAfter < e.cpuBefore ? (
            <div>
              <span>{t('fx.bgCpu')}</span>
              <b>
                {e.cpuBefore.toLocaleString(locale, { maximumFractionDigits: 1 })} % → <em>{e.cpuAfter.toLocaleString(locale, { maximumFractionDigits: 1 })} %</em>
              </b>
            </div>
          ) : (
            <div>
              <span>{t('fx.bgCpu')}</span>
              <b className="fx-calm">{t('fx.calm', { v: e.cpuAfter.toLocaleString(locale, { maximumFractionDigits: 1 }) })}</b>
            </div>
          )}
          {e.ramFreed !== null && e.ramFreed > 50 * 1048576 && (
            <div>
              <span>{t('fx.ramFreed')}</span>
              <b>
                <em>+{bytes(e.ramFreed, locale)}</em>
              </b>
            </div>
          )}
        </div>
      ) : (
        <p className="faint small" style={{ margin: '8px 0 0' }}>
          {t('fx.measuring')}
        </p>
      )}
    </section>
  );
}

/** Liste von Programm-Namen: Chips + aus laufenden Apps wählen oder Namen eintippen */
function NameList({ label, hint, items, onChange, candidates, icon, testId }: { label: string; hint: string; items: string[]; onChange: (v: string[]) => void; candidates: string[]; icon?: ReactNode; testId: string }) {
  const [text, setText] = useState('');
  const add = (n: string) => {
    const v = n.trim();
    if (v && !items.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...items, v]);
    setText('');
  };
  const free = [...new Set(candidates)].filter((c) => !items.some((x) => x.toLowerCase() === c.toLowerCase())).sort((a, b) => a.localeCompare(b));
  return (
    <div className="settings-group" data-testid={testId}>
      <div className="section-label">
        {icon} {label}
      </div>
      <div className="card name-list">
        <p className="small faint" style={{ margin: '0 0 8px' }}>
          {hint}
        </p>
        <div className="chips">
          {items.map((n) => (
            <span key={n} className="name-chip">
              {n}
              <button onClick={() => onChange(items.filter((x) => x !== n))} aria-label={t('common.remove')}>
                <IconClose size={12} />
              </button>
            </span>
          ))}
        </div>
        <div className="row" style={{ gap: 6, marginTop: 10 }}>
          <select className="select grow" value="" onChange={(e) => e.target.value && add(e.target.value)} data-testid={`${testId}-add`}>
            <option value="">{t('list.addRunning')}</option>
            {free.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <input className="input" style={{ width: 150 }} placeholder={t('list.type')} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add(text)} />
          <button className="btn icon sm" onClick={() => add(text)} disabled={!text.trim()} aria-label={t('list.add')}>
            <IconPlus size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
