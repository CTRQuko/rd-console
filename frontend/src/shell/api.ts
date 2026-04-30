// Shared admin API fetcher.
//
// Each typed page used to carry its own `_xxApi<T>(path, init)` wrapper
// — same body four times: read JWT, attach Authorization header,
// JSON.stringify the body, surface a 401 by clearing the token and
// bouncing to /login, throw on non-OK with the response body trimmed
// to a sane size for toast messages.
//
// Centralised here so any future tweak (e.g. add a request-id header,
// expose a richer error type, route 503 retry through here) lands in
// one place. The pages that still ride on @ts-nocheck (Dashboard,
// Devices, Settings) keep their own local wrappers for now — switching
// them over is a follow-up that pairs naturally with the @ts-nocheck
// removal on those pages.

import { readAuthToken, clearAuthToken } from "./auth";

export interface ApiInit extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

/**
 * Authenticated JSON request.
 *
 * Returns `null` when the server responded with `204 No Content`,
 * the parsed body otherwise. A 401 is treated as "session is gone":
 * the auth token is wiped, the hash routes to `/login`, and the
 * call throws so callers' catch branches don't see partial state.
 *
 * @throws Error on `4xx`/`5xx` status codes (with the response body
 * trimmed to 200 chars in the message), or on `401` after the
 * redirect side-effects fire.
 */
export async function adminApi<T = unknown>(
  path: string,
  init: ApiInit = {},
): Promise<T | null> {
  const token = readAuthToken();
  const headers: Record<string, string> = {
    ...(init.headers || {}),
    ...(token ? { Authorization: "Bearer " + token } : {}),
  };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    clearAuthToken();
    window.location.hash = "/login";
    throw new Error("unauthenticated");
  }
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init.method || "GET"} ${path} -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}
