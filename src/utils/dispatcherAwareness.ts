// ============================================================
// RMPG Flex — AI Dispatcher Awareness + CAD Lookups
// ============================================================
// The "advanced awareness" layer: gives the AI dispatcher real-time
// situational grounding from live D1 and the ability to actually run the
// record checks a unit asks for (plate / person / warrant) instead of
// faking "stand by".
//
//   gatherAwareness(db, …)  → a compact text snapshot of the board that
//                             is injected into EVERY reasoning turn.
//   runLookup(db, …)        → executes a real CAD query and returns a
//                             terse facts string the model reads back.
//
// Every query is wrapped so a missing/empty table degrades to silence,
// never an exception — this all runs in the relay's waitUntil tail and
// must never throw into it. All SELECTs name explicit columns (never
// SELECT * on calls_for_service, which is at the 100-column D1 cap).
//
// Column names were verified against the LIVE schema (785de7ae) on
// 2026-05-29, not /migrations/ — see [[feedback-verify-live-schema-before-insert]].
// ============================================================

import { log } from './logger';
import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings } from '../types';
import { query, queryFirst, execute } from './db';
import { emitAlert } from './alertHub';
import { isFlagSet } from './sentinel';
import { isVehicleStolen } from './intelMatch';
import { containsAnyClause } from './searchText';
import { geocodeAddress, reverseGeocodeAddress } from '../routes/geocode';
import { resolveDistrict } from './districtResolver';
import { estimateEta } from './eta';
import { withUniqueRetry } from './serveIntakeRecords';
import { CLOSED_CALL_STATUSES } from './callStatus';

// Statuses that mean a unit is not currently working. Mirrors the canonical
// set (VALID_UNIT_STATUSES in extensions.ts:483, and gps.ts:64's own mirror
// comment) — 'offline'/'oos'/'unavailable' can never appear in units.status
// and were dead entries that gave a false sense of coverage while silently
// drifted from the real enum. Keep these three copies in sync.
const OFF_DUTY_UNIT_STATUSES = ['off_duty', 'out_of_service'];

async function safe<T>(p: Promise<T[]>): Promise<T[]> {
  try { return await p; } catch (err) {
    log.warn('query failed (skipped)', { err });
    return [];
  }
}

interface UnitRow { call_sign: string; status: string | null; assigned_beat: string | null; current_call_id: number | null }
interface CallRow {
  call_number: string | null; incident_type: string | null; status: string | null;
  location_address: string | null; unit_call_signs: string | null;
}

/**
 * Build a compact, radio-relevant snapshot of the current board for the
 * model. Kept short on purpose — every line is tokens on every reply.
 */
