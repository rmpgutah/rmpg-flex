import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import BoloBoard from '../BoloBoard';

const apiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({ apiFetch: (...a: any[]) => apiFetch(...a), authedImageUrl: (u: string) => u }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));

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
    render(<BoloBoard />);
    await waitFor(() => expect(screen.getByText('P1 subject')).toBeInTheDocument());
    expect(screen.getByText('P3 vehicle')).toBeInTheDocument();
  });
});
