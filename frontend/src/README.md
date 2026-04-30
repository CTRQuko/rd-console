# `frontend/src/` — ESM TypeScript app

The rd-console frontend is a single-page React 18 app, bundled by
Vite, written in TypeScript. Vite serves the dev server on `:5173`
with HMR; `npm run build` produces an optimised bundle in `dist/`.

## Layout

```
src/
├── main.tsx              Entry point. Mounts <App/> into #root.
├── App.tsx               Wraps Layout in ToastProvider + ErrorBoundary.
├── components/
│   ├── Icon.tsx          Inline lucide-style stroke icon set.
│   └── primitives.tsx    Tag/Drawer/Modal/ConfirmDialog/PageHeader/etc.
├── shell/
│   ├── Layout.tsx        Sidebar + Topbar + Router + auth gate.
│   ├── Sidebar.tsx       Left nav rail, polls real device count.
│   ├── Topbar.tsx        Breadcrumbs + ⌘K trigger + bell + user pill.
│   ├── Popover.tsx       Generic anchored popover.
│   ├── NotificationsPopover.tsx  Bell dropdown.
│   ├── UserMenuPopover.tsx       Avatar dropdown.
│   ├── CommandPalette.tsx        ⌘K / Ctrl+K.
│   ├── Router.tsx        route → page resolver.
│   ├── nav.ts            NAV catalogue + breadcrumb titles.
│   ├── theme.ts          useThemeState + accent palette.
│   ├── identity.ts       meInitials + ROLE_LABEL_ES.
│   └── auth.ts           readAuthToken / clearAuthToken.
└── pages/
    ├── Login.tsx
    ├── Dashboard.tsx     + DashboardEdit.tsx (widget editor)
    ├── Devices.tsx
    ├── Users.tsx
    ├── Logs.tsx
    ├── JoinTokens.tsx
    ├── AddressBook.tsx
    └── Settings.tsx
```

CSS lives in `public/` (Vite serves it statically) and is loaded
via `<link>` tags from `index.html`:

- `public/design/{tokens,components,layout}.css` — design system.
- `public/console/{shell,pages}.css` — page-level adjustments.
- `public/colors_and_type.css` + `public/fonts/` — typography.

## History — how we got here

The first three iterations transplanted the original ZIP design system
1:1, including its house style: every `.jsx` referenced React/ReactDOM
as window globals (no imports), and `index.html` loaded each file
through `<script type="text/babel">` with `@babel/standalone` doing the
transform in the browser. That kept the ZIP as the source of truth at
the cost of a 5 s cold load and an in-browser transformer warning.

Etapa 4 (PR 1-5) ported every `.jsx` to a typed ESM module under
`src/`, dropped the CDN trio (React UMD, ReactDOM UMD, Babel
standalone), and wired Vite's native `@vitejs/plugin-react` for both
dev and prod. The bundle dropped from ~600 KB raw + Babel runtime to
~360 KB raw / 100 KB gzipped, HMR works, and tests can stub React
the same way every other React app does.

`// @ts-nocheck` lived at the top of each ported page during the
mechanical port. That was the cheap way to land the move without
typing 9k lines of legacy JSX in one go. The follow-up has been
tightening types page by page:

- Typed: `Login.tsx`, `DashboardEdit.tsx`, `AddressBook.tsx`,
  `Logs.tsx`, `JoinTokens.tsx`, `Users.tsx`.
- Still on `@ts-nocheck`: `Dashboard.tsx`, `Devices.tsx`,
  `Settings.tsx`. Each removes ~100 implicit-`any` errors at once
  because of how dense the page is — they'll land in their own
  dedicated PRs (Dashboard's deferral comment in the file lists the
  recommended decomposition: Donut/PopHead/PopFoot/CoreBars first,
  then MetricCard, then the chart components, then the page).

Pages that consume the typed page exports (e.g. `DashboardPage`
imports `WidgetLayout` from `DashboardEdit`) are wired through
properly typed boundaries so the future `@ts-nocheck` removals don't
shake everything else.

## Common edits

- New page → drop a `.tsx` under `src/pages/` and route it from
  `src/shell/Router.tsx`.
- New top-level nav item → add it to `NAV` in `src/shell/nav.ts`
  and the breadcrumb titles map in the same file.
- Shared widget → add to `src/components/primitives.tsx` and export it.
- Persist a filter in the URL hash → copy the
  `_readFiltersFromHash` / `_writeFiltersToHash` pair from
  `pages/Logs.tsx` (or its smaller cousin in `pages/Users.tsx`).
  Initialise state from the reader, sync with `replaceState` from a
  `useEffect`. Default values get stripped from the URL so a clean
  state stays as `#/<page>` rather than `#/<page>?range=7d&…`.
- Paginate a list → see `pages/Logs.tsx` `loadMore`. The pattern is
  "ask for `?offset=&limit=` from the backend, append to local
  state, dedupe by id, expose a 'Cargar N más' button below the
  table."

## Hidden gotchas

- **Vite optimizeDeps cache**: if the dev server starts behaving
  weirdly after changing dependencies, `rm -rf node_modules/.vite`.
  Stale pre-bundles caused "Invalid hook call" loops during the
  Etapa 4 migration.
- **React.X direct refs**: a few components reach for
  `React.useRef`/`React.Children` directly (legacy carry-over).
  They rely on the `import * as React from "react"` line at the top
  of those files. Do not strip that import without re-running the
  page.
