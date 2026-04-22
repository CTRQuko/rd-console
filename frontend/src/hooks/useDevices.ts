/** React Query hooks for /admin/api/devices. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ApiDevice } from '@/types/api';

export const devicesKey = ['devices'] as const;

export function useDevices() {
  return useQuery({
    queryKey: devicesKey,
    queryFn: async () => {
      const r = await api.get<ApiDevice[]>('/admin/api/devices');
      return r.data;
    },
    // Devices page header copy promises a 30s refresh.
    refetchInterval: 30_000,
  });
}

export interface DeviceUpdateBody {
  hostname?: string | null;
  owner_user_id?: number | null;
}

export function useUpdateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body: DeviceUpdateBody }) => {
      const r = await api.patch<ApiDevice>(`/admin/api/devices/${id}`, body);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: devicesKey });
    },
  });
}

export function useForgetDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/admin/api/devices/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: devicesKey });
    },
  });
}

export function useDisconnectDevice() {
  return useMutation({
    mutationFn: async (id: number) => {
      const r = await api.post<{ ok: boolean; note?: string }>(
        `/admin/api/devices/${id}/disconnect`,
      );
      return r.data;
    },
  });
}
