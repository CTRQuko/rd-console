import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DevicesPage } from './DevicesPage';
import { signInAsAdmin, wrap } from '@/test/utils';
import { mockRoute, rx } from '@/test/apiMock';
import type { ApiDevice, ApiUser } from '@/types/api';

const USERS: ApiUser[] = [
  {
    id: 1,
    username: 'admin',
    email: 'admin@rd.local',
    role: 'admin',
    is_active: true,
    created_at: '2025-01-10T10:00:00',
    last_login_at: null,
  },
  {
    id: 2,
    username: 'alice',
    email: 'alice@rd.local',
    role: 'user',
    is_active: true,
    created_at: '2025-01-12T10:00:00',
    last_login_at: null,
  },
];

const DEVICES_SEED: ApiDevice[] = [
  {
    id: 10,
    rustdesk_id: '555 666 777',
    hostname: 'DESKTOP-ALPHA',
    username: 'alice',
    platform: 'Windows',
    cpu: '12C Intel',
    version: '1.4.0',
    owner_user_id: 2,
    last_ip: '10.0.0.11',
    last_seen_at: new Date().toISOString(),
    created_at: '2025-01-12T10:00:00',
    online: true,
    // v3 fields — present but unused in v2 tests.
    note: null,
    is_favorite: false,
    tags: [],
  },
  {
    id: 11,
    rustdesk_id: '888 999 000',
    hostname: 'MBP-BETA',
    username: null,
    platform: 'macOS',
    cpu: 'M3 Pro',
    version: '1.3.9',
    owner_user_id: null,
    last_ip: '10.0.0.12',
    last_seen_at: '2025-01-20T09:00:00',
    created_at: '2025-01-15T10:00:00',
    online: false,
    note: null,
    is_favorite: false,
    tags: [],
  },
];

function installHappyPath() {
  let devices = [...DEVICES_SEED];
  mockRoute('GET', rx('/admin/api/users'), () => ({ status: 200, data: USERS }));
  mockRoute('GET', rx('/admin/api/devices'), () => ({ status: 200, data: devices }));
  mockRoute('GET', rx('/admin/api/tags'), () => ({ status: 200, data: [] }));
  mockRoute('GET', rx('/admin/api/logs'), () => ({ status: 200, data: { total: 0, items: [] } }));
  mockRoute('PATCH', /^\/admin\/api\/devices\/(\d+)$/, (cfg) => {
    const id = Number(cfg.url?.match(/devices\/(\d+)/)?.[1]);
    const body = JSON.parse(cfg.data ?? '{}');
    devices = devices.map((d) => (d.id === id ? { ...d, ...body } : d));
    return { status: 200, data: devices.find((d) => d.id === id) };
  });
  mockRoute('DELETE', /^\/admin\/api\/devices\/(\d+)$/, (cfg) => {
    const id = Number(cfg.url?.match(/devices\/(\d+)/)?.[1]);
    devices = devices.filter((d) => d.id !== id);
    return { status: 204 };
  });
  mockRoute('POST', /^\/admin\/api\/devices\/(\d+)\/disconnect$/, () => ({
    status: 202,
    data: { ok: true, note: 'stub' },
  }));
  return { devices: () => devices };
}

describe('<DevicesPage />', () => {
  it('renders devices and status badges', async () => {
    signInAsAdmin();
    installHappyPath();
    wrap(<DevicesPage />);

    expect(await screen.findByText('DESKTOP-ALPHA')).toBeInTheDocument();
    expect(screen.getByText('MBP-BETA')).toBeInTheDocument();
    // v10 presence: DESKTOP-ALPHA has last_seen_at = now() (see DEVICES_SEED),
    // so its badge renders the "fresh" tier. MBP-BETA has a 2025 timestamp,
    // i.e. well past the 24h cold cutoff, so it's "cold". We assert via the
    // `data-tier` attribute on the badge wrapper — stable across i18n
    // changes (the tooltip text gets translated, the attribute doesn't).
    const alpha = screen.getByText('DESKTOP-ALPHA').closest('tr')!;
    expect(
      alpha.querySelector('.rd-online[data-tier="fresh"]'),
    ).not.toBeNull();
    const beta = screen.getByText('MBP-BETA').closest('tr')!;
    expect(
      beta.querySelector('.rd-online[data-tier="cold"]'),
    ).not.toBeNull();
  });

  it('filters offline devices', async () => {
    signInAsAdmin();
    installHappyPath();
    wrap(<DevicesPage />);
    await screen.findByText('DESKTOP-ALPHA');

    const statusFilter = screen.getAllByRole('combobox')[0];
    await userEvent.selectOptions(statusFilter, 'Offline');
    expect(screen.queryByText('DESKTOP-ALPHA')).not.toBeInTheDocument();
    expect(screen.getByText('MBP-BETA')).toBeInTheDocument();
  });

  it('opens the device drawer on row click', async () => {
    signInAsAdmin();
    installHappyPath();
    wrap(<DevicesPage />);
    await screen.findByText('DESKTOP-ALPHA');

    await userEvent.click(screen.getByText('DESKTOP-ALPHA'));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText(/last user/i)).toBeInTheDocument();
    // "alice" can appear in multiple fields in the drawer (e.g. Last user
    // + Owner); require at least one match rather than uniqueness.
    expect(within(drawer).getAllByText('alice').length).toBeGreaterThan(0);
  });

  it('forgetting a device issues DELETE and removes the row', async () => {
    signInAsAdmin();
    const h = installHappyPath();
    wrap(<DevicesPage />);
    await screen.findByText('DESKTOP-ALPHA');

    const row = screen.getByText('DESKTOP-ALPHA').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /actions for DESKTOP-ALPHA/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /forget device/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^forget$/i }));

    await waitFor(() => {
      expect(h.devices().find((d) => d.id === 10)).toBeUndefined();
    });
  });

  it('disables the Disconnect item for offline devices', async () => {
    signInAsAdmin();
    installHappyPath();
    wrap(<DevicesPage />);
    await screen.findByText('MBP-BETA');

    const row = screen.getByText('MBP-BETA').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /actions for MBP-BETA/i }));
    const disconnect = await screen.findByRole('menuitem', { name: /^disconnect/i });
    expect(disconnect).toBeDisabled();
  });

  it('PATCHes owner_user_id via the Edit owner dialog', async () => {
    signInAsAdmin();
    const patchSpy = vi.fn();
    let devices = [...DEVICES_SEED];
    mockRoute('GET', rx('/admin/api/users'), () => ({ status: 200, data: USERS }));
    mockRoute('GET', rx('/admin/api/devices'), () => ({ status: 200, data: devices }));
    mockRoute('GET', rx('/admin/api/logs'), () => ({ status: 200, data: { total: 0, items: [] } }));
    mockRoute('PATCH', /^\/admin\/api\/devices\/(\d+)$/, (cfg) => {
      const id = Number(cfg.url?.match(/devices\/(\d+)/)?.[1]);
      const body = JSON.parse(cfg.data ?? '{}');
      patchSpy(id, body);
      devices = devices.map((d) => (d.id === id ? { ...d, ...body } : d));
      return { status: 200, data: devices.find((d) => d.id === id) };
    });

    wrap(<DevicesPage />);
    await screen.findByText('MBP-BETA');
    const row = screen.getByText('MBP-BETA').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /actions for MBP-BETA/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /edit owner/i }));

    const dialog = await screen.findByRole('dialog', { name: /edit owner/i });
    await userEvent.selectOptions(within(dialog).getByLabelText(/^owner$/i), '2');
    await userEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith(11, { owner_user_id: 2 });
    });
  });
});
