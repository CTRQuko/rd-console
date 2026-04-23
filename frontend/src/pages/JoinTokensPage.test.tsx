import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JoinTokensPage } from './JoinTokensPage';
import { signInAsAdmin, wrap } from '@/test/utils';
import { mockRoute, rx } from '@/test/apiMock';
import type { JoinTokenCreated, JoinTokenMeta } from '@/types/api';

const SEED: JoinTokenMeta[] = [
  {
    id: 1,
    token_prefix: 'abcd1234',
    label: 'Abuela — laptop',
    created_by_user_id: 1,
    created_at: '2025-01-01T00:00:00',
    expires_at: '2025-01-02T00:00:00',
    used_at: null,
    revoked: false,
    status: 'active',
  },
  {
    id: 2,
    token_prefix: 'deadbeef',
    label: null,
    created_by_user_id: 1,
    created_at: '2024-12-31T00:00:00',
    expires_at: null,
    used_at: '2025-01-01T12:00:00',
    revoked: true,
    // revoked wins over used in the priority chain — see _status in backend.
    status: 'revoked',
  },
];

describe('<JoinTokensPage />', () => {
  it('redacts plaintext in the list view (only prefix is rendered)', async () => {
    signInAsAdmin();
    mockRoute('GET', rx('/admin/api/join-tokens'), () => ({
      status: 200,
      data: SEED,
    }));
    wrap(<JoinTokensPage />);

    // Prefixes render with a trailing ellipsis to signal truncation.
    expect(await screen.findByText('abcd1234…')).toBeInTheDocument();
    expect(screen.getByText('deadbeef…')).toBeInTheDocument();
    // Status chips map directly to the server-computed status.
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('revoked')).toBeInTheDocument();
    // Label renders when present, '—' placeholder when null.
    expect(screen.getByText('Abuela — laptop')).toBeInTheDocument();
  });

  it('mints a token, POSTs the payload, and surfaces plaintext exactly once', async () => {
    signInAsAdmin();
    mockRoute('GET', rx('/admin/api/join-tokens'), () => ({
      status: 200,
      data: [] as JoinTokenMeta[],
    }));
    const captured: unknown[] = [];
    const minted: JoinTokenCreated = {
      id: 42,
      token: 'rdcj_supersecret_plaintext_here_abc',
      token_prefix: 'rdcj_sup',
      label: 'invite',
      created_by_user_id: 1,
      created_at: '2025-01-10T00:00:00',
      expires_at: '2025-01-11T00:00:00',
      used_at: null,
      revoked: false,
      status: 'active',
    };
    mockRoute('POST', rx('/admin/api/join-tokens'), (cfg) => {
      captured.push(JSON.parse(cfg.data ?? '{}'));
      return { status: 201, data: minted };
    });
    wrap(<JoinTokensPage />);

    await userEvent.click(
      await screen.findByRole('button', { name: /create invitation/i }),
    );
    // fireEvent.change commits the whole value atomically, avoiding a race
    // where userEvent.type's per-char state updates land after the submit
    // click in a busy test environment.
    fireEvent.change(screen.getByPlaceholderText(/abuela/i), {
      target: { value: 'invite' },
    });
    // Leave default expiry (24h) — it's the most common case.
    await userEvent.click(screen.getByRole('button', { name: /^generate link$/i }));

    await waitFor(() =>
      expect(captured.at(-1)).toEqual({
        label: 'invite',
        expires_in_minutes: 60 * 24,
      }),
    );

    // The one-shot disclosure modal must display the plaintext — this is
    // the single time it's ever available to the admin.
    await waitFor(() =>
      expect(
        screen.getByDisplayValue('rdcj_supersecret_plaintext_here_abc'),
      ).toBeInTheDocument(),
    );
    // And the unmissable warning that backdrop/Esc won't dismiss it.
    expect(screen.getByRole('alert')).toHaveTextContent(/single-use/i);
  });

  it('asks for confirmation when the disclosure modal is dismissed via X', async () => {
    signInAsAdmin();
    mockRoute('GET', rx('/admin/api/join-tokens'), () => ({
      status: 200,
      data: [] as JoinTokenMeta[],
    }));
    const minted: JoinTokenCreated = {
      id: 7,
      token: 'rdcj_unmissable_plaintext',
      token_prefix: 'rdcj_unm',
      label: null,
      created_by_user_id: 1,
      created_at: '2025-02-01T00:00:00',
      expires_at: null,
      used_at: null,
      revoked: false,
      status: 'active',
    };
    mockRoute('POST', rx('/admin/api/join-tokens'), () => ({
      status: 201,
      data: minted,
    }));
    wrap(<JoinTokensPage />);

    await userEvent.click(
      await screen.findByRole('button', { name: /create invitation/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /^generate link$/i }));

    // Disclosure modal visible with plaintext.
    await waitFor(() =>
      expect(
        screen.getByDisplayValue('rdcj_unmissable_plaintext'),
      ).toBeInTheDocument(),
    );

    // Click the X on the disclosure header — should NOT close, should
    // open the confirm.
    const closeButtons = screen.getAllByRole('button', { name: /close dialog/i });
    await userEvent.click(closeButtons[0]);

    // Confirm prompt appears.
    expect(
      await screen.findByText(/did you copy the invitation/i),
    ).toBeInTheDocument();
    // Token value still present behind the confirm — nothing lost yet.
    expect(
      screen.getByDisplayValue('rdcj_unmissable_plaintext'),
    ).toBeInTheDocument();

    // Cancel returns to disclosure.
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(
      screen.queryByText(/did you copy the invitation/i),
    ).not.toBeInTheDocument();

    // Re-trigger + confirm this time closes everything.
    await userEvent.click(closeButtons[0]);
    await userEvent.click(screen.getByRole('button', { name: /close anyway/i }));
    await waitFor(() =>
      expect(
        screen.queryByDisplayValue('rdcj_unmissable_plaintext'),
      ).not.toBeInTheDocument(),
    );
  });

  it('exposes Email / WhatsApp / Telegram share links with the invite URL', async () => {
    signInAsAdmin();
    mockRoute('GET', rx('/admin/api/join-tokens'), () => ({
      status: 200,
      data: [] as JoinTokenMeta[],
    }));
    const minted: JoinTokenCreated = {
      id: 10,
      token: 'rdcj_share_token_for_test',
      token_prefix: 'rdcj_sha',
      label: null,
      created_by_user_id: 1,
      created_at: '2025-03-01T00:00:00',
      expires_at: null,
      used_at: null,
      revoked: false,
      status: 'active',
    };
    mockRoute('POST', rx('/admin/api/join-tokens'), () => ({
      status: 201,
      data: minted,
    }));
    wrap(<JoinTokensPage />);

    await userEvent.click(
      await screen.findByRole('button', { name: /create invitation/i }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: /^generate link$/i }),
    );

    // Each channel renders as a plain anchor with a deterministic href
    // that embeds the invite URL. `mailto:` has the body pre-filled;
    // wa.me and t.me are public share URLs the browser opens in a tab.
    const emailLink = await screen.findByRole('link', { name: /email/i });
    expect(emailLink.getAttribute('href')).toMatch(
      /^mailto:\?subject=.*&body=.*rdcj_share_token_for_test/,
    );
    const waLink = screen.getByRole('link', { name: /whatsapp/i });
    expect(waLink.getAttribute('href')).toMatch(
      /^https:\/\/wa\.me\/\?text=.*rdcj_share_token_for_test/,
    );
    const tgLink = screen.getByRole('link', { name: /telegram/i });
    expect(tgLink.getAttribute('href')).toMatch(
      /^https:\/\/t\.me\/share\/url\?url=.*rdcj_share_token_for_test/,
    );
  });

  it('revokes a token via DELETE', async () => {
    signInAsAdmin();
    mockRoute('GET', rx('/admin/api/join-tokens'), () => ({
      status: 200,
      data: [SEED[0]],
    }));
    const deleted: number[] = [];
    mockRoute('DELETE', rx('/admin/api/join-tokens/1'), () => {
      deleted.push(1);
      return { status: 204, data: null };
    });
    wrap(<JoinTokensPage />);

    await userEvent.click(
      await screen.findByRole('button', { name: /revoke abcd1234/i }),
    );
    // ConfirmDialog surfaces a "Revoke" button — click to confirm.
    await userEvent.click(screen.getByRole('button', { name: /^revoke$/i }));

    await waitFor(() => expect(deleted).toEqual([1]));
  });
});
