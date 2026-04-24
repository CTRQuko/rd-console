/** React Query hooks for the panel-state backup endpoints.
 *
 *  Two-step flow on the UI side:
 *    1. The admin picks a JSON file and we run a `dry_run` to surface the
 *       diff. The user confirms in a modal.
 *    2. We re-POST with `mode=apply` to commit.
 *
 *  Export is a plain GET — handled here as a one-shot async helper rather
 *  than a useQuery, since a download is a side-effecting user action and
 *  caching the bundle in memory would be misleading.
 */

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  BackupBundle,
  BackupRestoreMode,
  BackupRestoreResult,
} from '@/types/api';

/** Fetch the current backup bundle. The caller is responsible for triggering
 *  the file download — see `downloadBackup` below. */
export async function fetchBackup(): Promise<BackupBundle> {
  const { data } = await api.get<BackupBundle>('/admin/api/backup');
  return data;
}

/** Trigger a browser download of the current backup as
 *  `rd-console-backup-YYYYMMDD.json`. Resolves once the download has been
 *  initiated. */
export async function downloadBackup(): Promise<void> {
  const bundle = await fetchBackup();
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const a = document.createElement('a');
  a.href = url;
  a.download = `rd-console-backup-${today}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface RestoreVariables {
  bundle: BackupBundle;
  mode: BackupRestoreMode;
}

/** Run a restore — either as `dry_run` (preview the diff) or `apply`
 *  (commit). Use the same hook for both phases of the UI flow. */
export function useRestoreBackup() {
  return useMutation<BackupRestoreResult, unknown, RestoreVariables>({
    mutationFn: async ({ bundle, mode }) => {
      const { data } = await api.post<BackupRestoreResult>(
        `/admin/api/backup/restore?mode=${mode}`,
        bundle,
      );
      return data;
    },
  });
}
