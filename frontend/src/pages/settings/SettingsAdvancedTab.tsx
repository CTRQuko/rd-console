/** Settings → Advanced tab.
 *
 *  Escape hatch for operators: export the editable config as `.env`,
 *  surface build/environment info, and (since A1) provide a portable
 *  JSON backup/restore for the panel state.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Toast, type ToastValue } from '@/components/Toast';
import { api, apiErrorMessage } from '@/lib/api';
import { useServerInfo } from '@/hooks/useServerInfo';
import { downloadBackup, useRestoreBackup } from '@/hooks/useBackup';
import type {
  BackupBundle,
  BackupRestoreDiff,
} from '@/types/api';

export function SettingsAdvancedTab() {
  const { t } = useTranslation('settings');
  const { data } = useServerInfo();
  const [toast, setToast] = useState<ToastValue | null>(null);
  const [pending, setPending] = useState(false);

  // ─── .env export ─────────────────────────────────────────────────────────
  const onExport = async () => {
    setPending(true);
    try {
      const { data: body } = await api.get<string>(
        '/admin/api/settings/export',
        { responseType: 'text', transformResponse: (v) => v },
      );
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

  // ─── Backup / Restore ────────────────────────────────────────────────────
  const restore = useRestoreBackup();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingRestore, setPendingRestore] = useState<BackupBundle | null>(null);
  const [restoreDiff, setRestoreDiff] = useState<BackupRestoreDiff | null>(null);

  const onDownloadBackup = async () => {
    try {
      await downloadBackup();
      setToast({ kind: 'ok', text: t('advanced.backupDownloaded') });
    } catch (err) {
      setToast({ kind: 'error', text: apiErrorMessage(err) });
    }
  };

  const onPickFile = () => fileInputRef.current?.click();

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file later
    if (!file) return;
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as BackupBundle;
      if (bundle.schema_version !== 1) {
        setToast({ kind: 'error', text: t('advanced.backupInvalidSchema') });
        return;
      }
      // Run dry_run first — the user confirms in the modal before apply.
      const result = await restore.mutateAsync({ bundle, mode: 'dry_run' });
      setPendingRestore(bundle);
      setRestoreDiff(result.diff);
    } catch (err) {
      setToast({ kind: 'error', text: t('advanced.backupInvalid') });
    }
  };

  const onConfirmApply = async () => {
    if (!pendingRestore) return;
    try {
      await restore.mutateAsync({ bundle: pendingRestore, mode: 'apply' });
      setToast({ kind: 'ok', text: t('advanced.restoreSuccess') });
      setPendingRestore(null);
      setRestoreDiff(null);
    } catch (err) {
      setToast({ kind: 'error', text: apiErrorMessage(err) });
    }
  };

  const closeRestoreDialog = () => {
    setPendingRestore(null);
    setRestoreDiff(null);
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
        <h2 className="rd-settings-section__title">{t('advanced.backupTitle')}</h2>
        <p className="rd-settings-section__sub">
          {t('advanced.backupDescription')}
        </p>
        <div className="rd-settings-section__foot" style={{ gap: 8 }}>
          <Button icon={Download} onClick={onDownloadBackup}>
            {t('advanced.downloadBackup')}
          </Button>
          <Button
            variant="secondary"
            icon={Upload}
            onClick={onPickFile}
            disabled={restore.isPending}
          >
            {restore.isPending
              ? t('advanced.restoreInspecting')
              : t('advanced.restoreFromFile')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={onFileSelected}
          />
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

      <Dialog
        open={!!restoreDiff}
        onClose={closeRestoreDialog}
        title={t('advanced.confirmRestoreTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={closeRestoreDialog}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={onConfirmApply} disabled={restore.isPending}>
              {restore.isPending
                ? t('common:states.saving')
                : t('advanced.confirmRestoreApply')}
            </Button>
          </>
        }
      >
        <p style={{ margin: '0 0 12px', color: 'var(--fg-muted)' }}>
          {t('advanced.confirmRestoreBody')}
        </p>
        {restoreDiff && (
          <ul className="rd-mono" style={{ paddingLeft: 18, margin: 0, fontSize: 13 }}>
            <li>
              {t('advanced.diffUsers', {
                add: restoreDiff.users.add,
                update: restoreDiff.users.update,
              })}
            </li>
            <li>
              {t('advanced.diffTags', {
                add: restoreDiff.tags.add,
                update: restoreDiff.tags.update,
              })}
            </li>
            <li>
              {t('advanced.diffSettings', {
                add: restoreDiff.settings.add,
                update: restoreDiff.settings.update,
              })}
            </li>
          </ul>
        )}
      </Dialog>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
