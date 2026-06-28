# Spillman Flex Records Skin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the Records page to the literal Motorola Spillman Flex grey/steel-blue enterprise look, scoped to Records, built as a reusable layer for later app-wide rollout.

**Architecture:** A single `.spillman-theme` wrapper class on the Records page root activates a scoped CSS layer (`client/src/styles/spillman.css`) that recolors the existing dense list/detail markup, plus a small set of purpose-built Spillman chrome components (menu bar, record-type tab strip, form-section tab strip). All data hooks, fetchers, and actions are untouched — this is a presentation-only change.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind (hardcoded-hex tokens), Vitest + @testing-library/react, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-06-14-spillman-records-skin-design.md`

---

## File Structure

**Create:**
- `client/src/styles/spillman.css` — scoped Spillman theme layer (custom props + `.spillman-theme` overrides + `spm-*` chrome classes).
- `client/src/utils/sectionAnchor.ts` — pure `sectionAnchorId(title)` slug helper.
- `client/src/pages/records/spillman/recordFormSections.ts` — pure per-tab form-section config.
- `client/src/pages/records/spillman/SpillmanRecordTabs.tsx` — silver record-type tab strip.
- `client/src/pages/records/spillman/SpillmanMenuBar.tsx` — File/Edit/View/… menu strip.
- `client/src/pages/records/spillman/SpillmanFormTabs.tsx` — detail-panel form-section tab strip (scroll-to-section).
- `client/src/pages/records/spillman/__tests__/SpillmanRecordTabs.test.tsx`
- `client/src/pages/records/spillman/__tests__/SpillmanMenuBar.test.tsx`
- `client/src/pages/records/spillman/__tests__/recordFormSections.test.ts`
- `client/src/utils/__tests__/sectionAnchor.test.ts`

**Modify:**
- `client/src/main.tsx` — import `./styles/spillman.css`.
- `client/src/pages/RecordsPage.tsx` — add `.spillman-theme` wrapper; mount `SpillmanMenuBar`; swap inline tab row for `SpillmanRecordTabs`; mount `SpillmanFormTabs` in the right panel.
- `client/src/components/CollapsibleSection.tsx` — add stable `collapsible-section` / `collapsible-section-header` classes + `data-section-anchor` attribute.
- `client/public/sw.js` — bump `CACHE_NAME`.

---

## Task 1: Scaffold theme layer + wrapper class

**Files:**
- Create: `client/src/styles/spillman.css`
- Modify: `client/src/main.tsx:13`
- Modify: `client/src/pages/RecordsPage.tsx:631`

- [ ] **Step 1: Create the stylesheet with the custom-property root only**

Create `client/src/styles/spillman.css`:

```css
/* Spillman Flex grey/steel-blue theme — scoped to .spillman-theme.
   Reusable layer: the --spm-* tokens can later drive an app-wide rollout. */
