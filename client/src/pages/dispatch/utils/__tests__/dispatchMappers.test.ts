import { describe, it, expect } from 'vitest';
import { looksLikeCallRow, mapDbCall } from '../dispatchMappers';

// ============================================================
// Regression guard: "attaching a unit destroys the dispatch"
// ============================================================
// The unit-action handlers (assign/unassign/drag/auto-assign/dispatch/
// transfer) replace the selected call with mapDbCall(serverResponse). If an
// endpoint returns a bare acknowledgement body instead of a full call row,
// mapDbCall() emits a blank-id 'Other' call that wipes the real call from the
// dispatch UI. looksLikeCallRow() is the guard every replace-with-response
// path uses to refuse such a body. These tests pin that contract.

describe('mapDbCall on a non-row body (the bug)', () => {
  it('produces a blank-id "Other" call when fed an acknowledgement body', () => {
    // This is exactly what the old /assign-unit endpoint returned.
    const ack = { message: 'Unit assigned', assigned_unit_ids: [5172], premise_pushed: 0 };
    const mapped = mapDbCall(ack);
    // Demonstrates WHY the guard is needed: id is lost, type collapses to 'other'.
    expect(mapped.id).toBe('undefined');
    expect(mapped.incident_type).toBe('other');
  });
});

describe('looksLikeCallRow', () => {
  it('rejects a bare {message} acknowledgement body', () => {
    expect(looksLikeCallRow({ message: 'Unit assigned', assigned_unit_ids: [5172] })).toBe(false);
  });

  it('rejects an {error} body', () => {
    expect(looksLikeCallRow({ error: 'No fields to update' })).toBe(false);
  });

  it('rejects null / undefined / non-objects', () => {
    expect(looksLikeCallRow(null)).toBe(false);
    expect(looksLikeCallRow(undefined)).toBe(false);
    expect(looksLikeCallRow('Unit assigned')).toBe(false);
    expect(looksLikeCallRow(42)).toBe(false);
  });

  it('rejects a row missing an id (mapDbCall would blank it)', () => {
    expect(looksLikeCallRow({ incident_type: 'theft', call_number: 'CFS26-00017' })).toBe(false);
  });

  it('accepts a full call row (id + identifying field)', () => {
    expect(looksLikeCallRow({ id: 17, incident_type: 'other', call_number: 'CFS26-00017' })).toBe(true);
    // id present + call_number alone is enough
    expect(looksLikeCallRow({ id: 17, call_number: 'CFS26-00017' })).toBe(true);
  });

  it('guards the full round-trip: a good row maps, a bad body is refused', () => {
    const goodRow = { id: 17, incident_type: 'theft', call_number: 'CFS26-00017', assigned_unit_ids: '[5172]' };
    const badBody = { message: 'Unit assigned', assigned_unit_ids: [5172] };
    const existing = mapDbCall(goodRow);

    // The pattern every handler uses: only adopt the response if it's a row.
    const adopt = (resp: unknown) => (looksLikeCallRow(resp) ? mapDbCall(resp) : existing);

    expect(adopt(goodRow).id).toBe('17');
    // A bad body never replaces the good call.
    expect(adopt(badBody)).toBe(existing);
    expect(adopt(badBody).id).toBe('17');
  });
});
