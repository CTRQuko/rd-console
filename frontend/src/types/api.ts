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

export type TagColor = 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'zinc';

export const TAG_COLORS: readonly TagColor[] = [
  'blue',
  'green',
  'amber',
  'red',
  'violet',
  'zinc',
] as const;

/** Admin-authored tag label attached to devices for filtering. */
export interface Tag {
  id: number;
  name: string;
  color: TagColor;
  created_at: string;
  device_count: number;
}

/** Short tag reference embedded in ApiDevice.tags. */
export interface TagSummary {
  id: number;
  name: string;
  color: TagColor;
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
  // v3
  note: string | null;
  is_favorite: boolean;
  tags: TagSummary[];
}

/** Result from POST /admin/api/devices/bulk. */
export interface BulkResult {
  affected: number;
  skipped: number;
  action: string;
}

export type BulkAction =
  | 'assign_tag'
  | 'unassign_tag'
  | 'assign_owner'
  | 'forget'
  | 'favorite'
  | 'unfavorite';

/** Mirrors `AuditAction` in `backend/app/models/audit_log.py`. Add new
 *  values here whenever the backend enum grows — the LogsPage filter
 *  dropdown is keyed off this union. */
export type AuditActionValue =
  // Client-protocol events
  | 'connect'
  | 'disconnect'
  | 'file_transfer'
  | 'close'
  // Auth
  | 'login'
  | 'login_failed'
  // Users
  | 'user_created'
  | 'user_updated'
  | 'user_disabled'
  | 'user_enabled'
  | 'user_deleted'
  // Settings + log lifecycle
  | 'settings_changed'
  | 'settings_exported'
  | 'logs_deleted'
  // Devices (panel-initiated)
  | 'device_updated'
  | 'device_forgotten'
  | 'device_disconnect_requested'
  | 'device_bulk_updated'
  // Tagging
  | 'tag_created'
  | 'tag_deleted'
  | 'device_tagged'
  | 'device_untagged'
  // Personal Access Tokens
  | 'api_token_created'
  | 'api_token_revoked'
  // Address book
  | 'address_book_updated'
  | 'address_book_cleared'
  // Join tokens (admin-minted invites)
  | 'join_token_created'
  | 'join_token_revoked'
  | 'join_token_deleted'
  // Panel state backup/restore (Sprint A1 Bloque 4)
  | 'backup_exported'
  | 'backup_restored';

export type AuditCategory =
  | 'session'
  | 'auth'
  | 'user_management'
  | 'config'
  | 'address_book';

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

// ─── Personal Access Tokens (PR #14) ────────────────────────────────────────

/** Token metadata — never contains the plaintext secret. */
export interface ApiTokenMeta {
  id: number;
  name: string;
  /** First 12 chars of the plaintext ("rdcp_abcd123") — safe to render. */
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

/** One-shot response returned by POST /api/auth/tokens. `token` is the
 *  plaintext — the only time it's ever available; persist or surface to
 *  the user immediately. */
export interface ApiTokenCreated {
  token: string;
  metadata: ApiTokenMeta;
}

// ─── Join tokens (PR #18) ───────────────────────────────────────────────────

export type JoinTokenStatus = 'active' | 'used' | 'expired' | 'revoked';

/** Join-token metadata — never contains the plaintext secret after create. */
export interface JoinTokenMeta {
  id: number;
  /** First 8 chars of the plaintext — safe to render. */
  token_prefix: string;
  label: string | null;
  created_by_user_id: number | null;
  created_at: string;
  expires_at: string | null;
  used_at: string | null;
  revoked: boolean;
  status: JoinTokenStatus;
}

/** One-shot create response — `token` is the plaintext, only available here.
 *  Surface it to the admin immediately; losing it means revoke+remint. */
export interface JoinTokenCreated extends JoinTokenMeta {
  token: string;
}

/** Response shape of GET /api/join/:token — snake_case mirrors the backend. */
export interface JoinConfig {
  id_server: string;
  relay_server: string;
  api_server: string;
  public_key: string;
  label: string | null;
}

// ─── Backup / Restore (Sprint A1 Bloque 4) ──────────────────────────────────

/** A single user inside a backup bundle. No password_hash — restore mints a
 *  random one for new accounts; existing accounts keep their hash untouched. */
export interface BackupUser {
  username: string;
  email: string | null;
  role: ApiUserRole;
  is_active: boolean;
  created_at: string;
}

export interface BackupTag {
  name: string;
  color: string;
}

export interface BackupSetting {
  key: string;
  value: string;
}

/** Token metadata only — the plaintext is gone, so restore can't recreate
 *  the token. The export is for audit visibility. */
export interface BackupApiTokenMeta {
  name: string;
  token_prefix: string;
  created_at: string;
  expires_at: string | null;
}

export interface BackupJoinTokenMeta {
  token_prefix: string;
  label: string | null;
  created_at: string;
  expires_at: string | null;
}

/** Full backup bundle — what GET /admin/api/backup returns and what
 *  POST /admin/api/backup/restore accepts. */
export interface BackupBundle {
  schema_version: 1;
  exported_at: string;
  users: BackupUser[];
  tags: BackupTag[];
  settings: BackupSetting[];
  api_tokens: BackupApiTokenMeta[];
  join_tokens: BackupJoinTokenMeta[];
}

/** Per-entity diff returned by the restore endpoint. */
export interface BackupRestoreDiff {
  users: { add: number; update: number };
  tags: { add: number; update: number };
  settings: { add: number; update: number };
  api_tokens: { add: number; skip: number };
  join_tokens: { add: number; skip: number };
}

export type BackupRestoreMode = 'dry_run' | 'apply';

export interface BackupRestoreResult {
  mode: BackupRestoreMode;
  diff: BackupRestoreDiff;
}
