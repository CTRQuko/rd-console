// React hook: subscribe to /api/v1/ws/notifications with auto-reconnect.
//
// Same shape as useStatsWebSocket — pushes the notifications payload
// every 30 s. Returns null until the first message arrives. The
// Topbar combines this with its existing 60 s polling: WebSocket
// data overrides the poll once connected, so the bell dot updates
// the moment the backend writes a new audit row.
//
// Reconnect / cleanup / auth handshake live in `useJsonWebSocket`;
// this hook is now a thin specialisation.

import { useJsonWebSocket } from "./useJsonWebSocket";
import type { NotificationItem } from "./NotificationsPopover";

export interface NotificationsPayload {
  items: NotificationItem[];
  unread_count: number;
}

export function useNotificationsWebSocket(): NotificationsPayload | null {
  return useJsonWebSocket<NotificationsPayload>("/api/v1/ws/notifications");
}
