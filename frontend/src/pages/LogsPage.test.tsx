import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LogsPage } from './LogsPage';
import { signInAsAdmin, wrap } from '@/test/utils';
import { mockRoute, rx } from '@/test/apiMock';
import type { ApiAuditLog, PaginatedLogs } from '@/types/api';

const SEED: ApiAuditLog[] = [
  {
    id: 1,
    action: 'connect',
    from_id: '555 666 777',
    to_id: '888 999 000',
    ip: '10.0.0.1',
    uuid: 'uuid-1',
    actor_user_id: null,
    actor_username: null,
    payload: null,
    created_at: '2025-02-01T12:00:00',
  },
  {
    id: 2,
    action: 'login',
    from_id: null,
    to_id: null,
    ip: '10.0.0.1',
    uuid: null,
    actor_user_id: 1,
    actor_username: 'admin',
    payload: '{"ua":"Firefox"}',
    created_at: '2025-02-01T12:05:00',
  },
];

describe('<LogsPage />', () => {
  it('renders log rows returned by the API', async () => {
    signInAsAdmin();
    mockRoute('GET', rx('/admin/api/logs'), () => ({
      status: 200,
      data: { total: SEED.length, items: SEED } satisfies PaginatedLogs,
    }));
    wrap(<LogsPage />);

    expect(await screen.findByText(/555 666 777/)).toBeInTheDocument();
    // Scope to the data table — "login" also appears as an option in the
    // action filter <select>, which would make screen.getByText ambiguous.
    const table = screen.getByRole('table');
    expect(within(table).getByText('login')).toBeInTheDocument();
    // Total count in the toolbar
    expect(screen.getByText(/^2 events$/i)).toBeInTheDocument();
  });

  it('passes server-side filter params when the filters change', async () => {
    signInAsAdmin();
    const spy = vi.fn();
    mockRoute('GET', rx('/admin/api/logs'), (cfg) => {
      spy(cfg.params);
      return {
        status: 200,
        data: { total: 0, items: [] } satisfies PaginatedLogs,
      };
    });
    wrap(<LogsPage />);

    // First request fires on mount (Last 7 days default).
    await waitFor(() => expect(spy).toHaveBeenCalled());
    spy.mockClear();

    // Select the Auth category.
    const selects = screen.getAllByRole('combobox');
    const categorySelect = selects[1]; // range / category / action
    await userEvent.selectOptions(categorySelect, 'auth');

    await waitFor(() => {
      const last = spy.mock.calls.at(-1)?.[0] ?? {};
      expect(last.category).toBe('auth');
    });
  });

  it('expands a row to show the JSON payload', async () => {
    signInAsAdmin();
    mockRoute('GET', rx('/admin/api/logs'), () => ({
      status: 200,
      data: { total: SEED.length, items: SEED } satisfies PaginatedLogs,
    }));
    wrap(<LogsPage />);

    // Wait for a row value that only exists in the table (not in a filter
    // option) so the table is actually rendered before we query it. The
    // literal "login" also matches the action <option> in the filter select
    // and appears immediately after mount, before data loads.
    await screen.findByText(/555 666 777/);
    const table = screen.getByRole('table');
    const row = within(table).getByText('login').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /^expand$/i }));

    const payloadPre = await screen.findByText(/"ua": "Firefox"/);
    expect(payloadPre).toBeInTheDocument();
  });

  it('debounces the actor search into the query params', async () => {
    signInAsAdmin();
    const spy = vi.fn();
    mockRoute('GET', rx('/admin/api/logs'), (cfg) => {
      spy(cfg.params);
      return { status: 200, data: { total: 0, items: [] } };
    });
    wrap(<LogsPage />);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    spy.mockClear();

    await userEvent.type(screen.getByPlaceholderText(/actor or rustdesk id/i), 'admin');
    await waitFor(() => {
      const last = spy.mock.calls.at(-1)?.[0] ?? {};
      expect(last.actor).toBe('admin');
    }, { timeout: 1500 });
  });
});
