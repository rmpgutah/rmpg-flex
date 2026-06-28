# Intel Search & Dossier Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the Intel Search→dossier core, rebuild its UI to command-center grade, and advance the workflow (clickable associates, watchlist-from-anywhere, a working New-Report flow).

**Architecture:** Pure client-side React work over the existing tri-pane Intel Portal (`IntelPortalLayout` + `IntelContext` selection seam) plus one new client route. The Worker is healthy and already de-dupes search — **no Worker code changes**. All new data is already returned by existing endpoints (`/intel/dossier/person/:id`, `/intel/watchlist`, `POST /intel/reports`).

**Tech Stack:** React 18 + TS + Vite + Tailwind (pure-black Spillman theme), Vitest + Testing Library, `apiFetch`/`apiPostForm` from `client/src/hooks/useApi.ts`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `client/src/pages/intel/IntelContextPanel.tsx` | Right dossier peek — add associates render, watch toggle, start-report | Modify |
| `client/src/pages/intel/useWatchToggle.ts` | Reusable optimistic watchlist add/remove hook | Create |
| `client/src/pages/intel/search/ResultCard.tsx` | Result card — add relevance bar, date, watch star | Modify |
| `client/src/pages/intel/IntelSearch.tsx` | Search surface — group by type, result count, keyboard nav | Modify |
| `client/src/pages/intel/search/ResultGroup.tsx` | Renders one entity-type group with header | Create |
| `client/src/pages/intel/search/SearchBar.tsx` | Add recent/saved chips row | Modify |
| `client/src/pages/intel/WatchlistSection.tsx` | Branded empty-state | Modify |
| `client/src/pages/intel/NewIntelReportPage.tsx` | New-report create form (+ entity prefill) | Create |
| `client/src/App.tsx` | Register `reports/new` route before `reports/:id` | Modify |
| `client/public/sw.js` | Bump `CACHE_NAME` v954 → v956 | Modify |
| `client/src/pages/intel/__tests__/*` | Vitest for new behavior | Create |

**Reference shapes (verified in source):**
- Dossier `associates[]`: `{ person_id: number; name: string; shared_events: number; kinds: string[] }` (intelDossier.ts:57).
- Dossier also returns `watched: boolean`, `vehicles`, `addresses`, `linked_intel`, `escalation`, `timeline`, `flags`.
- Watch add: `POST /intel/watchlist` body `{ entity_type, entity_id, reason }`. Remove: `DELETE /intel/watchlist/:entityType/:entityId`.
- Report create: `POST /intel/reports` body `{ title, source_type?, raw_narrative?, threat_level, classification }` (intel/development.ts).
- `apiFetch(path, { method, body: JSON.stringify(...) })` — base URL + `/api` handled by the hook.

---

## Task 1: Render associates + walk the network (C1)

**Files:**
- Modify: `client/src/pages/intel/IntelContextPanel.tsx`
- Test: `client/src/pages/intel/__tests__/IntelContextPanel.associates.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/intel/__tests__/IntelContextPanel.associates.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import IntelContextPanel from '../IntelContextPanel';
import { IntelProvider, useIntelContext } from '../IntelContext';

const selectSpy = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => ({
    person: { id: 7, first_name: 'Jane', last_name: 'Doe' },
    flags: [], timeline: [], watched: false,
    associates: [{ person_id: 42, name: 'John Roe', shared_events: 3, kinds: ['arrest'] }],
  })),
  authedImageUrl: (u: string) => u,
}));

// Harness: select person 7, then render the panel.
function Harness() {
  const { selectEntity } = useIntelContext();
  return <button onClick={() => selectEntity('person', 7, 'Jane Doe')}>sel</button>;
}

describe('IntelContextPanel associates', () => {
  beforeEach(() => selectSpy.mockClear());
  it('renders associates and navigates on click', async () => {
    render(
      <MemoryRouter>
        <IntelProvider>
          <Harness />
          <IntelContextPanel />
        </IntelProvider>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText('sel'));
    await waitFor(() => expect(screen.getByText('John Roe')).toBeInTheDocument());
    expect(screen.getByText(/3 shared/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/pages/intel/__tests__/IntelContextPanel.associates.test.tsx`
