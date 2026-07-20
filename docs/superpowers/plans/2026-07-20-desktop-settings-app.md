# Desktop Settings App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the small `DesktopWidgetSettingsPopover` with a full windowable-looking `DesktopSettingsApp` that organizes existing desktop personalization controls into a Windows-Settings-style category sidebar, with two placeholder categories reserved for future phases.

**Architecture:** A single new native (non-iframe) component rendered directly inside `DesktopPageInner`, reusing the exact same props/callbacks the popover already receives — no new data model, no new API calls. Drag uses the existing `useDraggablePosition` hook; resize mirrors `FloatingWindow.tsx`'s existing corner-drag pattern.

**Tech Stack:** React 18 + TypeScript client, Vitest + `@testing-library/react`.

## Global Constraints

- No new D1 columns, no new API endpoints — every functional control calls the same callback prop the popover already calls, with the same value types.
- No new `NavFunction`/catalog entry — this is not a routed page.
- Default panel size 640×480, minimum 480×360 on resize.
- Window Management and Layout & Templates categories render static "coming in a future phase" text and must not call any callback prop.
- Default active category on open is `personalization`.

---

## Task 1: Create `DesktopSettingsApp.tsx`

**Files:**
- Create: `client/src/components/desktop/DesktopSettingsApp.tsx`
- Test: `client/src/components/desktop/DesktopSettingsApp.test.tsx`

**Interfaces:**
- Produces: `export default function DesktopSettingsApp(props: DesktopSettingsAppProps)`, `export interface DesktopSettingsAppProps` — consumed by Task 2's wiring into `DesktopPage.tsx`. Props are identical in name and type to the existing `DesktopWidgetSettingsPopoverProps` (`client/src/components/desktop/DesktopWidgetSettingsPopover.tsx`).

- [ ] **Step 1: Write the failing test**

