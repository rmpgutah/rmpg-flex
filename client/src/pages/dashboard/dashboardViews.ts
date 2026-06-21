// Pure, framework-free view-config for the Spillman dashboard screen.
// No React, no DOM beyond localStorage — keeps the rules unit-testable.

export type DashboardView = 'dispatch' | 'patrol' | 'admin';

export type PanelId =
  | 'activeCalls' | 'recentActivity' | 'activeUnits' | 'activeBolos'
  | 'statusSummary' | 'shiftStatus' | 'weather' | 'alertsReminders'
  | 'officerActivity' | 'callsNearMe' | 'myActivity'
  | 'callAnalytics' | 'adminExtras' | 'serveSchedule';

export const PANEL_IDS: readonly PanelId[] = [
  'activeCalls', 'recentActivity', 'activeUnits', 'activeBolos',
  'statusSummary', 'shiftStatus', 'weather', 'alertsReminders',
  'officerActivity', 'callsNearMe', 'myActivity',
  'callAnalytics', 'adminExtras', 'serveSchedule',
];

export const DASHBOARD_VIEWS: readonly DashboardView[] = ['dispatch', 'patrol', 'admin'];

export const DASHBOARD_VIEW_LABELS: Record<DashboardView, string> = {
  dispatch: 'Dispatch',
  patrol: 'Patrol',
  admin: 'Admin',
};

// Which panels each view renders, in display order.
export const VIEW_PANELS: Record<DashboardView, PanelId[]> = {
  dispatch: ['activeCalls', 'callAnalytics', 'activeUnits', 'activeBolos', 'recentActivity', 'serveSchedule', 'shiftStatus', 'weather'],
  patrol: ['shiftStatus', 'activeBolos', 'callsNearMe', 'myActivity', 'weather'],
  admin: [
    'statusSummary', 'activeCalls', 'callAnalytics', 'activeUnits', 'activeBolos',
    'recentActivity', 'serveSchedule', 'adminExtras', 'officerActivity', 'alertsReminders', 'shiftStatus', 'weather',
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
