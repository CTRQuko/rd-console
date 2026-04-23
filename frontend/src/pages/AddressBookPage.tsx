/** Address book — per-user peer directory.
 *
 *  Shared with native RustDesk clients: the Flutter client logs in via
 *  /api/login (kingmo888 shape) and syncs the same blob this page edits,
 *  so changes here appear in the client and vice-versa.
 *
 *  Storage contract: the backend stores an opaque stringified JSON blob.
 *  We parse it into {tags, peers[], tag_colors} on load and stringify
 *  the full object on save — forward-compat fields we don't know about
 *  are preserved via the spread in useAddressBook.
 */

import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable, type Column } from '@/components/DataTable';
import { Dialog } from '@/components/Dialog';
import { PageHeader } from '@/components/PageHeader';
import { TagChip } from '@/components/TagChip';
import { Toast, type ToastValue } from '@/components/Toast';
import {
  useAddressBook,
  useSaveAddressBook,
  type AbPeer,
} from '@/hooks/useAddressBook';
import { apiErrorMessage } from '@/lib/api';

interface PeerDraft {
  id: string;
  alias: string;
  hostname: string;
  username: string;
  platform: string;
  tags: string; // comma-separated in the form; split on save
}

function emptyDraft(): PeerDraft {
  return { id: '', alias: '', hostname: '', username: '', platform: '', tags: '' };
}

function peerToDraft(p: AbPeer): PeerDraft {
  return {
    id: p.id,
    alias: p.alias ?? '',
    hostname: p.hostname ?? '',
    username: p.username ?? '',
    platform: p.platform ?? '',
    tags: (p.tags ?? []).join(', '),
  };
}

function draftToPeer(d: PeerDraft, existing?: AbPeer): AbPeer {
  const tags = d.tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    ...(existing ?? {}),
    id: d.id.trim(),
    alias: d.alias.trim(),
    hostname: d.hostname.trim(),
    username: d.username.trim(),
    platform: d.platform.trim(),
    tags,
  };
}

type RowId = string & { __ab: true };
type TableRow = AbPeer & { id: RowId };

