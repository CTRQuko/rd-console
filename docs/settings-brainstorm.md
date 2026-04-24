# Settings — brainstorming de opciones faltantes

**Fecha:** 2026-04-24
**Target del UI:** operador de un RustDesk Server auto-alojado (homelab / SMB / IT pro)
**Objetivo:** identificar knobs útiles que hoy no existen, con prioridad y coste de implementación

Leyenda de prioridad:
- 🔴 **Must** — dolor claro del operador, base para v7–v8
- 🟠 **Nice** — petición frecuente pero no bloqueante
- 🟢 **Polish** — delight sin urgencia

Leyenda de coste:
- **FE** — frontend-only (estado local / localStorage)
- **BE** — requiere cambio de backend (modelo, endpoint, migración)
- **FE+BE** — ambas partes

---

## 1. General

Estado actual: landing page, idioma, formato fecha/hora, zona horaria.

| Opción | Qué / Por qué | Prioridad | Coste |
|---|---|---|---|
| Primer día de la semana | Domingo vs lunes — afecta calendarios futuros (picker de expiración de tokens, filtros de logs por semana) | 🟠 | FE |
| Formato de número | Separador decimal/miles (`1,234.5` vs `1.234,5`). Hoy hay contadores crudos en Dashboard/Logs que usan el default del browser | 🟠 | FE |
| Compacto/confortable en tablas | Reducir padding de filas para ver más filas de una vez — los operadores con listas largas de devices lo piden en cuanto superan 50 entradas | 🟠 | FE |
| Recordatorio de expiración de sesión | Toast 5 min antes de que caduque el JWT — evita perder formularios a medio rellenar | 🟢 | FE |
| Sonido de notificación | Ping opcional cuando entra un device nuevo online (mientras tengas la pestaña abierta) | 🟢 | FE |
| Atajos de teclado personalizables | `?` para mostrar ayuda, `g d` para ir a devices… — FE puro con Mousetrap o similar | 🟢 | FE |

---

## 2. Server

Estado actual: host ID/Relay, URL del panel, clave pública hbbs.

| Opción | Qué / Por qué | Prioridad | Coste |
|---|---|---|---|
| Puerto hbbs / hbbr explícitos | Hoy van implícitos en el host. Hay despliegues con relay en puertos no estándar (NAT con firewall corporativo) que necesitan `:21117` separado | 🔴 | FE+BE |
| STUN server hint | Campo opcional para indicar un STUN alternativo al cliente. Útil cuando el operador corre su propio STUN en la LAN | 🟠 | FE+BE |
| Límite de conexiones simultáneas | Mostrar y editar `RD_MAX_CONCURRENT_CONNECTIONS` — hoy sólo se puede cambiar con redeploy | 🟠 | FE+BE |
| Versión mínima de cliente | Forzar rechazo de clientes < X.Y por compatibilidad o por un CVE en versiones antiguas | 🟠 | BE |
| Test de conectividad al hbbs | Botón "Probar conexión" que llama a `/api/health/hbbs` para validar que el relay responde desde el panel | 🔴 | FE+BE |
| Región / etiqueta del server | Free-text para que aparezca en la página de `/join` ("Servidor EU — oficina Madrid") — útil en despliegues multi-server | 🟠 | FE+BE |
| Banner de mantenimiento | Mensaje corto que se muestra a todos los operadores (ej. "Reinicio programado domingo 10:00") | 🟢 | FE+BE |

---

## 3. Users

Estado actual: CRUD básico, disable/enable, hard delete, bulk ops, roles (admin/user).

