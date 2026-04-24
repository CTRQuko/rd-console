/** React Query hook for /admin/api/health/hbbs.
 *
 *  On-demand only (triggered by a button in Settings → Server). We do NOT
 *  auto-refresh — the probe is an outbound network action and we don't
 *  want it running every 30s from every open tab.
 */

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface HbbsHealthPort {
  port: number;
  ok: boolean;
  error: string;
  role: 'hbbs' | 'hbbr';
}

export interface HbbsHealth {
  host: string;
  ports: HbbsHealthPort[];
  healthy: boolean;
  last_heartbeat_at: string | null;
  last_heartbeat_ago_seconds: number | null;
}

/** Mutation-style (not query) because the call has side effects — an
 *  outbound TCP probe against 4 ports. Triggered by a button press only;
 *  no auto-refetch, no cache sharing. */
export function useHbbsHealth() {
  return useMutation<HbbsHealth, unknown, void>({
    mutationFn: async () => {
      const { data } = await api.get<HbbsHealth>('/admin/api/health/hbbs');
      return data;
    },
  });
}
