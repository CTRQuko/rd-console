// @ts-nocheck
// Mechanically ported from public/console/pages/AddressBook.jsx
// (Etapa 4 ESM migration). React aliases → bare hook names,
// window.X exports → named ESM exports. ts-nocheck because the
// legacy code wasn't typed; tightening up types is a follow-up.
import {
  useState, useEffect, useMemo, useCallback, useRef,
} from "react";
import { Icon } from "../components/Icon";
import {
  Tag, Dot, Switch, Tabs, EmptyState, Skeleton, ErrorBanner,
  Drawer, Modal, ConfirmDialog, PageSizeSelect, PageHeader,
  ToastProvider, useToast, useHashRoute,
} from "../components/primitives";

// ============================================================
// Pages — Address Book (Agenda)
// Contactos manuales agrupados, con permisos compartidos.
// ============================================================


// ─── Auth-aware fetch (Etapa 3.9) ────────────────────────
function _abAuthToken() {
  try {
    const raw = localStorage.getItem("cm-auth");
    return raw ? (JSON.parse(raw)?.token || null) : null;
  } catch { return null; }
}
async function _abApi(path, init = {}) {
  const token = _abAuthToken();
  const headers = {
    ...(init.headers || {}),
    ...(token ? { Authorization: "Bearer " + token } : {}),
  };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    try { localStorage.removeItem("cm-auth"); } catch {}
    window.location.hash = "/login";
    throw new Error("unauthenticated");
  }
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init.method || "GET"} ${path} -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ─── Blob ↔ {groups: [{name, color, members[]}]} adapter ────────────────
//
// The backend stores the address book as a stringified JSON blob in the
// kingmo888-compat shape RustDesk's Flutter client uses:
//
//   { tags: [...], peers: [{id, alias, username, hostname, tags:[...]}],
//     tag_colors: {tag: "#HEX"} }
//
// The Claude Design page expects {groups: [{id, name, color, members[]}]}
// with manual permissions per member. The mapping derives one group
// per tag; peers without tags become a "Sin etiqueta" group. There's
// no source-of-truth for "permission" in the blob → all members
// default to "view-control" until a backend Group/Contact model exists.
//
// Edits done in this page (create group, add contact, change perm,
// delete) currently DO NOT round-trip — see the TODO comments on
// each handler.
const _AB_DEFAULT_PERM = "view-control";
const _AB_TAG_TO_COLOR = {
  personal: "violet",
  design: "amber",
  servers: "blue",
  ci: "blue",
  lab: "green",
  kiosk: "rose",
  remote: "violet",
  legacy: "default",
};

function _abPickColor(name, tagColors) {
  if (tagColors && tagColors[name]) {
    // Map RustDesk hex/legacy colour codes to the design's palette
    // by hue (cheap heuristic — not exact but close enough).
    const v = String(tagColors[name]).toLowerCase();
    if (v.includes("8b5cf6") || v.includes("violet")) return "violet";
    if (v.includes("3b82f6") || v.includes("blue"))   return "blue";
    if (v.includes("22c55e") || v.includes("green"))  return "green";
    if (v.includes("f59e0b") || v.includes("amber"))  return "amber";
    if (v.includes("e11d48") || v.includes("rose"))   return "rose";
  }
  return _AB_TAG_TO_COLOR[name] || "default";
}

function _abAdaptBlob(raw) {
  if (!raw || typeof raw !== "string") return [];
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const peers = Array.isArray(parsed?.peers) ? parsed.peers : [];
  const declaredTags = Array.isArray(parsed?.tags) ? parsed.tags : [];
  const tagColors = parsed?.tag_colors || {};

  // Bucket peers by tag. A peer with multiple tags lands in each bucket.
  const buckets = new Map();
  for (const tag of declaredTags) {
    buckets.set(tag, []);
  }
  for (const p of peers) {
    const tags = Array.isArray(p.tags) && p.tags.length > 0 ? p.tags : ["__untagged"];
    for (const tag of tags) {
      if (!buckets.has(tag)) buckets.set(tag, []);
      buckets.get(tag).push(p);
    }
  }

  const groups = [];
  for (const [tag, members] of buckets.entries()) {
    if (tag === "__untagged" && members.length === 0) continue;
    groups.push({
      id: tag,
      name: tag === "__untagged" ? "Sin etiqueta" : tag,
      color: tag === "__untagged" ? "default" : _abPickColor(tag, tagColors),
      members: members.map((p, idx) => ({
        id: `${tag}_${idx}_${p.id}`,
        name: p.alias || p.hostname || p.id,
        email: p.username || p.id,
        devices: 1,
        perm: _AB_DEFAULT_PERM,
      })),
    });
  }
  return groups;
}

const _GROUP_COLORS = [
  { id: "violet", label: "Violeta", css: "var(--violet-500)" },
  { id: "blue",   label: "Azul",    css: "var(--blue-500)"   },
  { id: "green",  label: "Verde",   css: "var(--green-500)"  },
  { id: "amber",  label: "Ámbar",   css: "var(--amber-500)"  },
  { id: "rose",   label: "Rosa",    css: "#e11d48"           },
  { id: "default",label: "Gris",    css: "var(--zinc-400)"   },
];

