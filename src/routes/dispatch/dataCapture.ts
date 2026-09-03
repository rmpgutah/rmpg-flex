// src/routes/dispatch/dataCapture.ts
// ============================================================
// Dispatch Data Capture + Cross-reference Query Engine
// ============================================================
// Endpoints:
//   POST   /api/dispatch/capture/session            — create/upsert capture session
//   GET    /api/dispatch/capture/session/:callId    — get active session for a call
//   PUT    /api/dispatch/capture/session/:id        — save form state
//   POST   /api/dispatch/capture/session/:id/submit — commit session → cfs_subjects rows
//
//   POST   /api/dispatch/capture/subject            — attach a person to a call
//   GET    /api/dispatch/capture/subjects/:callId   — list subjects for a call
//   PATCH  /api/dispatch/capture/subject/:id        — update disposition / cross-links
//   DELETE /api/dispatch/capture/subject/:id        — remove from call (not from persons)
//
//   POST   /api/dispatch/capture/query              — cross-table PII query
//   GET    /api/dispatch/capture/query-log          — audit log (admin/supervisor)
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types';
import { query, queryFirst, execute, queryInChunks } from '../../utils/db';
import { recordAudit } from '../../utils/auditLog';
import { log } from '../../utils/logger';

const dataCapture = new Hono<Env>();

// ── Helpers ─────────────────────────────────────────────────

function actor(c: any) {
  const u = c.get('user');
  return { id: u?.user_id ?? u?.userId ?? u?.id ?? null, role: u?.role ?? '' };
}

function canViewPII(role: string): boolean {
  return ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'].includes(role);
}

// Normalize a query string for logging (strip extra whitespace, lowercase)
function normalizeQuery(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 500);
}

// ── Session endpoints ────────────────────────────────────────

// POST /session — create or return existing active session for a call
dataCapture.post('/session', async (c) => {
  const { id: userId, role } = actor(c);
  if (!canViewPII(role)) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<{ call_id: number; unit_id?: number }>();
  if (!body.call_id) return c.json({ error: 'call_id required' }, 400);

  // Reuse active session if one exists for this call
  const existing = await queryFirst<{ id: number }>(
    c.env.DB,
    `SELECT id FROM dispatch_capture_sessions WHERE call_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
    body.call_id
  );
  if (existing) return c.json({ session_id: existing.id, created: false });

  const result = await execute(
    c.env.DB,
    `INSERT INTO dispatch_capture_sessions (call_id, unit_id, dispatcher_id, caller_data, subjects_data, vehicles_data, status)
     VALUES (?, ?, ?, '{}', '[]', '[]', 'active')`,
    body.call_id, body.unit_id ?? null, userId
  );
  return c.json({ session_id: result.meta.last_row_id, created: true }, 201);
});

// GET /session/:callId — get active session for a call
dataCapture.get('/session/:callId', async (c) => {
  const { role } = actor(c);
  if (!canViewPII(role)) return c.json({ error: 'Forbidden' }, 403);

  const callId = Number(c.req.param('callId'));
  const session = await queryFirst(
    c.env.DB,
    `SELECT * FROM dispatch_capture_sessions WHERE call_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
    callId
  );
  return c.json(session ?? null);
});

