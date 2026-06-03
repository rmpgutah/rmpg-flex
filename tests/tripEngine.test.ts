import { describe, it, expect } from 'vitest';
import { decide, type ActiveTrip, type EngineCtx } from '../src/utils/tripEngine';

const baseCtx = (over: Partial<EngineCtx> = {}): EngineCtx => ({
  now: 1_000_000, curLat: 40.76, curLng: -111.89, prevLat: 40.76, prevLng: -111.89,
  stationaryRadiusM: 30, idleMs: 300_000, staleMs: 900_000, ...over,
});

const patrol = (over: Partial<ActiveTrip> = {}): ActiveTrip => ({
  id: 7, trip_type: 'patrol', call_id: null,
  anchor_lat: 40.76, anchor_lng: -111.89, last_move_at: 1_000_000, last_fix_ts: 999_000, ...over,
});

describe('tripEngine.decide — status events', () => {
  it('enroute with no active trip opens a CALL_RESPONSE', () => {
    const d = decide({ kind: 'status', status: 'enroute' }, null,
      baseCtx({ callId: 42, callNumber: '24-0613', callType: 'alarm' }));
    expect(d.open?.type).toBe('call_response');
    expect(d.open?.callId).toBe(42);
    expect(d.close).toBeUndefined();
  });

  it('enroute while a PATROL is active closes patrol then opens CALL_RESPONSE chained', () => {
    const d = decide({ kind: 'status', status: 'enroute' }, patrol(),
      baseCtx({ callId: 42, callNumber: '24-0613' }));
    expect(d.close?.tripId).toBe(7);
    expect(d.close?.reason).toBe('redispatch');
    expect(d.open?.type).toBe('call_response');
    expect(d.open?.prevTripId).toBe(7);
  });

  it('onscene closes the active CALL_RESPONSE with reason onscene', () => {
    const active: ActiveTrip = { ...patrol(), trip_type: 'call_response', call_id: 42 };
    const d = decide({ kind: 'status', status: 'onscene' }, active, baseCtx());
    expect(d.close?.reason).toBe('onscene');
    expect(d.open).toBeUndefined();
  });

  it('cleared closes an active response with reason cleared', () => {
    const active: ActiveTrip = { ...patrol(), trip_type: 'call_response', call_id: 42 };
    const d = decide({ kind: 'status', status: 'cleared' }, active, baseCtx());
    expect(d.close?.reason).toBe('cleared');
  });

  it('off_duty closes any active trip', () => {
    const d = decide({ kind: 'status', status: 'off_duty' }, patrol(), baseCtx());
    expect(d.close?.reason).toBe('off_duty');
  });
});

describe('tripEngine.decide — gps events', () => {
  it('moving with no active trip opens a PATROL', () => {
    const d = decide(
      { kind: 'gps', fix: { lat: 40.770, lng: -111.89, speed: 10, heading: null, ts: 1_000_000 } },
      null, baseCtx({ prevLat: 40.760, prevLng: -111.89 }),
    );
    expect(d.open?.type).toBe('patrol');
  });

  it('stationary with no active trip opens nothing', () => {
    const d = decide(
      { kind: 'gps', fix: { lat: 40.7600, lng: -111.8900, speed: 0, heading: null, ts: 1_000_000 } },
      null, baseCtx({ prevLat: 40.7600, prevLng: -111.8900 }),
    );
    expect(d.open).toBeUndefined();
  });

  it('active trip + fresh fix appends', () => {
    const d = decide(
      { kind: 'gps', fix: { lat: 40.7601, lng: -111.8900, speed: 8, heading: null, ts: 1_001_000 } },
      patrol(), baseCtx({ now: 1_001_000 }),
    );
    expect(d.append?.tripId).toBe(7);
  });

  it('idempotency: a fix at/older than last_fix_ts is dropped', () => {
    const d = decide(
      { kind: 'gps', fix: { lat: 40.7601, lng: -111.89, speed: 8, heading: null, ts: 999_000 } },
      patrol({ last_fix_ts: 999_000 }), baseCtx(),
    );
    expect(d.append).toBeUndefined();
    expect(d.close).toBeUndefined();
  });

  it('PATROL stationary past idleMs closes with end_time = arrival (last_move_at)', () => {
    const d = decide(
      { kind: 'gps', fix: { lat: 40.7600, lng: -111.8900, speed: 0, heading: null, ts: 1_400_000 } },
      patrol({ last_move_at: 1_000_000 }),
      baseCtx({ now: 1_400_000 }),
    );
    expect(d.close?.reason).toBe('idle_timeout');
    expect(d.close?.endTs).toBe(1_000_000);
  });

  it('PATROL moving beyond the radius updates the anchor', () => {
    const d = decide(
      { kind: 'gps', fix: { lat: 40.770, lng: -111.89, speed: 12, heading: null, ts: 1_001_000 } },
      patrol(), baseCtx({ now: 1_001_000 }),
    );
    expect(d.updateAnchor).toBeTruthy();
    expect(d.updateAnchor?.lat).toBeCloseTo(40.770);
  });
});

describe('tripEngine.decide — sweep', () => {
  it('closes an idle PATROL', () => {
    const d = decide({ kind: 'sweep' }, patrol({ last_move_at: 1_000_000 }), baseCtx({ now: 1_400_000 }));
    expect(d.close?.reason).toBe('idle_timeout');
  });
  it('stale-closes a CALL_RESPONSE whose last fix is older than staleMs', () => {
    const active: ActiveTrip = { ...patrol(), trip_type: 'call_response', call_id: 42, last_fix_ts: 1_000 };
    const d = decide({ kind: 'sweep' }, active, baseCtx({ now: 2_000_000 }));
    expect(d.close?.reason).toBe('stale');
  });
});

describe('tripEngine.decide — available + guards', () => {
  it('available closes an active CALL_RESPONSE (call ended)', () => {
    const active = { id: 7, trip_type: 'call_response' as const, call_id: 42,
      anchor_lat: 40.76, anchor_lng: -111.89, last_move_at: 1_000_000, last_fix_ts: 999_000 };
    const d = decide({ kind: 'status', status: 'available' }, active, baseCtx());
    expect(d.close?.reason).toBe('cleared');
  });
  it('available does NOT close an active PATROL (a patrol unit is already available)', () => {
    const d = decide({ kind: 'status', status: 'available' }, patrol(), baseCtx());
    expect(d.close).toBeUndefined();
  });
  it('a non-finite gps fix is a no-op (no trip opened on NaN coords)', () => {
    const d = decide({ kind: 'gps', fix: { lat: NaN, lng: -111.89, speed: 10, heading: null, ts: 1_000_000 } },
      null, baseCtx());
    expect(d.open).toBeUndefined();
  });
});