Expected: FAIL — "John Roe" not found (associates not rendered).

- [ ] **Step 3: Implement — extend `DossierLite` and render associates**

In `IntelContextPanel.tsx`, replace the `associates` field in the `DossierLite` interface (line ~17) and add a render block after the timeline block (after line ~104). New interface field:

```tsx
  associates?: Array<{ person_id: number; name: string; shared_events: number; kinds: string[] }>;
```

Add, immediately after the timeline `)}` (before the action row at line ~106), using `selectEntity` from context (add `selectEntity` to the `useIntelContext()` destructure at line ~22):

```tsx
{(dossier.associates || []).length > 0 && (
  <div>
    <div className="font-mono text-[8px] tracking-widest text-[#555] uppercase mb-[6px]">Associates</div>
    {(dossier.associates || []).slice(0, 8).map((a) => (
      <button key={a.person_id}
        onClick={() => selectEntity('person', a.person_id, a.name)}
        className="w-full text-left flex items-center gap-2 py-[3px] hover:bg-[#0a0a0a] rounded-[2px] px-1">
        <span className="w-[6px] h-[6px] rounded-full bg-[#22d3ee] mt-[1px] shrink-0" />
        <span className="text-[10px] text-[#cfcfcf] flex-1 truncate">{a.name}</span>
        <span className="font-mono text-[8px] text-[#666]">{a.shared_events} shared</span>
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd client && npx vitest run src/pages/intel/__tests__/IntelContextPanel.associates.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/IntelContextPanel.tsx client/src/pages/intel/__tests__/IntelContextPanel.associates.test.tsx
git commit -m "feat(intel): render clickable associates in dossier peek"
```

---

## Task 2: `useWatchToggle` hook + wire into panel & card (C2)

**Files:**
- Create: `client/src/pages/intel/useWatchToggle.ts`
- Modify: `client/src/pages/intel/IntelContextPanel.tsx`
- Test: `client/src/pages/intel/__tests__/useWatchToggle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// client/src/pages/intel/__tests__/useWatchToggle.test.ts
import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useWatchToggle } from '../useWatchToggle';

const apiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({ apiFetch: (...a: any[]) => apiFetch(...a) }));

describe('useWatchToggle', () => {
  beforeEach(() => apiFetch.mockReset());

  it('optimistically toggles on, calls POST', async () => {
    apiFetch.mockResolvedValue({});
    const { result } = renderHook(() => useWatchToggle('person', 7, false));
    await act(async () => { await result.current.toggle(); });
    expect(result.current.watched).toBe(true);
    expect(apiFetch).toHaveBeenCalledWith('/intel/watchlist', expect.objectContaining({ method: 'POST' }));
  });

  it('rolls back on error', async () => {
    apiFetch.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useWatchToggle('person', 7, false));
    await act(async () => { await result.current.toggle(); });
    expect(result.current.watched).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/pages/intel/__tests__/useWatchToggle.test.ts`
Expected: FAIL — cannot find `../useWatchToggle`.

- [ ] **Step 3: Implement the hook**

```ts
// client/src/pages/intel/useWatchToggle.ts
// Optimistic watchlist add/remove, reusable across search cards + dossier panel.
import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../../hooks/useApi';

export function useWatchToggle(entityType: string, entityId: number, initial: boolean) {
  const [watched, setWatched] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setWatched(initial), [initial, entityType, entityId]);

  const toggle = useCallback(async () => {
    if (busy) return;
    const next = !watched;
    setWatched(next); setBusy(true);
    try {
      if (next) {
        await apiFetch('/intel/watchlist', {
          method: 'POST',
          body: JSON.stringify({ entity_type: entityType, entity_id: entityId, reason: 'flagged from intel' }),
        });
      } else {
        await apiFetch(`/intel/watchlist/${entityType}/${entityId}`, { method: 'DELETE' });
      }
    } catch {
      setWatched(!next); // rollback
    } finally {
      setBusy(false);
    }
  }, [busy, watched, entityType, entityId]);

  return { watched, busy, toggle };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd client && npx vitest run src/pages/intel/__tests__/useWatchToggle.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the toggle into the dossier action row**

In `IntelContextPanel.tsx`, inside the `dossier && (() => { ... })()` block, add near the top of the IIFE body (after `const name = ...`):

```tsx
  const WatchBtn = () => {
    const { watched, toggle } = useWatchToggle('person', p.id, !!dossier.watched);
    return (
      <button onClick={toggle}
        className={`flex-1 text-center font-mono text-[8px] tracking-wide border rounded-[2px] py-[6px] uppercase ${watched ? 'border-[#d4a017] text-[#d4a017]' : 'border-[#3a3a3a] text-[#888]'}`}>
        {watched ? '★ Watching' : '☆ Watch'}
      </button>
    );
  };