Create `client/src/components/desktop/DesktopSettingsApp.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DesktopSettingsApp from './DesktopSettingsApp';
import { normalizeDesktopWidgets } from '../../utils/normalizeDesktopWidgets';

function renderApp(overrides: Partial<React.ComponentProps<typeof DesktopSettingsApp>> = {}) {
  const props = {
    widgets: normalizeDesktopWidgets(null),
    onToggleWidget: vi.fn(),
    iconSize: 'medium' as const,
    onIconSizeChange: vi.fn(),
    viewMode: 'grid' as const,
    onViewModeChange: vi.fn(),
    sortMode: 'manual' as const,
    onSortModeChange: vi.fn(),
    onSnapToGrid: vi.fn(),
    wallpaperId: 'blue-silver-default',
    onWallpaperChange: vi.fn(),
    accentId: 'default',
    onAccentChange: vi.fn(),
    onResetToDefault: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<DesktopSettingsApp {...props} />);
  return props;
}

describe('DesktopSettingsApp', () => {
  it('defaults to the Personalization category, showing wallpaper and accent controls', () => {
    renderApp();
    expect(screen.getByText('Wallpaper')).toBeInTheDocument();
    expect(screen.getByText('Accent Color')).toBeInTheDocument();
    expect(screen.queryByText('Icon Size')).not.toBeInTheDocument();
  });

  it('clicking a wallpaper swatch calls onWallpaperChange, an accent swatch calls onAccentChange', () => {
    const props = renderApp();
    fireEvent.click(screen.getByLabelText('Wallpaper: Sunken Slate'));
    expect(props.onWallpaperChange).toHaveBeenCalledWith('sunken');
    fireEvent.click(screen.getByLabelText('Accent: Amber'));
    expect(props.onAccentChange).toHaveBeenCalledWith('amber');
  });

  it('switching to Desktop & Icons shows widgets, icon size, view, sort, and reset controls', () => {
    renderApp();
    fireEvent.click(screen.getByText('Desktop & Icons'));
    expect(screen.getByText('Icon Size')).toBeInTheDocument();
    expect(screen.getByText('Reset to Default')).toBeInTheDocument();
    expect(screen.queryByText('Wallpaper')).not.toBeInTheDocument();
  });

  it('toggling a widget checkbox calls onToggleWidget with the widget id', () => {
    const props = renderApp();
    fireEvent.click(screen.getByText('Desktop & Icons'));
    fireEvent.click(screen.getByLabelText('Clock & Shift'));
    expect(props.onToggleWidget).toHaveBeenCalledWith('clock', false);
  });

  it('clicking an icon-size button calls onIconSizeChange', () => {
    const props = renderApp();
    fireEvent.click(screen.getByText('Desktop & Icons'));
    fireEvent.click(screen.getByText('Large'));
    expect(props.onIconSizeChange).toHaveBeenCalledWith('large');
  });

  it('clicking the List view button calls onViewModeChange', () => {
    const props = renderApp();
    fireEvent.click(screen.getByText('Desktop & Icons'));
    fireEvent.click(screen.getByText('List'));
    expect(props.onViewModeChange).toHaveBeenCalledWith('list');
  });

  it('clicking a sort-mode button calls onSortModeChange, and Snap to Grid calls onSnapToGrid', () => {
    const props = renderApp();
    fireEvent.click(screen.getByText('Desktop & Icons'));
    fireEvent.click(screen.getByText('Alphabetical'));
    expect(props.onSortModeChange).toHaveBeenCalledWith('alpha');
    fireEvent.click(screen.getByText('Snap to Grid'));
    expect(props.onSnapToGrid).toHaveBeenCalled();
  });

  it('Reset to Default asks for confirmation before calling onResetToDefault', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const props = renderApp();
    fireEvent.click(screen.getByText('Desktop & Icons'));
    fireEvent.click(screen.getByText('Reset to Default'));
    expect(window.confirm).toHaveBeenCalled();
    expect(props.onResetToDefault).toHaveBeenCalled();
  });

  it('Window Management category shows a placeholder and calls no callbacks', () => {
    const props = renderApp();
    fireEvent.click(screen.getByText('Window Management'));
    expect(screen.getByText(/coming in a future phase/i)).toBeInTheDocument();
    expect(props.onIconSizeChange).not.toHaveBeenCalled();
    expect(props.onWallpaperChange).not.toHaveBeenCalled();
  });

  it('Layout & Templates category shows a placeholder', () => {
    renderApp();
    fireEvent.click(screen.getByText('Layout & Templates'));
    expect(screen.getByText(/coming in a future phase/i)).toBeInTheDocument();
  });

  it('close button calls onClose', () => {
    const props = renderApp();
    fireEvent.click(screen.getByLabelText('Close Settings'));
    expect(props.onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopSettingsApp.test.tsx`
Expected: FAIL — `DesktopSettingsApp.tsx` doesn't exist yet (module not found).

- [ ] **Step 3: Create `DesktopSettingsApp.tsx`**

