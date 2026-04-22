/** React Query hooks for /admin/api/devices. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ApiDevice } from '@/types/api';

export const devicesKey = ['admin', 'devices'] as const;

export interface DevicesQuery {
  status?: 'all' | 'online' | 'offline';
  platform?: string;
  tag_id?: number | null;
  favorite?: boolean | null;
}

export function useDevices(q: DevicesQuery = {}) {
  return useQuery({
    // Key includes the query so React Query caches per filter permutation.
    queryKey: [...devicesKey, q],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (q.status && q.status !== 'all') params.status = q.status;
      if (q.platform && q.platform !== 'All') params.platform = q.platform;
      if (q.tag_id != null) params.tag_id = String(q.tag_id);
      if (q.favorite != null) params.favorite = String(q.favorite);
      const r = await api.get<ApiDevice[]>('/admin/api/devices', { params });
      return r.data;
    },
    // Devices page header copy promises a 30s refresh.
    refetchInterval: 30_000,
  });
}

export interface DeviceUpdateBody {
  hostname?: string | null;
  owner_user_id?: number | null;
  // v3
  note?: string | null;
  is_favorite?: boolean;
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
