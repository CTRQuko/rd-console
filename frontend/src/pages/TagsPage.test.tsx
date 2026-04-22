import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TagsPage } from './TagsPage';
import { signInAsAdmin, wrap } from '@/test/utils';
import { mockRoute, rx } from '@/test/apiMock';
import type { Tag } from '@/types/api';

const SEED: Tag[] = [
  {
    id: 1,
    name: 'lab',
    color: 'blue',
    created_at: '2025-01-01T00:00:00',
    device_count: 3,
  },
  {
    id: 2,
    name: 'office',
    color: 'green',
    created_at: '2025-01-02T00:00:00',
    device_count: 0,
  },
];

describe('<TagsPage />', () => {
  it('lists existing tags and their device count', async () => {
    signInAsAdmin();
    mockRoute('GET', rx('/admin/api/tags'), () => ({ status: 200, data: SEED }));
    wrap(<TagsPage />);

    expect(await screen.findByText('lab')).toBeInTheDocument();
    expect(screen.getByText('office')).toBeInTheDocument();
    // Device counts appear as plain numbers in the "Devices" column.
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('opens the create dialog and POSTs the payload', async () => {
    signInAsAdmin();
    mockRoute('GET', rx('/admin/api/tags'), () => ({ status: 200, data: [] }));
    const captured: unknown[] = [];
    mockRoute('POST', rx('/admin/api/tags'), (cfg) => {
      captured.push(JSON.parse(cfg.data ?? '{}'));
      return {
        status: 201,
        data: {
          id: 99,
          name: 'new',
          color: 'amber',
          created_at: '2025-01-10T00:00:00',
          device_count: 0,
        } satisfies Tag,
      };
    });
    wrap(<TagsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /create tag/i }));
    await userEvent.type(screen.getByLabelText(/name/i), 'new');
    await userEvent.selectOptions(screen.getByLabelText(/color/i), 'amber');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(captured.at(-1)).toEqual({ name: 'new', color: 'amber' }));
  });

  // NOTE: a 4xx-path test (409 "tag already exists") is skipped here — the
  // in-process apiMock adapter doesn't fully honour axios v1's
  // validateStatus semantics, so a 409 resolves instead of rejecting.
  // Coverage lives in backend pytest (test_tags.py::test_create_tag_rejects_...).
});
