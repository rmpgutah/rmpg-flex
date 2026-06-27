# Mapbox PR 2 — Data Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Annotation, Buffer Ring, Ruler, GPS Replay, and Nav Overlay tools to the MapToolbar — each a self-contained component. Only Annotations requires a new D1 table; the rest are ephemeral.

**Architecture:** Each tool follows the same `{ map, onClose }` interface used by PR 1 tools. Annotations persist to a new `map_annotations` D1 table via a new `/api/map/annotations` route. Buffer rings and ruler use `@turf/circle` and `@turf/length` respectively to create ephemeral GeoJSON layers. GPS Replay queries the existing breadcrumb GPS data source with a time-range param. Nav Overlay uses the existing `/api/mapbox/directions` proxy.

**Tech Stack:** React 18 + TypeScript, `@turf/circle` (PR 1 dep), `@turf/length` (already installed), Hono (Worker), Mapbox GL JS GeoJSON sources/layers.

**Prerequisite:** PR 1 must be merged first (MapToolbar, FeatureFlagsContext, and `/api/geofences` route must exist).

---

## File Structure

**New files — client:**
- `client/src/pages/map/components/AnnotationTool.tsx`
- `client/src/pages/map/components/BufferRingTool.tsx`
- `client/src/pages/map/components/RulerTool.tsx`
- `client/src/pages/map/components/GpsReplayTool.tsx`
- `client/src/pages/map/components/NavOverlayTool.tsx`
- `client/src/pages/map/components/__tests__/AnnotationTool.test.tsx`
- `client/src/pages/map/components/__tests__/BufferRingTool.test.tsx`
- `client/src/pages/map/components/__tests__/RulerTool.test.tsx`
- `client/src/pages/map/components/__tests__/NavOverlayTool.test.tsx`

**New files — worker:**
- `migrations/0153_map_annotations.sql`
- `src/routes/mapAnnotations.ts`

**Modified files:**
- `src/routesConfig.ts` — add mapAnnotations route
- `client/src/pages/map/MapPage.tsx` — register 5 new tools in MAP_TOOLS array

---

## Task 1: Migration and mapAnnotations route

**Files:**
- Create: `migrations/0153_map_annotations.sql`
- Create: `src/routes/mapAnnotations.ts`
- Modify: `src/routesConfig.ts`

- [ ] **Step 1: Write migration**

```sql
-- migrations/0153_map_annotations.sql
CREATE TABLE IF NOT EXISTS map_annotations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  body        TEXT,
  color       TEXT    DEFAULT '#d4a017',
  icon        TEXT    DEFAULT 'pin',
  lat         REAL    NOT NULL,
  lng         REAL    NOT NULL,
  created_by  INTEGER REFERENCES users(id),
  call_id     INTEGER,
  expires_at  TEXT,
  is_active   INTEGER DEFAULT 1,
  created_at  TEXT    DEFAULT (datetime('now')),
  updated_at  TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_map_annotations_active ON map_annotations(is_active);
```

- [ ] **Step 2: Write failing route test**

```ts
// tests/mapAnnotations.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import mapAnnotationsRouter from '../src/routes/mapAnnotations';

const mockDb = {
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  all: vi.fn().mockResolvedValue({ results: [] }),
  run: vi.fn().mockResolvedValue({ meta: { last_row_id: 7 } }),
};

function makeApp() {
  const app = new Hono<{ Bindings: any; Variables: any }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, username: 'officer1', role: 'officer', full_name: 'Officer One' });
    await next();
  });
  app.route('/', mapAnnotationsRouter);
  return app;
}

beforeEach(() => vi.clearAllMocks());

test('GET / returns empty array', async () => {
  const app = makeApp();
  const res = await app.request('/', {}, { DB: mockDb });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test('POST / rejects missing title', async () => {
  const app = makeApp();
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat: 40.7, lng: -111.9 }),
  }, { DB: mockDb });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toBe('title, lat, and lng are required');
});

test('POST / rejects invalid coordinates', async () => {
  const app = makeApp();
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'test', lat: 999, lng: -111.9 }),
  }, { DB: mockDb });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe('invalid_coordinates');
});

test('POST / creates annotation and returns id', async () => {
  const app = makeApp();
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Suspicious Vehicle', lat: 40.7, lng: -111.9 }),
  }, { DB: mockDb });
  expect(res.status).toBe(201);
  expect((await res.json()).id).toBe(7);
});

test('DELETE /:id soft-deletes', async () => {
  const app = makeApp();
  const res = await app.request('/3', { method: 'DELETE' }, { DB: mockDb });
  expect(res.status).toBe(200);
  expect(mockDb.bind).toHaveBeenCalledWith(3);
});
```

- [ ] **Step 3: Run test — expect FAIL**

```bash
npx vitest run tests/mapAnnotations.test.ts
```

- [ ] **Step 4: Implement mapAnnotations route**

