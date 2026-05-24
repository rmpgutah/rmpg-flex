/**
 * Pure aggregation utilities for the Business dossier endpoint.
 *
 * No DB access, no Express imports — deterministic transformations only.
 * All time-of-day / day-of-week math runs in America/Denver (Mountain Time)
 * via Luxon, which handles DST transitions correctly.
 */
import { DateTime } from 'luxon';

const TZ = 'America/Denver';

/**
 * Day-of-week keys used in the hours JSON.
 * Index 0 corresponds to Monday so the array lines up with Luxon's
 * `weekday` value (1=Monday … 7=Sunday) via `(weekday - 1) % 7`.
 */
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

interface DayHours {
  open: string;  // 'HH:MM' 24h
  close: string; // 'HH:MM' 24h
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Returns true if `now` falls inside the open-close window for the
 * business's hours JSON, in America/Denver. Cross-midnight windows
 * (close < open) are handled by also consulting the previous day's
 * hours. Holidays in `holidaysJson` (array of YYYY-MM-DD strings)
 * force a false return regardless of hours.
 */
export function computeIsCurrentlyOpen(
  hoursJson: string | null | undefined,
  now: Date = new Date(),
  holidaysJson: string | null | undefined = null,
): boolean {
  if (!hoursJson) return false;

  let hours: Record<string, DayHours>;
  try {
    hours = JSON.parse(hoursJson);
  } catch {
    return false;
  }
  if (!hours || typeof hours !== 'object') return false;

  const dt = DateTime.fromJSDate(now).setZone(TZ);
  if (!dt.isValid) return false;

  // Holiday short-circuit
  if (holidaysJson) {
    try {
      const holidays: string[] = JSON.parse(holidaysJson);
      const today = dt.toISODate();
      if (Array.isArray(holidays) && today && holidays.includes(today)) {
        return false;
      }
    } catch {
      // ignore malformed holidays
    }
  }

  const dayIdx = (dt.weekday - 1) % 7; // 0=Mon … 6=Sun
  const todayKey = DAY_KEYS[dayIdx];
  const todaysHours = hours[todayKey];
  const currentMin = dt.hour * 60 + dt.minute;

  if (todaysHours && todaysHours.open && todaysHours.close) {
    const openMin = parseHHMM(todaysHours.open);
    const closeMin = parseHHMM(todaysHours.close);
    if (closeMin < openMin) {
      // Cross-midnight: open from openMin today through closeMin tomorrow.
      // If we're past openMin today, we're open. If we're before closeMin
      // today, that's covered by yesterday's window (handled below).
      if (currentMin >= openMin) return true;
    } else if (currentMin >= openMin && currentMin <= closeMin) {
      return true;
    }
  }

  // Check yesterday's cross-midnight window (e.g. bar Fri 18:00-02:00,
  // querying Sat 01:30 — yesterday's window covers it).
  const yesterdayIdx = (dt.weekday - 2 + 7) % 7;
  const yesterdayKey = DAY_KEYS[yesterdayIdx];
  const yHours = hours[yesterdayKey];
  if (yHours && yHours.open && yHours.close) {
    const yOpen = parseHHMM(yHours.open);
    const yClose = parseHHMM(yHours.close);
    if (yClose < yOpen && currentMin <= yClose) {
      return true;
    }
  }

  return false;
}

/**
 * Computes a 7×6 heatmap: matrix[day_of_week][hour_bucket].
 *  - day 0 = Monday, day 6 = Sunday
 *  - bucket size 4 hours; bucket 0 = 00:00–03:59, … bucket 5 = 20:00–23:59
 * Always returns a fully-shaped 7×6 matrix even for empty input.
 */
export function computeHeatmap(
  events: Array<{ occurred_at: string }>,
): number[][] {
  const matrix: number[][] = Array.from({ length: 7 }, () => [0, 0, 0, 0, 0, 0]);
  for (const e of events) {
    if (!e || !e.occurred_at) continue;
    const dt = DateTime.fromISO(e.occurred_at, { zone: TZ });
    if (!dt.isValid) continue;
    const day = (dt.weekday - 1) % 7;
    const bucket = Math.min(5, Math.max(0, Math.floor(dt.hour / 4)));
    matrix[day][bucket]++;
  }
  return matrix;
}

/**
 * Computes period-over-period trend.
 *  - pct_change: integer percent change in event count (recent vs prior).
 *    Special-cases divide-by-zero: 0/0 → 0, n/0 → 100.
 *  - week_buckets: length-4 array of recent-event counts grouped by week.
 *    week_buckets[3] is the most recent 7 days; [0] is days 22–28.
 *    Events older than 28 days from now() are dropped.
 */
export function computeTrend(
  recent: Array<{ occurred_at: string }>,
  prior: Array<{ occurred_at: string }>,
): { pct_change: number; week_buckets: number[] } {
  const recentCount = recent.length;
  const priorCount = prior.length;

  let pct_change: number;
  if (priorCount === 0) {
    pct_change = recentCount === 0 ? 0 : 100;
  } else {
    pct_change = Math.round(((recentCount - priorCount) / priorCount) * 100);
  }

  const week_buckets = [0, 0, 0, 0];
  const now = DateTime.now();
  for (const e of recent) {
    if (!e || !e.occurred_at) continue;
    const dt = DateTime.fromISO(e.occurred_at);
    if (!dt.isValid) continue;
    const days = now.diff(dt, 'days').days;
    if (days < 0 || days >= 28) continue;
    const weeksAgo = Math.floor(days / 7); // 0..3
    week_buckets[3 - weeksAgo]++;
  }

  return { pct_change, week_buckets };
}

interface LinkedPersonRisk {
  active_warrant_count?: number;
  is_sex_offender?: boolean | number;
  flags?: string;
}

/**
 * Heuristic risk score for a business based on linked persons and
 * recent incident count. Higher = more attention warranted.
 *  - +5 per incident in last 30 days, capped at 30
 *  - +15 per linked person with an active warrant
 *  - +10 per linked person flagged as sex offender
 *  - +12 per linked person whose flags string contains 'VIOLENT'
 *
 * Levels: <15 low, 15–39 moderate, 40–69 high, ≥70 critical.
 */
export function computeRiskScore(
  _business: any,
  linkedPersons: LinkedPersonRisk[],
  incidentCount30d: number,
): { score: number; level: 'low' | 'moderate' | 'high' | 'critical' } {
  let score = 0;
  score += Math.min((incidentCount30d || 0) * 5, 30);
  for (const p of linkedPersons || []) {
    if (!p) continue;
    if ((p.active_warrant_count || 0) > 0) score += 15;
    if (p.is_sex_offender) score += 10;
    if (typeof p.flags === 'string' && p.flags.includes('VIOLENT')) score += 12;
  }

  let level: 'low' | 'moderate' | 'high' | 'critical';
  if (score >= 70) level = 'critical';
  else if (score >= 40) level = 'high';
  else if (score >= 15) level = 'moderate';
  else level = 'low';

  return { score, level };
}

// ============================================================
// Business dossier — aggregates 12 panels of data for a single
// business into a flat JSON payload. Used by
// `GET /api/records/businesses/:id/dossier` (Task 1.18).
//
// Schema-fragile cross-table queries (trespass_orders, bolos)
// are wrapped in try/catch returning [] so a schema gap does
// not 500 the whole dossier. The encrypted `alarm_info` block
// is stripped entirely for client_viewer / human_resources.
// ============================================================

import { decryptAlarmField } from './businessEncryption';

const ROLE_PRIORITY: Record<string, number> = {
  owner: 0,
  officer_director: 1,
  manager: 2,
  key_holder: 3,
  security_contact: 4,
  employee: 5,
  vendor: 6,
  other: 7,
};

const ALARM_RESTRICTED_ROLES = new Set(['client_viewer', 'human_resources']);

function safeQuery<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function buildBusinessDossier(
  db: any,
  businessId: number,
  userRole: string | undefined,
): any | null {
  const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId) as any;
  if (!business) return null;

