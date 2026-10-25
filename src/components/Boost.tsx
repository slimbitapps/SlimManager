import { useEffect, useState } from 'react';
import { t, getLang, getLocale } from '../i18n';
import { useStore, updateSettings, toast, errorText } from '../store';
import { bytes, duration } from '../shared/format';
import { Group, Row, Switch } from './ui';
import { AppIcon } from './Processes';
import { IconBolt, IconGamepad, IconInfo, IconKeyboard, IconTrash } from '../icons';

export function BoostView() {
  const boost = useStore((s) => s.boost);
  const game = useStore((s) => s.game);
  const cfg = useStore((s) => s.settings.boost);
  const procs = useStore((s) => s.procs);
  const stats = useStore((s) => s.stats);
  const isMac = window.api.platform === 'darwin';
  const [pick, setPick] = useState<string>('');
  const [, tick] = useState(0);
  const locale = getLocale();

  useEffect(() => {
    window.api.watchProcs(true).then((p) => useStore.setState({ procs: p }));
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => {
      clearInterval(id);
      void window.api.watchProcs(false);
    };
  }, []);

  // Auswahl: erkanntes Spiel, sonst größte App
  const candidates = (procs?.groups || []).filter((g) => g.kind === 'game' || g.kind === 'app').sort((a, b) => (a.kind === 'game' ? -1 : 0) - (b.kind === 'game' ? -1 : 0) || b.mem - a.mem);
  const target = pick || game || '';

  const start = async () => {
    if (!target) return;
    const r = await window.api.startBoost(target);
    if (!r.ok) toast(errorText(r.error), 'error');
  };

  return (
    <div className="view boost-view" data-testid="boost">
      <header className="view-head">
        <h1>{t('nav.boost')}</h1>
      </header>
      <div className="boost-scroll">
        <section className={`boost-hero ${boost.active ? 'on' : ''}`}>
          <div className="bolt">
            <IconBolt size={44} />
          </div>
          <div className="grow">
            {boost.active ? (
              <>
                <h2 data-testid="boost-status">{t('boost.activeFor', { name: boost.app || '' })}</h2>
                <p className="muted">
                  {t('boost.since', { time: duration(Math.round((Date.now() - (boost.startedAt || Date.now())) / 1000), getLang()) })} ·{' '}
                  {t('boost.changes', { raised: boost.raised ?? 0, lowered: boost.lowered ?? 0, closed: boost.closed ?? 0 })}
                </p>
                {boost.raiseError === 'admin' && (
                  <p className="note warn small">
                    <IconInfo size={14} /> {isMac ? t('boost.macAdmin') : t('boost.winAdmin')}
                  </p>
                )}
                <div className="hero-stats">
                  <span>CPU {stats?.cpu != null ? Math.round(stats.cpu) + ' %' : '–'}</span>
                  <span>GPU {stats?.gpu != null ? Math.round(stats.gpu) + ' %' : '–'}</span>
                  <span>RAM {stats?.ram != null ? Math.round(stats.ram) + ' %' : '–'}</span>
                </div>
              </>
            ) : (
              <>
                <h2>{game ? t('boost.detected', { name: game }) : t('boost.title')}</h2>
                <p className="muted">{t('boost.what')}</p>
                <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <select className="select" value={target} onChange={(e) => setPick(e.target.value)} data-testid="boost-pick">
                    <option value="">{t('boost.choose')}</option>
                    {candidates.map((g) => (
                      <option key={g.id} value={g.name}>
                        {g.kind === 'game' ? '🎮 ' : ''}
                        {g.name} · {bytes(g.mem, locale, 0)}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>
          {boost.active ? (
            <button className="btn lg" onClick={() => window.api.stopBoost()} data-testid="boost-stop">
              {t('boost.stop')}
            </button>
          ) : (
            <button className="btn primary lg boost-go" disabled={!target} onClick={start} data-testid="boost-start">
              <IconBolt size={18} />
              {t('boost.start')}
            </button>
          )}
        </section>

        <div className="boost-cols">
          <div>
            <Group label={t('boost.options')}>
              <Row label={t('boost.auto')} desc={t('boost.auto.desc')}>
                <Switch on={cfg.auto} onChange={(auto) => updateSettings({ boost: { auto } })} testId="boost-auto" />
              </Row>
              <Row label={t('boost.raise')} desc={isMac ? t('boost.raise.descMac') : t('boost.raise.desc')}>
                <Switch on={cfg.raiseGame} onChange={(raiseGame) => updateSettings({ boost: { raiseGame } })} />
              </Row>
              <Row label={t('boost.lower')} desc={t('boost.lower.desc')}>
                <Switch on={cfg.lowerOthers} onChange={(lowerOthers) => updateSettings({ boost: { lowerOthers } })} />
              </Row>
              <Row
                label={
                  <>
                    <IconKeyboard size={15} /> {t('boost.hotkey')}
                  </>
                }
                desc={t('boost.hotkey.desc', { key: isMac ? '⌘ ⇧ B' : 'Strg + Shift + B' })}
              >
                <Switch on={cfg.hotkey} onChange={(hotkey) => updateSettings({ boost: { hotkey } })} />
              </Row>
            </Group>
            <div className="note small muted">
              <IconInfo size={14} /> {t('boost.honest')}
            </div>
          </div>
          <div>
            <Group label={t('boost.closeList')}>
              {cfg.closeList.length === 0 && <div className="setting-row faint small">{t('boost.closeList.empty')}</div>}
              {cfg.closeList.map((n) => (
                <div className="setting-row" key={n}>
                  <span className="grow">{n}</span>
                  <button className="btn icon ghost sm" onClick={() => updateSettings({ boost: { closeList: cfg.closeList.filter((x) => x !== n) } })} aria-label={t('common.remove')}>
                    <IconTrash size={15} />
                  </button>
                </div>
              ))}
              <div className="setting-row">
                <select
                  className="select grow"
                  value=""
                  onChange={(e) => e.target.value && updateSettings({ boost: { closeList: [...cfg.closeList, e.target.value] } })}
                  data-testid="closelist-add"
                >
                  <option value="">{t('boost.closeList.add')}</option>
                  {(procs?.groups || [])
                    .filter((g) => (g.kind === 'app' || g.kind === 'background') && !cfg.closeList.includes(g.name))
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((g) => (
                      <option key={g.id} value={g.name}>
                        {g.name}
                      </option>
                    ))}
                </select>
              </div>
            </Group>
            <Group label={t('boost.games')}>
              {cfg.games.length === 0 && <div className="setting-row faint small">{t('boost.games.empty')}</div>}
              {cfg.games.map((n) => (
                <div className="setting-row" key={n}>
                  <IconGamepad size={16} />
                  <span className="grow">{n}</span>
                  <button className="btn icon ghost sm" onClick={() => updateSettings({ boost: { games: cfg.games.filter((x) => x !== n) } })} aria-label={t('common.remove')}>
                    <IconTrash size={15} />
                  </button>
                </div>
              ))}
              <div className="setting-row">
                <select className="select grow" value="" onChange={(e) => e.target.value && updateSettings({ boost: { games: [...cfg.games, e.target.value] } })}>
                  <option value="">{t('boost.games.add')}</option>
                  {(procs?.groups || [])
                    .filter((g) => g.kind === 'app' && !cfg.games.includes(g.name))
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((g) => (
                      <option key={g.id} value={g.name}>
                        {g.name}
                      </option>
                    ))}
                </select>
              </div>
            </Group>
            <div className="running-games">
              {(procs?.groups || [])
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
      </div>
    </div>
  );
}
