/** Collapsible — <details>/<summary>-backed accordion section.
 *
 *  Zero-JS toggle: the native `<details>` element handles the open/close
 *  state and the keyboard interaction (Enter/Space on the summary is
 *  free, arrow-scrolling works as expected, screen readers announce the
 *  expanded state). We only layer styling + a rotating chevron.
 *
 *  Compound API:
 *    <Collapsible defaultOpen title="Section">
 *      ...body...
 *    </Collapsible>
 *
 *  The `title` can be a ReactNode for richer headers (e.g. icon + label
 *  + helper text). Optional `summary` slot renders a secondary line
 *  under the title, visible collapsed-or-expanded — useful to preview
 *  the current value ("Date/time format — system").
 *
 *  Accessibility: `<details>` is a first-class interactive element.
 *  Don't wrap `summary` in an extra `<button>` (double-semantics),
 *  don't hide the marker on `<summary>` at the element level (breaks
 *  native ARIA announcement on some browsers) — instead nulling the
 *  marker via CSS on `::-webkit-details-marker` + removing `list-style`
 *  keeps the ARIA tree intact while visually hiding the triangle.
 */

import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

interface CollapsibleProps {
  /** Main header text or node (e.g. icon + label). */
  title: ReactNode;
  /** Optional second line — shown next to/under the title. Good for
   *  surfacing the current value when the section is closed. */
  summary?: ReactNode;
  /** Open by default. Matches the <details> `open` attribute; users
   *  toggling manually override this. */
  defaultOpen?: boolean;
  /** Content shown when expanded. */
  children: ReactNode;
}

export function Collapsible({
  title,
  summary,
  defaultOpen = true,
  children,
}: CollapsibleProps) {
  return (
    <details className="rd-collapsible" open={defaultOpen}>
      <summary className="rd-collapsible__summary">
        <ChevronRight size={16} className="rd-collapsible__chevron" />
        <span className="rd-collapsible__title">{title}</span>
        {summary ? (
          <span className="rd-collapsible__hint">{summary}</span>
        ) : null}
      </summary>
      <div className="rd-collapsible__body">{children}</div>
    </details>
  );
}
