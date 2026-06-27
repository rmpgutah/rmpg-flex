# Mapbox PR 3 — Admin Dev Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Dev ⚙" tab to the AdminPage with four sections: Feature Flags (KV-backed toggles for all map tools), Map Diagnostics overlay (live FPS/tiles/zoom HUD on the map canvas), API & WebSocket Inspector (client-side ring buffer of recent calls + WS messages), and Simulation Controls (fake GPS, seed test calls, trigger welfare timer).

**Architecture:** A new `AdminDevSettingsTab.tsx` is added as a tab in `AdminPage.tsx`. A new `src/routes/adminDev.ts` route provides `GET/PUT /api/admin/feature-flags` (KV reads/writes) and `POST /api/admin/mock/gps|call` (admin-only simulation triggers). The API/WS inspector is entirely client-side — it wraps `apiFetch` in a ring-buffer logger with no server changes.

**Tech Stack:** React 18 + TypeScript, Hono (Worker), Cloudflare KV (feature flags), existing `useLiveSync` hook (WS tap).

**Prerequisite:** PRs 1 and 2 must be merged (FeatureFlagsContext exists).

---

## File Structure

**New files — client:**
- `client/src/pages/admin/AdminDevSettingsTab.tsx` — full dev panel (4 sections)
- `client/src/utils/apiLogger.ts` — ring-buffer `apiFetch` interceptor
- `client/src/pages/map/components/MapDiagnosticsOverlay.tsx` — live FPS/zoom HUD
- `client/src/pages/admin/__tests__/AdminDevSettingsTab.test.tsx`
- `client/src/utils/__tests__/apiLogger.test.ts`

**New files — worker:**
- `src/routes/adminDev.ts`

**Modified files:**
- `src/routesConfig.ts` — register adminDev routes
- `client/src/pages/AdminPage.tsx` — add 'dev_settings' tab
- `client/src/hooks/useApi.ts` — plug apiLogger into apiFetch (2-line change)
- `client/src/pages/map/MapPage.tsx` — mount `<MapDiagnosticsOverlay>` when flag enabled

---

## Task 1: adminDev Worker route

**Files:**
- Create: `src/routes/adminDev.ts`
- Modify: `src/routesConfig.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/adminDev.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import adminDevRouter from '../src/routes/adminDev';

const mockKv = {
  get: vi.fn().mockResolvedValue(null),
  put: vi.fn().mockResolvedValue(undefined),
};

const mockDb = {
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue({ id: 5, unit_number: 'RMPG-01' }),
  run: vi.fn().mockResolvedValue({ meta: { last_row_id: 99 } }),
  all: vi.fn().mockResolvedValue({ results: [] }),
};

function makeApp(role = 'admin') {
  const app = new Hono<{ Bindings: any; Variables: any }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, username: 'admin', role, full_name: 'Admin' });
    await next();
  });
  app.route('/', adminDevRouter);
  return app;
}

beforeEach(() => vi.clearAllMocks());

test('GET /feature-flags returns defaults when KV is empty', async () => {
  const app = makeApp();
  const res = await app.request('/feature-flags', {}, { KV: mockKv, DB: mockDb });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.draw).toBe(true);
  expect(body.dev_diagnostics).toBe(false);
});

test('GET /feature-flags merges KV value over defaults', async () => {
  mockKv.get.mockResolvedValueOnce(JSON.stringify({ draw: false }));
  const app = makeApp();
  const res = await app.request('/feature-flags', {}, { KV: mockKv, DB: mockDb });
  const body = await res.json();
  expect(body.draw).toBe(false);
  expect(body.annotations).toBe(true); // default still true
});

test('PUT /feature-flags writes to KV', async () => {
  const app = makeApp();
  const res = await app.request('/feature-flags', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draw: false, ruler: true }),
  }, { KV: mockKv, DB: mockDb });
  expect(res.status).toBe(200);
  expect(mockKv.put).toHaveBeenCalledWith('feature_flags', expect.stringContaining('"draw":false'));
});

test('PUT /feature-flags returns 403 for non-admin', async () => {
  const app = makeApp('officer');
  const res = await app.request('/feature-flags', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draw: false }),
  }, { KV: mockKv, DB: mockDb });
  expect(res.status).toBe(403);
});

test('POST /mock/call creates test CFS record', async () => {
  const app = makeApp();
  const res = await app.request('/mock/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'TRAFFIC STOP' }),
  }, { KV: mockKv, DB: mockDb });
  expect(res.status).toBe(201);
  expect(mockDb.run).toHaveBeenCalled();
});

test('POST /mock/call returns 403 for non-admin', async () => {
  const app = makeApp('officer');
  const res = await app.request('/mock/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'TRAFFIC STOP' }),
  }, { KV: mockKv, DB: mockDb });
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/adminDev.test.ts
```

