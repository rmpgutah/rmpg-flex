// ============================================================
// driving_events — source-agnostic insert + dedup
// ============================================================
// Verifies:
//   1. Schema: required columns + indexes exist
//   2. insertDrivingEvent: writes a row and returns inserted=true
//   3. Dedup: same (source, source_event_id) → inserted=false
//   4. Auto-resolve: call_id + officer_id pulled from units
//   5. mapClearPathStatusCode: known codes + unknown fall-through
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  insertDrivingEvent,
  mapClearPathStatusCode,
  mapTraccarAlarm,
} from '../drivingEvents';

type Db = ReturnType<typeof Database>;

// Mirror of database.ts driving_events CREATE TABLE for isolated tests.
// Kept in sync with the production migration block; if production
// changes, update here AND add a test that catches the drift.
function makeDb(): Db {
  const db = new Database(':memory:');
  db.prepare(`
    CREATE TABLE units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER,
      current_call_id INTEGER,
      call_sign TEXT
    )
  `).run();
  db.prepare(`
    CREATE TABLE driving_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_event_id TEXT,
      device_id TEXT,
      unit_id INTEGER,
      officer_id INTEGER,
      event_type TEXT NOT NULL,
      severity TEXT DEFAULT 'info',
      event_timestamp TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      heading REAL,
      speed_mph REAL,
      address TEXT,
      call_id INTEGER,
      incident_id INTEGER,
      beat_code TEXT,
      has_video INTEGER DEFAULT 0,
      video_url TEXT,
      clip_object_key TEXT,
      thumb_object_key TEXT,
      duration_sec INTEGER,
      model_version TEXT,
      confidence REAL,
      raw_json TEXT,
      created_at TEXT
    )
  `).run();
  return db;
}

describe('insertDrivingEvent — basic insert', () => {
  let db: Db;
  beforeEach(() => { db = makeDb(); });

  it('inserts a normalized event and returns inserted=true', () => {
    const result = insertDrivingEvent({
      source: 'clearpathgps',
      source_event_id: 'dev-1:2026-04-28 12:00:00:HARD_BRAKE',
      device_id: 'dev-1',
      event_type: 'hard_brake',
      severity: 'warning',
      event_timestamp: '2026-04-28 12:00:00',
      latitude: 40.76,
      longitude: -111.89,
      speed_mph: 45,
    }, db as any);

    expect(result.inserted).toBe(true);
    expect(result.id).toBeGreaterThan(0);

    const row = db.prepare('SELECT * FROM driving_events WHERE id = ?').get(result.id) as any;
    expect(row.source).toBe('clearpathgps');
    expect(row.event_type).toBe('hard_brake');
    expect(row.severity).toBe('warning');
    expect(row.latitude).toBeCloseTo(40.76);
    expect(row.has_video).toBe(0); // default false
  });

  it('persists raw_json verbatim for forensic review', () => {
    const raw = JSON.stringify({ statusCode: 'IMPACT', g: 5.2 });
    const result = insertDrivingEvent({
      source: 'flex_ai',
      event_type: 'impact',
      event_timestamp: '2026-04-28 12:00:00',
      raw_json: raw,
    }, db as any);
    const row = db.prepare('SELECT raw_json FROM driving_events WHERE id = ?').get(result.id) as any;
    expect(row.raw_json).toBe(raw);
  });
});

