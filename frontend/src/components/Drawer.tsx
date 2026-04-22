/** Right-side Drawer (Sheet) primitive.
 *
 *  Slides in from the right over a 50% backdrop. Role="dialog" +
 *  aria-modal="true" + focus trap + Escape to close, mirroring Dialog.tsx.
 *  We intentionally did NOT extend Dialog directly because the backdrop is
 *  100vh-aligned instead of centered and the close affordance is a header
 *  close button rather than an overlay click (Sheets commonly keep the
 *  overlay interactive for "click outside to dismiss"; we do that too).
 */

import { useEffect, useId, useRef } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]),' +
  ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DrawerProps {
  open: boolean;
  onClose?: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Width in px. Default 480 per the spec. */
  width?: number;
}

export function Drawer({ open, onClose, title, children, footer, width = 480 }: DrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const pointerStartedInside = useRef(false);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const focusFirst = () => {
      const node = panelRef.current;
      if (!node) return;
      const focusables = node.querySelectorAll<HTMLElement>(FOCUSABLE);
      (focusables[0] ?? node).focus();
    };
    const raf = requestAnimationFrame(focusFirst);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const onBackdropPointerDown = (e: MouseEvent) => {
    pointerStartedInside.current = e.target !== e.currentTarget;
  };
  const onBackdropClick = (e: MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    if (pointerStartedInside.current) {
      pointerStartedInside.current = false;
      return;
    }
    onClose?.();
  };

  return (
    <div
      className="rd-drawer-backdrop"
      onMouseDown={onBackdropPointerDown}
      onClick={onBackdropClick}
    >
      <aside
        ref={panelRef}
        className="rd-drawer"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rd-drawer__head">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="rd-iconbtn"
            onClick={onClose}
            aria-label="Close drawer"
          >
            <X size={14} />
          </button>
        </div>
        <div className="rd-drawer__body">{children}</div>
        {footer ? <div className="rd-drawer__foot">{footer}</div> : null}
      </aside>
    </div>
  );
}
