import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

  it('expands a row to show a readable detail panel (not just raw JSON)', async () => {
    signInAsAdmin();
    mockRoute('GET', rx('/admin/api/logs'), () => ({
      status: 200,
      data: { total: SEED.length, items: SEED } satisfies PaginatedLogs,
    }));
    wrap(<LogsPage />);

    await screen.findByText(/555 666 777/);
    const table = screen.getByRole('table');
    const row = within(table).getByText('login').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /^expand$/i }));

    // Readable fields surface as label/value rows — "Actor" for the
    // admin who logged in, "When" for the formatted timestamp
    // (not a raw ISO string).
    expect(await screen.findByText(/admin \(id 1\)/)).toBeInTheDocument();
    // IP appears both in the table column and in the detail panel — both
    // are the right answer, so just assert at least one hit.
    expect(screen.getAllByText('10.0.0.1').length).toBeGreaterThan(0);
    // Timestamp now rendered via useDateTime() → fmt() under the test
    // env's system locale. Multiple rendered timestamps match /2025/;
    // just assert at least one is present.
    expect(screen.getAllByText(/2025/).length).toBeGreaterThan(0);

    // Payload JSON is parsed into a key/value row ("ua" → "Firefox"),
    // not dumped as source.
    expect(screen.getByText(/^ua$/)).toBeInTheDocument();
    expect(screen.getByText('Firefox')).toBeInTheDocument();

    // Raw JSON is still available under a collapsible, for power users.
    expect(screen.getByText(/Raw JSON/i)).toBeInTheDocument();
  });

  it('surfaces bulk delete toolbar when rows are selected + gates on typing DELETE', async () => {
    signInAsAdmin();
    mockRoute('GET', rx('/admin/api/logs'), () => ({
      status: 200,
      data: { total: SEED.length, items: SEED } satisfies PaginatedLogs,
    }));
    const deleted: number[][] = [];
    mockRoute('DELETE', rx('/admin/api/logs'), (cfg) => {
      const body = JSON.parse(cfg.data ?? '{}');
      deleted.push(body.ids);
      return {
        status: 200,
        data: { affected: body.ids.length, skipped: [] },
      };
    });
    wrap(<LogsPage />);

    await screen.findByText(/555 666 777/);
    // Select the first log row via its row checkbox.
    const rowCheckboxes = screen.getAllByRole('checkbox', {
      name: /^select log \d+$/i,
    });
    await userEvent.click(rowCheckboxes[0]);

    const deleteBtn = await screen.findByRole('button', { name: /^delete 1$/i });
    await userEvent.click(deleteBtn);

    // Confirm dialog is gated by "Type DELETE".
    const confirmInput = await screen.findByLabelText(/type .* to confirm/i);
    const confirmSubmit = screen.getByRole('button', { name: /^delete$/i });
    expect(confirmSubmit).toBeDisabled();

    fireEvent.change(confirmInput, { target: { value: 'DELETE' } });
    expect(confirmSubmit).not.toBeDisabled();
    await userEvent.click(confirmSubmit);

    await waitFor(() => expect(deleted[0]).toEqual([SEED[0].id]));
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
