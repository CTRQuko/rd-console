import { useState } from 'react';
import { AlertCircle, Check, Copy } from 'lucide-react';

type CopyState = 'idle' | 'copied' | 'error';

interface CopyableFieldProps {
  label?: string;
  value: string;
  mono?: boolean;
  /** Fired on successful copy — used by parents that want to track
   *  whether the admin has already captured a one-shot secret (e.g.
   *  the join-token disclosure modal skips its dismiss-confirm once
   *  the admin has copied at least once). */
  onCopy?: (value: string) => void;
}

async function copyToClipboard(value: string): Promise<void> {
  // Prefer the async Clipboard API; fall back to the legacy execCommand path
  // for insecure contexts (http://) where the modern API is blocked.
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    const ok = document.execCommand('copy');
    if (!ok) throw new Error('copy command rejected');
  } finally {
    document.body.removeChild(textarea);
  }
}

export function CopyableField({
  label,
  value,
  mono = true,
  onCopy: onCopyCb,
}: CopyableFieldProps) {
  const [state, setState] = useState<CopyState>('idle');

  const onCopy = async () => {
    try {
      await copyToClipboard(value);
      setState('copied');
      onCopyCb?.(value);
    } catch {
      setState('error');
    }
    setTimeout(() => setState('idle'), 1600);
  };

  const Ic = state === 'copied' ? Check : state === 'error' ? AlertCircle : Copy;
  const title =
    state === 'copied' ? 'Copied' : state === 'error' ? 'Copy failed — select manually' : 'Copy';

  return (
    <div className="rd-field">
      {label ? <div className="rd-field__label">{label}</div> : null}
      <div className={`rd-field__box ${state === 'copied' ? 'copied' : ''}`}>
        <input readOnly value={value} className={mono ? 'rd-mono' : ''} />
        <button
          type="button"
          onClick={onCopy}
          title={title}
          aria-label={title}
          style={state === 'error' ? { color: 'var(--red-600)' } : undefined}
        >
          <Ic size={14} />
        </button>
      </div>
    </div>
  );
}
