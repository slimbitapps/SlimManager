import { useEffect, useMemo, useState } from 'react';
import { t, type TKey } from '../i18n';
import { useStore, updateSettings, setEditing, setEditTarget, setView, setImage, toast, toggleFullscreen } from '../store';
import { Dashboard } from '../shared/Dashboard';
import type { WidgetData } from '../shared/WidgetView';
import { defaultLayout, makeWidget, METRIC, METRICS, needsProcs, PRESETS, SIZES, SKINS, stylesFor, WIDGET_TYPES } from '../shared/widgets';
import type { Bg, Font, Look, MetricId, Skin, Widget, WidgetType, WSize, WStyle } from '../types';
import { Seg, Switch } from './ui';
import { IconEdit, IconPalette, IconPip, IconPhone, IconPlus, IconCheck, IconDownload, IconUpload, IconImage, IconTrash, IconClose, IconExpand, IconMonitor } from '../icons';

type Target = 'pc' | 'phone';
type Panel = 'widget' | 'add' | 'look';

/** Aktuelles Layout (eigenes oder Standard des Skins) */
export function useLayout(target: Target): Widget[] {
  const s = useStore((x) => x.settings);
  // Nur einmal wissen, ob Temperaturen etc. fehlen – nicht bei jeder Messung neu bauen
  const missing = useStore((x) => (x.stats ? [x.stats.cpuTemp === null, x.stats.gpuTemp === null, x.stats.gpuMem === null].join() : ''));
  return useMemo(() => s.layout[target] || defaultLayout(s.look.skin, target, useStore.getState().stats), [s.layout, s.look.skin, target, missing]);
}

/** Daten für alle Widgets aus dem Speicher holen */
export function useWidgetData(): WidgetData {
  const stats = useStore((s) => s.stats);
  const history = useStore((s) => s.history);
  const sys = useStore((s) => s.sys);
  const procs = useStore((s) => s.procs);
  const boost = useStore((s) => s.boost);
  const game = useStore((s) => s.game);
  const lively = useStore((s) => s.lively && s.settings.look.anim);
  const decimals = useStore((s) => s.settings.look.decimals);
  const rate = useStore((s) => s.settings.app.rate);
  return useMemo(
    () => ({
      stats,
      history,
      sys,
      procs: procs ? procs.groups : null,
      boost,
      game,
      lively,
      decimals,
      rate,
      onBoost: (on: boolean) => (on ? game && window.api.startBoost(game) : window.api.stopBoost()),
    }),
    [stats, history, sys, procs, boost, game, lively, decimals, rate],
  );
}

