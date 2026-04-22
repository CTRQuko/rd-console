import { X } from 'lucide-react';
import type { TagColor } from '@/types/api';

interface TagChipProps {
  name: string;
  color: TagColor;
  onRemove?: () => void;
  onClick?: () => void;
  /** When true, renders as a filter button with a selected indicator. */
  selected?: boolean;
  size?: 'sm' | 'md';
}

export function TagChip({
  name,
  color,
  onRemove,
  onClick,
  selected = false,
  size = 'md',
}: TagChipProps) {
  const cls = [
    'rd-tag-chip',
    `rd-tag-chip--${color}`,
    size === 'sm' ? 'rd-tag-chip--sm' : '',
    selected ? 'rd-tag-chip--selected' : '',
    onClick ? 'rd-tag-chip--clickable' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls} onClick={onClick}>
      <span className="rd-tag-chip__dot" />
      <span className="rd-tag-chip__name">{name}</span>
      {onRemove ? (
        <button
          type="button"
          className="rd-tag-chip__x"
          aria-label={`Remove ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X size={12} />
        </button>
      ) : null}
    </span>
  );
}
