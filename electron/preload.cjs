'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('api', {
  getSettings: invoke('settings:get'),
  setSettings: invoke('settings:set'),
  appInfo: invoke('app:info'),
  sysStatic: invoke('sys:static'),
  getStats: invoke('stats:get'),
  watchProcs: invoke('procs:watch'),
  killGroup: invoke('procs:kill'),
  killPid: invoke('procs:killPid'),
  prioGroup: invoke('procs:prio'),
  prioPid: invoke('procs:prioPid'),
  reveal: invoke('procs:reveal'),
  icon: invoke('icon:get'),
  getBoost: invoke('boost:get'),
  startBoost: invoke('boost:start'),
  stopBoost: invoke('boost:stop'),
  getGame: invoke('game:get'),
  setOverlay: invoke('overlay:set'),
  overlaySize: invoke('overlay:size'),
  overlayConfig: invoke('overlay:config'),
  pickImage: invoke('look:pickImage'),
  getImage: invoke('look:getImage'),
  removeImage: invoke('look:removeImage'),
  exportLayout: invoke('layout:export'),
  importLayout: invoke('layout:import'),
  remoteInfo: invoke('remote:info'),
  newCode: invoke('remote:newCode'),
  disconnect: invoke('remote:disconnect'),
  removeDevice: invoke('devices:remove'),
  removeAllDevices: invoke('devices:removeAll'),
  answerApproval: invoke('approval:answer'),
  pendingApprovals: invoke('approval:pending'),
  openExternal: invoke('shell:openExternal'),
  copy: invoke('clipboard:write'),
  setTheme: invoke('win:theme'),
  log: invoke('app:log'),
  platform: process.platform,
  on(channel, cb) {
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
});
