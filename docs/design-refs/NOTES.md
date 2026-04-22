# Design Review Notes

Tracking notes for iterating on the Claude Design output.
Drop screenshots of the generated UI in `screenshots/` and reference them by filename.

---

## 🔁 Iteration log

Formato de cada ronda: qué pediste, qué devolvió, qué falla todavía.

### Iter 1 — Primera generación
- **Fecha:** _
- **Prompt:** (el del plan `necesito-un-rust-desktop-bubbly-dragonfly.md`)
- **Resultado:** _
- **Observaciones:** _

### Iter 2 — _
- **Prompt:** _
- **Resultado:** _
- **Observaciones:** _

---

## 📋 Checklist visual — comparar con RustDesk Pro

Marcar ✅ cuando el resultado se parezca, ❌ cuando falle.

### Sidebar
- [ ] Ancho ~240px
- [ ] Fondo `bg-zinc-900` muy oscuro
- [ ] Logo arriba (icon + wordmark + version badge)
- [ ] Ítem activo: **left-border azul 3px**, NO pill completa
- [ ] Hover sutil (`bg-zinc-800`)
- [ ] Avatar + logout abajo pegado al fondo

### Dashboard
- [ ] 4 stat cards en grid
- [ ] Icono en esquina superior derecha, pequeño
- [ ] Número grande alineado a la izquierda
- [ ] Sin bordes gordos, solo shadow sutil
- [ ] Tabla "Recent Connections" debajo

### Tablas (Users / Devices / Logs)
- [ ] Densidad alta (fila ~44px)
- [ ] Texto `text-sm`
- [ ] Status dot verde con pulse suave para online
- [ ] Columna ID con botón copy al hover
- [ ] Filtros + search arriba
- [ ] Paginación abajo con selector page size

### Login
- [ ] Card centrada, fondo neutro
- [ ] Logo + wordmark encima
- [ ] Input + password + botón azul full-width
- [ ] Footer pequeño con tagline

### Join page (`/join/:token`)
- [ ] Sin sidebar (layout limpio)
- [ ] 4 CopyableField (ID, Relay, API, Key)
- [ ] Pasos numerados genéricos (sin dominios hardcodeados)
- [ ] Estado de error si token inválido

### Settings
- [ ] Secciones separadas (Server info / Config / Security)
- [ ] Read-only copyables para public key
- [ ] Toggle para self-registration
- [ ] Save button al final de cada sección

---

## 🔤 Tipografía — estado

**Self-hosted en `frontend/public/fonts/`** (no Google Fonts, no CDN).

| Familia | Tipo | Uso | Tailwind utility |
|---------|------|-----|------------------|
| `InterVariable` | Variable (1 file 100-900 + 1 italic) | Body, UI, tablas | `font-sans` (default) |
| `InterDisplay` | 18 static (9 weights × 2 styles) | Headings, page titles, stat numbers | `font-display` |

Preload en `index.html`: `InterVariable.woff2` + `InterDisplay-SemiBold.woff2` (peso más usado en headings).

Licencia: OFL — `public/fonts/Inter-LICENSE.txt`.

---

## 🎨 Paleta — verificar

| Elemento | Target | OK? |
|----------|--------|-----|
| Sidebar bg | `#18181b` (zinc-900) | [ ] |
| Sidebar active accent | `#2563eb` (blue-600) | [ ] |
| Main bg light | `#fafafa` (zinc-50) | [ ] |
| Main bg dark | `#09090b` (zinc-950) | [ ] |
| Card border | `#e4e4e7` / `#27272a` | [ ] |
| Online badge | `#22c55e` (green-500) | [ ] |
| Offline badge | `#71717a` (zinc-500) | [ ] |

---

## ⚠️ Cosas a corregir (live — añadir mientras revisas)

- _
- _
- _

---

## 🚩 Red flags — si aparecen, re-prompt inmediato

- [ ] Emojis en la UI → NO
- [ ] Gradientes en botones/cards → NO
- [ ] Border radius >= `rounded-xl` → NO
- [ ] Tipografía Comic-Sans-vibes (muy rounded, muy gorda) → NO
- [ ] Iconos que no son Lucide → NO
- [ ] Dominios reales (`casaredes.cc`, `rustdesk.com`, IPs privadas) hardcodeados → NO
- [ ] `any` en TypeScript → NO
- [ ] Colores hardcodeados en vez de variables CSS shadcn → NO
- [ ] Mocks con datos reales (nombres, emails, IPs reales) → NO

---

## 📦 Al integrar el output en el repo

Cuando Claude Design te dé el resultado final, antes de `git add`:

- [ ] Verificar que `package.json` no introduzca deps no listadas en el stack aprobado
- [ ] Verificar que respeta `tailwind.config.js` existente (no lo sobrescribe con uno incompatible)
- [ ] Verificar que `src/index.css` mantiene las variables CSS de shadcn que ya hay
- [ ] Verificar que usa el alias `@/*` (no paths relativos rotos)
- [ ] `npm run build` pasa sin errores de TypeScript
- [ ] `npm run dev` arranca y las páginas cargan con mock data
- [ ] No hay imports a ficheros que no existen
- [ ] Revisar `.env` — que NO haya valores reales commiteados

---

## 🗂️ Referencias visuales

Dejar capturas del Pro en `docs/design-refs/screenshots/pro/` para comparar:
- `pro-dashboard.png`
- `pro-users.png`
- `pro-devices.png`
- `pro-logs.png`
- `pro-settings.png`

Y capturas del output generado en `docs/design-refs/screenshots/generated/` con el mismo naming para comparación lado a lado.
