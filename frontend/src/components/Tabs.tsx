/** Tabs — minimal compound component for in-page section switching.
 *
 *  Scope: horizontal tab strip + lazy panels. Deliberately tiny:
 *  single context, no animation, no roving tabindex magic beyond what
 *  screen readers actually need. For URL-synced tabs, the parent wires
 *  `value` / `onChange` to `useSearchParams` — we keep this component
 *  router-agnostic so tests and non-routed usage stay simple.
 *
 *  ARIA: matches the WAI-ARIA "Tabs" pattern — `role=tablist` on the list,
 *  `role=tab` + `aria-selected` + `aria-controls` on each trigger,
 *  `role=tabpanel` + `aria-labelledby` on each panel. Arrow keys move
 *  focus between triggers; Home/End jump to first/last.
 */

import {
  createContext,
  useContext,
  useId,
  useMemo,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

interface TabsContextValue {
  value: string;
  onChange: (next: string) => void;
  /** Stable id prefix so panels and triggers can reference each other. */
  idBase: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error(
      'Tabs.List / Tabs.Trigger / Tabs.Panel must be used inside <Tabs>',
    );
  }
  return ctx;
}

interface TabsProps {
  value: string;
  onChange: (next: string) => void;
  children: ReactNode;
}

export function Tabs({ value, onChange, children }: TabsProps) {
  const idBase = useId();
  const ctx = useMemo<TabsContextValue>(
    () => ({ value, onChange, idBase }),
    [value, onChange, idBase],
  );
  return <TabsContext.Provider value={ctx}>{children}</TabsContext.Provider>;
}

interface ListProps {
  children: ReactNode;
  ariaLabel?: string;
}

function List({ children, ariaLabel }: ListProps) {
  // Arrow-key navigation between triggers. We capture at the list level so
  // individual triggers don't need to know about siblings.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.getAttribute('role') !== 'tab') return;
    const triggers = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    const idx = triggers.indexOf(target as HTMLButtonElement);
    if (idx === -1) return;
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % triggers.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + triggers.length) % triggers.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = triggers.length - 1;
    else return;
    e.preventDefault();
    triggers[next]?.focus();
  };

  return (
    <div
      className="rd-tabs"
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}

interface TriggerProps {
  value: string;
  children: ReactNode;
}

function Trigger({ value, children }: TriggerProps) {
  const { value: active, onChange, idBase } = useTabsContext();
  const selected = active === value;
  const triggerId = `${idBase}-tab-${value}`;
  const panelId = `${idBase}-panel-${value}`;
  return (
    <button
      type="button"
      role="tab"
      id={triggerId}
      aria-selected={selected}
      aria-controls={panelId}
      tabIndex={selected ? 0 : -1}
      className={`rd-tab ${selected ? 'active' : ''}`}
      onClick={() => onChange(value)}
    >
      {children}
    </button>
  );
}

interface PanelProps {
  value: string;
  children: ReactNode;
  /** When true, keep the panel mounted even while inactive — useful if
   *  the content has expensive-to-reinit state. Off by default because
   *  unmounting is the common "settings tabs" expectation. */
  keepMounted?: boolean;
}

function Panel({ value, children, keepMounted = false }: PanelProps) {
  const { value: active, idBase } = useTabsContext();
  const selected = active === value;
  if (!selected && !keepMounted) return null;
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${value}`}
      aria-labelledby={`${idBase}-tab-${value}`}
      hidden={!selected}
      className="rd-tab-panel"
    >
      {children}
    </div>
  );
}

Tabs.List = List;
Tabs.Trigger = Trigger;
Tabs.Panel = Panel;
