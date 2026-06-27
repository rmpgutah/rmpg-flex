// Unit tests for the structured logger (src/utils/logger.ts).
// Runs in Node environment (vitest.config.ts) — tests pure functions
// and the JSON output format.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateTraceId, log } from '../src/utils/logger';

describe('generateTraceId', () => {
  it('produces a 16-character hex string', () => {
    const id = generateTraceId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces unique values on successive calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
    expect(ids.size).toBe(100);
  });
});

describe('log (structured JSON output)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('log.info writes a JSON line with level info', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.info('test message');
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0]);
    expect(line.l).toBe('info');
    expect(line.msg).toBe('test message');
    expect(line.s).toBe('rmpg-flex-api');
    expect(line.t).toBeDefined();
    expect(() => new Date(line.t)).not.toThrow();
  });

  it('log.error uses console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    log.error('error message');
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0]);
    expect(line.l).toBe('error');
    expect(line.msg).toBe('error message');
  });

  it('log.warn uses console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log.warn('warn message');
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0]);
    expect(line.l).toBe('warn');
  });

  it('log.debug uses console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.debug('debug message');
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0]);
    expect(line.l).toBe('debug');
  });

  it('includes context object when provided', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.info('with context', { userId: 42, action: 'test' });
    const line = JSON.parse(spy.mock.calls[0][0]);
    expect(line.ctx).toBeDefined();
    expect(line.ctx.userId).toBe(42);
    expect(line.ctx.action).toBe('test');
  });

  it('includes error details when Error provided', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('something broke');
    log.error('failed', {}, err);
    const line = JSON.parse(spy.mock.calls[0][0]);
    expect(line.err).toBeDefined();
    expect(line.err.message).toBe('something broke');
    expect(line.err.name).toBe('Error');
  });

  it('includes error message for non-Error thrown values', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    log.error('string error', {}, 'just a string');
    const line = JSON.parse(spy.mock.calls[0][0]);
    expect(line.err.message).toBe('just a string');
  });

  it('withTrace creates a child logger with fixed trace ID', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const child = log.withTrace('abc123def4567890');
    child.info('traced message');
    const line = JSON.parse(spy.mock.calls[0][0]);
    expect(line.trace).toBe('abc123def4567890');
  });

  it('withCtx creates a child logger with merged context', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const child = log.withCtx({ module: 'test' });
    child.info('merge test', { extra: 'value' });
    const line = JSON.parse(spy.mock.calls[0][0]);
    expect(line.ctx.module).toBe('test');
    expect(line.ctx.extra).toBe('value');
  });

  it('withCtx base context does not leak between calls', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const child = log.withCtx({ base: 'A' });
    child.info('first', { first: 1 });
    child.info('second', { second: 2 });
    const lines = spy.mock.calls.map((c) => JSON.parse(c[0]));
    expect(lines[0].ctx.base).toBe('A');
    expect(lines[0].ctx.first).toBe(1);
    expect(lines[1].ctx.base).toBe('A');
    expect(lines[1].ctx.second).toBe(2);
    expect(lines[1].ctx.first).toBeUndefined();
  });
});
