import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { clusterByGrid } from '../../../utils/serveMapClustering';

// This is a targeted unit test of the mapping function ServeIntakeMap will use,
// isolated from the mapboxgl runtime (mapboxgl is mocked globally in test setup).
describe('ServeIntakeMap clustering integration', () => {
  it('maps QueueMapItem shape into ClusterableItem shape without loss', () => {
    const queueItem = {
      id: 42,
      recipient_lng: -111.9,
      recipient_lat: 40.7,
      priority: 'rush',
      status: 'pending',
    };
    const clusterable = {
      id: queueItem.id,
      lng: queueItem.recipient_lng,
      lat: queueItem.recipient_lat,
      priority: queueItem.priority,
      status: queueItem.status,
    };
    const clusters = clusterByGrid([clusterable], 10);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].itemIds).toEqual([42]);
  });
});

// --- Rendered-component coverage for the fitBounds/zoom effect split ---
// vi.mock calls must stay top-level (they are hoisted by vitest's transform;
// nesting them inside describe/beforeEach silently fails to intercept the
// real modules).

const mockFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (url: string) => mockFetch(url),
}));

vi.mock('../../../utils/mapboxBasemap', () => ({
  applyRmpgBasemap: vi.fn(),
}));

vi.mock('../../../utils/mapboxLoader', () => {
  class FakeMap {
    getZoom() { return 10; }
    fitBounds(...args: unknown[]) {
      (globalThis as any).__fitBoundsSpy?.(...args);
      return this;
    }
    easeTo(...args: unknown[]) {
      (globalThis as any).__easeToSpy?.(...args);
      return this;
    }
    on(event: string, cb: () => void) {
      if (event === 'load') {
        // fire synchronously so mapReady flips true in the test
        cb();
      }
      if (event === 'zoomend') {
        (globalThis as any).__setZoomEndHandler?.(cb);
      }
      return this;
    }
    remove() { /* noop */ }
  }
  class FakeMarker {
    setLngLat() { return this; }
    addTo() { return this; }
    remove() { /* noop */ }
  }
  class FakePopup {
    setHTML() { return this; }
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
      Popup: FakePopup,
      LngLatBounds: FakeLngLatBounds,
    },
    MAPBOX_STYLE_DARK: 'mapbox://styles/mapbox/dark-v11',
    registerMapInstance: vi.fn(),
    unregisterMapInstance: vi.fn(),
  };
});

describe('ServeIntakeMap fitBounds/zoom split', () => {
  let zoomEndHandler: (() => void) | null = null;
  let fitBoundsSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch.mockReset();
    zoomEndHandler = null;
    fitBoundsSpy = vi.fn();
    (globalThis as any).__fitBoundsSpy = fitBoundsSpy;
    (globalThis as any).__easeToSpy = vi.fn();
    (globalThis as any).__setZoomEndHandler = (cb: () => void) => { zoomEndHandler = cb; };
  });

  it('calls fitBounds exactly once on load and does not call it again on a zoomend with no item change', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('map-items')) {
        return Promise.resolve([
          {
            id: 1,
            status: 'pending',
            priority: 'urgent',
            recipient_name: 'Jane Doe',
            recipient_address: '123 Main St',
            recipient_city: 'Salt Lake City',
            recipient_state: 'UT',
            document_type: 'Summons',
            case_number: 'CV-1',
            deadline: null,
            attempt_count: 0,
            recipient_type: 'person',
            recipient_lat: 40.7,
            recipient_lng: -111.9,
            location_note_id: null,
            location_note_text: null,
            next_attempt_date: null,
            next_attempt_window: null,
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const { default: ServeIntakeMap } = await import('../ServeIntakeMap');

    render(<ServeIntakeMap />);

    await waitFor(() => {
      expect(fitBoundsSpy).toHaveBeenCalledTimes(1);
    });

    // Simulate a zoomend firing (as would happen after a cluster-click easeTo)
    // with no change to the underlying item list.
    await act(async () => {
      zoomEndHandler?.();
    });

    // fitBounds must NOT be called again purely from the zoom-state change.
    expect(fitBoundsSpy).toHaveBeenCalledTimes(1);
  });
});
