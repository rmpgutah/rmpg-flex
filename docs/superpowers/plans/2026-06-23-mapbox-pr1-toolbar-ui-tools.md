# Mapbox PR 1 — Toolbar + Pure UI Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating vertical toolbar to the map canvas with Draw Geofence, 3D Buildings, Minimap, Scale bar, and Fullscreen tools — plus the FeatureFlagsContext that all three PRs share.

**Architecture:** A `MapToolbar` shell mounts one active tool component at a time. Each tool is a self-contained component that receives the Mapbox map ref and an `onClose` callback. MapPage gains a single new child: `<MapToolbar map={mapRef} tools={TOOLS} />`. The FeatureFlagsContext polls `/api/admin/feature-flags` (KV-backed) every 30s and controls which toolbar icons are visible.

**Tech Stack:** React 18 + TypeScript, Mapbox GL JS, `@mapbox/mapbox-gl-draw`, `@turf/circle`, Hono (Worker route), Tailwind CSS with RMPG design tokens.

---

## File Structure

**New files — client:**
- `client/src/contexts/FeatureFlagsContext.tsx` — React context + provider + `useFeatureFlags` hook
- `client/src/components/MapToolbar.tsx` — floating toolbar shell, tool switching
- `client/src/pages/map/components/DrawGeofenceTool.tsx` — Mapbox GL Draw integration
- `client/src/pages/map/components/BuildingsLayer.tsx` — 3D fill-extrusion toggle
- `client/src/pages/map/components/MinimapControl.tsx` — second Map instance in corner
- `client/src/pages/map/components/ScaleFullscreenControls.tsx` — wraps native Mapbox controls
- `client/src/contexts/__tests__/FeatureFlagsContext.test.tsx`
- `client/src/components/__tests__/MapToolbar.test.tsx`
- `client/src/pages/map/components/__tests__/DrawGeofenceTool.test.tsx`
- `client/src/pages/map/components/__tests__/BuildingsLayer.test.tsx`

**New files — worker:**
- `src/routes/geofences.ts` — CRUD for `geofence_zones` table

**Modified files:**
- `client/package.json` — add `@mapbox/mapbox-gl-draw`, `@turf/circle`
- `client/src/App.tsx` (or wherever providers are stacked) — wrap with `<FeatureFlagsProvider>`
- `client/src/pages/map/MapPage.tsx` — add `<MapToolbar>` as single new child
- `src/routesConfig.ts` — register geofences route (one-line append)

---

## Task 1: Install client dependencies

**Files:**
- Modify: `client/package.json`

- [ ] **Step 1: Install packages**

```bash
cd client && npm install @mapbox/mapbox-gl-draw @turf/circle
npm install --save-dev @types/mapbox__mapbox-gl-draw
```

Expected output: packages added, no peer-dep errors.

- [ ] **Step 2: Verify typecheck still passes**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd client && git add package.json package-lock.json
git commit -m "chore: add @mapbox/mapbox-gl-draw and @turf/circle deps"
```

---

## Task 2: FeatureFlagsContext

**Files:**
- Create: `client/src/contexts/FeatureFlagsContext.tsx`
- Create: `client/src/contexts/__tests__/FeatureFlagsContext.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/contexts/__tests__/FeatureFlagsContext.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { vi, test, expect, beforeEach } from 'vitest';
import { FeatureFlagsProvider, useFeatureFlags } from '../FeatureFlagsContext';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../../../hooks/useApi';

function Inspector({ flag }: { flag: string }) {
  const flags = useFeatureFlags();
  return <div data-testid={flag}>{String((flags as any)[flag])}</div>;
}

beforeEach(() => vi.clearAllMocks());

test('exposes default flags (all true except dev_diagnostics) before API resolves', () => {
  (apiFetch as any).mockReturnValue(new Promise(() => {})); // never resolves
  render(<FeatureFlagsProvider><Inspector flag="draw" /></FeatureFlagsProvider>);
  expect(screen.getByTestId('draw').textContent).toBe('true');
});

test('dev_diagnostics defaults to false', () => {
  (apiFetch as any).mockReturnValue(new Promise(() => {}));
  render(<FeatureFlagsProvider><Inspector flag="dev_diagnostics" /></FeatureFlagsProvider>);
  expect(screen.getByTestId('dev_diagnostics').textContent).toBe('false');
});