  // ── Linked persons (with active warrant count) ─────────────
  const linkedRows = db.prepare(`
    SELECT bp.id AS link_id, bp.role, bp.start_date, bp.end_date, bp.notes,
           p.id AS person_id, p.first_name, p.last_name, p.dob, p.flags, p.is_sex_offender, p.photo_url,
           (SELECT COUNT(*) FROM warrants w
              WHERE w.subject_person_id = p.id AND w.status = 'active') AS active_warrant_count
      FROM business_persons bp
      JOIN persons p ON p.id = bp.person_id
     WHERE bp.business_id = ?
  `).all(businessId) as any[];

  const linked_persons = linkedRows
    .map((r) => ({
      link_id: r.link_id,
      role: r.role,
      start_date: r.start_date,
      end_date: r.end_date,
      notes: r.notes,
      person: {
        id: r.person_id,
        first_name: r.first_name,
        last_name: r.last_name,
        dob: r.dob,
        flags: r.flags,
        is_sex_offender: r.is_sex_offender,
        photo_url: r.photo_url,
        active_warrant_count: Number(r.active_warrant_count || 0),
      },
    }))
    .sort((a, b) => {
      const pa = ROLE_PRIORITY[a.role] ?? 99;
      const pb = ROLE_PRIORITY[b.role] ?? 99;
      if (pa !== pb) return pa - pb;
      return (a.person.last_name || '').localeCompare(b.person.last_name || '');
    });

