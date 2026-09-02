import './styles/base.css';
import './styles/board.css';
import './styles/screens.css';
import './styles/victory.css';
import { App } from './app.ts';

const root = document.getElementById('app');
if (root) new App(root);

// Progressive-web-app shell: only registered for a real HTTP origin, so the
// Capacitor/file:// build and dev server are unaffected.
declare const __STANDALONE__: boolean;

const standalone = typeof __STANDALONE__ !== 'undefined' && __STANDALONE__;
if (!standalone && 'serviceWorker' in navigator && location.protocol.startsWith('http') && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(new URL('sw.js', location.href).pathname).catch(() => undefined);
  });
}
