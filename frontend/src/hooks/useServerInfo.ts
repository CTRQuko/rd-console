/** React Query hooks for /admin/api/settings/server-info.
 *
 *  GET returns the merged view (env default ∨ runtime override).
 *  PATCH persists overrides; an empty string for a field clears it back
 *  to the env default (delete-on-empty semantics matches the backend).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface ServerInfo {
  server_host: string;
  panel_url: string;
  hbbs_public_key: string;
  version: string;
}

export interface ServerInfoPatch {
  server_host?: string;
  panel_url?: string;
  hbbs_public_key?: string;
}

export const SERVER_INFO_KEY = ['admin', 'settings', 'server-info'] as const;

export function useServerInfo() {
  return useQuery<ServerInfo>({
    queryKey: SERVER_INFO_KEY,
    queryFn: async () => {
      const { data } = await api.get<ServerInfo>('/admin/api/settings/server-info');
      return data;
    },
  });
}

export function useUpdateServerInfo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ServerInfoPatch) => {
      const { data } = await api.patch<ServerInfo>(
        '/admin/api/settings/server-info',
        body,
      );
      return data;
    },
    onSuccess: (data) => {
      // Prime the cache with the server's post-save response so the form
      // doesn't flicker while we refetch.
      qc.setQueryData(SERVER_INFO_KEY, data);
      qc.invalidateQueries({ queryKey: SERVER_INFO_KEY });
    },
  });
}
