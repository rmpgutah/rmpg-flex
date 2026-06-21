import { describe, it, expect } from 'vitest';
import {
  FleetioError,
  FleetioConfigError,
  FleetioTimeoutError,
  FleetioHttpError,
  FleetioRateLimitError,
} from '../src/utils/fleetio/errors';

describe('Fleet.io error classes', () => {
  it('FleetioError carries message + optional status/detail', () => {
    const e = new FleetioError('boom', { status: 500, detail: { foo: 1 } });
    expect(e.message).toBe('boom');
    expect(e.status).toBe(500);
    expect(e.detail).toEqual({ foo: 1 });
    expect(e.name).toBe('FleetioError');
    expect(e instanceof Error).toBe(true);
  });

  it('subclasses extend FleetioError and Error', () => {
    expect(new FleetioConfigError('no key') instanceof FleetioError).toBe(true);
    expect(new FleetioTimeoutError('slow') instanceof FleetioError).toBe(true);
    expect(new FleetioHttpError('bad', 400) instanceof FleetioError).toBe(true);
    expect(new FleetioRateLimitError(30) instanceof FleetioError).toBe(true);
  });

  it('FleetioConfigError defaults to no status', () => {
    const e = new FleetioConfigError('missing FLEETIO_API_KEY');
    expect(e.status).toBeUndefined();
    expect(e.name).toBe('FleetioConfigError');
  });

  it('FleetioHttpError carries the status as a number', () => {
    const e = new FleetioHttpError('not found', 404, { error: 'gone' });
    expect(e.status).toBe(404);
    expect(e.detail).toEqual({ error: 'gone' });
    expect(e.name).toBe('FleetioHttpError');
  });

  it('FleetioRateLimitError stores retryAfterSeconds', () => {
    const e = new FleetioRateLimitError(60);
    expect(e.status).toBe(429);
    expect(e.retryAfterSeconds).toBe(60);
    expect(e.name).toBe('FleetioRateLimitError');
  });
});
