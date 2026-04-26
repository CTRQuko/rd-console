// ============================================================
// Pages — Address Book (Agenda)
// Contactos manuales agrupados, con permisos compartidos.
// ============================================================

const { useState: _abS, useEffect: _abE, useRef: _abR, useMemo: _abM } = React;

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
  const [open, setOpen] = _abS(false);
  const [openUp, setOpenUp] = _abS(false);
  const ref = _abR(null);
  _abE(() => {
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
  const [name, setName]   = _abS("");
  const [color, setColor] = _abS("violet");
  _abE(() => {
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
  const [name, setName]   = _abS("");
  const [email, setEmail] = _abS("");
  const [perm, setPerm]   = _abS("view-only");
  _abE(() => {
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
function AddressBookPage() {
  const [groups, setGroups] = _abS([]);
  const [activeGroupId, setActiveGroupId] = _abS(null);
  const [q, setQ] = _abS("");

  const [groupModal, setGroupModal] = _abS({ open: false, group: null });
  const [contactModal, setContactModal] = _abS({ open: false, contact: null });
  const [deleteContact, setDeleteContact] = _abS(null);
  const [deleteGroup, setDeleteGroup] = _abS(null);
  const [importOpen, setImportOpen] = _abS(false);
  const toast = useToast();

  // Initial load: pull the kingmo888-compat blob and derive groups
  // from its `tags` + `peers`. Refresh every 30 s so a peer that the
  // RustDesk client adds locally surfaces in the panel.
  _abE(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await _abApi("/api/ab/get", {
          method: "POST",
          body: JSON.stringify({ id: "panel" }),
        });
        if (cancelled) return;
        const next = _abAdaptBlob(res?.data);
        setGroups(next);
        if (next.length && !next.some((g) => g.id === activeGroupId)) {
          setActiveGroupId(next[0].id);
        }
      } catch {}
    };
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const group = _abM(() => groups.find((g) => g.id === activeGroupId) || groups[0], [groups, activeGroupId]);
  const filtered = _abM(() => {
    if (!group) return [];
    if (!q.trim()) return group.members;
    const ql = q.toLowerCase();
    return group.members.filter((m) =>
      m.name.toLowerCase().includes(ql) || m.email.toLowerCase().includes(ql)
    );
  }, [group, q]);

  // The address book is stored as a kingmo888 blob (see
  // backend/app/routers/address_book.py). Round-tripping a Group /
  // Contact / permission edit cleanly into that blob is non-trivial:
  //   - The blob has `peers[]` keyed by RustDesk id, not by group.
  //   - There's no "permission" field in the blob shape.
  // So for now the page is read-only against the live blob; create /
  // edit / delete actions stay client-side and show a toast that
  // tells the user the action didn't reach the backend. Wiring up a
  // real upsert needs either:
  //   (a) a Group/Contact-model migration on the backend (BACKEND.md
  //       §6 — bigger lift), or
  //   (b) a careful blob editor that preserves forward-compat fields.
  // Both belong to a follow-up commit.
  const _abReadOnlyToast = () =>
    toast(
      "La agenda es solo lectura — la sincroniza el cliente RustDesk. " +
      "Próximamente: edición desde el panel.",
      { tone: "info" }
    );

  const upsertGroup = (_g) => {
    _abReadOnlyToast();
    setGroupModal({ open: false, group: null });
  };
  const upsertContact = (_c) => {
    _abReadOnlyToast();
    setContactModal({ open: false, contact: null });
  };
  const removeContact = () => {
    _abReadOnlyToast();
    setDeleteContact(null);
  };
  const removeGroup = () => {
    _abReadOnlyToast();
    setDeleteGroup(null);
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

window.AddressBookPage = AddressBookPage;
