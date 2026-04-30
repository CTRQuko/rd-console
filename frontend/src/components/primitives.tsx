// Shared building blocks: Tag, Dot, Switch, Tabs, EmptyState, Skeleton,
// ErrorBanner, Drawer, Modal, ConfirmDialog, PageSizeSelect, PageHeader,
// ToastProvider/useToast, useHashRoute. Ported 1:1 from the legacy
// public/console/primitives.jsx as part of the Etapa 4 ESM migration
// (PR 2). The legacy file used `Object.assign(window, …)` to expose
// every primitive globally; here each one is a named ESM export.
import {
  type ReactNode,
  type CSSProperties,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Icon } from "./Icon";

// ─── Hash router ────────────────────────────────────────
export function useHashRoute() {
  const [hash, setHash] = useState(
    () => window.location.hash.replace(/^#/, "") || "/dashboard",
  );
  useEffect(() => {
    const onHash = () =>
      setHash(window.location.hash.replace(/^#/, "") || "/dashboard");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = useCallback((to: string) => {
    window.location.hash = to;
  }, []);
  return { route: hash, navigate };
}

// ─── Tag / Dot ──────────────────────────────────────────
export function Tag({
  tone = "default",
  children,
}: {
  tone?: string;
  children: ReactNode;
}) {
  const cls = tone === "default" ? "cm-tag" : `cm-tag cm-tag--${tone}`;
  return <span className={cls}>{children}</span>;
}

export function Dot({ online }: { online?: boolean }) {
  return <span className={online ? "cm-dot cm-dot--online" : "cm-dot cm-dot--offline"} />;
}

// ─── Switch ─────────────────────────────────────────────
export function Switch({
  checked,
  onChange,
  id,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  id?: string;
}) {
  return (
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
}

// ─── Tabs ───────────────────────────────────────────────
interface TabItem {
  value: string;
  label: ReactNode;
}
export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: TabItem[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
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
}

// ─── EmptyState ─────────────────────────────────────────
export function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
}: {
  icon?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="cm-empty">
      <div className="cm-empty__icon"><Icon name={icon} size={26} /></div>
      <h3 className="cm-empty__title">{title}</h3>
      {description && <p className="cm-empty__desc">{description}</p>}
      {action}
    </div>
  );
}

// ─── Skeleton ───────────────────────────────────────────
export function Skeleton({
  width = "100%",
  height = 14,
  style,
}: {
  width?: number | string;
  height?: number | string;
  style?: CSSProperties;
}) {
  return (
    <span
      className="cm-skel"
      style={{ display: "inline-block", width, height, ...style }}
    />
  );
}

// ─── ErrorBanner ────────────────────────────────────────
export function ErrorBanner({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="cm-error">
      <div className="cm-error__icon"><Icon name="alert" size={20} /></div>
      <div style={{ flex: 1 }}>
        <p className="cm-error__title">{title}</p>
        <p className="cm-error__desc">{description}</p>
      </div>
      {action}
    </div>
  );
}

// ─── Drawer ─────────────────────────────────────────────
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose?.();
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
          <button
            className="cm-btn cm-btn--ghost cm-btn--icon"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <Icon name="x" />
          </button>
        </header>
        <div className="cm-drawer__body">{children}</div>
        {footer && <footer className="cm-drawer__foot">{footer}</footer>}
      </aside>
    </>
  );
}

// ─── Modal ──────────────────────────────────────────────
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 480,
}: {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number | string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose?.();
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
          <button
            className="cm-btn cm-btn--ghost cm-btn--icon"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <Icon name="x" />
          </button>
        </header>
        <div className="cm-modal__body">{children}</div>
        {footer && <footer className="cm-modal__foot">{footer}</footer>}
      </div>
    </>
  );
}

// ─── ConfirmDialog ──────────────────────────────────────
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  tone = "danger",
  typeToConfirm = null,
}: {
  open: boolean;
  onClose?: () => void;
  onConfirm?: () => void;
  title?: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary" | "default";
  typeToConfirm?: string | null;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => { if (!open) setTyped(""); }, [open]);
  const isLocked = !!typeToConfirm && typed !== typeToConfirm;
  const confirmCls =
    tone === "danger"
      ? "cm-btn cm-btn--danger"
      : tone === "primary"
        ? "cm-btn cm-btn--primary"
        : "cm-btn";
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={460}
      footer={
        <div className="cm-modal__foot-row">
          <button className={confirmCls} disabled={isLocked} onClick={() => onConfirm?.()}>
            {confirmLabel}
          </button>
          <button className="cm-btn" onClick={onClose}>{cancelLabel}</button>
        </div>
      }
    >
      <p style={{ color: "var(--text-2)", margin: 0, marginBottom: typeToConfirm ? 16 : 0 }}>
        {description}
      </p>
      {typeToConfirm && (
        <div style={{ marginTop: 4 }}>
          <label
            className="cm-label"
            style={{ fontSize: 12, color: "var(--text-3)", display: "block", marginBottom: 6 }}
          >
            Escribe{" "}
            <strong style={{ color: "var(--text-1)", fontFamily: "var(--font-mono)" }}>
              {typeToConfirm}
            </strong>{" "}
            para confirmar
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
}

// ─── PageSizeSelect ─────────────────────────────────────
export function PageSizeSelect({
  value,
  onChange,
  options = [10, 25, 50, 100],
}: {
  value: number;
  onChange: (n: number) => void;
  options?: number[];
}) {
  return (
    <label className="cm-pgsize">
      <span>Mostrar</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="cm-input cm-input--sm"
      >
        {options.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
    </label>
  );
}

// ─── PageHeader ─────────────────────────────────────────
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="cm-page__head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="sub">{subtitle}</p>}
      </div>
      {actions && <div className="cm-page__head-actions">{actions}</div>}
    </header>
  );
}

// ─── Toast ──────────────────────────────────────────────
interface ToastEntry {
  id: string;
  msg: ReactNode;
  tone: string;
}
type ToastFn = (msg: ReactNode, opts?: { tone?: string; duration?: number }) => void;
const ToastCtx = createContext<ToastFn | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const push = useCallback<ToastFn>((msg, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, tone: opts.tone || "default" }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.duration || 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 80,
        }}
      >
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
              borderLeft: `3px solid var(--${t.tone === "error" || t.tone === "danger" ? "red-500" : t.tone === "success" ? "green-500" : "primary"})`,
            }}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastFn {
  const fn = useContext(ToastCtx);
  // Fallback to a noop if a consumer renders outside the provider —
  // avoids crashing tests / storybook-like setups where the toast UI
  // isn't present.
  return fn ?? (() => undefined);
}
