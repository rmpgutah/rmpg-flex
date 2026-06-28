# Spillman chrome kit (P0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared, reusable Spillman Flex chrome kit (`client/src/components/spillman/`) — color tokens, pure helpers, and presentational React components — that the Dispatch CAD board (P1) and Records replica (P2) both compose. Nothing is wired into a live page in this phase; it ships a tested component library only.

**Architecture:** Pure helpers (`spillmanColors`, `gridSort`) are framework-free and unit-tested first. Presentational components (`SpillmanWindow`, `SpillmanToolbar`, `SpillmanMenuBar`, `SpillmanGroupBox`, `SpillmanStatusGrid`) are stateless except for the menu's open/close, take all behavior via props, and read color from CSS custom properties. Styling lives in one global stylesheet (`spillman-kit.css`) using the existing `--spm-*` theme tokens plus new fixed priority/status tokens.

**Tech Stack:** React 18 + TypeScript, Vite 6, Vitest + @testing-library/react + @testing-library/jest-dom, Tailwind/CSS variables. lucide-react is the app icon lib but the kit stays icon-agnostic (`icon?: React.ReactNode`).

---

## File structure

- Create `client/src/components/spillman/spillmanColors.ts` — `priorityColor`, `unitStatusColor` (pure).
- Create `client/src/components/spillman/gridSort.ts` — `sortGridRows` (pure, stable).
- Create `client/src/components/spillman/SpillmanWindow.tsx` — title bar + body + status bar shell.
- Create `client/src/components/spillman/SpillmanToolbar.tsx` — declarative icon+label button row.
- Create `client/src/components/spillman/SpillmanMenuBar.tsx` — config-driven menu bar (generic; the Records-scoped copy stays put until P2).
- Create `client/src/components/spillman/SpillmanGroupBox.tsx` — titled field group.
- Create `client/src/components/spillman/SpillmanStatusGrid.tsx` — black, color-coded, sortable data grid (the CAD board core).
- Create `client/src/components/spillman/index.ts` — barrel export.
- Create `client/src/components/spillman/__tests__/*.test.ts(x)` — one test file per unit.
- Create `client/src/styles/spillman-kit.css` — global kit styles.
- Modify `client/src/styles/theme-palettes.css` — append fixed `--spm-pri-1..9` + `--spm-stat-*` tokens.
- Modify `client/src/main.tsx:14` — import the kit stylesheet.
- Modify `client/public/sw.js:622` — bump `CACHE_NAME`.

All test commands run from `client/`. Run a single file with `npx vitest run <path>`.

---

## Task 1: Fixed priority + unit-status color tokens

**Files:**
- Modify: `client/src/styles/theme-palettes.css` (append at end of file)

- [ ] **Step 1: Append the fixed token block**

These are theme-invariant (the CAD board is dark-always), so define them in a standalone `:root` rule at the very end of the file so nothing overrides them. Append:

```css

/* ── Spillman CAD fixed palette (theme-invariant) ──────────────────
   Call priority colors are fixed by Spillman spec and the unit-status
   colors live only on the dark CAD console, so they do NOT invert with
   day/night. Defined globally here; consumed by spillman-kit.css and the
   spillmanColors helper. */
:root {
  --spm-pri-1: #e24b4a;  /* red       */
  --spm-pri-2: #ef9f27;  /* orange    */
  --spm-pri-3: #e6c020;  /* yellow    */
  --spm-pri-4: #97c459;  /* light grn */
  --spm-pri-5: #2e9e54;  /* med green */
  --spm-pri-6: #85b7eb;  /* light blu */
  --spm-pri-7: #378add;  /* med blue  */
  --spm-pri-8: #1f5fa5;  /* dark blue */
  --spm-pri-9: #9b7fe0;  /* purple    */

  --spm-stat-avail: #1d9e55;  /* available  */
  --spm-stat-enrt:  #ef9f27;  /* en route   */
  --spm-stat-busy:  #e24b4a;  /* busy / OOS */
  --spm-stat-xbsy:  #85b7eb;  /* extra busy */
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/styles/theme-palettes.css
git commit -m "feat(spillman): add fixed CAD priority + unit-status color tokens"
```

---

## Task 2: `spillmanColors` pure helpers (TDD)