export async function gatherAwareness(db: D1Database, channelId: number, speaker: string | null): Promise<string> {
  const lines: string[] = [];

  // ── The transmitting unit + its current assignment ──
  if (speaker) {
    const unit = await queryFirst<UnitRow>(
      db,
      'SELECT call_sign, status, assigned_beat, current_call_id FROM units WHERE call_sign = ? LIMIT 1',
      speaker,
    ).catch(() => null);
    if (unit) {
      lines.push(`Transmitting unit ${unit.call_sign}: ${unit.status || 'status unknown'}${unit.assigned_beat ? `, beat ${unit.assigned_beat}` : ''}.`);
      if (unit.current_call_id) {
        const c = await queryFirst<CallRow>(
          db,
          'SELECT call_number, incident_type, status, location_address, unit_call_signs FROM calls_for_service WHERE id = ?',
          unit.current_call_id,
        ).catch(() => null);
        if (c) lines.push(`  Currently assigned to ${c.call_number || 'a call'} — ${c.incident_type || 'unknown type'} at ${c.location_address || 'unknown location'} [${c.status || '?'}].`);
      }
      // The unit's QUEUE — other open calls it's attached to (so dispatch can
      // answer "what else do I have"). Matched on the denormalized
      // unit_call_signs list; the current call above is included but the line
      // is only emitted when there's MORE than one.
      const queue = await safe(query<{ call_number: string | null; incident_type: string | null; status: string | null }>(
        db,
        `SELECT call_number, incident_type, status FROM calls_for_service
         WHERE unit_call_signs LIKE ? AND archived_at IS NULL
           AND COALESCE(status,'') NOT IN (${CLOSED_CALL_STATUSES.map(() => '?').join(',')})
         ORDER BY datetime(created_at) DESC LIMIT 4`,
        `%${unit.call_sign}%`, ...CLOSED_CALL_STATUSES,
      ));
      const queued = queue.filter((q) => q.call_number);
      if (queued.length > 1) {
        lines.push(`  ${unit.call_sign} queue: ${queued.map((q) => `${q.call_number} (${q.incident_type || '?'}, ${q.status || '?'})`).join('; ')}.`);
      }
    }
  }

  // ── Active calls on the board ──
  const calls = await safe(query<CallRow>(
    db,
    `SELECT call_number, incident_type, status, location_address, unit_call_signs
     FROM calls_for_service
     WHERE COALESCE(status,'') NOT IN (${CLOSED_CALL_STATUSES.map(() => '?').join(',')}) AND archived_at IS NULL
     ORDER BY COALESCE(priority_score, 0) DESC, datetime(created_at) DESC
     LIMIT 6`,
    ...CLOSED_CALL_STATUSES,
  ));
  if (calls.length) {
    lines.push('Active calls:');
    for (const c of calls) {
      lines.push(`  ${c.call_number || '(no #)'} ${c.incident_type || '?'} @ ${c.location_address || '?'} [${c.status || '?'}${c.unit_call_signs ? `, units ${c.unit_call_signs}` : ''}]`);
    }
  }

  // ── Unassigned backlog — active calls with NO unit attached. The dispatcher
  // should know how many jobs are holding so it can prioritize a backup ask. ──
  const pending = await safe(query<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM calls_for_service
     WHERE COALESCE(status,'') NOT IN (${CLOSED_CALL_STATUSES.map(() => '?').join(',')}) AND archived_at IS NULL
       AND COALESCE(TRIM(unit_call_signs), '') = ''`,
    ...CLOSED_CALL_STATUSES,
  ));
  if (pending[0]?.n) lines.push(`Unassigned/holding calls: ${pending[0].n}.`);

  // ── Units currently working ──
  const units = await safe(query<UnitRow>(
    db,
    `SELECT call_sign, status, assigned_beat FROM units
     WHERE call_sign IS NOT NULL AND COALESCE(status,'') NOT IN (${OFF_DUTY_UNIT_STATUSES.map(() => '?').join(',')})
     ORDER BY call_sign LIMIT 12`,
    ...OFF_DUTY_UNIT_STATUSES,
  ));
  if (units.length) {
    lines.push('Units on duty: ' + units.map((u) => `${u.call_sign}(${u.status || '?'}${u.assigned_beat ? `,beat ${u.assigned_beat}` : ''})`).join(', '));
  }

  // ── Active BOLOs ──
  const bolos = await safe(query<{ bolo_number: string | null; type: string | null; title: string | null; priority: number | null }>(
    db,
    `SELECT bolo_number, type, title, priority FROM bolos
     WHERE COALESCE(status,'') NOT IN ('expired','closed','cancelled','canceled')
       AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
     ORDER BY COALESCE(priority,0) DESC, datetime(created_at) DESC LIMIT 5`,
  ));
  if (bolos.length) {
    lines.push('Active BOLOs: ' + bolos.map((b) => `${b.bolo_number || b.type || 'BOLO'}${b.title ? ` (${b.title})` : ''}`).join('; '));
  }

  // ── Active panic alerts (highest urgency) ──
  const panics = await safe(query<{ id: number; location_address: string | null }>(
    db,
    `SELECT id, location_address FROM panic_alerts WHERE COALESCE(status,'') = 'active' LIMIT 3`,
  ));
  if (panics.length) {
    lines.push(`** ACTIVE PANIC ALERT(S): ${panics.length} — officer in distress${panics[0].location_address ? ` near ${panics[0].location_address}` : ''}. Treat as top priority. **`);
  }

  return lines.length ? lines.join('\n') : 'No active CAD activity on the board.';
}

// ─── CAD lookups ────────────────────────────────────────────

export type LookupType =
  | 'plate' | 'person' | 'warrant' | 'premise' | 'vin'
  | 'unit_location' | 'eta'
  // ── new functions ──
  | 'call_status'    // status/units on a call number ("status on CFS26-0042")
  | 'closest_unit'   // nearest available unit to an address ("who's closest to …")
  | 'last_dispatch'; // re-speak dispatch's last transmission ("say again")
export interface LookupRequest { type: LookupType; query: string }

/**
 * Lookups whose result is ALREADY a complete spoken radio line — the caller
 * reads `result.text` back verbatim instead of re-phrasing it through the LLM
 * (which would risk paraphrasing a GPS fix, an ETA, or a "say again" re-read).
 * The record checks (plate/person/warrant/vin/premise) are NOT here — they get
 * persona-phrased for radio brevity.
 */
export const VERBATIM_LOOKUPS = new Set<LookupType>([
  'unit_location', 'eta', 'call_status', 'closest_unit', 'last_dispatch',
]);

/**
 * A pointer to the underlying record a lookup hit, so the operator console can
 * auto-open the matching file (see VoiceHubDO → dispatch_speak.record). `kind`
 * maps to the client's /detached/record/:type/:id route + a side-panel fetch;
 * `id` is the table primary key. Only emitted for record checks the operator
 * can open (vehicle, person) — location/eta/warrant stay radio-readback only.
 */
export interface RecordRef { kind: 'vehicle' | 'person'; id: number }

/**
 * Result of a lookup: the terse line the dispatcher reads back, plus an
 * optional record pointer for the auto-open side panel.
 */
export interface LookupResult { text: string; record?: RecordRef }

const norm = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();

/**
 * Context a lookup may need beyond its own query — chiefly WHO is asking, so
 * "where am I" / "what's my ETA" can resolve to the transmitting unit.
 */
export interface LookupContext { speaker?: string | null; channelId?: number }

/**
 * Run the record check a unit requested. Returns a LookupResult (a terse facts
 * string for the model to read back + an optional record pointer), or a clear
 * "no record" line. Returns null only on a hard failure (so the caller can
 * fall back). `env` is needed for the location/ETA lookups (geofence + Mapbox);
 * the plain DB checks ignore it.
 */
export async function runLookup(
  env: Bindings,
  db: D1Database,
  req: LookupRequest,
  ctx: LookupContext = {},
): Promise<LookupResult | null> {
  try {
    if (req.type === 'plate') return await lookupPlate(db, req.query);
    if (req.type === 'person') return await lookupPerson(db, req.query);
    if (req.type === 'warrant') return await lookupWarrant(db, req.query);
    // premise/vin (from the officer-safety upgrade) return a plain string —
    // wrap them as a text-only LookupResult (no auto-open record).
    if (req.type === 'premise') return { text: await lookupPremiseText(db, req.query) };
    if (req.type === 'vin') return { text: await lookupVin(db, req.query) };
    // ── new functions ──
    if (req.type === 'call_status') return { text: await lookupCallStatus(db, req.query) };
    if (req.type === 'closest_unit') return { text: await lookupClosestUnit(env, db, req.query) };
    if (req.type === 'last_dispatch') return { text: await lookupLastDispatch(db, ctx.channelId ?? 0) };
    // "where am I" / "what's my ETA" key off the transmitting unit, not the
    // spoken query — the model may pass the call-sign through `query`, but the
    // speaker the relay already knows is authoritative.
    const unit = (ctx.speaker || req.query || '').trim();
    if (req.type === 'unit_location') return await lookupUnitLocation(env, db, unit);
    if (req.type === 'eta') return await lookupEta(env, db, unit);
    return null;
  } catch (err) {
    log.error('lookup failed', {}, err);
    return null;
  }
}

// ─── Premise hazards (officer-safety, proactive + on request) ───
interface PremiseHazardRow {
  alert_type: string | null; alert_level: string | null; title: string;
  description: string | null; flags: string | null;
}

/** Active, unexpired premise alerts whose address fuzzy-matches the query. */
async function premiseRows(db: D1Database, address: string): Promise<PremiseHazardRow[]> {
  const a = address.trim();
  if (a.length < 3) return [];
  // Match on a normalized leading street token so "200 S Main St" hits a
  // "200 S Main" alert. We compare on the first ~12 chars of the address.
  const key = `%${a.slice(0, 24).replace(/\s+/g, '%')}%`;
  return query<PremiseHazardRow>(
    db,
    `SELECT alert_type, alert_level, title, description, flags
     FROM premise_alerts
     WHERE active = 1
       AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
       AND address LIKE ?
     ORDER BY CASE LOWER(COALESCE(alert_level,'')) WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END
     LIMIT 3`,
    key,
  ).catch(() => []);
}

function formatPremise(rows: PremiseHazardRow[]): string {
  return rows.map((r) => {
    const lvl = r.alert_level && /crit|high/i.test(r.alert_level) ? `${r.alert_level.toUpperCase()} ` : '';
    let flags = '';
    try {
      const f = r.flags ? JSON.parse(r.flags) : [];
      if (Array.isArray(f) && f.length) flags = ` [${f.join(', ')}]`;
    } catch { /* flags not JSON — ignore */ }
    return `${lvl}${r.title}${r.description ? ` — ${r.description}` : ''}${flags}`;
  }).join('; ');
}

/** Request-driven premise lookup (a unit asked "any alerts at <address>"). */
async function lookupPremiseText(db: D1Database, raw: string): Promise<string> {
  const rows = await premiseRows(db, raw);
  if (!rows.length) return `No premise alerts on file for ${raw.trim()}.`;
  return `Premise alert${rows.length > 1 ? 's' : ''} at ${raw.trim()}: ${formatPremise(rows)}. Use caution.`;
}

/**
 * PROACTIVE officer-safety check — run unprompted when a unit goes "out at" a
 * location. Returns a SHORT spoken warning to prepend to the reply, or null
 * when the address is clean. Never throws (rides the relay tail).
 */
export async function checkPremiseHazards(db: D1Database, address: string | null | undefined): Promise<string | null> {
  if (!address) return null;
  const rows = await premiseRows(db, address).catch(() => []);
  if (!rows.length) return null;
  return `Be advised — ${formatPremise(rows)}. Use caution.`;
}

async function lookupVin(db: D1Database, raw: string): Promise<string> {
  const vin = norm(raw).replace(/\s+/g, '');
  if (vin.length < 6) return `Need a fuller VIN to run — say again at least the last 6.`;
  // Match a full VIN or a partial (last-N) — officers often read partials.
  const v = await queryFirst<{
    vin: string | null; plate_number: string | null; make: string | null; model: string | null;
    year: number | null; color: string | null; is_stolen: number | null;
    stolen_status: string | null; registered_owner: string | null;
  }>(
    db,
    // is_stolen is 100% NULL on live; stolen_status carries the value, so this
    // projection said "Not flagged stolen." for every vehicle unconditionally.
    `SELECT vin, plate_number, make, model, year, color, is_stolen, stolen_status, registered_owner
     FROM vehicles_records
     WHERE UPPER(REPLACE(vin,' ','')) = ? OR UPPER(REPLACE(vin,' ','')) LIKE ?
     ORDER BY datetime(COALESCE(updated_at, created_at)) DESC LIMIT 1`,
    vin, `%${vin}`,
  );
  if (!v) return `No vehicle on file for VIN ending ${vin.slice(-6)}.`;
  const desc = [v.year, v.color, v.make, v.model].filter(Boolean).join(' ') || 'vehicle';
  const parts = [
    `VIN ${v.vin || ''} comes back ${desc}${v.plate_number ? `, plate ${v.plate_number}` : ''}.`,
    isFlagSet(v.registered_owner) ? `Registered owner ${v.registered_owner}.` : null,
    isVehicleStolen(v.is_stolen, v.stolen_status)
      ? 'FLAGGED STOLEN — confirm and use caution.' : 'Not flagged stolen.',
  ].filter(Boolean);
  return parts.join(' ');
}

async function lookupPlate(db: D1Database, raw: string): Promise<LookupResult> {
  const plate = norm(raw).replace(/\s+/g, '');
  const v = await queryFirst<{
    id: number; plate_number: string; registration_state: string | null; state: string | null;
    make: string | null; model: string | null; year: number | null; color: string | null;
    is_stolen: number | null; stolen_status: string | null; owner_name: string | null;
    registered_owner: string | null; insurance_status: string | null; flags: string | null;
  }>(
    db,
    `SELECT id, plate_number, registration_state, state, make, model, year, color,
            is_stolen, stolen_status, owner_name, registered_owner, insurance_status, flags
     FROM vehicles_records
     WHERE REPLACE(REPLACE(UPPER(plate_number),' ',''),'-','') = ?
     ORDER BY datetime(COALESCE(updated_at, created_at)) DESC LIMIT 1`,
    plate,
  );
  if (!v) return { text: `No record on file for plate ${norm(raw)}.` };
  const desc = [v.year, v.color, v.make, v.model].filter(Boolean).join(' ') || 'vehicle';
  // Sentinel guard (isFlagSet): a literal "None"/"N/A" owner/insurance/flags
  // value would otherwise be read back as "Registered owner None." etc. (The
  // stolen check stays as-is — is_stolen is an integer and stolen_status is
  // regex-matched, so neither leaks a sentinel.)
  const owner = [v.registered_owner, v.owner_name].find(isFlagSet);
  // /stolen/ matches inside "not stolen", so this reported live vehicles marked
  // "Not Stolen" as FLAGGED STOLEN. Shared helper owns the semantics now.
  const stolen = isVehicleStolen(v.is_stolen, v.stolen_status);
  const parts = [
    `Plate ${v.plate_number}${v.registration_state || v.state ? ` (${v.registration_state || v.state})` : ''}: ${desc}.`,
    owner ? `Registered owner ${owner}.` : null,
    stolen ? 'FLAGGED STOLEN — confirm and use caution.' : 'Not flagged stolen.',
    isFlagSet(v.insurance_status) ? `Insurance ${v.insurance_status}.` : null,
    isFlagSet(v.flags) ? `Flags: ${v.flags}.` : null,
  ].filter(Boolean);
  return { text: parts.join(' '), record: { kind: 'vehicle', id: v.id } };
}

async function lookupPerson(db: D1Database, raw: string): Promise<LookupResult> {
  const q = `%${raw.trim().replace(/\s+/g, '%')}%`;
  const p = await queryFirst<{
    id: number; first_name: string | null; last_name: string | null; dob: string | null;
    flags: string | null; caution_flags: string | null; is_sex_offender: number | null;
    gang_affiliation: string | null;
  }>(
    db,
    `SELECT id, first_name, last_name, dob, flags, caution_flags, is_sex_offender, gang_affiliation
     FROM persons
     WHERE (TRIM(first_name || ' ' || last_name) LIKE ? OR last_name LIKE ? OR first_name LIKE ?)
     ORDER BY datetime(COALESCE(updated_at, created_at)) DESC LIMIT 1`,
    q, q, q,
  );
  if (!p) return { text: `No person record matching "${raw.trim()}".` };
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || raw.trim();
  // Outstanding warrants for this person (by id or by name).
  //
  // A failure here MUST NOT be spoken as "No active warrants on file" — this
  // text goes out over the air, so a swallowed error becomes an audible false
  // clear on warrant status. Track the failure and say so instead.
  //
  // instr() rather than LIKE on the name legs: D1 caps LIKE patterns at 50
  // chars (see searchText.ts), so a long subject name threw here — and the old
  // `.catch(() => [])` turned exactly that into "no warrants".
  let warrantLookupFailed = false;
  const nameMatch = containsAnyClause([
    "TRIM(COALESCE(subject_first_name,'') || ' ' || COALESCE(subject_last_name,''))",
    'subject_name',
  ]);
  const warrants = await query<{ warrant_number: string | null; offense: string | null; status: string | null }>(
    db,
    `SELECT warrant_number, charge_description AS offense, status
     FROM warrants
     WHERE (subject_person_id = ? OR ${nameMatch.sql})
       AND archived_at IS NULL AND COALESCE(status,'') NOT IN ('served','cleared','recalled','closed','quashed')
     LIMIT 3`,
    p.id, ...nameMatch.binds(name),
  ).catch((err) => {
    warrantLookupFailed = true;
    log.error('dispatcher-awareness warrant lookup failed', { personId: p.id }, err as Error);
    return [];
  });
  // Sentinel guard (isFlagSet): live D1 stores "None"/"N/A"/"0" not NULL, so a
  // raw truthiness check would speak a FALSE "gang affiliation noted: None" /
  // "Caution: None" over the air on a clean subject. Guard every flag read.
  const cautions = [p.caution_flags, p.flags].filter(isFlagSet).join('; ');
  const parts = [
    `${name}${p.dob ? `, DOB ${p.dob}` : ''}.`,
    warrants.length
      ? `ACTIVE WARRANT${warrants.length > 1 ? 'S' : ''}: ${warrants.map((w) => `${w.warrant_number || 'warrant'}${w.offense ? ` for ${w.offense}` : ''}`).join('; ')}. Confirm before action.`
      : warrantLookupFailed
        // Never speak a clearance we did not establish.
        ? 'WARRANT CHECK FAILED — warrant status UNKNOWN. Verify manually before action.'
        : 'No active warrants on file.',
    isFlagSet(p.is_sex_offender) ? 'Registered sex offender.' : null,
    isFlagSet(p.gang_affiliation) ? `Gang affiliation noted: ${p.gang_affiliation}.` : null,
    cautions ? `Caution: ${cautions}.` : null,
  ].filter(Boolean);
  return { text: parts.join(' '), record: { kind: 'person', id: p.id } };
}

async function lookupWarrant(db: D1Database, raw: string): Promise<LookupResult> {
  const q = `%${raw.trim().replace(/\s+/g, '%')}%`;
  const rows = await query<{
    warrant_number: string | null; subject_name: string | null; subject_first_name: string | null;
    subject_last_name: string | null; offense: string | null; bond_amount: string | null;
    status: string | null; issuing_agency: string | null;
  }>(
    db,
    `SELECT warrant_number, subject_name, subject_first_name, subject_last_name,
            charge_description AS offense,
            bail_amount AS bond_amount, status, issuing_agency
     FROM warrants
     WHERE (subject_name LIKE ? OR TRIM(COALESCE(subject_first_name,'') || ' ' || COALESCE(subject_last_name,'')) LIKE ? OR warrant_number LIKE ?)
       AND archived_at IS NULL
     ORDER BY datetime(COALESCE(updated_at, created_at)) DESC LIMIT 3`,
    q, q, q,
  );
  if (!rows.length) return { text: `No warrant on file matching "${raw.trim()}".` };
  const text = rows.map((w) => {
    const subj = w.subject_name || [w.subject_first_name, w.subject_last_name].filter(Boolean).join(' ') || 'subject';
    return `${w.warrant_number || 'Warrant'} on ${subj}${w.offense ? ` — ${w.offense}` : ''}${w.bond_amount ? `, bond ${w.bond_amount}` : ''} [${w.status || 'status unknown'}${w.issuing_agency ? `, ${w.issuing_agency}` : ''}].`;
  }).join(' ');
  return { text };
}

// ─── Call status ("status on CFS26-0042") ───────────────────
async function lookupCallStatus(db: D1Database, raw: string): Promise<string> {
  const q = raw.trim();
  if (q.length < 1) return 'Say again the call number.';
  // Exact call number first, then a loose contains-match so "status on 42"
  // can still find CFS26-00042.
  const stripped = q.replace(/[^A-Za-z0-9]/g, '');
  const c = await queryFirst<{
    call_number: string | null; incident_type: string | null; status: string | null;
    priority: string | null; location_address: string | null; unit_call_signs: string | null;
    disposition: string | null;
  }>(
    db,
    `SELECT call_number, incident_type, status, priority, location_address, unit_call_signs, disposition
     FROM calls_for_service
     WHERE UPPER(call_number) = UPPER(?)
        OR REPLACE(REPLACE(UPPER(call_number),'-',''),' ','') LIKE UPPER(?)
     ORDER BY datetime(COALESCE(updated_at, created_at)) DESC LIMIT 1`,
    q, `%${stripped}`,
  ).catch(() => null);
  if (!c) return `No call on file matching "${q}".`;
  const parts = [
    `${c.call_number || 'That call'} — ${c.incident_type || 'unknown type'}${c.priority ? `, ${c.priority}` : ''} at ${c.location_address || 'unknown location'}.`,
    `Status ${c.status || 'unknown'}${c.unit_call_signs ? `, units ${c.unit_call_signs}` : ', no units assigned'}.`,
    c.disposition ? `Disposition ${c.disposition}.` : null,
  ].filter(Boolean);
  return parts.join(' ');
}

// ─── Closest available unit to an address ───────────────────
function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8; // earth radius in miles
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

async function lookupClosestUnit(env: Bindings, db: D1Database, raw: string): Promise<string> {
  const addr = raw.trim();
  if (addr.length < 3) return 'Say again the location for a closest-unit check.';
  const coords = await geocodeAddress(env, addr).catch(() => null);
  if (!coords) return `Couldn't locate ${addr} to find the closest unit.`;

  // Latest GPS fix per call-sign in the last 30 min (SQLite returns the row at
  // MAX(recorded_at) for the bare columns), intersected with AVAILABLE units.
  const [fixes, avail] = await Promise.all([
    safe(query<{ call_sign: string; latitude: number; longitude: number }>(
      db,
      `SELECT call_sign, latitude, longitude, MAX(recorded_at) AS rec
       FROM gps_breadcrumbs
       WHERE call_sign IS NOT NULL AND recorded_at > datetime('now','-30 minutes')
       GROUP BY UPPER(call_sign)`,
    )),
    safe(query<{ cs: string }>(
      db,
      `SELECT UPPER(call_sign) AS cs FROM units WHERE status = 'available' AND call_sign IS NOT NULL`,
    )),
  ]);
  const availSet = new Set(avail.map((a) => a.cs));
  let best: { call_sign: string; miles: number } | null = null;
  for (const f of fixes) {
    if (!availSet.has(f.call_sign.toUpperCase())) continue;
    if (!Number.isFinite(f.latitude) || !Number.isFinite(f.longitude)) continue;
    const miles = haversineMiles(coords.lat, coords.lng, f.latitude, f.longitude);
    if (!best || miles < best.miles) best = { call_sign: f.call_sign, miles };
  }
  if (!best) return `No available unit with a recent GPS fix to send to ${addr}.`;
  return `Closest available is ${best.call_sign}, about ${best.miles.toFixed(1)} miles from ${addr}.`;
}

// ─── "Say again" — re-speak dispatch's last transmission ─────
async function lookupLastDispatch(db: D1Database, channelId: number): Promise<string> {
  if (!channelId) return 'Dispatch has nothing to repeat.';
  // DISPATCH transmissions are inserted with user_id NULL (see VoiceHubDO).
  const row = await queryFirst<{ transcript: string | null }>(
    db,
    `SELECT transcript FROM radio_transmissions
     WHERE channel_id = ? AND user_id IS NULL AND transcript IS NOT NULL AND TRIM(transcript) <> ''
     ORDER BY id DESC LIMIT 1`,
    channelId,
  ).catch(() => null);
  if (!row?.transcript) return 'Dispatch has no prior transmission to repeat.';
  return row.transcript.trim();
}

// ─── "Where am I" + "What's my ETA" (unit-centric lookups) ──
// Both key off the transmitting unit. They speak a complete radio line (the
// caller does NOT re-phrase them through the LLM), so the spoken text below IS
// what goes over the air.

interface BreadcrumbRow {
  latitude: number; longitude: number; recorded_at: string | null;
  heading: number | null; speed: number | null;
}

// Latest GPS fix for a unit within the window. The breadcrumb table carries a
// denormalized call_sign, so we match on it directly (no units join needed).
// 30 min is generous on purpose — a unit that asks "where am I" may have been
// parked a while; a stale-but-real fix beats "no location".
async function latestFix(db: D1Database, callSign: string): Promise<BreadcrumbRow | null> {
  if (!callSign) return null;
  return queryFirst<BreadcrumbRow>(
    db,
    `SELECT latitude, longitude, recorded_at, heading, speed
     FROM gps_breadcrumbs
     WHERE UPPER(call_sign) = UPPER(?)
       AND recorded_at > datetime('now', '-30 minutes')
     ORDER BY datetime(recorded_at) DESC LIMIT 1`,
    callSign,
  ).catch(() => null);
}

async function lookupUnitLocation(env: Bindings, db: D1Database, callSign: string): Promise<LookupResult> {
  const who = callSign || 'Unit';
  const fix = await latestFix(db, callSign);
  if (!fix || !Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) {
    return { text: `${who}, dispatch has no recent GPS fix on you — confirm your location.` };
  }
  // Beat/zone always resolves in-area (R2 geofence); the street is a best-effort
  // bonus from reverse-geocode.
  const [district, street] = await Promise.all([
    resolveDistrict(env, { lat: fix.latitude, lng: fix.longitude }).catch(() => null),
    reverseGeocodeAddress(env, fix.latitude, fix.longitude).catch(() => null),
  ]);
  const place = street
    || (district?.beat_name ? `${district.beat_name}` : null)
    || `${fix.latitude.toFixed(4)}, ${fix.longitude.toFixed(4)}`;
  const beat = district?.zone_beat || district?.beat_name;
  const parts = [
    `${who}, you're showing at ${place}`,
    beat ? `, ${beat}` : '',
    '.',
  ];
  return { text: parts.join('') };
}

async function lookupEta(env: Bindings, db: D1Database, callSign: string): Promise<LookupResult> {
  const who = callSign || 'Unit';
  const fix = await latestFix(db, callSign);
  if (!fix || !Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) {
    return { text: `${who}, dispatch can't compute an ETA — no recent GPS fix on you.` };
  }
  // Destination = the unit's currently assigned call (units.current_call_id).
  const dest = await queryFirst<{
    call_number: string | null; location_address: string | null;
    latitude: number | null; longitude: number | null;
  }>(
    db,
    `SELECT c.call_number, c.location_address, c.latitude, c.longitude
     FROM units u JOIN calls_for_service c ON c.id = u.current_call_id
     WHERE UPPER(u.call_sign) = UPPER(?) LIMIT 1`,
    callSign,
  ).catch(() => null);
  if (!dest || dest.latitude == null || dest.longitude == null) {
    return { text: `${who}, no active assignment with a mapped location to route to.` };
  }
  const eta = await estimateEta(
    env,
    { lat: fix.latitude, lng: fix.longitude },
    { lat: dest.latitude, lng: dest.longitude },
  );
  // "about" when the number is a straight-line estimate; a routed Mapbox time
  // is stated plainly. Honest phrasing per the eta.ts contract.
  const hedge = eta.source === 'mapbox' ? '' : 'about ';
  const where = dest.call_number || dest.location_address || 'your call';
  return {
    text: `${who}, you're ${hedge}${eta.minutes} minute${eta.minutes === 1 ? '' : 's'} out from ${where}, ${eta.miles} miles.`,
  };
}

// ============================================================
// CAD WRITES — spoken data entry
// ============================================================
// The read-side (runLookup) lets the dispatcher answer "run this plate".
// runAction is its mirror: it lets the dispatcher WRITE to the CAD when a
// unit says "show me out at 200 South" or "start a call, suspicious
// vehicle at 5th and Main". Every write is:
//   • schema-true   — column names + CHECK enums verified against the LIVE
//                     schema (785de7ae) on 2026-05-29, never /migrations/.
//   • policy-gated  — evaluateActionPolicy() (the operator knob) can refuse.
//   • best-effort   — a failure returns null so the relay tail never throws;
//                     the dispatcher just acknowledges verbally instead.
//   • board-live    — a successful write fans a 'dispatch_update' to every
//                     dispatcher console via AlertHubDO (broadcastBoard below),
//                     so a radio-AI call / status change appears INSTANTLY, not
//                     on the board's ~20s poll. The room socket's existing
//                     'dispatch_action' frame only reaches the radio console.
// ============================================================

// Push a live board event over the agency-wide AlertHubDO bus. This is the
// SAME 'dispatch_update' contract the HTTP create handler emits
// (broadcastAll('dispatch_update', { action, call/unit })) — but over the bus
// that actually reaches clients: the rewrite worker's broadcastAll() lands in
// an empty per-isolate socket map (the live /api/ws is on the legacy worker),
// whereas every console holds a socket to AlertHubDO (see src/utils/alertHub.ts).
// Fires from all three radio entry points (VoiceHubDO, radio.ts, voice.ts)
// since they share runAction. Best-effort — never throws into the relay tail.
async function broadcastBoard(env: Bindings, action: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await emitAlert(env, 'dispatch_update', { action, ...payload });
  } catch (err) {
    log.warn('board broadcast failed (non-fatal)', { err });
  }
}

