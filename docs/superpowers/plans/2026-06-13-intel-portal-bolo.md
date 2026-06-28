# Intel Portal — Phase 3: BOLO Board (UI adoption) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the `/intel/bolos` Coming-Soon placeholder with a command-center-styled BOLO board — a priority-grouped card grid with create / resolve / cancel — consuming the EXISTING `/comms/bolos` API. No new backend, no new table, no changes to `CommunicationsPage`.

**Architecture:** A small `useBolos` hook wraps the existing `bolosRouter` endpoints (`GET /comms/bolos`, `POST /comms/bolos`, `PUT /comms/bolos/:id`, `DELETE /comms/bolos/:id`). `BoloBoard` renders cards grouped by priority (P1/P2/P3) with an Active/All filter and a create modal. It mounts inside the existing `IntelPortalLayout` (so it inherits the rail + context panel chrome). The `/intel/bolos` route swaps from `IntelComingSoon` to `BoloBoard`.

**Tech Stack:** React 18 + TS + Vite + Tailwind; `apiFetch` from `client/src/hooks/useApi`; Vitest. No worker changes.

**Existing API contract (verified in `src/routes/dispatch/extensions.ts`):**
- `GET /comms/bolos` → `RawBOLO[]`, server-ordered P1→P2→recent. Fields: `id, bolo_number, type, status, title, description, subject_description, vehicle_description, photo_url, priority, issued_by, issued_by_name, expires_at, created_at`.
- `GET /comms/bolos/active` → active-only (same shape).
- `POST /comms/bolos` → body `{ type, title, description?, subject_description?, vehicle_description?, photo_url?, priority?, expires_at? }`; auto-numbers; returns row (201). Write roles.
- `PUT /comms/bolos/:id` → partial update; `status:'resolved'` is server-mapped to `cancelled`. Write roles.
- `DELETE /comms/bolos/:id` → admin/manager only.
- **Enums:** `type ∈ {person, vehicle, other}`; `status ∈ {active, expired, cancelled}`; `priority` uses CAD scheme `P1/P2/P3` (P1 highest; create defaults `P3`).

**Scope guards:** BOLOs have NO person/vehicle FK, so the board does NOT drive the right context panel (`selectEntity`) — it's a standalone board. No cross-phase dependency on Phase 2 search. No new design tokens beyond the established pure-black/gold/2px set.

**SW:** bump to **v926** (Phase 2 PR uses v925; pick the next free above it to avoid a collision when both merge).

---

## File Structure

**Create (client):**
- `client/src/pages/intel/useBolos.ts` — fetch + create/resolve/remove over `/comms/bolos`
- `client/src/pages/intel/bolo/BoloCard.tsx` — one BOLO card (presentational + action callbacks)
- `client/src/pages/intel/bolo/BoloCreateModal.tsx` — create form
- `client/src/pages/intel/BoloBoard.tsx` — board: filter + priority groups + create + actions
- Tests under `client/src/pages/intel/__tests__/` and `client/src/pages/intel/bolo/__tests__/`

**Modify:**
- `client/src/App.tsx` — `/intel/bolos` → `BoloBoard` (replace `IntelComingSoon`)
- `client/public/sw.js` — bump `CACHE_NAME`

---

## Task 1: `useBolos` hook

**Files:**
- Create: `client/src/pages/intel/useBolos.ts`
- Test: `client/src/pages/intel/__tests__/useBolos.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/intel/__tests__/useBolos.test.tsx`:

