import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Drawer } from './Drawer';

describe('<Drawer />', () => {
  it('renders with role="dialog" + aria-modal + accessible name', () => {
    render(
      <Drawer open title="Device details">
        <p>Body content</p>
      </Drawer>,
    );
    const d = screen.getByRole('dialog');
    expect(d).toHaveAttribute('aria-modal', 'true');
    expect(d).toHaveAccessibleName('Device details');
  });

  it('does not render when closed', () => {
    render(
      <Drawer open={false} title="Device details">
        <p>Body</p>
      </Drawer>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('invokes onClose on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="Device details" onClose={onClose}>
        <button type="button">Inside</button>
      </Drawer>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('invokes onClose when the close icon is clicked', async () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="Device details" onClose={onClose}>
        <p>Body</p>
      </Drawer>,
    );
    await userEvent.click(screen.getByRole('button', { name: /close drawer/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders a footer when provided', () => {
    render(
      <Drawer
        open
        title="Device details"
        footer={<button type="button">Forget</button>}
      >
        <p>Body</p>
      </Drawer>,
    );
    expect(screen.getByRole('button', { name: /forget/i })).toBeInTheDocument();
  });
});
