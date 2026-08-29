import { describe, it, expect } from 'vitest';
import { NAV_CATEGORIES } from './navCatalog';

const ALL = NAV_CATEGORIES.flatMap(cat => cat.functions);

describe('navCatalog — windowability metadata', () => {
  it('every function is either windowable (no notWindowable) or has a non-empty exclusion reason', () => {
    for (const fn of ALL) {
      if (fn.notWindowable !== undefined) {
        expect(typeof fn.notWindowable).toBe('string');
        expect(fn.notWindowable.length).toBeGreaterThan(0);
      }
    }
  });

  it('every windowSize is a positive width/height pair', () => {
    for (const fn of ALL) {
      if (fn.windowSize) {
        expect(fn.windowSize.width).toBeGreaterThan(0);
        expect(fn.windowSize.height).toBeGreaterThan(0);
      }
    }
  });

  it('/navigation is excluded — full-screen kiosk drive HUD', () => {
    const fn = ALL.find(f => f.path === '/navigation');
    expect(fn?.notWindowable).toBeTruthy();
  });

  it('/serve is excluded — mid-workflow window.location.href navigation to /pdf-editor', () => {
    const fn = ALL.find(f => f.path === '/serve');
    expect(fn?.notWindowable).toBeTruthy();
  });

  it('/dialer-connect is excluded — persistent CAD-shell Dial Connect iframe', () => {
    const fn = ALL.find(f => f.path === '/dialer-connect');
    expect(fn?.notWindowable).toBeTruthy();
  });

  it('the old broken "/national-warrants" path no longer exists — fixed to /national-warrant-search', () => {
    expect(ALL.some(f => f.path === '/national-warrants')).toBe(false);
    const fixed = ALL.find(f => f.path === '/national-warrant-search');
    expect(fixed?.windowSize).toEqual({ width: 1180, height: 860 });
  });

  it('/law-book is reachable from the catalog and windowable', () => {
    const fn = ALL.find(f => f.path === '/law-book');
    expect(fn).toBeDefined();
    expect(fn?.notWindowable).toBeUndefined();
    expect(fn?.windowSize).toEqual({ width: 1100, height: 820 });
  });

  it('no duplicate paths exist in the catalog', () => {
    const paths = ALL.map(f => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