```tsx
import { renderHook, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useBolos } from '../useBolos';

const apiFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({ apiFetch: (...a: any[]) => apiFetch(...a) }));

describe('useBolos', () => {
  beforeEach(() => { apiFetch.mockReset(); });

  it('loads bolos from /comms/bolos', async () => {
    apiFetch.mockResolvedValueOnce([
      { id: 1, bolo_number: '26-BOLO-00001', type: 'person', status: 'active', title: 'Wanted', description: null,
        subject_description: 'Tall', vehicle_description: null, photo_url: null, priority: 'P1', issued_by: 5,
        issued_by_name: 'CZ', expires_at: null, created_at: '2026-06-13' },
    ]);
    const { result } = renderHook(() => useBolos());
    await waitFor(() => expect(result.current.bolos.length).toBe(1));
    expect(result.current.bolos[0].title).toBe('Wanted');
  });

  it('create POSTs to /comms/bolos then reloads', async () => {
    apiFetch.mockResolvedValueOnce([]);                 // initial load
    apiFetch.mockResolvedValueOnce({ id: 9 });          // POST
    apiFetch.mockResolvedValueOnce([{ id: 9, bolo_number: '26-BOLO-00009', type: 'vehicle', status: 'active',
      title: 'Red truck', description: null, subject_description: null, vehicle_description: 'Red F150',
      photo_url: null, priority: 'P2', issued_by: 5, issued_by_name: 'CZ', expires_at: null, created_at: 'x' }]); // reload
    const { result } = renderHook(() => useBolos());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.create({ type: 'vehicle', title: 'Red truck', priority: 'P2' }); });
    expect(apiFetch).toHaveBeenCalledWith('/comms/bolos', expect.objectContaining({ method: 'POST' }));
    await waitFor(() => expect(result.current.bolos.some((b) => b.title === 'Red truck')).toBe(true));
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (`../useBolos` missing)

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce/client" && npx vitest run src/pages/intel/__tests__/useBolos.test.tsx`

- [ ] **Step 3: Implement `client/src/pages/intel/useBolos.ts`**

```ts
// Intel BOLO board data hook. Thin wrapper over the EXISTING /comms/bolos
// router (list/create/update/delete). No new backend.
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';

export interface Bolo {
  id: number; bolo_number: string; type: string; status: string; title: string;
  description: string | null; subject_description: string | null; vehicle_description: string | null;
  photo_url: string | null; priority: string; issued_by: number; issued_by_name: string | null;
  expires_at: string | null; created_at: string;
}

export interface BoloCreate {
  type: string; title: string; description?: string; subject_description?: string;
  vehicle_description?: string; priority?: string; expires_at?: string;
}

export function useBolos() {
  const [bolos, setBolos] = useState<Bolo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    apiFetch<Bolo[]>('/comms/bolos')
      .then((r) => { setBolos(Array.isArray(r) ? r : []); setError(null); })
      .catch((e) => setError(e?.message || 'failed to load BOLOs'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(reload, [reload]);

  const create = useCallback(async (payload: BoloCreate) => {
    await apiFetch('/comms/bolos', { method: 'POST', body: JSON.stringify(payload) });
    reload();
  }, [reload]);

  // Server maps status 'resolved' → 'cancelled'; we send 'cancelled' directly.
  const resolve = useCallback(async (id: number) => {
    await apiFetch(`/comms/bolos/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) });
    reload();
  }, [reload]);

  const remove = useCallback(async (id: number) => {
    await apiFetch(`/comms/bolos/${id}`, { method: 'DELETE' });
    reload();
  }, [reload]);

  return { bolos, loading, error, reload, create, resolve, remove };
}
```

- [ ] **Step 4: Run, verify PASS (2 tests)**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce/client" && npx vitest run src/pages/intel/__tests__/useBolos.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/useBolos.ts client/src/pages/intel/__tests__/useBolos.test.tsx
git commit -m "feat(intel): useBolos hook over existing /comms/bolos API"
```

---

## Task 2: `BoloCard` component

**Files:**
- Create: `client/src/pages/intel/bolo/BoloCard.tsx`
- Test: `client/src/pages/intel/bolo/__tests__/BoloCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/intel/bolo/__tests__/BoloCard.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import BoloCard from '../BoloCard';
import type { Bolo } from '../../useBolos';

const bolo: Bolo = {
  id: 1, bolo_number: '26-BOLO-00001', type: 'person', status: 'active', title: 'Wanted subject',
  description: 'Last seen downtown', subject_description: 'Tall, tattoo', vehicle_description: null,
  photo_url: null, priority: 'P1', issued_by: 5, issued_by_name: 'C. Zamora', expires_at: null, created_at: '2026-06-13',
};

describe('BoloCard', () => {
  it('renders title, number, priority, subject and fires resolve', () => {
    const onResolve = vi.fn();
    render(<BoloCard bolo={bolo} canDelete onResolve={onResolve} onDelete={() => {}} />);
    expect(screen.getByText('Wanted subject')).toBeInTheDocument();
    expect(screen.getByText('26-BOLO-00001')).toBeInTheDocument();
    expect(screen.getByText('P1')).toBeInTheDocument();
    expect(screen.getByText(/Tall, tattoo/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/resolve/i));
    expect(onResolve).toHaveBeenCalledWith(1);
  });

  it('hides delete when canDelete is false', () => {
    render(<BoloCard bolo={bolo} canDelete={false} onResolve={() => {}} onDelete={() => {}} />);
    expect(screen.queryByText(/cancel bolo/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce/client" && npx vitest run src/pages/intel/bolo/__tests__/BoloCard.test.tsx`

