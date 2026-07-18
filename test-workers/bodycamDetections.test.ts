// test-workers/bodycamDetections.test.ts
// Miniflare route smoke test for POST /api/personnel/bodycam-videos/:id/detections.
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import app from './entry';

async function execute(db: D1Database, sql: string): Promise<void> {
  await db.prepare(sql).run();
}

async function createTestVideo(cameraSerial: string): Promise<number> {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, full_name TEXT, badge_number TEXT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS body_cameras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    officer_id INTEGER NOT NULL,
    camera_id TEXT NOT NULL UNIQUE,
    make TEXT,
    model TEXT,
    firmware_version TEXT,
    storage_capacity_gb INTEGER DEFAULT 32,
    status TEXT NOT NULL DEFAULT 'available',
    condition TEXT NOT NULL DEFAULT 'good',
    assigned_at TEXT,
    returned_at TEXT,
    notes TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS bodycam_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_id INTEGER NOT NULL,
    officer_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER,
    mime_type TEXT DEFAULT 'video/mp4',
    recorded_at TEXT,
    case_number TEXT,
    classification TEXT DEFAULT 'routine',
    retention_status TEXT DEFAULT 'active',
    notes TEXT,
    uploaded_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);

  await db.prepare(`INSERT OR IGNORE INTO users (id, full_name, badge_number) VALUES (1, 'Test Officer', 'T-1')`).run();
  await db.prepare(
    `INSERT INTO body_cameras (officer_id, camera_id, status, storage_capacity_gb) VALUES (1, ?, 'assigned', 32)`
  ).bind(cameraSerial).run();
  const cam = await db.prepare(`SELECT id FROM body_cameras WHERE camera_id = ?`).bind(cameraSerial).first<{ id: number }>();
  const video = await db.prepare(
    `INSERT INTO bodycam_videos (camera_id, officer_id, title, file_path, file_size, mime_type, classification, uploaded_by)
     VALUES (?, 1, 'Detection target', 'bodycam-videos/detect-uuid/original.mp4', 1024, 'video/mp4', 'routine', 'test-officer')`
  ).bind(cam!.id).run();
  return Number(video.meta.last_row_id);
}

describe('POST /api/personnel/bodycam-videos/:id/detections', () => {
  it('stores counts + regions and bumps classification to flagged when hits are found on a routine video', async () => {
    const videoId = await createTestVideo('TEST-CAM-DETECT-1');
    const res = await app.request(`/api/personnel/bodycam-videos/${videoId}/detections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ regions: [{ kind: 'plate' }, { kind: 'face' }, { kind: 'face' }] }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { detected_plate_count: number; detected_face_count: number; flagged: boolean };
    expect(body.detected_plate_count).toBe(1);
    expect(body.detected_face_count).toBe(2);
    expect(body.flagged).toBe(true);

    const db = (env as unknown as { DB: D1Database }).DB;
    const row = await db.prepare('SELECT classification, detection_regions_json FROM bodycam_videos WHERE id = ?').bind(videoId).first<{ classification: string; detection_regions_json: string }>();
    expect(row?.classification).toBe('flagged');
    expect(JSON.parse(row!.detection_regions_json)).toHaveLength(3);
  });

  it('does not downgrade an already-restricted video back to flagged-by-detection, but still stores counts', async () => {
    const videoId = await createTestVideo('TEST-CAM-DETECT-2');
    const db = (env as unknown as { DB: D1Database }).DB;
    await db.prepare("UPDATE bodycam_videos SET classification = 'restricted' WHERE id = ?").bind(videoId).run();

    const res = await app.request(`/api/personnel/bodycam-videos/${videoId}/detections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ regions: [{ kind: 'plate' }] }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { flagged: boolean };
    expect(body.flagged).toBe(false);

    const row = await db.prepare('SELECT classification, detected_plate_count FROM bodycam_videos WHERE id = ?').bind(videoId).first<{ classification: string; detected_plate_count: number }>();
    expect(row?.classification).toBe('restricted');
    expect(row?.detected_plate_count).toBe(1);
  });
});
