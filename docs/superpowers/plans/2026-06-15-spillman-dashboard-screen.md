# Spillman Flex Dashboard Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reformat the Command & Control Dashboard to look like an authentic Spillman Flex desktop screen (steel-blue/grey group-box panels + screen toolbar), and add role-based view configs (Dispatch / Patrol / Admin) with an admin-only, per-user-persisted toolbar switcher.

**Architecture:** Presentation + client-side view-state only — no Worker/API/DB changes. A pure config module (`dashboardViews.ts`) declares which panels each view shows and the role/persistence rules. Two small prop-driven components (`SpmGroup`, `DashboardViewSelector`) provide the Spillman chrome. `DashboardPage.tsx` consumes `useAuth()`, resolves the effective view, renders the screen toolbar + selector, and gates each existing widget block by panel id. Styling reuses the existing `--spm-*` day/night token engine via a new `.dashboard-page` scoped layer in `spillman.css` (same substring-selector technique as the Records skin).

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind, vitest + @testing-library/react (jsdom), existing `useAuth` context (`client/src/context/AuthContext.tsx`).

**Spec:** `docs/superpowers/specs/2026-06-15-spillman-dashboard-screen-design.md`

---

## File Structure

- **Create** `client/src/pages/dashboard/dashboardViews.ts` — pure view-config: panel sets, role→default, switch allow-list, persistence, toolbar action order. The single source of view logic. No React.
- **Create** `client/src/pages/dashboard/__tests__/dashboardViews.test.ts` — unit tests for the above.
- **Create** `client/src/pages/dashboard/SpmGroup.tsx` — presentational Spillman group-box wrapper (`title`, `tone`, `children`).
- **Create** `client/src/pages/dashboard/__tests__/SpmGroup.test.tsx` — render test.
- **Create** `client/src/pages/dashboard/DashboardViewSelector.tsx` — presentational toolbar `View:` segmented control (`view`, `onChange`, `canSwitch`).
- **Create** `client/src/pages/dashboard/__tests__/DashboardViewSelector.test.tsx` — render/interaction test.
- **Modify** `client/src/styles/spillman.css` — append a `.dashboard-page` scoped skin layer + Spillman chrome classes (`.spm-screen-title`, `.spm-screen-toolbar`, `.spm-toolbtn`, `.spm-group*`, `.spm-view-seg*`).
- **Modify** `client/src/pages/DashboardPage.tsx` — add `.dashboard-page` root class; wire view state via `useAuth`; render screen title bar + toolbar (with selector + action buttons); remove the standalone Quick Actions panel; wrap each widget block in `SpmGroup` and gate by panel id.
- **Modify** `client/public/sw.js` — bump `CACHE_NAME`.

---

## Task 1: View-config module (pure, TDD)

