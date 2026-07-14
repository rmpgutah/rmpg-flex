# Warrants List Tab Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the "Warrants" (list) tab out of the 4,503-line `client/src/pages/WarrantsPage.tsx` megafile into its own self-contained component, apply the approved moderate-polish visual treatment (pill status badges, looser row/toolbar spacing), and add smoke-test coverage — with zero behavior change beyond the visual polish.

**Architecture:** Follows the existing extraction pattern already used in this exact file for `ScrapersTab` (`client/src/pages/warrants/ScrapersTab.tsx`, imported as `<ScrapersTab />`) and `ScreeningWorkspace` (`./ScreeningPage`). A new self-contained `client/src/pages/warrants/WarrantsListTab.tsx` owns all Warrants-tab-only state (filters, search, sort, pagination, batch actions, the selected-warrant detail panel, and the Serve/Delete/Archive/Unarchive/Update-status actions — all of which mutate the tab's own `warrants` array). The still-shell-owned New/Edit Warrant form modal (deliberately deferred to a later phase per the rebuild spec) talks back to the list via a `forwardRef` + `useImperativeHandle` handle, since `handleSubmit` in the shell needs to update the list's `warrants` array and its `error` banner after a save — a standard React pattern for "parent-owned modal, child-owned list" without prematurely restructuring modal ownership.

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind (Blue & Silver design tokens), Vitest + Testing Library.

**Correction to the rebuild spec:** The design spec (`docs/superpowers/specs/2026-07-14-warrants-page-rebuild-design.md`) describes four tabs (Dashboard, Warrants list, Search-All, Sources). The actual `TabId` union is `'dashboard' | 'warrants' | 'search-all' | 'screening' | 'watch' | 'sources' | 'scrapers'` — seven tabs, two of which (`scrapers`, `screening`) are *already* extracted into their own files. This plan only affects the `warrants` tab and doesn't depend on that correction, but later migration-order plans should target the corrected 5 remaining tabs (dashboard, warrants ← this plan, search-all, watch, sources), not 3.

---

## File structure

- **Create:** `client/src/components/warrants/StatusPill.tsx` — shared status-badge component (used by List, Search-All, and Sources tabs; only List is touched by this plan, the other two call sites are left as-is for now and updated when those tabs are migrated).
- **Create:** `client/src/components/warrants/__tests__/StatusPill.test.tsx`
- **Create:** `client/src/pages/warrants/WarrantsListTab.tsx` — the extracted tab.
- **Create:** `client/src/pages/warrants/__tests__/WarrantsListTab.test.tsx`
- **Modify:** `client/src/pages/WarrantsPage.tsx` — remove the extracted state/handlers/JSX, add the `<WarrantsListTab>` embed + imperative-ref wiring for the form modal, export the `Warrant`/`UnifiedWarrant` interfaces so the new files can import them.

---

### Task 1: `StatusPill` shared component

**Files:**
- Create: `client/src/components/warrants/StatusPill.tsx`
- Test: `client/src/components/warrants/__tests__/StatusPill.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/warrants/__tests__/StatusPill.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StatusPill from '../StatusPill';

describe('StatusPill', () => {
  it('renders the display label for a known status', () => {
    render(<StatusPill status="active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders a colored dot alongside the label', () => {
    render(<StatusPill status="served" />);
    const dot = screen.getByTestId('status-pill-dot');
    expect(dot).toBeInTheDocument();
  });

  it('falls back to a neutral style for an unrecognized status', () => {
    render(<StatusPill status="unknown-status" />);
    expect(screen.getByText('Unknown Status')).toBeInTheDocument();
  });

  it('applies the sm size classes by default', () => {
    render(<StatusPill status="active" />);
    expect(screen.getByTestId('status-pill')).toHaveClass('text-[10px]');
  });

  it('applies the md size classes when size="md"', () => {
    render(<StatusPill status="active" size="md" />);
    expect(screen.getByTestId('status-pill')).toHaveClass('text-xs');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/warrants/__tests__/StatusPill.test.tsx`
Expected: FAIL — `Cannot find module '../StatusPill'`

- [ ] **Step 3: Write the component**

```tsx
// client/src/components/warrants/StatusPill.tsx
import { formatEnumValue } from '../../utils/formatters';

// Moderate-polish pill treatment for warrant status — see
// docs/superpowers/specs/2026-07-14-warrants-page-rebuild-design.md.
// This is a deliberate, scoped exception to the project-wide dense-table
// "no pill badges" rule (CLAUDE.md, Design tokens section) — do not
// generalize this component's styling to other tables.
const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  active:   { bg: 'bg-red-500/15',    text: 'text-red-400',    border: 'border-red-500/40',    dot: 'bg-red-500' },
  served:   { bg: 'bg-green-500/15',  text: 'text-green-400',  border: 'border-green-500/40',  dot: 'bg-green-500' },
  recalled: { bg: 'bg-amber-500/15',  text: 'text-amber-400',  border: 'border-amber-500/40',  dot: 'bg-amber-500' },
  expired:  { bg: 'bg-rmpg-500/15',   text: 'text-rmpg-300',   border: 'border-rmpg-500/40',   dot: 'bg-rmpg-400' },
  quashed:  { bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-purple-500/40', dot: 'bg-purple-500' },
};
const FALLBACK_STYLE = { bg: 'bg-rmpg-700/40', text: 'text-rmpg-300', border: 'border-rmpg-600/50', dot: 'bg-rmpg-400' };

interface StatusPillProps {
  status: string;
  size?: 'sm' | 'md';
}

export default function StatusPill({ status, size = 'sm' }: StatusPillProps) {
  const style = STATUS_STYLES[status] ?? FALLBACK_STYLE;
  const sizeClasses = size === 'sm'
    ? 'text-[10px] px-2 py-0.5'
    : 'text-xs px-2.5 py-1';

  return (
    <span
      data-testid="status-pill"
      className={`inline-flex items-center gap-1.5 font-bold rounded-full border ${style.bg} ${style.text} ${style.border} ${sizeClasses}`}
    >
      <span data-testid="status-pill-dot" className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      {formatEnumValue(status)}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/warrants/__tests__/StatusPill.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/warrants/StatusPill.tsx client/src/components/warrants/__tests__/StatusPill.test.tsx
git commit -m "feat(warrants): add shared StatusPill component"
```

---

### Task 2: Export shared types from `WarrantsPage.tsx`

**Files:**
- Modify: `client/src/pages/WarrantsPage.tsx:59` (interface `Warrant`)
- Modify: `client/src/pages/WarrantsPage.tsx:182` (interface `UnifiedWarrant`)

- [ ] **Step 1: Add `export` to both interfaces**

At `client/src/pages/WarrantsPage.tsx:59`, change:
```ts
interface Warrant {
```
to:
```ts
export interface Warrant {
```

At `client/src/pages/WarrantsPage.tsx:182`, change:
```ts
interface UnifiedWarrant extends Warrant {
  source?: string | null;
}
```
to:
```ts
export interface UnifiedWarrant extends Warrant {
  source?: string | null;
}
```

- [ ] **Step 2: Verify typecheck still passes**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (adding `export` to an already-used-only-internally interface cannot break anything)

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/WarrantsPage.tsx
git commit -m "refactor(warrants): export Warrant/UnifiedWarrant types for reuse by extracted tabs"
```

---

### Task 3: Create `WarrantsListTab.tsx` — scaffold, props, and imperative handle

**Files:**
- Create: `client/src/pages/warrants/WarrantsListTab.tsx`

This task creates the file's skeleton — imports, prop/handle types, and the `forwardRef` wrapper — with a placeholder `return null` body. Task 4 fills in the moved state/handlers/JSX.

- [ ] **Step 1: Write the file skeleton**

```tsx
// client/src/pages/warrants/WarrantsListTab.tsx
// ============================================================
// Warrants — List tab
// ============================================================
// Extracted from the WarrantsPage.tsx megafile (see
// docs/superpowers/specs/2026-07-14-warrants-page-rebuild-design.md and
// docs/superpowers/plans/2026-07-14-warrants-list-tab-extraction.md).
//
// Owns: the warrant list/filters/search/sort/pagination/batch-actions,
// the selected-warrant detail panel, and the Serve/Delete/Archive/
// Unarchive/Update-status actions (all of which mutate this tab's own
// `warrants` array, hence why they live here and not in the shell).
//
// The New/Edit Warrant form modal is still owned by the shell
// (WarrantsPage.tsx) — deliberately deferred to a later extraction phase.
// Because that modal's save handler needs to update THIS tab's warrant
// list and error banner, this component exposes a WarrantsListTabHandle
// via forwardRef/useImperativeHandle that the shell calls into after a
// successful save.
// ============================================================

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle, Eye, Loader2, MapPin, User, X,
} from 'lucide-react';
import IconButton from '../../components/IconButton';
import ConfirmDialog from '../../components/ConfirmDialog';
import ViewOnMapLink from '../../components/ViewOnMapLink';
import JurisdictionLookup from '../../components/JurisdictionLookup';
import PrintRecordButton from '../../components/PrintRecordButton';
import WarrantNsopwStatus from '../../components/WarrantNsopwStatus';
import LinkedEmailsSection from '../../components/LinkedEmailsSection';
import EmailedDocuments from '../../components/EmailedDocuments';
import CollapsibleSection from '../../components/CollapsibleSection';
import StatusPill from '../../components/warrants/StatusPill';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../../components/ToastProvider';
import { useContextMenu, type ContextMenuItem } from '../../context/ContextMenuContext';
import { useMenuActions } from '../../utils/contextMenuActions';
import { formatDate, formatDateTime } from '../../utils/dateUtils';
import {
  priorityBucket, priorityChipClass, formatAge, freshnessClass, freshnessIcon,
  stateFromSource,
} from '../../utils/warrantListHelpers';
import { buildWarrantPacketPdf } from '../../utils/warrantPacket';
import { displayUserName } from '../../utils/userDisplay';
import type { Warrant, UnifiedWarrant } from '../WarrantsPage';

