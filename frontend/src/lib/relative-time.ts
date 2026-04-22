/** Convert "minutes ago" into a short relative string for tables. */
export function relTime(mins: number): string {
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${Math.round(mins)} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
}
