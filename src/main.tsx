import { createRoot } from 'react-dom/client';
import './base.css';
import './shared/dashboard.css';
import './app.css';
import { App } from './App';
import { init } from './store';

init().then(() => createRoot(document.getElementById('root')!).render(<App />));