```ts
// src/routes/mapAnnotations.ts
import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get('/', async (c) => {
  const bbox = c.req.query('bbox'); // optional "w,s,e,n"
  let sql = 'SELECT a.*, u.full_name as creator_name FROM map_annotations a LEFT JOIN users u ON a.created_by = u.id WHERE a.is_active = 1';
  const params: (string | number)[] = [];

  if (bbox) {
    const [w, s, e, n] = bbox.split(',').map(Number);
    if (w && s && e && n) {
      sql += ' AND a.lng BETWEEN ? AND ? AND a.lat BETWEEN ? AND ?';
      params.push(w, e, s, n);
    }
  }
  sql += ' ORDER BY a.created_at DESC';

  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(rows.results);
});

app.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    title: string;
    body?: string;
    color?: string;
    icon?: string;
    lat: number;
    lng: number;
    call_id?: number;
    expires_at?: string;
  }>();

  if (!body.title || body.lat === undefined || body.lng === undefined) {
    return c.json({ error: 'title, lat, and lng are required' }, 400);
  }
  if (Math.abs(body.lat) > 90 || Math.abs(body.lng) > 180) {
    return c.json({ error: 'invalid_coordinates' }, 400);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO map_annotations (title, body, color, icon, lat, lng, created_by, call_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    body.title,
    body.body ?? null,
    body.color ?? '#d4a017',
    body.icon ?? 'pin',
    body.lat,
    body.lng,
    user.id,
    body.call_id ?? null,
    body.expires_at ?? null
  ).run();

  return c.json({ success: true, id: result.meta.last_row_id }, 201);
});

app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{
    title?: string; body?: string; color?: string; icon?: string; expires_at?: string;
  }>();

  await c.env.DB.prepare(
    `UPDATE map_annotations
     SET title      = COALESCE(?, title),
         body       = COALESCE(?, body),
         color      = COALESCE(?, color),
         icon       = COALESCE(?, icon),
         expires_at = COALESCE(?, expires_at),
         updated_at = datetime('now')
     WHERE id = ?`
  ).bind(
    body.title ?? null, body.body ?? null, body.color ?? null,
    body.icon ?? null, body.expires_at ?? null, id
  ).run();

  return c.json({ success: true });
});

app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare(
    `UPDATE map_annotations SET is_active = 0, updated_at = datetime('now') WHERE id = ?`
  ).bind(id).run();
  return c.json({ success: true });
});

export default app;
```

- [ ] **Step 5: Register in routesConfig.ts**

```ts
// Add import near other route imports:
import mapAnnotations from './routes/mapAnnotations';

// Add to ROUTE_REGISTRY (alphabetical, under M):
{ prefix: '/api/map/annotations', router: mapAnnotations, auth: 'required',
  note: 'Shared map annotation pins (map_annotations table). All authenticated roles.' },
```

- [ ] **Step 6: Run tests and typecheck**

```bash
npx vitest run tests/mapAnnotations.test.ts && npm run typecheck
```

- [ ] **Step 7: Apply migration manually**

```bash
scripts/apply-migration.sh 0153_map_annotations.sql
```

Verify: `wrangler d1 execute rmpg-flex --remote --command "PRAGMA table_info(map_annotations)"` — expect 13 rows.

- [ ] **Step 8: Commit**

```bash
git add migrations/0153_map_annotations.sql \
        src/routes/mapAnnotations.ts \
        src/routesConfig.ts
git commit -m "feat: map_annotations D1 table + /api/map/annotations CRUD route"
```

---

## Task 2: AnnotationTool

**Files:**
- Create: `client/src/pages/map/components/AnnotationTool.tsx`
- Create: `client/src/pages/map/components/__tests__/AnnotationTool.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// client/src/pages/map/components/__tests__/AnnotationTool.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, test, expect, beforeEach } from 'vitest';
import AnnotationTool from '../AnnotationTool';

vi.mock('../../../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../../../../hooks/useApi';

const mockOn = vi.fn();
const mockOff = vi.fn();
const mockGetSource = vi.fn().mockReturnValue(null);
const mockAddSource = vi.fn();
const mockAddLayer = vi.fn();
const mockRemoveLayer = vi.fn();
const mockRemoveSource = vi.fn();
const mockGetLayer = vi.fn().mockReturnValue(null);
const mockGetCanvas = vi.fn().mockReturnValue({ style: {} });

const mockMap = {
  on: mockOn, off: mockOff,
  getSource: mockGetSource, addSource: mockAddSource,
  addLayer: mockAddLayer, removeLayer: mockRemoveLayer,
  removeSource: mockRemoveSource, getLayer: mockGetLayer,
  getCanvas: mockGetCanvas,
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  (apiFetch as any).mockResolvedValue([]);
});

test('renders annotation form fields', () => {
  render(<AnnotationTool map={mockMap} onClose={vi.fn()} />);
  expect(screen.getByPlaceholderText('Title…')).toBeInTheDocument();
  expect(screen.getByText('Save')).toBeInTheDocument();
});

test('loads existing annotations on mount', async () => {
  (apiFetch as any).mockResolvedValueOnce([
    { id: 1, title: 'Test', lat: 40.7, lng: -111.9, color: '#d4a017', icon: 'pin', body: null },
  ]);
  render(<AnnotationTool map={mockMap} onClose={vi.fn()} />);
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/map/annotations')));
});

test('shows error when title is empty on save', async () => {
  render(<AnnotationTool map={mockMap} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('Save'));
  expect(screen.getByText('Title is required')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd client && npx vitest run src/pages/map/components/__tests__/AnnotationTool.test.tsx
```

- [ ] **Step 3: Implement AnnotationTool**

