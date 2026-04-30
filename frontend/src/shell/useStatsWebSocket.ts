// React hook: subscribe to /api/v1/ws/stats with auto-reconnect.
//
// Usage:
//   const metrics = useStatsWebSocket();
//   if (metrics) console.log(metrics.cpu.pct);
//
// Returns null until the first message arrives. Reconnect / cleanup /
// auth handshake all live in `useJsonWebSocket` — this hook is now a
// 4-line specialisation that nails down the endpoint path and the
// payload type.

import { useJsonWebSocket } from "./useJsonWebSocket";

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
  return useJsonWebSocket<StatsPayload>("/api/v1/ws/stats");
}
