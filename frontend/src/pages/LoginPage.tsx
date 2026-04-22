import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Monitor } from 'lucide-react';
import { Button } from '@/components/Button';
import { mockApi } from '@/mock/mockApi';
import { useAuthStore } from '@/store/authStore';

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const { user, token } = await mockApi.login(username, password);
      login(user, token);
      navigate('/', { replace: true });
    } catch (ex) {
      setErr((ex as Error).message || 'Sign-in failed');
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
            <span className="rd-center__brand-name">rd-console</span>
          </div>
          <form className="rd-form" onSubmit={submit}>
            <div className="rd-form__field">
              <label className="rd-form__label" htmlFor="u">
                Username
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
                Password
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
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>
        <div className="rd-center__foot">
          RustDesk Server Manager
          <div style={{ marginTop: 10 }}>
            <Link
              to="/join/demo"
              style={{ color: 'var(--primary)', fontSize: 12, textDecoration: 'none' }}
            >
              Have an invitation? Open join page →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
