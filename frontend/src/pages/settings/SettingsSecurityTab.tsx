/** Settings → Security tab.
 *
 *  Change your panel password + read-only info on auth guardrails. The
 *  password change was previously buried on /account; surfacing it here
 *  (and leaving a link on /account) makes it discoverable as "a server
 *  setting you can tune", matching how operators mentally categorise it.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/Button';
import { Toast, type ToastValue } from '@/components/Toast';
import { api, apiErrorMessage } from '@/lib/api';

export function SettingsSecurityTab() {
  const { t } = useTranslation('settings');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<ToastValue | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setToast({ kind: 'error', text: t('common:validation.passwordMismatch') });
      return;
    }
    if (next.length < 8) {
      setToast({ kind: 'error', text: t('common:validation.passwordTooShort') });
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
      setToast({ kind: 'ok', text: t('common:toasts.passwordChanged') });
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
        <h2 className="rd-settings-section__title">{t('security.changePassword')}</h2>
        <p className="rd-settings-section__sub">
          {t('security.changePasswordDescription')}
        </p>
        <form onSubmit={onSubmit} className="rd-settings-section__body">
          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="pw-current">
              {t('security.currentPassword')}
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
              {t('security.newPassword')}
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
            <div className="rd-form__hint">{t('security.newPasswordHint')}</div>
          </div>
          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="pw-confirm">
              {t('security.confirmNewPassword')}
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
              {pending ? t('common:states.updating') : t('security.updatePassword')}
            </Button>
          </div>
        </form>
      </section>

      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">{t('security.guardrails')}</h2>
        <p className="rd-settings-section__sub">
          {t('security.guardrailsDescription')}
        </p>
        <div className="rd-settings-section__body">
          <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
            <div>
              <strong style={{ color: 'var(--fg)' }}>
                {t('security.guardrailsLoginLabel')}
              </strong>{' '}
              {t('security.guardrailsLoginValue')}
            </div>
            <div style={{ marginTop: 6 }}>
              <strong style={{ color: 'var(--fg)' }}>
                {t('security.guardrailsJoinLabel')}
              </strong>{' '}
              {t('security.guardrailsJoinValue')}
            </div>
            <div style={{ marginTop: 6 }}>
              <strong style={{ color: 'var(--fg)' }}>
                {t('security.guardrailsJwtLabel')}
              </strong>{' '}
              {t('security.guardrailsJwtValue')}{' '}
              <code>RD_ACCESS_TOKEN_EXPIRE_MINUTES</code>.
            </div>
            <div style={{ marginTop: 6 }}>
              <strong style={{ color: 'var(--fg)' }}>
                {t('security.guardrailsHashLabel')}
              </strong>{' '}
              {t('security.guardrailsHashValue')}
            </div>
          </div>
        </div>
      </section>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
