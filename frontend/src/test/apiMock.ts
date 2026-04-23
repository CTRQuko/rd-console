/** Minimal in-process HTTP mock.
 *
 *  Not MSW — we don't want to add a dep just for these tests. Instead we
 *  patch `axios.defaults.adapter` with a function that matches against a
 *  route table. Each test registers the routes it needs; the table resets
 *  between tests via `resetApiMock()` (called from test/setup.ts).
 *
 *  Kept deliberately tiny; the goal is page-level coverage, not wire
 *  conformance testing.
 */

import axios, { type AxiosRequestConfig } from 'axios';

type Handler = (config: AxiosRequestConfig) => {
  status: number;
  data?: unknown;
  headers?: Record<string, string>;
};

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
}

const routes: Route[] = [];

function urlOf(config: AxiosRequestConfig): string {
  const base = (config.baseURL ?? '').replace(/\/+$/, '');
  const u = config.url ?? '';
  return (base + (u.startsWith('/') ? u : `/${u}`)).replace(/^\/+/, '/');
}

export function mockRoute(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  pattern: RegExp,
  handler: Handler,
) {
  routes.push({ method, pattern, handler });
}

export function resetApiMock() {
  routes.length = 0;
}

// Install once — the test bootstrap imports this module.
axios.defaults.adapter = async (config) => {
  const url = urlOf(config);
  const method = (config.method ?? 'get').toUpperCase();
  const route = routes.find((r) => r.method === method && r.pattern.test(url));
  if (!route) {
    // Surface the unmatched request so broken tests fail loudly rather than
    // hanging on a pending promise.
    const snapshot = routes.map((r) => `${r.method} ${r.pattern}`).join('\n');
    return Promise.reject(
      Object.assign(new Error(`No mock for ${method} ${url}\nKnown routes:\n${snapshot}`), {
        isAxiosError: true,
        config,
        response: { status: 404, data: { detail: 'No mock' }, headers: {}, config, statusText: 'Not Found' },
      }),
    );
  }
  const out = route.handler(config);
  const response = {
    data: out.data,
    status: out.status,
    statusText: out.status >= 200 && out.status < 300 ? 'OK' : 'Error',
    headers: out.headers ?? { 'content-type': 'application/json' },
    config,
    request: {},
  };
  // Mirror axios v1 behaviour: if validateStatus rejects the response code,
  // raise an AxiosError so consumers that branch on 4xx/5xx (JoinPage's
  // 404/410, for example) exercise their catch path in tests.
  const validate = config.validateStatus ?? ((s: number) => s >= 200 && s < 300);
  if (!validate(out.status)) {
    return Promise.reject(
      Object.assign(new Error(`Request failed with status code ${out.status}`), {
        isAxiosError: true,
        config,
        response,
        code: 'ERR_BAD_REQUEST',
      }),
    );
  }
  return response;
}

/** URL helper for routes. Takes a fixed path and returns an anchored regex. */
export function rx(path: string, { suffix = '' } = {}): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}${suffix}$`);
}
