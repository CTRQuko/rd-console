// ============================================================
// Console Mockup — shell.jsx
// Sidebar (grouped nav, collapsible) + Topbar (breadcrumbs,
// command palette trigger, theme toggle, user menu) + Layout.
// Theme + density + accent persist to localStorage.
// ============================================================

const { useState: _useS, useEffect: _useE, useMemo: _useM, useCallback: _useC, useRef: _useR } = React;

// ─── Nav definition ─────────────────────────────────────
// Top-level nav. Badges are populated in <Sidebar/> from real backend
// counts — keeping the static catalogue badge-free avoids a stale "248"
// ghost lingering when the panel is loading or hits an auth error.
const NAV = [
  {
    group: "Operación",
    items: [
      { id: "dashboard",   label: "Panel",         icon: "dashboard",   path: "/dashboard" },
      { id: "devices",     label: "Dispositivos",  icon: "devices",     path: "/devices" },
      { id: "users",       label: "Usuarios",      icon: "users",       path: "/users" },
      { id: "addressbook", label: "Agenda",        icon: "addressbook", path: "/addressbook" },
      { id: "tokens",      label: "Invitaciones",  icon: "tokens",      path: "/tokens" },
      { id: "logs",        label: "Auditoría",     icon: "logs",        path: "/logs" },
    ],
  },
  {
    group: "Sistema",
    items: [
      { id: "settings",    label: "Ajustes",       icon: "settings",    path: "/settings/general" },
    ],
  },
];

// Reverse lookup helpers — given a hash, find the active item + breadcrumb.
function findActive(route) {
  const flat = NAV.flatMap((g) => g.items.map((it) => ({ ...it, group: g.group })));
  // Match longest prefix.
  const sorted = [...flat].sort((a, b) => b.path.length - a.path.length);
  return sorted.find((it) => route === it.path || route.startsWith(it.path + "/")) || flat[0];
}

// Breadcrumbs from path: split into segments, title-case, except for known IDs.
function makeCrumbs(route) {
  const segs = route.replace(/^\//, "").split("/").filter(Boolean);
  const titles = {
    dashboard: "Panel", devices: "Dispositivos", users: "Usuarios",
    addressbook: "Agenda", tokens: "Invitaciones", logs: "Auditoría",
    settings: "Ajustes",
    general: "General", servidor: "Servidor", seguridad: "Seguridad",
    usuarios: "Usuarios", updates: "Actualizaciones", login: "Iniciar sesión",
  };
  return segs.map((s) => titles[s] || s.charAt(0).toUpperCase() + s.slice(1));
}

// ─── Theme store ───────────────────────────────────────
const ACCENTS = {
  blue:   { name: "Blue",   p500: "#3b82f6", p600: "#2563eb", p700: "#1d4ed8" },
  violet: { name: "Violet", p500: "#8b5cf6", p600: "#7c3aed", p700: "#6d28d9" },
  green:  { name: "Green",  p500: "#22c55e", p600: "#16a34a", p700: "#15803d" },
  amber:  { name: "Amber",  p500: "#f59e0b", p600: "#d97706", p700: "#b45309" },
  rose:   { name: "Rose",   p500: "#f43f5e", p600: "#e11d48", p700: "#be123c" },
  slate:  { name: "Slate",  p500: "#64748b", p600: "#475569", p700: "#334155" },
};

function useThemeState(defaults) {
  const [t, setT] = _useS(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("cm-theme") || "{}");
      return { ...defaults, ...saved };
    } catch { return defaults; }
  });
  _useE(() => {
    localStorage.setItem("cm-theme", JSON.stringify(t));
    const root = document.documentElement;
    root.classList.toggle("dark", t.mode === "dark");
    root.dataset.density = t.density;
    const a = ACCENTS[t.accent] || ACCENTS.blue;
    root.style.setProperty("--blue-500", a.p500);
    root.style.setProperty("--blue-600", a.p600);
    root.style.setProperty("--blue-700", a.p700);
  }, [t]);
  return [t, setT];
}

