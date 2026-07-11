# Spillman CAD Board (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Dispatch page an authentic Spillman Flex CAD console view — command line + live-clock band + three black monospace color-coded status grids (Undispatched Calls / Dispatched Calls / Unit Status) — bound to the existing DispatchPage state and handlers, as a toggleable replacement for the call-queue list panel.

**Architecture:** A self-contained `SpillmanCadBoard` component in `client/src/pages/dispatch/spillman/` composed from the P0 chrome kit (`SpillmanStatusGrid`, `priorityColor`, `unitStatusColor`). All data and mutations are injected as props from `DispatchPage`; the board owns zero API calls. Pure helpers (`cadGridMappers.ts` row/column mapping + partitioning, `cadCommandLine.ts` mnemonic parser) are unit-tested. DispatchPage gains one persisted boolean (`rmpg_dispatch_cad_board`) that swaps the left call-list panel for the board, plus a context-free `handleDragUnassignUnit` in `useDispatchUnitActions` so the `uc` mnemonic works without a selected call.

**Tech Stack:** React 18 + TypeScript, vitest + @testing-library/react (jsdom), P0 kit in `client/src/components/spillman/`, existing Spillman CSS tokens (`--spm-*`, `spm-status-grid` classes in `client/src/styles/spillman-kit.css`).

**Scope guards (locked by program spec):** presentation/relayout only — no API, schema, or migration changes; keep the AVL map and all data-entry forms; drag unit→call reuses `handleDragAssignUnit`; command line is optional sugar over existing handlers (no full Spillman grammar); no Motorola logos.

---

### Task 1: `cadCommandLine.ts` — mnemonic parser (pure, TDD)

**Files:**
- Create: `client/src/pages/dispatch/spillman/cadCommandLine.ts`
- Test: `client/src/pages/dispatch/spillman/__tests__/cadCommandLine.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { parseCadCommand, findUnitByCallSign, findCallByNumber } from '../cadCommandLine';

describe('parseCadCommand', () => {
  it('returns null for empty input', () => {
    expect(parseCadCommand('')).toBeNull();
    expect(parseCadCommand('   ')).toBeNull();
  });

  it('parses ac (add call)', () => {
    expect(parseCadCommand('ac')).toEqual({ kind: 'ac' });
    expect(parseCadCommand('AC')).toEqual({ kind: 'ac' });
  });

  it('parses dc <unit> [call#] (dispatch call)', () => {
    expect(parseCadCommand('dc P12')).toEqual({ kind: 'dc', unit: 'P12', call: undefined });
    expect(parseCadCommand('dc p12 2026-000451')).toEqual({ kind: 'dc', unit: 'p12', call: '2026-000451' });
  });

  it('dc without a unit is unknown', () => {
    expect(parseCadCommand('dc')).toEqual({ kind: 'unknown', input: 'dc' });
  });

  it('parses uc <unit> (unit clear)', () => {
    expect(parseCadCommand('uc P12')).toEqual({ kind: 'uc', unit: 'P12' });
    expect(parseCadCommand('uc')).toEqual({ kind: 'unknown', input: 'uc' });
  });

  it('parses cc [call#] (clear call)', () => {
    expect(parseCadCommand('cc')).toEqual({ kind: 'cc', call: undefined });
    expect(parseCadCommand('cc 451')).toEqual({ kind: 'cc', call: '451' });
  });

  it('anything else is unknown', () => {
    expect(parseCadCommand('frobnicate 12')).toEqual({ kind: 'unknown', input: 'frobnicate 12' });
  });
});

describe('resolvers', () => {
  const units = [
    { id: '7', call_sign: 'P12' },
    { id: '9', call_sign: 'S3' },
  ] as any[];
  const calls = [
    { id: 'c1', call_number: '2026-000451' },
    { id: 'c2', call_number: '2026-000452' },
  ] as any[];

  it('findUnitByCallSign is case-insensitive', () => {
    expect(findUnitByCallSign(units, 'p12')?.id).toBe('7');
    expect(findUnitByCallSign(units, 'X1')).toBeUndefined();
  });

  it('findCallByNumber matches exact or numeric suffix', () => {
    expect(findCallByNumber(calls, '2026-000451')?.id).toBe('c1');
    expect(findCallByNumber(calls, '452')?.id).toBe('c2');
    expect(findCallByNumber(calls, '9999')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/pages/dispatch/spillman/__tests__/cadCommandLine.test.ts`