  // ── Active trespass orders (schema-fragile) ────────────────
  const active_trespass_orders = safeQuery<any[]>(
    () =>
      db.prepare(`
        SELECT id, order_number, status, subject_first_name, subject_last_name,
               person_id, effective_date, expiration_date
          FROM trespass_orders
         WHERE protected_business_id = ? AND status = 'active'
         ORDER BY effective_date DESC
      `).all(businessId) as any[],
    [],
  );

  // ── Active BOLOs (schema-fragile) ──────────────────────────
  const active_bolos = safeQuery<any[]>(
    () =>
      db.prepare(`
        SELECT id, bolo_number, type, title, priority, status, expires_at, created_at
          FROM bolos
         WHERE linked_business_id = ? AND status = 'active'
         ORDER BY created_at DESC
      `).all(businessId) as any[],
    [],
  );

  // ── Recent activity: incidents + calls (last 365d) ─────────
  const incidents = db.prepare(`
    SELECT i.id, i.incident_number, i.incident_type, i.status, i.created_at AS occurred_at, i.priority
      FROM incident_businesses ib
      JOIN incidents i ON i.id = ib.incident_id
     WHERE ib.business_id = ?
     ORDER BY i.created_at DESC
     LIMIT 50
  `).all(businessId) as any[];

  const calls = db.prepare(`
    SELECT c.id, c.call_number, c.incident_type, c.priority, c.status, c.created_at AS occurred_at
      FROM call_businesses cb
      JOIN calls_for_service c ON c.id = cb.call_id
     WHERE cb.business_id = ?
     ORDER BY c.created_at DESC
     LIMIT 50
  `).all(businessId) as any[];

  const counts = {
    incident_count: (db.prepare('SELECT COUNT(*) AS n FROM incident_businesses WHERE business_id = ?')
      .get(businessId) as any).n,
    call_count: (db.prepare('SELECT COUNT(*) AS n FROM call_businesses WHERE business_id = ?')
      .get(businessId) as any).n,
  };

  const recent_activity = { incidents, calls, counts };

  // ── Heatmap + trend over recent activity ───────────────────
  const allEvents = [
    ...incidents.map((i: any) => ({ occurred_at: i.occurred_at })),
    ...calls.map((c: any) => ({ occurred_at: c.occurred_at })),
  ];
  const heatmap = computeHeatmap(allEvents);