**Files:**
- Create: `client/src/components/spillman/spillmanColors.ts`
- Test: `client/src/components/spillman/__tests__/spillmanColors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { priorityColor, unitStatusColor } from '../spillmanColors';

describe('priorityColor', () => {
  it('maps priorities 1..9 to their CSS var', () => {
    expect(priorityColor(1)).toBe('var(--spm-pri-1)');
    expect(priorityColor(9)).toBe('var(--spm-pri-9)');
  });
  it('accepts numeric strings', () => {
    expect(priorityColor('2')).toBe('var(--spm-pri-2)');
  });
  it('returns inherit for out-of-range, zero, null, or junk', () => {
    expect(priorityColor(0)).toBe('inherit');
    expect(priorityColor(10)).toBe('inherit');
    expect(priorityColor(null)).toBe('inherit');
    expect(priorityColor(undefined)).toBe('inherit');
    expect(priorityColor('x')).toBe('inherit');
  });
});

describe('unitStatusColor', () => {
  it('maps known statuses case-insensitively', () => {
    expect(unitStatusColor('AVAIL')).toBe('var(--spm-stat-avail)');
    expect(unitStatusColor('available')).toBe('var(--spm-stat-avail)');
    expect(unitStatusColor('ENRT')).toBe('var(--spm-stat-enrt)');
    expect(unitStatusColor('en route')).toBe('var(--spm-stat-enrt)');
    expect(unitStatusColor(' busy ')).toBe('var(--spm-stat-busy)');
    expect(unitStatusColor('OOS')).toBe('var(--spm-stat-busy)');
    expect(unitStatusColor('XBSY')).toBe('var(--spm-stat-xbsy)');
  });
  it('returns inherit for OMDT, unknown, or empty', () => {
    expect(unitStatusColor('OMDT')).toBe('inherit');
    expect(unitStatusColor('whatever')).toBe('inherit');
    expect(unitStatusColor(null)).toBe('inherit');
    expect(unitStatusColor('')).toBe('inherit');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/spillman/__tests__/spillmanColors.test.ts`
Expected: FAIL — `Failed to resolve import "../spillmanColors"`.

- [ ] **Step 3: Write the implementation**

```ts
/** Spillman CAD color mapping. Returns CSS-variable strings (or 'inherit')
 *  so callers drop the value straight into an inline `color`/`background`. */

const PRIORITIES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);

/** Fixed Spillman call-priority color (1 red … 9 purple). */
export function priorityColor(priority: number | string | null | undefined): string {
  const n = typeof priority === 'string' ? parseInt(priority, 10) : priority;
  return typeof n === 'number' && PRIORITIES.has(n) ? `var(--spm-pri-${n})` : 'inherit';
}

const STATUS_TO_TOKEN: Record<string, string> = {
  avail: 'avail', available: 'avail',
  enrt: 'enrt', enroute: 'enrt', 'en route': 'enrt',
  busy: 'busy', oos: 'busy',
  xbsy: 'xbsy',
};

/** Unit-status color for the CAD console (available/en-route/busy/extra-busy).
 *  Unknown or out-of-service-monitor (OMDT) falls back to the row's default. */
export function unitStatusColor(status: string | null | undefined): string {
  if (!status) return 'inherit';
  const token = STATUS_TO_TOKEN[status.trim().toLowerCase()];
  return token ? `var(--spm-stat-${token})` : 'inherit';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/spillman/__tests__/spillmanColors.test.ts`
Expected: PASS (2 suites, all assertions green).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/spillman/spillmanColors.ts client/src/components/spillman/__tests__/spillmanColors.test.ts
git commit -m "feat(spillman): priorityColor + unitStatusColor helpers"
```

---

## Task 3: `sortGridRows` pure helper (TDD)

**Files:**
- Create: `client/src/components/spillman/gridSort.ts`
- Test: `client/src/components/spillman/__tests__/gridSort.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { sortGridRows } from '../gridSort';

const rows = [
  { id: 'a', p: 3, nature: 'Theft' },
  { id: 'b', p: 1, nature: 'Fire' },
  { id: 'c', p: 2, nature: 'Accident' },
  { id: 'd', p: 1, nature: 'Assault' },
];

