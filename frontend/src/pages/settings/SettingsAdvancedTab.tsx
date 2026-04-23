/** Settings → Advanced tab.
 *
 *  Escape hatch for operators: export the editable config as `.env`,
 *  surface build/environment info, and leave room for future debug
 *  switches. Kept deliberately separate so accidental clicks on Server
 *  or Security don't lead to destructive-feeling actions.
 */

import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/Button';
import { Toast, type ToastValue } from '@/components/Toast';
import { api, apiErrorMessage } from '@/lib/api';
import { useServerInfo } from '@/hooks/useServerInfo';

export function SettingsAdvancedTab() {
  const { data } = useServerInfo();
  const [toast, setToast] = useState<ToastValue | null>(null);
  const [pending, setPending] = useState(false);

  const onExport = async () => {
    setPending(true);
    try {
      // responseType=text so axios doesn't JSON.parse the plain-text dump.
      const { data: body } = await api.get<string>(
        '/admin/api/settings/export',
        { responseType: 'text', transformResponse: (v) => v },
      );
      // Create a download in-browser; no server-side disposition needed.
      const blob = new Blob([body as unknown as string], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'rd-console.env';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setToast({ kind: 'ok', text: 'Export downloaded.' });
    } catch (err) {
      setToast({ kind: 'error', text: apiErrorMessage(err) });
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">Export configuration</h2>
        <p className="rd-settings-section__sub">
          Download the editable runtime settings as a <code>.env</code>-style
          file. Useful when migrating to a new host. Secrets
          (<code>RD_SECRET_KEY</code>, <code>RD_ADMIN_PASSWORD</code>,
          <code>RD_CLIENT_SHARED_SECRET</code>) are <strong>never</strong>{' '}
          included — copy those from your source env.
        </p>
        <div className="rd-settings-section__foot">
          <Button icon={Download} onClick={onExport} disabled={pending}>
            {pending ? 'Exporting…' : 'Download rd-console.env'}
          </Button>
        </div>
      </section>

      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">Build info</h2>
        <div className="rd-settings-section__body">
          <div style={{ fontSize: 13 }}>
            <div style={{ marginBottom: 6 }}>
              <span
                className="rd-field__label"
                style={{ display: 'inline-block', minWidth: 120, color: 'var(--fg-muted)' }}
              >
                Version
              </span>
              <span className="rd-mono">{data?.version ?? 'unknown'}</span>
            </div>
            <div>
              <span
                className="rd-field__label"
                style={{ display: 'inline-block', minWidth: 120, color: 'var(--fg-muted)' }}
              >
                Frontend
              </span>
              <span className="rd-mono">React + Vite</span>
            </div>
          </div>
        </div>
      </section>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
