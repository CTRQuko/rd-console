import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type Column } from './DataTable';

interface Row {
  id: number;
  name: string;
}

const rows: Row[] = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  name: `user-${i + 1}`,
}));

const columns: Column<Row>[] = [
  { key: 'id', header: 'Id', cell: (r) => String(r.id) },
  { key: 'name', header: 'Name', cell: (r) => r.name },
];

describe('<DataTable />', () => {
  it('renders the first page of rows and the pagination summary', () => {
    render(<DataTable<Row> columns={columns} rows={rows} pageSize={5} />);
    expect(screen.getByText('user-1')).toBeInTheDocument();
    expect(screen.getByText('user-5')).toBeInTheDocument();
    expect(screen.queryByText('user-6')).not.toBeInTheDocument();
    expect(screen.getByText(/showing 1[\u2013-]5 of 12/i)).toBeInTheDocument();
  });

  it('advances to the next page on click', async () => {
    render(<DataTable<Row> columns={columns} rows={rows} pageSize={5} />);
    await userEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.queryByText('user-1')).not.toBeInTheDocument();
    expect(screen.getByText('user-6')).toBeInTheDocument();
    expect(screen.getByText('user-10')).toBeInTheDocument();
  });

  it('shows the empty state when rows are empty', () => {
    render(
      <DataTable<Row>
        columns={columns}
        rows={[]}
        pageSize={5}
        empty="No users yet."
      />,
    );
    expect(screen.getByText('No users yet.')).toBeInTheDocument();
  });

  it('disables prev on page 1 and next on the last page', async () => {
    render(<DataTable<Row> columns={columns} rows={rows} pageSize={5} />);
    const [prev, next] = screen.getAllByRole('button');
    expect(prev).toBeDisabled();
    // advance to page 3 (last, only 2 rows)
    await userEvent.click(next);
    await userEvent.click(next);
    expect(screen.getByText(/page 3 of 3/i)).toBeInTheDocument();
    expect(next).toBeDisabled();
  });
});
