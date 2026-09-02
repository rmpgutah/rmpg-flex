import { describe, it, expect } from 'vitest';
import { NAV_CATEGORIES, CLIENT_VIEWER_BLOCKED, CONTRACT_MANAGER_BLOCKED } from './navCatalog';

describe('navCatalog', () => {
  it('has at least one category with at least one function', () => {
    expect(NAV_CATEGORIES.length).toBeGreaterThan(0);
    const totalFunctions = NAV_CATEGORIES.reduce((sum, cat) => sum + cat.functions.length, 0);
    expect(totalFunctions).toBeGreaterThan(50);
  });

  it('has no duplicate paths across the whole catalog', () => {
    const paths = NAV_CATEGORIES.flatMap(cat => cat.functions.map(fn => fn.path));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('blocks /admin for both client_viewer and contract_manager', () => {
    expect(CLIENT_VIEWER_BLOCKED.has('/admin')).toBe(true);
    expect(CONTRACT_MANAGER_BLOCKED.has('/admin')).toBe(true);
    expect(CLIENT_VIEWER_BLOCKED.has('/desktop-company-browser')).toBe(true);
    expect(CLIENT_VIEWER_BLOCKED.has('/dialer-connect')).toBe(true);
    expect(CONTRACT_MANAGER_BLOCKED.has('/desktop-company-browser')).toBe(true);
  });
});
