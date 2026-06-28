import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockApiFetch = vi.fn();
const mockSubscribe = vi.fn((..._a: any[]) => () => {});
const mockNavigate = vi.fn();

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: (...a: any[]) => mockApiFetch(...a) }));
vi.mock('../../../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: (...a: any[]) => mockSubscribe(...a) }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

describe('MessagesCard (smoke)', () => {
  it('module loads', async () => {
    const mod = await import('../MessagesCard');
    expect(mod.default).toBeDefined();
  });
});

describe('MessagesCard', () => {
  beforeEach(() => { mockApiFetch.mockReset(); mockNavigate.mockReset(); });

  it('renders unread count', async () => {
    const now = new Date().toISOString();
    mockApiFetch.mockResolvedValueOnce([
      { id: 1, from_name: 'Dispatch', body: 'Check in at EOT', created_at: now, read_at: null },
      { id: 2, from_name: 'Supervisor', body: 'Report due by 5', created_at: now, read_at: null },
      { id: 3, from_name: 'Dispatch', body: 'Thanks', created_at: now, read_at: now },
    ]);
    const { default: MessagesCard } = await import('../MessagesCard');
    render(<MessagesCard />);
    await waitFor(() => expect(screen.getByText(/Inbox · 2 new/i)).toBeInTheDocument());
  });
});