Expected: FAIL — module `../cadCommandLine` not found.

- [ ] **Step 3: Implement the parser**

```ts
// Spillman-style CAD command-line mnemonics, wired to existing DispatchPage
// handlers (NOT a dispatch engine). Grammar is deliberately tiny — P1 scope:
//   ac              → open the New Call modal
//   dc <unit> [c#]  → dispatch: assign unit to call (default: selected call)
//   uc <unit>       → unit clear: unassign unit from its current call
//   cc [c#]         → clear call with disposition (default: selected call)
import type { CallForService, Unit } from '../../../types';

export type CadCommand =
  | { kind: 'ac' }
  | { kind: 'dc'; unit: string; call: string | undefined }
  | { kind: 'uc'; unit: string }
  | { kind: 'cc'; call: string | undefined }
  | { kind: 'unknown'; input: string };

export function parseCadCommand(raw: string): CadCommand | null {
  const input = raw.trim();
  if (!input) return null;
  const [word, ...rest] = input.split(/\s+/);
  switch (word.toLowerCase()) {
    case 'ac':
      return { kind: 'ac' };
    case 'dc':
      return rest[0] ? { kind: 'dc', unit: rest[0], call: rest[1] } : { kind: 'unknown', input };
    case 'uc':
      return rest[0] ? { kind: 'uc', unit: rest[0] } : { kind: 'unknown', input };
    case 'cc':
      return { kind: 'cc', call: rest[0] };
    default:
      return { kind: 'unknown', input };
  }
}

export function findUnitByCallSign(units: Unit[], token: string): Unit | undefined {
  const t = token.trim().toLowerCase();
  return units.find((u) => (u.call_sign || '').toLowerCase() === t);
}

/** Match a call by exact call_number, or by numeric suffix ("451" → 2026-000451). */
export function findCallByNumber(calls: CallForService[], token: string): CallForService | undefined {
  const t = token.trim().toLowerCase();
  const exact = calls.find((c) => (c.call_number || '').toLowerCase() === t);
  if (exact) return exact;
  if (!/^\d+$/.test(t)) return undefined;
  return calls.find((c) => {
    const digits = (c.call_number || '').replace(/\D/g, '');
    return digits.endsWith(t) && Number(digits.slice(-t.length)) === Number(t);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/pages/dispatch/spillman/__tests__/cadCommandLine.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/dispatch/spillman/cadCommandLine.ts client/src/pages/dispatch/spillman/__tests__/cadCommandLine.test.ts
git commit -m "feat(dispatch): Spillman CAD command-line parser (ac/dc/uc/cc)"
```

---

### Task 2: `cadGridMappers.ts` — grid columns, partitioning, colors (pure, TDD)

