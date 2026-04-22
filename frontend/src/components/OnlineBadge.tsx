interface OnlineBadgeProps {
  online: boolean;
  label?: string;
}

export function OnlineBadge({ online, label }: OnlineBadgeProps) {
  const display = label ?? (online ? 'Online' : 'Offline');
  return (
    <span className="rd-online">
      <span className={`rd-online__dot ${online ? 'on' : 'off'}`} />
      <span className={online ? 'rd-online__label on' : 'rd-online__label off'}>{display}</span>
    </span>
  );
}