// Board-shaped call row — the columns the client mapDbCall renders into a card.
// Explicit list (never SELECT * — calls_for_service is at the 100-col D1 cap);
// any field not selected just defaults client-side and the ~20s poll backfills.
async function boardCallRow(db: D1Database, callId: number): Promise<Record<string, unknown> | null> {
  return queryFirst<Record<string, unknown>>(
    db,
    `SELECT id, call_number, incident_type, priority, status, location_address,
            latitude, longitude, description, caller_name, source, disposition,
            sector_id, sector_name, zone_id, zone_name, beat_id, beat_name,
            dispatch_code, created_at, updated_at, dispatched_at, cleared_at
     FROM calls_for_service WHERE id = ? LIMIT 1`,
    callId,
  ).catch(() => null);
}

// Board-shaped unit row — the fields DispatchPage.applyUnitPatch + the map's
// unit_update bridge read (status, position, officer name, current call number).
async function boardUnitRow(db: D1Database, unitId: number): Promise<Record<string, unknown> | null> {
  return queryFirst<Record<string, unknown>>(
    db,
    `SELECT u.id, u.call_sign, u.status, u.officer_id, u.latitude, u.longitude,
            u.current_call_id, u.last_status_change, u.updated_at,
            usr.full_name AS officer_name, c.call_number AS current_call_number
     FROM units u
     LEFT JOIN users usr ON usr.id = u.officer_id
     LEFT JOIN calls_for_service c ON c.id = u.current_call_id
     WHERE u.id = ? LIMIT 1`,
    unitId,
  ).catch(() => null);
}

