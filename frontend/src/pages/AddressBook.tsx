// Mechanically ported from public/console/pages/AddressBook.jsx
// (Etapa 4 ESM migration). React aliases → bare hook names,
// window.X exports → named ESM exports.
//
// Types added in the @ts-nocheck cleanup pass: the page now models
// the Group/Contact rows that /api/ab/v2 round-trips and converts
// them to the Member/Group shape the UI consumes (with the four
// `_rd_id`/`_platform`/`_note`/`_tags` carry-over fields used by the
// upsertContact PATCH).
import {
  useState, useEffect, useMemo, useRef,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Icon } from "../components/Icon";
import {
  Tag, EmptyState,
  Drawer, Modal, ConfirmDialog, PageHeader,
  useToast,
} from "../components/primitives";

// ============================================================
// Pages — Address Book (Agenda)
// Contactos manuales agrupados, con permisos compartidos.
// ============================================================

// ─── Tipos compartidos ──────────────────────────────────

type Perm = "view-only" | "view-control" | "control-only";
type GroupColor = "violet" | "blue" | "green" | "amber" | "rose" | "default";

interface Member {
  id: string;
  name: string;
  email: string;
  devices: number;
  perm: Perm;
  // Backend-side fields kept for save round-trip (only present when
  // the row originated in /api/ab/v2 — local edits before save lack
  // them and the upsert path treats `id` as the create discriminator).
  _rd_id?: string;
  _platform?: string;
  _note?: string;
  _tags?: string[];
}

interface Group {
  id: string;
  name: string;
  color: GroupColor;
  members: Member[];
  _backend_id?: number;
  _note?: string;
}

interface BackendGroup {
  id: number;
  name: string;
  color?: GroupColor | null;
  note?: string | null;
  contact_count?: number;
}

interface BackendContact {
  id: number;
  group_id: number;
  rd_id: string;
  alias: string;
  username: string;
  platform: string;
  note: string;
  tags?: string[];
}

interface KebabSeparator {
  // Sentinel used in `items` arrays to render a divider line.
  readonly __sep: true;
}

interface KebabAction {
  label: string;
  icon?: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
}

type KebabItem = "sep" | KebabAction;

// ─── Auth-aware fetch (Etapa 3.9) ────────────────────────
function _abAuthToken(): string | null {
  try {
    const raw = localStorage.getItem("cm-auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string };
    return parsed?.token ?? null;
  } catch { return null; }
}

interface ApiInit extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

async function _abApi<T = unknown>(path: string, init: ApiInit = {}): Promise<T | null> {
  const token = _abAuthToken();
  const headers: Record<string, string> = {
    ...(init.headers || {}),
    ...(token ? { Authorization: "Bearer " + token } : {}),
  };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    try { localStorage.removeItem("cm-auth"); } catch {
      // localStorage might be unavailable — ignore.
    }
    window.location.hash = "/login";
    throw new Error("unauthenticated");
  }
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init.method || "GET"} ${path} -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

const _AB_DEFAULT_PERM: Perm = "view-control";

const _GROUP_COLORS: Array<{ id: GroupColor; label: string; css: string }> = [
  { id: "violet", label: "Violeta", css: "var(--violet-500)" },
  { id: "blue",   label: "Azul",    css: "var(--blue-500)"   },
  { id: "green",  label: "Verde",   css: "var(--green-500)"  },
  { id: "amber",  label: "Ámbar",   css: "var(--amber-500)"  },
  { id: "rose",   label: "Rosa",    css: "#e11d48"           },
  { id: "default",label: "Gris",    css: "var(--zinc-400)"   },
];

const _PERM_OPTIONS: Array<{ id: Perm; label: string; tone: string; desc: string }> = [
  { id: "view-only",     label: "Solo ver",          tone: "default", desc: "Puede ver la pantalla; no controla." },
  { id: "view-control",  label: "Ver y controlar",   tone: "primary", desc: "Acceso completo (ratón + teclado)." },
  { id: "control-only",  label: "Solo controlar",    tone: "amber",   desc: "Sin pantalla — útil para CI." },
];

const _colorCss = (id: GroupColor | undefined): string => {
  const found = _GROUP_COLORS.find((c) => c.id === id);
  return (found ?? _GROUP_COLORS[_GROUP_COLORS.length - 1]).css;
};
const _permTone = (p: Perm): string => (_PERM_OPTIONS.find((x) => x.id === p) ?? _PERM_OPTIONS[0]).tone;
const _permLabel = (p: Perm): string => (_PERM_OPTIONS.find((x) => x.id === p) ?? _PERM_OPTIONS[0]).label;