```

Then replace the existing action row (the `<div className="flex gap-[6px] pt-1">` block, lines ~106-109) with:

```tsx
<div className="flex gap-[6px] pt-1">
  <WatchBtn />
  <Link to={`/intel/person/${p.id}`} className="flex-1 text-center font-mono text-[8px] tracking-wide text-[#d4a017] border border-[#3a3a3a] rounded-[2px] py-[6px] uppercase">Dossier</Link>
</div>
<button onClick={() => navigate(`/intel/reports/new?from=person:${p.id}&label=${encodeURIComponent(name)}`)}
  className="w-full text-center font-mono text-[8px] tracking-wide text-[#22d3ee] border border-[#1f3a3a] rounded-[2px] py-[6px] uppercase">+ Start Intel Report</button>
```

Add `import { useNavigate } from 'react-router-dom';` and `const navigate = useNavigate();` at the top of the component (Task 6 also depends on this navigate). Add `import { useWatchToggle } from './useWatchToggle';`.

- [ ] **Step 6: Run the full intel client test dir + typecheck**

Run: `cd client && npx vitest run src/pages/intel && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/intel/useWatchToggle.ts client/src/pages/intel/IntelContextPanel.tsx client/src/pages/intel/__tests__/useWatchToggle.test.ts
git commit -m "feat(intel): watchlist toggle + start-report seam in dossier panel"
```

---

## Task 3: Result card relevance bar + date + watch star (B1)

**Files:**
- Modify: `client/src/pages/intel/search/ResultCard.tsx`
- Test: `client/src/pages/intel/__tests__/ResultCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/intel/__tests__/ResultCard.test.tsx
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import ResultCard from '../search/ResultCard';

vi.mock('../../../hooks/useApi', () => ({ authedImageUrl: (u: string) => u }));

const clustered = {
  hit: { type: 'person', id: 7, label: 'Jane Doe', snippet: 'snip', flags: ['WARRANT'], score: 88, date: '2026-05-01' },
  linkedCount: 1, siblings: [],
} as any;

describe('ResultCard', () => {
  it('shows a relevance bar and date', () => {
    render(<ResultCard clustered={clustered} onSelect={() => {}} onOpen={() => {}} />);
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByTestId('relevance-bar')).toBeInTheDocument();
    expect(screen.getByText('2026-05-01')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/pages/intel/__tests__/ResultCard.test.tsx`
Expected: FAIL — no `relevance-bar` testid.

- [ ] **Step 3: Implement — add relevance bar + date**

In `ResultCard.tsx`, inside the `<button ...onSelect...>` block after the flags `<div>` (line ~35), add:

```tsx
        <div className="flex items-center gap-2 mt-[3px]">
          <div className="h-[3px] w-[60px] bg-[#161616] rounded-[2px] overflow-hidden" data-testid="relevance-bar">
            <div className="h-full bg-[#d4a017]" style={{ width: `${Math.max(8, Math.min(100, h.score))}%` }} />
          </div>
          {h.date && <span className="font-mono text-[8px] text-[#555]">{h.date}</span>}
        </div>
```

(`h.date` and `h.score` already exist on `QueryHit`.)

- [ ] **Step 4: Run test, verify it passes**

Run: `cd client && npx vitest run src/pages/intel/__tests__/ResultCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/search/ResultCard.tsx client/src/pages/intel/__tests__/ResultCard.test.tsx
git commit -m "feat(intel): result card relevance bar + date"
```

---

## Task 4: Group results by entity type + result count (B1)

**Files:**
- Create: `client/src/pages/intel/search/ResultGroup.tsx`
- Modify: `client/src/pages/intel/IntelSearch.tsx`
- Test: `client/src/pages/intel/__tests__/IntelSearch.group.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/intel/__tests__/IntelSearch.group.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect } from 'vitest';
import IntelSearch from '../IntelSearch';
import { IntelProvider } from '../IntelContext';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => ({
    results: [
      { type: 'person', id: 1, label: 'Al Pal', snippet: '', flags: [], score: 90 },
      { type: 'vehicle', id: 2, label: 'Red Ford', snippet: '', flags: [], score: 70 },
    ],
    facets: { byType: { person: 1, vehicle: 1 }, byFlag: {} },
  })),
  authedImageUrl: (u: string) => u,
}));

