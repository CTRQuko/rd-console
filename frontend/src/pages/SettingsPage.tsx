import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { CopyableField } from '@/components/CopyableField';
import { PageHeader } from '@/components/PageHeader';
import { Toggle } from '@/components/Toggle';
import { mockApi } from '@/mock/mockApi';
import type { ServerInfo } from '@/types/api';

interface SettingsForm {
  name: string;
  offlineTimeout: number;
  allowRegistration: boolean;
}

export function SettingsPage() {
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [form, setForm] = useState<SettingsForm>({
    name: '',
    offlineTimeout: 60,
    allowRegistration: false,
  });

  useEffect(() => {
    mockApi.server().then((s) => {
      setServer(s);
      setForm({
        name: s.name,
        offlineTimeout: s.offlineTimeout,
        allowRegistration: s.allowRegistration,
      });
    });
  }, []);

  if (!server) return <div style={{ color: 'var(--fg-muted)' }}>Loading…</div>;

  return (
    <>
      <PageHeader title="Settings" />

      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">Server info</h2>
        <p className="rd-settings-section__sub">
          Read-only. These values are derived from your environment.
        </p>
        <div className="rd-settings-section__body">
          <CopyableField label="Server URL" value={server.url} />
          <CopyableField label="Public key" value={server.publicKey} />
          <div style={{ fontSize: 13 }}>
            <span className="rd-field__label" style={{ display: 'block', marginBottom: 4 }}>
              Server version
            </span>
            <span className="rd-mono">{server.version}</span>
          </div>
        </div>
      </section>

      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">Configuration</h2>
        <p className="rd-settings-section__sub">Operational settings for this console.</p>
        <div className="rd-settings-section__body">
          <div className="rd-form__field">
            <label className="rd-form__label">Server name</label>
            <input
              className="rd-input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="rd-form__field">
            <label className="rd-form__label">Device offline timeout (minutes)</label>
            <input
              className="rd-input"
              type="number"
              style={{ maxWidth: 200 }}
              value={form.offlineTimeout}
              onChange={(e) =>
                setForm({ ...form, offlineTimeout: Number(e.target.value) })
              }
            />
            <div className="rd-form__hint">
              Devices are marked offline after this many minutes without a heartbeat.
            </div>
          </div>
          <div>
            <Toggle
              checked={form.allowRegistration}
              onChange={(v) => setForm({ ...form, allowRegistration: v })}
              label="Allow self-registration"
            />
            <div className="rd-form__hint" style={{ marginLeft: 48, marginTop: 4 }}>
              When on, anyone with a join token can create their own account.
            </div>
          </div>
        </div>
        <div className="rd-settings-section__foot">
          <Button>Save changes</Button>
        </div>
      </section>

      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">Security</h2>
        <p className="rd-settings-section__sub">Change your panel password.</p>
        <div className="rd-settings-section__body">
          <div className="rd-form__field">
            <label className="rd-form__label">Current password</label>
            <input className="rd-input" type="password" style={{ maxWidth: 320 }} />
          </div>
          <div className="rd-form__field">
            <label className="rd-form__label">New password</label>
            <input className="rd-input" type="password" style={{ maxWidth: 320 }} />
            <div className="rd-form__hint">Minimum 12 characters.</div>
          </div>
          <div className="rd-form__field">
            <label className="rd-form__label">Confirm new password</label>
            <input className="rd-input" type="password" style={{ maxWidth: 320 }} />
          </div>
        </div>
        <div className="rd-settings-section__foot">
          <Button>Update password</Button>
        </div>
      </section>
    </>
  );
}
