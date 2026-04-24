/** React Query hooks for Personal Access Tokens.
 *
 *  Scope: the backend scopes every call to the authenticated user, so
 *  there's no user_id in any URL — whatever JWT the app already has does
 *  the disambiguation. That makes these hooks radically simpler than
 *  useTags / useUsers.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ApiTokenCreated, ApiTokenMeta } from '@/types/api';

export const TOKENS_KEY = ['auth', 'tokens'] as const;

export function useApiTokens() {
  return useQuery<ApiTokenMeta[]>({
    queryKey: TOKENS_KEY,
    queryFn: async () => {
      const { data } = await api.get<ApiTokenMeta[]>('/api/auth/tokens');
      return data;
    },
    // Poll every 30s so `last_used_at` reflects live usage of the token
    // without requiring the user to refresh manually.
    refetchInterval: 30_000,
  });
}

export interface CreateTokenBody {
  name: string;
  /** Minutes until expiry. Omit / null = never expires. */
  expires_in_minutes?: number | null;
}

export function useCreateApiToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateTokenBody) => {
      const { data } = await api.post<ApiTokenCreated>(
        '/api/auth/tokens',
        body,
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TOKENS_KEY });
    },
  });
}

export function useRevokeApiToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/auth/tokens/${id}`);
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TOKENS_KEY });
    },
  });
}
