// ============================================================
// Dashcam Videos — Workers (Hono) Port
// CRUD, file upload (R2), streaming (R2), entity links,
// auto-correlation, quality report, storage usage, CSV export.
// Skips: auditLog, broadcast, sendCsv.
// File handling adapted from local disk (multer/fs) to R2.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, safeStr } from '../worker-middleware/d1Helpers';
import { localNow } from '../worker-middleware/timeUtils';

export function mountDashcamVideoRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // === GET / — List dashcam videos ===
  api.get('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const { vehicle_id, unit_id, case_number, search, limit: limitStr, offset: offsetStr } = q;
      const limit = Math.min(100000, Math.max(1, parseInt(limitStr || '100000', 10) || 100000));
      const offset = Math.max(0, Math.min(parseInt(offsetStr || '0', 10) || 0, 10000));

      let query = `
        SELECT v.*,
          COALESCE(fv.vehicle_number, fv_unit.vehicle_number) as vehicle_number,
          COALESCE(fv.make, fv_unit.make) as vehicle_make,
          COALESCE(fv.model, fv_unit.model) as vehicle_model,
          COALESCE(fv.year, fv_unit.year) as vehicle_year,
          u.call_sign as unit_call_sign
        FROM dashcam_videos v
        LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
        LEFT JOIN units u ON v.unit_id = u.id
        LEFT JOIN fleet_vehicles fv_unit ON fv_unit.assigned_unit_id = v.unit_id AND v.vehicle_id IS NULL
        WHERE 1=1
      `;
      const params: any[] = [];

      if (vehicle_id) { query += ' AND (v.vehicle_id = ? OR fv_unit.id = ?)'; params.push(vehicle_id, vehicle_id); }
      if (unit_id) { query += ' AND v.unit_id = ?'; params.push(unit_id); }
      if (case_number) { query += ' AND v.case_number = ?'; params.push(case_number); }
      if (search) {
        const qs = `%${search}%`;
        query += " AND (v.title LIKE ? OR v.case_number LIKE ? OR v.address LIKE ? OR COALESCE(fv.vehicle_number, fv_unit.vehicle_number) LIKE ? OR u.call_sign LIKE ?)";
        params.push(qs, qs, qs, qs, qs);
      }

      query += ' ORDER BY v.recorded_at DESC, v.created_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const videos = await db.prepare(query).all(...params);
      const totalRow = await db.prepare('SELECT COUNT(*) as cnt FROM dashcam_videos').get() as any;
      const total = totalRow?.cnt || 0;

      return c.json({ videos, total });
    } catch (error: any) {
      return c.json({ error: 'Failed to list videos', code: 'DASHCAMVIDEOS_LIST_VIDEOS_ERROR' }, 500);
    }
  });

  // === GET /:id — Single video detail ===
  api.get('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const video = await db.prepare(`
        SELECT v.*,
          COALESCE(fv.vehicle_number, fv_unit.vehicle_number) as vehicle_number,
          COALESCE(fv.make, fv_unit.make) as vehicle_make,
          COALESCE(fv.model, fv_unit.model) as vehicle_model,
          COALESCE(fv.year, fv_unit.year) as vehicle_year,
          u.call_sign as unit_call_sign
        FROM dashcam_videos v
        LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
        LEFT JOIN units u ON v.unit_id = u.id
        LEFT JOIN fleet_vehicles fv_unit ON fv_unit.assigned_unit_id = v.unit_id AND v.vehicle_id IS NULL
        WHERE v.id = ?
      `).get(c.req.param('id'));

      if (!video) return c.json({ error: 'Video not found', code: 'VIDEO_NOT_FOUND' }, 404);
      return c.json(video);
    } catch (error: any) {
      return c.json({ error: 'Failed to get video', code: 'DASHCAMVIDEOS_GET_VIDEO_ERROR' }, 500);
    }
  });

  // === POST / — Upload a new dashcam video (via multipart form) ===
  api.post('/', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c) => {
    try {
      const formData = await c.req.formData();
      const videoFile = formData.get('video');

      if (!videoFile || !(videoFile instanceof File)) {
        return c.json({ error: 'No video file uploaded', code: 'NO_VIDEO_FILE_UPLOADED' }, 400);
      }

      const title = safeStr(formData.get('title'));
      if (!title || title.length > 500) {
        return c.json({ error: 'Title is required (max 500 chars)', code: 'TITLE_IS_REQUIRED' }, 400);
      }

      const classification = safeStr(formData.get('classification')) || 'routine';
      const validClassifications = ['routine', 'evidence', 'incident', 'training', 'flagged', 'restricted', 'other'];
      if (classification && !validClassifications.includes(classification)) {
        return c.json({ error: `Classification must be one of: ${validClassifications.join(', ')}` }, 400);
      }

      // Upload to R2
      const ext = videoFile.name.split('.').pop() || 'mp4';
      const r2Key = `dashcam/dashcam_${Date.now()}_${crypto.randomUUID().slice(0, 12)}.${ext}`;
      const fileBuffer = await videoFile.arrayBuffer();

      await c.env.UPLOADS.put(r2Key, fileBuffer, {
        httpMetadata: { contentType: videoFile.type || 'video/mp4' },
      });

      const db = new D1Db(c.env.DB);
      const now = localNow();
      const user = c.get('user');

      const vehicle_id = safeStr(formData.get('vehicle_id'));
      const unit_id = safeStr(formData.get('unit_id'));

      // Auto-resolve vehicle_id from unit's assigned fleet vehicle if not provided
      let resolvedVehicleId = vehicle_id || null;
      if (!resolvedVehicleId && unit_id) {
        const fv = await db.prepare('SELECT id FROM fleet_vehicles WHERE assigned_unit_id = ?').get(unit_id) as any;
        if (fv) resolvedVehicleId = fv.id;
      }

      const result = await db.prepare(`
        INSERT INTO dashcam_videos
          (vehicle_id, unit_id, title, file_path, file_size, duration_seconds, mime_type,
           recorded_at, case_number, classification, speed_mph, latitude, longitude, address,
           notes, source, uploaded_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upload', ?, ?, ?)
      `).run(
        resolvedVehicleId,
        unit_id || null,
        title,
        r2Key,
        videoFile.size,
        formData.get('duration_seconds') ? parseInt(safeStr(formData.get('duration_seconds')), 10) : null,
        videoFile.type || 'video/mp4',
        safeStr(formData.get('recorded_at')) || null,
        safeStr(formData.get('case_number')) || null,
        classification,
        formData.get('speed_mph') ? parseFloat(safeStr(formData.get('speed_mph'))) : null,
        formData.get('latitude') ? parseFloat(safeStr(formData.get('latitude'))) : null,
        formData.get('longitude') ? parseFloat(safeStr(formData.get('longitude'))) : null,
        safeStr(formData.get('address')) || null,
        safeStr(formData.get('notes')) || null,
        user.username || 'system',
        now, now,
      );

      const id = result.meta.last_row_id;
      return c.json({ success: true, id });
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // === PUT /:id — Update video metadata ===
  api.put('/:id', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) return c.json({ error: 'Invalid video ID', code: 'INVALID_VIDEO_ID' }, 400);

      const existing = await db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'Video not found', code: 'VIDEO_NOT_FOUND' }, 404);

      const body = await c.req.json();

      if (body.title !== undefined && (typeof body.title !== 'string' || body.title.length > 500)) {
        return c.json({ error: 'Title must be 500 characters or less', code: 'TITLE_MUST_BE_500' }, 400);
      }

      const validClassifications = ['routine', 'evidence', 'incident', 'training', 'flagged', 'restricted', 'other'];
      if (body.classification && !validClassifications.includes(body.classification)) {
        return c.json({ error: `Classification must be one of: ${validClassifications.join(', ')}` }, 400);
      }

      if (body.notes !== undefined && body.notes !== null && typeof body.notes === 'string' && body.notes.length > 10000) {
        return c.json({ error: 'Notes must be 10000 characters or less', code: 'NOTES_MUST_BE_10000' }, 400);
      }

      const fieldMap: Record<string, (v: any) => any> = {
        title: v => v ?? null,
        vehicle_id: v => v ?? null,
        unit_id: v => v ?? null,
        recorded_at: v => v ?? null,
        case_number: v => v ?? null,
        classification: v => v ?? null,
        speed_mph: v => v == null ? null : parseFloat(String(v)),
        latitude: v => v == null ? null : parseFloat(String(v)),
        longitude: v => v == null ? null : parseFloat(String(v)),
        address: v => v ?? null,
        notes: v => v ?? null,
      };
      const sets: string[] = [];
      const values: any[] = [];
      for (const [key, transform] of Object.entries(fieldMap)) {
        if (Object.prototype.hasOwnProperty.call(body, key)) {
          sets.push(`${key} = ?`);
          values.push(transform(body[key]));
        }
      }
      if (sets.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' }, 400);

      sets.push('updated_at = ?');
      values.push(localNow());
      values.push(id);
      await db.prepare(`UPDATE dashcam_videos SET ${sets.join(', ')} WHERE id = ?`).run(...values);

      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to update video', code: 'DASHCAMVIDEOS_UPDATE_VIDEO_ERROR' }, 500);
    }
  });

  // === DELETE /:id — Delete video + R2 object ===
  api.delete('/:id', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) return c.json({ error: 'Invalid video ID', code: 'INVALID_VIDEO_ID' }, 400);

      const video = await db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(id) as any;
      if (!video) return c.json({ error: 'Video not found', code: 'VIDEO_NOT_FOUND' }, 404);

      // Delete from R2
      if (video.file_path) {
        try { await c.env.UPLOADS.delete(video.file_path); } catch { /* R2 delete may fail */ }
      }

      await db.prepare('DELETE FROM dashcam_videos WHERE id = ?').run(id);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to delete video', code: 'DASHCAMVIDEOS_DELETE_VIDEO_ERROR' }, 500);
    }
  });

  // === GET /:id/stream — Stream video from R2 with range support ===
  api.get('/:id/stream', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const video = await db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(c.req.param('id')) as any;
      if (!video) return c.json({ error: 'Video not found', code: 'VIDEO_NOT_FOUND' }, 404);

      if (!video.file_path) return c.json({ error: 'Video file not found', code: 'VIDEO_FILE_NOT_FOUND' }, 404);

      const obj = await c.env.UPLOADS.get(video.file_path);
      if (!obj) return c.json({ error: 'Video file not found on storage', code: 'VIDEO_FILE_NOT_FOUND' }, 404);

      const fileSize = obj.size;
      const rangeHeader = c.req.header('Range');

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
          c.status(416);
          c.header('Content-Range', `bytes */${fileSize}`);
          return c.body(null);
        }

        const rangeObj = await c.env.UPLOADS.get(video.file_path, {
          range: { offset: start, length: end - start + 1 },
        });
        if (!rangeObj) return c.body(null, 416);

        const chunk = await rangeObj.arrayBuffer();
        c.status(206);
        c.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        c.header('Accept-Ranges', 'bytes');
        c.header('Content-Length', String((end - start + 1)));
        c.header('Content-Type', video.mime_type || 'video/mp4');
        return c.body(chunk);
      } else {
        const fullObj = await c.env.UPLOADS.get(video.file_path);
        if (!fullObj) return c.json({ error: 'Video not found' }, 404);

        const data = await fullObj.arrayBuffer();
        c.header('Content-Length', String(fileSize));
        c.header('Content-Type', video.mime_type || 'video/mp4');
        return c.body(data);
      }
    } catch (error: any) {
      return c.json({ error: 'Failed to stream video', code: 'DASHCAMVIDEOS_STREAM_VIDEO_ERROR' }, 500);
    }
  });

  // === GET /:id/links — List linked entities ===
  api.get('/:id/links', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const videoId = paramNum(c.req.param('id'));
      if (isNaN(videoId)) return c.json({ error: 'Invalid video ID', code: 'INVALID_VIDEO_ID' }, 400);

      const links = await db.prepare(`
        SELECT * FROM dashcam_video_links WHERE video_id = ? ORDER BY created_at DESC LIMIT 1000
      `).all(videoId);

      return c.json(links);
    } catch (error: any) {
      return c.json({ error: 'Failed to list video links', code: 'DASHCAMVIDEOS_LIST_VIDEO_LINKS' }, 500);
    }
  });

  // === POST /:id/links — Link video to entity ===
  api.post('/:id/links', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const videoId = paramNum(c.req.param('id'));
      if (isNaN(videoId)) return c.json({ error: 'Invalid video ID', code: 'INVALID_VIDEO_ID' }, 400);

      const body = await c.req.json();
      const { entity_type, entity_id, notes } = body;

      if (!entity_type || !entity_id) {
        return c.json({ error: 'entity_type and entity_id are required', code: 'ENTITYTYPE_AND_ENTITYID_ARE' }, 400);
      }

      const parsedEntityId = parseInt(String(entity_id), 10);
      if (isNaN(parsedEntityId) || parsedEntityId <= 0) {
        return c.json({ error: 'entity_id must be a positive integer', code: 'ENTITYID_MUST_BE_A' }, 400);
      }
      if (notes !== undefined && notes !== null && (typeof notes !== 'string' || notes.length > 2000)) {
        return c.json({ error: 'notes must be 2000 characters or less', code: 'NOTES_MUST_BE_2000' }, 400);
      }

      const validTypes = ['call', 'incident', 'case', 'warrant', 'citation'];
      if (!validTypes.includes(entity_type)) {
        return c.json({ error: `entity_type must be one of: ${validTypes.join(', ')}` }, 400);
      }

      const video = await db.prepare('SELECT id, title FROM dashcam_videos WHERE id = ?').get(videoId) as any;
      if (!video) return c.json({ error: 'Video not found', code: 'VIDEO_NOT_FOUND' }, 404);

      const existing = await db.prepare(
        'SELECT id FROM dashcam_video_links WHERE video_id = ? AND entity_type = ? AND entity_id = ?'
      ).get(videoId, entity_type, entity_id);
      if (existing) return c.json({ error: 'This link already exists', code: 'THIS_LINK_ALREADY_EXISTS' }, 409);

      const result = await db.prepare(`
        INSERT INTO dashcam_video_links (video_id, entity_type, entity_id, linked_by, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(videoId, entity_type, entity_id, user.username || 'unknown', notes || null, localNow());

      return c.json({ success: true, id: result.meta.last_row_id });
    } catch (error: any) {
      return c.json({ error: 'Failed to link video', code: 'DASHCAMVIDEOS_LINK_VIDEO_ERROR' }, 500);
    }
  });

  // === DELETE /:id/links/:linkId — Remove link ===
  api.delete('/:id/links/:linkId', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const linkId = paramNum(c.req.param('linkId'));
      if (isNaN(linkId)) return c.json({ error: 'Invalid link ID', code: 'INVALID_LINK_ID' }, 400);

      const link = await db.prepare('SELECT * FROM dashcam_video_links WHERE id = ?').get(linkId) as any;
      if (!link) return c.json({ error: 'Link not found', code: 'LINK_NOT_FOUND' }, 404);

      await db.prepare('DELETE FROM dashcam_video_links WHERE id = ?').run(linkId);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to unlink video', code: 'DASHCAMVIDEOS_UNLINK_VIDEO_ERROR' }, 500);
    }
  });

  // === POST /webhook/clearpathgps — ClearPathGPS webhook (multipart) ===
  api.post('/webhook/clearpathgps', async (c) => {
    try {
      const formData = await c.req.formData();
      const videoFile = formData.get('video');

      const db = new D1Db(c.env.DB);
      const safeStrLocal = (v: any, maxLen: number): string | null =>
        v != null ? String(v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, maxLen) : null;

      const device_id = safeStrLocal(formData.get('device_id'), 100);
      const device_name = safeStrLocal(formData.get('device_name'), 200);
      const event_type = safeStrLocal(formData.get('event_type'), 100);
      const event_timestamp = safeStrLocal(formData.get('event_timestamp'), 50);
      const address = safeStrLocal(formData.get('address'), 500);
      const unit_call_sign = safeStrLocal(formData.get('unit_call_sign'), 50);
      const vehicle_number = safeStrLocal(formData.get('vehicle_number'), 50);
      const speed_mph_raw = formData.get('speed_mph');
      const latitude_raw = formData.get('latitude');
      const longitude_raw = formData.get('longitude');
      const speed_mph = speed_mph_raw != null ? parseFloat(String(speed_mph_raw)) : null;
      const latitude = latitude_raw != null ? parseFloat(String(latitude_raw)) : null;
      const longitude = longitude_raw != null ? parseFloat(String(longitude_raw)) : null;

      if ((latitude != null && (isNaN(latitude) || latitude < -90 || latitude > 90)) ||
          (longitude != null && (isNaN(longitude) || longitude < -180 || longitude > 180)) ||
          (speed_mph != null && (isNaN(speed_mph) || speed_mph < 0 || speed_mph > 999))) {
        return c.json({ error: 'Invalid numeric values', code: 'INVALID_NUMERIC_VALUES' }, 400);
      }

      // Resolve unit from device mapping or call sign
      let unitId: number | null = null;
      let vehicleId: number | null = null;

      if (device_id) {
        const mapping = await db.prepare('SELECT unit_id FROM cpg_device_mappings WHERE cpg_device_id = ? AND is_active = 1').get(device_id) as any;
        if (mapping) unitId = mapping.unit_id;
      }
      if (!unitId && unit_call_sign) {
        const unit = await db.prepare('SELECT id FROM units WHERE call_sign = ?').get(unit_call_sign) as any;
        if (unit) unitId = unit.id;
      }
      if (vehicle_number) {
        const vehicle = await db.prepare('SELECT id FROM fleet_vehicles WHERE vehicle_number = ?').get(vehicle_number) as any;
        if (vehicle) vehicleId = vehicle.id;
      } else if (unitId) {
        const fv = await db.prepare('SELECT id FROM fleet_vehicles WHERE assigned_unit_id = ?').get(unitId) as any;
        if (fv) vehicleId = fv.id;
      }

      const now = localNow();
      const title = `${event_type || 'camera_event'} -- ${device_name || device_id || 'ClearPathGPS'} -- ${event_timestamp || now}`;

      if (videoFile && videoFile instanceof File) {
        // Upload video to R2
        const ext = videoFile.name.split('.').pop() || 'mp4';
        const r2Key = `dashcam/webhook_${Date.now()}_${crypto.randomUUID().slice(0, 12)}.${ext}`;
        const fileBuffer = await videoFile.arrayBuffer();
        await c.env.UPLOADS.put(r2Key, fileBuffer, {
          httpMetadata: { contentType: videoFile.type || 'video/mp4' },
        });

        const result = await db.prepare(`
          INSERT INTO dashcam_videos
            (vehicle_id, unit_id, title, file_path, file_size, mime_type,
             recorded_at, speed_mph, latitude, longitude, address,
             notes, source, uploaded_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'clearpathgps', 'webhook', ?, ?)
        `).run(
          vehicleId, unitId, title, r2Key, videoFile.size,
          videoFile.type || 'video/mp4',
          event_timestamp || now, speed_mph, latitude, longitude, address,
          `Auto-captured: ${event_type || 'camera_event'}. Device: ${device_name || device_id || 'unknown'}`,
          now, now,
        );

        return c.json({ success: true, video_id: result.meta.last_row_id });
      } else {
        return c.json({ success: true, message: 'Event received, no video file attached' });
      }
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // === GET /:id/auto-correlate — Auto-correlate video to calls/incidents ===
  api.get('/:id/auto-correlate', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const videoId = paramNum(c.req.param('id'));
      if (isNaN(videoId)) return c.json({ error: 'Invalid video ID' }, 400);

      const video = await db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(videoId) as any;
      if (!video) return c.json({ error: 'Video not found' }, 404);

      const correlations: any[] = [];
      const recordedAt = video.recorded_at || video.created_at;

      if (recordedAt) {
        // Calls within +/- 30 minutes
        const callsNearby = await db.prepare(`
          SELECT id, call_number, incident_type, status, location_address, latitude, longitude, created_at
          FROM calls_for_service
          WHERE ABS(CAST((julianday(created_at) - julianday(?)) * 24 * 60 AS INTEGER)) <= 30
          ORDER BY ABS(julianday(created_at) - julianday(?))
          LIMIT 10
        `).all(recordedAt, recordedAt) as any[];

        for (const call of callsNearby) {
          let distance_mi: number | null = null;
          if (video.latitude && video.longitude && call.latitude && call.longitude) {
            const R = 3958.8;
            const dLat = (call.latitude - video.latitude) * Math.PI / 180;
            const dLng = (call.longitude - video.longitude) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(video.latitude * Math.PI / 180) * Math.cos(call.latitude * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
            distance_mi = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100) / 100;
          }
          correlations.push({
            entity_type: 'call', entity_id: call.id, identifier: call.call_number,
            type: call.incident_type, location: call.location_address, time: call.created_at,
            distance_mi, confidence: distance_mi !== null && distance_mi < 0.31 ? 'high' : distance_mi !== null && distance_mi < 1.24 ? 'medium' : 'low',
          });
        }

        // Incidents in the same time window
        const incidentsNearby = await db.prepare(`
          SELECT id, incident_number, incident_type, status, location_address, latitude, longitude, created_at
          FROM incidents
          WHERE ABS(CAST((julianday(created_at) - julianday(?)) * 24 * 60 AS INTEGER)) <= 30
          ORDER BY ABS(julianday(created_at) - julianday(?))
          LIMIT 10
        `).all(recordedAt, recordedAt) as any[];

        for (const inc of incidentsNearby) {
          correlations.push({
            entity_type: 'incident', entity_id: inc.id, identifier: inc.incident_number,
            type: inc.incident_type, location: inc.location_address, time: inc.created_at,
            distance_mi: null, confidence: 'medium',
          });
        }
      }

      const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
      correlations.sort((a, b) => (order[a.confidence] || 2) - (order[b.confidence] || 2));

      return c.json({ video_id: videoId, correlations });
    } catch (error: any) {
      return c.json({ error: 'Failed to auto-correlate', code: 'DASHCAM_AUTOCORRELATE_ERROR' }, 500);
    }
  });

  // === GET /quality/report — Video quality monitoring ===
  api.get('/quality/report', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);

      const missingMetadata = await db.prepare(`
        SELECT id, title, recorded_at, created_at,
          CASE
            WHEN recorded_at IS NULL THEN 'missing_recorded_at'
            WHEN duration_seconds IS NULL OR duration_seconds = 0 THEN 'missing_duration'
            WHEN file_size IS NULL OR file_size = 0 THEN 'missing_file_size'
            WHEN latitude IS NULL AND longitude IS NULL THEN 'missing_gps'
            ELSE 'ok'
          END as issue
        FROM dashcam_videos
        WHERE recorded_at IS NULL OR duration_seconds IS NULL OR duration_seconds = 0
          OR file_size IS NULL OR file_size = 0
        ORDER BY created_at DESC LIMIT 50
      `).all() as any[];

      const qualityStats = await db.prepare(`
        SELECT
          COUNT(*) as total_videos,
          AVG(file_size) as avg_file_size,
          AVG(CASE WHEN duration_seconds > 0 THEN file_size * 1.0 / duration_seconds ELSE NULL END) as avg_bytes_per_second,
          MIN(file_size) as min_file_size,
          MAX(file_size) as max_file_size,
          SUM(file_size) as total_storage_bytes,
          AVG(duration_seconds) as avg_duration_seconds
        FROM dashcam_videos WHERE file_size > 0
      `).get() as any;

      const bySource = await db.prepare(`
        SELECT source, COUNT(*) as count, SUM(file_size) as total_bytes,
          AVG(duration_seconds) as avg_duration
        FROM dashcam_videos GROUP BY source
      `).all() as any[];

      const suspiciouslySmall = await db.prepare(`
        SELECT id, title, file_size, duration_seconds, created_at
        FROM dashcam_videos WHERE file_size > 0 AND file_size < 50000
        ORDER BY created_at DESC LIMIT 20
      `).all() as any[];

      return c.json({
        total_videos: qualityStats?.total_videos || 0,
        avg_file_size_mb: qualityStats?.avg_file_size ? Math.round(qualityStats.avg_file_size / 1024 / 1024 * 10) / 10 : 0,
        avg_bitrate_kbps: qualityStats?.avg_bytes_per_second ? Math.round(qualityStats.avg_bytes_per_second * 8 / 1024) : 0,
        total_storage_gb: qualityStats?.total_storage_bytes ? Math.round(qualityStats.total_storage_bytes / 1024 / 1024 / 1024 * 100) / 100 : 0,
        missing_metadata: missingMetadata,
        missing_metadata_count: missingMetadata.length,
        suspiciously_small: suspiciouslySmall,
        by_source: bySource,
      });
    } catch (error: any) {
      return c.json({ error: 'Failed to get quality report', code: 'DASHCAM_QUALITY_REPORT_ERROR' }, 500);
    }
  });

  // === GET /storage/usage — Storage usage tracking ===
  api.get('/storage/usage', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);

      const total = await db.prepare(`
        SELECT COUNT(*) as count, COALESCE(SUM(file_size), 0) as total_bytes FROM dashcam_videos
      `).get() as any;

      const byClassification = await db.prepare(`
        SELECT classification, COUNT(*) as count, COALESCE(SUM(file_size), 0) as total_bytes
        FROM dashcam_videos GROUP BY classification ORDER BY total_bytes DESC
      `).all() as any[];

      const byVehicle = await db.prepare(`
        SELECT COALESCE(fv.vehicle_number, 'Unassigned') as vehicle,
          COUNT(*) as count, COALESCE(SUM(v.file_size), 0) as total_bytes
        FROM dashcam_videos v LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
        GROUP BY v.vehicle_id ORDER BY total_bytes DESC LIMIT 20
      `).all() as any[];

      const monthlyTrend = await db.prepare(`
        SELECT strftime('%Y-%m', created_at) as month,
          COUNT(*) as count, COALESCE(SUM(file_size), 0) as total_bytes
        FROM dashcam_videos
        WHERE created_at >= datetime('now', '-12 months')
        GROUP BY month ORDER BY month
      `).all() as any[];

      return c.json({
        total_videos: total.count,
        total_storage_gb: Math.round(total.total_bytes / 1024 / 1024 / 1024 * 100) / 100,
        by_classification: byClassification.map((c: any) => ({ ...c, total_gb: Math.round(c.total_bytes / 1024 / 1024 / 1024 * 100) / 100 })),
        by_vehicle: byVehicle.map((v: any) => ({ ...v, total_gb: Math.round(v.total_bytes / 1024 / 1024 / 1024 * 100) / 100 })),
        monthly_trend: monthlyTrend.map((m: any) => ({ ...m, total_gb: Math.round(m.total_bytes / 1024 / 1024 / 1024 * 100) / 100 })),
      });
    } catch (error: any) {
      return c.json({ error: 'Failed to get storage usage', code: 'DASHCAM_STORAGE_USAGE_ERROR' }, 500);
    }
  });

  // === GET /export/csv — Dashcam video CSV export ===
  api.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT v.id, v.title, v.file_size, v.duration_seconds, v.mime_type,
          v.recorded_at, v.case_number, v.classification, v.speed_mph,
          v.latitude, v.longitude, v.address, v.source, v.uploaded_by,
          v.notes, v.created_at,
          fv.vehicle_number, u.call_sign as unit_call_sign
        FROM dashcam_videos v
        LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
        LEFT JOIN units u ON v.unit_id = u.id
        ORDER BY v.recorded_at DESC LIMIT 10000
      `).all();

      const headers = ['ID', 'Title', 'Vehicle', 'Unit', 'Recorded At', 'Case Number', 'Classification', 'Duration (sec)', 'File Size (bytes)', 'Speed (mph)', 'Latitude', 'Longitude', 'Address', 'Source', 'Uploaded By', 'Notes', 'Created At'];
      const csvRows = (rows as any[]).map((r: any) => [r.id, r.title, r.vehicle_number, r.unit_call_sign, r.recorded_at, r.case_number, r.classification, r.duration_seconds, r.file_size, r.speed_mph, r.latitude, r.longitude, r.address, r.source, r.uploaded_by, r.notes, r.created_at]);
      const csv = [headers.join(','), ...csvRows.map((r: any[]) => r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','))].join('\n');

      c.header('Content-Type', 'text/csv');
      c.header('Content-Disposition', 'attachment; filename="dashcam_videos_export.csv"');
      return c.body(csv);
    } catch (error: any) {
      return c.json({ error: 'Export failed', code: 'EXPORT_FAILED' }, 500);
    }
  });

  // === POST /:id/burn — Queue HUD burn ===
  api.post('/:id/burn', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) return c.json({ error: 'Invalid video ID' }, 400);
      await db.prepare("UPDATE dashcam_videos SET burn_status = 'pending', updated_at = datetime('now') WHERE id = ?").run(id);
      return c.json({ success: true, message: 'HUD burn queued' });
    } catch (error: any) {
      return c.json({ error: 'Failed to queue burn', code: 'DASHCAM_BURN_ERROR' }, 500);
    }
  });

  app.route('/api/dashcam-videos', api);
}
