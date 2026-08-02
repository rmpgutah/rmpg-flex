import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// DashboardMiniMap (wrapped by this widget) instantiates a real mapbox-gl
// Map/Marker/Popup/LngLatBounds/AttributionControl and calls out to
// getMapboxToken / injectMapboxStyles / applyRmpgBasemap / apiFetch — all of
// which must be mocked to avoid touching a real Mapbox GL context in jsdom.
vi.mock('mapbox-gl', () => ({
  default: {
    Map: vi.fn().mockImplementation(() => ({
      addControl: vi.fn(),
      on: vi.fn(),
      remove: vi.fn(),
      fitBounds: vi.fn(),
    })),
    Marker: vi.fn().mockImplementation(() => ({
      setLngLat: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      setPopup: vi.fn().mockReturnThis(),
    })),
    Popup: vi.fn().mockImplementation(() => ({ setHTML: vi.fn().mockReturnThis() })),
    LngLatBounds: vi.fn().mockImplementation(() => ({ extend: vi.fn() })),
    AttributionControl: vi.fn(),
  },
}));
vi.mock('../../../utils/mapboxApiKey', () => ({ getMapboxToken: vi.fn().mockResolvedValue('') }));
vi.mock('../../../utils/mapboxLoader', () => ({ injectMapboxStyles: vi.fn() }));
vi.mock('../../../utils/mapboxBasemap', () => ({ applyRmpgBasemap: vi.fn() }));
vi.mock('../../../hooks/useApi', () => ({ apiFetch: vi.fn().mockResolvedValue([]) }));

import DesktopMiniMapWidget from './DesktopMiniMapWidget';

describe('DesktopMiniMapWidget', () => {
  it('renders the shared DashboardMiniMap inside the widget frame', () => {
    render(<MemoryRouter><DesktopMiniMapWidget /></MemoryRouter>);
    expect(screen.getByText(/Live Situational Map/i)).toBeInTheDocument();
  });

  it('exposes an "Open full map" control from the wrapped DashboardMiniMap', () => {
    render(<MemoryRouter><DesktopMiniMapWidget /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /open full map/i })).toBeInTheDocument();
  });
});
