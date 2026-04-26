# rd-console — Backend contract & implementation guide

> **Audiencia:** este documento está pensado para que un LLM de codificación (p. ej. Claude Code) implemente el backend partiendo del mockup del frontend (`Console Mockup.html` + `console/pages/*.jsx`). Cada sección describe **qué pantalla lo consume**, **qué endpoint hace falta**, **payloads exactos** (con ejemplos), **reglas de negocio**, **errores** y **eventos de auditoría**. Cuando una sección dice "Frontend: `archivo.jsx:línea`" eso es el sitio donde abrir el editor para confirmar el shape esperado.
>
> **Stack sugerido**: FastAPI 0.110+, SQLAlchemy 2.x, PostgreSQL 14+, Redis (sesiones / WS pub-sub), argon2id (passwords), ULIDs (`python-ulid`), `python-jose` (JWT). El mockup no impone stack, pero los nombres siguen estas convenciones.

---

## Índice

0. [Convenciones globales](#0--convenciones-globales)
1. [Auth & sesión](#1--auth--sesion)
2. [Dashboard — métricas en vivo](#2--dashboard--metricas-en-vivo)
3. [Dashboard — layout editable (NUEVO)](#3--dashboard--layout-editable-nuevo)
4. [Devices](#4--devices)
5. [Tags (sistema transversal)](#5--tags-sistema-transversal)
6. [Address Book](#6--address-book)
7. [Invitaciones (Join Tokens)](#7--invitaciones-join-tokens)
8. [Settings → Servidor](#8--settings--servidor)
9. [Settings → Usuarios](#9--settings--usuarios)
10. [Settings → Roles & permisos (NUEVO)](#10--settings--roles--permisos-nuevo)
11. [Settings → Seguridad → Tokens API](#11--settings--seguridad--tokens-api)
12. [Settings → Seguridad → Auditoría](#12--settings--seguridad--auditoria)
13. [Settings → Actualizaciones (NUEVO)](#13--settings--actualizaciones-nuevo)
14. [Logs operacionales (sesiones de relay)](#14--logs-operacionales)
15. [Notificaciones](#15--notificaciones)
16. [Búsqueda global / Command palette (NUEVO)](#16--busqueda-global--command-palette-nuevo)
17. [Preferencias del operador](#17--preferencias-del-operador)
18. [WebSockets — resumen y reconexión](#18--websockets)
19. [Catálogo de eventos de auditoría](#19--catalogo-de-eventos-de-auditoria)
20. [Rate limiting & CORS](#20--rate-limiting--cors)

---

## 0 · Convenciones globales

### Rutas y formato

- **Base URL:** `/api/v1`. Todo va bajo este prefijo.
- **Auth:** header `Authorization: Bearer <token>`. Las rutas `/auth/login`, `/auth/forgot` y `/health` son públicas.
- **Content-Type:** `application/json; charset=utf-8` salvo subida de ficheros (`multipart/form-data`).
- **IDs:** ULIDs en formato string (26 chars Crockford base32). Si prefieres UUIDv7, también vale; el frontend los trata como strings opacos.
- **Timestamps:** ISO 8601 UTC con `Z` (ej. `"2025-01-14T12:42:08.123Z"`). El frontend renderiza relativo (`hace 5 min`) — el backend solo manda absolutos.
- **Paginación:** query params `page` (1-indexed) + `size` (default 25, max 200). Respuesta:
  ```json
  { "rows": [...], "page": 1, "size": 25, "total": 142, "has_more": true }
  ```

### Envelope de error (TIPADO — usar en todas las rutas)

```ts
type ErrorResponse = {
  error: {
    code: string;            // identificador estable (ver tabla §0.1)
    message: string;         // string humano en EN; el frontend lo localiza
    details?: Record<string, unknown>;  // ej. { field: "email", reason: "format" }
    request_id: string;      // ULID — útil para grep en logs
  }
}
```

HTTP status sigue REST estándar:
- `400` — payload mal formado o validación de campo
- `401` — token ausente / expirado / inválido
- `403` — autenticado pero sin permiso (ver §10)
- `404` — recurso no existe (o no visible para el actor)
- `409` — conflicto (ej. email ya en uso)
- `422` — validación semántica (ej. password < 12 chars)
- `429` — rate limit (ver §20)
- `500` — bug de servidor; el frontend muestra "Algo falló" + `request_id`

### 0.1 · Tabla de error codes

| code | Cuándo emitirlo |
|---|---|
| `auth.invalid_credentials` | login con email/pass incorrecto |
| `auth.account_disabled` | usuario marcado `disabled` |
| `auth.token_expired` | JWT pasado de expiración |
| `auth.token_invalid` | JWT mal firmado o tampered |
| `auth.password_weak` | < 12 chars o entropía baja |
| `auth.cannot_modify_self_role` | un admin intentó cambiarse el rol (ver §9.2) |
| `validation.field_required` | falta un campo requerido (ver `details.field`) |
| `validation.field_format` | formato inválido (email, color hex, etc.) |
| `resource.not_found` | id no existe o no visible |
| `resource.conflict` | unique constraint violation |
| `permission.denied` | rol del actor no incluye el permiso (`details.required`) |
| `rate_limit.exceeded` | bucket vacío |
| `server.unavailable` | dependencia externa caída (Redis, hbbs…) |
| `server.internal` | bug |

### 0.2 · Auditoría (siempre)

Cada **mutación** (POST/PATCH/PUT/DELETE de cualquier recurso de negocio) escribe una fila en `audit_log`. Catálogo cerrado en §19. Si es ambiguo, prefiere registrar antes que omitir.

```sql
CREATE TABLE audit_log (
  id            CHAR(26) PRIMARY KEY,            -- ULID
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id      CHAR(26),                        -- NULL = system
  actor_label   TEXT NOT NULL,                   -- "alice@acme.io" | "system" | "api_token:<name>"
  action        TEXT NOT NULL,                   -- "device.updated", "user.deleted", ...
  category      TEXT NOT NULL CHECK (category IN ('auth','user','device','invite','config','session','role','token')),
  target_type   TEXT,                            -- "user" | "device" | ...
  target_id     CHAR(26),
  ip            INET,
  ua            TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'      -- diff, reason, etc.
);
CREATE INDEX ON audit_log (ts DESC);
CREATE INDEX ON audit_log (actor_id, ts DESC);
CREATE INDEX ON audit_log (category, action, ts DESC);
```

### 0.3 · Tipos compartidos

```ts
type ID        = string;            // ULID
type Timestamp = string;            // ISO 8601 UTC
type Paginated<T> = { rows: T[]; page: number; size: number; total: number; has_more: boolean };
```

---

## 1 · Auth & sesión

**Frontend:** `console/pages/Login.jsx`, user menu en `console/shell.jsx`.

### Endpoints

| Método | Ruta | Body | Respuesta | Notas |
|---|---|---|---|---|
| POST | `/auth/login` | `{ email, password, remember?: bool }` | `{ token, user, expires_at }` | Si `remember=true`, set cookie httpOnly `rd_session` con `Max-Age=30d`. Sin remember, la cookie expira al cerrar el navegador. |
| POST | `/auth/logout` | — | `204` | Invalida el token (Redis blacklist hasta su `exp`). |
| POST | `/auth/forgot` | `{ email }` | `204` | **Idempotente** — devuelve 204 incluso si el email no existe (anti enumeración). Si existe, envía email con link `/reset?token=<rt>`. |
| POST | `/auth/reset` | `{ reset_token, new_password }` | `204` | Token de un solo uso, TTL 1 h. Invalida sesiones del user. |
| GET  | `/auth/me` | — | `{ user }` | Llamado al hidratar la app. 401 si token inválido → frontend redirige a `/login`. |

### Shape de `user` en la respuesta

```ts
type AuthUser = {
  id: ID;
  email: string;
  display_name: string;
  role_id: ID;                      // referencia a §10
  role_label: string;               // nombre del rol cacheado
  permissions: string[];            // permisos efectivos del rol (ver §10), ej ["devices.read", "users.write"]
  avatar_url: string | null;
  preferences: {                    // ver §17
    theme: "light" | "dark" | "auto";
    density: "comfortable" | "compact";
    accent: string;                 // hex
    language: "es" | "en";
    default_landing: string;        // ruta inicial al login
  };
};
```

### Reglas

- Password hash: **argon2id** con `m=64MB, t=3, p=1`. Nunca guardar plaintext, nunca devolver hash.
- JWT: HS256 con secret rotado anualmente. Claims: `sub` (user_id), `iat`, `exp` (15 min sliding), `role_id`. La cookie `rd_session` lleva un refresh token de 30 d en Redis.
- Lockout: tras 5 intentos fallidos en 10 min para el mismo email **o** IP, devolver `429` durante 5 min.

### Auditoría

`auth.login`, `auth.login_failed`, `auth.logout`, `auth.password_reset_requested`, `auth.password_reset_completed`.

---

## 2 · Dashboard — métricas en vivo

**Frontend:** `console/pages/Dashboard.jsx` (lee polling), `console/pages/Dashboard.edit.jsx` (envuelve en grid editable). El bloque comentario al inicio de `Dashboard.jsx` describe los endpoints en formato técnico — esta sección lo formaliza.

### 2.1 · Métricas del relay

```
GET /system/metrics
```
Respuesta:
```json
{
  "cpu":    { "pct": 42, "load1": 0.81, "load5": 0.65, "load15": 0.5, "cores": 8, "model": "Apple M2 Pro", "ghz": 3.4 },
  "memory": { "pct": 67, "used_bytes": 11811160064, "total_bytes": 17179869184 },
  "sessions": { "active": 124, "limit": 500 },
  "network": { "in_bps": 12_500_000, "out_bps": 8_400_000, "link_capacity_bps": 1_000_000_000 },
  "uptime": { "pct_30d": 99.98, "since": "2024-12-15T08:30:00Z" },
  "totals": { "devices": 312, "users": 14 }
}
```

**Cadencia:** el frontend hace polling cada 5 s. Si activas WS (§18 `/ws/stats`), envía el mismo payload a esa frecuencia y el frontend prefiere WS si está abierto.

**Implementación:**
- CPU/RAM: `/proc/stat` + `/proc/meminfo` en Linux; `host_statistics64` + `host_processor_info` en macOS.
- Sessions activas: query a hbbs (relay RustDesk) por su API admin o DB compartida.
- `link_capacity_bps`: viene de `config.server.link_capacity_bps` (§8) — si no está, devolver `null` y el frontend pintará el chart sin línea de capacidad.

### 2.2 · Histograma de conexiones 24 h

```
GET /system/connections-24h
→ { "buckets": [12, 18, 24, ..., 31] }   // length = 24, [0] = hora UTC 00:00
```
Cadencia: refresh cada 60 s.

SQL referencia:
```sql
SELECT date_trunc('hour', ts) AS h, COUNT(*) AS n
FROM connection_events
WHERE ts >= now() - interval '24 hours'
GROUP BY h
ORDER BY h;
```
Rellena con 0 las horas vacías para que `buckets` siempre tenga 24 elementos.

### 2.3 · Throughput de red

```
GET /system/throughput?window=60m
→ { "in": int[60], "out": int[60], "max_bps": int, "link_capacity_bps": int|null }
```
- `in`/`out`: muestras 1/min, valores en bps.
- `max_bps`: pico en la ventana (para auto-escalar el chart en cliente).

### 2.4 · Uptime histórico

```
GET /system/uptime?days=30
→ { "series": float[30] }   // % uptime por día (0..100)
```
Calcular vía heartbeat probes o synthetic checks. Si un día baja del 99 %, el frontend lo pinta como degraded.

### 2.5 · Conexiones recientes

```
GET /connections/recent?limit=20
→ { "rows": [{ "from": "alice@acme", "to": "macbook-prod", "action": "connect", "ts": "...", "ip": "10.0.0.4" }] }
```
`action ∈ {"connect", "disconnect", "file_transfer", "chat"}`. Cadencia 10 s.

---

## 3 · Dashboard — layout editable (NUEVO)

**Frontend:** `console/pages/Dashboard.edit.jsx` (sistema de grid drag/resize).

El operador puede personalizar su dashboard: arrastrar widgets, redimensionarlos, ocultarlos, fijarlos. **Layout es por usuario**.

### Modelo

```ts
type WidgetLayout = {
  id: string;          // identificador del widget (catálogo cerrado, ver abajo)
  x: number;           // 0..11 — columna inicial (grid de 12 cols)
  y: number;           // 0..N  — fila (filas de 90 px alto)
  w: number;           // 1..12 — ancho en columnas
  h: number;           // 1..12 — alto en filas
  pinned?: boolean;    // si true, no es empujable por otros widgets al reorganizar
  hidden?: boolean;    // (futuro) — ocultar sin perder posición
};
```

**IDs válidos** (rechazar cualquier otro):
`metric-cpu`, `metric-ram`, `metric-sessions`, `metric-network`, `metric-uptime`, `chart-connections`, `chart-throughput`, `list-recent-connections`.

### Endpoints

| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| GET | `/dashboard/layout` | — | `{ layout: WidgetLayout[], updated_at: Timestamp }` |
| PUT | `/dashboard/layout` | `{ layout: WidgetLayout[] }` | `{ layout, updated_at }` |
| DELETE | `/dashboard/layout` | — | `204` (resetea al default → próxima GET devuelve el layout default del backend) |

### Validación

- `x + w <= 12`, `w >= 1`, `h >= 1`.
- Sin solapes: si dos widgets se pisan, `400 validation.layout_overlap` con `details: { conflict: ["id1", "id2"] }`.
- Frontend cae a localStorage si el endpoint falla (key `dashboard.layout.v2`); cuando vuelva online, hace PUT con lo guardado.

### Auditoría

No se audita (es preferencia personal, alta frecuencia, ruido). Si el operador es admin del relay, sí auditar `dashboard.layout_reset` cuando llame DELETE.

---

## 4 · Devices

**Frontend:** `console/pages/Devices.jsx` (lista + drawer).

### Modelo

```ts
type Device = {
  id: ID;
  alias: string;
  user_id: ID;
  user_label: string;        // email o display_name del owner
  os: string;                // detectado por hbbs ("Windows 11 23H2", "macOS 14.2", ...)
  os_override?: string;      // si el operador editó el SO manualmente
  version: string;           // versión del cliente RustDesk ("1.2.6")
  ip: string;                // última IP vista
  online: boolean;
  last_seen_at: Timestamp;
  notes?: string;            // markdown, max 4 KB
  tags: string[];            // referencia §5
  created_at: Timestamp;
};
```

### Endpoints

| Método | Ruta | Notas |
|---|---|---|
| GET | `/devices?q=&filter=online\|offline\|all&tag=&page=&size=` | Lista paginada. `q` busca en alias / user_label / ip. `tag` puede repetirse (`?tag=prod&tag=eu`) para AND. |
| GET | `/devices/:id` | Detalle — incluye `recent_activity` (últimos 20 eventos). |
| PATCH | `/devices/:id` | `{ alias?, notes?, os_override?, tags? }`. Solo se aceptan campos enviados. Audit: `device.updated` con `metadata.diff`. |
| DELETE | `/devices/:id` | Soft-delete (set `deleted_at`); frontend pide confirmación tipo-nombre. Audit: `device.deleted`. |
| POST | `/devices/:id/disconnect` | Llama a hbbs para forzar cierre. `204`. Audit: `device.disconnected`. Si el device ya está offline, `409 resource.conflict`. |

### `recent_activity`

```ts
type DeviceActivity = {
  ts: Timestamp;
  kind: "connect" | "disconnect" | "file_transfer" | "auth_failed";
  peer: string;        // quien conectó al device
  ip: string;
  detail?: string;     // ej. "120 MB · 3 archivos"
};
```

---

## 5 · Tags (sistema transversal)

Frontend: chips con autocompletar en Devices drawer y Address Book.

### Modelo

```ts
type Tag = {
  name: string;        // único, lowercase, [a-z0-9-_]+
  color: "violet" | "amber" | "green" | "blue" | "rose" | "slate";
  count: number;       // # de items que la usan
  scope: "device" | "user";  // separados — un tag de device no aparece en autocompletar de user
};
```

### Endpoints

| Método | Ruta | Notas |
|---|---|---|
| GET  | `/tags?scope=device\|user&q=` | Catálogo. Para autocompletar al escribir. |
| POST | `/tags` | `{ name, color?, scope }` — idempotente por `(scope, name)`. Si no hay color, asignar uno rotando la paleta. Audit: `tag.created` (solo en creación real, no en idempotente hit). |
| PATCH | `/tags/:scope/:name` | Solo `color`. |
| DELETE | `/tags/:scope/:name` | Hard delete + cascade en items que la usen. Audit: `tag.deleted` con `metadata.removed_from = N`. |

### Flujo de "tag nueva inline"

El usuario escribe en el campo de tags del drawer un tag que no existe → frontend hace `POST /tags` y a continuación `PATCH /devices/:id` con la lista actualizada. Si la creación falla, mostrar error inline y no añadirla al device.

---

## 6 · Address Book

**Frontend:** `console/pages/AddressBook.jsx`.

### Modelo

```ts
type Group = {
  id: ID;
  name: string;
  color: string;             // misma paleta que tags
  members_count: number;
  created_at: Timestamp;
};
type Contact = {
  id: ID;
  group_id: ID;
  display_name: string;
  email: string;
  devices_count: number;
  permission: "view-only" | "view-control" | "control-only";
  notes?: string;
  tags: string[];
};
```

### Endpoints

| Método | Ruta | Notas |
|---|---|---|
| GET    | `/groups` | Lista de grupos del operador (visibility según permisos). |
| POST   | `/groups` | `{ name, color }`. Audit: `group.created`. |
| PATCH  | `/groups/:id` | `{ name?, color? }`. |
| DELETE | `/groups/:id` | Si tiene miembros, requiere `?force=true` o devuelve `409 resource.conflict { details: { members: N } }`. |
| GET    | `/groups/:id/contacts` | Miembros. |
| POST   | `/groups/:id/contacts` | `{ display_name, email, permission, tags? }` |
| PATCH  | `/groups/:id/contacts/:contact_id` | Cualquier campo. |
| DELETE | `/groups/:id/contacts/:contact_id` | Quitar del grupo (no borra el user del sistema). |
| POST   | `/groups/import` | (placeholder en frontend) `multipart` con CSV `email,display_name,group,permission,tags`. Devuelve `{ imported: N, errors: [...] }`. |

---

## 7 · Invitaciones (Join Tokens)

**Frontend:** `console/pages/JoinTokens.jsx`.

Flujo: el operador crea una invitación con etiqueta + expiración → el frontend obtiene la URL y un QR → operador la comparte. **El raw_token solo se devuelve UNA VEZ** en el POST.

### Modelo

```ts
type Invite = {
  id: ID;
  name: string;                       // etiqueta humana ("Alice MacBook")
  prefix: string;                     // primeros 8 chars del token, para mostrar en lista
  expires_at: Timestamp | null;       // null = nunca
  status: "active" | "used" | "revoked" | "expired";
  used_by_device_id?: ID;
  created_by: ID;
  created_at: Timestamp;
  invite_url: string;                 // "https://relay.example/join/<token>"
};
```

### Endpoints

| Método | Ruta | Notas |
|---|---|---|
| GET    | `/invites?status=active\|all&page=` | Lista. Por defecto oculta `revoked`+`expired` salvo `?status=all`. |
| GET    | `/invites/:id` | Detalle (sin raw_token). |
| POST   | `/invites` | `{ name, expires_in_days?: number\|null }`. Devuelve **una sola vez** `{ invite, raw_token, qr_svg }`. Audit: `invite.created`. |
| POST   | `/invites/:id/revoke` | `204`. Audit: `invite.revoked`. |
| DELETE | `/invites/:id` | Hard delete (perdemos historial). Audit: `invite.deleted`. |
| GET    | `/invites/:id/qr.svg` | Re-genera el QR (mismo token, no expone raw). Útil si el cliente perdió el SVG inicial. |

### Compartir (Email/Telegram/WhatsApp)

Construido **en cliente** sobre `invite_url`. El backend NO envía mensajes:

```
mailto:?subject=...&body=<URL_ENCODED>
https://t.me/share/url?url=<URL>&text=<TEXT>
https://wa.me/?text=<URL_ENCODED>
```

(Si en el futuro queremos email server-side, añadiremos `POST /invites/:id/email { to: string[] }`.)

---

## 8 · Settings → Servidor

**Frontend:** `console/pages/Settings.jsx` panel `ServidorPanel` (~L161).

### Modelo

```ts
type ServerConfig = {
  rustdesk_host: string;             // "rustdeskserver.casaredes.cc:21116"
  panel_url: string;                 // URL pública del panel
  hbbs_pubkey: string;               // ed25519 base64
  relay_port: number;                // 21117
  stun_servers: string[];
  turn_servers: { url: string; user?: string; pass?: string }[];
  link_capacity_bps?: number;        // para chart de throughput (§2.3)
  tls?: { domain: string; expires_at: Timestamp; issuer: string };
  storage_backend: "sqlite" | "postgres" | "mysql";
  log_retention_days: number;        // default 90
};
```

### Endpoints

| Método | Ruta | Notas |
|---|---|---|
| GET  | `/config/server` | Lectura. |
| PUT  | `/config/server` | Escribe. Audit: `config.server_updated` con `metadata.diff` (objeto con campos cambiados). Tras commit, dispara reload de hbbs/hbbr (SIGHUP o restart controlado). Si el reload falla, devolver `500 server.unavailable` y revertir. |
| POST | `/config/server/tls` | `multipart` con `cert` y `key`. Validar antes de aplicar. Audit: `config.tls_updated`. |
| POST | `/config/server/test` | Body opcional `{ candidate: ServerConfig }` — valida conectividad sin guardar (ping a STUN, resolución del host, etc.). Respuesta: `{ ok: bool, checks: [{ name, ok, detail }] }`. |

---

## 9 · Settings → Usuarios

**Frontend:** `console/pages/Users.jsx` (renderizado embebido dentro de Settings).

### Modelo

```ts
type User = {
  id: ID;
  username: string;                  // login, único
  email: string | null;
  display_name: string;
  role_id: ID;                       // referencia §10
  role_label: string;                // cacheado
  status: "active" | "invited" | "disabled";
  last_active_at: Timestamp | null;
  created_at: Timestamp;
};
```

### Endpoints

| Método | Ruta | Notas |
|---|---|---|
| GET    | `/users?q=&status=&role_id=&page=` | Lista paginada. |
| GET    | `/users/:id` | Detalle. |
| POST   | `/users` | `{ username, email?, display_name, role_id, password }`. Password mínima 12 chars (validar también server-side). Audit: `user.created`. Si `email` está set, opcionalmente enviar invite link en lugar de password. |
| PATCH  | `/users/:id` | `{ email?, display_name?, role_id?, password? }`. Solo se aplica lo enviado. Si llega `password`, rotar y invalidar todas las sesiones del user (eliminar refresh tokens en Redis). Audit: `user.updated` y/o `user.password_reset` (si rotó password). |
| POST   | `/users/:id/disable` | `status="disabled"`, invalida sesiones. Audit: `user.disabled`. |
| POST   | `/users/:id/enable` | Vuelve a `active`. Audit: `user.enabled`. |
| DELETE | `/users/:id` | Body `{ confirm: "DELETE" }`. Hard delete del user, pero `audit_log.actor_id` queda apuntando a id huérfano (con `actor_label` cacheado). Devices del user pasan a `owner_id = NULL` o se borran según `?cascade=true`. Audit: `user.deleted`. |
| POST   | `/users/bulk` | `{ ids: ID[], action: "disable"\|"enable"\|"delete"\|"set_role", role_id?: ID }`. Procesa en transacción; si falla uno, no aplica ninguno. |

### 9.1 · Política de password

- Mínimo **12 chars**. Recomendado validar también que tenga ≥3 categorías (mayús, minús, número, símbolo).
- Hash: argon2id, parámetros `m=64MB, t=3, p=1`.
- Reset = nuevo password + invalida sesiones del user.
- Nunca devolver hash en ninguna respuesta.

### 9.2 · Auto-protección de rol (CRÍTICO)

El backend **debe rechazar** `PATCH /users/:self_id` si `role_id` cambia y `self_id == auth.user.id`. Error: `403 auth.cannot_modify_self_role`. El frontend ya muestra el dropdown deshabilitado, pero esto es defensa en profundidad.

Idem en `POST /users/bulk` con `action="set_role"`: filtrar el propio id antes de aplicar.

---

## 10 · Settings → Roles & permisos (NUEVO)

**Frontend:** `console/pages/Settings.jsx` `RolesPanel` (~L895). El catálogo `_ROLE_PERMS` define las áreas y permisos visibles, y `_ROLES_INIT` define dos roles built-in: `admin` y `user`.

### Modelo

```ts
type Role = {
  id: ID;
  name: string;
  description: string;
  builtin: boolean;          // si true, no editable y no eliminable
  members_count: number;     // # users con este rol
  permissions: string[];     // ej. ["devices.read", "devices.write", "users.read"]
  created_at: Timestamp;
};
```

### Catálogo de permisos

Lista cerrada que el backend **debe** validar contra. Cualquier permiso no listado en payload → `400 validation.unknown_permission`.

| Área | Permisos |
|---|---|
| Dispositivos | `devices.read`, `devices.write`, `devices.delete`, `devices.disconnect` |
| Agenda | `groups.read`, `groups.write`, `groups.delete` |
| Invitaciones | `invites.read`, `invites.create`, `invites.revoke`, `invites.delete` |
| Usuarios | `users.read`, `users.write`, `users.delete` |
| Tokens API | `tokens.read`, `tokens.create`, `tokens.revoke` |
| Logs | `logs.read`, `logs.export`, `logs.delete` |
| Ajustes | `settings.read`, `settings.write` |
| Roles | `roles.manage` |

### Endpoints

| Método | Ruta | Notas |
|---|---|---|
| GET    | `/roles` | Lista. |
| GET    | `/roles/catalog` | Devuelve áreas + permisos disponibles para construir el grid del frontend. **Estable** — el frontend hardcodea fallback. |
| POST   | `/roles` | `{ name, description, permissions: string[] }`. `builtin = false`. Audit: `role.created`. |
| PATCH  | `/roles/:id` | `{ name?, description?, permissions? }`. Si el rol es `builtin = true`, `403 permission.denied`. Audit: `role.updated` con diff. |
| POST   | `/roles/:id/duplicate` | Crea copia con `name = "<original> (copia)"`, `builtin = false`. Audit: `role.created`. |
| DELETE | `/roles/:id` | Si `builtin`, `403`. Si `members_count > 0`, requiere `?reassign_to=<role_id>` para mover los users a otro rol; si no se pasa, `409` con `details.members_count`. Audit: `role.deleted` + `role.members_reassigned`. |

### Built-ins iniciales (seed en migración)

```json
[
  {
    "id": "rol_admin", "name": "Administrador", "builtin": true,
    "permissions": ["devices.read","devices.write","devices.delete","devices.disconnect",
                    "groups.read","groups.write","groups.delete",
                    "invites.read","invites.create","invites.revoke","invites.delete",
                    "users.read","users.write","users.delete",
                    "tokens.read","tokens.create","tokens.revoke",
                    "logs.read","logs.export","logs.delete",
                    "settings.read","settings.write","roles.manage"]
  },
  {
    "id": "rol_user", "name": "Usuario", "builtin": true,
    "permissions": ["devices.read","groups.read","invites.read","logs.read"]
  }
]
```

### Enforcement

Cada endpoint declara qué permiso requiere (decorator `@requires("devices.write")` o equivalente). El middleware de auth carga `permissions` en el contexto al validar el JWT. Sin permiso → `403 permission.denied { details: { required: "devices.write" } }`.

### Auditoría

`role.created`, `role.updated`, `role.deleted`, `role.members_reassigned`, `user.role_changed` (este último ya en §9 pero mencionarlo aquí también).

---

## 11 · Settings → Seguridad → Tokens API

**Frontend:** `console/pages/Settings.jsx` panel Seguridad → Tokens.

### Modelo

```ts
type ApiToken = {
  id: ID;
  user_id: ID;
  user_label: string;
  name: string;                  // etiqueta humana
  prefix: string;                // "rdcp_UD1dz6P…" — primeros 12 chars del secret
  scopes: string[];              // subset del catálogo §10 (un token NO puede tener más permisos que su user)
  last_used_at: Timestamp | null;
  expires_at: Timestamp | null;
  created_at: Timestamp;
};
```

### Endpoints

| Método | Ruta | Notas |
|---|---|---|
| GET    | `/api-tokens` | Lista del operador. Admin con `tokens.read` ve todos. |
| POST   | `/api-tokens` | `{ name, expires_in_days?: number, scopes?: string[] }`. Si `scopes` omitido, hereda los del user. Devuelve **una sola vez** `{ token, raw_secret }`. Audit: `api_token.created`. |
| DELETE | `/api-tokens/:id` | Audit: `api_token.revoked`. |

### Uso

Header: `Authorization: Bearer rdcp_<secret>`. El secret se hashea (sha256, no necesita argon2 por su entropía) y solo se compara hash en cada request. `last_used_at` se actualiza con throttle de 60 s para no saturar la DB.

---

## 12 · Settings → Seguridad → Auditoría

**Frontend:** `console/pages/Settings.jsx` panel Auditoría (dentro de Seguridad).

| Método | Ruta | Notas |
|---|---|---|
| GET | `/audit?range=7d&category=&action=&actor_id=&q=&from=&to=&page=` | Lista paginada. `range` es atajo (`1h`, `24h`, `7d`, `30d`, `all`). `q` busca en `actor_label`, `target_id`, `metadata`. |
| GET | `/audit/actions` | Devuelve catálogo de actions disponibles + categorías. El frontend lo usa para poblar el dropdown de filtro. **Estable**. |
| GET | `/audit/export?format=csv\|ndjson&...filtros` | Stream. Headers: `Content-Disposition: attachment; filename="audit-2025-01-14.csv"`. |

---

## 13 · Settings → Actualizaciones (NUEVO)

**Frontend:** `console/pages/Settings.jsx` `UpdatesPanel` (~L744).

El panel muestra: versión instalada, canal, último check, botón "Comprobar actualizaciones", banner si hay nueva versión + botón Instalar, lista de cambios recientes.

### Modelo

```ts
type UpdateStatus = {
  current_version: string;            // "v2.4.1"
  channel: "stable" | "beta" | "nightly";
  last_checked_at: Timestamp | null;
  source: string;                     // "github.com/rustdesk/rustdesk" — configurable
  status: "uptodate" | "available" | "checking" | "error";
  available?: {
    version: string;                  // "v2.5.0"
    notes_md: string;                 // markdown
    published_at: Timestamp;
    download_size_bytes: number;
  };
  history: { version: string; published_at: Timestamp; notes_md: string }[];  // max 10
};
```

### Endpoints

| Método | Ruta | Notas |
|---|---|---|
| GET    | `/updates/status` | Lectura — usa el último check cacheado, no consulta el repo. |
| POST   | `/updates/check` | Forzar consulta al repo. Devuelve `UpdateStatus` actualizado. Si el repo no responde en 10 s, `503 server.unavailable`. Audit: `update.checked`. |
| POST   | `/updates/install` | Body `{ version: string }` — descarga + verifica firma + aplica. Respuesta inmediata `202 { job_id }`; el progreso va por WS `/ws/jobs/:job_id`. Audit: `update.install_started` y `update.install_completed`/`update.install_failed`. |
| POST   | `/updates/rollback` | Vuelve a la versión inmediatamente anterior si está cacheada. Audit: `update.rollback`. |

### Permisos

Solo `settings.write` puede llamar `check`/`install`/`rollback`. Lectura con `settings.read`.

### Implementación

- Source default: `https://api.github.com/repos/rustdesk/rustdesk/releases/latest`. Configurable en `/config/server` (campo `update_source`).
- Verificar **firma** del release antes de aplicar (la clave pública vive en el config, no en código).
- Cachear respuesta del check 30 min para no rate-limitar GitHub.

---

## 14 · Logs operacionales

**Frontend:** `console/pages/Logs.jsx`.

Distinto de §12 (auditoría de operadores): aquí van **eventos del relay** — sesiones de RustDesk, transferencias, fallos de auth, picos de throughput.

### Modelo

```ts
type SessionLog = {
  id: ID;
  ts: Timestamp;
  level: "info" | "success" | "warn" | "error";
  actor: string;            // email del usuario o device_id de origen
  action: string;           // "session.start" | "session.end" | "file.transfer" | "auth.failed" | "throughput.spike"
  target: string;           // alias del device destino
  detail: string;           // resumen humano
  bytes_in?: number;
  bytes_out?: number;
  duration_ms?: number;
  ip: string;
};
```

### Endpoints

| Método | Ruta | Notas |
|---|---|---|
| GET    | `/sessions/logs?level=&q=&action=&from=&to=&page=&size=` | Lista paginada. |
| GET    | `/sessions/logs/:id` | Detalle (drawer). Devuelve campos extra de telemetría: `client_version`, `os`, `relay_node`, `error_code` si `level=error`. |
| POST   | `/sessions/logs/bulk-delete` | `{ ids: ID[] }`. Solo `logs.delete`. Audit: `log.bulk_deleted` con `metadata.count`. |
| GET    | `/sessions/logs/export?format=csv\|ndjson&...filtros` | Stream. |

### WebSocket (opcional)

`/ws/sessions` empuja nuevos logs en vivo:
```json
{ "type": "log", "payload": <SessionLog> }
```
El frontend prepende a la lista si está en página 1, si no muestra badge "N nuevos eventos".

---

## 15 · Notificaciones

**Frontend:** topbar campana en `console/shell.jsx`.

### Modelo

```ts
type Notification = {
  id: ID;
  ts: Timestamp;
  read: boolean;
  level: "info" | "success" | "warn" | "error";
  title: string;
  body: string;
  actor?: string;
  link?: string;            // ruta interna ej. "/devices?id=dev_..."
};
```

### Endpoints

| Método | Ruta | Notas |
|---|---|---|
| GET    | `/notifications?unread_only=false&page=` | Paginada. |
| GET    | `/notifications/unread-count` | `{ count: number }` — para el badge. Cachear 30 s. |
| POST   | `/notifications/mark-read` | `{ ids: ID[] \| "all" }` |
| DELETE | `/notifications/:id` | Borrar (no archivar). |

### WS push

`/ws/notifications`:
```json
{ "type": "notification.new", "payload": <Notification> }
{ "type": "notification.read", "payload": { "id": "..." } }    // sincronización entre pestañas
```

---

## 16 · Búsqueda global / Command palette (NUEVO)

**Frontend:** `console/shell.jsx` palette abierta con `Cmd/Ctrl+K`. Busca en devices, users, settings (acciones), invites.

### Endpoint

```
GET /search?q=<text>&kinds=device,user,setting,invite,group&limit=20
```
Respuesta:
```ts
{
  results: {
    kind: "device" | "user" | "setting" | "invite" | "group" | "action";
    id: string;
    label: string;            // título mostrado
    sublabel?: string;        // segunda línea
    href: string;             // ruta interna a la que navegar
    score: number;            // 0..1, ranking
  }[];
}
```

### Reglas

- **Búsqueda fuzzy** (Postgres `pg_trgm` o similar) sobre los campos: `device.alias/user_label/ip`, `user.username/email/display_name`, `invite.name`, `group.name`.
- **kind=setting** y **kind=action** son **estáticos** (lista hardcodeada server-side de páginas y acciones del frontend, así no requiere índice). Ej: `{ kind:"setting", label:"Roles & permisos", href:"/settings/roles" }`.
- **Permisos**: filtrar resultados según `permissions` del actor — si no tiene `users.read`, no devolver users.
- **Latency target**: <100 ms p95. Cachear 60 s por query+actor.

### Auditoría

No se audita (alto volumen, bajo valor). Si hay paranoia regulatoria, añadir un sampling 1/100 de queries.

---

## 17 · Preferencias del operador

**Frontend:** localStorage por ahora; cuando exista backend persiste server-side y el localStorage queda como cache.

### Modelo

```ts
type Preferences = {
  theme: "light" | "dark" | "auto";
  density: "comfortable" | "compact";
  accent: string;                 // hex (#dc2626 default)
  language: "es" | "en";
  default_landing: string;        // ruta inicial post-login (ej. "/dashboard")
  notifications_enabled: boolean;
};
```

### Endpoints

| Método | Ruta | Notas |
|---|---|---|
| GET   | `/me/prefs` | Devuelve preferences (también en `/auth/me` al hidratar). |
| PATCH | `/me/prefs` | Solo campos enviados. Sin auditoría. |

---

## 18 · WebSockets

| Path | Mensajes | Cadencia | Frontend consumer |
|---|---|---|---|
| `/ws/stats` | `{ type:"stats", payload: <metrics> }` | 5 s | Dashboard |
| `/ws/sessions` | `{ type:"log", payload: <SessionLog> }` | en vivo | Logs |
| `/ws/notifications` | `notification.new` / `notification.read` | en vivo | Topbar campana |
| `/ws/jobs/:id` | `{ type:"progress", pct:0..100 }`, `{ type:"done"\|"failed", payload }` | en vivo | Updates install |

### Reglas de conexión

- Auth: query param `?token=<jwt>` en la primera handshake (no headers porque WebSocket en navegadores no permite headers custom).
- Reconexión: el cliente reintenta con backoff exponencial 1 s → 30 s. El servidor envía `ping` cada 25 s; cliente responde `pong`. Si no hay pong en 35 s, cierra.
- Multi-tab: cada pestaña abre su propia conexión. Para sincronizar lecturas (notificaciones marcadas leídas), usar `BroadcastChannel` en cliente o broadcast por user_id en server.

---

## 19 · Catálogo de eventos de auditoría

Lista cerrada que `/audit/actions` debe devolver. Cualquier emisor de `audit_log` debe usar exactamente estos strings.

| category | action | Quién lo emite |
|---|---|---|
| auth | `auth.login` | login OK |
| auth | `auth.login_failed` | login fail (incluso con email inexistente) |
| auth | `auth.logout` | logout explícito |
| auth | `auth.password_reset_requested` | POST /auth/forgot |
| auth | `auth.password_reset_completed` | POST /auth/reset |
| user | `user.created` / `user.updated` / `user.deleted` | endpoints §9 |
| user | `user.disabled` / `user.enabled` | §9 |
| user | `user.password_reset` | PATCH con password |
| user | `user.role_changed` | PATCH con role_id distinto |
| device | `device.updated` / `device.deleted` / `device.disconnected` | §4 |
| invite | `invite.created` / `invite.revoked` / `invite.deleted` | §7 |
| config | `config.server_updated` / `config.tls_updated` | §8 |
| role | `role.created` / `role.updated` / `role.deleted` / `role.members_reassigned` | §10 |
| token | `api_token.created` / `api_token.revoked` | §11 |
| session | `log.bulk_deleted` | §14 |
| update | `update.checked` / `update.install_started` / `update.install_completed` / `update.install_failed` / `update.rollback` | §13 |
| tag | `tag.created` / `tag.deleted` | §5 |
| group | `group.created` / `group.updated` / `group.deleted` | §6 |

---

## 20 · Rate limiting & CORS

### Rate limiting

Implementación: **bucket por (actor_id, route_group)** con Redis.

| Route group | Límite | Notas |
|---|---|---|
| `/auth/login`, `/auth/forgot` | 5/min por IP | Anti-bruteforce |
| `/auth/reset` | 3/h por IP | |
| `/search` | 60/min por user | Alto pero acotado |
| Mutaciones (POST/PATCH/DELETE) | 120/min por user | Suficiente para uso interactivo |
| Lectura general | 600/min por user | |
| `/updates/install`, `/updates/check` | 10/h global | El check externo va a GitHub |
| WS handshake | 5/min por IP | |

Header de respuesta cuando falla: `429 rate_limit.exceeded` + `Retry-After: <seconds>`.

### CORS

- Origen permitido: solo el `panel_url` configurado en `/config/server`. En desarrollo, `localhost:5173` y `127.0.0.1:5173`.
- Métodos: `GET, POST, PATCH, PUT, DELETE, OPTIONS`.
- Headers: `Authorization, Content-Type, X-Request-ID`.
- Credentials: `true` (cookies httpOnly).

---

## Changelog de este documento

- **v0.1** — primer corte: auth, devices, address book, invites, users, api tokens, server config, audit, sessions, notifications, prefs.
- **v0.2** — añadidas Roles & permisos (§10), Updates (§13), Dashboard layout editable (§3), Search global (§16), WebSockets consolidados (§18), envelope de errores tipado (§0.1), rate limiting + CORS (§20). Reescritura general orientada a LLM de codificación.
