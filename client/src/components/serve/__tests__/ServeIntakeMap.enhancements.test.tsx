// ============================================================
// RMPG Flex — Serve Intake Map enhancement smoke tests
// Shared smoke-test home for Tasks 5–11.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import ServeIntakeMap from '../ServeIntakeMap';
import * as useApiModule from '../../../hooks/useApi';
import { fetchMapboxRoute } from '../../../utils/mapboxRouting';
import { reverseGeocode } from '../../../utils/mapboxServices';

vi.mock('../../../utils/mapboxServices', () => ({
  reverseGeocode: vi.fn(() => Promise.resolve({ features: [{ place_name: '123 Main St, Salt Lake City, UT' }] })),
  forwardGeocode: vi.fn(),
}));

vi.mock('../../../utils/mapboxRouting', () => ({
  fetchMapboxRoute: vi.fn(() => Promise.resolve({
    eta: '12 min',
    distance: '4.2 mi',
    durationSec: 720,
    distanceMeters: 6760,
    geometry: [{ lat: 40.7, lng: -111.9 }, { lat: 40.75, lng: -111.8 }],
  })),
}));

// Track the most recently constructed mock Map instance so tests can assert
// on addSource/addLayer/getLayer/getSource calls against it.
let lastMapInstance: any = null;
// Track marker elements keyed by insertion order so a test can simulate a
// click on the marker for a specific queue item.
const markerElements: HTMLElement[] = [];
// Track marker instances (keyed by insertion order, matching markerElements)
// so tests can trigger a marker's dragend handler and control getLngLat.
const markerInstances: any[] = [];

