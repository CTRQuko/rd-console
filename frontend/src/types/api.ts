/** Shared types used by the UI and the real API.
 *
 *  v2 note: the backend now surfaces audit entries with `actor_username`
 *  (joined server-side) and new DEVICE_* action values. The mock types
 *  still use camelCase for the older pages — the new pages prefer
 *  snake_case mirroring the backend to avoid a per-call transform.
 */

export type Role = 'Admin' | 'User';
export type Status = 'Active' | 'Disabled';
export type Platform = 'Windows' | 'macOS' | 'Linux' | 'Android';
export type LogAction = 'connect' | 'disconnect' | 'file transfer';

/** Legacy camel-case shape used by Dashboard/Login mock data. */
export interface User {
  id: number;
  username: string;
  email: string;
  role: Role;
  status: Status;
  createdAt: string;
}

/** Legacy camel-case shape used by Dashboard mock data. */
export interface Device {
  id: number;
  rdId: string;
  hostname: string;
  platform: Platform;
  cpu: string;
  version: string;
  online: boolean;
  lastSeenMins: number;
  owner: string;
  ip: string;
}

export interface LogEntry {
  id: number;
  time: string;
  fromId: string;
  toId: string;
  action: LogAction;
  ip: string;
  uuid: string;
}

export interface RecentEntry extends Omit<LogEntry, 'time'> {
  time: string; // already formatted as relative
}

export interface DashboardStats {
  totalUsers: number;
  onlineDevices: number;
  totalDevices: number;
  connectionsToday: number;
  trends: {
    users: string;
    online: string;
    devices: string;
    connections: string;
  };
}

export interface ServerInfo {
  url: string;
  idServer: string;
  relayServer: string;
  publicKey: string;
  version: string;
  name: string;
  offlineTimeout: number;
  allowRegistration: boolean;
}

export interface AuthUser {
  username: string;
  role: Role;
}

/* ── v2 snake_case types mirroring the FastAPI response shapes ── */

export type ApiUserRole = 'admin' | 'user';

/** What /admin/api/users returns per row. */
export interface ApiUser {
  id: number;
  username: string;
  email: string | null;
  role: ApiUserRole;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

/** What /admin/api/devices returns per row. */
export interface ApiDevice {
  id: number;
  rustdesk_id: string;
  hostname: string | null;
  username: string | null;
  platform: string | null;
  cpu: string | null;
  version: string | null;
  owner_user_id: number | null;
  last_ip: string | null;
  last_seen_at: string | null;
  created_at: string;
  online: boolean;
}

export type AuditActionValue =
  | 'connect'
  | 'disconnect'
  | 'file_transfer'
  | 'close'
  | 'login'
  | 'login_failed'
  | 'user_created'
  | 'user_updated'
  | 'user_disabled'
  | 'settings_changed'
  | 'device_updated'
  | 'device_forgotten'
  | 'device_disconnect_requested';

export type AuditCategory = 'session' | 'auth' | 'user_management' | 'config';

export interface ApiAuditLog {
  id: number;
  action: AuditActionValue;
  from_id: string | null;
  to_id: string | null;
  ip: string | null;
  uuid: string | null;
  actor_user_id: number | null;
  actor_username: string | null;
  payload: string | null;
  created_at: string;
}

export interface PaginatedLogs {
  total: number;
  items: ApiAuditLog[];
}
