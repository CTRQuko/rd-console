/** Account page — self-service for the logged-in user.
 *
 *  Current scope: Personal Access Tokens. Will likely grow into change-
 *  password, notification prefs, etc; designed so those slot in as extra
 *  sections without reshuffling the routing.
 *
 *  Key UX constraints driven by the backend:
 *    - The plaintext token is only ever returned ONCE on creation. The
 *      "token created" dialog is therefore modal and must be explicitly
 *      dismissed — we don't want it auto-closing and leaving the user
 *      without the secret.
 *    - Revoked tokens stay in the list (greyed out) so audit trails can
 *      still resolve prefixes, but they're sorted to the bottom and
 *      labelled clearly.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable, type Column } from '@/components/DataTable';
import { Dialog } from '@/components/Dialog';
import { Select } from '@/components/Select';
import { Toast, type ToastValue } from '@/components/Toast';
import {
  useApiTokens,
  useCreateApiToken,
  useRevokeApiToken,
} from '@/hooks/useApiTokens';
import { apiErrorMessage } from '@/lib/api';
import { isExpired, useDateTime } from '@/lib/formatters';
import type { ApiTokenMeta } from '@/types/api';

// UI-only choices for the expiry dropdown. None = never expires.
const EXPIRY_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: 'Never',      minutes: null },
  { label: '7 days',     minutes: 7 * 24 * 60 },
  { label: '30 days',    minutes: 30 * 24 * 60 },
  { label: '90 days',    minutes: 90 * 24 * 60 },
  { label: '1 year',     minutes: 365 * 24 * 60 },
];

// Date formatting moved to `lib/formatters` — `useDateTime()` reads the
// user's Settings → General prefs (format + timezone) and returns a
// `fmt(iso)` helper consumed inline below.

function tokenStatus(t: ApiTokenMeta): { label: string; tone: 'ok' | 'warn' | 'dead' } {
  if (t.revoked_at) return { label: 'Revoked', tone: 'dead' };
  if (isExpired(t.expires_at)) {
    return { label: 'Expired', tone: 'dead' };
  }
  return { label: 'Active', tone: 'ok' };
}

export function SettingsApiTokensTab() {
  const { t } = useTranslation();
  const { data: rows = [], isLoading } = useApiTokens();
  const create = useCreateApiToken();
  const revoke = useRevokeApiToken();
  const { fmt: formatDate } = useDateTime();

  const [openCreate, setOpenCreate] = useState(false);
  const [pendingName, setPendingName] = useState('');
  const [pendingExpiry, setPendingExpiry] = useState<number | null>(null);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<ApiTokenMeta | null>(null);
  const [toast, setToast] = useState<ToastValue | null>(null);

  // Active tokens first, revoked at the bottom. Within each group, newest first.
  const sorted = [...rows].sort((a, b) => {
    const aDead = !!a.revoked_at;
    const bDead = !!b.revoked_at;
    if (aDead !== bDead) return aDead ? 1 : -1;
    return b.created_at.localeCompare(a.created_at);
  });

  const columns: Column<ApiTokenMeta>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (t) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <KeyRound size={14} style={{ color: 'var(--fg-muted)' }} />
          <span>{t.name}</span>
        </div>
      ),
    },
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
      key: 'status',
      header: 'Status',
      cell: (t) => {
        const s = tokenStatus(t);
        const color =
          s.tone === 'ok'
            ? 'var(--ok-fg, #16a34a)'
            : s.tone === 'warn'
              ? 'var(--warn-fg, #b45309)'
              : 'var(--fg-muted)';
        return <span style={{ color }}>{s.label}</span>;
      },
    },
    {
      key: 'last_used_at',
      header: 'Last used',
      cell: (t) => (
        <span className="rd-mono" style={{ color: 'var(--fg-muted)' }}>
          {formatDate(t.last_used_at)}
        </span>
      ),
    },
    {
      key: 'expires_at',
      header: 'Expires',
      cell: (t) => (
        <span className="rd-mono" style={{ color: 'var(--fg-muted)' }}>
          {t.expires_at ? formatDate(t.expires_at) : 'Never'}
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
          {t.revoked_at ? null : (
            <button
              type="button"
              className="rd-iconbtn"
              aria-label={`Revoke ${t.name}`}
              onClick={() => setConfirmRevoke(t)}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ),
    },
  ];

  const submitCreate = () => {
    const name = pendingName.trim();
    if (!name) return;
    create.mutate(
      { name, expires_in_minutes: pendingExpiry },
      {
        onSuccess: (res) => {
          setOpenCreate(false);
          setPendingName('');
          setPendingExpiry(null);
          setFreshToken(res.token);
        },
        onError: (err) =>
          setToast({ kind: 'error', text: apiErrorMessage(err) }),
      },
    );
  };

  const copyFresh = async () => {
    if (!freshToken) return;
    try {
      await navigator.clipboard.writeText(freshToken);
      setToast({ kind: 'ok', text: 'Token copied to clipboard.' });
    } catch {
      setToast({ kind: 'error', text: 'Copy failed — select and copy manually.' });
    }
  };

  return (
    <>
      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">API tokens</h2>
        <p className="rd-settings-section__sub">
          Personal Access Tokens for API scripts and automations — e.g.
          curling the admin API from a cron job. They authenticate{' '}
          <em>you</em> programmatically, scoped to your own account.
          Unrelated to the login password (change it in the Security tab)
          and to device invites (see Join tokens in the sidebar).
        </p>
        <div className="rd-settings-section__foot" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
          <Button icon={Plus} onClick={() => setOpenCreate(true)}>
            New token
          </Button>
        </div>
      </section>
      <DataTable<ApiTokenMeta>
        rows={sorted}
        columns={columns}
        empty={
          isLoading ? t('states.loading') : (
            <div className="rd-empty">
              <p>{t('empty_states.tokens')}</p>
              <Button size="sm" icon={Plus} onClick={() => setOpenCreate(true)}>
                {t('actions.create')}
              </Button>
            </div>
          )
        }
      />

      {/* Create dialog */}
      <Dialog
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        title="New personal access token"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpenCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitCreate}
              disabled={create.isPending || !pendingName.trim()}
            >
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="rd-form">
          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="tok-name">
              Name *
            </label>
            <input
              id="tok-name"
              className="rd-input"
              autoFocus
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value)}
              placeholder="home-cron, grafana, laptop…"
              maxLength={64}
            />
            <div className="rd-form__hint">
              Descriptive label. You can always rotate a token — the name
              just helps you remember which script uses it.
            </div>
          </div>
          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="tok-exp">
              Expiration
            </label>
            <Select
              id="tok-exp"
              value={pendingExpiry ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setPendingExpiry(v === '' ? null : Number(v));
              }}
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.label} value={o.minutes ?? ''}>
                  {o.label}
                </option>
              ))}
            </Select>
            <div className="rd-form__hint">
              Expired tokens are rejected automatically. Revoke early from
              the list above if you want to kill one before its expiry.
            </div>
          </div>
        </div>
      </Dialog>

      {/* One-shot reveal dialog */}
      <Dialog
        open={!!freshToken}
        onClose={() => setFreshToken(null)}
        title="Copy your new token"
        footer={
          <>
            <Button variant="secondary" icon={Copy} onClick={copyFresh}>
              Copy
            </Button>
            <Button onClick={() => setFreshToken(null)}>Done</Button>
          </>
        }
      >
        <div className="rd-form">
          <p style={{ margin: '0 0 12px', color: 'var(--fg-muted)' }}>
            This is the only time you'll see this token. Store it somewhere
            safe — if you lose it you'll need to create a new one.
          </p>
          <pre
            className="rd-mono"
            style={{
              background: 'var(--surface-2, #0d1117)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 12,
              overflowX: 'auto',
              margin: 0,
              userSelect: 'all',
              wordBreak: 'break-all',
              whiteSpace: 'pre-wrap',
            }}
          >
            {freshToken}
          </pre>
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!confirmRevoke}
        onClose={() => setConfirmRevoke(null)}
        onConfirm={() => {
          if (!confirmRevoke) return;
          const { id, name } = confirmRevoke;
          revoke.mutate(id, {
            onSuccess: () => {
              setConfirmRevoke(null);
              setToast({ kind: 'ok', text: `Token "${name}" revoked.` });
            },
            onError: (err) => {
              setConfirmRevoke(null);
              setToast({ kind: 'error', text: apiErrorMessage(err) });
            },
          });
        }}
        destructive
        confirmLabel="Revoke"
        title="Revoke token?"
        body={
          confirmRevoke
            ? `"${confirmRevoke.name}" will stop working immediately. Any script using it must be updated.`
            : ''
        }
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