export function DashboardView() {
  const look = useStore((s) => s.settings.look);
  const overlayOn = useStore((s) => s.settings.overlay.enabled);
  const image = useStore((s) => s.image);
  const editing = useStore((s) => s.editing);
  const fullscreen = useStore((s) => s.fullscreen);
  const target = useStore((s) => s.editTarget);
  const setTarget = setEditTarget;
  const [panel, setPanel] = useState<Panel>('add');
  const [selected, setSelected] = useState<string | null>(null);
  const layout = useLayout(editing ? target : 'pc');
  const data = useWidgetData();

  // Prozessliste nur messen lassen, wenn ein Widget sie zeigt
  const wantProcs = needsProcs(layout);
  useEffect(() => {
    if (!wantProcs) return;
    window.api.watchProcs(true).then((p) => useStore.setState({ procs: p }));
    return () => void window.api.watchProcs(false);
  }, [wantProcs]);

  const save = (next: Widget[]) => updateSettings({ layout: { [target]: next } });
  const sel = layout.find((w) => w.id === selected) || null;
  const edit = editing
    ? {
        selected,
        onSelect: (id: string | null) => {
          setSelected(id);
          setPanel(id ? 'widget' : 'add');
        },
        onMove: (from: number, to: number) => {
          const next = layout.slice();
          const [x] = next.splice(from, 1);
          next.splice(to, 0, x);
          save(next);
        },
        onRemove: (id: string) => {
          save(layout.filter((w) => w.id !== id));
          if (selected === id) setSelected(null);
        },
      }
    : undefined;

  return (
    <div className={`dash-view ${editing ? 'with-panel' : ''} ${fullscreen ? 'fs' : ''}`}>
      {fullscreen && (
        <div className="fs-exit">
          <button className="btn sm" onClick={() => window.api.setFullscreen(false)} data-testid="fs-exit">
            <IconClose size={15} />
            {t('fs.exit')}
          </button>
        </div>
      )}
      {!fullscreen && <header className="view-head">
        <h1>{editing ? t('dash.editTitle') : t('nav.dashboard')}</h1>
        {editing && (
          <Seg<Target>
            value={target}
            onChange={(v) => (setTarget(v), setSelected(null))}
            options={[
              ['pc', t('dash.target.pc')],
              ['phone', t('dash.target.phone')],
            ]}
          />
        )}
        <div className="spacer" />
        {!editing && (
          <>
            <button className={`btn ghost sm ${overlayOn ? 'active' : ''}`} onClick={() => window.api.setOverlay(!overlayOn)} title={t('overlay.tip')} data-testid="overlay-toggle">
              <IconPip size={16} />
              {t('overlay.btn')}
            </button>
            <button className="btn ghost sm" onClick={() => setView('phone')}>
              <IconPhone size={16} />
              {t('dash.toPhone')}
            </button>
            <FullscreenButton />
            <button className="btn sm" onClick={() => (setPanel('look'), setEditing(true))} data-testid="open-look">
              <IconPalette size={16} />
              {t('dash.look')}
            </button>
            <button className="btn primary sm" onClick={() => (setPanel('add'), setEditing(true))} data-testid="edit-layout">
              <IconEdit size={16} />
              {t('dash.edit')}
            </button>
          </>
        )}
        {editing && (
          <button className="btn primary sm" onClick={() => (setEditing(false), setSelected(null))} data-testid="edit-done">
            <IconCheck size={16} />
            {t('common.done')}
          </button>
        )}
      </header>}
      <div className="dash-area">
        <div className={`dash-holder ${editing && target === 'phone' ? 'phone-frame' : ''}`}>
          <Dashboard look={look} image={image} layout={layout} data={data} edit={edit} maxCols={editing && target === 'phone' ? 2 : 6} minCol={editing && target === 'phone' ? 150 : 210} testId="dashboard" />
        </div>
        {editing && (
          <aside className="edit-panel" data-testid="edit-panel">
            <div className="seg full">
              <button className={panel === 'add' ? 'on' : ''} onClick={() => (setPanel('add'), setSelected(null))} data-testid="panel-add">
                <IconPlus size={15} /> {t('dash.panel.add')}
              </button>
              <button className={panel === 'widget' ? 'on' : ''} disabled={!sel} onClick={() => setPanel('widget')}>
                <IconEdit size={15} /> {t('dash.panel.widget')}
              </button>
              <button className={panel === 'look' ? 'on' : ''} onClick={() => setPanel('look')} data-testid="panel-look">
                <IconPalette size={15} /> {t('dash.panel.look')}
              </button>
            </div>
            <div className="panel-body">
              {panel === 'add' && <AddPanel target={target} layout={layout} save={save} onAdded={(id) => (setSelected(id), setPanel('widget'))} />}
              {panel === 'widget' && sel && <WidgetPanel w={sel} layout={layout} save={save} />}
              {panel === 'widget' && !sel && <p className="muted small">{t('dash.selectHint')}</p>}
              {panel === 'look' && <LookPanel />}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

/** Vollbild-Knopf – bei mehreren Bildschirmen mit Auswahl (z. B. Dashboard auf den Zweitmonitor) */
function FullscreenButton() {
  const [displays, setDisplays] = useState<Awaited<ReturnType<typeof window.api.displays>>>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    window.api.displays().then(setDisplays);
  }, []);
  const many = displays.length > 1;
  return (
    <div className="menu-wrap">
      <button
        className="btn ghost sm"
        onClick={() => (many ? setOpen(!open) : toggleFullscreen())}
        title={t('fs.tip')}
        data-testid="fs-btn"
      >
        <IconExpand size={16} />
        {t('fs.btn')}
      </button>
      {open && (
        <div className="pop-menu" onMouseLeave={() => setOpen(false)}>
          {displays.map((d) => (
            <button key={d.id} onClick={() => (setOpen(false), toggleFullscreen(d.id))}>
              <IconMonitor size={15} />
              {d.label} · {d.w}×{d.h}
              {d.current ? ` (${t('fs.here')})` : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Widget hinzufügen / Vorlagen
function AddPanel({ target, layout, save, onAdded }: { target: Target; layout: Widget[]; save: (l: Widget[]) => void; onAdded: (id: string) => void }) {
  const skin = useStore((s) => s.settings.look.skin);
  const custom = useStore((s) => !!s.settings.layout[target]);
  const add = (type: WidgetType, metric?: MetricId) => {
    const w = makeWidget(type, metric);
    save([...layout, w]);
    onAdded(w.id);
  };
  return (
    <>
      <div className="section-label">{t('dash.add.metrics')}</div>
      <div className="add-grid">
        {METRICS.map((m) => (
          <button key={m} className="add-tile" onClick={() => add('metric', m)} data-testid={`add-metric-${m}`}>
            <i style={{ background: METRIC[m].color }} />
            {t(`metric.${m}` as TKey)}
          </button>
        ))}
      </div>
      <div className="section-label">{t('dash.add.widgets')}</div>
      <div className="add-grid">
        {WIDGET_TYPES.filter((x) => x !== 'metric').map((type) => (
          <button key={type} className="add-tile" onClick={() => add(type)} data-testid={`add-${type}`}>
            <i className="neutral" />
            {t(`wtype.${type}` as TKey)}
          </button>
        ))}
      </div>
      <div className="section-label">{t('dash.presets')}</div>
      <div className="preset-list">
        {(Object.keys(PRESETS) as (keyof typeof PRESETS)[])
          .filter((p) => (target === 'phone' ? true : p !== 'phone'))
          .map((p) => (
            <button key={p} className="btn sm" onClick={() => save(structuredClone(PRESETS[p]))} data-testid={`preset-${p}`}>
              {t(`preset.${p}` as TKey)}
            </button>
          ))}
      </div>
      {custom && (
        <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => updateSettings({ layout: { [target]: null } })}>
          {t('dash.reset', { skin: t(`skin.${skin}` as TKey) })}
        </button>
      )}
      <div className="section-label">{t('dash.share')}</div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" onClick={() => window.api.exportLayout().then((ok) => ok && toast(t('dash.exported'), 'ok'))}>
          <IconDownload size={15} />
          {t('dash.export')}
        </button>
        <button
          className="btn sm"
          onClick={async () => {
            const r = await window.api.importLayout();
            if (!r) return;
            if (r.error) toast(t('dash.importError'), 'error');
            else if (r.settings) {
              useStore.setState({ settings: r.settings });
              toast(t('dash.imported'), 'ok');
            }
          }}
        >
          <IconUpload size={15} />
          {t('dash.import')}
        </button>
      </div>
      <p className="faint small">{t('dash.dragHint')}</p>
    </>
  );
}

// ------------------------------------------------------------------ Ein Widget einstellen
function WidgetPanel({ w, layout, save }: { w: Widget; layout: Widget[]; save: (l: Widget[]) => void }) {
  const patch = (p: Partial<Widget>) => save(layout.map((x) => (x.id === w.id ? { ...x, ...p } : x)));
  const COLORS = ['', '#8b5cf6', '#22d3ee', '#f472b6', '#34d399', '#fb923c', '#facc15', '#ff4d6d', '#ffffff'];
  return (
    <div data-testid="widget-panel">
      <h3 className="panel-h">{w.type === 'metric' ? t(`metric.${w.metric}` as TKey) : t(`wtype.${w.type}` as TKey)}</h3>
      {w.type === 'metric' && (
        <>
          <label className="field">
            <span>{t('dash.w.metric')}</span>
            <select className="select" value={w.metric} onChange={(e) => {
              const metric = e.target.value as MetricId;
              const styles = stylesFor(metric);
              patch({ metric, style: styles.includes(w.style as WStyle) ? w.style : styles[0] });
            }} data-testid="w-metric">
              {METRICS.map((m) => (
                <option key={m} value={m}>
                  {t(`metric.${m}` as TKey)}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>{t('dash.w.style')}</span>
            <div className="style-picks">
              {stylesFor(w.metric || 'cpu').map((st) => (
                <button key={st} className={w.style === st ? 'on' : ''} onClick={() => patch({ style: st })} data-testid={`w-style-${st}`}>
                  <StyleIcon s={st} />
                  {t(`style.${st}` as TKey)}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      <div className="field">
        <span>{t('dash.w.size')}</span>
        <div className="size-picks">
          {SIZES.map((sz) => (
            <button key={sz} className={w.size === sz ? 'on' : ''} onClick={() => patch({ size: sz as WSize })} title={t(`size.${sz}` as TKey)} data-testid={`w-size-${sz}`}>
              <SizeIcon s={sz} />
            </button>
          ))}
        </div>
      </div>
      {w.type === 'procs' && (
        <label className="field">
          <span>{t('dash.w.count')}</span>
          <input type="range" min={3} max={15} value={w.count || 5} onChange={(e) => patch({ count: Number(e.target.value) })} />
        </label>
      )}
      {w.type === 'text' ? (
        <label className="field">
          <span>{t('dash.w.text')}</span>
          <input className="input" maxLength={120} value={w.text || ''} onChange={(e) => patch({ text: e.target.value })} />
        </label>
      ) : (
        <label className="field">
          <span>{t('dash.w.title')}</span>
          <input className="input" maxLength={40} placeholder={t('dash.w.titleAuto')} value={w.title || ''} onChange={(e) => patch({ title: e.target.value || undefined })} data-testid="w-title" />
        </label>
      )}
      <div className="field">
        <span>{t('dash.w.color')}</span>
        <div className="colors">
          {COLORS.map((c) => (
            <button key={c || 'auto'} className={(w.color || '') === c ? 'on' : ''} style={{ background: c || 'conic-gradient(#8b5cf6,#22d3ee,#f472b6,#8b5cf6)' }} onClick={() => patch({ color: c || undefined })} aria-label={c || t('common.auto')} />
          ))}
        </div>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 16 }}>
        <button className="btn sm" onClick={() => save([...layout, { ...w, id: 'c' + Date.now().toString(36) }])}>
          <IconPlus size={15} />
          {t('dash.w.duplicate')}
        </button>
        <button className="btn sm danger" onClick={() => save(layout.filter((x) => x.id !== w.id))}>
          <IconTrash size={15} />
          {t('common.remove')}
        </button>
      </div>
    </div>
  );
}

function StyleIcon({ s }: { s: WStyle }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      {s === 'ring' && <path d="M6.3 17.7A8 8 0 1 1 17.7 17.7" />}
      {s === 'speedo' && (
        <>
          <path d="M4 17a8 8 0 0 1 16 0" />
          <path d="M12 17l4-5" />
        </>
      )}
      {s === 'bar' && (
        <>
          <rect x="3" y="10" width="18" height="5" rx="2.5" opacity=".35" />
          <path d="M5.5 12.5h8" strokeWidth="3" />
        </>
      )}
      {s === 'chart' && <path d="M3 17l4-5 4 3 5-7 5 4" />}
      {s === 'number' && <path d="M7 7v10M5 9l2-2M11 8a2.5 2.5 0 0 1 5 0c0 3-5 4-5 9h5" />}
    </svg>
  );
}

function SizeIcon({ s }: { s: WSize }) {
  const [w, h] = { s: [1, 1], w: [2, 1], t: [1, 2], m: [2, 2], l: [3, 2], xl: [4, 2] }[s];
  return (
    <svg viewBox="0 0 40 20" width="40" height="20" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => {
        const x = i % 4;
        const y = Math.floor(i / 4);
        return <rect key={i} x={x * 10 + 1} y={y * 10 + 1} width="8" height="8" rx="1.5" fill="currentColor" opacity={x < w && y < h ? 1 : 0.18} />;
      })}
    </svg>
  );
}

// ------------------------------------------------------------------ Aussehen
const BGS: Bg[] = ['aurora', 'nebula', 'grid', 'waves', 'carbon', 'none'];
const ACCENTS = ['', '#8b5cf6', '#22d3ee', '#ff4d6d', '#34d399', '#ff6a3d', '#facc15', '#3f63f0'];
const FONTS: Font[] = ['system', 'rounded', 'mono', 'retro'];

export function LookPanel({ compact }: { compact?: boolean }) {
  const look = useStore((s) => s.settings.look);
  const image = useStore((s) => s.image);
  const rate = useStore((s) => s.settings.app.rate);
  const liveInGame = useStore((s) => s.settings.app.liveInGame);
  const set = (p: Partial<Look>) => updateSettings({ look: p });
  return (
    <div className="look-panel" data-testid="look-panel">
      <div className="section-label">{t('look.skin')}</div>
      <div className="skin-grid">
        {SKINS.map((sk) => (
          <button key={sk} className={`skin-tile ${look.skin === sk ? 'on' : ''}`} onClick={() => set({ skin: sk as Skin })} data-testid={`skin-${sk}`}>
            <SkinPreview skin={sk as Skin} />
            <span>{t(`skin.${sk}` as TKey)}</span>
          </button>
        ))}
      </div>
      {!compact && (
        <>
          <div className="section-label">{t('look.bg')}</div>
          <div className="bg-grid">
            {BGS.map((b) => (
              <button key={b} className={`bg-tile ${look.bg === b ? 'on' : ''}`} onClick={() => set({ bg: b })} title={t(`bg.${b}` as TKey)} data-testid={`bg-${b}`}>
                <div className="dash mini" data-skin={look.skin}>
                  <div className="dash-bg" data-bg={b}>
                    {b === 'grid' && <div className="synth-grid" />}
                  </div>
                </div>
                <span>{t(`bg.${b}` as TKey)}</span>
              </button>
            ))}
            <button
              className={`bg-tile ${look.bg === 'image' ? 'on' : ''}`}
              onClick={async () => {
                if (look.bgImage && image && look.bg !== 'image') return set({ bg: 'image' });
                const r = await window.api.pickImage();
                if (r) {
                  useStore.setState({ settings: r.settings });
                  setImage(r.img);
                }
              }}
              data-testid="bg-image"
            >
              <div className="bg-img-prev" style={image ? { backgroundImage: `url("${image}")` } : undefined}>
                {!image && <IconImage size={20} />}
              </div>
              <span>{t('bg.image')}</span>
            </button>
          </div>
          {look.bgImage && (
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <button
                className="btn sm"
                onClick={async () => {
                  const r = await window.api.pickImage();
                  if (r) {
                    useStore.setState({ settings: r.settings });
                    setImage(r.img);
                  }
                }}
              >
                {t('look.otherImage')}
              </button>
              <button
                className="btn sm ghost"
                onClick={async () => {
                  useStore.setState({ settings: await window.api.removeImage() });
                  setImage(null);
                }}
              >
                {t('look.removeImage')}
              </button>
            </div>
          )}
          <Slider label={t('look.dim')} v={look.dim} min={0} max={0.9} step={0.05} onChange={(dim) => set({ dim })} />
          {look.bg === 'image' && <Slider label={t('look.blur')} v={look.blur} min={0} max={30} step={1} onChange={(blur) => set({ blur })} />}
          <div className="section-label">{t('look.accent')}</div>
          <div className="colors">
            {ACCENTS.map((c) => (
              <button key={c || 'auto'} className={look.accent === c ? 'on' : ''} style={{ background: c || 'conic-gradient(#8b5cf6,#22d3ee,#f472b6,#8b5cf6)' }} onClick={() => set({ accent: c })} aria-label={c || t('common.auto')} />
            ))}
            <label className="color-input" title={t('look.ownColor')}>
              <input type="color" value={look.accent || '#8b5cf6'} onChange={(e) => set({ accent: e.target.value })} />
            </label>
          </div>
          <Slider label={t('look.cards')} v={look.cardAlpha} min={0.2} max={1} step={0.02} onChange={(cardAlpha) => set({ cardAlpha })} />
          <Slider label={t('look.radius')} v={look.radius} min={0} max={28} step={1} onChange={(radius) => set({ radius })} />
          <label className="field">
            <span>{t('look.font')}</span>
            <select className="select" value={look.font} onChange={(e) => set({ font: e.target.value as Font })}>
              {FONTS.map((f) => (
                <option key={f} value={f}>
                  {t(`font.${f}` as TKey)}
                </option>
              ))}
            </select>
          </label>
          <div className="field row-between">
            <span>{t('look.rgb')}</span>
            <Switch on={look.rgb} onChange={(rgb) => set({ rgb })} testId="rgb-switch" />
          </div>
          <div className="section-label">{t('look.motion')}</div>
          <div className="field row-between">
            <span>{t('look.anim')}</span>
            <Switch on={look.anim} onChange={(anim) => set({ anim })} testId="anim-switch" />
          </div>
          <div className="field">
            <span>{t('look.rate')}</span>
            <Seg<string>
              value={String(rate)}
              onChange={(v) => updateSettings({ app: { rate: Number(v) } })}
              options={[
                ['1000', t('look.rate.1')],
                ['500', t('look.rate.2')],
                ['250', t('look.rate.4')],
              ]}
            />
          </div>
          <div className="field">
            <span>{t('look.decimals')}</span>
            <Seg<string>
              value={String(look.decimals)}
              onChange={(v) => set({ decimals: Number(v) })}
              options={[
                ['0', '42 %'],
                ['1', '42,3 %'],
                ['2', '42,37 %'],
              ]}
            />
          </div>
          <div className="field row-between">
            <span>{t('look.liveInGame')}</span>
            <Switch on={liveInGame} onChange={(liveInGame) => updateSettings({ app: { liveInGame } })} />
          </div>
          <p className="faint small">{t('look.animNote')}</p>
        </>
      )}
    </div>
  );
}

function Slider({ label, v, min, max, step, onChange }: { label: string; v: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const [val, setVal] = useState(v);
  useEffect(() => setVal(v), [v]);
  return (
    <label className="field">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={val} onChange={(e) => setVal(Number(e.target.value))} onPointerUp={() => onChange(val)} onKeyUp={() => onChange(val)} onBlur={() => val !== v && onChange(val)} />
    </label>
  );
}

/** Kleine Vorschau eines Skins (echte Skin-Farben, Mini-Widgets) */
export function SkinPreview({ skin }: { skin: Skin }) {
  return (
    <div className="dash mini skin-prev" data-skin={skin} data-font={skin === 'terminal' ? 'mono' : skin === 'classic' ? 'retro' : 'system'}>
      <div className="dash-bg" data-bg={skin === 'clean' || skin === 'classic' || skin === 'terminal' ? 'none' : 'aurora'} />
      <div className="sp-cards">
        <div className="card-w">
          <div className="w-title">
            <span>CPU</span>
          </div>
          <svg viewBox="0 0 100 60" className="sp-spark">
            <path d="M0 45 L20 35 L35 40 L55 18 L75 28 L100 10" fill="none" stroke="var(--c-cpu)" strokeWidth="5" />
          </svg>
        </div>
        <div className="card-w">
          <div className="w-title">
            <span>GPU</span>
          </div>
          <b className="sp-num">67%</b>
        </div>
      </div>
    </div>
  );
}