```tsx
// client/src/components/desktop/DesktopSettingsApp.tsx
import React, { useState, useRef, useCallback } from 'react';
import { Sliders, LayoutGrid, AppWindow, FolderKanban, X } from 'lucide-react';
import type { DesktopWidgetState } from '../../utils/normalizeDesktopWidgets';
import { DESKTOP_WALLPAPERS } from '../../data/desktopWallpapers';
import { DESKTOP_ACCENTS } from '../../data/desktopAccents';
import { useDraggablePosition } from '../../hooks/useDraggablePosition';

const ALL_WIDGETS: { id: string; label: string }[] = [
  { id: 'clock', label: 'Clock & Shift' },
  { id: 'ops-summary', label: 'Live Ops Summary' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'quick-access', label: 'Quick Access' },
  { id: 'shift-timer', label: 'Shift Timer' },
  { id: 'pinned-call-ticker', label: 'Pinned Call Ticker' },
  { id: 'mini-map', label: 'Mini Map' },
];

const ICON_SIZES: Array<'small' | 'medium' | 'large'> = ['small', 'medium', 'large'];
const ICON_SIZE_LABELS: Record<'small' | 'medium' | 'large', string> = { small: 'Small', medium: 'Medium', large: 'Large' };
const SORT_MODES: Array<'manual' | 'alpha' | 'usage'> = ['manual', 'alpha', 'usage'];
const SORT_LABELS: Record<'manual' | 'alpha' | 'usage', string> = { manual: 'Manual', alpha: 'Alphabetical', usage: 'Most Used' };

const CATEGORIES = [
  { id: 'personalization', label: 'Personalization', icon: Sliders },
  { id: 'desktop-icons', label: 'Desktop & Icons', icon: LayoutGrid },
  { id: 'window-management', label: 'Window Management', icon: AppWindow },
  { id: 'layout-templates', label: 'Layout & Templates', icon: FolderKanban },
] as const;

type CategoryId = typeof CATEGORIES[number]['id'];

export interface DesktopSettingsAppProps {
  widgets: DesktopWidgetState[];
  onToggleWidget: (id: string, enabled: boolean) => void;
  iconSize: 'small' | 'medium' | 'large';
  onIconSizeChange: (size: 'small' | 'medium' | 'large') => void;
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
  sortMode: 'manual' | 'alpha' | 'usage';
  onSortModeChange: (mode: 'manual' | 'alpha' | 'usage') => void;
  onSnapToGrid: () => void;
  wallpaperId: string;
  onWallpaperChange: (id: string) => void;
  accentId: string;
  onAccentChange: (id: string) => void;
  onResetToDefault: () => void;
  onClose: () => void;
}

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 480;
const MIN_WIDTH = 480;
const MIN_HEIGHT = 360;

function sectionLabelStyle(): React.CSSProperties {
  return { color: 'var(--rmpg-400)' };
}

export default function DesktopSettingsApp({
  widgets, onToggleWidget, iconSize, onIconSizeChange, viewMode, onViewModeChange, sortMode, onSortModeChange, onSnapToGrid,
  wallpaperId, onWallpaperChange, accentId, onAccentChange, onResetToDefault, onClose,
}: DesktopSettingsAppProps) {
  const [activeCategory, setActiveCategory] = useState<CategoryId>('personalization');
  const [pos, setPos] = useState(() => ({
    x: Math.max(0, (window.innerWidth - DEFAULT_WIDTH) / 2),
    y: Math.max(0, (window.innerHeight - DEFAULT_HEIGHT) / 2),
  }));
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const { onPointerDown: onTitleBarPointerDown } = useDraggablePosition(pos.x, pos.y, (x, y) => setPos({ x, y }));

  const resizeState = useRef<{ startX: number; startY: number; originW: number; originH: number } | null>(null);
  const onResizeHandlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    resizeState.current = { startX: e.clientX, startY: e.clientY, originW: size.width, originH: size.height };
    const onMove = (ev: PointerEvent) => {
      if (!resizeState.current) return;
      const dx = ev.clientX - resizeState.current.startX;
      const dy = ev.clientY - resizeState.current.startY;
      setSize({
        width: Math.max(MIN_WIDTH, resizeState.current.originW + dx),
        height: Math.max(MIN_HEIGHT, resizeState.current.originH + dy),
      });
    };
    const onUp = () => {
      resizeState.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [size.width, size.height]);

  const enabledIds = new Set(widgets.filter(w => w.on).map(w => w.id));

  return (
    <div
      style={{
        position: 'fixed', left: pos.x, top: pos.y, width: size.width, height: size.height,
        background: 'var(--surface-raised)', border: '1px solid var(--border-strong)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 2000, display: 'flex', flexDirection: 'column',
      }}
    >
      <div
        onPointerDown={onTitleBarPointerDown}
        className="flex items-center justify-between px-2 select-none cursor-move"
        style={{ height: 30, background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}
      >
        <span className="text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>Settings</span>
        <button type="button" aria-label="Close Settings" onClick={onClose} className="p-1 hover:bg-surface-hover">
          <X className="w-3 h-3" style={{ color: 'var(--sev-critical, var(--rmpg-400))' }} />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div style={{ width: 160, borderRight: '1px solid var(--border-subtle)', flexShrink: 0, overflowY: 'auto' }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px]"
              style={{ background: activeCategory === cat.id ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
            >
              <cat.icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--rmpg-400)' }} />
              {cat.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {activeCategory === 'personalization' && (
            <div>
              <div className="text-[10px] font-semibold uppercase mt-2 mb-1" style={sectionLabelStyle()}>Wallpaper</div>
              <div className="flex gap-1.5 flex-wrap">
                {DESKTOP_WALLPAPERS.map(w => (
                  <button
                    key={w.id} type="button" aria-label={`Wallpaper: ${w.label}`} onClick={() => onWallpaperChange(w.id)}
                    style={{ width: 24, height: 24, background: w.background, border: wallpaperId === w.id ? '2px solid var(--brand-400)' : '1px solid var(--border-default)' }}
                  />
                ))}
              </div>

              <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Accent Color</div>
              <div className="flex gap-1.5 flex-wrap">
                {DESKTOP_ACCENTS.map(a => (
                  <button
                    key={a.id} type="button" aria-label={`Accent: ${a.label}`} onClick={() => onAccentChange(a.id)}
                    style={{ width: 20, height: 20, borderRadius: '50%', background: a.accent, border: accentId === a.id ? '2px solid var(--text-primary)' : '1px solid var(--border-default)' }}
                  />
                ))}
              </div>
            </div>
          )}

          {activeCategory === 'desktop-icons' && (
            <div>
              <div className="text-[10px] font-semibold uppercase mb-1" style={sectionLabelStyle()}>Widgets</div>
              {ALL_WIDGETS.map(w => (
                <label key={w.id} className="flex items-center gap-2 text-[11px] py-1" style={{ color: 'var(--text-primary)' }}>
                  <input type="checkbox" checked={enabledIds.has(w.id)} onChange={(e) => onToggleWidget(w.id, e.target.checked)} />
                  {w.label}
                </label>
              ))}

              <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Icon Size</div>
              <div className="flex gap-1">
                {ICON_SIZES.map(s => (
                  <button
                    key={s} type="button" onClick={() => onIconSizeChange(s)}
                    className="text-[10px] px-2 py-0.5"
                    style={{ border: '1px solid var(--border-default)', background: iconSize === s ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
                  >
                    {ICON_SIZE_LABELS[s]}
                  </button>
                ))}
              </div>

              <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>View</div>
              <div className="flex gap-1">
                {(['grid', 'list'] as const).map(mode => (
                  <button
                    key={mode} type="button" onClick={() => onViewModeChange(mode)}
                    className="text-[10px] px-2 py-0.5 capitalize"
                    style={{ border: '1px solid var(--border-default)', background: viewMode === mode ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
                  >
                    {mode === 'grid' ? 'Grid' : 'List'}
                  </button>
                ))}
              </div>

              <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Sort</div>
              <div className="flex gap-1 flex-wrap">
                {SORT_MODES.map(mode => (
                  <button
                    key={mode} type="button" onClick={() => onSortModeChange(mode)}
                    className="text-[10px] px-2 py-0.5"
                    style={{ border: '1px solid var(--border-default)', background: sortMode === mode ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
                  >
                    {SORT_LABELS[mode]}
                  </button>
                ))}
                <button type="button" onClick={onSnapToGrid} className="text-[10px] px-2 py-0.5" style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
                  Snap to Grid
                </button>
              </div>

              <div className="mt-3 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button
                  type="button"
                  onClick={() => { if (window.confirm('Reset your desktop layout, widgets, wallpaper, accent, and sticky notes back to default? This cannot be undone.')) onResetToDefault(); }}
                  className="text-[10px] px-2 py-1 w-full"
                  style={{ border: '1px solid var(--sev-critical)', color: 'var(--sev-critical)' }}
                >
                  Reset to Default
                </button>
              </div>
            </div>
          )}

          {activeCategory === 'window-management' && (
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Window cycling and multi-monitor placement are coming in a future phase.
            </div>
          )}

          {activeCategory === 'layout-templates' && (
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Layout export/import and per-role templates are coming in a future phase.
            </div>
          )}
        </div>
      </div>

      <div
        onPointerDown={onResizeHandlePointerDown}
        style={{ position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, cursor: 'nwse-resize' }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd client && npx vitest run src/components/desktop/DesktopSettingsApp.test.tsx`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopSettingsApp.tsx client/src/components/desktop/DesktopSettingsApp.test.tsx
