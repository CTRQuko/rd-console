import { useEffect, useState } from 'react';
import { Activity, Monitor, Users as UsersIcon, Zap } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { mockApi } from '@/mock/mockApi';
import type { DashboardStats, RecentEntry } from '@/types/api';

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);

  useEffect(() => {
    mockApi.stats().then(setStats);
    mockApi.recent().then(setRecent);
  }, []);

  if (!stats) return <div style={{ color: 'var(--fg-muted)' }}>Loading…</div>;

  const recentCols: Column<RecentEntry>[] = [
    {
      key: 'fromId',
      header: 'From',
      cell: (r) => <span className="rd-mono">{r.fromId}</span>,
    },
    {
      key: 'toId',
      header: 'To',
      cell: (r) => <span className="rd-mono">{r.toId}</span>,
    },
    {
      key: 'action',
      header: 'Action',
      cell: (r) => (
        <Badge
          variant={
            r.action === 'connect'
              ? 'info'
              : r.action === 'file transfer'
                ? 'transfer'
                : 'neutral'
          }
        >
          {r.action}
        </Badge>
      ),
    },
    {
      key: 'time',
      header: 'Time',
      cell: (r) => <span style={{ color: 'var(--fg-muted)' }}>{r.time}</span>,
    },
    {
      key: 'ip',
      header: 'IP',
      cell: (r) => <span className="rd-mono" style={{ color: 'var(--fg-muted)' }}>{r.ip}</span>,
    },
  ];

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Overview of your RustDesk relay." />
      <div className="rd-grid-4" style={{ marginBottom: 20 }}>
        <StatCard
          icon={UsersIcon}
          iconTone="blue"
          label="Total users"
          value={stats.totalUsers}
          trend={stats.trends.users}
          trendTone="up"
        />
        <StatCard
          icon={Activity}
          iconTone="green"
          label="Online devices"
          value={stats.onlineDevices}
          trend={stats.trends.online}
          trendTone="up"
        />
        <StatCard
          icon={Monitor}
          iconTone="zinc"
          label="Total devices"
          value={stats.totalDevices}
          trend={stats.trends.devices}
        />
        <StatCard
          icon={Zap}
          iconTone="violet"
          label="Connections today"
          value={stats.connectionsToday.toLocaleString()}
          trend={stats.trends.connections}
          trendTone="up"
        />
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          margin: '8px 0 12px',
        }}
      >
        <h2 className="rd-section-title">Recent connections</h2>
        <Button variant="ghost" size="sm">
          View all logs
        </Button>
      </div>
      <DataTable<RecentEntry>
        rows={recent}
        pageSize={10}
        empty="No recent connections."
        columns={recentCols}
      />
    </>
  );
}