const _PERM_OPTIONS = [
  { id: "view-only",     label: "Solo ver",          tone: "default", desc: "Puede ver la pantalla; no controla." },
  { id: "view-control",  label: "Ver y controlar",   tone: "primary", desc: "Acceso completo (ratón + teclado)." },
  { id: "control-only",  label: "Solo controlar",    tone: "amber",   desc: "Sin pantalla — útil para CI." },
];

const MOCK_GROUPS_INIT = [
  {
    id: "design",
    name: "Equipo de diseño",
    color: "violet",
    members: [
      { id: "m1", name: "Diana López",    email: "diana@acme.io",    devices: 2, perm: "view-control" },
      { id: "m2", name: "Hugo Roca",      email: "hugo@acme.io",     devices: 1, perm: "view-only" },
      { id: "m3", name: "Marta Iglesias", email: "marta@acme.io",    devices: 3, perm: "view-control" },
    ],
  },
  {
    id: "ci",
    name: "CI / build servers",
    color: "amber",
    members: [
      { id: "m4", name: "build-srv-eu",   email: "ci@acme.io",       devices: 1, perm: "control-only" },
      { id: "m5", name: "build-srv-us",   email: "ci@acme.io",       devices: 1, perm: "control-only" },
    ],
  },
  {
    id: "qa",
    name: "QA",
    color: "green",
    members: [
      { id: "m6", name: "qa-rig-01",      email: "qa@acme.io",       devices: 1, perm: "view-control" },
      { id: "m7", name: "qa-rig-02",      email: "qa@acme.io",       devices: 1, perm: "view-control" },
      { id: "m8", name: "qa-mac-mini",    email: "qa@acme.io",       devices: 1, perm: "view-only" },
    ],
  },
  {
    id: "kiosk",
    name: "Kioskos",
    color: "default",
    members: [
      { id: "m9", name: "kiosk-front",    email: "kiosk@acme.io",    devices: 1, perm: "view-only" },
      { id: "m10",name: "kiosk-lobby",    email: "kiosk@acme.io",    devices: 1, perm: "view-only" },
    ],
  },
];

const _colorCss = (id) => (_GROUP_COLORS.find((c) => c.id === id) || _GROUP_COLORS.at(-1)).css;
const _permTone = (p) => (_PERM_OPTIONS.find((x) => x.id === p) || _PERM_OPTIONS[0]).tone;
const _permLabel = (p) => (_PERM_OPTIONS.find((x) => x.id === p) || _PERM_OPTIONS[0]).label;

// ─── Kebab ─────────────────────────────────────────────
function _AbKebab({ items }) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const toggle = (e) => {
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
              onMouseEnter={(e) => !it.disabled && (e.currentTarget.style.background = "var(--bg-subtle)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
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
function GroupModal({ open, group, onClose, onSave }) {
  const [name, setName]   = useState("");
  const [color, setColor] = useState("violet");
  useEffect(() => {
    if (!open) return;
    setName(group?.name || "");
    setColor(group?.color || "violet");
  }, [open, group]);

  const submit = () => {
    if (!name.trim()) return;
    onSave({
      id: group?.id || ("g_" + Math.random().toString(36).slice(2, 7)),
      name: name.trim(),
      color,
      members: group?.members || [],
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
function ContactModal({ open, contact, groupName, onClose, onSave }) {
  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  const [perm, setPerm]   = useState("view-only");
  useEffect(() => {
    if (!open) return;
    setName(contact?.name || "");
    setEmail(contact?.email || "");
    setPerm(contact?.perm || "view-only");
  }, [open, contact]);

  const submit = () => {
    if (!name.trim()) return;
    onSave({
      id: contact?.id || ("m_" + Math.random().toString(36).slice(2, 7)),
      name: name.trim(),
      email: email.trim(),
      devices: contact?.devices || 0,
      perm,
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
  const [groups, setGroups] = useState([]);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [q, setQ] = useState("");

  const [groupModal, setGroupModal] = useState({ open: false, group: null });
  const [contactModal, setContactModal] = useState({ open: false, contact: null });
  const [deleteContact, setDeleteContact] = useState(null);
  const [deleteGroup, setDeleteGroup] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const toast = useToast();

  // Initial load: pull groups from /api/ab/v2/groups. The first call
  // auto-imports the v1 blob if the user hasn't migrated yet (backend
  // handles the idempotent path). Each group's contacts come from
  // /api/ab/v2/groups/{id}/contacts.
  const load = async () => {
    try {
      const groupRows = await _abApi("/api/ab/v2/groups");
      if (!groupRows) return;
      // Fetch contacts for every group in parallel.
      const adapted = await Promise.all(
        (groupRows || []).map(async (g) => {
          let members = [];
          try {
            const contacts = await _abApi(`/api/ab/v2/groups/${g.id}/contacts`);
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
            color: g.color || "blue",
            members,
            _backend_id: g.id,
            _note: g.note,
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

  const group = useMemo(() => groups.find((g) => g.id === activeGroupId) || groups[0], [groups, activeGroupId]);
  const filtered = useMemo(() => {
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
  const upsertGroup = async (g) => {
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

  const upsertContact = async (c) => {
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

