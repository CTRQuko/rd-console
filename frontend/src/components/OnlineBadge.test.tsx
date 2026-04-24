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

  // ─── v10 tier path ──────────────────────────────────────────────────────
  it('renders the fresh tier with a pulsing dot and custom label', () => {
    const { container } = render(
      <OnlineBadge tier="fresh" label="Seen now" tooltip="some tooltip" />,
    );
    expect(screen.getByText('Seen now')).toBeInTheDocument();
    const dot = container.querySelector('.rd-online__dot');
    expect(dot).toHaveClass('fresh');
    expect(dot).not.toHaveClass('on'); // v10 uses tier classes, not legacy
  });

  it('renders the stale tier with an amber dot and interpolated label', () => {
    const { container } = render(
      <OnlineBadge tier="stale" label="Recent (3h ago)" />,
    );
    const dot = container.querySelector('.rd-online__dot');
    expect(dot).toHaveClass('stale');
  });

  it('renders the cold tier greyed out', () => {
    const { container } = render(
      <OnlineBadge tier="cold" label="Inactive (2d ago)" />,
    );
    const dot = container.querySelector('.rd-online__dot');
    expect(dot).toHaveClass('cold');
  });

  it('renders the unknown tier for never-seen devices', () => {
    const { container } = render(
      <OnlineBadge tier="unknown" label="Never seen" />,
    );
    const dot = container.querySelector('.rd-online__dot');
    expect(dot).toHaveClass('unknown');
  });

  it('exposes the tooltip as a DOM title attribute (native hover, no deps)', () => {
    const { container } = render(
      <OnlineBadge
        tier="fresh"
        label="Seen now"
        tooltip="Server-observed heuristic, not real-time."
      />,
    );
    const wrapper = container.querySelector('.rd-online');
    expect(wrapper).toHaveAttribute(
      'title',
      'Server-observed heuristic, not real-time.',
    );
  });

  it('prefers tier over legacy online when both are present', () => {
    // Regression guard: if a caller accidentally passes both, we honour
    // the explicit tier (modern path) rather than the legacy boolean.
    const { container } = render(
      <OnlineBadge online tier="cold" label="Inactive" />,
    );
    const dot = container.querySelector('.rd-online__dot');
    expect(dot).toHaveClass('cold');
    expect(dot).not.toHaveClass('on');
  });
});
