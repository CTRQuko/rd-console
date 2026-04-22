/** LogsPage v2 — server-side filtering + paging + CSV/NDJSON export.
 *
 *  The filters translate directly into backend query params (category,
 *  action, since, actor) and we push them through useLogs(). Paging is
 *  offset/limit; placeholderData keeps the previous page visible while a
 *  new page loads so the table doesn't collapse.
 *
 *  Each row is expandable — clicking it reveals the JSON payload in a
 *  <pre> panel. This is the one audit "deep dive" affordance; everything
 *  else stays as a clean tabular view.
 */

import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { ChevronDown, ChevronRight, Download, FileJson } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import type { Column } from '@/components/DataTable';
import { DropdownMenu } from '@/components/DropdownMenu';
import { Input } from '@/components/Input';
import { PageHeader } from '@/components/PageHeader';
import { Select } from '@/components/Select';
import { Toast, type ToastValue } from '@/components/Toast';
import { downloadLogs, formatAction, useLogs, type LogsQuery } from '@/hooks/useLogs';
import { apiErrorMessage } from '@/lib/api';
import type { ApiAuditLog, AuditActionValue, AuditCategory } from '@/types/api';

type RangeKey = 'today' | '7d' | '30d' | 'all';

const RANGES: { value: RangeKey; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

const CATEGORIES: { value: '' | AuditCategory; label: string }[] = [
  { value: '', label: 'All categories' },
  { value: 'session', label: 'Session' },
  { value: 'auth', label: 'Auth' },
  { value: 'user_management', label: 'User management' },
  { value: 'config', label: 'Config / device' },
];

/** ISO timestamp that's N days before "now". `all` → undefined. */
function sinceFromRange(range: RangeKey): string | undefined {
  if (range === 'all') return undefined;
  const d = new Date();
  if (range === 'today') {
    d.setHours(0, 0, 0, 0);
  } else if (range === '7d') {
    d.setDate(d.getDate() - 7);
  } else {
    d.setDate(d.getDate() - 30);
  }
  return d.toISOString();
}

const PAGE_SIZE = 25;

export function LogsPage() {
  const [range, setRange] = useState<RangeKey>('7d');
  const [category, setCategory] = useState<'' | AuditCategory>('');
  const [action, setAction] = useState<'' | AuditActionValue>('');
  const [actor, setActor] = useState('');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState<ToastValue | null>(null);

  // Debounce the actor text so we don't thrash the backend on every keystroke.
  const actorDebounced = useDebounced(actor, 300);

  const query: LogsQuery = useMemo(
    () => ({
      category: category || undefined,
      action: action || undefined,
      actor: actorDebounced || undefined,
      since: sinceFromRange(range),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [category, action, actorDebounced, range, page],
  );

  const { data, isFetching } = useLogs(query);
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetPageOnFilter = <T,>(fn: (v: T) => void) => (v: T) => {
    setPage(0);
    fn(v);
  };

  const triggerExport = (format: 'csv' | 'ndjson') => {
    downloadLogs({ ...query, limit: undefined, offset: undefined }, format)
      .then(() => setToast({ kind: 'ok', text: `Export (${format}) ready.` }))
      .catch((err) => setToast({ kind: 'error', text: apiErrorMessage(err) }));
  };

  const columns: Column<ApiAuditLog>[] = [
    {
      key: 'expand',
      header: '',
      width: 32,
      cell: (r) => (
        <button
          type="button"
          className="rd-log-expand-btn"
          aria-label={expanded.has(r.id) ? 'Collapse' : 'Expand'}
          aria-expanded={expanded.has(r.id)}
          onClick={(e) => {
            e.stopPropagation();
            toggleExpand(r.id);
          }}
        >
          {expanded.has(r.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      ),
    },
    {
      key: 'created_at',
      header: 'Time',
      cell: (r) => (
        <span className="rd-mono" style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
          {r.created_at.slice(0, 19).replace('T', ' ')}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      cell: (r) => <Badge variant={variantForAction(r.action)}>{formatAction(r)}</Badge>,
    },
    {
      key: 'actor',
      header: 'Actor',
      cell: (r) => {
        if (r.actor_username) return <span>{r.actor_username}</span>;
        if (r.from_id)
          return (
            <span className="rd-mono" style={{ color: 'var(--fg-muted)' }}>
              {r.from_id}
            </span>
          );
        return <span style={{ color: 'var(--fg-muted)' }}>system</span>;
      },
    },
    {
      key: 'to_id',
      header: 'Target',
      cell: (r) => (
        <span className="rd-mono" style={{ color: 'var(--fg-muted)' }}>
          {r.to_id ?? '—'}
        </span>
      ),
    },
    {
      key: 'ip',
      header: 'IP',
      cell: (r) => (
        <span className="rd-mono" style={{ color: 'var(--fg-muted)' }}>
          {r.ip ?? '—'}
        </span>
      ),
    },
  ];

  // DataTable only supports one row per entry; render a virtual "expanded"
  // row inline by augmenting `rowClassName` + adding the payload block as a
  // second tbody sibling. Because DataTable doesn't support custom row
  // renderers, we wrap the whole table in our own expandable <table> below.
  return (
    <>
      <PageHeader title="Audit logs" />
      <div className="rd-toolbar">
        <div className="rd-toolbar__group" style={{ flexWrap: 'wrap' }}>
          <Select
            value={range}
            onChange={resetPageOnFilter((e) => setRange(e.target.value as RangeKey))}
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
          <Select
            value={category}
            onChange={resetPageOnFilter((e) =>
              setCategory(e.target.value as '' | AuditCategory),
            )}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <Select
            value={action}
            onChange={resetPageOnFilter((e) =>
              setAction(e.target.value as '' | AuditActionValue),
            )}
          >
            <option value="">All actions</option>
            <option value="connect">connect</option>
            <option value="disconnect">disconnect</option>
            <option value="file_transfer">file transfer</option>
            <option value="close">close</option>
            <option value="login">login</option>
            <option value="login_failed">login failed</option>
            <option value="user_created">user created</option>
            <option value="user_updated">user updated</option>
            <option value="user_disabled">user disabled</option>
            <option value="settings_changed">settings changed</option>
            <option value="device_updated">device updated</option>
            <option value="device_forgotten">device forgotten</option>
            <option value="device_disconnect_requested">device disconnect</option>
          </Select>
          <Input
            placeholder="Actor or RustDesk ID…"
            value={actor}
            onChange={resetPageOnFilter((e) => setActor(e.target.value))}
            style={{ width: 220 }}
          />
        </div>
        <div className="rd-toolbar__group">
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            {isFetching ? 'Loading…' : `${total.toLocaleString()} event${total === 1 ? '' : 's'}`}
          </span>
          <DropdownMenu
            ariaLabel="Export menu"
            trigger={
              <Button variant="secondary" size="sm" icon={Download}>
                Export
              </Button>
            }
            items={[
              {
                id: 'csv',
                label: 'Export CSV',
                onSelect: () => triggerExport('csv'),
              },
              {
                id: 'ndjson',
                label: (
                  <>
                    <FileJson size={14} /> Export NDJSON
                  </>
                ),
                onSelect: () => triggerExport('ndjson'),
              },
            ]}
          />
        </div>
      </div>

      {/* Expandable table (custom rather than DataTable because we need the
          inline payload row). Uses the same rd-table CSS. */}
      <ExpandableLogTable
        rows={rows}
        columns={columns}
        empty={isFetching ? 'Loading…' : 'No log entries match your filters.'}
        expanded={expanded}
        onRowClick={(r) => toggleExpand(r.id)}
      />

      <Pager
        page={page}
        lastPage={lastPage}
        total={total}
        pageSize={PAGE_SIZE}
        onPage={(p) => setPage(p)}
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

function variantForAction(
  a: AuditActionValue,
): 'info' | 'transfer' | 'warn' | 'neutral' {
  if (a === 'connect') return 'info';
  if (a === 'file_transfer') return 'transfer';
  if (a === 'login_failed' || a === 'user_disabled' || a === 'device_forgotten')
    return 'warn';
  return 'neutral';
}

/* ── expandable table ────────────────────────────────────────── */

interface ExpandableLogTableProps {
  rows: ApiAuditLog[];
  columns: Column<ApiAuditLog>[];
  empty: string;
  expanded: Set<number>;
  onRowClick: (r: ApiAuditLog) => void;
}

function ExpandableLogTable({
  rows,
  columns,
  empty,
  expanded,
  onRowClick,
}: ExpandableLogTableProps) {
  if (rows.length === 0) {
    return <div className="rd-empty">{empty}</div>;
  }
  return (
    <div className="rd-table-wrap">
      <table className="rd-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={String(c.key)} style={{ width: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = expanded.has(r.id);
            const cells: ReactElement[] = columns.map((c) => (
              // Column.cell is optional in the shared type; every column in
              // this page defines one, so fall back to empty just to keep
              // TypeScript narrow. The fallback is unreachable in practice.
              <td key={String(c.key)}>{c.cell ? c.cell(r) : null}</td>
            ));
            return (
              <>
                <tr
                  key={r.id}
                  className={`rd-log-row ${isOpen ? 'expanded' : ''}`}
                  onClick={() => onRowClick(r)}
                >
                  {cells}
                </tr>
                {isOpen ? (
                  <tr key={`${r.id}-payload`} className="rd-log-row expanded">
                    <td colSpan={columns.length}>
                      <pre className="rd-log-payload">{formatPayload(r)}</pre>
                    </td>
                  </tr>
                ) : null}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatPayload(r: ApiAuditLog): string {
  const meta = {
    id: r.id,
    created_at: r.created_at,
    action: r.action,
    actor_user_id: r.actor_user_id,
    actor_username: r.actor_username,
    from_id: r.from_id,
    to_id: r.to_id,
    ip: r.ip,
    uuid: r.uuid,
  };
  let payload: unknown = r.payload;
  if (typeof r.payload === 'string' && r.payload.trim().startsWith('{')) {
    try {
      payload = JSON.parse(r.payload);
    } catch {
      // leave as string
    }
  }
  return JSON.stringify({ ...meta, payload }, null, 2);
}

/* ── pager ───────────────────────────────────────────────────── */

interface PagerProps {
  page: number;
  lastPage: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}

function Pager({ page, lastPage, total, pageSize, onPage }: PagerProps) {
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 4px',
        fontSize: 12,
        color: 'var(--fg-muted)',
      }}
    >
      <span>
        {total === 0
          ? '—'
          : `${from}–${to} of ${total.toLocaleString()}`}
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        <Button
          variant="secondary"
          size="sm"
          disabled={page === 0}
          onClick={() => onPage(Math.max(0, page - 1))}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= lastPage}
          onClick={() => onPage(Math.min(lastPage, page + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/* ── tiny debounce hook (local — not worth a new module) ─────── */

import { useEffect, useState as useReactState } from 'react';
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useReactState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms, setV]);
  return v;
}