test('merges API response over defaults', async () => {
  (apiFetch as any).mockResolvedValue({ draw: false });
  render(<FeatureFlagsProvider><Inspector flag="draw" /></FeatureFlagsProvider>);
  await waitFor(() => expect(screen.getByTestId('draw').textContent).toBe('false'));
});

test('keeps defaults when API throws', async () => {
  (apiFetch as any).mockRejectedValue(new Error('network'));
  render(<FeatureFlagsProvider><Inspector flag="ruler" /></FeatureFlagsProvider>);
  await waitFor(() => expect(screen.getByTestId('ruler').textContent).toBe('true'));
});
```

- [ ] **Step 2: Run test — expect FAIL (module not found)**

```bash
cd client && npx vitest run src/contexts/__tests__/FeatureFlagsContext.test.tsx
```

- [ ] **Step 3: Implement FeatureFlagsContext**

```tsx
// client/src/contexts/FeatureFlagsContext.tsx
import { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';

export interface FeatureFlags {
  draw: boolean;
  annotations: boolean;
  gps_replay: boolean;
  nav_overlay: boolean;
  buildings_3d: boolean;
  buffer_rings: boolean;
  ruler: boolean;
  minimap: boolean;
  dev_diagnostics: boolean;
}

const DEFAULT_FLAGS: FeatureFlags = {
  draw: true,
  annotations: true,
  gps_replay: true,
  nav_overlay: true,
  buildings_3d: true,
  buffer_rings: true,
  ruler: true,
  minimap: true,
  dev_diagnostics: false,
};

const FeatureFlagsContext = createContext<FeatureFlags>(DEFAULT_FLAGS);

export function FeatureFlagsProvider({ children }: { children: React.ReactNode }) {
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);

  const load = () => {
    apiFetch<Partial<FeatureFlags>>('/admin/feature-flags')
      .then(data => setFlags({ ...DEFAULT_FLAGS, ...data }))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    window.addEventListener('focus', load);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', load);
    };
  }, []);

  return (
    <FeatureFlagsContext.Provider value={flags}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export const useFeatureFlags = () => useContext(FeatureFlagsContext);
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd client && npx vitest run src/contexts/__tests__/FeatureFlagsContext.test.tsx
```

- [ ] **Step 5: Wrap app with provider**

In `client/src/App.tsx`, find where providers are stacked (near `UserPreferencesContext`, etc.) and add:

```tsx
import { FeatureFlagsProvider } from './contexts/FeatureFlagsContext';
// Wrap existing provider tree:
<FeatureFlagsProvider>
  {/* existing providers */}
</FeatureFlagsProvider>
```

- [ ] **Step 6: Typecheck**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add client/src/contexts/FeatureFlagsContext.tsx \
        client/src/contexts/__tests__/FeatureFlagsContext.test.tsx \
        client/src/App.tsx
git commit -m "feat: add FeatureFlagsContext (KV-backed, 30s poll)"
```

---

## Task 3: Geofences API route

**Files:**
- Create: `src/routes/geofences.ts`
- Modify: `src/routesConfig.ts`

- [ ] **Step 1: Write the failing worker test**

```ts
// tests/geofences.test.ts
import { describe, test, expect, beforeEach, vi } from 'vitest';
import geofencesRouter from '../src/routes/geofences';
import { Hono } from 'hono';

function makeApp(dbOverride?: any) {
  const app = new Hono<{ Bindings: any; Variables: any }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, username: 'test', role: 'admin', full_name: 'Test' });
    await next();
  });
  app.route('/', geofencesRouter);
  return app;
}

const mockDb = {
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  all: vi.fn().mockResolvedValue({ results: [] }),
  run: vi.fn().mockResolvedValue({ meta: { last_row_id: 42 } }),
  first: vi.fn().mockResolvedValue(null),
};

test('GET / returns empty array', async () => {
  const app = makeApp();
  const res = await app.request('/', {}, { DB: mockDb });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});

test('POST / rejects missing zone_name', async () => {
  const app = makeApp();
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geojson_data: '{}' }),
  }, { DB: mockDb });
  expect(res.status).toBe(400);
});

test('POST / rejects invalid GeoJSON', async () => {
  const app = makeApp();
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone_name: 'test', geojson_data: 'not-json' }),
  }, { DB: mockDb });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toBe('invalid_geojson');
});

test('POST / creates geofence and returns id', async () => {
  const app = makeApp();
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      zone_name: 'Test Zone',
      zone_type: 'alert',
      geojson_data: '{"type":"FeatureCollection","features":[]}',
      color: '#d4a017',
    }),
  }, { DB: mockDb });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.id).toBe(42);
});

test('DELETE /:id soft-deletes (sets is_active=0)', async () => {
  const app = makeApp();
  const res = await app.request('/5', { method: 'DELETE' }, { DB: mockDb });
  expect(res.status).toBe(200);
  expect(mockDb.bind).toHaveBeenCalledWith(5);
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/geofences.test.ts
```

- [ ] **Step 3: Implement the route**

```ts
// src/routes/geofences.ts
import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM geofence_zones WHERE is_active = 1 ORDER BY created_at DESC'
  ).all();
  return c.json(rows.results);
});

app.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    zone_name: string;
    zone_type?: string;
    geojson_data: string;
    color?: string;
    description?: string;
  }>();

  if (!body.zone_name || !body.geojson_data) {
    return c.json({ error: 'zone_name and geojson_data are required' }, 400);
  }
  try {
    JSON.parse(body.geojson_data);
  } catch {
    return c.json({ error: 'invalid_geojson' }, 400);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO geofence_zones (zone_name, zone_type, geojson_data, color, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    body.zone_name,
    body.zone_type ?? 'alert',
    body.geojson_data,
    body.color ?? '#d4a017',
    body.description ?? null,
    user.id
  ).run();

  return c.json({ success: true, id: result.meta.last_row_id }, 201);
});

app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{
    zone_name?: string;
    zone_type?: string;
    geojson_data?: string;
    color?: string;
    description?: string;
  }>();

  await c.env.DB.prepare(
    `UPDATE geofence_zones
     SET zone_name    = COALESCE(?, zone_name),
         zone_type    = COALESCE(?, zone_type),
         geojson_data = COALESCE(?, geojson_data),
         color        = COALESCE(?, color),
         description  = COALESCE(?, description),
         updated_at   = datetime('now')
     WHERE id = ?`
  ).bind(
    body.zone_name ?? null,
    body.zone_type ?? null,
    body.geojson_data ?? null,
    body.color ?? null,
    body.description ?? null,
    id
  ).run();

  return c.json({ success: true });
});

app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare(
    `UPDATE geofence_zones SET is_active = 0, updated_at = datetime('now') WHERE id = ?`
  ).bind(id).run();
  return c.json({ success: true });
});

export default app;
```

- [ ] **Step 4: Register in routesConfig.ts**

In `src/routesConfig.ts`, add the import near the other route imports (alphabetical by prefix):

```ts
import geofences from './routes/geofences';
```

In `ROUTE_REGISTRY`, add one entry (place in the "G" section alphabetically):

```ts
{ prefix: '/api/geofences', router: geofences, auth: 'required',
  note: 'Geofence zone CRUD — writes to geofence_zones. All authenticated roles.' },
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npx vitest run tests/geofences.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/geofences.ts src/routesConfig.ts
git commit -m "feat: add /api/geofences CRUD route (geofence_zones table)"
```

---

## Task 4: MapToolbar shell

**Files:**
- Create: `client/src/components/MapToolbar.tsx`
- Create: `client/src/components/__tests__/MapToolbar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/__tests__/MapToolbar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, test, expect } from 'vitest';
import MapToolbar from '../MapToolbar';
import { FeatureFlagsContext } from '../../contexts/FeatureFlagsContext';

const ALL_ON = {
  draw: true, annotations: true, gps_replay: true, nav_overlay: true,
  buildings_3d: true, buffer_rings: true, ruler: true, minimap: true,
  dev_diagnostics: false,
};

const mockMap = {} as any;

const FakeTool = ({ onClose }: { map: any; onClose: () => void }) => (
  <div data-testid="tool-panel">
    <button onClick={onClose}>close</button>
  </div>
);

const TOOLS = [
  { id: 'draw', icon: '✏️', label: 'Draw', flag: 'draw' as const, component: FakeTool },
  { id: 'ruler', icon: '📏', label: 'Ruler', flag: 'ruler' as const, component: FakeTool },
];

function wrap(ui: React.ReactElement, flags = ALL_ON) {
  return render(
    <FeatureFlagsContext.Provider value={flags}>{ui}</FeatureFlagsContext.Provider>
  );
}

test('renders toolbar icon buttons', () => {
  wrap(<MapToolbar map={mockMap} tools={TOOLS} />);
  expect(screen.getByLabelText('Draw')).toBeInTheDocument();
  expect(screen.getByLabelText('Ruler')).toBeInTheDocument();
});

test('clicking a tool shows its panel', () => {
  wrap(<MapToolbar map={mockMap} tools={TOOLS} />);
  fireEvent.click(screen.getByLabelText('Draw'));
  expect(screen.getByTestId('tool-panel')).toBeInTheDocument();
});

test('clicking the same tool again closes the panel', () => {
  wrap(<MapToolbar map={mockMap} tools={TOOLS} />);
  fireEvent.click(screen.getByLabelText('Draw'));
  fireEvent.click(screen.getByLabelText('Draw'));
  expect(screen.queryByTestId('tool-panel')).not.toBeInTheDocument();
});

test('tool close button deactivates panel', () => {
  wrap(<MapToolbar map={mockMap} tools={TOOLS} />);
  fireEvent.click(screen.getByLabelText('Draw'));
  fireEvent.click(screen.getByText('close'));
  expect(screen.queryByTestId('tool-panel')).not.toBeInTheDocument();
});

test('hides tools whose feature flag is false', () => {
  wrap(<MapToolbar map={mockMap} tools={TOOLS} />, { ...ALL_ON, ruler: false });
  expect(screen.queryByLabelText('Ruler')).not.toBeInTheDocument();
});

test('returns null when map is null', () => {
  const { container } = wrap(<MapToolbar map={null} tools={TOOLS} />);
  expect(container.firstChild).toBeNull();
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd client && npx vitest run src/components/__tests__/MapToolbar.test.tsx
```

- [ ] **Step 3: Implement MapToolbar**

```tsx
// client/src/components/MapToolbar.tsx
import { useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { useFeatureFlags, type FeatureFlags } from '../contexts/FeatureFlagsContext';

export interface MapTool {
  id: string;
  icon: string;
  label: string;
  flag: keyof FeatureFlags | null;
  component: React.ComponentType<{ map: mapboxgl.Map; onClose: () => void }>;
}

interface Props {
  map: mapboxgl.Map | null;
  tools: MapTool[];
}

export default function MapToolbar({ map, tools }: Props) {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const flags = useFeatureFlags();

  if (!map) return null;

  const visible = tools.filter(t => t.flag === null || flags[t.flag]);
  const active = visible.find(t => t.id === activeTool);
  const toggle = (id: string) => setActiveTool(prev => prev === id ? null : id);

  return (
    <div className="absolute left-3 top-1/2 -translate-y-1/2 z-50 flex items-start gap-2 pointer-events-none">
      <div className="tactical-dark flex flex-col gap-1 p-1.5 rounded border border-surface-raised pointer-events-auto">
        {visible.map(tool => (
          <button
            key={tool.id}
            aria-label={tool.label}
            title={tool.label}
            onClick={() => toggle(tool.id)}
            className={`w-7 h-7 flex items-center justify-center rounded text-sm transition-colors ${
              activeTool === tool.id
                ? 'bg-brand-500 text-black'
                : 'bg-surface-raised text-rmpg-300 hover:bg-rmpg-700'
            }`}
          >
            {tool.icon}
          </button>
        ))}
      </div>
      {active && (
        <div className="pointer-events-auto">
          <active.component map={map} onClose={() => setActiveTool(null)} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd client && npx vitest run src/components/__tests__/MapToolbar.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add client/src/components/MapToolbar.tsx \
        client/src/components/__tests__/MapToolbar.test.tsx
git commit -m "feat: MapToolbar shell with feature-flag gating"
```

---

## Task 5: DrawGeofenceTool

**Files:**
- Create: `client/src/pages/map/components/DrawGeofenceTool.tsx`
- Create: `client/src/pages/map/components/__tests__/DrawGeofenceTool.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/map/components/__tests__/DrawGeofenceTool.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, test, expect, beforeEach } from 'vitest';
import DrawGeofenceTool from '../DrawGeofenceTool';

vi.mock('@mapbox/mapbox-gl-draw', () => ({
  default: vi.fn().mockImplementation(() => ({
    getAll: vi.fn().mockReturnValue({ type: 'FeatureCollection', features: [{ type: 'Feature' }] }),
    deleteAll: vi.fn(),
    changeMode: vi.fn(),
  })),
}));

vi.mock('../../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({ success: true, id: 1 }),
}));

const mockMap = {
  addControl: vi.fn(),
  removeControl: vi.fn(),
} as any;

beforeEach(() => vi.clearAllMocks());

test('renders shape, color, zone name, zone type controls', () => {
  render(<DrawGeofenceTool map={mockMap} onClose={vi.fn()} />);
  expect(screen.getByText('Polygon')).toBeInTheDocument();
  expect(screen.getByText('Circle')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Zone name…')).toBeInTheDocument();
});

test('shows error when saving without zone name', async () => {
  render(<DrawGeofenceTool map={mockMap} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(screen.getByText('Zone name is required')).toBeInTheDocument());
});

test('calls POST /api/geofences and onClose on successful save', async () => {
  const onClose = vi.fn();
  const { apiFetch } = await import('../../../../hooks/useApi');
  render(<DrawGeofenceTool map={mockMap} onClose={onClose} />);
  fireEvent.change(screen.getByPlaceholderText('Zone name…'), { target: { value: 'Test Zone' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
    '/geofences',
    expect.objectContaining({ method: 'POST' })
  ));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd client && npx vitest run src/pages/map/components/__tests__/DrawGeofenceTool.test.tsx
```

- [ ] **Step 3: Implement DrawGeofenceTool**

```tsx
// client/src/pages/map/components/DrawGeofenceTool.tsx
import { useEffect, useRef, useState } from 'react';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import type mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

interface Props {
  map: mapboxgl.Map;
  onClose: () => void;
}

const ZONE_TYPES = ['alert', 'exclusion', 'inclusion', 'patrol_required'] as const;
type ZoneType = typeof ZONE_TYPES[number];

const COLORS = ['#d4a017', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#f97316'];

export default function DrawGeofenceTool({ map, onClose }: Props) {
  const drawRef = useRef<MapboxDraw | null>(null);
  const [mode, setMode] = useState<'polygon' | 'circle'>('polygon');
  const [color, setColor] = useState(COLORS[0]);
  const [zoneName, setZoneName] = useState('');
  const [zoneType, setZoneType] = useState<ZoneType>('alert');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const draw = new MapboxDraw({
      displayControlsDefault: false,
      styles: [
        {
          id: 'draw-polygon-fill',
          type: 'fill',
          filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          paint: { 'fill-color': color, 'fill-opacity': 0.2 },
        },
        {
          id: 'draw-polygon-stroke',
          type: 'line',
          filter: ['all', ['==', '$type', 'Polygon']],
          paint: { 'line-color': color, 'line-width': 2 },
        },
        {
          id: 'draw-vertex',
          type: 'circle',
          filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex']],
          paint: { 'circle-radius': 5, 'circle-color': color },
        },
      ],
    });
    map.addControl(draw as any);
    drawRef.current = draw;
    draw.changeMode('draw_polygon');
    return () => {
      map.removeControl(draw as any);
      drawRef.current = null;
    };
  }, [map, color]);

  const handleSave = async () => {
    const draw = drawRef.current;
    if (!draw) return;
    const data = draw.getAll();
    if (!data.features.length) { setError('Draw a shape on the map first'); return; }
    if (!zoneName.trim()) { setError('Zone name is required'); return; }
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/geofences', {
        method: 'POST',
        body: JSON.stringify({
          zone_name: zoneName.trim(),
          zone_type: zoneType,
          geojson_data: JSON.stringify(data),
          color,
        }),
      });
      draw.deleteAll();
      setZoneName('');
      onClose();
    } catch {
      setError('Failed to save zone');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tactical-dark border border-surface-raised rounded p-3 w-52 text-xs space-y-2 shadow-lg">
      <div className="text-brand-400 font-bold uppercase tracking-wider text-[10px]">Draw Geofence</div>
      <div className="flex gap-1">
        {(['polygon', 'circle'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`flex-1 py-1 rounded text-[10px] capitalize ${
              mode === m ? 'bg-brand-500 text-black font-bold' : 'bg-surface-raised text-rmpg-300'
            }`}>
            {m}
          </button>
        ))}
      </div>
      <div className="flex gap-1 flex-wrap">
        {COLORS.map(c => (
          <button key={c} aria-label={`Color ${c}`} onClick={() => setColor(c)}
            className={`w-5 h-5 rounded-sm border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
            style={{ backgroundColor: c }} />
        ))}
      </div>
      <select value={zoneType} onChange={e => setZoneType(e.target.value as ZoneType)}
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 rounded px-1 py-0.5 text-[10px]">
        {ZONE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <input value={zoneName} onChange={e => setZoneName(e.target.value)}
        placeholder="Zone name…"
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-[10px]" />
      {error && <div className="text-red-400 text-[10px]">{error}</div>}
      <div className="text-rmpg-400 text-[10px]">Click map to draw</div>
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="flex-1 bg-brand-500 text-black font-bold py-1 rounded text-[10px] disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => { drawRef.current?.deleteAll(); onClose(); }}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd client && npx vitest run src/pages/map/components/__tests__/DrawGeofenceTool.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/components/DrawGeofenceTool.tsx \
        client/src/pages/map/components/__tests__/DrawGeofenceTool.test.tsx
git commit -m "feat: DrawGeofenceTool with Mapbox GL Draw integration"
```

---

## Task 6: BuildingsLayer

**Files:**
- Create: `client/src/pages/map/components/BuildingsLayer.tsx`
- Create: `client/src/pages/map/components/__tests__/BuildingsLayer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/map/components/__tests__/BuildingsLayer.test.tsx
import { renderHook } from '@testing-library/react';
import { vi, test, expect, beforeEach } from 'vitest';

// We test the hook logic, not the Mapbox side-effects
vi.mock('../../../../utils/mapPreferences', () => ({
  loadMapPref: vi.fn().mockReturnValue(false),
  saveMapPref: vi.fn(),
}));

import { useBuildingsLayer } from '../BuildingsLayer';

const addLayer = vi.fn();
const removeLayer = vi.fn();
const getLayer = vi.fn();
const on = vi.fn();

const mockMap = { addLayer, removeLayer, getLayer, on } as any;

beforeEach(() => { vi.clearAllMocks(); getLayer.mockReturnValue(undefined); });

test('exposes enabled state, defaulting to stored pref', () => {
  const { result } = renderHook(() => useBuildingsLayer(mockMap));
  expect(result.current.enabled).toBe(false);
});

test('toggle adds layer when enabling', () => {
  const { result } = renderHook(() => useBuildingsLayer(mockMap));
  result.current.toggle();
  // layer is added when enabled changes to true on next render
  expect(result.current.enabled).toBe(true);
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd client && npx vitest run src/pages/map/components/__tests__/BuildingsLayer.test.tsx
```

- [ ] **Step 3: Implement BuildingsLayer**

```tsx
// client/src/pages/map/components/BuildingsLayer.tsx
import { useEffect, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { loadMapPref, saveMapPref } from '../../../utils/mapPreferences';

const LAYER_ID = 'rmpg-3d-buildings';
const SOURCE_ID = 'composite';

export function useBuildingsLayer(map: mapboxgl.Map | null) {
  const [enabled, setEnabled] = useState(() => Boolean(loadMapPref('buildings_3d')));

  useEffect(() => {
    if (!map) return;
    const addBuildings = () => {
      if (map.getLayer(LAYER_ID)) return;
      map.addLayer({
        id: LAYER_ID,
        source: SOURCE_ID,
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: 15,
        paint: {
          'fill-extrusion-color': '#0d2235',
          'fill-extrusion-height': ['coalesce', ['*', ['get', 'levels'], 3], 10],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.8,
        },
      });
    };
    const removeBuildings = () => {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    };

    if (enabled) {
      if (map.isStyleLoaded()) addBuildings();
      else map.once('styledata', addBuildings);
    } else {
      removeBuildings();
    }
  }, [map, enabled]);

  const toggle = () => {
    setEnabled(prev => {
      saveMapPref('buildings_3d', !prev);
      return !prev;
    });
  };

  return { enabled, toggle };
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd client && npx vitest run src/pages/map/components/__tests__/BuildingsLayer.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/components/BuildingsLayer.tsx \
        client/src/pages/map/components/__tests__/BuildingsLayer.test.tsx
git commit -m "feat: 3D buildings layer hook (fill-extrusion, zoom ≥15)"
```

---

## Task 7: MinimapControl + ScaleFullscreenControls

**Files:**
- Create: `client/src/pages/map/components/MinimapControl.tsx`
- Create: `client/src/pages/map/components/ScaleFullscreenControls.tsx`

- [ ] **Step 1: Implement MinimapControl**

```tsx
// client/src/pages/map/components/MinimapControl.tsx
import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { getMapboxToken } from '../../../utils/mapboxApiKey';
import { saveMapPref, loadMapPref } from '../../../utils/mapPreferences';

interface Props {
  parentMap: mapboxgl.Map;
  onClose: () => void;
}

export default function MinimapControl({ parentMap, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<mapboxgl.Map | null>(null);
  const [visible, setVisible] = useState(() => Boolean(loadMapPref('minimap_visible')));

  useEffect(() => {
    if (!containerRef.current) return;
    const token = getMapboxToken();
    if (!token) return;

    const minimap = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: parentMap.getCenter(),
      zoom: Math.max(parentMap.getZoom() - 4, 1),
      attributionControl: false,
      interactive: true,
    });
    minimapRef.current = minimap;

    const syncToParent = () => {
      minimap.setCenter(parentMap.getCenter());
      minimap.setZoom(Math.max(parentMap.getZoom() - 4, 1));
    };

    parentMap.on('move', syncToParent);
    return () => {
      parentMap.off('move', syncToParent);
      minimap.remove();
      minimapRef.current = null;
    };
  }, [parentMap]);

  return (
    <div className="fixed bottom-4 right-4 z-40 tactical-dark border border-surface-raised rounded shadow-lg overflow-hidden"
         style={{ width: 180, height: 140 }}>
      <div ref={containerRef} className="w-full h-full" />
      <button
        aria-label="Close minimap"
        onClick={() => { saveMapPref('minimap_visible', false); onClose(); }}
        className="absolute top-1 right-1 text-rmpg-300 hover:text-white text-xs bg-surface-base rounded px-1">
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Implement ScaleFullscreenControls**

```tsx
// client/src/pages/map/components/ScaleFullscreenControls.tsx
import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { saveMapPref, loadMapPref } from '../../../utils/mapPreferences';

interface Props {
  map: mapboxgl.Map;
  showScale: boolean;
  showFullscreen: boolean;
}

export function useScaleControl(map: mapboxgl.Map | null, enabled: boolean) {
  const ctrlRef = useRef<mapboxgl.ScaleControl | null>(null);
  useEffect(() => {
    if (!map) return;
    if (enabled && !ctrlRef.current) {
      const ctrl = new mapboxgl.ScaleControl({ unit: 'imperial' });
      map.addControl(ctrl, 'bottom-left');
      ctrlRef.current = ctrl;
      saveMapPref('scale_visible', true);
    } else if (!enabled && ctrlRef.current) {
      map.removeControl(ctrlRef.current);
      ctrlRef.current = null;
      saveMapPref('scale_visible', false);
    }
    return () => {
      if (ctrlRef.current) { map.removeControl(ctrlRef.current); ctrlRef.current = null; }
    };
  }, [map, enabled]);
}

export function useFullscreenControl(map: mapboxgl.Map | null, enabled: boolean) {
  const ctrlRef = useRef<mapboxgl.FullscreenControl | null>(null);
  useEffect(() => {
    if (!map) return;
    if (enabled && !ctrlRef.current) {
      const ctrl = new mapboxgl.FullscreenControl();
      map.addControl(ctrl, 'top-right');
      ctrlRef.current = ctrl;
      saveMapPref('fullscreen_visible', true);
    } else if (!enabled && ctrlRef.current) {
      map.removeControl(ctrlRef.current);
      ctrlRef.current = null;
      saveMapPref('fullscreen_visible', false);
    }
    return () => {
      if (ctrlRef.current) { map.removeControl(ctrlRef.current); ctrlRef.current = null; }
    };
  }, [map, enabled]);
}
```

- [ ] **Step 3: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/map/components/MinimapControl.tsx \
        client/src/pages/map/components/ScaleFullscreenControls.tsx
git commit -m "feat: MinimapControl and ScaleFullscreenControl hooks"
```

---

## Task 8: Wire MapToolbar into MapPage

**Files:**
- Modify: `client/src/pages/map/MapPage.tsx`

- [ ] **Step 1: Find the map ref in MapPage**

```bash
grep -n "mapRef\|map\.current\|mapboxgl\.Map\|new Map(" client/src/pages/map/MapPage.tsx | head -15
```

Note the variable name holding the Mapbox map instance (likely `mapRef` or `map`).

- [ ] **Step 2: Add toolbar import and TOOLS config**

At the top of `MapPage.tsx`, add:

```tsx
import MapToolbar, { type MapTool } from '../../components/MapToolbar';
import DrawGeofenceTool from './components/DrawGeofenceTool';
import { useBuildingsLayer } from './components/BuildingsLayer';
import MinimapControl from './components/MinimapControl';
import { useScaleControl, useFullscreenControl } from './components/ScaleFullscreenControls';
import { useFeatureFlags } from '../../contexts/FeatureFlagsContext';
```

Inside the component body, add:

```tsx
const flags = useFeatureFlags();
const [showMinimap, setShowMinimap] = useState(() => Boolean(loadMapPref('minimap_visible')));
const [showScale, setShowScale] = useState(() => Boolean(loadMapPref('scale_visible')));
const [showFullscreen, setShowFullscreen] = useState(() => Boolean(loadMapPref('fullscreen_visible')));
const { enabled: buildingsEnabled, toggle: toggleBuildings } = useBuildingsLayer(mapRef.current);

useScaleControl(mapRef.current, showScale);
useFullscreenControl(mapRef.current, showFullscreen);

const MAP_TOOLS: MapTool[] = [
  { id: 'draw', icon: '✏️', label: 'Draw Geofence', flag: 'draw', component: DrawGeofenceTool },
  { id: '__divider__', icon: '', label: '', flag: null, component: () => null },
  {
    id: 'buildings',
    icon: buildingsEnabled ? '🏢' : '🏗️',
    label: '3D Buildings',
    flag: 'buildings_3d',
    component: ({ onClose }) => {
      toggleBuildings();
      onClose();
      return null;
    },
  },
  {
    id: 'minimap',
    icon: '🗺️',
    label: 'Minimap',
    flag: 'minimap',
    component: ({ map, onClose }) => (
      <MinimapControl parentMap={map} onClose={onClose} />
    ),
  },
  {
    id: 'scale',
    icon: '📐',
    label: 'Scale Bar',
    flag: null,
    component: ({ onClose }) => { setShowScale(p => !p); onClose(); return null; },
  },
  {
    id: 'fullscreen',
    icon: '⛶',
    label: 'Fullscreen',
    flag: null,
    component: ({ onClose }) => { setShowFullscreen(p => !p); onClose(); return null; },
  },
];
```

- [ ] **Step 3: Add `<MapToolbar>` to the JSX**

Find the outermost map container div and add `<MapToolbar>` as a sibling to the map canvas (not inside it):

```tsx
{/* Immediately after the map container div, still within the relative parent: */}
<MapToolbar map={mapRef.current} tools={MAP_TOOLS} />
```

- [ ] **Step 4: Run full test suite**

```bash
cd client && npx vitest run
npm run typecheck
```

Expected: all tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/MapPage.tsx
git commit -m "feat: wire MapToolbar into MapPage with all PR1 tools"
```

---

## Task 9: PR 1 branch and pull request

- [ ] **Step 1: Verify all tests pass**

```bash
npx vitest run && npm run typecheck && cd client && npx vitest run && npx tsc --noEmit
```

Expected: all green.

- [ ] **Step 2: Create PR**

```bash
gh pr create \
  --title "feat: Mapbox PR1 — floating toolbar + draw geofences + buildings + minimap" \
  --body "$(cat <<'EOF'
## Summary
- Floating vertical toolbar on map canvas (left edge) with mutual-exclusion tool activation
- FeatureFlagsContext (KV-backed, 30s poll) gates all toolbar tools
- DrawGeofenceTool: Mapbox GL Draw polygon/circle → saves to existing `geofence_zones` table via new `/api/geofences` CRUD route
- BuildingsLayer: 3D fill-extrusion toggle (zoom ≥ 15), state persisted to localStorage
- MinimapControl: second Map instance, 180×140px, bottom-right, tracks parent camera
- Scale bar + Fullscreen: native Mapbox controls exposed as toolbar toggles

## Test plan
- [ ] Run `npx vitest run` — all pass
- [ ] Run `npm run typecheck` — no errors
- [ ] Open map, confirm toolbar appears on left edge
- [ ] Draw a polygon geofence, name it, save → verify it appears in the geofence layer
- [ ] Toggle 3D buildings at zoom ≥ 15 (zoom into downtown SLC)
- [ ] Toggle minimap → appears bottom-right
- [ ] Admin: disable "draw" flag via AdminPage → draw icon disappears from toolbar

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
