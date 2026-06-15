# Spillman Flex Dashboard Screen — Design

**Date:** 2026-06-15
**Status:** Approved (brainstorming) → ready for implementation plan
**Scope:** Client only (`client/src/pages/DashboardPage.tsx` + `client/src/styles/spillman.css` + small new components). No Worker/API/DB changes.

## Goal

Reformat the Command & Control Dashboard so it reads like an authentic **Spillman Flex (Motorola Solutions)** desktop screen, and add **role-based view configs** (Dispatch / Patrol Officer / Admin) with a toolbar switcher.

This is **presentation + client-side view-state only**. All existing data fetching, endpoints, and widget logic are preserved; only layout, styling, and *which panels render* change.

## Decisions (locked in brainstorming)

1. **Fidelity — Option B, "Full Spillman desktop recreation"**, but confined to the page interior. The global Spillman chrome already exists and is **not touched**: `client/src/components/MenuBar.tsx` (File | View | Tools | Help), `client/src/components/StatusBar.tsx` (bottom bar), and the F1–F12 module ribbon in `Layout.tsx`.
2. **Palette — Option 3, day/night aware.** Light battleship-grey by day (06:00–18:00), dark steel-blue by night. Reuses the existing `--spm-*` token engine from the Records skin (`spillman.css` + `theme-palettes.css`). No new theme logic. Brand gold stays `#d4a017`.
3. **Layout** — screen title bar + screen toolbar + a titled steel-blue group-box panel grid (some panels rendered as dense list grids, not big metric tiles).
4. **Role configs** — Dispatch / Patrol Officer / Admin, selected by the logged-in user's role.
5. **Switcher** — only `admin` / `manager` / `supervisor` may switch views; `dispatcher` and `officer` are locked to their role default. A manual choice is remembered per user in `localStorage`.

## Architecture

Follow the **Records Spillman skin precedent** exactly:

- A new scoped CSS root class **`.dashboard-page`** is added to the `DashboardPage` root `<div>`.
- New rules in `client/src/styles/spillman.css` (or a sibling `spillman-dashboard.css` imported the same way) map the generic Tailwind tokens (`bg-surface-base`, `text-rmpg-*`, `border-rmpg-*`, etc.) onto `--spm-*` Spillman surfaces under `.dashboard-page`, using the same **substring attribute selector** technique already in `spillman.css`. This recolors the existing markup wholesale with zero per-element class churn.
- Genuinely-new Spillman chrome (screen title bar, screen toolbar, group-box headers) is added as dedicated elements/classes (`.spm-screen-title`, `.spm-screen-toolbar`, reuse `.collapsible-section` group-box styling or add `.spm-group` / `.spm-group-head`).
- The `--spm-*` variables already invert between night/day via the global switcher, so day/night is free.

### View config model (client-side, no backend)

A small pure module — **`client/src/pages/dashboard/dashboardViews.ts`** — declares the configs and resolution rules so they are unit-testable in isolation:

```ts
export type DashboardView = 'dispatch' | 'patrol' | 'admin';
export type PanelId =
  | 'activeCalls' | 'recentActivity' | 'activeUnits' | 'activeBolos'
  | 'statusSummary' | 'shiftStatus' | 'weather' | 'alertsReminders'
  | 'officerActivity' | 'callsNearMe' | 'myActivity';

// Which panels each view renders, in order.
export const VIEW_PANELS: Record<DashboardView, PanelId[]> = { ... };

// Default view for a role; unknown/non-operational roles fall back to 'dispatch'.
export function defaultViewForRole(role: string): DashboardView;

// Roles allowed to switch views.
export function canSwitchView(role: string): boolean; // admin|manager|supervisor

// Persistence helpers (localStorage key 'rmpg_dashboard_view').
export function readSavedView(): DashboardView | null;
export function writeSavedView(v: DashboardView): void;

// Effective view = (saved view if allowed to switch) else role default.
export function resolveDashboardView(role: string): DashboardView;
```

