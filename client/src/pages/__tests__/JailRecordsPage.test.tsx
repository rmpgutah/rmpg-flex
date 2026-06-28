import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import JailRecordsPage from '../JailRecordsPage';

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') return { ingested: 2, matched: 1, alerts: 1, parsed: 2 };
    if (path.includes('/jail/sources')) return [
      { source_key: 'ut-udc', display_name: 'Utah Dept. of Corrections (statewide)', county: null, kind: 'json', status: 'active', last_run_at: null, last_status: 'ok', row_count: 0 },
      { source_key: 'ut-salt-lake', display_name: 'Salt Lake County Jail', county: 'Salt Lake', kind: 'portal', status: 'pending', last_run_at: null, last_status: null, row_count: 0 },
    ];
    if (path.includes('/jail/bookings')) return [
      { id: 1, full_name: 'John Smith', booking_date: '2026-06-10', charges: 'Theft', county: 'Davis', entry_source: 'roster_manual', person_id: 5 },
    ];
    return [];
  }),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'admin', full_name: 'Test Admin', username: 'testadmin' } }),
}));

vi.mock('../../components/ToastProvider', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

describe('JailRecordsPage', () => {
  it('renders sources, bookings, and ingests a roster with cross-hit result', async () => {
    render(<MemoryRouter><JailRecordsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Salt Lake County Jail')).toBeInTheDocument());
    expect(screen.getByText('John Smith')).toBeInTheDocument();
    expect(screen.getByText('KNOWN →')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/John Smith - Theft/), { target: { value: 'Jane Doe - DUI' } });
    fireEvent.click(screen.getByText('INGEST + CROSS-HIT'));
    await waitFor(() => expect(screen.getByText(/1 FLAGGED HIT/)).toBeInTheDocument());
  });
});
