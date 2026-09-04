import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildServeJobMarkerEl, buildServeClusterEl, serveJobPopupHTML, addServeJobLayer, removeServeJobLayer, SERVE_PRIORITY_COLOR } from '../serveMapUtils';
import type { ServeMapEntry } from '../serveMapUtils';

// Minimal jsdom environment is provided by Vitest's default config.

const baseJob: ServeMapEntry = {
  id: 1, status: 'pending', priority: 'normal',
  recipient_name: 'John Smith', recipient_address: '123 Main St',
  recipient_lat: 40.76, recipient_lng: -111.89,
  case_number: 'CV-2026-001', client_name: 'RMPG', document_type: 'summons',
  deadline: null, location_note_id: null,
};

describe('SERVE_PRIORITY_COLOR', () => {
  it('has entries for all priority levels', () => {
    expect(SERVE_PRIORITY_COLOR.urgent).toBe('#ef4444');
    expect(SERVE_PRIORITY_COLOR.rush).toBe('#f97316');
    expect(SERVE_PRIORITY_COLOR.normal).toBe('#3b82f6');
    expect(SERVE_PRIORITY_COLOR.routine).toBe('#6b7280');
  });
});

describe('buildServeJobMarkerEl', () => {
  it('returns an HTMLElement with priority background color', () => {
    const el = buildServeJobMarkerEl({ ...baseJob, priority: 'urgent' });
    // jsdom normalizes hex to rgb() — check either form
    expect(el.style.background).toMatch(/ef4444|rgb\(239,\s*68,\s*68\)/);
  });

  it('adds location note dot when location_note_id is set', () => {
    const el = buildServeJobMarkerEl({ ...baseJob, location_note_id: 42 });
    expect(el.querySelectorAll('div').length).toBeGreaterThan(0);
  });

  it('does not add urgency ring for deadline > 72h away', () => {
    const future = new Date(Date.now() + 96 * 3_600_000).toISOString();
    const el = buildServeJobMarkerEl({ ...baseJob, deadline: future });
    // No animated child divs for far-future deadlines.
    const rings = [...el.querySelectorAll('div')].filter(d => d.style.animation?.includes('ping'));
    expect(rings).toHaveLength(0);
  });

  it('adds amber urgency ring for deadline < 72h away', () => {
    const soon = new Date(Date.now() + 24 * 3_600_000).toISOString();
    const el = buildServeJobMarkerEl({ ...baseJob, deadline: soon });
    // jsdom doesn't parse 'border' shorthand in cssText into borderColor;
    // check cssText directly which contains the raw value.
    const rings = [...el.querySelectorAll('div')].filter(d =>
      /f59e0b|rgb\(245,\s*158,\s*11\)/.test(d.style.cssText)
    );
    expect(rings.length).toBeGreaterThan(0);
  });

  it('applies green border when selected=true', () => {
    const el = buildServeJobMarkerEl(baseJob, { selected: true });
    // jsdom normalizes hex to rgb() — match either form
    expect(el.style.border).toContain('solid');
    expect(el.style.border).toMatch(/22c55e|rgb\(34,\s*197,\s*94\)/);
  });
});

describe('buildServeClusterEl', () => {
  it('shows count and uses priority color', () => {
    const el = buildServeClusterEl(5, 'rush');
    expect(el.textContent).toBe('5');
    // jsdom normalizes hex to rgb() — check either form
    expect(el.style.background).toMatch(/f97316|rgb\(249,\s*115,\s*22\)/);
  });

  it('caps display at 99+', () => {
    const el = buildServeClusterEl(150, 'routine');
    expect(el.textContent).toBe('99+');
  });
});

describe('serveJobPopupHTML', () => {
  it('contains recipient name', () => {
    expect(serveJobPopupHTML(baseJob)).toContain('John Smith');
  });

  it('escapes HTML in recipient name', () => {
    const html = serveJobPopupHTML({ ...baseJob, recipient_name: '<script>xss</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('includes Add to Route button when showAddToRoute=true', () => {
    expect(serveJobPopupHTML(baseJob, { showAddToRoute: true })).toContain('ADD TO ROUTE');
  });

  it('omits Add to Route button by default', () => {
    expect(serveJobPopupHTML(baseJob)).not.toContain('ADD TO ROUTE');
  });

  it('marks overdue deadlines in red', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const html = serveJobPopupHTML({ ...baseJob, deadline: past });
    expect(html).toContain('color:#ef4444');
  });
});

describe('addServeJobLayer / removeServeJobLayer', () => {
  const makeMockMap = () => {
    const sources: Record<string, boolean> = {};
    const layers: Record<string, boolean> = {};
    return {
      // mapboxSafeLayer's hasLayer/hasSource guard on map.style being truthy
      style: {},
      addSource: vi.fn((id: string) => { sources[id] = true; }),
      addLayer: vi.fn((spec: { id: string }) => { layers[spec.id] = true; }),
      removeSource: vi.fn((id: string) => { delete sources[id]; }),
      removeLayer: vi.fn((id: string) => { delete layers[id]; }),
      getSource: (id: string) => sources[id] ? {} : undefined,
      getLayer: (id: string) => layers[id] ? {} : undefined,
      _sources: sources,
      _layers: layers,
    };
  };

  it('addServeJobLayer adds source and two layers', () => {
    const map = makeMockMap();
    addServeJobLayer(map as any, [baseJob], 'test-source');
    expect(map.addSource).toHaveBeenCalledWith('test-source', expect.any(Object));
    expect(map.addLayer).toHaveBeenCalledTimes(2);
  });

  it('addServeJobLayer is idempotent (removes before adding)', () => {
    const map = makeMockMap();
    addServeJobLayer(map as any, [baseJob], 'test-source');
    addServeJobLayer(map as any, [baseJob], 'test-source');
    // removeLayer called at least once on second call
    expect(map.removeLayer.mock.calls.length).toBeGreaterThan(0);
    expect(map.addLayer).toHaveBeenCalledTimes(4); // 2 per call
  });

  it('removeServeJobLayer no-ops when layers absent', () => {
    const map = makeMockMap();
    expect(() => removeServeJobLayer(map as any, 'nonexistent')).not.toThrow();
  });
});
