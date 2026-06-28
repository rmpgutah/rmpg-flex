import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WorkOrdersRoute } from '../routes/WorkOrdersRoute';

function stub(handlers: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as Request).url);
    for (const path of Object.keys(handlers)) {
      if (url.includes(path)) {
        return Promise.resolve(new Response(JSON.stringify(handlers[path]), { status: 200 }));
      }
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  }));
}

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('<WorkOrdersRoute>', () => {
  it('fetches /api/work-orders and renders the rows with status badges', async () => {
    stub({
      '/api/work-orders': {
        count: 2,
        data: [
          { id: 1, vehicle_id: 42, status: 'open', number: 'WO-001', opened_at: '2026-06-21 10:00:00', closed_at: null, summary: 'Brake inspection', vendor_id: null, est_cost: 250.00, actual_cost: null, category_code: 'REPAIR', notes: null },
          { id: 2, vehicle_id: 43, status: 'completed', number: 'WO-002', opened_at: '2026-06-20 09:00:00', closed_at: '2026-06-20 16:00:00', summary: 'Oil change', vendor_id: null, est_cost: 75.00, actual_cost: 78.50, category_code: 'PM', notes: null },
        ],
      },
      '/api/fleet': [
        { id: 42, vehicle_name: 'Patrol 12', vehicle_number: 'P12' },
        { id: 43, vehicle_name: 'Patrol 13', vehicle_number: 'P13' },
      ],
    });
    render(<MemoryRouter><WorkOrdersRoute /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Brake inspection')).toBeInTheDocument());
    expect(screen.getByText('Oil change')).toBeInTheDocument();
    expect(screen.getByText('WO-001')).toBeInTheDocument();
    // The status BADGE text appears multiple places (filter <option>, "Open only" label,
    // badge inside the row) — scope to the data row and assert the badge is present.
    const row001 = screen.getByText('WO-001').closest('tr')!;
    expect(row001.textContent).toMatch(/Open/);
  });

  it('renders the New Work Order button and opens the modal on click', async () => {
    stub({
      '/api/work-orders': { count: 0, data: [] },
      '/api/fleet': [{ id: 1, vehicle_name: 'Unit', vehicle_number: 'U1' }],
    });
    render(<MemoryRouter><WorkOrdersRoute /></MemoryRouter>);
    await waitFor(() => expect(screen.queryByText(/loading work orders/i)).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /new work order/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // The "Vehicle *" label + Create button only exist inside the dialog.
    expect(dialog.textContent).toMatch(/Vehicle \*/);
    expect(dialog.textContent).toMatch(/Create/);
  });

  it('shows the empty state when no work orders exist', async () => {
    stub({
      '/api/work-orders': { count: 0, data: [] },
      '/api/fleet': [],
    });
    render(<MemoryRouter><WorkOrdersRoute /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/no work orders yet/i)).toBeInTheDocument());
  });

  it('filter dropdown is wired and updates its visible value', async () => {
    stub({
      '/api/work-orders': { count: 0, data: [] },
      '/api/fleet': [],
    });
    render(<MemoryRouter><WorkOrdersRoute /></MemoryRouter>);
    await waitFor(() => expect(screen.queryByText(/loading work orders/i)).toBeNull());
    const select = screen.getByLabelText(/filter by status/i) as HTMLSelectElement;
    expect(select.value).toBe('all');
    fireEvent.change(select, { target: { value: 'completed' } });
    expect(select.value).toBe('completed');
  });
});
