# `src/` — currently empty by design

The Claude Design v3 ZIP ships as a mockup-style React prototype:

- React 18 is loaded as a UMD global from a CDN.
- All `.jsx` files use `React.useState` / `ReactDOM.createRoot` directly,
  with NO ES module imports. They reference each other as global symbols
  (e.g. `app.jsx` uses `Layout`, `Router`, `ToastProvider` without
  importing them).
- They are loaded via `<script type="text/babel">` tags in `index.html`,
  compiled in the browser by `@babel/standalone`.

That layout is incompatible with Vite's ESM bundler: any `import` rewrite
would mean editing every `.jsx`, which violates the "1:1 with the ZIP"
rule we set in the migration plan.

**The transplant therefore lives entirely under `public/`** — Vite serves
that dir as static root, so `<script src="/console/...">` resolves to
`public/console/...` and the design system runs unchanged.

When we later TypeScript-ify (Etapa 4 of the plan), the ports will move
from `public/console/` → `src/console/` with proper `import` rewrites.
Until then, this dir intentionally stays empty.