**Files:**
- Create: `client/src/pages/dispatch/spillman/cadGridMappers.ts`
- Test: `client/src/pages/dispatch/spillman/__tests__/cadGridMappers.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import {
  spillmanPriorityNumber, partitionCalls, cadUnitStatusLabel,
  cadUnitColor, timeHHMM,
} from '../cadGridMappers';

describe('spillmanPriorityNumber', () => {
  it('maps P1..P4 straight to 1..4', () => {
    expect(spillmanPriorityNumber('P1')).toBe(1);
    expect(spillmanPriorityNumber('P4')).toBe(4);
  });
  it('is defensive about junk', () => {
    expect(spillmanPriorityNumber(undefined as any)).toBe(3);
    expect(spillmanPriorityNumber('nope' as any)).toBe(3);
  });
});

describe('partitionCalls', () => {
  const mk = (id: string, status: string) => ({ id, status } as any);
  it('splits working calls into undispatched vs dispatched and drops closed ones', () => {
    const calls = [
      mk('a', 'pending'), mk('b', 'on_hold'),
      mk('c', 'dispatched'), mk('d', 'enroute'), mk('e', 'onscene'),
      mk('f', 'cleared'), mk('g', 'closed'), mk('h', 'cancelled'), mk('i', 'archived'),
    ];
    const { undispatched, dispatched } = partitionCalls(calls);
    expect(undispatched.map((c) => c.id)).toEqual(['a', 'b']);
    expect(dispatched.map((c) => c.id)).toEqual(['c', 'd', 'e']);
  });
});

describe('cadUnitStatusLabel', () => {
  it('renders Spillman-style short codes', () => {
    expect(cadUnitStatusLabel('available')).toBe('AVL');
    expect(cadUnitStatusLabel('enroute')).toBe('ENR');
    expect(cadUnitStatusLabel('onscene')).toBe('ONS');
    expect(cadUnitStatusLabel('out_of_service')).toBe('OOS');
    expect(cadUnitStatusLabel(undefined)).toBe('—');
  });
});

describe('cadUnitColor', () => {
  it('routes through the fixed Spillman status palette', () => {
    expect(cadUnitColor('available')).toBe('var(--spm-stat-avail)');
    expect(cadUnitColor('enroute')).toBe('var(--spm-stat-enrt)');
    expect(cadUnitColor('onscene')).toBe('var(--spm-stat-busy)');
    expect(cadUnitColor('off_duty')).toBe('inherit');
  });
});

describe('timeHHMM', () => {
  it('formats an ISO timestamp as HH:MM and tolerates junk', () => {
    expect(timeHHMM('2026-07-02T09:05:00Z')).toMatch(/^\d{2}:\d{2}$/);
    expect(timeHHMM(undefined)).toBe('');
    expect(timeHHMM('not-a-date')).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/pages/dispatch/spillman/__tests__/cadGridMappers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the mappers**

```ts
// Pure mapping helpers for the Spillman CAD board's three status grids.
// The color contract comes from the P0 kit: priorityColor()/unitStatusColor()
// return CSS-variable strings usable directly as inline `color`.
import type { CallForService, CallPriority, Unit } from '../../../types';
import { unitStatusColor } from '../../../components/spillman';
import type { StatusColumn } from '../../../components/spillman';

/** RMPG P1..P4 → Spillman fixed priority number (1 red … 4 light green). */
export function spillmanPriorityNumber(priority: CallPriority): number {
  const n = parseInt(String(priority ?? '').replace(/^P/i, ''), 10);
  return n >= 1 && n <= 4 ? n : 3;
}

const UNDISPATCHED_STATUSES = new Set(['pending', 'on_hold']);
const DISPATCHED_STATUSES = new Set(['dispatched', 'enroute', 'onscene']);

export function partitionCalls(calls: CallForService[]): {
  undispatched: CallForService[];
  dispatched: CallForService[];
} {
  return {
    undispatched: calls.filter((c) => UNDISPATCHED_STATUSES.has(c.status)),
    dispatched: calls.filter((c) => DISPATCHED_STATUSES.has(c.status)),
  };
}

const UNIT_STATUS_LABELS: Record<string, string> = {
  available: 'AVL',
  dispatched: 'DSP',
  enroute: 'ENR',
  onscene: 'ONS',
  busy: 'BUSY',
  off_duty: 'OFFD',
  out_of_service: 'OOS',
};

export function cadUnitStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return UNIT_STATUS_LABELS[status] ?? status.toUpperCase();
}

// unitStatusColor() knows avail/enrt/busy/xbsy; translate our richer union
// onto that fixed CAD palette (working statuses read as "busy").
const UNIT_COLOR_ALIASES: Record<string, string> = {
  dispatched: 'busy',
  onscene: 'busy',
  out_of_service: 'oos',
};

export function cadUnitColor(status: string | null | undefined): string {
  if (!status || status === 'off_duty') return 'inherit';
  return unitStatusColor(UNIT_COLOR_ALIASES[status] ?? status);
}

