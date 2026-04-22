interface ToggleProps {
  checked: boolean;
  onChange?: (next: boolean) => void;
  label?: string;
}

export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <label className="rd-toggle-wrap">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`rd-toggle ${checked ? 'on' : ''}`}
        onClick={() => onChange?.(!checked)}
      />
      {label ? <span>{label}</span> : null}
    </label>
  );
}
