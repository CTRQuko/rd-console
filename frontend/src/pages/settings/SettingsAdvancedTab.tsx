/** Settings → Advanced tab.
 *
 *  Escape hatch for operators: export the editable config as `.env`,
 *  surface build/environment info, and leave room for future debug
 *  switches. Kept deliberately separate so accidental clicks on Server
 *  or Security don't lead to destructive-feeling actions.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Button } from '@/components/Button';
import { Toast, type ToastValue } from '@/components/Toast';
import { api, apiErrorMessage } from '@/lib/api';
import { useServerInfo } from '@/hooks/useServerInfo';

export function SettingsAdvancedTab() {
  const { t } = useTranslation('settings');
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
      setToast({ kind: 'ok', text: t('common:toasts.exportDownloaded') });
    } catch (err) {
      setToast({ kind: 'error', text: apiErrorMessage(err) });
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">{t('advanced.exportTitle')}</h2>
        <p className="rd-settings-section__sub">
          {t('advanced.exportDescription')}
        </p>
        <div className="rd-settings-section__foot">
          <Button icon={Download} onClick={onExport} disabled={pending}>
            {pending ? t('common:states.exporting') : t('advanced.downloadEnv')}
          </Button>
        </div>
      </section>

      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">{t('advanced.buildInfo')}</h2>
        <div className="rd-settings-section__body">
          <div style={{ fontSize: 13 }}>
            <div style={{ marginBottom: 6 }}>
              <span
                className="rd-field__label"
                style={{ display: 'inline-block', minWidth: 120, color: 'var(--fg-muted)' }}
              >
                {t('advanced.version')}
              </span>
              <span className="rd-mono">{data?.version ?? t('common:states.unknown')}</span>
            </div>
            <div>
              <span
                className="rd-field__label"
                style={{ display: 'inline-block', minWidth: 120, color: 'var(--fg-muted)' }}
              >
                {t('advanced.frontend')}
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