export interface WarrantsListTabHandle {
  /** Re-fetch the current page of the list (used after the shell's Form modal saves). */
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
  /** Patch a single warrant in the already-loaded list without a full refetch. */
  applyWarrantUpdate: (updated: Warrant) => void;
  /** If `id` matches the currently-selected/expanded warrant, re-fetch its detail. */
  refetchIfSelected: (id: number) => void;
  /** Surface an error in this tab's error banner (used by the shell's Form modal). */
  setListError: (message: string | null) => void;
}

export interface WarrantsListTabProps {
  /** Controls visibility without unmounting — see Task 5 (always-mounted pattern). */
  isVisible: boolean;
  user: { role?: string; full_name?: string; badge_number?: string } | null;
  isAdminOrManager: boolean;
  isGodMode: boolean;
  canManageWarrants: boolean;
  isMobile: boolean;
  navigate: NavigateFunction;
  /** From the shell's useSearchParams() — read once on mount for deep-link init. */
  initialPersonId: string | null;
  initialWarrantId: string | null;
  /** Whether the shell's Form modal is currently open (used to hide the mobile FAB). */
  formOpen: boolean;
  onOpenNewForm: () => void;
  onOpenEditForm: (w: Warrant) => void;
  onOpenPersonProfile: (personId: number) => void;
}

