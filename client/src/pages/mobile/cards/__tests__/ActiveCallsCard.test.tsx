import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockApiFetch = vi.fn();
const mockSubscribe = vi.fn(() => () => {});
const mockNavigate = vi.fn();

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: (...a: any[]) => mockApiFetch(...a) }));
vi.mock('../../../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: (...a: any[]) => (mockSubscribe as any)(...a) }),
}));
vi.mock('../../hooks/useGeolocation', () => ({
  useGeolocation: () => ({ status: 'idle', position: null }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

describe('ActiveCallsCard (smoke)', () => {
  it('module loads', async () => {
    const mod = await import('../ActiveCallsCard');
    expect(mod.default).toBeDefined();
  });
});

describe('ActiveCallsCard', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockSubscribe.mockClear();
    mockNavigate.mockReset();
  });

  it('renders P1 and P2 counts from fetched calls', async () => {
    mockApiFetch.mockResolvedValueOnce([
      { id: 1, call_number: 'C1', incident_type: 'Disturbance', priority: '1', status: 'pending', address: 'A', created_at: new Date().toISOString() },
      { id: 2, call_number: 'C2', incident_type: 'Theft', priority: '1', status: 'dispatched', address: 'B', created_at: new Date().toISOString() },
      { id: 3, call_number: 'C3', incident_type: 'Alarm', priority: '2', status: 'enroute', address: 'C', created_at: new Date().toISOString() },
    ]);
    const { default: ActiveCallsCard } = await import('../ActiveCallsCard');
    render(<ActiveCallsCard />);
    await waitFor(() => expect(screen.getByText(/P1 · 2/i)).toBeInTheDocument());
    expect(screen.getByText(/P2 · 1/i)).toBeInTheDocument();
  });
});
