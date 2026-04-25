/** Settings → Users tab — Edit + Disable + hard-delete + bulk ops wired
 *  to /admin/api/users.
 *
 *  Lives inside Settings (since v6 P6-B) — the outer SettingsPage owns
 *  the page chrome, so this file no longer renders a PageHeader. The
 *  Create button + search input share a single toolbar row.
 *
 *  The row-actions dropdown replaces the inline Edit/Disable buttons:
 *  fewer buttons to scan, more affordances per row (Reset password slot
 *  is ready for a future milestone). The Create flow still lives here;
 *  useCreateUser() with sensible defaults so the dialog can be opened in
 *  isolation for component tests. "Disable" is DELETE /admin/api/users/{id}
 *  per the backend contract — the server does a soft-disable.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable, type Column } from '@/components/DataTable';
import { Dialog } from '@/components/Dialog';
import { DropdownMenu } from '@/components/DropdownMenu';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Toast } from '@/components/Toast';
import {
  useBulkUsers,
  useCreateUser,
  useDeleteUser,
  useDisableUser,
  useUpdateUser,
  useUsers,
} from '@/hooks/useUsers';
import { apiErrorMessage } from '@/lib/api';
import { useDateTime } from '@/lib/formatters';
import { useAuthStore } from '@/store/authStore';
import type { ApiUser, ApiUserRole } from '@/types/api';

type ToastState = { kind: 'ok' | 'error'; text: string } | null;

export function SettingsUsersTab() {
  const { t } = useTranslation();
  const { data: rows = [], isLoading } = useUsers();
  const create = useCreateUser();
  const update = useUpdateUser();
  const disable = useDisableUser();
  const hardDelete = useDeleteUser();
  const bulk = useBulkUsers();
  const { fmtDateOnly } = useDateTime();
  const me = useAuthStore((s) => s.user);

  const [q, setQ] = useState('');
  const [openCreate, setOpenCreate] = useState(false);
  const [editing, setEditing] = useState<ApiUser | null>(null);
  const [confirm, setConfirm] = useState<ApiUser | null>(null);
  // Hard-delete confirmation (distinct from the disable confirm above —
  // destructive with a stronger wording so admins can't mis-click).
  const [confirmHardDelete, setConfirmHardDelete] = useState<ApiUser | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [confirmBulk, setConfirmBulk] = useState<'disable' | 'enable' | 'delete' | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const filtered = useMemo(() => {
    const query = q.toLowerCase().trim();
    if (!query) return rows;
    return rows.filter(
      (r) =>
        r.username.toLowerCase().includes(query) ||
        (r.email ?? '').toLowerCase().includes(query),
    );
  }, [rows, q]);

  const columns: Column<ApiUser>[] = [
    {
      key: 'username',
      header: 'Username',
      cell: (r) => <span style={{ fontWeight: 500 }}>{r.username}</span>,
    },
    {
      key: 'email',
      header: 'Email',
      cell: (r) => (
        <span style={{ color: 'var(--fg-muted)' }}>{r.email ?? '—'}</span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      cell: (r) => (
        <Badge variant={r.role === 'admin' ? 'admin' : 'neutral'}>
          {r.role === 'admin' ? 'Admin' : 'User'}
        </Badge>
      ),
    },
    {
      key: 'is_active',
      header: 'Status',
      cell: (r) => (
        <Badge variant={r.is_active ? 'active' : 'disabled'}>
          {r.is_active ? 'Active' : 'Disabled'}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      cell: (r) => (
        <span style={{ color: 'var(--fg-muted)' }} className="rd-mono">
          {fmtDateOnly(r.created_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 56,
      cell: (r) => {
        const isSelf = me?.username === r.username;
        // id=1 is the bootstrap admin — backend enforces it can't be
        // disabled or deleted. Mirror that in the UI so the option is
        // visibly unavailable, not just rejected after a click.
        const isInitialAdmin = r.id === 1;
        return (
          <div
            style={{ display: 'flex', justifyContent: 'flex-end' }}
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenu
              ariaLabel={`Actions for ${r.username}`}
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  icon={MoreHorizontal}
                  aria-label={`Actions for ${r.username}`}
                />
              }
              items={[
                {
                  id: 'edit',
                  label: 'Edit…',
                  onSelect: () => setEditing(r),
                },
                {
                  id: 'reset',
                  label: 'Reset password…',
                  onSelect: () => setEditing(r),
                },
                { id: 'div', label: '', divider: true },
                {
                  id: 'disable',
                  label: r.is_active ? 'Disable…' : 'Re-enable',
                  destructive: r.is_active,
                  disabled: (isSelf && r.is_active) || (isInitialAdmin && r.is_active),
                  onSelect: () => {
                    if (!r.is_active) {
                      // Flip back on with a PATCH; no confirmation needed.
                      update.mutate(
                        { id: r.id, body: { is_active: true } },
                        {
                          onSuccess: () =>
                            setToast({ kind: 'ok', text: `${r.username} re-enabled.` }),
                          onError: (err) =>
                            setToast({ kind: 'error', text: apiErrorMessage(err) }),
                        },
                      );
                    } else {
                      setConfirm(r);
                    }
                  },
                },
                {
                  id: 'delete',
                  label: 'Delete permanently…',
                  destructive: true,
                  disabled: isSelf || isInitialAdmin,
                  onSelect: () => setConfirmHardDelete(r),
                },
              ]}
            />
          </div>
        );
      },
    },
  ];

  return (
    <>
      <div className="rd-toolbar">
        <div className="rd-toolbar__group">
          <Input
            leftIcon={Search}
            placeholder="Search users…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: 260 }}
          />
          <Button icon={Plus} onClick={() => setOpenCreate(true)}>
            Create user
          </Button>
        </div>
        {selectedIds.length > 0 && (
          <div
            className="rd-toolbar__group"
            style={{ marginLeft: 'auto', gap: 8 }}
            role="group"
            aria-label="Bulk actions"
          >
            <span style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
              {selectedIds.length} selected
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmBulk('disable')}
            >
              Disable
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmBulk('enable')}
            >
              Re-enable
            </Button>
            <Button
              variant="destructive"
              size="sm"
              icon={Trash2}
              onClick={() => setConfirmBulk('delete')}
            >
              Delete
            </Button>
          </div>
        )}
      </div>
      <DataTable<ApiUser>
        rows={filtered}
        pageSize={10}
        empty={
          isLoading ? t('states.loading') : q ? t('empty_states.users_filtered') : (
            <div className="rd-empty">
              <p>{t('empty_states.users')}</p>
              <Button size="sm" icon={Plus} onClick={() => setOpenCreate(true)}>
                {t('actions.create')}
              </Button>
            </div>
          )
        }
        columns={columns}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={(ids) =>
          setSelectedIds(
            ids
              .map((i) => (typeof i === 'number' ? i : Number(i)))
              .filter((i) => !Number.isNaN(i)),
          )
        }
        // Clicking the row itself (outside the checkbox + actions menu)
        // opens the edit dialog — aligning with DevicesPage's drawer-on-
        // click pattern so users stop wondering why the row is "dead".
        // The actions menu cell stops propagation so menu clicks don't
        // double-fire.
        onRowClick={(r) => setEditing(r)}
      />

      <CreateUserDialog
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        onSubmit={(body) =>
          create.mutate(body, {
            onSuccess: () => {
              setOpenCreate(false);
              setToast({ kind: 'ok', text: `${body.username} created.` });
            },
            onError: (err) =>
              setToast({ kind: 'error', text: apiErrorMessage(err) }),
          })
        }
        submitting={create.isPending}
      />

      {editing && (
        <EditUserDialog
          key={editing.id}
          user={editing}
          onClose={() => setEditing(null)}
          onSubmit={(id, body) =>
            update.mutate(
              { id, body },
              {
                onSuccess: () => {
                  setEditing(null);
                  setToast({ kind: 'ok', text: 'User updated.' });
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
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          disable.mutate(confirm.id, {
            onSuccess: () => {
              setConfirm(null);
              setToast({ kind: 'ok', text: `${confirm.username} disabled.` });
            },
            onError: (err) => {
              setConfirm(null);
              setToast({ kind: 'error', text: apiErrorMessage(err) });
            },
          });
        }}
        destructive
        confirmLabel={disable.isPending ? 'Disabling…' : 'Disable'}
        title="Disable user?"
        body={
          confirm
            ? `${confirm.username} won't be able to sign in until re-enabled.`
            : ''
        }
      />

      <ConfirmDialog
        open={!!confirmHardDelete}
        onClose={() => setConfirmHardDelete(null)}
        onConfirm={() => {
          if (!confirmHardDelete) return;
          const victim = confirmHardDelete;
          hardDelete.mutate(victim.id, {
            onSuccess: () => {
              setConfirmHardDelete(null);
              setToast({ kind: 'ok', text: `${victim.username} deleted permanently.` });
            },
            onError: (err) => {
              setConfirmHardDelete(null);
              setToast({ kind: 'error', text: apiErrorMessage(err) });
            },
          });
        }}
        destructive
        confirmLabel={hardDelete.isPending ? 'Deleting…' : 'Delete permanently'}
        title="Delete user permanently?"
        body={
          confirmHardDelete
            ? `${confirmHardDelete.username} and all their API tokens and address book entries will be erased. Devices and audit logs keep their history (with NULL owner). This cannot be undone.`
            : ''
        }
      />

      <ConfirmDialog
        open={confirmBulk !== null}
        onClose={() => setConfirmBulk(null)}
        onConfirm={() => {
          if (!confirmBulk) return;
          const action = confirmBulk;
          const ids = selectedIds.slice();
          bulk.mutate(
            { action, user_ids: ids },
            {
              onSuccess: (result) => {
                setConfirmBulk(null);
                setSelectedIds([]);
                const skipped = result.skipped.length;
                const msg =
                  skipped === 0
                    ? `${result.affected} user${result.affected === 1 ? '' : 's'} ${action}d.`
                    : `${result.affected} ${action}d, ${skipped} skipped (${result.skipped
                        .map((s) => s.reason)
                        .join(', ')}).`;
                setToast({ kind: skipped === 0 ? 'ok' : 'error', text: msg });
              },
              onError: (err) => {
                setConfirmBulk(null);
                setToast({ kind: 'error', text: apiErrorMessage(err) });
              },
            },
          );
        }}
        destructive={confirmBulk !== 'enable'}
        confirmLabel={
          bulk.isPending
            ? 'Working…'
            : confirmBulk === 'delete'
              ? 'Delete all'
              : confirmBulk === 'enable'
                ? 'Re-enable all'
                : 'Disable all'
        }
        title={
          confirmBulk === 'delete'
            ? `Delete ${selectedIds.length} users permanently?`
            : confirmBulk === 'enable'
              ? `Re-enable ${selectedIds.length} users?`
              : `Disable ${selectedIds.length} users?`
        }
        body={
          confirmBulk === 'delete'
            ? 'Selected users and their PATs + address books will be erased. Yourself and the last active admin will be skipped automatically. This cannot be undone.'
            : confirmBulk === 'enable'
              ? 'Selected users will be able to sign in again.'
              : 'Selected users will not be able to sign in until re-enabled. Yourself and the last active admin will be skipped.'
        }
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

/* ── dialogs (co-located — only used here) ──────────────────── */

