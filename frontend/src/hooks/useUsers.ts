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
