import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Monitor } from 'lucide-react';
import { Button } from '@/components/Button';
import { apiErrorMessage, login as apiLogin } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { usePrefs } from '@/store/prefsStore';

export function LoginPage() {
  const { t } = useTranslation();
  const setSession = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const [prefs] = usePrefs();
  const [search] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!username || !password) {
      // Client-side guard so the real API doesn't have to bounce an empty
      // form. The backend rejects these too but this avoids the round trip.
      setErr(t('common:validation.missingCredentials'));
      return;
    }
    setLoading(true);
    try {
      const { user, token } = await apiLogin(username, password);
      setSession(user, token);
      // Deep-link takes precedence over the landing pref: if the
      // auth guard bounced the user to /login?next=/settings?tab=users,
      // honour that so they land back where they intended.
      // Otherwise follow the configured landingPage (Settings → General).
      const next = search.get('next');
      const target = next && next.startsWith('/') ? next : prefs.landingPage;
      navigate(target, { replace: true });
    } catch (ex) {
      setErr(apiErrorMessage(ex, t('common:validation.signInFailed')));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rd-center">
      <div>
        <div className="rd-center__card">
          <div className="rd-center__brand">
            <Monitor size={24} style={{ color: '#2563eb' }} />
            <span className="rd-center__brand-name">{t('pages:signInTitle')}</span>
          </div>
          <form className="rd-form" onSubmit={submit}>
            <div className="rd-form__field">
              <label className="rd-form__label" htmlFor="u">
                {t('pages:username')}
              </label>
              <input
                id="u"
                className="rd-input"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div className="rd-form__field">
              <label className="rd-form__label" htmlFor="p">
                {t('pages:password')}
              </label>
              <input
                id="p"
                className="rd-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {err ? <div style={{ fontSize: 12, color: 'var(--red-600)' }}>{err}</div> : null}
            <Button
              type="submit"
              disabled={loading}
              className="rd-btn--lg"
              style={{ width: '100%', justifyContent: 'center' }}
            >
              {loading ? t('common:states.signingIn') : t('common:actions.sign_in')}
            </Button>
          </form>
        </div>
        <div className="rd-center__foot">
          {t('pages:signInSubtitle')}
          <div style={{ marginTop: 10 }}>
            <Link
              to="/join/demo"
              style={{ color: 'var(--primary)', fontSize: 12, textDecoration: 'none' }}
            >
              {t('pages:haveInvitation')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