const WarrantsListTab = forwardRef<WarrantsListTabHandle, WarrantsListTabProps>(function WarrantsListTab(props, ref) {
  const { isVisible } = props;
  const { addToast } = useToast();

  useImperativeHandle(ref, () => ({
    refresh: async (opts) => { /* filled in Task 4 */ },
    applyWarrantUpdate: (updated) => { /* filled in Task 4 */ },
    refetchIfSelected: (id) => { /* filled in Task 4 */ },
    setListError: (message) => { /* filled in Task 4 */ },
  }));

  return (
    <div style={{ display: isVisible ? undefined : 'none' }}>
      {/* filled in Task 4 */}
    </div>
  );
});

export default WarrantsListTab;
```

- [ ] **Step 2: Verify it typechecks (unused-var errors expected and OK for now)**

Run: `cd client && npx tsc --noEmit 2>&1 | grep WarrantsListTab`
Expected: no errors referencing missing imports/types (unused-variable warnings are suppressed — `tsconfig.json` has `noUnusedLocals: false`, `noUnusedParameters: false`)

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/warrants/WarrantsListTab.tsx
git commit -m "feat(warrants): scaffold WarrantsListTab component (empty shell)"
```

---

### Task 4: Move state, handlers, and JSX into `WarrantsListTab.tsx`

**Files:**
- Modify: `client/src/pages/warrants/WarrantsListTab.tsx` (fill in the placeholders from Task 3)
- Modify: `client/src/pages/WarrantsPage.tsx` (remove the moved code — done in Task 5, after the new file is verified working, to keep a working intermediate state)

This is a mechanical move of already-correct code, not a rewrite. Copy each block from `WarrantsPage.tsx` **verbatim** (same logic, same variable names) into the new file, then apply the four surgical polish edits listed at the end of this task. Line numbers below are from `client/src/pages/WarrantsPage.tsx` as of this plan's writing — if the file has since changed, use `grep -n` for the anchor comments/strings quoted to relocate the block.

