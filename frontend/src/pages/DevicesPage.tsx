import { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/Button';
import { DataTable, type Column } from '@/components/DataTable';
import { OnlineBadge } from '@/components/OnlineBadge';
import { PageHeader } from '@/components/PageHeader';
import { PlatformIcon } from '@/components/PlatformIcon';
import { Select } from '@/components/Select';
import { relTime } from '@/lib/relative-time';
import { mockApi } from '@/mock/mockApi';
import type { Device } from '@/types/api';

export function DevicesPage() {
  const [rows, setRows] = useState<Device[]>([]);
  const [statusFilter, setStatusFilter] = useState<'All' | 'Online' | 'Offline'>('All');
  const [platformFilter, setPlatformFilter] = useState<
    'All' | 'Windows' | 'macOS' | 'Linux' | 'Android'
  >('All');

  useEffect(() => {
    mockApi.devices().then(setRows);
  }, []);

  const filtered = rows.filter((r) => {
    if (statusFilter === 'Online' && !r.online) return false;
    if (statusFilter === 'Offline' && r.online) return false;
    if (platformFilter !== 'All' && r.platform !== platformFilter) return false;
    return true;
  });

  const columns: Column<Device>[] = [
    {
      key: 'online',
      header: 'Status',
      width: 100,
      cell: (r) => <OnlineBadge online={r.online} />,
    },
    {
      key: 'rdId',
      header: 'RustDesk ID',
      cell: (r) => <span className="rd-mono">{r.rdId}</span>,
    },
    {
      key: 'hostname',
      header: 'Hostname',
      cell: (r) => <span style={{ fontWeight: 500 }}>{r.hostname}</span>,
    },
    {
      key: 'platform',
      header: 'Platform',
      cell: (r) => <PlatformIcon platform={r.platform} />,
    },
    {
      key: 'cpu',
      header: 'CPU',
      cell: (r) => <span style={{ color: 'var(--fg-muted)' }}>{r.cpu}</span>,
    },
    {
      key: 'version',
      header: 'Version',
      cell: (r) => (
        <span className="rd-mono" style={{ color: 'var(--fg-muted)' }}>
          {r.version}
        </span>
      ),
    },
    {
      key: 'lastSeenMins',
      header: 'Last seen',
      cell: (r) => <span style={{ color: 'var(--fg-muted)' }}>{relTime(r.lastSeenMins)}</span>,
    },
    {
      key: 'owner',
      header: 'Owner',
      cell: (r) => r.owner,
    },
    {
      key: 'actions',
      header: '',
      width: 80,
      cell: () => <Button variant="ghost" size="sm" icon={MoreHorizontal} />,
    },
  ];

  return (
    <>
      <PageHeader title="Devices" subtitle="Auto-refreshes every 30 seconds." />
      <div className="rd-toolbar">
        <div className="rd-toolbar__group">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option>All</option>
            <option>Online</option>
            <option>Offline</option>
          </Select>
          <Select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value as typeof platformFilter)}
          >
            <option>All</option>
            <option>Windows</option>
            <option>macOS</option>
            <option>Linux</option>
            <option>Android</option>
          </Select>
        </div>
        <div className="rd-toolbar__group">
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            {filtered.length} devices
          </span>
        </div>
      </div>
      <DataTable<Device>
        rows={filtered}
        pageSize={10}
        empty="No devices match your filters."
        columns={columns}
      />
    </>
  );
}