interface CreateUserDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: {
    username: string;
    email?: string;
    password: string;
    role?: ApiUserRole;
  }) => void;
  submitting: boolean;
}

function CreateUserDialog({ open, onClose, onSubmit, submitting }: CreateUserDialogProps) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<ApiUserRole>('user');

  // Reset when the dialog opens — no stale values if the admin creates two
  // users back to back.
  const onOpen = () => {
    setUsername('');
    setEmail('');
    setPassword('');
    setRole('user');
  };

  const canSubmit = username.trim().length > 0 && password.length >= 12;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create user"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit || submitting}
            onClick={() =>
              onSubmit({
                username: username.trim(),
                email: email.trim() || undefined,
                password,
                role,
              })
            }
          >
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      {/* Re-seed state on open via key; React will unmount/remount. */}
      <form
        className="rd-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) {
            onSubmit({
              username: username.trim(),
              email: email.trim() || undefined,
              password,
              role,
            });
          }
        }}
        ref={(node) => {
          if (open && node && !node.dataset.seeded) {
            node.dataset.seeded = 'true';
            onOpen();
          } else if (!open && node) {
            delete node.dataset.seeded;
          }
        }}
      >
        <div className="rd-form__field">
          <label className="rd-form__label" htmlFor="cu-username">
            Username *
          </label>
          <input
            id="cu-username"
            className="rd-input"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="jane.doe"
          />
        </div>
        <div className="rd-form__field">
          <label className="rd-form__label" htmlFor="cu-email">
            Email
          </label>
          <input
            id="cu-email"
            className="rd-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@example.com"
          />
        </div>
        <div className="rd-form__field">
          <label className="rd-form__label" htmlFor="cu-password">
            Password *
          </label>
          <input
            id="cu-password"
            className="rd-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="rd-form__hint">Minimum 12 characters.</div>
        </div>
        <div className="rd-form__field">
          <label className="rd-form__label" htmlFor="cu-role">
            Role
          </label>
          <Select
            id="cu-role"
            value={role}
            onChange={(e) => setRole(e.target.value as ApiUserRole)}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </Select>
        </div>
      </form>
    </Dialog>
  );
}

