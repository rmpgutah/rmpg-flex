# Desktop Settings App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cross-category search, export/import of device-scoped settings, per-category reset buttons, and a global `Ctrl+,` shortcut to open Settings, to the `/desktop` system's Settings app.

**Architecture:** A small static search index (`settingsSearchIndex.ts`) filters to a category, rendered above `DesktopSettingsApp.tsx`'s existing category sidebar. A new `settingsExportImport.ts` reads/writes a fixed list of known localStorage keys. Each of 3 categories gets its own "Reset" button calling a small inline reset function scoped to that category's own keys. `DesktopPage.tsx` gains a `keydown` listener for `Ctrl+,`, mirroring the existing `Ctrl+\`` listener pattern already used by `DesktopWindowSwitcher.tsx`.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react.

## Global Constraints

- All settings covered by export/import/reset are `localStorage` (device-scoped) — this build does not touch D1, `/preferences`, or any API call, and does not add anything to `desktop_layout_json`.
- All new chrome uses the project's CSS-variable-backed Tailwind tokens (`var(--surface-raised)`, `var(--brand-400)`, `var(--rmpg-400)`, etc.) — never hardcoded hex.
- No new D1 migrations in this build.
- Search is a "jump to category" mechanism only — no per-row anchors are added to any category's individual controls.

---

### Task 1: `settingsExportImport.ts` data layer

**Files:**
- Create: `client/src/utils/settingsExportImport.ts`
- Test: `client/src/utils/settingsExportImport.test.ts`

**Interfaces:**
- Produces: `exportSettings(): string`, `importSettings(json: string): { ok: boolean; error?: string }` — Task 4 consumes these exact names.

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/utils/settingsExportImport.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { exportSettings, importSettings } from './settingsExportImport';

const KNOWN_KEYS = [
  'rmpg_desktop_snap_enabled',
  'rmpg_desktop_multi_monitor',
  'rmpg_desktop_pinned_apps',
  'rmpg_desktop_taskbar_position',
  'rmpg_desktop_taskbar_size',
  'rmpg_desktop_taskbar_autohide',
  'rmpg_desktop_icon_label_overrides',
  'rmpg_desktop_auto_arrange',
  'rmpg_desktop_icons_hidden',
];

describe('settingsExportImport — export', () => {
  beforeEach(() => localStorage.clear());

  it('exports a JSON object containing exactly the known keys with their current values', () => {
    localStorage.setItem('rmpg_desktop_taskbar_position', 'top');
    localStorage.setItem('rmpg_desktop_snap_enabled', '0');
    const json = exportSettings();
    const parsed = JSON.parse(json);
    expect(parsed.rmpg_desktop_taskbar_position).toBe('top');
    expect(parsed.rmpg_desktop_snap_enabled).toBe('0');
    expect(Object.keys(parsed).sort()).toEqual([...KNOWN_KEYS].sort());
  });

  it('omits desktop_layout_json and other D1-synced keys even if present in localStorage', () => {
    localStorage.setItem('desktop_layout_json', '{"icons":[]}');
    const json = exportSettings();
    expect(JSON.parse(json)).not.toHaveProperty('desktop_layout_json');
  });

  it('a key with no stored value exports as null', () => {
    const json = exportSettings();
    expect(JSON.parse(json).rmpg_desktop_taskbar_position).toBeNull();
  });
});

