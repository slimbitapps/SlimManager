import { createRoot } from 'react-dom/client';
import './base.css';
import './shared/dashboard.css';
import './app.css';
import { App } from './App';
import { init } from './store';
import { createApi } from './api';

// Erst mit dem Kern verbinden, dann die Oberfläche zeigen
createApi('main')
  .then((api) => {
    window.api = api;
    return init();
  })
  .then(() => createRoot(document.getElementById('root')!).render(<App />))
  .catch((e) => {
    document.body.innerHTML = `<p style="font:15px system-ui;color:#999;padding:40px">SlimManager startet nicht: ${String(e && e.message ? e.message : e)}</p>`;
  });