- [ ] **Step 1: Move state declarations**

Copy `client/src/pages/WarrantsPage.tsx:540-576` (from `const [warrants, setWarrants] = useState<UnifiedWarrant[]>([]);` through `const [filterArchivedChip, setFilterArchivedChip] = useState(false);`) into the body of `WarrantsListTab`, directly after the `useImperativeHandle` block. Also copy:
- `client/src/pages/WarrantsPage.tsx:787-792` (`deletingWarrant`, `deleteLoading`, `archiveConfirmOpen`, `archiveTargetId`)
- `client/src/pages/WarrantsPage.tsx:782-784` (`serveModalOpen`, `serveLocation`, `serving`)
- `client/src/pages/WarrantsPage.tsx:564-566` (`bulkUpdateConfirmOpen`, `bulkArchiveConfirmOpen`, `bulkPrintConfirmOpen`)
- `client/src/pages/WarrantsPage.tsx:541` (`selectedWarrant`, `setSelectedWarrant`)

Replace the two `useState<string | null>(initialPersonId)` / `useRef<string | null>(searchParams.get('warrant_id'))` patterns with the prop-fed versions:

```tsx
const [filterPersonId, setFilterPersonId] = useState<string | null>(props.initialPersonId);
const pendingWarrantIdRef = useRef<string | null>(props.initialWarrantId);
```