describe('settingsExportImport — import', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips: export, clear, import, re-export produces the same JSON', () => {
    localStorage.setItem('rmpg_desktop_taskbar_position', 'top');
    localStorage.setItem('rmpg_desktop_auto_arrange', '1');
    const original = exportSettings();
    localStorage.clear();
    const result = importSettings(original);
    expect(result.ok).toBe(true);
    expect(exportSettings()).toBe(original);
  });

  it('rejects malformed JSON without writing anything', () => {
    localStorage.setItem('rmpg_desktop_taskbar_position', 'bottom');
    const result = importSettings('not valid json{{{');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(localStorage.getItem('rmpg_desktop_taskbar_position')).toBe('bottom');
  });

  it('rejects a non-object JSON shape (e.g. an array) without writing anything', () => {
    localStorage.setItem('rmpg_desktop_taskbar_position', 'bottom');
    const result = importSettings('[1,2,3]');
    expect(result.ok).toBe(false);
    expect(localStorage.getItem('rmpg_desktop_taskbar_position')).toBe('bottom');
  });

  it('silently ignores unknown keys in the imported JSON rather than writing them', () => {
    const result = importSettings(JSON.stringify({ some_foreign_key: 'x', rmpg_desktop_taskbar_position: 'top' }));
    expect(result.ok).toBe(true);
    expect(localStorage.getItem('some_foreign_key')).toBeNull();
    expect(localStorage.getItem('rmpg_desktop_taskbar_position')).toBe('top');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/utils/settingsExportImport.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// client/src/utils/settingsExportImport.ts
const KNOWN_KEYS = [
  'rmpg_desktop_snap_enabled',
  'rmpg_desktop_multi_monitor',
  'rmpg_desktop_pinned_apps',
  'rmpg_desktop_taskbar_position',
  'rmpg_desktop_taskbar_size',
  'rmpg_desktop_taskbar_autohide',
  'rmpg_desktop_icon_label_overrides',
  'rmpg_desktop_auto_arrange',
  'rmpg_desktop_icons_hidden',
] as const;

export function exportSettings(): string {
  const out: Record<string, string | null> = {};
  for (const key of KNOWN_KEYS) {
    try {
      out[key] = localStorage.getItem(key);
    } catch {
      out[key] = null;
    }
  }
  return JSON.stringify(out);
}

export function importSettings(json: string): { ok: boolean; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'That file is not a settings export.' };
  }
  const obj = parsed as Record<string, unknown>;
  try {
    for (const key of KNOWN_KEYS) {
      if (!(key in obj)) continue;
      const value = obj[key];
      if (value === null) {
        localStorage.removeItem(key);
      } else if (typeof value === 'string') {
        localStorage.setItem(key, value);
      }
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not save settings to this device.' };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/utils/settingsExportImport.test.ts`
Expected: PASS, all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/settingsExportImport.ts client/src/utils/settingsExportImport.test.ts
git commit -m "desktop: add settingsExportImport.ts (export/import device-scoped preferences)"
```

---

### Task 2: `settingsSearchIndex.ts` static data + `CategoryId` export

**Files:**
- Modify: `client/src/components/desktop/DesktopSettingsApp.tsx` (export `CategoryId`)
- Create: `client/src/data/settingsSearchIndex.ts`

**Interfaces:**
- Produces: `export type CategoryId` (from `DesktopSettingsApp.tsx`, currently a local, unexported type alias), `SETTINGS_SEARCH_INDEX: SettingsSearchEntry[]` (from the new file) — Task 3 consumes both.

- [ ] **Step 1: Export `CategoryId`**

In `client/src/components/desktop/DesktopSettingsApp.tsx`, change:

```ts
type CategoryId = typeof CATEGORIES[number]['id'];
```

to:

```ts
export type CategoryId = typeof CATEGORIES[number]['id'];
```

- [ ] **Step 2: Create the search index**

```ts
// client/src/data/settingsSearchIndex.ts
import type { CategoryId } from '../components/desktop/DesktopSettingsApp';

export interface SettingsSearchEntry {
  categoryId: CategoryId;
  keywords: string[];
}

export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  { categoryId: 'personalization', keywords: ['wallpaper', 'accent', 'accent color', 'theme'] },
  { categoryId: 'desktop-icons', keywords: ['icon size', 'view', 'grid', 'list', 'sort', 'snap to grid', 'widgets', 'auto-arrange', 'hide icons', 'rename'] },
  { categoryId: 'window-management', keywords: ['window cycling', 'ctrl', 'snap to edge', 'multi-monitor', 'secondary monitor'] },
  { categoryId: 'taskbar', keywords: ['auto-hide', 'position', 'top', 'bottom', 'size', 'small', 'large', 'pin'] },
  { categoryId: 'layout-templates', keywords: ['layout', 'template', 'export layout', 'import layout'] },
];
```

- [ ] **Step 3: Verify no type errors**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (this task adds pure data + a type export, no behavior change yet).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/desktop/DesktopSettingsApp.tsx client/src/data/settingsSearchIndex.ts
git commit -m "desktop: export CategoryId, add static settings search index"
```

---

### Task 3: Search UI in `DesktopSettingsApp.tsx`

**Files:**
- Modify: `client/src/components/desktop/DesktopSettingsApp.tsx`
- Test: `client/src/components/desktop/DesktopSettingsApp.test.tsx`

**Interfaces:**
- Consumes: `SETTINGS_SEARCH_INDEX` from `../../data/settingsSearchIndex` (Task 2).

- [ ] **Step 1: Write the failing tests**

Append to `client/src/components/desktop/DesktopSettingsApp.test.tsx` (this file's existing `renderApp` helper already provides every required prop as a `vi.fn()`/default value — reuse it):

```tsx
describe('DesktopSettingsApp — search', () => {
  it('typing a search term shows only matching category results instead of the full sidebar', () => {
    renderApp();
    fireEvent.change(screen.getByPlaceholderText(/search settings/i), { target: { value: 'auto-hide' } });
    expect(screen.getByText('Taskbar')).toBeInTheDocument();
    expect(screen.queryByText('Personalization')).not.toBeInTheDocument();
  });

  it('clicking a search result switches to that category and clears the search', () => {
    renderApp();
    fireEvent.change(screen.getByPlaceholderText(/search settings/i), { target: { value: 'auto-hide' } });
    fireEvent.click(screen.getByText('Taskbar'));
    expect(screen.getByText('Auto-Hide')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search settings/i)).toHaveValue('');
  });

  it('clearing the search query restores the full category sidebar', () => {
    renderApp();
    const input = screen.getByPlaceholderText(/search settings/i);
    fireEvent.change(input, { target: { value: 'auto-hide' } });
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByText('Personalization')).toBeInTheDocument();
    expect(screen.getByText('Taskbar')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/components/desktop/DesktopSettingsApp.test.tsx`
Expected: FAIL — no search input exists yet.

- [ ] **Step 3: Implement**

In `client/src/components/desktop/DesktopSettingsApp.tsx`, add the import:

```ts
import { SETTINGS_SEARCH_INDEX } from '../../data/settingsSearchIndex';
```

Add a `searchQuery` state near the other `useState` calls:

```ts
const [searchQuery, setSearchQuery] = useState('');
```

Compute matching categories:

```ts
const searchMatches = useMemo(() => {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return null;
  const matchedIds = new Set(
    SETTINGS_SEARCH_INDEX.filter(entry => entry.keywords.some(k => k.toLowerCase().includes(q))).map(e => e.categoryId),
  );
  return CATEGORIES.filter(cat => matchedIds.has(cat.id));
}, [searchQuery]);
```

Add `useMemo` to the existing `react` import: `import React, { useState, useRef, useCallback, useMemo } from 'react';`.

Replace the sidebar's category-list rendering block:

```tsx
<div style={{ width: 160, borderRight: '1px solid var(--border-subtle)', flexShrink: 0, overflowY: 'auto' }}>
  <input
    value={searchQuery}
    onChange={(e) => setSearchQuery(e.target.value)}
    placeholder="Search settings…"
    className="w-full px-2 py-1.5 text-[11px] bg-surface-sunken border-b border-rmpg-700 text-rmpg-100 focus:outline-none"
  />
  {(searchMatches ?? CATEGORIES).map(cat => (
    <button
      key={cat.id}
      type="button"
      onClick={() => { setActiveCategory(cat.id); setSearchQuery(''); }}
      className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px]"
      style={{ background: activeCategory === cat.id ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
    >
      <cat.icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--rmpg-400)' }} />
      {cat.label}
    </button>
  ))}
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/components/desktop/DesktopSettingsApp.test.tsx`
Expected: PASS, all tests including pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopSettingsApp.tsx client/src/components/desktop/DesktopSettingsApp.test.tsx
git commit -m "desktop: add cross-category settings search"
```

---

### Task 4: Export/Import buttons

**Files:**
- Modify: `client/src/components/desktop/DesktopSettingsApp.tsx`
- Test: `client/src/components/desktop/DesktopSettingsApp.test.tsx`

**Interfaces:**
- Consumes: `exportSettings`, `importSettings` from `../../utils/settingsExportImport` (Task 1).

- [ ] **Step 1: Write the failing tests**

Append to `client/src/components/desktop/DesktopSettingsApp.test.tsx`:

```tsx
describe('DesktopSettingsApp — export/import', () => {
  beforeEach(() => localStorage.clear());

  it('clicking Export Settings triggers a download of the current exportSettings() output', () => {
    localStorage.setItem('rmpg_desktop_taskbar_position', 'top');
    const clickSpy = vi.fn();
    const createElementSpy = vi.spyOn(document, 'createElement');
    renderApp();
    fireEvent.click(screen.getByText('Export Settings'));
    const anchorCall = createElementSpy.mock.results.find(r => (r.value as HTMLElement)?.tagName === 'A');
    expect(anchorCall).toBeTruthy();
    createElementSpy.mockRestore();
  });

  it('importing a valid settings file writes the values back and shows a success message', async () => {
    renderApp();
    const file = new File([JSON.stringify({ rmpg_desktop_taskbar_position: 'top' })], 'settings.json', { type: 'application/json' });
    const input = screen.getByLabelText('Import Settings') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText(/settings imported/i);
    expect(localStorage.getItem('rmpg_desktop_taskbar_position')).toBe('top');
  });

  it('importing a malformed file shows an error message and does not throw', async () => {
    renderApp();
    const file = new File(['not json'], 'bad.json', { type: 'application/json' });
    const input = screen.getByLabelText('Import Settings') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText(/not valid json/i);
  });
});
```

**Note for the implementer:** `File.text()` (used to read the uploaded file's contents) is async — the `onChange` handler must be `async` and the tests above use `await fireEvent.change(...)` plus `findByText` to accommodate that. Confirm jsdom's `File`/`FileReader` support in this project's test setup handles `.text()` (used elsewhere in the codebase already, e.g. any existing file-upload feature — search for `.text()` usage in other test files if you need a working reference pattern).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/components/desktop/DesktopSettingsApp.test.tsx`
Expected: FAIL — no Export/Import controls exist yet.

- [ ] **Step 3: Implement**

In `client/src/components/desktop/DesktopSettingsApp.tsx`, add the import:

```ts
import { exportSettings, importSettings } from '../../utils/settingsExportImport';
```

Add state for the import feedback message and a file-input ref:

```ts
const [importMessage, setImportMessage] = useState<string | null>(null);
const importInputRef = useRef<HTMLInputElement>(null);
```

Add handlers:

```ts
const handleExport = useCallback(() => {
  const blob = new Blob([exportSettings()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rmpg-desktop-settings.json';
  a.click();
  URL.revokeObjectURL(url);
}, []);

const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const result = importSettings(text);
  setImportMessage(result.ok ? 'Settings imported.' : (result.error ?? 'Import failed.'));
  e.target.value = '';
}, []);
```

Add the buttons in a new section above the category sidebar's search input (i.e., as a sibling section before the `<div style={{width:160...}}>` sidebar, spanning the full settings-window width, OR — simpler and consistent with the existing 2-column layout — placed as a small row directly below the title bar and above the `flex flex-1 overflow-hidden` row). Insert this block right after the title bar `<div>` and before `<div className="flex flex-1 overflow-hidden">`:

```tsx
<div className="flex items-center gap-2 px-2 py-1.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
  <button type="button" onClick={handleExport} className="text-[10px] px-2 py-0.5" style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
    Export Settings
  </button>
  <label className="text-[10px] px-2 py-0.5 cursor-pointer" style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
    Import Settings
    <input ref={importInputRef} type="file" accept="application/json" aria-label="Import Settings" onChange={handleImportFile} className="hidden" />
  </label>
  {importMessage && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{importMessage}</span>}
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/components/desktop/DesktopSettingsApp.test.tsx`
Expected: PASS, all tests including pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopSettingsApp.tsx client/src/components/desktop/DesktopSettingsApp.test.tsx
git commit -m "desktop: add Export/Import Settings buttons"
```

---

### Task 5: Per-category Reset buttons (Personalization, Window Management, Taskbar)

**Files:**
- Modify: `client/src/components/desktop/DesktopSettingsApp.tsx`
- Test: `client/src/components/desktop/DesktopSettingsApp.test.tsx`

**Interfaces:**
- Consumes: `onWallpaperChange`/`onAccentChange` (existing props), `setSnapEnabled` (existing import), `setTaskbarPosition`/`setTaskbarSize`/`setTaskbarAutoHide` (existing imports), `DEFAULT_WALLPAPER_ID`/`DEFAULT_ACCENT_ID` (need new imports from `../../data/desktopWallpapers`/`../../data/desktopAccents`).

- [ ] **Step 1: Write the failing tests**

Append to `client/src/components/desktop/DesktopSettingsApp.test.tsx`:

```tsx
describe('DesktopSettingsApp — per-category reset', () => {
  beforeEach(() => localStorage.clear());

  it('Personalization reset calls onWallpaperChange/onAccentChange with the defaults', () => {
    const props = renderApp();
    fireEvent.click(screen.getByText('Personalization'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByText('Reset this category to default'));
    expect(props.onWallpaperChange).toHaveBeenCalledWith('blue-silver-default');
    expect(props.onAccentChange).toHaveBeenCalled();
  });

  it('Window Management reset re-enables snap without touching taskbar keys', () => {
    localStorage.setItem('rmpg_desktop_taskbar_position', 'top');
    renderApp();
    fireEvent.click(screen.getByText('Window Management'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByText('Reset this category to default'));
    expect(localStorage.getItem('rmpg_desktop_snap_enabled')).toBe('1');
    expect(localStorage.getItem('rmpg_desktop_taskbar_position')).toBe('top');
  });

  it('Taskbar reset restores position/size/auto-hide defaults without touching pinned apps', () => {
    localStorage.setItem('rmpg_desktop_taskbar_position', 'top');
    localStorage.setItem('rmpg_desktop_taskbar_size', 'large');
    localStorage.setItem('rmpg_desktop_taskbar_autohide', '1');
    localStorage.setItem('rmpg_desktop_pinned_apps', JSON.stringify(['/dispatch']));
    renderApp();
    fireEvent.click(screen.getByText('Taskbar'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByText('Reset this category to default'));
    expect(localStorage.getItem('rmpg_desktop_taskbar_position')).toBe('bottom');
    expect(localStorage.getItem('rmpg_desktop_taskbar_size')).toBe('small');
    expect(localStorage.getItem('rmpg_desktop_taskbar_autohide')).toBe('0');
    expect(localStorage.getItem('rmpg_desktop_pinned_apps')).toBe(JSON.stringify(['/dispatch']));
  });
});
```

Note: since 3 different categories all render a button with the same text "Reset this category to default", each test switches to only one category before clicking, so `getByText` resolves unambiguously in each case (only one instance renders at a time, since categories are conditionally rendered based on `activeCategory`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/components/desktop/DesktopSettingsApp.test.tsx`
Expected: FAIL — no per-category reset buttons exist yet.

- [ ] **Step 3: Implement**

In `client/src/components/desktop/DesktopSettingsApp.tsx`, add imports:

```ts
import { DEFAULT_WALLPAPER_ID } from '../../data/desktopWallpapers';
import { DEFAULT_ACCENT_ID } from '../../data/desktopAccents';
```

Add a small reusable reset-button component right above the main `DesktopSettingsApp` export (or inline per-category — inline is fine given each usage is a one-off with a different `onClick`):

In the `personalization` category panel, add at the end (inside its existing `<div>`, after the Accent Color section):

```tsx
<div className="mt-3 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
  <button
    type="button"
    onClick={() => { if (window.confirm('Reset wallpaper and accent color to default?')) { onWallpaperChange(DEFAULT_WALLPAPER_ID); onAccentChange(DEFAULT_ACCENT_ID); } }}
    className="text-[10px] px-2 py-1 w-full"
    style={{ border: '1px solid var(--sev-critical)', color: 'var(--sev-critical)' }}
  >
    Reset this category to default
  </button>
</div>
```

In the `window-management` category panel, add at the end:

```tsx
<div className="mt-3 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
  <button
    type="button"
    onClick={() => { if (window.confirm('Reset window management settings (snap to edge) to default?')) { setSnapEnabled(true); setSnapEnabledState(true); } }}
    className="text-[10px] px-2 py-1 w-full"
    style={{ border: '1px solid var(--sev-critical)', color: 'var(--sev-critical)' }}
  >
    Reset this category to default
  </button>
</div>
```

In the `taskbar` category panel, add at the end:

```tsx
<div className="mt-3 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
  <button
    type="button"
    onClick={() => {
      if (!window.confirm('Reset taskbar position, size, and auto-hide to default? (Pinned apps are kept.)')) return;
      setTaskbarPosition('bottom'); setTaskbarPositionState('bottom');
      setTaskbarSize('small'); setTaskbarSizeState('small');
      setTaskbarAutoHide(false); setAutoHideState(false);
    }}
    className="text-[10px] px-2 py-1 w-full"
    style={{ border: '1px solid var(--sev-critical)', color: 'var(--sev-critical)' }}
  >
    Reset this category to default
  </button>
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/components/desktop/DesktopSettingsApp.test.tsx`
Expected: PASS, all tests including pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopSettingsApp.tsx client/src/components/desktop/DesktopSettingsApp.test.tsx
git commit -m "desktop: add per-category Reset buttons (Personalization, Window Management, Taskbar)"
```

---

### Task 6: Global `Ctrl+,` shortcut to open Settings

**Files:**
- Modify: `client/src/pages/DesktopPage.tsx`
- Test: `client/src/pages/DesktopPage.test.tsx`

**Interfaces:**
- Consumes: nothing new — calls the existing `setWidgetSettingsOpen` state setter already defined in `DesktopPageInner`.

- [ ] **Step 1: Write the failing test**

Read the current full content of `client/src/pages/DesktopPage.test.tsx` first to match its exact existing mocks/harness. Append:

```tsx
describe('DesktopPage — Ctrl+, opens Settings', () => {
  it('pressing Ctrl+, opens the Settings app', async () => {
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('Open app launcher')).toBeInTheDocument());
    fireEvent.keyDown(window, { key: ',', ctrlKey: true });
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByLabelText('Close Settings')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/DesktopPage.test.tsx`
Expected: FAIL — Ctrl+, does nothing today.

- [ ] **Step 3: Implement**

In `client/src/pages/DesktopPage.tsx`'s `DesktopPageInner` component, add a `useEffect` near the existing effects (after the debounced-save effect and the position-reconciliation effect if present from a prior branch, or simply anywhere inside the component body after `setWidgetSettingsOpen` is defined):

```ts
useEffect(() => {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key === ',') {
      e.preventDefault();
      setWidgetSettingsOpen(true);
    }
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}, []);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/DesktopPage.test.tsx`
Expected: PASS, all tests including pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/DesktopPage.tsx client/src/pages/DesktopPage.test.tsx
git commit -m "desktop: add global Ctrl+, shortcut to open Settings"
```

---

### Task 7: Full verification

**Files:** None (verification only).

- [ ] **Step 1: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `cd client && npx vitest run`
Expected: all tests pass.

- [ ] **Step 3: Build**

Run: `cd client && npx vite build`
Expected: build succeeds.

- [ ] **Step 4: Record verification in the ledger**

```bash
mkdir -p .superpowers/sdd
echo "SettingsShell-Task 7: complete — typecheck clean, full vitest suite passes, vite build succeeds. Manual smoke test not performed (pre-existing local D1 migration drift, consistent with prior branches this session)." >> .superpowers/sdd/progress.md
```
