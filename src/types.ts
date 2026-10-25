import type { BoostState, History, Look, MetricId, Proc, ProcGroup, Stats, SysInfo, Widget, Level, BoostMode } from './shared/types';
export type * from './shared/types';

export type Lang = 'de' | 'en';

export interface Prefs {
  lang: Lang | '';
  theme: 'light' | 'dark' | 'system';
  mode: 'simple' | 'expert';
}

export interface Device {
  id: string;
  name: string;
  added: number;
  lastSeen?: number;
}

export interface OverlayCfg {
  enabled: boolean;
  corner: 'tl' | 'tr' | 'bl' | 'br';
  metrics: MetricId[];
  opacity: number;
  scale: number;
  hotkey: boolean;
}

export interface Settings {
  version: number;
  onboarded: boolean;
  prefs: Prefs;
  look: Look;
  layout: { pc: Widget[] | null; phone: Widget[] | null };
  remote: { allowControl: boolean; approveNew: boolean; phoneLook: string };
  network: { address: string; port: number };
  boost: {
    mode: BoostMode;
    auto: boolean;
    hotkey: boolean;
    games: string[];
    exceptions: string[];
    game: { raiseGame: boolean; lowerOthers: boolean; freezeBg: boolean; freezeList: string[]; closeList: string[]; cores: boolean; power: boolean; trimRam: boolean; services: boolean };
    focus: { lowerOthers: boolean; freezeBg: boolean; freezeList: string[]; closeList: string[]; quiet: boolean; services: boolean };
  };
  overlay: OverlayCfg;
  alerts: { enabled: boolean; cpuTemp: number; gpuTemp: number; ram: number; hogs: boolean };
  app: { closeToTray: boolean; gpu: boolean; rate: number; liveInGame: boolean; autostart: boolean };
  devices: Device[];
}

export interface Address {
  name: string;
  address: string;
  kind: 'wifi' | 'ethernet' | 'hotspot' | 'iphone-hotspot' | 'other';
  score: number;
}

export interface RemoteInfo {
  url: string;
  base: string;
  qr: string;
  pin: string;
  address: Address | null;
  addresses: Address[];
  port: number;
  clients: { id: string; name: string; ip: string }[];
  devices: Device[];
  lastHit: number;
}

export interface AppInfo {
  version: string;
  electron: string;
  platform: string;
  locale: string;
}

export interface ProcData {
  flat: Proc[];
  groups: (ProcGroup & { pids: number[]; path: string; exe: string })[];
  at: number;
}

export interface Result {
  ok: boolean;
  error?: string;
}

export interface Api {
  getSettings(): Promise<Settings>;
  setSettings(p: Partial<Settings> | Record<string, unknown>): Promise<Settings>;
  appInfo(): Promise<AppInfo>;
  sysStatic(): Promise<SysInfo | null>;
  getStats(): Promise<{ snap: Stats | null; history: History; lively: boolean }>;
  watchProcs(on: boolean, level?: 'fast' | 'medium'): Promise<ProcData>;
  killGroup(id: string): Promise<Result>;
  killPid(pid: number): Promise<Result>;
  prioGroup(id: string, level: Level): Promise<Result>;
  prioPid(pid: number, level: Level): Promise<Result>;
  reveal(path: string): Promise<void>;
  icon(path: string): Promise<string | null>;
  getBoost(): Promise<BoostState>;
  startBoost(app: string, mode?: BoostMode): Promise<Result>;
  boostCaps(): Promise<{ freeze: boolean; cores: boolean; trim: boolean; power: boolean; services: boolean }>;
  stopBoost(): Promise<Result>;
  getGame(): Promise<string | null>;
  setOverlay(on: boolean): Promise<void>;
  overlaySize(w: number, h: number): Promise<void>;
  overlayConfig(): Promise<OverlayCfg>;
  pickImage(): Promise<{ settings: Settings; img: string } | null>;
  getImage(): Promise<string | null>;
  removeImage(): Promise<Settings>;
  exportLayout(): Promise<boolean>;
  importLayout(): Promise<{ settings?: Settings; error?: string } | null>;
  remoteInfo(): Promise<RemoteInfo>;
  newCode(): Promise<void>;
  disconnect(id: string): Promise<void>;
  removeDevice(id: string): Promise<void>;
  removeAllDevices(): Promise<void>;
  answerApproval(id: string, ok: boolean): Promise<void>;
  pendingApprovals(): Promise<{ id: string; name: string }[]>;
  openExternal(url: string): Promise<void>;
  copy(text: string): Promise<void>;
  setTheme(theme: string): Promise<void>;
  log(...a: unknown[]): Promise<void>;
  relaunch(): Promise<void>;
  selfUsage(): Promise<{ cpu: number; mem: number; gpu: boolean }>;
  displays(): Promise<{ id: string; label: string; primary: boolean; current: boolean; w: number; h: number }[]>;
  setFullscreen(on: boolean, displayId?: string): Promise<boolean>;
  gpuStatus(): Promise<string>;
  platform: string;
  on(channel: string, cb: (payload: any) => void): () => void;
}