export function timeHHMM(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── Column layouts (Spillman CAD console) ─────────────────────
export const UNDISPATCHED_COLUMNS: StatusColumn[] = [
  { key: 'pri', label: 'Pri', width: 34, align: 'center' },
  { key: 'call_number', label: 'Call #', width: 96 },
  { key: 'type', label: 'Type', width: 110 },
  { key: 'location', label: 'Location' },
  { key: 'zone', label: 'Zone', width: 70 },
  { key: 'time', label: 'Recvd', width: 52, align: 'right' },
];

export const DISPATCHED_COLUMNS: StatusColumn[] = [
  { key: 'pri', label: 'Pri', width: 34, align: 'center' },
  { key: 'call_number', label: 'Call #', width: 96 },
  { key: 'type', label: 'Type', width: 110 },
  { key: 'location', label: 'Location' },
  { key: 'units', label: 'Units', width: 110 },
  { key: 'status', label: 'Status', width: 64 },
];

export const UNIT_COLUMNS: StatusColumn[] = [
  { key: 'call_sign', label: 'Unit', width: 64 },
  { key: 'officer', label: 'Officer' },
  { key: 'status', label: 'St', width: 52, align: 'center' },
  { key: 'call_number', label: 'Call #', width: 96 },
  { key: 'beat', label: 'Beat', width: 64 },
  { key: 'time', label: 'Last', width: 52, align: 'right' },
];

// ── Row projections (plain records — SpillmanStatusGrid renders row[col.key]) ──
export interface CadCallRow extends Record<string, any> {
  id: string;
  call: CallForService;
}
export interface CadUnitRow extends Record<string, any> {
  id: string;
  unit: Unit;
}

export function callToRow(call: CallForService): CadCallRow {
  return {
    id: call.id,
    call,
    pri: spillmanPriorityNumber(call.priority),
    call_number: call.call_number,
    type: (call.incident_type || '').replace(/_/g, ' ').toUpperCase(),
    location: call.location || '',
    zone: call.beat_name || call.zone_name || call.zone_beat || '',
    time: timeHHMM((call as any).created_at),
    units: (call.assigned_units || []).join(' '),
    status: (call.status || '').replace(/_/g, ' ').toUpperCase(),
  };
}

export function unitToRow(unit: Unit, callNumberById: (id: string | null | undefined) => string): CadUnitRow {
  return {
    id: unit.id,
    unit,
    call_sign: unit.call_sign,
    officer: unit.officer_name || '',
    status: cadUnitStatusLabel(unit.status),
    call_number: callNumberById(unit.current_call_id) || unit.current_call_number || '',
    beat: unit.assigned_beat || '',
    time: timeHHMM(unit.last_status_change),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/pages/dispatch/spillman/__tests__/cadGridMappers.test.ts`
Expected: PASS. (Note: `cadUnitColor('out_of_service')` maps through alias `oos` → `unitStatusColor('oos')` = `var(--spm-stat-busy)`.)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/dispatch/spillman/cadGridMappers.ts client/src/pages/dispatch/spillman/__tests__/cadGridMappers.test.ts
git commit -m "feat(dispatch): CAD board grid mappers (partition, columns, Spillman colors)"
```

---

### Task 3: context-free unassign in `useDispatchUnitActions`

The `uc <unit>` mnemonic must clear a unit regardless of which call is selected. `handleUnassignUnit` requires `selectedCall`; add `handleDragUnassignUnit(callId, unitId)` mirroring the existing `handleDragAssignUnit` defensive pattern.

**Files:**
- Modify: `client/src/pages/dispatch/hooks/useDispatchUnitActions.ts` (insert after `handleUnassignUnit`, add to the `return {}` block)

- [ ] **Step 1: Implement**

```ts
  /** Context-free unassign (CAD board `uc` mnemonic + drag-out) — same
   *  defensive response handling as handleDragAssignUnit. */
  const handleDragUnassignUnit = useCallback(async (callId: string, unitId: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/unassign-unit`, {
        method: 'POST',
        body: JSON.stringify({ unit_id: unitId }),
      });
      const apply = (c: CallForService): CallForService => looksLikeCallRow(result)
        ? mapDbCall(result)
        : { ...c, assigned_units: (c.assigned_units || []).filter((u) => String(u) !== String(unitId)) };
      setCalls((prev) => prev.map((c) => c.id === callId ? apply(c) : c));
      setSelectedCall((prev) => prev?.id === callId ? apply(prev) : prev);
      await refreshUnits();
    } catch (err: any) {
      addToast(err?.error || err?.message || 'Failed to unassign unit', 'error');
    }
  }, [setCalls, setSelectedCall, refreshUnits, addToast]);
```

Add `handleDragUnassignUnit,` to the hook's returned object (next to `handleUnassignUnit`).

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no NEW errors (12 pre-existing errors are known).

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/dispatch/hooks/useDispatchUnitActions.ts
git commit -m "feat(dispatch): context-free handleDragUnassignUnit for CAD uc mnemonic"
```

---

### Task 4: `SpillmanCadBoard.tsx` — the console component (+ render test)

