import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OnlineBadge } from './OnlineBadge';

describe('<OnlineBadge />', () => {
  it('shows "Online" and the animated dot when online', () => {
    const { container } = render(<OnlineBadge online />);
    expect(screen.getByText('Online')).toBeInTheDocument();
    const dot = container.querySelector('.rd-online__dot');
    expect(dot).toHaveClass('on');
    expect(dot).not.toHaveClass('off');
  });

  it('shows "Offline" and the muted dot when offline', () => {
    const { container } = render(<OnlineBadge online={false} />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
    const dot = container.querySelector('.rd-online__dot');
    expect(dot).toHaveClass('off');
  });

  it('honours the custom label', () => {
    render(<OnlineBadge online label="Seen 1 min ago" />);
    expect(screen.getByText('Seen 1 min ago')).toBeInTheDocument();
  });
});
