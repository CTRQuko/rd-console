import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TagChip } from './TagChip';

describe('<TagChip />', () => {
  it('renders name + color class', () => {
    const { container } = render(<TagChip name="office" color="green" />);
    expect(screen.getByText('office')).toBeInTheDocument();
    expect(container.querySelector('.rd-tag-chip--green')).not.toBeNull();
  });

  it('shows a remove button only when onRemove is provided', () => {
    const onRemove = vi.fn();
    render(<TagChip name="lab" color="blue" onRemove={onRemove} />);
    expect(screen.getByRole('button', { name: /remove lab/i })).toBeInTheDocument();
  });

  it('fires onRemove without bubbling to onClick', async () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    render(<TagChip name="lab" color="blue" onClick={onClick} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole('button', { name: /remove lab/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
