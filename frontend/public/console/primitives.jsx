// ============================================================
// Console Mockup — primitives.jsx
// Shared building blocks: Tag, Switch, Tabs, Drawer, Empty,
// Skeleton, ErrorBanner, ConfirmDialog, useHashRoute hook.
// All exported to window for cross-script use.
// ============================================================

const { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } = React;

// ─── Hash router ────────────────────────────────────────
function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash.replace(/^#/, "") || "/dashboard");
  useEffect(() => {
    const onHash = () => setHash(window.location.hash.replace(/^#/, "") || "/dashboard");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = useCallback((to) => { window.location.hash = to; }, []);
  return { route: hash, navigate };
}

// ─── Primitives ─────────────────────────────────────────
const Tag = ({ tone = "default", children }) => {
  const cls = tone === "default" ? "cm-tag" : `cm-tag cm-tag--${tone}`;
  return <span className={cls}>{children}</span>;
};

const Dot = ({ online }) => (
  <span className={online ? "cm-dot cm-dot--online" : "cm-dot cm-dot--offline"} />
);

const Switch = ({ checked, onChange, id }) => (
  <label className="cm-switch">
    <input
      type="checkbox"
      id={id}
      checked={checked}
      onChange={(e) => onChange?.(e.target.checked)}
    />
    <span className="cm-switch__track" />
  </label>
);

const Tabs = ({ tabs, value, onChange }) => (
  <div className="cm-tabs" role="tablist">
    {tabs.map((t) => (
      <button
        key={t.value}
        role="tab"
        aria-selected={value === t.value}
        className="cm-tabs__tab"
        onClick={() => onChange(t.value)}
      >
        {t.label}
      </button>
    ))}
  </div>
);

const EmptyState = ({ icon = "inbox", title, description, action }) => (
  <div className="cm-empty">
    <div className="cm-empty__icon"><Icon name={icon} size={26} /></div>
    <h3 className="cm-empty__title">{title}</h3>
    <p className="cm-empty__desc">{description}</p>
    {action}
  </div>
);

const Skeleton = ({ width = "100%", height = 14, style }) => (
  <span className="cm-skel" style={{ display: "inline-block", width, height, ...style }} />
);

const ErrorBanner = ({ title, description, action }) => (
  <div className="cm-error">
    <div className="cm-error__icon"><Icon name="alert" size={20} /></div>
    <div style={{ flex: 1 }}>
      <p className="cm-error__title">{title}</p>
      <p className="cm-error__desc">{description}</p>
    </div>
    {action}
  </div>
);

const Drawer = ({ open, onClose, title, children, footer }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="cm-overlay" />
      <aside className="cm-drawer" role="dialog" aria-modal="true">
        <header className="cm-drawer__head">
          <h2>{title}</h2>
          <button className="cm-btn cm-btn--ghost cm-btn--icon" onClick={onClose} aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </header>
        <div className="cm-drawer__body">{children}</div>
        {footer && <footer className="cm-drawer__foot">{footer}</footer>}
      </aside>
    </>
  );
};

// ─── Modal genérico (× sistema-wide, ESC cierra) ───────
const Modal = ({ open, onClose, title, children, footer, width = 480 }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="cm-overlay" />
      <div className="cm-modal" role="dialog" aria-modal="true" style={{ maxWidth: width }}>
        <header className="cm-modal__head">
          <h2>{title}</h2>
          <button className="cm-btn cm-btn--ghost cm-btn--icon" onClick={onClose} aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </header>
        <div className="cm-modal__body">{children}</div>
        {footer && <footer className="cm-modal__foot">{footer}</footer>}
      </div>
    </>
  );
};

// ─── ConfirmDialog (× cerrar + orden Cancel der / Acción izq) ──
// Soporta opcionalmente "type-to-confirm" (escribir el nombre)
const ConfirmDialog = ({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  tone = "danger", // danger | primary | default
  typeToConfirm = null, // si se pasa, hay que escribir esa cadena exacta
}) => {
  const [typed, setTyped] = useState("");
  useEffect(() => { if (!open) setTyped(""); }, [open]);
  const isLocked = typeToConfirm && typed !== typeToConfirm;
  const confirmCls = tone === "danger" ? "cm-btn cm-btn--danger" : tone === "primary" ? "cm-btn cm-btn--primary" : "cm-btn";
  return (
    <Modal open={open} onClose={onClose} title={title} width={460}
      footer={
        <div className="cm-modal__foot-row">
          {/* Acción a la izquierda, Cancel a la derecha — invertido */}
          <button
            className={confirmCls}
            disabled={isLocked}
            onClick={() => { onConfirm?.(); }}
          >
            {confirmLabel}
          </button>
          <button className="cm-btn" onClick={onClose}>{cancelLabel}</button>
        </div>
      }
    >
      <p style={{ color: "var(--text-2)", margin: 0, marginBottom: typeToConfirm ? 16 : 0 }}>{description}</p>
      {typeToConfirm && (
        <div style={{ marginTop: 4 }}>
          <label className="cm-label" style={{ fontSize: 12, color: "var(--text-3)", display: "block", marginBottom: 6 }}>
            Escribe <strong style={{ color: "var(--text-1)", fontFamily: "var(--font-mono)" }}>{typeToConfirm}</strong> para confirmar
          </label>
          <input
            type="text"
            className="cm-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            placeholder={typeToConfirm}
          />
        </div>
      )}
    </Modal>
  );
};

// ─── PageSizeSelect (reusable) ─────────────────────────
const PageSizeSelect = ({ value, onChange, options = [10, 25, 50, 100] }) => (
  <label className="cm-pgsize">
    <span>Mostrar</span>
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="cm-input cm-input--sm">
      {options.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  </label>
);

const PageHeader = ({ title, subtitle, actions }) => (
  <header className="cm-page__head">
    <div>
      <h1>{title}</h1>
      {subtitle && <p className="sub">{subtitle}</p>}
    </div>
    {actions && <div className="cm-page__head-actions">{actions}</div>}
  </header>
);

// ─── Toast (lightweight) ────────────────────────────────
const ToastCtx = createContext(null);
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, tone: opts.tone || "default" }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.duration || 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div style={{ position: "fixed", bottom: 16, right: 16, display: "flex", flexDirection: "column", gap: 8, zIndex: 80 }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "10px 14px",
              boxShadow: "0 8px 24px -8px rgba(0,0,0,0.2)",
              fontSize: 14,
              minWidth: 240,
              borderLeft: `3px solid var(--${t.tone === "error" ? "red-500" : t.tone === "success" ? "green-500" : "primary"})`,
            }}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
const useToast = () => useContext(ToastCtx);

// Export to window
Object.assign(window, {
  useHashRoute, Tag, Dot, Switch, Tabs, EmptyState, Skeleton,
  ErrorBanner, Drawer, PageHeader, ToastProvider, useToast,
  Modal, ConfirmDialog, PageSizeSelect,
});
