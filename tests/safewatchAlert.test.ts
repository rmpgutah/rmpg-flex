// Pure-function tests for the SafeWatch inbound payload parser.
// The parser is the trust boundary: everything SafeWatch sends is
// untrusted public input, so every field is validated or dropped.
import { describe, it, expect } from 'vitest';
import { parseSafewatchAlert, MAX_HEADLINE, MAX_BODY } from '../src/utils/safewatchAlert';

const VALID = {
  external_id: 'sw_abc123',
  source_kind: 'community',
  source: 'safewatch',
  alert_type: 'suspicious_activity',
  severity: 'advisory',
  headline: 'Group loitering behind the strip mall',
  body: 'Three people, one carrying a crowbar.',
  location_text: '900 S State St, Salt Lake City, UT',
  latitude: 40.7508,
  longitude: -111.888,
  occurred_at: '2026-09-15T18:04:00Z',
};

describe('parseSafewatchAlert', () => {
  it('accepts a well-formed community report', () => {
    const r = parseSafewatchAlert(VALID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.externalId).toBe('sw_abc123');
    expect(r.payload.sourceKind).toBe('community');
    expect(r.payload.severity).toBe('advisory');
    expect(r.payload.latitude).toBeCloseTo(40.7508);
  });

  it('accepts an aggregated third-party feed item', () => {
    const r = parseSafewatchAlert({
      ...VALID, external_id: 'nws_9912', source_kind: 'feed', source: 'nws',
      alert_type: 'flash_flood', severity: 'urgent',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.sourceKind).toBe('feed');
    expect(r.payload.source).toBe('nws');
  });

  it.each([
    ['missing external_id', { ...VALID, external_id: undefined }],
    ['blank external_id', { ...VALID, external_id: '   ' }],
    ['missing headline', { ...VALID, headline: undefined }],
    ['blank headline', { ...VALID, headline: '' }],
    ['non-object', 'not-an-object'],
    ['null', null],
  ])('rejects %s', (_label, input) => {
    expect(parseSafewatchAlert(input).ok).toBe(false);
  });

  it('rejects an unknown source_kind rather than defaulting it', () => {
    // Silently coercing would let a caller launder a feed item as a
    // community report (or vice versa) and destroy provenance.
    expect(parseSafewatchAlert({ ...VALID, source_kind: 'official' }).ok).toBe(false);
  });

  it('rejects an unknown severity rather than defaulting it', () => {
    expect(parseSafewatchAlert({ ...VALID, severity: 'critical' }).ok).toBe(false);
  });

  it('defaults severity to info and source_kind to community when absent', () => {
    const r = parseSafewatchAlert({ external_id: 'x', headline: 'h' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.severity).toBe('info');
    expect(r.payload.sourceKind).toBe('community');
    expect(r.payload.source).toBe('safewatch');
  });

  it('drops out-of-range or non-numeric coordinates instead of storing them', () => {
    for (const bad of [{ latitude: 99, longitude: -111 }, { latitude: 40, longitude: 999 },
                       { latitude: 'north', longitude: -111 }, { latitude: NaN, longitude: 1 }]) {
      const r = parseSafewatchAlert({ ...VALID, ...bad });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.payload.latitude).toBeNull();
      expect(r.payload.longitude).toBeNull();
    }
  });

  it('drops a half-supplied coordinate pair', () => {
    const r = parseSafewatchAlert({ ...VALID, longitude: undefined });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.latitude).toBeNull();
    expect(r.payload.longitude).toBeNull();
  });

  it('truncates an oversized headline and body rather than rejecting', () => {
    const r = parseSafewatchAlert({
      ...VALID, headline: 'h'.repeat(MAX_HEADLINE + 500), body: 'b'.repeat(MAX_BODY + 5000),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.headline.length).toBe(MAX_HEADLINE);
    expect(r.payload.body?.length).toBe(MAX_BODY);
  });

  it('rejects an unparseable occurred_at instead of storing garbage', () => {
    const r = parseSafewatchAlert({ ...VALID, occurred_at: 'last tuesday' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.occurredAt).toBeNull();
  });

  it('normalizes occurred_at to an ISO string', () => {
    const r = parseSafewatchAlert({ ...VALID, occurred_at: '2026-09-15T18:04:00Z' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.occurredAt).toBe('2026-09-15T18:04:00.000Z');
  });

  it('ignores a caller-supplied status / reviewed_by / promoted_tip_id', () => {
    // Triage state is ours. A caller must not be able to land a row
    // pre-marked "promoted" or attribute a review to a real user id.
    const r = parseSafewatchAlert({
      ...VALID, status: 'promoted', reviewed_by: 1, promoted_tip_id: 7,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).not.toHaveProperty('status');
    expect(r.payload).not.toHaveProperty('reviewedBy');
    expect(r.payload).not.toHaveProperty('promotedTipId');
  });
});
