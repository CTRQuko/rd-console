import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Monitor, Search, Users as UsersIcon, X } from 'lucide-react';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { useDateTime } from '@/lib/formatters';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

type CommandKind = 'user' | 'device' | 'log';

interface CommandItem {
  kind: CommandKind;
  label: string;
  sublabel?: string;
  href: string;
}

const KIND_LABEL: Record<CommandKind, string> = {
  user: 'Users',
  device: 'Devices',
  log: 'Logs',
};

const KIND_ICON = {
  user: UsersIcon,
  device: Monitor,
  log: FileText,
} as const;

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const { data, isFetching } = useGlobalSearch(query, open);
  const { fmt } = useDateTime();

  const items: CommandItem[] = useMemo(() => {
    if (!data) return [];
    return [
      ...data.users.map<CommandItem>((u) => ({
        kind: 'user',
        label: u.username,
        sublabel: u.email ?? undefined,
        href: '/users',
      })),
      ...data.devices.map<CommandItem>((d) => ({
        kind: 'device',
        label: d.hostname ?? d.rustdesk_id,
        sublabel: d.rustdesk_id,
        href: '/devices',
      })),
      ...data.logs.map<CommandItem>((li) => ({
        kind: 'log',
        label: `${li.action} — ${li.actor_username ?? li.from_id ?? li.to_id ?? 'system'}`,
        sublabel: fmt(li.created_at),
        href: '/logs',
      })),
    ];
  }, [data, fmt]);

  // Auto-focus on mount. The parent returns null when `!open`, so each
  // opening is a fresh mount — state resets to its initial useState values
  // without needing a setState-in-effect (which React's stricter lint rule
  // would flag).
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  // Clamp active during render so the selection can never point past the
  // current items list length.
  const clamped = Math.min(active, Math.max(0, items.length - 1));
  if (clamped !== active) setActive(clamped);

  const pick = (i: number) => {
    const it = items[i];
    if (!it) return;
    navigate(it.href);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, Math.max(0, items.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        pick(active);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, active, items.length, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  // Render items grouped by kind, preserving a flat index for keyboard nav.
  const groups: { kind: CommandKind; items: CommandItem[]; offset: number }[] = [];
  let flatIndex = 0;
  (['user', 'device', 'log'] as const).forEach((k) => {
    const g = items.filter((it) => it.kind === k);
    if (g.length) {
      groups.push({ kind: k, items: g, offset: flatIndex });
      flatIndex += g.length;
    }
  });

  return (
    <div
      className="rd-palette-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="rd-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rd-palette__head">
          <Search size={16} />
          <input
            ref={inputRef}
            className="rd-palette__input"
            type="text"
            value={query}
            placeholder="Search users, devices, logs…"
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Global search input"
          />
          <button
            type="button"
            className="rd-iconbtn"
            onClick={onClose}
            aria-label="Close search"
          >
            <X size={14} />
          </button>
        </div>
        <div className="rd-palette__body">
          {query.trim() === '' ? (
            <div className="rd-palette__hint">
              Type to search users, devices and logs. Arrow keys to move, Enter to open.
            </div>
          ) : items.length === 0 ? (
            <div className="rd-palette__hint">
              {isFetching ? 'Searching…' : 'No matches.'}
            </div>
          ) : (
            groups.map(({ kind, items: gItems, offset }) => (
              <div key={kind} className="rd-palette__group">
                <div className="rd-palette__group-label">{KIND_LABEL[kind]}</div>
                <ul role="listbox">
                  {gItems.map((it, i) => {
                    const idx = offset + i;
                    const Icon = KIND_ICON[it.kind];
                    return (
                      <li key={`${kind}-${i}`} role="option" aria-selected={idx === active}>
                        <button
                          type="button"
                          className={`rd-palette__row ${idx === active ? 'active' : ''}`}
                          onMouseEnter={() => setActive(idx)}
                          onClick={() => pick(idx)}
                        >
                          <Icon size={14} />
                          <span className="rd-palette__label">{it.label}</span>
                          {it.sublabel ? (
                            <span className="rd-palette__sub">{it.sublabel}</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
        <div className="rd-palette__foot">
          <kbd>↑</kbd> <kbd>↓</kbd> move
          <span className="rd-palette__sep">·</span>
          <kbd>Enter</kbd> open
          <span className="rd-palette__sep">·</span>
          <kbd>Esc</kbd> close
        </div>
      </div>
    </div>
  );
}