// ─── Sidebar ────────────────────────────────────────────
function Sidebar({ active, collapsed, onToggle, onNav }) {
  // Real device count next to the "Dispositivos" label, polled every
  // 60 s. Falls back to no badge on auth/network errors so a stale "248"
  // ghost can't survive — better empty than wrong.
  const [badges, setBadges] = _useS({});
  _useE(() => {
    const token = readAuthToken();
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/admin/api/devices", {
          headers: { Authorization: "Bearer " + token },
        });
        if (!r.ok || cancelled) return;
        const list = await r.json();
        if (!cancelled) setBadges((b) => ({ ...b, devices: String(list.length) }));
      } catch {}
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <aside className="cm-side" aria-label="Navegación principal">
      <div className="cm-side__brand">
        <div className="cm-side__logo">RD</div>
        <span className="cm-side__name">rd-console</span>
      </div>
      <nav className="cm-side__nav">
        {NAV.map((group) => (
          <React.Fragment key={group.group}>
            <div className="cm-side__group">{group.group}</div>
            {group.items.map((it) => {
              const badge = badges[it.id] ?? it.badge;
              return (
              <a
                key={it.id}
                href={"#" + it.path}
                className="cm-side__item"
                aria-current={active.id === it.id ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onNav(it.path);
                }}
                title={collapsed ? it.label : undefined}
              >
                <span className="cm-side__icon"><Icon name={it.icon} /></span>
                <span className="cm-side__label">{it.label}</span>
                {badge && !collapsed && <span className="cm-side__badge">{badge}</span>}
              </a>
              );
            })}
          </React.Fragment>
        ))}
      </nav>
      <div className="cm-side__foot">
        <button className="cm-side__foot-btn" onClick={onToggle} aria-label="Colapsar sidebar">
          <Icon name="panelLeft" size={16} />
          {!collapsed && <span>Colapsar</span>}
        </button>
      </div>
    </aside>
  );
}

// ─── Popover genérico (anclado al disparador) ─────────
function Popover({ open, onClose, anchorRect, children, width = 360, align = "right" }) {
  _useE(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || !anchorRect) return null;
  const top = anchorRect.bottom + 8;
  const right = align === "right" ? Math.max(8, window.innerWidth - anchorRect.right) : undefined;
  const left = align === "left" ? anchorRect.left : undefined;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 80 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute", top, right, left, width,
          background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: 12, boxShadow: "0 16px 48px rgba(0,0,0,.22)",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Notificaciones (cableadas) ───────────────────────
// Maps the backend's notification "kind" string to an icon + tone +
// (optional) link so the topbar bell can render real audit events
// without each consumer reinventing the catalogue.
const _NOTI_PRESENTATION = {
  user_added:        { icon: "users",  level: "info",    link: "/users" },
  user_removed:      { icon: "x",      level: "warn",    link: "/users" },
  user_disabled:     { icon: "x",      level: "warn",    link: "/users" },
  login_failed:      { icon: "alert",  level: "error",   link: "/logs" },
  invite_created:    { icon: "tokens", level: "info",    link: "/tokens" },
  invite_revoked:    { icon: "tokens", level: "warn",    link: "/tokens" },
  device_removed:    { icon: "x",      level: "warn",    link: "/devices" },
  settings_changed:  { icon: "alert",  level: "info",    link: "/settings/general" },
  backup:            { icon: "check",  level: "success", link: "/settings/servidor" },
  backup_restored:   { icon: "check",  level: "success", link: "/settings/servidor" },
};

function _formatNotiWhen(iso) {
  // Compact relative formatter — matches the activity feed's tone.
  if (!iso) return "";
  const then = new Date(iso);
  const diff = Math.floor((Date.now() - then.getTime()) / 1000);
  if (diff < 60) return "ahora";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `hace ${Math.floor(diff / 86400)} d`;
  return then.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

function NotificationsPopover({ open, anchorRect, onClose, onNav, items, unreadCount, onMarkAllRead }) {
  const [tab, setTab] = _useS("all");
  // Read state is server-side: each item has an `n.read` flag computed
  // from the user's notifications_read_until_<uid> pointer.
  const visible = tab === "unread" ? items.filter((n) => !n.read) : items;
  const open_ = (n) => {
    // Single-item open just navigates. The full-feed mark-read happens
    // via the "Marcar todas leídas" button which bumps the pointer to
    // the highest visible id in one POST.
    const link = _NOTI_PRESENTATION[n.kind]?.link || "/logs";
    onNav(link);
    onClose();
  };
  const levelColor = (lv) => ({ warn: "#d97706", info: "var(--primary)", success: "#16a34a", error: "#e11d48" })[lv] || "var(--fg-muted)";

  return (
    <Popover open={open} onClose={onClose} anchorRect={anchorRect} width={400}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600, margin: 0, flex: 1 }}>Notificaciones</h3>
        {unreadCount > 0 && (
          <button onClick={onMarkAllRead} style={{ fontSize: 12, color: "var(--primary)", background: "transparent", border: "none", cursor: "pointer" }}>
            Marcar todas leídas
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 4, padding: "8px 12px 0", borderBottom: "1px solid var(--border)" }}>
        {[{ id: "all", label: `Todas (${items.length})` }, { id: "unread", label: `No leídas (${unreadCount})` }].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 12px", border: "none", background: "transparent",
              borderBottom: tab === t.id ? "2px solid var(--primary)" : "2px solid transparent",
              color: tab === t.id ? "var(--primary)" : "var(--fg-muted)",
              fontSize: 12, fontWeight: tab === t.id ? 600 : 500, cursor: "pointer", marginBottom: -1,
            }}
          >{t.label}</button>
        ))}
      </div>
      <div style={{ maxHeight: 380, overflowY: "auto" }}>
        {visible.length === 0 && (
          <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--fg-muted)", fontSize: 13 }}>
            <Icon name="check" size={28} /><div style={{ marginTop: 8 }}>Estás al día.</div>
          </div>
        )}
        {visible.map((n) => {
          const presentation = _NOTI_PRESENTATION[n.kind] || { icon: "alert", level: "info" };
          const read = !!n.read;
          return (
            <button
              key={n.id}
              onClick={() => open_(n)}
              style={{
                width: "100%", display: "flex", gap: 12, padding: "12px 16px",
                border: "none", borderBottom: "1px solid var(--border)",
                background: read ? "transparent" : "color-mix(in oklab, var(--primary) 5%, transparent)",
                textAlign: "left", cursor: "pointer", alignItems: "flex-start",
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                display: "grid", placeItems: "center",
                background: `color-mix(in oklab, ${levelColor(presentation.level)} 14%, transparent)`,
                color: levelColor(presentation.level),
              }}>
                <Icon name={presentation.icon} size={16} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontWeight: read ? 400 : 600, fontSize: 13 }}>{n.title}</span>
                  {!read && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--primary)", flexShrink: 0 }} />}
                </div>
                {n.subtitle && (
                  <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 2, lineHeight: 1.4 }}>{n.subtitle}</div>
                )}
                <div style={{ fontSize: 11, color: "var(--fg-muted)", marginTop: 4, display: "flex", gap: 8 }}>
                  {n.actor && <><span>{n.actor}</span><span>·</span></>}<span>{_formatNotiWhen(n.when)}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", textAlign: "center" }}>
        <button onClick={() => { onNav("/logs"); onClose(); }} style={{ fontSize: 12, color: "var(--fg-muted)", background: "transparent", border: "none", cursor: "pointer" }}>
          Ver todo el historial de auditoría →
        </button>
      </div>
    </Popover>
  );
}

