// React hook: subscribe to /api/v1/ws/stats with auto-reconnect.
//
// Usage:
//   const metrics = useStatsWebSocket();
//   if (metrics) console.log(metrics.cpu.pct);
//
// Returns null until the first message arrives. Reconnects with a
// capped exponential backoff if the socket drops. Closes cleanly when
// the component using it unmounts (so HMR + route changes don't leak
// open sockets).
//
// Auth: the JWT travels in `?token=…` because the browser's WebSocket
// constructor doesn't accept custom headers. The backend rejects with
// close code 4001 if missing/invalid.

import { useEffect, useRef, useState } from "react";
import { readAuthToken } from "./auth";

export interface StatsPayload {
  cpu: {
    pct: number;
    load1: number;
    load5: number;
    load15: number;
    cores: number;
    ghz: number;
    model: string;
  };
  memory: {
    pct: number;
    used_bytes: number;
    free_bytes: number;
    total_bytes: number;
  };
  sessions_active: number;
  bandwidth_bps: number;
  bandwidth_delta_pct_vs_prev_hour: number;
}

export function useStatsWebSocket(): StatsPayload | null {
  const [data, setData] = useState<StatsPayload | null>(null);
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
      const url = `${proto}://${window.location.host}/api/v1/ws/stats?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onmessage = (evt) => {
        try {
          const payload = JSON.parse(evt.data) as StatsPayload;
          setData(payload);
          retriesRef.current = 0;
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        // The close handler does the actual reconnect work.
      };

      ws.onclose = (evt) => {
        wsRef.current = null;
        if (cancelledRef.current) return;
        // Auth failures (4001/4003) shouldn't trigger a reconnect loop —
        // wait for the user/token to change before trying again.
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
  }, []);

  return data;
}
