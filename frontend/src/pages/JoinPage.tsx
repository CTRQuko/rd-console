/** Public onboarding page — GET /api/join/:token.
 *
 *  The backend is STRICT single-use: the first successful GET consumes the
 *  token (sets used_at). Reloading the page yields 410. The UI therefore
 *  warns the user not to close / refresh, and surfaces every piece of
 *  config they need to paste into their RustDesk client manually (the
 *  free client doesn't consume this format automatically).
 *
 *  Error shape:
 *    404 → invalid / revoked
 *    410 → already used / expired
 *    5xx → server error, suggest retry with the admin
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import { AlertCircle, Monitor } from 'lucide-react';
import { Button } from '@/components/Button';
import { CopyableField } from '@/components/CopyableField';
import { api } from '@/lib/api';
import type { JoinConfig } from '@/types/api';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; config: JoinConfig }
  | { kind: 'invalid' } //  404 — token unknown or revoked
  | { kind: 'consumed' } // 410 — already used or expired
  | { kind: 'error'; message: string };

export function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    if (!token) {
      setState({ kind: 'invalid' });
      return;
    }
    // Lightweight charset guard mirroring the backend length check — keeps
    // us from firing a GET on something that obviously isn't a token.
    if (token.length > 64) {
      setState({ kind: 'invalid' });
      return;
    }

    let cancelled = false;
    api
      .get<JoinConfig>(`/api/join/${encodeURIComponent(token)}`)
      .then((res) => {
        if (cancelled) return;
        setState({ kind: 'ok', config: res.data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (axios.isAxiosError(err)) {
          const status = err.response?.status;
          if (status === 404) return setState({ kind: 'invalid' });
          if (status === 410) return setState({ kind: 'consumed' });
        }
        setState({
          kind: 'error',
          message:
            axios.isAxiosError(err) && err.message
              ? err.message
              : 'Unexpected error loading invite.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.kind === 'loading') {
    return (
      <div className="rd-center">
        <div style={{ color: 'var(--fg-muted)' }}>Loading invitation…</div>
      </div>
    );
  }

  if (state.kind === 'invalid' || state.kind === 'consumed' || state.kind === 'error') {
    const title =
      state.kind === 'invalid'
        ? 'This invitation link is invalid or has been revoked.'
        : state.kind === 'consumed'
        ? 'This invitation has already been used or has expired.'
        : 'Something went wrong loading the invitation.';
    const hint =
      state.kind === 'invalid'
        ? 'Ask your administrator for a new invitation.'
        : state.kind === 'consumed'
        ? 'Each invitation is single-use. Ask your administrator for a new one.'
        : state.kind === 'error'
        ? state.message
        : '';
    return (
      <div className="rd-center">
        <div className="rd-error-card">
          <div className="rd-error-card__icon">
            <AlertCircle size={18} />
          </div>
          <div>
            <h3>{title}</h3>
            <p>{hint}</p>
            <div style={{ marginTop: 12 }}>
              <Link to="/login">
                <Button variant="secondary" size="sm">
                  Back to sign in
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { config } = state;

  return (
    <div className="rd-center">
      <div className="rd-join">
        <div className="rd-join__header">
          <Monitor size={28} style={{ color: '#2563eb', marginBottom: 8 }} />
          <h1 className="rd-join__title">
            {config.label ? `Welcome — ${config.label}` : 'Welcome to RustDesk'}
          </h1>
          <p className="rd-join__sub">
            Paste these settings into your RustDesk client once. You can close
            this page when you&apos;re done.
          </p>
        </div>

        {/* The backend marks the token as used on the first successful GET.
            Reloading or sharing this URL won't work — if we don't make that
            explicit here, the next person to open a forwarded link gets a
            confusing 410 with no context. */}
        <div
          role="alert"
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            padding: '10px 12px',
            borderRadius: 8,
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            marginBottom: 16,
          }}
        >
          <AlertCircle
            size={18}
            style={{ color: 'var(--amber-600, #f59e0b)', flexShrink: 0, marginTop: 2 }}
          />
          <div style={{ fontSize: 13, lineHeight: 1.45 }}>
            This invitation is <strong>single-use</strong>. Copy the values
            below before closing this page — reloading won&apos;t show them
            again.
          </div>
        </div>

        <div className="rd-card">
          <h3 className="rd-section-title" style={{ marginBottom: 16 }}>
            Connection settings
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <CopyableField label="ID server" value={config.id_server} />
            <CopyableField label="Relay server" value={config.relay_server} />
            <CopyableField label="Public key" value={config.public_key} />
            <CopyableField label="API server" value={config.api_server} />
          </div>
        </div>

        <div className="rd-card" style={{ marginTop: 16 }}>
          <h3 className="rd-section-title" style={{ marginBottom: 12 }}>
            How to connect
          </h3>
          <ol className="rd-join__steps">
            <li>
              Download RustDesk from{' '}
              <a
                href="https://rustdesk.com/"
                target="_blank"
                rel="noreferrer noopener"
                className="rd-mono"
              >
                rustdesk.com
              </a>
              .
            </li>
            <li>
              Open the app and go to <strong>Ajustes → Red</strong> (or{' '}
              <strong>Settings → Network</strong>).
            </li>
            <li>
              Click <strong>Servidor ID/Relay</strong> and paste the{' '}
              <strong>ID server</strong>, <strong>Relay server</strong>, and{' '}
              <strong>Public key</strong> from above. Leave{' '}
              <em>API server</em> blank unless your admin told you otherwise.
            </li>
            <li>
              Click <strong>Aceptar / OK</strong>. Your device should now show
              as <span className="rd-mono">Ready</span> in the client.
            </li>
          </ol>
        </div>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Link
            to="/login"
            style={{ color: 'var(--fg-muted)', fontSize: 12, textDecoration: 'none' }}
          >
            ← Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
