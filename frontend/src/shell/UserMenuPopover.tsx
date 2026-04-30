// Avatar dropdown anchored to the topbar user pill. Lets the operator
// switch theme mode and sign out. Logout fires a fire-and-forget POST
// to /api/auth/logout (revokes the JWT) and unconditionally wipes the
// localStorage envelope so the UI is responsive even if the request
// stalls.
import type { Dispatch, SetStateAction } from "react";
import { Icon } from "../components/Icon";
import { Popover } from "./Popover";
import { meInitials, ROLE_LABEL_ES, type MeUser } from "./identity";
import { clearAuthToken, readAuthToken } from "./auth";
import type { ThemeState } from "./theme";

interface Props {
  open: boolean;
  anchorRect: DOMRect | null;
  onClose: () => void;
  onNav: (path: string) => void;
  theme: ThemeState;
  setTheme: Dispatch<SetStateAction<ThemeState>>;
  me: MeUser | null;
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 12px",
        border: "none",
        background: "transparent",
        color: danger ? "#e11d48" : "var(--fg)",
        fontSize: 13,
        textAlign: "left",
        cursor: "pointer",
        borderRadius: 6,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-subtle)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Icon name={icon} size={14} /> {label}
    </button>
  );
}

export function UserMenuPopover({ open, anchorRect, onClose, onNav, theme, setTheme, me }: Props) {
  const wrap = (fn: () => void) => () => { fn(); onClose(); };

  const logout = () => {
    try {
      const token = readAuthToken();
      if (token) {
        fetch("/api/auth/logout", {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
        }).catch(() => undefined);
      }
    } catch {
      // ignore
    }
    clearAuthToken();
    onNav("/login");
  };

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
          <div style={{ fontSize: 11, color: "var(--primary)", fontWeight: 500, marginTop: 2 }}>
            {ROLE_LABEL_ES[me?.role || ""] || me?.role || ""}
          </div>
        </div>
      </div>
      <div style={{ padding: 4 }}>
        <MenuItem icon="user" label="Mi cuenta" onClick={wrap(() => onNav("/settings/usuarios"))} />
        <MenuItem icon="settings" label="Ajustes" onClick={wrap(() => onNav("/settings/general"))} />
      </div>
      <div style={{ borderTop: "1px solid var(--border)", padding: "8px 12px" }}>
        <div style={{ fontSize: 11, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>
          Apariencia
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["light", "dark"] as const).map((m) => (
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
        <MenuItem
          icon="users"
          label="Cambiar de usuario"
          onClick={wrap(() => {
            clearAuthToken();
            onNav("/login");
          })}
        />
        <MenuItem icon="x" label="Cerrar sesión" onClick={wrap(logout)} danger />
      </div>
    </Popover>
  );
}
