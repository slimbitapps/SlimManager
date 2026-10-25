/**
 * Mini-Anzeige: kleine Leiste mit Werten, immer im Vordergrund (auch über Spielen im Fenstermodus).
 * Klicks gehen durch sie hindurch.
 */
import type { Stats, MetricId } from '../shared/types';
import { METRIC } from '../shared/widgets';
import type { OverlayCfg } from '../types';
import { createApi } from '../api';

// Ecke aus der Adresse (die Hülle öffnet overlay.html?corner=tr)
(window as any).__corner = new URLSearchParams(location.search).get('corner') || 'tr';

const SHORT: Record<MetricId, string> = {
  cpu: 'CPU', ram: 'RAM', gpu: 'GPU', gpuMem: 'VRAM', cpuTemp: 'CPU°', gpuTemp: 'GPU°', netDown: '↓', netUp: '↑',
  diskRead: 'R', diskWrite: 'W', swap: 'SWAP', cpuSpeed: 'GHz', battery: 'BAT', procCount: 'PROC',
};
const COLORS: Partial<Record<MetricId, string>> = { cpu: '#a78bfa', gpu: '#22d3ee', gpuMem: '#22d3ee', ram: '#f472b6', swap: '#f472b6', cpuTemp: '#fb923c', gpuTemp: '#fb923c', netDown: '#34d399', netUp: '#a3e635' };

const style = document.createElement('style');
style.textContent = `
  html,body{margin:0;background:transparent;overflow:hidden;font-family:ui-monospace,'SF Mono','Cascadia Mono',Consolas,Menlo,monospace;-webkit-user-select:none;user-select:none}
  #ov{display:inline-flex;gap:12px;align-items:center;padding:6px 12px;border-radius:10px;background:rgba(8,8,16,.78);color:#fff;font-size:13px;font-weight:700;white-space:nowrap;border:1px solid rgba(255,255,255,.12);transform-origin:top left}
  #ov span{display:inline-flex;gap:5px;align-items:baseline}
  #ov i{font-style:normal;font-size:11px;opacity:.8}
  #ov b{font-variant-numeric:tabular-nums}
  .hot b{color:#ff4d6d}
`;
document.head.appendChild(style);
const el = document.getElementById('ov')!;
let cfg: OverlayCfg | null = null;
let last: Stats | null = null;
let lastSize = '';
const locale = navigator.language;

function render() {
  if (!cfg || !last) return;
  el.style.opacity = String(cfg.opacity);
  el.style.transform = `scale(${cfg.scale})`;
  el.innerHTML = cfg.metrics
    .map((m) => {
      const info = METRIC[m];
      const v = info.value(last!);
      const hot = info.warn && v !== null && v >= info.warn[1];
      return `<span class="${hot ? 'hot' : ''}"><i style="color:${COLORS[m] || '#cbd5e1'}">${SHORT[m]}</i><b>${info.fmt(v, locale).replace(' ', '')}</b></span>`;
    })
    .join('');
  // Fenstergröße an den Inhalt anpassen (nur wenn sie sich ändert)
  const r = el.getBoundingClientRect();
  const size = `${Math.ceil(r.width) + 2}x${Math.ceil(r.height) + 2}`;
  if (size !== lastSize) {
    lastSize = size;
    window.api.overlaySize(Math.ceil(r.width) + 2, Math.ceil(r.height) + 2);
  }
}

(window.api ? Promise.resolve(window.api) : createApi('overlay')).then((api) => {
  if (window.api !== api) window.api = api;
  // Ecke geändert → neu positionieren
  (window as any).__setCorner = (c: string) => {
    (window as any).__corner = c;
    lastSize = '';
    render();
  };
  api.overlayConfig().then((c) => {
    cfg = c;
    render();
  });
  api.on('overlay:config', (c: OverlayCfg) => {
    cfg = c;
    (window as any).__corner = c.corner;
    lastSize = '';
    render();
  });
  api.on('stats', (s: Stats) => {
    last = s;
    render();
  });
});
