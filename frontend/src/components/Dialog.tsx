import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface DialogProps {
  open: boolean;
  onClose?: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export function Dialog({ open, onClose, title, children, footer, width = 440 }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="rd-dialog-backdrop" onClick={onClose}>
      <div
        className="rd-dialog"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rd-dialog__head">
          <h2>{title}</h2>
          <button className="rd-iconbtn" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="rd-dialog__body">{children}</div>
        {footer ? <div className="rd-dialog__foot">{footer}</div> : null}
      </div>
    </div>
  );
}
