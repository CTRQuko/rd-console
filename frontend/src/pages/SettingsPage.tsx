/** Panel settings — admin-editable server info.
 *
 *  Backend: /admin/api/settings/server-info (GET merged env+override,
 *  PATCH writes override). Clearing a field posts an empty string, which
 *  the backend interprets as "drop override, fall back to env".
 *
 *  Password change lives on /account — not duplicated here. For v4 the
 *  only editable panel-wide knobs are the three RustDesk bridge values
 *  the end-user pastes into their client (surfaced via the invite flow).
 */

import { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { Toast, type ToastValue } from '@/components/Toast';
import {
  useServerInfo,
  useUpdateServerInfo,
  type ServerInfoPatch,
} from '@/hooks/useServerInfo';
import { apiErrorMessage } from '@/lib/api';

interface Form {
  server_host: string;
  panel_url: string;
  hbbs_public_key: string;
}

const EMPTY: Form = { server_host: '', panel_url: '', hbbs_public_key: '' };

export function SettingsPage() {
  const { data, isLoading } = useServerInfo();
  const update = useUpdateServerInfo();

  const [form, setForm] = useState<Form>(EMPTY);
  const [toast, setToast] = useState<ToastValue | null>(null);

  // Seed the form when data arrives (and re-seed after a save so empty-string
  // clears reflect the live fallback rather than a stale blank).
  useEffect(() => {
    if (data) {
      setForm({
        server_host: data.server_host,
        panel_url: data.panel_url,
        hbbs_public_key: data.hbbs_public_key,
      });
    }
  }, [data]);

  const dirtyPatch = useMemo<ServerInfoPatch>(() => {
    if (!data) return {};
    const out: ServerInfoPatch = {};
    if (form.server_host !== data.server_host) out.server_host = form.server_host;
    if (form.panel_url !== data.panel_url) out.panel_url = form.panel_url;
    if (form.hbbs_public_key !== data.hbbs_public_key)
      out.hbbs_public_key = form.hbbs_public_key;
    return out;
  }, [data, form]);

  const isDirty = Object.keys(dirtyPatch).length > 0;

  const onSave = () => {
    if (!isDirty) return;
    update.mutate(dirtyPatch, {
      onSuccess: () => setToast({ kind: 'ok', text: 'Settings saved.' }),
      onError: (err) =>
        setToast({ kind: 'error', text: apiErrorMessage(err) }),
    });
  };

  if (isLoading && !data) {
    return (
      <>
        <PageHeader title="Settings" />
        <div style={{ color: 'var(--fg-muted)' }}>Loading…</div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Settings" />

      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">RustDesk server</h2>
        <p className="rd-settings-section__sub">
          The values surfaced on the public <code>/join/:token</code> invite
          page so end users can paste them into their RustDesk client. Saved
          values override the container env. Leave a field blank to fall
          back to the env default.
        </p>
        <div className="rd-settings-section__body">
          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="sv-host">
              ID / Relay server (host[:port])
            </label>
            <input
              id="sv-host"
              className="rd-input"
              value={form.server_host}
              onChange={(e) => setForm({ ...form, server_host: e.target.value })}
              placeholder="rustdesk.example.com"
              style={{ maxWidth: 520 }}
            />
            <div className="rd-form__hint">
              Hostname (and optional port) where your hbbs + hbbr run. Both
              ID server and Relay server fields of the client will use this.
            </div>
          </div>

          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="sv-panel">
              Panel public URL
            </label>
            <input
              id="sv-panel"
              className="rd-input"
              value={form.panel_url}
              onChange={(e) => setForm({ ...form, panel_url: e.target.value })}
              placeholder="https://panel.example.com"
              style={{ maxWidth: 520 }}
            />
            <div className="rd-form__hint">
              Public URL used when displaying invite links. Must include the
              scheme (<code>https://</code> or <code>http://</code>).
            </div>
          </div>

          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="sv-pubkey">
              hbbs public key
            </label>
            <textarea
              id="sv-pubkey"
              className="rd-input rd-mono"
              value={form.hbbs_public_key}
              onChange={(e) =>
                setForm({ ...form, hbbs_public_key: e.target.value })
              }
              placeholder="Contents of id_ed25519.pub (base64 blob, one line)"
              rows={3}
              style={{ maxWidth: 520, resize: 'vertical' }}
            />
            <div className="rd-form__hint">
              Contents of <code>id_ed25519.pub</code> on the hbbs host.
              Users paste this into the "Key" field of the client settings
              so they authenticate the server.
            </div>
          </div>
        </div>
        <div className="rd-settings-section__foot">
          <Button
            icon={Save}
            onClick={onSave}
            disabled={!isDirty || update.isPending}
          >
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </section>

      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">Version</h2>
        <div className="rd-settings-section__body">
          <div style={{ fontSize: 13 }}>
            <span
              className="rd-field__label"
              style={{ display: 'block', marginBottom: 4 }}
            >
              rd-console
            </span>
            <span className="rd-mono">{data?.version ?? 'unknown'}</span>
          </div>
        </div>
      </section>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
