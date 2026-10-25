import { create } from 'zustand';
import type { RemoteInfo, Settings, Prefs, Lang, ProcData, Stats, History, SysInfo, BoostState, BoostSummary } from './types';
import { setLang, t, type TKey } from './i18n';

export type View = 'dashboard' | 'processes' | 'boost' | 'phone';
type Dialog = { kind: 'settings'; tab?: string } | { kind: 'hotspot' } | null;
export interface Toast {
  id: number;
  text: string;
  kind?: 'ok' | 'error' | 'info';
}

const HISTORY_KEYS = ['cpu', 'ram', 'gpu', 'gpuMem', 'cpuTemp', 'gpuTemp', 'netDown', 'netUp', 'diskRead', 'diskWrite', 'swap'] as const;
const HISTORY_LEN = 300;

interface State {
  ready: boolean;
  settings: Settings;
  info: RemoteInfo | null;
  stats: Stats | null;
  history: History;
  sys: SysInfo | null;
  boost: BoostState;
  summary: BoostSummary | null;
  game: string | null;
  procs: ProcData | null;
  image: string | null;
  view: View;
  editing: boolean;
  editTarget: 'pc' | 'phone';
  fullscreen: boolean;
  /** flüssige Anzeige mit Zähl-Animation? (aus, solange gezockt wird) */
  lively: boolean;
  approvals: { id: string; name: string }[];
  dialog: Dialog;
  showIntro: boolean;
  toasts: Toast[];
}

export const useStore = create<State>(() => ({
  ready: false,
  settings: null as unknown as Settings,
  info: null,
  stats: null,
  history: {},
  sys: null,
  boost: { active: false },
  summary: null,
  game: null,
  procs: null,
  image: null,
  view: 'dashboard',
  editing: false,
  editTarget: 'pc',
  fullscreen: false,
  lively: true,
  approvals: [],
  dialog: null,
  showIntro: false,
  toasts: [],
}));
const set = useStore.setState;
const get = useStore.getState;

/** Sprache des Computers erraten (nur beim ersten Start) */
function guessLang(locale: string): Lang {
  const l = (locale || navigator.language || 'en').slice(0, 2).toLowerCase();
  return l === 'de' ? 'de' : 'en';
}

export function applyTheme(theme: Prefs['theme']) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  window.api.setTheme(theme);
}

let histAt = 0;
function pushHistory(s: Stats) {
  const h = get().history;
  // Verlauf im Sekundentakt, auch wenn die Anzeige schneller aktualisiert
  if (s.t - histAt < 950) return h;
  histAt = s.t;
  const next: History = {};
  for (const k of HISTORY_KEYS) {
    const arr = (h[k] || []).concat([s[k] ?? null]);
    next[k] = arr.length > HISTORY_LEN ? arr.slice(-HISTORY_LEN) : arr;
  }
  return next;
}

export async function init() {
  const [settings, info, approvals, appInfo, st, sys, boost, game, image] = await Promise.all([
    window.api.getSettings(),
    window.api.remoteInfo(),
    window.api.pendingApprovals(),
    window.api.appInfo(),
    window.api.getStats(),
    window.api.sysStatic(),
    window.api.getBoost(),
    window.api.getGame(),
    window.api.getImage(),
  ]);
  if (!settings.prefs.lang) settings.prefs.lang = guessLang(appInfo.locale);
  setLang(settings.prefs.lang as Lang);
  applyTheme(settings.prefs.theme);
  document.documentElement.classList.add('platform-' + window.api.platform);
  set({ ready: true, settings, info, approvals, stats: st.snap, history: st.history, lively: st.lively, sys, boost, game, image });
  window.api.on('lively', (lively: boolean) => set({ lively }));

  window.api.on('remote:update', (info: RemoteInfo) => set({ info }));
  window.api.on('stats', async (s: Stats) => {
    set({ stats: s, history: pushHistory(s) });
    // Infos zum PC kommen kurz nach dem Start
    if (!get().sys) set({ sys: await window.api.sysStatic() });
  });
  // Fenster war versteckt/minimiert (dann kommen keine Live-Daten) → Verlauf neu übernehmen
  window.api.on('sync', (d: { snap: Stats | null; history: History }) => set({ stats: d.snap, history: d.history }));
  window.api.on('procs', (procs: ProcData) => set({ procs }));
  window.api.on('boost', (boost: BoostState) => set({ boost }));
  window.api.on('boost-summary', (summary: BoostSummary) => set({ summary }));
  window.api.on('game', (game: string | null) => get().game !== game && set({ game }));
  window.api.on('settings', (settings: Settings) => set({ settings }));
  window.api.on('navigate', (view: View) => set({ view }));
  window.api.on('fullscreen', (fullscreen: boolean) => set({ fullscreen, view: fullscreen ? 'dashboard' : get().view, editing: fullscreen ? false : get().editing }));
  // F11 = Vollbild-Dashboard, Esc = zurück
  addEventListener('keydown', (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      toggleFullscreen();
    } else if (e.key === 'Escape' && get().fullscreen && !get().dialog) window.api.setFullscreen(false);
  });
  window.api.on('phone-action', (a: { name: string; c: string; ok: boolean }) => toast(t('toast.phone', { name: a.name, what: t(`phone.cmd.${a.c}` as TKey) }), a.ok ? 'info' : 'error'));
  window.api.on('approval', (req: { id: string; name: string }) => set({ approvals: [...get().approvals.filter((a) => a.id !== req.id), req] }));
  window.api.on('approval-done', (id: string) => set({ approvals: get().approvals.filter((a) => a.id !== id) }));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(get().settings.prefs.theme));
}

export async function updateSettings(partial: Partial<Settings> | Record<string, unknown>) {
  const s = await window.api.setSettings(partial);
  set({ settings: s });
  return s;
}

export async function updatePrefs(p: Partial<Prefs>) {
  const s = await updateSettings({ prefs: p });
  if (p.lang) setLang(p.lang as Lang);
  if (p.theme) applyTheme(s.prefs.theme);
  set({ settings: { ...s } });
}

export async function finishOnboarding() {
  await updateSettings({ onboarded: true, prefs: get().settings.prefs });
  set({ showIntro: false });
}

export function setView(view: View) {
  set({ view, editing: false });
}
export function toggleFullscreen(displayId?: string) {
  set({ view: 'dashboard', editing: false });
  return window.api.setFullscreen(!get().fullscreen || !!displayId, displayId);
}
export function setEditing(editing: boolean) {
  set({ editing, editTarget: editing ? get().editTarget : 'pc' });
}
export function setEditTarget(editTarget: 'pc' | 'phone') {
  set({ editTarget });
}
/** Von der Handy-Seite direkt in den Editor für das Handy-Layout */
export function editPhoneLayout() {
  set({ view: 'dashboard', editing: true, editTarget: 'phone' });
}
export function setImage(image: string | null) {
  set({ image });
}
export function clearSummary() {
  set({ summary: null });
}
export function openDialog(d: Dialog) {
  set({ dialog: d });
}
export function closeDialog() {
  set({ dialog: null });
}
export function showIntroAgain() {
  set({ showIntro: true, dialog: null });
}

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 3200) {
  const id = ++toastId;
  set({ toasts: [...get().toasts, { id, text, kind }].slice(-4) });
  setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== id) }), ms);
}

/** Fehlercode vom Hauptprozess → verständlicher Text */
export function errorText(code?: string) {
  const known = ['admin', 'protected', 'gone', 'no-game', 'failed', 'no-control'];
  return t(`err.${known.includes(code || '') ? code : 'failed'}` as TKey);
}
