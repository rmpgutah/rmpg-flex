// ============================================================
// Serve Intake Enrichment
//
// At intake time, augment the parsed defendant/address with intelligence
// from the rest of the system so the CFS that gets created carries everything
// a dispatcher would otherwise have to research manually:
//
//   1. Prior contact history for the defendant (calls/incidents/arrests)
//   2. Risk flags (active warrants, BOLOs, officer-safety FIs)
//   3. Address frequency (prior calls/incidents at this address)
//   4. Adjacent open serves (other PSO calls within 1 mile, for route batching)
//   5. Apartment/unit number extracted from address string
//   6. Structured diligence tracker (which 4-window slots are still required)
//   7. Best-contact-time heuristic from prior successful serves
//   8. Closest-available-unit pre-suggestion at intake time
//
// All functions are best-effort. Each catches its own errors and returns
// a neutral result so a single failed enrichment never blocks intake.
// ============================================================

import type { getDb } from '../models/database';

type Db = ReturnType<typeof getDb>;

export interface EnrichmentInput {
  db: Db;
  defendant: { first: string; middle: string; last: string; dob?: string };
  address: string;
  latitude: number | null;
  longitude: number | null;
  defendantPersonId: number | null;
  dueDate: string | null; // 'MM/DD/YYYY'
  serviceWindowsLabel: string;
}

export interface EnrichmentResult {
  // Aggregated narrative section to append to dispatch notes (single string).
  narrativeSection: string;
  // Flags that influence CFS INSERT defaults.
  flags: {
    officerSafetyCaution: boolean;
    weaponsInvolved: boolean;
    secondaryType: string | null; // e.g. 'repeat_location'
    premiseAlertActive: boolean;
    activeTrespassOrder: boolean;
  };
  // Apartment/unit string parsed from address (for location_room field).
  unitNumber: string | null;
  // Structured diligence tracker JSON (for pso_service_windows field).
  serviceWindows: ServiceWindowsTracker;
  // Closest-available-unit suggestion at intake (or null if none).
  closestUnit: { id: number; call_sign: string; distance_miles: number; officer_name: string | null } | null;
  // Vehicle plates known to this subject (for at-door identification).
  knownVehicles: Array<{ plate: string; state: string | null; year: number | null; make: string | null; model: string | null; color: string | null }>;
  // Existing open civil case linked to this defendant (avoids duplicate case creation).
  existingOpenCase: { id: number; case_number: string; title: string } | null;
}

export interface ServiceWindowsTracker {
  required: string[];          // ['early_morning','daytime','evening','weekend']
  completed: string[];         // populated by attempts later
  next_required: string | null;
  next_required_by: string | null; // ISO date or null
  source: 'serve_intake_enrichment_v1';
}

