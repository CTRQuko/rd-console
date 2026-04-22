import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyableFieldProps {
  label?: string;
  value: string;
  mono?: boolean;
}

export function CopyableField({ label, value, mono = true }: CopyableFieldProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* ignore — clipboard permissions may block us; UX still shows Copied briefly */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const Ic = copied ? Check : Copy;
  return (
    <div className="rd-field">
      {label ? <div className="rd-field__label">{label}</div> : null}
      <div className={`rd-field__box ${copied ? 'copied' : ''}`}>
        <input readOnly value={value} className={mono ? 'rd-mono' : ''} />
        <button type="button" onClick={onCopy} title={copied ? 'Copied' : 'Copy'}>
          <Ic size={14} />
        </button>
      </div>
    </div>
  );
}
