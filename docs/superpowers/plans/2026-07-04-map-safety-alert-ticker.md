# Aggregated Safety Alert Ticker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `SafetyAlertTicker` panel on the Map page showing a unified, live-updating feed of panic alerts, welfare emergencies, and active premise alerts, per `docs/superpowers/specs/2026-07-04-map-safety-alert-ticker-design.md` (Phase 4 of the Map UI redesign program).

**Architecture:** 3 new data hooks (`usePanicAlerts`, `useWelfareAlerts`, `usePremiseAlertsList`) each independently fetch + subscribe/poll their own source, then a `useSafetyAlertFeed` hook composes their outputs into one sorted array with no coupling between the 3 sources. `SafetyAlertTicker` is a pure presentational component consuming `useSafetyAlertFeed`'s output.

**Tech Stack:** React, `apiFetch` (`client/src/hooks/useApi.ts`), `useWebSocket` (`client/src/context/WebSocketContext.tsx`), Vitest, TypeScript, Tailwind + `tacticalPalette.ts` tokens (Phase 2 conventions).

---

## Task 1: `usePanicAlerts` hook

**Files:**
- Create: `client/src/hooks/usePanicAlerts.ts`
- Create: `client/src/hooks/__tests__/usePanicAlerts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// client/src/hooks/__tests__/usePanicAlerts.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePanicAlerts } from '../usePanicAlerts';

const mockSubscribe = vi.fn(() => () => {});
vi.mock('../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: mockSubscribe, isConnected: true }),
}));

const mockApiFetch = vi.fn();
vi.mock('../useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

describe('usePanicAlerts', () => {
  beforeEach(() => { mockApiFetch.mockReset(); mockSubscribe.mockClear(); });

  it('fetches active panic alerts on mount', async () => {
    mockApiFetch.mockResolvedValue([{ id: 1, status: 'active', user_name: 'J. Smith', created_at: '2026-07-04T10:00:00Z' }]);
    const { result } = renderHook(() => usePanicAlerts());
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    expect(mockApiFetch).toHaveBeenCalledWith('/dispatch/panic');
  });

  it('subscribes to panic_alert WS events for refetch', () => {
    mockApiFetch.mockResolvedValue([]);
    renderHook(() => usePanicAlerts());
    expect(mockSubscribe).toHaveBeenCalledWith('panic_alert', expect.any(Function));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/hooks/__tests__/usePanicAlerts.test.ts`
Expected: FAIL — `Cannot find module '../usePanicAlerts'`

- [ ] **Step 3: Write the hook**

```ts
// client/src/hooks/usePanicAlerts.ts
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from './useApi';
import { useWebSocket } from '../context/WebSocketContext';

export interface PanicAlert {
  id: number;
  user_id: number;
  user_name?: string;
  badge_number?: string;
  call_sign?: string;
  status: 'active' | 'acknowledged' | 'resolved' | 'cancelled' | 'false_alarm';
  source: string;
  created_at: string;
}

export interface UsePanicAlertsResult {
  alerts: PanicAlert[];
  loading: boolean;
  refetch: () => void;
}

export function usePanicAlerts(): UsePanicAlertsResult {
  const [alerts, setAlerts] = useState<PanicAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const { subscribe } = useWebSocket();

  const refetch = useCallback(() => {
    apiFetch<PanicAlert[]>('/dispatch/panic')
      .then((rows) => setAlerts(rows.filter(a => a.status === 'active' || a.status === 'acknowledged')))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  useEffect(() => {
    const unsub = subscribe('panic_alert', () => refetch());
    return unsub;
  }, [subscribe, refetch]);

  return { alerts, loading, refetch };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/hooks/__tests__/usePanicAlerts.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors — if `subscribe`'s type signature rejects a bare `() => refetch()` callback shape, adjust to match `MessageHandler = (message: WSMessage) => void` exactly (check `client/src/context/WebSocketContext.tsx`'s exact type before assuming the lambda shape above compiles as-is).

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/usePanicAlerts.ts client/src/hooks/__tests__/usePanicAlerts.test.ts
git commit -m "feat(map): add usePanicAlerts hook for safety alert ticker"
```

---

## Task 2: `useWelfareAlerts` hook