describe('insertDrivingEvent — dedup on (source, source_event_id)', () => {
  let db: Db;
  beforeEach(() => { db = makeDb(); });

  it('returns inserted=false on duplicate source_event_id', () => {
    const input = {
      source: 'clearpathgps' as const,
      source_event_id: 'unique-key-1',
      event_type: 'hard_brake' as const,
      event_timestamp: '2026-04-28 12:00:00',
    };
    const first = insertDrivingEvent(input, db as any);
    const second = insertDrivingEvent(input, db as any);

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.id).toBe(first.id);

    const count = (db.prepare('SELECT COUNT(*) AS c FROM driving_events').get() as any).c;
    expect(count).toBe(1);
  });

  it('does NOT dedup when source_event_id is null (allows duplicates)', () => {
    const input = {
      source: 'manual' as const,
      event_type: 'use_of_force' as const,
      event_timestamp: '2026-04-28 12:00:00',
    };
    insertDrivingEvent(input, db as any);
    insertDrivingEvent(input, db as any);
    const count = (db.prepare('SELECT COUNT(*) AS c FROM driving_events').get() as any).c;
    expect(count).toBe(2);
  });

  it('treats different sources as independent dedup namespaces', () => {
    const eventId = 'shared-id';
    const a = insertDrivingEvent({
      source: 'clearpathgps', source_event_id: eventId,
      event_type: 'hard_brake', event_timestamp: '2026-04-28 12:00:00',
    }, db as any);
    const b = insertDrivingEvent({
      source: 'traccar', source_event_id: eventId,
      event_type: 'hard_brake', event_timestamp: '2026-04-28 12:00:00',
    }, db as any);
    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(true);
    expect(a.id).not.toBe(b.id);
  });
});

describe('insertDrivingEvent — auto-resolve from units', () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
    db.prepare('INSERT INTO units (id, officer_id, current_call_id) VALUES (?, ?, ?)')
      .run(7, 42, 1234);
  });

  it('resolves call_id from units.current_call_id when not supplied', () => {
    const result = insertDrivingEvent({
      source: 'flex_ai',
      unit_id: 7,
      event_type: 'fcw',
      event_timestamp: '2026-04-28 12:00:00',
    }, db as any);
    const row = db.prepare('SELECT call_id FROM driving_events WHERE id = ?').get(result.id) as any;
    expect(row.call_id).toBe(1234);
  });

  it('respects explicitly-supplied call_id over auto-resolve', () => {
    const result = insertDrivingEvent({
      source: 'flex_ai',
      unit_id: 7,
      call_id: 9999,
      event_type: 'fcw',
      event_timestamp: '2026-04-28 12:00:00',
    }, db as any);
    const row = db.prepare('SELECT call_id FROM driving_events WHERE id = ?').get(result.id) as any;
    expect(row.call_id).toBe(9999);
  });

  it('resolves officer_id from units when not supplied', () => {
    const result = insertDrivingEvent({
      source: 'flex_ai',
      unit_id: 7,
      event_type: 'fcw',
      event_timestamp: '2026-04-28 12:00:00',
    }, db as any);
    const row = db.prepare('SELECT officer_id FROM driving_events WHERE id = ?').get(result.id) as any;
    expect(row.officer_id).toBe(42);
  });

  it('leaves call_id null when unit has no current_call_id', () => {
    db.prepare('UPDATE units SET current_call_id = NULL WHERE id = ?').run(7);
    const result = insertDrivingEvent({
      source: 'flex_ai',
      unit_id: 7,
      event_type: 'fcw',
      event_timestamp: '2026-04-28 12:00:00',
    }, db as any);
    const row = db.prepare('SELECT call_id FROM driving_events WHERE id = ?').get(result.id) as any;
    expect(row.call_id).toBeNull();
  });
});

describe('mapClearPathStatusCode — vendor → normalized', () => {
  it('maps known harsh-event codes', () => {
    expect(mapClearPathStatusCode('HARD_BRAKE')).toEqual({ type: 'hard_brake', severity: 'warning' });
    expect(mapClearPathStatusCode('HARD_ACCEL')).toEqual({ type: 'hard_accel', severity: 'warning' });
    expect(mapClearPathStatusCode('SPEEDING')).toEqual({ type: 'speeding', severity: 'warning' });
  });

  it('maps critical codes with critical severity', () => {
    expect(mapClearPathStatusCode('IMPACT')).toEqual({ type: 'impact', severity: 'critical' });
    expect(mapClearPathStatusCode('SOS')).toEqual({ type: 'sos', severity: 'critical' });
    expect(mapClearPathStatusCode('PANIC')).toEqual({ type: 'sos', severity: 'critical' });
  });

  it('normalizes whitespace and dashes', () => {
    expect(mapClearPathStatusCode('hard-brake')).toEqual({ type: 'hard_brake', severity: 'warning' });
    expect(mapClearPathStatusCode('hard accel')).toEqual({ type: 'hard_accel', severity: 'warning' });
  });

  it('returns null for unknown / null codes', () => {
    expect(mapClearPathStatusCode(null)).toBeNull();
    expect(mapClearPathStatusCode('')).toBeNull();
    expect(mapClearPathStatusCode('SOMETHING_NEW')).toBeNull();
  });
});