**Files:**
- Create: `client/src/pages/dispatch/spillman/SpillmanCadBoard.tsx`
- Create: `client/src/pages/dispatch/spillman/index.ts`
- Test: `client/src/pages/dispatch/spillman/__tests__/SpillmanCadBoard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SpillmanCadBoard from '../SpillmanCadBoard';

afterEach(cleanup);

const calls = [
  { id: 'c1', call_number: '2026-000451', incident_type: 'alarm', priority: 'P1', status: 'pending', location: '100 S MAIN ST', assigned_units: [], created_at: '2026-07-02T09:00:00Z' },
  { id: 'c2', call_number: '2026-000452', incident_type: 'patrol_request', priority: 'P3', status: 'dispatched', location: '200 W TEMPLE', assigned_units: ['P12'], created_at: '2026-07-02T09:10:00Z' },
] as any[];
const units = [
  { id: 'u1', call_sign: 'P12', officer_name: 'ZAMORA', status: 'dispatched', current_call_id: 'c2', last_status_change: '2026-07-02T09:11:00Z' },
  { id: 'u2', call_sign: 'S3', officer_name: 'DOE', status: 'available', current_call_id: null, last_status_change: '2026-07-02T08:00:00Z' },
] as any[];

function mount(over: Partial<React.ComponentProps<typeof SpillmanCadBoard>> = {}) {
  const props = {
    calls, units, selectedCallId: null,
    onSelectCall: vi.fn(), onOpenNewCall: vi.fn(),
    onAssignUnitToCall: vi.fn(), onUnassignUnitFromCall: vi.fn(),
    onClearCall: vi.fn(), onCommandFeedback: vi.fn(),
    ...over,
  };
  render(<SpillmanCadBoard {...(props as any)} />);
  return props;
}

describe('SpillmanCadBoard', () => {
  it('renders the three status grids with partitioned rows', () => {
    mount();
    expect(screen.getByText(/UNDISPATCHED CALLS/i)).toBeInTheDocument();
    expect(screen.getByText(/DISPATCHED CALLS/i)).toBeInTheDocument();
    expect(screen.getByText(/UNIT STATUS/i)).toBeInTheDocument();
    expect(screen.getByText('2026-000451')).toBeInTheDocument(); // undispatched grid
    expect(screen.getAllByText('2026-000452').length).toBeGreaterThan(0); // dispatched + unit grids
  });

  it('runs dc <unit> <call#> from the command line', () => {
    const p = mount();
    const input = screen.getByLabelText('Command');
    fireEvent.change(input, { target: { value: 'dc S3 451' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onAssignUnitToCall).toHaveBeenCalledWith('c1', 'u2');
  });

  it('ac opens the new-call modal', () => {
    const p = mount();
    const input = screen.getByLabelText('Command');
    fireEvent.change(input, { target: { value: 'ac' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onOpenNewCall).toHaveBeenCalled();
  });

  it('uc <unit> unassigns via the unit’s current call', () => {
    const p = mount();
    const input = screen.getByLabelText('Command');
    fireEvent.change(input, { target: { value: 'uc P12' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onUnassignUnitFromCall).toHaveBeenCalledWith('c2', 'u1');
  });

  it('double-clicking a call row selects the call', () => {
    const p = mount();
    fireEvent.doubleClick(screen.getByText('2026-000451'));
    expect(p.onSelectCall).toHaveBeenCalledWith(calls[0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/dispatch/spillman/__tests__/SpillmanCadBoard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// Spillman Flex CAD console — P1 of the structural-replica program.
// Presentation-only shell: all data + mutations are injected by DispatchPage.
// Layout (top→bottom): command band (module label + live clock) → Command:
// line → Undispatched / Dispatched / Unit Status grids. Grids stay dark in
// both day/night themes via the kit's .spm-status-grid (tactical surface).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CallForService, Unit } from '../../../types';
import { SpillmanStatusGrid, priorityColor } from '../../../components/spillman';
import {
  UNDISPATCHED_COLUMNS, DISPATCHED_COLUMNS, UNIT_COLUMNS,
  partitionCalls, callToRow, unitToRow, cadUnitColor,
  type CadCallRow, type CadUnitRow,
} from './cadGridMappers';
import { parseCadCommand, findUnitByCallSign, findCallByNumber } from './cadCommandLine';

export interface SpillmanCadBoardProps {
  calls: CallForService[];
  units: Unit[];
  selectedCallId: string | null;
  onSelectCall: (call: CallForService) => void;
  onOpenNewCall: () => void;
  onAssignUnitToCall: (callId: string, unitId: string) => void;
  onUnassignUnitFromCall: (callId: string, unitId: string) => void;
  onClearCall: (callId: string) => void;
  /** Toast/announce channel for command-line feedback (errors, echoes). */
  onCommandFeedback: (message: string, level: 'success' | 'error' | 'info') => void;
}

function useCadClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);
  return now.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

export default function SpillmanCadBoard(props: SpillmanCadBoardProps) {
  const {
    calls, units, selectedCallId, onSelectCall, onOpenNewCall,
    onAssignUnitToCall, onUnassignUnitFromCall, onClearCall, onCommandFeedback,
  } = props;

  const clock = useCadClock();
  const [command, setCommand] = useState('');
  const commandRef = useRef<HTMLInputElement>(null);

  const { undispatched, dispatched } = useMemo(() => partitionCalls(calls), [calls]);
  const undispatchedRows = useMemo(() => undispatched.map(callToRow), [undispatched]);
  const dispatchedRows = useMemo(() => dispatched.map(callToRow), [dispatched]);
  const callNumberById = useMemo(() => {
    const m = new Map(calls.map((c) => [String(c.id), c.call_number] as const));
    return (id: string | null | undefined) => (id == null ? '' : m.get(String(id)) ?? '');
  }, [calls]);
  const unitRows = useMemo(() => units.map((u) => unitToRow(u, callNumberById)), [units, callNumberById]);

  const runCommand = () => {
    const cmd = parseCadCommand(command);
    if (!cmd) return;
    setCommand('');
    switch (cmd.kind) {
      case 'ac':
        onOpenNewCall();
        return;
      case 'dc': {
        const unit = findUnitByCallSign(units, cmd.unit);
        if (!unit) { onCommandFeedback(`Unknown unit: ${cmd.unit}`, 'error'); return; }
        const call = cmd.call
          ? findCallByNumber(calls, cmd.call)
          : calls.find((c) => c.id === selectedCallId);
        if (!call) { onCommandFeedback(cmd.call ? `Unknown call: ${cmd.call}` : 'No call selected', 'error'); return; }
        onAssignUnitToCall(call.id, unit.id);
        return;
      }
      case 'uc': {
        const unit = findUnitByCallSign(units, cmd.unit);
        if (!unit) { onCommandFeedback(`Unknown unit: ${cmd.unit}`, 'error'); return; }
        if (!unit.current_call_id) { onCommandFeedback(`${unit.call_sign} is not on a call`, 'error'); return; }
        onUnassignUnitFromCall(String(unit.current_call_id), unit.id);
        return;
      }
      case 'cc': {
        const call = cmd.call
          ? findCallByNumber(calls, cmd.call)
          : calls.find((c) => c.id === selectedCallId);
        if (!call) { onCommandFeedback(cmd.call ? `Unknown call: ${cmd.call}` : 'No call selected', 'error'); return; }
        onClearCall(call.id);
        return;
      }
      default:
        onCommandFeedback(`Unknown command: ${cmd.input} (try ac, dc <unit> [call#], uc <unit>, cc [call#])`, 'error');
    }
  };

  // Drag: unit rows are the drag source using the app-wide 'text/unit-id'
  // payload (same one CallCard consumes), call rows are drop targets.
  const onUnitDragStart = (row: CadUnitRow, e: React.DragEvent) => {
    e.dataTransfer.setData('text/unit-id', String(row.unit.id));
    e.dataTransfer.effectAllowed = 'link';
  };
  const onCallDrop = (row: CadCallRow, e: React.DragEvent) => {
    const unitId = e.dataTransfer.getData('text/unit-id');
    if (unitId) onAssignUnitToCall(row.call.id, unitId);
  };

  const callGridShared = {
    rowKey: (r: CadCallRow) => r.id,
    rowColor: (r: CadCallRow) => priorityColor(r.pri),
    selectedKey: selectedCallId ?? undefined,
    onSelect: (r: CadCallRow) => onSelectCall(r.call),
    onActivate: (r: CadCallRow) => onSelectCall(r.call),
    onDropRow: onCallDrop,
  };

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="spillman-cad-board">
      {/* Command band — steel-blue strip: module label + live clock */}
      <div
        className="flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-wider flex-shrink-0"
        style={{ background: 'var(--spm-band, var(--surface-raised))', color: 'var(--spm-text)', borderBottom: '1px solid var(--spm-border)' }}
      >
        <span>CAD — Dispatch Console</span>
        <span className="font-mono tabular-nums" aria-live="off">{clock}</span>
      </div>

      {/* Command line */}
      <div
        className="flex items-center gap-2 px-2 py-1 flex-shrink-0"
        style={{ background: 'var(--surface-sunken)', borderBottom: '1px solid var(--spm-border)' }}
      >
        <label htmlFor="spm-cad-command" className="text-[10px] font-bold" style={{ color: 'var(--spm-text)' }}>
          Command:
        </label>
        <input
          id="spm-cad-command"
          ref={commandRef}
          aria-label="Command"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') runCommand(); if (e.key === 'Escape') setCommand(''); }}
          spellCheck={false}
          autoComplete="off"
          className="flex-1 font-mono text-[11px] px-1.5 py-0.5 outline-none"
          style={{
            background: '#000', color: 'var(--spm-stat-avail, #7CFC00)',
            border: '1px solid var(--spm-border)', borderRadius: 2, caretColor: 'currentColor',
          }}
          placeholder="ac · dc <unit> [call#] · uc <unit> · cc [call#]"
        />
      </div>

      {/* Three status grids */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 p-1">
        <SpillmanStatusGrid<CadCallRow>
          title="UNDISPATCHED CALLS"
          badge={String(undispatchedRows.length)}
          columns={UNDISPATCHED_COLUMNS}
          rows={undispatchedRows}
          {...callGridShared}
        />
        <SpillmanStatusGrid<CadCallRow>
          title="DISPATCHED CALLS"
          badge={String(dispatchedRows.length)}
          columns={DISPATCHED_COLUMNS}
          rows={dispatchedRows}
          {...callGridShared}
        />
        <SpillmanStatusGrid<CadUnitRow>
          title="UNIT STATUS"
          badge={String(unitRows.length)}
          columns={UNIT_COLUMNS}
          rows={unitRows}
          rowKey={(r) => r.id}
          rowColor={(r) => cadUnitColor(r.unit.status)}
          onDragStartRow={onUnitDragStart}
        />
      </div>
    </div>
  );
}
```

`index.ts`:

```ts
export { default as SpillmanCadBoard } from './SpillmanCadBoard';
export type { SpillmanCadBoardProps } from './SpillmanCadBoard';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/pages/dispatch/spillman/`
Expected: PASS (all three test files).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/dispatch/spillman/
git commit -m "feat(dispatch): SpillmanCadBoard console (grids + command line + clock)"
```

