# rd-console — frontend

React 18 + Vite + TypeScript admin panel.

> **Status:** v6 — 100+ Vitest cases, all green. Ship-ready.

## Quickstart

```bash
cd frontend
npm install
npm run dev           # http://localhost:5173
```

The dev server proxies `/api/*` and `/admin/api/*` to `http://localhost:8080`
so the SPA can hit a local backend.

For split deploys (UI and API on different hosts), set `VITE_API_BASE` at
build time:

```bash
VITE_API_BASE=https://rustdesk.casaredes.cc npm run build
# or via docker:
docker build \
  --build-arg VITE_API_BASE=https://rustdesk.casaredes.cc \
  -f ../Dockerfile.frontend \
  -t rd-console-ui:latest ..
```

Axios picks the value up in `src/lib/api.ts:resolveBaseUrl()`.

## Layout

```
frontend/src/
├── App.tsx                        routes
├── main.tsx                       entrypoint + pre-hydration prefs IIFE
├── index.css                      shadcn HSL vars + sidebar follow-theme rule
├── design/
│   ├── tokens.css                 FLAT design tokens (consumed by .rd-*)
│   ├── components.css             .rd-btn, .rd-table, .rd-stat, etc
│   └── layout.css                 sidebar, topbar, tabs, settings sections, join
├── components/                    DataTable, Dialog, Tabs, ConfirmDialog, QRCode…
├── layout/                        AppLayout + Sidebar + TopBar
├── hooks/                         React Query wrappers (useUsers, useDevices,
│                                  useJoinTokens, useLogs, useServerInfo…)
├── store/
│   ├── authStore.ts               Zustand — JWT + user, persisted
│   ├── themeStore.ts              light/dark
│   └── prefsStore.ts              accent + fontScale + sidebarStyle (v6 slim)
├── pages/                         one file per route. Tabs live under settings/
└── types/api.ts                   backend response shapes
```

## Design system notes

The repo runs TWO token systems in parallel for historical reasons:

- **`index.css` shadcn HSL** — `--primary: 221 83% 53%`, consumed only via
  Tailwind's `bg-primary` etc. No components use it today.
- **`design/tokens.css` flat hex** — `--primary: var(--blue-600)`, consumed by
  every `.rd-*` class in components.css + layout.css.

Accent customisation in Settings → Appearance overrides the FLAT tokens via
`:root[data-accent="X"]` selectors (tokens.css). Font-scale applies through
`html { font-size: calc(14px * var(--rd-font-scale, 1)) }`, and every
`font-size` in components.css + layout.css is in `rem` so the slider scales
the UI uniformly.

## Testing

```bash
npx tsc --noEmit       # types
npx vitest run         # test suite
```

Co-located `*.test.tsx` next to the component/page it covers. `test/apiMock.ts`
fakes axios with route-table dispatch (honours `validateStatus` → AxiosError
on 4xx/5xx).
