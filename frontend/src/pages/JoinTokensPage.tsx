/** Join tokens admin — mint / list / revoke single-use device invites.
 *
 *  Scope: admin-only. The redaction contract matches /api/auth/tokens:
 *  the plaintext `token` comes back ONCE on create (for pasting into the
 *  invite URL) and is never retrievable again. List view only shows the
 *  8-char prefix. The post-create modal is deliberately non-dismissible
 *  on backdrop/Esc — losing the token means revoke + remint.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { Badge, type BadgeVariant } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CopyableField } from '@/components/CopyableField';
import { DataTable, type Column } from '@/components/DataTable';
import { Dialog } from '@/components/Dialog';
import { PageHeader } from '@/components/PageHeader';
import { Toast, type ToastValue } from '@/components/Toast';
import {
  useCreateJoinToken,
  useJoinTokens,
  useRevokeJoinToken,
} from '@/hooks/useJoinTokens';
import { apiErrorMessage } from '@/lib/api';
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

const fmtDate = (s: string | null) =>
  s ? new Date(s).toISOString().replace('T', ' ').slice(0, 16) : '—';

export function JoinTokensPage() {
  const { data: rows = [], isLoading } = useJoinTokens();
  const create = useCreateJoinToken();
  const revoke = useRevokeJoinToken();

  const [openCreate, setOpenCreate] = useState(false);
  const [pendingLabel, setPendingLabel] = useState('');
  const [pendingExpiry, setPendingExpiry] = useState<number | null>(60 * 24); // default: 24h
  const [minted, setMinted] = useState<JoinTokenCreated | null>(null);
  // When the admin tries to dismiss the disclosure via X/Esc/backdrop we
  // intercept and ask for confirmation — but if they click the explicit
  // "I've saved it" button we close straight through. Tracking that intent
  // in a separate flag keeps the two paths honest.
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [confirm, setConfirm] = useState<JoinTokenMeta | null>(null);
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
          <button
            type="button"
            className="rd-iconbtn"
            aria-label={`Revoke ${t.token_prefix}`}
            disabled={t.revoked}
            onClick={() => setConfirm(t)}
            style={t.revoked ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
          >
            <Trash2 size={14} />
          </button>
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
            Mint token
          </Button>
        }
      />
      <DataTable<JoinTokenMeta>
        rows={rows}
        columns={columns}
        empty={
          isLoading
            ? 'Loading…'
            : 'No join tokens yet. Mint one to onboard a device.'
        }
      />

      {/* ─── Create dialog ─────────────────────────────────────────── */}
      <Dialog
        open={openCreate}
        onClose={() => {
          setOpenCreate(false);
          resetCreateForm();
        }}
        title="Mint join token"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpenCreate(false);
                resetCreateForm();
              }}
            >
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={create.isPending}>
              {create.isPending ? 'Minting…' : 'Create'}
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
        onClose={() => setConfirmDismiss(true)}
        title="Copy this token now"
        width={560}
        footer={
          <Button
            onClick={() => {
              setMinted(null);
              setToast({ kind: 'ok', text: 'Join token minted.' });
            }}
          >
            I&apos;ve saved it — close
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
                This is the <strong>only</strong> time the full token will be
                shown. If you close this without copying it, the token is
                unrecoverable — you&apos;ll need to revoke it and mint a new
                one.
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <CopyableField label="Token" value={minted.token} />
            </div>

            <div style={{ marginTop: 10 }}>
              <CopyableField label="Invite URL" value={inviteUrl} />
            </div>

            <div
              className="rd-form__hint"
              style={{ marginTop: 10, color: 'var(--fg-muted)' }}
            >
              Share the invite URL with the end user — it&apos;s single-use
              and expires {minted.expires_at ? `on ${fmtDate(minted.expires_at)} UTC` : 'never'}.
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
          setToast({ kind: 'ok', text: 'Join token minted.' });
        }}
        destructive
        confirmLabel="Close anyway"
        title="Did you copy the token?"
        body="If you close now without saving the token you won't be able to see it again — you'll have to revoke it and mint a new one."
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

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