| Opción | Qué / Por qué | Prioridad | Coste |
|---|---|---|---|
| Invitar por email | Crear usuario + enviar invite con link de primer login. Hoy tienes que crear la cuenta y pasarle la contraseña fuera de banda | 🔴 | FE+BE (SMTP) |
| Reset de contraseña de otro usuario | Como admin, generar un link de reset o setear una contraseña temporal. Hoy la única vía es hard-delete + recreate | 🔴 | FE+BE |
| Última actividad | Columna "Last active" junto a "Last login" — ayuda a detectar cuentas zombi antes de hacer limpieza | 🟠 | FE+BE (track en cada request autenticada) |
| Forzar cierre de sesión | Invalidar todos los JWT emitidos a un usuario específico (útil cuando sospechas un token filtrado) | 🔴 | FE+BE (JWT revocation list) |
| Política de expiración de contraseña | Pref global: "obligar rotación cada 90 días" | 🟢 | FE+BE |
| Tags / grupos | Agrupar usuarios por equipo u oficina — base para RBAC granular futura | 🟠 | FE+BE |
| 2FA obligatorio | Toggle global: "todos los admins deben tener 2FA activo para loguear" | 🟠 | FE+BE (depende de feature 2FA de Security) |
| Export CSV de usuarios | Auditorías externas piden la lista periódicamente — hoy toca sacarla vía API a mano | 🟢 | FE |

---

## 4. API tokens

Estado actual: CRUD de PATs por usuario, expiración fija (none/7d/30d/90d/1y).

| Opción | Qué / Por qué | Prioridad | Coste |
|---|---|---|---|
| Scopes | `read-only` vs `full` vs scopes por recurso (`devices:read`, `users:write`). Hoy un token tiene los permisos enteros de su usuario | 🔴 | FE+BE |
| IP allowlist por token | CIDR o lista de IPs desde las que el token puede usarse. Base estándar para tokens de integración | 🟠 | FE+BE |
| Contadores de uso | "Usado hace X min, Y llamadas en los últimos 7 días" — detecta tokens huérfanos o comprometidos | 🟠 | FE+BE (metrics) |
| Rotación asistida | "Rotar token": crea uno nuevo con misma config, marca el viejo como grace-period, avisa cuando deja de usarse | 🟢 | FE+BE |
| Nota / descripción | Free-text al crear ("terraform-prod", "backup-script-nas") para recordar para qué era cada uno | 🔴 | FE+BE (columna `description`) |
| Expiración custom | Input datetime en lugar de los 5 presets — operadores avanzados quieren poder fijar al milisegundo | 🟢 | FE+BE |
| Webhook on use | Callback HTTP al usar el token (opcional) para que un SIEM externo reciba eventos | 🟢 | FE+BE |

---

## 5. Appearance

Estado actual: theme (light/dark), accent (6 presets), font scale.

