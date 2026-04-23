import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog } from './Dialog';

describe('<Dialog />', () => {
  it('renders with role="dialog" and aria-modal when open', () => {
    render(
      <Dialog open title="Confirm">
        <p>body</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Confirm');
  });

  it('does not render when closed', () => {
    render(
      <Dialog open={false} title="Confirm">
        <p>body</p>
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('invokes onClose on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Confirm">
        <button type="button">Inside</button>
      </Dialog>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('invokes onClose when clicking the close icon', async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Confirm">
        <p>body</p>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole('button', { name: /close dialog/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('does NOT steal focus back to the close button when typing causes parent re-renders', () => {
    // Regression: previously the effect depended on `onClose`, which
    // most consumers pass as an inline arrow (`onClose={() => setOpen(false)}`).
    // Every parent re-render rebuilt that function, re-ran the effect, and
    // the RAF inside it yanked focus to the first focusable — the header
    // "close" button. The user-visible bug was that typing a single
    // character into an input flipped focus to the X.
    function Host() {
      const [value, setValue] = useState('');
      // Passed inline on purpose: reproduces the real consumer shape
      // (TagsPage, JoinTokensPage, AddressBookPage…).
      return (
        <Dialog open onClose={() => {}} title="Create">
          <input
            aria-label="name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Dialog>
      );
    }
    render(<Host />);
    const input = screen.getByLabelText('name');
    // fireEvent.change triggers a real state update → parent re-render →
    // new inline onClose reference. Before the fix this caused focus to
    // jump to the close button; after the fix, focus stays in the input.
    input.focus();
    fireEvent.change(input, { target: { value: 'h' } });
    fireEvent.change(input, { target: { value: 'he' } });
    fireEvent.change(input, { target: { value: 'hel' } });
    expect(document.activeElement).toBe(input);
  });

  it('focuses the first body input on open, not the header close button', () => {
    render(
      <Dialog open onClose={() => {}} title="Create">
        <input aria-label="first" />
        <input aria-label="second" />
      </Dialog>,
    );
    // rAF fires synchronously in jsdom via the polyfill/fake timers setup
    // in most test suites — so we just read the active element.
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        expect(document.activeElement).toBe(screen.getByLabelText('first'));
        resolve();
      });
    });
  });
});