// ─── Kebab ─────────────────────────────────────────────
function _AbKebab({ items }: { items: KebabItem[] }) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      const menuH = Math.min(items.length * 36 + 16, 320);
      setOpenUp(window.innerHeight - r.bottom < menuH + 12);
    }
    setOpen((v) => !v);
  };
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button className="cm-btn cm-btn--ghost cm-btn--icon" onClick={toggle}>
        <Icon name="more" />
      </button>
      {open && (
        <div style={{
          position: "absolute",
          ...(openUp ? { bottom: "calc(100% + 4px)" } : { top: "calc(100% + 4px)" }),
          right: 0, zIndex: 50,
          minWidth: 180, background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: 10, boxShadow: "0 12px 32px rgba(0,0,0,.18)", padding: 4,
        }}>
          {items.map((it, i) => it === "sep" ? (
            <div key={i} style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          ) : (
            <button
              key={i}
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick?.(); }}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                padding: "8px 10px", borderRadius: 6, border: "none", background: "transparent",
                color: it.danger ? "#e11d48" : "var(--fg)",
                fontSize: 13, textAlign: "left", cursor: it.disabled ? "not-allowed" : "pointer",
                opacity: it.disabled ? 0.5 : 1, fontFamily: "inherit",
              }}
              onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = "var(--bg-subtle)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {it.icon && <Icon name={it.icon} size={14} />} {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Modal: Crear / editar grupo ──────────────────────
interface GroupModalProps {
  open: boolean;
  group: Group | null;
  onClose: () => void;
  onSave: (g: Group) => void;
}

function GroupModal({ open, group, onClose, onSave }: GroupModalProps) {
  const [name, setName]   = useState("");
  const [color, setColor] = useState<GroupColor>("violet");
  useEffect(() => {
    if (!open) return;
    setName(group?.name || "");
    setColor((group?.color as GroupColor) || "violet");
  }, [open, group]);

  const submit = () => {
    if (!name.trim()) return;
    onSave({
      id: group?.id || ("g_" + Math.random().toString(36).slice(2, 7)),
      name: name.trim(),
      color,
      members: group?.members || [],
      _backend_id: group?._backend_id,
      _note: group?._note,
    });
  };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={group ? `Editar grupo` : "Nuevo grupo"}
      width={460}
      footer={
        <>
          <button className="cm-btn cm-btn--primary" onClick={submit} disabled={!name.trim()}>
            {group ? "Guardar cambios" : "Crear grupo"}
          </button>
          <button className="cm-btn" onClick={onClose} style={{ marginLeft: "auto" }}>Cancelar</button>
        </>
      }
    >
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Nombre del grupo</label>
        <input
          className="cm-input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="p. ej. Equipo de soporte"
        />
        <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 4 }}>
          Etiqueta interna. Los miembros del grupo no la ven.
        </div>
      </div>
      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Color</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {_GROUP_COLORS.map((c) => (
            <button
              key={c.id}
              onClick={() => setColor(c.id)}
              title={c.label}
              aria-label={c.label}
              style={{
                width: 28, height: 28, borderRadius: 8, cursor: "pointer",
                background: c.css,
                border: color === c.id ? "2px solid var(--fg)" : "2px solid transparent",
                outline: "1px solid var(--border)",
              }}
            />
          ))}
        </div>
      </div>
    </Drawer>
  );
}

// ─── Modal: Crear / editar contacto ───────────────────
interface ContactModalProps {
  open: boolean;
  contact: Member | null;
  groupName?: string;
  onClose: () => void;
  onSave: (c: Member) => void;
}

