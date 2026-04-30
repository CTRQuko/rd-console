// Command palette anchored at Cmd/Ctrl+K. Searches the static NAV
// catalogue plus the Settings sub-routes. Arrow keys / Enter / Escape
// drive selection. No backend search yet — that's a future feature.
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { NAV } from "./nav";

interface PaletteItem {
  id: string;
  label: string;
  icon: string;
  path: string;
  group: string;
}

const SETTINGS_EXTRAS: PaletteItem[] = [
  { id: "settings-servidor",  label: "Ajustes · Servidor",        icon: "network",  path: "/settings/servidor",  group: "Ajustes" },
  { id: "settings-usuarios",  label: "Ajustes · Usuarios",        icon: "users",    path: "/settings/usuarios",  group: "Ajustes" },
  { id: "settings-seguridad", label: "Ajustes · Seguridad",       icon: "shield",   path: "/settings/seguridad", group: "Ajustes" },
  { id: "settings-updates",   label: "Ajustes · Actualizaciones", icon: "refresh",  path: "/settings/updates",   group: "Ajustes" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onNav: (path: string) => void;
}

export function CommandPalette({ open, onClose, onNav }: Props) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo<PaletteItem[]>(() => {
    const flat = NAV.flatMap((g) => g.items.map((it) => ({ ...it, group: g.group })));
    const all = [...flat, ...SETTINGS_EXTRAS];
    if (!q.trim()) return all;
    const ql = q.toLowerCase();
    return all.filter(
      (it) => it.label.toLowerCase().includes(ql) || it.group.toLowerCase().includes(ql),
    );
  }, [q]);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

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
          placeholder="Saltar a una página, buscar acción…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
        />
        <div className="cm-palette__list">
          {items.length === 0 && <div className="cm-empty" style={{ padding: 32 }}>Sin resultados.</div>}
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