// ─── Identity helpers ─────────────────────────────────
// Map the backend's 2-value role enum onto the human label the topbar +
// user menu show. Backend returns "admin" | "user".
const ROLE_LABEL_ES = { admin: "Administrador", user: "Usuario" };

// First letters of the displayable name (or email local part) — "Alex
// Méndez" → "AM", "admin" → "AD". Always uppercase, max 2 chars.
function meInitials(me) {
  const src = me?.email?.split("@")[0] || me?.username || "";
  const parts = String(src).replace(/[^A-Za-zÀ-ÿ0-9]+/g, " ").trim().split(/\s+/);
  const a = parts[0]?.[0] || "?";
  const b = parts[1]?.[0] || parts[0]?.[1] || "";
  return (a + b).toUpperCase().slice(0, 2) || "?";
}

// ─── User menu ───────────────────────────────────────
function UserMenuPopover({ open, anchorRect, onClose, onNav, theme, setTheme, me }) {
  const item = (icon, label, onClick, danger) => (
    <button
      onClick={() => { onClick?.(); onClose(); }}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%",
        padding: "8px 12px", border: "none", background: "transparent",
        color: danger ? "#e11d48" : "var(--fg)", fontSize: 13, textAlign: "left", cursor: "pointer",
        borderRadius: 6,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-subtle)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Icon name={icon} size={14} /> {label}
    </button>
  );
  return (
    <Popover open={open} onClose={onClose} anchorRect={anchorRect} width={280}>
      <div style={{ padding: 16, display: "flex", gap: 12, alignItems: "center", borderBottom: "1px solid var(--border)" }}>
        <div style={{
          width: 44, height: 44, borderRadius: "50%",
          background: "linear-gradient(135deg, var(--violet-500, #7c3aed), var(--blue-600, #2563eb))",
          display: "grid", placeItems: "center", color: "#fff", fontWeight: 600, fontSize: 14,
          fontFamily: "var(--font-display)",
        }}>{meInitials(me)}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{me?.username || "—"}</div>
          <div style={{ fontSize: 12, color: "var(--fg-muted)", overflow: "hidden", textOverflow: "ellipsis" }}>{me?.email || ""}</div>
          <div style={{ fontSize: 11, color: "var(--primary)", fontWeight: 500, marginTop: 2 }}>{ROLE_LABEL_ES[me?.role] || me?.role || ""}</div>
        </div>
      </div>
      <div style={{ padding: 4 }}>
        {item("user", "Mi cuenta", () => onNav("/settings/usuarios"))}
        {item("settings", "Ajustes", () => onNav("/settings/general"))}
      </div>
      <div style={{ borderTop: "1px solid var(--border)", padding: "8px 12px" }}>
        <div style={{ fontSize: 11, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Apariencia</div>
        <div style={{ display: "flex", gap: 4 }}>
          {["light", "dark"].map((m) => (
            <button
              key={m}
              onClick={() => setTheme((t) => ({ ...t, mode: m }))}
              style={{
                flex: 1, padding: "6px 8px", borderRadius: 6,
                border: "1px solid var(--border)",
                background: theme.mode === m ? "color-mix(in oklab, var(--primary) 12%, var(--card))" : "var(--card)",
                color: theme.mode === m ? "var(--primary)" : "var(--fg)",
                fontSize: 12, fontWeight: theme.mode === m ? 600 : 500, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <Icon name={m === "dark" ? "moon" : "sun"} size={12} /> {m === "dark" ? "Oscuro" : "Claro"}
            </button>
          ))}
        </div>
      </div>
      <div style={{ borderTop: "1px solid var(--border)", padding: 4 }}>
        {item("users", "Cambiar de usuario", () => {
          // Best-effort logout — wipe the local token and bounce to /login.
          // We don't await the backend POST so the UI feels instant.
          try { localStorage.removeItem("cm-auth"); } catch {}
          onNav("/login");
        })}
        {item("x", "Cerrar sesión", () => {
          try {
            const raw = localStorage.getItem("cm-auth");
            const token = raw ? JSON.parse(raw)?.token : null;
            if (token) {
              fetch("/api/auth/logout", {
                method: "POST",
                headers: { Authorization: "Bearer " + token },
              }).catch(() => {});
            }
            localStorage.removeItem("cm-auth");
          } catch {}
          onNav("/login");
        }, true)}
      </div>
    </Popover>
  );
}

// ─── Topbar ────────────────────────────────────────────
function Topbar({ crumbs, theme, setTheme, onOpenPalette, onMobileMenu, onNav }) {
  const [notiOpen, setNotiOpen] = _useS(false);
  const [userOpen, setUserOpen] = _useS(false);
  const notiRef = _useR(null);
  const userRef = _useR(null);
  const [notiRect, setNotiRect] = _useS(null);
  const [userRect, setUserRect] = _useS(null);
  const [me, setMe] = _useS(null);
  const [notiData, setNotiData] = _useS({ items: [], unread_count: 0 });

  // Hydrate the current user from the backend on mount. The Login.jsx
  // wired in Etapa 3 paso 1 stores the JWT under localStorage("cm-auth");
  // we read it here to fill the topbar identity slot. A 401 implies the
  // token expired or was revoked — wipe it and bounce the user to /login.
  _useE(() => {
    const token = readAuthToken();
    if (!token) return;
    let cancelled = false;
    fetch("/api/auth/me", { headers: { Authorization: "Bearer " + token } })
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 401) {
          try { localStorage.removeItem("cm-auth"); } catch {}
          onNav("/login");
          return;
        }
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled) setMe(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [onNav]);

  // Poll the notification feed every 60 s so the bell dot stays accurate
  // without the operator having to refresh. Skips silently on auth errors;
  // the /me hook above is the source of truth for "do we have a session".
  _useE(() => {
    const token = readAuthToken();
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/api/v1/notifications/recent?limit=20", {
          headers: { Authorization: "Bearer " + token },
        });
        if (!r.ok || cancelled) return;
        const data = await r.json();
        if (!cancelled) setNotiData(data);
      } catch {}
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // POST the highest visible id to the backend; on success we optimistically
  // flip every fetched item to read=true so the dot disappears immediately
  // (next poll will re-confirm from server).
  const markAllRead = async () => {
    const token = readAuthToken();
    if (!token || notiData.items.length === 0) return;
    const untilId = Math.max(...notiData.items.map((n) => n.id));
    try {
      await fetch("/api/v1/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ until_id: untilId }),
      });
      setNotiData((d) => ({
        items: d.items.map((n) => ({ ...n, read: true })),
        unread_count: 0,
      }));
    } catch {}
  };

  const openNoti = () => { setNotiRect(notiRef.current?.getBoundingClientRect()); setNotiOpen(true); setUserOpen(false); };
  const openUser = () => { setUserRect(userRef.current?.getBoundingClientRect()); setUserOpen(true); setNotiOpen(false); };

  return (
    <header className="cm-top">
      <button
        className="cm-top__btn"
        onClick={onMobileMenu}
        aria-label="Menú"
        style={{ display: window.innerWidth <= 900 ? "grid" : "none" }}
      >
        <Icon name="menu" />
      </button>
      <nav className="cm-top__crumbs" aria-label="Migas de pan">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            {i === crumbs.length - 1 ? <strong>{c}</strong> : <span>{c}</span>}
          </React.Fragment>
        ))}
      </nav>
      <button className="cm-top__search" onClick={onOpenPalette}>
        <Icon name="search" size={14} />
        <span style={{ flex: 1, textAlign: "left" }}>Buscar dispositivos, usuarios, ajustes…</span>
        <span className="cm-top__search-kbd">⌘K</span>
      </button>
      <div className="cm-top__actions">
        <button
          ref={notiRef}
          className="cm-top__btn"
          aria-label="Notificaciones"
          title="Notificaciones"
          onClick={openNoti}
        >
          <Icon name="bell" />
          {notiData.unread_count > 0 && <span className="dot" />}
        </button>
      </div>
      <button
        ref={userRef}
        className="cm-top__user"
        onClick={openUser}
        style={{ background: "transparent", border: "none", cursor: "pointer" }}
      >
        <div className="cm-top__avatar">{meInitials(me)}</div>
        <div className="cm-top__user-info">
          <span className="cm-top__user-name">{me?.username || "—"}</span>
          <span className="cm-top__user-role">{ROLE_LABEL_ES[me?.role] || me?.role || ""}</span>
        </div>
      </button>
      <NotificationsPopover
        open={notiOpen}
        anchorRect={notiRect}
        onClose={() => setNotiOpen(false)}
        onNav={onNav}
        items={notiData.items}
        unreadCount={notiData.unread_count}
        onMarkAllRead={markAllRead}
      />
      <UserMenuPopover open={userOpen} anchorRect={userRect} onClose={() => setUserOpen(false)} onNav={onNav} theme={theme} setTheme={setTheme} me={me} />
    </header>
  );
}