export type ActionType = 'set_unit_status' | 'create_call' | 'clear_call' | 'dispatch_backup' | 'create_bolo';

export interface ActionRequest {
  type: ActionType;
  /** Unit call-sign the action concerns (set_unit_status / clear_call / dispatch_backup). */
  unit?: string;
  /** Radio status word/10-code the unit reported (set_unit_status). */
  status?: string;
  /** Free-text location to attach to a status change ("out at 200 South"). */
  location?: string;
  /** New-call fields (create_call). */
  incident_type?: string;
  priority?: string;
  location_address?: string;
  description?: string;
  caller_name?: string;
  /** Call number to clear/close, or to attach backup to (clear_call / dispatch_backup). */
  call_number?: string;
  /** Disposition/outcome when clearing a call (clear_call). */
  disposition?: string;
  /** BOLO fields (create_bolo). bolo_type maps to the person/vehicle/other CHECK. */
  bolo_type?: string;
  title?: string;
  subject_description?: string;
  vehicle_description?: string;
}

/** Context a write may need beyond the request — chiefly WHO is issuing it, for
 *  writes (create_bolo) whose row carries a NOT NULL issued_by FK to users. */
export interface ActionContext { issuedBy?: number | null }

export interface ActionResult {
  /** Terse line the dispatcher reads back confirming what was written. */
  spoken: string;
  /** Machine summary for the TX tag / logs (e.g. "call_created:CFS26-0042"). */
  summary: string;
}