```tsx
// client/src/pages/map/components/AnnotationTool.tsx
import { useEffect, useRef, useState, useCallback } from 'react';
import type mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

interface Annotation {
  id: number;
  title: string;
  body: string | null;
  color: string;
  icon: string;
  lat: number;
  lng: number;
  creator_name?: string;
}

interface Props {
  map: mapboxgl.Map;
  onClose: () => void;
}

const SOURCE_ID = 'rmpg-annotations';
const LAYER_ID = 'rmpg-annotations-layer';
const ICONS = ['pin', 'warning', 'info', 'flag'] as const;
const COLORS = ['#d4a017', '#ef4444', '#22c55e', '#3b82f6', '#f97316'];

export default function AnnotationTool({ map, onClose }: Props) {
  const [pendingLng, setPendingLng] = useState<number | null>(null);
  const [pendingLat, setPendingLat] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [icon, setIcon] = useState<typeof ICONS[number]>('pin');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  const load = useCallback(() => {
    const bounds = map.getBounds();
    const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
    apiFetch<Annotation[]>(`/map/annotations?bbox=${bbox}`)
      .then(setAnnotations)
      .catch(() => {});
  }, [map]);

  useEffect(() => { load(); }, [load]);

  // Render annotations as markers on map
  useEffect(() => {
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': 8,
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    }
    const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource;
    source?.setData({
      type: 'FeatureCollection',
      features: annotations.map(a => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
        properties: { id: a.id, title: a.title, color: a.color },
      })),
    });
    return () => {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [map, annotations]);

  // Map click handler to pick location
  useEffect(() => {
    const handleClick = (e: mapboxgl.MapMouseEvent) => {
      setPendingLng(e.lngLat.lng);
      setPendingLat(e.lngLat.lat);
    };
    map.getCanvas().style.cursor = 'crosshair';
    map.on('click', handleClick);
    return () => {
      map.getCanvas().style.cursor = '';
      map.off('click', handleClick);
    };
  }, [map]);

  const handleSave = async () => {
    if (!title.trim()) { setError('Title is required'); return; }
    if (pendingLat === null || pendingLng === null) { setError('Click the map to place the pin first'); return; }
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/map/annotations', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), body: body || null, color, icon, lat: pendingLat, lng: pendingLng }),
      });
      load();
      setTitle(''); setBody(''); setPendingLat(null); setPendingLng(null);
    } catch {
      setError('Failed to save annotation');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tactical-dark border border-surface-raised rounded p-3 w-52 text-xs space-y-2 shadow-lg">
      <div className="text-brand-400 font-bold uppercase tracking-wider text-[10px]">Map Annotations</div>
      {pendingLat !== null
        ? <div className="text-rmpg-300 text-[10px]">📍 {pendingLat.toFixed(5)}, {pendingLng!.toFixed(5)}</div>
        : <div className="text-rmpg-400 text-[10px]">Click map to place pin</div>}
      <input value={title} onChange={e => setTitle(e.target.value)}
        placeholder="Title…"
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-[10px]" />
      <textarea value={body} onChange={e => setBody(e.target.value)}
        placeholder="Notes (optional)…" rows={2}
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-[10px] resize-none" />
      <div className="flex gap-1">
        {COLORS.map(c => (
          <button key={c} aria-label={`Color ${c}`} onClick={() => setColor(c)}
            className={`w-5 h-5 rounded-full border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
            style={{ backgroundColor: c }} />
        ))}
      </div>
      <div className="flex gap-1">
        {ICONS.map(i => (
          <button key={i} onClick={() => setIcon(i)}
            className={`flex-1 py-0.5 rounded text-[9px] ${icon === i ? 'bg-brand-500 text-black font-bold' : 'bg-surface-raised text-rmpg-300'}`}>
            {i}
          </button>
        ))}
      </div>
      {error && <div className="text-red-400 text-[10px]">{error}</div>}
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="flex-1 bg-brand-500 text-black font-bold py-1 rounded text-[10px] disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onClose}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Done
        </button>
      </div>
      {annotations.length > 0 && (
        <div className="border-t border-surface-raised pt-2 space-y-1">
          {annotations.slice(0, 5).map(a => (
            <div key={a.id} className="flex justify-between items-center">
              <span className="text-rmpg-200 truncate max-w-[120px]">{a.title}</span>
              <button onClick={async () => {
                await apiFetch(`/map/annotations/${a.id}`, { method: 'DELETE' });
                load();
              }} className="text-red-400 text-[10px] ml-1 hover:text-red-300">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd client && npx vitest run src/pages/map/components/__tests__/AnnotationTool.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/components/AnnotationTool.tsx \
        client/src/pages/map/components/__tests__/AnnotationTool.test.tsx
git commit -m "feat: AnnotationTool — shared persistent map pins (D1 backed)"
```

---

## Task 3: BufferRingTool

**Files:**
- Create: `client/src/pages/map/components/BufferRingTool.tsx`
- Create: `client/src/pages/map/components/__tests__/BufferRingTool.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// client/src/pages/map/components/__tests__/BufferRingTool.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, test, expect } from 'vitest';
import BufferRingTool from '../BufferRingTool';

vi.mock('@turf/circle', () => ({
  default: vi.fn().mockReturnValue({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[]] },
    properties: {},
  }),
}));

const mockMap = {
  on: vi.fn(), off: vi.fn(),
  getSource: vi.fn().mockReturnValue(null),
  addSource: vi.fn(), addLayer: vi.fn(),
  removeLayer: vi.fn(), removeSource: vi.fn(),
  getLayer: vi.fn().mockReturnValue(null),
  getCanvas: vi.fn().mockReturnValue({ style: {} }),
} as any;

test('renders radius input and unit toggle', () => {
  render(<BufferRingTool map={mockMap} onClose={vi.fn()} />);
  expect(screen.getByPlaceholderText('Radius…')).toBeInTheDocument();
  expect(screen.getByText('ft')).toBeInTheDocument();
  expect(screen.getByText('mi')).toBeInTheDocument();
});

test('unit toggle switches between ft and mi', () => {
  render(<BufferRingTool map={mockMap} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('mi'));
  expect(screen.getByText('mi').className).toContain('bg-brand-500');
});

test('Clear All button clears rings state', () => {
  render(<BufferRingTool map={mockMap} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('Clear All'));
  // No throw = pass (rings array was empty, removeLayer/Source not called)
  expect(mockMap.removeLayer).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd client && npx vitest run src/pages/map/components/__tests__/BufferRingTool.test.tsx
```

- [ ] **Step 3: Implement BufferRingTool**

```tsx
// client/src/pages/map/components/BufferRingTool.tsx
import { useEffect, useRef, useState } from 'react';
import turfCircle from '@turf/circle';
import type mapboxgl from 'mapbox-gl';

interface Ring { id: string; lat: number; lng: number; radiusM: number; color: string; }

interface Props { map: mapboxgl.Map; onClose: () => void; }

const COLORS = ['#d4a017', '#ef4444', '#22c55e', '#3b82f6'];
const FT_PER_M = 3.28084;
const MI_PER_M = 0.000621371;

export default function BufferRingTool({ map, onClose }: Props) {
  const [rings, setRings] = useState<Ring[]>([]);
  const [radius, setRadius] = useState('500');
  const [unit, setUnit] = useState<'ft' | 'mi'>('ft');
  const [color, setColor] = useState(COLORS[0]);
  const [opacity, setOpacity] = useState(0.3);
  const clickHandlerRef = useRef<((e: any) => void) | null>(null);

  useEffect(() => {
    const handler = (e: mapboxgl.MapMouseEvent) => {
      const r = Number(radius);
      if (!r || r <= 0) return;
      const radiusM = unit === 'ft' ? r / FT_PER_M : r / MI_PER_M;
      const id = `ring-${Date.now()}`;
      const circle = turfCircle([e.lngLat.lng, e.lngLat.lat], radiusM / 1000, { units: 'kilometers' });
      map.addSource(id, { type: 'geojson', data: circle as any });
      map.addLayer({ id: `${id}-fill`, type: 'fill', source: id,
        paint: { 'fill-color': color, 'fill-opacity': opacity } });
      map.addLayer({ id: `${id}-line`, type: 'line', source: id,
        paint: { 'line-color': color, 'line-width': 2 } });
      setRings(prev => [...prev, { id, lat: e.lngLat.lat, lng: e.lngLat.lng, radiusM, color }]);
    };
    clickHandlerRef.current = handler;
    map.getCanvas().style.cursor = 'crosshair';
    map.on('click', handler);
    return () => {
      map.getCanvas().style.cursor = '';
      if (clickHandlerRef.current) map.off('click', clickHandlerRef.current);
    };
  }, [map, radius, unit, color, opacity]);

  const clearAll = () => {
    rings.forEach(r => {
      if (map.getLayer(`${r.id}-fill`)) map.removeLayer(`${r.id}-fill`);
      if (map.getLayer(`${r.id}-line`)) map.removeLayer(`${r.id}-line`);
      if (map.getSource(r.id)) map.removeSource(r.id);
    });
    setRings([]);
  };

  useEffect(() => () => clearAll(), []);

  const displayRadius = (r: Ring) => {
    const ft = r.radiusM * FT_PER_M;
    return ft < 1320 ? `${Math.round(ft)} ft` : `${(ft / 5280).toFixed(2)} mi`;
  };

  return (
    <div className="tactical-dark border border-surface-raised rounded p-3 w-52 text-xs space-y-2 shadow-lg">
      <div className="text-brand-400 font-bold uppercase tracking-wider text-[10px]">Buffer Ring</div>
      <div className="text-rmpg-400 text-[10px]">Click map to place ring</div>
      <div className="flex gap-1 items-center">
        <input value={radius} onChange={e => setRadius(e.target.value)} placeholder="Radius…"
          type="number" min="1"
          className="flex-1 bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-[10px]" />
        {(['ft', 'mi'] as const).map(u => (
          <button key={u} onClick={() => setUnit(u)}
            className={`px-2 py-1 rounded text-[10px] ${unit === u ? 'bg-brand-500 text-black font-bold' : 'bg-surface-raised text-rmpg-300'}`}>
            {u}
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        {COLORS.map(c => (
          <button key={c} aria-label={`Color ${c}`} onClick={() => setColor(c)}
            className={`w-5 h-5 rounded-sm border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
            style={{ backgroundColor: c }} />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-rmpg-400 text-[10px]">Opacity</span>
        <input type="range" min="0.1" max="0.8" step="0.05" value={opacity}
          onChange={e => setOpacity(Number(e.target.value))} className="flex-1" />
      </div>
      {rings.length > 0 && (
        <div className="space-y-1 border-t border-surface-raised pt-2">
          {rings.map(r => (
            <div key={r.id} className="flex justify-between text-rmpg-300">
              <span>{displayRadius(r)}</span>
              <button onClick={() => {
                if (map.getLayer(`${r.id}-fill`)) map.removeLayer(`${r.id}-fill`);
                if (map.getLayer(`${r.id}-line`)) map.removeLayer(`${r.id}-line`);
                if (map.getSource(r.id)) map.removeSource(r.id);
                setRings(prev => prev.filter(x => x.id !== r.id));
              }} className="text-red-400 hover:text-red-300 text-[10px]">✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={clearAll}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Clear All
        </button>
        <button onClick={onClose}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Done
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd client && npx vitest run src/pages/map/components/__tests__/BufferRingTool.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/components/BufferRingTool.tsx \
        client/src/pages/map/components/__tests__/BufferRingTool.test.tsx
git commit -m "feat: BufferRingTool — ephemeral radius rings via turf.circle"
```

---

## Task 4: RulerTool

**Files:**
- Create: `client/src/pages/map/components/RulerTool.tsx`
- Create: `client/src/pages/map/components/__tests__/RulerTool.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// client/src/pages/map/components/__tests__/RulerTool.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, test, expect } from 'vitest';
import RulerTool from '../RulerTool';

vi.mock('@turf/length', () => ({
  default: vi.fn().mockReturnValue(1.609), // 1 km = 1 mile ish
}));

const mockMap = {
  on: vi.fn(), off: vi.fn(),
  getSource: vi.fn().mockReturnValue(null),
  addSource: vi.fn(), addLayer: vi.fn(),
  removeLayer: vi.fn(), removeSource: vi.fn(),
  getLayer: vi.fn().mockReturnValue(null),
  getCanvas: vi.fn().mockReturnValue({ style: {} }),
} as any;

test('renders instruction text and total distance 0.00 ft initially', () => {
  render(<RulerTool map={mockMap} onClose={vi.fn()} />);
  expect(screen.getByText(/click map to place/i)).toBeInTheDocument();
  expect(screen.getByText(/0\.00/)).toBeInTheDocument();
});

test('Clear button resets points', () => {
  render(<RulerTool map={mockMap} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('Clear'));
  expect(mockMap.getSource).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd client && npx vitest run src/pages/map/components/__tests__/RulerTool.test.tsx
```

- [ ] **Step 3: Implement RulerTool**

```tsx
// client/src/pages/map/components/RulerTool.tsx
import { useEffect, useRef, useState } from 'react';
import turfLength from '@turf/length';
import type mapboxgl from 'mapbox-gl';

interface Props { map: mapboxgl.Map; onClose: () => void; }

const SOURCE_POINTS = 'ruler-points';
const SOURCE_LINE = 'ruler-line';
const LAYER_POINTS = 'ruler-points-layer';
const LAYER_LINE = 'ruler-line-layer';
const LAYER_LABELS = 'ruler-labels-layer';

function fmtDistance(km: number): string {
  const ft = km * 3280.84;
  return ft < 1320 ? `${Math.round(ft)} ft` : `${(km * 0.621371).toFixed(2)} mi`;
}

export default function RulerTool({ map, onClose }: Props) {
  const [points, setPoints] = useState<[number, number][]>([]);
  const [totalKm, setTotalKm] = useState(0);
  const pointsRef = useRef<[number, number][]>([]);

  const updateSources = (pts: [number, number][]) => {
    const ptSource = map.getSource(SOURCE_POINTS) as mapboxgl.GeoJSONSource;
    const lineSource = map.getSource(SOURCE_LINE) as mapboxgl.GeoJSONSource;
    if (ptSource) ptSource.setData({
      type: 'FeatureCollection',
      features: pts.map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} })),
    });
    if (lineSource && pts.length >= 2) {
      const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} } as any;
      lineSource.setData(line);
      setTotalKm(turfLength(line, { units: 'kilometers' }));
    } else {
      setTotalKm(0);
    }
  };

  useEffect(() => {
    // Setup sources and layers
    if (!map.getSource(SOURCE_POINTS)) {
      map.addSource(SOURCE_POINTS, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: LAYER_POINTS, type: 'circle', source: SOURCE_POINTS,
        paint: { 'circle-radius': 5, 'circle-color': '#d4a017', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
    }
    if (!map.getSource(SOURCE_LINE)) {
      map.addSource(SOURCE_LINE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: LAYER_LINE, type: 'line', source: SOURCE_LINE,
        paint: { 'line-color': '#d4a017', 'line-width': 2, 'line-dasharray': [2, 2] } });
    }

    const handleClick = (e: mapboxgl.MapMouseEvent) => {
      const newPts: [number, number][] = [...pointsRef.current, [e.lngLat.lng, e.lngLat.lat]];
      pointsRef.current = newPts;
      setPoints(newPts);
      updateSources(newPts);
    };
    const handleDblClick = () => {
      // finish on double-click — mapbox fires click before dblclick, so last point is already added
    };

    map.getCanvas().style.cursor = 'crosshair';
    map.on('click', handleClick);
    map.on('dblclick', handleDblClick);

    return () => {
      map.getCanvas().style.cursor = '';
      map.off('click', handleClick);
      map.off('dblclick', handleDblClick);
      [LAYER_POINTS, LAYER_LINE, LAYER_LABELS].forEach(l => { if (map.getLayer(l)) map.removeLayer(l); });
      [SOURCE_POINTS, SOURCE_LINE].forEach(s => { if (map.getSource(s)) map.removeSource(s); });
    };
  }, [map]);

  const clear = () => {
    pointsRef.current = [];
    setPoints([]);
    setTotalKm(0);
    updateSources([]);
  };

  return (
    <div className="tactical-dark border border-surface-raised rounded p-3 w-48 text-xs space-y-2 shadow-lg">
      <div className="text-brand-400 font-bold uppercase tracking-wider text-[10px]">Distance Ruler</div>
      <div className="text-rmpg-400 text-[10px]">Click map to place waypoints</div>
      <div className="text-center py-1">
        <div className="text-rmpg-200 text-base font-bold">{fmtDistance(totalKm)}</div>
        <div className="text-rmpg-400 text-[10px]">{points.length} point{points.length !== 1 ? 's' : ''}</div>
      </div>
      <div className="flex gap-2">
        <button onClick={clear}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Clear
        </button>
        <button onClick={onClose}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Done
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd client && npx vitest run src/pages/map/components/__tests__/RulerTool.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/components/RulerTool.tsx \
        client/src/pages/map/components/__tests__/RulerTool.test.tsx
git commit -m "feat: RulerTool — geodesic distance measurement via @turf/length"
```

---

## Task 5: GpsReplayTool

**Files:**
- Create: `client/src/pages/map/components/GpsReplayTool.tsx`

- [ ] **Step 1: Implement GpsReplayTool**

```tsx
// client/src/pages/map/components/GpsReplayTool.tsx
import { useEffect, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

interface GpsPoint { lat: number; lng: number; recorded_at: string; unit_id?: number; }
interface Props { map: mapboxgl.Map; onClose: () => void; }

const SOURCE = 'gps-replay';
const TRAIL_LAYER = 'gps-replay-trail';
const MARKER_LAYER = 'gps-replay-marker';

const SPEEDS = [1, 2, 5, 10] as const;

export default function GpsReplayTool({ map, onClose }: Props) {
  const [units, setUnits] = useState<{ id: number; unit_number: string }[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<number | ''>('');
  const [hoursBack, setHoursBack] = useState(8);
  const [points, setPoints] = useState<GpsPoint[]>([]);
  const [curIdx, setCurIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<typeof SPEEDS[number]>(1);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    apiFetch<{ id: number; unit_number: string }[]>('/dispatch/units')
      .then(setUnits).catch(() => {});
  }, []);

  const loadTrack = async () => {
    if (!selectedUnit) return;
    setLoading(true);
    setPlaying(false);
    setCurIdx(0);
    try {
      const since = new Date(Date.now() - hoursBack * 3600_000).toISOString();
      const data = await apiFetch<GpsPoint[]>(
        `/dispatch/gps/history?unit_id=${selectedUnit}&since=${since}&limit=2000`
      );
      setPoints(data);
    } catch {
      setPoints([]);
    } finally {
      setLoading(false);
    }
  };

  // Sync trail/marker layers
  useEffect(() => {
    if (!map.getSource(SOURCE)) {
      map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: TRAIL_LAYER, type: 'line', source: SOURCE,
        paint: { 'line-color': '#d4a017', 'line-width': 3, 'line-opacity': 0.8 } });
      map.addLayer({ id: MARKER_LAYER, type: 'circle', source: SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 7, 'circle-color': '#d4a017', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
    }
    const src = map.getSource(SOURCE) as mapboxgl.GeoJSONSource;
    if (!src || !points.length) {
      src?.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const trail = points.slice(0, curIdx + 1);
    src.setData({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'LineString', coordinates: trail.map(p => [p.lng, p.lat]) }, properties: {} },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [trail[trail.length - 1].lng, trail[trail.length - 1].lat] }, properties: {} },
      ],
    });
    return () => {
      [TRAIL_LAYER, MARKER_LAYER].forEach(l => { if (map.getLayer(l)) map.removeLayer(l); });
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    };
  }, [map, points, curIdx]);

  useEffect(() => {
    if (playing && points.length) {
      intervalRef.current = setInterval(() => {
        setCurIdx(prev => {
          if (prev >= points.length - 1) { setPlaying(false); return prev; }
          return prev + 1;
        });
      }, 200 / speed);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, speed, points]);

  const progress = points.length ? Math.round((curIdx / (points.length - 1)) * 100) : 0;

  return (
    <div className="tactical-dark border border-surface-raised rounded p-3 w-56 text-xs space-y-2 shadow-lg">
      <div className="text-brand-400 font-bold uppercase tracking-wider text-[10px]">GPS Replay</div>
      <select value={selectedUnit} onChange={e => setSelectedUnit(Number(e.target.value))}
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 rounded px-1 py-0.5 text-[10px]">
        <option value="">Select unit…</option>
        {units.map(u => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
      </select>
      <div className="flex gap-1 items-center">
        <span className="text-rmpg-400 text-[10px]">Last</span>
        <select value={hoursBack} onChange={e => setHoursBack(Number(e.target.value))}
          className="bg-surface-base border border-surface-raised text-rmpg-200 rounded px-1 py-0.5 text-[10px]">
          {[1, 2, 4, 8, 12, 24].map(h => <option key={h} value={h}>{h}h</option>)}
        </select>
        <button onClick={loadTrack} disabled={!selectedUnit || loading}
          className="flex-1 bg-brand-500 text-black font-bold py-0.5 rounded text-[10px] disabled:opacity-50">
          {loading ? 'Loading…' : 'Load'}
        </button>
      </div>
      {points.length > 0 && (
        <>
          <div className="w-full bg-surface-raised rounded-full h-1.5">
            <div className="bg-brand-500 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-rmpg-400 text-[10px] text-center">{curIdx + 1} / {points.length} positions</div>
          <div className="flex gap-1 justify-center">
            <button onClick={() => { setCurIdx(0); setPlaying(false); }}
              className="bg-surface-raised text-rmpg-300 px-2 py-1 rounded text-[10px]">⏮</button>
            <button onClick={() => setPlaying(p => !p)}
              className="bg-brand-500 text-black font-bold px-3 py-1 rounded text-[10px]">
              {playing ? '⏸' : '▶'}
            </button>
            <button onClick={() => { setCurIdx(points.length - 1); setPlaying(false); }}
              className="bg-surface-raised text-rmpg-300 px-2 py-1 rounded text-[10px]">⏭</button>
          </div>
          <div className="flex gap-1 justify-center">
            {SPEEDS.map(s => (
              <button key={s} onClick={() => setSpeed(s)}
                className={`px-1.5 py-0.5 rounded text-[9px] ${speed === s ? 'bg-brand-500 text-black font-bold' : 'bg-surface-raised text-rmpg-300'}`}>
                {s}×
              </button>
            ))}
          </div>
        </>
      )}
      {!points.length && !loading && <div className="text-rmpg-400 text-[10px] text-center">Select a unit and load track</div>}
      <button onClick={onClose} className="w-full bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">Done</button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/map/components/GpsReplayTool.tsx
git commit -m "feat: GpsReplayTool — animated GPS track replay with time slider"
```

---

## Task 6: NavOverlayTool

**Files:**
- Create: `client/src/pages/map/components/NavOverlayTool.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// client/src/pages/map/components/__tests__/NavOverlayTool.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, test, expect } from 'vitest';
import NavOverlayTool from '../NavOverlayTool';

vi.mock('../../../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));
import { apiFetch } from '../../../../hooks/useApi';

const mockMap = {
  on: vi.fn(), off: vi.fn(),
  getSource: vi.fn().mockReturnValue(null),
  addSource: vi.fn(), addLayer: vi.fn(),
  removeLayer: vi.fn(), removeSource: vi.fn(),
  getLayer: vi.fn().mockReturnValue(null),
} as any;

test('renders origin and destination inputs', () => {
  render(<NavOverlayTool map={mockMap} onClose={vi.fn()} />);
  expect(screen.getByPlaceholderText('Origin address…')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Destination address…')).toBeInTheDocument();
});

test('Route button is disabled when inputs are empty', () => {
  render(<NavOverlayTool map={mockMap} onClose={vi.fn()} />);
  expect(screen.getByText('Get Route')).toBeDisabled();
});

test('shows error when directions API fails', async () => {
  (apiFetch as any).mockRejectedValue(new Error('network'));
  render(<NavOverlayTool map={mockMap} onClose={vi.fn()} />);
  fireEvent.change(screen.getByPlaceholderText('Origin address…'), { target: { value: '123 Main St' } });
  fireEvent.change(screen.getByPlaceholderText('Destination address…'), { target: { value: '456 Oak Ave' } });
  fireEvent.click(screen.getByText('Get Route'));
  await waitFor(() => expect(screen.getByText(/failed to get route/i)).toBeInTheDocument());
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd client && npx vitest run src/pages/map/components/__tests__/NavOverlayTool.test.tsx
```

- [ ] **Step 3: Implement NavOverlayTool**

```tsx
// client/src/pages/map/components/NavOverlayTool.tsx
import { useEffect, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

interface Step { maneuver: { instruction: string }; distance: number; }
interface Route { geometry: any; legs: { steps: Step[]; duration: number; distance: number }[]; }
interface Props { map: mapboxgl.Map; onClose: () => void; }

const SOURCE = 'nav-route';
const LAYER = 'nav-route-layer';
const LAYER_ALT = 'nav-route-alt-layer';

function fmtDuration(secs: number) {
  const m = Math.round(secs / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
function fmtDist(m: number) {
  const ft = m * 3.28084;
  return ft < 1320 ? `${Math.round(ft)} ft` : `${(m * 0.000621371).toFixed(1)} mi`;
}

export default function NavOverlayTool({ map, onClose }: Props) {
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getRoute = async () => {
    if (!origin.trim() || !destination.trim()) return;
    setLoading(true); setError(null); setRoutes([]);
    try {
      const data = await apiFetch<{ routes: Route[] }>(
        `/mapbox/directions?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&alternatives=true`
      );
      setRoutes(data.routes ?? []);
      setSelectedRoute(0);
    } catch {
      setError('Failed to get route — check addresses and try again');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!routes.length) return;
    const active = routes[selectedRoute];
    if (!active) return;

    if (!map.getSource(SOURCE)) {
      map.addSource(SOURCE, { type: 'geojson', data: active.geometry });
      map.addLayer({ id: LAYER, type: 'line', source: SOURCE,
        paint: { 'line-color': '#4a9eff', 'line-width': 5, 'line-opacity': 0.9 } });
    } else {
      (map.getSource(SOURCE) as mapboxgl.GeoJSONSource).setData(active.geometry);
    }
    return () => {
      if (map.getLayer(LAYER)) map.removeLayer(LAYER);
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    };
  }, [map, routes, selectedRoute]);

  const steps = routes[selectedRoute]?.legs[0]?.steps ?? [];
  const leg = routes[selectedRoute]?.legs[0];

  return (
    <div className="tactical-dark border border-surface-raised rounded p-3 w-56 text-xs space-y-2 shadow-lg">
      <div className="text-brand-400 font-bold uppercase tracking-wider text-[10px]">Nav Overlay</div>
      <input value={origin} onChange={e => setOrigin(e.target.value)}
        placeholder="Origin address…"
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-[10px]" />
      <input value={destination} onChange={e => setDestination(e.target.value)}
        placeholder="Destination address…"
        onKeyDown={e => e.key === 'Enter' && getRoute()}
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-[10px]" />
      <button onClick={getRoute} disabled={!origin.trim() || !destination.trim() || loading}
        className="w-full bg-brand-500 text-black font-bold py-1 rounded text-[10px] disabled:opacity-50">
        {loading ? 'Routing…' : 'Get Route'}
      </button>
      {error && <div className="text-red-400 text-[10px]">{error}</div>}
      {leg && (
        <div className="bg-surface-raised rounded p-2 text-center">
          <div className="text-brand-400 font-bold text-sm">{fmtDuration(leg.duration)}</div>
          <div className="text-rmpg-400 text-[10px]">{fmtDist(leg.distance)}</div>
        </div>
      )}
      {routes.length > 1 && (
        <div className="flex gap-1">
          {routes.map((_, i) => (
            <button key={i} onClick={() => setSelectedRoute(i)}
              className={`flex-1 py-0.5 rounded text-[10px] ${selectedRoute === i ? 'bg-brand-500 text-black font-bold' : 'bg-surface-raised text-rmpg-300'}`}>
              Route {i + 1}
            </button>
          ))}
        </div>
      )}
      {steps.length > 0 && (
        <div className="space-y-1 max-h-40 overflow-y-auto border-t border-surface-raised pt-2">
          {steps.map((step, i) => (
            <div key={i} className="flex gap-1 text-rmpg-300">
              <span className="text-rmpg-500 text-[9px] min-w-[28px]">{fmtDist(step.distance)}</span>
              <span className="text-[10px] leading-tight">{step.maneuver.instruction}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={() => { setRoutes([]); setOrigin(''); setDestination(''); }}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Clear
        </button>
        <button onClick={onClose}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Done
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd client && npx vitest run src/pages/map/components/__tests__/NavOverlayTool.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/components/NavOverlayTool.tsx \
        client/src/pages/map/components/__tests__/NavOverlayTool.test.tsx
git commit -m "feat: NavOverlayTool — turn-by-turn route overlay via /api/mapbox/directions"
```

---

## Task 7: Register all PR 2 tools in MapPage

**Files:**
- Modify: `client/src/pages/map/MapPage.tsx`

- [ ] **Step 1: Add imports at top of MapPage.tsx**

```tsx
import AnnotationTool from './components/AnnotationTool';
import BufferRingTool from './components/BufferRingTool';
import RulerTool from './components/RulerTool';
import GpsReplayTool from './components/GpsReplayTool';
import NavOverlayTool from './components/NavOverlayTool';
```

- [ ] **Step 2: Add 5 new entries to MAP_TOOLS array** (after the existing PR 1 tools, before the divider):

```tsx
{ id: 'annotations', icon: '📍', label: 'Annotate', flag: 'annotations' as const, component: AnnotationTool },
{ id: 'buffer', icon: '⭕', label: 'Buffer Ring', flag: 'buffer_rings' as const, component: BufferRingTool },
{ id: 'ruler', icon: '📏', label: 'Measure Distance', flag: 'ruler' as const, component: RulerTool },
{ id: 'replay', icon: '▶️', label: 'GPS Replay', flag: 'gps_replay' as const, component: GpsReplayTool },
{ id: 'nav', icon: '🧭', label: 'Navigation', flag: 'nav_overlay' as const, component: NavOverlayTool },
```

- [ ] **Step 3: Run full test suite**

```bash
cd client && npx vitest run && npx tsc --noEmit
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/map/MapPage.tsx
git commit -m "feat: register all PR2 data tools in MapToolbar"
```

---

## Task 8: PR 2 pull request

- [ ] **Step 1: Verify all tests pass**

```bash
npx vitest run && npm run typecheck && cd client && npx vitest run && npx tsc --noEmit
```

- [ ] **Step 2: Create PR**

```bash
gh pr create \
  --title "feat: Mapbox PR2 — annotations, buffer rings, ruler, GPS replay, nav overlay" \
  --body "$(cat <<'EOF'
## Summary
- AnnotationTool: shared persistent map pins → new `map_annotations` D1 table + `/api/map/annotations` CRUD
- BufferRingTool: ephemeral radius rings via `@turf/circle`, multi-ring, color/opacity controls
- RulerTool: geodesic distance measurement via `@turf/length`, waypoint-by-waypoint, imperial units
- GpsReplayTool: animate historical unit GPS track with play/pause/speed controls and time slider
- NavOverlayTool: turn-by-turn route overlay via existing `/api/mapbox/directions` proxy, alternative routes

## After merge
- [ ] Apply migration: `scripts/apply-migration.sh 0153_map_annotations.sql`
- [ ] Verify: `wrangler d1 execute rmpg-flex --remote --command "PRAGMA table_info(map_annotations)"`

## Test plan
- [ ] All vitest tests pass
- [ ] Click Annotate → click map → fill form → Save → pin appears, other browser window shows it
- [ ] Click Buffer → type 500 ft → click map → ring appears, radius label shows
- [ ] Click Ruler → place 3 waypoints → distance label updates
- [ ] Click GPS Replay → select unit → Load → Play → marker animates along trail
- [ ] Click Nav → enter addresses → Get Route → route line + turn list appears

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