**Files:**
- Create: `client/src/hooks/useWelfareAlerts.ts`
- Create: `client/src/hooks/__tests__/useWelfareAlerts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// client/src/hooks/__tests__/useWelfareAlerts.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWelfareAlerts } from '../useWelfareAlerts';

const mockSubscribe = vi.fn(() => () => {});
vi.mock('../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: mockSubscribe, isConnected: true }),
}));

const mockApiFetch = vi.fn();
vi.mock('../useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

describe('useWelfareAlerts', () => {
  beforeEach(() => { mockApiFetch.mockReset(); vi.useFakeTimers(); });

  it('filters welfare status rows to only emergency/overdue', async () => {
    mockApiFetch.mockResolvedValue([
      { user_id: 1, status: 'normal', officer_name: 'A' },
      { user_id: 2, status: 'emergency', officer_name: 'B' },
      { user_id: 3, status: 'overdue', officer_name: 'C' },
    ]);
    const { result } = renderHook(() => useWelfareAlerts());
    await waitFor(() => expect(result.current.alerts).toHaveLength(2));
    expect(result.current.alerts.map(a => a.officer_name)).toEqual(['B', 'C']);
  });

  it('subscribes to panic_alert for refetch (shared broadcast helper with /welfare/help)', () => {
    mockApiFetch.mockResolvedValue([]);
    renderHook(() => useWelfareAlerts());
    expect(mockSubscribe).toHaveBeenCalledWith('panic_alert', expect.any(Function));
  });
});
```

