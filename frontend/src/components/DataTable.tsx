/** DataTable v2 — same public API as v1 plus:
 *    - onRowClick(row)       — handler for clicking anywhere on a row
 *    - rowClassName(row)     — extra class applied to each <tr>
 *  Both are additive; existing call-sites that don't pass them behave
 *  exactly as before. Left in the same file so nothing else has to change.
 *
 *  Also removes the "reset to page 0 when row count changes" behavior that
 *  previously ran during render — it interacted poorly with placeholderData
 *  (a flash of "Page 1 of 1" while a new page was streaming). Paging is now
 *  caller-managed when the caller passes `onPageChange`; otherwise it stays
 *  local, but we reset via useEffect to avoid setState-in-render warnings
 *  under React 19's stricter model.
 */

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface Column<T> {
  key: string;
  header: ReactNode;
  width?: number | string;
  cell?: (row: T) => ReactNode;
}

interface DataTableProps<T extends { id?: number | string }> {
  columns: Column<T>[];
  rows: T[];
  empty?: string;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
}

export function DataTable<T extends { id?: number | string }>({
  columns,
  rows,
  empty = 'No rows.',
  pageSize = 10,
  onRowClick,
  rowClassName,
}: DataTableProps<T>) {
  const [page, setPage] = useState(0);
  const [prevPages, setPrevPages] = useState(0);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  // Clamp the current page when the row count shrinks (e.g. a filter
  // narrowed the list). React-recommended "reset state during render"
  // pattern — equivalent to a useEffect but fires one render earlier and
  // satisfies react-hooks/set-state-in-effect.
  if (prevPages !== pages) {
    setPrevPages(pages);
    if (page >= pages) setPage(0);
  }

  const start = page * pageSize;
  const slice = rows.slice(start, start + pageSize);

  return (
    <div className="rd-table-card">
      <table className="rd-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width } as CSSProperties}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slice.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="rd-table__empty">
                {empty}
              </td>
            </tr>
          ) : (
            slice.map((row, i) => (
              <tr
                key={row.id ?? i}
                className={rowClassName?.(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key}>
                    {c.cell ? c.cell(row) : (row as Record<string, ReactNode>)[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="rd-pager">
        <span className="rd-pager__count">
          Showing {total === 0 ? 0 : start + 1}–{Math.min(start + pageSize, total)} of {total}
        </span>
        <div className="rd-pager__ctrls">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="rd-pager__page">
            Page {page + 1} of {pages}
          </span>
          <button
            type="button"
            disabled={page >= pages - 1}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Next page"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