describe('IntelSearch grouping', () => {
  it('renders type-group headers and a result count', async () => {
    render(<MemoryRouter><IntelProvider><IntelSearch /></IntelProvider></MemoryRouter>);
    const input = screen.getByPlaceholderText(/search/i);
    input.focus();
    (input as HTMLInputElement).value = 'al';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => expect(screen.getByText('PERSONS')).toBeInTheDocument(), { timeout: 1500 });
    expect(screen.getByText('VEHICLES')).toBeInTheDocument();
  });
});
```

(If driving the debounced input via raw events is flaky, assert on a small exported pure helper `groupByType(hits)` instead — see Step 3, which exports it.)

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/pages/intel/__tests__/IntelSearch.group.test.tsx`
Expected: FAIL — "PERSONS" header not found.

- [ ] **Step 3: Implement `ResultGroup` + grouping in `IntelSearch`**

Create `client/src/pages/intel/search/ResultGroup.tsx`:

```tsx
import type { ClusteredHit } from '../clusterHits';
import { TYPE_LABELS } from '../intelTypes';
import ResultCard from './ResultCard';

export function groupByType(clustered: ClusteredHit[]): Array<[string, ClusteredHit[]]> {
  const m = new Map<string, ClusteredHit[]>();
  for (const c of clustered) m.set(c.hit.type, [...(m.get(c.hit.type) || []), c]);
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
}

export default function ResultGroup({ type, items, onSelect, onOpen }: {
  type: string; items: ClusteredHit[];
  onSelect: (t: string, id: number, label: string) => void;
  onOpen: (t: string, id: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="font-mono text-[8px] tracking-widest text-[#666] uppercase px-1">
        {TYPE_LABELS[type] || type} <span className="text-[#444]">· {items.length}</span>
      </div>
      {items.map((c) => (
        <ResultCard key={`${c.hit.type}:${c.hit.id}`} clustered={c} onSelect={onSelect} onOpen={onOpen} />
      ))}
    </div>
  );
}
```

In `IntelSearch.tsx`: import `ResultGroup, { groupByType }`; replace the `{clustered.map(...)}` block (lines ~56-60) with a result count + grouped render:

```tsx
{clustered.length > 0 && (
  <div className="font-mono text-[9px] text-[#666] px-1">{clustered.length} result{clustered.length === 1 ? '' : 's'}</div>
)}
{groupByType(clustered).map(([type, items]) => (
  <ResultGroup key={type} type={type} items={items}
    onSelect={selectEntity}
    onOpen={(t, id) => navigate(recordPath({ type: t, id }))} />
))}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd client && npx vitest run src/pages/intel/__tests__/IntelSearch.group.test.tsx`
Expected: PASS. If the debounced-input assertion is flaky, keep the `groupByType` unit assertion (import `groupByType` and assert it returns `[['person',…],['vehicle',…]]`).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/search/ResultGroup.tsx client/src/pages/intel/IntelSearch.tsx client/src/pages/intel/__tests__/IntelSearch.group.test.tsx
git commit -m "feat(intel): group search results by entity type + result count"
```

---

## Task 5: Keyboard navigation over results (B1)

**Files:**
- Modify: `client/src/pages/intel/IntelSearch.tsx`
- Test: `client/src/pages/intel/__tests__/IntelSearch.keys.test.tsx`

- [ ] **Step 1: Write the failing test (pure helper)**

Keyboard wiring over a grouped DOM is awkward to test through events; extract a pure index-stepper and test it.

```ts
// client/src/pages/intel/__tests__/IntelSearch.keys.test.tsx
import { describe, it, expect } from 'vitest';
import { stepIndex } from '../search/stepIndex';