// ─────────────────────────────────────────────────────────────────────
// 5. Apartment / unit / suite parser
// ─────────────────────────────────────────────────────────────────────
const UNIT_PATTERNS: RegExp[] = [
  /\b(?:Apt|Apartment|Unit|Ste|Suite|#)\s*\.?\s*([A-Za-z0-9\-]{1,8})\b/i,
  /,\s*#\s*([A-Za-z0-9\-]{1,8})\b/,
];

export function extractUnitNumber(address: string): string | null {
  if (!address) return null;
  for (const re of UNIT_PATTERNS) {
    const m = address.match(re);
    if (m && m[1]) return m[1].toUpperCase();
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// 1. Prior contact history (calls + incidents + arrests for this defendant)
// ─────────────────────────────────────────────────────────────────────
function priorContacts(db: Db, defendantPersonId: number | null, fullName: string, dob?: string): {
  callCount: number;
  incidentCount: number;
  arrestCount: number;
  lastContact: string | null;
} {
  const empty = { callCount: 0, incidentCount: 0, arrestCount: 0, lastContact: null as string | null };
  try {
    if (!defendantPersonId && (!fullName || fullName.trim().length < 3)) return empty;

    const callRow = defendantPersonId
      ? db.prepare(`SELECT COUNT(*) AS c, MAX(c.created_at) AS last FROM call_persons cp JOIN calls_for_service c ON c.id = cp.call_id WHERE cp.person_id = ?`).get(defendantPersonId) as any
      : { c: 0, last: null };
    const incidentRow = defendantPersonId
      ? db.prepare(`SELECT COUNT(*) AS c, MAX(i.created_at) AS last FROM incident_persons ip JOIN incidents i ON i.id = ip.incident_id WHERE ip.person_id = ?`).get(defendantPersonId) as any
      : { c: 0, last: null };

    // Arrest records often aren't linked to a person_id; match by name + dob.
    let arrestRow: any = { c: 0, last: null };
    if (fullName) {
      const parts = fullName.trim().split(/\s+/);
      const first = parts[0] || '';
      const last = parts[parts.length - 1] || '';
      arrestRow = db.prepare(`
        SELECT COUNT(*) AS c, MAX(booking_date) AS last
        FROM arrest_records
        WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)
          ${dob ? 'AND date_of_birth = ?' : ''}
      `).get(...(dob ? [first, last, dob] : [first, last])) as any;
    }

    const candidates = [callRow?.last, incidentRow?.last, arrestRow?.last].filter(Boolean) as string[];
    const lastContact = candidates.length > 0 ? candidates.sort().reverse()[0] : null;

    return {
      callCount: Number(callRow?.c || 0),
      incidentCount: Number(incidentRow?.c || 0),
      arrestCount: Number(arrestRow?.c || 0),
      lastContact,
    };
  } catch {
    return empty;
  }
}

// ─────────────────────────────────────────────────────────────────────
// 2. Risk flags (active warrants, BOLOs, officer-safety FIs)
// ─────────────────────────────────────────────────────────────────────
function riskFlags(db: Db, defendantPersonId: number | null, fullName: string): {
  activeWarrants: { count: number; types: string[] };
  activeBolos: number;
  officerSafetyFi: number;
} {
  const empty = { activeWarrants: { count: 0, types: [] as string[] }, activeBolos: 0, officerSafetyFi: 0 };
  try {
    if (!defendantPersonId && !fullName) return empty;

    const warrantRows = defendantPersonId
      ? db.prepare(`SELECT type FROM warrants WHERE subject_person_id = ? AND status = 'active'`).all(defendantPersonId) as any[]
      : [];
    const types = Array.from(new Set(warrantRows.map((r) => String(r.type)).filter(Boolean)));

    // BOLOs match by subject_description containing the name (loose). Active only.
    const bolos = fullName
      ? db.prepare(`SELECT COUNT(*) AS c FROM bolos WHERE status = 'active' AND (LOWER(subject_description) LIKE LOWER(?) OR LOWER(title) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?))`)
        .get(`%${fullName}%`, `%${fullName}%`, `%${fullName}%`) as any
      : { c: 0 };

    // Officer-safety field interviews — flag column on FIs.
    const fiRows = defendantPersonId
      ? db.prepare(`SELECT COUNT(*) AS c FROM field_interviews WHERE person_id = ? AND (officer_safety_caution = 1 OR safety_concerns IS NOT NULL OR weapons_observed IS NOT NULL)`).get(defendantPersonId) as any
      : { c: 0 };

    return {
      activeWarrants: { count: warrantRows.length, types },
      activeBolos: Number(bolos?.c || 0),
      officerSafetyFi: Number(fiRows?.c || 0),
    };
  } catch {
    return empty;
  }
}

// ─────────────────────────────────────────────────────────────────────
// 3. Address frequency (prior calls/incidents at this address, last 12mo)
// ─────────────────────────────────────────────────────────────────────
function addressFrequency(db: Db, address: string): { callCount: number; incidentCount: number; lastVisit: string | null } {
  const empty = { callCount: 0, incidentCount: 0, lastVisit: null as string | null };
  try {
    if (!address || address.length < 5) return empty;
    // Match on the first ~30 chars of the address (street # + name) to be tolerant of unit/zip variance.
    const matchPrefix = address.split(',')[0].trim().slice(0, 40);
    if (!matchPrefix) return empty;
    const like = `${matchPrefix}%`;
    const callRow = db.prepare(`SELECT COUNT(*) AS c, MAX(created_at) AS last FROM calls_for_service WHERE LOWER(location_address) LIKE LOWER(?) AND created_at > datetime('now', '-12 months')`).get(like) as any;
    const incidentRow = db.prepare(`SELECT COUNT(*) AS c, MAX(created_at) AS last FROM incidents WHERE LOWER(location_address) LIKE LOWER(?) AND created_at > datetime('now', '-12 months')`).get(like) as any;
    const candidates = [callRow?.last, incidentRow?.last].filter(Boolean) as string[];
    const lastVisit = candidates.length > 0 ? candidates.sort().reverse()[0] : null;
    return { callCount: Number(callRow?.c || 0), incidentCount: Number(incidentRow?.c || 0), lastVisit };
  } catch {
    return empty;
  }
}

// ─────────────────────────────────────────────────────────────────────
// 4. Adjacent open serves (other PSO calls within 1 mile)
// ─────────────────────────────────────────────────────────────────────
function adjacentOpenServes(db: Db, lat: number | null, lng: number | null): Array<{ call_number: string; distance_miles: number; address: string }> {
  if (lat == null || lng == null) return [];
  try {
    const rows = db.prepare(`
      SELECT call_number, latitude, longitude, location_address
      FROM calls_for_service
      WHERE incident_type = 'pso_client_request'
        AND status IN ('pending','dispatched','enroute','onscene','on_hold')
        AND latitude IS NOT NULL AND longitude IS NOT NULL
      LIMIT 500
    `).all() as any[];
    const toRad = (d: number) => (d * Math.PI) / 180;
    const haversineMiles = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 3958.7613;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    };
    return rows
      .map((r) => ({
        call_number: r.call_number,
        distance_miles: haversineMiles(lat, lng, r.latitude, r.longitude),
        address: r.location_address || '',
      }))
      .filter((r) => r.distance_miles <= 1.0)
      .sort((a, b) => a.distance_miles - b.distance_miles)
      .slice(0, 5);
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────
// 6. Structured diligence tracker
// ─────────────────────────────────────────────────────────────────────
function buildServiceWindowsTracker(serviceWindowsLabel: string, dueDate: string | null): ServiceWindowsTracker {
  const required: string[] = [];
  const label = (serviceWindowsLabel || '').toUpperCase();
  if (label.includes('6AM-9AM') || label.includes('EARLY')) required.push('early_morning');
  if (label.includes('9AM-6PM') || label.includes('DAYTIME')) required.push('daytime');
  if (label.includes('6PM-9PM') || label.includes('EVENING')) required.push('evening');
  if (label.includes('WEEKEND')) required.push('weekend');
  if (required.length === 0) required.push('early_morning', 'daytime', 'evening', 'weekend'); // standard 4-window default
  let nextRequiredBy: string | null = null;
  if (dueDate) {
    const m = dueDate.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
      nextRequiredBy = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }
  }
  return {
    required,
    completed: [],
    next_required: required[0] || null,
    next_required_by: nextRequiredBy,
    source: 'serve_intake_enrichment_v1',
  };
}

// ─────────────────────────────────────────────────────────────────────
// 7. Best contact time heuristic — derived from prior successful serves
//    of the same defendant (where status reached 'cleared' via process_served)
// ─────────────────────────────────────────────────────────────────────
function bestContactTime(db: Db, defendantPersonId: number | null): { window: string; sampleSize: number } | null {
  if (!defendantPersonId) return null;
  try {
    const rows = db.prepare(`
      SELECT c.process_served_at
      FROM call_persons cp
      JOIN calls_for_service c ON c.id = cp.call_id
      WHERE cp.person_id = ?
        AND c.process_served_at IS NOT NULL
        AND c.process_service_result = 'served'
      ORDER BY c.process_served_at DESC
      LIMIT 25
    `).all(defendantPersonId) as any[];
    if (rows.length < 2) return null;
    const buckets: Record<string, number> = { '06-09': 0, '09-12': 0, '12-15': 0, '15-18': 0, '18-21': 0, 'other': 0 };
    rows.forEach((r) => {
      const d = new Date(r.process_served_at);
      if (Number.isNaN(d.getTime())) return;
      const hr = d.getHours();
      if (hr >= 6 && hr < 9) buckets['06-09']++;
      else if (hr >= 9 && hr < 12) buckets['09-12']++;
      else if (hr >= 12 && hr < 15) buckets['12-15']++;
      else if (hr >= 15 && hr < 18) buckets['15-18']++;
      else if (hr >= 18 && hr < 21) buckets['18-21']++;
      else buckets['other']++;
    });
    const winner = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0];
    if (!winner || winner[1] === 0) return null;
    return { window: winner[0], sampleSize: rows.length };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// 8. Closest available unit at intake (haversine over units with GPS)
// ─────────────────────────────────────────────────────────────────────
function closestAvailableUnit(db: Db, lat: number | null, lng: number | null): EnrichmentResult['closestUnit'] {
  if (lat == null || lng == null) return null;
  try {
    const units = db.prepare(`
      SELECT u.id, u.call_sign, u.latitude, u.longitude, usr.full_name AS officer_name
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE u.status = 'available' AND u.latitude IS NOT NULL AND u.longitude IS NOT NULL
    `).all() as any[];
    if (units.length === 0) return null;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const haversineMiles = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 3958.7613;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    };
    const ranked = units.map((u) => ({
      id: Number(u.id),
      call_sign: String(u.call_sign),
      officer_name: u.officer_name || null,
      distance_miles: Number(haversineMiles(lat, lng, u.latitude, u.longitude).toFixed(2)),
    })).sort((a, b) => a.distance_miles - b.distance_miles);
    return ranked[0];
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// 9. Vehicles registered to subject (for at-door / driveway identification)
// ─────────────────────────────────────────────────────────────────────
function knownVehicles(db: Db, defendantPersonId: number | null): EnrichmentResult['knownVehicles'] {
  if (!defendantPersonId) return [];
  try {
    const rows = db.prepare(`
      SELECT plate_number, state, year, make, model, color
      FROM vehicles_records
      WHERE owner_person_id = ?
      ORDER BY created_at DESC
      LIMIT 6
    `).all(defendantPersonId) as any[];
    return rows
      .filter((r) => r.plate_number)
      .map((r) => ({
        plate: String(r.plate_number).toUpperCase(),
        state: r.state || null,
        year: r.year ? Number(r.year) : null,
        make: r.make || null,
        model: r.model || null,
        color: r.color || null,
      }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────
// 10. Known associates / co-residents at the address
// ─────────────────────────────────────────────────────────────────────
function knownAssociates(db: Db, defendantPersonId: number | null): Array<{ name: string; relationship: string; notes: string | null }> {
  if (!defendantPersonId) return [];
  try {
    const rows = db.prepare(`
      SELECT p.first_name, p.last_name, pa.relationship_type, pa.notes
      FROM person_associates pa
      JOIN persons p ON p.id = pa.associate_id
      WHERE pa.person_id = ?
      ORDER BY pa.created_at DESC
      LIMIT 5
    `).all(defendantPersonId) as any[];
    return rows.map((r) => ({
      name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      relationship: String(r.relationship_type || 'associate'),
      notes: r.notes || null,
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────
// 11. Active trespass orders against subject
// ─────────────────────────────────────────────────────────────────────
function activeTrespassOrders(db: Db, defendantPersonId: number | null): Array<{ order_number: string; location: string; expires: string | null }> {
  if (!defendantPersonId) return [];
  try {
    const rows = db.prepare(`
      SELECT order_number, location, expiration_date
      FROM trespass_orders
      WHERE person_id = ? AND status = 'active'
      ORDER BY effective_date DESC
      LIMIT 5
    `).all(defendantPersonId) as any[];
    return rows.map((r) => ({
      order_number: String(r.order_number),
      location: String(r.location || ''),
      expires: r.expiration_date || null,
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────
// 12. Premise alerts at the service address
// ─────────────────────────────────────────────────────────────────────
function premiseAlerts(db: Db, address: string): Array<{ title: string; alert_level: string; description: string | null }> {
  if (!address || address.length < 5) return [];
  try {
    const matchPrefix = address.split(',')[0].trim().slice(0, 40);
    if (!matchPrefix) return [];
    const rows = db.prepare(`
      SELECT title, alert_level, description, alert_type
      FROM premise_alerts
      WHERE LOWER(address) LIKE LOWER(?)
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY (CASE alert_level WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 WHEN 'caution' THEN 2 ELSE 3 END), created_at DESC
      LIMIT 5
    `).all(`${matchPrefix}%`) as any[];
    return rows.map((r) => ({
      title: String(r.title || r.alert_type || 'Premise alert'),
      alert_level: String(r.alert_level || 'info').toUpperCase(),
      description: r.description || null,
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────
// 13. Prior serve attempts at the exact address (any subject)
// ─────────────────────────────────────────────────────────────────────
function priorAttemptsAtAddress(db: Db, address: string): { attempts: number; lastResult: string | null; lastWhen: string | null } {
  const empty = { attempts: 0, lastResult: null as string | null, lastWhen: null as string | null };
  if (!address || address.length < 5) return empty;
  try {
    const matchPrefix = address.split(',')[0].trim().slice(0, 40);
    if (!matchPrefix) return empty;
    // serve_attempts has lat/lng but not address; join through serve_queue which carries address.
    const row = db.prepare(`
      SELECT COUNT(*) AS c, MAX(sa.attempt_at) AS last,
        (SELECT result FROM serve_attempts sa2
         JOIN serve_queue sq2 ON sq2.id = sa2.serve_queue_id
         WHERE LOWER(sq2.recipient_address) LIKE LOWER(?)
         ORDER BY sa2.attempt_at DESC LIMIT 1) AS last_result
      FROM serve_attempts sa
      JOIN serve_queue sq ON sq.id = sa.serve_queue_id
      WHERE LOWER(sq.recipient_address) LIKE LOWER(?)
    `).get(`${matchPrefix}%`, `${matchPrefix}%`) as any;
    return {
      attempts: Number(row?.c || 0),
      lastResult: row?.last_result || null,
      lastWhen: row?.last || null,
    };
  } catch {
    return empty;
  }
}

// ─────────────────────────────────────────────────────────────────────
// 14. Aliases / known-as for the subject
// ─────────────────────────────────────────────────────────────────────
function subjectAliases(db: Db, defendantPersonId: number | null): string[] {
  if (!defendantPersonId) return [];
  try {
    const row = db.prepare(`SELECT aliases, alias_nickname FROM persons WHERE id = ?`).get(defendantPersonId) as any;
    if (!row) return [];
    const out = new Set<string>();
    if (row.alias_nickname) out.add(String(row.alias_nickname).trim());
    if (row.aliases) {
      // aliases column stores either JSON array or comma-delimited string
      try {
        const parsed = JSON.parse(row.aliases);
        if (Array.isArray(parsed)) parsed.forEach((a) => { if (a) out.add(String(a).trim()); });
      } catch {
        String(row.aliases).split(/[,;]/).forEach((a) => { const t = a.trim(); if (t) out.add(t); });
      }
    }
    return Array.from(out).filter(Boolean).slice(0, 6);
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────
// 15. Last patrol GPS ping near the address (within 0.1mi, last 30d)
// ─────────────────────────────────────────────────────────────────────
function lastPatrolNearAddress(db: Db, lat: number | null, lng: number | null): { call_sign: string; officer_name: string | null; when: string; distance_miles: number } | null {
  if (lat == null || lng == null) return null;
  try {
    // Bounding-box prefilter (0.1 mi ≈ 0.0015 deg lat, 0.0019 deg lng at SLC) then exact haversine.
    const dLat = 0.002;
    const dLng = 0.0024;
    const rows = db.prepare(`
      SELECT call_sign, officer_name, latitude, longitude, recorded_at
      FROM gps_breadcrumbs
      WHERE latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
        AND recorded_at > datetime('now', '-30 days', 'localtime')
      ORDER BY recorded_at DESC
      LIMIT 200
    `).all(lat - dLat, lat + dLat, lng - dLng, lng + dLng) as any[];
    if (rows.length === 0) return null;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const haversineMiles = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 3958.7613;
      const dLatR = toRad(lat2 - lat1);
      const dLonR = toRad(lon2 - lon1);
      const a = Math.sin(dLatR / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLonR / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    };
    const ranked = rows
      .map((r) => ({
        call_sign: String(r.call_sign || ''),
        officer_name: r.officer_name || null,
        when: String(r.recorded_at || ''),
        distance_miles: Number(haversineMiles(lat, lng, r.latitude, r.longitude).toFixed(2)),
      }))
      .filter((r) => r.distance_miles <= 0.1)
      .sort((a, b) => (a.when < b.when ? 1 : -1));
    return ranked[0] || null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// 16. Existing open civil case for this defendant (avoid duplicate creation)
// ─────────────────────────────────────────────────────────────────────
function existingOpenCase(db: Db, defendantPersonId: number | null): EnrichmentResult['existingOpenCase'] {
  if (!defendantPersonId) return null;
  try {
    const row = db.prepare(`
      SELECT id, case_number, title
      FROM cases
      WHERE defendant_person_id = ? AND status = 'open'
      ORDER BY created_at DESC LIMIT 1
    `).get(defendantPersonId) as any;
    if (!row) return null;
    return { id: Number(row.id), case_number: String(row.case_number), title: String(row.title || '') };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Main entry: run all enrichments and return a single result
// ─────────────────────────────────────────────────────────────────────
export function buildEnrichment(input: EnrichmentInput): EnrichmentResult {
  const fullName = `${input.defendant.first}${input.defendant.middle ? ' ' + input.defendant.middle : ''} ${input.defendant.last}`.trim();
  const contacts = priorContacts(input.db, input.defendantPersonId, fullName, input.defendant.dob);
  const risk = riskFlags(input.db, input.defendantPersonId, fullName);
  const addr = addressFrequency(input.db, input.address);
  const adjacent = adjacentOpenServes(input.db, input.latitude, input.longitude);
  const unitNumber = extractUnitNumber(input.address);
  const serviceWindows = buildServiceWindowsTracker(input.serviceWindowsLabel, input.dueDate);
  const bestTime = bestContactTime(input.db, input.defendantPersonId);
  const closestUnit = closestAvailableUnit(input.db, input.latitude, input.longitude);
  // ── New deeper-system enrichments ──
  const vehicles = knownVehicles(input.db, input.defendantPersonId);
  const associates = knownAssociates(input.db, input.defendantPersonId);
  const trespass = activeTrespassOrders(input.db, input.defendantPersonId);
  const premise = premiseAlerts(input.db, input.address);
  const priorAttempts = priorAttemptsAtAddress(input.db, input.address);
  const aliases = subjectAliases(input.db, input.defendantPersonId);
  const lastPatrol = lastPatrolNearAddress(input.db, input.latitude, input.longitude);
  const openCase = existingOpenCase(input.db, input.defendantPersonId);

  // Build narrative section. Each subsection is conditional on having data.
  const lines: string[] = [];
  lines.push('🔍 INTAKE ENRICHMENT');
  lines.push('═'.repeat(50));

  // Risk flags first (highest priority)
  const riskLines: string[] = [];
  if (risk.activeWarrants.count > 0) {
    riskLines.push(`⚠️ ACTIVE WARRANTS: ${risk.activeWarrants.count} (${risk.activeWarrants.types.join(', ').toUpperCase() || 'unspecified type'})`);
  }
  if (risk.activeBolos > 0) riskLines.push(`⚠️ ACTIVE BOLOS: ${risk.activeBolos}`);
  if (risk.officerSafetyFi > 0) riskLines.push(`⚠️ OFFICER SAFETY FI: ${risk.officerSafetyFi} prior contact(s) flagged`);
  if (trespass.length > 0) {
    trespass.forEach((t) => {
      riskLines.push(`⚠️ ACTIVE TRESPASS ORDER: ${t.order_number} @ ${t.location.slice(0, 50)}${t.expires ? ` (expires ${t.expires.slice(0, 10)})` : ''}`);
    });
  }
  if (premise.length > 0) {
    premise.forEach((p) => {
      const icon = p.alert_level === 'CRITICAL' ? '🛑' : p.alert_level === 'WARNING' ? '⚠️' : 'ℹ️';
      riskLines.push(`${icon} PREMISE ALERT [${p.alert_level}]: ${p.title}${p.description ? ` — ${p.description.slice(0, 80)}` : ''}`);
    });
  }
  if (riskLines.length > 0) {
    lines.push(...riskLines);
    lines.push('');
  }

  // Subject history
  if (contacts.callCount + contacts.incidentCount + contacts.arrestCount > 0) {
    const parts: string[] = [];
    if (contacts.callCount > 0) parts.push(`${contacts.callCount} prior call(s)`);
    if (contacts.incidentCount > 0) parts.push(`${contacts.incidentCount} incident(s)`);
    if (contacts.arrestCount > 0) parts.push(`${contacts.arrestCount} arrest(s)`);
    lines.push(`👤 SUBJECT HISTORY: ${parts.join(', ')}${contacts.lastContact ? ` — last contact ${contacts.lastContact.slice(0, 10)}` : ''}`);
  } else {
    lines.push('👤 SUBJECT HISTORY: no prior system contact');
  }

  // Aliases / known-as
  if (aliases.length > 0) {
    lines.push(`🪪 KNOWN AS: ${aliases.map((a) => `"${a}"`).join(', ')}`);
  }

  // Vehicles registered to subject
  if (vehicles.length > 0) {
    lines.push(`🚗 KNOWN VEHICLES (${vehicles.length}):`);
    vehicles.forEach((v) => {
      const desc = [v.year, v.color, v.make, v.model].filter(Boolean).join(' ').trim() || 'vehicle';
      lines.push(`   • ${v.plate}${v.state ? ` (${v.state})` : ''} — ${desc}`);
    });
  }

  // Known associates / co-residents
  if (associates.length > 0) {
    lines.push(`👥 KNOWN ASSOCIATES (${associates.length}):`);
    associates.forEach((a) => {
      lines.push(`   • ${a.name} — ${a.relationship}${a.notes ? ` — ${a.notes.slice(0, 60)}` : ''}`);
    });
    lines.push('   ↳ Sub-serve to a competent adult 16+ at residence may apply if defendant absent.');
  }

  // Address frequency
  if (addr.callCount + addr.incidentCount > 0) {
    const parts: string[] = [];
    if (addr.callCount > 0) parts.push(`${addr.callCount} call(s)`);
    if (addr.incidentCount > 0) parts.push(`${addr.incidentCount} incident(s)`);
    lines.push(`🏠 ADDRESS HISTORY (12mo): ${parts.join(', ')}${addr.lastVisit ? ` — last visit ${addr.lastVisit.slice(0, 10)}` : ''}`);
    if (addr.callCount > 3) lines.push(`   ↳ Repeat-visit location — unit should review prior dispositions before approach.`);
  }

  // Prior serve attempts at this exact address (any subject)
  if (priorAttempts.attempts > 0) {
    lines.push(`📋 PRIOR SERVE ATTEMPTS AT THIS ADDRESS: ${priorAttempts.attempts}${priorAttempts.lastResult ? ` — last result: ${priorAttempts.lastResult.toUpperCase()}` : ''}${priorAttempts.lastWhen ? ` (${priorAttempts.lastWhen.slice(0, 10)})` : ''}`);
    if (priorAttempts.lastResult && /not.served|no.contact|unable/i.test(priorAttempts.lastResult)) {
      lines.push(`   ↳ Prior attempt unsuccessful — vary attempt window and approach.`);
    }
  }

  // Last patrol GPS ping near address (within 0.1 mile, last 30 days)
  if (lastPatrol) {
    lines.push(`📡 LAST PATROL NEAR ADDRESS: ${lastPatrol.call_sign}${lastPatrol.officer_name ? ` (${lastPatrol.officer_name})` : ''} — ${lastPatrol.distance_miles}mi @ ${lastPatrol.when.slice(0, 16).replace('T', ' ')}`);
  }

  // Apartment / unit clarification
  if (unitNumber) {
    lines.push(`🚪 UNIT/APT: #${unitNumber} (auto-extracted from address)`);
  }

  // Adjacent jobs for route batching
  if (adjacent.length > 0) {
    lines.push('');
    lines.push(`🗺️ NEARBY OPEN SERVES (within 1mi):`);
    adjacent.forEach((a) => {
      lines.push(`   • ${a.call_number} — ${a.distance_miles.toFixed(1)}mi — ${a.address.slice(0, 60)}`);
    });
    lines.push(`   ↳ Consider batching attempts on the same patrol pass.`);
  }

  // Best contact window
  if (bestTime) {
    const fmt: Record<string, string> = {
      '06-09': '06:00-09:00', '09-12': '09:00-12:00', '12-15': '12:00-15:00',
      '15-18': '15:00-18:00', '18-21': '18:00-21:00', 'other': 'late evening / overnight',
    };
    lines.push('');
    lines.push(`📊 BEST CONTACT WINDOW: ${fmt[bestTime.window]} (based on ${bestTime.sampleSize} prior serve attempts on this subject)`);
  }

  // Diligence tracker
  lines.push('');
  lines.push(`📅 DILIGENCE WINDOWS REQUIRED: ${serviceWindows.required.map((w) => w.replace('_', ' ').toUpperCase()).join(' · ')}`);
  if (serviceWindows.next_required_by) {
    lines.push(`   ↳ Complete by ${serviceWindows.next_required_by}.`);
  }

  // Closest unit suggestion
  if (closestUnit) {
    lines.push('');
    lines.push(`🚓 CLOSEST AVAILABLE UNIT AT INTAKE: ${closestUnit.call_sign} — ${closestUnit.distance_miles}mi${closestUnit.officer_name ? ` (${closestUnit.officer_name})` : ''}`);
  }

  // Existing open civil case (avoid duplicate case creation downstream)
  if (openCase) {
    lines.push('');
    lines.push(`📁 EXISTING OPEN CASE FOR THIS DEFENDANT: ${openCase.case_number} — ${openCase.title}`);
    lines.push(`   ↳ Consider linking this serve to the existing case rather than creating a new one.`);
  }

  return {
    narrativeSection: lines.join('\n'),
    flags: {
      officerSafetyCaution: risk.activeWarrants.count > 0 || risk.officerSafetyFi > 0 || trespass.length > 0 || premise.some((p) => p.alert_level === 'CRITICAL' || p.alert_level === 'WARNING'),
      weaponsInvolved: risk.activeWarrants.types.includes('arrest') || risk.officerSafetyFi > 0,
      secondaryType: addr.callCount > 3 ? 'repeat_location' : null,
      premiseAlertActive: premise.length > 0,
      activeTrespassOrder: trespass.length > 0,
    },
    unitNumber,
    serviceWindows,
    closestUnit,
    knownVehicles: vehicles,
    existingOpenCase: openCase,
  };
}
