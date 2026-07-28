// ============================================================
// RMPG Flex — Serve Intake Map enhancement smoke tests
// Shared smoke-test home for Tasks 5–11.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ServeIntakeMap from '../ServeIntakeMap';
import * as useApiModule from '../../../hooks/useApi';

vi.mock('../../../utils/mapboxLoader', () => ({
  mapboxgl: {
    Map: vi.fn(function () {
      return {
        on: vi.fn((event: string, cb: () => void) => { if (event === 'load') cb(); }),
        remove: vi.fn(),
        fitBounds: vi.fn(),
        getZoom: vi.fn(() => 10),
        easeTo: vi.fn(),
        addSource: vi.fn(),
        addLayer: vi.fn(),
        getSource: vi.fn(() => null),
        getLayer: vi.fn(() => null),
        removeLayer: vi.fn(),
        removeSource: vi.fn(),
      };
    }),
    Marker: vi.fn(function () {
      return { setLngLat: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis(), remove: vi.fn() };
    }),
    Popup: vi.fn(function () {
      return { setHTML: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis(), remove: vi.fn() };
    }),
    LngLatBounds: vi.fn(function () {
      return { extend: vi.fn() };
    }),
  },
  MAPBOX_STYLE_DARK: 'dark-v11',
  registerMapInstance: vi.fn(),
  unregisterMapInstance: vi.fn(),
}));
vi.mock('../../../utils/mapboxBasemap', () => ({ applyRmpgBasemap: vi.fn() }));

describe('ServeIntakeMap', () => {
  beforeEach(() => {
    vi.spyOn(useApiModule, 'apiFetch').mockImplementation((path: string) => {
      if (path === '/serve-intake/map-items') return Promise.resolve([]);
      if (path === '/serve-intake/location-notes') return Promise.resolve([]);
      return Promise.resolve([]);
    });
  });

  it('renders without crashing and loads the queue', async () => {
    render(<ServeIntakeMap />);
    await waitFor(() => expect(screen.getByText(/no active serve orders/i)).toBeInTheDocument());
  });
});
