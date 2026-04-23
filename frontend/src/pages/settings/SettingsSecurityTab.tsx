/** Settings → Security tab.
 *
 *  Change your panel password + read-only info on auth guardrails. The
 *  password change was previously buried on /account; surfacing it here
 *  (and leaving a link on /account) makes it discoverable as "a server
 *  setting you can tune", matching how operators mentally categorise it.
 */

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/Button';
import { Toast, type ToastValue } from '@/components/Toast';
import { api, apiErrorMessage } from '@/lib/api';

export function SettingsSecurityTab() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<ToastValue | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setToast({ kind: 'error', text: 'New password and confirmation do not match.' });
      return;
    }
    if (next.length < 8) {
      setToast({ kind: 'error', text: 'New password must be at least 8 characters.' });
      return;
    }
    setPending(true);
    try {
      await api.post('/api/auth/change-password', {
        current_password: current,
        new_password: next,
      });
      setCurrent('');
      setNext('');
      setConfirm('');
      setToast({ kind: 'ok', text: 'Password changed.' });
    } catch (err) {
      setToast({ kind: 'error', text: apiErrorMessage(err) });
    } finally {
      setPending(false);
    }
  };

  const canSubmit =
    current.length > 0 && next.length >= 8 && next === confirm && !pending;

  return (
    <>
      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">Change password</h2>
        <p className="rd-settings-section__sub">
          Changes take effect on next sign-in. Your current session stays
          valid until its JWT expires.
        </p>
        <form onSubmit={onSubmit} className="rd-settings-section__body">
          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="pw-current">
              Current password
            </label>
            <input
              id="pw-current"
              type="password"
              className="rd-input"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              style={{ maxWidth: 320 }}
            />
          </div>
          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="pw-new">
              New password
            </label>
            <input
              id="pw-new"
              type="password"
              className="rd-input"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              style={{ maxWidth: 320 }}
            />
            <div className="rd-form__hint">Minimum 8 characters.</div>
          </div>
          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="pw-confirm">
              Confirm new password
            </label>
            <input
              id="pw-confirm"
              type="password"
              className="rd-input"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              style={{ maxWidth: 320 }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="submit" icon={KeyRound} disabled={!canSubmit}>
              {pending ? 'Updating…' : 'Update password'}
            </Button>
          </div>
        </form>
      </section>

      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">Guardrails</h2>
        <p className="rd-settings-section__sub">
          Read-only summary of the auth and abuse-prevention limits in
          effect. Changes to these require redeploying with the matching
          env vars.
        </p>
        <div className="rd-settings-section__body">
          <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
            <div>
              <strong style={{ color: 'var(--fg)' }}>Login rate limit:</strong>{' '}
              10 requests / minute per IP (HTTP 429 after threshold).
            </div>
            <div style={{ marginTop: 6 }}>
              <strong style={{ color: 'var(--fg)' }}>Join redemption rate limit:</strong>{' '}
              30 requests / minute per IP.
            </div>
            <div style={{ marginTop: 6 }}>
              <strong style={{ color: 'var(--fg)' }}>Panel session (JWT):</strong>{' '}
              24 hours, set via <code>RD_ACCESS_TOKEN_EXPIRE_MINUTES</code>.
            </div>
            <div style={{ marginTop: 6 }}>
              <strong style={{ color: 'var(--fg)' }}>Password hashing:</strong>{' '}
              Argon2id, automatic rehash on login when parameters change.
            </div>
          </div>
        </div>
      </section>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
