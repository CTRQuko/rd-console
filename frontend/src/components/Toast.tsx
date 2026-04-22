/** Tiny transient toast — inline-positioned element used by the three new
 *  pages. Not a real toast stack (we only ever show one at a time); kept
 *  local instead of a context so there's no hidden global state to reset
 *  between tests.
 */

import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';

export interface ToastValue {
  kind: 'ok' | 'error';
  text: string;
}

interface ToastProps {
  toast: ToastValue | null;
  onDismiss: () => void;
  /** Ms before auto-dismiss. Default 4000. */
  timeout?: number;
}

export function Toast({ toast, onDismiss, timeout = 4000 }: ToastProps) {
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(onDismiss, timeout);
    return () => window.clearTimeout(id);
  }, [toast, onDismiss, timeout]);

  if (!toast) return null;
  const Icon = toast.kind === 'ok' ? CheckCircle2 : AlertCircle;
  return (
    <div
      className={`rd-toast rd-toast--${toast.kind}`}
      role="status"
      aria-live="polite"
    >
      <Icon size={16} />
      <span>{toast.text}</span>
      <button
        type="button"
        className="rd-iconbtn"
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{ marginLeft: 'auto' }}
      >
        <X size={12} />
      </button>
    </div>
  );
}
