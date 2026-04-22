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
}

export function DataTable<T extends { id?: number | string }>({
  columns,
  rows,
  empty = 'No rows.',
  pageSize = 10,
}: DataTableProps<T>) {
  const [page, setPage] = useState(0);
  const [prevTotal, setPrevTotal] = useState(rows.length);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  // Reset to page 0 when the row count changes (e.g. a filter narrowed the
  // list). This runs during render — the React-recommended pattern for
  // "reset state on prop change" without an extra useEffect pass.
  if (prevTotal !== total) {
    setPrevTotal(total);
    setPage(0);
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
              <tr key={row.id ?? i}>
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
