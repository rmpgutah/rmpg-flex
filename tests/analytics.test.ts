import { describe, it, expect } from 'vitest';
import {
  parseWarehouse,
  escapeSqlLiteral,
  buildPlateHistorySql,
  buildAlprSummarySql,
  extractRows,
  alprReadEvent,
  flexEvent,
  cleanEventType,
  buildEventsSql,
  buildEventSummarySql,
  buildCfsTrendsSql,
  buildGpsCoverageSql,
  ANALYTICS_NAMESPACE,
  ALPR_TABLE,
  EVENTS_TABLE,
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

describe('flexEvent', () => {
  it('coerces ids to string, lat/lng/value to number, payload to JSON string', () => {
    const ev = flexEvent({
      event_type: 'cfs_created', occurred_at: '2026-06-15T00:00:00Z',
      actor_id: 7, entity_type: 'call', entity_id: 42, unit_id: 'PS-D19',
      lat: 40.76, lng: -111.89, status: 'pending', label: 'Disturbance',
      category: 'dispatch', priority: 'P2', value: 3,
      payload: { call_number: '26-0001' },
    });
    expect(ev.event_type).toBe('cfs_created');
    expect(ev.entity_id).toBe('42');          // id → string
    expect(ev.unit_id).toBe('PS-D19');
    expect(ev.lat).toBe(40.76);
    expect(ev.value).toBe(3);
    expect(ev.priority).toBe('P2');
    expect(ev.payload).toBe('{"call_number":"26-0001"}');
  });

  it('nulls absent/empty fields (no undefined leaks into Iceberg columns)', () => {
    const ev = flexEvent({ event_type: 'patrol_scan', occurred_at: 't' });
    expect(ev.actor_id).toBeNull();
    expect(ev.entity_id).toBeNull();
    expect(ev.unit_id).toBeNull();
    expect(ev.lat).toBeNull();
    expect(ev.value).toBeNull();
    expect(ev.payload).toBeNull();
  });

  it('accepts raw unknown values (e.g. body.priority) without throwing', () => {
    const ev = flexEvent({ event_type: 'x', occurred_at: 't', lat: 'not-a-number', priority: 4 });
    expect(ev.lat).toBeNull();      // non-numeric string → null
    expect(ev.priority).toBe('4');  // number → string
  });
});

describe('cleanEventType', () => {
  it('keeps [a-z0-9_], lowercases, and strips the rest', () => {
    expect(cleanEventType('CFS_Created')).toBe('cfs_created');
    expect(cleanEventType("gps'; DROP")).toBe('gpsdrop');
    expect(cleanEventType('a'.repeat(50)).length).toBe(40);
  });
});

describe('flex_events SQL builders', () => {
  const sinceIso = '2026-06-01T00:00:00.000Z';

  it('buildEventsSql reads flex_events, filters by sanitized type, time-bounds, orders', () => {
    const sql = buildEventsSql({ sinceIso, eventType: 'cfs_created' });
    expect(sql).toContain(`FROM ${ANALYTICS_NAMESPACE}.${EVENTS_TABLE}`);
    expect(sql).toContain("event_type = 'cfs_created'");
    expect(sql).toContain(`occurred_at >= '${sinceIso}'`);
    expect(sql).toContain('ORDER BY occurred_at DESC');
  });

  it('buildEventsSql omits the type filter when no type given', () => {
    expect(buildEventsSql({ sinceIso })).not.toContain('event_type =');
  });

  it('buildEventSummarySql groups by event_type', () => {
    const sql = buildEventSummarySql({ sinceIso });
    expect(sql).toContain('COUNT(*) AS events');
    expect(sql).toContain('GROUP BY event_type');
  });

  it('buildCfsTrendsSql filters to cfs_created and groups by nature', () => {
    const sql = buildCfsTrendsSql({ sinceIso });
    expect(sql).toContain("event_type = 'cfs_created'");
    expect(sql).toContain('GROUP BY label, priority');
  });

  it('buildGpsCoverageSql aggregates pings per unit', () => {
    const sql = buildGpsCoverageSql({ sinceIso });
    expect(sql).toContain("event_type = 'gps_ping'");
    expect(sql).toContain('GROUP BY unit_id');
    expect(sql).toContain('AVG(value) AS avg_speed');
  });
});
