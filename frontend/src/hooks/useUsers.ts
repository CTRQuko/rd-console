/** React Query hooks for /admin/api/users.
 *
 *  The Create flow still lives on mockApi-powered UI in UsersPage pre-v2;
 *  these hooks power the new Edit + Disable flow. The mutations call
 *  `queryClient.invalidateQueries({ queryKey: ['users'] })` so the list
 *  refreshes without a manual refetch.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ApiUser, ApiUserRole } from '@/types/api';

export const usersKey = ['users'] as const;

export function useUsers() {
  return useQuery({
    queryKey: usersKey,
    queryFn: async () => {
      const r = await api.get<ApiUser[]>('/admin/api/users');
      return r.data;
    },
    // Admins occasionally do `last_login_at` audits while a user is logging
    // in. 30s is enough cadence without being chatty.
    refetchInterval: 30_000,
  });
}

export interface UserUpdateBody {
  email?: string | null;
  role?: ApiUserRole;
  is_active?: boolean;
  password?: string;
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body: UserUpdateBody }) => {
      const r = await api.patch<ApiUser>(`/admin/api/users/${id}`, body);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersKey });
    },
  });
}

export function useDisableUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/admin/api/users/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersKey });
    },
  });
}

/** Hard delete (DELETE /admin/api/users/{id}?hard=true) — wipes the user
 *  row plus PATs + address book; preserves devices/audit rows with NULL
 *  owner. Distinct hook from useDisableUser so consumers have to opt in
 *  explicitly. */
export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/admin/api/users/${id}?hard=true`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersKey });
    },
  });
}

export type BulkUserAction = 'disable' | 'enable' | 'delete';

export interface BulkUserResult {
  action: BulkUserAction;
  affected: number;
  skipped: { user_id: number; reason: string }[];
}

export function useBulkUsers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { action: BulkUserAction; user_ids: number[] }) => {
      const r = await api.post<BulkUserResult>('/admin/api/users/bulk', body);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersKey });
    },
  });
}

export interface UserCreateBody {
  username: string;
  email?: string;
  password: string;
  role?: ApiUserRole;
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UserCreateBody) => {
      const r = await api.post<ApiUser>('/admin/api/users', body);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersKey });
    },
  });
}
