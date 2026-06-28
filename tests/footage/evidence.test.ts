import { describe, it, expect } from 'vitest';
import { footageEvidenceNumber, viewSessionKey, isUnlockable, buildCourtManifest, manifestPayloadHash } from '../../src/utils/footage/evidence';

describe('footageEvidenceNumber', () => {
  it('formats YY-FEV-NNNNN', () => {
    expect(footageEvidenceNumber(2026, 42)).toBe('26-FEV-00042');
    expect(footageEvidenceNumber(2026, 0)).toBe('26-FEV-00000');
  });
});

describe('viewSessionKey', () => {
  it('is stable within the same hour and distinct across hours/users', () => {
    expect(viewSessionKey(7, '2026-06-14T09:18:30.000Z')).toBe('7|2026-06-14T09');
    expect(viewSessionKey(7, '2026-06-14T09:59:00.000Z')).toBe(viewSessionKey(7, '2026-06-14T09:18:30.000Z'));
    expect(viewSessionKey(7, '2026-06-14T10:00:00.000Z')).not.toBe(viewSessionKey(7, '2026-06-14T09:18:30.000Z'));
    expect(viewSessionKey(8, '2026-06-14T09:18:30.000Z')).not.toBe(viewSessionKey(7, '2026-06-14T09:18:30.000Z'));
  });
});

describe('isUnlockable', () => {
  it('requires a non-empty reason', () => {
    expect(isUnlockable('mistaken lock')).toBe(true);
    expect(isUnlockable('   ')).toBe(false);
    expect(isUnlockable('')).toBe(false);
    expect(isUnlockable(undefined)).toBe(false);
  });
});

describe('buildCourtManifest', () => {
  it('orders chunks by seq, lists gaps, and carries refs+custody', () => {
    const m = buildCourtManifest({
      request: { id: 5, evidence_number: '26-FEV-00005', classification: 'evidence', preserved_reason: 'panic', from_ts: 0, to_ts: 120000 },
      chunks: [
        { seq: 1, from_ts: 40000, to_ts: 80000, bytes: 10, sha256: 'b', status: 'downloaded' },
        { seq: 0, from_ts: 0, to_ts: 40000, bytes: 12, sha256: 'a', status: 'downloaded' },
        { seq: 2, from_ts: 80000, to_ts: 120000, bytes: 0, sha256: null, status: 'missing' },
      ],
      links: [{ entity_type: 'incident', entity_id: 9 }],
      custody: [{ action: 'preserved', actor_name: 'Sys', reason: null, created_at: 't0' }],
    });
    expect(m.evidence_number).toBe('26-FEV-00005');
    expect(m.chunks.map((c) => c.seq)).toEqual([0, 1, 2]);
    expect(m.gaps).toEqual([2]);
    expect(m.case_refs).toEqual([{ entity_type: 'incident', entity_id: 9 }]);
    expect(m.custody).toHaveLength(1);
  });
});

describe('manifestPayloadHash', () => {
  it('is a deterministic 64-char sha256 hex', async () => {
    const manifest = buildCourtManifest({
      request: { id: 1, evidence_number: '26-FEV-00001', classification: 'evidence', preserved_reason: null, from_ts: 0, to_ts: 40000 },
      chunks: [{ seq: 0, from_ts: 0, to_ts: 40000, bytes: 1, sha256: 'x', status: 'downloaded' }],
      links: [], custody: [],
    });
    const h1 = await manifestPayloadHash(manifest);
    const h2 = await manifestPayloadHash(manifest);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
  });
});