// Canonical unit statuses (must match the units.status CHECK exactly).
type UnitStatus = 'available' | 'dispatched' | 'enroute' | 'onscene' | 'busy' | 'off_duty' | 'out_of_service';

// Map the words/10-codes a unit actually says on the radio onto the strict
// units.status enum. Anything unrecognized is rejected (no silent default —
// a wrong status write is worse than asking the unit to repeat).
function mapUnitStatus(raw: string | undefined): UnitStatus | null {
  const s = (raw || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!s) return null;
  if (/(^|[^0-9])108$|inservice|^clear$|^available$|^code4$|^10?4$/.test(s)) return 'available';
  if (/107$|outofservice|^oos$/.test(s)) return 'out_of_service';
  if (/1076$|1051$|enroute|responding|onmyway/.test(s)) return 'enroute';
  if (/1023$|1097$|onscene|arrived|^out$|outat/.test(s)) return 'onscene';
  if (/busy|tiedup|1078$|backup/.test(s)) return 'busy';
  if (/offduty|endofshift|1042$/.test(s)) return 'off_duty';
  return null;
}

// calls_for_service.priority CHECK is exactly ('P1','P2','P3','P4').
function mapPriority(raw: string | undefined): 'P1' | 'P2' | 'P3' | 'P4' {
  const s = (raw || '').toUpperCase();
  if (/\b(P?1|EMERGENC|PRIORITY ?1|CODE ?3)\b/.test(s)) return 'P1';
  if (/\b(P?2|URGENT|PRIORITY ?2)\b/.test(s)) return 'P2';
  if (/\b(P?4|NON.?URGENT|ROUTINE|COLD)\b/.test(s)) return 'P4';
  return 'P3'; // sensible default for an un-triaged radio report
}

