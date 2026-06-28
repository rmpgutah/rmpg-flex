import { describe, it, expect } from 'vitest';
import type { FleetV2AuditDetails, FleetV2ViewDetails, FleetV2ApiErrorDetails } from '../src/types/fleetV2Audit';
import { isViewDetails, isApiErrorDetails } from '../src/types/fleetV2Audit';

describe('FleetV2AuditDetails discriminated union', () => {
  it('isViewDetails narrows correctly', () => {
    const v: FleetV2AuditDetails = { kind: 'FLEET_V2_VIEW', route: '/fleet/v2', viewport_width: 1440 };
    expect(isViewDetails(v)).toBe(true);
    if (isViewDetails(v)) {
      const _r: string = v.route;
      const _w: number = v.viewport_width;
      expect(_r).toBe('/fleet/v2');
      expect(_w).toBe(1440);
    }
  });

  it('isApiErrorDetails narrows correctly', () => {
    const e: FleetV2AuditDetails = {
      kind: 'FLEET_V2_API_ERROR',
      endpoint: '/api/fleet',
      status: 500,
      message: 'boom',
    };
    expect(isApiErrorDetails(e)).toBe(true);
    if (isApiErrorDetails(e)) {
      const _s: number = e.status;
      expect(_s).toBe(500);
    }
  });

  it('isViewDetails rejects an error payload', () => {
    const e: FleetV2AuditDetails = { kind: 'FLEET_V2_API_ERROR', endpoint: '/x', status: 0, message: '' };
    expect(isViewDetails(e)).toBe(false);
  });

  it('FleetV2ViewDetails and FleetV2ApiErrorDetails are separate concrete types', () => {
    const v: FleetV2ViewDetails = { kind: 'FLEET_V2_VIEW', route: '/x', viewport_width: 100 };
    const e: FleetV2ApiErrorDetails = { kind: 'FLEET_V2_API_ERROR', endpoint: '/y', status: 1, message: 'a' };
    expect(v.kind).not.toBe(e.kind);
  });
});