The page reads the current user (already available via the app's auth/user context), computes the effective view once, holds it in `useState`, and renders only the panels in `VIEW_PANELS[view]`. The toolbar `View:` selector calls `writeSavedView` + `setView` (rendered read-only/hidden when `!canSwitchView(role)`).

### Panel inventory → existing widget mapping

Each panel wraps **existing** widget markup/data — nothing is rebuilt:

| PanelId | Source in current `DashboardPage.tsx` |
|---|---|
| `activeCalls` | primary stats + priority breakdown + calls-by-hour chart |
| `activeUnits` | units available / officers-on-duty (officer activity list, on-duty subset) |
| `activeBolos` | existing BOLO ticker |
| `recentActivity` | `ActivityFeed` component |
| `statusSummary` | secondary stats row (warrants, warrant poll, pending serve, open cases, persons, incidents) |
| `shiftStatus` | existing shift countdown widget |
| `weather` | existing weather widget |
| `alertsReminders` | expiring certs + court dates + overdue reports widgets |
| `officerActivity` | officer activity comparison |
| `callsNearMe` / `myActivity` | Patrol view: filtered presentations of existing calls/activity data (no new endpoint; reuse loaded data, scope client-side by current officer where data allows; fall back to the unscoped list if no officer id) |

### View → panel matrix

- **Dispatch** (default: `dispatcher`): activeCalls, activeUnits, activeBolos, recentActivity, shiftStatus, weather.
- **Patrol Officer** (default: `officer`): shiftStatus, activeBolos, callsNearMe, myActivity, weather. Toolbar action order leads with Start Patrol / New Citation / Process Server.
- **Admin / Command** (default: `admin`, `manager`, `supervisor`): statusSummary, activeCalls, activeUnits, activeBolos, recentActivity, officerActivity, alertsReminders, shiftStatus, weather (the full screen).
- **Fallback** (any other role — contract_manager, client_viewer, human_resources): Dispatch view, locked.

## Toolbar

A `.spm-screen-toolbar` row directly under the screen title bar:
- **Left:** `View:` label + segmented selector (Dispatch | Patrol | Admin). Active segment = steel-blue fill. Hidden/disabled for non-switching roles.
- **Right:** raised Spillman action buttons — New Call, New Incident, New Citation, Start Patrol, Process Server, Print, Refresh. These reuse the existing Quick Actions handlers (modals/navigation); the standalone Quick Actions panel is removed.

## Error handling / edge cases

- Unknown role → `defaultViewForRole` returns `'dispatch'`.
- Corrupt/invalid `localStorage` value → ignored, treated as null (fall back to role default).
- A non-switching role with a stale saved view → ignored; `resolveDashboardView` only honors a saved view when `canSwitchView` is true.
- Patrol view with no current-officer id → `callsNearMe`/`myActivity` show the unscoped lists rather than empty.
- Loading skeleton and error banner behavior are preserved.

## Testing

- Unit-test the pure module `dashboardViews.ts` with vitest (`client/src/pages/dashboard/__tests__/dashboardViews.test.ts`): role→default mapping (incl. fallback), `canSwitchView` allow-list, `resolveDashboardView` precedence (saved-but-not-allowed ignored; saved-and-allowed honored), persistence round-trip, invalid-storage handling.
- Existing `client-typecheck`, `client-tests`, `client-build` CI gates must pass.
- No Worker tests (presentation change).

## Non-goals / YAGNI

- No server-persisted user dashboard preferences (localStorage only).
- No drag-and-drop / user-customizable panel arrangement (fixed per view).
- No changes to `MenuBar`, `StatusBar`, the module ribbon, or any data endpoint.
- No new migration, no D1 changes.

## Ship checklist

- Bump `CACHE_NAME` in `client/public/sw.js`.
- Ship via feature branch → PR (per project flow), not direct push to main.
