import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const mockApiFetch = vi.fn();
const mockSubscribe = vi.fn((..._a: any[]) => () => {});

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: (...a: any[]) => mockApiFetch(...a) }));
vi.mock('../../../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: (...a: any[]) => mockSubscribe(...a) }),
}));
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, officer_id: 1, role: 'officer' } }),
}));

describe('ShiftCard (smoke)', () => {
  it('module loads', async () => {
    const mod = await import('../ShiftCard');
    expect(mod.default).toBeDefined();
  });
});

describe('ShiftCard', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    cleanup();
  });

  it('shows Clock In when inactive', async () => {
    mockApiFetch.mockResolvedValueOnce({ active: false });
    const { default: ShiftCard } = await import('../ShiftCard');
    render(<ShiftCard />);
    await waitFor(() => expect(screen.getByRole('button', { name: /clock in/i })).toBeInTheDocument());
  });

  it('shows Clock Out + stats when active', async () => {
    mockApiFetch.mockResolvedValueOnce({
      active: true, started_at: '2026-04-20T08:00:00Z', hours_today: 4.2, calls_handled: 12,
    });
    const { default: ShiftCard } = await import('../ShiftCard');
    render(<ShiftCard />);
    await waitFor(() => expect(screen.getByRole('button', { name: /clock out/i })).toBeInTheDocument());
    expect(screen.getByText(/4\.2/)).toBeInTheDocument();
    expect(screen.getByText(/^12$/)).toBeInTheDocument();
  });
});