**Files:**
- Create: `client/src/pages/dashboard/dashboardViews.ts`
- Test: `client/src/pages/dashboard/__tests__/dashboardViews.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/dashboard/__tests__/dashboardViews.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  VIEW_PANELS,
  PANEL_IDS,
  defaultViewForRole,
  canSwitchView,
  resolveDashboardView,
  toolbarActionsForView,
  readSavedView,
  writeSavedView,
  DASHBOARD_VIEW_STORAGE_KEY,
  type DashboardView,
} from '../dashboardViews';

describe('defaultViewForRole', () => {
  it('maps operational roles to their view', () => {
    expect(defaultViewForRole('dispatcher')).toBe('dispatch');
    expect(defaultViewForRole('officer')).toBe('patrol');
    expect(defaultViewForRole('admin')).toBe('admin');
    expect(defaultViewForRole('manager')).toBe('admin');
    expect(defaultViewForRole('supervisor')).toBe('admin');
  });
  it('falls back to dispatch for non-operational/unknown roles', () => {
    expect(defaultViewForRole('contract_manager')).toBe('dispatch');
    expect(defaultViewForRole('client_viewer')).toBe('dispatch');
    expect(defaultViewForRole('human_resources')).toBe('dispatch');
    expect(defaultViewForRole('')).toBe('dispatch');
    expect(defaultViewForRole('something_new')).toBe('dispatch');
  });
});

describe('canSwitchView', () => {
  it('allows only admin/manager/supervisor', () => {
    expect(canSwitchView('admin')).toBe(true);
    expect(canSwitchView('manager')).toBe(true);
    expect(canSwitchView('supervisor')).toBe(true);
    expect(canSwitchView('dispatcher')).toBe(false);
    expect(canSwitchView('officer')).toBe(false);
    expect(canSwitchView('client_viewer')).toBe(false);
  });
});

describe('VIEW_PANELS', () => {
  it('only references known panel ids', () => {
    const known = new Set(PANEL_IDS);
    (Object.keys(VIEW_PANELS) as DashboardView[]).forEach((v) => {
      VIEW_PANELS[v].forEach((p) => expect(known.has(p)).toBe(true));
    });
  });
  it('admin shows the superset incl. statusSummary, officerActivity, alertsReminders', () => {
    expect(VIEW_PANELS.admin).toContain('statusSummary');
    expect(VIEW_PANELS.admin).toContain('officerActivity');
    expect(VIEW_PANELS.admin).toContain('alertsReminders');
  });
  it('dispatch omits admin-only panels', () => {
    expect(VIEW_PANELS.dispatch).not.toContain('officerActivity');
    expect(VIEW_PANELS.dispatch).not.toContain('alertsReminders');
  });
  it('patrol is field-focused', () => {
    expect(VIEW_PANELS.patrol).toContain('shiftStatus');
    expect(VIEW_PANELS.patrol).toContain('activeBolos');
    expect(VIEW_PANELS.patrol).toContain('callsNearMe');
    expect(VIEW_PANELS.patrol).not.toContain('officerActivity');
  });
});

describe('resolveDashboardView', () => {
  beforeEach(() => localStorage.clear());
  it('returns role default when nothing saved', () => {
    expect(resolveDashboardView('dispatcher')).toBe('dispatch');
  });
  it('honors a saved view ONLY when the role may switch', () => {
    writeSavedView('patrol');
    expect(resolveDashboardView('admin')).toBe('patrol');     // admin can switch
    expect(resolveDashboardView('dispatcher')).toBe('dispatch'); // saved ignored
  });
  it('ignores an invalid saved value', () => {
    localStorage.setItem(DASHBOARD_VIEW_STORAGE_KEY, 'bogus');
    expect(resolveDashboardView('admin')).toBe('admin');
  });
});

describe('persistence', () => {
  beforeEach(() => localStorage.clear());
  it('round-trips a valid view', () => {
    writeSavedView('admin');
    expect(readSavedView()).toBe('admin');
  });
  it('readSavedView returns null for missing/invalid', () => {
    expect(readSavedView()).toBeNull();
    localStorage.setItem(DASHBOARD_VIEW_STORAGE_KEY, 'nope');
    expect(readSavedView()).toBeNull();
  });
  it('readSavedView swallows storage errors', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readSavedView()).toBeNull();
    spy.mockRestore();
  });
});

describe('toolbarActionsForView', () => {
  it('patrol leads with field actions', () => {
    const ids = toolbarActionsForView('patrol').map((a) => a.id);
    expect(ids.slice(0, 3)).toEqual(['startPatrol', 'newCitation', 'processServer']);
  });
  it('dispatch/admin lead with call/incident actions', () => {
    expect(toolbarActionsForView('dispatch').map((a) => a.id).slice(0, 2)).toEqual(['newCall', 'newIncident']);
    expect(toolbarActionsForView('admin').map((a) => a.id).slice(0, 2)).toEqual(['newCall', 'newIncident']);
  });
  it('always includes print and refresh', () => {
    const ids = toolbarActionsForView('dispatch').map((a) => a.id);
    expect(ids).toContain('print');
    expect(ids).toContain('refresh');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/dashboard/__tests__/dashboardViews.test.ts`
Expected: FAIL — `Cannot find module '../dashboardViews'`.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/pages/dashboard/dashboardViews.ts`:

```ts
// Pure, framework-free view-config for the Spillman dashboard screen.
// No React, no DOM beyond localStorage — keeps the rules unit-testable.

