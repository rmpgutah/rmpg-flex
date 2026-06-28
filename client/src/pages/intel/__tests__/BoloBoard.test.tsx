import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect } from 'vitest';
import BoloBoard from '../BoloBoard';

const apiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...a: any[]) => apiFetch(...a),
  authedImageUrl: (u: string) => u,
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'admin', id: 1 } }),
}));
vi.mock('../../../components/ToastProvider', () => ({
  useToast: () => ({ addToast: vi.fn() }),
  default: ({ children }: { children: any }) => children,
}));

describe('BoloBoard', () => {
  it('renders bolos grouped by priority', async () => {
    apiFetch.mockResolvedValue([
      { id: 1, bolo_number: '26-BOLO-00001', type: 'person', status: 'active', title: 'P1 subject', description: null,
        subject_description: null, vehicle_description: null, photo_url: null, priority: 'P1', issued_by: 5,
        issued_by_name: 'CZ', expires_at: null, created_at: 'x' },
      { id: 2, bolo_number: '26-BOLO-00002', type: 'vehicle', status: 'active', title: 'P3 vehicle', description: null,
        subject_description: null, vehicle_description: 'Red', photo_url: null, priority: 'P3', issued_by: 5,
        issued_by_name: 'CZ', expires_at: null, created_at: 'x' },
    ]);
    render(<MemoryRouter><BoloBoard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('P1 subject')).toBeInTheDocument());
    expect(screen.getByText('P3 vehicle')).toBeInTheDocument();
  });

  it('cancel BOLO opens a confirm dialog before calling DELETE (v1047)', async () => {
    apiFetch.mockResolvedValue([
      { id: 7, bolo_number: '26-BOLO-00007', type: 'person', status: 'active', title: 'X', description: null,
        subject_description: null, vehicle_description: null, photo_url: null, priority: 'P1', issued_by: 5,
        issued_by_name: 'CZ', expires_at: null, created_at: 'x' },
    ]);
    render(<MemoryRouter><BoloBoard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());
    // The Cancel BOLO button on the card now opens a ConfirmDialog instead
    // of firing DELETE directly.
    fireEvent.click(screen.getByText(/cancel bolo/i));
    expect(await screen.findByText(/Cancel BOLO\?/)).toBeInTheDocument();
    // Confirm dialog Keep BOLO closes it without firing DELETE.
    fireEvent.click(screen.getByText(/keep bolo/i));
    // apiFetch was only called once (initial load), never for DELETE.
    const deleteCalls = apiFetch.mock.calls.filter((c: any[]) => c[1]?.method === 'DELETE');
    expect(deleteCalls.length).toBe(0);
  });

  it('shows empty state with N hint when no active BOLOs (v1047)', async () => {
    apiFetch.mockResolvedValue([]);
    render(<MemoryRouter><BoloBoard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/no active bolos\./i)).toBeInTheDocument());
    expect(screen.getByText(/Press/i)).toBeInTheDocument();
  });
});
