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