// ─── Command palette ───────────────────────────────────
function CommandPalette({ open, onClose, onNav }) {
  const [q, setQ] = _useS("");
  const [idx, setIdx] = _useS(0);
  const inputRef = _useR(null);

  const items = _useM(() => {
    const flat = NAV.flatMap((g) => g.items.map((it) => ({ ...it, group: g.group })));
    const extras = [
      { id: "settings-servidor",  label: "Ajustes · Servidor",        icon: "network",  path: "/settings/servidor",  group: "Ajustes" },
      { id: "settings-usuarios",  label: "Ajustes · Usuarios",        icon: "users",    path: "/settings/usuarios",  group: "Ajustes" },
      { id: "settings-seguridad", label: "Ajustes · Seguridad",       icon: "shield",   path: "/settings/seguridad", group: "Ajustes" },
      { id: "settings-updates",   label: "Ajustes · Actualizaciones", icon: "refresh",  path: "/settings/updates",   group: "Ajustes" },
    ];
    const all = [...flat, ...extras];
    if (!q.trim()) return all;
    const ql = q.toLowerCase();
    return all.filter((it) => it.label.toLowerCase().includes(ql) || it.group.toLowerCase().includes(ql));
  }, [q]);

  _useE(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  _useE(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, items.length - 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
      if (e.key === "Enter" && items[idx]) { onNav(items[idx].path); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, idx, onNav, onClose]);

  if (!open) return null;
  return (
    <div className="cm-palette" onClick={onClose}>
      <div className="cm-palette__panel" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cm-palette__input"
          placeholder="Saltar a una página, buscar acción…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
        />
        <div className="cm-palette__list">
          {items.length === 0 && <div className="cm-empty" style={{ padding: 32 }}>Sin resultados.</div>}
          {items.map((it, i) => (
            <div
              key={it.id}
              className={"cm-palette__item" + (i === idx ? " cm-palette__item--active" : "")}
              onMouseEnter={() => setIdx(i)}
              onClick={() => { onNav(it.path); onClose(); }}
            >
              <Icon name={it.icon} size={16} />
              <span style={{ flex: 1 }}>{it.label}</span>
              <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>{it.group}</span>
              {i === idx && <span className="cm-palette__item-kbd">⏎</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Auth helpers ──────────────────────────────────────
// Minimal client-side auth gate. The token is stored at login time
// (Login.jsx) under localStorage("cm-auth") as { token, savedAt }.
function readAuthToken() {
  try {
    const raw = localStorage.getItem("cm-auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.token || null;
  } catch {
    return null;
  }
}

// ─── Layout (the shell host) ───────────────────────────
function Layout({ children }) {
  const { route, navigate } = useHashRoute();
  const active = findActive(route);
  const crumbs = makeCrumbs(route);

  const [theme, setTheme] = useThemeState({ mode: "light", density: "default", accent: "blue" });
  const [collapsed, setCollapsed] = _useS(() => localStorage.getItem("cm-side-collapsed") === "1");
  const [mobileOpen, setMobileOpen] = _useS(false);
  const [paletteOpen, setPaletteOpen] = _useS(false);

  // Auth gate: bounce unauthenticated users to /login on every route change,
  // and bounce authenticated users away from /login back to the dashboard.
  _useE(() => {
    const hasToken = !!readAuthToken();
    const onLogin = route === "/login" || route.startsWith("/login");
    if (!hasToken && !onLogin) {
      navigate("/login");
    } else if (hasToken && onLogin) {
      navigate("/dashboard");
    }
  }, [route, navigate]);

  _useE(() => {
    localStorage.setItem("cm-side-collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  // Cmd+K / Ctrl+K
  _useE(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The login page is full-bleed: no sidebar / topbar. Render the child
  // directly so the LoginPage controls the entire viewport.
  if (route === "/login" || route.startsWith("/login")) {
    return React.cloneElement(children, { route, navigate, theme, setTheme });
  }

  const sideMode = mobileOpen ? "open" : (collapsed ? "collapsed" : "default");

  return (
    <div className="cm-app" data-side={sideMode}>
      <Sidebar
        active={active}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onNav={(p) => { navigate(p); setMobileOpen(false); }}
      />
      <Topbar
        crumbs={crumbs}
        theme={theme}
        setTheme={setTheme}
        onOpenPalette={() => setPaletteOpen(true)}
        onMobileMenu={() => setMobileOpen((o) => !o)}
        onNav={navigate}
      />
      <main className="cm-main">
        {React.cloneElement(children, { route, navigate, theme, setTheme })}
      </main>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNav={navigate}
      />
    </div>
  );
}

// ─── Router (route → page) ──────────────────────────
function Router({ route, navigate, theme, setTheme }) {
  if (route === "/" || route === "/dashboard") return <DashboardPage navigate={navigate} />;
  if (route.startsWith("/devices"))      return <DevicesPage route={route} navigate={navigate} />;
  if (route.startsWith("/addressbook"))  return <AddressBookPage route={route} navigate={navigate} />;
  if (route.startsWith("/tokens"))       return <JoinTokensPage route={route} navigate={navigate} />;
  if (route.startsWith("/logs"))         return <LogsPage route={route} navigate={navigate} />;
  if (route.startsWith("/users"))        return <UsersPage route={route} navigate={navigate} />;
  if (route.startsWith("/settings"))     return <SettingsPage route={route} navigate={navigate} theme={theme} setTheme={setTheme} />;
  if (route.startsWith("/login"))        return <LoginPage navigate={navigate} />;
  return (
    <div className="cm-page">
      <PageHeader title="Página no encontrada" subtitle={`Ruta: ${route}`} />
      <button className="cm-btn cm-btn--primary" onClick={() => navigate("/dashboard")}>
        Volver al dashboard
      </button>
    </div>
  );
}

window.Layout = Layout;
window.Router = Router;
