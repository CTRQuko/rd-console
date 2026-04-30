// React hook: subscribe to /api/v1/ws/notifications with auto-reconnect.
//
// Same shape as useStatsWebSocket — pushes the notifications payload
// every 30 s. Returns null until the first message arrives. The
// Topbar combines this with its existing 60 s polling: WebSocket
// data overrides the poll once connected, so the bell dot updates
// the moment the backend writes a new audit row.
import { useEffect, useRef, useState } from "react";
import { readAuthToken } from "./auth";
import type { NotificationItem } from "./NotificationsPopover";

export interface NotificationsPayload {
  items: NotificationItem[];
  unread_count: number;
}

export function useNotificationsWebSocket(): NotificationsPayload | null {
  const [data, setData] = useState<NotificationsPayload | null>(null);
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
      const url = `${proto}://${window.location.host}/api/v1/ws/notifications?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onmessage = (evt) => {
        try {
          const payload = JSON.parse(evt.data) as NotificationsPayload;
          setData(payload);
          retriesRef.current = 0;
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        // close handler does the actual reconnect
      };

      ws.onclose = (evt) => {
        wsRef.current = null;
        if (cancelledRef.current) return;
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
