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
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Download, FileJson, Trash2 } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import type { Column } from '@/components/DataTable';
import { Dialog } from '@/components/Dialog';
import { DropdownMenu } from '@/components/DropdownMenu';
import { Input } from '@/components/Input';
import { PageHeader } from '@/components/PageHeader';
import { Select } from '@/components/Select';
import { Toast, type ToastValue } from '@/components/Toast';
import {
  downloadLogs,
  formatAction,
  useDeleteLogs,
  useLogs,
  type LogsQuery,
} from '@/hooks/useLogs';
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

const VALID_RANGES: readonly RangeKey[] = ['today', '7d', '30d', 'all'];
const VALID_CATEGORIES: readonly AuditCategory[] = [
  'session',
  'auth',
  'user_management',
  'config',
];
const VALID_ACTIONS: readonly AuditActionValue[] = [
  'connect',
  'disconnect',
  'file_transfer',
  'close',
  'login',
  'login_failed',
  'user_created',
  'user_updated',
  'user_disabled',
  'settings_changed',
  'device_updated',
  'device_forgotten',
  'device_disconnect_requested',
];

export function LogsPage() {
  // Seed filters from the URL so Dashboard links like /logs?category=session
  // or /logs?actor=<id> land with the filter applied.
  const [searchParams] = useSearchParams();
  const initRange = (searchParams.get('range') ?? '') as RangeKey;
  const initCategory = (searchParams.get('category') ?? '') as AuditCategory;
  const initAction = (searchParams.get('action') ?? '') as AuditActionValue;
  const initActor = searchParams.get('actor') ?? '';

  const [range, setRange] = useState<RangeKey>(
    VALID_RANGES.includes(initRange) ? initRange : '7d',
  );
  const [category, setCategory] = useState<'' | AuditCategory>(
    VALID_CATEGORIES.includes(initCategory) ? initCategory : '',
  );
  const [action, setAction] = useState<'' | AuditActionValue>(
    VALID_ACTIONS.includes(initAction) ? initAction : '',
  );
  const [actor, setActor] = useState(initActor);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  // "Type DELETE to confirm" — the high-friction gate on a destructive bulk
  // action. Cleared whenever the dialog opens fresh.
  const [confirmText, setConfirmText] = useState('');
  const deleteMut = useDeleteLogs();
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

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Leader checkbox covers the CURRENT page only — crossing pages would
  // silently select rows the admin can't see, which is exactly the kind
  // of footgun the "type DELETE" gate is there to avoid, but let's not
  // tempt it by also leaking selection across pages.
  const pageIds = rows.map((r) => r.id);
  const allSelectedOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someSelectedOnPage =
    !allSelectedOnPage && pageIds.some((id) => selected.has(id));

  const toggleSelectPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelectedOnPage) {
        // Deselect everything on this page.
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  };

  const openConfirm = () => {
    setConfirmText('');
    setConfirmOpen(true);
  };

  const submitDelete = () => {
    if (confirmText !== 'DELETE') return;
    const ids = Array.from(selected);
    deleteMut.mutate(ids, {
      onSuccess: (result) => {
        setConfirmOpen(false);
        setSelected(new Set());
        const skipped = result.skipped.length;
        const msg =
          skipped === 0
            ? `${result.affected} log entr${result.affected === 1 ? 'y' : 'ies'} deleted.`
            : `${result.affected} deleted, ${skipped} skipped (${result.skipped
                .map((s) => s.reason)
                .join(', ')}).`;
        setToast({ kind: skipped === 0 ? 'ok' : 'error', text: msg });
      },
      onError: (err) =>
        setToast({ kind: 'error', text: apiErrorMessage(err) }),
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
      key: 'select',
      header: (
        <input
          type="checkbox"
          aria-label="Select all on this page"
          checked={allSelectedOnPage}
          ref={(el) => {
            // React has no native "indeterminate" attribute — poke the DOM
            // directly. Doesn't trigger a re-render since it's a prop on the
            // raw element, not a React-managed state.
            if (el) el.indeterminate = someSelectedOnPage;
          }}
          onChange={toggleSelectPage}
          onClick={(e) => e.stopPropagation()}
        />
      ),
      width: 28,
      cell: (r) => (
        <input
          type="checkbox"
          aria-label={`Select log ${r.id}`}
          checked={selected.has(r.id)}
          onChange={() => toggleSelect(r.id)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },
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
          {selected.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              icon={Trash2}
              onClick={openConfirm}
            >
              Delete {selected.size}
            </Button>
          )}
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

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Delete ${selected.size} log entr${selected.size === 1 ? 'y' : 'ies'}?`}
        width={480}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={submitDelete}
              disabled={confirmText !== 'DELETE' || deleteMut.isPending}
            >
              {deleteMut.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <div className="rd-form">
          <div
            role="alert"
            style={{
              display: 'flex', gap: 10, alignItems: 'flex-start',
              padding: '10px 12px', borderRadius: 8,
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              color: 'var(--fg)', fontSize: 13, lineHeight: 1.45,
            }}
          >
            <div>
              Audit entries are the forensic record of actions on this panel.
              Deletion is <strong>soft</strong> — a <code>LOGS_DELETED</code>
              entry is written showing which IDs were purged, and rows
              created in the last <strong>30 days</strong> can never be
              deleted regardless of selection.
            </div>
          </div>
          <div className="rd-form__field" style={{ marginTop: 12 }}>
            <label className="rd-form__label" htmlFor="delete-confirm">
              Type <code>DELETE</code> to confirm
            </label>
            <input
              id="delete-confirm"
              className="rd-input"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              autoFocus
            />
          </div>
        </div>
      </Dialog>

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
                      <LogDetail r={r} />
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

/** Parse a payload string into a list of {key, value} pairs.
 *
 *  Handles three shapes emitted by backend routers today:
 *    1. JSON object — pretty-printed as-is.
 *    2. `key=value key=value …` — our common free-form shape. Values may
 *       contain spaces (e.g. `label=Abuela — laptop`), so we consume up to
 *       the next whitespace-separated `key=` token.
 *    3. Anything else — a single "value" row with the raw string.
 */
function parsePayload(raw: string | null): { key: string; value: string }[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === 'object') {
        return Object.entries(obj).map(([key, v]) => ({
          key,
          value: typeof v === 'string' ? v : JSON.stringify(v),
        }));
      }
    } catch {
      // fall through to the key=value branch
    }
  }
  // Match `key=` where key is word-chars followed by `=`. Value is the
  // smallest slice up to the next ` word=` boundary or end-of-string.
  const re = /(\w+)=(.*?)(?=\s+\w+=|$)/g;
  const out: { key: string; value: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    out.push({ key: m[1], value: m[2].trim() });
  }
  if (out.length === 0) {
    return [{ key: 'raw', value: trimmed }];
  }
  return out;
}

function fmtTimestamp(iso: string): string {
  // The API returns `YYYY-MM-DDTHH:MM:SS[.ffff]` UTC. Render as
  // `YYYY-MM-DD HH:MM:SS UTC` — readable, unambiguous, no client TZ
  // surprises when comparing against server-side filters.
  return iso.replace('T', ' ').replace(/\..*$/, '') + ' UTC';
}

/** Render a row's expanded detail as a key/value table + raw JSON escape hatch.
 *
 *  Previously this was `<pre>{JSON.stringify(row)}</pre>` — user feedback
 *  called it out as unreadable "source code". The new layout surfaces the
 *  fields an admin actually scans for (who / when / what / target) at the
 *  top, then lists the parsed payload keys, then keeps a collapsed "raw"
 *  section for power users who want to grep.
 */
function LogDetail({ r }: { r: ApiAuditLog }): ReactElement {
  const payloadKvs = parsePayload(r.payload);

  const rows: { label: string; value: ReactElement | string }[] = [
    { label: 'When', value: <span className="rd-mono">{fmtTimestamp(r.created_at)}</span> },
    { label: 'Action', value: formatAction(r) },
    {
      label: 'Actor',
      value:
        r.actor_username
          ? `${r.actor_username}${r.actor_user_id ? ` (id ${r.actor_user_id})` : ''}`
          : r.actor_user_id
            ? `user id ${r.actor_user_id}`
            : 'system / unauthenticated',
    },
  ];
  if (r.from_id) rows.push({ label: 'From', value: <span className="rd-mono">{r.from_id}</span> });
  if (r.to_id) rows.push({ label: 'To', value: <span className="rd-mono">{r.to_id}</span> });
  if (r.ip) rows.push({ label: 'IP', value: <span className="rd-mono">{r.ip}</span> });
  if (r.uuid) rows.push({ label: 'UUID', value: <span className="rd-mono">{r.uuid}</span> });

  return (
    <div className="rd-log-detail" style={{ padding: '12px 16px' }}>
      <table
        className="rd-kv"
        style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
      >
        <tbody>
          {rows.map(({ label, value }) => (
            <tr key={label}>
              <th
                scope="row"
                style={{
                  textAlign: 'left',
                  padding: '4px 12px 4px 0',
                  color: 'var(--fg-muted)',
                  fontWeight: 500,
                  width: 120,
                  verticalAlign: 'top',
                }}
              >
                {label}
              </th>
              <td style={{ padding: '4px 0' }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {payloadKvs.length > 0 && (
        <>
          <div
            style={{
              marginTop: 12,
              marginBottom: 4,
              color: 'var(--fg-muted)',
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: 0.6,
            }}
          >
            Payload
          </div>
          <table
            className="rd-kv"
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
          >
            <tbody>
              {payloadKvs.map(({ key, value }) => (
                <tr key={key}>
                  <th
                    scope="row"
                    style={{
                      textAlign: 'left',
                      padding: '4px 12px 4px 0',
                      color: 'var(--fg-muted)',
                      fontWeight: 500,
                      width: 120,
                      verticalAlign: 'top',
                    }}
                  >
                    {key}
                  </th>
                  <td style={{ padding: '4px 0' }}>
                    <span className="rd-mono">{value}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <details style={{ marginTop: 12 }}>
        <summary
          style={{ color: 'var(--fg-muted)', fontSize: 12, cursor: 'pointer' }}
        >
          Raw JSON
        </summary>
        <pre
          className="rd-log-payload"
          style={{ marginTop: 6, fontSize: 12 }}
        >
{JSON.stringify(
  {
    id: r.id,
    created_at: r.created_at,
    action: r.action,
    actor_user_id: r.actor_user_id,
    actor_username: r.actor_username,
    from_id: r.from_id,
    to_id: r.to_id,
    ip: r.ip,
    uuid: r.uuid,
    payload: r.payload,
  },
  null,
  2,
)}
        </pre>
      </details>
    </div>
  );
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
