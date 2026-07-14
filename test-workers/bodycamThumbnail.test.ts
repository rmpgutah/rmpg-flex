// test-workers/bodycamThumbnail.test.ts
// Miniflare route smoke test for POST/GET /api/personnel/bodycam-videos/:id/thumbnail.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';

async function execute(db: D1Database, sql: string): Promise<void> {
  await db.prepare(sql).run();
}

async function createTestCameraAndVideo(): Promise<number> {
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

  await db.prepare(`INSERT INTO users (id, full_name, badge_number) VALUES (1, 'Test Officer', 'T-1')`).run();
  await db.prepare(
    `INSERT INTO body_cameras (officer_id, camera_id, status, storage_capacity_gb) VALUES (1, 'TEST-CAM-1', 'assigned', 32)`
  ).run();
  const cam = await db.prepare(`SELECT id FROM body_cameras WHERE camera_id = 'TEST-CAM-1'`).first<{ id: number }>();
  const video = await db.prepare(
    `INSERT INTO bodycam_videos (camera_id, officer_id, title, file_path, file_size, mime_type, classification, uploaded_by)
     VALUES (?, 1, 'Test clip', 'bodycam-videos/test-uuid/original.mp4', 1024, 'video/mp4', 'routine', 'test-officer')`
  ).bind(cam!.id).run();
  return Number(video.meta.last_row_id);
}

describe('POST/GET /api/personnel/bodycam-videos/:id/thumbnail', () => {
  let videoId: number;
  beforeAll(async () => { videoId = await createTestCameraAndVideo(); });

  it('stores the JPEG to R2 and sets thumbnail_path, then serves it back', async () => {
    const fd = new FormData();
    fd.append('thumbnail', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'thumb.jpg');

    const postRes = await app.request(`/api/personnel/bodycam-videos/${videoId}/thumbnail`, { method: 'POST', body: fd }, env as unknown as Record<string, unknown>);
    expect(postRes.status).toBe(200);
    const postBody = await postRes.json() as { thumbnail_path: string };
    expect(postBody.thumbnail_path).toBe(`bodycam-videos/test-uuid/thumbnail.jpg`);

    const getRes = await app.request(`/api/personnel/bodycam-videos/${videoId}/thumbnail`, {}, env as unknown as Record<string, unknown>);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('content-type')).toBe('image/jpeg');
  });

  it('404s when no thumbnail has been uploaded yet for a different video', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const video = await db.prepare(
      `INSERT INTO bodycam_videos (camera_id, officer_id, title, file_path, file_size, mime_type, classification, uploaded_by)
       VALUES ((SELECT id FROM body_cameras WHERE camera_id = 'TEST-CAM-1'), 1, 'No thumb yet', 'bodycam-videos/other-uuid/original.mp4', 1024, 'video/mp4', 'routine', 'test-officer')`
    ).run();
    const otherId = Number(video.meta.last_row_id);
    const res = await app.request(`/api/personnel/bodycam-videos/${otherId}/thumbnail`, {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(404);
  });
});
