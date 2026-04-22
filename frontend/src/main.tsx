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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