git commit -m "desktop: add DesktopSettingsApp with categorized Personalization/Desktop & Icons/placeholders"
```

---

## Task 2: Wire `DesktopSettingsApp` into `DesktopPage.tsx`, update its trigger label

**Files:**
- Modify: `client/src/pages/DesktopPage.tsx`
- Modify: `client/src/pages/DesktopPage.test.tsx`

**Interfaces:**
- Consumes: `DesktopSettingsApp`/`DesktopSettingsAppProps` from Task 1.

- [ ] **Step 1: Swap the import**

Replace:

```ts
import DesktopWidgetSettingsPopover from '../components/desktop/DesktopWidgetSettingsPopover';
```

with:

```ts
import DesktopSettingsApp from '../components/desktop/DesktopSettingsApp';
```

- [ ] **Step 2: Rename the context-menu trigger label**

Replace:

```ts
            { label: 'Widget settings', onClick: () => setWidgetSettingsOpen(true) },
```

with:

```ts
            { label: 'Settings', onClick: () => setWidgetSettingsOpen(true) },
```

- [ ] **Step 3: Swap the rendered component**

Replace:

```tsx
        {widgetSettingsOpen && (
          <DesktopWidgetSettingsPopover
            widgets={widgets} onToggleWidget={handleToggleWidget}
            iconSize={layout.iconSize} onIconSizeChange={handleIconSizeChange}
            viewMode={layout.viewMode} onViewModeChange={handleViewModeChange}
            sortMode={layout.sortMode} onSortModeChange={handleSortModeChange} onSnapToGrid={handleSnapToGrid}
            wallpaperId={wallpaperId} onWallpaperChange={setWallpaperId}
            accentId={accentId} onAccentChange={setAccentId}
            onResetToDefault={handleResetToDefault}
            onClose={() => setWidgetSettingsOpen(false)}
          />
        )}
