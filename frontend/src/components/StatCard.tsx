import type { ComponentType, ReactNode } from 'react';

type Tone = 'blue' | 'green' | 'zinc' | 'violet';
type TrendTone = 'up' | 'down' | 'muted';

interface StatCardProps {
  icon: ComponentType<{ size?: number | string; className?: string }>;
  iconTone?: Tone;
  label: string;
  value: ReactNode;
  trend?: ReactNode;
  trendTone?: TrendTone;
}

export function StatCard({
  icon: Icon,
  iconTone = 'blue',
  label,
  value,
  trend,
  trendTone = 'muted',
}: StatCardProps) {
  return (
    <div className="rd-stat">
      <div className="rd-stat__head">
        <div className={`rd-stat__icon rd-stat__icon--${iconTone}`}>
          <Icon size={18} />
        </div>
      </div>
      <div className="rd-stat__label">{label}</div>
      <div className="rd-stat__num">{value}</div>
      {trend ? <div className={`rd-stat__trend rd-stat__trend--${trendTone}`}>{trend}</div> : null}
    </div>
  );
}