function ContactModal({ open, contact, groupName, onClose, onSave }: ContactModalProps) {
  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  const [perm, setPerm]   = useState<Perm>("view-only");
  useEffect(() => {
    if (!open) return;
    setName(contact?.name || "");
    setEmail(contact?.email || "");
    setPerm((contact?.perm as Perm) || "view-only");
  }, [open, contact]);

  const submit = () => {
    if (!name.trim()) return;
    onSave({
      id: contact?.id || ("m_" + Math.random().toString(36).slice(2, 7)),
      name: name.trim(),
      email: email.trim(),
      devices: contact?.devices ?? 0,
      perm,
      _rd_id: contact?._rd_id,
      _platform: contact?._platform,
      _note: contact?._note,
      _tags: contact?._tags,
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={contact ? "Editar contacto" : "Añadir contacto"}
      width={500}
      footer={
        <>
          <button className="cm-btn cm-btn--primary" onClick={submit} disabled={!name.trim()}>
            {contact ? "Guardar" : "Añadir al grupo"}
          </button>
          <button className="cm-btn" onClick={onClose} style={{ marginLeft: "auto" }}>Cancelar</button>
        </>
      }
    >
      {groupName && (
        <div style={{ fontSize: 12, color: "var(--fg-muted)", marginBottom: 14 }}>
          En el grupo <strong style={{ color: "var(--fg)" }}>{groupName}</strong>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Nombre</label>
          <input className="cm-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre o alias" />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Email</label>
          <input className="cm-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="opcional" />
        </div>
      </div>
      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Permisos compartidos</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {_PERM_OPTIONS.map((p) => (
            <label key={p.id} style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              padding: 10, borderRadius: 8, cursor: "pointer",
              border: perm === p.id ? "1px solid var(--primary)" : "1px solid var(--border)",
              background: perm === p.id ? "color-mix(in oklab, var(--primary) 8%, transparent)" : "transparent",
            }}>
              <input type="radio" name="perm" checked={perm === p.id} onChange={() => setPerm(p.id)} style={{ marginTop: 3 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{p.label}</div>
                <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>{p.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>
    </Drawer>
  );
}

// ─── Página ───────────────────────────────────────────
export function AddressBookPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const [groupModal, setGroupModal] = useState<{ open: boolean; group: Group | null }>({ open: false, group: null });
  const [contactModal, setContactModal] = useState<{ open: boolean; contact: Member | null }>({ open: false, contact: null });
  const [deleteContact, setDeleteContact] = useState<Member | null>(null);
  const [deleteGroup, setDeleteGroup] = useState<Group | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const toast = useToast();

  // Initial load: pull groups from /api/ab/v2/groups. The first call
  // auto-imports the v1 blob if the user hasn't migrated yet (backend
  // handles the idempotent path). Each group's contacts come from
  // /api/ab/v2/groups/{id}/contacts.
  const load = async () => {
    try {
      const groupRows = await _abApi<BackendGroup[]>("/api/ab/v2/groups");
      if (!groupRows) return;
      // Fetch contacts for every group in parallel.
      const adapted: Group[] = await Promise.all(
        groupRows.map(async (g) => {
          let members: Member[] = [];
          try {
            const contacts = await _abApi<BackendContact[]>(`/api/ab/v2/groups/${g.id}/contacts`);
            members = (contacts || []).map((c) => ({
              id: String(c.id),
              name: c.alias || c.rd_id,
              email: c.username || c.rd_id,
              devices: 1,
              perm: _AB_DEFAULT_PERM,
              // Backend-side fields kept for save round-trip.
              _rd_id: c.rd_id,
              _platform: c.platform,
              _note: c.note,
              _tags: c.tags || [],
            }));
          } catch {
            // empty members on contact-fetch failure
          }
          return {
            id: String(g.id),
            name: g.name,
            color: (g.color as GroupColor) || "blue",
            members,
            _backend_id: g.id,
            _note: g.note ?? undefined,
          };
        }),
      );
      setGroups(adapted);
      if (adapted.length && !adapted.some((g) => g.id === activeGroupId)) {
        setActiveGroupId(adapted[0].id);
      }
    } catch {
      // silent
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await load(); })();
    const id = setInterval(() => { if (!cancelled) load(); }, 30000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const group: Group | undefined = useMemo(
    () => groups.find((g) => g.id === activeGroupId) || groups[0],
    [groups, activeGroupId],
  );
  const filtered = useMemo<Member[]>(() => {
    if (!group) return [];
    if (!q.trim()) return group.members;
    const ql = q.toLowerCase();
    return group.members.filter((m) =>
      m.name.toLowerCase().includes(ql) || m.email.toLowerCase().includes(ql)
    );
  }, [group, q]);

  // CRUD via /api/ab/v2 (Group + Contact tables). The legacy /api/ab
  // blob endpoints stay around for the kingmo888 sync protocol; this
  // page edits the v2 rows that the first GET auto-imports the blob
  // into.
  const upsertGroup = async (g: Group) => {
    const isNew = !g._backend_id;
    try {
      if (isNew) {
        await _abApi("/api/ab/v2/groups", {
          method: "POST",
          body: JSON.stringify({ name: g.name, color: g.color, note: g._note || "" }),
        });
      } else {
        await _abApi(`/api/ab/v2/groups/${g._backend_id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: g.name, color: g.color, note: g._note || "" }),
        });
      }
      setGroupModal({ open: false, group: null });
      await load();
      toast(isNew ? "Grupo creado" : "Grupo actualizado", { tone: "success" });
    } catch {
      toast("No se pudo guardar el grupo", { tone: "danger" });
    }
  };

  const upsertContact = async (c: Member) => {
    const groupBackendId = group?._backend_id;
    if (!groupBackendId) {
      toast("Selecciona un grupo primero", { tone: "danger" });
      return;
    }
    const body = {
      rd_id: c._rd_id || c.email || "",
      alias: c.name || "",
      username: c.email || "",
      platform: c._platform || "",
      note: c._note || "",
      tags: Array.isArray(c._tags) ? c._tags : [],
    };
    const contactBackendId = c.id && /^\d+$/.test(String(c.id)) ? Number(c.id) : null;
    try {
      if (contactBackendId) {
        await _abApi(`/api/ab/v2/contacts/${contactBackendId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await _abApi(`/api/ab/v2/groups/${groupBackendId}/contacts`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      setContactModal({ open: false, contact: null });
      await load();
      toast(contactBackendId ? "Contacto actualizado" : "Contacto añadido", { tone: "success" });
    } catch {
      toast("No se pudo guardar el contacto", { tone: "danger" });
    }
  };

  const removeContact = async () => {
    if (!deleteContact) return;
    const cid = deleteContact.id;
    setDeleteContact(null);
    if (!/^\d+$/.test(String(cid))) {
      toast("ID de contacto inválido", { tone: "danger" });
      return;
    }
    try {
      await _abApi(`/api/ab/v2/contacts/${cid}`, { method: "DELETE" });
      await load();
      toast("Contacto eliminado", { tone: "success" });
    } catch {
      toast("No se pudo eliminar", { tone: "danger" });
    }
  };

  const removeGroup = async () => {
    if (!deleteGroup) return;
    const gid = deleteGroup._backend_id;
    setDeleteGroup(null);
    if (!gid) {
      toast("Grupo no persistido", { tone: "danger" });
      return;
    }
    try {
      await _abApi(`/api/ab/v2/groups/${gid}`, { method: "DELETE" });
      await load();
      toast("Grupo eliminado", { tone: "success" });
    } catch {
      toast("No se pudo eliminar el grupo", { tone: "danger" });
    }
  };

  return (
    <div className="cm-page">
      <PageHeader
        title="Agenda"
        subtitle="Contactos agrupados manualmente con permisos de acceso compartidos."
        actions={<>
          <button className="cm-btn" onClick={() => setImportOpen(true)}>
            <Icon name="upload" size={14} /> Importar
          </button>
          <button className="cm-btn cm-btn--primary" onClick={() => setGroupModal({ open: true, group: null })}>
            <Icon name="plus" size={14} /> Nuevo grupo
          </button>
        </>}
      />

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20, alignItems: "flex-start" }}>
        {/* Group list */}
        <aside className="cm-card" style={{ padding: 8, position: "sticky", top: 16 }}>
          <div style={{ padding: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ color: "var(--fg-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600 }}>
              Grupos · {groups.length}
            </span>
            <button
              className="cm-btn cm-btn--ghost cm-btn--icon"
              title="Nuevo grupo"
              onClick={() => setGroupModal({ open: true, group: null })}
              style={{ width: 24, height: 24 }}
            >
              <Icon name="plus" size={14} />
            </button>
          </div>
          <div style={{ maxHeight: 480, overflowY: "auto", paddingRight: 2 }}>
            {groups.map((g) => (
              <div
                key={g.id}
                onClick={() => setActiveGroupId(g.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", borderRadius: 8,
                  cursor: "pointer",
                  background: activeGroupId === g.id ? "var(--bg-subtle)" : "transparent",
                  fontSize: 14,
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: _colorCss(g.color), flexShrink: 0 }} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span>
                <span style={{ color: "var(--fg-muted)", fontSize: 12, fontFamily: "var(--font-mono)" }}>{g.members.length}</span>
                <_AbKebab items={[
                  { label: "Editar grupo",   icon: "edit",  onClick: () => setGroupModal({ open: true, group: g }) },
                  "sep",
                  { label: "Eliminar grupo", icon: "trash", danger: true, onClick: () => setDeleteGroup(g), disabled: groups.length === 1 },
                ]} />
              </div>
            ))}
          </div>
        </aside>

        {/* Members of selected group */}
        <section className="cm-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: _colorCss(group?.color) }} />
                {group?.name}
              </h2>
              <p style={{ color: "var(--fg-muted)", fontSize: 13, margin: "2px 0 0" }}>
                {group?.members.length} miembros · {group?.members.reduce((s, m) => s + m.devices, 0)} dispositivos
              </p>
            </div>
            <div className="cm-toolbar__search" style={{ minWidth: 200 }}>
              <Icon name="search" />
              <input placeholder="Buscar miembro…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <button className="cm-btn cm-btn--primary" onClick={() => setContactModal({ open: true, contact: null })}>
              <Icon name="plus" size={14} /> Añadir contacto
            </button>
          </div>
          <div style={{ maxHeight: 540, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <EmptyState
                icon="user"
                title={q ? "Sin resultados" : "Sin miembros"}
                description={q ? "Prueba con otro nombre o email." : "Añade contactos para empezar a compartir acceso."}
              />
            ) : (
              <table className="cm-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Email</th>
                    <th>Dispositivos</th>
                    <th>Permiso</th>
                    <th style={{ width: 36 }} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((m) => (
                    <tr
                      key={m.id}
                      onClick={() => setContactModal({ open: true, contact: m })}
                      style={{ cursor: "pointer" }}
                    >
                      <td style={{ fontWeight: 500 }}>{m.name}</td>
                      <td style={{ color: "var(--fg-muted)" }}>{m.email || "—"}</td>
                      <td className="cm-table__cell-mono">{m.devices}</td>
                      <td><Tag tone={_permTone(m.perm)}>{_permLabel(m.perm)}</Tag></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <_AbKebab items={[
                          { label: "Editar",       icon: "edit",  onClick: () => setContactModal({ open: true, contact: m }) },
                          "sep",
                          { label: "Eliminar",     icon: "trash", danger: true, onClick: () => setDeleteContact(m) },
                        ]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      {/* Modals */}
      <GroupModal
        open={groupModal.open}
        group={groupModal.group}
        onClose={() => setGroupModal({ open: false, group: null })}
        onSave={upsertGroup}
      />
      <ContactModal
        open={contactModal.open}
        contact={contactModal.contact}
        groupName={group?.name}
        onClose={() => setContactModal({ open: false, contact: null })}
        onSave={upsertContact}
      />

      <ConfirmDialog
        open={!!deleteContact}
        onClose={() => setDeleteContact(null)}
        onConfirm={removeContact}
        title={`Eliminar a ${deleteContact?.name || ""}`}
        description={`Vas a quitar a «${deleteContact?.name}» del grupo «${group?.name}». Sus dispositivos perderán los permisos asociados.`}
        confirmLabel="Eliminar contacto"
        cancelLabel="Cancelar"
        tone="danger"
        typeToConfirm={deleteContact?.name}
      />

      <ConfirmDialog
        open={!!deleteGroup}
        onClose={() => setDeleteGroup(null)}
        onConfirm={removeGroup}
        title={`Eliminar grupo «${deleteGroup?.name || ""}»`}
        description={`Vas a borrar el grupo «${deleteGroup?.name}» y sus ${deleteGroup?.members.length || 0} contactos. Los dispositivos no se eliminan, solo pierden esta agrupación.`}
        confirmLabel="Eliminar grupo"
        cancelLabel="Cancelar"
        tone="danger"
        typeToConfirm={deleteGroup?.name}
      />

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Importar contactos"
        width={460}
        footer={
          <div className="cm-modal__foot-row">
            <button className="cm-btn cm-btn--primary" disabled style={{ opacity: 0.6 }}>
              Próximamente
            </button>
            <button className="cm-btn" onClick={() => setImportOpen(false)}>Cerrar</button>
          </div>
        }
      >
        <p style={{ fontSize: 13, color: "var(--fg-muted)", margin: 0, marginBottom: 12 }}>
          Esta función está en construcción. Cuando esté disponible podrás importar contactos desde:
        </p>
        <ul style={{ fontSize: 13, lineHeight: 1.8, paddingLeft: 18, margin: 0 }}>
          <li>CSV (formato <code style={{ fontFamily: "var(--font-mono)" }}>nombre,email,permiso</code>)</li>
          <li>vCard (.vcf) — exportado desde Apple Contacts, Outlook, etc.</li>
          <li>Otra agenda RustDesk (export JSON)</li>
        </ul>
      </Modal>
    </div>
  );
}
