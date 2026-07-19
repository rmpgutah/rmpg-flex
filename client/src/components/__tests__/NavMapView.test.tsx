import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../utils/mapboxApiKey', () => ({
  getMapboxAccessToken: vi.fn().mockResolvedValue('pk.test-token'),
  getMapboxTokenErrorMessage: vi.fn().mockReturnValue('Mapbox token missing'),
}));

vi.mock('../../utils/mapboxLoader', () => ({
  initMapbox: vi.fn(),
  mapboxgl: {
    Map: vi.fn().mockImplementation(() => ({
      addControl: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      remove: vi.fn(),
    })),
    NavigationControl: vi.fn(),
    AttributionControl: vi.fn(),
  },
  MAPBOX_STYLE_DARK: 'mock://dark',
  MAPBOX_STYLE_SATELLITE: 'mock://satellite',
  MAPBOX_STYLE_STREETS: 'mock://streets',
  MAPBOX_STYLE_LIGHT: 'mock://light',
  classifyMapboxError: vi.fn().mockReturnValue({ message: '', isAuthErr: false }),
}));

vi.mock('../../utils/mapboxBasemap', () => ({ applyRmpgBasemap: vi.fn() }));

const trafficToggle = vi.fn();
const weatherToggle = vi.fn();
let trafficEnabled = false;
let weatherEnabled = false;

vi.mock('../../hooks/useMapTraffic', () => ({
  useMapTraffic: vi.fn(() => ({ enabled: trafficEnabled, toggle: trafficToggle, setEnabled: vi.fn() })),
}));
vi.mock('../../hooks/useMapWeatherRadar', () => ({
  useMapWeatherRadar: vi.fn(() => ({
    enabled: weatherEnabled, toggle: weatherToggle, setEnabled: vi.fn(),
    opacity: 0.6, setOpacity: vi.fn(), frames: [],
  })),
}));

import NavMapView from '../NavMapView';

describe('NavMapView — live traffic + weather radar controls', () => {
  beforeEach(() => {
    trafficEnabled = false;
    weatherEnabled = false;
    trafficToggle.mockClear();
    weatherToggle.mockClear();
  });

  it('renders traffic and weather toggle buttons when controls are shown', () => {
    render(<NavMapView position={null} showControls />);
    expect(screen.getByTitle('Show live traffic')).toBeInTheDocument();
    expect(screen.getByTitle('Show weather radar')).toBeInTheDocument();
  });

  it('calls the traffic hook toggle when the traffic button is clicked', () => {
    render(<NavMapView position={null} showControls />);
    fireEvent.click(screen.getByTitle('Show live traffic'));
    expect(trafficToggle).toHaveBeenCalledTimes(1);
  });

  it('calls the weather hook toggle when the weather button is clicked', () => {
    render(<NavMapView position={null} showControls />);
    fireEvent.click(screen.getByTitle('Show weather radar'));
    expect(weatherToggle).toHaveBeenCalledTimes(1);
  });

  it('reflects the active state in the button title', () => {
    trafficEnabled = true;
    weatherEnabled = true;
    render(<NavMapView position={null} showControls />);
    expect(screen.getByTitle('Hide live traffic')).toBeInTheDocument();
    expect(screen.getByTitle('Hide weather radar')).toBeInTheDocument();
  });

  it('hides both toggle buttons when showControls is false', () => {
    render(<NavMapView position={null} showControls={false} />);
    expect(screen.queryByTitle('Show live traffic')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Show weather radar')).not.toBeInTheDocument();
  });
});
