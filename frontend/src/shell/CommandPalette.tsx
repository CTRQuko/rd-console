// Command palette anchored at Cmd/Ctrl+K. Searches:
//   1. Static catalogue (NAV + Settings sub-routes) — instant.
//   2. Backend /admin/api/search (users + devices + audit logs) —
//      debounced 250 ms so we don't spam the server on every keystroke.
//
// Arrow keys / Enter / Escape drive selection. Backend hits navigate
// to the listing page for the matching resource (no deep-link slug
// support yet — a follow-up will pre-select the row by id).
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { NAV } from "./nav";
import { readAuthToken } from "./auth";

interface PaletteItem {
  id: string;
  label: string;
  icon: string;
  path: string;
  group: string;
  hint?: string;
}

const SETTINGS_EXTRAS: PaletteItem[] = [
  { id: "settings-servidor",  label: "Ajustes · Servidor",        icon: "network",  path: "/settings/servidor",  group: "Ajustes" },
  { id: "settings-usuarios",  label: "Ajustes · Usuarios",        icon: "users",    path: "/settings/usuarios",  group: "Ajustes" },
  { id: "settings-seguridad", label: "Ajustes · Seguridad",       icon: "shield",   path: "/settings/seguridad", group: "Ajustes" },
  { id: "settings-updates",   label: "Ajustes · Actualizaciones", icon: "refresh",  path: "/settings/updates",   group: "Ajustes" },
];

interface BackendUserHit { id: number; username: string; email: string | null }
interface BackendDeviceHit { id: number; rustdesk_id: string; hostname: string | null }
interface BackendLogHit { id: number; action: string; actor_username: string | null; from_id: string | null; to_id: string | null; created_at: string }
interface BackendResults {
  users: BackendUserHit[];
  devices: BackendDeviceHit[];
  logs: BackendLogHit[];
}

function adaptBackend(r: BackendResults): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const u of r.users) {
    out.push({
      id: `u-${u.id}`,
      label: u.username + (u.email ? ` · ${u.email}` : ""),
      icon: "user",
      path: "/users",
      group: "Usuarios",
      hint: "Ver lista",
    });
  }
  for (const d of r.devices) {
    out.push({
      id: `d-${d.id}`,
      label: d.hostname || d.rustdesk_id,
      icon: "devices",
      path: "/devices",
      group: "Dispositivos",
      hint: d.rustdesk_id,
    });
  }
  for (const li of r.logs) {
    const target = li.from_id || li.to_id || "";
    out.push({
      id: `l-${li.id}`,
      label: `${li.action}${target ? " — " + target : ""}`,
      icon: "logs",
      path: "/logs",
      group: "Auditoría",
      hint: li.actor_username || "",
    });
  }
  return out;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onNav: (path: string) => void;
}

export function CommandPalette({ open, onClose, onNav }: Props) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [backend, setBackend] = useState<PaletteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Static section: instant filter over NAV + Settings extras.
  const staticItems = useMemo<PaletteItem[]>(() => {
    const flat = NAV.flatMap((g) => g.items.map((it) => ({ ...it, group: g.group })));
    const all = [...flat, ...SETTINGS_EXTRAS];
    if (!q.trim()) return all;
    const ql = q.toLowerCase();
    return all.filter(
      (it) => it.label.toLowerCase().includes(ql) || it.group.toLowerCase().includes(ql),
    );
  }, [q]);

  // Backend section: debounced fetch. Only triggers once the user has
  // typed 2+ characters — single-letter queries return too much noise.
  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) {
      setBackend([]);
      return;
    }
    const token = readAuthToken();
    if (!token) return;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(
          `/admin/api/search?q=${encodeURIComponent(q.trim())}&limit=5`,
          { headers: { Authorization: "Bearer " + token } },
        );
        if (!r.ok) {
          setBackend([]);
          return;
        }
        const data = (await r.json()) as BackendResults;
        setBackend(adaptBackend(data));
      } catch {
        setBackend([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, q]);

  const items = useMemo(() => [...staticItems, ...backend], [staticItems, backend]);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setBackend([]);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Reset selection when results change.
  useEffect(() => {
    setIdx(0);
  }, [items.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((i) => Math.min(i + 1, items.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && items[idx]) {
        onNav(items[idx].path);
        onClose();
      }
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
          placeholder="Saltar a una página, buscar dispositivo / usuario / evento…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="cm-palette__list">
          {items.length === 0 && !loading && (
            <div className="cm-empty" style={{ padding: 32 }}>Sin resultados.</div>
          )}
          {loading && items.length === 0 && (
            <div className="cm-empty" style={{ padding: 32, color: "var(--fg-muted)" }}>Buscando…</div>
          )}
          {items.map((it, i) => (
            <div
              key={it.id}
              className={"cm-palette__item" + (i === idx ? " cm-palette__item--active" : "")}
              onMouseEnter={() => setIdx(i)}
              onClick={() => {
                onNav(it.path);
                onClose();
              }}
            >
              <Icon name={it.icon} size={16} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {it.label}
              </span>
              {it.hint && (
                <span style={{ fontSize: 11, color: "var(--fg-muted)", marginRight: 8 }}>{it.hint}</span>
              )}
              <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>{it.group}</span>
              {i === idx && <span className="cm-palette__item-kbd">⏎</span>}
            </div>
          ))}
        </div>
        {loading && items.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--fg-muted)", padding: "6px 16px", borderTop: "1px solid var(--border)" }}>
            Buscando en backend…
          </div>
        )}
      </div>
    </div>
  );
}