- [ ] **Step 3: Implement `client/src/pages/intel/bolo/BoloCard.tsx`**

```tsx
import { authedImageUrl } from '../../../hooks/useApi';
import type { Bolo } from '../useBolos';

const PRIORITY_TAG: Record<string, string> = {
  P1: 'bg-[#3a0d0a] text-[#ff6b5e] border-[#5a1410]',
  P2: 'bg-[#3a2a08] text-[#f0c050] border-[#5a3a10]',
  P3: 'bg-[#1a1a1a] text-[#aaa] border-[#333]',
};
const TYPE_ICON: Record<string, string> = { person: '◉', vehicle: '🚗', other: '⚑' };

export default function BoloCard({ bolo, canDelete, onResolve, onDelete }: {
  bolo: Bolo;
  canDelete: boolean;
  onResolve: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const expired = bolo.status !== 'active';
  return (
    <div className={`border rounded-[2px] p-3 ${expired ? 'border-[#1a1a1a] bg-[#040404] opacity-60' : 'border-[#232323] bg-[#070707]'}`}>
      <div className="flex items-start gap-3">
        {bolo.type === 'person' && bolo.photo_url
          ? <img src={authedImageUrl(bolo.photo_url)} alt="" className="w-10 h-12 object-cover rounded-[2px] border border-[#2a2a2a] shrink-0" />
          : <div className="w-10 h-12 bg-[#161616] border border-[#2a2a2a] rounded-[2px] shrink-0 flex items-center justify-center text-[#555]">{TYPE_ICON[bolo.type] || '⚑'}</div>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-mono text-[8px] px-[5px] py-[1px] rounded-[2px] border ${PRIORITY_TAG[bolo.priority] || PRIORITY_TAG.P3}`}>{bolo.priority}</span>
            <span className="font-mono text-[9px] text-[#888]">{bolo.bolo_number}</span>
            {expired && <span className="font-mono text-[8px] text-[#666] uppercase">{bolo.status}</span>}
          </div>
          <div className="text-[13px] text-white font-semibold mt-1 truncate">{bolo.title}</div>
          {bolo.subject_description && <div className="text-[11px] text-[#bbb] truncate">{bolo.subject_description}</div>}
          {bolo.vehicle_description && <div className="text-[11px] text-[#bbb] truncate">{bolo.vehicle_description}</div>}
          {bolo.description && <div className="text-[10px] text-[#777] mt-1 line-clamp-2">{bolo.description}</div>}
          <div className="flex items-center gap-2 mt-2 text-[9px] text-[#555] font-mono">
            <span>{bolo.issued_by_name || 'Unknown'}</span>
            {bolo.expires_at && <span>· expires {bolo.expires_at.slice(0, 10)}</span>}
          </div>
        </div>
      </div>
      {!expired && (
        <div className="flex gap-2 mt-2 justify-end">
          <button onClick={() => onResolve(bolo.id)}
            className="font-mono text-[8px] tracking-wide text-[#d4a017] border border-[#3a3a3a] rounded-[2px] px-2 py-[5px] uppercase">Resolve</button>
          {canDelete && (
            <button onClick={() => onDelete(bolo.id)}
              className="font-mono text-[8px] tracking-wide text-[#ff6b5e] border border-[#5a1410] rounded-[2px] px-2 py-[5px] uppercase">Cancel BOLO</button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run, verify PASS (2 tests)**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce/client" && npx vitest run src/pages/intel/bolo/__tests__/BoloCard.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/bolo/BoloCard.tsx client/src/pages/intel/bolo/__tests__/BoloCard.test.tsx
git commit -m "feat(intel): BOLO card component"
```

---

## Task 3: `BoloCreateModal` component

**Files:**
- Create: `client/src/pages/intel/bolo/BoloCreateModal.tsx`
- Test: `client/src/pages/intel/bolo/__tests__/BoloCreateModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/intel/bolo/__tests__/BoloCreateModal.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import BoloCreateModal from '../BoloCreateModal';

describe('BoloCreateModal', () => {
  it('submits the entered fields', () => {
    const onCreate = vi.fn();
    render(<BoloCreateModal onClose={() => {}} onCreate={onCreate} />);
    fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: 'Stolen plate' } });
    fireEvent.click(screen.getByText(/create bolo/i));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ title: 'Stolen plate', type: 'person', priority: 'P3' }));
  });

  it('does not submit without a title', () => {
    const onCreate = vi.fn();
    render(<BoloCreateModal onClose={() => {}} onCreate={onCreate} />);
    fireEvent.click(screen.getByText(/create bolo/i));
    expect(onCreate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce/client" && npx vitest run src/pages/intel/bolo/__tests__/BoloCreateModal.test.tsx`

- [ ] **Step 3: Implement `client/src/pages/intel/bolo/BoloCreateModal.tsx`**

```tsx
import { useState } from 'react';
import type { BoloCreate } from '../useBolos';

const INPUT = 'w-full bg-[#0b0b0b] border border-[#2e2e2e] rounded-[2px] px-2 py-[6px] text-[12px] text-gray-200 focus:border-[#d4a017] outline-none';
const LABEL = 'font-mono text-[8px] tracking-widest text-[#888] uppercase';

export default function BoloCreateModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (payload: BoloCreate) => void;
}) {
  const [type, setType] = useState('person');
  const [priority, setPriority] = useState('P3');
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [description, setDescription] = useState('');

  const submit = () => {
    if (!title.trim()) return;
    onCreate({
      type, title: title.trim(), priority,
      subject_description: subject.trim() || undefined,
      vehicle_description: vehicle.trim() || undefined,
      description: description.trim() || undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-[#060606] border border-[#3a3a3a] rounded-[2px]" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-[#232323] font-mono text-[10px] tracking-widest text-[#d4a017] uppercase">New BOLO</div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className={LABEL}>Type</div>
              <select value={type} onChange={(e) => setType(e.target.value)} className={INPUT}>
                <option value="person">Person</option>
                <option value="vehicle">Vehicle</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <div className={LABEL}>Priority</div>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className={INPUT}>
                <option value="P1">P1 — Critical</option>
                <option value="P2">P2 — High</option>
                <option value="P3">P3 — Routine</option>
              </select>
            </div>
          </div>
          <div><div className={LABEL}>Title *</div><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title / headline" className={INPUT} /></div>
          {type !== 'vehicle' && <div><div className={LABEL}>Subject description</div><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject description" className={INPUT} /></div>}
          {type !== 'person' && <div><div className={LABEL}>Vehicle description</div><input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="Vehicle description" className={INPUT} /></div>}
          <div><div className={LABEL}>Details</div><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Narrative / details" rows={3} className={INPUT} /></div>
        </div>
        <div className="px-4 py-3 border-t border-[#232323] flex justify-end gap-2">
          <button onClick={onClose} className="font-mono text-[9px] tracking-wide text-[#888] border border-[#2a2a2a] rounded-[2px] px-3 py-[6px] uppercase">Cancel</button>
          <button onClick={submit} className="font-mono text-[9px] tracking-wide text-black bg-[#d4a017] rounded-[2px] px-3 py-[6px] uppercase">Create BOLO</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run, verify PASS (2 tests)**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce/client" && npx vitest run src/pages/intel/bolo/__tests__/BoloCreateModal.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/bolo/BoloCreateModal.tsx client/src/pages/intel/bolo/__tests__/BoloCreateModal.test.tsx
git commit -m "feat(intel): BOLO create modal"
```

---

## Task 4: `BoloBoard` + route swap

**Files:**
- Create: `client/src/pages/intel/BoloBoard.tsx`
- Modify: `client/src/App.tsx`
- Test: `client/src/pages/intel/__tests__/BoloBoard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/intel/__tests__/BoloBoard.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import BoloBoard from '../BoloBoard';

const apiFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({ apiFetch: (...a: any[]) => apiFetch(...a), authedImageUrl: (u: string) => u }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));

describe('BoloBoard', () => {
  it('renders bolos grouped by priority', async () => {
    apiFetch.mockResolvedValue([
      { id: 1, bolo_number: '26-BOLO-00001', type: 'person', status: 'active', title: 'P1 subject', description: null,
        subject_description: null, vehicle_description: null, photo_url: null, priority: 'P1', issued_by: 5,
        issued_by_name: 'CZ', expires_at: null, created_at: 'x' },
      { id: 2, bolo_number: '26-BOLO-00002', type: 'vehicle', status: 'active', title: 'P3 vehicle', description: null,
        subject_description: null, vehicle_description: 'Red', photo_url: null, priority: 'P3', issued_by: 5,
        issued_by_name: 'CZ', expires_at: null, created_at: 'x' },
    ]);
    render(<BoloBoard />);
    await waitFor(() => expect(screen.getByText('P1 subject')).toBeInTheDocument());
    expect(screen.getByText('P3 vehicle')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce/client" && npx vitest run src/pages/intel/__tests__/BoloBoard.test.tsx`

- [ ] **Step 3: Implement `client/src/pages/intel/BoloBoard.tsx`**

```tsx
// Intel command-center BOLO board. Priority-grouped cards over the existing
// /comms/bolos API. Active/All filter, create modal, resolve/cancel actions.
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useBolos } from './useBolos';
import BoloCard from './bolo/BoloCard';
import BoloCreateModal from './bolo/BoloCreateModal';

const PRIORITIES = ['P1', 'P2', 'P3'] as const;
const ADMIN_ROLES = new Set(['admin', 'manager']);

export default function BoloBoard() {
  const { bolos, loading, error, create, resolve, remove } = useBolos();
  const { user } = useAuth();
  const canDelete = ADMIN_ROLES.has(String((user as any)?.role || '').toLowerCase());
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [creating, setCreating] = useState(false);

  const visible = useMemo(
    () => (showActiveOnly ? bolos.filter((b) => b.status === 'active') : bolos),
    [bolos, showActiveOnly],
  );
  const groups = useMemo(() => {
    const g: Record<string, typeof bolos> = { P1: [], P2: [], P3: [] };
    const other: typeof bolos = [];
    for (const b of visible) (g[b.priority] ? g[b.priority] : other).push(b);
    return { g, other };
  }, [visible]);

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-3">
        <div className="font-mono text-[10px] tracking-widest text-[#888] uppercase flex-1">BOLO Board ({visible.length})</div>
        <div className="flex gap-1">
          <button onClick={() => setShowActiveOnly(true)}
            className={`font-mono text-[9px] px-2 py-[3px] rounded-[2px] border ${showActiveOnly ? 'border-[#d4a017] text-[#d4a017]' : 'border-[#232323] text-[#888]'}`}>Active</button>
          <button onClick={() => setShowActiveOnly(false)}
            className={`font-mono text-[9px] px-2 py-[3px] rounded-[2px] border ${!showActiveOnly ? 'border-[#d4a017] text-[#d4a017]' : 'border-[#232323] text-[#888]'}`}>All</button>
        </div>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-1 font-mono text-[9px] tracking-wide text-black bg-[#d4a017] rounded-[2px] px-2 py-[4px] uppercase">
          <Plus size={11} /> New BOLO
        </button>
      </div>

      {error && <div className="text-[10px] text-[#ff6b5e]">{error}</div>}
      {loading && <div className="text-[11px] text-[#888]">Loading BOLOs…</div>}
      {!loading && visible.length === 0 && <div className="text-[11px] text-[#555]">No {showActiveOnly ? 'active ' : ''}BOLOs.</div>}

      {PRIORITIES.map((p) => groups.g[p].length > 0 && (
        <div key={p}>
          <div className="font-mono text-[8px] tracking-widest text-[#555] uppercase mb-1">Priority {p}</div>
          <div className="grid grid-cols-2 gap-2">
            {groups.g[p].map((b) => <BoloCard key={b.id} bolo={b} canDelete={canDelete} onResolve={resolve} onDelete={remove} />)}
          </div>
        </div>
      ))}
      {groups.other.length > 0 && (
        <div>
          <div className="font-mono text-[8px] tracking-widest text-[#555] uppercase mb-1">Other</div>
          <div className="grid grid-cols-2 gap-2">
            {groups.other.map((b) => <BoloCard key={b.id} bolo={b} canDelete={canDelete} onResolve={resolve} onDelete={remove} />)}
          </div>
        </div>
      )}

      {creating && <BoloCreateModal onClose={() => setCreating(false)} onCreate={create} />}
    </div>
  );
}
```

> Note: `useAuth` is the app auth context at `client/src/context/AuthContext` — it exposes `user` with a `role`. If the exact shape differs, the `canDelete` line degrades safely to `false` (hiding the admin-only Cancel button), which is the safe default. Confirm the import path resolves during typecheck.

- [ ] **Step 4: Swap the route in `client/src/App.tsx`**

- Add the lazy import after the other intel ones (near `IntelComingSoon`):
  ```tsx
  const BoloBoard = lazyRetry(() => import('./pages/intel/BoloBoard'));
  ```
- Change the `/intel/bolos` child route from the placeholder to `BoloBoard`:
  ```tsx
  <Route path="bolos" element={<RouteErrorBoundary><BoloBoard /></RouteErrorBoundary>} />
  ```
  (It currently reads `element={<RouteErrorBoundary><IntelComingSoon title="BOLO Board" phase="Phase · BOLO" /></RouteErrorBoundary>}` — replace the element. Leave `IntelComingSoon` imported; it's still used by `/intel/map` and `/intel/ai`.)

- [ ] **Step 5: Run test + typecheck + build**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce/client"
npx vitest run src/pages/intel/__tests__/BoloBoard.test.tsx
npx tsc --noEmit
npx vite build
```
All PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/intel/BoloBoard.tsx client/src/App.tsx
git commit -m "feat(intel): BOLO board in the portal (priority groups + create + resolve)"
```

---

## Task 5: SW bump + full gate

**Files:**
- Modify: `client/public/sw.js`

- [ ] **Step 1: Bump `CACHE_NAME`** from `rmpg-flex-v924` to `rmpg-flex-v926` (v925 is taken by the Phase 2 PR).

- [ ] **Step 2: Full gate**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce/client"
npx tsc --noEmit && npx vitest run && npx vite build
```
All PASS (vitest includes the new useBolos/BoloCard/BoloCreateModal/BoloBoard tests).

- [ ] **Step 3: Commit**

```bash
git add client/public/sw.js
git commit -m "chore(intel): bump SW to v926 for BOLO board"
```

---

## Self-Review

**Spec coverage (corrected spec §7 — UI adoption):**
- BOLO Board UI in the portal over the existing `bolosRouter` → Tasks 1-4 ✓
- Card grid by priority + create + resolve/cancel → Tasks 2, 3, 4 ✓
- No new table / no new endpoints (uses existing `/comms/bolos`) → confirmed; no worker changes ✓
- Replaces the `/intel/bolos` Coming-Soon placeholder → Task 4 ✓
- Reuse `BoloAlertBanner` (already app-wide) → no change needed; the banner already runs via Layout ✓

**Placeholder scan:** No TBD/TODO; all code complete.

**Type consistency:** `Bolo` + `BoloCreate` defined in `useBolos.ts`, consumed unchanged by `BoloCard` (`Bolo`), `BoloCreateModal` (`BoloCreate`), and `BoloBoard`. Priority values `P1/P2/P3` and type values `person/vehicle/other` match the worker's `VALID_BOLO_*` enums. `resolve` sends `status:'cancelled'` (a valid enum value). `authedImageUrl` imported from `useApi` (named export, verified in Phase 2).

**Risk recheck:** no worker/DB change (zero migration risk). `canDelete` degrades safely to false if the auth shape differs. SW v926 avoids the Phase 2 v925 collision. Route swap is one line, mirroring the Phase 2 search swap.
