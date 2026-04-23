import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import { JoinPage } from './JoinPage';
import { wrap } from '@/test/utils';
import { mockRoute, rx } from '@/test/apiMock';
import type { JoinConfig } from '@/types/api';

const renderAt = (token: string) =>
  wrap(
    <Routes>
      <Route path="/join/:token" element={<JoinPage />} />
    </Routes>,
    { initialRoute: `/join/${token}` },
  );

const SAMPLE: JoinConfig = {
  id_server: 'rd.example.com',
  relay_server: 'rd.example.com',
  api_server: 'https://panel.example.com',
  public_key: 'PUBKEY_ABC',
  label: 'Abuela — laptop',
};

describe('<JoinPage />', () => {
  it('renders connection settings when the API returns 200', async () => {
    mockRoute('GET', rx('/api/join/abc'), () => ({
      status: 200,
      data: SAMPLE,
    }));
    renderAt('abc');

    // Label surfaced in the greeting, config values in CopyableFields.
    expect(await screen.findByText(/Abuela — laptop/)).toBeInTheDocument();
    // id_server and relay_server legitimately share the same value, so two
    // inputs carry it — assert both are present rather than a single hit.
    expect(screen.getAllByDisplayValue('rd.example.com')).toHaveLength(2);
    expect(screen.getByDisplayValue('PUBKEY_ABC')).toBeInTheDocument();
    // Single-use warning must be visible up front.
    expect(screen.getByRole('alert')).toHaveTextContent(/single-use/i);
  });

  it('shows "invalid" state on 404', async () => {
    mockRoute('GET', rx('/api/join/nope'), () => ({
      status: 404,
      data: { detail: 'Invalid or revoked token' },
    }));
    renderAt('nope');

    await waitFor(() =>
      expect(
        screen.getByText(/invalid or has been revoked/i),
      ).toBeInTheDocument(),
    );
  });

  it('shows "already used or expired" state on 410', async () => {
    mockRoute('GET', rx('/api/join/used'), () => ({
      status: 410,
      data: { detail: 'Token already used' },
    }));
    renderAt('used');

    await waitFor(() =>
      expect(
        screen.getByText(/already been used or has expired/i),
      ).toBeInTheDocument(),
    );
  });

  it('short-circuits comically long tokens without hitting the network', () => {
    // 65+ char tokens are not real tokens. Render directly as invalid.
    const long = 'x'.repeat(100);
    renderAt(long);
    expect(
      screen.getByText(/invalid or has been revoked/i),
    ).toBeInTheDocument();
  });
});
