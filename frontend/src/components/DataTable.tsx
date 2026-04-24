/** DataTable v3 — adds opt-in multi-select with leader checkbox + per-row
 *  checkbox. Existing call-sites that don't pass `selectable` see no change.
 *
 *  v2 shape preserved:
 *    - onRowClick(row) / rowClassName(row) additive props
 *    - "reset to page 0 when row count changes" via render-time setState
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
  empty?: ReactNode;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  /** Opt-in: render checkboxes. Pass controlled `selectedIds` + `onSelectionChange`. */
  selectable?: boolean;
  selectedIds?: (number | string)[];
  onSelectionChange?: (ids: (number | string)[]) => void;
  /** Extractor used when row.id isn't set directly. Defaults to `row.id`. */
  getRowId?: (row: T) => number | string;
}

export function DataTable<T extends { id?: number | string }>({
  columns,
  rows,
  empty = 'No rows.',
  pageSize = 10,
  onRowClick,
  rowClassName,
  selectable = false,
  selectedIds,
  onSelectionChange,
  getRowId,
}: DataTableProps<T>) {
  const [page, setPage] = useState(0);
  const [prevPages, setPrevPages] = useState(0);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  if (prevPages !== pages) {
    setPrevPages(pages);
    if (page >= pages) setPage(0);
  }

  const start = page * pageSize;
  const slice = rows.slice(start, start + pageSize);

  const idOf = (r: T): number | string => (getRowId ? getRowId(r) : (r.id as number | string));

  // Leader checkbox reflects the state of the CURRENT page only — selecting
  // all across pages is a footgun we deliberately don't expose.
  const selectedOnPage = selectable
    ? slice.filter((r) => (selectedIds ?? []).includes(idOf(r))).length
    : 0;
  const leaderChecked = selectable && selectedOnPage > 0 && selectedOnPage === slice.length;
  const leaderIndeterminate =
    selectable && selectedOnPage > 0 && selectedOnPage < slice.length;

  const toggleLeader = () => {
    if (!onSelectionChange) return;
    const idsOnPage = slice.map(idOf);
    const next = new Set(selectedIds ?? []);
    if (leaderChecked) {
      idsOnPage.forEach((i) => next.delete(i));
    } else {
      idsOnPage.forEach((i) => next.add(i));
    }
    onSelectionChange(Array.from(next));
  };

  const toggleRow = (row: T) => {
    if (!onSelectionChange) return;
    const id = idOf(row);
    const next = new Set(selectedIds ?? []);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(Array.from(next));
  };

  return (
    <div className="rd-table-card">
      <table className="rd-table">
        <thead>
          <tr>
            {selectable ? (
              <th className="rd-table__check-cell">
                <input
                  type="checkbox"
                  className="rd-table__checkbox"
                  checked={leaderChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = leaderIndeterminate;
                  }}
                  onChange={toggleLeader}
                  aria-label="Select all on page"
                />
              </th>
            ) : null}
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
              <td
                colSpan={columns.length + (selectable ? 1 : 0)}
                className="rd-table__empty"
              >
                {empty}
              </td>
            </tr>
          ) : (
            slice.map((row, i) => {
              const id = idOf(row);
              const isSelected = selectable && (selectedIds ?? []).includes(id);
              return (
                <tr
                  key={row.id ?? i}
                  className={[
                    rowClassName?.(row) ?? '',
                    isSelected ? 'rd-log-row expanded' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {selectable ? (
                    <td
                      className="rd-table__check-cell"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="rd-table__checkbox"
                        checked={isSelected}
                        onChange={() => toggleRow(row)}
                        aria-label={`Select row ${id}`}
                      />
                    </td>
                  ) : null}
                  {columns.map((c) => (
                    <td key={c.key}>
                      {c.cell ? c.cell(row) : (row as Record<string, ReactNode>)[c.key]}
                    </td>
                  ))}
                </tr>
              );
            })
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
