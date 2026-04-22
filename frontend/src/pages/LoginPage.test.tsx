import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage } from './LoginPage';
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
    renderAt();
    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/password/i), 'whatever');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByTestId('home')).toBeInTheDocument();
    expect(useAuthStore.getState().user?.username).toBe('admin');
  });
});
