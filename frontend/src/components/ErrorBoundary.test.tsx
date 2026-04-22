import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from './ErrorBoundary';

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new Error('boom');
  return <div data-testid="ok">ok</div>;
}

describe('<ErrorBoundary />', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Bomb explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('ok')).toBeInTheDocument();
  });

  it('catches descendant errors and renders the fallback card', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb explode />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/boom/)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('reset clears the error and re-renders children', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <ErrorBoundary>
        <Bomb explode />
      </ErrorBoundary>,
    );
    // Stop the child from exploding BEFORE clicking reset — otherwise the
    // boundary catches the same error again as soon as state clears.
    rerender(
      <ErrorBoundary>
        <Bomb explode={false} />
      </ErrorBoundary>,
    );
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByTestId('ok')).toBeInTheDocument();
    spy.mockRestore();
  });
});