```

with:

```tsx
        {widgetSettingsOpen && (
          <DesktopSettingsApp
            widgets={widgets} onToggleWidget={handleToggleWidget}
            iconSize={layout.iconSize} onIconSizeChange={handleIconSizeChange}
            viewMode={layout.viewMode} onViewModeChange={handleViewModeChange}
            sortMode={layout.sortMode} onSortModeChange={handleSortModeChange} onSnapToGrid={handleSnapToGrid}
            wallpaperId={wallpaperId} onWallpaperChange={setWallpaperId}
            accentId={accentId} onAccentChange={setAccentId}
            onResetToDefault={handleResetToDefault}
            onClose={() => setWidgetSettingsOpen(false)}
          />
        )}
```

- [ ] **Step 4: Update the two `DesktopPage.test.tsx` tests that reference the old "Widget settings" label and assume Icon Size/Reset are immediately visible**

Replace:

```tsx
  it('opens the settings popover with icon size, sort, wallpaper, accent, and reset controls', () => {
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    fireEvent.contextMenu(screen.getByText(/No modules pinned yet/i));
    fireEvent.click(screen.getByText('Widget settings'));
    expect(screen.getByText('Icon Size')).toBeInTheDocument();
    expect(screen.getByText('Reset to Default')).toBeInTheDocument();
  });