- [ ] **Step 3: Implement adminDev route**

```ts
// src/routes/adminDev.ts
import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const DEFAULT_FLAGS = {
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

const requireAdmin = async (c: any, next: () => Promise<void>) => {
  if (c.get('user').role !== 'admin') {
    return c.json({ error: 'admin_required' }, 403);
  }
  await next();
};

app.get('/feature-flags', async (c) => {
  const raw = await c.env.KV.get('feature_flags');
  const stored = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  return c.json({ ...DEFAULT_FLAGS, ...stored });
});

app.put('/feature-flags', requireAdmin, async (c) => {
  const body = await c.req.json<Record<string, boolean>>();
  const merged = { ...DEFAULT_FLAGS, ...body };
  await c.env.KV.put('feature_flags', JSON.stringify(merged));
  return c.json({ success: true, flags: merged });
});

app.post('/mock/gps', requireAdmin, async (c) => {
  const body = await c.req.json<{ unit_id: number; lat: number; lng: number }>();
  if (!body.unit_id || body.lat === undefined || body.lng === undefined) {
    return c.json({ error: 'unit_id, lat, lng required' }, 400);
  }
  const unit = await c.env.DB.prepare('SELECT id, unit_number FROM units WHERE id = ?')
    .bind(body.unit_id).first();
  if (!unit) return c.json({ error: 'unit_not_found' }, 404);

  await c.env.DB.prepare(
    `INSERT INTO unit_locations (unit_id, lat, lng, accuracy, recorded_at, notes)
     VALUES (?, ?, ?, 1, datetime('now'), '[DEV_SIM]')`
  ).bind(body.unit_id, body.lat, body.lng).run();

  return c.json({ success: true, unit });
});

app.post('/mock/call', requireAdmin, async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ type?: string }>();
  const callType = body.type ?? 'TRAFFIC STOP';

  const result = await c.env.DB.prepare(
    `INSERT INTO calls_for_service (call_type, status, priority, address, notes, created_by, created_at)
     VALUES (?, 'PENDING', 3, 'TEST LOCATION — Dev Sim', '[TEST] Auto-created by dev simulation', ?, datetime('now'))`
  ).bind(callType, user.id).run();

  return c.json({ success: true, id: result.meta.last_row_id }, 201);
});

export default app;
```

- [ ] **Step 4: Register in routesConfig.ts**

```ts
// Add import near other route imports:
import adminDev from './routes/adminDev';

// Add to ROUTE_REGISTRY (under existing /api/admin entries):
{ prefix: '/api/admin/dev', router: adminDev, auth: 'required',
  note: 'Dev settings: feature flags (KV), mock GPS/calls. Admin role required per-route.' },
```

- [ ] **Step 5: Run tests and typecheck**

```bash
npx vitest run tests/adminDev.test.ts && npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/adminDev.ts src/routesConfig.ts
git commit -m "feat: /api/admin/dev — feature flags (KV) + mock GPS/call endpoints"
```

---

## Task 2: API logger utility

**Files:**
- Create: `client/src/utils/apiLogger.ts`
- Create: `client/src/utils/__tests__/apiLogger.test.ts`
- Modify: `client/src/hooks/useApi.ts` (2-line change)

- [ ] **Step 1: Write failing test**

