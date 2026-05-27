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
import { execute, query, queryFirst } from './db';
import type { ExtractedField, QueueRow, ServePriority } from './serveIntakeExtract';

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
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'process_service_recipient', 'Auto-created via serve intake')`,
    name, b.address || null, b.city || null, b.state || null, b.zip || null,
    b.phone || null, b.contact_name || null, b.contact_phone || null,
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
  const max = await queryFirst<{ max: string | null }>(
    db, "SELECT MAX(call_number) as max FROM calls_for_service WHERE call_number LIKE ?",
    `${prefix}%`,
  );
  const seq = max?.max
    ? String(parseInt(max.max.slice(prefix.length), 10) + 1).padStart(5, '0')
    : '00001';
  return `${prefix}${seq}`;
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

// ── Call creation ────────────────────────────────────────────
export interface ServiceCallInput {
  call_number: string;
  incident_type: string;
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  caller_name: string | null;
  caller_phone: string | null;
  location_address: string;
  property_id: number | null;
  description: string | null;
  dispatcher_id: number | null;
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
  const result = await execute(
    db,
    `INSERT INTO calls_for_service (
      call_number, incident_type, priority, status,
      caller_name, caller_phone, location_address, property_id,
      description, source, dispatcher_id
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, 'intake', ?)`,
    c.call_number, c.incident_type, c.priority,
    c.caller_name, c.caller_phone, c.location_address, c.property_id,
    c.description, c.dispatcher_id,
  );
  return { id: Number(result.meta.last_row_id) };
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
}

export interface CommitInput {
  fields: Record<string, ExtractedField>;
  queueRow: QueueRow;
  userId: number | null;
  documentSummary: string;             // free-text inserted into call.description
}

export async function commitIntake(db: D1Database, input: CommitInput): Promise<CommitResult> {
  const { fields, queueRow, userId } = input;
  const get = (k: string) => (fields[k]?.value || '').trim();

  const isBusiness = get('recipient_type').toLowerCase() === 'business';
  const businessName = get('recipient_business_name') || (isBusiness ? get('recipient_last_name') : '');
  const recipientFirst = get('recipient_first_name');
  const recipientMiddle = get('recipient_middle_name');
  const recipientLast = get('recipient_last_name');
  const recipientPhone = get('recipient_phone');
  const recipientDob = get('recipient_dob');
  const agentFullName = get('registered_agent_name');

  // Build location string. The intake address might be partial — fall
  // back to the recipient_address alone if city/state/zip aren't there.
  const addr = queueRow.recipient_address || '';
  const city = queueRow.recipient_city || '';
  const stateZip = [queueRow.recipient_state, queueRow.recipient_zip].filter(Boolean).join(' ');
  const fullLocation = [addr, [city, stateZip].filter(Boolean).join(', ')].filter(Boolean).join(', ');

  // ── 1. Business row (corporate recipients only) ────────────
  let business: RecordRef = { id: 0, created: false };
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
  }

  // ── 2. Person row(s) ──────────────────────────────────────
  // For corporate service we create the REGISTERED AGENT as the
  // person row (that's the human at the door). For person service
  // the recipient themselves IS the person row.
  let person: RecordRef = { id: 0, created: false };
  let agentPerson: RecordRef = { id: 0, created: false };

  if (isBusiness) {
    if (agentFullName) {
      const parts = splitFullName(agentFullName);
      agentPerson = await findOrCreatePerson(db, {
        first_name: parts.first,
        middle_name: parts.middle,
        last_name: parts.last,
        address: addr || null,
        phone: recipientPhone || null,
      });
      // For the queue's recipient_person_id, point at the agent —
      // that's who the officer needs to find on the door.
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
  if (addr) {
    property = await findOrCreateProperty(db, {
      name: businessName || queueRow.recipient_name || addr,
      address: fullLocation || addr,
      city, state: queueRow.recipient_state, zip: queueRow.recipient_zip,
      property_type: isBusiness ? 'business_service' : 'residential_service',
    });
  }

  // ── 4. CFS call row ──────────────────────────────────────
  let callId: number | null = null;
  let callNumber: string | null = null;
  if (fullLocation || addr) {
    const cn = await nextCallNumber(db);
    const caller_name = queueRow.client_name || queueRow.attorney_name;
    const caller_phone = get('attorney_phone') || null;
    const description = input.documentSummary;
    try {
      const call = await createServiceCall(db, {
        call_number: cn,
        incident_type: 'civil_paper_service',
        priority: cadPriority(queueRow.priority),
        caller_name: caller_name || null,
        caller_phone,
        location_address: fullLocation || addr,
        property_id: property.id || null,
        description,
        dispatcher_id: userId,
      });
      callId = call.id;
      callNumber = cn;
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
    const ins = await execute(
      db,
      `INSERT INTO serve_queue (
        call_id, officer_id, recipient_name, recipient_person_id,
        recipient_address, recipient_city, recipient_state, recipient_zip,
        property_id,
        document_type, case_number, court_name, jurisdiction,
        client_name, attorney_name, priority, deadline,
        service_instructions, notes, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      callId, userId,
      queueRow.recipient_name, person.id || null,
      queueRow.recipient_address, queueRow.recipient_city,
      queueRow.recipient_state, queueRow.recipient_zip,
      property.id || null,
      queueRow.document_type, queueRow.case_number,
      queueRow.court_name, queueRow.jurisdiction,
      queueRow.client_name, queueRow.attorney_name,
      queueRow.priority, queueRow.deadline,
      queueRow.service_instructions, queueRow.notes,
    );
    queueId = Number(ins.meta.last_row_id);
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

  return {
    serve_queue_id: queueId,
    person_id: person.id || null,
    agent_person_id: agentPerson.id || null,
    business_id: business.id || null,
    property_id: property.id || null,
    call_id: callId,
    call_number: callNumber,
    created: {
      person: person.created,
      agent_person: agentPerson.created,
      business: business.created,
      property: property.created,
      call: callId !== null,
    },
  };
}