describe('sortGridRows', () => {
  it('sorts numbers ascending by default', () => {
    expect(sortGridRows(rows, 'p').map((r) => r.id)).toEqual(['b', 'd', 'c', 'a']);
  });
  it('sorts numbers descending', () => {
    expect(sortGridRows(rows, 'p', 'desc').map((r) => r.id)).toEqual(['a', 'c', 'b', 'd']);
  });
  it('sorts strings naturally', () => {
    expect(sortGridRows(rows, 'nature').map((r) => r.nature))
      .toEqual(['Accident', 'Assault', 'Fire', 'Theft']);
  });
  it('keeps equal-key rows in original order (stable)', () => {
    expect(sortGridRows(rows, 'p').filter((r) => r.p === 1).map((r) => r.id)).toEqual(['b', 'd']);
  });
  it('puts null/undefined keys last and does not mutate input', () => {
    const withGaps = [{ id: '1', t: 5 }, { id: '2', t: null }, { id: '3', t: 2 }];
    const out = sortGridRows(withGaps, 't');
    expect(out.map((r) => r.id)).toEqual(['3', '1', '2']);
    expect(withGaps.map((r) => r.id)).toEqual(['1', '2', '3']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/spillman/__tests__/gridSort.test.ts`
Expected: FAIL — `Failed to resolve import "../gridSort"`.

- [ ] **Step 3: Write the implementation**

```ts
/** Stable sort for status-grid rows. Returns a NEW array (never mutates).
 *  Numbers compare numerically; everything else compares as natural strings;
 *  null/undefined sort last regardless of direction. */
export function sortGridRows<T extends Record<string, any>>(
  rows: T[],
  key: string,
  dir: 'asc' | 'desc' = 'asc',
): T[] {
  const sign = dir === 'desc' ? -1 : 1;
  return rows
    .map((row, index) => [row, index] as const)
    .sort(([a, ia], [b, ib]) => {
      const av = a[key];
      const bv = b[key];
      const aNull = av === null || av === undefined;
      const bNull = bv === null || bv === undefined;
      if (aNull && bNull) return ia - ib;
      if (aNull) return 1;
      if (bNull) return -1;
      let cmp: number;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return cmp !== 0 ? cmp * sign : ia - ib;
    })
    .map(([row]) => row);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/spillman/__tests__/gridSort.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/spillman/gridSort.ts client/src/components/spillman/__tests__/gridSort.test.ts
git commit -m "feat(spillman): stable sortGridRows helper"
```

---

## Task 4: Kit stylesheet + global import

**Files:**
- Create: `client/src/styles/spillman-kit.css`
- Modify: `client/src/main.tsx` (line 14 area — after the existing `import './styles/spillman.css';`)

- [ ] **Step 1: Create the kit stylesheet**

```css
/* Spillman Flex chrome kit — GLOBAL (unscoped) styles for the shared
   components in client/src/components/spillman/. Window/toolbar/group-box
   use the themeable --spm-* tokens (day/night aware); the status grid is a
   fixed dark console (Spillman CAD is dark-always). */

/* ── Window shell ─────────────────────────────────────────────── */
.spm-window { display: flex; flex-direction: column; border: 1px solid var(--spm-border); background: var(--spm-form); color: var(--spm-text); }
.spm-window-titlebar { display: flex; align-items: center; gap: 8px; padding: 3px 8px; font-size: 12px; background: linear-gradient(#c2c7cf, #aab1bb); color: #1c2530; }
.spm-window-title { font-weight: 600; }
.spm-window-screen { flex: 1; text-align: center; color: #2a3346; }
.spm-window-controls { display: flex; gap: 4px; }
.spm-window-controls button { width: 18px; height: 16px; line-height: 14px; font-size: 11px; border: 1px solid #8a909a; background: #d6dae0; color: #2a3346; border-radius: 2px; }
.spm-window-controls .spm-window-close { background: #c0504d; border-color: #913b39; color: #fff; }
.spm-window-body { flex: 1; min-height: 0; }
.spm-window-status { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 8px; background: var(--spm-chrome); color: var(--spm-text-muted); border-top: 1px solid var(--spm-border); }

/* ── Toolbar ──────────────────────────────────────────────────── */
.spm-toolbar { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 3px 6px; background: var(--spm-toolbar); border-bottom: 1px solid var(--spm-border); }
.spm-toolbar-leading { display: flex; align-items: center; margin-right: 6px; }
.spm-toolbar .toolbar-btn { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; font-size: 11px; border: 1px solid transparent; background: transparent; color: var(--spm-text); border-radius: 2px; }
.spm-toolbar .toolbar-btn:hover:not(:disabled) { background: var(--spm-toolbar-hover); border-color: var(--spm-border); }
.spm-toolbar .toolbar-btn:active:not(:disabled) { background: var(--spm-toolbar-active); }
.spm-toolbar .toolbar-btn:disabled { opacity: .45; }
.spm-toolbar .toolbar-btn-primary { background: var(--spm-toolbar-primary); border-color: var(--spm-border); font-weight: 600; }

/* ── Group box ────────────────────────────────────────────────── */
.spm-groupbox { border: 1px solid var(--spm-border); background: var(--spm-field); margin: 0 0 6px; padding: 0; }
.spm-groupbox-head { font-size: 11px; font-weight: 600; padding: 2px 8px; color: var(--spm-accent); background: var(--spm-group-head); }
.spm-groupbox-body { display: grid; gap: 4px 12px; padding: 6px 8px; }

/* ── Status grid (fixed dark console) ─────────────────────────── */
.spm-status-grid { display: flex; flex-direction: column; min-height: 0; background: #0a0a0a; border: 1px solid #2a2f37; }
.spm-status-grid-head { display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 2px 6px; background: #b9c0cb; color: #1c2530; }
.spm-status-grid-title { font-weight: 600; }
.spm-status-grid-table { width: 100%; border-collapse: collapse; font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; table-layout: fixed; }
.spm-status-grid-table th { background: #1c1f24; color: #9aa3b0; font-weight: 600; padding: 2px 4px; text-align: left; cursor: default; user-select: none; }
.spm-status-grid-table th[aria-sort] { cursor: pointer; }
.spm-status-grid-table td { padding: 1px 4px; color: #cfd6e0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.spm-status-grid-table tr[aria-selected="true"] { outline: 1px solid #4f7fc0; outline-offset: -1px; }
.spm-status-grid-table tbody tr:hover { background: #15191f; }
```

- [ ] **Step 2: Import the stylesheet in main.tsx**

In `client/src/main.tsx`, immediately after the existing line `import './styles/spillman.css';`, add:

```ts
import './styles/spillman-kit.css';
```

- [ ] **Step 3: Verify it builds (CSS resolves)**

Run: `npx tsc --noEmit`
Expected: PASS (no TS errors — CSS import is side-effecting only).

- [ ] **Step 4: Commit**

```bash
git add client/src/styles/spillman-kit.css client/src/main.tsx
git commit -m "feat(spillman): global chrome-kit stylesheet + import"
```

---

## Task 5: `SpillmanStatusGrid` component (TDD)

**Files:**
- Create: `client/src/components/spillman/SpillmanStatusGrid.tsx`
- Test: `client/src/components/spillman/__tests__/SpillmanStatusGrid.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SpillmanStatusGrid, { type StatusColumn, type SpillmanStatusGridProps } from '../SpillmanStatusGrid';

afterEach(cleanup);

interface Row { id: string; nature: string; p: number }
const columns: StatusColumn[] = [
  { key: 'p', label: 'P', align: 'center' },
  { key: 'nature', label: 'Nature' },
];
const rows: Row[] = [
  { id: 'b', nature: 'Fire', p: 1 },
  { id: 'a', nature: 'Theft', p: 3 },
];

function renderGrid(extra: Partial<SpillmanStatusGridProps<Row>> = {}) {
  return render(
    <SpillmanStatusGrid<Row>
      title="Undispatched calls"
      badge="cad_1"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      {...extra}
    />,
  );
}

describe('SpillmanStatusGrid', () => {
  it('renders title, badge, a header per column and a row per item', () => {
    renderGrid();
    expect(screen.getByText('Undispatched calls')).toBeInTheDocument();
    expect(screen.getByText('cad_1')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    expect(screen.getByText('Fire')).toBeInTheDocument();
    expect(screen.getByText('Theft')).toBeInTheDocument();
  });

  it('fires onSelect on row click and onActivate on double-click', () => {
    const onSelect = vi.fn();
    const onActivate = vi.fn();
    renderGrid({ onSelect, onActivate });
    fireEvent.click(screen.getByText('Fire'));
    expect(onSelect).toHaveBeenCalledWith(rows[0]);
    fireEvent.doubleClick(screen.getByText('Theft'));
    expect(onActivate).toHaveBeenCalledWith(rows[1]);
  });

  it('fires onSort when a header is clicked', () => {
    const onSort = vi.fn();
    renderGrid({ onSort });
    fireEvent.click(screen.getByText('Nature'));
    expect(onSort).toHaveBeenCalledWith('nature');
  });

  it('applies rowColor as inline text color', () => {
    renderGrid({ rowColor: () => 'var(--spm-pri-1)' });
    const cell = screen.getByText('Fire');
    expect(cell.closest('tr')).toHaveStyle({ color: 'var(--spm-pri-1)' });
  });

  it('sorts rows when sortKey is provided', () => {
    renderGrid({ sortKey: 'nature', sortDir: 'asc' });
    const cells = screen.getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toContain('Fire');
    const order = screen.getAllByRole('row').slice(1).map((tr) => tr.textContent);
    expect(order[0]).toContain('Fire');
    expect(order[1]).toContain('Theft');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/spillman/__tests__/SpillmanStatusGrid.test.tsx`
Expected: FAIL — cannot resolve `../SpillmanStatusGrid`.

- [ ] **Step 3: Write the implementation**

```tsx
import React from 'react';
import { sortGridRows } from './gridSort';

export interface StatusColumn {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
}

export interface SpillmanStatusGridProps<T extends Record<string, any>> {
  title: string;
  badge?: string;
  columns: StatusColumn[];
  rows: T[];
  rowKey: (row: T) => string;
  rowColor?: (row: T) => string;
  renderCell?: (row: T, col: StatusColumn) => React.ReactNode;
  selectedKey?: string;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  onSelect?: (row: T) => void;
  onActivate?: (row: T) => void;
  onContextMenu?: (row: T, e: React.MouseEvent) => void;
  onDropRow?: (row: T, e: React.DragEvent) => void;
}

/** Black, monospace, color-coded status grid — the CAD board's core panel.
 *  All behavior is injected via props; sorting is local when sortKey is set. */
export default function SpillmanStatusGrid<T extends Record<string, any>>(
  props: SpillmanStatusGridProps<T>,
) {
  const {
    title, badge, columns, rows, rowKey, rowColor, renderCell,
    selectedKey, sortKey, sortDir = 'asc', onSort,
    onSelect, onActivate, onContextMenu, onDropRow,
  } = props;

  const ordered = sortKey ? sortGridRows(rows, sortKey, sortDir) : rows;

  return (
    <div className="spm-status-grid">
      <div className="spm-status-grid-head">
        <span className="spm-status-grid-title">{title}</span>
        {badge && <span className="spm-status-grid-badge">{badge}</span>}
      </div>
      <table className="spm-status-grid-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{ width: c.width, textAlign: c.align ?? 'left' }}
                aria-sort={
                  sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined
                }
                onClick={onSort ? () => onSort(c.key) : undefined}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((row) => {
            const k = rowKey(row);
            return (
              <tr
                key={k}
                aria-selected={selectedKey === k ? true : undefined}
                style={rowColor ? { color: rowColor(row) } : undefined}
                onClick={onSelect ? () => onSelect(row) : undefined}
                onDoubleClick={onActivate ? () => onActivate(row) : undefined}
                onContextMenu={onContextMenu ? (e) => onContextMenu(row, e) : undefined}
                onDragOver={onDropRow ? (e) => e.preventDefault() : undefined}
                onDrop={onDropRow ? (e) => onDropRow(row, e) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align ?? 'left' }}>
                    {renderCell ? renderCell(row, c) : String(row[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/spillman/__tests__/SpillmanStatusGrid.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/spillman/SpillmanStatusGrid.tsx client/src/components/spillman/__tests__/SpillmanStatusGrid.test.tsx
git commit -m "feat(spillman): SpillmanStatusGrid (sortable color-coded CAD grid)"
```

---

## Task 6: `SpillmanWindow` component (TDD)

**Files:**
- Create: `client/src/components/spillman/SpillmanWindow.tsx`
- Test: `client/src/components/spillman/__tests__/SpillmanWindow.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SpillmanWindow from '../SpillmanWindow';

afterEach(cleanup);

describe('SpillmanWindow', () => {
  it('renders title, screen name and children', () => {
    render(
      <SpillmanWindow title="Brown, James" screenName="Names Table">
        <p>body</p>
      </SpillmanWindow>,
    );
    expect(screen.getByText('Brown, James')).toBeInTheDocument();
    expect(screen.getByText('Names Table')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('renders a status bar only when status content is provided', () => {
    const { rerender } = render(<SpillmanWindow title="t"><span /></SpillmanWindow>);
    expect(document.querySelector('.spm-window-status')).toBeNull();
    rerender(
      <SpillmanWindow title="t" statusLeft="User: czamora" statusRight="OVR Rec">
        <span />
      </SpillmanWindow>,
    );
    expect(screen.getByText('User: czamora')).toBeInTheDocument();
    expect(screen.getByText('OVR Rec')).toBeInTheDocument();
  });

  it('calls onClose when the close control is clicked', () => {
    const onClose = vi.fn();
    render(<SpillmanWindow title="t" onClose={onClose}><span /></SpillmanWindow>);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/spillman/__tests__/SpillmanWindow.test.tsx`
Expected: FAIL — cannot resolve `../SpillmanWindow`.

- [ ] **Step 3: Write the implementation**

```tsx
import React from 'react';

export interface SpillmanWindowProps {
  title: string;
  screenName?: string;
  statusLeft?: React.ReactNode;
  statusRight?: React.ReactNode;
  onMinimize?: () => void;
  onMaximize?: () => void;
  onClose?: () => void;
  children: React.ReactNode;
}

/** Spillman window shell: grey title bar (title / screen name / controls),
 *  a body region, and an optional status bar. */
export default function SpillmanWindow({
  title, screenName, statusLeft, statusRight,
  onMinimize, onMaximize, onClose, children,
}: SpillmanWindowProps) {
  const hasStatus = statusLeft != null || statusRight != null;
  return (
    <div className="spm-window">
      <div className="spm-window-titlebar">
        <span className="spm-window-title">{title}</span>
        {screenName && <span className="spm-window-screen">{screenName}</span>}
        <span className="spm-window-controls">
          {onMinimize && (
            <button type="button" aria-label="Minimize" onClick={onMinimize}>–</button>
          )}
          {onMaximize && (
            <button type="button" aria-label="Maximize" onClick={onMaximize}>□</button>
          )}
          {onClose && (
            <button type="button" className="spm-window-close" aria-label="Close" onClick={onClose}>×</button>
          )}
        </span>
      </div>
      <div className="spm-window-body">{children}</div>
      {hasStatus && (
        <div className="spm-window-status">
          <span>{statusLeft}</span>
          <span>{statusRight}</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/spillman/__tests__/SpillmanWindow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/spillman/SpillmanWindow.tsx client/src/components/spillman/__tests__/SpillmanWindow.test.tsx
git commit -m "feat(spillman): SpillmanWindow shell"
```

---

## Task 7: `SpillmanToolbar` component (TDD)

**Files:**
- Create: `client/src/components/spillman/SpillmanToolbar.tsx`
- Test: `client/src/components/spillman/__tests__/SpillmanToolbar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SpillmanToolbar, { type ToolbarButton } from '../SpillmanToolbar';

afterEach(cleanup);

describe('SpillmanToolbar', () => {
  it('renders a button per entry with accessible labels', () => {
    const buttons: ToolbarButton[] = [
      { id: 'srch', label: 'Srch' },
      { id: 'add', label: 'Add' },
    ];
    render(<SpillmanToolbar ariaLabel="Records actions" buttons={buttons} />);
    expect(screen.getByRole('toolbar', { name: 'Records actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Srch' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('fires onClick and respects disabled', () => {
    const onClick = vi.fn();
    const onDisabled = vi.fn();
    const buttons: ToolbarButton[] = [
      { id: 'a', label: 'Go', onClick },
      { id: 'b', label: 'Nope', onClick: onDisabled, disabled: true },
    ];
    render(<SpillmanToolbar ariaLabel="t" buttons={buttons} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nope' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(onDisabled).not.toHaveBeenCalled();
  });

  it('renders the leading slot', () => {
    render(
      <SpillmanToolbar ariaLabel="t" leading={<span>AV</span>} buttons={[{ id: 'x', label: 'X' }]} />,
    );
    expect(screen.getByText('AV')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/spillman/__tests__/SpillmanToolbar.test.tsx`
Expected: FAIL — cannot resolve `../SpillmanToolbar`.

- [ ] **Step 3: Write the implementation**

```tsx
import React from 'react';

export interface ToolbarButton {
  id: string;
  icon?: React.ReactNode;
  label?: string;
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
}

interface SpillmanToolbarProps {
  buttons: ToolbarButton[];
  leading?: React.ReactNode;
  ariaLabel: string;
}

/** A Spillman toolbar row of icon+label buttons. Icon-agnostic: pass any node. */
export default function SpillmanToolbar({ buttons, leading, ariaLabel }: SpillmanToolbarProps) {
  return (
    <div className="spm-toolbar" role="toolbar" aria-label={ariaLabel}>
      {leading && <div className="spm-toolbar-leading">{leading}</div>}
      {buttons.map((b) => (
        <button
          key={b.id}
          type="button"
          className={`toolbar-btn${b.primary ? ' toolbar-btn-primary' : ''}`}
          title={b.title ?? b.label}
          aria-label={b.label ?? b.title ?? b.id}
          disabled={b.disabled}
          onClick={b.onClick}
        >
          {b.icon}
          {b.label && <span className="spm-toolbar-label">{b.label}</span>}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/spillman/__tests__/SpillmanToolbar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/spillman/SpillmanToolbar.tsx client/src/components/spillman/__tests__/SpillmanToolbar.test.tsx
git commit -m "feat(spillman): SpillmanToolbar button row"
```

---

## Task 8: `SpillmanGroupBox` component (TDD)

**Files:**
- Create: `client/src/components/spillman/SpillmanGroupBox.tsx`
- Test: `client/src/components/spillman/__tests__/SpillmanGroupBox.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, cleanup } from '@testing-library/react';
import SpillmanGroupBox from '../SpillmanGroupBox';

afterEach(cleanup);

describe('SpillmanGroupBox', () => {
  it('renders the title and children', () => {
    render(
      <SpillmanGroupBox title="Name and Address">
        <label>Last</label>
      </SpillmanGroupBox>,
    );
    expect(screen.getByText('Name and Address')).toBeInTheDocument();
    expect(screen.getByText('Last')).toBeInTheDocument();
  });

  it('exposes the section anchor and column count', () => {
    const { container } = render(
      <SpillmanGroupBox title="Traits" anchor="spm-sec-traits" columns={3}>
        <span />
      </SpillmanGroupBox>,
    );
    expect(container.querySelector('[data-section-anchor="spm-sec-traits"]')).not.toBeNull();
    const body = container.querySelector('.spm-groupbox-body') as HTMLElement;
    expect(body.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/spillman/__tests__/SpillmanGroupBox.test.tsx`
Expected: FAIL — cannot resolve `../SpillmanGroupBox`.

- [ ] **Step 3: Write the implementation**

```tsx
import React from 'react';

export interface SpillmanGroupBoxProps {
  title: string;
  anchor?: string;
  columns?: number;
  children: React.ReactNode;
}

/** Titled Spillman group box. `anchor` exposes a data-section-anchor hook
 *  (used by the Records form-tab strip in P2); `columns` sets the field grid. */
export default function SpillmanGroupBox({
  title, anchor, columns = 2, children,
}: SpillmanGroupBoxProps) {
  return (
    <fieldset className="spm-groupbox" data-section-anchor={anchor}>
      <legend className="spm-groupbox-head">{title}</legend>
      <div
        className="spm-groupbox-body"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {children}
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/spillman/__tests__/SpillmanGroupBox.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/spillman/SpillmanGroupBox.tsx client/src/components/spillman/__tests__/SpillmanGroupBox.test.tsx
git commit -m "feat(spillman): SpillmanGroupBox titled field group"
```

---

## Task 9: Generic `SpillmanMenuBar` component (TDD)

The Records page keeps its own `pages/records/spillman/SpillmanMenuBar.tsx` until P2. This is the generic, config-driven version the kit exports (used by the CAD board in P1).

**Files:**
- Create: `client/src/components/spillman/SpillmanMenuBar.tsx`
- Test: `client/src/components/spillman/__tests__/SpillmanMenuBar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SpillmanMenuBar, { type MenuSpec } from '../SpillmanMenuBar';

afterEach(cleanup);

describe('SpillmanMenuBar (generic)', () => {
  it('renders only menus that have at least one actionable item', () => {
    const menus: MenuSpec[] = [
      { name: 'File', items: [{ label: 'New', onClick: vi.fn() }] },
      { name: 'Empty', items: [{ label: 'Nothing' }] },
    ];
    render(<SpillmanMenuBar menus={menus} />);
    expect(screen.getByText('File')).toBeInTheDocument();
    expect(screen.getByText('Empty')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Empty'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a dropdown and fires the item handler, then closes', () => {
    const onNew = vi.fn();
    const menus: MenuSpec[] = [{ name: 'File', items: [{ label: 'New', onClick: onNew }] }];
    render(<SpillmanMenuBar menus={menus} />);
    fireEvent.click(screen.getByText('File'));
    const item = screen.getByRole('menuitem', { name: 'New' });
    fireEvent.click(item);
    expect(onNew).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/spillman/__tests__/SpillmanMenuBar.test.tsx`
Expected: FAIL — cannot resolve `../SpillmanMenuBar`.

- [ ] **Step 3: Write the implementation**

```tsx
import React, { useState } from 'react';

export interface MenuItem { label: string; onClick?: () => void; }
export interface MenuSpec { name: string; items: MenuItem[]; }

/** Config-driven Spillman menu bar. Menus with no actionable item still show
 *  a (disabled-feeling) label but never open an empty dropdown. */
export default function SpillmanMenuBar({ menus }: { menus: MenuSpec[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="spm-menubar" role="menubar" onMouseLeave={() => setOpen(null)}>
      {menus.map(({ name, items }) => {
        const live = items.filter((i) => typeof i.onClick === 'function');
        const has = live.length > 0;
        return (
          <div key={name} className="spm-menu">
            <button
              type="button"
              className="spm-menu-label"
              aria-haspopup={has ? 'true' : undefined}
              aria-expanded={has ? open === name : undefined}
              onClick={() => { if (has) setOpen(open === name ? null : name); }}
            >
              {name}
            </button>
            {open === name && has && (
              <div className="spm-menu-dropdown" role="menu">
                {live.map((i) => (
                  <button
                    key={i.label}
                    type="button"
                    role="menuitem"
                    className="spm-menu-item"
                    onClick={() => { i.onClick?.(); setOpen(null); }}
                  >
                    {i.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/spillman/__tests__/SpillmanMenuBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/spillman/SpillmanMenuBar.tsx client/src/components/spillman/__tests__/SpillmanMenuBar.test.tsx
git commit -m "feat(spillman): generic config-driven SpillmanMenuBar"
```

---

## Task 10: Barrel export, full verification, SW bump

**Files:**
- Create: `client/src/components/spillman/index.ts`
- Modify: `client/public/sw.js:622`

- [ ] **Step 1: Write the barrel**

```ts
export { default as SpillmanWindow } from './SpillmanWindow';
export type { SpillmanWindowProps } from './SpillmanWindow';
export { default as SpillmanToolbar } from './SpillmanToolbar';
export type { ToolbarButton } from './SpillmanToolbar';
export { default as SpillmanMenuBar } from './SpillmanMenuBar';
export type { MenuItem, MenuSpec } from './SpillmanMenuBar';
export { default as SpillmanGroupBox } from './SpillmanGroupBox';
export type { SpillmanGroupBoxProps } from './SpillmanGroupBox';
export { default as SpillmanStatusGrid } from './SpillmanStatusGrid';
export type { StatusColumn, SpillmanStatusGridProps } from './SpillmanStatusGrid';
export { priorityColor, unitStatusColor } from './spillmanColors';
export { sortGridRows } from './gridSort';
```

- [ ] **Step 2: Bump the service-worker cache name**

In `client/public/sw.js` line 622, change:

```js
const CACHE_NAME = 'rmpg-flex-v972';
```
to:
```js
const CACHE_NAME = 'rmpg-flex-v973';
```

- [ ] **Step 3: Run the full kit test suite**

Run: `npx vitest run src/components/spillman/`
Expected: PASS — 7 test files (spillmanColors, gridSort, SpillmanStatusGrid, SpillmanWindow, SpillmanToolbar, SpillmanGroupBox, SpillmanMenuBar), all green.

- [ ] **Step 4: Typecheck the client**

Run: `npx tsc --noEmit`
Expected: PASS — no errors.

- [ ] **Step 5: Production build smoke**

Run: `npx vite build`
Expected: build completes; `spillman-kit.css` is bundled (it is imported by `main.tsx`).

- [ ] **Step 6: Commit**

```bash
git add client/src/components/spillman/index.ts client/public/sw.js
git commit -m "feat(spillman): barrel export for chrome kit + SW cache bump v973"
```

---

## Done criteria

- `client/src/components/spillman/` exports `SpillmanWindow`, `SpillmanToolbar`, `SpillmanMenuBar`, `SpillmanGroupBox`, `SpillmanStatusGrid`, `priorityColor`, `unitStatusColor`, `sortGridRows`.
- 7 vitest files pass; `tsc --noEmit` clean; `vite build` succeeds.
- No live page imports the kit yet (P1 wires the CAD board; P2 wires Records) — so behavior of the running app is unchanged except the (empty until used) kit stylesheet and the SW bump.
- Open a PR off this branch (feature branch → `gh pr create`), let CI run the standard gates.
