import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ConnectionsMapPanel from '../ConnectionsMapPanel';

const mockFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (url: string) => mockFetch(url),
}));

const mockGetMapboxAccessToken = vi.fn();
vi.mock('../../utils/mapboxApiKey', () => ({
  getMapboxAccessToken: () => mockGetMapboxAccessToken(),
}));

vi.mock('../../utils/mapboxBasemap', () => ({
  applyRmpgBasemap: vi.fn(),
}));

vi.mock('../../utils/webglRecovery', () => ({
  installWebglContextRecovery: vi.fn(() => () => {}),
}));

vi.mock('../../utils/mapboxLoader', () => {
  class FakeMap {
    addSource() { /* noop */ }
    addLayer() { /* noop */ }
    fitBounds() { return this; }
    on(event: string, cb: () => void) {
      // Fire immediately so effects depending on 'load'/'style.load' resolve synchronously in tests.
      cb();
      return this;
    }
    remove() { /* noop */ }
  }
  class FakeMarker {
    setLngLat() { return this; }
    addTo() { return this; }
    remove() { /* noop */ }
  }
  class FakeLngLatBounds {
    extend() { return this; }
  }
  return {
    mapboxgl: {
      Map: FakeMap,
      Marker: FakeMarker,
      LngLatBounds: FakeLngLatBounds,
    },
    MAPBOX_STYLE_DARK: 'mapbox://styles/mapbox/dark-v11',
    initMapbox: vi.fn(),
    registerMapInstance: vi.fn(),
    unregisterMapInstance: vi.fn(),
  };
});

describe('ConnectionsMapPanel', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockGetMapboxAccessToken.mockReset();
  });

  it('renders a loading state while data and token resolve', () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
    mockGetMapboxAccessToken.mockReturnValue(new Promise(() => {}));

    render(<ConnectionsMapPanel nodeType="person" nodeEntityId={1} />);

    expect(document.querySelector('.animate-spin')).toBeTruthy();
    expect(screen.queryByText(/No geo data/i)).not.toBeInTheDocument();
  });

  it('shows the "No geo data" empty state when both endpoints return empty arrays', async () => {
    mockFetch.mockResolvedValue({ data: [] });
    mockGetMapboxAccessToken.mockResolvedValue('pk.test-token');

    render(<ConnectionsMapPanel nodeType="person" nodeEntityId={1} />);

    await waitFor(() => {
      expect(screen.getByText(/No geo data for this entity\./i)).toBeInTheDocument();
    });
    expect(document.querySelector('.animate-spin')).toBeFalsy();
  });

  it('does not throw and still resolves to the empty state when getMapboxAccessToken() rejects', async () => {
    mockFetch.mockResolvedValue({
      data: [{ lat: 40.76, lng: -111.89 }],
    });
    mockGetMapboxAccessToken.mockRejectedValue(new Error('Mapbox access token is not configured'));

    expect(() => render(<ConnectionsMapPanel nodeType="person" nodeEntityId={1} />)).not.toThrow();

    await waitFor(() => {
      expect(screen.getByText(/No geo data for this entity\./i)).toBeInTheDocument();
    });
    expect(document.querySelector('.animate-spin')).toBeFalsy();
  });
});
