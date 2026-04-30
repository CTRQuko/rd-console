// Topbar — burger button (mobile), breadcrumbs, command palette
// trigger, notifications bell + popover, avatar pill + menu. Hydrates
// /api/auth/me on mount and polls /api/v1/notifications/recent every
// 60 s so the bell dot stays accurate.
import { Fragment, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Icon } from "../components/Icon";
import { readAuthToken, clearAuthToken } from "./auth";
import { meInitials, ROLE_LABEL_ES, type MeUser } from "./identity";
import { NotificationsPopover, type NotificationItem } from "./NotificationsPopover";
import { UserMenuPopover } from "./UserMenuPopover";
import type { ThemeState } from "./theme";

interface NotificationsPayload {
  items: NotificationItem[];
  unread_count: number;
}

interface TopbarProps {
  crumbs: string[];
  theme: ThemeState;
  setTheme: Dispatch<SetStateAction<ThemeState>>;
  onOpenPalette: () => void;
  onMobileMenu: () => void;
  onNav: (path: string) => void;
}

export function Topbar({
  crumbs,
  theme,
  setTheme,
  onOpenPalette,
  onMobileMenu,
  onNav,
}: TopbarProps) {
  const [notiOpen, setNotiOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const notiRef = useRef<HTMLButtonElement>(null);
  const userRef = useRef<HTMLButtonElement>(null);
  const [notiRect, setNotiRect] = useState<DOMRect | null>(null);
  const [userRect, setUserRect] = useState<DOMRect | null>(null);
  const [me, setMe] = useState<MeUser | null>(null);
  const [notiData, setNotiData] = useState<NotificationsPayload>({ items: [], unread_count: 0 });

  // Hydrate the current user on mount. A 401 implies the token expired
  // or was revoked — wipe it and bounce to /login.
  useEffect(() => {
    const token = readAuthToken();
    if (!token) return;
    let cancelled = false;
    fetch("/api/auth/me", { headers: { Authorization: "Bearer " + token } })
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 401) {
          clearAuthToken();
          onNav("/login");
          return;
        }
        if (!r.ok) return;
        const data = (await r.json()) as MeUser;
        if (!cancelled) setMe(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [onNav]);

  // Poll notifications every 60 s.
  useEffect(() => {
    const token = readAuthToken();
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/api/v1/notifications/recent?limit=20", {
          headers: { Authorization: "Bearer " + token },
        });
        if (!r.ok || cancelled) return;
        const data = (await r.json()) as NotificationsPayload;
        if (!cancelled) setNotiData(data);
      } catch {
        // silent
      }
    };
    load();
    const t = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

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
    } catch {
      // silent
    }
  };

  const openNoti = () => {
    setNotiRect(notiRef.current?.getBoundingClientRect() ?? null);
    setNotiOpen(true);
    setUserOpen(false);
  };
  const openUser = () => {
    setUserRect(userRef.current?.getBoundingClientRect() ?? null);
    setUserOpen(true);
    setNotiOpen(false);
  };

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
          <Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            {i === crumbs.length - 1 ? <strong>{c}</strong> : <span>{c}</span>}
          </Fragment>
        ))}
      </nav>
      <button className="cm-top__search" onClick={onOpenPalette}>
        <Icon name="search" size={14} />
        <span style={{ flex: 1, textAlign: "left" }}>
          Buscar dispositivos, usuarios, ajustes…
        </span>
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
          <span className="cm-top__user-role">{ROLE_LABEL_ES[me?.role || ""] || me?.role || ""}</span>
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
      <UserMenuPopover
        open={userOpen}
        anchorRect={userRect}
        onClose={() => setUserOpen(false)}
        onNav={onNav}
        theme={theme}
        setTheme={setTheme}
        me={me}
      />
    </header>
  );
}
