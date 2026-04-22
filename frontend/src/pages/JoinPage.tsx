import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, Monitor, QrCode } from 'lucide-react';
import { Button } from '@/components/Button';
import { CopyableField } from '@/components/CopyableField';
import { mockApi } from '@/mock/mockApi';
import type { ServerInfo } from '@/types/api';

export function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const [server, setServer] = useState<ServerInfo | null>(null);

  // Derived from the URL — no extra state needed. In real integration this
  // check will move into the API call's error branch (404 → invalid).
  const invalid = !token || token === 'invalid';

  useEffect(() => {
    if (invalid) return;
    mockApi.server().then(setServer);
  }, [invalid]);

  if (invalid) {
    return (
      <div className="rd-center">
        <div className="rd-error-card">
          <div className="rd-error-card__icon">
            <AlertCircle size={18} />
          </div>
          <div>
            <h3>This invitation link is invalid or has expired.</h3>
            <p>Ask your administrator for a new invitation.</p>
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

  if (!server) {
    return (
      <div className="rd-center">
        <div style={{ color: 'var(--fg-muted)' }}>Loading…</div>
      </div>
    );
  }

  return (
    <div className="rd-center">
      <div className="rd-join">
        <div className="rd-join__header">
          <Monitor size={28} style={{ color: '#2563eb', marginBottom: 8 }} />
          <h1 className="rd-join__title">Welcome to {server.name}</h1>
          <p className="rd-join__sub">You've been invited to connect via RustDesk.</p>
        </div>

        <div className="rd-card">
          <h3 className="rd-section-title" style={{ marginBottom: 16 }}>
            Connection settings
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <CopyableField label="ID server" value={server.idServer} />
            <CopyableField label="Relay server" value={server.relayServer} />
            <CopyableField label="API server" value={server.url} />
            <CopyableField label="Public key" value={server.publicKey} />
          </div>
        </div>

        <div className="rd-card" style={{ marginTop: 16 }}>
          <h3 className="rd-section-title" style={{ marginBottom: 12 }}>
            How to connect
          </h3>
          <ol className="rd-join__steps">
            <li>
              Download RustDesk from <span className="rd-mono">rustdesk.com</span>.
            </li>
            <li>
              Open <strong>Settings → Network → ID/Relay Server</strong>.
            </li>
            <li>Fill in the fields shown above.</li>
            <li>
              Click <strong>OK</strong> — you're connected.
            </li>
          </ol>
          <div className="rd-join__qr">
            <QrCode size={40} />
            <div>
              <div style={{ color: 'var(--fg)', fontWeight: 500 }}>Scan from your phone</div>
              <div style={{ marginTop: 2 }}>
                QR code will appear here when RustDesk Mobile is supported.
              </div>
            </div>
          </div>
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
