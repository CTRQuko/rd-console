import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Tailwind base + @font-face for Inter/InterDisplay + shadcn CSS vars.
import './index.css';
// Design-system CSS custom properties (colors, sizes, radii, motion).
import './design/tokens.css';
// Plain-CSS component styles (rd-* classes used by src/components/*).
import './design/components.css';
// App layout + page-level CSS (sidebar, topbar, settings sections, join).
import './design/layout.css';

import App from './App';

// Pre-hydration apply of saved appearance prefs. Runs before React mounts
// so the first paint already has the right accent/density/radius/font-
// scale — no flash of default tokens while React spins up. Failures are
// silently ignored: defaults baked in index.css are safe.
(() => {
  try {
    const raw = localStorage.getItem('rd:prefs');
    if (!raw) return;
    const p = JSON.parse(raw);
    const html = document.documentElement;
    if (typeof p.accent === 'string') html.setAttribute('data-accent', p.accent);
    if (typeof p.fontScale === 'number') {
      html.style.setProperty('--rd-font-scale', String(p.fontScale));
    }
    // density / radius / sidebarStyle were shipped in earlier prefs
    // versions but removed. Older localStorage blobs carry them;
    // prefsStore.readInitial ignores them and applyPrefsToDom strips
    // any dangling attributes. Skip silently here too.
  } catch {
    /* ignore — defaults apply */
  }
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
