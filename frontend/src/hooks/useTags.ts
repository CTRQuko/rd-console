/** React Query hooks for /admin/api/tags + device tag assignment + bulk ops. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ApiDevice, BulkAction, BulkResult, Tag, TagColor } from '@/types/api';

export const TAGS_KEY = ['admin', 'tags'] as const;
export const DEVICES_KEY = ['admin', 'devices'] as const;

export function useTags() {
  return useQuery<Tag[]>({
    queryKey: TAGS_KEY,
    queryFn: async () => {
      const { data } = await api.get<Tag[]>('/admin/api/tags');
      return data;
    },
  });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; color: TagColor }) => {
      const { data } = await api.post<Tag>('/admin/api/tags', body);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAGS_KEY });
    },
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/admin/api/tags/${id}`);
      return id;
    },
    onSuccess: () => {
      // Tag removal changes device tag lists too.
      qc.invalidateQueries({ queryKey: TAGS_KEY });
      qc.invalidateQueries({ queryKey: DEVICES_KEY });
    },
  });
}

export function useAssignTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { deviceId: number; tagId: number }) => {
      const { data } = await api.post<ApiDevice>(
        `/admin/api/devices/${v.deviceId}/tags/${v.tagId}`,
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DEVICES_KEY });
      qc.invalidateQueries({ queryKey: TAGS_KEY });
    },
  });
}

export function useUnassignTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { deviceId: number; tagId: number }) => {
      const { data } = await api.delete<ApiDevice>(
        `/admin/api/devices/${v.deviceId}/tags/${v.tagId}`,
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DEVICES_KEY });
      qc.invalidateQueries({ queryKey: TAGS_KEY });
    },
  });
}

export interface BulkBody {
  device_ids: number[];
  action: BulkAction;
  tag_id?: number;
  owner_user_id?: number | null;
}

export function useBulkUpdateDevices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: BulkBody) => {
      const { data } = await api.post<BulkResult>(
        '/admin/api/devices/bulk',
        body,
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DEVICES_KEY });
      qc.invalidateQueries({ queryKey: TAGS_KEY });
    },
  });
}
