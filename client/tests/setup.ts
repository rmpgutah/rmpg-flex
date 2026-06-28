import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';
// Match production: pin all date/time display to Mountain Time so tests
// behave identically regardless of the CI runner's timezone (CI is UTC).
import '../src/utils/enforceMountainTime';

// Node 25 injects an experimental bare `localStorage` global that shadows
// jsdom's Storage instance with a plain empty object (no getItem/setItem/clear).
// Replace both the global and window bindings with a Map-backed Storage shim
// so tests can use the standard Web Storage API.
(() => {
  const needsShim = () => {
    const ls = (globalThis as any).localStorage;
    return !ls || typeof ls.setItem !== 'function' || typeof ls.clear !== 'function';
  };
  if (!needsShim()) return;
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => { store.delete(k); },
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true, writable: true });
  if (typeof (globalThis as any).window !== 'undefined') {
    Object.defineProperty((globalThis as any).window, 'localStorage', { value: shim, configurable: true, writable: true });
  }
})();

// Clear localStorage before each test to prevent state leakage
beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // jsdom may not support localStorage.clear in all versions
  }
});