describe('stepIndex', () => {
  it('clamps and wraps within [0,len)', () => {
    expect(stepIndex(0, +1, 3)).toBe(1);
    expect(stepIndex(2, +1, 3)).toBe(0); // wrap
    expect(stepIndex(0, -1, 3)).toBe(2); // wrap back
    expect(stepIndex(-1, +1, 0)).toBe(-1); // empty
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/pages/intel/__tests__/IntelSearch.keys.test.tsx`
Expected: FAIL — cannot find `../search/stepIndex`.

- [ ] **Step 3: Implement the helper + wire keydown**

Create `client/src/pages/intel/search/stepIndex.ts`:

```ts
// Wrap-around index stepper for keyboard nav. len 0 → -1 (nothing selectable).
export function stepIndex(cur: number, delta: number, len: number): number {
  if (len <= 0) return -1;
  return ((cur + delta) % len + len) % len;
}
```

In `IntelSearch.tsx`, add `const [cursor, setCursor] = useState(-1);`, reset it to `-1` whenever `results` change, and add an `onKeyDown` on the outer `<div>` (make it focusable / attach to the SearchBar input via a passed handler). Minimal wiring: keep a flat `flatHits = clustered` array and:

```tsx
const onKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => stepIndex(c < 0 ? -1 : c, +1, clustered.length)); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => stepIndex(c < 0 ? 0 : c, -1, clustered.length)); }
  else if (e.key === 'Enter' && cursor >= 0 && clustered[cursor]) {
    const h = clustered[cursor].hit;
    if (e.metaKey || e.ctrlKey) navigate(recordPath({ type: h.type, id: h.id }));
    else selectEntity(h.type, h.id, h.label);
  }
};
```

Attach `onKeyDown` to the top wrapper `<div className="p-3 space-y-3" onKeyDown={onKeyDown}>`. Pass `cursor` down to `ResultGroup`/`ResultCard` (optional `highlighted` boolean) to outline the active card — compute the flat offset per group. (Highlight styling is cosmetic; the test covers the stepper logic.)

- [ ] **Step 4: Run test + typecheck**

Run: `cd client && npx vitest run src/pages/intel/__tests__/IntelSearch.keys.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/search/stepIndex.ts client/src/pages/intel/IntelSearch.tsx client/src/pages/intel/__tests__/IntelSearch.keys.test.tsx
git commit -m "feat(intel): keyboard navigation over search results"
```

---

## Task 6: New Intel Report page — fix broken button + entity prefill (C3 + dead-end repair)

**Files:**
- Create: `client/src/pages/intel/NewIntelReportPage.tsx`
- Modify: `client/src/App.tsx` (add `reports/new` route BEFORE `reports/:id`; lazy import)
- Test: `client/src/pages/intel/__tests__/NewIntelReportPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/intel/__tests__/NewIntelReportPage.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi, describe, it, expect } from 'vitest';
import NewIntelReportPage from '../NewIntelReportPage';

