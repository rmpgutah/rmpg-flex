// Regression test for the cross-unit pause/resume bug: `geofence_alert` is
// broadcast to EVERY connected client (broadcastAll in src/routes/dispatch/gps.ts),
// not scoped to a unit. NavTripProvider must ignore events for units other than
// the current officer's own assigned unit (gps.unitId) before calling the
// pause/resume endpoints — otherwise any unit crossing a station geofence would
// pause/resume every OTHER officer's trip too.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────
let geofenceHandler: ((msg: any) => void) | null = null;
const subscribe = vi.fn((type: string, handler: (msg: any) => void) => {
  if (type === 'geofence_alert') geofenceHandler = handler;
  return () => { geofenceHandler = null; };
});

vi.mock('../WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe }),
}));

const apiFetch = vi.fn().mockResolvedValue({});
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

let mockUnitId: number | null = 42;
vi.mock('../../hooks/useGpsTracking', () => ({
  useGpsTracking: () => ({
    latitude: null,
    longitude: null,
    accuracy: null,
    speed: null,
    heading: null,
    headingSmoothed: null,
    isTracking: false,
    unitId: mockUnitId,
  }),
}));

let mockActiveTripId: number | null = 555;
vi.mock('../../hooks/useNavTripDetection', () => ({
  useNavTripDetection: () => ({
    detection: { activeTripId: mockActiveTripId },
  }),
}));

vi.mock('../../hooks/useNavGuidanceEngine', () => ({
  useNavGuidanceEngine: () => ({ updateOrigin: vi.fn() }),
}));

import { NavTripProvider } from '../NavTripContext';

describe('NavTripProvider station geofence pause/resume — unit filtering', () => {
  beforeEach(() => {
    apiFetch.mockClear();
    geofenceHandler = null;
    mockUnitId = 42;
    mockActiveTripId = 555;
  });

  it('does NOT pause/resume when the geofence_alert is for a different unit', async () => {
    render(<NavTripProvider>{null}</NavTripProvider>);
    await waitFor(() => expect(geofenceHandler).not.toBeNull());

    geofenceHandler!({
      data: { unit_id: 99, zone_id: 1, zone_type: 'station', event_type: 'enter' },
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('pauses the active trip when the geofence_alert is for this officer\'s own unit', async () => {
    render(<NavTripProvider>{null}</NavTripProvider>);
    await waitFor(() => expect(geofenceHandler).not.toBeNull());

    geofenceHandler!({
      data: { unit_id: 42, zone_id: 1, zone_type: 'station', event_type: 'enter' },
    });

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/nav/trip/555/pause', { method: 'PUT' }));
  });

  it('resumes the active trip on exit for this officer\'s own unit', async () => {
    render(<NavTripProvider>{null}</NavTripProvider>);
    await waitFor(() => expect(geofenceHandler).not.toBeNull());

    geofenceHandler!({
      data: { unit_id: 42, zone_id: 1, zone_type: 'station', event_type: 'exit' },
    });

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/nav/trip/555/resume', { method: 'PUT' }));
  });

  it('does not act when this officer has no assigned unit yet', async () => {
    mockUnitId = null;
    render(<NavTripProvider>{null}</NavTripProvider>);
    await waitFor(() => expect(geofenceHandler).not.toBeNull());

    geofenceHandler!({
      data: { unit_id: 42, zone_id: 1, zone_type: 'station', event_type: 'enter' },
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
