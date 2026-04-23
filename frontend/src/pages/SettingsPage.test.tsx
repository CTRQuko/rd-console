import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from './SettingsPage';
import { signInAsAdmin, wrap } from '@/test/utils';
import { mockRoute, rx } from '@/test/apiMock';

const SEED = {
  server_host: 'env-host.example',
  panel_url: 'https://env-panel.example',
  hbbs_public_key: 'ENV_PUBKEY',
  version: '0.1.0',
};

describe('<SettingsPage />', () => {
  it('renders current server info', async () => {
    signInAsAdmin();
    mockRoute('GET', rx('/admin/api/settings/server-info'), () => ({
      status: 200,
      data: SEED,
    }));
    wrap(<SettingsPage />);

    expect(
      await screen.findByDisplayValue('env-host.example'),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://env-panel.example')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ENV_PUBKEY')).toBeInTheDocument();
    // Version surfaces read-only.
    expect(screen.getByText('0.1.0')).toBeInTheDocument();
  });

  it('PATCHes only the fields that changed', async () => {
    signInAsAdmin();
    mockRoute('GET', rx('/admin/api/settings/server-info'), () => ({
      status: 200,
      data: SEED,
    }));
    const captured: unknown[] = [];
    mockRoute('PATCH', rx('/admin/api/settings/server-info'), (cfg) => {
      const body = JSON.parse(cfg.data ?? '{}');
      captured.push(body);
      return { status: 200, data: { ...SEED, ...body } };
    });
    wrap(<SettingsPage />);

    const host = await screen.findByDisplayValue('env-host.example');
    fireEvent.change(host, { target: { value: 'live.example' } });

    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      // Only server_host was touched — panel_url and pubkey are NOT in
      // the payload.
      expect(captured.at(-1)).toEqual({ server_host: 'live.example' }),
    );
  });

  it('disables Save when nothing is dirty', async () => {
    signInAsAdmin();
    mockRoute('GET', rx('/admin/api/settings/server-info'), () => ({
      status: 200,
      data: SEED,
    }));
    wrap(<SettingsPage />);

    await screen.findByDisplayValue('env-host.example');
    const save = screen.getByRole('button', { name: /save changes/i });
    expect(save).toBeDisabled();
  });
});