| Opción | Qué / Por qué | Prioridad | Coste |
|---|---|---|---|
| Logo personalizado | Upload de un PNG/SVG que reemplace el Monitor icon en sidebar + página de login. Homelab con branding propio lo pide | 🟠 | FE+BE (storage) |
| Color de acento libre | Color picker además de los 6 presets — para casar con una paleta corporativa exacta | 🟢 | FE |
| Sidebar collapsible | Toggle para colapsar sidebar a iconos solos (más espacio en laptops 13") | 🟠 | FE |
| Densidad de UI | Global: compacto / confortable — afecta paddings de cards, rows, formularios | 🟠 | FE |
| Follow system theme | "Auto" además de light/dark — sigue la preferencia del OS en tiempo real | 🟢 | FE |
| High contrast | Preset accesible que sube contraste y engrosa bordes — WCAG AAA target | 🟢 | FE |
| Favicon custom | Cuando hay logo custom, también el favicon; útil para distinguir pestañas cuando tienes varios rd-console abiertos | 🟢 | FE+BE |

---

## 6. Security

Estado actual: cambio de contraseña propia + guardrails en solo lectura.

| Opción | Qué / Por qué | Prioridad | Coste |
|---|---|---|---|
| 2FA (TOTP) | Enrolarse con Google Authenticator / 1Password / YubiKey. **Crítico** para un panel que controla acceso a máquinas remotas | 🔴 | FE+BE |
| Sesiones activas | Tabla de sesiones vivas (JWT emitidos) con IP, device, último uso — permite revocar una específica | 🔴 | FE+BE |
| Intentos de login fallidos | Listado reciente (usuario, IP, timestamp). Detecta brute-force incipiente antes de que el rate limit lo bloquee | 🔴 | FE+BE (ya existe como event en audit log, falta una vista dedicada) |
| IP allowlist para admin | CIDR que restringe a qué IPs un admin puede loguear al panel. Complemento natural al 2FA | 🟠 | FE+BE |
| Backup codes para 2FA | 10 códigos de un solo uso imprimibles por si pierdes el authenticator | 🔴 | FE+BE (depende de 2FA) |
| Política de contraseña editable | Subir mínimo a 12 caracteres, requerir símbolos… Hoy está hardcoded en 8 | 🟠 | FE+BE |
| Duración de sesión configurable | Dropdown: 1h / 8h / 24h / 7d en lugar del hardcoded 24h actual | 🟠 | FE+BE |
| Auto-logout por inactividad | Configurable (15 min / 1 h / nunca). El JWT no vale si el usuario cierra el portátil con sesión abierta | 🟠 | FE |
| Notificación de login nuevo | Email al usuario cuando se inicia sesión desde una IP/device desconocidos | 🟢 | FE+BE (SMTP) |

---

## 7. Advanced

Estado actual: export `.env` + info de build.

| Opción | Qué / Por qué | Prioridad | Coste |
|---|---|---|---|
| Import `.env` | Contrapartida del export actual — suba un `.env` para aplicar overrides en una sola operación al migrar de host | 🔴 | FE+BE |
| Backup / restore DB | Snapshot del `rd-console.db` descargable + endpoint para restaurar. Hoy hay que hacer `docker cp` a mano | 🔴 | FE+BE |
| Modo mantenimiento | Toggle que devuelve 503 en el panel y muestra el banner de "estamos arreglando cosas" durante upgrades | 🟠 | FE+BE |
| Endpoint `/metrics` Prometheus | Toggle + token protegido — operadores con Grafana casero lo enchufan sin redesplegar | 🟠 | BE |
| Healthcheck UI | Tabla con status de hbbs / hbbr / DB / disk / memoria — centraliza diagnóstico sin salir del panel | 🔴 | FE+BE |
| Logs del contenedor | Últimas N líneas de `docker logs` del propio rd-console, sin darle al operador acceso SSH al host | 🟠 | FE+BE |
| Limpieza de audit log | "Borrar eventos más antiguos que X días" — evita que la DB crezca sin control en instalaciones de años | 🟠 | FE+BE |
| Toggle de debug | `LOG_LEVEL=debug` por sesión (hora) sin redeploy — útil para troubleshooting puntual | 🟢 | FE+BE |
| Webhooks globales | URL que recibe POST en eventos del sistema (device online/offline, login fail, token created) | 🟢 | FE+BE |
| Exportar audit log | CSV/JSON filtrable, complementa el export de `.env` con el log de actividad | 🟠 | FE+BE |

---

## Transversales (no encajan en una tab concreta)

| Opción | Qué / Por qué | Prioridad | Ubicación sugerida |
|---|---|---|---|
| Wizard de bienvenida al primer login | Guided setup: fija server host, crea primer invite, revisa 2FA. Reduce drop-off en primera instalación | 🔴 | Nueva ruta `/setup` |
| Changelog in-app | Badge "Novedades" en sidebar al actualizar a una versión nueva, con un modal que resume cambios relevantes | 🟠 | Sidebar + modal |
| Health pill en topbar | Punto verde/amarillo/rojo siempre visible que resume el healthcheck. Clickable abre la vista del tab Advanced | 🔴 | Topbar global |
| Quick switcher | `Cmd/Ctrl+K` para saltar a cualquier device/usuario/token por nombre — productividad pura | 🟠 | Topbar global |

---

## Propuesta de priorización para próximos sprints

**Sprint P8 (Security + visibilidad):** 2FA, sesiones activas, intentos fallidos, healthcheck UI — el core de un panel que gestiona acceso remoto.

**Sprint P9 (Ops):** puerto hbbs/hbbr explícitos, test de conectividad, backup/restore DB, import `.env` — lo que se necesita para migrar o recuperarse sin SSH al host.

**Sprint P10 (Colaboración):** invitar por email, reset de contraseña de otro user, forzar logout, scopes en API tokens, nota en API tokens — multi-operador con garantías.

**Sprint P11 (Polish):** branding (logo/favicon custom), sidebar collapsible, densidad UI, atajos de teclado, quick switcher, wizard de bienvenida.
