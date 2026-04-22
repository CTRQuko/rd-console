/** Typed axios instance + helpers. Reads the JWT from the Zustand auth
 *  store and attaches it as `Authorization: Bearer <token>` on every
 *  request. A 401 response triggers a hard logout so a stale token doesn't
 *  silently linger.
 */

import axios, { AxiosError, type AxiosInstance } from 'axios';
import { useAuthStore } from '@/store/authStore';

/** Base URL. Vite exposes `import.meta.env.BASE_URL`; we also honour
 *  `VITE_API_BASE` when set (useful for split frontend/backend dev).
 */
function resolveBaseUrl(): string {
  const fromEnv =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    (import.meta.env.VITE_API_BASE as string | undefined);
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  return '';
}

export const api: AxiosInstance = axios.create({
  baseURL: resolveBaseUrl(),
  // 20 s is generous for an admin panel — heartbeat/audit endpoints are
  // elsewhere, this is UI-only traffic.
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      // Session expired or revoked — flush the auth store so the router
      // gate redirects to /login. We deliberately don't navigate here; the
      // route guards handle it when the store flips to null.
      useAuthStore.getState().logout();
    }
    return Promise.reject(err);
  },
);

/** Extract the best human-readable error message from an axios failure.
 *  The FastAPI backend returns `{ detail: "..." }` on 4xx; surface that
 *  exactly so "Cannot demote or deactivate the last active admin" reaches
 *  the user verbatim instead of "Request failed with status code 400".
 */
export function apiErrorMessage(err: unknown, fallback = 'Request failed'): string {
  if (axios.isAxiosError(err)) {
    const detail = (err.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      // Pydantic validation error shape: [{ loc, msg, type }, ...]
      const first = detail[0] as { msg?: string } | undefined;
      if (first?.msg) return first.msg;
    }
    return err.message || fallback;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
