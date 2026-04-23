import { useEffect, useId, useRef } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { X } from 'lucide-react';

interface DialogProps {
  open: boolean;
  onClose?: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

// Focusable selector used for the tab-trap. Kept narrow on purpose.
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]),' +
  ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ open, onClose, title, children, footer, width = 440 }: DialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  // Track whether a mouse-down started inside the dialog so a drag-release
  // on the backdrop doesn't close the dialog mid-text-selection.
  const pointerStartedInside = useRef(false);

  // Keep onClose in a ref so the setup effect below only runs on open/close
  // toggles. Without this, consumer pages passing inline arrow handlers
  // (e.g. `onClose={() => { setOpenCreate(false); resetForm(); }}`) created
  // a new reference on every re-render — including every keystroke inside
  // form fields — which re-triggered the effect and stole focus back to
  // the first focusable element (the header "close" button). The
  // user-visible symptom was: typing in a dialog input bounced focus to
  // the X button between characters. Same for typing that caused state
  // updates in the parent.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Escape to close + focus trap. ONLY re-runs when `open` toggles.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const focusFirst = () => {
      const node = dialogRef.current;
      if (!node) return;
      // Prefer the first input/textarea/select inside the body over the
      // header's close button, which is otherwise always the DOM-first
      // focusable. Falls back to the first generic focusable (e.g.
      // confirm dialogs with no inputs), then to the dialog itself.
      const bodyControl = node.querySelector<HTMLElement>(
        '.rd-dialog__body input:not([disabled]), .rd-dialog__body textarea:not([disabled]), .rd-dialog__body select:not([disabled])',
      );
      if (bodyControl) {
        bodyControl.focus();
        return;
      }
      const focusables = node.querySelectorAll<HTMLElement>(FOCUSABLE);
      const first = focusables[0];
      (first ?? node).focus();
    };
    // Defer focus so it lands after the node is painted.
    const raf = requestAnimationFrame(focusFirst);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
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
      // Restore focus to where it was before the dialog opened.
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

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
      className="rd-dialog-backdrop"
      onMouseDown={onBackdropPointerDown}
      onClick={onBackdropClick}
    >
      <div
        ref={dialogRef}
        className="rd-dialog"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rd-dialog__head">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="rd-iconbtn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={14} />
          </button>
        </div>
        <div className="rd-dialog__body">{children}</div>
        {footer ? <div className="rd-dialog__foot">{footer}</div> : null}
      </div>
    </div>
  );
}
