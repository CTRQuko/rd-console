// Notifications popover anchored to the topbar bell. Items come from
// /api/v1/notifications/recent (server-computed read flag). Mark-all-read
// POSTs the highest visible id; the optimistic state flip is done by
// the parent (Topbar) so the popover stays presentation-only.
import { useState } from "react";
import { Icon } from "../components/Icon";
import { Popover } from "./Popover";

export interface NotificationItem {
  id: number;
  kind: string;
  title: string;
  subtitle?: string | null;
  when: string;
  actor?: string | null;
  read: boolean;
}

// kind → icon + tone + (optional) link target. Anything not in the
// map falls back to a generic "alert" icon at info level.
const _NOTI_PRESENTATION: Record<string, { icon: string; level: string; link: string }> = {
  user_added:       { icon: "users",  level: "info",    link: "/users" },
  user_removed:     { icon: "x",      level: "warn",    link: "/users" },
  user_disabled:    { icon: "x",      level: "warn",    link: "/users" },
  login_failed:     { icon: "alert",  level: "error",   link: "/logs" },
  invite_created:   { icon: "tokens", level: "info",    link: "/tokens" },
  invite_revoked:   { icon: "tokens", level: "warn",    link: "/tokens" },
  device_removed:   { icon: "x",      level: "warn",    link: "/devices" },
  settings_changed: { icon: "alert",  level: "info",    link: "/settings/general" },
  backup:           { icon: "check",  level: "success", link: "/settings/servidor" },
  backup_restored:  { icon: "check",  level: "success", link: "/settings/servidor" },
};

function levelColor(lv: string): string {
  switch (lv) {
    case "warn":    return "#d97706";
    case "info":    return "var(--primary)";
    case "success": return "#16a34a";
    case "error":   return "#e11d48";
    default:        return "var(--fg-muted)";
  }
}

function formatNotiWhen(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso);
  const diff = Math.floor((Date.now() - then.getTime()) / 1000);
  if (diff < 60) return "ahora";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `hace ${Math.floor(diff / 86400)} d`;
  return then.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

interface Props {
  open: boolean;
  anchorRect: DOMRect | null;
  onClose: () => void;
  onNav: (path: string) => void;
  items: NotificationItem[];
  unreadCount: number;
  onMarkAllRead: () => void;
}

export function NotificationsPopover({
  open,
  anchorRect,
  onClose,
  onNav,
  items,
  unreadCount,
  onMarkAllRead,
}: Props) {
  const [tab, setTab] = useState<"all" | "unread">("all");
  const visible = tab === "unread" ? items.filter((n) => !n.read) : items;

  const openItem = (n: NotificationItem) => {
    const link = _NOTI_PRESENTATION[n.kind]?.link || "/logs";
    onNav(link);
    onClose();
  };

  return (
    <Popover open={open} onClose={onClose} anchorRect={anchorRect} width={400}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600, margin: 0, flex: 1 }}>
          Notificaciones
        </h3>
        {unreadCount > 0 && (
          <button onClick={onMarkAllRead} style={{ fontSize: 12, color: "var(--primary)", background: "transparent", border: "none", cursor: "pointer" }}>
            Marcar todas leídas
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 4, padding: "8px 12px 0", borderBottom: "1px solid var(--border)" }}>
        {[
          { id: "all" as const, label: `Todas (${items.length})` },
          { id: "unread" as const, label: `No leídas (${unreadCount})` },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 12px",
              border: "none",
              background: "transparent",
              borderBottom: tab === t.id ? "2px solid var(--primary)" : "2px solid transparent",
              color: tab === t.id ? "var(--primary)" : "var(--fg-muted)",
              fontSize: 12,
              fontWeight: tab === t.id ? 600 : 500,
              cursor: "pointer",
              marginBottom: -1,
            }}
          >{t.label}</button>
        ))}
      </div>
      <div style={{ maxHeight: 380, overflowY: "auto" }}>
        {visible.length === 0 && (
          <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--fg-muted)", fontSize: 13 }}>
            <Icon name="check" size={28} />
            <div style={{ marginTop: 8 }}>Estás al día.</div>
          </div>
        )}
        {visible.map((n) => {
          const presentation = _NOTI_PRESENTATION[n.kind] || { icon: "alert", level: "info", link: "/logs" };
          const read = !!n.read;
          return (
            <button
              key={n.id}
              onClick={() => openItem(n)}
              style={{
                width: "100%",
                display: "flex",
                gap: 12,
                padding: "12px 16px",
                border: "none",
                borderBottom: "1px solid var(--border)",
                background: read ? "transparent" : "color-mix(in oklab, var(--primary) 5%, transparent)",
                textAlign: "left",
                cursor: "pointer",
                alignItems: "flex-start",
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
                  {n.actor && <><span>{n.actor}</span><span>·</span></>}
                  <span>{formatNotiWhen(n.when)}</span>
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
