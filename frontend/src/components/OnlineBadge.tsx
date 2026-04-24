import type { LastSeenTier } from '@/lib/formatters';

export interface OnlineBadgeProps {
  /** Legacy binary prop. When `tier` is omitted we render the historic
   *  `on` / `off` CSS classes so existing callsites and tests stay valid. */
  online?: boolean;
  /** Presence tier derived from `lastSeenStatus` — preferred when known.
   *  When provided, renders the tier-specific CSS class instead of
   *  `on` / `off`, and takes precedence over `online` for coloring. */
  tier?: LastSeenTier;
  /** Text shown next to the dot. Defaults to "Online"/"Offline" on the
   *  legacy path; callers of the tier path should always pass a label. */
  label?: string;
  /** Hover text. Renders as the DOM `title` attribute — no new deps. */
  tooltip?: string;
}

/** Which CSS class to put on `.rd-online__dot` and `.rd-online__label`.
 *  Two worlds kept on purpose: legacy (on/off) for the pre-v10 callsites
 *  and tests; tier for v10+ honest-presence. */
function classFor(props: OnlineBadgeProps): { cls: string; label: string } {
  if (props.tier) {
    return { cls: props.tier, label: props.label ?? '' };
  }
  // Legacy path — preserve `on` / `off` so existing CSS + tests still work.
  const cls = props.online ? 'on' : 'off';
  const label = props.label ?? (props.online ? 'Online' : 'Offline');
  return { cls, label };
}

export function OnlineBadge(props: OnlineBadgeProps) {
  const { cls, label } = classFor(props);
  const { tooltip, tier } = props;
  return (
    <span className="rd-online" title={tooltip} data-tier={tier ?? cls}>
      <span className={`rd-online__dot ${cls}`} />
      <span className={`rd-online__label ${cls}`}>{label}</span>
    </span>
  );
}
