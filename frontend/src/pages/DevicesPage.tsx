/** DevicesPage v2 — filters + row dropdown + Device detail drawer.
 *
 *  The table rows are clickable (opens the drawer). The trailing dropdown
 *  is a sibling affordance — it stops event propagation so clicking
 *  "Edit owner" doesn't also open the drawer behind the dialog.
 */

import { useMemo, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
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
import { Toast, type ToastValue } from '@/components/Toast';
import { useDeviceLogs } from '@/hooks/useLogs';
import {
  useDevices,
  useDisconnectDevice,
  useForgetDevice,
  useUpdateDevice,
} from '@/hooks/useDevices';
import { useUsers } from '@/hooks/useUsers';
import { apiErrorMessage } from '@/lib/api';
import { formatAction } from '@/hooks/useLogs';
import type { ApiDevice, Platform } from '@/types/api';

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

export function DevicesPage() {
  const { data: rows = [], isLoading } = useDevices();
  const { data: users = [] } = useUsers();
  const update = useUpdateDevice();
  const forget = useForgetDevice();
  const disconnect = useDisconnectDevice();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('All');
  const [selected, setSelected] = useState<ApiDevice | null>(null);
  const [confirmForget, setConfirmForget] = useState<ApiDevice | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<ApiDevice | null>(null);
  const [editOwner, setEditOwner] = useState<ApiDevice | null>(null);
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

  const columns: Column<ApiDevice>[] = [
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

  return (
    <>
      <PageHeader title="Devices" subtitle="Auto-refreshes every 30 seconds." />
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
        </div>
        <div className="rd-toolbar__group">
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            {filtered.length} device{filtered.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>
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
      />

      <DeviceDrawer
        device={selected}
        ownerName={
          selected?.owner_user_id
            ? usernamesById[selected.owner_user_id] ?? null
            : null
        }
        onClose={() => setSelected(null)}
        onEditOwner={() => selected && setEditOwner(selected)}
        onDisconnect={() => selected && setConfirmDisconnect(selected)}
        onForget={() => selected && setConfirmForget(selected)}
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

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

/* ── device detail drawer ─────────────────────────────────────── */

interface DeviceDrawerProps {
  device: ApiDevice | null;
  ownerName: string | null;
  onClose: () => void;
  onEditOwner: () => void;
  onDisconnect: () => void;
  onForget: () => void;
}

function DeviceDrawer({
  device,
  ownerName,
  onClose,
  onEditOwner,
  onDisconnect,
  onForget,
}: DeviceDrawerProps) {
  const { data: logs } = useDeviceLogs(device?.id ?? null, 10);

  if (!device) return null;

  return (
    <Drawer
      open={!!device}
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
  // Parent renders this with `key={device.id}` so each distinct device
  // re-mounts the component with fresh state. No seeding effect needed.
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