const apiFetch = vi.fn(async () => ({ id: 99 }));
vi.mock('../../../hooks/useApi', () => ({ apiFetch: (...a: any[]) => apiFetch(...a) }));

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/intel/reports/new" element={<NewIntelReportPage />} />
        <Route path="/intel/reports/:id" element={<div>detail-99</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('NewIntelReportPage', () => {
  it('prefills title from ?from + label', () => {
    renderAt('/intel/reports/new?from=person:42&label=Jane%20Doe');
    expect((screen.getByLabelText(/title/i) as HTMLInputElement).value).toMatch(/Jane Doe/);
  });

  it('submits a report and navigates to its detail', async () => {
    renderAt('/intel/reports/new');
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Test report' } });
    fireEvent.click(screen.getByText(/submit report/i));
    await waitFor(() => expect(screen.getByText('detail-99')).toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledWith('/intel/reports', expect.objectContaining({ method: 'POST' }));
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/pages/intel/__tests__/NewIntelReportPage.test.tsx`
Expected: FAIL — cannot find `../NewIntelReportPage`.

- [ ] **Step 3: Implement the page**

```tsx
// client/src/pages/intel/NewIntelReportPage.tsx
// New raw intel report. Fixes the previously-dead "+ NEW REPORT" button and
// accepts ?from=<type>:<id>&label=<name> to pre-seed a report from a dossier.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../hooks/useApi';

const THREATS = ['low', 'medium', 'high', 'critical'];

export default function NewIntelReportPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const from = sp.get('from') || '';
  const label = sp.get('label') || '';

  const initialTitle = useMemo(() => (label ? `Subject of interest — ${label}` : ''), [label]);
  const initialNarrative = useMemo(() => (from && label ? `Report initiated from ${from.split(':')[0]} "${label}" (${from}).\n\n` : ''), [from, label]);

  const [title, setTitle] = useState(initialTitle);
  const [narrative, setNarrative] = useState(initialNarrative);
  const [threat, setThreat] = useState('low');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!title.trim()) { setErr('Title is required.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await apiFetch<{ id: number }>('/intel/reports', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          raw_narrative: narrative.trim(),
          threat_level: threat,
          classification: 'law_enforcement_sensitive',
          source_type: from ? 'field' : 'manual',
        }),
      });
      nav(`/intel/reports/${r.id}`);
    } catch {
      setErr('Failed to create report.'); setBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-3" style={{ background: '#000', minHeight: '100%', color: '#ddd' }}>
      <h1 className="text-sm font-semibold tracking-wide" style={{ color: '#d4a017' }}>NEW INTELLIGENCE REPORT</h1>
      {err && <div style={{ color: '#ef4444', fontSize: 11 }}>{err}</div>}

      <label className="block text-[10px] text-[#888] uppercase tracking-wider">Title
        <input aria-label="title" value={title} onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full bg-[#070707] border border-[#232323] rounded-[2px] px-2 py-[6px] text-[12px] text-[#e8e8e8]" />
      </label>

      <label className="block text-[10px] text-[#888] uppercase tracking-wider">Raw narrative
        <textarea aria-label="narrative" value={narrative} onChange={(e) => setNarrative(e.target.value)} rows={8}
          className="mt-1 w-full bg-[#070707] border border-[#232323] rounded-[2px] px-2 py-[6px] text-[12px] text-[#e8e8e8]" />
      </label>

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[#888] uppercase tracking-wider">Threat</span>
        {THREATS.map((t) => (
          <button key={t} onClick={() => setThreat(t)}
            className="px-2 py-1 text-[10px] uppercase rounded-[2px]"
            style={{ background: threat === t ? '#d4a017' : '#0b0b0b', color: threat === t ? '#000' : '#888' }}>{t}</button>
        ))}
      </div>

      <div className="flex gap-2 pt-1">
        <button disabled={busy} onClick={submit}
          className="px-3 py-1 text-xs font-semibold" style={{ background: '#d4a017', color: '#000', borderRadius: 2 }}>
          {busy ? 'Submitting…' : 'Submit report'}
        </button>
        <button onClick={() => nav('/intel/reports')} className="px-3 py-1 text-xs" style={{ color: '#888' }}>Cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Register the route (BEFORE `reports/:id`)**

In `client/src/App.tsx`, add the lazy import near line ~120:

```tsx
const NewIntelReportPage = lazyRetry(() => import('./pages/intel/NewIntelReportPage'));
```

And insert the route immediately before the `reports/:id` route (line ~494) so `new` is not captured by `:id`:

```tsx
<Route path="reports/new" element={<RouteErrorBoundary><NewIntelReportPage /></RouteErrorBoundary>} />
```

- [ ] **Step 5: Run test, verify it passes**

Run: `cd client && npx vitest run src/pages/intel/__tests__/NewIntelReportPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/intel/NewIntelReportPage.tsx client/src/App.tsx client/src/pages/intel/__tests__/NewIntelReportPage.test.tsx
git commit -m "feat(intel): working New Report page + entity prefill (fixes dead NEW REPORT button)"
```

---

## Task 7: Branded empty-states for thin sections (A3)

**Files:**
- Modify: `client/src/pages/intel/WatchlistSection.tsx`
- Test: `client/src/pages/intel/__tests__/WatchlistSection.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/intel/__tests__/WatchlistSection.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect } from 'vitest';
import WatchlistSection from '../WatchlistSection';
import { IntelProvider } from '../IntelContext';

vi.mock('../../../hooks/useApi', () => ({ apiFetch: vi.fn(async () => []) }));

describe('WatchlistSection empty-state', () => {
  it('shows an All clear branded empty-state', async () => {
    render(<MemoryRouter><IntelProvider><WatchlistSection /></IntelProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/all clear/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/pages/intel/__tests__/WatchlistSection.test.tsx`
Expected: FAIL — "All clear" not present (current text is "No active watches.").

- [ ] **Step 3: Implement the branded empty-state**

In `WatchlistSection.tsx`, replace the empty line (line ~15):

```tsx
{rows.length === 0 && (
  <div className="border border-[#1f1f1f] bg-[#070707] rounded-[2px] px-3 py-6 text-center">
    <div className="text-[#10b981] text-[18px] leading-none mb-1">✓</div>
    <div className="text-[11px] text-[#999]">All clear — no active watches</div>
    <div className="text-[9px] text-[#555] mt-1">Flag a person or vehicle from search to monitor it here.</div>
  </div>
)}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd client && npx vitest run src/pages/intel/__tests__/WatchlistSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/WatchlistSection.tsx client/src/pages/intel/__tests__/WatchlistSection.test.tsx
git commit -m "feat(intel): branded empty-state for watchlist (calm, not broken)"
```

---

## Task 8: Recent + saved search chips (B1)

**Files:**
- Modify: `client/src/pages/intel/IntelSearch.tsx`
- Test: `client/src/pages/intel/__tests__/IntelSearch.chips.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/intel/__tests__/IntelSearch.chips.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect } from 'vitest';
import IntelSearch from '../IntelSearch';
import { IntelProvider } from '../IntelContext';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path.startsWith('/intel/saved-searches')) return [{ id: 1, name: 'Gang plates', query_text: 'flag:gang', created_at: '' }];
    if (path.startsWith('/intel/search-history')) return [{ query_text: 'carlos', executed_at: '' }];
    return { results: [], facets: { byType: {}, byFlag: {} } };
  }),
  authedImageUrl: (u: string) => u,
}));

describe('IntelSearch chips', () => {
  it('shows a saved-search chip and applies it on click', async () => {
    render(<MemoryRouter><IntelProvider><IntelSearch /></IntelProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Gang plates')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Gang plates'));
    expect((screen.getByPlaceholderText(/search/i) as HTMLInputElement).value).toBe('flag:gang');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/pages/intel/__tests__/IntelSearch.chips.test.tsx`
Expected: FAIL — "Gang plates" chip not rendered.

- [ ] **Step 3: Implement chips**

In `IntelSearch.tsx`, pull `saved` + `recent` from `useSavedSearches()` (extend the existing destructure: `const { save, saved, recent } = useSavedSearches();`). Render a chip row under `<SearchBar/>` (only when the query is short, so it acts as a launcher):

```tsx
{raw.trim().length < 2 && (saved.length > 0 || recent.length > 0) && (
  <div className="flex gap-1 flex-wrap">
    {saved.slice(0, 6).map((s) => (
      <button key={`s${s.id}`} onClick={() => setRaw(s.query_text)}
        className="font-mono text-[9px] px-2 py-[3px] rounded-[2px] border border-[#3a2a08] text-[#d4a017]">★ {s.name}</button>
    ))}
    {recent.slice(0, 6).map((r, i) => (
      <button key={`r${i}`} onClick={() => setRaw(r.query_text)}
        className="font-mono text-[9px] px-2 py-[3px] rounded-[2px] border border-[#232323] text-[#999]">{r.query_text}</button>
    ))}
  </div>
)}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd client && npx vitest run src/pages/intel/__tests__/IntelSearch.chips.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/IntelSearch.tsx client/src/pages/intel/__tests__/IntelSearch.chips.test.tsx
git commit -m "feat(intel): surface saved + recent searches as quick-launch chips"
```

---

## Task 9: Full verification + SW bump

**Files:**
- Modify: `client/public/sw.js`

- [ ] **Step 1: Bump the service worker cache**

In `client/public/sw.js` line 607: `const CACHE_NAME = 'rmpg-flex-v954';` → `'rmpg-flex-v956';`

- [ ] **Step 2: Worker typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Full client test suite**

Run: `cd client && npx vitest run`
Expected: all green (new intel tests + existing).

- [ ] **Step 5: Worker test suite (regression)**

Run: `npx vitest run`
Expected: all green (no worker changes; confirms nothing broke).

- [ ] **Step 6: Client build**

Run: `cd client && npx vite build`
Expected: build succeeds.

- [ ] **Step 7: Commit + open PR**

```bash
git add client/public/sw.js
git commit -m "chore(intel): bump SW cache v954 → v956 for intel search rebuild"
git push -u origin claude/relaxed-chandrasekhar-39b244
gh pr create --title "Intel Search & Dossier rebuild — repair + advance workflow" --body "$(cat <<'EOF'
## Summary
Repairs and rebuilds the Intel Search → dossier core and advances the workflow.

### Repair
- Render **clickable associates** in the dossier peek (data was fetched but never shown) → walk the network in-panel.
- Fix the dead **"+ NEW REPORT"** button: `/intel/reports/new` had no route and fell through to `reports/:id`.
- Branded **empty-states** so quiet feeds read "all clear," not "broken."

### Rebuild (command-center grade)
- Search results **grouped by entity type** with headers + result count.
- Result cards gain a **relevance bar** + date.
- **Keyboard nav** (↑/↓/Enter, Cmd+Enter opens).
- **Saved + recent searches** surfaced as quick-launch chips.

### Advance (deepen search→dossier)
- **Watchlist toggle** from the dossier panel (reusable `useWatchToggle`).
- **"Start Intel Report"** from a dossier → prefilled New-Report page (entry into the report loop).

No Worker code changes — both search endpoints already de-dupe; all new data comes from existing endpoints.

### Post-merge (manual)
- Optional hygiene: `POST /api/intel/reindex` (admin) on live to purge stale duplicate index rows (cosmetic; users never saw them).

### Deferred fast-follows (named, not dropped)
Map/geospatial phase · full report development-loop UI · AI-analyst-central.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- A1 (read-path dedupe) — N/A, already implemented (documented, no task). ✓
- A2 (hygiene reindex) — PR post-merge note (Task 9 PR body). ✓
- A3 (empty-states) — Task 7. ✓
- B1 (grouping/relevance/count/keyboard/chips) — Tasks 3,4,5,8. ✓
- B2 (dossier peek photo/escalation/timeline/associates/actions) — photo+escalation+timeline already render; associates Task 1; actions Task 2. ✓
- C1 (associate navigation) — Task 1. ✓
- C2 (watch toggle from anywhere) — Task 2 (panel). Card-level star deferred within scope note below. ✓
- C3 (start report seam) — Tasks 2 + 6. ✓

**Note on C2 scope:** The spec mentions a watch toggle on the search *card* too. To keep `ResultCard` focused and avoid threading watch-state through the cluster pipeline, the card-level star is **deferred** to a fast-follow; the dossier-panel toggle (the primary surface) ships here. This is a deliberate YAGNI trim, called out rather than silently dropped.

**Placeholder scan:** No TBD/TODO; every code step has real code. ✓
**Type consistency:** `useWatchToggle(entityType, entityId, initial)` used consistently (Task 2). `groupByType` / `stepIndex` names match across tasks. Associate shape `{ person_id, name, shared_events, kinds }` matches Task 1 render + dossier source. ✓