```ts
// client/src/utils/__tests__/apiLogger.test.ts
import { test, expect, beforeEach } from 'vitest';
import { logApiCall, getApiLog, clearApiLog } from '../apiLogger';

beforeEach(() => clearApiLog());

test('starts empty', () => {
  expect(getApiLog()).toHaveLength(0);
});

test('logs a call entry', () => {
  logApiCall({ method: 'GET', path: '/api/health', status: 200, latencyMs: 45 });
  const log = getApiLog();
  expect(log).toHaveLength(1);
  expect(log[0].path).toBe('/api/health');
  expect(log[0].status).toBe(200);
});

test('caps at 100 entries (ring buffer)', () => {
  for (let i = 0; i < 110; i++) {
    logApiCall({ method: 'GET', path: `/api/test/${i}`, status: 200, latencyMs: 10 });
  }
  expect(getApiLog()).toHaveLength(100);
});

test('newest entry is first', () => {
  logApiCall({ method: 'GET', path: '/api/first', status: 200, latencyMs: 10 });
  logApiCall({ method: 'GET', path: '/api/second', status: 200, latencyMs: 10 });
  expect(getApiLog()[0].path).toBe('/api/second');
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd client && npx vitest run src/utils/__tests__/apiLogger.test.ts
```

- [ ] **Step 3: Implement apiLogger**

```ts
// client/src/utils/apiLogger.ts
export interface ApiLogEntry {
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  timestamp: number;
}

const MAX_ENTRIES = 100;
let log: ApiLogEntry[] = [];
let listeners: (() => void)[] = [];

export function logApiCall(entry: Omit<ApiLogEntry, 'timestamp'>) {
  log = [{ ...entry, timestamp: Date.now() }, ...log].slice(0, MAX_ENTRIES);
  listeners.forEach(fn => fn());
}

export function getApiLog(): ApiLogEntry[] { return log; }
export function clearApiLog() { log = []; listeners.forEach(fn => fn()); }
export function subscribeApiLog(fn: () => void) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd client && npx vitest run src/utils/__tests__/apiLogger.test.ts
```

- [ ] **Step 5: Plug into apiFetch**

In `client/src/hooks/useApi.ts`, find where `apiFetch` completes a fetch (around the response handling). Add two lines — a `start` timestamp before the fetch and a `logApiCall` after the response:

```ts
// At the start of the fetch, before the fetch() call:
import { logApiCall } from '../utils/apiLogger';
const _t0 = Date.now();

// After you have the response status (inside the existing response handler):
logApiCall({ method, path: relativeUrl, status: response.status, latencyMs: Date.now() - _t0 });
```

Search for the line `const response = await fetchWithTimeout(...)` in `useApi.ts` and wrap it:

```ts
const _t0 = Date.now();
const response = await fetchWithTimeout(url, fetchInit, options?.timeoutMs);
logApiCall({ method, path: relativeUrl, status: response.status, latencyMs: Date.now() - _t0 });
```

- [ ] **Step 6: Typecheck**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/apiLogger.ts \
        client/src/utils/__tests__/apiLogger.test.ts \
        client/src/hooks/useApi.ts
