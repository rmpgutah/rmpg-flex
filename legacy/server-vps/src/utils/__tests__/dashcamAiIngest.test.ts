// ============================================================
// dashcam-ai event ingest — handler tests
// ============================================================
// Verifies the orchestration of HMAC verification → validation
// → storage.put → driving_events insert → evidence_hashes insert.
//
// Handler is a pure function with all I/O injected so tests run
// against in-memory better-sqlite3 + a real filesystem tmpdir.
// No HTTP server, no supertest, no mocks.
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { handleEventIngest } from '../dashcamAiIngest';
import { computeSignatureHex, REPLAY_WINDOW_SEC } from '../dashcamAiHmac';
import { createFilesystemStorage } from '../storageAdapter';

type Db = ReturnType<typeof Database>;

const SECRET = 'test-shared-secret-32chars-minimum-foo';

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
  db.prepare(`
    CREATE TABLE evidence_hashes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_type TEXT NOT NULL,
      artifact_id INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      size_bytes INTEGER,
      storage_uri TEXT,
      captured_at TEXT NOT NULL,
      hashed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      signer TEXT,
      signature TEXT,
      prev_hash_id INTEGER,
      notes TEXT
    )
  `).run();
  return db;
}

let baseDir: string;
let db: Db;
beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flex-ingest-test-'));
  db = makeDb();
});
afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

interface BuildPayloadOpts {
  override?: Partial<Record<string, any>>;
  withClip?: boolean;
}
function buildPayload(opts: BuildPayloadOpts = {}): Buffer {
  const obj: any = {
    source_event_id: 'jetson-12-1745798400-fcw',
    device_id: 'jetson-12',
    unit_id: 12,
    event_type: 'fcw',
    severity: 'warning',
    event_timestamp: '2026-04-28 12:00:00',
    latitude: 40.76,
    longitude: -111.89,
    speed_mph: 45,
    heading: 270,
    duration_sec: 60,
    model_version: 'openpilot-0.9.5',
    confidence: 0.87,
    ...opts.override,
  };
  if (opts.withClip) {
    obj.clip_filename = 'front.mp4';
    obj.clip_base64 = Buffer.from('clip bytes').toString('base64');
  }
  return Buffer.from(JSON.stringify(obj));
}

function signedHeaders(rawBody: Buffer, ts = Math.floor(Date.now() / 1000)) {
  return {
    'x-dashcam-signature': 'sha256=' + computeSignatureHex(SECRET, ts, rawBody),
    'x-dashcam-timestamp': String(ts),
  };
}

describe('handleEventIngest — auth failures', () => {
  it('returns 401 when signature is missing', async () => {
    const rawBody = buildPayload();
    const result = await handleEventIngest({
      rawBody,
      headers: { 'x-dashcam-timestamp': String(Math.floor(Date.now() / 1000)) },
      secret: SECRET,
      storage: createFilesystemStorage(baseDir),
      db: db as any,
    });
    expect(result.status).toBe(401);
  });

  it('returns 401 when signature is wrong', async () => {
    const rawBody = buildPayload();
    const result = await handleEventIngest({
      rawBody,
      headers: {
        'x-dashcam-signature': 'sha256=' + 'a'.repeat(64),
        'x-dashcam-timestamp': String(Math.floor(Date.now() / 1000)),
      },
      secret: SECRET,
      storage: createFilesystemStorage(baseDir),
      db: db as any,
    });
    expect(result.status).toBe(401);
  });

  it('returns 401 when timestamp is expired', async () => {
    const rawBody = buildPayload();
    const old = Math.floor(Date.now() / 1000) - REPLAY_WINDOW_SEC - 5;
    const result = await handleEventIngest({
      rawBody,
      headers: signedHeaders(rawBody, old),
      secret: SECRET,
      storage: createFilesystemStorage(baseDir),
      db: db as any,
    });
    expect(result.status).toBe(401);
  });
});

