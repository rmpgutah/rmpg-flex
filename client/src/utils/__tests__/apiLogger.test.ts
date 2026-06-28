import { test, expect, beforeEach, afterEach, vi } from 'vitest';

// Import AFTER setting up mocks
let logEntry: any;
let getLog: any;
let clearLog: any;
let MAX_ENTRIES: number;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../apiLogger');
  logEntry = mod.logEntry;
  getLog = mod.getLog;
  clearLog = mod.clearLog;
  MAX_ENTRIES = mod.MAX_ENTRIES;
});

afterEach(() => clearLog?.());

test('logEntry adds to log', () => {
  logEntry({ method: 'GET', path: '/api/test', status: 200, latencyMs: 50 });
  const log = getLog();
  expect(log).toHaveLength(1);
  expect(log[0].path).toBe('/api/test');
});

test('log is capped at MAX_ENTRIES', () => {
  for (let i = 0; i < MAX_ENTRIES + 10; i++) {
    logEntry({ method: 'GET', path: `/api/${i}`, status: 200, latencyMs: 1 });
  }
  expect(getLog()).toHaveLength(MAX_ENTRIES);
});

test('clearLog empties the log', () => {
  logEntry({ method: 'GET', path: '/api/x', status: 200, latencyMs: 1 });
  clearLog();
  expect(getLog()).toHaveLength(0);
});

test('getLog filters by path prefix', () => {
  logEntry({ method: 'GET', path: '/api/map/foo', status: 200, latencyMs: 1 });
  logEntry({ method: 'GET', path: '/api/dispatch/bar', status: 200, latencyMs: 1 });
  expect(getLog('/api/map')).toHaveLength(1);
});