---

### Task 5: wire the board into DispatchPage behind a persisted toggle

**Files:**
- Modify: `client/src/pages/dispatch/DispatchPage.tsx`
  - import block (top of file)
  - state block near `const [filterTab, ...]` (~line 344)
  - hook destructure of `useDispatchUnitActions` (~line 837): add `handleDragUnassignUnit`
  - left-panel `PanelTitleBar` children (~line 3275): add the CAD/List toggle button
  - left panel body: wrap TabBar + filters + call list in `{!cadBoardView && (...)}` and add `{cadBoardView && <SpillmanCadBoard .../>}`

- [ ] **Step 1: Add import + state**

```tsx
import { SpillmanCadBoard } from './spillman';
```

```tsx
  // Spillman CAD console view (P1 structural replica). Persisted; defaults ON
  // per program decision "replaces default look" — '0' opts back to classic.
  const [cadBoardView, setCadBoardView] = useState<boolean>(
    () => { try { return localStorage.getItem('rmpg_dispatch_cad_board') !== '0'; } catch { return true; } },
  );
  const toggleCadBoardView = () => {
    setCadBoardView((v) => {
      try { localStorage.setItem('rmpg_dispatch_cad_board', v ? '0' : '1'); } catch { /* private mode */ }
      return !v;
    });
  };
```

