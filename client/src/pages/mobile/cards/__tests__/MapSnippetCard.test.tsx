import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn(async () => []) }));
vi.mock('../../../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: () => () => {} }),
}));
vi.mock('../../hooks/useGeolocation', () => ({
  useGeolocation: () => ({ status: 'idle', position: null }),
}));
vi.mock('../../../map-v2/hooks/useOlBeatLayer', () => ({
  useOlBeatLayer: () => ({ ready: false }),
}));
vi.mock('../../../map-v2/hooks/useOlLiveMarkers', () => ({
  useOlLiveMarkers: () => ({}),
}));
vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
}));

describe('MapSnippetCard (smoke)', () => {
  it('module loads', async () => {
    const mod = await import('../MapSnippetCard');
    expect(mod.default).toBeDefined();
  });
});

describe('MapSnippetCard', () => {
  it('renders title and full-map link', async () => {
    const { default: MapSnippetCard } = await import('../MapSnippetCard');
    render(<MapSnippetCard />);
    expect(screen.getByText(/^MAP$/i)).toBeInTheDocument();
    expect(screen.getByText(/Open full map/i)).toBeInTheDocument();
  });
});
