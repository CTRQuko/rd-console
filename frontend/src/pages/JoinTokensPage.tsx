/** Join tokens admin — mint / list / revoke single-use device invites.
 *
 *  Scope: admin-only. The redaction contract matches /api/auth/tokens:
 *  the plaintext `token` comes back ONCE on create (for pasting into the
 *  invite URL) and is never retrievable again. List view only shows the
 *  8-char prefix. The post-create modal is deliberately non-dismissible
 *  on backdrop/Esc — losing the token means revoke + remint.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, Mail, MessageCircle, MoreHorizontal, Plus, Send, Trash2 } from 'lucide-react';
import { Badge, type BadgeVariant } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CopyableField } from '@/components/CopyableField';
import { DataTable, type Column } from '@/components/DataTable';
import { Dialog } from '@/components/Dialog';
import { DropdownMenu } from '@/components/DropdownMenu';
import { PageHeader } from '@/components/PageHeader';
import { QRCode } from '@/components/QRCode';
import { Toast, type ToastValue } from '@/components/Toast';
import { Toggle } from '@/components/Toggle';
import {
  useBulkJoinTokens,
  useCreateJoinToken,
  useHardDeleteJoinToken,
  useJoinTokens,
  useRevokeJoinToken,
} from '@/hooks/useJoinTokens';
import { apiErrorMessage } from '@/lib/api';
import { useDateTime } from '@/lib/formatters';
import type {
  JoinTokenCreated,
  JoinTokenMeta,
  JoinTokenStatus,
} from '@/types/api';

// Map server-derived status to badge colour. Kept in one place so a new
// status value triggers a compile error if the union changes.
const STATUS_VARIANT: Record<JoinTokenStatus, BadgeVariant> = {
  active: 'active',
  used: 'info',
  expired: 'warn',
  revoked: 'disabled',
};

// Expiry presets the admin can pick without typing a number. Matches the
// backend cap (30 days max). `null` = never expires.
const EXPIRY_PRESETS: { label: string; minutes: number | null }[] = [
  { label: '15 minutes', minutes: 15 },
  { label: '1 hour', minutes: 60 },
  { label: '24 hours', minutes: 60 * 24 },
  { label: '7 days', minutes: 60 * 24 * 7 },
  { label: '30 days (max)', minutes: 30 * 24 * 60 },
  { label: 'Never', minutes: null },
];

// `fmtDate` lives in `lib/formatters` now — see `useDateTime()` below.

export function JoinTokensPage() {
  // Whether to include revoked tokens in the list. Default OFF per
  // feedback — "revoke = out of sight". Admin can flip the toggle to
  // audit the full history.
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const { data: rows = [], isLoading } = useJoinTokens(includeRevoked);
  const create = useCreateJoinToken();
  const revoke = useRevokeJoinToken();
  const hardDelete = useHardDeleteJoinToken();
  const bulk = useBulkJoinTokens();
  const { fmt: fmtDate } = useDateTime();

  const [openCreate, setOpenCreate] = useState(false);
  const [pendingLabel, setPendingLabel] = useState('');
  const [pendingExpiry, setPendingExpiry] = useState<number | null>(60 * 24); // default: 24h
  const [minted, setMinted] = useState<JoinTokenCreated | null>(null);
  // When the admin tries to dismiss the disclosure via X/Esc/backdrop we
  // intercept and ask for confirmation — UNLESS they've already copied at
  // least once (tracked via `copiedAt`), in which case the data is safely
  // on the clipboard / forwarded and dismiss can skip the confirm step.
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<JoinTokenMeta | null>(null);
  const [confirmHardDelete, setConfirmHardDelete] = useState<JoinTokenMeta | null>(null);
  const [confirmBulk, setConfirmBulk] = useState<'revoke' | 'delete' | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [toast, setToast] = useState<ToastValue | null>(null);

  // Invite URL helper — the backend surfaces it via public /api/join/:token,
  // so the admin can paste either the plaintext token or the full URL into
  // the end-user's onboarding message.
  const inviteUrl = useMemo(() => {
    if (!minted) return '';
    return `${window.location.origin}/join/${minted.token}`;
  }, [minted]);

  const columns: Column<JoinTokenMeta>[] = [
    {
      key: 'token_prefix',
      header: 'Prefix',
      cell: (t) => (
        <span className="rd-mono" style={{ color: 'var(--fg-muted)' }}>
          {t.token_prefix}…
        </span>
      ),
    },
    {
      key: 'label',
      header: 'Label',
      cell: (t) =>
        t.label ? (
          <span>{t.label}</span>
        ) : (
          <span style={{ color: 'var(--fg-muted)' }}>—</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (t) => (
        <Badge variant={STATUS_VARIANT[t.status]} dot>
          {t.status}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      cell: (t) => (
        <span style={{ color: 'var(--fg-muted)' }} className="rd-mono">
          {fmtDate(t.created_at)}
        </span>
      ),
    },
    {
      key: 'expires_at',
      header: 'Expires',
      cell: (t) => (
        <span style={{ color: 'var(--fg-muted)' }} className="rd-mono">
          {t.expires_at ? fmtDate(t.expires_at) : 'never'}
        </span>
      ),
    },
    {
      key: 'used_at',
      header: 'Used',
      cell: (t) => (
        <span style={{ color: 'var(--fg-muted)' }} className="rd-mono">
          {fmtDate(t.used_at)}
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
          <DropdownMenu
            ariaLabel={`Actions for ${t.token_prefix}`}
            trigger={
              <Button
                variant="ghost"
                size="sm"
                icon={MoreHorizontal}
                aria-label={`Actions for ${t.token_prefix}`}
              />
            }
            items={[
              {
                id: 'revoke',
                label: 'Revoke…',
                destructive: true,
                disabled: t.revoked,
                onSelect: () => setConfirm(t),
              },
              {
                id: 'delete',
                label: 'Delete permanently…',
                destructive: true,
                onSelect: () => setConfirmHardDelete(t),
              },
            ]}
          />
        </div>
      ),
    },
  ];

  const resetCreateForm = () => {
    setPendingLabel('');
    setPendingExpiry(60 * 24);
  };

  const submitCreate = () => {
    const label = pendingLabel.trim() || null;
    create.mutate(
      { label, expires_in_minutes: pendingExpiry },
      {
        onSuccess: (data) => {
          setOpenCreate(false);
          resetCreateForm();
          // The plaintext token lives only in `data`. Stash it in local
          // state so the one-shot disclosure modal can display it; we
          // never write it anywhere else.
          setMinted(data);
        },
        onError: (err) =>
          setToast({ kind: 'error', text: apiErrorMessage(err) }),
      },
    );
  };

  return (
    <>
      <PageHeader
        title="Join tokens"
        subtitle="Single-use invite tokens for onboarding a new device's RustDesk client. Not the same as Personal Access Tokens on My account (those are for API scripts). Each invite is shown in plaintext exactly once — copy it immediately."
        action={
          <Button icon={Plus} onClick={() => setOpenCreate(true)}>
            Create invitation
          </Button>
        }
      />
      <div className="rd-toolbar">
        <div className="rd-toolbar__group">
          <Toggle
            checked={includeRevoked}
            onChange={setIncludeRevoked}
            label="Show revoked"
          />
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
              onClick={() => setConfirmBulk('revoke')}
            >
              Revoke
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
      <DataTable<JoinTokenMeta>
        rows={rows}
        columns={columns}
        empty={
          isLoading
            ? 'Loading…'
            : includeRevoked
              ? 'No invitations yet. Create one to onboard a device.'
              : 'No active invitations. Toggle "Show revoked" to see history, or Create one to onboard a device.'
        }
        selectable
        selectedIds={selectedIds}
        onSelectionChange={(ids) =>
          setSelectedIds(
            ids
              .map((i) => (typeof i === 'number' ? i : Number(i)))
              .filter((i) => !Number.isNaN(i)),
          )
        }
      />

      {/* ─── Create dialog ─────────────────────────────────────────── */}
      <Dialog
        open={openCreate}
        onClose={() => {
          // Neutral toast on dismiss — Jandro repeatedly reported
          // "cancel created it anyway" confusion. The code never creates
          // on cancel; this toast makes the non-outcome explicit so the
          // admin has a positive signal that nothing was persisted.
          setOpenCreate(false);
          resetCreateForm();
          if (!create.isPending) {
            setToast({ kind: 'ok', text: 'No invitation created.' });
          }
        }}
        title="Create invitation"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpenCreate(false);
                resetCreateForm();
                setToast({ kind: 'ok', text: 'No invitation created.' });
              }}
            >
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={create.isPending}>
              {create.isPending ? 'Generating…' : 'Generate link'}
            </Button>
          </>
        }
      >
        <div className="rd-form">
          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="jt-label">
              Label (optional)
            </label>
            <input
              id="jt-label"
              className="rd-input"
              autoFocus
              value={pendingLabel}
              onChange={(e) => setPendingLabel(e.target.value)}
              placeholder="Abuela — laptop"
              maxLength={128}
            />
            <div className="rd-form__hint">
              Free-form note. Shown in the list so admins can tell invites
              apart. ≤ 128 characters.
            </div>
          </div>
          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="jt-expiry">
              Expires
            </label>
            <select
              id="jt-expiry"
              className="rd-input"
              value={pendingExpiry === null ? 'never' : String(pendingExpiry)}
              onChange={(e) =>
                setPendingExpiry(
                  e.target.value === 'never' ? null : Number(e.target.value),
                )
              }
            >
              {EXPIRY_PRESETS.map((p) => (
                <option
                  key={p.label}
                  value={p.minutes === null ? 'never' : String(p.minutes)}
                >
                  {p.label}
                </option>
              ))}
            </select>
            <div className="rd-form__hint">
              Invites are not long-lived credentials — prefer the shortest
              expiry that fits the onboarding window.
            </div>
          </div>
        </div>
      </Dialog>

      {/* ─── One-shot disclosure modal ─────────────────────────────── */}
      {/*
       * X / Esc / backdrop route through `confirmDismiss` instead of
       * closing the modal directly — if the admin dismisses by accident
       * the token is unrecoverable, so we ask before letting them go.
       * The primary "I've saved it" button skips the confirm (it's the
       * explicit acknowledgement path).
       */}
      <Dialog
        open={!!minted}
        onClose={() => {
          // If the admin has already captured the invite through any of
          // the share actions, a re-confirmation adds friction without
          // protecting anything — the data is out of the modal. Close
          // directly. Otherwise fall through to the guard dialog.
          if (copiedAt !== null) {
            setMinted(null);
            setCopiedAt(null);
            setToast({ kind: 'ok', text: 'Invitation created.' });
          } else {
            setConfirmDismiss(true);
          }
        }}
        title="Share this invitation"
        width={560}
        footer={
          <Button
            onClick={() => {
              setMinted(null);
              setCopiedAt(null);
              setToast({ kind: 'ok', text: 'Invitation created.' });
            }}
          >
            {copiedAt !== null
              ? 'Done — close'
              : 'I\u2019ve copied the invite \u2014 close'}
          </Button>
        }
      >
        {minted ? (
          <div className="rd-form">
            <div
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                padding: '10px 12px',
                borderRadius: 8,
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                color: 'var(--fg)',
              }}
              role="alert"
            >
              <AlertTriangle
                size={18}
                style={{ color: 'var(--amber-600, #f59e0b)', flexShrink: 0, marginTop: 2 }}
              />
              <div style={{ fontSize: 13, lineHeight: 1.45 }}>
                This invitation is <strong>single-use</strong> and shown{' '}
                <strong>only once</strong>. Send it to the user through one
                of the channels below — if you close this without copying
                or forwarding, you&apos;ll need to revoke and create a new
                one.
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <CopyableField
                label="Invite URL"
                value={inviteUrl}
                onCopy={() => setCopiedAt(Date.now())}
              />
            </div>

            <ShareRow inviteUrl={inviteUrl} onShared={() => setCopiedAt(Date.now())} />

            <div
              style={{
                marginTop: 14,
                display: 'flex',
                justifyContent: 'center',
                padding: 14,
                background: 'var(--card, #fff)',
                border: '1px solid var(--border)',
                borderRadius: 8,
              }}
            >
              <QRCode value={inviteUrl} size={180} ariaLabel="Invite URL QR code" />
            </div>

            <details style={{ marginTop: 10 }}>
              <summary
                style={{
                  color: 'var(--fg-muted)', fontSize: 12, cursor: 'pointer',
                }}
              >
                Show raw token (usually not needed)
              </summary>
              <div style={{ marginTop: 8 }}>
                <CopyableField
                  label="Token"
                  value={minted.token}
                  onCopy={() => setCopiedAt(Date.now())}
                />
              </div>
            </details>

            <div
              className="rd-form__hint"
              style={{ marginTop: 10, color: 'var(--fg-muted)' }}
            >
              Invite expires {minted.expires_at ? `on ${fmtDate(minted.expires_at)}` : 'never'}.
            </div>
          </div>
        ) : null}
      </Dialog>

      {/* ─── Dismiss-without-copying guard ─────────────────────────── */}
      <ConfirmDialog
        open={confirmDismiss}
        onClose={() => setConfirmDismiss(false)}
        onConfirm={() => {
          setConfirmDismiss(false);
          setMinted(null);
          setCopiedAt(null);
          setToast({ kind: 'ok', text: 'Invitation created.' });
        }}
        destructive
        confirmLabel="Close anyway"
        title="Did you copy the invitation?"
        body="If you close now without saving the invite URL you won't be able to see it again — you'll have to revoke and create a new one."
      />

      {/* ─── Revoke confirmation ───────────────────────────────────── */}
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const { id, token_prefix } = confirm;
          revoke.mutate(id, {
            onSuccess: () => {
              setConfirm(null);
              setToast({ kind: 'ok', text: `Token ${token_prefix}… revoked.` });
            },
            onError: (err) => {
              setConfirm(null);
              setToast({ kind: 'error', text: apiErrorMessage(err) });
            },
          });
        }}
        destructive
        confirmLabel="Revoke"
        title="Revoke join token?"
        body={
          confirm
            ? `Token ${confirm.token_prefix}…${confirm.label ? ` (${confirm.label})` : ''} will stop working immediately. Any invite URL already sent becomes invalid.`
            : ''
        }
      />

      {/* ─── Hard delete confirmation ──────────────────────────────── */}
      <ConfirmDialog
        open={!!confirmHardDelete}
        onClose={() => setConfirmHardDelete(null)}
        onConfirm={() => {
          if (!confirmHardDelete) return;
          const victim = confirmHardDelete;
          hardDelete.mutate(victim.id, {
            onSuccess: () => {
              setConfirmHardDelete(null);
              setToast({ kind: 'ok', text: `Token ${victim.token_prefix}… deleted permanently.` });
            },
            onError: (err) => {
              setConfirmHardDelete(null);
              setToast({ kind: 'error', text: apiErrorMessage(err) });
            },
          });
        }}
        destructive
        confirmLabel={hardDelete.isPending ? 'Deleting…' : 'Delete permanently'}
        title="Delete invitation permanently?"
        body={
          confirmHardDelete
            ? `Token ${confirmHardDelete.token_prefix}…${confirmHardDelete.label ? ` (${confirmHardDelete.label})` : ''} will be removed from the database. The deletion itself is stamped in the audit log. This cannot be undone.`
            : ''
        }
      />

      {/* ─── Bulk confirmation ─────────────────────────────────────── */}
      <ConfirmDialog
        open={confirmBulk !== null}
        onClose={() => setConfirmBulk(null)}
        onConfirm={() => {
          if (!confirmBulk) return;
          const action = confirmBulk;
          const ids = selectedIds.slice();
          bulk.mutate(
            { action, ids },
            {
              onSuccess: (result) => {
                setConfirmBulk(null);
                setSelectedIds([]);
                const skipped = result.skipped.length;
                const actionWord = action === 'delete' ? 'deleted' : 'revoked';
                const msg =
                  skipped === 0
                    ? `${result.affected} invitation${result.affected === 1 ? '' : 's'} ${actionWord}.`
                    : `${result.affected} ${actionWord}, ${skipped} skipped (${result.skipped.map((s) => s.reason).join(', ')}).`;
                setToast({ kind: skipped === 0 ? 'ok' : 'error', text: msg });
              },
              onError: (err) => {
                setConfirmBulk(null);
                setToast({ kind: 'error', text: apiErrorMessage(err) });
              },
            },
          );
        }}
        destructive
        confirmLabel={
          bulk.isPending
            ? 'Working…'
            : confirmBulk === 'delete'
              ? 'Delete all'
              : 'Revoke all'
        }
        title={
          confirmBulk === 'delete'
            ? `Delete ${selectedIds.length} invitation${selectedIds.length === 1 ? '' : 's'} permanently?`
            : `Revoke ${selectedIds.length} invitation${selectedIds.length === 1 ? '' : 's'}?`
        }
        body={
          confirmBulk === 'delete'
            ? 'Selected invitations will be erased from the database. Audit log keeps a record of each deletion. This cannot be undone.'
            : 'Selected invitations will stop working immediately. Any invite URL already sent becomes invalid. Already-revoked rows are skipped.'
        }
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

