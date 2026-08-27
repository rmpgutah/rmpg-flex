import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, executeInChunks } from '../utils/db';
import { normalizeDob } from '../utils/normalizeDob';
import { codedLike, containsAnyClause } from '../utils/searchText';
import { recordAudit } from '../utils/auditLog';
import { screenPersonForSor } from '../utils/screening/nsopwAdapter';
import { lookupFailedCoverage, LOOKUP_OK } from '../utils/screening/coverage';
import { log } from '../utils/logger';
import { tryRepairAndRetry } from '../utils/repairFts';
import { upsertDlRecord } from './dlRecords';

import { dbErrorResponse } from '../utils/dbErrors';
import { toDisplayLabel } from '../utils/displayLabel';
import { decodeVinCached } from '../utils/vinDecoder';
const records = new Hono<Env>();

// Inline role gate — same pattern as admin.ts. Destructive / chain-of-custody
// operations must not be reachable by every authenticated role (client_viewer
// included). Returns an error string when the caller's role is insufficient.
function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// ── Sentinel clients for parentless property rows ──────────────
// properties.client_id is NOT NULL and FKs to clients(id), but some rows
// have no natural parent client: a DL-scan address (the address printed on
// a license) and an unaffiliated business/intel record. Mirror the
// serve-intake sentinel pattern (utils/serveIntakeRecords.ts): create one
// named client the first time it's needed and reuse it forever, so the FK
// target always exists and these rows stay filterable by sentinel name.
async function ensureSentinelClient(db: D1Database, name: string, notes: string): Promise<number> {
  const found = await queryFirst<{ id: number }>(
    db, 'SELECT id FROM clients WHERE name = ? LIMIT 1', name);
  if (found) return found.id;
  const result = await execute(db,
    `INSERT INTO clients (name, contact_name, status, notes) VALUES (?, 'system', 'active', ?)`,
    name, notes);
  return Number(result.meta.last_row_id);
}
const ensureScanSentinelClient = (db: D1Database) =>
  ensureSentinelClient(db, 'Field Intelligence — Scanned',
    'Auto-created for scan/field-imported property rows (DL scanner). Do not delete — used as the default client_id for those rows.');
// Sentinel for hand-entered property rows with no parent client (the Records
// "Add property" form sends client_id: null when the user leaves the client
// blank). Without this, the NOT NULL properties.client_id constraint 500s the
// create/update — the twin of the DL-scan path above.
const ensureUnaffiliatedSentinelClient = (db: D1Database) =>
  ensureSentinelClient(db, 'Unaffiliated — No Client',
    'Auto-created for hand-entered property records with no parent client. Do not delete — used as the default client_id for those rows.');

// Resolve a usable client_id for a properties write: the supplied positive
// numeric id, else the reusable "Unaffiliated" sentinel. properties.client_id
// is NOT NULL + FKs clients(id), so null/0/'' would otherwise trip the
// constraint at write time rather than at validation time.
async function resolvePropertyClientId(db: D1Database, raw: unknown): Promise<number> {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return ensureUnaffiliatedSentinelClient(db);
}

