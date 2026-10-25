/** Gemeinsame Datentypen für PC-Fenster, Handy-Seite und Mini-Anzeige. */

export interface Disk {
  mount: string;
  label: string;
  size: number;
  used: number;
  pct: number | null;
}

export interface Stats {
  t: number;
  cpu: number | null;
  cores: (number | null)[];
  cpuSpeed: number | null;
  cpuTemp: number | null;
  ram: number | null;
  ramUsed: number | null;
  ramTotal: number | null;
  swap: number | null;
  swapUsed: number | null;
  gpu: number | null;
  gpuTemp: number | null;
  gpuMem: number | null;
  gpuMemUsed: number | null;
  gpuMemTotal: number | null;
  netDown: number | null;
  netUp: number | null;
  diskRead: number | null;
  diskWrite: number | null;
  disks: Disk[];
  battery: { pct: number | null; charging: boolean; plugged: boolean } | null;
  procCount: number | null;
  uptime: number;
}

export type History = Record<string, (number | null)[]>;

export interface SysInfo {
  cpu: string;
  cores: number;
  physicalCores: number | null;
  gpu: string;
  gpus: string[];
  os: string;
  host: string;
  ramTotal: number;
}

export type Kind = 'game' | 'app' | 'background' | 'system' | 'self';
export type Level = 'low' | 'below' | 'normal' | 'above' | 'high';

export interface ProcGroup {
  id: string;
  name: string;
  cpu: number;
  mem: number;
  count: number;
  kind: Kind;
  prio: Level;
  pids?: number[];
  path?: string;
  exe?: string;
}

export interface Proc {
  pid: number;
  ppid: number;
  name: string;
  app: string;
  cpu: number;
  mem: number;
  path: string;
  user: string;
  prio: Level;
  kind: Kind;
}

export interface BoostState {
  active: boolean;
  app?: string;
  startedAt?: number;
  auto?: boolean;
  raised?: number;
  lowered?: number;
  closed?: number;
  raiseError?: string | null;
  changed?: number;
}

export interface BoostSummary {
  app: string;
  durationMs: number;
  avgCpu: number | null;
  avgGpu: number | null;
  maxCpuTemp: number | null;
  maxGpuTemp: number | null;
  auto: boolean;
}

// ------------------------------------------------------------------ Aussehen & Layout
export type Skin = 'neon' | 'glass' | 'clean' | 'classic' | 'terminal' | 'sunset';
export type Bg = 'none' | 'aurora' | 'grid' | 'carbon' | 'waves' | 'nebula' | 'image';
export type Font = 'system' | 'rounded' | 'mono' | 'retro';

export interface Look {
  skin: Skin;
  accent: string;
  bg: Bg;
  bgImage: boolean;
  dim: number;
  blur: number;
  cardAlpha: number;
  radius: number;
  font: Font;
  rgb: boolean;
  anim: boolean;
}

export type WidgetType = 'metric' | 'cores' | 'procs' | 'clock' | 'net' | 'disks' | 'boost' | 'system' | 'battery' | 'text';
export type MetricId =
  | 'cpu' | 'ram' | 'gpu' | 'gpuMem' | 'cpuTemp' | 'gpuTemp' | 'netDown' | 'netUp' | 'diskRead' | 'diskWrite' | 'swap' | 'cpuSpeed' | 'battery' | 'procCount';
export type WStyle = 'ring' | 'bar' | 'chart' | 'number';
export type WSize = 's' | 'w' | 't' | 'm' | 'l' | 'xl';

export interface Widget {
  id: string;
  type: WidgetType;
  size: WSize;
  metric?: MetricId;
  style?: WStyle;
  count?: number;
  title?: string;
  text?: string;
  color?: string;
}