export type DashboardView = 'dispatch' | 'patrol' | 'admin';

export type PanelId =
  | 'activeCalls' | 'recentActivity' | 'activeUnits' | 'activeBolos'
  | 'statusSummary' | 'shiftStatus' | 'weather' | 'alertsReminders'
  | 'officerActivity' | 'callsNearMe' | 'myActivity';

export const PANEL_IDS: readonly PanelId[] = [
  'activeCalls', 'recentActivity', 'activeUnits', 'activeBolos',
  'statusSummary', 'shiftStatus', 'weather', 'alertsReminders',
  'officerActivity', 'callsNearMe', 'myActivity',
];

export const DASHBOARD_VIEWS: readonly DashboardView[] = ['dispatch', 'patrol', 'admin'];

export const DASHBOARD_VIEW_LABELS: Record<DashboardView, string> = {
  dispatch: 'Dispatch',
  patrol: 'Patrol',
  admin: 'Admin',
};

// Which panels each view renders, in display order.
export const VIEW_PANELS: Record<DashboardView, PanelId[]> = {
  dispatch: ['activeCalls', 'activeUnits', 'activeBolos', 'recentActivity', 'shiftStatus', 'weather'],
  patrol: ['shiftStatus', 'activeBolos', 'callsNearMe', 'myActivity', 'weather'],
  admin: [
    'statusSummary', 'activeCalls', 'activeUnits', 'activeBolos',
    'recentActivity', 'officerActivity', 'alertsReminders', 'shiftStatus', 'weather',
  ],
};

const ROLE_DEFAULT: Record<string, DashboardView> = {
  dispatcher: 'dispatch',
  officer: 'patrol',
  admin: 'admin',
  manager: 'admin',
  supervisor: 'admin',
};

const SWITCH_ROLES = new Set(['admin', 'manager', 'supervisor']);

export const DASHBOARD_VIEW_STORAGE_KEY = 'rmpg_dashboard_view';

export function defaultViewForRole(role: string): DashboardView {
  return ROLE_DEFAULT[role] ?? 'dispatch';
}

export function canSwitchView(role: string): boolean {
  return SWITCH_ROLES.has(role);
}

function isDashboardView(v: unknown): v is DashboardView {
  return v === 'dispatch' || v === 'patrol' || v === 'admin';
}

