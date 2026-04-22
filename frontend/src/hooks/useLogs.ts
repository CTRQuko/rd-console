/** React Query hooks for /admin/api/logs.
 *
 *  The list query accepts all server-side filters. Export helpers dispatch a
 *  direct browser download (new window + query string) rather than hitting
 *  the backend through axios — StreamingResponse + JWT header via axios is
 *  doable but requires us to buffer the full body in memory, which defeats
 *  the point of streaming.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import type {
  ApiAuditLog,
  AuditActionValue,
  AuditCategory,
  PaginatedLogs,
} from '@/types/api';

export interface LogsQuery {
  action?: AuditActionValue;
  category?: AuditCategory;
  since?: string;
  until?: string;
  actor?: string;
  device_id?: number;
  limit?: number;
  offset?: number;
}

export const logsKey = (q: LogsQuery) => ['logs', q] as const;

function buildParams(q: LogsQuery): Record<string, string> {
  const p: Record<string, string> = {};
  if (q.action) p.action = q.action;
  if (q.category) p.category = q.category;
  if (q.since) p.since = q.since;
  if (q.until) p.until = q.until;
  if (q.actor) p.actor = q.actor;
  if (q.device_id !== undefined) p.device_id = String(q.device_id);
  if (q.limit !== undefined) p.limit = String(q.limit);
  if (q.offset !== undefined) p.offset = String(q.offset);
  return p;
}

export function useLogs(query: LogsQuery) {
  return useQuery({
    queryKey: logsKey(query),
    queryFn: async () => {
      const r = await api.get<PaginatedLogs>('/admin/api/logs', {
        params: buildParams(query),
      });
      return r.data;
    },
    // Keep the previous page visible while filters change so the table
    // doesn't collapse to "No events" mid-keystroke.
    placeholderData: (prev) => prev,
  });
}

/** Fetch a single device's recent activity (from_id OR to_id match).
 *  Used inside the Device detail drawer.
 */
export function useDeviceLogs(deviceId: number | null, limit = 10) {
  return useQuery({
    queryKey: ['logs', 'device', deviceId, limit] as const,
    queryFn: async () => {
      if (deviceId == null) return { total: 0, items: [] } as PaginatedLogs;
      const r = await api.get<PaginatedLogs>('/admin/api/logs', {
        params: { device_id: String(deviceId), limit: String(limit) },
      });
      return r.data;
    },
    enabled: deviceId != null,
  });
}

/** Trigger a CSV / NDJSON download for the current filter set. */
export async function downloadLogs(
  query: LogsQuery,
  format: 'csv' | 'ndjson',
): Promise<void> {
  // StreamingResponse + axios blob would materialise the whole body in JS
  // memory. Instead, request via fetch() with the bearer token and pipe the
  // resulting Blob into an anchor download. Still buffered, but without
  // axios' transform hooks running over it.
  const token = useAuthStore.getState().token;
  const params = new URLSearchParams(buildParams(query));
  params.set('format', format);
  const r = await fetch(`/admin/api/logs?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) {
    throw new Error(`Export failed: ${r.status} ${r.statusText}`);
  }
  const blob = await r.blob();
  const filename =
    format === 'csv' ? 'rd-console-audit.csv' : 'rd-console-audit.ndjson';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Format a single audit row for the UI. Extracted so LogsPage and the
 *  Device drawer stay in sync on copy/labels.
 */
export function formatAction(row: ApiAuditLog): string {
  return row.action.replace(/_/g, ' ');
}