- [ ] **Step 2: Destructure `handleDragUnassignUnit`** from `useDispatchUnitActions` (add to the existing destructuring list around line 810–837).

- [ ] **Step 3: Add the toggle button** inside the left panel's `PanelTitleBar` children (next to the Sound/Handoff buttons):

```tsx
          <button type="button"
            onClick={toggleCadBoardView}
            className="toolbar-btn"
            title={cadBoardView ? 'Switch to classic call list' : 'Switch to Spillman CAD console'}
          >
            <Monitor style={{ width: 10, height: 10 }} />
            {cadBoardView ? 'List' : 'CAD'}
          </button>
```

(`Monitor` is a lucide-react icon; add it to the existing lucide import if absent.)

- [ ] **Step 4: Conditional render.** Wrap the existing `<TabBar …/>`, the operational status strip, the filter strip, and the `{/* Call List */}` div in `{!cadBoardView && (<> … </>)}`, then add as a sibling:

```tsx
        {cadBoardView && (
          <SpillmanCadBoard
            calls={calls}
            units={units}
            selectedCallId={selectedCall?.id ?? null}
            onSelectCall={setSelectedCall}
            onOpenNewCall={() => { setTemplateInitialData(undefined); setShowNewCallModal(true); }}
            onAssignUnitToCall={handleDragAssignUnit}
            onUnassignUnitFromCall={handleDragUnassignUnit}
            onClearCall={(callId) => handleClearWithDisposition(callId)}
            onCommandFeedback={(msg, level) => addToast(msg, level === 'info' ? 'success' : level)}
          />
        )}
```

