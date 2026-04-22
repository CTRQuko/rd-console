import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DropdownMenu } from './DropdownMenu';

describe('<DropdownMenu />', () => {
  it('opens, exposes role="menu", and closes on Escape', async () => {
    const onA = vi.fn();
    render(
      <DropdownMenu
        ariaLabel="Row actions"
        trigger={<button type="button">Open</button>}
        items={[
          { id: 'a', label: 'Alpha', onSelect: onA },
          { id: 'b', label: 'Beta', onSelect: () => {} },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /open/i }));
    const menu = await screen.findByRole('menu', { name: /row actions/i });
    expect(menu).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('activates an item on click and closes the menu', async () => {
    const onBeta = vi.fn();
    render(
      <DropdownMenu
        trigger={<button type="button">Open</button>}
        items={[
          { id: 'a', label: 'Alpha', onSelect: () => {} },
          { id: 'b', label: 'Beta', onSelect: onBeta },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /open/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /beta/i }));
    expect(onBeta).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not fire onSelect for a disabled item', async () => {
    const onA = vi.fn();
    render(
      <DropdownMenu
        trigger={<button type="button">Open</button>}
        items={[{ id: 'a', label: 'Alpha', onSelect: onA, disabled: true }]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /open/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /alpha/i }));
    expect(onA).not.toHaveBeenCalled();
  });

  it('renders dividers as role="separator"', async () => {
    render(
      <DropdownMenu
        trigger={<button type="button">Open</button>}
        items={[
          { id: 'a', label: 'Alpha', onSelect: () => {} },
          { id: 'sep', label: '', divider: true },
          { id: 'b', label: 'Beta', onSelect: () => {}, destructive: true },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /open/i }));
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });
});
