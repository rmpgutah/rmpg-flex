import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMapGeofenceAlerts } from '../useMapGeofenceAlerts';
import * as useApiModule from '../useApi';

vi.mock('../useApi', () => ({ apiFetch: vi.fn() }));

describe('useMapGeofenceAlerts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches from /geofences (not the dead /dispatch/calls/geofences path) and parses geojson_data', async () => {
    const mockRow = {
      id: 7,
      zone_name: 'HQ Perimeter',
      zone_type: 'exclusion',
      color: '#ef4444',
      is_active: 1,
      geojson_data: JSON.stringify({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[[-111.9, 40.7], [-111.8, 40.7], [-111.8, 40.8], [-111.9, 40.8], [-111.9, 40.7]]],
          },
        }],
      }),
    };
    vi.mocked(useApiModule.apiFetch).mockResolvedValue([mockRow]);

    const { result } = renderHook(() => useMapGeofenceAlerts(null, false));
    act(() => result.current.setEnabled(true));

    await waitFor(() => expect(result.current.geofences).toHaveLength(1));
    expect(useApiModule.apiFetch).toHaveBeenCalledWith('/geofences');
    expect(result.current.geofences[0]).toMatchObject({
      id: '7', name: 'HQ Perimeter', type: 'exclusion', active: true,
    });
    expect(result.current.geofences[0].coordinates).toHaveLength(4); // closing point dropped
  });
});
