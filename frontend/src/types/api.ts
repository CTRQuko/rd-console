/** Shared types used by the UI and the mock/real API. */

export type Role = 'Admin' | 'User';
export type Status = 'Active' | 'Disabled';
export type Platform = 'Windows' | 'macOS' | 'Linux' | 'Android';
export type LogAction = 'connect' | 'disconnect' | 'file transfer';

export interface User {
  id: number;
  username: string;
  email: string;
  role: Role;
  status: Status;
  createdAt: string;
}

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
