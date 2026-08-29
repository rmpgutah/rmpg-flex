// tests/servePlanContext.test.ts
// ============================================================
// R5/R6 — persisted planning context + auto-created-row exclusion
// ============================================================
// R6: commitIntake resolves the address class and parses the client's
// hours/days/start bar, then persists them. The replan/backfill paths must
// READ that instead of re-deriving an interim class and dropping the client's
// dictated hours entirely.
//
// R5: a `businesses` row this same pipeline auto-created is not independent
// evidence and must never confirm an address class.
// ============================================================

import { describe, it, expect } from 'vitest';
import { planContextFromRow } from '../src/utils/servePlanContext';
import { isAutoCreatedBusinessRecord } from '../src/utils/serveIntakeBriefing';
import { resolveAddressClass } from '../src/utils/serveAddressClass';
import { replanAfterFailedAttempt } from '../src/utils/serveDiligencePlanner';

describe('R6: planContextFromRow', () => {
  it('reads a confirmed business class plus the client hours/days/start bar', () => {
    const ctx = planContextFromRow({
      klass: 'business',
      confirmed: 1,                       // SQLite json_extract of JSON true
      client_attempt_schedule: '06:00-09:00;18:00-21:00',
      service_days_allowed: 'weekdays',
      attempt_start_not_before: '2026-08-01',
    });
    expect(ctx.addressClass).toBe('business');
    expect(ctx.addressClassConfirmed).toBe(true);
    expect(ctx.clientBands).toEqual([
      { start: '06:00', end: '09:00' },
      { start: '18:00', end: '21:00' },
    ]);
    expect(ctx.allowedDays).toEqual([1, 2, 3, 4, 5]);
    expect(ctx.startNotBefore).toBe('2026-08-01');
  });

  it('reads a confirmed corporate class from persisted parsed_data', () => {
    const ctx = planContextFromRow({
      klass: 'corporate',
      confirmed: 0,
      client_attempt_schedule: null,
      service_days_allowed: null,
      attempt_start_not_before: null,
    });
    expect(ctx.addressClass).toBe('corporate');
    expect(ctx.addressClassConfirmed).toBe(false);
  });

  it('a legacy row with no persisted class degrades to unknown/unconfirmed (D-2 safe direction)', () => {
    const ctx = planContextFromRow(null);
    expect(ctx).toEqual({
      addressClass: 'unknown',
      addressClassConfirmed: false,
      clientBands: [],
      allowedDays: null,
      startNotBefore: null,
    });
  });

  it('never reports confirmed from a missing or falsey stored value', () => {
    for (const confirmed of [null, 0, '0', 'false'] as const) {
      expect(planContextFromRow({
        klass: 'business', confirmed,
        client_attempt_schedule: null, service_days_allowed: null,
        attempt_start_not_before: null,
      }).addressClassConfirmed).toBe(false);
    }
  });

  it('rejects a malformed start-date bar rather than passing it to the planner', () => {
    const ctx = planContextFromRow({
      klass: null, confirmed: null,
      client_attempt_schedule: null, service_days_allowed: null,
      attempt_start_not_before: 'next monday',
    });
    expect(ctx.startNotBefore).toBeNull();
  });
});

describe('R6: every attempt AFTER the first honours the client hours', () => {
  it('replanAfterFailedAttempt uses the client bands when they are supplied', () => {
    const next = replanAfterFailedAttempt(
      { attempt_at: '2026-07-27T12:00:00Z', result: 'no_answer', window: '07:00-09:00' },
      {
        deadline: null, max_attempts: 3, attempt_count: 1,
        recipient_lat: null, recipient_lng: null,
        addressClass: 'residential', addressClassConfirmed: false,
        clientBands: [{ start: '18:00', end: '21:00' }],
        allowedDays: null, startNotBefore: null,
      },
    );
    expect(next).not.toBeNull();
    expect(next!.authority).toBe('client-specified');
    expect(next!.window).toBe('18:00-21:00');
  });

  it('and honours the client day restriction on the replan too', () => {
    const next = replanAfterFailedAttempt(
      { attempt_at: '2026-07-27T12:00:00Z', result: 'no_answer', window: null },
      {
        deadline: null, max_attempts: 3, attempt_count: 1,
        recipient_lat: null, recipient_lng: null,
        addressClass: 'residential', addressClassConfirmed: false,
        clientBands: [], allowedDays: [1, 2, 3, 4, 5, 6], startNotBefore: null,
      },
    );
    expect(next).not.toBeNull();
    expect(next!.weekday).not.toBe('Sunday');
  });

  it('D-2 (R4): an unconfirmed business class on the replan path gets residential windows', () => {
    const next = replanAfterFailedAttempt(
      { attempt_at: '2026-07-27T12:00:00Z', result: 'no_answer', window: null },
      {
        deadline: null, max_attempts: 3, attempt_count: 1,
        recipient_lat: null, recipient_lng: null,
        addressClass: 'business', addressClassConfirmed: false,
      },
    );
    expect(next!.authority).toBe('residential default');
  });
});

describe('R5: an auto-created businesses row cannot confirm an address class', () => {
  it('recognises the marker findOrCreateBusiness writes', () => {
    expect(isAutoCreatedBusinessRecord({ notes: 'Auto-created via serve intake' })).toBe(true);
    expect(isAutoCreatedBusinessRecord({ business_type: 'process_service_recipient' })).toBe(true);
    expect(isAutoCreatedBusinessRecord(null)).toBe(false);
  });

  it('treats an operator-authored row as independent evidence', () => {
    expect(isAutoCreatedBusinessRecord({
      notes: 'Suite 300, front desk accepts service', business_type: 'client',
    })).toBe(false);
  });

  it('the registered-agent-at-a-residence case does not self-confirm as business', () => {
    // A corporation served through its registered agent AT THE AGENT'S HOME.
    // The first intake auto-created a businesses row at that residential
    // address; the second intake matched it. Feeding that match into
    // businessRecordMatched produced confirmed business — weekday business
    // hours at a private residence. commitIntake now gates the flag on
    // independence, which is what this asserts at the resolver boundary.
    const autoCreated = { notes: 'Auto-created via serve intake', business_type: 'process_service_recipient' };
    const independent = !isAutoCreatedBusinessRecord(autoCreated);
    const r = resolveAddressClass({ businessRecordMatched: independent, instructionsText: '' });
    expect(r.confirmed).toBe(false);
    expect(r.klass).toBe('unknown');
  });
});
