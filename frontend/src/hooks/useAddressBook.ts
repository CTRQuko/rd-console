/** React Query hooks for the per-user address book.
 *
 *  The backend is intentionally opaque: it stores a stringified JSON blob
 *  verbatim. This hook handles the double-encoding so the UI can work with
 *  normal typed JS objects.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface AbPeer {
  id: string;
  username?: string;
  hostname?: string;
  alias?: string;
  platform?: string;
  tags?: string[];
  hash?: string;
  // Forward-compat: any fields the backend/client add we don't know about
  // are preserved because we merge into the original on save.
  [key: string]: unknown;
}

export interface AddressBookData {
  tags: string[];
  peers: AbPeer[];
  tag_colors: string; // stringified JSON: {"tagname": colorInt}
  // Forward-compat fields preserved verbatim.
  [key: string]: unknown;
}

export const AB_KEY = ['ab'] as const;

interface AbEnvelope {
  updated_at: string | null;
  data: string;
}

interface AbSnapshot {
  updated_at: string | null;
  data: AddressBookData;
  /** The raw string we fetched — useful for debugging + optimistic rollback. */
  raw: string;
}

const EMPTY_AB: AddressBookData = { tags: [], peers: [], tag_colors: '{}' };

function parseEnvelope(env: AbEnvelope): AbSnapshot {
  if (!env.data) {
    return { updated_at: env.updated_at, data: { ...EMPTY_AB }, raw: '' };
  }
  try {
    const parsed = JSON.parse(env.data) as Partial<AddressBookData>;
    return {
      updated_at: env.updated_at,
      data: {
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        peers: Array.isArray(parsed.peers) ? parsed.peers : [],
        tag_colors:
          typeof parsed.tag_colors === 'string' ? parsed.tag_colors : '{}',
        ...parsed,
      },
      raw: env.data,
    };
  } catch {
    // Corrupted blob — present an empty AB to the UI but keep `raw` so the
    // user doesn't accidentally overwrite a salvageable server copy until
    // they take an explicit action.
    return { updated_at: env.updated_at, data: { ...EMPTY_AB }, raw: env.data };
  }
}

export function useAddressBook() {
  return useQuery<AbSnapshot>({
    queryKey: AB_KEY,
    queryFn: async () => {
      const { data } = await api.post<AbEnvelope>('/api/ab/get', {});
      return parseEnvelope(data);
    },
  });
}

export function useSaveAddressBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: AddressBookData) => {
      // Stringify stably — sort_keys-ish behaviour is nice-to-have for diffs
      // but not load-bearing. JSON.stringify default is fine.
      const stringified = JSON.stringify(next);
      await api.post('/api/ab', { data: stringified });
      return stringified;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: AB_KEY });
    },
  });
}
