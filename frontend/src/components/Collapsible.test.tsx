import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Collapsible } from './Collapsible';

describe('<Collapsible />', () => {
  it('renders open by default and shows its children', () => {
    render(
      <Collapsible title="Section A">
        <p>inner content</p>
      </Collapsible>,
    );
    const details = screen.getByRole('group');
    expect(details).toHaveAttribute('open');
    expect(screen.getByText('inner content')).toBeVisible();
  });

  it('respects defaultOpen={false}', () => {
    render(
      <Collapsible title="Section B" defaultOpen={false}>
        <p>hidden content</p>
      </Collapsible>,
    );
    const details = screen.getByRole('group');
    expect(details).not.toHaveAttribute('open');
  });

  it('toggles open state when the summary is clicked', async () => {
    render(
      <Collapsible title="Section C" defaultOpen={false}>
        <p>click target content</p>
      </Collapsible>,
    );
    const details = screen.getByRole('group');
    const summary = screen.getByText('Section C');
    expect(details).not.toHaveAttribute('open');
    await userEvent.click(summary);
    expect(details).toHaveAttribute('open');
    await userEvent.click(summary);
    expect(details).not.toHaveAttribute('open');
  });

  it('renders the optional summary hint alongside the title', () => {
    render(
      <Collapsible title="Format" summary="system locale">
        <p>body</p>
      </Collapsible>,
    );
    expect(screen.getByText('Format')).toBeInTheDocument();
    expect(screen.getByText('system locale')).toBeInTheDocument();
  });
});
