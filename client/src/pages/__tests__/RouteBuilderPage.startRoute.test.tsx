import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, test, expect, beforeEach } from 'vitest';
import RouteBuilderPage from '../RouteBuilderPage';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('mapbox-gl', () => ({
  default: {
    Marker: vi.fn().mockImplementation(() => ({ setLngLat: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis(), remove: vi.fn(), setPopup: vi.fn().mockReturnThis() })),
    Popup: vi.fn().mockImplementation(() => ({ setHTML: vi.fn().mockReturnThis() })),
    LngLatBounds: vi.fn().mockImplementation(() => ({ extend: vi.fn() })),
  },
}));

vi.mock('../../utils/mapboxApiKey', () => ({ getMapboxToken: vi.fn().mockResolvedValue('') }));
vi.mock('../../utils/mapboxLoader', () => ({
  createMapboxMap: vi.fn().mockReturnValue({ on: vi.fn(), remove: vi.fn(), fitBounds: vi.fn() }),
  addMapboxTrail: vi.fn(),
  removeMapboxTrail: vi.fn(),
  injectMapboxStyles: vi.fn(),
}));
vi.mock('../../utils/mapboxServices', () => ({ getDirections: vi.fn().mockResolvedValue({ routes: [] }) }));

const mockLoadUnitRoute = vi.fn().mockResolvedValue(undefined);
vi.mock('../../context/NavTripContext', () => ({
  useNavTrip: () => ({ loadUnitRoute: mockLoadUnitRoute }),
}));

vi.mock('../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: vi.fn().mockReturnValue(() => {}) }),
}));

const mockApiFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

const waypoint = {
  stop_number: 1,
  call_id: 1,
  call_number: 'CFS-1',
  incident_type: 'other',
  priority: 'P2',
  latitude: 40.7,
  longitude: -111.9,
  location_address: '123 Main St',
  status: 'active',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApiFetch.mockImplementation((url: string) => {
    if (url === '/api/dispatch/units') {
      return Promise.resolve([{ id: 'U1', call_sign: 'Adam-1', officer_name: 'Officer Test', status: 'available' }]);
    }
    if (url.startsWith('/api/dispatch/routing/unit/')) {
      return Promise.resolve([]);
    }
    return Promise.resolve({});
  });
});

test('Start Route button is absent with no built route', () => {
  render(<MemoryRouter><RouteBuilderPage /></MemoryRouter>);
  expect(screen.queryByText('Start Route')).not.toBeInTheDocument();
});

test('Start Route saves (if unsaved), loads the unit route into guidance, and navigates to /navigation', async () => {
  mockApiFetch.mockImplementation((url: string, opts?: any) => {
    if (url === '/api/dispatch/units') {
      return Promise.resolve([{ id: 'U1', call_sign: 'Adam-1', officer_name: 'Officer Test', status: 'available' }]);
    }
    if (url.startsWith('/api/dispatch/routing/unit/')) {
      return Promise.resolve([]);
    }
    if (url === '/api/dispatch/routing/optimize' && opts?.method === 'POST') {
      return Promise.resolve({
        unit_id: 'U1',
        origin: { lat: 40.7, lng: -111.9 },
        optimized_order: [1],
        waypoints: [waypoint],
        total_distance_miles: 2,
        estimated_time_minutes: 5,
        algorithm: 'nn',
        priority_weighted: true,
      });
    }
    if (url === '/api/dispatch/routing/save' && opts?.method === 'POST') {
      return Promise.resolve({ success: true, id: 42 });
    }
    return Promise.resolve({});
  });

  render(<MemoryRouter><RouteBuilderPage /></MemoryRouter>);

  await waitFor(() => expect(screen.getByText('— Select Unit —')).toBeInTheDocument());
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'U1' } });
  fireEvent.click(screen.getByRole('button', { name: /Build Route/i }));

  await waitFor(() => expect(screen.getByText('Start Route')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Start Route'));

  await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith(
    '/api/dispatch/routing/save',
    expect.objectContaining({ method: 'POST' }),
  ));
  await waitFor(() => expect(mockLoadUnitRoute).toHaveBeenCalledWith('U1'));
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/navigation'));
});
