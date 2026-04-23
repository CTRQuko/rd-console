/** DevicesPage v3 — v2 shape + tags + notes + favourites + bulk ops.
 *
 *  The table rows are clickable (opens the drawer). The trailing dropdown
 *  is a sibling affordance — it stops event propagation so clicking
 *  "Edit owner" doesn't also open the drawer behind the dialog.
 *
 *  v3 additions:
 *    - Star column (toggle favorite per device, no confirm)
 *    - Tag list column with chips + filter dropdown
 *    - Note field editable in the drawer + persisted on Save
 *    - Multi-select via DataTable.selectable; bulk bar appears above the
 *      table when anything is selected, with assign tag / forget / favorite
 *      actions.
 */

import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MoreHorizontal, Star, Tag as TagIcon } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable, type Column } from '@/components/DataTable';
import { Dialog } from '@/components/Dialog';
import { Drawer } from '@/components/Drawer';
import { DropdownMenu } from '@/components/DropdownMenu';
import { OnlineBadge } from '@/components/OnlineBadge';
import { PageHeader } from '@/components/PageHeader';
import { PlatformIcon } from '@/components/PlatformIcon';
import { Select } from '@/components/Select';
import { TagChip } from '@/components/TagChip';
import { TagInput } from '@/components/TagInput';
import { Toast, type ToastValue } from '@/components/Toast';
import { useDeviceLogs } from '@/hooks/useLogs';
import {
  useDevices,
  useDisconnectDevice,
  useForgetDevice,
  useUpdateDevice,
} from '@/hooks/useDevices';
import {
  useAssignTag,
  useBulkUpdateDevices,
  useCreateTag,
  useTags,
  useUnassignTag,
} from '@/hooks/useTags';
import { useUsers } from '@/hooks/useUsers';
import { apiErrorMessage } from '@/lib/api';
import { formatAction } from '@/hooks/useLogs';
import type { ApiDevice, Platform, Tag } from '@/types/api';

type StatusFilter = 'All' | 'Online' | 'Offline';
type PlatformFilter = 'All' | Platform;