// GET /records/properties
records.get('/properties', async (c) => {
  try {
    const db = getDb(c.env);
    const { search, client_id, archived } = c.req.query();
    // LEFT JOIN clients for client_name: PropertiesTab displays it, searches it
    // and sorts by it, but `properties` has only client_id — so before this join
    // client_name was ALWAYS undefined and all three silently did nothing.
    // Every bare column below must stay p.-qualified: clients also has a `name`,
    // so an unqualified `name` is ambiguous and D1 rejects the statement.
    let sql = 'SELECT p.*, c.name AS client_name FROM properties p LEFT JOIN clients c ON p.client_id = c.id';
    const params: unknown[] = [];
    const wheres: string[] = [];
    // client_name is searched on BOTH sides deliberately. Server-side (c.name
    // here) so a client-name search reaches every property rather than only the
    // 500 this endpoint returns; client-side (PropertiesTab.tsx:284) so the
    // narrowing still feels instant with no round-trip. The two must stay in
    // sync — a column searchable here but not there returns rows the local
    // filter then hides, which reads as "search is broken".
    if (search) { const m = containsAnyClause(['p.name', 'p.address', 'c.name']); wheres.push(m.sql); params.push(...m.binds(search)); }
    if (client_id) { wheres.push('p.client_id = ?'); params.push(client_id); }
    if (archived === 'true') wheres.push('p.archived_at IS NOT NULL');
    else if (archived !== 'all') wheres.push('(p.archived_at IS NULL)');
    if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
    sql += ' ORDER BY p.name LIMIT 500';
    const rows = await query<Record<string, unknown>>(db, sql, ...params);
    return c.json(rows);
  } catch (err) {
    log.error('GET /properties failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

const PROPERTY_WRITABLE_COLUMNS = new Set([
  'name', 'address', 'address_2', 'city', 'state', 'zip', 'client_id', 'property_type',
  'gate_code', 'alarm_code', 'emergency_contact', 'post_orders', 'hazard_notes',
  'access_instructions', 'latitude', 'longitude', 'is_active', 'notes',
  'business_type', 'structure_type', 'occupancy_status', 'year_built',
  'square_footage', 'number_of_stories', 'security_features',
  'key_holder_name', 'key_holder_phone', 'key_holder_relationship',
  'owner_name', 'owner_phone', 'last_inspection_date', 'inspection_status',
  'alarm_company', 'alarm_account', 'alarm_system', 'camera_system',
  'parking_info', 'roof_access', 'utility_shutoffs', 'known_hazards',
  'contact_email', 'secondary_contact_name', 'secondary_contact_phone',
  'patrol_frequency', 'opening_hours', 'closing_hours',
  // Assessor-sourced columns (migration 0142). `year_built` was already
  // writable above (pre-existing column from 0037); the rest are new.
  'parcel_number', 'owner_of_record', 'owner_type', 'owner_mailing_address',
  'total_market_value', 'land_sqft',
  'last_sale_date', 'last_sale_price', 'legal_description', 'tax_district',
  'assessor_last_synced_at', 'assessor_source_url',
]);

// POST /records/properties
records.post('/properties', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.name) return c.json({ error: 'name is required' }, 400);
    // properties.client_id is NOT NULL — fall back to the Unaffiliated sentinel
    // when no valid client is supplied so a parentless property still saves.
    const clientId = await resolvePropertyClientId(db, body.client_id);
    const cols: string[] = ['created_at', 'client_id'];
    const vals: unknown[] = [clientId];
    const placeholders: string[] = ["datetime('now')", '?'];
    for (const [key, val] of Object.entries(body)) {
      if (key === 'client_id') continue; // resolved above
      if (PROPERTY_WRITABLE_COLUMNS.has(key)) { cols.push(key); vals.push(val ?? null); placeholders.push('?'); }
    }
    const result = await execute(db, `INSERT INTO properties (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`, ...vals);
    const created = await queryFirst(db, 'SELECT * FROM properties WHERE id = ?', Number(result.meta.last_row_id));
    return c.json(created, 201);
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// PUT /records/properties/:id
records.put('/properties/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM properties WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Property not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    const cols: string[] = []; const params: unknown[] = [];
    for (const [key, val] of Object.entries(body)) {
      if (!PROPERTY_WRITABLE_COLUMNS.has(key)) continue;
      // client_id is NOT NULL: clearing the client on edit must resolve to the
      // Unaffiliated sentinel, not UPDATE ... SET client_id = NULL (would 500).
      if (key === 'client_id') { cols.push('client_id = ?'); params.push(await resolvePropertyClientId(db, val)); }
      else { cols.push(`${key} = ?`); params.push(val ?? null); }
    }
    if (cols.length === 0) return c.json({ message: 'No changes' });
    await execute(db, `UPDATE properties SET ${cols.join(', ')} WHERE id = ?`, ...params, id);
    const updated = await queryFirst(db, 'SELECT * FROM properties WHERE id = ?', id);
    return c.json(updated);
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// GET /records/properties/export — CSV download. Must be registered before
// /properties/:id so Hono does not match "export" as the :id segment.
records.get('/properties/export', async (c): Promise<Response> => {
  try {
    const db = getDb(c.env);
    const { archived } = c.req.query();
    const sql = `SELECT * FROM properties WHERE ${archived === 'true' ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'} ORDER BY name LIMIT 50000`;
    const rows = await query<Record<string, unknown>>(db, sql);
    if (rows.length === 0) return c.newResponse('', 200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=properties_export.csv' });
    const keys = ['name', 'address', 'city', 'state', 'zip', 'property_type', 'client_id', 'is_active', 'notes'];
    const csv = [keys.join(','), ...rows.map((r) => keys.map((k) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    return c.newResponse(csv, 200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=properties_export.csv' });
  } catch (err) {
    log.error('GET /properties/export failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// GET /records/properties/:id — fetch a single property.
records.get('/properties/:id', async (c): Promise<Response> => {
  try {
    const db = getDb(c.env);
    // client_name via LEFT JOIN — see GET /properties for why (detail panel
    // renders the Client block from it).
    const row = await queryFirst(db,
      'SELECT p.*, c.name AS client_name FROM properties p LEFT JOIN clients c ON p.client_id = c.id WHERE p.id = ?',
      c.req.param('id'));
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(row);
  } catch (err) {
    log.error('GET /properties/:id failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// DELETE /records/properties/:id — hard delete + remove junction rows.
records.delete('/properties/:id', async (c): Promise<Response> => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    await execute(db, "DELETE FROM record_links WHERE (source_type = 'property' AND source_id = ?) OR (target_type = 'property' AND target_id = ?)", id, id);
    await execute(db, 'DELETE FROM properties WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /properties/:id failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// POST /records/properties/:id/archive — soft-delete.
records.post('/properties/:id/archive', async (c): Promise<Response> => {
  try {
    const db = getDb(c.env);
    await execute(db, "UPDATE properties SET archived_at = datetime('now') WHERE id = ?", c.req.param('id'));
    return c.json({ success: true });
  } catch (err) {
    log.error('POST /properties/:id/archive failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// POST /records/properties/:id/unarchive — restore.
records.post('/properties/:id/unarchive', async (c): Promise<Response> => {
  try {
    const db = getDb(c.env);
    await execute(db, 'UPDATE properties SET archived_at = NULL WHERE id = ?', c.req.param('id'));
    return c.json({ success: true });
  } catch (err) {
    log.error('POST /properties/:id/unarchive failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// All writable columns on the persons table, sourced from the legacy
// database.ts addCol() calls + initial CREATE TABLE. Covers the full
// PersonFormData interface (~80 fields) so no field is silently dropped
// on create or edit. Excludes legal-entity fields (role_tag, entity_type,
// bar_number, firm_name) which are stored in the same table but managed
// by the legal module. BOOLEAN-ish columns (is_sex_offender, is_veteran)
// are coerced to 0/1 integers.
const PERSON_WRITABLE_COLUMNS = new Set([
  'first_name', 'last_name', 'middle_name', 'alias_nickname', 'suffix',
  'dob', 'gender', 'race', 'nationality', 'aliases',
  'height', 'height_feet', 'height_inches', 'weight',
  'build', 'complexion', 'hair_color', 'hair_length', 'hair_style',
  'eye_color', 'facial_hair', 'glasses', 'shoe_size',
  'scars_marks_tattoos', 'clothing_description',
  'address', 'address_2', 'city', 'state', 'zip', 'phone', 'phone_secondary',
  'home_phone', 'work_phone', 'email', 'email_secondary',
  'dl_number', 'dl_state', 'dl_expiry', 'dl_class',
  'dl_issue_date', 'dl_restrictions', 'dl_endorsements',
  'ssn_last4', 'ssn_full',
  'photo_url', 'photo', 'id_image_url',
  'id_type', 'id_number', 'id_state', 'id_expiry',
  'employer', 'occupation',
  'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
  'language', 'gang_affiliation',
  'is_sex_offender', 'is_veteran',
  'place_of_birth', 'citizenship', 'marital_status',
  'probation_parole', 'probation_parole_officer',
  'known_associates', 'social_media',
  'caution_flags', 'flags', 'notes',
  'ncic_number', 'sor_number', 'fbi_number',
  'state_id_number', 'passport_number', 'passport_country',
  'immigration_status', 'disability_flags', 'mental_health_flags',
  'substance_abuse', 'medication_notes',
  'education_level', 'military_branch', 'military_status',
  'tribal_affiliation',
  'tattoo_description', 'scar_description', 'piercing_description',
  'distinguishing_features', 'identifying_marks_location',
  'date_last_seen', 'location_last_seen', 'alias_dob',
  'watchlist_match', 'watchlist_checked_at',
  'voice_description', 'religion', 'dietary_restrictions',
  'blood_type',
]);

// Overflow columns. `persons` is at the D1 100-column SELECT-result cap, so these
// newer demographic fields live in the 1:1 `persons_ext` table (migration 0081),
// NOT on `persons` — adding them to `persons` would push `SELECT * FROM persons`
// past 100 cols ("too many columns in result set") and trip the column-cap CI
// guard. These keys are still in PERSON_WRITABLE_COLUMNS (they're valid input);
// the write loops below route them to persons_ext instead of persons, and reads
// merge them back via mergePersonExt(). Same pattern as calls_for_service_ext.
const PERSON_EXT_COLUMNS = new Set([
  'suffix', 'nationality', 'voice_description', 'religion', 'dietary_restrictions',
  'address_2', // apartment/unit number (persons at 96 cols — overflow only)
  // DL barcode fields (AAMVA PDF417 elements DCB/DCD/DBD) — mig 0155
  'dl_restrictions', 'dl_endorsements', 'dl_issue_date',
  // Full AAMVA field coverage (mig 0211) — was parsed by the scanner but
  // dropped on the way to D1 before this change.
  'country', 'document_discriminator', 'is_real_id', 'is_organ_donor',
  'under_18_until', 'under_21_until', 'aamva_version', 'issuer_id',
  'address2', 'raw_aamva_elements',
  // AoS ID capture — additional AAMVA fields (mig 0236)
  'place_of_birth', 'name_prefix', 'is_veteran', 'non_resident_indicator',
  'limited_duration_doc', 'card_revision_date', 'dl_hazmat_expiry', 'card_type',
]);
// Read projection excludes raw_aamva_elements: it's a raw barcode-element
// dump kept for potential forensic/debugging use, not something every
// authenticated caller (including client_viewer) should see on every
// person read. Still fully writable via PERSON_EXT_COLUMNS above.
const PERSON_EXT_READ_COLUMNS = [...PERSON_EXT_COLUMNS].filter(c => c !== 'raw_aamva_elements');
const PERSON_EXT_SELECT = PERSON_EXT_READ_COLUMNS.join(', ');

/** Upsert the overflow fields present in `body` into persons_ext (1:1 on
 *  person_id). No-op when the body carries none of them. */
export async function writePersonExt(
  db: ReturnType<typeof getDb>, personId: number | string, body: Record<string, unknown>,
): Promise<void> {
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const k of PERSON_EXT_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(body, k)) {
      cols.push(k);
      const v = body[k];
      // Serialize arrays/objects — D1 bind() rejects them (D1_TYPE_ERROR).
      vals.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : (v ?? null));
    }
  }
  if (cols.length === 0) return;
  const placeholders = cols.map(() => '?').join(', ');
  const setClause = cols.map((c) => `${c} = excluded.${c}`).join(', ');
  await execute(db,
    `INSERT INTO persons_ext (person_id, ${cols.join(', ')}) VALUES (?, ${placeholders})
     ON CONFLICT(person_id) DO UPDATE SET ${setClause}`,
    personId, ...vals);
}

/** Merge a person's persons_ext overflow fields onto the base row so callers see
 *  one flat object. Returns the row unchanged when it has no ext row yet. */
export async function mergePersonExt(
  db: ReturnType<typeof getDb>, person: Record<string, unknown> | null,
): Promise<Record<string, unknown> | null> {
  if (!person || person.id == null) return person;
  const ext = await queryFirst<Record<string, unknown>>(db,
    `SELECT ${PERSON_EXT_SELECT} FROM persons_ext WHERE person_id = ?`, person.id as number);
  return ext ? { ...person, ...ext } : person;
}

// POST /records/persons
records.post('/persons', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.first_name || !body.last_name) return c.json({ error: 'first_name and last_name required' }, 400);
    // Normalize DOB to ISO at the write boundary so age-matching + display
    // get a consistent format. normalizeDob returns null for unparseable
    // input (honest) rather than a guessed-wrong date.
    const normalizedDob = normalizeDob(typeof body.dob === 'string' ? body.dob : null);

    const cols: string[] = ['dob', 'created_at'];
    const vals: string[] = ['?', "datetime('now')"];
    const params: unknown[] = [normalizedDob];

    for (const [key, val] of Object.entries(body)) {
      if (key === 'dob' || key === 'created_at' || key === 'updated_at') continue;
      // Overflow fields go to persons_ext (below), not the base persons INSERT.
      if (PERSON_EXT_COLUMNS.has(key)) continue;
      if (PERSON_WRITABLE_COLUMNS.has(key)) {
        cols.push(key);
        vals.push('?');
        // Coerce boolean-ish fields to integer
        if (key === 'is_sex_offender' || key === 'is_veteran') {
          params.push(val ? 1 : 0);
        } else if (val !== null && typeof val === 'object') {
          // D1 bind() throws D1_TYPE_ERROR on arrays/objects (e.g. the DL
          // scanner's `flags: ['dl_ocr_imported']`). JSON-encode at the write
          // boundary — flags & *_flags columns are JSON-array TEXT anyway.
          params.push(JSON.stringify(val));
        } else {
          params.push(val ?? null);
        }
      }
    }

    const result = await tryRepairAndRetry(db,
      () => execute(db, `INSERT INTO persons (${cols.join(', ')}) VALUES (${vals.join(', ')})`, ...params),
      'persons_fts',
    );
    const newId = Number(result.meta.last_row_id);
    await writePersonExt(db, newId, body);
    const person = await mergePersonExt(db, await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM persons WHERE id = ?', newId));
    // Auto-screen new persons against NSOPW. Fire-and-forget: a SOR
    // miss/timeout must NOT block person creation. Confirmed hits land
    // in screening_hits and surface on PersonIntelPanel + dossier.
    c.executionCtx.waitUntil(
      screenPersonForSor(c.env, newId, { triggeredBy: 'person_create' })
        .catch((err) => console.warn('[nsopw] person_create screen failed:', err)),
    );
    return c.json(person, 201);
  } catch (err) {
    console.error('POST /records/persons failed:', err);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// ============================================================
// POST /records/from-dl-scan — one-shot create/link from a DL scan.
// Creates or reuses a Person (dedupe on dl_number, else name+DOB), an
// optional Vehicle (dedupe on plate, linked via owner_person_id), and a
// Property from the license address (dedupe on address). Everything that
// can be linked is linked; the response says what was created vs reused.
// ============================================================
records.post('/from-dl-scan', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{
      scan?: Record<string, unknown>;
      vehicle?: Record<string, unknown>;
      create_property?: boolean;
      call_id?: number;
    }>();
    const scan = body.scan ?? {};
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const first = str(scan.first_name);
    const last = str(scan.last_name);
    if (!first || !last) return c.json({ error: 'scan.first_name and scan.last_name required' }, 400);
    const dob = normalizeDob(str(scan.date_of_birth) ?? str(scan.dob));
    const dlNumber = str(scan.dl_number);

    // ── Person: reuse by DL number, else by exact name+DOB ──
    let person = dlNumber
      ? await queryFirst<Record<string, unknown>>(db,
          'SELECT * FROM persons WHERE dl_number = ? LIMIT 1', dlNumber)
      : null;
    if (!person && dob) {
      person = await queryFirst<Record<string, unknown>>(db,
        `SELECT * FROM persons WHERE lower(first_name) = lower(?) AND lower(last_name) = lower(?) AND dob = ? LIMIT 1`,
        first, last, dob);
    }
    let personCreated = false;
    if (!person) {
      // Passport/ID-card scans (iOS MRZ) carry document_number instead of
      // dl_number — persons is at the D1 column cap, so the doc number is
      // recorded in notes rather than a new column. Name+DOB dedupe above
      // still applies to those scans.
      const docType = str(scan.doc_type);
      const docNumber = str(scan.document_number);
      const note = docType && docType !== 'license'
        ? `Created from ${toDisplayLabel(docType)} scan${docNumber ? ` (doc# ${docNumber}${str(scan.issuing_country) ? `, ${str(scan.issuing_country)}` : ''})` : ''}`
        : 'Created from DL scan';
      // Booleans arrive from AamvaResult as `boolean | null`; coerce to
      // 0/1/null explicitly rather than binding a JS boolean (D1's bind()
      // behavior on raw booleans is not something to rely on).
      const boolToInt = (v: unknown): number | null => (v == null ? null : (v ? 1 : 0));
      const isVeteran = boolToInt(scan.is_veteran);

      const result = await execute(db, `
        INSERT INTO persons (first_name, middle_name, last_name, dob, gender, height, weight,
          eye_color, hair_color, address, city, state, zip, dl_number, dl_state,
          dl_expiry, dl_class, is_veteran, flags, notes, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`,
        first, str(scan.middle_name), last, dob, str(scan.gender), str(scan.height),
        str(scan.weight), str(scan.eye_color), str(scan.hair_color), str(scan.address),
        str(scan.city), str(scan.state), str(scan.zip), dlNumber, str(scan.dl_state),
        str(scan.dl_expiry), str(scan.dl_class), isVeteran,
        JSON.stringify(['dl_scan_imported']), note);
      const newPersonId = Number(result.meta.last_row_id);
      // Write every AAMVA overflow field to persons_ext — full field
      // coverage (mig 0211), not just the restrictions/endorsements/issue_date
      // subset from mig 0155.
      await writePersonExt(db, newPersonId, {
        suffix:                 str(scan.suffix),
        dl_restrictions:        str(scan.dl_restrictions),
        dl_endorsements:        str(scan.dl_endorsements),
        dl_issue_date:          str(scan.dl_issue_date),
        country:                str(scan.country),
        document_discriminator: str(scan.document_discriminator),
        is_real_id:             boolToInt(scan.is_real_id),
        is_organ_donor:         boolToInt(scan.is_organ_donor),
        under_18_until:         str(scan.under_18_until),
        under_21_until:         str(scan.under_21_until),
        aamva_version:          typeof scan.aamva_version === 'number' ? scan.aamva_version : null,
        issuer_id:              str(scan.issuer_id),
        address2:               str(scan.address2),
        raw_aamva_elements:     scan.raw_elements ?? null,
      });
      person = await mergePersonExt(db, await queryFirst<Record<string, unknown>>(db,
        'SELECT * FROM persons WHERE id = ?', newPersonId));
      personCreated = true;
    }
    const personId = Number(person!.id);
    if (personCreated) {
      // Auto-screen DL-scanned persons too. Same fire-and-forget posture.
      c.executionCtx.waitUntil(
        screenPersonForSor(c.env, personId, { triggeredBy: 'dl_scan_create' })
          .catch((err) => console.warn('[nsopw] dl_scan screen failed:', err)),
      );
    }

    // ── DL record: upsert in the same request so a scan populates both
    // persons and dl_records — previously two disconnected write paths. ──
    let dlRecordId: number | null = null;
    let dlRecordCreated = false;
    if (dlNumber) {
      try {
        const dlUpsert = await upsertDlRecord(db, {
          dl_number: dlNumber, dl_state: str(scan.dl_state),
          dl_class: str(scan.dl_class), dl_expiry: str(scan.dl_expiry),
          dl_issue_date: str(scan.dl_issue_date),
          dl_restrictions: str(scan.dl_restrictions), dl_endorsements: str(scan.dl_endorsements),
          first_name: first, middle_name: str(scan.middle_name), last_name: last, suffix: str(scan.suffix),
          date_of_birth: dob, gender: str(scan.gender), height: str(scan.height), weight: str(scan.weight),
          eye_color: str(scan.eye_color), hair_color: str(scan.hair_color),
          address: str(scan.address), address2: str(scan.address2), city: str(scan.city),
          address_state: str(scan.state), postal_code: str(scan.zip),
          source: 'DL_SCAN',
        });
        dlRecordId = dlUpsert.recordId;
        dlRecordCreated = dlUpsert.created;
      } catch (err) {
        console.warn('[from-dl-scan] dl_records upsert failed (non-fatal):', err);
      }
    }

    // ── Vehicle: optional; reuse by plate, always (re)link to the person ──
    let vehicle: Record<string, unknown> | null = null;
    let vehicleCreated = false;
    const plate = str(body.vehicle?.plate_number);
    if (plate) {
      vehicle = await queryFirst<Record<string, unknown>>(db,
        'SELECT * FROM vehicles_records WHERE upper(plate_number) = upper(?) LIMIT 1', plate);
      if (vehicle) {
        if (vehicle.owner_person_id == null) {
          await execute(db, 'UPDATE vehicles_records SET owner_person_id = ? WHERE id = ?', personId, vehicle.id);
          vehicle = { ...vehicle, owner_person_id: personId };
        }
      } else {
        const v = body.vehicle!;
        const result = await execute(db, `
          INSERT INTO vehicles_records (plate_number, state, vin, make, model, year, color,
            owner_person_id, registered_owner, notes, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'))`,
          plate, str(v.plate_state) ?? str(v.state) ?? str(scan.dl_state), str(v.vin), str(v.make), str(v.model),
          str(v.year), str(v.color), personId, `${first} ${last}`, 'Created from DL scan');
        vehicle = await queryFirst<Record<string, unknown>>(db,
          'SELECT * FROM vehicles_records WHERE id = ?', Number(result.meta.last_row_id));
        vehicleCreated = true;
      }
    }

    // ── Property: from the license address; reuse on exact address match ──
    let property: Record<string, unknown> | null = null;
    let propertyCreated = false;
    const address = str(scan.address);
    if (body.create_property !== false && address) {
      property = await queryFirst<Record<string, unknown>>(db,
        'SELECT * FROM properties WHERE lower(address) = lower(?) LIMIT 1', address);
      if (!property) {
        // properties.client_id is NOT NULL + FK → clients(id); DL-scan
        // addresses have no parent client, so attach the scan sentinel.
        const sentinelClientId = await ensureScanSentinelClient(db);
        const result = await execute(db, `
          INSERT INTO properties (client_id, name, address, city, state, zip, property_type,
            occupancy_status, owner_name, notes, is_active, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?, 1, datetime('now'))`,
          sentinelClientId, address, address, str(scan.city), str(scan.state), str(scan.zip),
          'residential', 'occupied', `${first} ${last}`,
          `Created from DL scan — listed address of ${first} ${last}`);
        property = await queryFirst<Record<string, unknown>>(db,
          'SELECT * FROM properties WHERE id = ?', Number(result.meta.last_row_id));
        propertyCreated = true;
      }
    }

    // ── Current call: auto-link the scanned subject to the call the
    // officer is scanning during, mirroring the existing ALPR call_vehicles
    // auto-link for scanned vehicles. Best-effort — a failure here must not
    // block person/dl_records/vehicle/property creation. ──
    let callLinked = false;
    let caseLinkedId: number | null = null;
    const callId = typeof body.call_id === 'number' ? body.call_id : null;
    if (callId) {
      try {
        const scannerUserId = (c.get('userId') as number | null | undefined) ?? null;
        await execute(db,
          `INSERT OR IGNORE INTO call_persons (call_id, person_id, role, added_by, added_at) VALUES (?, ?, 'subject', ?, datetime('now'))`,
          callId, personId, scannerUserId);
        callLinked = true;
      } catch (err) {
        console.warn('[from-dl-scan] call_persons link failed (non-fatal):', err);
      }
      try {
        const caseRow = await queryFirst<{ case_id: number }>(db,
          'SELECT case_id FROM case_calls WHERE call_id = ? LIMIT 1', callId);
        if (caseRow) {
          await execute(db,
            `INSERT OR IGNORE INTO case_person_links (case_id, person_id, relationship) VALUES (?, ?, 'linked')`,
            caseRow.case_id, personId);
          caseLinkedId = caseRow.case_id;
        }
      } catch (err) {
        console.warn('[from-dl-scan] case_person_links link failed (non-fatal):', err);
      }
    }

    // ── Warrants: backfill any orphaned warrant (entered by name/DOB text
    // only, never linked to a person row) that matches this subject, then
    // surface every active warrant now linked to them — whether just
    // backfilled or already linked before this scan. Best-effort. ──
    let warrantHits: Array<Record<string, unknown>> = [];
    if (dob) {
      try {
        const orphaned = await query<{ id: number; warrant_number: string | null }>(db,
          `SELECT id, warrant_number FROM warrants
           WHERE subject_person_id IS NULL AND LOWER(status) = 'active'
             AND LOWER(subject_first_name) = LOWER(?) AND LOWER(subject_last_name) = LOWER(?)
             AND subject_dob = ?`,
          first, last, dob);
        const result = await execute(db,
          `UPDATE warrants SET subject_person_id = ?
           WHERE subject_person_id IS NULL AND LOWER(status) = 'active'
             AND LOWER(subject_first_name) = LOWER(?) AND LOWER(subject_last_name) = LOWER(?)
             AND subject_dob = ?`,
          personId, first, last, dob);
        if ((result.meta.changes ?? 0) > 0 && orphaned.length > 0) {
          const warrantNumbers = orphaned.map(w => w.warrant_number ?? String(w.id)).join(', ');
          await recordAudit(c, {
            action: 'dl_scan_warrant_backfill',
            entityType: 'person',
            entityId: personId,
            details: `Linked warrant(s) ${warrantNumbers} to person ${first} ${last} (id ${personId}) via DL scan backfill`,
          });
        }
      } catch (err) {
        console.warn('[from-dl-scan] warrant backfill failed (non-fatal):', err);
      }
      try {
        warrantHits = await query<Record<string, unknown>>(db,
          // Live warrants columns are type / charge_description / bail_amount.
          // Aliased so the DL-scan response shape is unchanged.
          `SELECT id, warrant_number, type AS warrant_type,
                  charge_description AS offense_description,
                  bail_amount AS bond_amount, issuing_agency
           FROM warrants WHERE subject_person_id = ? AND LOWER(status) = 'active'`,
          personId);
      } catch (err) {
        console.warn('[from-dl-scan] warrant hit query failed (non-fatal):', err);
      }
    }

    // ── Prior calls / open cases: surfaced for officer awareness only —
    // never auto-written. A scan should not assert new case involvement
    // beyond the current call it's actually happening in (handled above). ──
    let priorCalls: Array<Record<string, unknown>> = [];
    let openCases: Array<Record<string, unknown>> = [];
    try {
      priorCalls = await query<Record<string, unknown>>(db,
        `SELECT c.id, c.call_number, c.incident_type, c.status, c.created_at
         FROM calls_for_service c JOIN call_persons cp ON c.id = cp.call_id
         WHERE cp.person_id = ? ORDER BY c.created_at DESC LIMIT 10`,
        personId);
    } catch (err) {
      console.warn('[from-dl-scan] prior calls query failed (non-fatal):', err);
    }
    try {
      openCases = await query<Record<string, unknown>>(db,
        `SELECT DISTINCT ca.id, ca.case_number, ca.title, ca.status
         FROM cases ca JOIN case_person_links cpl ON ca.id = cpl.case_id
         WHERE cpl.person_id = ? AND LOWER(ca.status) NOT IN ('closed', 'archived')
         ORDER BY ca.id DESC LIMIT 10`,
        personId);
    } catch (err) {
      console.warn('[from-dl-scan] open cases query failed (non-fatal):', err);
    }

    return c.json({
      person, person_created: personCreated,
      vehicle, vehicle_created: vehicleCreated,
      property, property_created: propertyCreated,
      dl_record_id: dlRecordId, dl_record_created: dlRecordCreated,
      call_linked: callLinked,
      case_linked_id: caseLinkedId,
      warrant_hits: warrantHits,
      prior_calls: priorCalls,
      open_cases: openCases,
    }, 201);
  } catch (err) {
    console.error('POST /records/from-dl-scan failed:', err);
    return dbErrorResponse(c, err, 'Failed to create linked records');
  }
});

// GET /records/persons/search
records.get('/persons/search', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query('q');
    if (!q || q.length < 2) return c.json([]);
    // Three person-search paths in this file each named a DIFFERENT column set:
    // this one (last/first/phone), /persons/alias-search (first/last only), and
    // the bulk /persons list (first/last/alias_nickname/phone/email/dl_number).
    // The bulk list was the most complete, so the two dedicated SEARCH
    // endpoints — the ones an officer actually types into — were the narrowest.
    // Aligned here, plus the alias and secondary-phone columns none of them had.
    const mq = containsAnyClause([
      'last_name', 'first_name', 'middle_name',
      'alias_nickname', 'aliases',
      'phone', 'phone_secondary', 'home_phone', 'work_phone',
      'email', 'dl_number',
    ]);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT * FROM persons
      WHERE ${mq.sql}
      ORDER BY last_name, first_name LIMIT 50
    `, ...mq.binds(q));
    return c.json(rows);
  } catch (err) {
    log.error('GET /persons/search failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// ── Persons extra endpoints (must be before /:id to avoid param capture) ──

// GET /records/persons/export — CSV export of all persons.
records.get('/persons/export', async (c) => {
  try {
    const db = getDb(c.env);
    const { archived } = c.req.query();
    let sql = 'SELECT * FROM persons';
    if (archived !== 'true') {
      sql += " WHERE (flags IS NULL OR flags = '[]' OR flags NOT LIKE '%archived%')";
    }
    sql += ' ORDER BY last_name, first_name LIMIT 50000';
    const rows = await query<Record<string, unknown>>(db, sql);
    if (rows.length === 0) return c.json([]);
    const keys = ['first_name','last_name','dob','gender','race','height','weight','hair_color','eye_color','address','phone','email'];
    const csv = [keys.join(','), ...rows.map((r: any) => keys.map((k: string) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    return c.newResponse(csv, 200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=persons_export.csv' });
  } catch (err) {
    log.error('GET /persons/export failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// POST /records/persons/check-duplicates — find potential duplicate persons.
records.post('/persons/check-duplicates', async (c) => {
  try {
    const db = getDb(c.env);
    const { first_name, last_name, dob } = await c.req.json<{ first_name?: string; last_name?: string; dob?: string }>();
    if (!first_name || !last_name) return c.json({ matches: [] });
    const matches = await query<Record<string, unknown>>(db,
      'SELECT id, first_name, last_name, dob, gender, race, address, phone FROM persons WHERE last_name = ? AND first_name = ?',
      last_name.trim(), first_name.trim());
    if (matches.length === 0 && dob) {
      const dobMatches = await query<Record<string, unknown>>(db,
        'SELECT id, first_name, last_name, dob, gender, race, address, phone FROM persons WHERE last_name = ? AND dob = ?',
        last_name.trim(), dob);
      return c.json({ matches: dobMatches });
    }
    return c.json({ matches });
  } catch (err) { return c.json({ matches: [] }); }
});

// GET /records/persons/duplicates — find potential duplicate pairs.
records.get('/persons/duplicates', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT a.id as id_a, a.first_name as first_name_a, a.last_name as last_name_a, a.dob as dob_a,
             b.id as id_b, b.first_name as first_name_b, b.last_name as last_name_b, b.dob as dob_b
      FROM persons a JOIN persons b ON a.last_name = b.last_name AND a.first_name = b.first_name AND a.id < b.id
      ORDER BY a.last_name, a.first_name LIMIT 200`);
    return c.json(rows);
  } catch (err) { return c.json([]); }
});

// POST /records/persons/merge — merge duplicate person records.
records.post('/persons/merge', async (c) => {
  try {
    const db = getDb(c.env);
    const { keep_id, merge_id } = await c.req.json<{ keep_id?: number; merge_id?: number }>();
    if (!keep_id || !merge_id || keep_id === merge_id) return c.json({ error: 'keep_id and merge_id required and must differ' }, 400);
    const [keep, merge] = await Promise.all([
      queryFirst<Record<string, unknown>>(db, 'SELECT * FROM persons WHERE id = ?', keep_id),
      queryFirst<Record<string, unknown>>(db, 'SELECT * FROM persons WHERE id = ?', merge_id),
    ]);
    if (!keep || !merge) return c.json({ error: 'One or both persons not found' }, 404);
    // Update FK references from merge_id to keep_id
    for (const t of ['vehicles_records', 'incident_persons', 'call_persons', 'warrants', 'criminal_history']) {
      try { await execute(db, `UPDATE ${t} SET person_id = ? WHERE person_id = ?`, keep_id, merge_id); } catch { /* table may not exist */ }
    }
    // warrants link the subject via subject_person_id on live (person_id is NULL),
    // so the generic loop above never re-points them — do it explicitly, or the
    // merged person's warrants orphan when the row is deleted below.
    try { await execute(db, 'UPDATE warrants SET subject_person_id = ? WHERE subject_person_id = ?', keep_id, merge_id); } catch { /* subject link optional */ }
    // serve_queue.recipient_person_id is a BARE column with NO FK constraint on
    // live D1 — D1 never cascades it. The generic loop above only touches tables
    // keyed on `person_id`, so without this the merged person's serve_queue rows
    // dangle at a deleted id after the DELETE below. Re-point to keep_id.
    try { await execute(db, 'UPDATE serve_queue SET recipient_person_id = ? WHERE recipient_person_id = ?', keep_id, merge_id); } catch { /* serve_queue optional */ }
    await execute(db, 'DELETE FROM persons WHERE id = ?', merge_id);
    return c.json({ success: true, keep_id });
  } catch (err) { return dbErrorResponse(c, err, 'Merge failed'); }
});

// GET /records/persons/alias-search — search by potential alias.
//
// This searched ONLY first_name and last_name, which made it functionally
// identical to a plain name search: the one endpoint whose entire purpose is
// finding people by alias could not match an alias at all. `persons` stores
// them in alias_nickname and aliases.
//
// Verified live: 'NIKITA' and 'BRAYDEN' are real alias_nickname values that
// returned 0 rows here. Same defect class as #3222/#3223 — a matcher naming
// fewer columns than the data lives in.
records.get('/persons/alias-search', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query('q');
    if (!q || q.length < 2) return c.json([]);
    const ma = containsAnyClause([
      'alias_nickname', 'aliases',
      'first_name', 'last_name', 'middle_name',
    ]);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT id, first_name, last_name, dob, gender, alias_nickname FROM persons WHERE ${ma.sql} ORDER BY last_name, first_name LIMIT 50`,
      ...ma.binds(q));
    return c.json(rows);
  } catch (err) { return c.json([]); }
});

// GET /records/persons/:id — fetch a single person by ID (full detail).
// Called by PersonsTab on selection, DispatchRecordPanel, RecordDetailWindow,
// and PrintRecordButton for cross-reference. Returns the full row so the
// client can render address, phone, flags, etc. without a second query.
records.get('/persons/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const person = await mergePersonExt(db, await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM persons WHERE id = ?', id));
    if (!person) return c.json({ error: 'Person not found' }, 404);
    return c.json(person);
  } catch (err) {
    console.error('GET /records/persons/:id failed:', err);
    return dbErrorResponse(c, err, 'Failed to get person');
  }
});

// PUT /records/persons/:id — update a person. Accepts the same fields as
// POST /persons. Returns the updated row on success.
records.put('/persons/:id', async (c) => {
  try {
    const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
    if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM persons WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Person not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    const cols: string[] = [];
    const params: unknown[] = [];

    let touchesExt = false;
    for (const [key, val] of Object.entries(body)) {
      if (key === 'id' || key === 'created_at' || key === 'updated_at') continue;
      // Overflow fields are upserted into persons_ext (below), not persons.
      if (PERSON_EXT_COLUMNS.has(key)) { touchesExt = true; continue; }
      if (PERSON_WRITABLE_COLUMNS.has(key)) {
        cols.push(`${key} = ?`);
        // Coerce boolean-ish fields to integer
        if (key === 'is_sex_offender' || key === 'is_veteran') {
          params.push(val ? 1 : 0);
        } else if (val !== null && typeof val === 'object') {
          // D1 bind() rejects arrays/objects (D1_TYPE_ERROR). Columns like
          // `flags` and `aliases` store JSON text, so serialize at the
          // boundary — a client sending flags: ['dl_ocr_imported'] would
          // otherwise crash the whole INSERT/UPDATE.
          params.push(JSON.stringify(val));
        } else {
          params.push(val ?? null);
        }
      }
    }

    if (cols.length === 0 && !touchesExt) return c.json({ message: 'No changes' });

    // Base columns (skip the UPDATE entirely if this edit only touched ext fields).
    // Wrapped in tryRepairAndRetry: the persons_au trigger writes into
    // persons_fts's shadow tables on every update, so a corrupted FTS index
    // (SQLITE_CORRUPT_VTAB) fails this UPDATE outright — self-heal and retry
    // once instead of surfacing the raw driver error to the client.
    if (cols.length > 0) {
      await tryRepairAndRetry(db,
        () => execute(db, `UPDATE persons SET ${cols.join(', ')} WHERE id = ?`, ...params, id),
        'persons_fts',
      );
    }
    await writePersonExt(db, id, body);
    const updated = await mergePersonExt(db, await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM persons WHERE id = ?', id));
    return c.json(updated);
  } catch (err) {
    console.error('PUT /records/persons/:id failed:', err);
    return dbErrorResponse(c, err, 'Failed to update person');
  }
});

// DELETE /records/persons/:id — hard-delete a person.
// The client also supports archiving (POST /.../archive) as a softer
// alternative; this path is the explicit "delete" button in the UI.
// If persons_fts is corrupt (SQLITE_CORRUPT_VTAB), the persons_ad trigger
// fails — we detect that and rebuild the FTS table before retrying.
records.delete('/persons/:id', async (c) => {
  try {
    const denied = requireRole(c, 'admin', 'manager', 'supervisor');
    if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM persons WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Person not found' }, 404);
    // D1 enforces FKs. persons(id) has RESTRICT children that block a bare
    // DELETE; the CASCADE children (incident_persons, case_person_links) clean
    // themselves. Resolve the RESTRICT ones first:
    //   call_persons          → junction rows; drop the person↔call links.
    //   vehicles_records.owner → detach (NULL); the vehicle record survives.
    // Also sweep the polymorphic record_links (no FK, so it would otherwise
    // leave orphan edges in the Connections graph).
    await execute(db, 'DELETE FROM call_persons WHERE person_id = ?', id);
    await execute(db, 'UPDATE vehicles_records SET owner_person_id = NULL WHERE owner_person_id = ?', id);
    await execute(db, "DELETE FROM record_links WHERE (source_type='person' AND source_id=?) OR (target_type='person' AND target_id=?)", id, id);
    // serve_queue.recipient_person_id is a BARE column with NO FK on live D1
    // (there is no serve_queue_persons cascade — the earlier comment was wrong),
    // so D1 never nulls it on delete. Detach explicitly or the serve_queue row
    // dangles at a deleted id (ghost recipient on the queue / route planner).
    try { await execute(db, 'UPDATE serve_queue SET recipient_person_id = NULL WHERE recipient_person_id = ?', id); } catch { /* serve_queue optional */ }
    // Detach (not delete) the person from records that should survive: a warrant
    // and its citations are real records that must not vanish with the person,
    // but they also must not dangle at a deleted id (ghost nodes in Connections).
    try { await execute(db, 'UPDATE warrants SET subject_person_id = NULL WHERE subject_person_id = ?', id); } catch { /* optional */ }
    try { await execute(db, 'UPDATE citations SET person_id = NULL WHERE person_id = ?', id); } catch { /* optional */ }
    // serve_receipts.recipient_person_id and client_person_links.person_id
    // are bare/NO-ACTION FKs (no ON DELETE clause) — unlike the CASCADE
    // children above, D1 rejects the parent DELETE outright when either
    // still points at this id. serve_receipts is a signed legal record and
    // must survive; detach the identity link like warrants/citations above.
    try { await execute(db, 'UPDATE serve_receipts SET recipient_person_id = NULL WHERE recipient_person_id = ?', id); } catch { /* optional */ }
    try { await execute(db, 'DELETE FROM client_person_links WHERE person_id = ?', id); } catch { /* optional */ }
    await tryRepairAndRetry(db,
      () => execute(db, 'DELETE FROM persons WHERE id = ?', id),
      'persons_fts',
    );
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /records/persons/:id failed', {}, err);
    return dbErrorResponse(c, err, 'Failed to delete person');
  }
});

// POST /records/persons/:id/archive — soft-delete by marking the person's
// flags JSON with an archived entry. The persons table has no dedicated
// archived_at column (near the D1 100-col cap), so we overload the existing
// flags TEXT field (a JSON array) by appending {"type":"archived"}.
// The search handler /persons/search does NOT filter by default — archived
// persons still appear in search results but the client's list view
// filters them client-side via showArchived state.
records.post('/persons/:id/archive', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const person = await queryFirst<{ id: number; flags: string }>(db, 'SELECT id, flags FROM persons WHERE id = ?', id);
    if (!person) return c.json({ error: 'Person not found' }, 404);

    const flags = (() => {
      try { const p = JSON.parse(person.flags || '[]'); return Array.isArray(p) ? p : []; } catch { return []; }
    })();
    const isArchived = flags.some((f: any) => typeof f === 'object' && f.type === 'archived');
    if (isArchived) return c.json({ message: 'Already archived' });

    flags.push({ type: 'archived', at: new Date().toISOString() });
    await execute(db, 'UPDATE persons SET flags = ? WHERE id = ?', JSON.stringify(flags), id);
    return c.json({ success: true, archived: true });
  } catch (err) {
    console.error('POST /records/persons/:id/archive failed:', err);
    return dbErrorResponse(c, err, 'Failed to archive person');
  }
});

// POST /records/persons/:id/unarchive — reverse the archive flag.
records.post('/persons/:id/unarchive', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const person = await queryFirst<{ id: number; flags: string }>(db, 'SELECT id, flags FROM persons WHERE id = ?', id);
    if (!person) return c.json({ error: 'Person not found' }, 404);

    const flags = (() => {
      try { const p = JSON.parse(person.flags || '[]'); return Array.isArray(p) ? p : []; } catch { return []; }
    })();
    const filtered = flags.filter((f: any) => !(typeof f === 'object' && f.type === 'archived'));
    if (filtered.length === flags.length) return c.json({ message: 'Not archived' });

    await execute(db, 'UPDATE persons SET flags = ? WHERE id = ?', JSON.stringify(filtered), id);
    return c.json({ success: true, archived: false });
  } catch (err) {
    console.error('POST /records/persons/:id/unarchive failed:', err);
    return dbErrorResponse(c, err, 'Failed to unarchive person');
  }
});

// ── Persons sub-resource endpoints ──

// GET /records/persons/:id/system-history — warrants, incidents, calls, citations for a person.
records.get('/persons/:id/system-history', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const [warrants, incidents, calls, citations] = await Promise.all([
      query<Record<string, unknown>>(db, `SELECT id, warrant_number, type, charge_description AS description, status, bail_amount, issuing_agency, issuing_court, issued_date, expires_at FROM warrants WHERE subject_person_id = ? ORDER BY created_at DESC LIMIT 50`, id),
      query<Record<string, unknown>>(db, 'SELECT i.id, i.incident_number, i.incident_type, i.status, i.created_at, i.location_address, ip.role FROM incidents i JOIN incident_persons ip ON i.id = ip.incident_id WHERE ip.person_id = ? ORDER BY i.created_at DESC LIMIT 50', id),
      query<Record<string, unknown>>(db, 'SELECT c.id, c.call_number, c.incident_type, c.status, c.created_at, c.location_address FROM calls_for_service c JOIN call_persons cp ON c.id = cp.call_id WHERE cp.person_id = ? ORDER BY c.created_at DESC LIMIT 50', id),
      query<Record<string, unknown>>(db, 'SELECT id, citation_number, type, violation_description, status, fine_amount, violation_date, court_date FROM citations WHERE person_id = ? ORDER BY created_at DESC LIMIT 50', id),
    ]);
    const activeWarrants = warrants.filter((w: any) => w.status === 'active');
    const activeCitations = citations.filter((c: any) => c.status === 'issued' || c.status === 'contested');
    const boloActive = false;
    return c.json({
      warrants,
      incidents,
      calls,
      citations,
      bolo_active: boloActive,
      summary: {
        total_warrants: warrants.length,
        active_warrants: activeWarrants.length,
        total_incidents: incidents.length,
        total_calls: calls.length,
        total_citations: citations.length,
        active_citations: activeCitations.length,
      },
    });
  } catch (err) {
    console.error('GET /records/persons/:id/system-history failed:', err);
    return c.json({ warrants: [], incidents: [], calls: [], citations: [], bolo_active: false, summary: { total_warrants: 0, active_warrants: 0, total_incidents: 0, total_calls: 0, total_citations: 0, active_citations: 0 } });
  }
});

// GET /records/persons/:id/criminal-history
records.get('/persons/:id/criminal-history', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const rows = await query<Record<string, unknown>>(db, 'SELECT * FROM criminal_history WHERE person_id = ? ORDER BY created_at DESC LIMIT 200', id);
    return c.json(rows);
  } catch (err) { return c.json([]); }
});

// POST /records/persons/:id/criminal-history
records.post('/persons/:id/criminal-history', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const body = await c.req.json<Record<string, unknown>>();
    const user = c.get('user') as { id: number } | undefined;
    if (!body.offense) return c.json({ error: 'offense required' }, 400);
    const result = await execute(db,
      `INSERT INTO criminal_history (person_id, record_type, offense, offense_level, statute, case_number, agency, jurisdiction, offense_date, disposition, disposition_date, sentence, source, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      id, body.record_type || 'arrest', body.offense, body.offense_level || null,
      body.statute || null, body.case_number || null, body.agency || null,
      body.jurisdiction || null, body.offense_date || null, body.disposition || null,
      body.disposition_date || null, body.sentence || null, body.source || null,
      body.notes || null, user?.id ?? null);
    const created = await queryFirst(db, 'SELECT * FROM criminal_history WHERE id = ?', Number(result.meta.last_row_id));
    return c.json(created, 201);
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

const CRIMINAL_HISTORY_WRITABLE = new Set([
  'record_type', 'offense', 'offense_level', 'statute', 'case_number',
  'agency', 'jurisdiction', 'offense_date', 'disposition', 'disposition_date',
  'sentence', 'source', 'notes',
]);

// PUT /records/criminal-history/:id
records.put('/criminal-history/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM criminal_history WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Record not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    const cols: string[] = []; const params: unknown[] = [];
    for (const [key, val] of Object.entries(body)) {
      if (CRIMINAL_HISTORY_WRITABLE.has(key)) { cols.push(`${key} = ?`); params.push(val ?? null); }
    }
    if (cols.length === 0) return c.json({ message: 'No changes' });
    await execute(db, `UPDATE criminal_history SET ${cols.join(', ')} WHERE id = ?`, ...params, id);
    const updated = await queryFirst(db, 'SELECT * FROM criminal_history WHERE id = ?', id);
    return c.json(updated);
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// DELETE /records/criminal-history/:id
records.delete('/criminal-history/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM criminal_history WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Record not found' }, 404);
    await execute(db, 'DELETE FROM criminal_history WHERE id = ?', id);
    return c.json({ ok: true, id: Number(id) });
  } catch (err) {
    log.error('DELETE /criminal-history/:id failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// GET /records/persons/:id/incidents — incidents involving this person.
records.get('/persons/:id/incidents', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const rows = await query<Record<string, unknown>>(db, 'SELECT i.id, i.incident_number, i.incident_type, i.status, i.created_at, i.location_address FROM incidents i JOIN incident_persons ip ON i.id = ip.incident_id WHERE ip.person_id = ? ORDER BY i.created_at DESC LIMIT 200', id);
    return c.json(rows);
  } catch (err) { return c.json([]); }
});

// GET /records/persons/:id/clients — client relationships for this person.
records.get('/persons/:id/clients', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const rows = await query<Record<string, unknown>>(db, 'SELECT cpl.*, cl.name as client_name FROM client_person_links cpl LEFT JOIN clients cl ON cpl.client_id = cl.id WHERE cpl.person_id = ? ORDER BY cpl.created_at DESC LIMIT 100', id);
    return c.json(rows);
  } catch (err) { return c.json([]); }
});

// GET /records/clients/:clientId/persons — persons linked to a client.
records.get('/clients/:clientId/persons', async (c) => {
  try {
    const db = getDb(c.env);
    const clientId = c.req.param('clientId');
    const rows = await query<Record<string, unknown>>(db,
      `SELECT cpl.*, p.first_name, p.last_name, (p.first_name || ' ' || p.last_name) AS full_name FROM client_person_links cpl LEFT JOIN persons p ON cpl.person_id = p.id WHERE cpl.client_id = ? ORDER BY cpl.created_at DESC LIMIT 100`, clientId);
    return c.json(rows);
  } catch (err) { return c.json([]); }
});

// POST /records/client-persons — create a client-person link.
records.post('/client-persons', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{ person_id?: number; client_id?: number; relationship?: string }>();
    if (!body.person_id || !body.client_id) return c.json({ error: 'person_id and client_id required' }, 400);
    const result = await db.prepare(
      "INSERT INTO client_person_links (person_id, client_id, relationship, created_at) VALUES (?, ?, ?, datetime('now'))")
      .bind(body.person_id, body.client_id, body.relationship || null)
      .run();
    return c.json({ success: true, id: result.meta?.last_row_id });
  } catch (err) {
    log.error('POST /client-persons failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed to create link' }, 500); }
});

// DELETE /records/client-persons/:linkId — remove a client-person link.
records.delete('/client-persons/:linkId', async (c) => {
  try {
    const db = getDb(c.env);
    const linkId = c.req.param('linkId');
    const existing = await queryFirst<Record<string, unknown>>(db, 'SELECT id FROM client_person_links WHERE id = ?', linkId);
    if (!existing) return c.json({ error: 'Link not found' }, 404);
    await execute(db, 'DELETE FROM client_person_links WHERE id = ?', linkId);
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /client-persons/:linkId failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed to delete link' }, 500); }
});

// All writable columns on vehicles_records sourced from legacy addCol() calls.
// Covers the full VehicleFormData interface (~50 fields).
const VEHICLE_WRITABLE_COLUMNS = new Set([
  'plate_number', 'state', 'registration_state', 'plate_type',
  'make', 'model', 'year', 'trim', 'color', 'secondary_color',
  'body_style', 'doors', 'vin', 'engine_type', 'fuel_type',
  'transmission', 'drive_type', 'odometer',
  'insurance_company', 'insurance_policy', 'insurance_expiry',
  'registration_expiry', 'owner_person_id',
  'owner_name', 'owner_address', 'owner_phone', 'owner_dl_number', 'owner_dob',
  'registered_owner', 'primary_driver_name', 'lien_holder',
  'commercial_vehicle', 'hazmat', 'vehicle_use',
  'stolen_status', 'stolen_date', 'recovery_date', 'ncic_entry_number',
  'tow_status', 'tow_company', 'tow_location', 'tow_date',
  'tow_lot_location', 'tow_release_date', 'tow_release_to', 'tow_reason',
  'title_status', 'exterior_condition', 'interior_condition',
  'estimated_value', 'window_tint', 'modifications', 'equipment_notes',
  'damage_description', 'distinguishing_features',
  'flags', 'notes',
]);

// GET /records/vehicles/decode-vin — NHTSA VIN decode with D1 cache.
// Must be registered BEFORE /vehicles/:id so Hono doesn't interpret
// 'decode-vin' as an :id param (even though :id is digit-constrained below,
// this guard is belt-and-suspenders for the POST route above).
records.get('/vehicles/decode-vin', async (c) => {
  try {
    const vin = c.req.query('vin');
    if (!vin || vin.length !== 17) return c.json({ error: 'Invalid VIN' }, 400);
    const db = getDb(c.env);
    const result = await decodeVinCached(db, vin.toUpperCase());
    return c.json(result);
  } catch (err) {
    log.error('GET /vehicles/decode-vin failed', { src: 'src/routes/records.ts' }, err);
    return c.json({ error: 'VIN decode failed' }, 500);
  }
});

// POST /records/vehicles
records.post('/vehicles', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.plate_number) return c.json({ error: 'plate_number required' }, 400);
    // Duplicate plate detection — same plate+state already on file.
    const dupCheck = await queryFirst<{ id: number }>(db,
      'SELECT id FROM vehicles_records WHERE plate_number = ? AND (state = ? OR (state IS NULL AND ? IS NULL)) LIMIT 1',
      String(body.plate_number),
      body.state ?? null,
      body.state ?? null,
    );
    if (dupCheck) return c.json({ error: 'duplicate', existing_id: dupCheck.id }, 409);
    const cols: string[] = [];
    const vals: string[] = [];
    const params: unknown[] = [];
    for (const [key, val] of Object.entries(body)) {
      if (key === 'created_at' || key === 'updated_at') continue;
      if (VEHICLE_WRITABLE_COLUMNS.has(key)) {
        cols.push(key);
        vals.push('?');
        if (key === 'commercial_vehicle' || key === 'hazmat') {
          params.push(val ? 1 : 0);
        } else if (key === 'doors') {
          params.push(val !== '' && val != null ? parseInt(String(val), 10) : null);
        } else {
          params.push(val ?? null);
        }
      }
    }
    cols.push('created_at');
    vals.push("datetime('now')");
    const result = await execute(db,
      `INSERT INTO vehicles_records (${cols.join(', ')}) VALUES (${vals.join(', ')})`, ...params);
    const newId = Number(result.meta.last_row_id);
    const vehicle = await queryFirst(db, 'SELECT * FROM vehicles_records WHERE id = ?', newId);
    // Audit trail — fire-and-forget via recordAudit (which uses waitUntil internally).
    recordAudit(c, {
      action: 'create',
      entityType: 'vehicle',
      entityId: newId,
      details: { plate_number: body.plate_number, state: body.state },
    }).catch(() => {/* never block response */});
    return c.json(vehicle, 201);
  } catch (err) {
    console.error('POST /records/vehicles failed:', err);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// GET /records/vehicles/search
records.get('/vehicles/search', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query('q');
    if (!q || q.length < 2) return c.json([]);
    const mq = containsAnyClause(['v.plate_number', 'v.vin', 'v.make', 'v.model']);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT v.*, p.first_name, p.last_name, p.first_name AS owner_first_name, p.last_name AS owner_last_name FROM vehicles_records v
      LEFT JOIN persons p ON v.owner_person_id = p.id
      WHERE ${mq.sql}
      ORDER BY v.plate_number LIMIT 50
    `, ...mq.binds(q));
    return c.json(rows);
  } catch (err) {
    log.error('GET /vehicles/search failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// GET /records/vehicles/:id — fetch a single vehicle by ID.
// :id is constrained to digits so it does NOT shadow the specific GET routes
// registered AFTER it (/vehicles/export, /vehicles/plate-lookup,
// /vehicles/bolo-check) — without the {[0-9]+} guard, Hono matched those as
// :id="plate-lookup" and the real handlers 404'd (broke the iOS plate run +
// any web caller). Vehicle ids are integer PKs.
records.get('/vehicles/:id{[0-9]+}', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const vehicle = await queryFirst<Record<string, unknown>>(db, 'SELECT v.*, p.first_name, p.last_name, p.first_name AS owner_first_name, p.last_name AS owner_last_name FROM vehicles_records v LEFT JOIN persons p ON v.owner_person_id = p.id WHERE v.id = ?', id);
    if (!vehicle) return c.json({ error: 'Vehicle not found' }, 404);
    return c.json(vehicle);
  } catch (err) { return dbErrorResponse(c, err, 'Failed to get vehicle'); }
});

// PUT /records/vehicles/:id — update a vehicle.
records.put('/vehicles/:id', async (c) => {
  try {
    const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
    if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM vehicles_records WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Vehicle not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    const cols: string[] = [];
    const params: unknown[] = [];
    for (const [key, val] of Object.entries(body)) {
      if (key === 'id' || key === 'created_at' || key === 'updated_at') continue;
      if (VEHICLE_WRITABLE_COLUMNS.has(key)) {
        cols.push(`${key} = ?`);
        if (key === 'commercial_vehicle' || key === 'hazmat') {
          params.push(val ? 1 : 0);
        } else if (key === 'doors') {
          params.push(val !== '' && val != null ? parseInt(String(val), 10) : null);
        } else {
          params.push(val ?? null);
        }
      }
    }
    // Sync is_stolen INTEGER whenever stolen_status is being written.
    if ('stolen_status' in body) {
      const sv = String(body.stolen_status ?? '');
      const isStolenInt = (sv === 'Stolen' || sv === 'Active') ? 1 : 0;
      cols.push('is_stolen = ?');
      params.push(isStolenInt);
    }
    if (cols.length === 0) return c.json({ message: 'No changes' });
    cols.push("updated_at = datetime('now')");
    const updatedCols = cols.filter(c => c !== "updated_at = datetime('now')");
    await execute(db, `UPDATE vehicles_records SET ${cols.join(', ')} WHERE id = ?`, ...params, id);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT v.*, p.first_name, p.last_name FROM vehicles_records v LEFT JOIN persons p ON v.owner_person_id = p.id WHERE v.id = ?', id);
    // Audit trail.
    recordAudit(c, {
      action: 'update',
      entityType: 'vehicle',
      entityId: Number(id),
      details: { fields: updatedCols },
    }).catch(() => {/* never block response */});
    return c.json(updated);
  } catch (err) {
    console.error('PUT /records/vehicles/:id failed:', err);
    return dbErrorResponse(c, err, 'Failed to update vehicle');
  }
});

// DELETE /records/vehicles/:id
records.delete('/vehicles/:id', async (c) => {
  try {
    const denied = requireRole(c, 'admin', 'manager', 'supervisor');
    if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM vehicles_records WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Vehicle not found' }, 404);
    // FK children: call_vehicles is RESTRICT (blocks the delete); incident_vehicles
    // and business_vehicles CASCADE on their own. Drop the junction rows + sweep
    // orphan polymorphic record_links before removing the vehicle.
    await execute(db, 'DELETE FROM call_vehicles WHERE vehicle_id = ?', id);
    await execute(db, "DELETE FROM record_links WHERE (source_type='vehicle' AND source_id=?) OR (target_type='vehicle' AND target_id=?)", id, id);
    await execute(db, 'DELETE FROM vehicles_records WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) { console.error('DELETE /records/vehicles/:id failed:', err); return dbErrorResponse(c, err, 'Failed to delete vehicle'); }
});

// POST /records/vehicles/:id/archive — mark vehicle as archived in flags JSON.
records.post('/vehicles/:id/archive', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const row = await queryFirst<{ id: number; flags: string }>(db, 'SELECT id, flags FROM vehicles_records WHERE id = ?', id);
    if (!row) return c.json({ error: 'Vehicle not found' }, 404);
    const flags = (() => { try { const p = JSON.parse(row.flags || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } })();
    if (flags.some((f: any) => typeof f === 'object' && f.type === 'archived')) return c.json({ message: 'Already archived' });
    flags.push({ type: 'archived', at: new Date().toISOString() });
    await execute(db, 'UPDATE vehicles_records SET flags = ? WHERE id = ?', JSON.stringify(flags), id);
    return c.json({ success: true, archived: true });
  } catch (err) { return dbErrorResponse(c, err, 'Failed to archive vehicle'); }
});

// POST /records/vehicles/:id/unarchive
records.post('/vehicles/:id/unarchive', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const row = await queryFirst<{ id: number; flags: string }>(db, 'SELECT id, flags FROM vehicles_records WHERE id = ?', id);
    if (!row) return c.json({ error: 'Vehicle not found' }, 404);
    const flags = (() => { try { const p = JSON.parse(row.flags || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } })();
    const filtered = flags.filter((f: any) => !(typeof f === 'object' && f.type === 'archived'));
    if (filtered.length === flags.length) return c.json({ message: 'Not archived' });
    await execute(db, 'UPDATE vehicles_records SET flags = ? WHERE id = ?', JSON.stringify(filtered), id);
    return c.json({ success: true, archived: false });
  } catch (err) { return dbErrorResponse(c, err, 'Failed to unarchive vehicle'); }
});

// GET /records/vehicles/:id/incidents — incidents involving this vehicle.
records.get('/vehicles/:id/incidents', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const rows = await query<Record<string, unknown>>(db, 'SELECT i.id, i.incident_number, i.incident_type, i.status, i.created_at FROM incidents i JOIN incident_vehicles iv ON i.id = iv.incident_id WHERE iv.vehicle_id = ? ORDER BY i.created_at DESC LIMIT 100', id);
    return c.json(rows);
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// GET /records/vehicles/:id/history — calls/field interviews this vehicle was involved in.
records.get('/vehicles/:id/history', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const rows = await query<Record<string, unknown>>(db, `
      SELECT 'call' as source, c.id, c.call_number, c.incident_type, c.status, c.created_at, c.location_address FROM calls_for_service c JOIN call_vehicles cv ON c.id = cv.call_id WHERE cv.vehicle_id = ?
      UNION ALL
      SELECT 'fi' as source, fi.id, NULL as call_number, fi.contact_reason as incident_type, fi.status, fi.created_at, fi.location FROM field_interviews fi JOIN fi_vehicles fv ON fi.id = fv.fi_id WHERE fv.vehicle_id = ?
      ORDER BY 6 DESC LIMIT 100`,
      id, id);
    return c.json(rows);
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// GET /records/vehicles/export
records.get('/vehicles/export', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, 'SELECT v.*, p.first_name, p.last_name FROM vehicles_records v LEFT JOIN persons p ON v.owner_person_id = p.id ORDER BY v.plate_number LIMIT 50000');
    const csv = ['plate_number,state,make,model,year,color,vin,owner_first_name,owner_last_name,notes', ...rows.map((r: any) => [r.plate_number, r.state, r.make, r.model, r.year, r.color, r.vin, r.first_name, r.last_name, r.notes].map((v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    return c.newResponse(csv, 200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=vehicles_export.csv' });
  } catch (err) {
    log.error('GET /vehicles/export failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// GET /records/vehicles/plate-lookup — quick plate check.
records.get('/vehicles/plate-lookup', async (c) => {
  try {
    const db = getDb(c.env);
    const plate = c.req.query('plate');
    if (!plate || plate.length < 2) return c.json(null);
    const row = await queryFirst<Record<string, unknown>>(db, 'SELECT v.*, p.first_name, p.last_name FROM vehicles_records v LEFT JOIN persons p ON v.owner_person_id = p.id WHERE v.plate_number = ? LIMIT 1', plate.toUpperCase());
    return c.json(row || null);
  } catch (err) { return c.json(null); }
});

// GET /records/vehicles/bolo-check — active BOLOs matching this vehicle.
records.get('/vehicles/bolo-check', async (c) => {
  try {
    const db = getDb(c.env);
    const plate = c.req.query('plate');
    if (!plate || plate.length < 2) return c.json({ matches: [], count: 0 });
    // instr(), not LIKE — D1's 50-char LIKE cap would throw here, and the catch
    // below turns any throw into an empty BOLO result: a false clear on
    // officer-safety data. containsAnyClause is case-insensitive via lower().
    const mb = containsAnyClause(['vehicle_description', 'description']);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT id, bolo_number, title, description, priority, created_at FROM bolos WHERE status = 'active' AND ${mb.sql} ORDER BY priority ASC, created_at DESC LIMIT 10`,
      ...mb.binds(plate));
    return c.json({ matches: rows, count: rows.length, checked: true, coverage: LOOKUP_OK });
  } catch (err) {
    // Was `catch { return c.json({ matches: [], count: 0 }) }` — a failed BOLO
    // lookup was indistinguishable from "no BOLOs on this plate". Still a 200 so
    // the caller's UI keeps rendering, but `checked: false` + coverage say plainly
    // that this is not a clearance.
    log.error('bolo-check lookup failed', { plate: c.req.query('plate') }, err as Error);
    return c.json({
      matches: [], count: 0, checked: false,
      coverage: lookupFailedCoverage('Active BOLOs'),
    });
  }
});

// POST /records/vehicles/stolen-check — local stolen-vehicle check.
// HISTORY: this was a hardcoded `{stolen:false}` that never queried anything —
// an officer-safety FALSE CLEAR on vehicles locally flagged Stolen (2026-06-10
// audit). Now checks (1) vehicles_records.stolen_status (same predicate as the
// client's isActiveStolen badge) + ncic_entry_number, and (2) active BOLOs
// matching the plate. Source is labeled honestly: this is LOCAL RECORDS ONLY,
// not a live NCIC query — a CLEAR here never clears a real NCIC hit.
records.post('/vehicles/stolen-check', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    // Accept both `plate` and `plate_number` (DlSearchPage sends the latter).
    const plate = typeof body.plate === 'string' && body.plate.trim() ? body.plate.trim().toUpperCase()
      : typeof body.plate_number === 'string' && body.plate_number.trim() ? body.plate_number.trim().toUpperCase() : null;
    const vin = typeof body.vin === 'string' && body.vin.trim() ? body.vin.trim().toUpperCase() : null;
    const state = typeof body.state === 'string' ? body.state : null;
    if (!plate && !vin) {
      return c.json({ checked: false, stolen: false, source: 'local records', message: 'No plate or VIN provided' }, 400);
    }

    // 1. Local vehicle record flagged stolen?
    const where: string[] = [];
    const params: unknown[] = [];
    if (plate) { where.push('UPPER(plate_number) = ?'); params.push(plate); }
    if (vin) { where.push('UPPER(vin) = ?'); params.push(vin); }
    const rec = await queryFirst<{ id: number; stolen_status: string | null; ncic_entry_number: string | null; make: string | null; model: string | null }>(
      db,
      `SELECT id, stolen_status, ncic_entry_number, make, model FROM vehicles_records WHERE ${where.join(' OR ')} LIMIT 1`,
      ...params);
    const localStolen = (rec?.stolen_status || '').trim().toLowerCase() === 'stolen';

    // 2. Active BOLO mentioning the plate?
    // A failure here must NOT read as "no BOLO". Track it: the old
    // `catch { boloMatches = [] }` let the response below state "no active
    // BOLOs" when the query never actually ran — asserting an absence the code
    // had not established.
    let boloMatches: Record<string, unknown>[] = [];
    let boloCoverage = LOOKUP_OK;
    if (plate) {
      try {
        // instr(), not LIKE — D1's 50-char LIKE cap would throw here.
        const mb = containsAnyClause(['vehicle_description', 'description']);
        boloMatches = await query<Record<string, unknown>>(db,
          `SELECT id, bolo_number, title, priority FROM bolos WHERE status = 'active' AND ${mb.sql} ORDER BY priority ASC LIMIT 5`,
          ...mb.binds(plate));
      } catch (boloErr) {
        boloMatches = [];
        boloCoverage = lookupFailedCoverage('Active BOLOs');
        log.error('stolen-check BOLO lookup failed', { plate }, boloErr as Error);
      }
    }

    const stolen = localStolen || boloMatches.length > 0;
    const message = localStolen
      ? `Vehicle flagged STOLEN in local records${rec?.ncic_entry_number ? ` (NCIC entry ${rec.ncic_entry_number})` : ''}`
      : boloMatches.length > 0
        ? `Active BOLO match: ${boloMatches.map((m) => m.bolo_number || m.title).filter(Boolean).join(', ')}`
        : boloCoverage.available
          ? 'No stolen flag in local records or active BOLOs — NOT a live NCIC check'
          : 'No stolen flag in local records. THE BOLO CHECK FAILED — this is NOT a clearance.';
    return c.json({
      checked: true, stolen, source: 'local records + BOLO', message,
      plate, vin, state,
      record_id: rec?.id ?? null,
      ncic_entry_number: rec?.ncic_entry_number ?? null,
      bolo_matches: boloMatches,
      bolo_coverage: boloCoverage,
    });
  } catch (err) {
    log.error('POST /vehicles/stolen-check failed', { src: 'src/routes/records.ts' }, err);
    // Fail HONESTLY — an error must read as "couldn't check", never as CLEAR.
    return c.json({ checked: false, stolen: false, source: 'local records', message: 'Stolen check failed — treat as UNVERIFIED, not clear', detail: (err as Error)?.message }, 500);
  }
});

// GET /records/vehicles/alerts/expired-registration — check registration expiry.
records.get('/vehicles/alerts/expired-registration', async (c) => {
  try {
    const db = getDb(c.env);
    const plate = c.req.query('plate');
    if (!plate || plate.length < 2) return c.json({ expired: false });
    const row = await queryFirst<Record<string, unknown>>(db, "SELECT id, plate_number, vin FROM vehicles_records WHERE plate_number = ?", plate.toUpperCase());
    return c.json({ expired: false, vehicle: row || null });
  } catch (err) { return c.json({ expired: false }); }
});

// POST /records/plate-check — multi-source plate aggregator called by VehiclesTab.
// Returns an empty result set when no external integration is configured so the
// tab loads without error (the caller already has .catch(() => null) as a guard,
// but a 404 is noisier than a clean empty response).
records.post('/plate-check', async (c): Promise<Response> => {
  return c.json({ results: [], sources: [] });
});

// ── Businesses (canonical `businesses` table) ──
// Unified onto the dedicated businesses table (migration 0125) so the Records
// Business tab shares one store with call-linking + business photos/visits/
// vehicles (which already key off `businesses`). `properties` is real-estate
// only. Columns latitude/longitude/annual_revenue/status/flags added in 0125.

const BUSINESS_WRITABLE_COLUMNS = new Set([
  'name', 'dba_name', 'business_type', 'ein', 'license_number',
  'address', 'city', 'state', 'zip', 'latitude', 'longitude',
  'phone', 'email', 'website', 'owner_name', 'owner_phone',
  'contact_name', 'contact_phone', 'contact_email',
  'industry', 'employee_count', 'annual_revenue', 'status', 'flags', 'notes',
  // Assessor-sourced columns (migration 0142). Autofill writes these via
  // /api/assessor/apply, but a manual save through the records PATCH/POST
  // must travel the same allow-list.
  'parcel_number', 'owner_of_record', 'owner_type', 'owner_mailing_address',
  'year_built', 'total_market_value', 'land_sqft',
  'last_sale_date', 'last_sale_price', 'legal_description', 'tax_district',
  'assessor_last_synced_at', 'assessor_source_url',
]);

// GET /records/businesses — list businesses.
records.get('/businesses', async (c) => {
  try {
    const db = getDb(c.env);
    const archived = c.req.query('archived') === 'true';
    const rows = await query<Record<string, unknown>>(db, `SELECT * FROM businesses WHERE ${archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'} ORDER BY name LIMIT 500`);
    return c.json(rows);
  } catch (err) {
    log.error('GET /businesses failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// GET /records/businesses/:id — fetch a single business record.
records.get('/businesses/:id', async (c): Promise<Response> => {
  try {
    const db = getDb(c.env);
    const row = await queryFirst(db, 'SELECT * FROM businesses WHERE id = ?', c.req.param('id'));
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(row);
  } catch (err) {
    log.error('GET /businesses/:id failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// POST /records/businesses — create a business.
records.post('/businesses', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.name || !body.business_type) return c.json({ error: 'name and business_type required' }, 400);
    const cols: string[] = ['created_at']; const placeholders: string[] = ["datetime('now')"]; const vals: unknown[] = [];
    for (const [key, val] of Object.entries(body)) {
      if (BUSINESS_WRITABLE_COLUMNS.has(key)) { cols.push(key); placeholders.push('?'); vals.push(val ?? null); }
    }
    const result = await execute(db, `INSERT INTO businesses (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`, ...vals);
    const created = await queryFirst(db, 'SELECT * FROM businesses WHERE id = ?', Number(result.meta.last_row_id));
    return c.json(created, 201);
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// PUT /records/businesses/:id — update a business.
records.put('/businesses/:id', async (c) => {
  try {
    const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
    if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM businesses WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Business not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    const cols: string[] = []; const params: unknown[] = [];
    for (const [key, val] of Object.entries(body)) {
      if (BUSINESS_WRITABLE_COLUMNS.has(key)) { cols.push(`${key} = ?`); params.push(val ?? null); }
    }
    if (cols.length === 0) return c.json({ message: 'No changes' });
    cols.push("updated_at = datetime('now')");
    await execute(db, `UPDATE businesses SET ${cols.join(', ')} WHERE id = ?`, ...params, id);
    const updated = await queryFirst(db, 'SELECT * FROM businesses WHERE id = ?', id);
    return c.json(updated);
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// POST /records/businesses/:id/archive — soft-delete (client expects this route).
records.post('/businesses/:id/archive', async (c) => {
  try {
    const db = getDb(c.env);
    await execute(db, "UPDATE businesses SET archived_at = datetime('now') WHERE id = ?", c.req.param('id'));
    return c.json({ success: true });
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// POST /records/businesses/:id/unarchive — restore.
records.post('/businesses/:id/unarchive', async (c) => {
  try {
    const db = getDb(c.env);
    await execute(db, 'UPDATE businesses SET archived_at = NULL WHERE id = ?', c.req.param('id'));
    return c.json({ success: true });
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// DELETE /records/businesses/:id — hard-delete + clean its junction rows.
records.delete('/businesses/:id', async (c) => {
  try {
    const denied = requireRole(c, 'admin', 'manager', 'supervisor');
    if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const id = c.req.param('id');
    await execute(db, 'DELETE FROM business_vehicles WHERE business_id = ?', id);
    await execute(db, 'DELETE FROM business_visits WHERE business_id = ?', id);
    await execute(db, 'DELETE FROM business_photos WHERE business_id = ?', id);
    await execute(db, 'DELETE FROM call_businesses WHERE business_id = ?', id);
    await execute(db, 'DELETE FROM businesses WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// ── Evidence ─────────────────────────────────────────────────

// GET /records/evidence — list/search evidence.
records.get('/evidence', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query('q');
    const status = c.req.query('status');
    let where = ' WHERE 1=1';
    const params: unknown[] = [];
    if (q) { const m = containsAnyClause(['e.evidence_number', 'e.description']); where += ` AND ${m.sql}`; params.push(...m.binds(q)); }
    if (status) { where += ' AND e.status = ?'; params.push(status); }
    // incidents joined for incident_number: EvidenceTab displays and searches it
    // but `evidence` stores only incident_id, so it was always undefined. The
    // join is on the incidents PK, so it cannot multiply rows (COUNT below is
    // still the true match count).
    const FROM = 'FROM evidence e LEFT JOIN users u ON e.collected_by = u.id LEFT JOIN incidents i ON e.incident_id = i.id';
    const sql = `SELECT e.*, u.full_name as collected_by_name, i.incident_number AS incident_number ${FROM}${where} ORDER BY e.created_at DESC LIMIT 500`;
    const rows = await query<Record<string, unknown>>(db, sql, ...params);
    // pagination.total must be the MATCHING row count, not the returned page
    // size. `total: rows.length` silently caps at the LIMIT, so once the table
    // outgrows the page the UI reports a wrong total and cannot tell that the
    // list was truncated.
    const totalRow = await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n ${FROM}${where}`, ...params).catch(() => null);
    return c.json({ data: rows, pagination: { total: totalRow?.n ?? rows.length, limit: 500, returned: rows.length } });
  } catch (err) {
    log.error('GET /evidence failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// GET /records/evidence/stats
records.get('/evidence/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const row = await queryFirst<Record<string, unknown>>(db, "SELECT COUNT(*) as total, SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) as collected, SUM(CASE WHEN status = 'in_storage' THEN 1 ELSE 0 END) as stored, SUM(CASE WHEN status IN ('submitted_to_le','disposed','released') THEN 1 ELSE 0 END) as closed FROM evidence");
    return c.json(row || { total: 0, collected: 0, stored: 0, closed: 0 });
  } catch (err) {
    log.error('GET /evidence/stats failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// GET /records/evidence/locations
records.get('/evidence/locations', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, "SELECT storage_location, COUNT(*) as count FROM evidence WHERE storage_location IS NOT NULL AND storage_location != '' GROUP BY storage_location ORDER BY count DESC");
    return c.json(rows);
  } catch (err) {
    log.error('GET /evidence/locations failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// GET /records/evidence/aging-report
records.get('/evidence/aging-report', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, "SELECT e.*, u.full_name as collected_by_name, i.incident_number AS incident_number, julianday('now') - julianday(e.created_at) as age_days FROM evidence e LEFT JOIN users u ON e.collected_by = u.id LEFT JOIN incidents i ON e.incident_id = i.id WHERE e.status IN ('received', 'in_storage') ORDER BY e.created_at ASC LIMIT 200");
    return c.json(rows);
  } catch (err) {
    log.error('GET /evidence/aging-report failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// GET /records/evidence/export
records.get('/evidence/export', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, 'SELECT e.*, u.full_name as collected_by_name, i.incident_number AS incident_number FROM evidence e LEFT JOIN users u ON e.collected_by = u.id LEFT JOIN incidents i ON e.incident_id = i.id ORDER BY e.created_at DESC LIMIT 50000');
    if (rows.length === 0) return c.json([]);
    const keys = Object.keys(rows[0] as object);
    const csv = [keys.join(','), ...rows.map((r: any) => keys.map((k: string) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    return c.newResponse(csv, 200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=evidence_export.csv' });
  } catch (err) {
    log.error('GET /evidence/export failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// GET /records/evidence/:id
records.get('/evidence/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const row = await queryFirst<Record<string, unknown>>(db, 'SELECT e.*, u.full_name as collected_by_name, i.incident_number AS incident_number FROM evidence e LEFT JOIN users u ON e.collected_by = u.id LEFT JOIN incidents i ON e.incident_id = i.id WHERE e.id = ?', id);
    if (!row) return c.json({ error: 'Evidence not found' }, 404);
    return c.json(row);
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// All writable columns on the evidence table, sourced from legacy addCol()
// calls. Covers the full EvidenceFormData interface (~30 fields).
// NOTE: live D1 uses `evidence_type` (not `type`). The handlers map `type`
// from the client to `evidence_type` before iterating this set.
const EVIDENCE_WRITABLE_COLUMNS = new Set([
  'evidence_number', 'incident_id', 'case_id', 'evidence_type',
  'description', 'location_found', 'collected_by', 'collected_date',
  'storage_location', 'chain_of_custody', 'status',
  'category', 'packaging_type', 'serial_number', 'brand', 'model',
  'estimated_value', 'dimensions', 'weight',
  'photo_taken', 'lab_submitted', 'lab_case_number', 'lab_name',
  'disposal_method', 'disposal_date', 'disposal_authorized_by',
  'condition', 'quantity',
  'is_biological', 'narcotics_flag', 'temperature_sensitive',
  'collection_context', 'court_hold_reference',
  'checked_out_by', 'checked_out_at', 'checkout_reason',
  'expected_return_date', 'condition_on_return',
  'release_status', 'release_requested_by', 'release_requested_at',
  'release_to', 'release_reason', 'release_approved_by', 'release_approved_at',
  'storage_temperature', 'location_detail',
  'retention_until', 'disposition',
  'notes', 'flags',
  'pq_sealed_description', 'pq_seal_aad',
]);

function coerceBooleanField(key: string, val: unknown): unknown {
  if (key === 'photo_taken' || key === 'lab_submitted' || key === 'is_biological' || key === 'narcotics_flag' || key === 'temperature_sensitive') {
    return val ? 1 : 0;
  }
  return val ?? null;
}

// Columns the evidence write path (EVIDENCE_WRITABLE_COLUMNS) may emit, with the
// types from the retired VPS `addCol()` definitions (legacy/server-vps/src/models/
// database.ts). The VPS added these at boot; that mechanism is dead on Workers and
// no migration ever replaced it, so live D1 was missing the crime-lab / checkout /
// release-workflow columns — any write touching one (e.g. narcotics_flag) failed
// with "no such column". This reconciler is the idempotent self-heal, mirroring
// ensureAlprSchema / ensureSchema in the ALPR & redaction routes. case_id/flags
// were in the whitelist but never in the legacy schema either; included so the
// whitelist can never drift past the table again.
const EVIDENCE_DRIFT_COLUMNS: Record<string, string> = {
  case_id: 'INTEGER',
  narcotics_flag: 'INTEGER DEFAULT 0',
  temperature_sensitive: 'INTEGER DEFAULT 0',
  collection_context: 'TEXT',
  court_hold_reference: 'TEXT',
  checked_out_by: 'INTEGER',
  checked_out_at: 'TEXT',
  checkout_reason: 'TEXT',
  expected_return_date: 'TEXT',
  condition_on_return: 'TEXT',
  release_status: 'TEXT',
  release_requested_by: 'INTEGER',
  release_requested_at: 'TEXT',
  release_to: 'TEXT',
  release_reason: 'TEXT',
  release_approved_by: 'INTEGER',
  release_approved_at: 'TEXT',
  location_detail: 'TEXT',
  flags: 'TEXT',
  pq_sealed_description: 'TEXT',
  pq_seal_aad: 'TEXT',
};

// Reconcile the evidence table against the write-path column set before any
// INSERT/UPDATE. One pragma read + ALTER only for whatever's actually missing,
// so it's a no-op on an already-migrated DB. D1 lacks IF NOT EXISTS on ADD
// COLUMN, hence the per-column existence check + tolerated ALTER failure.
async function ensureEvidenceSchema(db: D1Database): Promise<void> {
  const info = await db.prepare(`SELECT name FROM pragma_table_info('evidence')`).all();
  const existing = new Set((info.results ?? []).map((r) => (r as { name: string }).name));
  for (const [name, type] of Object.entries(EVIDENCE_DRIFT_COLUMNS)) {
    if (existing.has(name)) continue;
    try { await execute(db, `ALTER TABLE evidence ADD COLUMN ${name} ${type}`); }
    catch { /* concurrent add or already present — tolerated */ }
  }
}

// POST /records/evidence — create evidence.
records.post('/evidence', async (c) => {
  try {
    const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
    if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    // Live D1 uses `evidence_type` not `type` — accept either client field.
    if (body.type != null && body.evidence_type == null) body.evidence_type = body.type;
    delete body.type;
    if (!body.evidence_type || !body.description) return c.json({ error: 'evidence_type and description required' }, 400);
    await ensureEvidenceSchema(db);
    // incident_id is optional — standalone evidence (e.g. found property) has no linked incident.
    const user = c.get('user') as { id: number } | undefined;
    const cols: string[] = [];
    const vals: string[] = [];
    const params: unknown[] = [];
    cols.push('created_at');
    vals.push("datetime('now')");
    for (const [key, val] of Object.entries(body)) {
      if (key === 'created_at' || key === 'updated_at') continue;
      if (EVIDENCE_WRITABLE_COLUMNS.has(key)) {
        cols.push(key);
        vals.push('?');
        params.push(coerceBooleanField(key, val));
      }
    }
    if (!body.collected_by && user?.id) {
      cols.push('collected_by');
      vals.push('?');
      params.push(user.id);
    }
    if (!body.evidence_number) {
      cols.push('evidence_number');
      vals.push('?');
      params.push(`E${Date.now()}`);
    }
    if (!body.chain_of_custody) {
      cols.push('chain_of_custody');
      vals.push('?');
      params.push('[]');
    }
    const result = await execute(db,
      `INSERT INTO evidence (${cols.join(', ')}) VALUES (${vals.join(', ')})`, ...params);
    const created = await queryFirst(db, 'SELECT e.*, u.full_name as collected_by_name FROM evidence e LEFT JOIN users u ON e.collected_by = u.id WHERE e.id = ?', Number(result.meta.last_row_id));
    return c.json(created, 201);
  } catch (err) {
    console.error('POST /records/evidence failed:', err);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// PUT /records/evidence/:id
records.put('/evidence/:id', async (c) => {
  try {
    const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
    if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM evidence WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Evidence not found' }, 404);
    await ensureEvidenceSchema(db);
    const body = await c.req.json<Record<string, unknown>>();
    // Live D1 uses `evidence_type` not `type` — accept either client field.
    if (body.type != null && body.evidence_type == null) body.evidence_type = body.type;
    delete body.type;
    const cols: string[] = [];
    const params: unknown[] = [];
    for (const [key, val] of Object.entries(body)) {
      if (key === 'id' || key === 'created_at' || key === 'updated_at') continue;
      if (EVIDENCE_WRITABLE_COLUMNS.has(key)) {
        cols.push(`${key} = ?`);
        params.push(coerceBooleanField(key, val));
      }
    }
    if (cols.length === 0) return c.json({ message: 'No changes' });
    await execute(db, `UPDATE evidence SET ${cols.join(', ')} WHERE id = ?`, ...params, id);
    const updated = await queryFirst(db, 'SELECT e.*, u.full_name as collected_by_name FROM evidence e LEFT JOIN users u ON e.collected_by = u.id WHERE e.id = ?', id);
    return c.json(updated);
  } catch (err) {
    console.error('PUT /records/evidence/:id failed:', err);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// DELETE /records/evidence/:id
records.delete('/evidence/:id', async (c) => {
  try {
    const denied = requireRole(c, 'admin', 'manager', 'supervisor');
    if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM evidence WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Evidence not found' }, 404);
    await execute(db, 'DELETE FROM evidence WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// ── Evidence sub-resource endpoints ──────────────────────────────────────────
// These were called by EvidencePropertyPage but never mounted, causing all
// chain-action / checkout / checkin / disposition / release / audit / links
// button actions to 404 silently. Added 2026-06-22 (page 65 audit).

// POST /records/evidence/:id/chain-action
// Appends an entry to the JSON chain_of_custody column and updates item status.
records.post('/evidence/:id/chain-action', async (c) => {
  try {
    const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
    if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    await ensureEvidenceSchema(db);
    const id = c.req.param('id');
    const user = c.get('user') as { id?: number; full_name?: string; username?: string } | undefined;
    const row = await queryFirst<{ id: number; chain_of_custody: string | null }>(db, 'SELECT id, chain_of_custody FROM evidence WHERE id = ?', id);
    if (!row) return c.json({ error: 'Evidence not found' }, 404);
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const action = String(body.action || 'check_in');
    const entry = {
      action,
      user_id: user?.id ?? null,
      user_name: (user as any)?.full_name || (user as any)?.username || null,
      by_name: (user as any)?.full_name || (user as any)?.username || null,
      timestamp: new Date().toISOString(),
      to_location: body.to_location ? String(body.to_location) : undefined,
      from_location: body.from_location ? String(body.from_location) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
    };
    let chain: unknown[] = [];
    if (row.chain_of_custody) {
      try { chain = JSON.parse(row.chain_of_custody) as unknown[]; } catch { chain = []; }
    }
    chain.push(entry);
    // Map action to status
    const STATUS_MAP: Record<string, string> = {
      check_in: 'checked_in', check_out: 'checked_out', transfer: 'in_storage',
      lab_submit: 'submitted_to_le', release: 'released', dispose: 'disposed',
    };
    const newStatus = STATUS_MAP[action];
    const updates: string[] = ['chain_of_custody = ?'];
    const values: unknown[] = [JSON.stringify(chain)];
    if (newStatus) { updates.push('status = ?'); values.push(newStatus); }
    values.push(id);
    await execute(db, `UPDATE evidence SET ${updates.join(', ')} WHERE id = ?`, ...values);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT e.*, u.full_name as collected_by_name FROM evidence e LEFT JOIN users u ON e.collected_by = u.id WHERE e.id = ?', id);
    return c.json({ success: true, data: updated });
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// POST /records/evidence/:id/checkout
records.post('/evidence/:id/checkout', async (c) => {
  try {
    const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
    if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    await ensureEvidenceSchema(db);
    const id = c.req.param('id');
    const user = c.get('user') as { id?: number; full_name?: string; username?: string } | undefined;
    const row = await queryFirst<{ id: number; status: string }>(db, 'SELECT id, status FROM evidence WHERE id = ?', id);
    if (!row) return c.json({ error: 'Evidence not found' }, 404);
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const now = new Date().toISOString();
    await execute(db,
      `UPDATE evidence SET status = 'checked_out', checked_out_by = ?, checked_out_at = ?,
        checkout_reason = ?, expected_return_date = ? WHERE id = ?`,
      user?.id ?? null, now,
      body.reason ? String(body.reason) : null,
      body.expected_return_date ? String(body.expected_return_date) : null,
      id,
    );
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT e.*, u.full_name as collected_by_name FROM evidence e LEFT JOIN users u ON e.collected_by = u.id WHERE e.id = ?', id);
    return c.json({ success: true, data: updated });
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// POST /records/evidence/:id/checkin
records.post('/evidence/:id/checkin', async (c) => {
  try {
    const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
    if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    await ensureEvidenceSchema(db);
    const id = c.req.param('id');
    const row = await queryFirst<{ id: number }>(db, 'SELECT id FROM evidence WHERE id = ?', id);
    if (!row) return c.json({ error: 'Evidence not found' }, 404);
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    await execute(db,
      `UPDATE evidence SET status = 'checked_in', checked_out_by = NULL, checked_out_at = NULL,
        checkout_reason = NULL, expected_return_date = NULL,
        condition_on_return = ? WHERE id = ?`,
      body.condition_on_return ? String(body.condition_on_return) : null,
      id,
    );
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT e.*, u.full_name as collected_by_name FROM evidence e LEFT JOIN users u ON e.collected_by = u.id WHERE e.id = ?', id);
    return c.json({ success: true, data: updated });
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// PUT /records/evidence/:id/disposition
records.put('/evidence/:id/disposition', async (c) => {
  try {
    const denied = requireRole(c, 'admin', 'manager', 'supervisor');
    if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const id = c.req.param('id');
    const row = await queryFirst<{ id: number }>(db, 'SELECT id FROM evidence WHERE id = ?', id);
    if (!row) return c.json({ error: 'Evidence not found' }, 404);
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const disposition = String(body.disposition || 'pending');
    const newStatus = disposition === 'pending' ? 'pending_disposition'
      : ['destroy', 'forfeit', 'auction'].includes(disposition) ? 'disposed'
      : disposition === 'return_to_owner' ? 'released'
      : 'pending_disposition';
    await execute(db,
      `UPDATE evidence SET disposition = ?, disposal_method = ?,
        disposal_date = CASE WHEN ? != 'pending' THEN date('now') ELSE NULL END,
        status = ? WHERE id = ?`,
      disposition,
      body.disposition_method ? String(body.disposition_method) : null,
      disposition, newStatus, id,
    );
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT e.*, u.full_name as collected_by_name FROM evidence e LEFT JOIN users u ON e.collected_by = u.id WHERE e.id = ?', id);
    return c.json({ success: true, data: updated });
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// POST /records/evidence/:id/request-release
records.post('/evidence/:id/request-release', async (c) => {
  try {
    const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
    if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    await ensureEvidenceSchema(db);
    const id = c.req.param('id');
    const user = c.get('user') as { id?: number } | undefined;
    const row = await queryFirst<{ id: number; status: string }>(db, 'SELECT id, status FROM evidence WHERE id = ?', id);
    if (!row) return c.json({ error: 'Evidence not found' }, 404);
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const now = new Date().toISOString();
    await execute(db,
      `UPDATE evidence SET release_status = 'release_requested',
        release_requested_by = ?, release_requested_at = ?,
        release_to = ?, release_reason = ? WHERE id = ?`,
      user?.id ?? null, now,
      body.release_to ? String(body.release_to) : null,
      body.reason ? String(body.reason) : null,
      id,
    );
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT e.*, u.full_name as collected_by_name FROM evidence e LEFT JOIN users u ON e.collected_by = u.id WHERE e.id = ?', id);
    return c.json({ success: true, data: updated });
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// PUT /records/evidence/:id/approve-release (admin/supervisor only)
records.put('/evidence/:id/approve-release', async (c) => {
  try {
    const denied = requireRole(c, 'admin', 'manager', 'supervisor');
    if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    await ensureEvidenceSchema(db);
    const id = c.req.param('id');
    const user = c.get('user') as { id?: number } | undefined;
    const row = await queryFirst<{ id: number; release_status: string | null }>(db, 'SELECT id, release_status FROM evidence WHERE id = ?', id);
    if (!row) return c.json({ error: 'Evidence not found' }, 404);
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const action = String(body.action || 'approve');
    const now = new Date().toISOString();
    if (action === 'approve') {
      await execute(db,
        `UPDATE evidence SET release_status = 'released', status = 'released',
          release_approved_by = ?, release_approved_at = ? WHERE id = ?`,
        user?.id ?? null, now, id,
      );
    } else {
      await execute(db,
        `UPDATE evidence SET release_status = NULL,
          release_requested_by = NULL, release_requested_at = NULL,
          release_to = NULL, release_reason = NULL WHERE id = ?`,
        id,
      );
    }
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT e.*, u.full_name as collected_by_name FROM evidence e LEFT JOIN users u ON e.collected_by = u.id WHERE e.id = ?', id);
    return c.json({ success: true, data: updated });
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// GET /records/evidence/:id/custody-validation
// Validates chain of custody integrity — looks for gaps > 48h and warnings.
records.get('/evidence/:id/custody-validation', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const row = await queryFirst<{ id: number; status: string; storage_location: string | null; chain_of_custody: string | null }>(
      db, 'SELECT id, status, storage_location, chain_of_custody FROM evidence WHERE id = ?', id,
    );
    if (!row) return c.json({ error: 'Evidence not found' }, 404);
    let chain: Array<{ action?: string; timestamp?: string; at?: string; user_name?: string; by_name?: string }> = [];
    if (row.chain_of_custody) {
      try { chain = JSON.parse(row.chain_of_custody); } catch { chain = []; }
    }
    const gaps: Array<{ from_action: string; to_action: string; from_time: string; to_time: string; gap_hours: number }> = [];
    const warnings: string[] = [];
    for (let i = 1; i < chain.length; i++) {
      const prev = chain[i - 1];
      const curr = chain[i];
      const t1 = prev.timestamp || prev.at;
      const t2 = curr.timestamp || curr.at;
      if (t1 && t2) {
        const gapH = (new Date(t2).getTime() - new Date(t1).getTime()) / 3_600_000;
        if (gapH > 48) {
          gaps.push({
            from_action: prev.action || '?', to_action: curr.action || '?',
            from_time: t1, to_time: t2, gap_hours: Math.round(gapH),
          });
        }
      }
    }
    if (row.status === 'checked_out' && chain.length > 0) warnings.push('Item is currently checked out');
    if (chain.length === 0) warnings.push('No chain of custody entries — evidence intake was not recorded');
    return c.json({
      data: {
        is_valid: gaps.length === 0,
        chain_length: chain.length,
        current_status: row.status,
        current_location: row.storage_location,
        gaps,
        warnings,
      },
    });
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// GET /records/evidence/:id/linked-records
// Returns the incident, cases, and forensic cases linked to this evidence item.
records.get('/evidence/:id/linked-records', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const row = await queryFirst<{ id: number; incident_id: number | null; case_id: number | null }>(
      db, 'SELECT id, incident_id, case_id FROM evidence WHERE id = ?', id,
    );
    if (!row) return c.json({ error: 'Evidence not found' }, 404);
    // Incident
    const incident = row.incident_id
      ? await queryFirst<Record<string, unknown>>(db, 'SELECT id, incident_number, incident_type, status FROM incidents WHERE id = ?', row.incident_id).catch(() => null)
      : null;
    // Cases linked via evidence_case_links or directly via case_id
    const cases = await (async () => {
      try {
        return await query<Record<string, unknown>>(db,
          `SELECT c.id, c.case_number, c.case_type, c.status FROM cases c
           INNER JOIN case_evidence_links ecl ON ecl.case_id = c.id WHERE ecl.evidence_id = ?
           UNION
           SELECT c.id, c.case_number, c.case_type, c.status FROM cases c WHERE c.id = ?`,
          id, row.case_id ?? -1,
        );
      } catch { return []; }
    })();
    // Forensic cases
    const forensicCases = await (async () => {
      try {
        return await query<Record<string, unknown>>(db,
          `SELECT fc.id, fc.lab_number, fc.title, fc.case_type, fc.status
           FROM forensic_cases fc
           -- forensic_case_evidence does not exist; forensic_case_entity_links
           -- is the polymorphic link table (entity_type + entity_id).
           INNER JOIN forensic_case_entity_links fce ON fce.forensic_case_id = fc.id
           WHERE fce.entity_type = 'evidence' AND fce.entity_id = ?`,
          id,
        );
      } catch { return []; }
    })();
    return c.json({ data: { incident, cases, forensic_cases: forensicCases } });
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// POST /records/evidence/:id/archive — not applicable (evidence uses status transitions).
records.post('/evidence/:id/archive', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number; status: string }>(db, "SELECT id, status FROM evidence WHERE id = ? AND status NOT IN ('disposed', 'released')", id);
    if (!existing) return c.json({ error: 'Evidence not found or already finalized' }, 404);
    await execute(db, "UPDATE evidence SET status = 'disposed' WHERE id = ?", id);
    return c.json({ success: true, archived: true, status: 'disposed' });
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// POST /records/evidence/:id/unarchive
records.post('/evidence/:id/unarchive', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number; status: string }>(db, "SELECT id, status FROM evidence WHERE id = ? AND status = 'disposed'", id);
    if (!existing) return c.json({ error: 'Evidence not found or not archived' }, 404);
    await execute(db, "UPDATE evidence SET status = 'in_storage' WHERE id = ?", id);
    return c.json({ success: true, archived: false, status: 'in_storage' });
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// GET /records/ncic-query?type=person|vehicle|warrant|phone|address&query=...
// Powers the NCIC/NLETS terminal (QH/QV/QW/QT/QA + the QX cross-reference
// fan-out). Ported from the legacy VPS handler with the fixes that were
// causing live "PERSON QUERY FAILED" / "WARRANT QUERY FAILED" errors:
//   1. warrants link the subject via subject_person_id — migration 0200
//      dropped the old redundant person_id column entirely, so
//      subject_person_id is now the sole (and only valid) FK to query.
//   2. each optional sub-query (criminal_history, warrants) is wrapped so a
//      missing/drifted table degrades to an empty list instead of 500ing the
//      whole request (live D1 schema drifts from /migrations/).
// The terminal renders a 200 with whatever data exists ("NO RECORD FOUND")
// rather than a scary red "QUERY FAILED".
records.get('/ncic-query', async (c) => {
  const db = getDb(c.env);
  const type = c.req.query('type');
  const q = c.req.query('query');
  if (!type || !q || q.length < 2) {
    return c.json({ error: 'type and query (min 2 chars) required', code: 'TYPE_AND_QUERY_MIN' }, 400);
  }
  // instr(), not LIKE — D1 caps LIKE patterns at 50 chars (see searchText.ts).
  // Especially important here: most branches below are wrapped in soft(), which
  // swallows the D1 error and returns []. A too-long query therefore reported
  // "no records" on an NCIC terminal rather than failing — a false clear, the
  // same hazard class as the 2026-06-10 stolen-check incident.
  const nq = (...cols: string[]) => containsAnyClause(cols);

  // Run an OPTIONAL sub-query that must never fail the whole response. A
  // missing table / drifted column resolves to [] instead of throwing — BUT the
  // failure is now recorded, because on an NCIC terminal a swallowed error
  // rendered as "no records" is a false clear, not a graceful degradation.
  const failures: string[] = [];
  const soft = async <T>(label: string, fn: () => Promise<T[]>): Promise<T[]> => {
    try { return await fn(); } catch (err) {
      failures.push(label);
      log.error('ncic-query sub-query failed', { type, label }, err as Error);
      return [];
    }
  };
  /**
   * Every success path goes through here so a partial failure can never be
   * presented as a clean "no records" result.
   */
  const respond = (results: unknown) => c.json({
    type, results, query: q,
    checked: failures.length === 0,
    degraded: failures.length > 0,
    failed_sources: failures,
    coverage: failures.length
      ? lookupFailedCoverage(`NCIC records (${failures.join(', ')})`)
      : LOOKUP_OK,
  });
  // Warrant projection aliased to the field names the client formatter reads
  // (charge_description, bail_amount). offense_level isn't on the live table —
  // the formatter tolerates its absence.
  // Real live columns: charge_description / bail_amount / issuing_court /
  // issued_date / expires_at. Alias to the names the formatter reads (jurisdiction,
  // issued_at) so none resolve undefined; `charge`/`jurisdiction`/`issued_at` do NOT
  // exist on the live warrants table (the old names 500'd this query). Migration
  // 0200 dropped the now-redundant bond_amount column — bail_amount is canonical.
  const WARRANT_COLS = `id, warrant_number, type, charge_description, status,
    bail_amount, issuing_court AS jurisdiction,
    issuing_agency, issued_date AS issued_at, expires_at`;

  try {
    switch (type) {
      case 'person': {
        // Aliases and middle names are searchable, not just the legal first/last.
        //
        // Same defect class as the QW warrant query (#3222): the matcher named
        // fewer columns than the data actually lives in, so records that were
        // present answered NO RECORD FOUND. A subject known to officers by a
        // nickname was unreachable, even though `persons.alias_nickname` and
        // `persons.aliases` hold exactly that — and records.ts already exposes
        // a dedicated /persons/alias-search endpoint that this query never used.
        //
        // Live D1: 4 persons carry alias_nickname, 1 carries aliases, 43 carry
        // a middle_name.
        //
        // Purely additive — this can only return MORE matches, never fewer.
        const mp = nq('first_name', 'last_name', 'middle_name',
          'alias_nickname', 'aliases',
          "first_name || ' ' || last_name", "last_name || ', ' || first_name",
          "first_name || ' ' || COALESCE(middle_name,'') || ' ' || last_name");
        const persons = await query<Record<string, any>>(db, `
          SELECT * FROM persons
          WHERE ${mp.sql}
          ORDER BY last_name, first_name LIMIT 10
        `, ...mp.binds(q));

        // Normalize live column-name drift to the field names the NCIC client
        // terminal formatter reads. Live `persons` stores dob/gender/dl_number
        // (verified via PersonsTab's row mapping), but the formatter reads
        // date_of_birth/sex/drivers_license — without this the terminal showed
        // blank SEX/DOB and a missing OLN/ line on an otherwise-good record.
        // JS-level (post-SELECT *) so a column that doesn't exist can't throw.
        for (const p of persons) {
          if (p.date_of_birth == null && p.dob != null) p.date_of_birth = p.dob;
          if (p.sex == null && p.gender != null) p.sex = p.gender;
          if (p.drivers_license == null && p.dl_number != null) p.drivers_license = p.dl_number;
        }

        // Fan the per-person sub-queries out in PARALLEL rather than awaiting
        // each in sequence.
        //
        // This loop issues TWO round-trips per person, so at the previous
        // LIMIT 5 it was 10 sequential awaits; raising the limit to 10 would
        // have made it 20 and roughly doubled the terminal's response time.
        // The sequential fan-out is what made the low limit necessary in the
        // first place — a QH on a common surname silently returned 5 of N
        // matches, which for a name lookup at a stop is the wrong trade.
        //
        // Promise.all keeps wall time at roughly one round-trip pair while
        // doubling coverage. Each sub-query is already wrapped in soft(), so a
        // single failure still degrades to [] for that person instead of
        // rejecting the whole batch.
        const results = await Promise.all(persons.map(async (p) => {
          const [criminalHistory, warrants] = await Promise.all([
            soft('criminal history', () => query<Record<string, any>>(db,
              `SELECT * FROM criminal_history WHERE person_id = ? ORDER BY offense_date DESC LIMIT 50`,
              p.id)),
            soft('warrants', () => query<Record<string, any>>(db,
              `SELECT ${WARRANT_COLS} FROM warrants
               WHERE subject_person_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 50`,
              p.id)),
          ]);
          return { person: p, criminalHistory, warrants };
        }));
        return respond(results);
      }
      case 'warrant': {
        // Match the warrant's OWN subject name, not just the joined person's.
        //
        // This searched only w.warrant_number and the LEFT JOINed persons row.
        // A warrant whose subject was never linked to a persons record
        // (subject_person_id IS NULL) has NULL for every p.* column, so it was
        // unreachable by name — even though the warrant itself carries
        // subject_name / subject_first_name / subject_last_name.
        //
        // Measured on live D1: 19 of the 21 ACTIVE warrants are unlinked, and
        // all 19 carry a subject name. A `QW GONZALEZ` at a traffic stop
        // returned 1 of 9 active Gonzalez warrants — and that one hit only by
        // coincidence, because its warrant_number string
        // ("natrona-county-wy-natrona:gonz…") happens to contain "gonz".
        // Everything else answered NO RECORD FOUND for subjects with live
        // arrest warrants.
        //
        // Purely additive: this can only ever return MORE warrants, never
        // fewer, so no existing hit is lost.
        const mw = nq(
          'w.warrant_number',
          'w.subject_name', 'w.subject_first_name', 'w.subject_last_name',
          "COALESCE(w.subject_last_name,'') || ', ' || COALESCE(w.subject_first_name,'')",
          'p.first_name', 'p.last_name',
          "p.last_name || ', ' || p.first_name",
        );
        const results = await soft('warrants', () => query<Record<string, any>>(db, `
          SELECT ${WARRANT_COLS.split(',').map(s => 'w.' + s.trim()).join(', ')},
                 -- Fall back to the warrant's own subject fields when there is
                 -- no linked person. Aliasing p.* alone SHADOWED the warrant's
                 -- columns, so an unlinked hit came back with a NULL name and
                 -- the terminal printed no NAM/ line at all — an officer saw a
                 -- warrant hit with no indication of WHO it was for.
                 COALESCE(p.first_name, w.subject_first_name) AS subject_first_name,
                 COALESCE(p.last_name, w.subject_last_name, w.subject_name) AS subject_last_name
          FROM warrants w
          LEFT JOIN persons p ON p.id = w.subject_person_id
          WHERE w.status = 'active'
            AND ${mw.sql}
          ORDER BY w.created_at DESC LIMIT 10
        `, ...mw.binds(q)));
        return respond(results);
      }
      case 'vehicle': {
        const mv = nq('v.plate_number', 'v.vin', 'v.make', 'v.model');
        const results = await soft('vehicle records', () => query<Record<string, any>>(db, `
          SELECT v.*, p.first_name AS owner_first_name, p.last_name AS owner_last_name
          FROM vehicles_records v
          LEFT JOIN persons p ON v.owner_person_id = p.id
          WHERE ${mv.sql}
          ORDER BY v.plate_number LIMIT 10
        `, ...mv.binds(q)));
        return respond(results);
      }
      case 'phone': {
        // persons stores FOUR phone columns; this searched one.
        //
        // Live D1: 17 persons have a primary phone, but 4 have phone_secondary,
        // 4 home_phone and 3 work_phone — and 2 persons have ONLY a non-primary
        // number, making them entirely unreachable by a QT lookup. Dialling a
        // number that is on file returned NO RECORD FOUND.
        //
        // Purely additive.
        const mph = nq('phone', 'phone_secondary', 'home_phone', 'work_phone');
        const results = await soft('persons by phone', () => query<Record<string, any>>(db,
          `SELECT * FROM persons WHERE ${mph.sql} ORDER BY last_name, first_name LIMIT 10`,
          ...mph.binds(q)));
        return respond(results);
      }
      case 'address': {
        const mad = nq('address');
        const results = await soft('persons by address', () => query<Record<string, any>>(db,
          `SELECT * FROM persons WHERE ${mad.sql} ORDER BY last_name, first_name LIMIT 10`,
          ...mad.binds(q)));
        return respond(results);
      }
      default:
        return c.json({ error: 'unknown query type', code: 'UNKNOWN_TYPE' }, 400);
    }
  } catch {
    // Even the base persons query failing should render as "NO RECORD FOUND",
    // not a terminal error — return an empty, flagged result set.
    return c.json({ type, results: [], query: q, degraded: true });
  }
});

// GET /records/search?q=...&type=person|vehicle|business
// Used by client/src/components/LinkRecordModal.tsx for cross-type linking.
// Returns an array of records matching the query for the given type. Legacy
// has no handler at this exact path (it has /persons/search and /vehicles/
// search separately) so calls fell through with empty `[]` and the dropdown
// stayed blank.
records.get('/search', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query('q');
    const type = (c.req.query('type') || 'person').toLowerCase();
    if (!q || q.length < 2) return c.json([]);
    // instr(), not LIKE: D1 caps LIKE patterns at 50 chars, so a search term past
    // 48 characters returned a 500 (8 recorded live failures). searchText.ts.
    const match = (...cols: string[]) => containsAnyClause(cols);

    // Client (LinkRecordModal.tsx) renders `result.label || result.name ||
    // result.id`. Without a `label` field it falls back to the numeric record
    // id ("1", "2") which the user reported as "showing the Record number".
    // Format per user spec: persons → "Last, First"; vehicles → plate number;
    // properties → business name if it looks like a business, else street
    // address. We synthesize `label` on every row.

    if (type === 'person') {
      const mp = match('last_name', 'first_name', 'phone', "first_name || ' ' || last_name");
      const rows = await query<Record<string, unknown>>(db, `
        SELECT * FROM persons
        WHERE ${mp.sql}
        ORDER BY last_name, first_name LIMIT 50
      `, ...mp.binds(q));
      return c.json(rows.map((r) => ({
        ...r,
        label: [r.last_name, r.first_name].filter(Boolean).join(', ') || `Person #${r.id}`,
      })));
    }

    if (type === 'vehicle') {
      const mv = match('v.plate_number', 'v.vin', 'v.make', 'v.model');
      const rows = await query<Record<string, unknown>>(db, `
        SELECT v.*, p.first_name, p.last_name
        FROM vehicles_records v
        LEFT JOIN persons p ON v.owner_person_id = p.id
        WHERE ${mv.sql}
        ORDER BY v.plate_number LIMIT 50
      `, ...mv.binds(q));
      return c.json(rows.map((r) => {
        const plate = (r.plate_number as string | null) || '';
        const yearMakeModel = [r.year, r.make, r.model].filter(Boolean).join(' ');
        // "8JAR3 — 2022 Dodge RAM" reads better than just the plate when the
        // dispatcher's picking from a list of look-alike plates.
        const label = plate
          ? (yearMakeModel ? `${plate} — ${yearMakeModel}` : plate)
          : (yearMakeModel || `Vehicle #${r.id}`);
        return { ...r, label };
      }));
    }

    if (type === 'business') {
      // businesses live in the dedicated `businesses` table (migration 0125);
      // `properties` is real-estate only. LINK_ENTITY_TABLE and recordExists
      // both target `businesses`, so search must return IDs from that table.
      const mb = match('name', 'dba_name', 'address', 'owner_name');
      const rows = await query<Record<string, unknown>>(db, `
        SELECT id, name, dba_name, business_type, address, city, state, phone, owner_name FROM businesses
        WHERE ${mb.sql}
        ORDER BY name LIMIT 50
      `, ...mb.binds(q));
      return c.json(rows.map((r) => {
        const name = (r.name as string | null) || '';
        const dba = (r.dba_name as string | null) || '';
        const address = (r.address as string | null) || '';
        const label = dba ? `${name} (${dba})` : (name || address || `Business #${r.id}`);
        return { ...r, label };
      }));
    }

    if (type === 'property') {
      const mpr = match('name', 'address');
      const rows = await query<Record<string, unknown>>(db, `
        SELECT * FROM properties
        WHERE ${mpr.sql}
        ORDER BY name LIMIT 50
      `, ...mpr.binds(q));
      return c.json(rows.map((r) => {
        const name = (r.name as string | null) || '';
        const address = (r.address as string | null) || '';
        const label = address || name || `Property #${r.id}`;
        return { ...r, label };
      }));
    }

    if (type === 'evidence') {
      const me = match('evidence_number', 'description', 'lab_case_number');
      const rows = await query<Record<string, unknown>>(db, `
        SELECT * FROM evidence
        WHERE ${me.sql}
        ORDER BY evidence_number LIMIT 50
      `, ...me.binds(q));
      return c.json(rows.map((r) => ({
        ...r,
        label: [r.evidence_number, r.description].filter(Boolean).join(' — ') || `Evidence #${r.id}`,
      })));
    }

    if (type === 'incident') {
      const itLike = codedLike('incident_type', q);
      const mi = match('incident_number', 'location_address');
      const rows = await query<Record<string, unknown>>(db, `
        SELECT id, incident_number, incident_type, status, location_address, created_at FROM incidents
        WHERE ${mi.sql} OR ${itLike.sql}
        ORDER BY created_at DESC LIMIT 50
      `, ...mi.binds(q), ...itLike.binds);
      return c.json(rows.map((r) => ({
        ...r,
        label: [r.incident_number, r.incident_type].filter(Boolean).join(' — ') || `Incident #${r.id}`,
      })));
    }

    if (type === 'case') {
      const ctLike = codedLike('case_type', q);
      const mc = match('case_number', 'title');
      const rows = await query<Record<string, unknown>>(db, `
        SELECT id, case_number, title, status, case_type, created_at FROM cases
        WHERE ${mc.sql} OR ${ctLike.sql}
        ORDER BY created_at DESC LIMIT 50
      `, ...mc.binds(q), ...ctLike.binds);
      return c.json(rows.map((r) => ({
        ...r,
        label: [r.case_number, r.title].filter(Boolean).join(' — ') || `Case #${r.id}`,
      })));
    }

    if (type === 'warrant') {
      const mw = match('warrant_number', 'subject_name', 'charge_description');
      const rows = await query<Record<string, unknown>>(db, `
        SELECT id, warrant_number, subject_name, charge_description, status, created_at FROM warrants
        WHERE ${mw.sql}
        ORDER BY created_at DESC LIMIT 50
      `, ...mw.binds(q));
      return c.json(rows.map((r) => ({
        ...r,
        label: [r.warrant_number, r.subject_name].filter(Boolean).join(' — ') || `Warrant #${r.id}`,
      })));
    }

    // Unknown type — empty array keeps the client UI consistent (no error toast).
    return c.json([]);
  } catch (err) {
    console.error('GET /records/search failed:', err);
    return dbErrorResponse(c, err, 'Search failed');
  }
});

// ── Records Retention ──────────────────────────────────────────

// Exported so src/utils/retentionReminderSweep.ts can read the same
// schedule enforcement actually acts on, instead of a hand-copied mirror
// that could silently drift.
export const RETENTION_SCHEDULE: Record<string, number> = {
  evidence: 365 * 99,
  incidents: 365 * 10,
  persons: 0,
  vehicles: 0,
  properties: 0,
};

// POST /records/retention/enforce — admin-only. Archives/purges records
// that have exceeded their retention period. Only affects record types
// with a non-zero retention schedule.
records.post('/retention/enforce', async (c) => {
  const user = c.get('user');
  if (!user || (user as any).role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  try {
    const db = getDb(c.env);
    const results: Record<string, number> = {};
    for (const [recordType, days] of Object.entries(RETENTION_SCHEDULE)) {
      if (days <= 0) continue;
      let count = 0;
      if (recordType === 'evidence') {
        const expired = await query<{ id: number }>(db,
          `SELECT id FROM evidence WHERE status IN ('in_storage','received')
           AND datetime(created_at) < datetime('now',?) LIMIT 500`, `-${days} days`);
        if (expired.length > 0) {
          const ids = expired.map((r: any) => r.id);
          // The SELECT above is LIMIT 500, so this IN-list can carry up to 500
          // bound parameters — five times D1's 100-parameter cap, which throws
          // at BIND time before the statement runs. Retention enforcement would
          // 500 and dispose nothing the moment 100+ rows aged out.
          count = await executeInChunks(db, ids,
            (ps) => `UPDATE evidence SET status='disposed' WHERE id IN (${ps})`);
        }
      } else if (recordType === 'incidents') {
        const expired = await query<{ id: number }>(db,
          `SELECT id FROM incidents WHERE status = 'approved' AND archived_at IS NULL
           AND datetime(created_at) < datetime('now',?) LIMIT 500`, `-${days} days`);
        if (expired.length > 0) {
          const ids = expired.map((r: any) => r.id);
          // Same LIMIT 500 vs 100-parameter-cap mismatch as the evidence branch.
          count = await executeInChunks(db, ids,
            (ps) => `UPDATE incidents SET archived_at=datetime('now'),updated_at=datetime('now') WHERE id IN (${ps})`);
        }
      }
      if (count > 0) results[recordType] = count;
    }
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
    await recordAudit(c, { action: 'records_retention_enforced', entityType: 'records', entityId: 0, details: JSON.stringify(results), actorId: (user as any).id ?? 0 });
    return c.json({ enforced: true, results });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to enforce retention');
  }
});

// GET /records/retention/policy — current retention policy.
records.get('/retention/policy', async (c) => {
  try {
    const db = getDb(c.env);
    const reportDays = await queryFirst<{ config_value: string }>(db,
      `SELECT config_value FROM system_config
       WHERE config_key='report_retention_days' AND category='reports'`);
    return c.json({
      schedule: RETENTION_SCHEDULE,
      report_retention_days: reportDays ? parseInt(reportDays.config_value,10)||365 : 365,
    });
  } catch (err) {
    log.error('GET /retention/policy failed', { src: 'src/routes/records.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// GET /api/records/reports/approval-queue — ReportsPage Pending Approvals tab.
// Backed by the incidents table: any incident with status in submitted /
// pending_approval / returned is in supervisor's queue. Joins officer +
// supervisor name so the queue row renders without an extra lookup.
records.get('/reports/approval-queue', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        i.id, i.incident_number, i.incident_type, i.priority, i.status,
        i.location_address, i.created_at, i.updated_at, i.officer_id,
        u.full_name AS officer_name,
        u.badge_number AS officer_badge,
        s.full_name AS supervisor_name
      FROM incidents i
      LEFT JOIN users u ON u.id = i.officer_id
      LEFT JOIN users s ON s.id = i.supervisor_id
      WHERE i.status IN ('submitted', 'pending_approval', 'returned')
      ORDER BY i.created_at DESC
      LIMIT 200
    `);
    return c.json(rows);
  } catch (err) {
    console.error('GET /records/reports/approval-queue error:', err);
    return c.json([], 200);
  }
});

// POST /api/records/reports/:id/approve — supervisor approves a pending report.
// Proxy to the incidents approve logic: updates status → 'approved'.
records.post('/reports/:id/approve', async (c) => {
  const roleErr = requireRole(c, 'admin', 'manager', 'supervisor');
  if (roleErr) return c.json({ error: roleErr }, 403);
  const id = c.req.param('id');
  const actor = c.get('user') as { id: number; role: string } | undefined;
  try {
    const db = getDb(c.env);
    const report = await queryFirst<{ id: number; status: string }>(db, 'SELECT id, status FROM incidents WHERE id = ?', id);
    if (!report) return c.json({ error: 'Report not found' }, 404);
    if (!['submitted', 'pending_approval', 'returned'].includes(report.status)) {
      return c.json({ error: 'Report is not in a reviewable status', code: 'INVALID_STATUS' }, 409);
    }
    await db.prepare(`UPDATE incidents SET status = 'approved', supervisor_id = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(actor?.id ?? null, id).run();
    return c.json({ success: true, id: Number(id), status: 'approved' });
  } catch (err) {
    console.error('POST /records/reports/:id/approve error:', err);
    return c.json({ error: 'Failed to approve report' }, 500);
  }
});

// POST /api/records/reports/:id/return — supervisor returns a report for revision.
records.post('/reports/:id/return', async (c) => {
  const roleErr = requireRole(c, 'admin', 'manager', 'supervisor');
  if (roleErr) return c.json({ error: roleErr }, 403);
  const id = c.req.param('id');
  const actor = c.get('user') as { id: number; role: string } | undefined;
  try {
    const body = await c.req.json() as { reason?: string };
    const reason = (body.reason ?? '').trim();
    if (!reason) return c.json({ error: 'Return reason is required' }, 400);
    const db = getDb(c.env);
    const report = await queryFirst<{ id: number; status: string }>(db, 'SELECT id, status FROM incidents WHERE id = ?', id);
    if (!report) return c.json({ error: 'Report not found' }, 404);
    // incidents stores supervisor feedback in review_notes (no supervisor_notes).
    await db.prepare(`UPDATE incidents SET status = 'returned', supervisor_id = ?, review_notes = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(actor?.id ?? null, reason, id).run();
    return c.json({ success: true, id: Number(id), status: 'returned', reason });
  } catch (err) {
    console.error('POST /records/reports/:id/return error:', err);
    return c.json({ error: 'Failed to return report' }, 500);
  }
});

/* ------------------------------------------------------------------ */
/*  Record links (cross-entity linkage)                                */
/* ------------------------------------------------------------------ */
//
// Ported from the legacy `rmpg-flex` Worker so the manual "Link Record"
// flow (client/src/components/LinkRecordModal.tsx +
// LinkedRecordsSection.tsx) actually persists. On the legacy backend the
// feature wrote zero rows for production's entire life (record_links
// stayed empty, no record_linked audit entries) — see the linkage-drop
// investigation. Routing /api/records/links to this rewrite handler via
// the proxy makes created_by come from the DB-verified `user.id`, which
// the legacy handler's NaN-prone `user.userId` bind could not guarantee.
//
// Live schema (verified): record_links(id, source_type, source_id TEXT,
// target_type, target_id TEXT, relationship DEFAULT 'associated', notes,
// created_by, created_at, UNIQUE(source_type, source_id, target_type,
// target_id)). source_id/target_id are TEXT — bind ids as strings so the
// comparison matches regardless of the numeric value the client sends.

/** Resolve a human-readable label for a linked record. Best-effort: any
 *  failure degrades to "<type> #<id>" rather than throwing the request. */
async function getRecordLabel(
  db: D1Database,
  type: string,
  id: string | number,
): Promise<string> {
  try {
    switch (type) {
      case 'person': {
        const p = await queryFirst<{ first_name: string; last_name: string }>(
          db, 'SELECT first_name, last_name FROM persons WHERE id = ?', id);
        return p ? `${p.first_name} ${p.last_name}`.trim() : `Person #${id}`;
      }
      case 'vehicle': {
        const v = await queryFirst<{ make: string; model: string; plate_number: string }>(
          db, 'SELECT make, model, plate_number FROM vehicles_records WHERE id = ?', id);
        return v
          ? `${v.make || ''} ${v.model || ''} ${v.plate_number ? `(${v.plate_number})` : ''}`.trim() || `Vehicle #${id}`
          : `Vehicle #${id}`;
      }
      case 'property': {
        const pr = await queryFirst<{ name: string; address: string }>(
          db, 'SELECT name, address FROM properties WHERE id = ?', id);
        return pr ? (pr.name || pr.address || `Property #${id}`) : `Property #${id}`;
      }
      case 'business': {
        // businesses migrated to their own `businesses` table in migration 0125.
        const biz = await queryFirst<{ name: string; address: string }>(
          db, 'SELECT name, address FROM businesses WHERE id = ?', id);
        return biz ? (biz.name || biz.address || `Business #${id}`) : `Business #${id}`;
      }
      case 'evidence': {
        const e = await queryFirst<{ evidence_number: string; description: string }>(
          db, 'SELECT evidence_number, description FROM evidence WHERE id = ?', id);
        return e ? `${e.evidence_number || ''} ${e.description || ''}`.trim() || `Evidence #${id}` : `Evidence #${id}`;
      }
      case 'incident': {
        const i = await queryFirst<{ incident_number: string; incident_type: string }>(
          db, 'SELECT incident_number, incident_type FROM incidents WHERE id = ?', id);
        return i ? `${i.incident_number || `Incident #${id}`}${i.incident_type ? ` — ${i.incident_type}` : ''}` : `Incident #${id}`;
      }
      case 'case': {
        const cs = await queryFirst<{ case_number: string; title: string }>(
          db, 'SELECT case_number, title FROM cases WHERE id = ?', id);
        return cs ? `${cs.case_number || `Case #${id}`}${cs.title ? ` — ${cs.title}` : ''}` : `Case #${id}`;
      }
      case 'warrant': {
        const w = await queryFirst<{ warrant_number: string; subject_name: string }>(
          db, 'SELECT warrant_number, subject_name FROM warrants WHERE id = ?', id);
        return w ? `${w.warrant_number || `Warrant #${id}`}${w.subject_name ? ` — ${w.subject_name}` : ''}` : `Warrant #${id}`;
      }
      default:
        return `${type} #${id}`;
    }
  } catch {
    return `${type} #${id}`;
  }
}

// Canonical map of linkable entity type → backing table. Single source of
// truth for both existence validation and label resolution. Mirrors
// LINKABLE_TYPES in client/src/utils/recordLinks.ts and RecordEntityType in
// client/src/types/index.ts. `business` has its own `businesses` table
// (migrated from `properties` in migration 0125).
// Values are a fixed whitelist — never interpolate caller input into SQL.
const LINK_ENTITY_TABLE: Record<string, string> = {
  person: 'persons',
  vehicle: 'vehicles_records',
  property: 'properties',
  business: 'businesses',
  evidence: 'evidence',
  incident: 'incidents',
  case: 'cases',
  warrant: 'warrants',
};

/** A type is linkable iff it maps to a known backing table. */
function isLinkableType(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(LINK_ENTITY_TABLE, type);
}

/** True iff a record of this linkable type with this id actually exists.
 *  Used to enforce the strict rule that a link's two endpoints must both be
 *  real records — you cannot link to a record that isn't in the system. */
async function recordExists(db: D1Database, type: string, id: string | number): Promise<boolean> {
  const table = LINK_ENTITY_TABLE[type];
  if (!table) return false;
  try {
    const row = await queryFirst<{ one: number }>(
      db, `SELECT 1 AS one FROM ${table} WHERE id = ? LIMIT 1`, id);
    return !!row;
  } catch {
    return false;
  }
}

interface RecordLinkRow {
  id: number;
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  relationship: string;
  notes: string | null;
  created_by: number | null;
  created_at: string;
  created_by_name?: string | null;
}

// GET /records/links?type=<entity>&id=<id> — links where the entity is
// either source OR target. Each row is enriched with the *other* side
// (linked_type / linked_id / linked_label) so the panel renders without
// a second round-trip.
// Accepts both `type`/`id` and `source_type`/`source_id` param naming
// conventions (the client's PrintRecordButton uses the latter).
records.get('/links', async (c) => {
  try {
    const db = getDb(c.env);
    const type = c.req.query('type') || c.req.query('source_type');
    const id = c.req.query('id') || c.req.query('source_id');
    if (!type || !id) {
      return c.json({ error: 'type and id query parameters are required' }, 400);
    }
    const links = await query<RecordLinkRow>(db, `
      SELECT rl.*, u.full_name AS created_by_name
      FROM record_links rl
      LEFT JOIN users u ON rl.created_by = u.id
      WHERE (rl.source_type = ? AND rl.source_id = ?)
         OR (rl.target_type = ? AND rl.target_id = ?)
      ORDER BY rl.created_at DESC
      LIMIT 1000
    `, type, id, type, id);

    const enriched = await Promise.all(links.map(async (link) => {
      const isSource = link.source_type === type && String(link.source_id) === String(id);
      const linkedType = isSource ? link.target_type : link.source_type;
      const linkedId = isSource ? link.target_id : link.source_id;
      // For vehicle links, include structured metadata so the PDF's VEHICLE /
      // COLOR / YEAR columns populate instead of parsing a label string.
      // For person links, include DOB + active-warrant flag for PS-203 table.
      let linked_meta: Record<string, unknown> | undefined;
      if (linkedType === 'vehicle') {
        const veh = await queryFirst<{ year?: number; color?: string; make?: string; model?: string; plate_number?: string }>(
          db, 'SELECT year, color, make, model, plate_number FROM vehicles_records WHERE id = ?', linkedId,
        );
        if (veh) linked_meta = veh as Record<string, unknown>;
      } else if (linkedType === 'person') {
        const per = await queryFirst<{ dob?: string }>(
          db, 'SELECT dob FROM persons WHERE id = ?', linkedId,
        );
        const wRow = await queryFirst<{ cnt: number }>(
          db, "SELECT COUNT(*) AS cnt FROM warrants WHERE subject_person_id = ? AND LOWER(status) = 'active'", linkedId,
        );
        if (per || (wRow && wRow.cnt > 0)) {
          linked_meta = {
            ...(per || {}),
            active_warrants: (wRow?.cnt ?? 0) > 0 ? 1 : 0,
          };
        }
      } else if (linkedType === 'property') {
        // Address for the PS-203 LINKED PROPERTIES table. Without this the PDF's
        // ADDRESS column was structurally always blank: getRecordLabel returns
        // the property NAME only, and no linked_meta was emitted for properties,
        // so nothing ever carried the address to the form.
        // Street address only: the PS-203 ADDRESS column is ~90pt and does not
        // wrap, so appending city/state/zip would clip mid-token.
        const prop = await queryFirst<{ address?: string }>(
          db, 'SELECT address FROM properties WHERE id = ?', linkedId,
        );
        if (prop) linked_meta = prop as Record<string, unknown>;
      } else if (linkedType === 'business') {
        // Businesses share the PDF's property table, so they need the same shape.
        const biz = await queryFirst<{ address?: string }>(
          db, 'SELECT address FROM businesses WHERE id = ?', linkedId,
        );
        if (biz) linked_meta = biz as Record<string, unknown>;
      }
      return {
        ...link,
        linked_type: linkedType,
        linked_id: linkedId,
        linked_label: await getRecordLabel(db, linkedType, linkedId),
        ...(linked_meta ? { linked_meta } : {}),
      };
    }));
    return c.json(enriched);
  } catch (err) {
    console.error('GET /records/links failed:', err);
    return dbErrorResponse(c, err, 'Failed to get record links');
  }
});

// POST /records/links — create a cross-entity link.
records.post('/links', async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user');
    const body = await c.req.json<Record<string, unknown>>();
    const source_type = body.source_type as string | undefined;
    const target_type = body.target_type as string | undefined;
    // ids are TEXT in the table; coerce to string so an integer id sent by
    // the client stores identically to how GET (?id=2) later queries it.
    const source_id = body.source_id != null ? String(body.source_id) : undefined;
    const target_id = body.target_id != null ? String(body.target_id) : undefined;
    const relationship = (body.relationship as string) || 'associated';
    const notes = (body.notes as string) || null;

    if (!source_type || !source_id || !target_type || !target_id) {
      return c.json({ error: 'source_type, source_id, target_type, and target_id are required' }, 400);
    }
    if (source_type === target_type && source_id === target_id) {
      return c.json({ error: 'Cannot link a record to itself' }, 400);
    }

    // Strict referential rule: both endpoints must be a KNOWN record type and
    // an EXISTING record. A record is never linked to a non-existent ("non-
    // linked") record — that would create a dangling link the connections
    // graph and PDFs can't resolve.
    if (!isLinkableType(source_type) || !isLinkableType(target_type)) {
      return c.json({
        error: `Unsupported record type. Linkable types: ${Object.keys(LINK_ENTITY_TABLE).join(', ')}.`,
        code: 'LINK_TYPE_UNSUPPORTED',
      }, 400);
    }
    const [srcOk, tgtOk] = await Promise.all([
      recordExists(db, source_type, source_id),
      recordExists(db, target_type, target_id),
    ]);
    if (!srcOk || !tgtOk) {
      const missing: string[] = [];
      if (!srcOk) missing.push(`source ${source_type} #${source_id}`);
      if (!tgtOk) missing.push(`target ${target_type} #${target_id}`);
      return c.json({
        error: `Cannot create link — ${missing.join(' and ')} not found. A record can only be linked to an existing record.`,
        code: 'LINK_ENDPOINT_NOT_FOUND',
      }, 422);
    }

    let result;
    try {
      result = await execute(db, `
        INSERT INTO record_links (source_type, source_id, target_type, target_id, relationship, notes, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `, source_type, source_id, target_type, target_id, relationship, notes, user.id);
    } catch (err) {
      // UNIQUE(source_type, source_id, target_type, target_id) — the exact
      // link already exists. Surface 409 so the client can message it
      // distinctly instead of a generic failure.
      if ((err as Error)?.message?.includes('UNIQUE constraint failed')) {
        return c.json({ error: 'This link already exists' }, 409);
      }
      throw err;
    }

    const linkId = Number(result.meta?.last_row_id || 0);

    // Audit trail (best-effort — a logging failure must not roll back the
    // link the user just created). UTC timestamp per the storage standard.
    try {
      const sourceLabel = await getRecordLabel(db, source_type, source_id);
      const targetLabel = await getRecordLabel(db, target_type, target_id);
      await execute(db, `
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `, user.id, 'record_linked', 'record_link', linkId,
        `Linked ${source_type} "${sourceLabel}" to ${target_type} "${targetLabel}"`,
        c.req.header('CF-Connecting-IP') || c.req.header('x-forwarded-for') || 'unknown');
    } catch (err) {
      console.error('record_linked audit log failed (non-fatal):', err);
    }

    const created = await queryFirst<RecordLinkRow>(db, `
      SELECT rl.*, u.full_name AS created_by_name
      FROM record_links rl
      LEFT JOIN users u ON rl.created_by = u.id
      WHERE rl.id = ?
    `, linkId);
    return c.json(created, 201);
  } catch (err) {
    console.error('POST /records/links failed:', err);
    return dbErrorResponse(c, err, 'Failed to create record link');
  }
});

// DELETE /records/links/:id — remove a link.
records.delete('/links/:id', async (c) => {
  try {
    const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
    if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid link id' }, 400);

    const link = await queryFirst<RecordLinkRow>(db, 'SELECT * FROM record_links WHERE id = ?', id);
    if (!link) return c.json({ error: 'Link not found' }, 404);

    await execute(db, 'DELETE FROM record_links WHERE id = ?', id);

    try {
      await execute(db, `
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `, user.id, 'record_unlinked', 'record_link', id,
        `Removed link between ${link.source_type} #${link.source_id} and ${link.target_type} #${link.target_id}`,
        c.req.header('CF-Connecting-IP') || c.req.header('x-forwarded-for') || 'unknown');
    } catch (err) {
      console.error('record_unlinked audit log failed (non-fatal):', err);
    }

    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /records/links failed:', err);
    return dbErrorResponse(c, err, 'Failed to delete record link');
  }
});

// ============================================================
// Bulk GET endpoints used by the SYNC layer + GlobalSearch.
// Added 2026-06-06 — the offline router's pull handlers call
// /api/records/persons and /api/records/vehicles on every sync;
// without these the SYNC fails and the offline cache stays empty.
// ============================================================

const PERSONS_BULK_COLUMNS = `id, first_name, middle_name, last_name, alias_nickname, dob, ssn_last4, dl_number, dl_state,
  phone, phone_secondary, email, address, city, state, zip, height_feet, height_inches, weight, race, gender, build,
  complexion, hair_color, hair_length, hair_style, facial_hair, eye_color, glasses, scars_marks_tattoos,
  is_sex_offender, is_veteran, occupation, employer, photo, photo_url, id_image_url, caution_flags, flags, notes,
  created_at, updated_at`;

const VEHICLES_BULK_COLUMNS = `id, vin, plate_number, state, make, model, year, color, body_style,
  owner_name, owner_phone, owner_address, owner_person_id, registered_owner, insurance_company, insurance_policy, insurance_expiry,
  is_stolen, stolen_status, flags, notes, created_at, updated_at`;

// GET /records/persons?search=...&limit=...&officer_safety=true
// Bulk list for SYNC. search is a soft LIKE across name + alias + phone + email.
// officer_safety=true filters to persons with active officer safety flags.
records.get('/persons', async (c) => {
  try {
    const db = getDb(c.env);
    const search = c.req.query('search') || '';
    const archived = c.req.query('archived');
    const officerSafety = c.req.query('officer_safety') === 'true';
    const limit = Math.min(parseInt(c.req.query('limit') || '500', 10) || 500, 2000);
    const wheres: string[] = [];
    if (archived === 'true') {
      wheres.push("flags LIKE '%archived%'");
    } else if (archived !== 'all') {
      wheres.push("(flags IS NULL OR flags = '[]' OR flags NOT LIKE '%archived%')");
    }
    if (officerSafety) {
      // Filter to persons with active officer safety flags (weapon_draw, running, struggle, etc.)
      wheres.push("(flags LIKE '%weapon_draw%' OR flags LIKE '%running%' OR flags LIKE '%struggle%' OR flags LIKE '%officer_safety%')");
    }
    const params: unknown[] = [];
    if (search) {
      const ms = containsAnyClause(['first_name', 'last_name', 'alias_nickname', 'phone', 'email', 'dl_number']);
      wheres.push(ms.sql);
      params.push(...ms.binds(search));
    }
    const whereClause = wheres.length ? ' WHERE ' + wheres.join(' AND ') : '';
    const sql = `SELECT ${PERSONS_BULK_COLUMNS} FROM persons${whereClause} ORDER BY last_name, first_name LIMIT ?`;
    // Snapshot the predicate bindings BEFORE the LIMIT is appended — the count
    // query shares the WHERE clause but must not receive the limit parameter.
    const whereParams = [...params];
    params.push(limit);
    const rows = await query<Record<string, unknown>>(db, sql, ...params);
    // See the evidence handler: total is the MATCHING count, not the page size.
    const totalRow = await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM persons${whereClause}`, ...whereParams).catch(() => null);
    return c.json({ data: rows, pagination: { total: totalRow?.n ?? rows.length, limit, returned: rows.length } });
  } catch (err) {
    console.error('GET /records/persons failed:', err);
    return c.json({ error: 'Failed to list persons' }, 500);
  }
});

// GET /records/vehicles?search=...&limit=...
// Bulk list for SYNC. search is a soft LIKE across plate + VIN + make/model + owner.
records.get('/vehicles', async (c) => {
  try {
    const db = getDb(c.env);
    const search = c.req.query('search') || '';
    const archived = c.req.query('archived');
    const limit = Math.min(parseInt(c.req.query('limit') || '500', 10) || 500, 2000);
    const wheres: string[] = [];
    if (archived === 'true') {
      wheres.push("flags LIKE '%archived%'");
    } else if (archived !== 'all') {
      wheres.push("(flags IS NULL OR flags = '[]' OR flags NOT LIKE '%archived%')");
    }
    const params: unknown[] = [];
    if (search) {
      const ms = containsAnyClause(['plate_number', 'vin', 'make', 'model', 'owner_name', 'registered_owner']);
      wheres.push(ms.sql);
      params.push(...ms.binds(search));
    }
    const whereClause = wheres.length ? ' WHERE ' + wheres.join(' AND ') : '';
    const sql = `SELECT ${VEHICLES_BULK_COLUMNS} FROM vehicles_records${whereClause} ORDER BY updated_at DESC LIMIT ?`;
    // Snapshot before LIMIT is appended — see the persons handler above.
    const whereParams = [...params];
    params.push(limit);
    const rows = await query<Record<string, unknown>>(db, sql, ...params);
    const totalRow = await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM vehicles_records${whereClause}`, ...whereParams).catch(() => null);
    return c.json({ data: rows, pagination: { total: totalRow?.n ?? rows.length, limit, returned: rows.length } });
  } catch (err) {
    console.error('GET /records/vehicles failed:', err);
    return c.json({ error: 'Failed to list vehicles' }, 500);
  }
});

records.get('/clients', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, 'SELECT * FROM clients ORDER BY name LIMIT 1000');
    return c.json(rows);
  } catch {
    return c.json([]);
  }
});

export default records;
