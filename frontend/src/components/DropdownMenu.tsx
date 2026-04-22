/** Dropdown menu primitive.
 *
 *  Triggered by a button (rendered by the consumer via `trigger`), opens an
 *  absolutely-positioned list of items. Keyboard: ↑/↓ to move between
 *  items, Enter/Space to activate, Escape to close.
 *
 *  We deliberately keep this minimal — no portal, no sub-menus. The menu
 *  panel is position:absolute inside a relative wrapper so it inherits the
 *  correct stacking context without needing a z-index above the sidebar.
 */

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, KeyboardEvent, ReactElement, ReactNode } from 'react';

export interface DropdownMenuItem {
  /** Stable id — used as React key + aria-activedescendant target. */
  id: string;
  label: ReactNode;
  /** Callback fired on activation. Leave undefined for a divider. */
  onSelect?: () => void;
  destructive?: boolean;
  /** If true, renders a thin separator instead of a row. */
  divider?: boolean;
  /** Hide completely when the ancestor lacks permission, etc. */
  hidden?: boolean;
  /** Disable but render — communicates "not available right now". */
  disabled?: boolean;
}

interface DropdownMenuProps {
  /** The trigger element. Must accept `ref` + `onClick` + `aria-*` props. */
  trigger: ReactElement;
  items: DropdownMenuItem[];
  /** Accessible label used on the floating menu element. */
  ariaLabel?: string;
  /** Align the menu to the right edge of the trigger (default) or the left. */
  align?: 'start' | 'end';
  /** Menu width in px. Default 200. */
  width?: number;
}

export function DropdownMenu({
  trigger,
  items,
  ariaLabel = 'Actions',
  align = 'end',
  width = 200,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const menuId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Indexes of items that are focusable (skip dividers + hidden).
  const focusable = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => !it.divider && !it.hidden && !it.disabled)
    .map(({ i }) => i);

  const close = useCallback(
    (returnFocus = true) => {
      setOpen(false);
      if (returnFocus && triggerRef.current) {
        triggerRef.current.focus();
      }
    },
    [],
  );

  // Global dismissers: outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey as EventListener);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey as EventListener);
    };
  }, [open, close]);

  const onTriggerClick = () => {
    // Re-seed the active index to the first focusable item whenever we
    // open the menu. Doing it here (in the handler) keeps the effect body
    // pure — React prefers setState in event handlers over effects.
    if (!open && focusable.length > 0) setActive(focusable[0]);
    setOpen((v) => !v);
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const pos = focusable.indexOf(active);
      const next = focusable[(pos + 1 + focusable.length) % focusable.length];
      setActive(next);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const pos = focusable.indexOf(active);
      const next = focusable[(pos - 1 + focusable.length) % focusable.length];
      setActive(next);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(focusable[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(focusable[focusable.length - 1]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const it = items[active];
      if (it && !it.disabled && !it.divider && !it.hidden) {
        it.onSelect?.();
        close(true);
      }
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  // Inject click + ref + aria onto the consumer-provided trigger.
  if (!isValidElement(trigger)) {
    throw new Error('<DropdownMenu> trigger must be a valid React element');
  }
  type TriggerProps = {
    ref?: (node: HTMLElement | null) => void;
    onClick?: (e: React.MouseEvent<HTMLElement>) => void;
    'aria-haspopup'?: string;
    'aria-expanded'?: boolean;
    'aria-controls'?: string;
  };
  const triggerProps = trigger.props as TriggerProps & { onClick?: TriggerProps['onClick'] };
  // The ref callback only writes to a ref mutable cell — it never reads
  // during render — so the "refs during render" lint is a false positive
  // here. We need the callback form specifically so cloneElement can merge
  // with any ref the caller already attached to the trigger.
  // eslint-disable-next-line react-hooks/refs
  const enhancedTrigger = cloneElement<TriggerProps>(trigger as ReactElement<TriggerProps>, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
    },
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      triggerProps.onClick?.(e);
      onTriggerClick();
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': menuId,
  });

  const menuStyle: CSSProperties = {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    [align === 'end' ? 'right' : 'left']: 0,
    width,
    zIndex: 50,
  };

  return (
    <span
      ref={rootRef}
      className="rd-dropdown-root"
      style={{ position: 'relative', display: 'inline-block' }}
    >
      {enhancedTrigger}
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          className="rd-dropdown"
          style={menuStyle}
          onKeyDown={onMenuKey}
          tabIndex={-1}
          // Move focus onto the menu so arrow keys work immediately.
          ref={(node) => {
            if (node) requestAnimationFrame(() => node.focus());
          }}
        >
          {items.map((it, i) => {
            if (it.hidden) return null;
            if (it.divider) {
              return <div key={it.id} className="rd-dropdown__divider" role="separator" />;
            }
            const isActive = i === active;
            return (
              <button
                key={it.id}
                type="button"
                role="menuitem"
                className={`rd-dropdown__item ${isActive ? 'active' : ''} ${
                  it.destructive ? 'destructive' : ''
                }`}
                disabled={it.disabled}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  it.onSelect?.();
                  close(true);
                }}
              >
                {it.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}