// ─── OPERATOR POLICY KNOB (TUNE ME) ─────────────────────────
// Letting an AI write to a LIVE police CAD off radio audio is a real
// security/UX trade-off, and it's the operator's call — the same way
// DISPATCH_POLICY (in aiDispatcher.ts) is the operator-owned persona knob.
// This gate runs BEFORE any write. Return { allow:false, reason } to refuse
// (the dispatcher then asks the unit to confirm instead of writing).
//
// The default is deliberately conservative. Tune it to RMPG's risk
// tolerance — e.g. require a confirmed call-sign before a status change, or
// hold P1 call creation for a human.
export function evaluateActionPolicy(req: ActionRequest): { allow: boolean; reason?: string } {
  if (req.type === 'set_unit_status') {
    if (!req.unit || !mapUnitStatus(req.status)) {
      return { allow: false, reason: 'unclear unit or status' };
    }
    // NOTE: the "known call-sign" half of this policy needs the DB, so it is
    // enforced in setUnitStatus() (which refuses an unmatched call-sign).
    // This sync gate only screens the shape; the DB check is the real guard.
    return { allow: true };
  }
  if (req.type === 'create_call') {
    // Never mint a call without a place to send units.
    if (!req.location_address || req.location_address.trim().length < 3) {
      return { allow: false, reason: 'no location given' };
    }
    if (!req.incident_type || !req.incident_type.trim()) {
      return { allow: false, reason: 'no incident type given' };
    }
    return { allow: true };
  }
  if (req.type === 'clear_call') {
    if (!req.call_number || !req.call_number.trim()) {
      return { allow: false, reason: 'no call number given' };
    }
    return { allow: true };
  }
  if (req.type === 'dispatch_backup') {
    // Need SOMETHING to attach backup to — the requesting unit or a call.
    if (!req.unit && !req.call_number) {
      return { allow: false, reason: 'no unit or call to back up' };
    }
    return { allow: true };
  }
  if (req.type === 'create_bolo') {
    // Need a title or a description to issue a meaningful BOLO. (The issuer's
    // user id is required too, but that's checked in createBolo where the FK
    // lives — the sync gate only screens shape.)
    if (!req.title?.trim() && !req.description?.trim() && !req.subject_description?.trim() && !req.vehicle_description?.trim()) {
      return { allow: false, reason: 'no BOLO detail given' };
    }
    return { allow: true };
  }
  return { allow: false, reason: 'unknown action' };
}

/**
 * Execute the CAD write a unit requested over the radio. Returns an
 * ActionResult (spoken confirmation + machine summary) on success, or null
 * on a hard failure / policy refusal so the caller falls back to a plain
 * verbal acknowledgement. Never throws into the relay tail.
 */
export async function runAction(env: Bindings, db: D1Database, req: ActionRequest, ctx: ActionContext = {}): Promise<ActionResult | null> {
  const gate = evaluateActionPolicy(req);
  if (!gate.allow) {
    log.warn('action refused', { reason: gate.reason, request: JSON.stringify(req) });
    return null;
  }
  try {
    if (req.type === 'set_unit_status') return await setUnitStatus(env, db, req);
    if (req.type === 'create_call') return await createCall(env, db, req);
    if (req.type === 'clear_call') return await clearCall(env, db, req);
    if (req.type === 'dispatch_backup') return await dispatchBackup(env, db, req);
    if (req.type === 'create_bolo') return await createBolo(db, req, ctx);
    return null;
  } catch (err) {
    log.error('action failed', {}, err);
    return null;
  }
}

