// ============================================================
// RMPG Flex — Serve Intake record commit pipeline
// ============================================================
// Turns an extracted-fields blob (from serveIntakeExtract) into a
// fully-linked set of RMS rows:
//
//   businesses        — created if recipient_type='business'
//   persons           — created for the human served (the recipient,
//                       OR the registered agent if it's corporate)
//   properties        — one row per intake address, deduped by
//                       normalized address; uses a sentinel client
//                       so the NOT NULL FK is satisfied
//   calls_for_service — one CFS row per intake (call_number generated
//                       via the same CFS{YY}-{NNNNN} sequence as
//                       /api/dispatch/calls)
//   call_persons      — link recipient + registered agent to the call
//   call_businesses   — link the business to the call (when applicable)
//   serve_queue       — back-references all of the above via
//                       call_id / property_id / recipient_person_id
//
// All "find-or-create" helpers prefer reuse over duplication so a
// re-uploaded packet for an existing recipient doesn't fork the
// records. Match criteria are intentionally conservative:
//   • persons: case-insensitive last+first match, optional phone tie
//   • businesses: case-insensitive name + normalized address
//   • properties: normalized address only
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings } from '../types';
import { execute, query, queryFirst, columnExists } from './db';
import { geocodeAddress } from '../routes/geocode';
import { resolveDistrict } from './districtResolver';
import { deriveCrossStreetFromCoords } from './crossStreet';
import { parseLocationParts } from './parseLocationParts';
import { buildPsoBriefing, buildOcrContext, isAutoCreatedBusinessRecord } from './serveIntakeBriefing';
import type { IntakeDocMeta, OcrContext, PropertyRecord, BusinessRecord } from './serveIntakeBriefing';
import { createCaseWithLinks } from './caseCreate';
import {
  planAttemptWindows, escalatePriorityForDeadline,
  clusterByProximity, applyUrgencyTier, daysUntilDeadline,
} from './serveDiligencePlanner';
import type { AttemptWindow } from './serveDiligencePlanner';
import { persistAttemptSchedule } from './serveAttemptScheduler';
import { findLocationNote } from './serveLocationNotes';
import { resolveAddressClass } from './serveAddressClass';
import { inferVenueKind, buildOutputTree } from './serveIntakeOutputTree';
import { coerceVenueKind, normalizeServeJobOps } from './serveJobOps';
import { parseClientBands, parseAllowedDays } from './serveScheduleParse';
import { scheduleFitsDeadline } from './serveAttemptWindows';
import { log } from './logger';
import type { ExtractedField, QueueRow, ServePriority } from './serveIntakeExtract';
import { encodePsoServiceWindows } from './serveIntakeExtract';
import type { FieldConflict } from './serveIntakeArbitrate';
import { toDisplayLabel } from './displayLabel';

// ── Sentinel client for intake-generated properties ──────────
// properties.client_id is NOT NULL and FKs to clients(id). Process-
// service intake doesn't naturally have a parent client, so we
// create one sentinel row called "Process Service External" the
// first time it's needed, then reuse it forever.
const SENTINEL_CLIENT_NAME = 'Process Service External';

export async function ensureSentinelClient(db: D1Database): Promise<number> {
  const found = await queryFirst<{ id: number }>(
    db, 'SELECT id FROM clients WHERE name = ? LIMIT 1', SENTINEL_CLIENT_NAME,
  );
  if (found) return found.id;
  const result = await execute(
    db,
    `INSERT INTO clients (name, contact_name, status, notes)
     VALUES (?, ?, 'active', 'Auto-created for process-service intake. Do not delete — used as default client_id for intake-generated property rows.')`,
    SENTINEL_CLIENT_NAME, 'system',
  );
  return Number(result.meta.last_row_id);
}

// ── Normalization helpers ────────────────────────────────────
// Cheap normalize: lowercase, collapse whitespace, strip trailing
// commas/periods. Enough to dedupe "525 East 300 South" vs
// "525  East  300  South." without doing real address parsing.
export function normAddr(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
}

function normName(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
}

// Finding 3 FIX: whether the ACTUAL planned attempt count (not a hardcoded
// guess at what the default "should" be) fits the days remaining before the
// deadline. `plannedWindowCount` must be the real `attemptPlan.length` —
// business defaults are 2 windows, residential/unknown defaults are 3, and a
// client schedule can specify any count; guessing any single constant is
// wrong for at least one of those cases.
export function computeScheduleImpossible(
  plannedWindowCount: number,
  daysRemaining: number | null,
): boolean {
  return !scheduleFitsDeadline(plannedWindowCount, daysRemaining);
}

// A registered-agent string is only a real human name worth a `persons` row
// when it (a) doesn't read as a role/department label and (b) actually has a
// plausible two-token human name. Court packets routinely list the corporate
// agent as generic boilerplate ("Medical Records Department", "Registered
// Agent", "Custodian of Records", "Front Desk") — splitFullName() turns those
// into junk rows like first="Medical"/last="Department". When the agent text
// looks like a role rather than a person, we link the business only and skip
// the person row.
const AGENT_ROLE_PATTERN = /department|records|registered agent|authorized|custodian|front desk|reception|legal dept|hr\b/i;