vi.mock('../../../utils/mapboxLoader', () => ({
  mapboxgl: {
    Map: vi.fn(function () {
      const handlers: Record<string, (e?: any) => void> = {};
      const instance = {
        on: vi.fn((event: string, cb: (e?: any) => void) => {
          handlers[event] = cb;
          if (event === 'load') cb();
        }),
        __handlers: handlers,
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
        // The rectangle-select handler always calls unproject twice per drag —
        // once for the SW corner, once for NE. Return a box that trivially
        // encloses everything so tests can assert on selection without
        // reimplementing real screen->lnglat math.
        unproject: vi.fn()
          .mockReturnValueOnce({ lng: -180, lat: -90 })
          .mockReturnValueOnce({ lng: 180, lat: 90 }),
      };
      lastMapInstance = instance;
      return instance;
    }),
    Marker: vi.fn(function (opts: { element: HTMLElement; draggable?: boolean; anchor?: string }) {
      if (opts?.element) markerElements.push(opts.element);
      const handlers: Record<string, (...args: any[]) => void> = {};
      const instance = {
        // Retained so tests can assert on construction options (draggable /
        // anchor) — a serve pin must be constructed non-draggable.
        __options: opts,
        setLngLat: vi.fn().mockReturnThis(),
        addTo: vi.fn().mockReturnThis(),
        remove: vi.fn(),
        on: vi.fn((event: string, cb: (...args: any[]) => void) => { handlers[event] = cb; }),
        __handlers: handlers,
        getLngLat: vi.fn(() => ({ lng: -111.9, lat: 40.7 })),
        setPopup: vi.fn().mockReturnThis(),
        getPopup: vi.fn(() => null),
        getElement: vi.fn(() => opts?.element),
      };
      markerInstances.push(instance);
      return instance;
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
    markerInstances.length = 0;
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

  it('fetches and plots dispatch units only after "Show Units" is toggled on', async () => {
    const MOCK_UNIT = {
      id: 'u1', call_sign: 'A-12', status: 'available' as const, officer_name: 'Officer Test',
      latitude: 40.77, longitude: -111.9, gps_heading: null, gps_accuracy: null,
      vehicle: '', current_call_id: null, call_number: null,
      current_call_type: null, current_call_location: null,
    };
    const apiFetchSpy = vi.spyOn(useApiModule, 'apiFetch').mockImplementation((path: string) => {
      if (path === '/serve-intake/map-items') return Promise.resolve([]);
      if (path === '/serve-intake/location-notes') return Promise.resolve([]);
      if (path === '/dispatch/units') return Promise.resolve([MOCK_UNIT]);
      return Promise.resolve([]);
    });

    render(<ServeIntakeMap />);
    await waitFor(() => expect(screen.getByText(/no active serve orders/i)).toBeInTheDocument());

    // Off by default — no units poll should fire.
    expect(apiFetchSpy).not.toHaveBeenCalledWith('/dispatch/units');

    await act(async () => {
      screen.getByRole('button', { name: /show units/i }).click();
    });

    await waitFor(() => expect(apiFetchSpy).toHaveBeenCalledWith('/dispatch/units'));
    await waitFor(() => expect(lastMapInstance.addSource).not.toThrow);
    // A unit marker is a plain mapboxgl.Marker with a DOM element built by
    // buildUnitMarkerEl — assert one was created for the fetched unit.
    await waitFor(() => expect(
      markerElements.some((el) => el.className === 'rmpg-mbx-unit'),
    ).toBe(true));

    // Toggling back off removes the unit marker(s).
    await act(async () => {
      screen.getByRole('button', { name: /show units/i }).click();
    });
    await waitFor(() => expect(
      markerInstances.filter((m) => m.remove.mock.calls.length > 0).length,
    ).toBeGreaterThan(0));
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

  it('does not call fetchMapboxRoute until both an origin and a job are selected', () => {
    render(<ServeIntakeMap />);
    expect(fetchMapboxRoute).not.toHaveBeenCalled();
  });

  it('draws a drive-time preview route and shows the ETA badge once origin + target are both set', async () => {
    vi.spyOn(useApiModule, 'apiFetch').mockImplementation((path: string) => {
      if (path === '/serve-intake/map-items') return Promise.resolve([MOCK_QUEUE_ITEM]);
      if (path === '/serve-intake/location-notes') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(<ServeIntakeMap />);
    await waitFor(() => expect(markerElements.length).toBeGreaterThan(0));

    // Right-click the map to set the preview origin (simulated position).
    act(() => {
      lastMapInstance.__handlers.contextmenu?.({ lngLat: { lng: -111.9, lat: 40.7 }, originalEvent: { preventDefault: vi.fn() } });
    });
    expect(fetchMapboxRoute).not.toHaveBeenCalled();

    // Open the marker popup and click "Preview drive time" to set the target.
    await act(async () => {
      markerElements[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
    });
    const previewBtn = document.getElementById(`srv-popup-preview-${MOCK_QUEUE_ITEM.id}`);
    expect(previewBtn).toBeTruthy();
    await act(async () => {
      previewBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitFor(() => expect(fetchMapboxRoute).toHaveBeenCalledWith(
      { lng: -111.9, lat: 40.7 },
      { lng: MOCK_QUEUE_ITEM.recipient_lng, lat: MOCK_QUEUE_ITEM.recipient_lat },
    ));
    await waitFor(() => {
      expect(lastMapInstance.addSource).toHaveBeenCalledWith(
        'srv-drive-preview',
        expect.objectContaining({ type: 'geojson' }),
      );
    });
    expect(lastMapInstance.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'srv-drive-preview-layer', source: 'srv-drive-preview' }),
    );
    await waitFor(() => expect(screen.getByText(/ETA 12 min/i)).toBeInTheDocument());
  });

  it('ignores a stale drive-time route response when the target changes before it resolves (cancellation guard)', async () => {
    let resolveFirst: (v: any) => void = () => {};
    const firstPromise = new Promise((resolve) => { resolveFirst = resolve; });
    (fetchMapboxRoute as unknown as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => firstPromise)
      .mockImplementationOnce(() => Promise.resolve({
        eta: '5 min', distance: '1.1 mi', durationSec: 300, distanceMeters: 1770,
        geometry: [{ lat: 40.7, lng: -111.9 }, { lat: 40.71, lng: -111.89 }],
      }));

    const otherItem = { ...MOCK_QUEUE_ITEM, id: 502, recipient_lat: 40.8, recipient_lng: -111.95 };
    vi.spyOn(useApiModule, 'apiFetch').mockImplementation((path: string) => {
      if (path === '/serve-intake/map-items') return Promise.resolve([MOCK_QUEUE_ITEM, otherItem]);
      if (path === '/serve-intake/location-notes') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(<ServeIntakeMap />);
    await waitFor(() => expect(markerElements.length).toBeGreaterThanOrEqual(2));

    act(() => {
      lastMapInstance.__handlers.contextmenu?.({ lngLat: { lng: -111.9, lat: 40.7 }, originalEvent: { preventDefault: vi.fn() } });
    });

    // Select the first target (kicks off the never-yet-resolved first fetch).
    await act(async () => {
      markerElements[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
    });
    document.getElementById(`srv-popup-preview-${MOCK_QUEUE_ITEM.id}`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Before the first fetch resolves, switch to a second target.
    await act(async () => {
      markerElements[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
    });
    await act(async () => {
      document.getElementById(`srv-popup-preview-${otherItem.id}`)!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitFor(() => expect(screen.getByText(/ETA 5 min/i)).toBeInTheDocument());

    // Now resolve the stale first fetch — it must be ignored (cancelled).
    await act(async () => {
      resolveFirst({
        eta: '99 min', distance: '50 mi', durationSec: 5940, distanceMeters: 80000,
        geometry: [{ lat: 40.7, lng: -111.9 }, { lat: 41.0, lng: -112.0 }],
      });
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.queryByText(/ETA 99 min/i)).not.toBeInTheDocument();
    expect(screen.getByText(/ETA 5 min/i)).toBeInTheDocument();
  });

  it('does not throw when the component unmounts while a drive-time preview is active', async () => {
    vi.spyOn(useApiModule, 'apiFetch').mockImplementation((path: string) => {
      if (path === '/serve-intake/map-items') return Promise.resolve([MOCK_QUEUE_ITEM]);
      if (path === '/serve-intake/location-notes') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const { unmount } = render(<ServeIntakeMap />);
    await waitFor(() => expect(markerElements.length).toBeGreaterThan(0));

    act(() => {
      lastMapInstance.__handlers.contextmenu?.({ lngLat: { lng: -111.9, lat: 40.7 }, originalEvent: { preventDefault: vi.fn() } });
    });
    await act(async () => {
      markerElements[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
    });
    await act(async () => {
      document.getElementById(`srv-popup-preview-${MOCK_QUEUE_ITEM.id}`)!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => expect(lastMapInstance.addSource).toHaveBeenCalled());

    // Same unmount-safety hazard as the trail-effect test above: the
    // map-init effect's cleanup can null mapRef.current independently of
    // this effect's own cleanup ordering.
    expect(() => unmount()).not.toThrow();
  });

  // Pins are no longer draggable, so the map surface never reverse-geocodes at
  // all — the assertion now holds unconditionally rather than "until a drag".
  it('never calls reverseGeocode from the map surface', async () => {
    render(<ServeIntakeMap />);
    await waitFor(() => expect(screen.getByText(/no active serve orders/i)).toBeInTheDocument());
    expect(reverseGeocode).not.toHaveBeenCalled();
  });

  it('renders no bulk-action bar when nothing is selected', async () => {
    render(<ServeIntakeMap />);
    await waitFor(() => expect(screen.getByText(/no active serve orders/i)).toBeInTheDocument());
    expect(screen.queryByText(/apply to selected/i)).not.toBeInTheDocument();
  });

  describe('bulk "Archive" action', () => {
    it('sends status "archived" in the PUT body and not the removed "skipped" status', async () => {
      const apiFetchSpy = vi.spyOn(useApiModule, 'apiFetch').mockImplementation((path: string) => {
        if (path === '/serve-intake/map-items') return Promise.resolve([MOCK_QUEUE_ITEM]);
        if (path === '/serve-intake/location-notes') return Promise.resolve([]);
        if (path === '/process-server/bulk-status') return Promise.resolve({ success: true });
        return Promise.resolve([]);
      });
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      render(<ServeIntakeMap />);
      await waitFor(() => expect(markerElements.length).toBeGreaterThan(0));

      // Shift-drag-select the marker's job via a real drag (not a shift-click)
      // so the mousedown/mouseup rectangle-select handlers pick it up.
      const container = document.querySelector('.absolute.inset-0') as HTMLElement;
      const rect = { left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500, x: 0, y: 0, toJSON: () => ({}) };
      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
      await act(async () => {
        container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, shiftKey: true, clientX: 0, clientY: 0 }));
        container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, shiftKey: true, clientX: 500, clientY: 500 }));
      });

      await waitFor(() => expect(screen.getByText(/apply to selected/i)).toBeInTheDocument());

      const archiveBtn = screen.getByText('Archive');
      await act(async () => { archiveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

      await waitFor(() => {
        expect(apiFetchSpy).toHaveBeenCalledWith(
          '/process-server/bulk-status',
          expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({ ids: [MOCK_QUEUE_ITEM.id], status: 'archived' }),
          }),
        );
      });
    });

    it('alerts the user and preserves selection when the bulk-status request fails', async () => {
      vi.spyOn(useApiModule, 'apiFetch').mockImplementation((path: string) => {
        if (path === '/serve-intake/map-items') return Promise.resolve([MOCK_QUEUE_ITEM]);
        if (path === '/serve-intake/location-notes') return Promise.resolve([]);
        if (path === '/process-server/bulk-status') return Promise.reject(new Error('400'));
        return Promise.resolve([]);
      });
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

      render(<ServeIntakeMap />);
      await waitFor(() => expect(markerElements.length).toBeGreaterThan(0));

      const container = document.querySelector('.absolute.inset-0') as HTMLElement;
      const rect = { left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500, x: 0, y: 0, toJSON: () => ({}) };
      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
      await act(async () => {
        container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, shiftKey: true, clientX: 0, clientY: 0 }));
        container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, shiftKey: true, clientX: 500, clientY: 500 }));
      });
      await waitFor(() => expect(screen.getByText(/apply to selected/i)).toBeInTheDocument());

      const archiveBtn = screen.getByText('Archive');
      await act(async () => { archiveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

      await waitFor(() => expect(alertSpy).toHaveBeenCalled());
      // Selection preserved on failure — the bulk-action bar is still shown.
      expect(screen.getByText(/apply to selected/i)).toBeInTheDocument();
    });
  });

  // Replaces the former "drag-to-correct-geocode confirmation" suite. Serve-job
  // pins are now PINNED to their stored coordinate: dragging a data point on the
  // map is no longer a way to relocate a job, so there is no dragend handler and
  // no confirm/PUT round-trip to exercise. Relocating a job is an explicit
  // records edit instead.
  describe('serve-job pins are fixed to their stored coordinate', () => {
    async function renderWithOneMarker() {
      vi.spyOn(useApiModule, 'apiFetch').mockImplementation((path: string) => {
        if (path === '/serve-intake/map-items') return Promise.resolve([MOCK_QUEUE_ITEM]);
        if (path === '/serve-intake/location-notes') return Promise.resolve([]);
        return Promise.resolve([]);
      });
      render(<ServeIntakeMap />);
      await waitFor(() => expect(markerInstances.length).toBeGreaterThan(0));
      return markerInstances[0];
    }

    it('constructs the job marker with draggable disabled', async () => {
      await renderWithOneMarker();
      const opts = markerInstances[0].__options ?? {};
      expect(opts.draggable).toBe(false);
    });

    it('registers no dragend handler, so a pin can never be moved by a map gesture', async () => {
      const marker = await renderWithOneMarker();
      expect(marker.__handlers.dragend).toBeUndefined();
    });

    it('never PUTs a coordinate change from the map surface', async () => {
      const apiFetchSpy = useApiModule.apiFetch as ReturnType<typeof vi.fn>;
      await renderWithOneMarker();
      expect(apiFetchSpy).not.toHaveBeenCalledWith(
        expect.stringContaining(`/process-server/${MOCK_QUEUE_ITEM.id}`),
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  afterEach(() => {
    cleanup();
  });
});
