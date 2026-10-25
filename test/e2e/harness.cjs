'use strict';
/**
 * Test-Fenster für den Klick-Test: zeigt die echte Oberfläche (dist/index.html) und verbindet sie – genau wie in der
 * Tauri-App – über den gesicherten WebSocket mit dem echten Kern. Electron dient hier nur als Test-Browser,
 * es ist NICHT Teil der fertigen App.
 */
const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 1360, height: 860, title: 'SlimManager', show: true, webPreferences: { contextIsolation: true, sandbox: true } });
  w.loadURL(process.env.SM_E2E_URL);
});
app.on('window-all-closed', () => app.quit());
