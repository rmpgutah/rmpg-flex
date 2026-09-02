import { describe, it, expect } from 'vitest';
import { collectCrossRefs } from '../src/utils/personIntel/crossReference';
import { computeVerdict, effectiveConfidence } from '../src/utils/personIntel/verification';
import {
  pendingCentraliaResult,
  normalizeCentraliaResult,
  centraliaToDataPoints,
} from '../src/utils/personIntel/centraliaModel';
import type {
  SourceResult,
  CapturedCrossRef,
  CrossReference,
  Verification,
} from '../src/utils/personIntel/types';

// ─── helpers ─────────────────────────────────────────────────
function xref(over: Partial<CapturedCrossRef> = {}): CapturedCrossRef {
  return {
    source: 'COURTLISTENER',
    externalRef: '2:21-cr-00123',
    label: 'United States v. Smith',
    matchedFields: [{ field: 'name', value: 'John Smith' }],
    confidence: 0.42,
    isCriminal: true,
    riskFlags: ['court_criminal'],
    ...over,
  };
}

function toCrossRef(c: CapturedCrossRef, id = 1, dossierId = 10): CrossReference {
  return {
    id, dossierId,
    source: c.source, externalRef: c.externalRef, externalUrl: c.externalUrl,
    label: c.label, matchedFields: c.matchedFields, confidence: c.confidence,
    isCriminal: c.isCriminal, riskFlags: c.riskFlags,
  };
}

// ─── capture engine ──────────────────────────────────────────
describe('crossReference capture', () => {
  it('collects crossRefs from adapter SourceResults', () => {
    const results: SourceResult[] = [
      {
        sourceName: 'CourtListener', phase: 2, status: 'success',
        dataPoints: [], connections: [], responseTimeMs: 10,
        crossRefs: [xref({ externalRef: 'docket-A' }), xref({ externalRef: 'docket-B', confidence: 0.34 })],
      },
      {
        sourceName: 'FBI_Wanted', phase: 2, status: 'success',
        dataPoints: [], connections: [], responseTimeMs: 8,
        crossRefs: [xref({ source: 'FBI_WANTED', externalRef: 'fbi-url', confidence: 0.46, riskFlags: ['fugitive'] })],
      },
    ];
    const out = collectCrossRefs(results);
    expect(out).toHaveLength(3);
    expect(out.map(c => c.externalRef).sort()).toEqual(['docket-A', 'docket-B', 'fbi-url']);
  });

  it('dedupes by (source, externalRef) keeping the higher confidence + merging fields', () => {
    const results: SourceResult[] = [
      {
        sourceName: 'CourtListener', phase: 2, status: 'success',
        dataPoints: [], connections: [], responseTimeMs: 5,
        crossRefs: [
          xref({ externalRef: 'DUP', confidence: 0.4, matchedFields: [{ field: 'name', value: 'John Smith' }] }),
          xref({ externalRef: 'DUP', confidence: 0.55, matchedFields: [{ field: 'dob', value: '1990-01-01' }], riskFlags: ['court_criminal'] }),
        ],
      },
    ];
    const out = collectCrossRefs(results);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBeCloseTo(0.55, 5);
    expect(out[0].matchedFields).toHaveLength(2);
    expect(out[0].riskFlags).toContain('court_criminal');
  });

  it('ignores adapters that emit no crossRefs', () => {
    const results: SourceResult[] = [
      { sourceName: 'Pipl', phase: 2, status: 'success', dataPoints: [], connections: [], responseTimeMs: 3 },
    ];
    expect(collectCrossRefs(results)).toHaveLength(0);
  });
});

// ─── verification verdicts ───────────────────────────────────
describe('computeVerdict', () => {
  const base = toCrossRef(xref({ confidence: 0.42, matchedFields: [{ field: 'name', value: 'John Smith' }, { field: 'dob', value: '1990-05-12' }] }));

  it('confirms a DOB match and boosts confidence', () => {
    const v = computeVerdict(base, 'dob', '1990-05-12');
    expect(v.result).toBe('confirmed');
    expect(v.adjustedConfidence).toBeGreaterThanOrEqual(0.9);
  });

  it('confirms a partial DOB (same year-month)', () => {
    const v = computeVerdict(base, 'dob', '1990-05-30');
    expect(v.result).toBe('confirmed');
    expect(v.adjustedConfidence).toBeLessThan(0.9);
  });

  it('rejects a DOB conflict', () => {
    const v = computeVerdict(base, 'dob', '1988-01-01');
    expect(v.result).toBe('rejected');
    expect(v.adjustedConfidence).toBeLessThanOrEqual(0.05);
  });

  it('is inconclusive when no evidence is supplied', () => {
    const v = computeVerdict(base, 'dob', '');
    expect(v.result).toBe('inconclusive');
    expect(v.adjustedConfidence).toBe(base.confidence);
  });

  it('confirms officer_review only with evidence text', () => {
    expect(computeVerdict(base, 'officer_review', '').result).toBe('inconclusive');
    const v = computeVerdict(base, 'officer_review', 'matched against DL photo');
    expect(v.result).toBe('confirmed');
    expect(v.adjustedConfidence).toBeGreaterThanOrEqual(0.7);
  });

  it('confirms a phone match on last-10 digits (absorbs country code)', () => {
    const x = toCrossRef(xref({ matchedFields: [{ field: 'phone', value: '+18015551234' }] }));
    expect(computeVerdict(x, 'phone', '(801) 555-1234').result).toBe('confirmed');
  });

  it('confirms an email match case-insensitively', () => {
    const x = toCrossRef(xref({ matchedFields: [{ field: 'email', value: 'John@Example.com' }] }));
    expect(computeVerdict(x, 'email', 'john@example.com').result).toBe('confirmed');
  });
});