// PUT /session/:id — save form state (autosave)
dataCapture.put('/session/:id', async (c) => {
  const { id: userId, role } = actor(c);
  if (!canViewPII(role)) return c.json({ error: 'Forbidden' }, 403);

  const sessionId = Number(c.req.param('id'));
  const body = await c.req.json<{
    caller_data?: Record<string, unknown>;
    subjects_data?: unknown[];
    vehicles_data?: unknown[];
    notes?: string;
  }>();

  const session = await queryFirst<{ id: number; dispatcher_id: number | null }>(
    c.env.DB,
    `SELECT id, dispatcher_id FROM dispatch_capture_sessions WHERE id = ? AND status = 'active'`,
    sessionId
  );
  if (!session) return c.json({ error: 'Session not found or not active' }, 404);
  if (session.dispatcher_id !== null && session.dispatcher_id !== userId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await execute(
    c.env.DB,
    `UPDATE dispatch_capture_sessions
     SET caller_data = COALESCE(?, caller_data),
         subjects_data = COALESCE(?, subjects_data),
         vehicles_data = COALESCE(?, vehicles_data),
         notes = COALESCE(?, notes),
         updated_at = datetime('now')
     WHERE id = ?`,
    body.caller_data ? JSON.stringify(body.caller_data) : null,
    body.subjects_data ? JSON.stringify(body.subjects_data) : null,
    body.vehicles_data ? JSON.stringify(body.vehicles_data) : null,
    body.notes ?? null,
    sessionId
  );
  return c.json({ ok: true });
});

// POST /session/:id/submit — commit session data into cfs_subjects rows
dataCapture.post('/session/:id/submit', async (c) => {
  const { id: userId, role } = actor(c);
  if (!canViewPII(role)) return c.json({ error: 'Forbidden' }, 403);

  const sessionId = Number(c.req.param('id'));
  const session = await queryFirst<{
    id: number; call_id: number; dispatcher_id: number | null;
    subjects_data: string; caller_data: string;
  }>(
    c.env.DB,
    `SELECT id, call_id, dispatcher_id, subjects_data, caller_data FROM dispatch_capture_sessions WHERE id = ? AND status = 'active'`,
    sessionId
  );
  if (!session) return c.json({ error: 'Session not found or not active' }, 404);
  if (session.dispatcher_id !== null && session.dispatcher_id !== userId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  let subjects: any[] = [];
  let callerData: any = {};
  try {
    subjects = JSON.parse(session.subjects_data || '[]');
    callerData = JSON.parse(session.caller_data || '{}');
  } catch {
    return c.json({ error: 'Corrupt session data' }, 400);
  }

  const subjectIds: number[] = [];

  // Insert caller as a subject if we have enough data and no person_id yet.
  // Also back-fill caller_name / caller_phone on the parent CFS record so they
  // appear in the call header and CSV exports (these fields were silently dropped
  // before because cfs_subjects has no name/phone columns of its own).
  if (callerData.name || callerData.phone) {
    // Build a narrative that includes the name/phone so it survives in cfs_subjects
    const callerNarrative = [
      callerData.description,
      callerData.name ? `Name: ${callerData.name}` : null,
      callerData.phone ? `Phone: ${callerData.phone}` : null,
    ].filter(Boolean).join('; ') || null;

    const r = await execute(
      c.env.DB,
      `INSERT INTO cfs_subjects (call_id, person_id, role, relationship_to_call, description_narrative, captured_by)
       VALUES (?, ?, 'caller', ?, ?, ?)`,
      session.call_id,
      callerData.person_id ?? null,
      callerData.relationship ?? null,
      callerNarrative,
      userId
    );
    subjectIds.push(r.meta.last_row_id as number);

    // Persist caller identity to the parent call row (COALESCE keeps existing
    // dispatcher-entered data if the call was created manually first).
    try {
      await execute(
        c.env.DB,
        `UPDATE calls_for_service
         SET caller_name  = COALESCE(NULLIF(caller_name,''),  ?),
             caller_phone = COALESCE(NULLIF(caller_phone,''), ?),
             updated_at   = datetime('now')
         WHERE id = ?`,
        callerData.name  ?? null,
        callerData.phone ?? null,
        session.call_id,
      );
    } catch (err) {
      log.error('dataCapture: caller field update failed (non-fatal)', { callId: session.call_id }, err as Error);
    }
  }

  // Insert each captured subject
  for (const s of subjects) {
    const r = await execute(
      c.env.DB,
      `INSERT INTO cfs_subjects
         (call_id, person_id, role, relationship_to_call, description_narrative,
          last_seen_location, last_seen_at, direction_of_travel, vehicle_description,
          vehicle_record_id, warrant_id, person_intel_id, captured_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      session.call_id,
      s.person_id ?? null,
      s.role ?? 'contact',
      s.relationship_to_call ?? null,
      s.description_narrative ?? null,
      s.last_seen_location ?? null,
      s.last_seen_at ?? null,
      s.direction_of_travel ?? null,
      s.vehicle_description ?? null,
      s.vehicle_record_id ?? null,
      s.warrant_id ?? null,
      s.person_intel_id ?? null,
      userId
    );
    subjectIds.push(r.meta.last_row_id as number);
  }

  // Mark session submitted
  await execute(
    c.env.DB,
    `UPDATE dispatch_capture_sessions SET status='submitted', submitted_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
    sessionId
  );

  await recordAudit(c, {
    action: 'dispatch.capture.submit',
    entityType: 'calls_for_service',
    entityId: session.call_id,
    details: JSON.stringify({ sessionId, subjectCount: subjectIds.length }),
    actorId: userId,
  });

  return c.json({ ok: true, subject_ids: subjectIds });
});

// ── Subject endpoints ────────────────────────────────────────

// POST /subject — directly attach a person to a call (no session needed)
dataCapture.post('/subject', async (c) => {
  const { id: userId, role } = actor(c);
  if (!canViewPII(role)) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<{
    call_id: number;
    person_id?: number;
    role?: string;
    relationship_to_call?: string;
    description_narrative?: string;
    last_seen_location?: string;
    last_seen_at?: string;
    direction_of_travel?: string;
    vehicle_description?: string;
    vehicle_record_id?: number;
    warrant_id?: number;
  }>();
  if (!body.call_id) return c.json({ error: 'call_id required' }, 400);

  const result = await execute(
    c.env.DB,
    `INSERT INTO cfs_subjects
       (call_id, person_id, role, relationship_to_call, description_narrative,
        last_seen_location, last_seen_at, direction_of_travel, vehicle_description,
        vehicle_record_id, warrant_id, captured_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    body.call_id,
    body.person_id ?? null,
    body.role ?? 'contact',
    body.relationship_to_call ?? null,
    body.description_narrative ?? null,
    body.last_seen_location ?? null,
    body.last_seen_at ?? null,
    body.direction_of_travel ?? null,
    body.vehicle_description ?? null,
    body.vehicle_record_id ?? null,
    body.warrant_id ?? null,
    userId
  );

  return c.json({ ok: true, id: result.meta.last_row_id }, 201);
});

// GET /subjects/:callId — all subjects attached to a call, with person join
dataCapture.get('/subjects/:callId', async (c) => {
  const { role } = actor(c);
  if (!canViewPII(role)) return c.json({ error: 'Forbidden' }, 403);

  const callId = Number(c.req.param('callId'));
  const rows = await query(
    c.env.DB,
    `SELECT
       s.*,
       p.first_name, p.last_name, p.middle_name, p.dob, p.phone, p.email,
       p.address, p.city, p.state, p.zip, p.race, p.gender,
       p.height_feet, p.height_inches, p.hair_color, p.eye_color,
       p.caution_flags, p.flags, p.photo_url,
       p.dl_number, p.dl_state,
       p.alias_nickname, p.aliases,
       p.ncic_number, p.fbi_number
     FROM cfs_subjects s
     LEFT JOIN persons p ON p.id = s.person_id
     WHERE s.call_id = ?
     ORDER BY s.captured_at ASC`,
    callId
  );
  return c.json(rows);
});

// PATCH /subject/:id — update disposition or cross-links
dataCapture.patch('/subject/:id', async (c) => {
  const { id: userId, role } = actor(c);
  if (!canViewPII(role)) return c.json({ error: 'Forbidden' }, 403);

  const subjectId = Number(c.req.param('id'));
  const body = await c.req.json<{
    located?: boolean;
    arrested?: boolean;
    disposition?: string;
    person_id?: number;
    vehicle_record_id?: number;
    warrant_id?: number;
    person_intel_id?: number;
    last_seen_location?: string;
    direction_of_travel?: string;
  }>();

  const callId = Number(c.req.query('call_id'));
  if (!callId) return c.json({ error: 'call_id is required' }, 400);
  const result = await execute(
    c.env.DB,
    `UPDATE cfs_subjects SET
       located = COALESCE(?, located),
       arrested = COALESCE(?, arrested),
       disposition = COALESCE(?, disposition),
       person_id = COALESCE(?, person_id),
       vehicle_record_id = COALESCE(?, vehicle_record_id),
       warrant_id = COALESCE(?, warrant_id),
       person_intel_id = COALESCE(?, person_intel_id),
       last_seen_location = COALESCE(?, last_seen_location),
       direction_of_travel = COALESCE(?, direction_of_travel),
       updated_at = datetime('now')
     WHERE id = ? AND call_id = ?`,
    body.located != null ? (body.located ? 1 : 0) : null,
    body.arrested != null ? (body.arrested ? 1 : 0) : null,
    body.disposition ?? null,
    body.person_id ?? null,
    body.vehicle_record_id ?? null,
    body.warrant_id ?? null,
    body.person_intel_id ?? null,
    body.last_seen_location ?? null,
    body.direction_of_travel ?? null,
    subjectId, callId
  );
  if (result.meta.changes === 0) return c.json({ error: 'Subject not found on this call' }, 404);
  return c.json({ ok: true });
});

// DELETE /subject/:id?call_id= — detach a subject from its call.
// call_id is required to prevent cross-call deletes: an officer on Call A
// cannot silently destroy a subject record that belongs to Call B.
dataCapture.delete('/subject/:id', async (c) => {
  const { id: userId, role } = actor(c);
  if (!['admin', 'manager', 'supervisor', 'dispatcher'].includes(role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const subjectId = Number(c.req.param('id'));
  const callId = Number(c.req.query('call_id'));
  if (!callId) return c.json({ error: 'call_id is required' }, 400);

  const result = await execute(
    c.env.DB,
    `DELETE FROM cfs_subjects WHERE id = ? AND call_id = ?`,
    subjectId, callId,
  );
  if (result.meta.changes === 0) {
    return c.json({ error: 'Subject not found on this call' }, 404);
  }
  return c.json({ ok: true });
});

// ── Cross-table PII query ────────────────────────────────────

// POST /query — unified person/vehicle/warrant search across all local sources
// Returns hits from: persons, dl_records, vehicles_records, warrants,
//                    skiptracer_dossiers, person_intelligence, field_contacts (if table exists)
dataCapture.post('/query', async (c) => {
  const { id: userId, role } = actor(c);
  if (!canViewPII(role)) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<{
    name?: string;
    first_name?: string;
    last_name?: string;
    dob?: string;
    phone?: string;
    email?: string;
    plate?: string;
    address?: string;
    dl_number?: string;
    call_id?: number;
  }>();

  const hasInput = Object.values(body).some(v => v && String(v).trim());
  if (!hasInput) return c.json({ error: 'At least one search field required' }, 400);

  const results: Record<string, unknown[]> = {
    persons: [],
    dl_records: [],
    vehicles: [],
    warrants: [],
    dossiers: [],
    person_intel: [],
    call_history: [],
  };
  const sourceTables: string[] = [];

  // ── persons ──────────────────────────────────────────────
  const personClauses: string[] = [];
  const personBinds: unknown[] = [];

  if (body.name) {
    const n = `%${body.name.trim().slice(0, 48)}%`;
    personClauses.push(`(first_name || ' ' || last_name LIKE ? OR alias_nickname LIKE ? OR aliases LIKE ?)`);
    personBinds.push(n, n, n);
  }
  if (body.first_name) { personClauses.push(`first_name LIKE ?`); personBinds.push(`%${String(body.first_name).slice(0, 48)}%`); }
  if (body.last_name) { personClauses.push(`last_name LIKE ?`); personBinds.push(`%${String(body.last_name).slice(0, 48)}%`); }
  if (body.dob) { personClauses.push(`dob = ?`); personBinds.push(body.dob); }
  if (body.phone) {
    const ph = body.phone.replace(/\D/g, '');
    personClauses.push(`(REPLACE(REPLACE(REPLACE(phone,'-',''),'(',''),')','') LIKE ? OR REPLACE(REPLACE(REPLACE(phone_secondary,'-',''),'(',''),')','') LIKE ?)`);
    personBinds.push(`%${ph}%`, `%${ph}%`);
  }
  if (body.email) { const emailPat = `%${String(body.email).slice(0, 48)}%`; personClauses.push(`(email LIKE ? OR email_secondary LIKE ?)`); personBinds.push(emailPat, emailPat); }
  if (body.address) { personClauses.push(`address LIKE ?`); personBinds.push(`%${String(body.address).slice(0, 48)}%`); }
  if (body.dl_number) { personClauses.push(`dl_number = ?`); personBinds.push(body.dl_number.toUpperCase()); }

  if (personClauses.length > 0) {
    try {
      const personRows = await query(
        c.env.DB,
        `SELECT id, first_name, middle_name, last_name, dob, gender, race,
                phone, phone_secondary, email, email_secondary,
                address, city, state, zip,
                dl_number, dl_state, alias_nickname, aliases,
                caution_flags, flags, is_sex_offender,
                ncic_number, fbi_number, sor_number,
                photo_url, updated_at
         FROM persons
         WHERE ${personClauses.join(' OR ')}
         LIMIT 50`,
        ...personBinds
      );
      results.persons = personRows;
      if (personRows.length > 0) sourceTables.push('persons');
    } catch (e) {
      log.error('query persons failed', {}, e as Error);
    }
  }

  // ── dl_records ───────────────────────────────────────────
  if (body.name || body.dl_number || body.dob || body.address) {
    const dlClauses: string[] = [];
    const dlBinds: unknown[] = [];
    if (body.name) { dlClauses.push(`full_name LIKE ?`); dlBinds.push(`%${body.name.trim().slice(0, 48)}%`); }
    if (body.dl_number) { dlClauses.push(`dl_number = ?`); dlBinds.push(body.dl_number.toUpperCase()); }
    if (body.dob) { dlClauses.push(`dob = ?`); dlBinds.push(body.dob); }
    if (body.address) { dlClauses.push(`address LIKE ?`); dlBinds.push(`%${String(body.address).slice(0, 48)}%`); }
    try {
      const dlRows = await query(
        c.env.DB,
        `SELECT id, dl_number, dl_state, full_name, dob, gender, address, city, state, zip,
                eye_color, hair_color, height, weight, class, expires_at, captured_at
         FROM dl_records
         WHERE ${dlClauses.join(' OR ')}
         LIMIT 25`,
        ...dlBinds
      );
      results.dl_records = dlRows;
      if (dlRows.length > 0) sourceTables.push('dl_records');
    } catch (e) {
      log.error('query dl_records failed', {}, e as Error);
    }
  }

  // ── vehicles_records ─────────────────────────────────────
  if (body.plate || body.name) {
    const vClauses: string[] = [];
    const vBinds: unknown[] = [];
    if (body.plate) {
      vClauses.push(`UPPER(TRIM(plate_number)) = ?`);
      vBinds.push(body.plate.toUpperCase().trim());
    }
    if (body.name) {
      vClauses.push(`registered_owner LIKE ?`);
      vBinds.push(`%${body.name.trim().slice(0, 48)}%`);
    }
    try {
      const vRows = await query(
        c.env.DB,
        `SELECT id, plate_number, plate_state, vin, year, make, model, color_primary,
                registered_owner, is_stolen, stolen_status, watchlist_flags,
                lien_holder, title_status, updated_at
         FROM vehicles_records
         WHERE ${vClauses.join(' OR ')}
         LIMIT 25`,
        ...vBinds
      );
      results.vehicles = vRows;
      if (vRows.length > 0) sourceTables.push('vehicles_records');
    } catch (e) {
      log.error('query vehicles_records failed', {}, e as Error);
    }
  }

  // ── warrants ─────────────────────────────────────────────
  if (body.name || body.dob) {
    const wClauses: string[] = [];
    const wBinds: unknown[] = [];
    if (body.name) {
      wClauses.push(`subject_name LIKE ?`);
      wBinds.push(`%${body.name.trim().slice(0, 48)}%`);
    }
    if (body.dob) { wClauses.push(`subject_dob = ?`); wBinds.push(body.dob); }
    try {
      const wRows = await query(
        c.env.DB,
        `SELECT id, warrant_number, subject_name, subject_dob, charge_description,
                status, warrant_type, bail_amount, issuing_court, issued_date,
                is_felony, extraditable
         FROM warrants
         WHERE (${wClauses.join(' OR ')}) AND status IN ('active','issued','outstanding')
         LIMIT 25`,
        ...wBinds
      );
      results.warrants = wRows;
      if (wRows.length > 0) sourceTables.push('warrants');
    } catch (e) {
      log.error('query warrants failed', {}, e as Error);
    }
  }

  // ── skiptracer_dossiers ──────────────────────────────────
  if (body.name || body.phone || body.email) {
    const sdClauses: string[] = [];
    const sdBinds: unknown[] = [];
    if (body.name) { sdClauses.push(`subject_name LIKE ?`); sdBinds.push(`%${body.name.trim().slice(0, 48)}%`); }
    if (body.phone) { sdClauses.push(`subject_phone LIKE ?`); sdBinds.push(`%${body.phone.replace(/\D/g, '').slice(-7)}%`); }
    if (body.email) { sdClauses.push(`subject_email LIKE ?`); sdBinds.push(`%${String(body.email).slice(0, 48)}%`); }
    try {
      const sdRows = await query(
        c.env.DB,
        `SELECT id, subject_name, subject_dob, subject_address, subject_phone,
                subject_email, notes, created_at
         FROM skiptracer_dossiers
         WHERE ${sdClauses.join(' OR ')}
         LIMIT 20`,
        ...sdBinds
      );
      results.dossiers = sdRows;
      if (sdRows.length > 0) sourceTables.push('skiptracer_dossiers');
    } catch (e) {
      log.error('query skiptracer_dossiers failed', {}, e as Error);
    }
  }

  // ── person_intelligence ──────────────────────────────────
  if (body.name || body.dob || body.phone || body.plate || body.email) {
    const piClauses: string[] = [];
    const piBinds: unknown[] = [];
    if (body.name) { piClauses.push(`subject_name LIKE ?`); piBinds.push(`%${body.name.trim().slice(0, 48)}%`); }
    if (body.dob) { piClauses.push(`subject_dob = ?`); piBinds.push(body.dob); }
    // JSON seed search for phone/plate/email
    if (body.phone) { piClauses.push(`subject_seed LIKE ?`); piBinds.push(`%${body.phone.replace(/\D/g, '').slice(-7)}%`); }
    if (body.email) { piClauses.push(`subject_seed LIKE ?`); piBinds.push(`%${String(body.email).slice(0, 48)}%`); }
    if (body.plate) { piClauses.push(`subject_seed LIKE ?`); piBinds.push(`%${body.plate.toUpperCase()}%`); }
    try {
      const piRows = await query(
        c.env.DB,
        `SELECT id, subject_name, subject_dob, status, phase, risk_score, risk_flags,
                linked_person_id, data_points_found, created_at, completed_at
         FROM person_intelligence
         WHERE ${piClauses.join(' OR ')}
         LIMIT 20`,
        ...piBinds
      );
      results.person_intel = piRows;
      if (piRows.length > 0) sourceTables.push('person_intelligence');
    } catch (e) {
      log.error('query person_intelligence failed', {}, e as Error);
    }
  }

  // ── Call history for matched persons ─────────────────────
  // If we found person IDs, pull their call history
  const matchedPersonIds = (results.persons as any[]).map((p: any) => p.id);
  if (matchedPersonIds.length > 0) {
    try {
      const callRowsRaw = await queryInChunks(
        c.env.DB,
        matchedPersonIds,
        (placeholders) =>
          `SELECT s.person_id, c.id, c.call_number, c.incident_type, c.priority,
                  c.status, c.location_address, c.created_at, c.disposition
           FROM cfs_subjects s
           JOIN calls_for_service c ON c.id = s.call_id
           WHERE s.person_id IN (${placeholders})`
      );
      const callRows = (callRowsRaw as any[])
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 50);
      results.call_history = callRows;
      if (callRows.length > 0) sourceTables.push('cfs_subjects');
    } catch (e) {
      log.error('query call_history failed', {}, e as Error);
    }
  }

  // ── Audit log ─────────────────────────────────────────────
  const queryType = body.plate ? 'plate'
    : body.dl_number ? 'dl_number'
    : body.dob ? 'dob'
    : body.phone ? 'phone'
    : body.email ? 'email'
    : body.address ? 'address'
    : 'name';

  const queryInput = normalizeQuery(
    body.plate ?? body.dl_number ?? body.name ??
    body.phone ?? body.email ?? body.address ?? body.dob ?? ''
  );

  const totalHits = Object.values(results).reduce((s, arr) => s + arr.length, 0);

  try {
    await execute(
      c.env.DB,
      `INSERT INTO subject_query_log (queried_by, query_type, query_input, hit_count, source_tables, call_id)
       VALUES (?,?,?,?,?,?)`,
      userId, queryType, queryInput, totalHits,
      JSON.stringify(sourceTables), body.call_id ?? null
    );
  } catch (e) {
    log.error('subject_query_log insert failed', {}, e as Error);
  }

  return c.json({ results, sources: sourceTables, total_hits: totalHits });
});

// ── Query audit log (admin/supervisor) ──────────────────────

dataCapture.get('/query-log', async (c) => {
  const { id: userId, role } = actor(c);
  if (!['admin', 'manager', 'supervisor'].includes(role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const offset = Number(c.req.query('offset') ?? 0);
  const queriedBy = c.req.query('user_id');

  let sql = `SELECT q.*, u.full_name AS queried_by_name
             FROM subject_query_log q
             LEFT JOIN users u ON u.id = q.queried_by`;
  const binds: unknown[] = [];
  if (queriedBy) { sql += ` WHERE q.queried_by = ?`; binds.push(Number(queriedBy)); }
  sql += ` ORDER BY q.queried_at DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const rows = await query(c.env.DB, sql, ...binds);
  return c.json(rows);
});

export default dataCapture;
