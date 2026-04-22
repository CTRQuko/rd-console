/** Tags admin — CRUD the vocabulary used to group devices. */

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable, type Column } from '@/components/DataTable';
import { Dialog } from '@/components/Dialog';
import { PageHeader } from '@/components/PageHeader';
import { Select } from '@/components/Select';
import { TagChip } from '@/components/TagChip';
import { Toast, type ToastValue } from '@/components/Toast';
import {
  useCreateTag,
  useDeleteTag,
  useTags,
} from '@/hooks/useTags';
import { apiErrorMessage } from '@/lib/api';
import { TAG_COLORS, type Tag, type TagColor } from '@/types/api';

export function TagsPage() {
  const { data: rows = [], isLoading } = useTags();
  const create = useCreateTag();
  const remove = useDeleteTag();

  const [openCreate, setOpenCreate] = useState(false);
  const [pendingName, setPendingName] = useState('');
  const [pendingColor, setPendingColor] = useState<TagColor>('blue');
  const [confirm, setConfirm] = useState<Tag | null>(null);
  const [toast, setToast] = useState<ToastValue | null>(null);

  const columns: Column<Tag>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (t) => <TagChip name={t.name} color={t.color} />,
    },
    {
      key: 'device_count',
      header: 'Devices',
      cell: (t) => (
        <span className="rd-mono" style={{ color: 'var(--fg-muted)' }}>
          {t.device_count}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      cell: (t) => (
        <span style={{ color: 'var(--fg-muted)' }} className="rd-mono">
          {new Date(t.created_at).toISOString().slice(0, 10)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 60,
      cell: (t) => (
        <div
          style={{ display: 'flex', justifyContent: 'flex-end' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="rd-iconbtn"
            aria-label={`Delete ${t.name}`}
            onClick={() => setConfirm(t)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  const submitCreate = () => {
    const name = pendingName.trim();
    if (!name) return;
    create.mutate(
      { name, color: pendingColor },
      {
        onSuccess: () => {
          setOpenCreate(false);
          setPendingName('');
          setPendingColor('blue');
          setToast({ kind: 'ok', text: `Tag "${name}" created.` });
        },
        onError: (err) =>
          setToast({ kind: 'error', text: apiErrorMessage(err) }),
      },
    );
  };

  return (
    <>
      <PageHeader
        title="Tags"
        subtitle="Short labels you can attach to devices for filtering."
        action={
          <Button icon={Plus} onClick={() => setOpenCreate(true)}>
            Create tag
          </Button>
        }
      />
      <DataTable<Tag>
        rows={rows}
        columns={columns}
        empty={isLoading ? 'Loading…' : 'No tags yet. Create one to start grouping devices.'}
      />

      <Dialog
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        title="Create tag"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpenCreate(false)}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={create.isPending || !pendingName.trim()}>
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="rd-form">
          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="tag-name">
              Name *
            </label>
            <input
              id="tag-name"
              className="rd-input"
              autoFocus
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value)}
              placeholder="office, lab, juan…"
              maxLength={32}
            />
            <div className="rd-form__hint">
              1–32 characters. Names are case-insensitive unique.
            </div>
          </div>
          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="tag-color">
              Color
            </label>
            <Select
              id="tag-color"
              value={pendingColor}
              onChange={(e) => setPendingColor(e.target.value as TagColor)}
            >
              {TAG_COLORS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <div className="rd-form__hint" style={{ marginTop: 6 }}>
              Preview: <TagChip name={pendingName || 'preview'} color={pendingColor} />
            </div>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const { id, name } = confirm;
          remove.mutate(id, {
            onSuccess: () => {
              setConfirm(null);
              setToast({ kind: 'ok', text: `Tag "${name}" deleted.` });
            },
            onError: (err) => {
              setConfirm(null);
              setToast({ kind: 'error', text: apiErrorMessage(err) });
            },
          });
        }}
        destructive
        confirmLabel="Delete"
        title="Delete tag?"
        body={
          confirm
            ? `"${confirm.name}" will be removed from ${confirm.device_count} device${confirm.device_count === 1 ? '' : 's'}.`
            : ''
        }
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