interface EditUserDialogProps {
  user: ApiUser;
  onClose: () => void;
  onSubmit: (
    id: number,
    body: {
      email?: string | null;
      role?: ApiUserRole;
      is_active?: boolean;
      password?: string;
    },
  ) => void;
  submitting: boolean;
}

function EditUserDialog({ user, onClose, onSubmit, submitting }: EditUserDialogProps) {
  // State is initialised from the user prop at mount. The parent renders
  // this component with `key={user.id}` so switching to a different user
  // unmounts + remounts, re-running the initial state — no useEffect
  // needed. Avoids the react-hooks/set-state-in-effect lint.
  const [email, setEmail] = useState(user.email ?? '');
  const [role, setRole] = useState<ApiUserRole>(user.role);
  const [password, setPassword] = useState('');
  const me = useAuthStore((s) => s.user);

  const isSelf = me?.username === user.username;
  const canSubmit = password === '' || password.length >= 12;

  return (
    <Dialog
      open={!!user}
      onClose={onClose}
      title={`Edit ${user.username}`}
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            disabled={submitting || !canSubmit}
            onClick={() => {
              const body: {
                email?: string | null;
                role?: ApiUserRole;
                password?: string;
              } = {};
              const trimmedEmail = email.trim();
              const nextEmail = trimmedEmail === '' ? null : trimmedEmail;
              if (nextEmail !== user.email) body.email = nextEmail;
              if (role !== user.role) body.role = role;
              if (password) body.password = password;
              // If nothing changed, close silently so we don't bounce the
              // invalidation query for no reason.
              if (Object.keys(body).length === 0) {
                onClose();
                return;
              }
              onSubmit(user.id, body);
            }}
          >
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="rd-form">
        <div className="rd-form__readonly-head">
          <span className="rd-form__readonly-label">Username</span>
          <span className="rd-form__readonly-value">{user.username}</span>
        </div>
        <div className="rd-form__field">
          <label className="rd-form__label" htmlFor="eu-email">
            Email
          </label>
          <input
            id="eu-email"
            className="rd-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="rd-form__field">
          <label className="rd-form__label" htmlFor="eu-role">
            Role
          </label>
          <Select
            id="eu-role"
            value={role}
            onChange={(e) => setRole(e.target.value as ApiUserRole)}
            disabled={isSelf}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </Select>
          {isSelf ? (
            <div className="rd-form__hint">
              You can't change your own role. Ask another admin.
            </div>
          ) : null}
        </div>
        <div className="rd-form__divider" />
        <div className="rd-form__section-label">Reset password</div>
        <div className="rd-form__field">
          <label className="rd-form__label" htmlFor="eu-password">
            New password
          </label>
          <input
            id="eu-password"
            className="rd-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave blank to keep current"
          />
          {password && password.length < 12 ? (
            <div className="rd-form__error">Must be at least 12 characters.</div>
          ) : (
            <div className="rd-form__hint">
              Password is rotated only if you set a new value.
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