export function isPlausibleAgentPersonName(full: string | null | undefined): boolean {
  const s = (full || '').trim();
  if (!s) return false;
  // Reject sentinel/placeholder noise the OCR sometimes emits.
  if (/^(none|n\/?a|unknown|n\/a)$/i.test(s)) return false;
  // Role/department label → not a person.
  if (AGENT_ROLE_PATTERN.test(s)) return false;
  // Require a plausible 2-token human name: at least two alphabetic tokens
  // (allowing internal hyphens/apostrophes for names like "O'Brien" or
  // "Smith-Jones"). A single token ("Reception") or a token soup of initials
  // doesn't clear the bar.
  const tokens = s.split(/\s+/).filter(Boolean);
  const nameTokens = tokens.filter((t) => /^[A-Za-z][A-Za-z'’-]*$/.test(t));
  return nameTokens.length >= 2;
}

// Split a corporate-style "First Middle Last" into a person row.
// If the input is just "Joan Lind" → { first: 'Joan', last: 'Lind' }.
// If it's "Joan", we still need last_name NOT NULL — fall back to '?'.
export function splitFullName(full: string | null): { first: string; middle: string; last: string } {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', middle: '', last: '' };
  if (parts.length === 1) return { first: parts[0], middle: '', last: '-' };
  if (parts.length === 2) return { first: parts[0], middle: '', last: parts[1] };
  return { first: parts[0], middle: parts.slice(1, -1).join(' '), last: parts[parts.length - 1] };
}

// ── Person ───────────────────────────────────────────────────
export interface PersonInput {
  first_name: string;
  last_name: string;
  middle_name?: string;
  dob?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface RecordRef { id: number; created: boolean }

export async function findOrCreatePerson(db: D1Database, p: PersonInput): Promise<RecordRef> {
  const first = p.first_name.trim();
  const last = (p.last_name || '').trim() || '-';
  if (!first && last === '-') {
    // Caller passed nothing actionable — return a sentinel "0" so
    // the upstream caller can decide to skip linking.
    return { id: 0, created: false };
  }
  // Match on (last, first) case-insensitively first; tighten with
  // phone when present to avoid colliding common names.
  const params: unknown[] = [normName(last), normName(first)];
  let where = "LOWER(last_name) = ? AND LOWER(first_name) = ?";
  if (p.phone) { where += " AND phone = ?"; params.push(p.phone); }
  const existing = await queryFirst<{ id: number }>(
    db, `SELECT id FROM persons WHERE ${where} LIMIT 1`, ...params,
  );
  if (existing) return { id: existing.id, created: false };

  // Persons schema (migration 0001): first_name NOT NULL, last_name NOT NULL,
  // dob, gender, race, height, weight, hair_color, eye_color, scars_marks_tattoos,
  // address, phone, email, photo_url, flags, notes, created_at.
  const ins = await execute(
    db,
    `INSERT INTO persons (first_name, last_name, dob, address, phone, email, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    first || '-', last,
    p.dob || null,
    p.address || null, p.phone || null, p.email || null,
    'Auto-created via serve intake',
  );
  return { id: Number(ins.meta.last_row_id), created: true };
}

// ── Business ─────────────────────────────────────────────────
export interface BusinessInput {
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  business_type?: string | null;
  notes?: string | null;
}

export async function findOrCreateBusiness(db: D1Database, b: BusinessInput): Promise<RecordRef> {
  const name = (b.name || '').trim();
  if (!name) return { id: 0, created: false };
  const normalizedAddr = normAddr(b.address);
  // Match by case-insensitive name first; if the same name appears
  // with different addresses we treat each as a distinct row (chains).
  const candidates = await query<{ id: number; address: string | null }>(
    db, 'SELECT id, address FROM businesses WHERE LOWER(name) = ? LIMIT 20', normName(name),
  );
  for (const c of candidates) {
    if (!normalizedAddr || normAddr(c.address) === normalizedAddr) {
      return { id: c.id, created: false };
    }
  }
  const ins = await execute(
    db,
    `INSERT INTO businesses (name, address, city, state, zip, phone, contact_name, contact_phone, business_type, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    name, b.address || null, b.city || null, b.state || null, b.zip || null,
    b.phone || null, b.contact_name || null, b.contact_phone || null,
    b.business_type ?? 'process_service_recipient', b.notes ?? 'Auto-created via serve intake',
  );
  return { id: Number(ins.meta.last_row_id), created: true };
}

// ── Property ─────────────────────────────────────────────────
export interface PropertyInput {
  name: string;
  address: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  property_type?: string | null;
}

export async function findOrCreateProperty(db: D1Database, p: PropertyInput): Promise<RecordRef> {
  const address = (p.address || '').trim();
  if (!address) return { id: 0, created: false };
  const normalizedAddr = normAddr(address);
  // properties.address is the canonical match key. Same address on
  // two intakes = same property, no matter who the recipient is.
  const candidates = await query<{ id: number; address: string }>(
    db, 'SELECT id, address FROM properties WHERE LOWER(address) LIKE ? LIMIT 20',
    `%${normalizedAddr.split(' ').slice(0, 4).join(' ')}%`,
  );
  for (const c of candidates) {
    if (normAddr(c.address) === normalizedAddr) {
      return { id: c.id, created: false };
    }
  }
  const clientId = await ensureSentinelClient(db);
  // is_active is the only column we MUST set beyond the original 0001
  // schema — live D1 added `is_active INTEGER NOT NULL` via the 0037
  // backport WITHOUT a default value, so an INSERT that omits it crashes
  // with SQLITE_CONSTRAINT_NOTNULL (observed in prod 2026-05-27, first
  // real intake attempt). The other 0037 columns (city/state/zip/notes/
  // updated_at/etc.) are all nullable — keeping the projection narrow so
  // a future column rename/drop on live doesn't break this writer.
  const ins = await execute(
    db,
    `INSERT INTO properties (client_id, name, address, latitude, longitude, property_type, post_orders, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    clientId,
    p.name || address,
    address,
    p.latitude ?? null, p.longitude ?? null,
    p.property_type || 'process_service',
    'Auto-created via serve intake',
  );
  return { id: Number(ins.meta.last_row_id), created: true };
}

// ── Call number generation ───────────────────────────────────
// Mirrors src/routes/dispatch/calls.ts (CFS{YY}-{NNNNN}) so intake-
// created calls slot into the same sequence as dispatcher-created
// calls without a gap or a parallel namespace.
export async function nextCallNumber(db: D1Database): Promise<string> {
  const year = new Date().getFullYear().toString().slice(-2);
  const prefix = `CFS${year}-`;
  // Belt-and-suspenders: scan forward past any numbers that were minted
  // by a racing writer between our MAX read and the eventual INSERT.
  // The caller's withUniqueRetry provides the outer safety net; this
  // loop avoids the retry cost when we can detect the collision early.
  for (let skip = 0; skip < 10; skip++) {
    const max = await queryFirst<{ max: string | null }>(
      db, "SELECT MAX(call_number) as max FROM calls_for_service WHERE call_number LIKE ?",
      `${prefix}%`,
    );
    const n = max?.max
      ? parseInt(max.max.slice(prefix.length), 10) + 1 + skip
      : 1 + skip;
    const candidate = `${prefix}${String(n).padStart(5, '0')}`;
    const exists = await queryFirst<{ n: number }>(
      db, 'SELECT 1 FROM calls_for_service WHERE call_number = ? LIMIT 1',
      candidate,
    );
    if (!exists) return candidate;
  }
  // Fallback: return the raw MAX+1 and let withUniqueRetry handle collision.
  const max = await queryFirst<{ max: string | null }>(
    db, "SELECT MAX(call_number) as max FROM calls_for_service WHERE call_number LIKE ?",
    `${prefix}%`,
  );
  const seq = max?.max
    ? String(parseInt(max.max.slice(prefix.length), 10) + 1).padStart(5, '0')
    : '00001';
  return `${prefix}${seq}`;
}

// ── UNIQUE-violation detection + retry ───────────────────────
// call_number is UNIQUE on calls_for_service. The minter is a non-atomic
// SELECT MAX()+1, so two writers racing (intake + dispatcher, or two intakes)
// can mint the same number; the loser's INSERT throws SQLITE_CONSTRAINT and the
// call silently drops. Detect that specific failure so we can re-mint + retry
// instead of swallowing it.
export function isUniqueViolation(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  // Match ONLY UNIQUE violations — NOT the bare "constraint failed" substring,
  // which SQLite/D1 also emits for NOT NULL / CHECK / FOREIGN KEY failures
  // ("NOT NULL constraint failed: …"). Treating those as a call_number collision
  // re-minted + retried 5× pointlessly and masked the real cause.
  return msg.includes('unique') || msg.includes('2067') /* SQLITE_CONSTRAINT_UNIQUE */;
}

// Run an INSERT that may collide on a freshly-minted unique key. `mint` produces
// a candidate value (re-minted each attempt so a retry picks up any rows the
// racing writer just committed); `insert` performs the INSERT with it. On a
// UNIQUE violation we re-mint + retry up to `attempts` times; any other error
// (or exhausting the retries) rethrows so the caller's existing handling fires.
export async function withUniqueRetry<T>(
  mint: () => Promise<string>,
  insert: (value: string) => Promise<T>,
  attempts = 5,
): Promise<{ value: string; result: T }> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const value = await mint();
    try {
      const result = await insert(value);
      return { value, result };
    } catch (err) {
      lastErr = err;
      if (!isUniqueViolation(err)) throw err;
      // Collision — loop re-mints against the now-advanced MAX and retries.
    }
  }
  throw lastErr;
}

// ── Incident-type classification ─────────────────────────────
// All serve-intake calls appear on the dispatch board as 'pso_client_request'
// so dispatchers see the unified "PSO Client Request" label rather than a mix
// of civil-paper sub-types. Sub-type detail is already recorded on serve_queue
// (document_type) and in the call description, so nothing is lost.
function resolveIncidentType(
  _docType: string | null,
  _fields: Record<string, ExtractedField>,
): string {
  return 'pso_client_request';
}

// ── Priority mapping (serve → CAD ladder) ────────────────────
// CAD CFS priority is P1..P4. Civil-paper service is rarely time-
// critical; even a rush packet sits at P2 because true P1 is
// reserved for in-progress emergencies. The mapping is intentionally
// conservative so intake never floods the active-calls queue with
// fake P1s.
export function cadPriority(p: ServePriority): 'P1' | 'P2' | 'P3' | 'P4' {
  switch (p) {
    case 'urgent':  return 'P1';
    case 'rush':    return 'P2';
    case 'normal':  return 'P3';
    case 'routine': return 'P4';
  }
}

const SERVE_QUEUE_INTAKE_COPY_COLS = new Set([
  'recipient_phone', 'recipient_dob', 'recipient_type',
  'business_name', 'registered_agent_name', 'registered_office_address',
  'serve_type', 'serve_fee', 'time_window',
  'attorney_phone', 'attorney_email', 'attorney_bar_number',
]);

const CFS_INTAKE_COPY_COLS = new Set([
  'attorney_name', 'jurisdiction', 'deadline', 'time_window',
  'service_instructions', 'plaintiff_name',
]);

/** Copy intake fields onto dedicated serve_queue columns Process Server reads. */
async function patchServeQueueIntakeCopy(
  db: D1Database,
  queueId: number,
  row: QueueRow,
): Promise<void> {
  const pairs: Array<[string, unknown]> = [
    ['recipient_phone', row.recipient_phone],
    ['recipient_dob', row.recipient_dob],
    ['recipient_type', row.recipient_type],
    ['business_name', row.business_name],
    ['registered_agent_name', row.registered_agent_name],
    ['registered_office_address', row.registered_office_address],
    ['serve_type', row.serve_type],
    ['serve_fee', row.serve_fee],
    ['time_window', row.time_window],
    ['attorney_phone', row.attorney_phone],
    ['attorney_email', row.attorney_email],
    ['attorney_bar_number', row.attorney_bar_number],
  ];
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [col, val] of pairs) {
    if (!SERVE_QUEUE_INTAKE_COPY_COLS.has(col)) continue;
    if (val == null || val === '') continue;
    try {
      if (!(await columnExists(db, 'serve_queue', col))) continue;
    } catch {
      continue;
    }
    sets.push(`${col} = ?`);
    args.push(val);
  }
  if (!sets.length) return;
  try {
    args.push(queueId);
    await execute(db, `UPDATE serve_queue SET ${sets.join(', ')} WHERE id = ?`, ...args);
  } catch (err) {
    log.warn('serve_queue copy patch skipped', { queueId, error: String(err) });
  }
}

async function patchCfsExtIntakeCopy(
  db: D1Database,
  callId: number,
  fields: Record<string, string | null>,
): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [col, val] of Object.entries(fields)) {
    if (!CFS_INTAKE_COPY_COLS.has(col)) continue;
    if (val == null || val === '') continue;
    try {
      if (!(await columnExists(db, 'calls_for_service_ext', col))) continue;
    } catch {
      continue;
    }
    sets.push(`${col} = COALESCE(NULLIF(?, ''), ${col})`);
    args.push(val);
  }
  if (!sets.length) return;
  try {
    args.push(callId);
    await execute(db, `UPDATE calls_for_service_ext SET ${sets.join(', ')} WHERE id = ?`, ...args);
  } catch (err) {
    log.warn('CFS ext copy patch skipped', { callId, error: String(err) });
  }
}

// ── Call creation ────────────────────────────────────────────
export interface ServiceCallInput {
  call_number: string;
  incident_type: string;
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  caller_name: string | null;
  caller_phone: string | null;
  location_address: string;
  property_id: number | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  // PSO pre-arrival briefing (all columns verified on live D1 2026-05-29):
  notes: string | null;                  // JSON array of note objects (Notes tab feed)
  scene_safety: string | null;           // Info-tab Scene section
  officer_safety_caution: 0 | 1;         // red caution badge / Flags tab
  domestic_violence: 0 | 1;              // Flags tab (protective orders)
  dispatcher_id: number | null;
  client_id?: number | null;
  // ── Geo enrichment (parity with a dispatcher-created call) ──
  // All optional + best-effort. The base columns are the SAME ones
  // dispatch/calls.ts populates (they exist on live calls_for_service);
  // area_* live on the 1:1 calls_for_service_ext (base is at the 100-col cap).
  // Written via a post-INSERT UPDATE so a column miss never blocks call creation.
  cross_street?: string | null;
  location_building?: string | null;
  location_floor?: string | null;
  location_room?: string | null;
  sector_id?: number | null;
  sector_name?: string | null;
  zone_id?: string | null;
  zone_name?: string | null;
  beat_id?: string | null;
  beat_name?: string | null;
  beat_descriptor?: string | null;
  zone_beat?: string | null;
  dispatch_code?: string | null;
  area_code?: string | null;             // → calls_for_service_ext
  area_name?: string | null;             // → calls_for_service_ext
}

export async function createServiceCall(db: D1Database, c: ServiceCallInput): Promise<{ id: number }> {
  // Only touch columns that exist on the schema in migrations/0001_initial_schema.sql.
  // calls_for_service is at the 100-col cap (see CLAUDE.md gotcha #13) — never ADD a
  // column here without porting it to calls_for_service_ext.
  //
  // source MUST be one of the CHECK-allowed values on live D1:
  //   'phone','radio','alarm','walk_in','email','patrol','online','dispatch',
  //   'panic','servemanager','intake','other'
  // Earlier draft used 'process_service' which is NOT in that list — that would
  // have failed with SQLITE_CONSTRAINT_CHECK on the next INSERT after the
  // properties.is_active fix. 'intake' is the existing canonical value used by
  // other intake flows (ServeManager pollers etc.) so it groups cleanly in
  // dispatch-source analytics.
  // latitude/longitude are EXISTING columns (dispatch/calls.ts writes them);
  // we're not adding to the 100-col table, just populating two more so the
  // intake call pins on the dispatch map exactly like a dispatcher-created one.
  const result = await execute(
    db,
    `INSERT INTO calls_for_service (
      call_number, incident_type, priority, status,
      caller_name, caller_phone, location_address, property_id,
      latitude, longitude, description,
      notes, scene_safety, officer_safety_caution, domestic_violence,
      source, dispatcher_id, client_id
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'intake', ?, ?)`,
    c.call_number, c.incident_type, c.priority,
    c.caller_name, c.caller_phone, c.location_address, c.property_id,
    c.latitude, c.longitude, c.description,
    c.notes, c.scene_safety, c.officer_safety_caution, c.domestic_violence,
    c.dispatcher_id, c.client_id ?? null,
  );
  const id = Number(result.meta.last_row_id);

  // ── Geo enrichment (best-effort, AFTER the call commits) ──────
  // Applied as a separate UPDATE rather than folded into the INSERT above so a
  // single drifted column can never abort call creation — the intake's whole
  // purpose is to produce a call. A failure here degrades to "no cross-street /
  // district", not "no call". These base columns mirror dispatch/calls.ts.
  const geoSets: string[] = [];
  const geoParams: unknown[] = [];
  const addGeo = (col: string, val: unknown) => {
    if (val != null && val !== '') { geoSets.push(`${col} = ?`); geoParams.push(val); }
  };
  addGeo('cross_street', c.cross_street);
  addGeo('location_building', c.location_building);
  addGeo('location_floor', c.location_floor);
  addGeo('location_room', c.location_room);
  addGeo('sector_id', c.sector_id);
  addGeo('sector_name', c.sector_name);
  addGeo('zone_id', c.zone_id);
  addGeo('zone_name', c.zone_name);
  addGeo('beat_id', c.beat_id);
  addGeo('beat_name', c.beat_name);
  addGeo('beat_descriptor', c.beat_descriptor);
  addGeo('zone_beat', c.zone_beat);
  addGeo('dispatch_code', c.dispatch_code);
  if (geoSets.length) {
    try {
      geoParams.push(id);
      await execute(db, `UPDATE calls_for_service SET ${geoSets.join(', ')} WHERE id = ?`, ...geoParams);
    } catch (err) {
      console.warn('[createServiceCall] geo enrichment update skipped (non-fatal):', err);
    }
  }

  // Area (top of A/S/Z/B) lives on the 1:1 ext table (base is at the 100-col cap).
  if (c.area_code != null || c.area_name != null) {
    try {
      await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', id);
      await execute(
        db,
        'UPDATE calls_for_service_ext SET area_code = COALESCE(?, area_code), area_name = COALESCE(?, area_name) WHERE id = ?',
        c.area_code ?? null, c.area_name ?? null, id,
      );
    } catch (err) {
      console.warn('[createServiceCall] area ext write skipped (non-fatal):', err);
    }
  }

  return { id };
}

// ── Linking ──────────────────────────────────────────────────
// call_persons and call_businesses already exist (migrations 0022,
// 0023). UNIQUE(call_id, person_id, role) and the equivalent for
// businesses prevent duplicate rows — we use INSERT OR IGNORE as a
// defensive net in case a recipient is also their own agent.
export async function linkCallToPerson(
  db: D1Database, callId: number, personId: number, role: string, addedBy: number | null,
): Promise<void> {
  if (!callId || !personId) return;
  await execute(
    db,
    `INSERT OR IGNORE INTO call_persons (call_id, person_id, role, added_by)
     VALUES (?, ?, ?, ?)`,
    callId, personId, role, addedBy,
  );
}

export async function linkCallToBusiness(
  db: D1Database, callId: number, businessId: number, role: string, addedBy: number | null,
): Promise<void> {
  if (!callId || !businessId) return;
  await execute(
    db,
    `INSERT OR IGNORE INTO call_businesses (call_id, business_id, role, added_by)
     VALUES (?, ?, ?, ?)`,
    callId, businessId, role, addedBy,
  );
}

// ── Top-level commit ─────────────────────────────────────────
// Single entry point used by both /upload and /intake. Takes the
// merged-fields blob + the assembled QueueRow and produces every
// downstream record, returning a flat result the route can pass
// back to the client unchanged.
export interface CommitResult {
  serve_queue_id: number | null;
  person_id: number | null;            // the human we will physically serve
  agent_person_id: number | null;      // distinct from person_id ONLY when corporate
  business_id: number | null;          // only set when corporate
  property_id: number | null;
  call_id: number | null;
  call_number: string | null;
  created: {
    person: boolean; agent_person: boolean; business: boolean;
    property: boolean; call: boolean;
  };
  // OCR provenance summary (only when the caller supplied per-doc metadata).
  intake_note?: string | null;
  missing_critical?: string[];
  // Diligence plan computed at intake (also embedded in parsed_data._intake).
  attempt_plan?: AttemptWindow[];
  // Set when an ACTIVE queue entry already exists for this case+recipient —
  // no new records are created; uploaded documents attach to the existing
  // entry instead (serve_queue_id points at it).
  duplicate_of?: { serve_queue_id: number; status: string; case_number: string | null } | null;
  // Auto-created Case File (migration 0146) anchoring everything from this
  // intake batch — CFS, persons, property, the queue row itself, and the
  // uploaded packet docs. Null only when the case-create write itself
  // failed (best-effort: a case-create error never aborts the intake).
  // On duplicate intake we surface the EXISTING case (looked up via the
  // duplicate queue row's case_id) so re-uploads attach to the same file.
  case_id?: number | null;
  rmpg_case_number?: string | null;
}

export interface CommitInput {
  fields: Record<string, ExtractedField>;
  queueRow: QueueRow;
  userId: number | null;
  documentSummary: string;             // free-text inserted into call.description
  docCount: number;                    // number of uploaded docs (for the briefing note)
  // Per-document OCR provenance (file → engine/confidence/type) + every date
  // the extractor saw. When present, commitIntake files an "OCR & EXTRACTION
  // CONTEXT" note on the CFS Notes feed, appends a compact provenance line to
  // serve_queue.notes, and embeds a machine-readable `_intake` block in
  // parsed_data. Optional — the legacy /intake path has no per-doc metadata.
  docs?: IntakeDocMeta[];
  allDates?: string[];
  // Cross-document arbitration output (serveIntakeArbitrate.arbitrateFields).
  // Embedded verbatim into parsed_data._intake.conflicts so the PR 4 review
  // UI can offer the rejected candidate instead of the value we picked.
  // Optional — single-document callers (/intake legacy path, document
  // reprocessing) have nothing to arbitrate.
  conflicts?: FieldConflict[];
  // Cross-field validation issues (serveIntakeValidate.validateFields), e.g.
  // ZIP↔state disagreement or a bad phone digit count. Previously these only
  // reached log.warn, so an officer saw a confidence knocked down with no
  // stated reason. Embedded verbatim into parsed_data._intake.validation_issues
  // so PR 4's review UI can show the reason behind the lowered confidence.
  validationIssues?: Array<{ field: string; severity: 'warn' | 'error'; message: string }>;
  // Operator-selected client (from the intake form's client dropdown). When
  // set, it is written directly to serve_queue.client_id and skips the
  // post-hoc name-based lookup that would otherwise resolve the contract.
  clientId?: number | null;
  // Full Worker bindings. KV powers the geocode cache; DB + MAP_DATA back the
  // R2 geofence (district resolve); MAPBOX_ACCESS_TOKEN powers cross-street
  // derivation. All geo enrichment is best-effort — a miss never blocks commit.
  // (Both callers — /upload and /intake — already pass `env: c.env`.)
  env: Bindings;
  // Phase 1 Quality Gate — multi-defendant fan-out. When null/undefined, the
  // existing single-recipient path runs. When non-empty, the function loops
  // over each name, creating one full intake per defendant linked to a single
  // shared case_file_id. Operator picks come from the review-panel picker.
  defendantsSelected?: string[] | null;
  // FK back to serve_intake_judge_runs.id, stamped onto every serve_queue row
  // created in this commit so a reviewer can drill from a flagged queue row
  // to the per-field verdict + raw model response.
  judgeRunId?: number | null;
  // From the judgeResult — persisted to serve_queue.quality_status on every
  // row created. 'clean' | 'needs_review' | 'error'. Defaults to 'clean'.
  qualityStatus?: 'clean' | 'needs_review' | 'error';
  // Phase 1 Quality Gate — multi-defendant fan-out. When set, commitOneIntake
  // SKIPS case-file creation and links the new serve_queue row to this
  // existing case instead. The wrapper sets it on iterations 2..N from
  // iteration 1's returned case_id, so all defendants in one packet land
  // under one case file.
  forcedCaseId?: number | null;
}

export async function commitIntake(db: D1Database, input: CommitInput): Promise<CommitResult> {
  const picks = input.defendantsSelected;
  if (!picks || picks.length <= 1) {
    return commitOneIntake(db, input);
  }
  let firstResult: CommitResult | null = null;
  let sharedCaseId: number | null = null;
  for (let i = 0; i < picks.length; i++) {
    const fullName = picks[i].trim();
    const { first, last } = splitFullName(fullName);
    const perFields = {
      ...input.fields,
      recipient_first_name: { value: first, confidence: 1.0 },
      recipient_last_name: { value: last, confidence: 1.0 },
      recipient_business_name: { value: '', confidence: 0 },
    };
    const perQueueRow = { ...input.queueRow, recipient_name: fullName };
    const res = await commitOneIntake(db, {
      ...input,
      fields: perFields,
      queueRow: perQueueRow,
      forcedCaseId: sharedCaseId,    // null for iter 1; populated for iters 2..N
    });
    if (!firstResult) firstResult = res;
    if (res.case_id != null && sharedCaseId == null) sharedCaseId = res.case_id;
  }
  return firstResult!;
}

async function commitOneIntake(db: D1Database, input: CommitInput): Promise<CommitResult> {
  const { fields, queueRow, userId } = input;
  const get = (k: string) => (fields[k]?.value || '').trim();
  const nowIso = new Date().toISOString();

  // ── Duplicate-intake guard ─────────────────────────────────
  // A re-uploaded packet (or a client-side duplicate job, common in
  // ServeManager exports) must not spawn a second active queue entry +
  // CAD call for the same paper — double-serving wastes attempts and
  // reads badly in court. Match on case number + recipient when both
  // exist, else recipient + address. Only ACTIVE entries block; a served/
  // cancelled/failed prior entry means this is a legitimate re-serve.
  const ACTIVE = "('pending','assigned','in_progress','attempted')";
  let dup: { id: number; status: string; case_number: string | null } | null = null;
  if (queueRow.case_number && queueRow.recipient_name) {
    dup = await queryFirst(db,
      `SELECT id, status, case_number FROM serve_queue
       WHERE status IN ${ACTIVE} AND case_number = ? AND LOWER(recipient_name) = LOWER(?)
       ORDER BY id DESC LIMIT 1`,
      queueRow.case_number, queueRow.recipient_name) as any;
  } else if (queueRow.recipient_name && queueRow.recipient_address) {
    dup = await queryFirst(db,
      `SELECT id, status, case_number FROM serve_queue
       WHERE status IN ${ACTIVE} AND LOWER(recipient_name) = LOWER(?) AND LOWER(recipient_address) = LOWER(?)
       ORDER BY id DESC LIMIT 1`,
      queueRow.recipient_name, queueRow.recipient_address) as any;
  }
  if (dup) {
    // Re-uploaded packet: surface the EXISTING case anchored to the
    // duplicate queue row so /upload can attach the just-uploaded docs
    // to the same Case File. case_id column lands with migration 0146 —
    // legacy D1 returns null and the route handles that gracefully.
    let dupCaseId: number | null = null;
    let dupCaseNumber: string | null = null;
    try {
      const dupRow = await queryFirst<{ case_id: number | null }>(
        db, 'SELECT case_id FROM serve_queue WHERE id = ?', dup.id);
      if (dupRow?.case_id) {
        dupCaseId = dupRow.case_id;
        const caseRow = await queryFirst<{ case_number: string | null }>(
          db, 'SELECT case_number FROM cases WHERE id = ?', dupCaseId);
        dupCaseNumber = caseRow?.case_number ?? null;
      }
    } catch { /* column missing on legacy D1 — non-fatal */ }
    return {
      serve_queue_id: dup.id, person_id: null, agent_person_id: null,
      business_id: null, property_id: null, call_id: null, call_number: null,
      created: { person: false, agent_person: false, business: false, property: false, call: false },
      duplicate_of: { serve_queue_id: dup.id, status: dup.status, case_number: dup.case_number ?? null },
      case_id: dupCaseId,
      rmpg_case_number: dupCaseNumber,
    };
  }

  // ── Deadline-driven priority escalation + diligence plan ──
  // ≤3 days to deadline → urgent, ≤7 → rush (raise-only). Computed BEFORE
  // the briefing/call/queue writes so every consumer sees the same value.
  queueRow.priority = escalatePriorityForDeadline(queueRow.priority, nowIso, queueRow.deadline);

  const isBusiness = get('recipient_type').toLowerCase() === 'business';
  const businessName = get('recipient_business_name') || (isBusiness ? get('recipient_last_name') : '');

  // Look up service location notation — shapes the attempt schedule and briefing.
  const locationNote = await findLocationNote(db, {
    businessName: businessName || null,
    personName: isBusiness ? null : (get('recipient_first_name') + ' ' + get('recipient_last_name')).trim() || null,
    address: queueRow.recipient_address || null,
  });

  const recipientFirst = get('recipient_first_name');
  const recipientMiddle = get('recipient_middle_name');
  const recipientLast = get('recipient_last_name');
  const recipientPhone = get('recipient_phone');
  const recipientDob = get('recipient_dob');
  const agentFullName = get('registered_agent_name');

  // Build location string. The intake address might be partial OR might
  // already include city/state/zip inline (court packets often have the
  // full address on one line). Detect overlap so we don't duplicate
  // "Salt Lake City, UT 84102, Salt Lake City, UT 84102" — observed in
  // property id=6 on 2026-05-27 before this fix landed.
  const addr = queueRow.recipient_address || '';
  const city = queueRow.recipient_city || '';
  const stateZip = [queueRow.recipient_state, queueRow.recipient_zip].filter(Boolean).join(' ');
  const addrLower = addr.toLowerCase();
  // Use word-boundary regex so a 2-letter state abbreviation (e.g. "UT")
  // doesn't falsely match mid-word street names like "South" (sou-TH → "ut").
  const cityAlreadyInAddr = !!city && addrLower.includes(city.toLowerCase());
  const stateAlreadyInAddr = !!queueRow.recipient_state &&
    new RegExp(`\\b${queueRow.recipient_state}\\b`, 'i').test(addr);
  const cityStateSuffix = cityAlreadyInAddr || stateAlreadyInAddr
    ? '' : [city, stateZip].filter(Boolean).join(', ');
  const fullLocation = [addr, cityStateSuffix].filter(Boolean).join(', ');

  // ── Geocode once, reuse for property + call + queue ──────────
  // Mirrors dispatch/calls.ts so an intake-created CFS pins on the map
  // and the route planner can sequence it. Best-effort: geocodeAddress
  // returns null on any miss/error (Nominatim down, address too sparse)
  // and we simply store null coords — the records still link correctly,
  // they just won't have a map pin until someone geocodes them later.
  let coords: { lat: number; lng: number } | null = null;
  if (fullLocation || addr) {
    // Time-boxed: geocodeAddress hits external Nominatim (1 req/sec, can stall
    // or hang). Cap at 8s so a slow geocoder can't hold the whole /upload commit
    // response open — on timeout coords stay null, exactly as on a miss, and the
    // records still link (lat/lng backfill later). (Audit item B.)
    coords = await Promise.race([
      geocodeAddress(input.env, fullLocation || addr).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
    ]);
  }

  // ── Geo enrichment (A/S/Z/B + cross street + Building/Suite) ──
  // Parity with a dispatcher-created call: resolve the district from the
  // geocoded point (R2 geofence), derive the nearest cross street (Mapbox
  // Tilequery via the server-side token), and parse Building/Suite/Floor from
  // the address text. Mirrors the dispatch create-call backfill. Every piece is
  // best-effort + time-boxed so it can never block the commit — a miss just
  // leaves that field null, exactly as before this enrichment existed.
  let district: Awaited<ReturnType<typeof resolveDistrict>> = null;
  let crossStreet = '';
  if (coords) {
    [district, crossStreet] = await Promise.all([
      resolveDistrict(input.env, { lat: coords.lat, lng: coords.lng }).catch(() => null),
      Promise.race([
        deriveCrossStreetFromCoords(input.env, coords.lng, coords.lat, addr).catch(() => ''),
        new Promise<string>((resolve) => setTimeout(() => resolve(''), 6_000)),
      ]),
    ]);
  }
  const locParts = parseLocationParts(fullLocation || addr);

  // ── 1. Business row (corporate recipients only) ────────────
  let business: RecordRef = { id: 0, created: false };
  let businessRecord: BusinessRecord | null = null;
  if (isBusiness && businessName) {
    business = await findOrCreateBusiness(db, {
      name: businessName,
      address: addr || null,
      city: city || null,
      state: queueRow.recipient_state,
      zip: queueRow.recipient_zip,
      phone: recipientPhone || null,
      contact_name: agentFullName || null,
    });
    // When the business already existed, fetch contact details for briefing enrichment.
    if (!business.created && business.id) {
      businessRecord = await queryFirst<BusinessRecord>(
        db,
        'SELECT owner_name, owner_phone, contact_name, contact_phone, phone, notes, business_type FROM businesses WHERE id = ?',
        business.id,
      ) ?? null;
    }
  }

  // ── 2. Person row(s) ──────────────────────────────────────
  // For corporate service we create the REGISTERED AGENT as the
  // person row (that's the human at the door). For person service
  // the recipient themselves IS the person row.
  let person: RecordRef = { id: 0, created: false };
  let agentPerson: RecordRef = { id: 0, created: false };

  if (isBusiness) {
    // Only create a person row for the registered agent when the agent text is
    // a plausible human name. Generic role/department labels ("Medical Records
    // Department", "Registered Agent", "Custodian of Records") create junk
    // persons rows like first="Medical"/last="Department" — skip those and keep
    // the business link as the sole record. (Audit AI-2.)
    if (agentFullName && isPlausibleAgentPersonName(agentFullName)) {
      const parts = splitFullName(agentFullName);
      agentPerson = await findOrCreatePerson(db, {
        first_name: parts.first,
        middle_name: parts.middle,
        last_name: parts.last,
        address: addr || null,
      });
      // For the queue's recipient_person_id, point at the agent —
      // that's who the officer needs to find on the door.
      person = agentPerson;
    } else if (recipientFirst || recipientLast) {
      // Fallback: operator filled the agent's name into the First/Last Name
      // fields (common when the registered agent is a known individual rather
      // than a department). Don't drop these — create the person row from them.
      agentPerson = await findOrCreatePerson(db, {
        first_name: recipientFirst,
        middle_name: recipientMiddle,
        last_name: recipientLast || '-',
        dob: recipientDob || null,
        address: addr || null,
        phone: recipientPhone || null,
      });
      person = agentPerson;
    }
  } else if (recipientFirst || recipientLast) {
    person = await findOrCreatePerson(db, {
      first_name: recipientFirst,
      middle_name: recipientMiddle,
      last_name: recipientLast || '-',
      dob: recipientDob || null,
      address: addr || null,
      phone: recipientPhone || null,
    });
  }

  // ── 3. Property row ──────────────────────────────────────
  let property: RecordRef = { id: 0, created: false };
  let propertyRecord: PropertyRecord | null = null;
  if (addr) {
    property = await findOrCreateProperty(db, {
      name: businessName || queueRow.recipient_name || addr,
      address: fullLocation || addr,
      city, state: queueRow.recipient_state, zip: queueRow.recipient_zip,
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
      property_type: isBusiness ? 'business_service' : 'residential_service',
    });
    // When the property already existed, fetch security fields for briefing enrichment.
    if (!property.created && property.id) {
      propertyRecord = await queryFirst<PropertyRecord>(
        db,
        `SELECT gate_code, alarm_code, alarm_account, alarm_company,
                key_holder_name, key_holder_phone, post_orders,
                access_instructions, hazard_notes
           FROM properties WHERE id = ?`,
        property.id,
      ) ?? null;
    }
  }

  // Address class describes the LOCATION (operator decision D-2). A
  // registered agent at a residence gets residential windows; isBusiness
  // no longer selects timing, only who may accept service.
  //
  // propertyRecordClass is left undefined: the live `properties` table
  // (see migrations/baseline/schema.sql) has no `address_class` column —
  // only `property_type` ('business_service'/'residential_service', set
  // by findOrCreateProperty above), which is a different vocabulary and
  // not what resolveAddressClass expects. Adding a real column is out of
  // scope for this task; resolution falls through to businessRecordMatched
  // / instructionsText / extracted / unknown instead.
  //
  // R5: a matched `businesses` row only CONFIRMS a business location when it
  // is independent evidence. findOrCreateBusiness above inserts a row for
  // every corporate intake, marked 'Auto-created via serve intake' — so a
  // corporation served through its registered agent AT THE AGENT'S HOME
  // auto-created a business row at that residential address on the first
  // intake, and the second intake matched it and self-confirmed as a
  // business location: weekday business hours at a private residence. That
  // is precisely the registered-agent-at-a-residence case D-2 exists to
  // prevent. Auto-created rows are excluded from confirming.
  const businessRecordIsIndependent = !!businessRecord && !isAutoCreatedBusinessRecord(businessRecord);
  const addressClassResult = resolveAddressClass({
    operatorOverride: get('address_class') || undefined,
    propertyRecordClass: undefined,
    businessRecordMatched: businessRecordIsIndependent && isBusiness,
    instructionsText: queueRow.service_instructions || '',
    extracted: get('address_class'),
    serviceAddress: fullLocation || addr,
    entityName: queueRow.recipient_name || get('recipient_business_name') || queueRow.business_name,
    recipientType: queueRow.recipient_type || (isBusiness ? 'business' : null),
  });

  const rawClientSchedule = get('client_attempt_schedule');
  const rawAllowedDays = get('service_days_allowed');
  const clientBands = parseClientBands(rawClientSchedule);
  const allowedDays = parseAllowedDays(rawAllowedDays);
  const startNotBefore = get('attempt_start_not_before') || null;

  // R3: fail-closed only works if the failure is VISIBLE. A non-empty source
  // string that yields no bands / a null day set means the client dictated
  // something we could not read — which is NOT the same as the client
  // dictating nothing, and must not silently become "defaults apply".
  const unparsedClientSchedule = rawClientSchedule.trim() && clientBands.length === 0
    ? rawClientSchedule.trim() : null;
  const unparsedAllowedDays = rawAllowedDays.trim() && allowedDays === null
    ? rawAllowedDays.trim() : null;
  if (unparsedClientSchedule || unparsedAllowedDays) {
    log.warn('serve-intake client schedule present but unparseable — defaults applied', {
      client_attempt_schedule: unparsedClientSchedule,
      service_days_allowed: unparsedAllowedDays,
      case_number: queueRow.case_number,
    });
  }

  const inferredVenue = inferVenueKind(
    fullLocation || addr,
    queueRow.recipient_name || get('recipient_business_name') || queueRow.business_name,
    queueRow.service_instructions,
  );
  const venueKind = coerceVenueKind(get('venue_kind')) ?? inferredVenue;

  const attemptPlan = planAttemptWindows(nowIso, queueRow.deadline, 'America/Denver', {
    isBusiness,
    addressClass: addressClassResult.klass,
    addressClassConfirmed: addressClassResult.confirmed,
    clientBands,
    allowedDays,
    startNotBefore,
    locationNote,
    venueKind,
  });

  // Finding 3 FIX: `clientBands.length || 3` didn't match selectWindows'
  // actual defaults (business → 2 windows, residential/unknown → 3), so a
  // business job with no client schedule and 2 days remaining was wrongly
  // flagged impossible. Use the ACTUAL planned window count instead of a
  // hardcoded guess — see computeScheduleImpossible below.
  const scheduleImpossible = computeScheduleImpossible(
    attemptPlan.length,
    daysUntilDeadline(nowIso, queueRow.deadline),
  );

  log.info('serve-intake attempt plan', {
    address_class: addressClassResult.klass,
    class_source: addressClassResult.source,
    confirmed: addressClassResult.confirmed,
    client_bands: clientBands.length,
    authority: attemptPlan[0]?.authority ?? 'none',
    schedule_impossible: scheduleImpossible,
  });

  // ── OCR provenance context (filed on call notes + queue row) ──
  const ocrContext: OcrContext | null = input.docs?.length
    ? buildOcrContext(input.docs, fields, input.allDates ?? [], nowIso)
    : null;

  // ── 4. CFS call row ──────────────────────────────────────
  let callId: number | null = null;
  let callNumber: string | null = null;
  if (fullLocation || addr) {
    const caller_name = queueRow.attorney_name || queueRow.client_name;
    const caller_phone = get('attorney_phone') || null;

    // ── PSO pre-arrival briefing ──────────────────────────────
    // Turn the extracted facts into the officer-facing notations the
    // PSO reads on the call before arrival: a structured INTAKE note,
    // an OFFICER SAFETY note + scene_safety/caution flags (per the
    // operator's document-type policy), and a ⚠ prefix on the call
    // description so the queue row reads hot at a glance.
    const briefing = buildPsoBriefing({
      fields,
      queueRow,
      isBusiness,
      agentName: agentFullName,
      fullLocation: fullLocation || addr,
      docCount: input.docCount,
      attemptPlan,
      locationNote,
      propertyRecord,
      businessRecord,
      addressClass: addressClassResult.klass,
      addressClassConfirmed: addressClassResult.confirmed,
      scheduleImpossible,
      hasClientSchedule: clientBands.length > 0,
      unparsedClientSchedule,
      unparsedAllowedDays,
    }, nowIso);
    // File the OCR provenance note AFTER the intake briefing so the feed
    // reads: safety → briefing → extraction context.
    if (ocrContext) {
      briefing.notes.push({
        id: `intake-ocr-${Date.now() + 2}`,
        author: 'OCR',
        text: ocrContext.noteText,
        timestamp: nowIso,
      });
    }
    // SERVICE INSTRUCTIONS copied verbatim into the call's Description (the
    // dispatch "Call Details" field) so the PSO/dispatcher sees the client's
    // exact service requirements (rush timing, sub-service rules, diligence
    // windows) on the CFS without opening the serve queue row. Appended after
    // the structured summary so the one-line queue picture stays intact.
    const instructions = (queueRow.service_instructions || '').trim();
    const summaryText = briefing.descriptionPrefix + input.documentSummary;
    // Dedupe guard: if the summary ever embeds the instructions itself,
    // appending again would print the client's rule twice on one call.
    const description = instructions && !summaryText.includes(instructions)
      ? `${summaryText}\n\nSERVICE INSTRUCTIONS: ${instructions}`
      : summaryText;

    try {
      // call_number is UNIQUE — re-mint + retry on a collision so a concurrent
      // writer racing the non-atomic SELECT MAX()+1 minter can't silently drop
      // this call. (Audit AI-4.)
      const { value: cn, result: call } = await withUniqueRetry(
        () => nextCallNumber(db),
        (callNo) => createServiceCall(db, {
          call_number: callNo,
          incident_type: resolveIncidentType(queueRow.document_type, fields),
          priority: cadPriority(queueRow.priority),
          caller_name: caller_name || null,
          caller_phone,
          location_address: fullLocation || addr,
          property_id: property.id || null,
          latitude: coords?.lat ?? null,
          longitude: coords?.lng ?? null,
          description,
          notes: briefing.notes.length ? JSON.stringify(briefing.notes) : null,
          scene_safety: briefing.sceneSafety || null,
          officer_safety_caution: briefing.officerSafetyCaution,
          domestic_violence: briefing.domesticViolence,
          dispatcher_id: userId,
          client_id: input.clientId ?? null,
          // Geo enrichment — parity with a dispatcher-created call.
          cross_street: crossStreet || null,
          location_building: locParts.building || null,
          location_floor: locParts.floor || null,
          location_room: locParts.suite || null,
          sector_id: district?.sector_id ?? null,
          sector_name: district?.sector_name ?? null,
          zone_id: district?.zone_id ?? null,
          zone_name: district?.zone_name ?? null,
          beat_id: district?.beat_id ?? null,
          beat_name: district?.beat_name ?? null,
          beat_descriptor: district?.beat_descriptor ?? null,
          zone_beat: district?.zone_beat ?? null,
          dispatch_code: district?.dispatch_code ?? null,
          area_code: district?.area_code ?? null,
          area_name: district?.area_name ?? null,
        }),
      );
      callId = call.id;
      callNumber = cn;

      // ── PSO / process-service ext fields ────────────────────
      // Write the Information Form fields into calls_for_service_ext so the
      // dispatch detail "PSO Client Request Details" and "Process Service
      // Details" sections are pre-populated from OCR rather than blank.
      try {
        const windowsJson = encodePsoServiceWindows(get('service_windows'));
        const psoServiceType = queueRow.document_type || get('process_type') || null;
        const recipientFullName = queueRow.recipient_name ||
          [recipientFirst, recipientLast].filter(Boolean).join(' ').trim() || null;
        const servedTo = isBusiness && agentFullName
          ? `${recipientFullName} c/o ${agentFullName}`
          : recipientFullName;
        // Attorney is the operational callback; client is the billing party.
        const requestorName = queueRow.attorney_name || queueRow.client_name || null;
        await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', callId);
        await execute(
          db,
          `UPDATE calls_for_service_ext SET
            pso_requestor_name    = COALESCE(NULLIF(?, ''), pso_requestor_name),
            pso_requestor_phone   = COALESCE(NULLIF(?, ''), pso_requestor_phone),
            pso_requestor_email   = COALESCE(NULLIF(?, ''), pso_requestor_email),
            pso_service_type      = COALESCE(NULLIF(?, ''), pso_service_type),
            pso_service_windows   = COALESCE(NULLIF(?, ''), pso_service_windows),
            pso_authorization     = COALESCE(NULLIF(?, ''), pso_authorization),
            process_service_type  = COALESCE(NULLIF(?, ''), process_service_type),
            process_served_to     = COALESCE(NULLIF(?, ''), process_served_to),
            process_served_address = COALESCE(NULLIF(?, ''), process_served_address),
            case_number           = COALESCE(NULLIF(?, ''), case_number),
            court_name            = COALESCE(NULLIF(?, ''), court_name)
           WHERE id = ?`,
          requestorName,
          get('attorney_phone') || null,
          get('attorney_email') || null,
          psoServiceType,
          windowsJson,
          queueRow.sm_job_id || null,
          psoServiceType,
          servedTo,
          fullLocation || addr || null,
          queueRow.case_number || null,
          queueRow.court_name || null,
          callId,
        );
        // Extra Dispatch fields (migration 0269). Best-effort — a missing
        // column on drifted D1 must not abort the intake.
        await patchCfsExtIntakeCopy(db, callId, {
          attorney_name: queueRow.attorney_name,
          jurisdiction: queueRow.jurisdiction,
          deadline: queueRow.deadline,
          time_window: queueRow.time_window,
          service_instructions: queueRow.service_instructions,
          plaintiff_name: queueRow.plaintiff,
        });
      } catch (err) {
        console.warn('[commitOneIntake] PSO ext write skipped (non-fatal):', err);
      }
    } catch (err) {
      // Best-effort — if the call insert fails (FK or column drift),
      // surface it but don't abort the whole intake. The queue row
      // can still get created without a call link.
      console.error('createServiceCall failed:', err);
    }
  }

  // ── 5. serve_queue row ────────────────────────────────────
  let queueId: number | null = null;
  if (queueRow.recipient_name || queueRow.recipient_address) {
    // Catch-all: persist EVERY extracted field as flat {field: value} JSON so no
    // OCR'd data is lost on commit. fieldsToQueueRow maps the hot query paths to
    // dedicated columns Process Server and Dispatch read; parsed_data remains
    // the long-tail audit copy.
    const parsedData = JSON.stringify({
      ...Object.fromEntries(
        Object.entries(fields)
          .map(([k, v]) => [k, (v?.value || '').trim()] as const)
          .filter(([, val]) => val),
      ),
      // Machine-readable extraction audit block — queryable via
      // json_extract(parsed_data, '$._intake.missing_critical') etc.
      _intake: {
        extracted_at: nowIso,
        // R6: the resolved address class used to be computed here and then
        // DISCARDED, so every downstream re-plan/backfill path fell back to
        // the interim `isBusiness ? 'business' : 'unknown'` mapping — the
        // exact defect this work exists to fix. Persist the full resolution
        // (class + confirmation + source) so those paths can read the real
        // answer. `confirmed` is load-bearing, not diagnostic: business
        // TIMING is gated on it (D-2 / serveAttemptWindows).
        address_class: {
          klass: addressClassResult.klass,
          confirmed: addressClassResult.confirmed,
          source: addressClassResult.source,
        },
        venue: venueKind,
        output_tree: (() => {
          const tree = buildOutputTree({
            addressClass: addressClassResult.klass,
            addressClassConfirmed: addressClassResult.confirmed,
            isBusiness,
            fields,
            queueRow,
            agentName: agentFullName,
            fullLocation: fullLocation || addr,
            docCount: input.docCount,
            nowIso,
            gateCode: get('gate_code') || propertyRecord?.gate_code,
            hazardNotes: propertyRecord?.hazard_notes,
            venueOverride: coerceVenueKind(get('venue_kind')),
            dogsOnSite: /^(1|true|yes)$/i.test(get('dogs_on_site')),
            camerasOnSite: /^(1|true|yes)$/i.test(get('cameras_on_site')),
            noSunday: /^(1|true|yes)$/i.test(get('no_sunday')) || /do not serve on sunday/i.test(queueRow.service_instructions || ''),
            authorizedAcceptor: get('authorized_acceptor') || null,
            languageNeeded: get('language_needed') || null,
            physicalDescription: get('physical_description') || null,
          });
          return {
            venue: tree.venue,
            venue_label: tree.venueLabel,
            catalog_size: tree.catalogSize,
            fired_ids: tree.firedIds,
            fired_count: tree.features.length,
            windows: attemptPlan.map((w) => ({ window: w.window, authority: w.authority, focus: w.focus })),
          };
        })(),
        attempt_plan: attemptPlan,
        conflicts: input.conflicts ?? [],
        validation_issues: input.validationIssues ?? [],
        ...(ocrContext ? {
          documents: input.docs!.map((d) => ({
            file_name: d.file_name, doc_type: d.doc_type,
            ocr_engine: d.ocr_engine, confidence: d.confidence, success: d.success,
          })),
          all_dates: input.allDates ?? [],
          missing_critical: ocrContext.missingCritical,
        } : {}),
      },
      _ops: normalizeServeJobOps({
        documents_to_serve: get('documents_to_serve'),
        venue_kind: get('venue_kind'),
        gate_code: get('gate_code'),
        dogs_on_site: get('dogs_on_site'),
        cameras_on_site: get('cameras_on_site'),
        language_needed: get('language_needed'),
        authorized_acceptor: get('authorized_acceptor'),
        photo_required: get('photo_required'),
        physical_description: get('physical_description'),
        vehicle_description: get('vehicle_description'),
        best_contact_window: get('best_contact_window'),
        no_sunday: get('no_sunday'),
        no_saturday: get('no_saturday'),
        sub_service_first: get('sub_service_authorized_first_attempt'),
      }),
    });
    // Queue notes = extracted service windows + a compact provenance line so
    // the serve-queue views carry the OCR context without the full markdown.
    const queueNotes = [queueRow.notes, ocrContext?.queueLine]
      .filter(Boolean).join('\n') || null;
    const explicitClientId = input.clientId ?? null;
    // Cache cluster id + urgency tier at intake so the dashboard scheduler
    // can color and sort without recomputing per query. Daily cron keeps
    // tier in sync if deadline/attempt_count drift later.
    const geoClusterId = clusterByProximity(
      coords?.lat ?? null,
      coords?.lng ?? null,
      queueRow.recipient_zip ?? null,
    );
    const urgencyTier = applyUrgencyTier(
      queueRow.deadline ?? null,
      0,                                // intake = no attempts yet
      3,                                // QueueRow has no max_attempts; use default
      nowIso,
    );
    const urgencyComputedAt = nowIso;
    const ins = await execute(
      db,
      `INSERT INTO serve_queue (
        call_id, officer_id, recipient_name, recipient_person_id,
        recipient_address, recipient_city, recipient_state, recipient_zip,
        recipient_lat, recipient_lng,
        property_id, business_id,
        document_type, case_number, court_name, jurisdiction,
        client_id, client_name, attorney_name, priority, deadline,
        service_instructions, notes,
        plaintiff_name, defendant_name, court_date, parsed_data, status,
        geo_cluster_id, urgency_tier, urgency_computed_at,
        quality_status, judge_run_id, sm_job_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      callId, userId,
      queueRow.recipient_name, person.id || null,
      queueRow.recipient_address, queueRow.recipient_city,
      queueRow.recipient_state, queueRow.recipient_zip,
      coords?.lat ?? null, coords?.lng ?? null,
      property.id || null, business.id || null,
      queueRow.document_type, queueRow.case_number,
      queueRow.court_name, queueRow.jurisdiction,
      explicitClientId, queueRow.client_name, queueRow.attorney_name,
      queueRow.priority, queueRow.deadline,
      queueRow.service_instructions, queueNotes,
      queueRow.plaintiff, queueRow.defendant, queueRow.court_date, parsedData,
      geoClusterId, urgencyTier, urgencyComputedAt,
      input.qualityStatus ?? 'clean', input.judgeRunId ?? null, queueRow.sm_job_id ?? null,
    );
    queueId = Number(ins.meta.last_row_id);

    if (queueId) {
      await patchServeQueueIntakeCopy(db, queueId, queueRow);
    }

    // Auto-link the billing contract. When an explicit client was selected on
    // intake, go straight to the contract lookup; otherwise fall back to
    // name-matching. Best-effort — never blocks intake.
    if (queueId) {
      try {
        const resolvedClientId = explicitClientId ?? (queueRow.client_name
          ? (await queryFirst<{ id: number }>(
              db, "SELECT id FROM clients WHERE LOWER(name) = LOWER(?) AND status = 'active' LIMIT 1",
              queueRow.client_name.trim()))?.id ?? null
          : null);
        if (resolvedClientId) {
          if (!explicitClientId) {
            await execute(db, 'UPDATE serve_queue SET client_id = ? WHERE id = ?', resolvedClientId, queueId);
          }
          const con = await queryFirst<{ id: number }>(
            db, "SELECT id FROM client_contracts WHERE client_id = ? AND status = 'active' ORDER BY start_date DESC LIMIT 1",
            resolvedClientId);
          if (con?.id) await execute(db, 'UPDATE serve_queue SET contract_id = ? WHERE id = ?', con.id, queueId);
        }
      } catch { /* best-effort — billing never blocks intake */ }
    }
  }

  // ── 5b. Persist dated attempt schedule ───────────────────
  // Best-effort: a scheduling failure must never abort the intake commit.
  // NB: no broadcastAll here — the route that calls commitIntake responds
  // with the new queue_id, and the client navigates to a fresh view that
  // fetches via useLiveSync on mount. The PATCH route + replan hook DO
  // broadcast because those happen without a page navigation.
  if (queueId && attemptPlan.length) {
    persistAttemptSchedule(db, queueId, attemptPlan, nowIso).catch((err) =>
      console.error('[serve-schedule] persist failed (non-fatal):', err),
    );
  }

  // ── 6. Junction-table links ──────────────────────────────
  // These are best-effort like the audit_log write in calls.ts —
  // a missing junction shouldn't fail the intake commit.
  try {
    if (callId && person.id) {
      await linkCallToPerson(db, callId, person.id,
        isBusiness ? 'serve_recipient_agent' : 'serve_recipient', userId);
    }
    if (callId && business.id) {
      await linkCallToBusiness(db, callId, business.id, 'serve_recipient', userId);
    }
  } catch (err) {
    console.error('linkCall* failed (non-fatal):', err);
  }

  // ── 7. Auto-create the Case File for this intake batch ─────
  // Anchors all downstream artifacts (attempts, photos, notice
  // PDFs, follow-on CFS dispatches) to a single record so the
  // operator and reviewers have one place to read the job's
  // history. Best-effort — a case-create failure cannot abort
  // the intake commit (queue row + CFS already inserted). Per
  // option B (operator decision 2026-06-22), runs unconditionally
  // — even when no CFS was created (address-less batches), the
  // case is the home for re-attempted intake or post-intake
  // address discovery.
  //
  // Multi-defendant fan-out: when forcedCaseId is set (iterations
  // 2..N of a multi-defendant commitIntake), we SKIP case-file
  // creation and reuse the case the first defendant's iteration
  // already created. Only the case_persons link for this defendant
  // is added so all defendants appear under one case file.
  let caseId: number | null = null;
  let caseNumber: string | null = null;
  try {
    if (input.forcedCaseId != null && input.forcedCaseId > 0) {
      // Reuse the shared case from iteration 1 — just link this person.
      caseId = input.forcedCaseId;
      const caseRow = await queryFirst<{ case_number: string | null }>(
        db, 'SELECT case_number FROM cases WHERE id = ?', caseId);
      caseNumber = caseRow?.case_number ?? null;
      // Add this defendant as a person link on the existing case.
      const personIdForLink = (isBusiness && agentPerson.id) ? agentPerson.id : person.id;
      const relationshipLabel = (isBusiness && agentPerson.id) ? 'serve_recipient_agent' : 'serve_recipient';
      if (personIdForLink) {
        await execute(
          db,
          // case_persons stores the linkage label in `role`, not `relationship`.
          `INSERT OR IGNORE INTO case_persons (case_id, person_id, role)
           VALUES (?, ?, ?)`,
          caseId, personIdForLink, relationshipLabel,
        );
      }
    } else {
      // Title reads "Service: <recipient> — <doc type>" so the case
      // browser surfaces the same info the queue card does. Fall back
      // through best-available identifiers when intake is sparse.
      const recipientLabel = queueRow.recipient_name?.trim()
        || businessName
        || [recipientFirst, recipientLast].filter(Boolean).join(' ').trim()
        || 'Unknown recipient';
      const docTypeLabel = queueRow.document_type
        ? toDisplayLabel(queueRow.document_type)
        : 'Service of Process';
      const title = `Service: ${recipientLabel} — ${docTypeLabel}`;

      // Summary mirrors the briefing the PSO sees on the call. Cap
      // hard so a long packet can't blow the cases.summary index.
      const summary = (input.documentSummary || '').slice(0, 1500) || null;

      // Persons: include both the agent person (corporate) and the
      // direct recipient (individual) when both ended up created.
      // The relationship label tells the case browser which is which.
      const linkedPersons: { person_id: number; relationship?: string }[] = [];
      if (isBusiness && agentPerson.id) {
        linkedPersons.push({ person_id: agentPerson.id, relationship: 'serve_recipient_agent' });
      } else if (person.id) {
        linkedPersons.push({ person_id: person.id, relationship: 'serve_recipient' });
      }

      const created = await createCaseWithLinks(db, {
        title,
        case_type: 'service',
        summary,
        created_by: userId,
        source: 'serve-intake',
        linked_call_id: callId,
        linked_persons: linkedPersons,
        linked_property_id: property.id || null,
        linked_serve_queue_id: queueId,
      });
      caseId = created.case_id;
      caseNumber = created.case_number;
    }
  } catch (err) {
    // Auto-case is a convenience layer — a failure here must NOT
    // unwind the intake. Operator can manually create + link a
    // case via POST /api/cases as before. Log so we notice drift
    // (typically: cases table missing or D1 quota).
    console.error('auto-case-create failed (non-fatal):', err);
  }

  return {
    intake_note: ocrContext?.noteText ?? null,
    missing_critical: ocrContext?.missingCritical ?? [],
    attempt_plan: attemptPlan,
    duplicate_of: null,
    serve_queue_id: queueId,
    person_id: person.id || null,
    agent_person_id: agentPerson.id || null,
    business_id: business.id || null,
    property_id: property.id || null,
    call_id: callId,
    call_number: callNumber,
    case_id: caseId,
    rmpg_case_number: caseNumber,
    created: {
      person: person.created,
      agent_person: agentPerson.created,
      business: business.created,
      property: property.created,
      call: callId !== null,
    },
  };
}
