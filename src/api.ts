/**
 * Verbindung der Oberfläche zum Kern (Tauri-Version).
 * Ersetzt die frühere Electron-Brücke: Alle Befehle gehen über einen WebSocket an den Kern (nur 127.0.0.1, mit Token),
 * Fenster-Sachen (Vollbild, Bildschirme, Größe) direkt über Tauri.
 * Ohne Tauri (automatische Tests) kommen Port und Token aus der Adresse: index.html?port=…&token=…
 */
import type { Api, Settings } from './types';

type Listener = (payload: any) => void;

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function tauriWindow() {
  const m = await import('@tauri-apps/api/window');
  return m.getCurrentWindow();
}
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const m = await import('@tauri-apps/api/core');
  return m.invoke<T>(cmd, args);
}

/** Port + Token des Kerns holen (Tauri fragt die Hülle; der Kern startet evtl. noch → kurz warten) */
async function coreAddress(): Promise<{ port: number; token: string }> {
  const q = new URLSearchParams(location.search);
  if (q.get('port') && q.get('token')) return { port: Number(q.get('port')), token: q.get('token')! };
  for (let i = 0; i < 100; i++) {
    const info = isTauri() ? await tauriInvoke<{ port: number; token: string } | null>('core_info') : null;
    if (info) return info;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Kern nicht erreichbar');
}

class Rpc {
  private ws!: WebSocket;
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private listeners = new Map<string, Set<Listener>>();
  private queue: string[] = [];
  private url = '';

  async connect(role: 'main' | 'overlay') {
    const { port, token } = await coreAddress();
    this.url = `ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}&role=${role}`;
    await this.open();
  }

  private open() {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        for (const m of this.queue.splice(0)) ws.send(m);
        resolve();
      };
      ws.onerror = () => reject(new Error('Verbindung zum Kern fehlgeschlagen'));
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id !== undefined) {
          const p = this.pending.get(m.id);
          this.pending.delete(m.id);
          if (p) m.e ? p.reject(new Error(m.e)) : p.resolve(m.r);
        } else if (m.ev) this.emit(m.ev, m.p);
      };
      // Verbindung weg (z. B. Kern neu gestartet) → neu verbinden
      ws.onclose = () => setTimeout(() => this.open().catch(() => {}), 1000);
    });
  }

  call<T = any>(m: string, ...a: unknown[]): Promise<T> {
    const id = ++this.id;
    const msg = JSON.stringify({ id, m, a });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(msg);
      else this.queue.push(msg);
    });
  }

  on(ev: string, cb: Listener) {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
    this.listeners.get(ev)!.add(cb);
    return () => this.listeners.get(ev)?.delete(cb);
  }
  emit(ev: string, payload: unknown) {
    for (const cb of this.listeners.get(ev) || []) cb(payload);
  }
}

/** Bild auswählen und auf höchstens 2560 px verkleinern (läuft in der Oberfläche, kein Zusatz-Programm nötig) */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] || null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
async function shrinkImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => ((img.onload = res), (img.onerror = rej), (img.src = url)));
    const scale = Math.min(1, 2560 / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.84);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Fenster-Zustand an den Kern melden (sichtbar / vorne / Vollbild) – er misst dann passend oft */
async function reportState(rpc: Rpc) {
  let fullscreen = false;
  const send = () => rpc.call('ui:state', { visible: document.visibilityState === 'visible', focused: document.hasFocus(), fullscreen }).catch(() => {});
  addEventListener('focus', send);
  addEventListener('blur', send);
  document.addEventListener('visibilitychange', send);
  if (isTauri()) {
    const w = await tauriWindow();
    const check = async () => {
      const fs = await w.isFullscreen();
      if (fs !== fullscreen) {
        fullscreen = fs;
        rpc.emit('fullscreen', fs);
        send();
      }
    };
    await w.onResized(() => void check());
  }
  send();
}

