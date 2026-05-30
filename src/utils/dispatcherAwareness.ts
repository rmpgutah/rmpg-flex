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

import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings } from '../types';
import { query, queryFirst, execute } from './db';
import { geocodeAddress, reverseGeocodeAddress } from '../routes/geocode';
import { resolveDistrict } from './districtResolver';
import { estimateEta } from './eta';

// Statuses that mean a call is no longer on the active board.
const CLOSED_CALL_STATUSES = ['closed', 'cleared', 'archived', 'cancelled', 'canceled'];
// Statuses that mean a unit is not currently working.
const OFF_DUTY_UNIT_STATUSES = ['off_duty', 'offline', 'out_of_service', 'oos', 'unavailable'];

async function safe<T>(p: Promise<T[]>): Promise<T[]> {
  try { return await p; } catch (err) {
    console.warn('[awareness] query failed (skipped):', (err as Error)?.message);
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

export type LookupType = 'plate' | 'person' | 'warrant' | 'unit_location' | 'eta';
export interface LookupRequest { type: LookupType; query: string }

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
export interface LookupContext { speaker?: string | null }

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
    // "where am I" / "what's my ETA" key off the transmitting unit, not the
    // spoken query — the model may pass the call-sign through `query`, but the
    // speaker the relay already knows is authoritative.
    const unit = (ctx.speaker || req.query || '').trim();
    if (req.type === 'unit_location') return await lookupUnitLocation(env, db, unit);
    if (req.type === 'eta') return await lookupEta(env, db, unit);
    return null;
  } catch (err) {
    console.error('[awareness] lookup failed:', (err as Error)?.message);
    return null;
  }
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
  const owner = v.registered_owner || v.owner_name;
  const stolen = v.is_stolen || (v.stolen_status && /stolen|yes|active/i.test(v.stolen_status));
  const parts = [
    `Plate ${v.plate_number}${v.registration_state || v.state ? ` (${v.registration_state || v.state})` : ''}: ${desc}.`,
    owner ? `Registered owner ${owner}.` : null,
    stolen ? 'FLAGGED STOLEN — confirm and use caution.' : 'Not flagged stolen.',
    v.insurance_status ? `Insurance ${v.insurance_status}.` : null,
    v.flags ? `Flags: ${v.flags}.` : null,
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
  const warrants = await query<{ warrant_number: string | null; offense: string | null; status: string | null }>(
    db,
    `SELECT warrant_number, COALESCE(offense, offense_description, charge_description, description) AS offense, status
     FROM warrants
     WHERE (person_id = ? OR subject_person_id = ? OR TRIM(COALESCE(subject_first_name,'') || ' ' || COALESCE(subject_last_name,'')) LIKE ? OR subject_name LIKE ?)
       AND archived_at IS NULL AND COALESCE(status,'') NOT IN ('served','cleared','recalled','closed','quashed')
     LIMIT 3`,
    p.id, p.id, `%${name}%`, `%${name}%`,
  ).catch(() => []);
  const cautions = [p.caution_flags, p.flags].filter(Boolean).join('; ');
  const parts = [
    `${name}${p.dob ? `, DOB ${p.dob}` : ''}.`,
    warrants.length
      ? `ACTIVE WARRANT${warrants.length > 1 ? 'S' : ''}: ${warrants.map((w) => `${w.warrant_number || 'warrant'}${w.offense ? ` for ${w.offense}` : ''}`).join('; ')}. Confirm before action.`
      : 'No active warrants on file.',
    p.is_sex_offender ? 'Registered sex offender.' : null,
    p.gang_affiliation ? `Gang affiliation noted: ${p.gang_affiliation}.` : null,
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
            COALESCE(offense, offense_description, charge_description, description) AS offense,
            COALESCE(bond_amount, bail_amount) AS bond_amount, status, issuing_agency
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
// ============================================================

export type ActionType = 'set_unit_status' | 'create_call';

export interface ActionRequest {
  type: ActionType;
  /** Unit call-sign the action concerns (set_unit_status). */
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
}

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
  return { allow: false, reason: 'unknown action' };
}

/**
 * Execute the CAD write a unit requested over the radio. Returns an
 * ActionResult (spoken confirmation + machine summary) on success, or null
 * on a hard failure / policy refusal so the caller falls back to a plain
 * verbal acknowledgement. Never throws into the relay tail.
 */
export async function runAction(env: Bindings, db: D1Database, req: ActionRequest): Promise<ActionResult | null> {
  const gate = evaluateActionPolicy(req);
  if (!gate.allow) {
    console.warn('[awareness] action refused:', gate.reason, JSON.stringify(req));
    return null;
  }
  try {
    if (req.type === 'set_unit_status') return await setUnitStatus(db, req);
    if (req.type === 'create_call') return await createCall(env, db, req);
    return null;
  } catch (err) {
    console.error('[awareness] action failed:', (err as Error)?.message);
    return null;
  }
}

async function setUnitStatus(db: D1Database, req: ActionRequest): Promise<ActionResult | null> {
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
    console.warn(`[awareness] status write refused — unknown call-sign "${callSign}"`);
    return null;
  }
  await execute(
    db,
    `UPDATE units SET status = ?, last_status_change = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    status, unit.id,
  );
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
  const year = new Date().getFullYear().toString().slice(-2);
  const prefix = `CFS${year}-`;
  const [{ max }] = await query<{ max: string | null }>(
    db, 'SELECT MAX(call_number) as max FROM calls_for_service WHERE call_number LIKE ?', `${prefix}%`,
  );
  const seq = max ? String(parseInt(max.slice(prefix.length), 10) + 1).padStart(5, '0') : '00001';
  const callNumber = `${prefix}${seq}`;

  // Geocode + district backfill so the call plots on the map and closest-unit
  // ranking works — same enrichment the HTTP path does. All best-effort.
  let lat: number | null = null, lng: number | null = null;
  const coords = await geocodeAddress(env, address).catch(() => null);
  if (coords) { lat = coords.lat; lng = coords.lng; }
  let district: Awaited<ReturnType<typeof resolveDistrict>> = null;
  if (lat != null && lng != null) {
    district = await resolveDistrict(env, { lat, lng }).catch(() => null);
  }

  const res = await execute(
    db,
    `INSERT INTO calls_for_service
       (call_number, incident_type, priority, status, location_address, source,
        description, caller_name, latitude, longitude,
        sector_id, sector_name, zone_id, zone_name, beat_id, beat_name, dispatch_code,
        created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, 'radio', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    callNumber,
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
  );
  if (!res.meta.last_row_id) return null;
  const beat = district?.beat_name ? ` in ${district.beat_name}` : '';
  return {
    spoken: `Copy, I've created ${callNumber}, ${priority}, ${incidentType} at ${address}${beat}.`,
    summary: `call_created:${callNumber}`,
  };
}