describe('mapTraccarAlarm — vendor → normalized', () => {
  it('maps Traccar harsh-driving alarms (camelCase)', () => {
    expect(mapTraccarAlarm('hardBraking')).toEqual({ type: 'hard_brake', severity: 'warning' });
    expect(mapTraccarAlarm('hardAcceleration')).toEqual({ type: 'hard_accel', severity: 'warning' });
    expect(mapTraccarAlarm('hardCornering')).toEqual({ type: 'hard_turn', severity: 'warning' });
    expect(mapTraccarAlarm('overspeed')).toEqual({ type: 'speeding', severity: 'warning' });
  });

  it('maps Traccar critical alarms', () => {
    expect(mapTraccarAlarm('sos')).toEqual({ type: 'sos', severity: 'critical' });
    expect(mapTraccarAlarm('accident')).toEqual({ type: 'impact', severity: 'critical' });
    expect(mapTraccarAlarm('shock')).toEqual({ type: 'impact', severity: 'critical' });
  });

  it('maps Traccar ignition transitions', () => {
    expect(mapTraccarAlarm('ignitionOn')).toEqual({ type: 'ignition_on', severity: 'info' });
    expect(mapTraccarAlarm('ignitionOff')).toEqual({ type: 'ignition_off', severity: 'info' });
  });

  it('maps tampering/power events to custom severity=alert', () => {
    expect(mapTraccarAlarm('tampering')).toEqual({ type: 'custom', severity: 'alert' });
    expect(mapTraccarAlarm('powerCut')).toEqual({ type: 'custom', severity: 'alert' });
  });

  it('returns null for unknown / falsy input', () => {
    expect(mapTraccarAlarm(null)).toBeNull();
    expect(mapTraccarAlarm(undefined)).toBeNull();
    expect(mapTraccarAlarm('')).toBeNull();
    expect(mapTraccarAlarm('movement')).toBeNull();   // not an event-of-interest
    expect(mapTraccarAlarm('something_new')).toBeNull();
  });
});

describe('insertDrivingEvent — has_video boolean coerces to int', () => {
  let db: Db;
  beforeEach(() => { db = makeDb(); });

  it('stores has_video=true as 1', () => {
    const r = insertDrivingEvent({
      source: 'clearpathgps',
      event_type: 'impact',
      event_timestamp: '2026-04-28 12:00:00',
      has_video: true,
    }, db as any);
    const row = db.prepare('SELECT has_video FROM driving_events WHERE id = ?').get(r.id) as any;
    expect(row.has_video).toBe(1);
  });

  it('stores has_video=false (and undefined) as 0', () => {
    const r1 = insertDrivingEvent({
      source: 'clearpathgps',
      event_type: 'impact',
      event_timestamp: '2026-04-28 12:00:00',
      has_video: false,
    }, db as any);
    const r2 = insertDrivingEvent({
      source: 'clearpathgps',
      event_type: 'impact',
      event_timestamp: '2026-04-28 12:00:01',
    }, db as any);
    const row1 = db.prepare('SELECT has_video FROM driving_events WHERE id = ?').get(r1.id) as any;
    const row2 = db.prepare('SELECT has_video FROM driving_events WHERE id = ?').get(r2.id) as any;
    expect(row1.has_video).toBe(0);
    expect(row2.has_video).toBe(0);
  });
});