Also widen the left panel when the board is active: change the panel wrapper `className` from the static `w-[35%] min-w-[320px]` to

```tsx
      <div className={`${cadBoardView ? 'w-[52%] min-w-[560px]' : 'w-[35%] min-w-[320px]'} border-r border-[var(--spm-border)] flex flex-col`} style={{ background: 'var(--surface-base)' }}>
```

(Verify `addToast` is available in DispatchPage scope — it is used elsewhere in the file; if it's named differently there, wire whatever the page's toast function is.)

- [ ] **Step 5: Typecheck + full client test suite + build**

Run:
```bash
cd client && npx tsc --noEmit
npx vitest run
npx vite build
```
Expected: no NEW typecheck errors (12 pre-existing), no NEW test failures (9 pre-existing in 4 files), build succeeds.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/dispatch/DispatchPage.tsx
git commit -m "feat(dispatch): mount Spillman CAD console as default left-panel view (toggle persisted)"
```

---

### Task 6: ship

- [ ] **Step 1: SW changelog note (documentation only — CACHE_NAME is auto-stamped).** Add one line under the most recent `// vNNN:` comment in `client/public/sw.js`:

```js
// vNNNN+1: Spillman CAD console (P1) — command line + 3 status grids on Dispatch
```

- [ ] **Step 2: Push branch + PR** (per feedback-use-pr-flow-not-direct-push):

```bash
git push -u origin claude/festive-kalam-645a93
gh pr create --title "feat(dispatch): Spillman Flex CAD console (P1 structural replica)" --body "..."
```

PR body must note: presentation-only, no migrations, toggle escape-hatch `rmpg_dispatch_cad_board=0`, and that P2 (Records replica) is next.

---

## Self-Review

- **Spec coverage:** command band + clock ✅ (Task 4), Command: line with ac/dc/uc/cc → existing handlers ✅ (Tasks 1, 4, 5), three black monospace grids with fixed priority palette ✅ (Tasks 2, 4), drag unit→call via `handleDragAssignUnit` ✅ (Tasks 4, 5), AVL map + data entry retained ✅ (right panel untouched), no data-model changes ✅. Out of scope honored: no full grammar, no MDI windows, no logos. **Toolbar glyph row** from the visual reference is deliberately deferred — the page's existing PanelTitleBar buttons already provide the tool actions; duplicating them inside the board would be noise. Noted for P1.5 polish if the operator wants the literal glyph strip.
- **Placeholder scan:** all steps carry real code; the only soft item is "verify `addToast` name" in Task 5 Step 4, which is a verification instruction, not a placeholder.
- **Type consistency:** `CadCallRow`/`CadUnitRow` defined in Task 2 and consumed in Task 4; `handleDragUnassignUnit` defined in Task 3, destructured and passed in Task 5; `StatusColumn` imported from the kit barrel in Task 2 (the barrel exports the type from `SpillmanStatusGrid`). `SpillmanStatusGrid` generic usage matches its `Record<string, any>` bound.
