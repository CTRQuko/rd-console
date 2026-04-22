/** Mock data + simulated API with 200 ms latency.
 *  Keeps the same shape the real backend will expose (see backend/app/routers).
 *  Replace this module with a real axios-backed client in F4.
 */

import type {
  AuthUser,
  DashboardStats,
  Device,
  LogEntry,
  Platform,
  RecentEntry,
  ServerInfo,
  User,
} from '@/types/api';

const usernames = [
  'admin', 'jane.doe', 'bob', 'alice.k', 'mark', 'sysops', 'helpdesk', 'lucy',
  'eric.h', 'nina', 'paul', 'gina', 'sara', 'tom.w', 'viktor', 'eva',
];
const hostnames = [
  'desktop-jane', 'mac-office', 'server-hq', 'lab-pc-01', 'dev-mbp', 'reception',
  'warehouse-pc', 'field-01', 'nuc-vpn', 'qa-win11', 'mac-design', 'kiosk-03',
  'home-server', 'lenovo-x1', 'imac-studio',
];
const platforms: Platform[] = ['Windows', 'macOS', 'Linux', 'Android'];
const actions: LogEntry['action'][] = ['connect', 'disconnect', 'file transfer'];

const seed = (i: number) => {
  const x = Math.sin(i * 9999) * 10000;
  return x - Math.floor(x);
};
const pick = <T>(arr: readonly T[], i: number): T => arr[Math.floor(seed(i) * arr.length)];
const rdId = (i: number) => {
  const n = Math.floor(seed(i + 101) * 900_000_000) + 100_000_000;
  return String(n).replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
};
const ip = (i: number) =>
  `192.168.${Math.floor(seed(i + 22) * 200) + 1}.${Math.floor(seed(i + 44) * 200) + 1}`;

const relAgo = (mins: number): string => {
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${Math.round(mins)} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
};

const USERS: User[] = Array.from({ length: 24 }, (_, i) => ({
  id: i + 1,
  username: usernames[i % usernames.length] + (i >= usernames.length ? String(i) : ''),
  email: `${usernames[i % usernames.length]}@example.com`,
  role: i === 0 ? 'Admin' : seed(i + 7) > 0.8 ? 'Admin' : 'User',
  status: seed(i + 3) > 0.15 ? 'Active' : 'Disabled',
  createdAt: `2025-${String(Math.floor(seed(i + 5) * 12) + 1).padStart(2, '0')}-${String(
    Math.floor(seed(i + 6) * 27) + 1,
  ).padStart(2, '0')}`,
}));

const DEVICES: Device[] = Array.from({ length: 32 }, (_, i) => {
  const online = seed(i + 9) > 0.45;
  return {
    id: i + 1,
    rdId: rdId(i),
    hostname: hostnames[i % hostnames.length] + (i >= hostnames.length ? `-${i}` : ''),
    platform: pick(platforms, i + 2),
    cpu: pick(
      ['Intel i5-12400', 'Apple M2', 'AMD Ryzen 7', 'Intel i7-13700', 'Snapdragon 8'],
      i + 4,
    ),
    version: `1.2.${Math.floor(seed(i + 8) * 9)}`,
    online,
    lastSeenMins: online
      ? Math.floor(seed(i + 1) * 30)
      : Math.floor(seed(i + 11) * 4000) + 30,
    owner: pick(usernames, i + 3),
    ip: ip(i),
  };
});

const LOGS: LogEntry[] = Array.from({ length: 60 }, (_, i) => ({
  id: i + 1,
  time: `2026-04-${String(22 - Math.floor(i / 8)).padStart(2, '0')} ${String(14 - (i % 14)).padStart(2, '0')}:${String(
    (i * 7) % 60,
  ).padStart(2, '0')}`,
  fromId: rdId(i),
  toId: rdId(i + 1000),
  action: pick(actions, i),
  ip: ip(i),
  uuid: `${(seed(i + 50) * 1e16).toString(16).slice(0, 8)}-${(seed(i + 51) * 1e8).toString(16).slice(0, 4)}`,
}));

const RECENT: RecentEntry[] = LOGS.slice(0, 7).map((l) => ({
  ...l,
  time: relAgo(Math.floor(seed(l.id) * 120)),
}));

const STATS: DashboardStats = {
  totalUsers: 42,
  onlineDevices: DEVICES.filter((d) => d.online).length,
  totalDevices: DEVICES.length,
  connectionsToday: 1284,
  trends: {
    users: '+3 this week',
    online: 'Live',
    devices: 'No change',
    connections: '↑ 12% vs yesterday',
  },
};

const SERVER: ServerInfo = {
  url: 'https://console.example.com',
  idServer: 'rd.example.com',
  relayServer: 'rd.example.com',
  publicKey: 'OeVuKk5nlHiXp+APNn0Y3pC1Iw3NuS6Km2n0kQR6Y=',
  version: '0.1.0-rc.4',
  name: 'Homelab Console',
  offlineTimeout: 60,
  allowRegistration: false,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockApi = {
  async login(username: string, password: string): Promise<{ token: string; user: AuthUser }> {
    await sleep(200);
    if (!username || !password) throw new Error('Missing credentials');
    return { token: 'mock.jwt.token', user: { username, role: 'Admin' } };
  },
  async stats(): Promise<DashboardStats> {
    await sleep(200);
    return STATS;
  },
  async recent(): Promise<RecentEntry[]> {
    await sleep(200);
    return RECENT;
  },
  async users(): Promise<User[]> {
    await sleep(200);
    return USERS;
  },
  async devices(): Promise<Device[]> {
    await sleep(200);
    return DEVICES;
  },
  async logs(): Promise<LogEntry[]> {
    await sleep(200);
    return LOGS;
  },
  async server(): Promise<ServerInfo> {
    await sleep(200);
    return SERVER;
  },
};