describe('effectiveConfidence', () => {
  it('returns base when no verifications', () => {
    const xr = toCrossRef(xref({ confidence: 0.42 }));
    expect(effectiveConfidence(xr, [])).toBeCloseTo(0.42, 5);
  });

  it('returns the highest confirmed adjusted confidence', () => {
    const xr = toCrossRef(xref({ confidence: 0.42 }));
    const v: Verification[] = [
      { crossRefId: 1, method: 'dob', result: 'inconclusive', evidence: '', verifiedBy: 1, adjustedConfidence: 0.42 },
      { crossRefId: 1, method: 'dob', result: 'confirmed', evidence: '1990-05-12', verifiedBy: 1, adjustedConfidence: 0.9 },
    ];
    expect(effectiveConfidence(xr, v)).toBeCloseTo(0.9, 5);
  });

  it('collapses to near-zero when a verification rejects', () => {
    const xr = toCrossRef(xref({ confidence: 0.42 }));
    const v: Verification[] = [
      { crossRefId: 1, method: 'dob', result: 'rejected', evidence: '1988-01-01', verifiedBy: 1, adjustedConfidence: 0.05 },
    ];
    expect(effectiveConfidence(xr, v)).toBeLessThanOrEqual(0.05);
  });
});

// ─── centralia model ─────────────────────────────────────────
describe('centralia model', () => {
  it('builds a pending skeleton', () => {
    const p = pendingCentraliaResult('mont', 'DA 25-0040');
    expect(p.status).toBe('pending');
    expect(p.court_id).toBe('mont');
    expect(p.cluster.docket_number).toBe('DA 25-0040');
    expect(p.warnings?.[0]).toMatch(/not available on Workers/);
  });

  it('normalizes a realistic extractor output into the typed shape', () => {
    const raw = {
      status: 'valid',
      court_id: 'mont',
      cluster: {
        citation: '2025 MT 40',
        docket_number: 'DA 25-0040',
        case_name: 'State v. Doe',
        date_filed: 'May 1, 2025',
        date_filed_iso: '2025-05-01',
        panel: ['Justice McKinnon', 'Justice Shea'],
        parties: ['State of Montana', 'John Doe'],
      },
      opinions: [
        { author: 'Justice McKinnon', type: 'majority', text: 'We affirm...' },
        { author: 'Justice Shea', type: 'concurrence' },
      ],
      warnings: ['page 3 has a scan'],
      removed: [{ kind: 'folio', page: 1, text: '1' }],
    };
    const r = normalizeCentraliaResult(raw);
    expect(r.status).toBe('valid');
    expect(r.cluster.case_name).toBe('State v. Doe');
    expect(r.cluster.panel).toEqual(['Justice McKinnon', 'Justice Shea']);
    expect(r.opinions).toHaveLength(2);
    expect(r.opinions[0].author).toBe('Justice McKinnon');
    expect(r.warnings).toEqual(['page 3 has a scan']);
  });

  it('fails gracefully on garbage input', () => {
    const r = normalizeCentraliaResult('nope');
    expect(r.status).toBe('failed');
    expect(r.opinions).toEqual([]);
  });

  it('extracts legal data points from a centralia result', () => {
    const r = normalizeCentraliaResult({
      status: 'valid', court_id: 'mont',
      cluster: { case_name: 'State v. Doe', docket_number: 'DA 25-0040', citation: '2025 MT 40', date_filed: 'May 1, 2025' },
      opinions: [{ author: 'Justice McKinnon' }],
    });
    const pts = centraliaToDataPoints(r);
    const fields = pts.map(p => p.field);
    expect(fields).toContain('case_name');
    expect(fields).toContain('docket_number');
    expect(fields).toContain('citation');
    expect(fields).toContain('opinion_author');
  });
});