  const now = Date.now();
  const D28 = 28 * 24 * 3600 * 1000;
  const D56 = 56 * 24 * 3600 * 1000;
  const recentEvents = allEvents.filter((e) => {
    const t = Date.parse(e.occurred_at);
    return !isNaN(t) && now - t <= D28;
  });
  const priorEvents = allEvents.filter((e) => {
    const t = Date.parse(e.occurred_at);
    return !isNaN(t) && now - t > D28 && now - t <= D56;
  });
  const trend = computeTrend(recentEvents, priorEvents);

  // ── Risk score (last-30-day incidents) ─────────────────────
  const incidentCount30d = incidents.filter((i: any) => {
    const t = Date.parse(i.occurred_at);
    return !isNaN(t) && now - t <= 30 * 24 * 3600 * 1000;
  }).length;
  const risk_score = computeRiskScore(business, linked_persons.map((lp) => lp.person), incidentCount30d);

  // ── Hours block ────────────────────────────────────────────
  const hours = {
    hours_of_operation: business.hours_of_operation || null,
    holiday_schedule: business.holiday_schedule || null,
    is_currently_open: computeIsCurrentlyOpen(
      business.hours_of_operation,
      new Date(),
      business.holiday_schedule,
    ),
  };

  // ── Photos ─────────────────────────────────────────────────
  const photos = safeQuery<any[]>(
    () =>
      db.prepare(`
        SELECT id, url, caption, category, uploaded_at
          FROM business_photos
         WHERE business_id = ?
         ORDER BY uploaded_at DESC
      `).all(businessId) as any[],
    [],
  );

  // ── Vehicles (use plate_number, not plate) ─────────────────
  const vehicles = safeQuery<any[]>(
    () =>
      db.prepare(`
        SELECT bv.id AS link_id, bv.relationship, bv.notes,
               v.id AS vehicle_id, v.plate_number, v.state, v.make, v.model, v.year, v.color
          FROM business_vehicles bv
          JOIN vehicles_records v ON v.id = bv.vehicle_id
         WHERE bv.business_id = ?
         ORDER BY bv.created_at DESC
      `).all(businessId) as any[],
    [],
  );

  // ── Recent visits ──────────────────────────────────────────
  const visits = safeQuery<any[]>(
    () =>
      db.prepare(`
        SELECT id, officer_id, visit_at, latitude, longitude, notes
          FROM business_visits
         WHERE business_id = ?
         ORDER BY visit_at DESC
         LIMIT 25
      `).all(businessId) as any[],
    [],
  );

  // ── Related businesses (same parent_company) ───────────────
  const related_businesses = safeQuery<any[]>(
    () => {
      if (!business.parent_company) return [];
      return db.prepare(`
        SELECT id, name, dba_name, address, city, state
          FROM businesses
         WHERE parent_company = ? AND id != ? AND archived_at IS NULL
         ORDER BY name
         LIMIT 25
      `).all(business.parent_company, businessId) as any[];
    },
    [],
  );

  // ── Alarm info (conditional, encrypted-at-rest) ────────────
  const role = (userRole || '').toLowerCase();
  const includeAlarm = !ALARM_RESTRICTED_ROLES.has(role);

  const dossier: any = {
    business,
    linked_persons,
    active_trespass_orders,
    recent_activity,
    hours,
    photos,
    vehicles,
    visits,
    related_businesses,
    active_bolos,
    heatmap,
    trend,
    risk_score,
    meta: {
      generated_at: new Date().toISOString(),
      version: 1,
    },
  };

  if (includeAlarm) {
    dossier.alarm_info = {
      alarm_company: business.alarm_company || null,
      panel_code: decryptAlarmField(business.alarm_panel_code || null),
      passphrase: decryptAlarmField(business.alarm_passphrase || null),
      after_hours_contact_name: business.after_hours_contact_name || null,
      after_hours_contact_phone: business.after_hours_contact_phone || null,
    };
  }

  return dossier;
}
