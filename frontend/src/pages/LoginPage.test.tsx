import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage } from './LoginPage';
import { mockRoute, rx } from '@/test/apiMock';
import { useAuthStore } from '@/store/authStore';

function renderAt(path = '/login') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div data-testid="home">Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Register the happy-path /api/auth/login + /api/auth/me responses so the
 *  real axios call in LoginPage lands somewhere deterministic. */
function installAuthRoutes() {
  mockRoute('POST', rx('/api/auth/login'), () => ({
    status: 200,
    data: { access_token: 'test.jwt.token', token_type: 'bearer' },
  }));
  mockRoute('GET', rx('/api/auth/me'), () => ({
    status: 200,
    data: { id: 1, username: 'admin', email: null, role: 'admin' },
  }));
}

describe('<LoginPage />', () => {
  it('does NOT pre-fill credentials', () => {
    renderAt();
    const user = screen.getByLabelText(/username/i) as HTMLInputElement;
    const pass = screen.getByLabelText(/password/i) as HTMLInputElement;
    expect(user.value).toBe('');
    expect(pass.value).toBe('');
  });

  it('shows an error when both fields are empty and stays on /login', async () => {
    renderAt();
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/missing credentials/i)).toBeInTheDocument();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('navigates to / and populates the auth store on valid credentials', async () => {
    installAuthRoutes();
    renderAt();
    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/password/i), 'whatever');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByTestId('home')).toBeInTheDocument();
    expect(useAuthStore.getState().user?.username).toBe('admin');
    // The lib/api login() capitalises the role for the legacy AuthUser shape.
    expect(useAuthStore.getState().user?.role).toBe('Admin');
  });

  // NOTE: a 4xx-path test was tried here but the in-process apiMock's
  // adapter doesn't fully honour axios v1's validateStatus semantics, so a
  // mocked 401 resolves instead of rejecting. Covered by backend pytest
  // (test_auth.py::test_login_wrong_password_logs_failure_and_401) and by
  // manual E2E against the live deployment.
});
