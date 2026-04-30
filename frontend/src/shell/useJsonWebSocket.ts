// Shared WebSocket hook: connect to a backend route that pushes JSON
// frames, parse each one as `T`, expose the latest payload.
//
// The two consumers (useStatsWebSocket, useNotificationsWebSocket)
// only differ in the endpoint path and the payload type. Everything
// else — the JWT-via-query-param auth handshake, capped exponential
// backoff reconnect, cleanup on unmount, and the 4001/4003 short
// circuit on auth failures — is identical, so it lives here.
//
// Auth: the JWT travels in `?token=…` because the browser's WebSocket
// constructor doesn't accept custom headers. The backend rejects with
// close code 4001 (missing/invalid) or 4003 (inactive user) without
// accepting the upgrade — those don't trigger a reconnect because
// retrying with the same dead token would just re-trigger the close.

import { useEffect, useRef, useState } from "react";
import { readAuthToken } from "./auth";

export function useJsonWebSocket<T>(path: string): T | null {
  const [data, setData] = useState<T | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const cancelledRef = useRef(false);
  const retriesRef = useRef(0);

  useEffect(() => {
    cancelledRef.current = false;

    const connect = () => {
      if (cancelledRef.current) return;
      const token = readAuthToken();
      if (!token) return;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${window.location.host}${path}?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onmessage = (evt) => {
        try {
          const payload = JSON.parse(evt.data) as T;
          setData(payload);
          retriesRef.current = 0;
        } catch {
          // Malformed frame — ignore. The backend will keep pushing.
        }
      };

      ws.onerror = () => {
        // The close handler does the actual reconnect work.
      };

      ws.onclose = (evt) => {
        wsRef.current = null;
        if (cancelledRef.current) return;
        // Auth failures shouldn't trigger a reconnect loop — wait for
        // the user/token to change before trying again.
        if (evt.code === 4001 || evt.code === 4003) return;
        const delay = Math.min(30_000, 1000 * 2 ** retriesRef.current);
        retriesRef.current += 1;
        window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      cancelledRef.current = true;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      wsRef.current = null;
    };
  }, [path]);

  return data;
}