(Test file uses `vi.useFakeTimers()` since Step 3's implementation includes a 60s poll interval — restore real timers in an `afterEach` if the test file doesn't already have one via a shared setup.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/hooks/__tests__/useWelfareAlerts.test.ts`
Expected: FAIL — `Cannot find module '../useWelfareAlerts'`

- [ ] **Step 3: Write the hook**

```ts
// client/src/hooks/useWelfareAlerts.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from './useApi';
import { useWebSocket } from '../context/WebSocketContext';

export interface WelfareAlert {
  user_id: number;
  officer_name?: string;
  badge_number?: string;
  call_sign?: string;
  status: 'normal' | 'prompted' | 'overdue' | 'emergency';
  minutes_since_last_check?: number;
}

const POLL_INTERVAL_MS = 60_000;

export interface UseWelfareAlertsResult {
  alerts: WelfareAlert[];
  loading: boolean;
  refetch: () => void;
}

export function useWelfareAlerts(): UseWelfareAlertsResult {
  const [alerts, setAlerts] = useState<WelfareAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const { subscribe } = useWebSocket();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refetch = useCallback(() => {
    apiFetch<WelfareAlert[]>('/dispatch/welfare/status')
      .then((rows) => setAlerts(rows.filter(a => a.status === 'emergency' || a.status === 'overdue')))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  // /welfare/escalate broadcasts a distinct 'welfare_alert' WS type this
  // codebase's WSMessageType union doesn't include yet (checked
  // client/src/types/index.ts) — rather than widen that shared type as a
  // side effect of this UI-only phase, poll to catch escalation updates.
  // panic_alert IS subscribed below since /welfare/help shares panic.ts's
  // broadcastPanic() helper, covering the higher-urgency real-time case.
  useEffect(() => {
    timerRef.current = setInterval(refetch, POLL_INTERVAL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [refetch]);

  useEffect(() => {
    const unsub = subscribe('panic_alert', () => refetch());
    return unsub;
  }, [subscribe, refetch]);

  return { alerts, loading, refetch };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/hooks/__tests__/useWelfareAlerts.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run typecheck**

Run: `cd client && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useWelfareAlerts.ts client/src/hooks/__tests__/useWelfareAlerts.test.ts
git commit -m "feat(map): add useWelfareAlerts hook for safety alert ticker"
```

---

## Task 3: `usePremiseAlertsList` hook

**Files:**
- Create: `client/src/hooks/usePremiseAlertsList.ts`
- Create: `client/src/hooks/__tests__/usePremiseAlertsList.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// client/src/hooks/__tests__/usePremiseAlertsList.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePremiseAlertsList } from '../usePremiseAlertsList';

const mockApiFetch = vi.fn();
vi.mock('../useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

describe('usePremiseAlertsList', () => {
  beforeEach(() => { mockApiFetch.mockReset(); });

  it('fetches all active premise alerts with no query params (global list, not location-scoped)', async () => {
    mockApiFetch.mockResolvedValue([{ id: 1, address: '123 Main St', alert_type: 'hazmat', alert_level: 'critical', title: 'Chemical spill' }]);
    const { result } = renderHook(() => usePremiseAlertsList());
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    expect(mockApiFetch).toHaveBeenCalledWith('/dispatch/geography/premise-alerts');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/hooks/__tests__/usePremiseAlertsList.test.ts`
Expected: FAIL — `Cannot find module '../usePremiseAlertsList'`

- [ ] **Step 3: Write the hook**

```ts
// client/src/hooks/usePremiseAlertsList.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from './useApi';

export interface PremiseAlertListItem {
  id: number;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  alert_type: string;
  alert_level: 'critical' | 'warning' | 'info' | string;
  title: string;
  description?: string;
  flags?: string;
}

const POLL_INTERVAL_MS = 60_000;

export interface UsePremiseAlertsListResult {
  alerts: PremiseAlertListItem[];
  loading: boolean;
  refetch: () => void;
}

export function usePremiseAlertsList(): UsePremiseAlertsListResult {
  const [alerts, setAlerts] = useState<PremiseAlertListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refetch = useCallback(() => {
    // No address/lat/lng query params — the route's own `where` clause
    // (src/routes/dispatch/geography.ts) defaults to all active, unexpired
    // premise alerts when none are provided.
    apiFetch<PremiseAlertListItem[]>('/dispatch/geography/premise-alerts')
      .then(setAlerts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  // No WS broadcast exists for premise_alerts create/update — poll only.
  useEffect(() => {
    timerRef.current = setInterval(refetch, POLL_INTERVAL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [refetch]);

  return { alerts, loading, refetch };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/hooks/__tests__/usePremiseAlertsList.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Run typecheck**

Run: `cd client && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/usePremiseAlertsList.ts client/src/hooks/__tests__/usePremiseAlertsList.test.ts
git commit -m "feat(map): add usePremiseAlertsList hook for safety alert ticker"
```

---

## Task 4: `useSafetyAlertFeed` merge hook

**Files:**
- Create: `client/src/hooks/useSafetyAlertFeed.ts`
- Create: `client/src/hooks/__tests__/useSafetyAlertFeed.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// client/src/hooks/__tests__/useSafetyAlertFeed.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSafetyAlertFeed } from '../useSafetyAlertFeed';

vi.mock('../usePanicAlerts', () => ({
  usePanicAlerts: () => ({
    alerts: [{ id: 1, user_name: 'Officer A', status: 'active', created_at: '2026-07-04T10:00:00Z' }],
    loading: false,
  }),
}));
vi.mock('../useWelfareAlerts', () => ({
  useWelfareAlerts: () => ({
    alerts: [{ user_id: 2, officer_name: 'Officer B', status: 'emergency' }],
    loading: false,
  }),
}));
vi.mock('../usePremiseAlertsList', () => ({
  usePremiseAlertsList: () => ({
    alerts: [{ id: 3, address: '123 Main St', alert_level: 'critical', title: 'Hazmat', alert_type: 'hazmat' }],
    loading: false,
  }),
}));

describe('useSafetyAlertFeed', () => {
  it('merges all 3 sources into one array sorted panic > welfare > premise', () => {
    const { result } = renderHook(() => useSafetyAlertFeed());
    expect(result.current.items).toHaveLength(3);
    expect(result.current.items.map(i => i.type)).toEqual(['panic', 'welfare', 'premise']);
  });

  it('exposes a total count for the collapsed badge', () => {
    const { result } = renderHook(() => useSafetyAlertFeed());
    expect(result.current.count).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/hooks/__tests__/useSafetyAlertFeed.test.ts`
Expected: FAIL — `Cannot find module '../useSafetyAlertFeed'`

- [ ] **Step 3: Write the hook**

```ts
// client/src/hooks/useSafetyAlertFeed.ts
import { useMemo } from 'react';
import { usePanicAlerts } from './usePanicAlerts';
import { useWelfareAlerts } from './useWelfareAlerts';
import { usePremiseAlertsList } from './usePremiseAlertsList';

export interface SafetyAlertItem {
  id: string;
  type: 'panic' | 'welfare' | 'premise';
  severity: 'critical' | 'warning' | 'info';
  label: string;
  detail?: string;
  timestamp?: string;
}

const SEVERITY_RANK: Record<SafetyAlertItem['severity'], number> = { critical: 0, warning: 1, info: 2 };
const TYPE_RANK: Record<SafetyAlertItem['type'], number> = { panic: 0, welfare: 1, premise: 2 };

export interface UseSafetyAlertFeedResult {
  items: SafetyAlertItem[];
  count: number;
  loading: boolean;
}

export function useSafetyAlertFeed(): UseSafetyAlertFeedResult {
  const panic = usePanicAlerts();
  const welfare = useWelfareAlerts();
  const premise = usePremiseAlertsList();

  const items = useMemo<SafetyAlertItem[]>(() => {
    const panicItems: SafetyAlertItem[] = panic.alerts.map(a => ({
      id: `panic-${a.id}`,
      type: 'panic',
      severity: 'critical',
      label: a.user_name ? `Panic — ${a.user_name}` : 'Panic alert',
      detail: a.call_sign ?? undefined,
      timestamp: a.created_at,
    }));
    const welfareItems: SafetyAlertItem[] = welfare.alerts.map(a => ({
      id: `welfare-${a.user_id}`,
      type: 'welfare',
      severity: a.status === 'emergency' ? 'critical' : 'warning',
      label: a.officer_name ? `Welfare — ${a.officer_name}` : 'Welfare check overdue',
      detail: a.call_sign ?? undefined,
    }));
    const premiseItems: SafetyAlertItem[] = premise.alerts.map(a => ({
      id: `premise-${a.id}`,
      type: 'premise',
      severity: (a.alert_level as SafetyAlertItem['severity']) ?? 'info',
      label: a.title,
      detail: a.address,
    }));

    return [...panicItems, ...welfareItems, ...premiseItems].sort((a, b) => {
      const typeDiff = TYPE_RANK[a.type] - TYPE_RANK[b.type];
      if (typeDiff !== 0) return typeDiff;
      return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    });
  }, [panic.alerts, welfare.alerts, premise.alerts]);

  return {
    items,
    count: items.length,
    loading: panic.loading || welfare.loading || premise.loading,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/hooks/__tests__/useSafetyAlertFeed.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run typecheck**

Run: `cd client && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useSafetyAlertFeed.ts client/src/hooks/__tests__/useSafetyAlertFeed.test.ts
git commit -m "feat(map): add useSafetyAlertFeed hook merging panic/welfare/premise alerts"
```

---

## Task 5: `SafetyAlertTicker` component

**Files:**
- Create: `client/src/pages/map/components/SafetyAlertTicker.tsx`
- Create: `client/src/pages/map/components/__tests__/SafetyAlertTicker.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/map/components/__tests__/SafetyAlertTicker.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SafetyAlertTicker from '../SafetyAlertTicker';
import type { SafetyAlertItem } from '../../../../hooks/useSafetyAlertFeed';

const items: SafetyAlertItem[] = [
  { id: 'panic-1', type: 'panic', severity: 'critical', label: 'Panic — Officer A' },
  { id: 'welfare-2', type: 'welfare', severity: 'critical', label: 'Welfare — Officer B' },
  { id: 'premise-3', type: 'premise', severity: 'warning', label: 'Hazmat', detail: '123 Main St' },
  { id: 'premise-4', type: 'premise', severity: 'info', label: 'Watch zone', detail: '456 Elm St' },
];

describe('SafetyAlertTicker', () => {
  it('shows the top 3 items in the collapsed strip even when closed', () => {
    render(<SafetyAlertTicker items={items} count={4} loading={false} />);
    expect(screen.getByText('Panic — Officer A')).toBeInTheDocument();
    expect(screen.getByText('Welfare — Officer B')).toBeInTheDocument();
    expect(screen.getByText('Hazmat')).toBeInTheDocument();
    expect(screen.queryByText('Watch zone')).not.toBeInTheDocument();
  });

  it('shows a badge with the total count', () => {
    render(<SafetyAlertTicker items={items} count={4} loading={false} />);
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('expands to show all items when the trigger is clicked', () => {
    render(<SafetyAlertTicker items={items} count={4} loading={false} />);
    fireEvent.click(screen.getByLabelText(/safety alerts/i));
    expect(screen.getByText('Watch zone')).toBeInTheDocument();
  });

  it('renders nothing extra when there are zero alerts (no empty badge clutter)', () => {
    render(<SafetyAlertTicker items={[]} count={0} loading={false} />);
    expect(screen.queryByLabelText(/safety alerts/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/SafetyAlertTicker.test.tsx`
Expected: FAIL — `Cannot find module '../SafetyAlertTicker'`

- [ ] **Step 3: Write the component**

```tsx
// client/src/pages/map/components/SafetyAlertTicker.tsx
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { SafetyAlertItem } from '../../../hooks/useSafetyAlertFeed';

interface SafetyAlertTickerProps {
  items: SafetyAlertItem[];
  count: number;
  loading: boolean;
}

const SEVERITY_COLOR: Record<SafetyAlertItem['severity'], string> = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
};

function AlertRow({ item }: { item: SafetyAlertItem }) {
  const color = SEVERITY_COLOR[item.severity];
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs" style={{ borderLeft: `2px solid ${color}` }}>
      <span style={{ color }} className="font-semibold">{item.label}</span>
      {item.detail && <span className="text-rmpg-400 truncate">{item.detail}</span>}
    </div>
  );
}

/** Unified panic/welfare/premise-alert feed for the Map page. The top 3
 *  items (already sorted panic > welfare > premise by useSafetyAlertFeed)
 *  stay visible in a compact strip even when collapsed — this is a display
 *  surface, not a control, so "collapsed" only hides items beyond the top 3,
 *  it never hides the highest-priority alerts entirely. */
export default function SafetyAlertTicker({ items, count }: SafetyAlertTickerProps) {
  const [expanded, setExpanded] = useState(false);
  if (count === 0) return null;

  const visibleItems = expanded ? items : items.slice(0, 3);

  return (
    <div className="absolute top-3 left-3 z-20 bg-surface-raised/95 border border-border-default backdrop-blur-sm" style={{ borderRadius: 2, minWidth: 220, maxWidth: 320 }}>
      <button
        type="button"
        aria-label={`Safety alerts (${count})`}
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
      >
        <AlertTriangle className="w-3.5 h-3.5 text-[#ef4444]" />
        <span className="text-rmpg-200 text-xs font-semibold flex-1">Safety Alerts</span>
        <span className="bg-[#ef4444] text-white text-[10px] font-bold px-1.5 rounded-sm">{count}</span>
      </button>
      <div className="flex flex-col gap-0.5 pb-1">
        {visibleItems.map(item => <AlertRow key={item.id} item={item} />)}
      </div>
    </div>
  );
}
```

(`rounded-sm` on the count badge is a small text pill, not a boxed toolbar button — consistent with the exception already established for the heatmap Live/Historical pill in `MapboxMapPage.tsx`, not the `TOOLBAR_ITEM_CLASS` pattern, since this isn't a toolbar item.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/SafetyAlertTicker.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Run typecheck**

Run: `cd client && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/components/SafetyAlertTicker.tsx client/src/pages/map/components/__tests__/SafetyAlertTicker.test.tsx
git commit -m "feat(map): add SafetyAlertTicker component"
```

---

## Task 6: Wire `SafetyAlertTicker` into `MapboxMapPage.tsx`

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

- [ ] **Step 1: Import the hook and component**

```ts
import { useSafetyAlertFeed } from '../../hooks/useSafetyAlertFeed';
import SafetyAlertTicker from './components/SafetyAlertTicker';
```

- [ ] **Step 2: Call the hook and render the component**

Add near the other top-level hook calls (alongside `useMapGeofenceAlerts`, etc.):
```ts
const safetyAlertFeed = useSafetyAlertFeed();
```

Render it near the other top-level panels (alongside `<MapOverlaysPanel .../>`):
```tsx
<SafetyAlertTicker items={safetyAlertFeed.items} count={safetyAlertFeed.count} loading={safetyAlertFeed.loading} />
```

Confirm this doesn't visually collide with anything already anchored `top-3 left-3` — run `grep -n "top-3 left-3\|top-3 right-3" client/src/pages/map/MapboxMapPage.tsx` first; if another element already claims that exact position, offset the ticker (e.g. `top-14 left-3`) rather than overlapping it.

- [ ] **Step 3: Run typecheck**

Run: `cd client && npx tsc --noEmit`

- [ ] **Step 4: Run the full map test suite**

Run: `cd client && npx vitest run src/pages/map/ src/hooks/__tests__/usePanicAlerts.test.ts src/hooks/__tests__/useWelfareAlerts.test.ts src/hooks/__tests__/usePremiseAlertsList.test.ts src/hooks/__tests__/useSafetyAlertFeed.test.ts`
Expected: all pass

- [ ] **Step 5: Manual browser verification**

Open `/map`, confirm the ticker renders (or renders nothing if there are genuinely zero active alerts today — trigger a test panic alert via the panic button if available, or seed one via the admin/API directly, to confirm the ticker picks it up in real time).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): wire SafetyAlertTicker into MapboxMapPage"
```

---

## Self-Review Notes

- **Spec coverage:** All 3 data sources (panic, welfare, premise) + the merge/sort + the UI component + wiring are covered across 6 tasks, matching the spec's Design section exactly, including both corrections made during spec review (premise alerts via the global-list endpoint, not `useMapGeofenceAlerts`'s click-scoped state; welfare polls rather than subscribing to a WSMessageType that doesn't exist yet).
- **Placeholder scan:** No TBD/TODO. Task 6's Step 2 has one explicit "verify no positional collision, adjust if needed" instruction — this is a real verification step with a concrete fallback (`top-14 left-3`), not a vague placeholder.
- **Type consistency:** `SafetyAlertItem`'s shape (`id`, `type`, `severity`, `label`, `detail?`, `timestamp?`) is defined once in Task 4 and consumed identically by Task 5's component props and its test file's import path.