export async function createApi(role: 'main' | 'overlay' = 'main'): Promise<Api> {
  const rpc = new Rpc();
  await rpc.connect(role);
  const info = await rpc.call<{ platform: string }>('app:info');
  if (isTauri()) document.documentElement.classList.add('tauri');
  const c =
    (m: string) =>
    (...a: unknown[]) =>
      rpc.call(m, ...a);

  const api: Api = {
    getSettings: c('settings:get') as Api['getSettings'],
    setSettings: c('settings:set') as Api['setSettings'],
    appInfo: c('app:info') as Api['appInfo'],
    sysStatic: c('sys:static') as Api['sysStatic'],
    getStats: c('stats:get') as Api['getStats'],
    watchProcs: c('procs:watch') as Api['watchProcs'],
    killGroup: c('procs:kill') as Api['killGroup'],
    killPid: c('procs:killPid') as Api['killPid'],
    prioGroup: c('procs:prio') as Api['prioGroup'],
    prioPid: c('procs:prioPid') as Api['prioPid'],
    reveal: c('procs:reveal') as Api['reveal'],
    icon: c('icon:get') as Api['icon'],
    getBoost: c('boost:get') as Api['getBoost'],
    startBoost: c('boost:start') as Api['startBoost'],
    boostCaps: c('boost:caps') as Api['boostCaps'],
    stopBoost: c('boost:stop') as Api['stopBoost'],
    getGame: c('game:get') as Api['getGame'],
    setOverlay: c('overlay:set') as Api['setOverlay'],
    overlayConfig: c('overlay:config') as Api['overlayConfig'],
    /** Mini-Anzeige: Fenster an den Inhalt anpassen und in die gewählte Ecke setzen */
    overlaySize: async (w: number, h: number) => {
      if (!isTauri()) return;
      const { LogicalSize, LogicalPosition, currentMonitor, primaryMonitor } = await import('@tauri-apps/api/window');
      const win = await tauriWindow();
      await win.setSize(new LogicalSize(w, h));
      const mon = (await primaryMonitor()) || (await currentMonitor());
      if (!mon) return;
      const sf = mon.scaleFactor;
      const area = mon.workArea || { position: mon.position, size: mon.size };
      const ax = area.position.x / sf;
      const ay = area.position.y / sf;
      const aw = area.size.width / sf;
      const ah = area.size.height / sf;
      const corner = (window as any).__corner || 'tr';
      const m = 12;
      await win.setPosition(new LogicalPosition(corner.endsWith('l') ? ax + m : ax + aw - w - m, corner.startsWith('t') ? ay + m : ay + ah - h - m));
    },
    pickImage: async () => {
      const f = await pickFile('image/*');
      if (!f) return null;
      return rpc.call<{ settings: Settings; img: string } | null>('look:setImage', await shrinkImage(f));
    },
    getImage: c('look:getImage') as Api['getImage'],
    removeImage: c('look:removeImage') as Api['removeImage'],
    exportLayout: async () => {
      const text = await rpc.call<string>('layout:exportData');
      return isTauri() ? tauriInvoke<boolean>('save_text', { name: 'SlimManager-Layout.json', contents: text }) : true;
    },
    importLayout: async () => {
      const f = await pickFile('.json,application/json');
      if (!f) return null;
      return rpc.call('layout:importData', await f.text());
    },
    remoteInfo: c('remote:info') as Api['remoteInfo'],
    newCode: c('remote:newCode') as Api['newCode'],
    disconnect: c('remote:disconnect') as Api['disconnect'],
    removeDevice: c('devices:remove') as Api['removeDevice'],
    removeAllDevices: c('devices:removeAll') as Api['removeAllDevices'],
    answerApproval: c('approval:answer') as Api['answerApproval'],
    pendingApprovals: c('approval:pending') as Api['pendingApprovals'],
    openExternal: c('shell:openExternal') as Api['openExternal'],
    copy: async (text: string) => {
      await navigator.clipboard.writeText(String(text)).catch(() => {});
    },
    setTheme: async (theme: string) => {
      if (!isTauri()) return;
      const w = await tauriWindow();
      await w.setTheme(theme === 'system' ? null : (theme as 'light' | 'dark')).catch(() => {});
    },
    log: c('app:log') as Api['log'],
    relaunch: async () => {
      if (isTauri()) await tauriInvoke('relaunch');
    },
    selfUsage: c('self:usage') as Api['selfUsage'],
    displays: async () => {
      if (!isTauri()) return [];
      const { availableMonitors, currentMonitor, primaryMonitor } = await import('@tauri-apps/api/window');
      const [all, cur, pri] = await Promise.all([availableMonitors(), currentMonitor(), primaryMonitor()]);
      return all.map((m, i) => ({
        id: m.name || String(i),
        label: m.name || `Display ${i + 1}`,
        primary: !!pri && pri.name === m.name,
        current: !!cur && cur.name === m.name,
        w: Math.round(m.size.width / m.scaleFactor),
        h: Math.round(m.size.height / m.scaleFactor),
      }));
    },
    setFullscreen: async (on: boolean, displayId?: string) => {
      if (!isTauri()) {
        rpc.emit('fullscreen', on); // Test ohne Tauri: Vollbild nur "spielen"
        return on;
      }
      const { availableMonitors, LogicalPosition } = await import('@tauri-apps/api/window');
      const w = await tauriWindow();
      if (on && displayId) {
        const target = (await availableMonitors()).find((m, i) => (m.name || String(i)) === displayId);
        if (target) {
          await w.setFullscreen(false);
          await w.setPosition(new LogicalPosition(target.position.x / target.scaleFactor + 40, target.position.y / target.scaleFactor + 40));
        }
      }
      await w.setFullscreen(on);
      return on;
    },
    gpuStatus: async () => 'webview',
    platform: info.platform,
    on: (ch, cb) => rpc.on(ch, cb),
  };
  if (role === 'main') void reportState(rpc);
  return api;
}
