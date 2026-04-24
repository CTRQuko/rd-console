/** React Query hooks for admin-minted join tokens (single-use device invites).
 *
 *  Scope: admin-only. The backend enforces it with 403. Unlike PATs there's
 *  no "my tokens" view — every admin sees every token. On create, the
 *  response includes the plaintext `token` exactly once (for pasting into
 *  the invite URL); subsequent list/read calls only return `token_prefix`.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { JoinTokenCreated, JoinTokenMeta } from '@/types/api';

export const JOIN_TOKENS_KEY = (includeRevoked: boolean) =>
  ['admin', 'join-tokens', { includeRevoked }] as const;

export function useJoinTokens(includeRevoked = false) {
  return useQuery<JoinTokenMeta[]>({
    queryKey: JOIN_TOKENS_KEY(includeRevoked),
    queryFn: async () => {
      const { data } = await api.get<JoinTokenMeta[]>('/admin/api/join-tokens', {
        params: includeRevoked ? { include_revoked: true } : undefined,
      });
      return data;
    },
    // Poll every 30s so an admin watching this page sees a token's
    // `used_at` flip within seconds of a peer claiming the invite, without
    // having to F5. Matches the cadence on useDevices.
    refetchInterval: 30_000,
  });
}

export interface CreateJoinTokenBody {
  /** Optional free-form label (≤ 128 chars). */
  label?: string | null;
  /** Minutes until expiry (1 .. 30*24*60). null/omitted = never expires. */
  expires_in_minutes?: number | null;
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  // Multiple query keys exist (with/without include_revoked). Invalidate
  // the common prefix so every variant refetches.
  qc.invalidateQueries({ queryKey: ['admin', 'join-tokens'] });
}

export function useCreateJoinToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateJoinTokenBody) => {
      const { data } = await api.post<JoinTokenCreated>(
        '/admin/api/join-tokens',
        body,
      );
      return data;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

/** Soft revoke — backend sets `revoked=true`. Row stays in DB.
 *  Default list hides revoked, so the admin typically won't see it after. */
export function useRevokeJoinToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/admin/api/join-tokens/${id}`);
      return id;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

/** Hard delete — backend removes the row entirely. Audit trail preserved
 *  via JOIN_TOKEN_DELETED in /admin/api/logs. Irreversible. */
export function useHardDeleteJoinToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/admin/api/join-tokens/${id}?hard=true`);
      return id;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export type BulkJoinTokenAction = 'revoke' | 'delete';

export interface BulkJoinTokenResult {
  action: BulkJoinTokenAction;
  affected: number;
  skipped: { id: number; reason: string }[];
}

export function useBulkJoinTokens() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { action: BulkJoinTokenAction; ids: number[] }) => {
      const { data } = await api.post<BulkJoinTokenResult>(
        '/admin/api/join-tokens/bulk',
        body,
      );
      return data;
    },
    onSuccess: () => invalidateAll(qc),
  });
}