// ── Issue a BOLO by voice ("put out a BOLO on …") ──
// bolos: type CHECK('person','vehicle','other'), status CHECK('active',…),
// issued_by NOT NULL FK→users(id). The AI has no user row of its own, so the
// REQUESTING officer is the issuer (ctx.issuedBy) — without it we refuse rather
// than violate the FK. bolo_number is UNIQUE; minted BOLO{YY}-{NNNNN}.
const BOLO_TYPES = new Set(['person', 'vehicle', 'other']);
function mapBoloType(raw: string | undefined): 'person' | 'vehicle' | 'other' {
  const s = (raw || '').trim().toLowerCase();
  if (BOLO_TYPES.has(s)) return s as 'person' | 'vehicle' | 'other';
  if (/person|subject|suspect|individual|male|female|juvenile/.test(s)) return 'person';
  if (/vehicle|car|truck|plate|suv|van|motorcycle/.test(s)) return 'vehicle';
  return 'other';
}

async function createBolo(db: D1Database, req: ActionRequest, ctx: ActionContext): Promise<ActionResult | null> {
  const issuedBy = ctx.issuedBy;
  if (!issuedBy || !Number.isFinite(issuedBy)) {
    // No known issuer → can't satisfy the NOT NULL FK. Refuse (honesty guard).
    log.warn('BOLO refused — no issuing user id');
    return null;
  }
  const boloType = mapBoloType(req.bolo_type);
  const title = (req.title || req.description || req.subject_description || req.vehicle_description || '').trim().slice(0, 200);
  if (!title) return null;
  const priority = mapPriority(req.priority);

  // Mint a unique BOLO number in the board's format. bolo_number is UNIQUE and
  // the minter is a non-atomic SELECT MAX()+1, so a concurrent issue can collide
  // — re-mint + retry on a UNIQUE violation instead of dropping the BOLO. The
  // mint closure re-reads MAX() each attempt so a retry picks up the racer's row.
  const year = new Date().getFullYear().toString().slice(-2);
  const prefix = `BOLO${year}-`;
  const mintBolo = async (): Promise<string> => {
    const [{ max }] = await query<{ max: string | null }>(
      db, 'SELECT MAX(bolo_number) as max FROM bolos WHERE bolo_number LIKE ?', `${prefix}%`,
    );
    const seq = max ? String(parseInt(max.slice(prefix.length), 10) + 1).padStart(5, '0') : '00001';
    return `${prefix}${seq}`;
  };

  let boloNumber: string;
  let res: Awaited<ReturnType<typeof execute>>;
  try {
    const out = await withUniqueRetry(
      mintBolo,
      (boloNo) => execute(
        db,
        `INSERT INTO bolos (bolo_number, type, title, description, subject_description, vehicle_description,
                            status, priority, issued_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'))`,
        boloNo, boloType, title,
        req.description?.trim() || null,
        req.subject_description?.trim() || null,
        req.vehicle_description?.trim() || null,
        priority, issuedBy,
      ),
    );
    boloNumber = out.value;
    res = out.result;
  } catch (err) {
    log.warn('BOLO insert failed', { err });
    return null;
  }
  if (!res.meta.last_row_id) return null;
  return {
    spoken: `Copy, BOLO is out — ${boloNumber}, ${priority}, ${title}. All units be on the lookout.`,
    summary: `bolo_created:${boloNumber}`,
  };
}

async function setUnitStatus(env: Bindings, db: D1Database, req: ActionRequest): Promise<ActionResult | null> {
  const status = mapUnitStatus(req.status);
  const callSign = (req.unit || '').trim();
  if (!status || !callSign) return null;
  // OPERATOR POLICY (chosen 2026-05-29): require a KNOWN call-sign. We never
  // create or update a phantom unit — if the call-sign isn't in `units`, the
  // write is refused and the dispatcher asks the unit to identify instead.
  const unit = await queryFirst<{ id: number; call_sign: string }>(
    db, 'SELECT id, call_sign FROM units WHERE UPPER(call_sign) = UPPER(?) LIMIT 1', callSign,
  );
  if (!unit) {
    log.warn('status write refused — unknown call-sign', { callSign });
    return null;
  }
  await execute(
    db,
    `UPDATE units SET status = ?, last_status_change = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    status, unit.id,
  );
  // Live board: the new status hits every dispatcher console instantly.
  const unitRow = await boardUnitRow(db, unit.id);
  if (unitRow) await broadcastBoard(env, 'unit_status_changed', { unit: unitRow });
  const where = req.location ? ` at ${req.location.trim()}` : '';
  return {
    spoken: `${unit.call_sign}, copy, show you ${spokenStatus(status)}${where}.`,
    summary: `unit_status:${unit.call_sign}=${status}`,
  };
}

// Render the canonical status as a dispatcher would say it on the air.
function spokenStatus(s: UnitStatus): string {
  switch (s) {
    case 'available': return 'in service';
    case 'out_of_service': return 'out of service';
    case 'enroute': return 'en route';
    case 'onscene': return 'out on scene';
    case 'busy': return 'tied up';
    case 'off_duty': return 'off duty';
    default: return s;
  }
}

async function createCall(env: Bindings, db: D1Database, req: ActionRequest): Promise<ActionResult | null> {
  const incidentType = (req.incident_type || '').trim();
  const address = (req.location_address || '').trim();
  if (!incidentType || address.length < 3) return null;
  const priority = mapPriority(req.priority);

  // Mint a call number in the same CFS{YY}-{NNNNN} format as the HTTP
  // create handler so radio-born calls share one sequence with the board.
  // call_number is UNIQUE and the minter is a non-atomic SELECT MAX()+1, so a
  // concurrent writer (HTTP create, intake, another radio call) can collide;
  // the loser's INSERT throws and the call silently drops. Re-mint + retry on a
  // UNIQUE violation. The mint closure re-reads MAX() each attempt. (Audit AI-4.)
  const year = new Date().getFullYear().toString().slice(-2);
  const prefix = `CFS${year}-`;
  const mintCallNumber = async (): Promise<string> => {
    const [{ max }] = await query<{ max: string | null }>(
      db, 'SELECT MAX(call_number) as max FROM calls_for_service WHERE call_number LIKE ?', `${prefix}%`,
    );
    const seq = max ? String(parseInt(max.slice(prefix.length), 10) + 1).padStart(5, '0') : '00001';
    return `${prefix}${seq}`;
  };

  // Geocode + district backfill so the call plots on the map and closest-unit
  // ranking works — same enrichment the HTTP path does. All best-effort.
  let lat: number | null = null, lng: number | null = null;
  const coords = await geocodeAddress(env, address).catch(() => null);
  if (coords) { lat = coords.lat; lng = coords.lng; }
  let district: Awaited<ReturnType<typeof resolveDistrict>> = null;
  if (lat != null && lng != null) {
    district = await resolveDistrict(env, { lat, lng }).catch(() => null);
  }

  let callNumber: string;
  let res: Awaited<ReturnType<typeof execute>>;
  try {
    const out = await withUniqueRetry(
      mintCallNumber,
      (callNo) => execute(
        db,
        `INSERT INTO calls_for_service
           (call_number, incident_type, priority, status, location_address, source,
            description, caller_name, latitude, longitude,
            sector_id, sector_name, zone_id, zone_name, beat_id, beat_name, dispatch_code,
            created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, 'radio', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        callNo,
        incidentType.toLowerCase().replace(/\s+/g, '_'),
        priority,
        address,
        req.description?.trim() || null,
        req.caller_name?.trim() || null,
        lat, lng,
        district?.sector_id ?? null, district?.sector_name ?? null,
        district?.zone_id ?? null, district?.zone_name ?? null,
        district?.beat_id ?? null, district?.beat_name ?? null,
        district?.dispatch_code ?? null,
      ),
    );
    callNumber = out.value;
    res = out.result;
  } catch (err) {
    log.warn('createCall insert failed', { err });
    return null;
  }
  if (!res.meta.last_row_id) return null;

  // ── Area enrichment (AI-6) ────────────────────────────────────
  // The base INSERT above writes sector/zone/beat (which exist on
  // calls_for_service), but Area — the top of the A/S/Z/B hierarchy — lives on
  // the 1:1 calls_for_service_ext overflow table (base is at the 100-col cap).
  // Parity with serveIntakeRecords.createServiceCall: INSERT OR IGNORE the ext
  // row, then UPDATE the area columns. Best-effort — a miss just leaves Area
  // null, exactly as before; it must never abort the radio-born call.
  if (district?.area_code != null || district?.area_name != null) {
    try {
      const callId = Number(res.meta.last_row_id);
      await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', callId);
      await execute(
        db,
        'UPDATE calls_for_service_ext SET area_code = COALESCE(?, area_code), area_name = COALESCE(?, area_name) WHERE id = ?',
        district.area_code ?? null, district.area_name ?? null, callId,
      );
    } catch (err) {
      log.warn('createCall area ext write skipped (non-fatal)', { err });
    }
  }

  const beat = district?.beat_name ? ` in ${district.beat_name}` : '';
  return {
    spoken: `Copy, I've created ${callNumber}, ${priority}, ${incidentType} at ${address}${beat}.`,
    summary: `call_created:${callNumber}`,
  };
}

