declare module '*.css';
declare module '*.png' {
  const src: string;
  export default src;
}
declare module 'nosleep.js' {
  export default class NoSleep {
    enable(): Promise<void>;
    disable(): void;
    isEnabled: boolean;
  }
}
interface Window {
  api: import('./types').Api;
}
