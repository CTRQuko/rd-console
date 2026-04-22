import type { ReactNode } from 'react';

export type BadgeVariant =
  | 'neutral'
  | 'admin'
  | 'active'
  | 'disabled'
  | 'info'
  | 'transfer'
  | 'warn';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  dot?: boolean;
}

export function Badge({ variant = 'neutral', children, dot }: BadgeProps) {
  return (
    <span className={`rd-badge rd-badge--${variant}`}>
      {dot ? <span className="rd-badge__dot" /> : null}
      {children}
    </span>
  );
}