export function readSavedView(): DashboardView | null {
  try {
    const raw = localStorage.getItem(DASHBOARD_VIEW_STORAGE_KEY);
    return isDashboardView(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeSavedView(view: DashboardView): void {
  try {
    localStorage.setItem(DASHBOARD_VIEW_STORAGE_KEY, view);
  } catch {
    /* storage unavailable — ignore */
  }
}

// Effective view = saved view (only if the role may switch) else role default.
export function resolveDashboardView(role: string): DashboardView {
  if (canSwitchView(role)) {
    const saved = readSavedView();
    if (saved) return saved;
  }
  return defaultViewForRole(role);
}

export type ToolbarActionId =
  | 'newCall' | 'newIncident' | 'newCitation' | 'startPatrol'
  | 'processServer' | 'print' | 'refresh';

export interface ToolbarAction { id: ToolbarActionId; label: string; }

const ACTION_LABELS: Record<ToolbarActionId, string> = {
  newCall: 'New Call',
  newIncident: 'New Incident',
  newCitation: 'New Citation',
  startPatrol: 'Start Patrol',
  processServer: 'Process Server',
  print: 'Print',
  refresh: 'Refresh',
};

// Toolbar action order. Patrol leads with field actions; others lead with call/incident.
export function toolbarActionsForView(view: DashboardView): ToolbarAction[] {
  const lead: ToolbarActionId[] = view === 'patrol'
    ? ['startPatrol', 'newCitation', 'processServer', 'newCall', 'newIncident']
    : ['newCall', 'newIncident', 'newCitation', 'startPatrol', 'processServer'];
  const order: ToolbarActionId[] = [...lead, 'print', 'refresh'];
  return order.map((id) => ({ id, label: ACTION_LABELS[id] }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/dashboard/__tests__/dashboardViews.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/dashboard/dashboardViews.ts client/src/pages/dashboard/__tests__/dashboardViews.test.ts
git commit -m "feat(dashboard): pure view-config module for Spillman role views"
```

---

## Task 2: SpmGroup group-box component (TDD)

**Files:**
- Create: `client/src/pages/dashboard/SpmGroup.tsx`
- Test: `client/src/pages/dashboard/__tests__/SpmGroup.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/dashboard/__tests__/SpmGroup.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SpmGroup from '../SpmGroup';

describe('SpmGroup', () => {
  it('renders the title and children', () => {
    render(<SpmGroup title="Active Calls"><div>body-content</div></SpmGroup>);
    expect(screen.getByText('Active Calls')).toBeTruthy();
    expect(screen.getByText('body-content')).toBeTruthy();
  });
  it('applies the tone class to the header', () => {
    const { container } = render(<SpmGroup title="BOLOs" tone="red"><span>x</span></SpmGroup>);
    expect(container.querySelector('.spm-group-head.tone-red')).toBeTruthy();
  });
  it('defaults to steel tone', () => {
    const { container } = render(<SpmGroup title="X"><span>x</span></SpmGroup>);
    expect(container.querySelector('.spm-group-head.tone-steel')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/dashboard/__tests__/SpmGroup.test.tsx`
Expected: FAIL — cannot find module `../SpmGroup`.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/pages/dashboard/SpmGroup.tsx`:

```tsx
import React from 'react';

export type SpmTone = 'steel' | 'red' | 'gold';

interface SpmGroupProps {
  title: string;
  tone?: SpmTone;
  className?: string;
  children: React.ReactNode;
}

/**
 * Spillman Flex "group box": a titled panel with a gradient header bar.
 * Colors come from the .dashboard-page skin layer in spillman.css (day/night aware),
 * so this component only emits structural classes.
 */
export default function SpmGroup({ title, tone = 'steel', className = '', children }: SpmGroupProps) {
  return (
    <section className={`spm-group ${className}`.trim()}>
      <div className={`spm-group-head tone-${tone}`}>{title}</div>
      <div className="spm-group-body">{children}</div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/dashboard/__tests__/SpmGroup.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/dashboard/SpmGroup.tsx client/src/pages/dashboard/__tests__/SpmGroup.test.tsx
git commit -m "feat(dashboard): SpmGroup Spillman group-box component"
```

---

## Task 3: DashboardViewSelector component (TDD)

**Files:**
- Create: `client/src/pages/dashboard/DashboardViewSelector.tsx`
- Test: `client/src/pages/dashboard/__tests__/DashboardViewSelector.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/dashboard/__tests__/DashboardViewSelector.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardViewSelector from '../DashboardViewSelector';

describe('DashboardViewSelector', () => {
  it('renders nothing when the user cannot switch', () => {
    const { container } = render(
      <DashboardViewSelector view="dispatch" canSwitch={false} onChange={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
  it('renders all three view buttons when switching is allowed', () => {
    render(<DashboardViewSelector view="admin" canSwitch onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Dispatch' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Patrol' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeTruthy();
  });
  it('marks the active view with aria-pressed', () => {
    render(<DashboardViewSelector view="patrol" canSwitch onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Patrol' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Admin' }).getAttribute('aria-pressed')).toBe('false');
  });
  it('calls onChange with the clicked view', async () => {
    const onChange = vi.fn();
    render(<DashboardViewSelector view="admin" canSwitch onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Dispatch' }));
    expect(onChange).toHaveBeenCalledWith('dispatch');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/dashboard/__tests__/DashboardViewSelector.test.tsx`
Expected: FAIL — cannot find module `../DashboardViewSelector`.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/pages/dashboard/DashboardViewSelector.tsx`:

```tsx
import React from 'react';
import { DASHBOARD_VIEWS, DASHBOARD_VIEW_LABELS, type DashboardView } from './dashboardViews';

interface Props {
  view: DashboardView;
  canSwitch: boolean;
  onChange: (view: DashboardView) => void;
}

/**
 * Toolbar "View:" segmented control. Renders nothing for roles that may not
 * switch (the page still shows their role-default view).
 */
export default function DashboardViewSelector({ view, canSwitch, onChange }: Props) {
  if (!canSwitch) return null;
  return (
    <div className="spm-view-seg" role="group" aria-label="Dashboard view">
      <span className="spm-view-seg-label">View:</span>
      {DASHBOARD_VIEWS.map((v) => (
        <button
          key={v}
          type="button"
          className={`spm-view-seg-btn ${v === view ? 'on' : ''}`.trim()}
          aria-pressed={v === view}
          onClick={() => onChange(v)}
        >
          {DASHBOARD_VIEW_LABELS[v]}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/dashboard/__tests__/DashboardViewSelector.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/dashboard/DashboardViewSelector.tsx client/src/pages/dashboard/__tests__/DashboardViewSelector.test.tsx
git commit -m "feat(dashboard): DashboardViewSelector toolbar segmented control"
```

---

## Task 4: Spillman `.dashboard-page` skin + chrome CSS

**Files:**
- Modify: `client/src/styles/spillman.css` (append at end)

This reuses the existing `--spm-*` variables (already defined in `theme-palettes.css`, already day/night aware) exactly like the `.records-page` block earlier in the same file.

- [ ] **Step 1: Append the skin layer**

Add to the END of `client/src/styles/spillman.css`:

```css
/* ╔══════════════════════════════════════════════════════════╗
   ║  Spillman Dashboard screen skin (.dashboard-page)         ║
   ║  Reuses --spm-* day/night vars, same technique as Records ║
   ╚══════════════════════════════════════════════════════════╝ */
.dashboard-page { background: var(--spm-form); color: var(--spm-text); }

/* Recolor the existing token-based surfaces wholesale */
.dashboard-page [class*="bg-surface-base"],
.dashboard-page [class*="bg-surface-deep"],
.dashboard-page [class*="bg-surface-sunken"],
.dashboard-page [class*="bg-rmpg-9"] { background-color: var(--spm-form) !important; }
.dashboard-page [class*="bg-surface-raised"],
.dashboard-page [class*="bg-surface-overlay"],
.dashboard-page [class*="bg-rmpg-8"],
.dashboard-page [class*="bg-rmpg-7"] { background-color: var(--spm-field) !important; }
.dashboard-page [class*="border-rmpg-"] { border-color: var(--spm-border) !important; }
.dashboard-page .text-white { color: var(--spm-text) !important; }
.dashboard-page [class*="text-rmpg-3"],
.dashboard-page [class*="text-rmpg-4"],
.dashboard-page [class*="text-rmpg-5"] { color: var(--spm-text-muted) !important; }
.dashboard-page [class*="text-brand-4"],
.dashboard-page [class*="text-brand-5"] { color: var(--spm-accent) !important; }

/* ── Screen title bar ── */
.dashboard-page .spm-screen-title {
  background: linear-gradient(#5a7ea6, #2e4a66);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
  padding: 4px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #2e4a66;
}

/* ── Screen toolbar ── */
.dashboard-page .spm-screen-toolbar {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  background: var(--spm-chrome);
  border: 1px solid var(--spm-border);
  border-top: none;
  padding: 4px 6px;
}
.dashboard-page .spm-toolbtn {
  background: var(--spm-toolbar);
  border: 1px solid var(--spm-border);
  color: var(--spm-text);
  font-size: 11px;
  padding: 3px 9px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.dashboard-page .spm-toolbtn:hover { background: var(--spm-toolbar-hover); }
.dashboard-page .spm-toolbtn:active { background: var(--spm-toolbar-active); }
.dashboard-page .spm-toolbtn.spacer { margin-left: auto; }

/* ── View segmented control ── */
.dashboard-page .spm-view-seg { display: inline-flex; align-items: center; gap: 4px; margin-right: 8px; }
.dashboard-page .spm-view-seg-label { font-size: 11px; color: var(--spm-text); }
.dashboard-page .spm-view-seg-btn {
  background: var(--spm-toolbar);
  border: 1px solid var(--spm-border);
  color: var(--spm-text);
  font-size: 11px;
  padding: 3px 11px;
  cursor: pointer;
}
.dashboard-page .spm-view-seg-btn:hover { background: var(--spm-toolbar-hover); }
.dashboard-page .spm-view-seg-btn.on {
  background: var(--spm-select);
  color: #ffffff;
  font-weight: 600;
  border-color: #2e4a66;
}

/* ── Group boxes ── */
.dashboard-page .spm-group {
  border: 1px solid var(--spm-border);
  background: var(--spm-field);
  display: flex;
  flex-direction: column;
}
.dashboard-page .spm-group-head {
  font-size: 11px;
  font-weight: 700;
  color: #ffffff;
  padding: 2px 7px;
  border-bottom: 1px solid var(--spm-border);
}
.dashboard-page .spm-group-head.tone-steel { background: linear-gradient(#5a7ea6, #2e4a66); }
.dashboard-page .spm-group-head.tone-red   { background: linear-gradient(#a23b3b, #6e1f1f); }
.dashboard-page .spm-group-head.tone-gold  { background: linear-gradient(#c08a2e, #8a5e15); }
.dashboard-page .spm-group-body { padding: 6px 7px; }
```

- [ ] **Step 2: Verify the stylesheet still compiles**

Run: `cd client && npx vite build`
Expected: build succeeds (CSS is valid; no token errors).

- [ ] **Step 3: Commit**

```bash
git add client/src/styles/spillman.css
git commit -m "style(dashboard): add .dashboard-page Spillman skin + chrome classes"
```

---

## Task 5: Wire view state + screen chrome into DashboardPage

This task adds the root class, view state, title bar, and toolbar. It does **not** yet gate the panels (Task 6).

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx`

- [ ] **Step 1: Add imports**

Near the existing imports (after the `import { useIsMobile }` line, ~line 26), add:

```tsx
import { useAuth } from '../context/AuthContext';
import SpmGroup from './dashboard/SpmGroup';
import DashboardViewSelector from './dashboard/DashboardViewSelector';
import {
  resolveDashboardView, canSwitchView, writeSavedView,
  VIEW_PANELS, toolbarActionsForView,
  type DashboardView, type PanelId, type ToolbarActionId,
} from './dashboard/dashboardViews';
```

- [ ] **Step 2: Add view state inside the component**

Immediately after the existing `const { addToast } = useToast();` line (~line 355), add:

```tsx
  const { user } = useAuth();
  const role = user?.role ?? '';
  const [view, setView] = useState<DashboardView>(() => resolveDashboardView(role));
  // Re-resolve when the role becomes available after async auth load.
  useEffect(() => { setView(resolveDashboardView(role)); }, [role]);
  const maySwitch = canSwitchView(role);
  const panels = VIEW_PANELS[view];
  const hasPanel = useCallback((id: PanelId) => panels.includes(id), [panels]);
  const handleViewChange = useCallback((v: DashboardView) => {
    writeSavedView(v);
    setView(v);
  }, []);
```

- [ ] **Step 3: Add a toolbar action dispatcher**

After `handleViewChange`, add (reuses existing handlers/navigate already present in the component):

```tsx
  const runToolbarAction = useCallback((id: ToolbarActionId) => {
    switch (id) {
      case 'newCall': setShowNewCallModal(true); break;
      case 'newIncident': setShowIncidentModal(true); break;
      case 'newCitation': navigate('/citations'); break;
      case 'startPatrol': navigate('/patrol'); break;
      case 'processServer': navigate('/serve'); break;
      case 'print': window.print(); break;
      case 'refresh': fetchDashboardData(); break;
    }
  }, [navigate, fetchDashboardData]);
```

- [ ] **Step 4: Add the root class**

Change the main container `<div>` (currently `className="p-4 space-y-4 animate-fade-in"` at ~line 595) to prefix `dashboard-page`:

```tsx
    <div className="dashboard-page p-4 space-y-4 animate-fade-in" role="main" aria-label="Command and Control Dashboard" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 1rem))' }}>
```

- [ ] **Step 5: Insert the screen title bar + toolbar**

Directly inside that `<div>`, BEFORE the existing "Portal Header" block, insert:

```tsx
      {/* Spillman screen title bar */}
      <div className="spm-screen-title">
        <span className={`led-dot ${stats.active_calls > 0 ? 'led-green animate-led-pulse' : 'led-green'}`} aria-hidden="true" />
        Command &amp; Control — Operational
      </div>

      {/* Spillman screen toolbar: View selector + raised action buttons */}
      <div className="spm-screen-toolbar" role="toolbar" aria-label="Dashboard actions">
        <DashboardViewSelector view={view} canSwitch={maySwitch} onChange={handleViewChange} />
        {toolbarActionsForView(view).map((a) => (
          <button
            key={a.id}
            type="button"
            className={`spm-toolbtn ${a.id === 'print' ? 'spacer' : ''}`.trim()}
            onClick={() => runToolbarAction(a.id)}
          >
            {a.label}
          </button>
        ))}
      </div>
```

- [ ] **Step 6: Remove the standalone Quick Actions panel**

Delete the entire `{/* Quick Action Buttons */}` panel block (the `<div className="panel-beveled ...">` containing `<PanelTitleBar title="QUICK ACTIONS" .../>` and its button grid, ~lines 901–932). Its actions now live in the toolbar. Leave the Shift Status and Weather panels in place (Task 6 wraps them).

- [ ] **Step 7: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS. (If `tsc` flags an unused `hasPanel`/`SpmGroup`/`PanelId` import, that's expected until Task 6 — proceed; Task 6 consumes them. If you prefer a clean intermediate, you may temporarily reference them, but it's acceptable to complete Task 6 before the final typecheck gate.)

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/DashboardPage.tsx
git commit -m "feat(dashboard): Spillman screen title bar + toolbar with view switcher"
```

---

## Task 6: Wrap widgets in group boxes and gate by panel id

Map each existing widget block to a `PanelId`, wrap it in `<SpmGroup>`, and gate it with `hasPanel(...)`. Locate blocks by their existing JSX comment banners (the file uses them throughout). Do these one block at a time, typechecking after each couple.

**Panel → existing block mapping:**

| PanelId | Existing block (by comment / content) | Wrap title / tone |
|---|---|---|
| `activeCalls` | "Stats Cards Row" (primary 4) + "Priority Breakdown" + the calls-by-hour chart block | `Active Calls — Priority & Volume` / steel |
| `statusSummary` | "Secondary Stats Row" (warrants / warrant poll / pending serve / open cases / total persons) | `Status Summary` / steel |
| `shiftStatus` | the Shift Countdown panel (inside "Shift Countdown + Weather + Quick Actions Row") | `Shift Status` / steel |
| `weather` | the Weather panel in that same row | `Weather — Salt Lake City` / steel |
| `activeBolos` | "BOLO Ticker" block | `Active BOLOs` / **red** |
| `alertsReminders` | "Shift-Aware Stats + Court Dates + Expiring Certs Row" | `Alerts & Reminders` / **gold** |
| `recentActivity` | the Activity feed block (`<ActivityFeed .../>`) | `Recent Activity` / steel |
| `officerActivity` | the officer-activity comparison block | `Officer Activity` / steel |
| `activeUnits` | the units/on-duty block (officers on duty) | `Active Units` / steel |
| `callsNearMe` | Patrol-only: render the same active-calls list data (unscoped fallback) | `Calls Near Me` / steel |
| `myActivity` | Patrol-only: render `<ActivityFeed/>` (same data) | `My Activity` / steel |

Note: `callsNearMe` / `myActivity` reuse already-loaded data; if `user?.id` is available you may filter client-side, otherwise show the unscoped list (spec fallback). A minimal first implementation may render the same content as `activeCalls`/`recentActivity` — acceptable per spec (no new endpoint).

- [ ] **Step 1: Wrap + gate each block**

For every block above, apply this pattern (example for BOLOs):

```tsx
{hasPanel('activeBolos') && bolos.length > 0 && (
  <SpmGroup title="Active BOLOs" tone="red">
    {/* ...existing BOLO ticker inner JSX (minus its old outer wrapper styling)... */}
  </SpmGroup>
)}
```

For panels that previously had a `PanelTitleBar` (Shift Status, Weather), remove the inner `<PanelTitleBar .../>` (the `SpmGroup` header replaces it) and drop the old `panel-beveled` outer wrapper, keeping the inner content.

Gate the primary stats / priority / chart cluster as one `activeCalls` group:

```tsx
{hasPanel('activeCalls') && (
  <SpmGroup title="Active Calls — Priority & Volume">
    {/* primary stats grid + priority breakdown + calls-by-hour chart */}
  </SpmGroup>
)}
```

Gate the secondary stats row as `statusSummary`:

```tsx
{hasPanel('statusSummary') && (
  <SpmGroup title="Status Summary">
    {/* secondary stats grid */}
  </SpmGroup>
)}
```

Add the two patrol-only panels (place near the BOLO/activity area):

```tsx
{hasPanel('callsNearMe') && (
  <SpmGroup title="Calls Near Me">
    {/* reuse the active-calls list rendering (unscoped fallback) */}
  </SpmGroup>
)}
{hasPanel('myActivity') && (
  <SpmGroup title="My Activity">
    <ActivityFeed activities={activities} />
  </SpmGroup>
)}
```

(Match `ActivityFeed`'s actual props to its existing usage in the file.)

- [ ] **Step 2: Confirm no dead references**

Ensure `SpmGroup`, `hasPanel`, `PanelId` are all now used (resolves any Task 5 unused-import note). Remove the now-unused `PanelTitleBar` import only if no longer referenced anywhere in the file (grep first).

Run: `cd client && grep -n "PanelTitleBar" src/pages/DashboardPage.tsx`
If zero matches remain, delete its import line.

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS, no unused-symbol errors.

- [ ] **Step 4: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: PASS (new dashboard tests + all existing).

- [ ] **Step 5: Build**

Run: `cd client && npx vite build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/DashboardPage.tsx
git commit -m "feat(dashboard): group-box panels gated by role view config"
```

---

## Task 7: Service worker cache bump + final verification

**Files:**
- Modify: `client/public/sw.js`

- [ ] **Step 1: Bump CACHE_NAME**

Find `CACHE_NAME` in `client/public/sw.js` and increment its version number (e.g. `...-v972` → `...-v973`). Match the existing naming exactly.

Run: `cd client && grep -n "CACHE_NAME" public/sw.js`

- [ ] **Step 2: Final gates (mirror CI)**

Run each and confirm PASS:
```bash
cd client && npx tsc --noEmit
cd client && npx vitest run
cd client && npx vite build
```

- [ ] **Step 3: Manual visual check (browser)**

Because the WAF blocks headless curl, eyeball it: `cd client && npm run dev`, open the dashboard, and confirm:
- Steel-blue group boxes + screen toolbar render; day vs night palette flips with the theme toggle.
- As `admin`: the `View:` selector shows and switching Dispatch/Patrol/Admin changes the visible panels; reload preserves the last pick.
- As `dispatcher`/`officer` (or temporarily hardcode role to test): no selector, role-default panels only.

- [ ] **Step 4: Commit**

```bash
git add client/public/sw.js
git commit -m "chore(dashboard): bump SW cache for Spillman dashboard screen"
```

---

## Self-Review notes

- **Spec coverage:** fidelity/Option-B (Tasks 4–6), day/night palette via `--spm-*` (Task 4), screen title+toolbar (Task 5), role configs + matrix (Task 1 `VIEW_PANELS`, Task 6 gating), switcher admin-only + per-user persistence + fallback role (Task 1 + Task 3 + Task 5), Quick Actions → toolbar (Task 5 step 6), patrol near-me fallback (Task 6), no API/DB (whole plan), SW bump (Task 7). All covered.
- **Type consistency:** `DashboardView`, `PanelId`, `ToolbarActionId`, `VIEW_PANELS`, `resolveDashboardView`, `canSwitchView`, `writeSavedView`, `toolbarActionsForView` are defined in Task 1 and consumed with identical names in Tasks 3/5/6.
- **Known intermediate state:** Task 5 may leave `SpmGroup`/`hasPanel` imported-but-unused until Task 6; called out explicitly so it isn't mistaken for an error. Tasks 5 and 6 both touch `DashboardPage.tsx` and should be executed in order by the same worker (or sequential subagents).
