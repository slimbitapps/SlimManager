/**
 * Handy-/Tablet-Seite: Live-Dashboard, Prozesse und Game Boost.
 * Läuft im normalen Browser, keine App-Installation nötig.
 */
import { createRoot } from 'react-dom/client';
import '../shared/dashboard.css';
import './remote.css';
import { Remote } from './Remote';
import { setLang } from '../i18n';

setLang(navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en');
createRoot(document.getElementById('app')!).render(<Remote />);