```

with:

```tsx
  it('opens the settings app with icon size, sort, wallpaper, accent, and reset controls', () => {
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    fireEvent.contextMenu(screen.getByText(/No modules pinned yet/i));
    fireEvent.click(screen.getByText('Settings'));
    fireEvent.click(screen.getByText('Desktop & Icons'));
    expect(screen.getByText('Icon Size')).toBeInTheDocument();
    expect(screen.getByText('Reset to Default')).toBeInTheDocument();
  });
```

Replace:

```tsx
      fireEvent.contextMenu(screen.getByText(/No modules pinned yet/i));
      fireEvent.click(screen.getByText('Widget settings'));
      fireEvent.click(screen.getByText('Reset to Default'));

      expect(confirmSpy).toHaveBeenCalled();
```

with:

```tsx
      fireEvent.contextMenu(screen.getByText(/No modules pinned yet/i));
      fireEvent.click(screen.getByText('Settings'));
      fireEvent.click(screen.getByText('Desktop & Icons'));
      fireEvent.click(screen.getByText('Reset to Default'));

      expect(confirmSpy).toHaveBeenCalled();
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `cd client && npx vitest run src/pages/DesktopPage.test.tsx src/components/desktop/DesktopSettingsApp.test.tsx`
Expected: PASS (all tests in both files)

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/DesktopPage.tsx client/src/pages/DesktopPage.test.tsx
git commit -m "desktop: wire DesktopSettingsApp into DesktopPage, rename trigger to Settings"
```

---

## Task 3: Remove the superseded `DesktopWidgetSettingsPopover`

**Files:**
- Delete: `client/src/components/desktop/DesktopWidgetSettingsPopover.tsx`
- Delete: `client/src/components/desktop/DesktopWidgetSettingsPopover.test.tsx`

**Interfaces:** none — this is a pure deletion once Task 2 has removed the last consumer.

- [ ] **Step 1: Verify no remaining references**

Run: `grep -rn "DesktopWidgetSettingsPopover" client/src --include="*.tsx" --include="*.ts"`
Expected: no output (Task 2 already replaced the only import/usage).

- [ ] **Step 2: Delete both files**

```bash
git rm client/src/components/desktop/DesktopWidgetSettingsPopover.tsx client/src/components/desktop/DesktopWidgetSettingsPopover.test.tsx
```

- [ ] **Step 3: Run the client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (confirms nothing still imports the deleted file).

- [ ] **Step 4: Commit**

```bash
git commit -m "desktop: remove DesktopWidgetSettingsPopover — superseded by DesktopSettingsApp"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full client test suite**

Run: `cd client && npx vitest run`
Expected: all tests PASS.

- [ ] **Step 3: Full client production build**

Run: `cd client && npx vite build`
Expected: builds successfully.

- [ ] **Step 4: Manual verification note**

If a working dev/staging environment is available: open `/desktop`, right-click the desktop canvas, click "Settings," confirm it opens centered with a title bar; switch between all 4 categories; change a wallpaper and an accent color and confirm they visibly apply to the desktop behind the (still-open) Settings window; drag the title bar to reposition; drag the bottom-right corner to resize (confirm it won't shrink below 480×360); click "Desktop & Icons," toggle a widget off, confirm it disappears from the desktop; click Close.

If no working dev/staging environment is available (as was the case for two prior changes in this program, due to unrelated local D1 migration drift), state that plainly rather than claiming this step was performed — the automated test suite from Steps 1-3 is real evidence; a skipped manual step is not silently equivalent to it.
