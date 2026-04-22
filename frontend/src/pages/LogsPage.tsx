import { useEffect, useState } from 'react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { Select } from '@/components/Select';
import { mockApi } from '@/mock/mockApi';
import type { LogEntry } from '@/types/api';

export function LogsPage() {
  const [rows, setRows] = useState<LogEntry[]>([]);
  const [action, setAction] = useState<'All' | LogEntry['action']>('All');
  const [range, setRange] = useState('Last 7 days');

  useEffect(() => {
    mockApi.logs().then(setRows);
  }, []);

  const filtered = rows.filter((r) => action === 'All' || r.action === action);

  const columns: Column<LogEntry>[] = [
    {
      key: 'time',
      header: 'Time',
      cell: (r) => (
        <span className="rd-mono" style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
          {r.time}
        </span>
      ),
    },
    {
      key: 'fromId',
      header: 'From ID',
      cell: (r) => <span className="rd-mono">{r.fromId}</span>,
    },
    {
      key: 'toId',
      header: 'To ID',
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
      key: 'ip',
      header: 'IP',
      cell: (r) => (
        <span className="rd-mono" style={{ color: 'var(--fg-muted)' }}>
          {r.ip}
        </span>
      ),
    },
    {
      key: 'uuid',
      header: 'UUID',
      cell: (r) => (
        <span className="rd-mono" style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
          {r.uuid}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Audit logs" />
      <div className="rd-toolbar">
        <div className="rd-toolbar__group">
          <Select value={range} onChange={(e) => setRange(e.target.value)}>
            <option>Today</option>
            <option>Last 7 days</option>
            <option>Last 30 days</option>
            <option>All time</option>
          </Select>
          <Select
            value={action}
            onChange={(e) => setAction(e.target.value as typeof action)}
          >
            <option>All</option>
            <option>connect</option>
            <option>disconnect</option>
            <option>file transfer</option>
          </Select>
        </div>
        <div className="rd-toolbar__group">
          <Button variant="secondary" size="sm">
            Export CSV
          </Button>
        </div>
      </div>
      <DataTable<LogEntry>
        rows={filtered}
        pageSize={10}
        empty="No log entries match your filters."
        columns={columns}
      />
    </>
  );
}
