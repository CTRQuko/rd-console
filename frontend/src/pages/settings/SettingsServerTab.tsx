/** Settings → Server tab.
 *
 *  Lives in its own file so adding more tabs (Appearance, Language, …)
 *  doesn't grow a monolithic SettingsPage.tsx. Behaviour identical to
 *  the pre-tabs version shipped in PR #25.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Save, XCircle, Zap } from 'lucide-react';
import { Button } from '@/components/Button';
import { Toast, type ToastValue } from '@/components/Toast';
import {
  useServerInfo,
  useUpdateServerInfo,
  type ServerInfoPatch,
} from '@/hooks/useServerInfo';
import { useHbbsHealth, type HbbsHealthPort } from '@/hooks/useHbbsHealth';
import { apiErrorMessage } from '@/lib/api';

interface Form {
  server_host: string;
  panel_url: string;
  hbbs_public_key: string;
}

const EMPTY: Form = { server_host: '', panel_url: '', hbbs_public_key: '' };

export function SettingsServerTab() {
  const { t } = useTranslation('settings');
  const { data, isLoading } = useServerInfo();
  const update = useUpdateServerInfo();
  const health = useHbbsHealth();
  const [form, setForm] = useState<Form>(EMPTY);
  const [toast, setToast] = useState<ToastValue | null>(null);

  useEffect(() => {
    if (data) {
      setForm({
        server_host: data.server_host,
        panel_url: data.panel_url,
        hbbs_public_key: data.hbbs_public_key,
      });
    }
  }, [data]);

  const dirtyPatch = useMemo<ServerInfoPatch>(() => {
    if (!data) return {};
    const out: ServerInfoPatch = {};
    if (form.server_host !== data.server_host) out.server_host = form.server_host;
    if (form.panel_url !== data.panel_url) out.panel_url = form.panel_url;
    if (form.hbbs_public_key !== data.hbbs_public_key)
      out.hbbs_public_key = form.hbbs_public_key;
    return out;
  }, [data, form]);

  const isDirty = Object.keys(dirtyPatch).length > 0;

  const onSave = () => {
    if (!isDirty) return;
    update.mutate(dirtyPatch, {
      onSuccess: () => setToast({ kind: 'ok', text: 'Settings saved.' }),
      onError: (err) =>
        setToast({ kind: 'error', text: apiErrorMessage(err) }),
    });
  };

  if (isLoading && !data) {
    return <div style={{ color: 'var(--fg-muted)' }}>Loading…</div>;
  }

  return (
    <>
      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">{t('server.title')}</h2>
        <p className="rd-settings-section__sub">
          {t('server.description')}
        </p>
        <div className="rd-settings-section__body">
          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="sv-host">
              {t('server.idRelay')}
            </label>
            <input
              id="sv-host"
              className="rd-input"
              value={form.server_host}
              onChange={(e) => setForm({ ...form, server_host: e.target.value })}
              placeholder="rustdesk.example.com"
              style={{ maxWidth: 520 }}
            />
            <div className="rd-form__hint">
              {t('server.idRelayHint')}
            </div>
          </div>

          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="sv-panel">
              {t('server.panelUrl')}
            </label>
            <input
              id="sv-panel"
              className="rd-input"
              value={form.panel_url}
              onChange={(e) => setForm({ ...form, panel_url: e.target.value })}
              placeholder="https://panel.example.com"
              style={{ maxWidth: 520 }}
            />
            <div className="rd-form__hint">
              {t('server.panelUrlHint')}
            </div>
          </div>

          <div className="rd-form__field">
            <label className="rd-form__label" htmlFor="sv-pubkey">
              {t('server.publicKey')}
            </label>
            <textarea
              id="sv-pubkey"
              className="rd-input rd-mono"
              value={form.hbbs_public_key}
              onChange={(e) =>
                setForm({ ...form, hbbs_public_key: e.target.value })
              }
              placeholder="Contents of id_ed25519.pub (base64 blob, one line)"
              rows={3}
              style={{ maxWidth: 520, resize: 'vertical' }}
            />
            <div className="rd-form__hint">
              {t('server.publicKeyHint')}
            </div>
          </div>
        </div>
        <div className="rd-settings-section__foot">
          <Button
            icon={Save}
            onClick={onSave}
            disabled={!isDirty || update.isPending}
          >
            {update.isPending ? t('common:states.saving') : t('common:actions.saveChanges')}
          </Button>
        </div>
      </section>

      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">{t('server.connectivityTitle')}</h2>
        <p className="rd-settings-section__sub">
          {t('server.connectivityDescription')}
        </p>
        <div className="rd-settings-section__body">
          {health.data ? (
            <HealthReport
              host={health.data.host}
              ports={health.data.ports}
              healthy={health.data.healthy}
              lastHeartbeatAt={health.data.last_heartbeat_at}
              lastHeartbeatAgoSeconds={health.data.last_heartbeat_ago_seconds}
              t={t}
            />
          ) : (
            <div style={{ fontSize: '0.929rem', color: 'var(--fg-muted)' }}>
              {t('server.connectivityHint')}
            </div>
          )}
          {health.isError && (
            <div className="rd-form__error">
              {apiErrorMessage(health.error)}
            </div>
          )}
        </div>
        <div className="rd-settings-section__foot">
          <Button
            icon={Zap}
            onClick={() => health.mutate()}
            disabled={health.isPending}
            variant="secondary"
          >
            {health.isPending ? t('server.connectivityProbing') : t('server.connectivityProbe')}
          </Button>
        </div>
      </section>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

// ─── Health report subview ──────────────────────────────────────────────────
//
// Extracted to keep the main component's JSX readable. Pure presentational —
// no data fetching, no state, no mutation. All strings go through the t()
// of the parent so new locales don't need to be plumbed down.

interface HealthReportProps {
  host: string;
  ports: HbbsHealthPort[];
  healthy: boolean;
  lastHeartbeatAt: string | null;
  lastHeartbeatAgoSeconds: number | null;
  t: (key: string) => string;
}

function HealthReport({
  host,
  ports,
  healthy,
  lastHeartbeatAt,
  lastHeartbeatAgoSeconds,
  t,
}: HealthReportProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: '0.929rem', color: 'var(--fg-muted)' }}>
        {t('server.connectivityHost')}:{' '}
        <span className="rd-mono" style={{ color: 'var(--fg)' }}>{host}</span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 8,
        }}
      >
        {ports.map((p) => (
          <PortPill key={p.port} port={p} t={t} />
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          paddingTop: 8,
          borderTop: '1px solid var(--border)',
          fontSize: '0.857rem',
        }}
      >
        <span>
          <strong style={{ color: 'var(--fg)' }}>
            {t('server.connectivityStatus')}:
          </strong>{' '}
          <span
            style={{
              color: healthy ? 'var(--green-600)' : 'var(--red-600)',
              fontWeight: 500,
            }}
          >
            {healthy
              ? t('server.connectivityHealthy')
              : t('server.connectivityUnhealthy')}
          </span>
        </span>
        <span style={{ color: 'var(--fg-muted)' }}>
          <strong style={{ color: 'var(--fg)' }}>
            {t('server.connectivityLastHeartbeat')}:
          </strong>{' '}
          {formatAgo(lastHeartbeatAt, lastHeartbeatAgoSeconds, t)}
        </span>
      </div>
    </div>
  );
}

function PortPill({
  port,
  t,
}: {
  port: HbbsHealthPort;
  t: (key: string) => string;
}) {
  const label = PORT_LABELS[port.port] ?? `port ${port.port}`;
  const Icon = port.ok ? CheckCircle2 : XCircle;
  const tone = port.ok ? 'var(--green-600)' : 'var(--red-600)';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--card)',
      }}
      title={port.error || t('server.connectivityPortOk')}
    >
      <Icon size={16} style={{ color: tone, flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          className="rd-mono"
          style={{ fontSize: '0.857rem', fontWeight: 500 }}
        >
          {port.port}
        </div>
        <div style={{ fontSize: '0.786rem', color: 'var(--fg-muted)' }}>
          {label}
        </div>
      </div>
    </div>
  );
}

const PORT_LABELS: Record<number, string> = {
  21115: 'hbbs NAT test',
  21116: 'hbbs rendezvous',
  21117: 'hbbr relay',
  21118: 'hbbs websocket',
};

function formatAgo(
  iso: string | null,
  seconds: number | null,
  t: (key: string) => string,
): string {
  if (iso === null || seconds === null) return t('server.connectivityNeverSeen');
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
