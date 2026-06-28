import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockApiFetch = vi.fn();
const mockSubscribe = vi.fn(() => () => {});

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: (...a: any[]) => mockApiFetch(...a) }));
vi.mock('../../../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: (...a: any[]) => (mockSubscribe as any)(...a) }),
}));

describe('BolosCard (smoke)', () => {
  it('module loads', async () => {
    const mod = await import('../BolosCard');
    expect(mod.default).toBeDefined();
  });
});

describe('BolosCard', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockSubscribe.mockClear();
  });

  it('renders a BOLO row and a premise alert row in the merged feed', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes('bolos')) {
        return [{
          id: 1,
          title: 'Armed robbery suspect',
          suspect_description: '6ft male, red hoodie',
          created_at: new Date().toISOString(),
        }];
      }
      if (url.includes('premise-alerts') || url.includes('premise_alerts')) {
        return [{
          id: 1,
          location_name: '100 Main St',
          alert_type: 'OFFICER SAFETY',
          description: 'Violent occupant',
          created_at: new Date().toISOString(),
        }];
      }
      return [];
    });

    const { default: BolosCard } = await import('../BolosCard');
    render(<BolosCard />);

    await waitFor(() => expect(screen.getByText('Armed robbery suspect')).toBeInTheDocument());
    expect(screen.getByText('100 Main St')).toBeInTheDocument();
    expect(screen.getByText('BOLO')).toBeInTheDocument();
    expect(screen.getByText('ALERT')).toBeInTheDocument();
  });
});
