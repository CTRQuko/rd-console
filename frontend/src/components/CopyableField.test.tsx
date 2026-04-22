import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CopyableField } from './CopyableField';

describe('<CopyableField />', () => {
  const originalClipboard = navigator.clipboard;
  const originalIsSecure = window.isSecureContext;

  beforeEach(() => {
    // Force the modern path on (window.isSecureContext) and mock clipboard.
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: originalIsSecure,
    });
  });

  it('calls navigator.clipboard.writeText and flips to the copied state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<CopyableField label="Public key" value="ABC123" />);
    await userEvent.click(screen.getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith('ABC123');
    // After the click the button's accessible name switches to "Copied".
    expect(
      await screen.findByRole('button', { name: /copied/i }),
    ).toBeInTheDocument();
  });

  it('shows the error state when the clipboard throws', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<CopyableField label="Token" value="secret" />);
    await userEvent.click(screen.getByRole('button', { name: /copy/i }));

    expect(
      await screen.findByRole('button', { name: /copy failed/i }),
    ).toBeInTheDocument();
  });

  it('renders the value in a readonly input', () => {
    render(<CopyableField label="Server" value="rd.example.com" />);
    const input = screen.getByDisplayValue('rd.example.com') as HTMLInputElement;
    expect(input).toHaveAttribute('readonly');
  });
});
