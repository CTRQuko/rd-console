import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddressBookPage } from './AddressBookPage';
import { signInAsAdmin, wrap } from '@/test/utils';
import { mockRoute, rx } from '@/test/apiMock';

const SEED_INNER = JSON.stringify({
  tags: ['home', 'work'],
  peers: [
    {
      id: '1779980041',
      alias: 'laptop',
      hostname: 'desktop',
      platform: 'Windows',
      username: 'jandro',
      tags: ['home'],
      hash: '',
    },
  ],
  tag_colors: '{"home":-16711936,"work":-65536}',
});

describe('<AddressBookPage />', () => {
  it('renders peers returned from /api/ab/get', async () => {
    signInAsAdmin();
    mockRoute('POST', rx('/api/ab/get'), () => ({
      status: 200,
      data: { updated_at: '2026-04-23T01:30:00', data: SEED_INNER },
    }));
    wrap(<AddressBookPage />);

    expect(await screen.findByText('1779980041')).toBeInTheDocument();
    expect(screen.getByText('laptop')).toBeInTheDocument();
    expect(screen.getByText('Windows')).toBeInTheDocument();
  });

  it('adds a peer via the dialog and POSTs the full blob to /api/ab', async () => {
    signInAsAdmin();
    mockRoute('POST', rx('/api/ab/get'), () => ({
      status: 200,
      data: { updated_at: null, data: '' },
    }));
    let lastPut: unknown = null;
    mockRoute('POST', rx('/api/ab'), (cfg) => {
      lastPut = JSON.parse(cfg.data as string);
      return { status: 200, data: { updated_at: '2026-04-23T01:35:00' } };
    });

    wrap(<AddressBookPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /add peer/i }));
    // Use fireEvent.change to sidestep the autoFocus-vs-userEvent.type flakiness
    // — we only care that the final values land in the payload, not keystrokes.
    fireEvent.change(screen.getByLabelText(/rustdesk id/i), { target: { value: '999' } });
    fireEvent.change(screen.getByLabelText(/^alias/i), { target: { value: 'gateway' } });
    fireEvent.change(screen.getByLabelText(/^tags/i), { target: { value: 'net, home' } });
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(lastPut).not.toBeNull());
    const body = lastPut as { data: string };
    // The body carries a double-stringified envelope.
    expect(typeof body.data).toBe('string');
    const inner = JSON.parse(body.data);
    expect(inner.peers).toHaveLength(1);
    expect(inner.peers[0]).toMatchObject({
      id: '999',
      alias: 'gateway',
      tags: ['net', 'home'],
    });
    // top-level tags union synced from per-peer tags
    expect(inner.tags).toEqual(expect.arrayContaining(['net', 'home']));
  });

  it('removes a peer via confirm dialog', async () => {
    signInAsAdmin();
    mockRoute('POST', rx('/api/ab/get'), () => ({
      status: 200,
      data: { updated_at: '2026-04-23T01:30:00', data: SEED_INNER },
    }));
    let lastPut: unknown = null;
    mockRoute('POST', rx('/api/ab'), (cfg) => {
      lastPut = JSON.parse(cfg.data as string);
      return { status: 200, data: { updated_at: '2026-04-23T01:40:00' } };
    });

    wrap(<AddressBookPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /remove 1779980041/i }));
    await user.click(await screen.findByRole('button', { name: /^remove$/i }));

    await waitFor(() => expect(lastPut).not.toBeNull());
    const body = lastPut as { data: string };
    const inner = JSON.parse(body.data);
    expect(inner.peers).toHaveLength(0);
  });

  it('opens the Edit peer dialog when clicking the row body', async () => {
    // Row-click edit added in v6 P5 for consistency with Users + Devices.
    // The actions column's inline buttons still work independently because
    // they stop propagation.
    signInAsAdmin();
    mockRoute('POST', rx('/api/ab/get'), () => ({
      status: 200,
      data: { updated_at: '2026-04-23T01:30:00', data: SEED_INNER },
    }));
    wrap(<AddressBookPage />);
    const user = userEvent.setup();

    // Click on the alias cell (part of the row body, not in the actions).
    await user.click(await screen.findByText('laptop'));
    expect(
      await screen.findByRole('dialog', { name: /edit peer/i }),
    ).toBeInTheDocument();
  });
});
