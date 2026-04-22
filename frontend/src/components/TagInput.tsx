import { useState } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import type { Tag, TagColor } from '@/types/api';
import { TagChip } from './TagChip';

interface TagInputProps {
  /** Every tag available to assign. */
  all: Tag[];
  /** Currently assigned tag ids. */
  assignedIds: number[];
  /** Invoked when user picks an existing tag. */
  onAssign: (tagId: number) => void;
  /** Invoked when user picks an assigned tag (to remove it). */
  onUnassign: (tagId: number) => void;
  /** Optional: invoked when user types a new name + presses Enter. */
  onCreate?: (name: string, color: TagColor) => Promise<void> | void;
  disabled?: boolean;
}

/** Combobox-style editor: search + pick from existing tags, toggle assignment,
 *  or (if onCreate is provided) create a new tag inline when there's no
 *  match. Kept deliberately simple — no portal, no async suggestion.
 */
export function TagInput({
  all,
  assignedIds,
  onAssign,
  onUnassign,
  onCreate,
  disabled,
}: TagInputProps) {
  const [query, setQuery] = useState('');

  const qLower = query.trim().toLowerCase();
  const assignedSet = new Set(assignedIds);
  const filtered = qLower
    ? all.filter((t) => t.name.toLowerCase().includes(qLower))
    : all;
  const exactMatch = all.find((t) => t.name.toLowerCase() === qLower);
  const canCreate = Boolean(onCreate && qLower && !exactMatch);

  const handleCreate = async () => {
    if (!onCreate || !query.trim()) return;
    await onCreate(query.trim(), 'blue');
    setQuery('');
  };

  return (
    <div className="rd-tag-input">
      <label className="rd-tag-input__search">
        <Search size={14} />
        <input
          type="text"
          value={query}
          placeholder={onCreate ? 'Filter or create tag…' : 'Filter tags…'}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canCreate) {
              e.preventDefault();
              void handleCreate();
            }
          }}
          disabled={disabled}
        />
      </label>

      <ul className="rd-tag-input__list" role="listbox">
        {filtered.map((t) => {
          const isAssigned = assignedSet.has(t.id);
          return (
            <li key={t.id} className="rd-tag-input__item">
              <button
                type="button"
                disabled={disabled}
                className="rd-tag-input__row"
                onClick={() => (isAssigned ? onUnassign(t.id) : onAssign(t.id))}
                aria-pressed={isAssigned}
              >
                <TagChip name={t.name} color={t.color} size="sm" />
                {isAssigned ? <Check size={14} /> : null}
              </button>
            </li>
          );
        })}
        {canCreate ? (
          <li className="rd-tag-input__item">
            <button
              type="button"
              disabled={disabled}
              className="rd-tag-input__row rd-tag-input__row--create"
              onClick={() => void handleCreate()}
            >
              <Plus size={14} />
              <span>
                Create tag <strong>{query.trim()}</strong>
              </span>
            </button>
          </li>
        ) : null}
        {filtered.length === 0 && !canCreate ? (
          <li className="rd-tag-input__empty">No tags match.</li>
        ) : null}
      </ul>
    </div>
  );
}
