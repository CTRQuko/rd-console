import { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable, type Column } from '@/components/DataTable';
import { Dialog } from '@/components/Dialog';
import { Input } from '@/components/Input';
import { PageHeader } from '@/components/PageHeader';
import { Select } from '@/components/Select';
import { mockApi } from '@/mock/mockApi';
import type { User } from '@/types/api';

export function UsersPage() {
  const [rows, setRows] = useState<User[]>([]);
  const [q, setQ] = useState('');
  const [openCreate, setOpenCreate] = useState(false);
  const [confirm, setConfirm] = useState<User | null>(null);

  useEffect(() => {
    mockApi.users().then(setRows);
  }, []);

  const query = q.toLowerCase();
  const filtered = rows.filter(
    (r) =>
      !query ||
      r.username.toLowerCase().includes(query) ||
      r.email.toLowerCase().includes(query),
  );

  const columns: Column<User>[] = [
    {
      key: 'username',
      header: 'Username',
      cell: (r) => <span style={{ fontWeight: 500 }}>{r.username}</span>,
    },
    {
      key: 'email',
      header: 'Email',
      cell: (r) => <span style={{ color: 'var(--fg-muted)' }}>{r.email}</span>,
    },
    {
      key: 'role',
      header: 'Role',
      cell: (r) => (
        <Badge variant={r.role === 'Admin' ? 'admin' : 'neutral'}>{r.role}</Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <Badge variant={r.status === 'Active' ? 'active' : 'disabled'}>{r.status}</Badge>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      cell: (r) => (
        <span style={{ color: 'var(--fg-muted)' }} className="rd-mono">
          {r.createdAt}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 140,
      cell: (r) => (
        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm">
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirm(r)}
            style={{ color: 'var(--red-600)' }}
          >
            Disable
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        action={
          <Button icon={Plus} onClick={() => setOpenCreate(true)}>
            Create user
          </Button>
        }
      />
      <div className="rd-toolbar">
        <div className="rd-toolbar__group">
          <Input
            leftIcon={Search}
            placeholder="Search users…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: 260 }}
          />
        </div>
      </div>
      <DataTable<User>
        rows={filtered}
        pageSize={8}
        empty={q ? 'No users match your search.' : 'No users yet.'}
        columns={columns}
      />

      <Dialog
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        title="Create user"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpenCreate(false)}>
              Cancel
            </Button>
            <Button onClick={() => setOpenCreate(false)}>Create</Button>
          </>
        }
      >
        <div className="rd-form">
          <div className="rd-form__field">
            <label className="rd-form__label">Username *</label>
            <input className="rd-input" placeholder="jane.doe" />
          </div>
          <div className="rd-form__field">
            <label className="rd-form__label">Email</label>
            <input className="rd-input" type="email" placeholder="jane@example.com" />
          </div>
          <div className="rd-form__field">
            <label className="rd-form__label">Password *</label>
            <input className="rd-input" type="password" />
            <div className="rd-form__hint">Minimum 12 characters.</div>
          </div>
          <div className="rd-form__field">
            <label className="rd-form__label">Role</label>
            <Select defaultValue="User">
              <option>User</option>
              <option>Admin</option>
            </Select>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm)
            setRows((rs) =>
              rs.map((r) => (r.id === confirm.id ? { ...r, status: 'Disabled' } : r)),
            );
        }}
        destructive
        confirmLabel="Disable"
        title="Disable user?"
        body={
          confirm
            ? `${confirm.username} won't be able to sign in until re-enabled.`
            : ''
        }
      />
    </>
  );
}
