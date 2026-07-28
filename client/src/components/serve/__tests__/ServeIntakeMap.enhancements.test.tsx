// ============================================================
// RMPG Flex — Serve Intake Map enhancement smoke tests
// Shared smoke-test home for Tasks 5–11.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import ServeIntakeMap from '../ServeIntakeMap';
import * as useApiModule from '../../../hooks/useApi';

// Track the most recently constructed mock Map instance so tests can assert
// on addSource/addLayer/getLayer/getSource calls against it.
let lastMapInstance: any = null;
// Track marker elements keyed by insertion order so a test can simulate a
// click on the marker for a specific queue item.
const markerElements: HTMLElement[] = [];

vi.mock('../../../utils/mapboxLoader', () => ({
  mapboxgl: {
    Map: vi.fn(function () {
      const instance = {
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
      lastMapInstance = instance;
      return instance;
    }),
    Marker: vi.fn(function (opts: { element: HTMLElement }) {
      if (opts?.element) markerElements.push(opts.element);
      return { setLngLat: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis(), remove: vi.fn() };
    }),
    Popup: vi.fn(function () {
      let html = '';
      let attached: HTMLElement | null = null;
      return {
        setHTML: vi.fn(function (this: any, h: string) { html = h; return this; }),
        addTo: vi.fn(() => {
          // Simulate real Mapbox behavior enough for popup-button wiring
          // tests: insert the popup's HTML into the document so the
          // component's document.getElementById lookups (for the "Open
          // record" / "Add notation" / "View trail" buttons) can find them.
          attached = document.createElement('div');
          attached.innerHTML = html;
          document.body.appendChild(attached);
          return attached;
        }),
        remove: vi.fn(() => { attached?.remove(); attached = null; }),
      };
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

const MOCK_QUEUE_ITEM = {
  id: 501,
  status: 'pending',
  priority: 'urgent',
  recipient_name: 'John Doe',
  recipient_address: '123 Main St',
  recipient_city: 'Salt Lake City',
  recipient_state: 'UT',
  document_type: 'Summons',
  case_number: 'CV-2026-001',
  deadline: null,
  attempt_count: 2,
  recipient_type: 'person',
  recipient_lat: 40.76,
  recipient_lng: -111.891,
  location_note_id: null,
  location_note_text: null,
  next_attempt_date: null,
  next_attempt_window: null,
};

const MOCK_TRAIL_RESPONSE = {
  trail: [
    { attempt_at: '2026-07-20T10:00:00Z', latitude: 40.76, longitude: -111.891, result: 'no_answer' },
    { attempt_at: '2026-07-21T14:00:00Z', latitude: 40.761, longitude: -111.892, result: 'served' },
  ],
  polyline: [
    [-111.891, 40.76],
    [-111.892, 40.761],
  ] as [number, number][],
};

describe('ServeIntakeMap', () => {
  beforeEach(() => {
    lastMapInstance = null;
    markerElements.length = 0;
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

  it('draws the attempt-history trail overlay when the popup trail button is clicked', async () => {
    vi.spyOn(useApiModule, 'apiFetch').mockImplementation((path: string) => {
      if (path === '/serve-intake/map-items') return Promise.resolve([MOCK_QUEUE_ITEM]);
      if (path === '/serve-intake/location-notes') return Promise.resolve([]);
      if (path === `/process-server/${MOCK_QUEUE_ITEM.id}/gps-trail`) return Promise.resolve(MOCK_TRAIL_RESPONSE);
      return Promise.resolve([]);
    });

    render(<ServeIntakeMap />);
    await waitFor(() => expect(markerElements.length).toBeGreaterThan(0));

    // Click the marker to open its popup (attaches popup HTML to document.body).
    await act(async () => {
      markerElements[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // The component wires popup button listeners after a 50ms setTimeout.
      await new Promise((r) => setTimeout(r, 60));
    });

    const trailBtn = document.getElementById(`srv-popup-trail-${MOCK_QUEUE_ITEM.id}`);
    expect(trailBtn).toBeTruthy();

    await act(async () => {
      trailBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitFor(() => {
      expect(lastMapInstance.addSource).toHaveBeenCalledWith(
        'srv-attempt-trail',
        expect.objectContaining({ type: 'geojson' }),
      );
    });
    expect(lastMapInstance.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'srv-attempt-trail-layer', source: 'srv-attempt-trail' }),
    );
  });

  it('does not throw when the component unmounts while a trail is active', async () => {
    vi.spyOn(useApiModule, 'apiFetch').mockImplementation((path: string) => {
      if (path === '/serve-intake/map-items') return Promise.resolve([MOCK_QUEUE_ITEM]);
      if (path === '/serve-intake/location-notes') return Promise.resolve([]);
      if (path === `/process-server/${MOCK_QUEUE_ITEM.id}/gps-trail`) return Promise.resolve(MOCK_TRAIL_RESPONSE);
      return Promise.resolve([]);
    });

    const { unmount } = render(<ServeIntakeMap />);
    await waitFor(() => expect(markerElements.length).toBeGreaterThan(0));

    await act(async () => {
      markerElements[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
    });

    const trailBtn = document.getElementById(`srv-popup-trail-${MOCK_QUEUE_ITEM.id}`);
    await act(async () => {
      trailBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitFor(() => expect(lastMapInstance.addSource).toHaveBeenCalled());

    // Simulate the real-world hazard: the map-init effect's cleanup nulls
    // mapRef.current before/independently of the trail effect's own cleanup.
    // Unmounting here exercises both cleanups; it must not throw even though
    // the trail-effect cleanup closure still holds a reference to the old map.
    expect(() => unmount()).not.toThrow();
  });

  afterEach(() => {
    cleanup();
  });
});