Add one `useId` for the serve modal title (replacing the shell's `serveTitleId`):

```tsx
const serveTitleId = useId();
```

(Add `useId` to the `react` import list from Task 3's skeleton.)

- [ ] **Step 2: Move data-fetching and mutation handlers**

Copy these functions verbatim from `client/src/pages/WarrantsPage.tsx` into `WarrantsListTab`, in this order:

- `fetchWarrants` — `client/src/pages/WarrantsPage.tsx:920-966` — but change the last line's `[filterStatus, ...]` dependency array's `debouncedSearch` (already correct per the earlier debounce fix) — no change needed, copy as-is.
- `silentRefreshWarrants` — `client/src/pages/WarrantsPage.tsx:1010-1018`
- `fetchWarrantDetail` — `client/src/pages/WarrantsPage.tsx:1019-1024`
- The `?warrant_id=` deep-link `useEffect` — `client/src/pages/WarrantsPage.tsx:1026-1057` (search for the comment `── /warrants?warrant_id=<id> deep-link auto-select ──`). Change its guard from `if (!target || activeTab !== 'warrants') return;` to `if (!target) return;` (this component only ever exists when the warrants tab context is relevant — `isVisible` governs display, not mount, per the always-mounted pattern in Task 5, and the ref is only non-null when a deep link was actually present).
- `toggleBatchSelect`, `toggleSelectAll` — `client/src/pages/WarrantsPage.tsx:598-611`
- `handleBatchUpdate`, `performBatchUpdate` — `client/src/pages/WarrantsPage.tsx:612-627`
- `handleBulkArchive`, `performBulkArchive` — `client/src/pages/WarrantsPage.tsx:639-661`
- `handleBulkReview` — `client/src/pages/WarrantsPage.tsx:663-673`
- `handleBulkPrintPacket`, `performBulkPrintPacket` — `client/src/pages/WarrantsPage.tsx:675-688` (search for `const handleBulkPrintPacket`)
- `toggleSort` (search for `const toggleSort =`)
- `handleServe` — `client/src/pages/WarrantsPage.tsx:1448-1467` (search for `const handleServe = async`)
- `handleUnarchive` — `client/src/pages/WarrantsPage.tsx:1484-1493`
- `handleDelete` — `client/src/pages/WarrantsPage.tsx:1494-1508`
- `handleUpdateStatus` — `client/src/pages/WarrantsPage.tsx:1510-1520`
- `handlePrintWarrantPdf` — search for `const handlePrintWarrantPdf =`
- `buildWarrantMenu` — search for `const buildWarrantMenu =` (needed by the row context menu; replace its `openEditForm(w)` call with `props.onOpenEditForm(w)` and `openPersonProfile(...)` with `props.onOpenPersonProfile(...)`)

In each copied handler, replace any reference to `openPersonProfile` with `props.onOpenPersonProfile`, and any reference to `openEditForm` with `props.onOpenEditForm` (these two functions stay shell-owned per this task's scope).

- [ ] **Step 3: Fill in the imperative handle**

Replace the placeholder handle from Task 3 with real implementations built from the handlers just moved in:

```tsx
useImperativeHandle(ref, () => ({
  refresh: (opts) => fetchWarrants(opts),
  applyWarrantUpdate: (updated) => {
    setWarrants((prev) => prev.map((w) => w.id === updated.id ? { ...w, ...updated } : w));
    if (selectedWarrant?.id === updated.id) setSelectedWarrant((prev) => prev ? { ...prev, ...updated } : prev);
  },
  refetchIfSelected: (id) => {
    if (selectedWarrant?.id === id) fetchWarrantDetail(id);
  },
  setListError: (message) => setError(message),
}), [fetchWarrants, selectedWarrant, fetchWarrantDetail]);
```

- [ ] **Step 4: Move JSX — toolbar action buttons**

Copy `client/src/pages/WarrantsPage.tsx:1635-1649` (both `{activeTab === 'warrants' && ...}` blocks — the "+ New Warrant" button and the export/print toolbar group) into the returned JSX. Change:
- `{activeTab === 'warrants' && !showArchived && isAdminOrManager && (` → `{!showArchived && props.isAdminOrManager && (`
- `{activeTab === 'warrants' && (` → the surrounding `{...}` wrapper is no longer needed (this component only renders warrants-tab content) — drop the conditional, keep the JSX inside it.
- Any `onClick={openNewForm}` → `onClick={props.onOpenNewForm}`
- Any bare `isAdminOrManager`/`isGodMode`/`canManageWarrants`/`isMobile`/`user` reference → `props.isAdminOrManager` / `props.isGodMode` / `props.canManageWarrants` / `props.isMobile` / `props.user`

- [ ] **Step 5: Move JSX — main content (filters, table, detail panel)**

Copy `client/src/pages/WarrantsPage.tsx:2041-2738` into the returned JSX, after the toolbar block from Step 4. Apply the same prop-prefixing rules as Step 4 throughout (`isAdminOrManager` → `props.isAdminOrManager`, etc. — `isMobile` appears very frequently in this block, in every responsive-layout ternary). Also:
- `onClick={() => openEditForm(selectedWarrant)}` → `onClick={() => props.onOpenEditForm(selectedWarrant)}`
- `onClick={() => openPersonProfile(selectedWarrant.subject_person_id!)}` and similar → `props.onOpenPersonProfile(...)`
- `navigate(...)` calls → `props.navigate(...)`

- [ ] **Step 6: Move JSX — Serve modal, Delete/Archive/Bulk confirm dialogs, mobile FAB**

Copy into the returned JSX, after the Step 5 block:
- Serve modal — `client/src/pages/WarrantsPage.tsx:4192-4224`
- Delete confirm `ConfirmDialog` — `client/src/pages/WarrantsPage.tsx:4232-4241` (search for `{/* DELETE CONFIRM */}`)
- Bulk status-update confirm — `client/src/pages/WarrantsPage.tsx:4243-4252`
- Bulk archive confirm — search for `{/* BULK ARCHIVE CONFIRM`
- Bulk print confirm — search for the third bulk `ConfirmDialog` following it
- Archive-single confirm — search for `archiveConfirmOpen` used in a `ConfirmDialog` (separate from delete)
- Mobile FAB — `client/src/pages/WarrantsPage.tsx:4226-4230`, changing `{isMobile && activeTab === 'warrants' && ...}` to `{props.isMobile && ...}` and `onClick={openNewForm}` to `onClick={props.onOpenNewForm}`

- [ ] **Step 7: Apply the four visual-polish edits (approved moderate-polish direction)**

These are the only intentional behavior-preserving *visual* changes in this migration — everything else in Steps 1–6 must be a byte-for-byte logic-preserving move.

1. Replace every inline status-badge `<span className={...STATUS_COLORS...}>{formatEnumValue(w.status)}</span>` pattern (there are three within the moved range — the list row, the mobile list row, and the detail-panel header) with `<StatusPill status={w.status} />` (or `status={selectedWarrant.status}` for the detail-panel one, using `size="md"`).
2. In the toolbar block (Step 4), increase button padding from the current `px-2 py-0.5`-style classes to `px-3 py-1.5` and add `font-semibold`.
3. In the table (Step 5), increase row cell padding from `py-1`-scale to `py-2` on desktop (leave the mobile card-row layout's existing padding — it's already touch-target-sized).
4. Under the subject name cell, add a secondary line showing DOB if present:
   ```tsx
   <div className="flex flex-col gap-0.5">
     <span className="text-rmpg-100 font-semibold">{w.subject_name || '—'}</span>
     {w.subject_dob && <span className="text-[10px] text-rmpg-500">DOB {formatDate(w.subject_dob)}</span>}
   </div>
   ```
   in place of the current bare `{w.subject_name}` cell content.

- [ ] **Step 8: Verify typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: errors ONLY in `WarrantsPage.tsx` about now-unused local declarations that got copied (not deleted) — no errors in `WarrantsListTab.tsx`. If `WarrantsListTab.tsx` itself has errors, fix them before proceeding (most likely cause: a missed `props.` prefix, or a helper/icon import missed from the Task 3 import list — check the exact error message and add the missing import from the matching line in `WarrantsPage.tsx`'s own import block).

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/warrants/WarrantsListTab.tsx
git commit -m "feat(warrants): move Warrants list tab logic + JSX into WarrantsListTab, apply moderate-polish styling"
```

---

### Task 5: Wire the shell (`WarrantsPage.tsx`) to render `WarrantsListTab`

**Files:**
- Modify: `client/src/pages/WarrantsPage.tsx`

- [ ] **Step 1: Import the new component and its handle type**

Near the top of `client/src/pages/WarrantsPage.tsx` (alongside the existing `import ScrapersTab from './warrants/ScrapersTab';`), add:

```tsx
import WarrantsListTab, { type WarrantsListTabHandle } from './warrants/WarrantsListTab';
```

- [ ] **Step 2: Add the ref and render the component**

Near the top of the `WarrantsPage` component body (alongside the other `useRef` declarations), add:

```tsx
const listTabRef = useRef<WarrantsListTabHandle>(null);
```

Replace every `{activeTab === 'warrants' && (...)}` block identified in Task 4 (the toolbar buttons at lines 1635-1649, the main content at 2041-2738, the Serve modal / confirm dialogs / mobile FAB moved in Task 4 Step 6) by **deleting** that JSX from `WarrantsPage.tsx` entirely and, in its place (at the position where the main content block used to be, i.e. where `{activeTab === 'warrants' && (` opened at line 2041), inserting:

```tsx
<WarrantsListTab
  ref={listTabRef}
  isVisible={activeTab === 'warrants'}
  user={user}
  isAdminOrManager={isAdminOrManager}
  isGodMode={isGodMode}
  canManageWarrants={canManageWarrants}
  isMobile={isMobile}
  navigate={navigate}
  initialPersonId={initialPersonId}
  initialWarrantId={pendingWarrantIdRef.current}
  formOpen={formOpen}
  onOpenNewForm={openNewForm}
  onOpenEditForm={openEditForm}
  onOpenPersonProfile={openPersonProfile}
/>
```

This is rendered unconditionally (not wrapped in `{activeTab === 'warrants' && ...}`) — `WarrantsListTab` manages its own visibility internally via the `isVisible` prop (`display: none` when not active), matching today's actual behavior where switching tabs does not unmount/reset the list's state (verified: `fetchWarrants`'s `useEffect` already re-fetches on every switch back to the tab, but filter/search input text is currently preserved across a tab switch — an unconditional-render-with-CSS-hide preserves this; a conditional-mount would not).

- [ ] **Step 3: Wire the Form modal's save handler to the ref**

In `handleSubmit` (`client/src/pages/WarrantsPage.tsx`, search for `const handleSubmit = async (e: React.FormEvent) => {`), replace the body's list-mutation lines:

```tsx
        setWarrants((prev) => prev.map((w) => w.id === editingWarrant.id ? { ...w, ...updated } : w));
        if (selectedWarrant?.id === editingWarrant.id) fetchWarrantDetail(editingWarrant.id);
```
with:
```tsx
        listTabRef.current?.applyWarrantUpdate(updated);
        listTabRef.current?.refetchIfSelected(editingWarrant.id);
```

and:
```tsx
        await apiFetch('/warrants', { method: 'POST', body: JSON.stringify(body) });
        await fetchWarrants({ silent: true });
```
with:
```tsx
        await apiFetch('/warrants', { method: 'POST', body: JSON.stringify(body) });
        await listTabRef.current?.refresh({ silent: true });
```

and in the `catch` block:
```tsx
    } catch (err: any) {
      setError(err?.message || 'Failed to save warrant');
```
with:
```tsx
    } catch (err: any) {
      listTabRef.current?.setListError(err?.message || 'Failed to save warrant');
```

- [ ] **Step 4: Delete the now-dead moved code from the shell**

Delete from `client/src/pages/WarrantsPage.tsx`: the state declarations, handlers, and `useEffect` moved in Task 4 Steps 1-2 (`warrants`, `selectedWarrant`, `loading`, `error`, all `filter*`/`sort*` state, `debouncedSearch`, `showArchived`, `page`/`totalPages`/`totalCount`, `expandedRowId`, `batchSelected`/`batchStatus`/`batchSubmitting`, the three `bulk*ConfirmOpen` flags, `deletingWarrant`/`deleteLoading`, `archiveConfirmOpen`/`archiveTargetId`, `serveModalOpen`/`serveLocation`/`serving`, `fetchWarrants`, `silentRefreshWarrants`, `fetchWarrantDetail`, the deep-link `useEffect`, `toggleBatchSelect`/`toggleSelectAll`, `handleBatchUpdate`/`performBatchUpdate`, `handleBulkArchive`/`performBulkArchive`, `handleBulkReview`, `handleBulkPrintPacket`/`performBulkPrintPacket`, `toggleSort`, `handleServe`, `handleUnarchive`, `handleDelete`, `handleUpdateStatus`, `handlePrintWarrantPdf`, `buildWarrantMenu`).

Do **not** delete `openNewForm`, `openEditForm`, `formOpen`, `editingWarrant`, `submitting`, `handleSubmit` — these stay in the shell (Form modal ownership, unchanged by this plan).

- [ ] **Step 5: Verify typecheck and full test suite**

Run: `cd client && npx tsc --noEmit`
Expected: no errors. If errors reference an identifier that used to live in the deleted block, that means Task 4 missed moving it — go back and add it to `WarrantsListTab.tsx`.

Run: `cd client && npx vitest run`
Expected: all existing tests still pass (this task doesn't touch other tabs' code paths).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/WarrantsPage.tsx
git commit -m "refactor(warrants): wire WarrantsListTab into the shell, remove moved code"
```

---

### Task 6: Smoke tests for `WarrantsListTab`

**Files:**
- Create: `client/src/pages/warrants/__tests__/WarrantsListTab.test.tsx`

- [ ] **Step 1: Write the smoke tests**

```tsx
// client/src/pages/warrants/__tests__/WarrantsListTab.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import WarrantsListTab from '../WarrantsListTab';
import * as useApiModule from '../../../hooks/useApi';

vi.mock('../../../components/ToastProvider', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));
vi.mock('../../../context/ContextMenuContext', () => ({
  useContextMenu: () => ({ openMenu: vi.fn() }),
}));
vi.mock('../../../utils/contextMenuActions', () => ({
  useMenuActions: () => ({ action: (label: string, onClick: () => void) => ({ label, onClick }) }),
}));

const baseProps = {
  isVisible: true,
  user: { role: 'admin', full_name: 'Test Officer', badge_number: '1A' },
  isAdminOrManager: true,
  isGodMode: true,
  canManageWarrants: true,
  isMobile: false,
  navigate: vi.fn(),
  initialPersonId: null,
  initialWarrantId: null,
  formOpen: false,
  onOpenNewForm: vi.fn(),
  onOpenEditForm: vi.fn(),
  onOpenPersonProfile: vi.fn(),
};

function renderTab(props = {}) {
  return render(
    <MemoryRouter>
      <WarrantsListTab {...baseProps} {...props} />
    </MemoryRouter>,
  );
}

describe('WarrantsListTab', () => {
  beforeEach(() => {
    vi.spyOn(useApiModule, 'apiFetch').mockResolvedValue({ warrants: [], total: 0 });
  });

  it('renders without crashing and fetches the list on mount', async () => {
    renderTab();
    await waitFor(() => {
      expect(useApiModule.apiFetch).toHaveBeenCalledWith(expect.stringContaining('/warrants/unified'));
    });
  });

  it('debounces the search box — typing does not fire a request per keystroke', async () => {
    renderTab();
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalledTimes(1));
    const search = screen.getByPlaceholderText(/search/i);
    await userEvent.type(search, 'Turley');
    // Immediately after typing, no new request yet (debounce window hasn't elapsed).
    expect(useApiModule.apiFetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalledTimes(2), { timeout: 1000 });
    expect(useApiModule.apiFetch).toHaveBeenLastCalledWith(expect.stringContaining('subject_name=Turley'));
  });

  it('calls onOpenNewForm when the New Warrant button is clicked', async () => {
    renderTab();
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: /new warrant/i }));
    expect(baseProps.onOpenNewForm).toHaveBeenCalled();
  });

  it('is hidden (display: none) when isVisible is false', async () => {
    const { container } = renderTab({ isVisible: false });
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalledTimes(1));
    expect(container.firstChild).toHaveStyle({ display: 'none' });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd client && npx vitest run src/pages/warrants/__tests__/WarrantsListTab.test.tsx`
Expected: PASS (4 tests). If the "New Warrant" button's accessible name doesn't match `/new warrant/i` exactly, inspect the actual rendered button text/aria-label in the moved JSX (Task 4 Step 4) and adjust the test's `name` matcher to match — don't change the component to match the test.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/warrants/__tests__/WarrantsListTab.test.tsx
git commit -m "test(warrants): add smoke tests for WarrantsListTab"
```

---

### Task 7: Live browser verification

- [ ] **Step 1: Start the dev servers and log in**

Start `worker-dev` and `client-dev` (see `.claude/launch.json`), log into the app with the `temp_audit_user` test account (see project memory `reference-live-test-account`, or use whatever local dev credentials are configured), navigate to Warrants.

- [ ] **Step 2: Exercise every action the migration touched**

- Type in the search box — confirm it debounces (network tab shows one request ~400ms after typing stops, not one per keystroke).
- Apply each filter chip (Priority, Since Week, Matches, State, Federal, Archived) and confirm the list updates.
- Sort by each column (Priority, Age, Freshness) and confirm order flips on second click.
- Select a warrant row, confirm the detail panel opens showing `StatusPill` (pill-shaped, colored dot) instead of the old outlined badge.
- Click "New Warrant", fill and save — confirm the new warrant appears in the list without a full page reload glitch (this exercises the `listTabRef.current?.refresh` wiring from Task 5 Step 3).
- Edit an existing warrant, save — confirm the list row and (if that warrant is selected) the detail panel both reflect the update immediately (exercises `applyWarrantUpdate`/`refetchIfSelected`).
- Serve a warrant, delete a warrant, archive/unarchive a warrant — confirm each action's `ConfirmDialog` opens and completes correctly.
- Select several rows via checkbox, run each bulk action (status update, archive, mark reviewed, print packet).
- Switch to another tab and back — confirm the list's filter/search state is preserved (not reset) and the list re-fetches (matches today's behavior).
- Right-click a warrant row — confirm the context menu still opens with working "View subject"/edit options.
- Confirm visually: pill status badges, looser row/toolbar padding, DOB line under subject name — matches the approved mockup direction.

- [ ] **Step 3: Screenshot before/after for the PR description**

Take a screenshot of the Warrants list tab in its final state for the PR body.

---

### Task 8: Final verification and PR

- [ ] **Step 1: Full verification sweep**

Run: `cd client && npx tsc --noEmit && npx vitest run` (client)
Run: `npm run typecheck` (from repo root — worker side, should be unaffected but confirm)
Expected: all clean/green.

- [ ] **Step 2: Push and open PR** (branch fresh off latest `main` — this codebase squash-merges PRs, so branching off a stale local `main` will orphan the commits; `git fetch origin main && git checkout -b <branch> origin/main` first if the current branch predates the last merge)

```bash
git push -u origin <branch-name>
gh pr create -R rmpgutah/rmpg-flex --title "refactor(warrants): extract Warrants list tab, moderate-polish styling" --body "..."
```

---

## Self-review notes

- **Spec coverage:** Covers the spec's "Migration order, step 1" (Warrants list tab) and the approved Visual direction (pill badges, looser spacing, DOB secondary line, toolbar hierarchy) and Verification section (typecheck + tests + live browser pass + smoke tests) in full. Dashboard/Search-All/Watch/Sources tabs and the shared-modal extraction are explicitly out of scope for this plan — separate plans per the spec's incremental rollout.
- **Type consistency:** `WarrantsListTabHandle` and `WarrantsListTabProps` are defined once in Task 3 and used identically in Task 4 (implementation) and Task 5 (shell wiring) — verified no signature drift across the three tasks.
- **No placeholders:** Task 3's `/* filled in Task 4 */` comments are intentional and immediately resolved by name in Task 4's steps — not an unresolved TBD.