.spillman-theme {
  --spm-chrome: #d6d3c8;
  --spm-form: #ece9dd;
  --spm-field: #f7f9fb;
  --spm-border: #9a958a;
  --spm-field-border: #c3cdd8;
  --spm-accent: #2e4a66;
  --spm-select: #316ac5;
  --spm-text: #1a1a1a;
  --spm-text-muted: #555555;
}
```

- [ ] **Step 2: Import the stylesheet after index.css**

In `client/src/main.tsx`, the line `import './index.css';` is at line 13. Add immediately after it:

```ts
import './index.css';
import './styles/spillman.css';
```

- [ ] **Step 3: Add the wrapper class to the Records page root**

In `client/src/pages/RecordsPage.tsx`, the root return (currently `<div className="flex flex-col h-full animate-fade-in">`) becomes:

```tsx
  return (
    <div className="spillman-theme flex flex-col h-full animate-fade-in">
```

- [ ] **Step 4: Verify build compiles**

Run: `cd client && npx vite build`
Expected: build succeeds (CSS imported, no TS errors). The page will look unchanged so far (only custom props defined).

- [ ] **Step 5: Commit**

```bash
git add client/src/styles/spillman.css client/src/main.tsx client/src/pages/RecordsPage.tsx
git commit -m "feat(records): scaffold scoped Spillman theme layer + wrapper class"
```

---

## Task 2: Recolor base chrome (surfaces, borders, text, scrollbars, title bar, toolbar)

**Files:**
- Modify: `client/src/styles/spillman.css`

- [ ] **Step 1: Append the base-recolor overrides**

Append to `client/src/styles/spillman.css`:

```css
/* ── Base surface + text recolor ───────────────────────────── */
.spillman-theme { background: var(--spm-form); color: var(--spm-text); }

/* rmpg / surface / brand background families → light Spillman surfaces.
   Substring attribute selectors absorb the /alpha utility variants too. */
.spillman-theme [class*="bg-rmpg-9"],
.spillman-theme [class*="bg-rmpg-95"],
.spillman-theme [class*="bg-surface-base"],
.spillman-theme [class*="bg-surface-deep"],
.spillman-theme [class*="bg-surface-sunken"] { background-color: var(--spm-form) !important; }

.spillman-theme [class*="bg-rmpg-8"],
.spillman-theme [class*="bg-rmpg-7"],
.spillman-theme [class*="bg-surface-raised"],
.spillman-theme [class*="bg-surface-overlay"] { background-color: #ffffff !important; }

/* Borders → structural Spillman grey */
.spillman-theme [class*="border-rmpg-"] { border-color: var(--spm-border) !important; }

/* Text → dark on light; brand/amber accents → steel-blue */
.spillman-theme .text-white { color: #15202b !important; }
.spillman-theme [class*="text-rmpg-3"],
.spillman-theme [class*="text-rmpg-4"],
.spillman-theme [class*="text-rmpg-5"] { color: var(--spm-text-muted) !important; }
.spillman-theme [class*="text-brand-4"],
.spillman-theme [class*="text-brand-5"] { color: var(--spm-accent) !important; }

/* Scrollbars → light */
.spillman-theme .scrollbar-dark::-webkit-scrollbar-track { background: #d8d4c8 !important; }
.spillman-theme .scrollbar-dark::-webkit-scrollbar-thumb { background: #b3ae9e !important; }

/* Window title bar → steel-blue gradient */
.spillman-theme .panel-title-bar {
  background: linear-gradient(#5a7ea6, #2e4a66) !important;
  border-color: #2e4a66 !important;
  color: #ffffff !important;
}
.spillman-theme .panel-title-bar .title-icon,
.spillman-theme .panel-title-bar span { color: #ffffff !important; }

/* Toolbar buttons → classic raised */
.spillman-theme .toolbar-btn {
  background: linear-gradient(#ffffff, #e8e6da) !important;
  border: 1px solid #b3ae9e !important;
  color: #1a1a1a !important;
}
.spillman-theme .toolbar-btn:hover { background: linear-gradient(#ffffff, #dad7c9) !important; }
.spillman-theme .toolbar-btn-primary {
  background: linear-gradient(#dfe8f6, #b9d2ee) !important;
  border-color: #6f93bd !important;
  color: #16314f !important;
  font-weight: 600 !important;
}
```

- [ ] **Step 2: Visual verification**

Run: `cd client && npm run dev` and open the Records page in a browser.
Expected: title bar is steel-blue, toolbar buttons are raised/light, page background is silver, text is dark. (List rows + detail will be partly recolored; refined in later tasks.)

- [ ] **Step 3: Verify build**

Run: `cd client && npx vite build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add client/src/styles/spillman.css
git commit -m "feat(records): Spillman base chrome recolor (surfaces, title bar, toolbar)"
```

---

## Task 3: Group-box restyle via CollapsibleSection

**Files:**
- Create: `client/src/utils/sectionAnchor.ts`
- Create: `client/src/utils/__tests__/sectionAnchor.test.ts`
- Modify: `client/src/components/CollapsibleSection.tsx:49-53`
- Modify: `client/src/styles/spillman.css`

- [ ] **Step 1: Write the failing test for the anchor helper**

Create `client/src/utils/__tests__/sectionAnchor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sectionAnchorId } from '../sectionAnchor';

describe('sectionAnchorId', () => {
  it('slugifies a section title', () => {
    expect(sectionAnchorId('Physical Description')).toBe('spm-sec-physical-description');
  });
  it('collapses punctuation and ampersands', () => {
    expect(sectionAnchorId('Contact & Address')).toBe('spm-sec-contact-address');
  });
  it('trims leading/trailing separators', () => {
    expect(sectionAnchorId('  Notes!  ')).toBe('spm-sec-notes');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/sectionAnchor.test.ts`
Expected: FAIL — cannot find module `../sectionAnchor`.

- [ ] **Step 3: Implement the helper**

Create `client/src/utils/sectionAnchor.ts`:

```ts
/** Slugify a section title into a stable anchor id for Spillman form-tab scroll.
 *  "Physical Description" -> "spm-sec-physical-description" */
export function sectionAnchorId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `spm-sec-${slug}`;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/sectionAnchor.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add stable classes + anchor attribute to CollapsibleSection**

In `client/src/components/CollapsibleSection.tsx`:

Add the import near the other imports at the top of the file:

```ts
import { sectionAnchorId } from '../utils/sectionAnchor';
```

The outer wrapper (currently at lines 49-53):

```tsx
    <div
      className={`relative border border-[#2b2b2b] overflow-hidden ${className}`}
```

becomes:

```tsx
    <div
      data-section-anchor={typeof title === 'string' ? sectionAnchorId(title) : undefined}
      className={`collapsible-section relative border border-[#2b2b2b] overflow-hidden ${className}`}
```

The header `<button>` (currently at lines 59-64) — add the `collapsible-section-header` class to its existing className. Change:

```tsx
        className="w-full flex items-center justify-between px-2.5 py-1.5 hover:brightness-125 transition-all"
```

to:

```tsx
        className="collapsible-section-header w-full flex items-center justify-between px-2.5 py-1.5 hover:brightness-125 transition-all"
```

- [ ] **Step 6: Append the group-box CSS**

Append to `client/src/styles/spillman.css`:

```css
/* ── Group boxes (CollapsibleSection) ──────────────────────── */
.spillman-theme .collapsible-section {
  border: 1px solid var(--spm-border) !important;
  background: #ffffff !important;
}
.spillman-theme .collapsible-section-header {
  background: linear-gradient(#eef3f9, #cfdcec) !important;
  border-bottom: 1px solid var(--spm-border);
  color: #22405e !important;
}
.spillman-theme .collapsible-section-header * { color: #22405e !important; }
```

- [ ] **Step 7: Verify non-Records pages are unaffected + build**

Run: `cd client && npx vitest run && npx vite build`
Expected: all tests pass; build succeeds. (The `data-section-anchor` attribute and extra classes are inert outside `.spillman-theme`.)

- [ ] **Step 8: Commit**

```bash
git add client/src/utils/sectionAnchor.ts client/src/utils/__tests__/sectionAnchor.test.ts client/src/components/CollapsibleSection.tsx client/src/styles/spillman.css
git commit -m "feat(records): Spillman group-box restyle via CollapsibleSection hooks"
```

---

## Task 4: SpillmanRecordTabs component

**Files:**
- Create: `client/src/pages/records/spillman/SpillmanRecordTabs.tsx`
- Create: `client/src/pages/records/spillman/__tests__/SpillmanRecordTabs.test.tsx`
- Modify: `client/src/styles/spillman.css`
- Modify: `client/src/pages/RecordsPage.tsx` (tab row, lines ~441-477)

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/records/spillman/__tests__/SpillmanRecordTabs.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import SpillmanRecordTabs, { type SpillmanRecordTab } from '../SpillmanRecordTabs';

const tabs: SpillmanRecordTab[] = [
  { id: 'persons', label: 'Names', count: 52 },
  { id: 'vehicles', label: 'Vehicles', count: 44 },
];

describe('SpillmanRecordTabs', () => {
  it('marks the active tab selected and shows its count', () => {
    render(<SpillmanRecordTabs tabs={tabs} activeTab="persons" onSelect={() => {}} />);
    const active = screen.getByRole('tab', { selected: true });
    expect(active).toHaveTextContent('Names');
    expect(active).toHaveTextContent('(52)');
  });

  it('fires onSelect with the clicked tab id', () => {
    const onSelect = vi.fn();
    render(<SpillmanRecordTabs tabs={tabs} activeTab="persons" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('tab', { name: /Vehicles/ }));
    expect(onSelect).toHaveBeenCalledWith('vehicles');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/pages/records/spillman/__tests__/SpillmanRecordTabs.test.tsx`
Expected: FAIL — cannot find module `../SpillmanRecordTabs`.

- [ ] **Step 3: Implement the component**

Create `client/src/pages/records/spillman/SpillmanRecordTabs.tsx`:

```tsx
import React from 'react';
import { UserCircle, Car, Building2, Briefcase, Package } from 'lucide-react';

export type RecordTabId = 'persons' | 'vehicles' | 'properties' | 'businesses' | 'evidence';

export interface SpillmanRecordTab {
  id: RecordTabId;
  label: string;
  count: number;
}

interface Props {
  tabs: SpillmanRecordTab[];
  activeTab: RecordTabId;
  onSelect: (id: RecordTabId) => void;
}

const ICONS: Record<RecordTabId, React.ElementType> = {
  persons: UserCircle,
  vehicles: Car,
  properties: Building2,
  businesses: Briefcase,
  evidence: Package,
};

export default function SpillmanRecordTabs({ tabs, activeTab, onSelect }: Props) {
  return (
    <div className="spm-record-tabs" role="tablist" aria-label="Record type tabs">
      {tabs.map((tab) => {
        const Icon = ICONS[tab.id];
        const on = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(tab.id)}
            className={`spm-record-tab ${on ? 'on' : ''}`}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{tab.label}</span>
            <span className="spm-record-tab-count">({tab.count})</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd client && npx vitest run src/pages/records/spillman/__tests__/SpillmanRecordTabs.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Append the tab-strip CSS**

Append to `client/src/styles/spillman.css`:

```css
/* ── Record-type tab strip ─────────────────────────────────── */
.spillman-theme .spm-record-tabs {
  display: flex;
  background: var(--spm-chrome);
  border-bottom: 1px solid var(--spm-border);
  font-size: 11px;
  overflow-x: auto;
}
.spillman-theme .spm-record-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-right: 1px solid #b3ae9e;
  color: #33312b;
  white-space: nowrap;
}
.spillman-theme .spm-record-tab.on {
  background: #ffffff;
  font-weight: 600;
  border-bottom: 2px solid var(--spm-accent);
}
.spillman-theme .spm-record-tab-count { color: var(--spm-text-muted); }
.spillman-theme .spm-record-tab.on .spm-record-tab-count { color: var(--spm-accent); }
```

- [ ] **Step 6: Wire into RecordsPage**

In `client/src/pages/RecordsPage.tsx`, add the import near the other tab-component imports (around line 43):

```tsx
import SpillmanRecordTabs from './records/spillman/SpillmanRecordTabs';
```

Replace the entire `{/* Tab Row */}` block (the `<div ... role="tablist">` … `</div>` spanning roughly lines 440-477, which renders `tabs.map(...)` and the Archive toggle) with:

```tsx
      {/* Tab Row — Spillman silver record-type tabs + archive toggle */}
      <div className="flex items-stretch border-b border-rmpg-600">
        <SpillmanRecordTabs
          tabs={tabs.map(t => ({ id: t.id, label: t.label, count: t.count }))}
          activeTab={activeTab}
          onSelect={(id) => setActiveTab(id)}
        />
        <button
          type="button"
          onClick={() => setShowArchived(!showArchived)}
          className={`ml-auto flex items-center gap-1 px-2 text-[9px] font-bold uppercase tracking-wider transition-colors border whitespace-nowrap ${
            showArchived
              ? 'bg-amber-900/40 text-amber-400 border-amber-700/50'
              : 'bg-rmpg-700/50 text-rmpg-500 border-rmpg-600'
          }`}
        >
          <Archive className="w-2.5 h-2.5" />
          {showArchived ? 'Archives' : 'Archive'}
        </button>
      </div>
```

(The `Archive` icon is already imported in RecordsPage. The `tabs` array, `activeTab`, `setActiveTab`, `showArchived`, `setShowArchived` are already in scope.)

- [ ] **Step 7: Verify typecheck + tests + build**

Run: `cd client && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/records/spillman/SpillmanRecordTabs.tsx client/src/pages/records/spillman/__tests__/SpillmanRecordTabs.test.tsx client/src/styles/spillman.css client/src/pages/RecordsPage.tsx
git commit -m "feat(records): Spillman silver record-type tab strip"
```

---

## Task 5: SpillmanMenuBar component

**Files:**
- Create: `client/src/pages/records/spillman/SpillmanMenuBar.tsx`
- Create: `client/src/pages/records/spillman/__tests__/SpillmanMenuBar.test.tsx`
- Modify: `client/src/styles/spillman.css`
- Modify: `client/src/pages/RecordsPage.tsx` (left panel, above the tab row)

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/records/spillman/__tests__/SpillmanMenuBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import SpillmanMenuBar from '../SpillmanMenuBar';

describe('SpillmanMenuBar', () => {
  it('renders the standard Spillman menus', () => {
    render(<SpillmanMenuBar />);
    ['File', 'Edit', 'View', 'Record', 'Tools', 'Window', 'Help'].forEach((m) => {
      expect(screen.getByText(m)).toBeInTheDocument();
    });
  });

  it('fires onNew when the File menu New action is clicked', () => {
    const onNew = vi.fn();
    render(<SpillmanMenuBar onNew={onNew} />);
    fireEvent.click(screen.getByText('File'));
    fireEvent.click(screen.getByRole('menuitem', { name: /New/ }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/pages/records/spillman/__tests__/SpillmanMenuBar.test.tsx`
Expected: FAIL — cannot find module `../SpillmanMenuBar`.

- [ ] **Step 3: Implement the component**

Create `client/src/pages/records/spillman/SpillmanMenuBar.tsx`:

```tsx
import React, { useState } from 'react';

interface Props {
  onNew?: () => void;
  onPrint?: () => void;
  onExport?: () => void;
  onFind?: () => void;
}

interface MenuItem { label: string; onClick?: () => void; }

export default function SpillmanMenuBar({ onNew, onPrint, onExport, onFind }: Props) {
  const [open, setOpen] = useState<string | null>(null);

  const menus: Record<string, MenuItem[]> = {
    File: [
      { label: 'New', onClick: onNew },
      { label: 'Print', onClick: onPrint },
      { label: 'Export', onClick: onExport },
    ],
    Edit: [{ label: 'Find', onClick: onFind }],
    View: [],
    Record: [],
    Tools: [],
    Window: [],
    Help: [],
  };

  return (
    <div className="spm-menubar" role="menubar" onMouseLeave={() => setOpen(null)}>
      {Object.keys(menus).map((name) => (
        <div key={name} className="spm-menu">
          <button
            type="button"
            className="spm-menu-label"
            aria-haspopup="true"
            aria-expanded={open === name}
            onClick={() => setOpen(open === name ? null : name)}
          >
            {name}
          </button>
          {open === name && menus[name].length > 0 && (
            <div className="spm-menu-dropdown" role="menu">
              {menus[name].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className="spm-menu-item"
                  onClick={() => { item.onClick?.(); setOpen(null); }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd client && npx vitest run src/pages/records/spillman/__tests__/SpillmanMenuBar.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Append the menu-bar CSS**

Append to `client/src/styles/spillman.css`:

```css
/* ── Menu bar ──────────────────────────────────────────────── */
.spillman-theme .spm-menubar {
  display: flex;
  background: #f1efe2;
  border-bottom: 1px solid #aca899;
  font-size: 12px;
  position: relative;
  z-index: 20;
}
.spillman-theme .spm-menu-label {
  padding: 3px 10px;
  color: #1a1a1a;
}
.spillman-theme .spm-menu-label:hover,
.spillman-theme .spm-menu-label[aria-expanded="true"] { background: #cdd2dd; }
.spillman-theme .spm-menu { position: relative; }
.spillman-theme .spm-menu-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 140px;
  background: #f6f5ef;
  border: 1px solid #9a958a;
  box-shadow: 2px 2px 6px rgba(0,0,0,.3);
  display: flex;
  flex-direction: column;
}
.spillman-theme .spm-menu-item {
  text-align: left;
  padding: 4px 14px;
  font-size: 12px;
  color: #1a1a1a;
}
.spillman-theme .spm-menu-item:hover { background: var(--spm-select); color: #fff; }
```

- [ ] **Step 6: Wire into RecordsPage**

In `client/src/pages/RecordsPage.tsx`, add the import (around line 43):

```tsx
import SpillmanMenuBar from './records/spillman/SpillmanMenuBar';
```

In the `leftPanel` JSX, insert the menu bar immediately **after** the closing `</PanelTitleBar>` tag (around line 438) and **before** the `{/* Tab Row */}` block:

```tsx
      </PanelTitleBar>

      <SpillmanMenuBar
        onNew={() => {
          if (activeTab === 'persons') setNewPersonTrigger(t => t + 1);
          else if (activeTab === 'vehicles') setNewVehicleTrigger(t => t + 1);
          else if (activeTab === 'properties') setNewPropertyTrigger(t => t + 1);
          else if (activeTab === 'businesses') businessState.setShowFormModal(true);
          else if (activeTab === 'evidence') setNewEvidenceTrigger(t => t + 1);
        }}
        onFind={() => {
          const el = document.querySelector<HTMLInputElement>('.spillman-theme input[type="search"], .spillman-theme input[placeholder]');
          el?.focus();
        }}
      />
```

(`activeTab`, the `setNew*Trigger` setters, and `businessState` are all already in scope in the component.)

- [ ] **Step 7: Verify typecheck + tests + build**

Run: `cd client && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/records/spillman/SpillmanMenuBar.tsx client/src/pages/records/spillman/__tests__/SpillmanMenuBar.test.tsx client/src/styles/spillman.css client/src/pages/RecordsPage.tsx
git commit -m "feat(records): Spillman menu bar (File/Edit/View/…)"
```

---

## Task 6: Record-form section tabs (scroll-to-section)

**Files:**
- Create: `client/src/pages/records/spillman/recordFormSections.ts`
- Create: `client/src/pages/records/spillman/__tests__/recordFormSections.test.ts`
- Create: `client/src/pages/records/spillman/SpillmanFormTabs.tsx`
- Modify: `client/src/styles/spillman.css`
- Modify: `client/src/pages/RecordsPage.tsx` (right panel, above the detail content)

- [ ] **Step 1: Write the failing test for the section config**

Create `client/src/pages/records/spillman/__tests__/recordFormSections.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RECORD_FORM_SECTIONS } from '../recordFormSections';
import { sectionAnchorId } from '../../../../utils/sectionAnchor';

describe('RECORD_FORM_SECTIONS', () => {
  it('defines sections for the persons tab whose ids match real section titles', () => {
    const persons = RECORD_FORM_SECTIONS.persons;
    expect(persons.length).toBeGreaterThan(0);
    // The anchor for "Physical Description" must equal the persons[0] target.
    expect(persons.find(s => s.target === sectionAnchorId('Physical Description'))).toBeTruthy();
  });

  it('every section has a label and an spm-sec target', () => {
    Object.values(RECORD_FORM_SECTIONS).flat().forEach((s) => {
      expect(s.label).toBeTruthy();
      expect(s.target.startsWith('spm-sec-')).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/pages/records/spillman/__tests__/recordFormSections.test.ts`
Expected: FAIL — cannot find module `../recordFormSections`.

- [ ] **Step 3: Implement the section config**

Create `client/src/pages/records/spillman/recordFormSections.ts`. The `target` values are the `data-section-anchor` ids emitted by `CollapsibleSection` for the matching section titles (verify titles against each tab's `<CollapsibleSection title="…">` calls):

```ts
import { sectionAnchorId } from '../../../utils/sectionAnchor';
import type { RecordTabId } from './SpillmanRecordTabs';

export interface FormSection { label: string; target: string; }

const sec = (label: string, title: string): FormSection => ({ label, target: sectionAnchorId(title) });

export const RECORD_FORM_SECTIONS: Record<RecordTabId, FormSection[]> = {
  persons: [
    sec('Physical', 'Physical Description'),
    sec('Contact', 'Contact & Address'),
    sec('Identification', 'Identification'),
    sec('Associations', 'Legal & Associations'),
    sec('Caution', 'Officer Safety / Caution'),
  ],
  vehicles: [],
  properties: [],
  businesses: [],
  evidence: [],
};
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd client && npx vitest run src/pages/records/spillman/__tests__/recordFormSections.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement the form-tabs component**

Create `client/src/pages/records/spillman/SpillmanFormTabs.tsx`:

```tsx
import React, { useState } from 'react';
import type { FormSection } from './recordFormSections';

interface Props { sections: FormSection[]; }

export default function SpillmanFormTabs({ sections }: Props) {
  const [active, setActive] = useState<string | null>(sections[0]?.target ?? null);

  if (sections.length === 0) return null;

  const go = (target: string) => {
    setActive(target);
    const el = document.querySelector(`[data-section-anchor="${target}"]`);
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
      (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="spm-form-tabs" role="tablist" aria-label="Record form sections">
      {sections.map((s) => (
        <button
          key={s.target}
          type="button"
          role="tab"
          aria-selected={active === s.target}
          className={`spm-form-tab ${active === s.target ? 'on' : ''}`}
          onClick={() => go(s.target)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Append the form-tabs CSS**

Append to `client/src/styles/spillman.css`:

```css
/* ── Record form section tabs ──────────────────────────────── */
.spillman-theme .spm-form-tabs {
  display: flex;
  gap: 2px;
  padding: 3px 4px 0 4px;
  background: var(--spm-chrome);
  border-bottom: 1px solid var(--spm-border);
  overflow-x: auto;
}
.spillman-theme .spm-form-tab {
  padding: 4px 10px;
  font-size: 11px;
  border: 1px solid var(--spm-border);
  border-bottom: none;
  background: #cbc8bc;
  color: #33312b;
  border-radius: 3px 3px 0 0;
  white-space: nowrap;
}
.spillman-theme .spm-form-tab.on {
  background: var(--spm-form);
  font-weight: 600;
  position: relative;
  top: 1px;
}
```

- [ ] **Step 7: Wire into RecordsPage right panel**

In `client/src/pages/RecordsPage.tsx`, add the imports (around line 43):

```tsx
import SpillmanFormTabs from './records/spillman/SpillmanFormTabs';
import { RECORD_FORM_SECTIONS } from './records/spillman/recordFormSections';
```

In the `rightPanel` JSX, insert immediately **after** the closing `</PanelTitleBar>` and **before** the `{/* Active TabDetail Content */}` div (around line 601), gated so it only shows when a record is selected and sections exist:

```tsx
      </PanelTitleBar>

      {hasSelection && RECORD_FORM_SECTIONS[activeTab as keyof typeof RECORD_FORM_SECTIONS]?.length > 0 && (
        <SpillmanFormTabs sections={RECORD_FORM_SECTIONS[activeTab as keyof typeof RECORD_FORM_SECTIONS]} />
      )}
```

(`hasSelection` and `activeTab` are already in scope.)

- [ ] **Step 8: Verify typecheck + tests + build**

Run: `cd client && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: all pass.

- [ ] **Step 9: Manual verification**

Run: `cd client && npm run dev`, open Records, select a person. The form-tab strip appears; clicking "Identification" smooth-scrolls the detail to that group-box.

- [ ] **Step 10: Commit**

```bash
git add client/src/pages/records/spillman/recordFormSections.ts client/src/pages/records/spillman/__tests__/recordFormSections.test.ts client/src/pages/records/spillman/SpillmanFormTabs.tsx client/src/styles/spillman.css client/src/pages/RecordsPage.tsx
git commit -m "feat(records): Spillman record-form section tabs (scroll-to-section)"
```

---

## Task 7: Left-list + selection recolor

**Files:**
- Modify: `client/src/styles/spillman.css`

- [ ] **Step 1: Append list-row + selection CSS**

Append to `client/src/styles/spillman.css`:

```css
/* ── Left results list → silver rows, steel-blue selection ─── */
.spillman-theme [role="listitem"] {
  border-bottom: 1px solid #eceadf !important;
  color: var(--spm-text) !important;
}
.spillman-theme [role="listitem"]:nth-child(even) { background: #f6f5ef !important; }
.spillman-theme [role="listitem"]:hover { background: #e9f0fa !important; }
.spillman-theme [role="listitem"][aria-selected="true"] {
  background: var(--spm-select) !important;
  border-left-color: #1e3f6b !important;
}
.spillman-theme [role="listitem"][aria-selected="true"],
.spillman-theme [role="listitem"][aria-selected="true"] * {
  color: #ffffff !important;
}
/* keep status badges legible on the blue selection */
.spillman-theme [role="listitem"][aria-selected="true"] [class*="bg-red-9"] { background: #b91c1c !important; }
```

- [ ] **Step 2: Visual verification across tabs**

Run: `cd client && npm run dev`, open Records. For Persons, Vehicles, Property, Evidence: rows are silver with zebra striping; the selected row is steel-blue with white text; hover is light blue.
Expected: selection reads clearly; no dark-on-dark or white-on-white text.

- [ ] **Step 3: Verify build**

Run: `cd client && npx vite build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add client/src/styles/spillman.css
git commit -m "feat(records): Spillman silver list rows + steel-blue selection"
```

---

## Task 8: Identity band + caution banner recolor

**Files:**
- Modify: `client/src/styles/spillman.css`

- [ ] **Step 1: Inspect the existing detail header markup**

Run: `cd client && grep -n "identity\|hero\|HIGH RISK\|AlertBanner\|caution" src/pages/records/PersonsTab.tsx | head`
Expected: locate the hero identity band (~line 960) and any `AlertBanner`/caution usage, to confirm the class hooks the rules below target. Adjust the selectors in Step 2 if the band uses different utility classes.

- [ ] **Step 2: Append identity/caution CSS**

Append to `client/src/styles/spillman.css`:

```css
/* ── Detail identity band + caution banner ─────────────────── */
/* Amber/gold caution surfaces → Spillman caution gradient */
.spillman-theme [class*="bg-amber-9"],
.spillman-theme [class*="bg-yellow-9"] {
  background: linear-gradient(#fff4d6, #ffe9ad) !important;
  border-color: #c79a2e !important;
}
.spillman-theme [class*="bg-amber-9"] *,
.spillman-theme [class*="bg-yellow-9"] * { color: #6b4e10 !important; }

/* Red officer-safety surfaces → keep red but lighten for the light theme */
.spillman-theme [class*="bg-red-9"] {
  background: #f6dada !important;
  border-color: #b03030 !important;
}
.spillman-theme [class*="bg-red-9"] * { color: #9a1c1c !important; }

/* HIGH RISK / status pills sit on white in the identity band */
.spillman-theme [class*="bg-surface"][class*="rounded"] { background: #ffffff !important; }
```

- [ ] **Step 3: Visual verification**

Run: `cd client && npm run dev`, open a HIGH-RISK person (e.g. Turley) and a person with an officer-safety flag.
Expected: caution banner is the gold Spillman gradient with brown text; red flags are light-red with dark-red text; HIGH RISK / VETERAN badges remain legible.

- [ ] **Step 4: Verify build**

Run: `cd client && npx vite build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add client/src/styles/spillman.css
git commit -m "feat(records): Spillman identity band + caution/red flag recolor"
```

---

## Task 9: Cache bump + full verification + finishing

**Files:**
- Modify: `client/public/sw.js`

- [ ] **Step 1: Bump the service-worker cache name**

Run: `cd client && grep -n "CACHE_NAME" public/sw.js | head -1`
Then edit `client/public/sw.js`, incrementing the `CACHE_NAME` version (e.g. `...-v955` → `...-v956`). Use the next integer above the current value.

- [ ] **Step 2: Full CI-gate verification**

Run: `cd client && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: typecheck clean; all vitest pass (including the 4 new Spillman test files); build succeeds.

- [ ] **Step 3: Full visual pass**

Run: `cd client && npm run dev`. Walk all five tabs (Persons, Vehicles, Properties, Business, Evidence): list + detail. Confirm the Spillman chrome (steel-blue title bar, menu bar, silver tabs, group-boxes, blue selection) is consistent and no element is illegible. Resize to a mobile width and confirm tabs scroll horizontally and nothing is clipped.

- [ ] **Step 4: Commit + push + PR**

```bash
git add client/public/sw.js
git commit -m "chore(records): bump SW cache for Spillman skin"
git push -u origin claude/trusting-bohr-5f2432
gh pr create --title "Spillman Flex grey/steel-blue Records skin" --body "$(cat <<'EOF'
Re-skins the Records page to the literal Motorola Spillman Flex grey/steel-blue enterprise look, scoped to Records via a reusable \`.spillman-theme\` layer.

## What changed
- New scoped CSS layer \`client/src/styles/spillman.css\` (no other page affected).
- Spillman chrome: steel-blue title bar, File/Edit/View menu bar, silver record-type tab strip, record-form section tabs.
- Group-box form sections via a one-line \`CollapsibleSection\` restyle.
- Silver list rows with steel-blue selection; gold caution banner.
- Presentation-only: all data hooks, fetchers, link/delete/archive/export unchanged.

## Deferred (expand-later)
- True columnar sortable grids per tab; real tabbed record forms; app-wide Spillman rollout.

Spec: \`docs/superpowers/specs/2026-06-14-spillman-records-skin-design.md\`
Plan: \`docs/superpowers/plans/2026-06-14-spillman-records-skin.md\`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** theme layer (T1-2), group-boxes (T3), menu bar (T5), record-type tabs (T4), form-section tabs (T6), list+selection (T7), identity/caution (T8), reusable `--spm-*` layer (T1), SW bump + PR flow (T9). All spec sections mapped.
- **Deferred items** (columnar grids, real tabbed forms, app-wide) are intentionally not tasks — they're documented as out-of-scope in the spec and the PR body.
- **Type consistency:** `RecordTabId` defined in `SpillmanRecordTabs.tsx` and reused by `recordFormSections.ts`; `FormSection.target` is the `data-section-anchor` value produced by `sectionAnchorId()` (shared util) and consumed by `SpillmanFormTabs`. `SpillmanRecordTab` shape `{id,label,count}` matches the `tabs.map(...)` projection in RecordsPage.
- **Verification dependency:** Task 6 Step 3 and Task 8 Step 1 require confirming the live `<CollapsibleSection title="…">` strings; the plan instructs verifying/adjusting against the actual source rather than assuming.
