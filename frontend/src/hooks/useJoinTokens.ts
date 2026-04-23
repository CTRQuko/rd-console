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

export const JOIN_TOKENS_KEY = ['admin', 'join-tokens'] as const;

export function useJoinTokens() {
  return useQuery<JoinTokenMeta[]>({
    queryKey: JOIN_TOKENS_KEY,
    queryFn: async () => {
      const { data } = await api.get<JoinTokenMeta[]>('/admin/api/join-tokens');
      return data;
    },
  });
}

export interface CreateJoinTokenBody {
  /** Optional free-form label (≤ 128 chars). */
  label?: string | null;
  /** Minutes until expiry (1 .. 30*24*60). null/omitted = never expires. */
  expires_in_minutes?: number | null;
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: JOIN_TOKENS_KEY });
    },
  });
}

export function useRevokeJoinToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/admin/api/join-tokens/${id}`);
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: JOIN_TOKENS_KEY });
    },
  });
}
