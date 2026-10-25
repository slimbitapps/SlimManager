/**
 * Das Dashboard: Hintergrund + Raster mit Widgets im gewählten Skin.
 * PC-Fenster (mit Bearbeiten-Modus) und Handy-Seite benutzen dieselbe Komponente.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Look, Widget } from './types';
import { SPAN } from './widgets';
import { WidgetView, type WidgetData } from './WidgetView';
import { Detail, detailFor, type DetailKind } from './Detail';
import type { ProcGroup } from './types';
import { t } from '../i18n';

export interface EditProps {
  selected: string | null;
  onSelect: (id: string | null) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (id: string) => void;
}

/** Hex-Farbe → "r, g, b" für rgba() in CSS */
function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

export function lookVars(look: Look): CSSProperties {
  const v: Record<string, string | number> = {
    '--d-alpha': look.cardAlpha,
    '--d-radius': `${look.radius}px`,
    '--d-dim': look.dim,
    '--d-blur': `${look.blur}px`,
  };
  if (look.accent) {
    v['--d-accent'] = look.accent;
    v['--d-accent-rgb'] = rgb(look.accent);
  }
  return v as CSSProperties;
}

export function Backdrop({ look, image }: { look: Look; image: string | null }) {
  const bg = look.bg === 'image' && !image ? 'none' : look.bg;
  return (
    <div className="dash-bg" data-bg={bg} aria-hidden="true">
      {bg === 'image' && image && <div className="dash-img" style={{ backgroundImage: `url("${image}")` }} />}
      {bg === 'grid' && <div className="synth-grid" />}
      <div className="dash-dim" />
    </div>
  );
}

export function Dashboard({
  look, image, layout, data, edit, maxCols = 6, minCol = 200, children, testId, onDetail, onApp, onAll, onBoostTile,
}: {
  /** Detail-Ansicht geöffnet/geschlossen (damit die Prozessliste nur dann gemessen wird) */
  onDetail?: (kind: DetailKind | null) => void;
  onApp?: (g: ProcGroup) => void;
  onAll?: () => void;
  onBoostTile?: () => void;
  look: Look;
  image: string | null;
  layout: Widget[];
  data: WidgetData;
  edit?: EditProps;
  maxCols?: number;
  minCol?: number;
  children?: ReactNode;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(4);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [detail, setDetail] = useState<DetailKind | null>(null);
  const openDetail = (k: DetailKind | null) => {
    setDetail(k);
    onDetail?.(k);
  };
  // Detail-Ansicht schließen, wenn der Bearbeiten-Modus startet
  useEffect(() => {
    if (edit && detail) openDetail(null);
  }, [edit]); // eslint-disable-line react-hooks/exhaustive-deps
  // Animationen (falls eingeschaltet) anhalten, solange das Fenster nicht im Vordergrund ist
  const [paused, setPaused] = useState(() => document.visibilityState === 'hidden' || !document.hasFocus());
  useEffect(() => {
    if (!look.anim && !look.rgb) return;
    const upd = () => setPaused(document.visibilityState === 'hidden' || !document.hasFocus());
    addEventListener('focus', upd);
    addEventListener('blur', upd);
    document.addEventListener('visibilitychange', upd);
    return () => {
      removeEventListener('focus', upd);
      removeEventListener('blur', upd);
      document.removeEventListener('visibilitychange', upd);
    };
  }, [look.anim, look.rgb]);

  // Spaltenzahl passt sich der Breite an (Handy 2, großes Fenster bis 6)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCols(Math.max(2, Math.min(maxCols, Math.floor(el.clientWidth / minCol)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxCols, minCol]);

  return (
    <div
      className={`dash ${look.rgb ? 'rgb' : ''} ${look.anim ? 'anim' : ''} ${paused ? 'paused' : ''} ${edit ? 'editing' : ''}`}
      data-skin={look.skin}
      data-font={look.font}
      style={lookVars(look)}
      data-testid={testId}
    >
      <Backdrop look={look} image={image} />
      <div className="dash-scroll">
        {children}
        <div ref={ref} className="grid" style={{ '--cols': cols } as CSSProperties} onClick={(e) => edit && e.target === e.currentTarget && edit.onSelect(null)}>
          {layout.map((w, i) => {
            const [cw, ch] = SPAN[w.size];
            const style = { gridColumn: `span ${Math.min(cw, cols)}`, gridRow: `span ${ch}` };
            const target = edit ? null : detailFor(w);
            const cls = `card-w ${edit?.selected === w.id ? 'selected' : ''} ${dragOver === i && dragFrom !== i ? 'drop' : ''} ${target ? 'tappable' : ''}`;
            return (
              <div
                key={w.id}
                className={cls}
                style={style}
                data-testid={`widget-${w.id}`}
                data-type={w.type}
                draggable={!!edit}
                onClick={edit ? () => edit.onSelect(w.id) : target ? (e) => {
                  // Knöpfe in der Kachel (z. B. "Boost starten") nicht abfangen
                  if ((e.target as HTMLElement).closest('button')) return;
                  if (target === 'boost') onBoostTile?.();
                  else openDetail(target);
                } : undefined}
                onDragStart={edit ? (e) => (setDragFrom(i), e.dataTransfer.setData('text/plain', String(i)), (e.dataTransfer.effectAllowed = 'move')) : undefined}
                onDragOver={edit ? (e) => (e.preventDefault(), setDragOver(i)) : undefined}
                onDragLeave={edit ? () => setDragOver((x) => (x === i ? null : x)) : undefined}
                onDrop={
                  edit
                    ? (e) => {
                        e.preventDefault();
                        const from = dragFrom ?? Number(e.dataTransfer.getData('text/plain'));
                        if (Number.isInteger(from) && from !== i) edit.onMove(from, i);
                        setDragFrom(null);
                        setDragOver(null);
                      }
                    : undefined
                }
                onDragEnd={() => (setDragFrom(null), setDragOver(null))}
              >
                <WidgetView w={w} d={data} />
                {edit && (
                  <button
                    className="w-remove"
                    title={t('common.remove')}
                    aria-label={t('common.remove')}
                    onClick={(e) => {
                      e.stopPropagation();
                      edit.onRemove(w.id);
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
          {layout.length === 0 && <div className="dash-empty">{t('dash.empty')}</div>}
        </div>
      </div>
      {detail && <Detail kind={detail} d={data} onClose={() => openDetail(null)} onApp={onApp} onAll={onAll} />}
    </div>
  );
}