export function AddressBookPage() {
  const { data: snap, isLoading } = useAddressBook();
  const save = useSaveAddressBook();

  const [editing, setEditing] = useState<AbPeer | null>(null);
  const [draft, setDraft] = useState<PeerDraft>(emptyDraft);
  const [isNew, setIsNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AbPeer | null>(null);
  const [toast, setToast] = useState<ToastValue | null>(null);

  const peers = useMemo<AbPeer[]>(() => snap?.data.peers ?? [], [snap]);
  const knownTags = snap?.data.tags ?? [];

  const rows = useMemo<TableRow[]>(
    () => peers.map((p) => ({ ...p, id: p.id as RowId })),
    [peers],
  );

  const openNew = () => {
    setDraft(emptyDraft());
    setEditing(null);
    setIsNew(true);
  };

  const openEdit = (peer: AbPeer) => {
    setDraft(peerToDraft(peer));
    setEditing(peer);
    setIsNew(false);
  };

  const closeDialog = () => {
    setIsNew(false);
    setEditing(null);
  };

  const persist = (nextPeers: AbPeer[], successMsg: string) => {
    if (!snap) return;
    const nextData = { ...snap.data, peers: nextPeers };
    // Keep top-level `tags` in sync with the union of per-peer tags so
    // the native client's tag picker sees them.
    const allTags = new Set(snap.data.tags);
    for (const p of nextPeers) for (const t of p.tags ?? []) allTags.add(t);
    nextData.tags = Array.from(allTags);

    save.mutate(nextData, {
      onSuccess: () => {
        closeDialog();
        setConfirmDelete(null);
        setToast({ kind: 'ok', text: successMsg });
      },
      onError: (err) =>
        setToast({ kind: 'error', text: apiErrorMessage(err) }),
    });
  };

  const submitDialog = () => {
    const id = draft.id.trim();
    if (!id) {
      setToast({ kind: 'error', text: 'ID is required.' });
      return;
    }
    if (isNew && peers.some((p) => p.id === id)) {
      setToast({ kind: 'error', text: `A peer with ID "${id}" already exists.` });
      return;
    }
    const nextPeer = draftToPeer(draft, editing ?? undefined);
    const next = editing
      ? peers.map((p) => (p.id === editing.id ? nextPeer : p))
      : [...peers, nextPeer];
    persist(next, isNew ? `Added peer ${id}.` : `Updated peer ${id}.`);
  };

  const submitDelete = () => {
    if (!confirmDelete) return;
    const next = peers.filter((p) => p.id !== confirmDelete.id);
    persist(next, `Removed peer ${confirmDelete.id}.`);
  };

  const columns: Column<TableRow>[] = [
    {
      key: 'id',
      header: 'RustDesk ID',
      cell: (r) => <span className="rd-mono">{r.id}</span>,
    },
    {
      key: 'alias',
      header: 'Alias',
      cell: (r) => r.alias || <span style={{ color: 'var(--fg-muted)' }}>—</span>,
    },
    {
      key: 'hostname',
      header: 'Hostname',
      cell: (r) =>
        r.hostname ? (
          <span className="rd-mono">{r.hostname}</span>
        ) : (
          <span style={{ color: 'var(--fg-muted)' }}>—</span>
        ),
    },
    {
      key: 'platform',
      header: 'Platform',
      cell: (r) => r.platform || <span style={{ color: 'var(--fg-muted)' }}>—</span>,
    },
    {
      key: 'tags',
      header: 'Tags',
      cell: (r) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(r.tags ?? []).length === 0 ? (
            <span style={{ color: 'var(--fg-muted)' }}>—</span>
          ) : (
            (r.tags ?? []).map((t) => <TagChip key={t} name={t} color="blue" size="sm" />)
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 100,
      cell: (r) => (
        <div
          style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="rd-iconbtn"
            aria-label={`Edit ${r.id}`}
            onClick={() => openEdit(r)}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className="rd-iconbtn"
            aria-label={`Remove ${r.id}`}
            onClick={() => setConfirmDelete(r)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  const dialogOpen = isNew || !!editing;

  return (
    <>
      <PageHeader
        title="Address book"
        subtitle={
          snap?.updated_at
            ? `Synced with your RustDesk client. Last update: ${new Date(snap.updated_at).toISOString().slice(0, 16).replace('T', ' ')}.`
            : 'Synced with your RustDesk client. Add peers here and they appear on every device.'
        }
        action={
          <Button icon={Plus} onClick={openNew}>
            Add peer
          </Button>
        }
      />
      <DataTable<TableRow>
        rows={rows}
        columns={columns}
        empty={
          isLoading
            ? 'Loading…'
            : 'No peers yet. Add one to start syncing across your clients.'
        }
      />

      {/* Known tags summary — surface what the RustDesk client shows */}
      {knownTags.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 8,
              color: 'var(--fg-muted)',
              fontSize: 13,
            }}
          >
            Known tags
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {knownTags.map((t) => (
              <TagChip key={t} name={t} color="blue" size="sm" />
            ))}
          </div>
        </section>
      )}

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title={isNew ? 'Add peer' : `Edit peer ${editing?.id ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={submitDialog} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="rd-form">
          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="ab-id">
              RustDesk ID *
            </label>
            <input
              id="ab-id"
              className="rd-input rd-mono"
              autoFocus={isNew}
              disabled={!isNew}
              value={draft.id}
              onChange={(e) => setDraft({ ...draft, id: e.target.value })}
              placeholder="1779980041"
              maxLength={32}
            />
            <div className="rd-form__hint">
              Immutable once set. Rename by removing and re-adding.
            </div>
          </div>
          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="ab-alias">
              Alias
            </label>
            <input
              id="ab-alias"
              className="rd-input"
              value={draft.alias}
              onChange={(e) => setDraft({ ...draft, alias: e.target.value })}
              placeholder="Friendly name shown in the client"
              maxLength={64}
            />
          </div>
          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="ab-hostname">
              Hostname
            </label>
            <input
              id="ab-hostname"
              className="rd-input"
              value={draft.hostname}
              onChange={(e) => setDraft({ ...draft, hostname: e.target.value })}
              maxLength={128}
            />
          </div>
          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="ab-username">
              Remote username
            </label>
            <input
              id="ab-username"
              className="rd-input"
              value={draft.username}
              onChange={(e) => setDraft({ ...draft, username: e.target.value })}
              maxLength={64}
            />
          </div>
          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="ab-platform">
              Platform
            </label>
            <input
              id="ab-platform"
              className="rd-input"
              value={draft.platform}
              onChange={(e) => setDraft({ ...draft, platform: e.target.value })}
              placeholder="Windows, Linux, Mac, Android…"
              maxLength={32}
            />
          </div>
          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="ab-tags">
              Tags
            </label>
            <input
              id="ab-tags"
              className="rd-input"
              value={draft.tags}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              placeholder="home, work, server"
            />
            <div className="rd-form__hint">Comma-separated. New tags are created automatically.</div>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={submitDelete}
        destructive
        confirmLabel="Remove"
        title="Remove from address book?"
        body={
          confirmDelete
            ? `"${confirmDelete.alias || confirmDelete.id}" will be removed from your address book on every device.`
            : ''
        }
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