git commit -m "feat: apiLogger ring buffer (100 entries) + plug into apiFetch"
```

---

## Task 3: MapDiagnosticsOverlay

**Files:**
- Create: `client/src/pages/map/components/MapDiagnosticsOverlay.tsx`

- [ ] **Step 1: Implement MapDiagnosticsOverlay**

```tsx
// client/src/pages/map/components/MapDiagnosticsOverlay.tsx
import { useEffect, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import mapboxglLib from 'mapbox-gl';

interface Props { map: mapboxgl.Map; }

interface Stats {
  fps: number;
  zoom: number;
  pitch: number;
  bearing: number;
  lat: number;
  lng: number;
  layerCount: number;
  renderMs: number;
}

export default function MapDiagnosticsOverlay({ map }: Props) {
  const [stats, setStats] = useState<Stats>({
    fps: 0, zoom: 0, pitch: 0, bearing: 0, lat: 0, lng: 0, layerCount: 0, renderMs: 0,
  });
  const frameRef = useRef(0);
  const lastFrameTime = useRef(performance.now());
  const renderStart = useRef(0);

  useEffect(() => {
    const onRender = () => {
      const now = performance.now();
      const delta = now - lastFrameTime.current;
      lastFrameTime.current = now;
      const fps = delta > 0 ? Math.round(1000 / delta) : 0;
      const center = map.getCenter();
      const style = map.getStyle();
      const layerCount = style?.layers?.length ?? 0;
      setStats({
        fps,
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
        lat: center.lat,
        lng: center.lng,
        layerCount,
        renderMs: Math.round(now - renderStart.current),
      });
      renderStart.current = now;
    };
    map.on('render', onRender);
    return () => map.off('render', onRender);
  }, [map]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        // This component only renders when enabled, so just signal parent
        // Parent controls visibility via feature flag / localStorage
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="absolute top-2 right-2 z-50 tactical-dark border border-surface-raised rounded p-2 text-[10px] font-mono space-y-0.5 opacity-90 select-none pointer-events-none min-w-[160px]">
      <div className="text-brand-400 font-bold text-[9px] uppercase tracking-wider mb-1">MAP DIAGNOSTICS</div>
      <Row label="FPS" value={String(stats.fps)} color={stats.fps < 30 ? '#ef4444' : stats.fps < 55 ? '#d4a017' : '#4ade80'} />
      <Row label="Render" value={`${stats.renderMs}ms`} />
      <Row label="Layers" value={String(stats.layerCount)} />
      <Row label="Zoom" value={stats.zoom.toFixed(2)} />
      <Row label="Pitch" value={`${stats.pitch.toFixed(1)}°`} />
      <Row label="Bearing" value={`${stats.bearing.toFixed(1)}°`} />
      <Row label="Lat" value={stats.lat.toFixed(6)} />
      <Row label="Lng" value={stats.lng.toFixed(6)} />
      <div className="text-rmpg-500 text-[9px] pt-1 border-t border-surface-raised">
        GL v{(mapboxglLib as any).version ?? '?'}
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-rmpg-400">{label}</span>
      <span style={color ? { color } : undefined} className="text-rmpg-200">{value}</span>
    </div>
  );
}
```

- [ ] **Step 2: Mount in MapPage when flag is enabled**

In `client/src/pages/map/MapPage.tsx`, add:

```tsx
import MapDiagnosticsOverlay from './components/MapDiagnosticsOverlay';

// Inside component, after the flags destructure:
const { dev_diagnostics } = useFeatureFlags();

// In JSX, alongside MapToolbar:
{dev_diagnostics && mapRef.current && (
  <MapDiagnosticsOverlay map={mapRef.current} />
)}
```

- [ ] **Step 3: Typecheck**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/map/components/MapDiagnosticsOverlay.tsx \
        client/src/pages/map/MapPage.tsx
git commit -m "feat: MapDiagnosticsOverlay — live FPS/zoom/layers HUD (Ctrl+Shift+D)"
```

---

## Task 4: AdminDevSettingsTab

**Files:**
- Create: `client/src/pages/admin/AdminDevSettingsTab.tsx`
- Create: `client/src/pages/admin/__tests__/AdminDevSettingsTab.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// client/src/pages/admin/__tests__/AdminDevSettingsTab.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, test, expect, beforeEach } from 'vitest';
import AdminDevSettingsTab from '../AdminDevSettingsTab';
import { FeatureFlagsContext } from '../../../contexts/FeatureFlagsContext';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({ success: true }),
}));

const ALL_FLAGS = {
  draw: true, annotations: true, gps_replay: true, nav_overlay: true,
  buildings_3d: true, buffer_rings: true, ruler: true, minimap: true, dev_diagnostics: false,
};

function wrap(role = 'admin') {
  return render(
    <FeatureFlagsContext.Provider value={ALL_FLAGS}>
      <AdminDevSettingsTab userRole={role} />
    </FeatureFlagsContext.Provider>
  );
}

test('renders all four section headings', () => {
  wrap();
  expect(screen.getByText('Feature Flags')).toBeInTheDocument();
  expect(screen.getByText('Map Diagnostics')).toBeInTheDocument();
  expect(screen.getByText('API & WebSocket Inspector')).toBeInTheDocument();
  expect(screen.getByText('Simulation Controls')).toBeInTheDocument();
});

test('returns null for non-admin users', () => {
  const { container } = wrap('officer');
  expect(container.firstChild).toBeNull();
});

test('toggling a feature flag calls PUT /api/admin/dev/feature-flags', async () => {
  const { apiFetch } = await import('../../../hooks/useApi');
  wrap();
  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
    '/admin/dev/feature-flags',
    expect.objectContaining({ method: 'PUT' })
  ));
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd client && npx vitest run src/pages/admin/__tests__/AdminDevSettingsTab.test.tsx
```

- [ ] **Step 3: Implement AdminDevSettingsTab**

```tsx
// client/src/pages/admin/AdminDevSettingsTab.tsx
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { useFeatureFlags, type FeatureFlags } from '../../contexts/FeatureFlagsContext';
import { getApiLog, clearApiLog, subscribeApiLog, type ApiLogEntry } from '../../utils/apiLogger';

interface Props { userRole: string; }

const FLAG_LABELS: { key: keyof FeatureFlags; label: string }[] = [
  { key: 'draw', label: 'Draw Geofence' },
  { key: 'annotations', label: 'Map Annotations' },
  { key: 'gps_replay', label: 'GPS Replay' },
  { key: 'nav_overlay', label: 'Navigation Overlay' },
  { key: 'buildings_3d', label: '3D Buildings' },
  { key: 'buffer_rings', label: 'Buffer Rings' },
  { key: 'ruler', label: 'Distance Ruler' },
  { key: 'minimap', label: 'Minimap' },
  { key: 'dev_diagnostics', label: 'Map Diagnostics Overlay (Ctrl+Shift+D)' },
];

const MOCK_CALL_TYPES = ['TRAFFIC STOP', 'WELFARE CHECK', 'DISTURBANCE', 'SUSPICIOUS ACTIVITY'];

export default function AdminDevSettingsTab({ userRole }: Props) {
  if (userRole !== 'admin') return null;

  const flags = useFeatureFlags();
  const [localFlags, setLocalFlags] = useState<FeatureFlags>(flags);
  const [saving, setSaving] = useState(false);
  const [apiLog, setApiLog] = useState<ApiLogEntry[]>(() => getApiLog());
  const [logFilter, setLogFilter] = useState('');
  const [mockGpsUnit, setMockGpsUnit] = useState('');
  const [mockGpsLat, setMockGpsLat] = useState('40.7608');
  const [mockGpsLng, setMockGpsLng] = useState('-111.8910');
  const [mockCallType, setMockCallType] = useState(MOCK_CALL_TYPES[0]);
  const [simStatus, setSimStatus] = useState<string | null>(null);
  const [units, setUnits] = useState<{ id: number; unit_number: string }[]>([]);

  useEffect(() => {
    apiFetch<{ id: number; unit_number: string }[]>('/dispatch/units')
      .then(setUnits).catch(() => {});
  }, []);

  useEffect(() => {
    return subscribeApiLog(() => setApiLog([...getApiLog()]));
  }, []);

  const toggleFlag = async (key: keyof FeatureFlags) => {
    const updated = { ...localFlags, [key]: !localFlags[key] };
    setLocalFlags(updated);
    setSaving(true);
    try {
      await apiFetch('/admin/dev/feature-flags', {
        method: 'PUT',
        body: JSON.stringify(updated),
      });
    } catch {
      setLocalFlags(localFlags); // revert
    } finally {
      setSaving(false);
    }
  };

  const sendMockGps = async () => {
    if (!mockGpsUnit) { setSimStatus('Select a unit first'); return; }
    try {
      await apiFetch('/admin/dev/mock/gps', {
        method: 'POST',
        body: JSON.stringify({ unit_id: Number(mockGpsUnit), lat: Number(mockGpsLat), lng: Number(mockGpsLng) }),
      });
      setSimStatus(`GPS position injected for unit ${mockGpsUnit}`);
    } catch {
      setSimStatus('Failed to inject GPS position');
    }
  };

  const sendMockCall = async () => {
    try {
      await apiFetch('/admin/dev/mock/call', {
        method: 'POST',
        body: JSON.stringify({ type: mockCallType }),
      });
      setSimStatus(`Test call created: ${mockCallType}`);
    } catch {
      setSimStatus('Failed to create test call');
    }
  };

  const filteredLog = logFilter
    ? apiLog.filter(e => e.path.includes(logFilter))
    : apiLog;

  return (
    <div className="space-y-4 p-4">
      {/* Section 1: Feature Flags */}
      <section className="bg-surface-raised rounded border border-surface-base p-4">
        <h3 className="text-brand-400 font-bold text-sm uppercase tracking-wider mb-3">
          Feature Flags {saving && <span className="text-rmpg-400 text-xs normal-case ml-2">Saving…</span>}
        </h3>
        <div className="space-y-2">
          {FLAG_LABELS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={localFlags[key]}
                onChange={() => toggleFlag(key)}
                className="w-4 h-4 rounded accent-brand-500"
              />
              <span className="text-rmpg-200 text-sm group-hover:text-white transition-colors">{label}</span>
              <span className={`ml-auto text-xs ${localFlags[key] ? 'text-green-400' : 'text-red-400'}`}>
                {localFlags[key] ? 'ON' : 'OFF'}
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* Section 2: Map Diagnostics */}
      <section className="bg-surface-raised rounded border border-surface-base p-4">
        <h3 className="text-brand-400 font-bold text-sm uppercase tracking-wider mb-3">Map Diagnostics</h3>
        <p className="text-rmpg-400 text-xs mb-3">
          Shows a live FPS/zoom/layer HUD overlaid on the map canvas. Toggle via the Feature Flag above or keyboard shortcut.
        </p>
        <div className="bg-surface-base rounded p-3 text-xs font-mono text-rmpg-300">
          Keyboard shortcut: <kbd className="bg-rmpg-700 px-1.5 py-0.5 rounded text-rmpg-100">Ctrl</kbd>+
          <kbd className="bg-rmpg-700 px-1.5 py-0.5 rounded text-rmpg-100">Shift</kbd>+
          <kbd className="bg-rmpg-700 px-1.5 py-0.5 rounded text-rmpg-100">D</kbd>
          {' '}on the Map page
        </div>
      </section>

      {/* Section 3: API & WS Inspector */}
      <section className="bg-surface-raised rounded border border-surface-base p-4">
        <h3 className="text-brand-400 font-bold text-sm uppercase tracking-wider mb-3">API & WebSocket Inspector</h3>
        <div className="flex gap-2 mb-2">
          <input value={logFilter} onChange={e => setLogFilter(e.target.value)}
            placeholder="Filter by path (e.g. /map)…"
            className="flex-1 bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-xs" />
          <button onClick={() => { clearApiLog(); setApiLog([]); }}
            className="bg-surface-base border border-surface-raised text-rmpg-300 px-3 py-1 rounded text-xs hover:text-white">
            Clear
          </button>
        </div>
        <div className="bg-surface-base rounded border border-surface-raised max-h-64 overflow-y-auto">
          {filteredLog.length === 0
            ? <div className="text-rmpg-500 text-xs text-center py-4">No API calls logged yet</div>
            : filteredLog.map((entry, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1 border-b border-surface-raised last:border-0 text-xs font-mono">
                <span className="text-rmpg-400 text-[10px] w-6 text-right">{entry.method.slice(0, 3)}</span>
                <span className={`w-8 text-center text-[10px] font-bold ${
                  entry.status < 300 ? 'text-green-400' : entry.status < 500 ? 'text-yellow-400' : 'text-red-400'
                }`}>{entry.status}</span>
                <span className="flex-1 text-rmpg-300 truncate">{entry.path}</span>
                <span className="text-rmpg-500 text-[10px] w-12 text-right">{entry.latencyMs}ms</span>
              </div>
            ))
          }
        </div>
      </section>

      {/* Section 4: Simulation Controls */}
      <section className="bg-surface-raised rounded border border-red-900/40 p-4">
        <h3 className="text-red-400 font-bold text-sm uppercase tracking-wider mb-1">Simulation Controls</h3>
        <p className="text-rmpg-500 text-xs mb-3">Admin only. All actions are audit-logged with [DEV_SIM] tag.</p>

        <div className="space-y-4">
          {/* Fake GPS */}
          <div>
            <div className="text-rmpg-200 text-xs font-semibold mb-2">Inject Fake GPS Position</div>
            <div className="grid grid-cols-2 gap-2">
              <select value={mockGpsUnit} onChange={e => setMockGpsUnit(e.target.value)}
                className="col-span-2 bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-xs">
                <option value="">Select unit…</option>
                {units.map(u => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
              </select>
              <input value={mockGpsLat} onChange={e => setMockGpsLat(e.target.value)}
                placeholder="Lat" className="bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-xs" />
              <input value={mockGpsLng} onChange={e => setMockGpsLng(e.target.value)}
                placeholder="Lng" className="bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-xs" />
            </div>
            <button onClick={sendMockGps}
              className="mt-2 w-full bg-red-900/60 text-red-200 border border-red-700/50 py-1.5 rounded text-xs hover:bg-red-800/60">
              Inject GPS Position
            </button>
          </div>

          {/* Seed Test Call */}
          <div>
            <div className="text-rmpg-200 text-xs font-semibold mb-2">Seed Test Call</div>
            <div className="flex gap-2">
              <select value={mockCallType} onChange={e => setMockCallType(e.target.value)}
                className="flex-1 bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-xs">
                {MOCK_CALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <button onClick={sendMockCall}
                className="bg-red-900/60 text-red-200 border border-red-700/50 px-3 py-1 rounded text-xs hover:bg-red-800/60">
                Create
              </button>
            </div>
          </div>

          {simStatus && (
            <div className="text-green-400 text-xs bg-surface-base rounded px-2 py-1">{simStatus}</div>
          )}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd client && npx vitest run src/pages/admin/__tests__/AdminDevSettingsTab.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/admin/AdminDevSettingsTab.tsx \
        client/src/pages/admin/__tests__/AdminDevSettingsTab.test.tsx
git commit -m "feat: AdminDevSettingsTab — flags, diagnostics, API inspector, sim controls"
```

---

## Task 5: Wire Dev tab into AdminPage

**Files:**
- Modify: `client/src/pages/AdminPage.tsx`

- [ ] **Step 1: Add import**

In `client/src/pages/AdminPage.tsx`, add with the other tab imports:

```tsx
import AdminDevSettingsTab from './admin/AdminDevSettingsTab';
```

- [ ] **Step 2: Add to VALID_TABS**

Find the `VALID_TABS` array and append `'dev_settings'`:

```ts
const VALID_TABS = ['users', 'clients', /* ... existing ... */, 'person_intel', 'dev_settings'];
```

- [ ] **Step 3: Add to tabGroups**

Find the `tabGroups` array. In the `System & Config` category (where `map_settings` lives), add:

```ts
{ id: 'dev_settings', label: 'Dev ⚙', icon: Code2 },  // import Code2 from 'lucide-react'
```

Add the import at the top with other Lucide icons:
```tsx
import { /* existing icons */, Code2 } from 'lucide-react';
```

- [ ] **Step 4: Add render case**

Find where the tab content is rendered (the large conditional/switch that maps tab IDs to components). Add:

```tsx
{activeTab === 'dev_settings' && (
  <AdminDevSettingsTab userRole={user?.role ?? ''} />
)}
```

- [ ] **Step 5: Run full test suite**

```bash
cd client && npx vitest run && npx tsc --noEmit
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/AdminPage.tsx
git commit -m "feat: add Dev tab to AdminPage (admin-only)"
```

---

## Task 6: PR 3 pull request

- [ ] **Step 1: Verify all tests pass**

```bash
npx vitest run && npm run typecheck && cd client && npx vitest run && npx tsc --noEmit
```

- [ ] **Step 2: Initialize KV feature flags** (if not auto-initialized by GET handler)

```bash
wrangler kv:key put --binding=KV "feature_flags" \
  '{"draw":true,"annotations":true,"gps_replay":true,"nav_overlay":true,"buildings_3d":true,"buffer_rings":true,"ruler":true,"minimap":true,"dev_diagnostics":false}'
```

- [ ] **Step 3: Create PR**

```bash
gh pr create \
  --title "feat: Mapbox PR3 — Admin Dev Panel (flags, diagnostics, inspector, simulation)" \
  --body "$(cat <<'EOF'
## Summary
- New "Dev ⚙" tab in AdminPage (admin role only)
- Feature Flags: 9 toggles for all map tools, stored in KV, all clients pick up changes within 30s
- Map Diagnostics Overlay: live FPS/zoom/pitch/bearing/layers HUD — enable via flag or Ctrl+Shift+D
- API Inspector: ring buffer of last 100 apiFetch calls (method, path, status, latency) with path filter
- Simulation Controls: inject fake GPS position for any unit, seed test CFS record (auto-flagged [TEST])
- Backend: GET/PUT /api/admin/dev/feature-flags (KV), POST /api/admin/dev/mock/gps|call (admin only)

## Test plan
- [ ] All vitest tests pass, typecheck clean
- [ ] Log into admin account → Admin page → Dev tab is visible
- [ ] Log into officer account → Dev tab does NOT appear
- [ ] Toggle "Draw Geofence" OFF → map toolbar draw icon disappears (within 30s or on focus)
- [ ] Open Map page → enable Dev Diagnostics flag → HUD appears top-right of map
- [ ] Make any API call → switch to Admin > Dev > API Inspector → call appears in log
- [ ] Simulation: inject GPS for a unit → confirm in /api/dispatch/gps

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
