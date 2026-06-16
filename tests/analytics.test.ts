import { describe, it, expect } from 'vitest';
import {
  parseWarehouse,
  escapeSqlLiteral,
  buildPlateHistorySql,
  buildAlprSummarySql,
  extractRows,
  alprReadEvent,
  ANALYTICS_NAMESPACE,
  ALPR_TABLE,
} from '../src/utils/analytics';

describe('parseWarehouse', () => {
  it('splits on the FIRST underscore, keeping hyphens in the bucket name', () => {
    expect(parseWarehouse('a1b2c3d4_rmpg-flex-analytics')).toEqual({
      accountId: 'a1b2c3d4',
      bucket: 'rmpg-flex-analytics',
    });
  });

  it('throws when there is no separator', () => {
    expect(() => parseWarehouse('nounderscorehere')).toThrow();
  });

  it('throws when the underscore is leading or trailing', () => {
    expect(() => parseWarehouse('_bucket')).toThrow();
    expect(() => parseWarehouse('account_')).toThrow();
  });
});

describe('escapeSqlLiteral', () => {
  it('doubles single quotes so a literal cannot break out', () => {
    expect(escapeSqlLiteral("O'BRIEN")).toBe("O''BRIEN");
    expect(escapeSqlLiteral("X' OR '1'='1")).toBe("X'' OR ''1''=''1");
  });
});

describe('buildPlateHistorySql', () => {
  const sinceIso = '2026-03-01T00:00:00.000Z';

  it('uppercases the plate and reads from the configured table', () => {
    const sql = buildPlateHistorySql({ plate: 'abc123', sinceIso });
    expect(sql).toContain(`FROM ${ANALYTICS_NAMESPACE}.${ALPR_TABLE}`);
    expect(sql).toContain("WHERE plate = 'ABC123'");
    expect(sql).toContain(`occurred_at >= '${sinceIso}'`);
    expect(sql).toContain('ORDER BY occurred_at DESC');
  });

  it('escapes a quote-bearing plate instead of letting it break the query', () => {
    const sql = buildPlateHistorySql({ plate: "x' OR '1'='1", sinceIso });
    // The quote is doubled — the whole thing stays inside one string literal.
    expect(sql).toContain("WHERE plate = 'X'' OR ''1''=''1'");
  });

  it('clamps limit into [1, 5000] and defaults to 500', () => {
    expect(buildPlateHistorySql({ plate: 'A1', sinceIso })).toContain('LIMIT 500');
    expect(buildPlateHistorySql({ plate: 'A1', sinceIso, limit: 999999 })).toContain('LIMIT 5000');
    expect(buildPlateHistorySql({ plate: 'A1', sinceIso, limit: 0 })).toContain('LIMIT 1');
  });
});

describe('buildAlprSummarySql', () => {
  it('aggregates by plate over the window', () => {
    const sql = buildAlprSummarySql({ sinceIso: '2026-05-01T00:00:00.000Z' });
    expect(sql).toContain('COUNT(*) AS reads');
    expect(sql).toContain('GROUP BY plate');
    expect(sql).toContain('ORDER BY reads DESC');
    expect(sql).toContain('LIMIT 100');
  });
});

describe('extractRows', () => {
  it('returns [] for null / non-object / no recognised shape', () => {
    expect(extractRows(null)).toEqual([]);
    expect(extractRows('nope')).toEqual([]);
    expect(extractRows({ foo: 1 })).toEqual([]);
  });

  it('pulls rows out of the known envelope variants', () => {
    const rows = [{ plate: 'ABC123' }];
    expect(extractRows(rows)).toBe(rows);
    expect(extractRows({ rows })).toBe(rows);
    expect(extractRows({ result: { rows } })).toBe(rows);
    expect(extractRows({ result: rows })).toBe(rows);
    expect(extractRows({ data: { rows } })).toBe(rows);
  });
});

describe('alprReadEvent', () => {
  const src = {
    captureRowId: 42, callId: 7, incidentId: null,
    lat: 40.76, lng: -111.89, locationText: '300 S Main',
    userId: 3, source: 'field' as const,
  };

  it('maps a field read, preferring the canonical plate and stringifying year', () => {
    const ev = alprReadEvent(src, {
      plate: 'ABC123', canonical_plate: 'ABC123', state: 'UT',
      make: 'Toyota', model: 'Camry', year: 2019, color: 'silver',
      vehicle_type: 'sedan', trust_score: 0.91, vehicle_record_id: 9,
      hits: [{ severity: 'critical' }, { severity: 'info' }],
    }, '2026-06-15T12:00:00.000Z');

    expect(ev.event_type).toBe('alpr_read');
    expect(ev.plate).toBe('ABC123');
    expect(ev.raw_plate).toBe('ABC123');
    expect(ev.year).toBe('2019');           // always a string
    expect(ev.trust).toBe(0.91);
    expect(ev.hit_count).toBe(2);
    expect(ev.critical_hit).toBe(true);
    expect(ev.capture_id).toBe(42);
    expect(ev.captured_by).toBe(3);
    expect(ev.source).toBe('field');
  });

  it('handles an unattended edge read (null user/capture, no hits)', () => {
    const ev = alprReadEvent(
      { captureRowId: null, callId: null, incidentId: null, lat: null, lng: null,
        locationText: null, userId: null, source: 'edge' },
      { plate: '6KJ3L8', canonical_plate: '6KJ3L8', trust_score: 0.72 },
      '2026-06-15T12:00:00.000Z',
    );
    expect(ev.capture_id).toBeNull();
    expect(ev.captured_by).toBeNull();
    expect(ev.hit_count).toBe(0);
    expect(ev.critical_hit).toBe(false);
    expect(ev.source).toBe('edge');
  });

  it('falls back to confidence when trust_score is absent, else null', () => {
    expect(alprReadEvent(src, { plate: 'A1', confidence: 0.5 }, 't').trust).toBe(0.5);
    expect(alprReadEvent(src, { plate: 'A1' }, 't').trust).toBeNull();
  });
});