describe('handleEventIngest — payload validation', () => {
  it('returns 400 on malformed JSON body', async () => {
    const rawBody = Buffer.from('not json{');
    const result = await handleEventIngest({
      rawBody,
      headers: signedHeaders(rawBody),
      secret: SECRET,
      storage: createFilesystemStorage(baseDir),
      db: db as any,
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/json/i);
  });

  it('returns 400 on missing event_type', async () => {
    const rawBody = buildPayload({ override: { event_type: undefined } });
    const result = await handleEventIngest({
      rawBody,
      headers: signedHeaders(rawBody),
      secret: SECRET,
      storage: createFilesystemStorage(baseDir),
      db: db as any,
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/event_type/);
  });

  it('returns 400 on missing event_timestamp', async () => {
    const rawBody = buildPayload({ override: { event_timestamp: undefined } });
    const result = await handleEventIngest({
      rawBody,
      headers: signedHeaders(rawBody),
      secret: SECRET,
      storage: createFilesystemStorage(baseDir),
      db: db as any,
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/event_timestamp/);
  });
});

describe('handleEventIngest — happy path without clip', () => {
  it('inserts driving_events and returns 200', async () => {
    const rawBody = buildPayload();
    const result = await handleEventIngest({
      rawBody,
      headers: signedHeaders(rawBody),
      secret: SECRET,
      storage: createFilesystemStorage(baseDir),
      db: db as any,
    });

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.event_id).toBeGreaterThan(0);
    expect(result.body.deduped).toBe(false);
    expect(result.body.evidence_id).toBeNull();

    const row = db.prepare('SELECT * FROM driving_events WHERE id = ?').get(result.body.event_id) as any;
    expect(row.source).toBe('flex_ai');
    expect(row.event_type).toBe('fcw');
    expect(row.has_video).toBe(0);
    expect(row.unit_id).toBe(12);
  });

  it('does NOT write evidence_hashes when no clip', async () => {
    const rawBody = buildPayload();
    await handleEventIngest({
      rawBody,
      headers: signedHeaders(rawBody),
      secret: SECRET,
      storage: createFilesystemStorage(baseDir),
      db: db as any,
    });
    const evCount = (db.prepare('SELECT COUNT(*) AS c FROM evidence_hashes').get() as any).c;
    expect(evCount).toBe(0);
  });
});

describe('handleEventIngest — happy path WITH clip', () => {
  it('stores clip, writes driving_events, writes evidence_hashes', async () => {
    const rawBody = buildPayload({ withClip: true });
    const result = await handleEventIngest({
      rawBody,
      headers: signedHeaders(rawBody),
      secret: SECRET,
      storage: createFilesystemStorage(baseDir),
      db: db as any,
    });

    expect(result.status).toBe(200);
    expect(result.body.evidence_id).toBeGreaterThan(0);

    const event = db.prepare('SELECT * FROM driving_events WHERE id = ?').get(result.body.event_id) as any;
    expect(event.has_video).toBe(1);
    expect(event.clip_object_key).toMatch(/^file:\/\//);

    const ev = db.prepare('SELECT * FROM evidence_hashes WHERE id = ?').get(result.body.evidence_id) as any;
    expect(ev.artifact_type).toBe('driving_event_clip');
    expect(ev.artifact_id).toBe(result.body.event_id);
    expect(ev.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.size_bytes).toBe(Buffer.from('clip bytes').length);

    // Storage actually has the file
    const filePath = ev.storage_uri.replace(/^file:\/\//, '');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath).toString()).toBe('clip bytes');
  });

  it('writes evidence_hashes with correct sha256 of clip bytes', async () => {
    const rawBody = buildPayload({ withClip: true });
    const result = await handleEventIngest({
      rawBody,
      headers: signedHeaders(rawBody),
      secret: SECRET,
      storage: createFilesystemStorage(baseDir),
      db: db as any,
    });
    const ev = db.prepare('SELECT sha256 FROM evidence_hashes WHERE id = ?').get(result.body.evidence_id) as any;
    // SHA-256 of 'clip bytes'
    const crypto = await import('crypto');
    const expected = crypto.createHash('sha256').update('clip bytes').digest('hex');
    expect(ev.sha256).toBe(expected);
  });
});

describe('handleEventIngest — dedup', () => {
  it('returns deduped=true on duplicate source_event_id', async () => {
    const rawBody1 = buildPayload();
    const first = await handleEventIngest({
      rawBody: rawBody1,
      headers: signedHeaders(rawBody1),
      secret: SECRET,
      storage: createFilesystemStorage(baseDir),
      db: db as any,
    });

    // Same source_event_id, different other content (would be unusual,
    // but tests the dedup path explicitly)
    const rawBody2 = buildPayload({ override: { speed_mph: 99 } });
    const second = await handleEventIngest({
      rawBody: rawBody2,
      headers: signedHeaders(rawBody2),
      secret: SECRET,
      storage: createFilesystemStorage(baseDir),
      db: db as any,
    });

    expect(first.status).toBe(200);
    expect(first.body.deduped).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.deduped).toBe(true);
    expect(second.body.event_id).toBe(first.body.event_id);

    const count = (db.prepare('SELECT COUNT(*) AS c FROM driving_events').get() as any).c;
    expect(count).toBe(1);
  });
});

describe('handleEventIngest — auto-resolves call_id from units', () => {
  it('uses units.current_call_id when payload has none', async () => {
    db.prepare('INSERT INTO units (id, officer_id, current_call_id) VALUES (?, ?, ?)').run(12, 99, 555);
    const rawBody = buildPayload();
    const result = await handleEventIngest({
      rawBody,
      headers: signedHeaders(rawBody),
      secret: SECRET,
      storage: createFilesystemStorage(baseDir),
      db: db as any,
    });
    const row = db.prepare('SELECT call_id, officer_id FROM driving_events WHERE id = ?').get(result.body.event_id) as any;
    expect(row.call_id).toBe(555);
    expect(row.officer_id).toBe(99);
  });
});
