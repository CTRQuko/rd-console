import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface UserHit {
  id: number;
  username: string;
  email: string | null;
}
export interface DeviceHit {
  id: number;
  rustdesk_id: string;
  hostname: string | null;
}
export interface LogHit {
  id: number;
  action: string;
  actor_username: string | null;
  from_id: string | null;
  to_id: string | null;
  created_at: string;
}
export interface SearchResults {
  users: UserHit[];
  devices: DeviceHit[];
  logs: LogHit[];
}

export const SEARCH_KEY = ['admin', 'search'] as const;

/** Debounces the query string and runs /admin/api/search via React Query. */
export function useGlobalSearch(query: string, enabled: boolean) {
  const [debounced, setDebounced] = useState('');
  // Standard debounce via setTimeout from useEffect.
  useEffect(() => {
    if (!enabled) return; // Nothing to do; `effective` below ignores state.
    const id = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(id);
  }, [query, enabled]);

  // Derived during render so the query key can flip to "" when disabled
  // without a synchronous setState inside the effect body.
  const effective = enabled ? debounced : '';

  const empty: SearchResults = { users: [], devices: [], logs: [] };

  return useQuery<SearchResults>({
    queryKey: [...SEARCH_KEY, effective],
    enabled: enabled && effective.length > 0,
    queryFn: async () => {
      const { data } = await api.get<SearchResults>('/admin/api/search', {
        params: { q: effective },
      });
      return data;
    },
    placeholderData: empty,
  });
}