/** Minutes since a timestamp, UI-friendly. `null` → "Never". */
function relativeLastSeen(iso: string | null): string {
  if (!iso) return 'Never';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const secs = Math.max(0, Math.floor((now - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Normalise a URL search-param value against a whitelist so a bogus value
// (?status=pony) doesn't break rendering.
function clampFilter<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  if (!raw) return fallback;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

const STATUS_VALUES = ['All', 'Online', 'Offline'] as const;
const PLATFORM_VALUES = ['All', 'Windows', 'macOS', 'Linux', 'Android'] as const;

export function DevicesPage() {
  // Seed filters from the URL on mount so Dashboard links like
  // /devices?status=online actually land with the filter applied. After
  // mount we just keep local state — we don't push back to the URL because
  // the filter UI is ephemeral and URL-sync would fight React Router's
  // history model for no real benefit.
  const [searchParams] = useSearchParams();
  const initStatus = clampFilter<StatusFilter>(
    searchParams.get('status')?.replace(/^./, (c) => c.toUpperCase()) ?? null,
    STATUS_VALUES,
    'All',
  );
  const initPlatform = clampFilter<PlatformFilter>(
    searchParams.get('platform'),
    PLATFORM_VALUES,
    'All',
  );
  const initTag = (() => {
    const raw = searchParams.get('tag_id');
    if (!raw) return 'all' as const;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : ('all' as const);
  })();
  const initFav = searchParams.get('favorite') === 'true';

  // Client-side filters (status / platform) for UX parity with v2. Tag + fav
  // filters are pushed to the server so the dataset can stay small.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initStatus);
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>(initPlatform);
  const [tagFilter, setTagFilter] = useState<number | 'all'>(initTag);
  const [favoriteOnly, setFavoriteOnly] = useState(initFav);

  const { data: rows = [], isLoading } = useDevices({
    tag_id: tagFilter === 'all' ? null : tagFilter,
    favorite: favoriteOnly ? true : null,
  });
  const { data: users = [] } = useUsers();
  const { data: allTags = [] } = useTags();

  const update = useUpdateDevice();
  const forget = useForgetDevice();
  const disconnect = useDisconnectDevice();
  const assignTag = useAssignTag();
  const unassignTag = useUnassignTag();
  const createTag = useCreateTag();
  const bulk = useBulkUpdateDevices();

  const [selected, setSelected] = useState<ApiDevice | null>(null);
  const [confirmForget, setConfirmForget] = useState<ApiDevice | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<ApiDevice | null>(null);
  const [confirmBulkForget, setConfirmBulkForget] = useState(false);
  const [editOwner, setEditOwner] = useState<ApiDevice | null>(null);
  const [selectedIds, setSelectedIds] = useState<(number | string)[]>([]);
  const [bulkTagDialog, setBulkTagDialog] = useState(false);
  const [toast, setToast] = useState<ToastValue | null>(null);

  const usernamesById = useMemo(
    () => Object.fromEntries(users.map((u) => [u.id, u.username] as const)),
    [users],
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (statusFilter === 'Online' && !r.online) return false;
        if (statusFilter === 'Offline' && r.online) return false;
        if (platformFilter !== 'All' && r.platform !== platformFilter) return false;
        return true;
      }),
    [rows, statusFilter, platformFilter],
  );

  const selectedRows = filtered.filter((r) => selectedIds.includes(r.id));

  const toggleFavorite = (r: ApiDevice) => {
    update.mutate(
      { id: r.id, body: { is_favorite: !r.is_favorite } },
      {
        onError: (err) =>
          setToast({ kind: 'error', text: apiErrorMessage(err) }),
      },
    );
  };

  const columns: Column<ApiDevice>[] = [
    {
      key: 'favorite',
      header: '',
      width: 34,
      cell: (r) => (
        <button
          type="button"
          className={`rd-star ${r.is_favorite ? 'active' : ''}`}
          aria-label={r.is_favorite ? 'Unstar device' : 'Star device'}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(r);
          }}
        >
          <Star size={14} fill={r.is_favorite ? 'currentColor' : 'none'} />
        </button>
      ),
    },
    {
      key: 'online',
      header: 'Status',
      width: 100,
      cell: (r) => <OnlineBadge online={r.online} />,
    },
    {
      key: 'rustdesk_id',
      header: 'RustDesk ID',
      cell: (r) => <span className="rd-mono">{r.rustdesk_id}</span>,
    },
    {
      key: 'hostname',
      header: 'Hostname',
      cell: (r) => (
        <span style={{ fontWeight: 500 }}>{r.hostname ?? '—'}</span>
      ),
    },
    {
      key: 'platform',
      header: 'Platform',
      cell: (r) =>
        r.platform ? (
          <PlatformIcon platform={r.platform as Platform} />
        ) : (
          <span style={{ color: 'var(--fg-muted)' }}>—</span>
        ),
    },
    {
      key: 'tags',
      header: 'Tags',
      cell: (r) =>
        r.tags.length === 0 ? (
          <span style={{ color: 'var(--fg-subtle)' }}>—</span>
        ) : (
          <div className="rd-tag-list">
            {r.tags.map((t) => (
              <TagChip key={t.id} name={t.name} color={t.color} size="sm" />
            ))}
          </div>
        ),
    },
    {
      key: 'version',
      header: 'Version',
      cell: (r) => (
        <span className="rd-mono" style={{ color: 'var(--fg-muted)' }}>
          {r.version ?? '—'}
        </span>
      ),
    },
    {
      key: 'last_seen_at',
      header: 'Last seen',
      cell: (r) => (
        <span style={{ color: 'var(--fg-muted)' }}>
          {relativeLastSeen(r.last_seen_at)}
        </span>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      cell: (r) =>
        r.owner_user_id ? usernamesById[r.owner_user_id] ?? `#${r.owner_user_id}` : (
          <span style={{ color: 'var(--fg-muted)' }}>Unassigned</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      width: 56,
      cell: (r) => (
        <div
          style={{ display: 'flex', justifyContent: 'flex-end' }}
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu
            ariaLabel={`Actions for ${r.hostname ?? r.rustdesk_id}`}
            trigger={
              <Button
                variant="ghost"
                size="sm"
                icon={MoreHorizontal}
                aria-label={`Actions for ${r.hostname ?? r.rustdesk_id}`}
              />
            }
            items={[
              {
                id: 'open',
                label: 'Open details',
                onSelect: () => setSelected(r),
              },
              {
                id: 'owner',
                label: 'Edit owner…',
                onSelect: () => setEditOwner(r),
              },
              {
                id: 'disconnect',
                label: 'Disconnect…',
                disabled: !r.online,
                onSelect: () => setConfirmDisconnect(r),
              },
              { id: 'div', label: '', divider: true },
              {
                id: 'forget',
                label: 'Forget device…',
                destructive: true,
                onSelect: () => setConfirmForget(r),
              },
            ]}
          />
        </div>
      ),
    },
  ];

  const hasSelection = selectedIds.length > 0;

  return (
    <>
      <PageHeader
        title="Devices"
        subtitle="Clients that have connected to this server. Rows appear automatically when a RustDesk client points its ID/Relay here — you don't add devices manually. Metadata (hostname, platform, version) populates from the client's own sysinfo or the hbbs sync; a freshly-connected client can take up to ~30s to fill in. Auto-refreshes every 30s."
      />

      <div className="rd-toolbar">
        <div className="rd-toolbar__group">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option>All</option>
            <option>Online</option>
            <option>Offline</option>
          </Select>
          <Select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value as PlatformFilter)}
          >
            <option>All</option>
            <option>Windows</option>
            <option>macOS</option>
            <option>Linux</option>
            <option>Android</option>
          </Select>
          <Select
            value={tagFilter === 'all' ? 'all' : String(tagFilter)}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              setTagFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
            }
          >
            <option value="all">All tags</option>
            {allTags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Button
            variant={favoriteOnly ? 'primary' : 'secondary'}
            size="sm"
            icon={Star}
            onClick={() => setFavoriteOnly((v) => !v)}
          >
            {favoriteOnly ? 'Starred only' : 'Starred only'}
          </Button>
        </div>
        <div className="rd-toolbar__group">
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            {filtered.length} device{filtered.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {hasSelection ? (
        <div className="rd-bulk-bar">
          <span className="rd-bulk-bar__count">
            {selectedIds.length} selected
          </span>
          <div className="rd-bulk-bar__actions">
            <Button size="sm" variant="secondary" icon={TagIcon} onClick={() => setBulkTagDialog(true)}>
              Assign tag…
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                bulk.mutate(
                  { device_ids: selectedRows.map((r) => r.id), action: 'favorite' },
                  {
                    onSuccess: (res) =>
                      setToast({
                        kind: 'ok',
                        text: `${res.affected} device${res.affected === 1 ? '' : 's'} starred.`,
                      }),
                    onError: (err) =>
                      setToast({ kind: 'error', text: apiErrorMessage(err) }),
                  },
                );
              }}
            >
              Star
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setConfirmBulkForget(true)}
            >
              Forget…
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      <DataTable<ApiDevice>
        rows={filtered}
        pageSize={10}
        empty={
          isLoading
            ? 'Loading…'
            : 'No devices match your filters.'
        }
        columns={columns}
        onRowClick={(r) => setSelected(r)}
        rowClassName={() => 'rd-row--clickable'}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />

      <DeviceDrawer
        device={selected}
        ownerName={
          selected?.owner_user_id
            ? usernamesById[selected.owner_user_id] ?? null
            : null
        }
        allTags={allTags}
        onClose={() => setSelected(null)}
        onEditOwner={() => selected && setEditOwner(selected)}
        onDisconnect={() => selected && setConfirmDisconnect(selected)}
        onForget={() => selected && setConfirmForget(selected)}
        onSaveNote={(note) => {
          if (!selected) return;
          update.mutate(
            { id: selected.id, body: { note } },
            {
              onSuccess: () =>
                setToast({ kind: 'ok', text: 'Note saved.' }),
              onError: (err) =>
                setToast({ kind: 'error', text: apiErrorMessage(err) }),
            },
          );
        }}
        onAssignTag={(tagId) => {
          if (!selected) return;
          assignTag.mutate({ deviceId: selected.id, tagId });
        }}
        onUnassignTag={(tagId) => {
          if (!selected) return;
          unassignTag.mutate({ deviceId: selected.id, tagId });
        }}
        onCreateTag={async (name) => {
          const tag = await createTag.mutateAsync({ name, color: 'blue' });
          if (selected) assignTag.mutate({ deviceId: selected.id, tagId: tag.id });
        }}
      />

      {editOwner && (
        <EditOwnerDialog
          key={editOwner.id}
          device={editOwner}
          users={users.map((u) => ({ id: u.id, username: u.username }))}
          onClose={() => setEditOwner(null)}
          onSubmit={(deviceId, ownerId) =>
            update.mutate(
              { id: deviceId, body: { owner_user_id: ownerId } },
              {
                onSuccess: () => {
                  setEditOwner(null);
                  setToast({ kind: 'ok', text: 'Owner updated.' });
                },
                onError: (err) =>
                  setToast({ kind: 'error', text: apiErrorMessage(err) }),
              },
            )
          }
          submitting={update.isPending}
        />
      )}

      <ConfirmDialog
        open={!!confirmForget}
        onClose={() => setConfirmForget(null)}
        destructive
        confirmLabel={forget.isPending ? 'Forgetting…' : 'Forget'}
        title="Forget this device?"
        body={
          confirmForget
            ? `Forgetting ${confirmForget.hostname ?? confirmForget.rustdesk_id} removes it from the registry. ` +
              `It will re-appear when it next connects, without its current owner or hostname.`
            : ''
        }
        onConfirm={() => {
          if (!confirmForget) return;
          const target = confirmForget;
          forget.mutate(target.id, {
            onSuccess: () => {
              setConfirmForget(null);
              if (selected?.id === target.id) setSelected(null);
              setToast({ kind: 'ok', text: 'Device forgotten.' });
            },
            onError: (err) => {
              setConfirmForget(null);
              setToast({ kind: 'error', text: apiErrorMessage(err) });
            },
          });
        }}
      />

      <ConfirmDialog
        open={!!confirmDisconnect}
        onClose={() => setConfirmDisconnect(null)}
        destructive
        confirmLabel={disconnect.isPending ? 'Requesting…' : 'Disconnect'}
        title="Disconnect this device?"
        body={
          confirmDisconnect
            ? `${confirmDisconnect.hostname ?? confirmDisconnect.rustdesk_id} will be asked to drop its relay session. ` +
              `Audit entry is written regardless of delivery.`
            : ''
        }
        onConfirm={() => {
          if (!confirmDisconnect) return;
          const target = confirmDisconnect;
          disconnect.mutate(target.id, {
            onSuccess: () => {
              setConfirmDisconnect(null);
              setToast({ kind: 'ok', text: 'Disconnect requested — event logged.' });
            },
            onError: (err) => {
              setConfirmDisconnect(null);
              setToast({ kind: 'error', text: apiErrorMessage(err) });
            },
          });
        }}
      />

      {/* Bulk forget — destructive. Body lists the first few hostnames
          so it's not just a count. */}
      <ConfirmDialog
        open={confirmBulkForget}
        onClose={() => setConfirmBulkForget(false)}
        destructive
        confirmLabel={bulk.isPending ? 'Forgetting…' : `Forget ${selectedRows.length}`}
        title={`Forget ${selectedRows.length} device${selectedRows.length === 1 ? '' : 's'}?`}
        body={(() => {
          const head = selectedRows
            .slice(0, 5)
            .map((r) => r.hostname ?? r.rustdesk_id)
            .join(', ');
          const more = selectedRows.length > 5 ? ` and ${selectedRows.length - 5} more` : '';
          return `${head}${more}. They will re-appear when they next connect.`;
        })()}
        onConfirm={() => {
          bulk.mutate(
            { device_ids: selectedRows.map((r) => r.id), action: 'forget' },
            {
              onSuccess: (res) => {
                setConfirmBulkForget(false);
                setSelectedIds([]);
                setToast({
                  kind: 'ok',
                  text: `${res.affected} device${res.affected === 1 ? '' : 's'} forgotten.`,
                });
              },
              onError: (err) => {
                setConfirmBulkForget(false);
                setToast({ kind: 'error', text: apiErrorMessage(err) });
              },
            },
          );
        }}
      />

      {/* Bulk assign tag — pick a tag from the list, then apply. */}
      <BulkAssignTagDialog
        open={bulkTagDialog}
        allTags={allTags}
        onClose={() => setBulkTagDialog(false)}
        onPick={(tagId) => {
          bulk.mutate(
            {
              device_ids: selectedRows.map((r) => r.id),
              action: 'assign_tag',
              tag_id: tagId,
            },
            {
              onSuccess: (res) => {
                setBulkTagDialog(false);
                setToast({
                  kind: 'ok',
                  text: `${res.affected} device${res.affected === 1 ? '' : 's'} tagged.`,
                });
              },
              onError: (err) => {
                setBulkTagDialog(false);
                setToast({ kind: 'error', text: apiErrorMessage(err) });
              },
            },
          );
        }}
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

/* ── device detail drawer ─────────────────────────────────────── */

interface DeviceDrawerProps {
  device: ApiDevice | null;
  ownerName: string | null;
  allTags: Tag[];
  onClose: () => void;
  onEditOwner: () => void;
  onDisconnect: () => void;
  onForget: () => void;
  onSaveNote: (note: string | null) => void;
  onAssignTag: (tagId: number) => void;
  onUnassignTag: (tagId: number) => void;
  onCreateTag: (name: string) => Promise<void> | void;
}

function DeviceDrawer({
  device,
  ownerName,
  allTags,
  onClose,
  onEditOwner,
  onDisconnect,
  onForget,
  onSaveNote,
  onAssignTag,
  onUnassignTag,
  onCreateTag,
}: DeviceDrawerProps) {
  const { data: logs } = useDeviceLogs(device?.id ?? null, 10);

  if (!device) return null;

  return (
    <Drawer
      key={device.id}
      open
      onClose={onClose}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <OnlineBadge online={device.online} />
          <span className="rd-mono">{device.rustdesk_id}</span>
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onEditOwner}>
            Edit owner
          </Button>
          <Button
            variant="secondary"
            onClick={onDisconnect}
            disabled={!device.online}
          >
            Disconnect
          </Button>
          <Button
            variant="destructive"
            onClick={onForget}
            style={{ marginLeft: 'auto' }}
          >
            Forget
          </Button>
        </>
      }
    >
      <dl className="rd-deflist">
        <dt>Hostname</dt>
        <dd>{device.hostname ?? '—'}</dd>
        <dt>Last user</dt>
        <dd>{device.username ?? '—'}</dd>
        <dt>Platform</dt>
        <dd>
          {device.platform ? (
            <PlatformIcon platform={device.platform as Platform} />
          ) : '—'}
        </dd>
        <dt>CPU</dt>
        <dd>{device.cpu ?? '—'}</dd>
        <dt>Version</dt>
        <dd className="mono">{device.version ?? '—'}</dd>
        <dt>Last IP</dt>
        <dd className="mono">{device.last_ip ?? '—'}</dd>
        <dt>Last seen</dt>
        <dd>{relativeLastSeen(device.last_seen_at)}</dd>
        <dt>First seen</dt>
        <dd className="mono">{device.created_at.slice(0, 19).replace('T', ' ')}</dd>
        <dt>Owner</dt>
        <dd>
          {ownerName ?? (
            <span style={{ color: 'var(--fg-muted)' }}>Unassigned</span>
          )}
        </dd>
      </dl>

      <NoteEditor
        initial={device.note}
        onSave={onSaveNote}
      />

      <div>
        <div className="rd-form__section-label" style={{ marginBottom: 8 }}>
          Tags
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {device.tags.length === 0 ? (
            <span style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
              No tags yet.
            </span>
          ) : (
            device.tags.map((t) => (
              <TagChip
                key={t.id}
                name={t.name}
                color={t.color}
                size="sm"
                onRemove={() => onUnassignTag(t.id)}
              />
            ))
          )}
        </div>
        <TagInput
          all={allTags}
          assignedIds={device.tags.map((t) => t.id)}
          onAssign={onAssignTag}
          onUnassign={onUnassignTag}
          onCreate={(name) => onCreateTag(name)}
        />
      </div>

      <div>
        <div className="rd-form__section-label" style={{ marginBottom: 8 }}>
          Recent activity
        </div>
        {!logs || logs.items.length === 0 ? (
          <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
            No events recorded yet.
          </div>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {logs.items.map((r) => (
              <li
                key={r.id}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'baseline',
                  fontSize: 12,
                  padding: '6px 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <span className="rd-mono" style={{ color: 'var(--fg-muted)', minWidth: 120 }}>
                  {r.created_at.slice(0, 19).replace('T', ' ')}
                </span>
                <Badge
                  variant={
                    r.action.includes('connect')
                      ? 'info'
                      : r.action.includes('file')
                        ? 'transfer'
                        : 'neutral'
                  }
                >
                  {formatAction(r)}
                </Badge>
                <span style={{ color: 'var(--fg-muted)' }}>
                  {r.actor_username ?? r.from_id ?? r.to_id ?? ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}

/* ── note editor ───────────────────────────────────────────── */

interface NoteEditorProps {
  initial: string | null;
  onSave: (note: string | null) => void;
}

function NoteEditor({ initial, onSave }: NoteEditorProps) {
  const [value, setValue] = useState(initial ?? '');
  const dirty = value !== (initial ?? '');
  return (
    <div>
      <div className="rd-form__section-label" style={{ marginBottom: 8 }}>
        Note
      </div>
      <textarea
        className="rd-input"
        style={{ minHeight: 72, resize: 'vertical', padding: 8, width: '100%' }}
        placeholder="Free-form admin note (max 500 chars)…"
        maxLength={500}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginTop: 6,
          gap: 6,
        }}
      >
        <Button
          size="sm"
          variant="secondary"
          disabled={!dirty}
          onClick={() => setValue(initial ?? '')}
        >
          Reset
        </Button>
        <Button
          size="sm"
          disabled={!dirty}
          onClick={() => onSave(value === '' ? null : value)}
        >
          Save note
        </Button>
      </div>
    </div>
  );
}

/* ── edit owner dialog ────────────────────────────────────────── */

interface EditOwnerDialogProps {
  device: ApiDevice;
  users: { id: number; username: string }[];
  onClose: () => void;
  onSubmit: (deviceId: number, ownerId: number | null) => void;
  submitting: boolean;
}

function EditOwnerDialog({
  device,
  users,
  onClose,
  onSubmit,
  submitting,
}: EditOwnerDialogProps) {
  const [value, setValue] = useState<string>(
    device.owner_user_id ? String(device.owner_user_id) : '',
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Edit owner — ${device.hostname ?? device.rustdesk_id}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            disabled={submitting}
            onClick={() =>
              onSubmit(device.id, value === '' ? null : Number(value))
            }
          >
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="rd-form">
        <div className="rd-form__field">
          <label className="rd-form__label" htmlFor="eo-owner">
            Owner
          </label>
          <Select
            id="eo-owner"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </Select>
          <div className="rd-form__hint">
            Owner is the panel user responsible for this device. It controls
            visibility in the end-user view (future milestone) and appears in
            audit logs.
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* ── bulk: assign tag dialog ──────────────────────────────── */

interface BulkAssignTagDialogProps {
  open: boolean;
  allTags: Tag[];
  onClose: () => void;
  onPick: (tagId: number) => void;
}

function BulkAssignTagDialog({ open, allTags, onClose, onPick }: BulkAssignTagDialogProps) {
  if (!open) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Assign tag to selected devices"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      {allTags.length === 0 ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
          No tags defined yet. Create one from the Tags page first.
        </div>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {allTags.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="rd-tag-input__row"
                onClick={() => onPick(t.id)}
              >
                <TagChip name={t.name} color={t.color} size="sm" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