/** Row of share affordances shown in the post-create disclosure modal.
 *
 *  Rendered as plain `<a>` elements so the browser handles them natively:
 *  `mailto:` opens the OS mail client, `wa.me` and `t.me/share` open in
 *  a new tab. All three are consumer-facing targets; they don't leak the
 *  token to any third-party backend on their own (the URL is in the
 *  query string, so strictly it traverses the redirecting server — fine
 *  for the invite URL which is single-use and expires, but noted).
 *
 *  `onShared` fires on click so the parent can mark the invite as
 *  captured and skip the dismiss-confirm.
 */
function ShareRow({
  inviteUrl,
  onShared,
}: {
  inviteUrl: string;
  onShared: () => void;
}) {
  const subject = 'Your RustDesk invitation';
  const body = `Open this link once:\n${inviteUrl}\n\nNeed help? Ask your admin.`;
  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(body)}`;
  const telegram =
    `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}` +
    `&text=${encodeURIComponent(subject)}`;

  const linkStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 12px', borderRadius: 6, fontSize: 13,
    border: '1px solid var(--border)', color: 'var(--fg)',
    background: 'var(--card)', textDecoration: 'none',
  };

  return (
    <div
      style={{
        marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap',
      }}
      role="group"
      aria-label="Share invitation"
    >
      <a href={mailto} onClick={onShared} style={linkStyle}>
        <Mail size={14} /> Email
      </a>
      <a
        href={whatsapp}
        target="_blank"
        rel="noreferrer noopener"
        onClick={onShared}
        style={linkStyle}
      >
        <MessageCircle size={14} /> WhatsApp
      </a>
      <a
        href={telegram}
        target="_blank"
        rel="noreferrer noopener"
        onClick={onShared}
        style={linkStyle}
      >
        <Send size={14} /> Telegram
      </a>
    </div>
  );
}
