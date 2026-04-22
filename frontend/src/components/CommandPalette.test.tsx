import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommandPalette } from './CommandPalette';
import { mockRoute, rx } from '@/test/apiMock';

function renderPalette(open = true) {
  // Fresh QueryClient per render so caches don't leak between tests.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <CommandPalette open={open} onClose={() => {}} />
            }
          />
          <Route path="/users" element={<div data-testid="users-page">Users</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('<CommandPalette />', () => {
  it('does not render when closed', () => {
    renderPalette(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders as a modal dialog with a labeled search input', () => {
    renderPalette(true);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText(/global search input/i)).toBeInTheDocument();
  });

  it('shows the empty-state hint until a query is typed', () => {
    renderPalette(true);
    expect(screen.getByText(/type to search/i)).toBeInTheDocument();
  });

  it('calls /admin/api/search and renders a user hit', async () => {
    mockRoute('GET', rx('/admin/api/search'), () => ({
      status: 200,
      data: {
        users: [{ id: 1, username: 'admin', email: null }],
        devices: [],
        logs: [],
      },
    }));
    renderPalette(true);
    await userEvent.type(screen.getByLabelText(/global search input/i), 'adm');
    expect(await screen.findByText('admin')).toBeInTheDocument();
  });
});