// ── Clear / close a call (10-8 from scene, disposition) ──
const CLOSED_STATES = new Set(['cleared', 'closed', 'archived', 'cancelled', 'canceled']);
async function clearCall(env: Bindings, db: D1Database, req: ActionRequest): Promise<ActionResult | null> {
  const cn = (req.call_number || '').trim();
  if (!cn) return null;
  const call = await queryFirst<{ id: number; call_number: string; status: string | null }>(
    db, 'SELECT id, call_number, status FROM calls_for_service WHERE UPPER(call_number) = UPPER(?) LIMIT 1', cn,
  );
  if (!call) return null; // never invent a call — defer to a verbal "say again"
  if (call.status && CLOSED_STATES.has(call.status)) {
    return { spoken: `${call.call_number} is already cleared.`, summary: `call_clear_noop:${call.call_number}` };
  }
  const disp = req.disposition?.trim() || null;
  await execute(
    db,
    `UPDATE calls_for_service
       SET previous_status = status, status = 'cleared',
           cleared_at = datetime('now'), status_changed_at = datetime('now'),
           updated_at = datetime('now'), disposition = COALESCE(?, disposition)
     WHERE id = ?`,
    disp, call.id,
  );
  // Live board: drop/refresh the now-cleared call on every console immediately
  // (mapDbCall reads status='cleared'; the board filters it from the active list).
  const clearedRow = await boardCallRow(db, call.id);
  if (clearedRow) await broadcastBoard(env, 'call_updated', { call: clearedRow });
  return {
    spoken: `Copy, ${call.call_number} cleared${disp ? `, disposition ${disp}` : ''}.`,
    summary: `call_cleared:${call.call_number}`,
  };
}

// ── Dispatch the nearest available unit as backup (10-78) ──
async function dispatchBackup(env: Bindings, db: D1Database, req: ActionRequest): Promise<ActionResult | null> {
  const reqUnit = (req.unit || '').trim();
  let callId: number | null = null;
  let callNumber: string | null = null;
  let requestingBeat: string | null = null;

  if (req.call_number?.trim()) {
    const c = await queryFirst<{ id: number; call_number: string | null }>(
      db, 'SELECT id, call_number FROM calls_for_service WHERE UPPER(call_number) = UPPER(?) LIMIT 1', req.call_number.trim(),
    );
    if (c) { callId = c.id; callNumber = c.call_number; }
  }
  if (reqUnit) {
    const u = await queryFirst<{ current_call_id: number | null; assigned_beat: string | null }>(
      db, 'SELECT current_call_id, assigned_beat FROM units WHERE UPPER(call_sign) = UPPER(?) LIMIT 1', reqUnit,
    );
    if (u) {
      requestingBeat = u.assigned_beat;
      if (callId == null && u.current_call_id != null) callId = u.current_call_id;
    }
  }

  // Closest available responder — prefer the requesting unit's beat, never the
  // requester itself. (Drive-time ranking is a client/Matrix concern; on the
  // server we use beat affinity as a cheap proxy.)
  const candidate = await queryFirst<{ id: number; call_sign: string }>(
    db,
    `SELECT id, call_sign FROM units
     WHERE status = 'available' AND call_sign IS NOT NULL AND UPPER(call_sign) <> UPPER(?)
     ORDER BY CASE WHEN assigned_beat = ? THEN 0 ELSE 1 END, call_sign
     LIMIT 1`,
    reqUnit || ' ', requestingBeat ?? ' ',
  );
  if (!candidate) {
    return { spoken: 'No units available for backup right now — stand by.', summary: 'backup_none' };
  }
  if (callId != null) {
    await execute(
      db,
      `UPDATE units SET status = 'dispatched', current_call_id = ?, last_status_change = datetime('now'), updated_at = datetime('now') WHERE UPPER(call_sign) = UPPER(?)`,
      callId, candidate.call_sign,
    );
    if (!callNumber) {
      const c = await queryFirst<{ call_number: string | null }>(db, 'SELECT call_number FROM calls_for_service WHERE id = ?', callId);
      callNumber = c?.call_number ?? null;
    }
  } else {
    await execute(
      db,
      `UPDATE units SET status = 'dispatched', last_status_change = datetime('now'), updated_at = datetime('now') WHERE UPPER(call_sign) = UPPER(?)`,
      candidate.call_sign,
    );
  }
  // Live board: the backup unit flips to 'dispatched' on every console instantly.
  const backupRow = await boardUnitRow(db, candidate.id);
  if (backupRow) await broadcastBoard(env, 'unit_status_changed', { unit: backupRow });
  const assist = reqUnit ? ` to assist ${reqUnit}` : '';
  const onCall = callNumber ? ` on ${callNumber}` : '';
  return {
    spoken: `${candidate.call_sign}, respond for backup${assist}${onCall}.`,
    summary: `backup_dispatched:${candidate.call_sign}`,
  };
}
