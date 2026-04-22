import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { UsersPage } from './UsersPage';
import { signInAsAdmin, wrap } from '@/test/utils';
import { mockRoute, rx } from '@/test/apiMock';
import type { ApiUser } from '@/types/api';

const USERS_SEED: ApiUser[] = [
  {
    id: 1,
    username: 'admin',
    email: 'admin@rd.local',
    role: 'admin',
    is_active: true,
    created_at: '2025-01-10T10:00:00',
    last_login_at: '2025-02-01T09:00:00',
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
  {
    id: 3,
    username: 'bob',
    email: null,
    role: 'user',
    is_active: false,
    created_at: '2025-01-15T10:00:00',
    last_login_at: null,
  },
];

function installHappyPath() {
  let store = [...USERS_SEED];
  mockRoute('GET', rx('/admin/api/users'), () => ({ status: 200, data: store }));
  mockRoute('PATCH', /^\/admin\/api\/users\/(\d+)$/, (cfg) => {
    const id = Number(cfg.url?.match(/users\/(\d+)/)?.[1]);
    const body = JSON.parse(cfg.data ?? '{}');
    const next = store.map((u) => (u.id === id ? { ...u, ...body } : u));
    store = next;
    const updated = next.find((u) => u.id === id)!;
    return { status: 200, data: updated };
  });
  mockRoute('DELETE', /^\/admin\/api\/users\/(\d+)$/, (cfg) => {
    const id = Number(cfg.url?.match(/users\/(\d+)/)?.[1]);
    store = store.map((u) => (u.id === id ? { ...u, is_active: false } : u));
    return { status: 204 };
  });
  mockRoute('POST', rx('/admin/api/users'), (cfg) => {
    const body = JSON.parse(cfg.data ?? '{}');
    const created: ApiUser = {
      id: store.length + 1,
      username: body.username,
      email: body.email ?? null,
      role: body.role ?? 'user',
      is_active: true,
      created_at: new Date().toISOString(),
      last_login_at: null,
    };
    store = [...store, created];
    return { status: 201, data: created };
  });
}

describe('<UsersPage />', () => {
  it('renders users returned by the API', async () => {
    signInAsAdmin();
    installHappyPath();
    wrap(<UsersPage />);

    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
    // Disabled user is badged as such.
    const bobRow = screen.getByText('bob').closest('tr')!;
    expect(within(bobRow).getByText('Disabled')).toBeInTheDocument();
  });

  it('filters rows by username/email via the search box', async () => {
    signInAsAdmin();
    installHappyPath();
    wrap(<UsersPage />);

    await screen.findByText('alice');
    await userEvent.type(screen.getByPlaceholderText(/search users/i), 'bob');
    expect(screen.queryByText('alice')).not.toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
  });

  it('disables a user via the row dropdown → confirm dialog', async () => {
    signInAsAdmin();
    installHappyPath();
    wrap(<UsersPage />);
    await screen.findByText('alice');

    const row = screen.getByText('alice').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /actions for alice/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /^disable/i }));
    // Confirm dialog
    expect(await screen.findByRole('dialog', { name: /disable user/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^disable$/i }));

    // After the mutation invalidates, alice's row should render a Disabled badge.
    await waitFor(() => {
      const aliceRow = screen.getByText('alice').closest('tr')!;
      expect(within(aliceRow).getByText('Disabled')).toBeInTheDocument();
    });
  });

  it('opens the Edit dialog and PATCHes only changed fields', async () => {
    signInAsAdmin();
    const patchSpy = vi.fn();
    // Re-install with a spy on the PATCH handler so we can inspect the body.
    let store = [...USERS_SEED];
    mockRoute('GET', rx('/admin/api/users'), () => ({ status: 200, data: store }));
    mockRoute('PATCH', /^\/admin\/api\/users\/(\d+)$/, (cfg) => {
      patchSpy(cfg.url, JSON.parse(cfg.data ?? '{}'));
      const id = Number(cfg.url?.match(/users\/(\d+)/)?.[1]);
      const body = JSON.parse(cfg.data ?? '{}');
      store = store.map((u) => (u.id === id ? { ...u, ...body } : u));
      return { status: 200, data: store.find((u) => u.id === id) };
    });

    wrap(<UsersPage />);
    await screen.findByText('alice');

    const row = screen.getByText('alice').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /actions for alice/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /^edit/i }));

    const dialog = await screen.findByRole('dialog', { name: /edit alice/i });
    const role = within(dialog).getByLabelText(/role/i) as HTMLSelectElement;
    await userEvent.selectOptions(role, 'admin');

    await userEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith(
        expect.stringMatching(/users\/2/),
        { role: 'admin' },
      );
    });
  });

  it('disables the Disable menu item for the logged-in admin themselves', async () => {
    signInAsAdmin('admin');
    installHappyPath();
    wrap(<UsersPage />);
    await screen.findByText('admin');

    const row = screen.getByText('admin').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /actions for admin/i }));
    const disable = await screen.findByRole('menuitem', { name: /^disable/i });
    expect(disable).toBeDisabled();
  });
});
